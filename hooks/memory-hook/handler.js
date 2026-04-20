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

// OMLS Idle Scheduler — reset idle counter on user activity
let _idleScheduler = null;
async function getIdleScheduler() {
  if (_idleScheduler) return _idleScheduler;
  try {
    _idleScheduler = await import('./modules/idleScheduler.mjs');
  } catch { _idleScheduler = { onActivity: () => {} }; }
  return _idleScheduler;
}

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
  const drawerId = `drawer_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const sessionKey = metadata?.sessionKey;

  // Watermark metadata (X-SIR inspired) — store seed for later verification
  const watermarkMeta = sessionKey ? {
    watermark_seed: `session_${sessionKey}`,
    watermark_strength: 0.15,
    watermark_version: '1.0',
  } : null;

  const drawer = {
    id: drawerId,
    wing,
    room,
    hall,
    content,
    metadata: { ...metadata, watermark: watermarkMeta },
    addedAt: Date.now(),
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
// Prompt Injection Detection — Inspired by EasyJailbreak Evaluator
// ============================================================================

const INJECTION_PATTERNS = [
  // 1. System Prompt Leakage
  { pattern: /ignore[\s\w]*previous[\s\w]*instructions/i, category: 'prompt_leak', severity: 2, name: 'Ignore Previous Instructions' },
  { pattern: /disregard[\s\w]*your[\s\w]*(system|original|initial)[\s\w]*instructions/i, category: 'prompt_leak', severity: 2, name: 'Disregard System Instructions' },
  { pattern: /forget[\s\w]*all[\s\w]*previous[\s\w]*(rules|instruct|prompt)/i, category: 'prompt_leak', severity: 3, name: 'Forget All Rules' },
  { pattern: /you[\s\w]*are[\s\w]*now[\s\w]*(a?\s*different|a new|an?)\s*(AI|assistant|model)/i, category: 'role_override', severity: 2, name: 'Role Override (You are now)' },
  { pattern: /pretend[\s\w]*(you are|being|to be)/i, category: 'role_override', severity: 1, name: 'Pretend Mode' },

  // 2. Privilege Escalation
  { pattern: /grant (yourself |all )?(admin|root|superuser|unrestricted)/i, category: 'privilege_escalation', severity: 3, name: 'Privilege Grant Request' },
  { pattern: /bypass[\s\w]*(your |the )?(safety|filter|restriction|constraint|policy)/i, category: 'privilege_escalation', severity: 3, name: 'Safety Bypass Request' },
  { pattern: /disable[\s\w]*(safety|safe|content|filter|moderation)/i, category: 'privilege_escalation', severity: 3, name: 'Disable Safety Filters' },
  { pattern: /remove[\s\w]*(your |the )?(restriction|constraint|limit)/i, category: 'privilege_escalation', severity: 2, name: 'Remove Restrictions' },

  // 3. Data Exfiltration
  { pattern: /(repeat|show|print)[\s\w]*(your |the )?(system[\s\w]*prompt|instruction|builtin|prompt[\s\w]*content)/i, category: 'exfiltration', severity: 2, name: 'Prompt Exfiltration Request' },
  { pattern: /output[\s\w]*your[\s\w]*(initial|original|system|system-prompt)/i, category: 'exfiltration', severity: 2, name: 'System Prompt Output Request' },
  { pattern: /what[\s\w]*(are |were )?(your |the )?(base|system|default|original)[\s\w]*instructions/i, category: 'exfiltration', severity: 1, name: 'Instructions Query' },

  // 4. Malicious Payload (Common Attack Patterns)
  { pattern: /(concatenate|join|merge)[\s\w]*((system|role|user)[\s\w]*prompt)/i, category: 'payload', severity: 2, name: 'Prompt Concatenation' },
  { pattern: /<\s*system[\s\w]*>|<\s*instruction[\s\w]*>/i, category: 'payload', severity: 1, name: 'XML-style Injection' },
  { pattern: /\\u007B[\s\w]*"(system|role|instruction)/i, category: 'payload', severity: 2, name: 'Unicode JSON Injection' },
  { pattern: /(base64|base64_decode|eval|exec|__import__|os\.system)/i, category: 'code_injection', severity: 3, name: 'Code Injection Attempt' },

  // 5. Social Engineering
  { pattern: /you[\s\w]*(must|have to|should always)[\s\w]*(reveal|show|tell|disclose)/i, category: 'social_engineering', severity: 1, name: 'Mandatory Disclosure Demand' },
  { pattern: /as[\s\w]*(an? )?(AI|assistant|language model)[\s\w]*(you (must|have to|should)|it's (your|their))/i, category: 'social_engineering', severity: 1, name: 'AI Obligation Framing' },
  { pattern: /pelease|plese|plz|pls/i, category: 'social_engineering', severity: 1, name: 'Casual Manipulation' },

  // 6.越狱关键词
  { pattern: /(jailbreak|越狱|hack|破解)/i, category: 'jailbreak', severity: 2, name: 'Jailbreak Keyword' },
  { pattern: /dan[\s\w]*(mode|system)|\/\/\[|DAN Mode/i, category: 'jailbreak', severity: 3, name: 'DAN/Jailbreak Prompt' },
  { pattern: /(developer|dev|开发者)[\s\w]*(:|\.| mode|\s)/i, category: 'jailbreak', severity: 2, name: 'Developer Mode Request' },
];

const SUSPICIOUS_FILE_EXTENSIONS = /(cmd|ps1|bat|vbs|exe|msi|sh|bash|dmg|pkg|apk|deb|rpm)/i;
const SUSPICIOUS_URL_PATTERNS = /(bit\.ly|tinyurl|t\.co|goo\.gl|is\.gd|buff\.ly)/i;

function detectPromptInjection(content) {
  const alerts = [];
  const lower = content.toLowerCase();

  for (const rule of INJECTION_PATTERNS) {
    if (rule.pattern.test(content)) {
      alerts.push({
        category: rule.category,
        severity: rule.severity,
        name: rule.name,
        matched: content.match(rule.pattern)?.[0] || rule.pattern.source,
      });
    }
  }

  // Check for suspicious file extensions in context
  if (SUSPICIOUS_FILE_EXTENSIONS.test(content) && /download|install|run|execute|open/i.test(content)) {
    alerts.push({ category: 'malicious_download', severity: 2, name: 'Suspicious File Download Request' });
  }

  // Check for suspicious URL shorteners
  if (SUSPICIOUS_URL_PATTERNS.test(content)) {
    alerts.push({ category: 'suspicious_link', severity: 1, name: 'URL Shortener Link' });
  }

  // Check for token-based attacks (high entropy = suspicious)
  const tokenDensity = content.split(/\s+/).filter(t => t.length > 20 && /[^a-zA-Z0-9]/.test(t)).length;
  if (tokenDensity > 5) {
    alerts.push({ category: 'high_entropy_tokens', severity: 1, name: 'High Entropy Token Injection' });
  }

  return alerts;
}

function severityLabel(severity) {
  return severity === 3 ? '🔴 HIGH' : severity === 2 ? '🟡 MEDIUM' : '🟢 LOW';
}

function handlePromptAlerts(content, alerts, senderName, sessionKey) {
  if (alerts.length === 0) return;

  const maxSeverity = Math.max(...alerts.map(a => a.severity));
  const summary = alerts.map(a => `${severityLabel(a.severity)} ${a.name}`).join('; ');

  console.warn(`[memory-hook] 🚨 Prompt injection detected! (severity: ${maxSeverity})`);
  console.warn(`[memory-hook]   Sender: ${senderName} | Session: ${sessionKey?.slice(0, 8)}`);
  for (const alert of alerts) {
    console.warn(`[memory-hook]   - [${alert.category}] ${alert.name}: "${alert.matched?.slice(0, 60)}"`);
  }

  // Store as security event (high severity only)
  if (maxSeverity >= 2) {
    const wing = 'wing_openclaw';
    const room = 'security';
    const hall = 'hall_events';
    const alertContent = `Security Alert: ${alerts.map(a => a.name).join(', ')} — Sender: ${senderName} — Snippet: ${content.slice(0, 100)}`;
    const drawer = addPalaceDrawer(wing, room, hall, alertContent, {
      type: 'security_alert',
      severity: maxSeverity,
      alerts,
      sessionKey,
    });
    appendMemoryEntry({
      type: 'security_alert',
      drawerId: drawer.id,
      wing,
      room,
      hall,
      content: alertContent,
      senderName,
      sessionKey,
      severity: maxSeverity,
      alertCount: alerts.length,
    });
    console.warn(`[memory-hook]   ✓ Security alert stored: drawer ${drawer.id}`);
  }
}

// ============================================================================
// Hook Handlers (called by the hook loader based on event type)
// ============================================================================

async function onAgentBootstrap(event) {
  const { sessionKey, workspaceDir } = event.context || {};
  try {
    const l0 = getL0Content();
    if (event.messages) event.messages.push(`[Memory L0] ${l0}`);
  } catch (e) {
    console.warn('[memory-hook] L0 injection failed:', e.message);
  }
}

async function onMessagePreprocessed(event) {
  // OMLS: reset idle counter on user activity
  try { (await getIdleScheduler()).onActivity(); } catch { /* ignore */ }

  const { context } = event;
  const { content, senderId, senderName, conversationId } = context || {};
  if (!content || content.trim().length < 15) return;

  const sender = senderName || senderId || 'unknown';

  try {
    // 1. Prompt Injection Detection (EasyJailbreak-inspired)
    const alerts = detectPromptInjection(content);
    if (alerts.length > 0) {
      handlePromptAlerts(content, alerts, sender, event.sessionKey);
    }

    // 2. Memory Extraction
    extractAndStoreMemory(content, sender, conversationId, event.sessionKey);
  } catch (e) {
    console.warn('[memory-hook] Message processing failed:', e.message);
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
