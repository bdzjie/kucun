/**
 * memory_hook.mjs — OpenClaw Internal Hook for Auto-Save Memory
 * ============================================================
 *
 * Opens: ~/.openclaw/memory/memories.jsonl (append-only WAL)
 *        ~/.openclaw/memory/palace_state.json (palace drawer state)
 *
 * This is a PURE JavaScript module — no TypeScript compilation required.
 * OpenClaw loads it as a legacy hook (trusted local code).
 */

// ============================================================================
// Constants
// ============================================================================

const STATE_DIR = 'C:/Users/Administrator/.openclaw';
const MEMORY_DIR = STATE_DIR + '/memory';
const MEMORIES_FILE = MEMORY_DIR + '/memories.jsonl';
const PALACE_FILE = MEMORY_DIR + '/palace_state.json';
const IDENTITY_FILE = MEMORY_DIR + '/identity.json';

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
// Memory Operations
// ============================================================================

/**
 * Load L0 identity content for agent bootstrap.
 */
function getL0Content() {
  const identity = readJsonFile(IDENTITY_FILE, {});
  const name = identity?.name || 'Q仔';
  const role = identity?.role || 'AI 商务助理';
  return `[Identity] Name: ${name} | Role: ${role} | Vibe: 专业、高效、直接`;
}

/**
 * Append a memory entry to the WAL file.
 */
function appendMemoryEntry(entry) {
  ensureMemoryDir();
  const line = JSON.stringify({
    ...entry,
    timestamp: Date.now(),
    id: entry.id || `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  }) + '\n';
  appendFileSync(MEMORIES_FILE, line, 'utf8');
}

/**
 * Add a palace drawer (BM25-indexed memory).
 */
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
 * Classify text into memory type (simple keyword-based classifier).
 */
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

/**
 * Extract memory from a message and store it.
 */
function extractAndStoreMemory(content, senderName, conversationId, sessionKey) {
  if (!content || content.trim().length < 15) return;

  const type = classifyText(content);
  if (type === 'general') return;

  const wing = 'wing_user';
  const room = conversationId ? `session_${conversationId.slice(0, 8)}` : 'session_general';
  const hall = type === 'decision' ? 'hall_facts'
    : type === 'preference' ? 'hall_preferences'
    : type === 'milestone' || type === 'problem' ? 'hall_events'
    : 'hall_advice';

  const drawer = addPalaceDrawer(wing, room, hall, content, {
    senderName,
    conversationId,
    sessionKey,
    type
  });

  appendMemoryEntry({
    type: 'auto_saved_memory',
    drawerId: drawer.id,
    wing,
    room,
    hall,
    content,
    senderName,
    conversationId,
    sessionKey
  });

  console.log(`[memory_hook] Stored ${type} memory: "${content.slice(0, 50)}..."`);
}

// ============================================================================
// BM25 Index (in-memory, rebuilt from palace_state.json on load)
// ============================================================================

// Simple in-memory BM25 index — rebuilt from palace_state.json
const bm25Index = new Map(); // term -> [{docId, tf, positions}]

function tokenize(text) {
  return text.toLowerCase()
    .replace(/[^\w\s\u4e00-\u9fff]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 1);
}

function buildBm25Index() {
  const palace = readJsonFile(PALACE_FILE, { drawers: [] });
  bm25Index.clear();
  const N = palace.drawers?.length || 1;

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
 * agent:bootstrap — Inject L0 identity into agent context.
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
 * message:preprocessed — Auto-save important messages to memory.
 */
export async function onMessagePreprocessed(event) {
  const { context } = event;
  const { content, senderId, senderName, conversationId } = context || {};

  if (!content || content.trim().length < 15) return;

  try {
    extractAndStoreMemory(
      content,
      senderName || senderId || 'unknown',
      conversationId,
      event.sessionKey
    );
  } catch (error) {
    console.warn('[memory_hook] Failed to extract memory:', error.message);
  }
}

/**
 * session:patch — Detect session end and trigger final save.
 */
export async function onSessionPatch(event) {
  const { context } = event;
  const { sessionEntry, patch } = context || {};

  const endedAt = patch?.endedAt;
  if (!endedAt) return;

  console.log(`[memory_hook] session:end sessionKey=${event.sessionKey}`);

  try {
    appendMemoryEntry({
      type: 'session_end',
      sessionKey: event.sessionKey,
      endedAt,
      sessionEntry
    });
    console.log(`[memory_hook] Session end logged: ${event.sessionKey}`);
  } catch (error) {
    console.warn('[memory_hook] Failed to log session end:', error.message);
  }
}

// ============================================================================
// Default export — OpenClaw calls this at module load time.
// The loader then registers the named exports (onAgentBootstrap, etc.) internally.
// ============================================================================

export default async function memoryHookExtension(api) {
  console.log('[memory_hook] Module loaded. Building BM25 index from palace state...');
  try {
    buildBm25Index();
    console.log('[memory_hook] BM25 index built. Hook handlers: agent:bootstrap, message:preprocessed, session:patch');
  } catch (error) {
    console.warn('[memory_hook] BM25 index build failed:', error.message);
  }
}
