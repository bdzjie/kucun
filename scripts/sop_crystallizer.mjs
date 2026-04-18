/**
 * sop_crystallizer.mjs — Skill SOP 自动结晶器
 * ===============================================
 *
 * GenericAgent 自进化启发：
 * 任务成功后，将执行路径结晶为可复用的 SOP 文件。
 *
 * 用法:
 *   node scripts/sop_crystallizer.mjs                          # 扫描 SOP registry 生成 SOP
 *   node scripts/sop_crystallizer.mjs --session <key>        # 从特定会话结晶
 *   node scripts/sop_crystallizer.mjs --list                   # 列出已有 SOP
 *
 * 生成的 SOP 格式:
 *   # [SOP] 任务类型 | 触发条件
 *   ## 执行步骤
 *   ## 异常处理
 *   ## 使用示例
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { resolve, basename } from 'node:path';

const STATE_DIR = 'C:/Users/Administrator/.openclaw';
const MEMORY_DIR = STATE_DIR + '/memory';
const SOP_DIR = MEMORY_DIR + '/sops';
const SOP_REGISTRY_FILE = MEMORY_DIR + '/sop_registry.json';
const PALACE_FILE = MEMORY_DIR + '/palace_state.json';

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

// ============================================================================
// SOP Category Heuristics
// ============================================================================

function inferCategory(content, toolResults) {
  const lower = (content || '').toLowerCase();

  const categories = [
    { name: 'file_operation', keywords: ['file', 'write', 'read', 'edit', 'create', 'delete'], weight: 0 },
    { name: 'web_browse', keywords: ['web', 'http', 'fetch', 'scrape', 'crawl', 'browse'], weight: 0 },
    { name: 'code_run', keywords: ['python', 'bash', 'shell', 'script', 'run', 'execute', 'install'], weight: 0 },
    { name: 'data_process', keywords: ['parse', 'json', 'csv', 'data', 'filter', 'transform', 'sort'], weight: 0 },
    { name: 'git_operations', keywords: ['git', 'commit', 'push', 'pull', 'branch', 'merge'], weight: 0 },
    { name: 'system_config', keywords: ['config', 'setup', 'install', 'configure', 'env', 'variable'], weight: 0 },
    { name: 'search', keywords: ['search', 'find', 'grep', 'query', 'lookup'], weight: 0 },
    { name: 'general', keywords: [], weight: 0 }
  ];

  for (const cat of categories) {
    for (const kw of cat.keywords) {
      if (lower.includes(kw)) {
        cat.weight++;
      }
    }
  }

  categories.sort((a, b) => b.weight - a.weight);
  return categories[0]?.name || 'general';
}

function inferTools(toolResults) {
  if (!toolResults || !toolResults.length) return [];
  const tools = new Set();
  for (const r of toolResults) {
    const name = r.toolName || r.name || 'unknown';
    if (name !== 'unknown') tools.add(name);
  }
  return Array.from(tools);
}

// ============================================================================
// SOP Content Generation
// ============================================================================

/**
 * 从单个 SOP 片段生成完整的 SOP 文档。
 */
function generateSopDocument(sop) {
  const category = inferCategory(sop.trigger, sop.fragment?.steps ? [{ toolName: 'inferred' }] : []);
  const tools = inferTools(sop.fragment?.steps ? [{ toolName: 'inferred' }] : []);

  const lines = [
    `# [SOP] ${category.toUpperCase()} | ${sop.trigger.slice(0, 80)}`,
    '',
    `> 自动生成于 ${new Date(sop.createdAt).toISOString()}`,
    `> 来源会话: ${sop.sessionKey} (turn ${sop.turn})`,
    '',
    '## 触发条件',
    '',
    '```',
    sop.trigger,
    '```',
    '',
    '## 执行步骤',
    ''
  ];

  // 从 tool results 提取步骤
  if (sop.fragment?.steps) {
    const steps = sop.fragment.steps.split('\n').filter(s => s.trim());
    for (let i = 0; i < steps.length; i++) {
      lines.push(`${i + 1}. ${steps[i].replace(/^\s*\d+\.\s*/, '')}`);
    }
  } else {
    lines.push('> (步骤信息待补充)');
  }

  lines.push('');
  lines.push('## 异常处理');

  // 从 tool results 推断可能的错误
  if (sop.fragment?.steps) {
    lines.push('```');
    lines.push('# TODO: 填充异常处理');
    lines.push('```');
  }

  lines.push('');
  lines.push('## 验证方式');
  lines.push('');
  lines.push('> (验证步骤待补充)');
  lines.push('');
  lines.push('## 使用示例');
  lines.push('');
  lines.push('```bash');
  lines.push(`# 触发: ${sop.trigger.slice(0, 60)}`);
  lines.push('```');

  return lines.join('\n');
}

/**
 * 从 SOP 片段生成 skill index 条目。
 */
function generateSkillIndexEntry(sop) {
  const category = inferCategory(sop.trigger, []);
  return {
    key: sop.id,
    name: category + '_' + sop.id.slice(-6),
    description: sop.trigger.slice(0, 200),
    one_line_summary: `Auto-crystallized SOP: ${sop.trigger.slice(0, 60)}`,
    category,
    tags: [category, 'auto-generated', 'sop'],
    language: 'multi',
    os: ['windows', 'linux', 'macos'],
    form: 'sop',
    clarity: 5,
    completeness: 3,
    actionability: 7,
    autonomous_safe: false,
    blast_radius: 'medium',
    effect_scope: 'local',
    estimated_tokens: 'small',
    capabilities: inferTools(sop.fragment?.steps),
    createdAt: sop.createdAt,
    sessionKey: sop.sessionKey,
    turn: sop.turn
  };
}

