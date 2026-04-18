/**
 * l4_archiver.mjs — L4 Batch Memory Archiver
 * ===========================================
 *
 * GenericAgent L4 启发实现：
 * 将 OpenClaw 的已验证记忆定期归档到 L4 层
 *
 * 数据源（OpenClaw 实际存储）:
 *   memories.jsonl       — 已验证记忆（WAL 追加）
 *   palace_state.json    — Palace drawer 记忆（BM25 索引）
 *   wal/write_log.jsonl  — WAL 审计日志（仅最近24h）
 *
 * Phase 1: 从多个源收集记忆条目
 * Phase 2: 压缩去重（按 content hash）
 * Phase 3: 追加到 all_histories.txt
 * Phase 4: 每月打包（使用 PowerShell Compress-Archive）
 *
 * 用法:
 *   node scripts/l4_archiver.mjs        # dry-run
 *   node scripts/l4_archiver.mjs --run # 实际执行
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, cpSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const $require = createRequire(import.meta.url);

const STATE_DIR = 'C:/Users/Administrator/.openclaw';
const MEMORY_DIR = STATE_DIR + '/memory';
const WAL_DIR = STATE_DIR + '/wal';
const L4_DIR = MEMORY_DIR + '/L4_raw_sessions';
const ALL_HISTORIES_FILE = L4_DIR + '/all_histories.txt';

const args = process.argv.slice(2);
const DRY_RUN = !args.includes('--run');

// ============================================================================
// File Readers
// ============================================================================

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

function readJson(filePath, fallback = null) {
  if (!existsSync(filePath)) return fallback;
  try { return JSON.parse(readFileSync(filePath, 'utf8')); } catch { return fallback; }
}

// ============================================================================
// Collect Memories
// ============================================================================

function contentHash(content) {
  return createHash('sha1').update(content).digest('hex').slice(0, 8);
}

function collectMemories() {
  const entries = [];

  // memories.jsonl — WAL-style verified memories
  const walMemories = readJsonl(MEMORY_DIR + '/memories.jsonl', []);
  for (const m of walMemories) {
    if (!m || !m.content) continue;
    entries.push({
      id: m.id || `wal_${entries.length}`,
      source: 'memories.jsonl',
      content: m.content,
      type: m.type || m.hall || 'general',
      wing: m.wing || '',
      room: m.room || '',
      created_at: m.created_at || m.timestamp || null,
      hash: contentHash(m.content),
    });
  }

  // palace_state.json — BM25-indexed drawers
  const palace = readJson(MEMORY_DIR + '/palace_state.json', {});
  for (const d of (palace.drawers || [])) {
    if (!d.content) continue;
    entries.push({
      id: d.id || `drawer_${entries.length}`,
      source: 'palace_state.json',
      content: d.content,
      type: d.hall || 'general',
      wing: d.wing || '',
      room: d.room || '',
      created_at: d.addedAt ? new Date(d.addedAt).toISOString() : null,
      hash: contentHash(d.content),
    });
  }

  // wal/write_log.jsonl — audit trail (last 24h only)
  const walLog = readJsonl(WAL_DIR + '/write_log.jsonl', []);
  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
  for (const entry of walLog) {
    if (!entry || !entry.timestamp) continue;
    const ts = typeof entry.timestamp === 'number'
      ? entry.timestamp * 1000
      : new Date(entry.timestamp).getTime();
    if (ts < oneDayAgo) continue;
    entries.push({
      id: `wal_${entries.length}`,
      source: 'wal/write_log.jsonl',
      content: JSON.stringify(entry.operation || entry),
      type: 'wal_entry',
      wing: entry.file_path || '',
      room: '',
      created_at: new Date(ts).toISOString(),
      hash: contentHash(JSON.stringify(entry)),
    });
  }

  return entries;
}

// ============================================================================
// Deduplicate
// ============================================================================

function deduplicate(entries) {
  const seen = new Set();
  return entries.filter(e => {
    if (seen.has(e.hash)) return false;
    seen.add(e.hash);
    return true;
  });
}

// ============================================================================
// Archive
// ============================================================================

function archive(uniqueEntries) {
  if (!existsSync(L4_DIR)) {
    mkdirSync(L4_DIR, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dateStr = new Date().toISOString().slice(0, 10);

  // Phase 3: Append to all_histories.txt
  let appended = 0;
  for (const e of uniqueEntries) {
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
  console.log(`[L4] Appended ${appended} entries to all_histories.txt`);

  // Phase 4: Monthly ZIP using PowerShell Compress-Archive
  const now = new Date();
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const monthStr = `${lastMonth.getFullYear()}-${String(lastMonth.getMonth() + 1).padStart(2, '0')}`;
  const zipPath = `${L4_DIR}/L4_${monthStr}.zip`;
  const tmpDir = `${L4_DIR}/__monthly_tmp__`;

  if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });
  cpSync(ALL_HISTORIES_FILE, `${tmpDir}/all_histories.txt`, { force: true });

  try {
    const { execSync } = $require('node:child_process');
    const psCmd = `Compress-Archive -Path "${tmpDir}\\*" -DestinationPath "${zipPath}" -Force`;
    execSync(`powershell -Command "${psCmd}"`, { timeout: 30000 });
    console.log(`[L4] Monthly ZIP: ${zipPath}`);
  } catch (e) {
    console.log(`[L4] ZIP skipped (optional): ${e.message}`);
  }
}

// ============================================================================
// Main
// ============================================================================

console.log(`[L4] Starting archiver at ${new Date().toISOString()}`);
console.log(`[L4] L4 dir: ${L4_DIR}`);
console.log(`[L4] Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);

const entries = collectMemories();
console.log(`[L4] Collected ${entries.length} entries`);

if (entries.length === 0) {
  console.log('[L4] Nothing to archive');
  process.exit(0);
}

const unique = deduplicate(entries);
console.log(`[L4] After dedup: ${unique.length} unique`);

if (DRY_RUN) {
  console.log('\n[L4] Sample entries (first 3):');
  for (const e of unique.slice(0, 3)) {
    console.log(`  [${e.source}] ${e.type} | ${e.content.slice(0, 80)}...`);
  }
} else {
  archive(unique);
  console.log('\n[L4] Archive complete!');
}
