import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, 'data');
const USERS_FILE = path.resolve(DATA_DIR, 'users.json');

const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_KEYLEN = 64;
const PBKDF2_DIGEST = 'sha512';
const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

// In-memory sessions: token → { userId, username, createdAt }
const sessions = new Map();

// Clean expired sessions every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [token, session] of sessions) {
    if (now - session.createdAt > SESSION_MAX_AGE_MS) sessions.delete(token);
  }
}, 300_000);

// ─── User Store ──────────────────────────────────────────────────────────

async function readUsers() {
  try {
    const raw = await fs.readFile(USERS_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return { users: [] };
  }
}

async function writeUsers(data) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(USERS_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

// ─── Password Hashing (PBKDF2 with per-user salt) ──────────────────────

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, PBKDF2_KEYLEN, PBKDF2_DIGEST).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'string' || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const test = crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, PBKDF2_KEYLEN, PBKDF2_DIGEST).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(test, 'hex'));
}

// ─── Username Validation ─────────────────────────────────────────────────

const USERNAME_RE = /^[\w一-鿿]{2,20}$/;

export function validateUsername(username) {
  return typeof username === 'string' && USERNAME_RE.test(username);
}

// ─── Session Token ───────────────────────────────────────────────────────

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

// ─── Register ────────────────────────────────────────────────────────────

export async function registerUser(username, password) {
  if (!validateUsername(username)) {
    return { error: '用户名需为 2-20 位字母、数字、下划线或中文' };
  }

  const store = await readUsers();
  if (store.users.some(u => u.username === username)) {
    return { error: '用户名已存在' };
  }

  const user = {
    id: crypto.randomUUID(),
    username,
    passwordHash: password ? hashPassword(password) : null,
    createdAt: new Date().toISOString(),
  };

  store.users.push(user);
  await writeUsers(store);

  const token = generateToken();
  sessions.set(token, { userId: user.id, username: user.username, createdAt: Date.now() });

  return { token, user: { id: user.id, username: user.username, createdAt: user.createdAt } };
}

// ─── Login ───────────────────────────────────────────────────────────────

export async function loginUser(username, password) {
  const store = await readUsers();
  const user = store.users.find(u => u.username === username);

  // Generic error to prevent user enumeration
  const genericError = { error: '用户名或密码错误' };

  if (!user) {
    return genericError;
  }

  // If user set a password, it must match
  if (user.passwordHash) {
    if (!password || !verifyPassword(password, user.passwordHash)) {
      return genericError;
    }
  }

  const token = generateToken();
  sessions.set(token, { userId: user.id, username: user.username, createdAt: Date.now() });

  return { token, user: { id: user.id, username: user.username, createdAt: user.createdAt } };
}

// ─── Session Lookup ──────────────────────────────────────────────────────

export function getSession(token) {
  const session = sessions.get(token);
  if (!session) return null;
  if (Date.now() - session.createdAt > SESSION_MAX_AGE_MS) {
    sessions.delete(token);
    return null;
  }
  return session;
}

export function deleteSession(token) {
  sessions.delete(token);
}

// ─── Auth Middleware ──────────────────────────────────────────────────────

export function requireAuth(req, res, next) {
  // Support token from Authorization header OR query param (for EventSource)
  let token = null;
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    token = header.slice(7);
  } else if (req.query && req.query.token) {
    token = req.query.token;
  }

  if (!token) {
    return res.status(401).json({ error: '未登录' });
  }
  const session = getSession(token);
  if (!session) {
    return res.status(401).json({ error: '会话已过期，请重新登录' });
  }

  req.userId = session.userId;
  req.username = session.username;
  next();
}
