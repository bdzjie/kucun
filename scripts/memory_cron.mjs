/**
 * memory_cron.mjs — Standalone Memory Cron (No Gateway Required)
 * ==============================================================
 *
 * Runs L4 Archiver + SOP Crystallizer on a schedule.
 * Uses pure Node.js setInterval — no gateway pairing needed.
 *
 * GenericAgent启发：每12小时 L4归档 + 任务成功后SOP结晶
 * OpenClaw设计：cron jobs 需要 operator.admin scope（gateway不可用）
 *
 * 用法:
 *   node scripts/memory_cron.mjs              # 启动（前台）
 *   node scripts/memory_cron.mjs --daemon    # 守护进程模式
 *   node scripts/memory_cron.mjs --once      # 单次执行后退出
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { setInterval, setTimeout } from 'node:timers';
import { execFileSync } from 'node:child_process';

const $require = createRequire(import.meta.url);

const STATE_DIR = 'C:/Users/Administrator/.openclaw';
const MEMORY_DIR = STATE_DIR + '/memory';
const L4_DIR = MEMORY_DIR + '/L4_raw_sessions';
const ALL_HISTORIES_FILE = L4_DIR + '/all_histories.txt';
const CRON_STATE_FILE = L4_DIR + '/cron_state.json';

const args = process.argv.slice(2);
const IS_DAEMON = args.includes('--daemon');
const IS_ONCE = args.includes('--once');

// Schedule intervals
const L4_ARCHIVE_INTERVAL_MS = 12 * 60 * 60 * 1000; // 12 hours
const SOP_CHECK_INTERVAL_MS = 60 * 60 * 1000;        // 1 hour
const FTS5_INDEX_INTERVAL_MS = 6 * 60 * 60 * 1000;   // 6 hours

// ============================================================================
// File Helpers
// ============================================================================

function readJson(filePath, fallback = null) {
  if (!existsSync(filePath)) return fallback;
  try { return JSON.parse(readFileSync(filePath, 'utf8')); } catch { return fallback; }
}

function writeJson(filePath, data) {
  writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function contentHash(content) {
  return createHash('sha1').update(content).digest('hex').slice(0, 8);
}

function readJsonl(filePath, fallback = []) {
  if (!existsSync(filePath)) return fallback;
  try {
    const raw = readFileSync(filePath, 'utf8').trim();
    if (!raw) return fallback;
    if (raw.startsWith('[')) {
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [arr];
    }
    return raw.split('\n').filter(l => l.trim()).map(l => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);
  } catch { return fallback; }
}

// ============================================================================
// Cron State — tracks last run times
// ============================================================================

function getCronState() {
  return readJson(CRON_STATE_FILE, {
    lastL4Archive: null,
    lastSopCheck: null,
    lastFts5Index: null,
    archiverVersion: 1,
  });
}

function setCronState(state) {
  if (!existsSync(L4_DIR)) mkdirSync(L4_DIR, { recursive: true });
  writeJson(CRON_STATE_FILE, state);
}

// ============================================================================
// L4 Archiver (from l4_archiver.mjs)
// ============================================================================

function collectMemories() {
  const entries = [];
  const now = Date.now();
  const oneDayAgo = now - 24 * 60 * 60 * 1000;

  // memories.jsonl
  for (const m of readJsonl(MEMORY_DIR + '/memories.jsonl', [])) {
    if (!m || !m.content) continue;
    entries.push({
      id: m.id || `wal_${entries.length}`,
      source: 'memories.jsonl',
      content: m.content,
      type: m.type || m.hall || 'general',
      wing: m.wing || '',
      created_at: m.created_at || m.timestamp || null,
      hash: contentHash(m.content),
    });
  }

  // palace_state.json
  const palace = readJson(MEMORY_DIR + '/palace_state.json', {});
  for (const d of (palace.drawers || [])) {
    if (!d.content) continue;
    entries.push({
      id: d.id || `drawer_${entries.length}`,
      source: 'palace_state.json',
      content: d.content,
      type: d.hall || 'general',
      wing: d.wing || '',
      created_at: d.addedAt ? new Date(d.addedAt).toISOString() : null,
      hash: contentHash(d.content),
    });
  }

  // wal/write_log.jsonl (last 24h)
  const walLog = readJsonl(STATE_DIR + '/wal/write_log.jsonl', []);
  for (const entry of walLog) {
    if (!entry || !entry.timestamp) continue;
    const ts = typeof entry.timestamp === 'number' ? entry.timestamp * 1000 : new Date(entry.timestamp).getTime();
    if (ts < oneDayAgo) continue;
    entries.push({
      id: `wal_${entries.length}`,
      source: 'wal/write_log.jsonl',
      content: JSON.stringify(entry.operation || entry),
      type: 'wal_entry',
      wing: entry.file_path || '',
      created_at: new Date(ts).toISOString(),
      hash: contentHash(JSON.stringify(entry)),
    });
  }

  return entries;
}

function deduplicate(entries) {
  const seen = new Set();
  return entries.filter(e => {
    if (seen.has(e.hash)) return false;
    seen.add(e.hash);
    return true;
  });
}

function runL4Archive() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dateStr = new Date().toISOString().slice(0, 10);
  const entries = collectMemories();

  if (entries.length === 0) {
    console.log(`[cron/l4] Nothing to archive at ${dateStr}`);
    return;
  }

  const unique = deduplicate(entries);
  console.log(`[cron/l4] Archiving ${unique.length} entries (from ${entries.length} total)`);

  if (!existsSync(L4_DIR)) mkdirSync(L4_DIR, { recursive: true });

  let appended = 0;
  for (const e of unique) {
    const record = JSON.stringify({
      archived_at: timestamp,
      date: dateStr,
      source: e.source,
      type: e.type,
      wing: e.wing,
      content: e.content.slice(0, 1000),
      hash: e.hash,
    });
    writeFileSync(ALL_HISTORIES_FILE, record + '\n', { flag: 'a', encoding: 'utf8' });
    appended++;
  }
  console.log(`[cron/l4] Appended ${appended} entries to all_histories.txt`);

  // Monthly ZIP
  const now = new Date();
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const monthStr = `${lastMonth.getFullYear()}-${String(lastMonth.getMonth() + 1).padStart(2, '0')}`;
  const zipPath = `${L4_DIR}/L4_${monthStr}.zip`;
  const tmpDir = `${L4_DIR}/__monthly_tmp__`;

  if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });
  try {
    const { execSync } = $require('node:child_process');
    const psCmd = `Compress-Archive -Path "${tmpDir}\\*" -DestinationPath "${zipPath}" -Force`;
    execSync(`powershell -Command "${psCmd}"`, { timeout: 30000 });
    console.log(`[cron/l4] Monthly ZIP: ${zipPath}`);
  } catch (e) {
    console.log(`[cron/l4] ZIP skipped: ${e.message.slice(0, 60)}`);
  }
}

// ============================================================================
// SOP Crystallizer Check
// ============================================================================

function checkSops() {
  // Check if any tasks completed that might need SOP crystallization
  // Based on SOP registry - look for sessions with high success patterns
  const sopRegistry = readJson(MEMORY_DIR + '/sop_registry.json', { sops: [] });
  const memories = readJsonl(MEMORY_DIR + '/memories.jsonl', []);

  // Look for milestone-type memories in last hour that might crystallize into SOPs
  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  const recentMilestones = memories.filter(m => {
    if (!m.timestamp) return false;
    const ts = typeof m.timestamp === 'number' ? m.timestamp : new Date(m.timestamp).getTime();
    return ts > oneHourAgo && (m.type === 'milestone' || m.hall === 'hall_events');
  });

  if (recentMilestones.length > 0) {
    console.log(`[cron/sop] ${recentMilestones.length} recent milestones — SOP crystallization candidate`);
    // Note: Full SOP crystallization requires task context
    // This is a trigger indicator, actual SOP written by agent on next similar task
  }
}

// ============================================================================
// Main Cron Loop
// ============================================================================

function tick() {
  const state = getCronState();
  const now = Date.now();
  let changed = false;

  // L4 Archive check
  const l4Due = !state.lastL4Archive || (now - state.lastL4Archive) >= L4_ARCHIVE_INTERVAL_MS;
  if (l4Due) {
    console.log(`[cron] L4 archive due (last: ${state.lastL4Archive ? new Date(state.lastL4Archive).toISOString() : 'never'})`);
    try {
      runL4Archive();
      state.lastL4Archive = now;
      changed = true;
    } catch (e) {
      console.error(`[cron/l4] Error: ${e.message}`);
    }
  }

  // SOP Check
  const sopDue = !state.lastSopCheck || (now - state.lastSopCheck) >= SOP_CHECK_INTERVAL_MS;
  if (sopDue) {
    try {
      checkSops();
      state.lastSopCheck = now;
      changed = true;
    } catch (e) {
      console.error(`[cron/sop] Error: ${e.message}`);
    }
  }

  // FTS5 Index check
  const fts5Due = !state.lastFts5Index || (now - state.lastFts5Index) >= FTS5_INDEX_INTERVAL_MS;
  if (fts5Due) {
    console.log(`[cron/fts5] Building FTS5 index (last: ${state.lastFts5Index ? new Date(state.lastFts5Index).toISOString() : 'never'})`);
    try {
      runFts5Index();
      state.lastFts5Index = now;
      changed = true;
    } catch (e) {
      console.error(`[cron/fts5] Error: ${e.message}`);
    }
  }

  if (changed) setCronState(state);
}

// ============================================================================
// FTS5 Indexer — Hermes SQLite FTS5 Session Search
// ============================================================================

function runFts5Index() {
  // Compute script path relative to workspace root
  const workspaceRoot = STATE_DIR.replace(/\\/g, '/');
  const bridgeScript = workspaceRoot + '/workspace/modules/search/sqlite_fts5_bridge.py';
  const sessionsDir = STATE_DIR + '/agents/main/sessions';
  const dbPath = MEMORY_DIR + '/fts5.db';

  try {
    const result = execFileSync('python', [bridgeScript, 'index', sessionsDir, dbPath], {
      encoding: 'utf8',
      timeout: 60000,
    });
    const data = JSON.parse(result.trim());
    console.log(`[cron/fts5] Indexed ${data.indexed_sessions} sessions — ${data.stats?.total_messages || 0} messages in DB`);
  } catch (e) {
    // Fallback via shell
    try {
      const { execSync } = $require('node:child_process');
      const pyCmd = `python "${bridgeScript}" index "${sessionsDir}" "${dbPath}"`;
      const output = execSync(pyCmd, { encoding: 'utf8', timeout: 60000 });
      const data = JSON.parse(output.trim());
      console.log(`[cron/fts5] Indexed ${data.indexed_sessions} sessions — ${data.stats?.total_messages || 0} messages`);
    } catch (e2) {
      throw new Error(`FTS5 index failed: ${e2.message.slice(0, 100)}`);
    }
  }
}

// ============================================================================
// Startup
// ============================================================================

console.log(`[memory_cron] Starting at ${new Date().toISOString()}`);
console.log(`[memory_cron] Mode: ${IS_DAEMON ? 'DAEMON' : IS_ONCE ? 'ONCE' : 'FOREGROUND'}`);
console.log(`[memory_cron] L4 archive interval: 12h | SOP check interval: 1h`);

if (IS_ONCE) {
  tick();
  console.log('[memory_cron] Single run complete.');
  process.exit(0);
}

// Run immediately on start
tick();

// Then schedule
setInterval(tick, 60 * 60 * 1000); // Check every hour

if (IS_DAEMON) {
  console.log('[memory_cron] Running as daemon. PID:', process.pid);
  // Keep process alive
  setInterval(() => {}, 60 * 1000);
} else {
  console.log('[memory_cron] Press Ctrl+C to stop.');
}