// ============================================================================
// SOP Registry Management
// ============================================================================

function loadRegistry() {
  return readJsonFile(SOP_REGISTRY_FILE, { sops: [] });
}

function saveRegistry(registry) {
  writeFileSync(SOP_REGISTRY_FILE, JSON.stringify(registry, null, 2), 'utf8');
}

// ============================================================================
// SOP File Operations
// ============================================================================

function writeSopFile(sop) {
  ensureDir(SOP_DIR);
  const category = inferCategory(sop.trigger, []);
  const filename = `${category}_${sop.id}.md`;
  const filepath = resolve(SOP_DIR, filename);

  const doc = generateSopDocument(sop);
  writeFileSync(filepath, doc, 'utf8');

  return { filepath, filename };
}

// ============================================================================
// Skill Index (for Skill Search integration)
// ============================================================================

const SKILL_INDEX_FILE = MEMORY_DIR + '/skill_index.json';

function loadSkillIndex() {
  return readJsonFile(SKILL_INDEX_FILE, { skills: [] });
}

function saveSkillIndex(index) {
  writeFileSync(SKILL_INDEX_FILE, JSON.stringify(index, null, 2), 'utf8');
}

function addToSkillIndex(entry) {
  const index = loadSkillIndex();
  index.skills = index.skills || [];

  // 去重
  const existing = index.skills.findIndex(s => s.key === entry.key);
  if (existing >= 0) {
    index.skills[existing] = entry;
  } else {
    index.skills.push(entry);
  }

  // 最多保留 100
  if (index.skills.length > 100) {
    index.skills = index.skills.slice(-100);
  }

  saveSkillIndex(index);
  return index.skills.length;
}

// ============================================================================
// Main Operations
// ============================================================================

function listSops() {
  const registry = loadRegistry();
  console.log(`\n📦 SOP Registry: ${registry.sops.length} SOPs\n`);

  for (const sop of registry.sops) {
    const category = inferCategory(sop.trigger, []);
    const date = new Date(sop.createdAt).toISOString().slice(0, 10);
    console.log(`  [${sop.id.slice(-8)}] ${date} ${category.padEnd(16)} ${sop.trigger.slice(0, 60)}`);
  }
  console.log('');

  // 也列出文件系统中的 SOP
  if (existsSync(SOP_DIR)) {
    const files = readdirSync(SOP_DIR).filter(f => f.endsWith('.md'));
    console.log(`📁 SOP Files: ${files.length} in ${SOP_DIR}`);
    for (const f of files.slice(0, 5)) {
      console.log(`  ${f}`);
    }
    if (files.length > 5) console.log(`  ... and ${files.length - 5} more`);
  }
  console.log('');
}

function crystallizeAll() {
  const registry = loadRegistry();
  if (!registry.sops || registry.sops.length === 0) {
    console.log('[SOP] No SOPs to crystallize');
    return { generated: 0 };
  }

  console.log(`[SOP] Crystallizing ${registry.sops.length} SOPs...`);
  let generated = 0;

  for (const sop of registry.sops) {
    try {
      const { filename } = writeSopFile(sop);
      const indexEntry = generateSkillIndexEntry(sop);
      addToSkillIndex(indexEntry);
      generated++;
      console.log(`  ✅ ${filename}`);
    } catch (e) {
      console.log(`  ❌ ${sop.id}: ${e.message}`);
    }
  }

  console.log(`\n[SOP] Crystallized ${generated}/${registry.sops.length} SOPs`);
  return { generated };
}

function findSimilarTasks(query) {
  const registry = loadRegistry();
  const queryLower = query.toLowerCase();

  console.log(`\n🔍 Searching for similar tasks to: "${query}"`);
  console.log('');

  const matches = registry.sops?.filter(sop => {
    const trigger = (sop.trigger || '').toLowerCase();
    const steps = (sop.fragment?.steps || '').toLowerCase();
    return trigger.includes(queryLower) || steps.includes(queryLower);
  }) || [];

  if (matches.length === 0) {
    console.log('  No similar SOPs found');
  } else {
    for (const m of matches.slice(0, 5)) {
      const category = inferCategory(m.trigger, []);
      console.log(`  [${m.id.slice(-8)}] ${category}`);
      console.log(`    Trigger: ${m.trigger.slice(0, 80)}`);
      if (m.fragment?.steps) {
        console.log(`    Steps: ${m.fragment.steps.slice(0, 100)}...`);
      }
      console.log('');
    }
  }

  return matches;
}

// ============================================================================
// CLI
// ============================================================================

const args = process.argv.slice(2);

if (args.includes('--list')) {
  listSops();
} else if (args.includes('--search') && args.length > 1) {
  const query = args[args.indexOf('--search') + 1] || '';
  findSimilarTasks(query);
} else if (args.includes('--crystallize')) {
  const result = crystallizeAll();
  process.exit(result.generated > 0 ? 0 : 1);
} else {
  // Default: list + stats
  const registry = loadRegistry();
  const skillIndex = loadSkillIndex();

  console.log('');
  console.log('🔷 SOP Crystallizer — GenericAgent Skill 自进化');
  console.log('');
  console.log(`  Registry:  ${registry.sops?.length || 0} SOPs`);
  console.log(`  Skill Index: ${skillIndex.skills?.length || 0} entries`);
  console.log(`  SOP Files: ${existsSync(SOP_DIR) ? readdirSync(SOP_DIR).filter(f => f.endsWith('.md')).length : 0} files`);
  console.log('');
  console.log('  Usage:');
  console.log('    --list         List all SOPs');
  console.log('    --search <q>   Find similar SOPs');
  console.log('    --crystallize  Generate SOP files from registry');
  console.log('');
}
