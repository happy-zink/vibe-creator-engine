import 'dotenv/config';
import OpenAI from 'openai';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { CRITIC_PROMPT } from './prompts/critic.js';
import { CREATOR_PROMPT } from './prompts/creator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── OpenAI Client ─────────────────────────────────────────────────────

if (!process.env.OPENAI_API_KEY) {
  console.error('❌ 缺少 OPENAI_API_KEY，请在 .env 文件中配置');
  process.exit(1);
}

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_BASE_URL || undefined,
});

export const CRITIC_USER_SUFFIX = `\n\n请严格按照以下 JSON 格式输出评分结果，不要输出任何其他内容：
{"score": <数字>, "feedback": "<具体的修改建议>"}`;

const MODEL = process.env.OPENAI_MODEL || 'gpt-4o';

// ─── Core API Call ─────────────────────────────────────────────────────

export async function callAI(systemPrompt, userPrompt) {
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];

  const completion = await client.chat.completions.create({
    model: MODEL,
    messages,
    temperature: 0.7,
  });

  // Some reasoning models put the answer in reasoning_content when content is empty
  const raw = (completion.choices?.[0]?.message?.content?.trim())
    || (completion.choices?.[0]?.message?.reasoning_content?.trim())
    || '';
  if (!raw) throw new Error('AI 返回内容为空');

  // Warn if output was truncated but still return it for validation
  if (completion.choices?.[0]?.finish_reason === 'length') {
    log(`  [callAI] 输出被截断 (token 上限)，尝试使用已生成部分`);
  }

  return raw;
}

// ─── JSON Safe Parse ───────────────────────────────────────────────────

export function parseCriticJSON(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]+\}/);
    if (match) {
      try {
        const obj = JSON.parse(match[0]);
        if (typeof obj.score === 'number' && typeof obj.feedback === 'string') {
          return obj;
        }
      } catch { /* fall through */ }
    }
    throw new Error('Critic 返回内容无法解析为 JSON');
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────

const MAX_HTML_SIZE = 512 * 1024;

export function sanitizeFilename(raw) {
  return raw.replace(/[^a-zA-Z0-9_\-]/g, '');
}

