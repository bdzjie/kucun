/**
 * memory-hook/handler.js
 * Auto-save Memory Hook for OpenClaw
 *
 * The hook loader imports this module's default export and registers it
 * for each event listed in HOOK.md frontmatter events[].
 */

import { appendFileSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';

const STATE_DIR = 'C:/Users/Administrator/.openclaw';
const MEMORY_DIR = STATE_DIR + '/memory';

// ============================================================================
// File Helpers
// ============================================================================

function ensureMemoryDir() {
  if (!existsSync(MEMORY_DIR)) mkdirSync(MEMORY_DIR, { recursive: true });
}

function readJsonFile(filePath, fallback = null) {
  try {
    if (!existsSync(filePath)) return fallback;
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch { return fallback; }
}

function writeJsonFile(filePath, data) {
  ensureMemoryDir();
  writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

// ============================================================================
// Memory Operations
// ============================================================================

function getL0Content() {
  const identity = readJsonFile(MEMORY_DIR + '/identity.json', {});
  const name = identity?.name || 'Q仔';
  const role = identity?.role || 'AI 商务助理';
  return `[Identity] Name: ${name} | Role: ${role} | Vibe: 专业、高效、直接`;
}

function appendMemoryEntry(entry) {
  ensureMemoryDir();
  const line = JSON.stringify({
    ...entry,
    timestamp: Date.now(),
    id: entry.id || `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  }) + '\n';
  appendFileSync(MEMORY_DIR + '/memories.jsonl', line, 'utf8');
}

function addPalaceDrawer(wing, room, hall, content, metadata = {}) {
  const palace = readJsonFile(MEMORY_DIR + '/palace_state.json', { drawers: [] });
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
  writeJsonFile(MEMORY_DIR + '/palace_state.json', palace);
  return drawer;
}

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
    for (const kw of keywords) { if (lower.includes(kw)) score++; }
    if (score > bestScore) { bestScore = score; bestType = type; }
  }
  return bestScore >= 1 ? bestType : 'general';
}

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
  const drawer = addPalaceDrawer(wing, room, hall, content, { senderName, conversationId, sessionKey, type });
  appendMemoryEntry({ type: 'auto_saved_memory', drawerId: drawer.id, wing, room, hall, content, senderName, conversationId, sessionKey });
  console.log(`[memory-hook] Stored ${type} memory: "${content.slice(0, 50)}..."`);
}

// ============================================================================
// Hook Handlers (called by the hook loader based on event type)
// ============================================================================

async function onAgentBootstrap(event) {
  const { sessionKey, workspaceDir } = event.context || {};
  console.log(`[memory-hook] agent:bootstrap session=${sessionKey}`);
  try {
    const l0 = getL0Content();
    if (event.messages) event.messages.push(`[Memory L0] ${l0}`);
    console.log(`[memory-hook] Injected L0: ${l0.slice(0, 60)}`);
  } catch (e) {
    console.warn('[memory-hook] L0 injection failed:', e.message);
  }
}

async function onMessagePreprocessed(event) {
  const { context } = event;
  const { content, senderId, senderName, conversationId } = context || {};
  if (!content || content.trim().length < 15) return;
  try {
    extractAndStoreMemory(content, senderName || senderId || 'unknown', conversationId, event.sessionKey);
  } catch (e) {
    console.warn('[memory-hook] Memory extraction failed:', e.message);
  }
}

async function onSessionPatch(event) {
  const { context } = event;
  const { patch } = context || {};
  const endedAt = patch?.endedAt;
  if (!endedAt) return;
  console.log(`[memory-hook] session:end sessionKey=${event.sessionKey}`);
  try {
    appendMemoryEntry({ type: 'session_end', sessionKey: event.sessionKey, endedAt });
  } catch (e) {
    console.warn('[memory-hook] Session end logging failed:', e.message);
  }

  // Auto Skill Creator — Hermes: detect patterns after session end
  try {
    triggerAutoSkillCreator();
  } catch (e) {
    console.warn('[memory-hook] Auto skill creator failed:', e.message);
  }
}

function triggerAutoSkillCreator() {
  const scriptPath = resolve(STATE_DIR.replace(/\\/g, '/'), 'workspace/modules/auto_skill_creator.py');
  const proc = spawn('python', [scriptPath], { stdio: 'pipe' });
  let stdout = '';
  let stderr = '';
  proc.stdout.on('data', d => { stdout += d.toString(); });
  proc.stderr.on('data', d => { stderr += d.toString(); });
  proc.on('close', code => {
    if (code === 0 && stdout.trim()) {
      try {
        const result = JSON.parse(stdout.trim());
        if (result.skills_created > 0) {
          console.log(`[memory-hook] Auto-skill: created ${result.skills_created} skill(s): ${result.created_skills.join(', ')}`);
        } else {
          console.log(`[memory-hook] Auto-skill: checked ${result.candidates_found} candidates — no new skills (threshold: 60%)`);
        }
      } catch { /* ignore parse errors */ }
    } else if (stderr) {
      console.warn('[memory-hook] Auto-skill stderr:', stderr.slice(0, 100));
    }
  });
}

// ============================================================================
// Default Export — OpenClaw hook loader dispatches by event.type
// ============================================================================

export default async function memoryHookHandler(event) {
  if (event.type === 'agent' && event.action === 'bootstrap') return onAgentBootstrap(event);
  if (event.type === 'message' && event.action === 'preprocessed') return onMessagePreprocessed(event);
  if (event.type === 'session' && event.action === 'patch') return onSessionPatch(event);
}
