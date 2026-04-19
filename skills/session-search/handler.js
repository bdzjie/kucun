/**
 * session-search skill handler
 * Pure TypeScript FTS5-style BM25 session search
 * No Python subprocess needed — works natively in Node.js/Bun
 */

const STATE_DIR = 'C:/Users/Administrator/.openclaw';
const SESSIONS_DIR = STATE_DIR + '/agents/main/sessions';

let _indexBuilt = false;

async function ensureIndex() {
  if (_indexBuilt) return;
  try {
    const { rebuildIndex } = await import('../../modules/search/session_fts.ts');
    rebuildIndex(SESSIONS_DIR);
    _indexBuilt = true;
  } catch (e) {
    console.warn('[session-search] Index build failed:', e.message);
  }
}

function formatResults(results) {
  if (!results || results.length === 0) {
    return '没有找到相关会话记录。';
  }

  // Group by session
  const bySession = {};
  for (const r of results) {
    if (!bySession[r.sessionId]) {
      bySession[r.sessionId] = [];
    }
    bySession[r.sessionId].push(r);
  }

  let output = `找到 **${results.length}** 条相关记录，覆盖 **${Object.keys(bySession).length}** 个会话：\n\n`;

  for (const [sessionId, msgs] of Object.entries(bySession)) {
    const sessionLabel = sessionId.slice(0, 8);
    const score = msgs[0].score;
    output += `### 会话 ${sessionLabel}...\n`;
    output += `BM25 相关度: **${score.toFixed(3)}** | 命中消息: **${msgs.length}**\n\n`;

    for (const msg of msgs.slice(0, 3)) {
      const role = msg.role === 'user' ? '用户' : '助手';
      const snippet = msg.snippet || msg.content.slice(0, 150);
      output += `**${role}**: ${snippet}\n\n`;
    }
    output += '---\n\n';
  }

  return output;
}

export default async function sessionSearchHandler(event) {
  let query = '';

  if (event.type === 'message' && event.context?.content) {
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

  // Clean query
  query = query
    .replace(/^(search|搜索|查找|look up|find)\s*/i, '')
    .replace(/^(我之前|之前|之前我|有没有|有没有人|我想知道)\s*/i, '')
    .trim();

  if (!query) {
    return {
      handled: true,
      skill: 'session-search',
      response: '请提供搜索内容。例如：「搜索关于 hook 系统的会话」'
    };
  }

  await ensureIndex();

  try {
    const { search } = await import('../../modules/search/session_fts.ts');
    const results = search(query, { limit: 10 });
    const formatted = formatResults(results);

    return {
      handled: true,
      skill: 'session-search',
      response: formatted,
      resultCount: results.length,
    };
  } catch (e) {
    return {
      handled: true,
      skill: 'session-search',
      response: `搜索失败: ${e.message}`,
    };
  }
}