function sanitizeForMetaComment(str) {
  return str.replace(/--/g, '——').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function validateHTML(code) {
  if (!code || typeof code !== 'string') throw new Error('生成内容为空或类型错误');
  if (code.length > MAX_HTML_SIZE) throw new Error(`内容超出大小上限 (${MAX_HTML_SIZE} bytes)`);
  if (!/<html[\s>]/i.test(code)) {
    throw new Error('生成内容不是合法的 HTML 文档');
  }
}

export function ensureClosedHTML(code) {
  if (!/<\/html>/i.test(code)) {
    return code.trimEnd() + '\n</html>';
  }
  return code;
}

// ─── Agentic Loop (supports optional event callback) ───────────────────

export async function generateVibePage(seed, { onEvent, log = console.log, userId = null } = {}) {
  const emit = (event) => {
    if (onEvent) onEvent(event);
  };

  log(`\n🎨 Vibe Creator Engine — 自循环创意工作流启动`);
  log(`   种子: "${seed}"\n`);

  let currentPrompt = seed;
  let iteration = 0;
  const maxIterations = 3;
  let finalCode = '';
  let score, feedback;
  let bestScore = 0;
  let bestCode = '';

  while (iteration < maxIterations) {
    iteration++;
    log(`─── 第 ${iteration}/${maxIterations} 轮迭代 ─────────────────────`);

    // ── Creator (with 1 retry) ──
    let creatorOk = false;
    for (let attempt = 0; attempt < 2 && !creatorOk; attempt++) {
      try {
        log('  [Creator] 正在调用 LLM 生成页面...');
        emit({ type: 'step', role: 'Creator', iteration, msg: attempt === 0 ? '沉思中...' : '再思...' });

        const raw = await callAI(CREATOR_PROMPT, currentPrompt);
        finalCode = ensureClosedHTML(raw.replace(/^```html\s*/i, '').replace(/```\s*$/, '').trim());
        validateHTML(finalCode);
        log(`  [Creator] 生成完成 (${finalCode.length} 字符)`);
        emit({ type: 'step', role: 'Creator', iteration, msg: `生成完成 (${finalCode.length} 字符)` });
        creatorOk = true;
      } catch (err) {
        log(`  [Creator] 生成失败 (尝试 ${attempt + 1}/2): ${err.message}`);
        if (attempt === 0) emit({ type: 'step', role: 'Creator', iteration, msg: '思绪中断，重新提笔...' });
      }
    }
    if (!creatorOk) {
      emit({ type: 'error', role: 'Creator', msg: '生成页面失败，请稍后重试' });
      return null;
    }

    // ── Critic (with 1 retry) ──
    let criticOk = false;
    for (let attempt = 0; attempt < 2 && !criticOk; attempt++) {
      try {
        log('  [Critic] 正在审美审查...');
        emit({ type: 'step', role: 'Critic', iteration, msg: attempt === 0 ? '静观中...' : '细品中...' });

        const criticRaw = await callAI(CRITIC_PROMPT, finalCode + CRITIC_USER_SUFFIX);
        const parsed = parseCriticJSON(criticRaw);
        score = parsed.score;
        feedback = parsed.feedback;

        if (typeof score !== 'number' || typeof feedback !== 'string') {
          throw new Error('Critic JSON 字段缺失或类型错误');
        }

        log(`  [Critic] 评分: ${score}/100 | ${feedback}`);
        emit({ type: 'score', role: 'Critic', iteration, score, feedback });
        criticOk = true;
      } catch (err) {
        log(`  [Critic] 审查失败 (尝试 ${attempt + 1}/2): ${err.message}`);
        if (attempt === 0) emit({ type: 'step', role: 'Critic', iteration, msg: '目光游移，再次审视...' });
      }
    }
    if (!criticOk) {
      emit({ type: 'error', role: 'Critic', msg: '审查过程失败，请稍后重试' });
      return null;
    }

    // ── Track best version ──
    if (score > bestScore) {
      bestScore = score;
      bestCode = finalCode;
    }

    // ── Decision ──
    if (score >= 90) {
      log('\n  ✅ 达标！作品通过审查。');
      emit({ type: 'done', score, feedback });

      const timestamp = sanitizeFilename(
        new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
      );
      const rand = Math.random().toString(36).slice(2, 6);
      const filename = `vibe-${timestamp}-${rand}.html`;
      const outputDir = userId
        ? path.resolve(__dirname, '..', 'output', userId)
        : path.resolve(__dirname, '..', 'output');
      const outputPath = path.resolve(outputDir, filename);

      if (!outputPath.startsWith(outputDir)) {
        log('\n  ❌ 文件路径越界，已阻止写入。');
        return { html: finalCode, score, iterations: iteration, filename: null };
      }

      await fs.mkdir(outputDir, { recursive: true });
      // Embed metadata as HTML comment (sanitize to prevent injection)
      const safeSeed = sanitizeForMetaComment(seed);
      const metaComment = `<!-- vibe-meta: ${JSON.stringify({ seed: safeSeed, score, iterations: iteration })} -->`;
      const codeWithMeta = finalCode.replace(/<!DOCTYPE/i, `${metaComment}\n<!DOCTYPE`);
      await fs.writeFile(outputPath, codeWithMeta, 'utf-8');
      log(`\n  📄 文件已保存: ${userId ? 'output/' + userId + '/' : 'output/'}${filename}`);
      return { html: codeWithMeta, score, iterations: iteration, filename };
    }

    // ── Feedback Loop ──
    currentPrompt = `${seed}\n\n[Critic 反馈 (第 ${iteration} 轮)]: ${feedback}\n请根据以上反馈重新生成，修正所有指出的问题。`;
    log('\n  ⏳ 携带反馈进入下一轮迭代...\n');
  }

  // ── Fallback: use the best-scoring version across all iterations ──
  if (bestScore > score) {
    log(`\n  📝 已达到最大迭代次数，当前最高分为 ${bestScore} 分，采取保底机制输出。`);
    finalCode = bestCode;
    score = bestScore;
  } else {
    log(`\n  📝 已达最大迭代次数，当前最高分为 ${bestScore} 分，输出最终版本。`);
  }
  emit({ type: 'done', score, feedback });

  const timestamp = sanitizeFilename(
    new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  );
  const rand = Math.random().toString(36).slice(2, 6);
  const filename = `vibe-${timestamp}-${rand}.html`;
  const outputDir = userId
    ? path.resolve(__dirname, '..', 'output', userId)
    : path.resolve(__dirname, '..', 'output');
  const outputPath = path.resolve(outputDir, filename);

  if (!outputPath.startsWith(outputDir)) {
    log('\n  ❌ 文件路径越界，已阻止写入。');
    return { html: finalCode, score, iterations: maxIterations, filename: null };
  }

  await fs.mkdir(outputDir, { recursive: true });

  const safeSeed = sanitizeForMetaComment(seed);
  const metaComment = `<!-- vibe-meta: ${JSON.stringify({ seed: safeSeed, score, iterations: maxIterations })} -->`;
  const codeWithMeta = finalCode.replace(/<!DOCTYPE/i, `${metaComment}\n<!DOCTYPE`);
  await fs.writeFile(outputPath, codeWithMeta, 'utf-8');
  log(`  📄 最终版本已保存: ${userId ? 'output/' + userId + '/' : 'output/'}${filename}\n`);

  return { html: codeWithMeta, score, iterations: maxIterations, filename };
}
