import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateVibePage } from './core.js';
import { registerUser, loginUser, getSession, deleteSession, requireAuth } from './auth.js';
import fs from 'fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// ─── Security: restrict CORS to local dev origins ──────────────────────

app.use(cors({
  origin(origin, cb) {
    if (!origin || /^https?:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)) {
      cb(null, true);
    } else {
      cb(null, false);
    }
  },
}));

// ─── Security headers ───────────────────────────────────────────────────

app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.removeHeader('X-Powered-By');
  next();
});

app.use(express.json({ limit: '1mb' }));

// ─── Rate limiting (simple in-memory) ──────────────────────────────────

const rateLimit = new Map();
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_REQUESTS = 3;

function checkRate(ip) {
  const now = Date.now();
  const entry = rateLimit.get(ip);
  if (!entry || now - entry.start > RATE_WINDOW_MS) {
    rateLimit.set(ip, { start: now, count: 1 });
    return true;
  }
  entry.count++;
  return entry.count <= RATE_MAX_REQUESTS;
}

// Evict stale rate-limit entries every minute
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimit) {
    if (now - entry.start > RATE_WINDOW_MS) rateLimit.delete(ip);
  }
}, RATE_WINDOW_MS);

// ─── Health check ──────────────────────────────────────────────────────

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

// ─── Auth Routes ────────────────────────────────────────────────────────

app.post('/api/auth/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || typeof username !== 'string') {
    return res.status(400).json({ error: '请输入用户名' });
  }
  const result = await registerUser(username.trim(), password || null);
  if (result.error) {
    return res.status(400).json({ error: result.error });
  }
  res.json(result);
});

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || typeof username !== 'string') {
    return res.status(400).json({ error: '请输入用户名' });
  }
  const result = await loginUser(username.trim(), password || null);
  if (result.error) {
    return res.status(400).json({ error: result.error });
  }
  res.json(result);
});

app.get('/api/auth/me', (req, res) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: '未登录' });
  }
  const session = getSession(header.slice(7));
  if (!session) {
    return res.status(401).json({ error: '会话已过期' });
  }
  res.json({ user: { id: session.userId, username: session.username } });
});

app.delete('/api/auth/session', (req, res) => {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    deleteSession(header.slice(7));
  }
  res.json({ ok: true });
});

// ─── List output files (per user) ──────────────────────────────────────

app.get('/api/works', requireAuth, async (req, res) => {
  try {
    const outputDir = path.resolve(__dirname, '..', 'output', req.userId);
    const files = await fs.readdir(outputDir).catch(() => []);
    const htmlFiles = files.filter(f => f.endsWith('.html')).sort().reverse();
    const works = await Promise.all(htmlFiles.map(async (f) => {
      let title = f.replace(/\.html$/, '');
      let score = null;
      let seed = null;
      let iterations = null;
      try {
        const content = await fs.readFile(path.resolve(outputDir, f), 'utf-8');
        const match = content.match(/<title>([^<]*)<\/title>/i);
        if (match && match[1].trim()) title = match[1].trim();
        if (f.includes('-draft')) score = '<90';
        // Extract embedded metadata
        const metaMatch = content.match(/<!-- vibe-meta: ({.*?}) -->/);
        if (metaMatch) {
          try {
            const meta = JSON.parse(metaMatch[1]);
            seed = meta.seed || null;
            if (typeof meta.score === 'number') score = meta.score;
            iterations = meta.iterations || null;
          } catch { /* ignore */ }
        }
      } catch { /* use filename as fallback */ }
      const stat = await fs.stat(path.resolve(outputDir, f));
      const createdAt = stat.mtime.toISOString();
      return { id: f, title, filename: f, createdAt, score, seed, iterations };
    }));
    res.json({ works });
  } catch {
    res.json({ works: [] });
  }
});

// ─── Get single work content (per user) ────────────────────────────────

