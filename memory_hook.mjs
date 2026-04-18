/**
 * memory_hook.mjs — OpenClaw Internal Hook v2
 * =============================================================
 *
 * GenericAgent 启发实现：
 * 1. Summary 标签格式 — 工具结果+意图的精确快照
 * 2. 行动验证写入原则 — 只有验证成功的执行才写入记忆
 * 3. SOP 结晶提示 — 任务成功后生成可复用技能的指引
 *
 * Opens: ~/.openclaw/memory/memories.jsonl (WAL)
 *        ~/.openclaw/memory/palace_state.json (BM25-indexed drawers)
 *        ~/.openclaw/memory/sop_registry.json (skill crystallized SOPs)
 */

// ============================================================================
// Constants
// ============================================================================

const STATE_DIR = 'C:/Users/Administrator/.openclaw';
const MEMORY_DIR = STATE_DIR + '/memory';
const MEMORIES_FILE = MEMORY_DIR + '/memories.jsonl';
const PALACE_FILE = MEMORY_DIR + '/palace_state.json';
const IDENTITY_FILE = MEMORY_DIR + '/identity.json';
const SOP_REGISTRY_FILE = MEMORY_DIR + '/sop_registry.json';
const L4_DIR = MEMORY_DIR + '/L4_raw_sessions';

// ============================================================================
// File Helpers
// ============================================================================

import { appendFileSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

function ensureMemoryDir() {
  if (!existsSync(MEMORY_DIR)) {
    mkdirSync(MEMORY_DIR, { recursive: true });
  }
}

function readJsonFile(filePath, fallback = null) {
  try {
    if (!existsSync(filePath)) return fallback;
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJsonFile(filePath, data) {
  ensureMemoryDir();
  writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

// ============================================================================
// Turn Counter (for per-N-turn tool schema refresh)
// ============================================================================

let turnCount = 0;

function getNextTurn() {
  return ++turnCount;
}

// GenericAgent 每10轮重置 tools，防止位置退化
// OpenClaw 通过 hook 暴露这一信息，供 agent 在工具调用时检查
function shouldResetTools() {
  // 每10轮返回 true，强制重新发送完整 tool schema
  return turnCount > 0 && turnCount % 10 === 0;
}

// ============================================================================
// L0 Identity
// ============================================================================

function getL0Content() {
  const identity = readJsonFile(IDENTITY_FILE, {});
  const name = identity?.name || 'Q仔';
  const role = identity?.role || 'AI 商务助理';
  return `[Identity] Name: ${name} | Role: ${role} | Vibe: 专业、高效、直接`;
}

// ============================================================================
// Summary Tag Format (GenericAgent 风格)
// ============================================================================

/**
 * 生成 GenericAgent 风格的 summary 标签。
 * 这是"物理快照"——精确描述工具结果 + 下一步意图。
 *
 * 格式：
 * <summary> 工具结果+意图快照 </summary>
 * <content> 原始消息内容 </content>
 * <verified> true/false </verified>
 */
function buildSummaryTag(content, toolResults, nextIntent) {
  const parts = [];

  // 工具结果快照（精确、无幻觉）
  if (toolResults && toolResults.length > 0) {
    const resultSummary = toolResults
      .slice(0, 3)  // 最多3个结果
      .map(r => {
        const status = r.status || 'unknown';
        const name = r.toolName || r.name || 'unknown';
        const snippet = typeof r.result === 'string'
          ? r.result.slice(0, 100)
          : JSON.stringify(r.result).slice(0, 100);
        return `[${status}] ${name}: ${snippet}`;
      })
      .join(' | ');
    parts.push(`工具结果: ${resultSummary}`);
  }

  // 下一步意图（简洁）
  if (nextIntent) {
    parts.push(`意图: ${nextIntent.slice(0, 80)}`);
  }

  // 原始内容摘要
  parts.push(`原文: ${content.slice(0, 120)}`);

  return `<summary> ${parts.join(' | ')} </summary>`;
}

// ============================================================================
// Action Verification — 行动验证写入原则
// ============================================================================

/**
 * 验证工具执行是否成功。
 * 只有成功的执行结果才能写入记忆（防止幻觉）。
 *
 * GenericAgent 原则：No Execution, No Memory.
 */
function verifyToolSuccess(toolResult) {
  if (!toolResult) return false;

  const status = toolResult.status || toolResult.success;

  // 认为成功的情况
  if (status === 'success' || status === true) return true;

  // 认为失败的情况
  if (status === 'error' || status === false || status === 'failed') return false;

  // 字符串状态检查
  const statusStr = String(status).toLowerCase();
  if (statusStr.includes('error') || statusStr.includes('fail') || statusStr.includes('timeout')) {
    return false;
  }

  // 有内容但无明确失败标记 →保守地认为成功
  return toolResult.result !== undefined && toolResult.result !== null;
}

/**
 * 从事件上下文中提取工具结果。
 */
function extractVerifiedToolResults(context) {
  const results = [];

  // 尝试从 toolResults 字段获取
  const toolResults = context?.toolResults || context?.tool_call_results || [];
  for (const r of toolResults) {
    if (verifyToolSuccess(r)) {
      results.push({
        toolName: r.toolName || r.name || 'unknown',
        status: 'success',
        result: r.result || r.output || r.content
      });
    }
  }

  // 尝试从 message 结果中提取
  const message = context?.message || context?.assistantMessage || {};
  const contentBlocks = message?.content || message?.blocks || [];
  for (const block of contentBlocks) {
    if (block?.type === 'tool_result' && verifyToolSuccess(block)) {
      results.push({
        toolName: block.name || 'unknown',
        status: 'success',
        result: block.content
      });
    }
  }

  return results;
}

// ============================================================================
// Memory Storage
// ============================================================================

function appendMemoryEntry(entry) {
  ensureMemoryDir();
  const line = JSON.stringify({
    ...entry,
    timestamp: Date.now(),
    id: entry.id || `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  }) + '\n';
  appendFileSync(MEMORIES_FILE, line, 'utf8');
}

function addPalaceDrawer(wing, room, hall, content, metadata = {}) {
  const palace = readJsonFile(PALACE_FILE, { drawers: [] });
  const drawer = {
    id: `drawer_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    wing,
    room,
    hall,
    content,
    metadata,
    addedAt: Date.now()
  };
  palace.drawers = palace.drawers || [];
  palace.drawers.push(drawer);
  writeJsonFile(PALACE_FILE, palace);
  return drawer;
}

/**
 * 用 GenericAgent 风格存储记忆：
 * - 带 summary 标签（工具结果+意图快照）
 * - 行动验证通过
 */
function storeVerifiedMemory(content, type, senderName, conversationId, sessionKey, toolResults, nextIntent) {
  // 构建 summary 格式
  const summaryTag = buildSummaryTag(content, toolResults, nextIntent);
  const fullContent = `${summaryTag}\n<content> ${content} </content>`;

  const wing = 'wing_user';
  const room = conversationId ? `session_${conversationId.slice(0, 8)}` : 'session_general';
  const hall = type === 'decision' ? 'hall_facts'
    : type === 'preference' ? 'hall_preferences'
    : type === 'milestone' || type === 'problem' ? 'hall_events'
    : 'hall_advice';

  const drawer = addPalaceDrawer(wing, room, hall, fullContent, {
    senderName,
    conversationId,
    sessionKey,
    type,
    verified: true,
    toolResultsCount: toolResults?.length || 0
  });

  appendMemoryEntry({
    type: 'verified_memory',
    drawerId: drawer.id,
    wing,
    room,
    hall,
    content: fullContent,
    senderName,
    conversationId,
    sessionKey,
    toolResults,
    turn: turnCount
  });

  console.log(`[memory_hook] Verified memory stored [${type}] turn=${turnCount}: "${content.slice(0, 60)}..."`);
}

// ============================================================================
// Memory Classifier
// ============================================================================

function classifyText(text) {
  const lower = text.toLowerCase();
  const markers = {
    decision: ['decided', 'chose', 'going with', 'because', 'trade-off', 'better to', 'approach', '的选择', '决定', '因为'],
    preference: ['prefer', 'always', 'never', 'my rule', '喜欢', '偏好', '从不', '一定'],
    milestone: ['fixed it', 'breakthrough', 'finally', 'worked', 'achieved', '成功', '终于', '突破', '第一次'],
    problem: ['bug', 'root cause', 'fix was', 'issue', 'failed', 'broke', '问题', '错误', '修复'],
    emotional: ['love', 'hate', 'feel', 'angry', 'sorry', 'excited', '喜欢', '讨厌', '感觉', '!']
  };

  let bestType = 'general';
  let bestScore = 0;

  for (const [type, keywords] of Object.entries(markers)) {
    let score = 0;
    for (const kw of keywords) {
      if (lower.includes(kw)) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      bestType = type;
    }
  }

  return bestScore >= 1 ? bestType : 'general';
}

// ============================================================================
// SOP Crystallization (GenericAgent Skill 自进化)
// ============================================================================

/**
 * 检测是否可以结晶为 SOP。
 * 条件：任务成功完成 + 执行路径可描述 + 足够复杂（不是简单问答）
 */
function detectCrystallizableTask(content, toolResults, turn) {
  // 太简单的任务不需要结晶
  if (!content || content.trim().length < 30) return false;
  if (content.includes('?') && !toolResults?.length) return false; // 简单问答不过

  // 有工具执行结果 → 可以结晶
  if (toolResults?.length > 0) return true;

  // 关键字触发
  const triggerKeywords = [
    'install', 'setup', 'configure', 'deploy', 'build', 'create', 'write', 'run',
    '安装', '配置', '部署', '构建', '创建', '执行', '编写'
  ];
  const lower = content.toLowerCase();
  return triggerKeywords.some(kw => lower.includes(kw));
}

/**
 * 从工具执行路径生成 SOP 片段。
 */
function generateSopFragment(content, toolResults) {
  const steps = [];

  // 从工具结果提取关键步骤
  if (toolResults?.length > 0) {
    for (const r of toolResults) {
      const snippet = typeof r.result === 'string'
        ? r.result.slice(0, 200)
        : JSON.stringify(r.result).slice(0, 200);
      steps.push(`  ${r.toolName}: ${snippet}`);
    }
  }

  return {
    trigger: content.slice(0, 100),
    steps: steps.join('\n'),
    generatedAt: new Date().toISOString()
  };
}

/**
 * 注册 SOP 到 registry。
 */
function registerSop(content, toolResults, sessionKey) {
  const registry = readJsonFile(SOP_REGISTRY_FILE, { sops: [] });

  const sop = {
    id: `sop_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    trigger: content.slice(0, 100),
    fragment: generateSopFragment(content, toolResults),
    sessionKey,
    turn,
    createdAt: Date.now()
  };

  registry.sops = registry.sops || [];
  registry.sops.push(sop);

  // 最多保留 50 个 SOP
  if (registry.sops.length > 50) {
    registry.sops = registry.sops.slice(-50);
  }

  writeJsonFile(SOP_REGISTRY_FILE, registry);
  console.log(`[memory_hook] SOP crystallized: "${content.slice(0, 50)}..." (total: ${registry.sops.length})`);

  return sop;
}

// ============================================================================
// L4 Session Archiver (会话→长期记忆沉淀)
// ============================================================================

function archiveSessionToL4(sessionKey, sessionData) {
  ensureMemoryDir();
  if (!existsSync(L4_DIR)) {
    mkdirSync(L4_DIR, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `session_${sessionKey}_${timestamp}.json`;
  const filepath = resolve(L4_DIR, filename);

  const archiveEntry = {
    sessionKey,
    archivedAt: Date.now(),
    messages: sessionData.messages || [],
    summary: sessionData.summary || '',
    turnCount: sessionData.turnCount || 0
  };

  writeFileSync(filepath, JSON.stringify(archiveEntry, null, 2), 'utf8');
  console.log(`[memory_hook] L4 archived: ${filename}`);

  return filepath;
}

// ============================================================================
// BM25 Index
// ============================================================================

const bm25Index = new Map();

function tokenize(text) {
  return text.toLowerCase()
    .replace(/[^\w\s\u4e00-\u9fff]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 1);
}

function buildBm25Index() {
  const palace = readJsonFile(PALACE_FILE, { drawers: [] });
  bm25Index.clear();

  for (const drawer of (palace.drawers || [])) {
    const terms = tokenize(drawer.content);
    const termFreq = new Map();
    for (const term of terms) {
      termFreq.set(term, (termFreq.get(term) || 0) + 1);
    }

    for (const [term, tf] of termFreq) {
      if (!bm25Index.has(term)) {
        bm25Index.set(term, { df: 0, docs: [] });
      }
      const entry = bm25Index.get(term);
      entry.df++;
      entry.docs.push({ docId: drawer.id, tf, docLen: terms.length });
    }
  }
}

// ============================================================================
// Hook Handlers
// ============================================================================

/**
 * agent:bootstrap — Inject L0 identity.
 */
export async function onAgentBootstrap(event) {
  const { sessionKey, workspaceDir } = event.context || {};
  console.log(`[memory_hook] agent:bootstrap session=${sessionKey} workspace=${workspaceDir}`);

  try {
    const l0 = getL0Content();
    if (event.messages) {
      event.messages.push(`[Memory L0] ${l0}`);
    }
    console.log(`[memory_hook] Injected L0 memory: ${l0.slice(0, 60)}`);
  } catch (error) {
    console.warn('[memory_hook] Failed to load L0 memory:', error.message);
  }
}

/**
 * message:preprocessed — Auto-save with action verification.
 *
 * GenericAgent 原则：No Execution, No Memory.
 * 只有工具执行成功，才将消息结晶为记忆。
 */
export async function onMessagePreprocessed(event) {
  const { context } = event;
  const { content, senderId, senderName, conversationId } = context || {};

  if (!content || content.trim().length < 15) return;

  // 递增 turn counter
  const currentTurn = getNextTurn();

  // 提取并验证工具执行结果（行动验证核心）
  const verifiedToolResults = extractVerifiedToolResults(context);

  // GenericAgent 风格：任务成功后结晶为 SOP
  if (detectCrystallizableTask(content, verifiedToolResults, currentTurn)) {
    try {
      registerSop(content, verifiedToolResults, event.sessionKey);
    } catch (error) {
      console.warn('[memory_hook] SOP crystallization failed:', error.message);
    }
  }

  // 行动验证：只有验证成功的执行才写入记忆
  // 条件：至少有1个验证成功的工具结果，或内容包含明确的决策/偏好/里程碑
  const hasVerifiedExecution = verifiedToolResults.length > 0;
  const type = classifyText(content);
  const isSignificantType = ['decision', 'preference', 'milestone', 'problem'].includes(type);

  if (hasVerifiedExecution || isSignificantType) {
    try {
      // 推断下一步意图（如果有工具结果）
      const nextIntent = verifiedToolResults.length > 0
        ? `Continue with ${verifiedToolResults[0].toolName}...`
        : null;

      storeVerifiedMemory(
        content,
        type,
        senderName || senderId || 'unknown',
        conversationId,
        event.sessionKey,
        verifiedToolResults,
        nextIntent
      );
    } catch (error) {
      console.warn('[memory_hook] Memory store failed:', error.message);
    }
  }

  // 暴露 turn count 供 agent 检查（用于每10轮 reset tools）
  if (event.context) {
    event.context.currentTurn = currentTurn;
    event.context.shouldResetTools = shouldResetTools();
  }
}

/**
 * session:patch — Detect session end and trigger L4 archive.
 */
export async function onSessionPatch(event) {
  const { context } = event;
  const { sessionEntry, patch } = context || {};

  const endedAt = patch?.endedAt;
  if (!endedAt) return;

  console.log(`[memory_hook] session:end sessionKey=${event.sessionKey}`);

  try {
    // L4 归档：会话结束时自动沉淀到 L4_raw_sessions
    if (sessionEntry) {
      archiveSessionToL4(event.sessionKey, {
        messages: sessionEntry.messages || [],
        summary: sessionEntry.summary || '',
        turnCount: turnCount
      });
    }

    appendMemoryEntry({
      type: 'session_end',
      sessionKey: event.sessionKey,
      endedAt,
      turnCount,
      sessionEntry
    });

    // 重置 turn counter（会话结束）
    turnCount = 0;
    console.log(`[memory_hook] Session end logged + L4 archived: ${event.sessionKey}`);
  } catch (error) {
    console.warn('[memory_hook] Session end + L4 archive failed:', error.message);
  }
}

// ============================================================================
// Default export
// ============================================================================

export default async function memoryHookExtension(api) {
  console.log('[memory_hook] v2 loaded — GenericAgent principles: Summary Tags + Action Verification + SOP Crystallization + L4 Archive');
  try {
    buildBm25Index();
    console.log('[memory_hook] BM25 index built');
  } catch (error) {
    console.warn('[memory_hook] BM25 index build failed:', error.message);
  }
}
