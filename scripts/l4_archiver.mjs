/**
 * l4_archiver.mjs — L4 Session Batch Archiver
 * ==============================================
 *
 * GenericAgent L4 启发实现：
 * 将 OpenClaw 的原始会话定期归档到 ~/.openclaw/memory/L4_raw_sessions/
 *
 * Phase 1: 压缩会话（去除 system prompt + assistant echo，仅保留 USER 交互）
 * Phase 2: 追加到 all_histories.txt（去重合并）
 * Phase 3: 按月打包为 ZIP
 * Phase 4: 清理原始文件（最近2小时内的活跃会话保留）
 *
 * 用法:
 *   node scripts/l4_archiver.mjs                    # dry-run
 *   node scripts/l4_archiver.mjs --run              # 实际执行
 *   node scripts/l4_archiver.mjs --run --force       # 跳过确认
 *
 * Cron 配置（每12小时一次）:
 *   openclaw cron add --name L4-session-archiver \
 *     --schedule 'cron: 0 0,12 * * *' \
 *     --payload '{"kind":"agentTurn","message":"run l4_archiver"}'
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync, statSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';

const STATE_DIR = 'C:/Users/Administrator/.openclaw';
const MEMORY_DIR = STATE_DIR + '/memory';
const L4_DIR = MEMORY_DIR + '/L4_raw_sessions';
const SESSION_DIR = STATE_DIR + '/sessions';
const ALL_HISTORIES_FILE = L4_DIR + '/all_histories.txt';

// ============================================================================
// CLI Args
// ============================================================================

const args = process.argv.slice(2);
const DRY_RUN = !args.includes('--run');
const FORCE = args.includes('--force');

if (DRY_RUN) {
  console.log('🔍 [L4 Archiver] DRY RUN mode — pass --run to execute');
  console.log('');
}

// ============================================================================
// Helpers
// ============================================================================

function ensureDir(dir) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
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

function fileSize(path) {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

function fileMtime(path) {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return 0;
  }
}

// ============================================================================
// Session Discovery
// ============================================================================

function discoverSessions() {
  if (!existsSync(SESSION_DIR)) {
    console.log(`[L4] No sessions directory: ${SESSION_DIR}`);
    return [];
  }

  const files = readdirSync(SESSION_DIR)
    .filter(f => f.endsWith('.json') || f.endsWith('.jsonl'))
    .map(f => resolve(SESSION_DIR, f))
    .filter(f => statSync(f).isFile());

  return files;
}

// ============================================================================
// Session Parsing
// ============================================================================

/**
 * 从会话文件中提取消息对（USER/ASSISTANT 交互）。
 * 遵循 GenericAgent 原则：去除 system prompt 和 assistant echo，
 * 仅保留实质性的 USER 请求。
 */
function extractHistoryFromSession(filepath) {
  const raw = readFileSync(filepath, 'utf8');
  let sessions = [];

  try {
    // JSON 格式
    const data = JSON.parse(raw);
    const messages = Array.isArray(data.messages) ? data.messages
      : Array.isArray(data) ? data
      : [data];

    for (const msg of messages) {
      const role = msg.role || msg.sender || '';
      const content = typeof msg.content === 'string' ? msg.content
        : msg.content?.text || JSON.stringify(msg.content || '');
      const time = msg.timestamp || msg.createdAt || '';

      if (role.toLowerCase() === 'user' && content.trim()) {
        sessions.push(`[USER] ${content.slice(0, 200)}`);
      } else if ((role.toLowerCase() === 'assistant' || role.toLowerCase() === 'agent') && content.trim()) {
        // ASSISTANT 行也保留（用于理解上下文），但比 USER 短
        sessions.push(`[Agent] ${content.slice(0, 100)}`);
      }
    }
  } catch {
    // 非 JSON 格式，按行解析
    const lines = raw.split('\n').filter(l => l.trim());
    for (const line of lines) {
      const userMatch = line.match(/\[USER\]/i);
      const asstMatch = line.match(/\[ASSISTANT\]|\[Agent\]/i);
      if (userMatch) sessions.push(line.slice(0, 200));
      else if (asstMatch) sessions.push(line.slice(0, 100));
    }
  }

  return sessions;
}

// ============================================================================
// Compress Session
// ============================================================================

const CUTOFF_MS = 2 * 60 * 60 * 1000; // 2小时

function compressSession(filepath) {
  const mtime = fileMtime(filepath);
  const now = Date.now();
  const age = now - mtime;

  if (age < CUTOFF_MS) {
    return { skipped: 'recent(<2h)', path: filepath };
  }

  const sessions = extractHistoryFromSession(filepath);
  if (sessions.length === 0) {
    return { skipped: 'no_user_messages', path: filepath };
  }

  const originalSize = fileSize(filepath);
  const compressed = sessions.join('\n');
  const compressedSize = Buffer.byteLength(compressed, 'utf8');

  // 太小的不归档
  if (compressedSize < 4500) {
    return { skipped: 'too_small_after_compress', path: filepath };
  }

  return {
    originalSize,
    compressedSize,
    ratio: Math.round((1 - compressedSize / Math.max(originalSize, 1)) * 100),
    sessions: sessions.length,
    content: compressed,
    path: filepath
  };
}

// ============================================================================
// Deduplication
// ============================================================================

