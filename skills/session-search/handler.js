/**
 * session-search skill handler
 * Searches historical sessions using SQLite FTS5 BM25
 */

import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';

const STATE_DIR = 'C:/Users/Administrator/.openclaw';
const MEMORY_DIR = STATE_DIR + '/memory';
const DB_PATH = MEMORY_DIR + '/fts5.db';

function execPythonBridge(args) {
  return new Promise((resolve, reject) => {
    const bridgeScript = resolve(STATE_DIR.replace(/\\/g, '/'), 'workspace/modules/search/sqlite_fts5_bridge.py');
    const proc = spawn('python', [bridgeScript, ...args], { encoding: 'utf8', timeout: 15000 });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', d => { stdout += d.toString(); });
    proc.stderr.on('data', d => { stderr += d.toString(); });
    proc.on('close', code => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(stderr || `Exit code ${code}`));
    });
    proc.on('error', err => reject(err));
  });
}

function parseSearchResults(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function formatResults(results) {
  if (!results || results.length === 0) {
    return '没有找到相关会话记录。';
  }

  // Group by session
  const bySession = {};
  for (const r of results) {
    if (!bySession[r.session_id]) {
      bySession[r.session_id] = [];
    }
    bySession[r.session_id].push(r);
  }

  let output = `找到 **${results.length}** 条相关记录，覆盖 **${Object.keys(bySession).length}** 个会话：\n\n`;

  for (const [sessionId, msgs] of Object.entries(bySession)) {
    const sessionLabel = sessionId.slice(0, 8);
    const score = msgs[0].score;
    output += `### 会话 ${sessionLabel}...\n`;
    output += `BM25 相关度: **${score.toFixed(3)}** | 命中消息: **${msgs.length}**\n\n`;

    for (const msg of msgs.slice(0, 3)) {
      const role = msg.role === 'user' ? '👤 用户' : '🤖 助手';
      const snippet = msg.snippet || msg.content.slice(0, 150);
      output += `**${role}**: ${snippet}\n\n`;
    }
    output += '---\n\n';
  }

  return output;
}

export default async function sessionSearchHandler(event) {
  // Extract search query from the user's message
  let query = '';

  if (event.type === 'message' && event.context?.content) {
    // Direct message content
    query = event.context.content;
  } else if (event.message?.content) {
    query = event.message.content;
  }

  if (!query || query.trim().length < 2) {
    return {
      handled: true,
      skill: 'session-search',
      response: '请提供搜索内容。例如：「搜索关于 hook 系统的会话」'
    };
  }

  // Clean query — remove skill invocation prefix if present
  query = query.replace(/^(search|搜索|查找|look up|find)/i, '').trim();

  // Also remove common filler
  query = query.replace(/^(我之前|之前|之前我|有没有|有没有人)/i, '').trim();

  try {
    const raw = await execPythonBridge(['search', query, DB_PATH, '10']);
    const results = parseSearchResults(raw);
    const formatted = formatResults(results);

    return {
      handled: true,
      skill: 'session-search',
      response: formatted,
      results,
    };
  } catch (e) {
    return {
      handled: true,
      skill: 'session-search',
      response: `搜索失败: ${e.message}`,
    };
  }
}
