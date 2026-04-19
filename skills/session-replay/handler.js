/**
 * session-replay skill handler
 * Replay past session experiences using BM25 search.
 * Delegates to scripts/session_replay.py for actual search.
 */

const PYTHON = 'C:/Users/Administrator/AppData/Local/Programs/Python/Python312/python.exe';
const REPLAY_SCRIPT = 'C:/Users/Administrator/.openclaw/workspace/scripts/session_replay.py';

export default async function sessionReplayHandler(event) {
  // Extract query
  let input = '';
  if (event.type === 'message' && event.context?.content) {
    input = event.context.content;
  } else if (event.message?.content) {
    input = event.message.content;
  }

  // Parse: /replay <query>
  const match = input.match(/^\/replay\s+(.+)$/is);
  if (!match) {
    return {
      handled: true,
      skill: 'session-replay',
      response: `Usage: /replay <task_description>\n\nExamples:\n  /replay 如何配置 gateway\n  /replay 分析 claude code 源码\n  /replay 创建新 skill\n\nSearches past sessions for similar tasks and their solutions using BM25 ranking.`,
    };
  }

  const query = match[1].trim();

  return await runReplay(query);
}

async function runReplay(query) {
  try {
    const { execFileSync } = await import('node:child_process');

    const result = execFileSync(PYTHON, [REPLAY_SCRIPT, query, '5'], {
      encoding: 'utf8',
      timeout: 30000,
      maxBuffer: 1024 * 1024,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    });

    const data = JSON.parse(result.trim());

    if (data.error) {
      return {
        handled: true,
        skill: 'session-replay',
        response: `Replay failed: ${data.error}`,
      };
    }

    if (data.count === 0) {
      return {
        handled: true,
        skill: 'session-replay',
        response: `No similar sessions found for: "${query}"\n\nTry different keywords or check if sessions have been indexed.`,
        query,
        count: 0,
      };
    }

    // Format output
    const lines = [
      '=== Session Replay ===',
      `Query: ${query}`,
      `Found ${data.count} similar session(s):`,
      '',
    ];

    for (let i = 0; i < data.results.length; i++) {
      const r = data.results[i];
      lines.push(`--- Session ${i + 1} ---`);
      lines.push(`  Session: ${r.sessionId.slice(0, 16)}... | Score: ${r.score} | Msgs: ${r.messageCount}`);
      if (r.timestamp) lines.push(`  Time: ${r.timestamp}`);
      lines.push(`  ${r.snippet}`);
      lines.push('');
    }

    lines.push(`Run /replay "${query}" to search again.`);

    return {
      handled: true,
      skill: 'session-replay',
      response: lines.join('\n'),
      query,
      count: data.count,
      results: data.results,
    };
  } catch (e) {
    return {
      handled: true,
      skill: 'session-replay',
      response: `Session replay failed: ${e.message}`,
      error: e.message,
    };
  }
}