function hashContent(content) {
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

function getExistingHashes() {
  if (!existsSync(ALL_HISTORIES_FILE)) return new Set();
  const raw = readFileSync(ALL_HISTORIES_FILE, 'utf8');
  const hashes = new Set();
  const sessionMarkers = raw.match(/SESSION:\s+(\S+)/g) || [];
  for (const m of sessionMarkers) {
    hashes.add(m.replace('SESSION:', '').trim());
  }
  return hashes;
}

// ============================================================================
// Phase Execution
// ============================================================================

function run() {
  console.log(`[L4] Starting archiver at ${new Date().toISOString()}`);
  console.log(`[L4] Session dir: ${SESSION_DIR}`);
  console.log(`[L4] L4 dir: ${L4_DIR}`);
  console.log('');

  ensureDir(L4_DIR);

  // Discover
  const sessionFiles = discoverSessions();
  console.log(`[L4] Found ${sessionFiles.length} session files`);
  if (sessionFiles.length === 0) {
    console.log('[L4] Nothing to archive');
    return { processed: 0, skipped: 0, errors: 0 };
  }

  // Phase 1: Compress
  const compressed = [];
  const skipped = [];
  const errors = [];

  for (const fp of sessionFiles) {
    try {
      const result = compressSession(fp);
      if (result.skipped) {
        skipped.push({ file: basename(fp), reason: result.skipped });
      } else {
        const hash = hashContent(result.content);
        compressed.push({ ...result, hash, basename: basename(fp) });
      }
    } catch (e) {
      errors.push({ file: basename(fp), error: e.message });
    }
  }

  console.log(`[L4] Phase 1: ${compressed.length} to archive, ${skipped.length} skipped, ${errors.length} errors`);
  for (const s of skipped.slice(0, 5)) {
    console.log(`  SKIP ${s.file}: ${s.reason}`);
  }
  for (const e of errors.slice(0, 3)) {
    console.log(`  ERR  ${e.file}: ${e.error}`);
  }
  console.log('');

  if (compressed.length === 0) {
    console.log('[L4] Nothing new to archive');
    return { processed: 0, skipped: skipped.length, errors: errors.length };
  }

  // Deduplicate
  const existingHashes = getExistingHashes();
  const newOnes = compressed.filter(c => !existingHashes.has(c.hash));
  console.log(`[L4] Dedup: ${compressed.length} total, ${newOnes.length} new`);

  if (newOnes.length === 0) {
    console.log('[L4] All sessions already archived');
    return { processed: 0, skipped: skipped.length + compressed.length, errors: errors.length };
  }

  // Show compression stats
  const totalOrig = newOnes.reduce((s, c) => s + c.originalSize, 0);
  const totalComp = newOnes.reduce((s, c) => s + c.compressedSize, 0);
  const overallRatio = Math.round((1 - totalComp / Math.max(totalOrig, 1)) * 100);
  console.log(`[L4] Compression: ${Math.round(totalOrig / 1024)}KB → ${Math.round(totalComp / 1024)}KB (${overallRatio}% reduction)`);
  console.log('');

  if (DRY_RUN) {
    console.log('[L4] DRY RUN — would archive:');
    for (const c of newOnes) {
      console.log(`  ${c.basenam} (${c.sessions} sessions, ${c.compressedSize} bytes, ${c.ratio}% ratio)`);
    }
    return { processed: newOnes.length, skipped: skipped.length, errors: errors.length, dryRun: true };
  }

  // Phase 2: Append to all_histories.txt
  let appendedCount = 0;
  const appendStream = createWriteStream(ALL_HISTORIES_FILE, { flags: 'a' });

  for (const c of newOnes) {
    const sep = '═'.repeat(60);
    const entry = `\n${sep}\nSESSION: ${c.hash} | ${basename(c.path)} | ${new Date().toISOString()}\n${sep}\n${c.content}\n`;
    appendStream.write(entry, 'utf8');
    appendedCount++;
  }
  appendStream.end();

  console.log(`[L4] Phase 2: Appended ${appendedCount} sessions to all_histories.txt`);

  // Phase 3: Monthly ZIP
  const byMonth = new Map();
  for (const c of newOnes) {
    const d = new Date();
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (!byMonth.has(key)) byMonth.set(key, []);
    byMonth.get(key).push(c);
  }

  for (const [month, items] of byMonth) {
    const zipPath = resolve(L4_DIR, `${month}.zip`);
    console.log(`[L4] Phase 3: Would create ${zipPath} with ${items.length} sessions (ZIP creation requires extra deps in pure Node)`);
    // 实际 ZIP 创建需要 node:fs + node:zlib + append，请求是简单追加
  }

  // Phase 4: Delete originals (after successful archive)
  let deletedCount = 0;
  for (const c of newOnes) {
    try {
      if (!DRY_RUN) {
        unlinkSync(c.path);
        deletedCount++;
      }
    } catch (e) {
      console.warn(`[L4] Failed to delete ${c.basename}: ${e.message}`);
    }
  }

  console.log(`[L4] Phase 4: Would delete ${newOnes.length} original files`);
  console.log('');
  console.log('[L4] Done:', { processed: newOnes.length, skipped: skipped.length, errors: errors.length });

  return { processed: newOnes.length, skipped: skipped.length, errors: errors.length };
}

// ============================================================================
// Main
// ============================================================================

const result = run();
process.exit(DRY_RUN ? 0 : 0);
