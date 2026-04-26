// cone-memory/handler.js — M-flow Cone Graph Memory Query Handler
// Bridges to Python MemoryOrchestrator via memory_query_bridge.py

import { execSync } from 'child_process';

const WORKSPACE = 'C:/Users/Administrator/.openclaw/workspace';
const PY = 'python';

/**
 * Call memory_query_bridge.py to run a memory query
 */
function queryMemory(query, mode = 'episodic', hybridWeight = 0.3) {
  const script = `${WORKSPACE}/memory_query_bridge.py`;
  const cmd = `${PY} "${script}" "${query.replace(/"/g, '\\"')}" ${mode} --hybrid-weight=${hybridWeight}`;
  try {
    const output = execSync(cmd, {
      encoding: 'utf-8',
      timeout: 30000,
      maxBuffer: 2 * 1024 * 1024,
    });
    // Parse last JSON block from output
    const jsonStart = output.lastIndexOf('{');
    if (jsonStart < 0) return null;
    return JSON.parse(output.slice(jsonStart));
  } catch (e) {
    return null;
  }
}

/**
 * Format memory bundle as markdown
 */
function formatBundle(state) {
  if (!state || !state.results) return '无法获取记忆结果';

  const { results, router_result, retrieval_mode } = state;
  const layer = router_result?.layer?.toUpperCase() || '—';
  const mode = (retrieval_mode || 'episodic').toUpperCase();
  const count = results.length;

  let md = `# 🧠 Cone Graph Memory\n\n`;
  md += `> **检索模式:** ${mode} | **入口层:** ${layer} | **命中:** ${count} episodes\n\n`;

  if (count === 0) {
    md += `_没有找到相关记忆_`;
    return md;
  }

  for (const ep of results) {
    const score = ((ep.score || 0) * 100).toFixed(0);
    md += `## ${ep.id} ${score >= 80 ? '🟢' : score >= 50 ? '🟡' : '⚪'} ${score}%\n\n`;
    md += `${ep.summary || '(无摘要)'}\n\n`;
    if (ep.facets && ep.facets.length > 0) {
      md += `**Facets:** ${ep.facets.map(f => f.topic || f.id).join(' · ')}\n\n`;
    }
    md += `---\n\n`;
  }

  return md;
}

export default async function handler(input, context) {
  // Extract query: use input directly or parse from context.message
  let query = (input || '').trim();
  let mode = 'episodic';

  // If no explicit query, try to get it from context
  if (!query && context?.message) {
    // Strip known command prefixes
    query = context.message
      .replace(/^\/memory\s*/i, '')
      .replace(/^search\s*memory\s*/i, '')
      .replace(/^query\s*memory\s*/i, '')
      .replace(/^remember\s*/i, '')
      .replace(/^do\s*you\s*remember\s*/i, '')
      .replace(/^what\s*do\s*you\s*remember\s*/i, '')
      .trim();
  }

  // Parse optional mode and hybrid_weight from query
  // e.g., "/memory deadline episodic hybrid=0.5" or "/memory project hybrid=0.7"
  const modeMatch = query.match(/\s+(episodic|lexical|unified|procedural)\s*$/i);
  if (modeMatch) {
    mode = modeMatch[1].toLowerCase();
    query = query.replace(/\s+(episodic|lexical|unified|procedural)\s*$/i, '').trim();
  }
  let hybridWeight = 0.3;
  const hybridMatch = query.match(/hybrid=([\d.]+)/i);
  if (hybridMatch) {
    hybridWeight = Math.max(0, Math.min(1, parseFloat(hybridMatch[1])));
    query = query.replace(/hybrid=[\d.]+/i, '').trim();
  }

  if (!query) {
    return {
      success: false,
      output: `Usage: /memory <query> [episodic|lexical|unified|procedural] [hybrid=W]\n\nExamples:\n  /memory deadline communication\n  /memory project status episodic\n  /memory deadline hybrid=0.7\n\n检索模式:\n  episodic (默认) — 图传播评分，适合精确记忆召回\n  lexical — BM25关键词，适合简单查询\n  unified — 混合模式\n\nhybrid_weight (BM25权重): 0.0=纯TF-IDF, 1.0=纯BM25, 默认0.3`,
    };
  }

  const state = queryMemory(query, mode, hybridWeight);

  if (!state || state.error) {
    return {
      success: false,
      output: `记忆查询失败${state?.error ? ': ' + state.error : ''}\n\n请确保 cone_graph.db 和 cone_vector 索引已构建。\n运行: python _rebuild_data.py && python _rebuild_vector.py`,
    };
  }

  const md = formatBundle(state);

  return {
    success: true,
    output: md,
    metadata: {
      query,
      mode: state.retrieval_mode,
      layer: state.router_result?.layer,
      episodeCount: state.results?.length || 0,
      topScore: state.results?.[0]?.score || 0,
    },
  };
}