app.get('/api/works/:filename', requireAuth, async (req, res) => {
  const { filename } = req.params;
  if (!/^[^\\/:*?"<>|]+\.html$/i.test(filename) || filename.includes('..')) {
    return res.status(400).json({ error: '非法文件名' });
  }
  try {
    const outputDir = path.resolve(__dirname, '..', 'output', req.userId);
    const filePath = path.resolve(outputDir, filename);
    if (!filePath.startsWith(outputDir)) {
      return res.status(403).json({ error: '禁止访问' });
    }
    const content = await fs.readFile(filePath, 'utf-8');
    res.type('html').send(content);
  } catch {
    res.status(404).json({ error: '文件不存在' });
  }
});

// ─── Delete a work (per user) ──────────────────────────────────────────

app.delete('/api/works/:filename', requireAuth, async (req, res) => {
  const { filename } = req.params;
  if (!/^[^\\/:*?"<>|]+\.html$/i.test(filename) || filename.includes('..')) {
    return res.status(400).json({ error: '非法文件名' });
  }
  try {
    const outputDir = path.resolve(__dirname, '..', 'output', req.userId);
    const filePath = path.resolve(outputDir, filename);
    if (!filePath.startsWith(outputDir)) {
      return res.status(403).json({ error: '禁止访问' });
    }
    await fs.unlink(filePath);
    res.json({ ok: true });
  } catch {
    res.status(404).json({ error: '文件不存在' });
  }
});

// ─── Generate via SSE (Server-Sent Events, per user) ──────────────────

app.post('/api/generate', requireAuth, async (req, res) => {
  const ip = req.ip || req.socket.remoteAddress;

  if (!checkRate(ip)) {
    return res.status(429).json({ error: '请求过于频繁，请稍后再试' });
  }

  const { seed } = req.body;

  if (!seed || typeof seed !== 'string' || seed.trim().length === 0) {
    return res.status(400).json({ error: '请提供创意种子' });
  }

  if (seed.length > 500) {
    return res.status(400).json({ error: '创意种子过长，请控制在 500 字以内' });
  }

  // SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'X-Accel-Buffering': 'no',
    Connection: 'keep-alive',
  });

  let closed = false;
  const sendEvent = (data) => {
    if (!closed && !res.destroyed) {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
      if (res.flush) res.flush();
    }
  };

  // Keepalive: send SSE comment every 15s to prevent connection timeout
  const keepalive = setInterval(() => {
    if (!closed && !res.destroyed) {
      res.write(': keepalive\n\n');
      if (res.flush) res.flush();
    }
  }, 15_000);

  // Timeout: 10 min (3 rounds × 2 calls × ~140s each with reasoning model)
  const timeout = setTimeout(() => {
    closed = true;
    clearInterval(keepalive);
    sendEvent({ type: 'error', msg: '生成超时，请重试' });
    res.end();
  }, 600_000);

  req.on('close', () => { closed = true; clearInterval(keepalive); });

  try {
    const result = await generateVibePage(seed.trim(), {
      onEvent: sendEvent,
      log: () => {},
      userId: req.userId,
    });

    clearTimeout(timeout);
    clearInterval(keepalive);

    if (!closed) {
      if (result) {
        sendEvent({ type: 'result', html: result.html, score: result.score, iterations: result.iterations, filename: result.filename });
      } else {
        sendEvent({ type: 'error', msg: '生成过程中遇到问题，请重试' });
      }
    }
  } catch (err) {
    clearTimeout(timeout);
    clearInterval(keepalive);
    console.error('Generate error:', err.message, err.stack);
    if (!closed) sendEvent({ type: 'error', msg: '服务器内部错误，请稍后重试' });
  }

  if (!closed) res.end();
});

// ─── Generate via SSE (GET for EventSource) ──────────────────────────

app.get('/api/generate', requireAuth, async (req, res) => {
  const ip = req.ip || req.socket.remoteAddress;

  if (!checkRate(ip)) {
    return res.status(429).json({ error: '请求过于频繁，请稍后再试' });
  }

  const seed = req.query.seed;

  if (!seed || typeof seed !== 'string' || seed.trim().length === 0) {
    return res.status(400).json({ error: '请提供创意种子' });
  }

  if (seed.length > 500) {
    return res.status(400).json({ error: '创意种子过长，请控制在 500 字以内' });
  }

  // SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'X-Accel-Buffering': 'no',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': req.headers.origin || '*',
  });

  let closed = false;
  const sendEvent = (data) => {
    if (!closed && !res.destroyed) {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
      if (res.flush) res.flush();
    }
  };

  // Keepalive: send SSE comment every 15s to prevent connection timeout
  const keepalive = setInterval(() => {
    if (!closed && !res.destroyed) {
      res.write(': keepalive\n\n');
      if (res.flush) res.flush();
    }
  }, 15_000);

  // Timeout: 10 min
  const timeout = setTimeout(() => {
    closed = true;
    clearInterval(keepalive);
    sendEvent({ type: 'error', msg: '生成超时，请重试' });
    sendEvent({ type: 'DONE' });
    res.end();
  }, 600_000);

  req.on('close', () => { closed = true; clearInterval(keepalive); clearTimeout(timeout); });

  try {
    const result = await generateVibePage(seed.trim(), {
      onEvent: sendEvent,
      log: () => {},
      userId: req.userId,
    });

    clearTimeout(timeout);
    clearInterval(keepalive);

    if (!closed && !res.destroyed) {
      if (result) {
        sendEvent({ type: 'result', html: result.html, score: result.score, iterations: result.iterations, filename: result.filename });
      } else {
        sendEvent({ type: 'error', msg: '生成过程中遇到问题，请重试' });
      }
      sendEvent({ type: 'DONE' });
      res.end();
    }
  } catch (err) {
    clearTimeout(timeout);
    clearInterval(keepalive);
    console.error('Generate error:', err.message, err.stack);
    if (!closed && !res.destroyed) {
      sendEvent({ type: 'error', msg: '服务器内部错误，请稍后重试' });
      sendEvent({ type: 'DONE' });
      res.end();
    }
  }
});

// ─── Start (bind to localhost only) ────────────────────────────────────

app.listen(PORT, '127.0.0.1', () => {
  console.log(`🚀 API 服务器运行中: http://127.0.0.1:${PORT}`);
  console.log(`   仅绑定本地回环地址，外部无法直接访问`);
});
