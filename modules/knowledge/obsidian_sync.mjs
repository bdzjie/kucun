/**
 * obsidian_sync.mjs
 * 
 * Bidirectional sync between OpenClaw memory and Obsidian vault.
 * Inspired by: SwarmVault (swarmclawai/swarmvault) + agent-second-brain
 * 
 * OpenClaw memories → Obsidian notes (with wiki-links, tags, MOCs)
 * Obsidian vault → OpenClaw knowledge graph
 */

import { existsSync, readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, appendFileSync, unlinkSync, rmdirSync } from 'fs';
import { join, dirname, basename, relative } from 'path';
import { homedir } from 'os';

/**
 * @typedef {Object} ObsidianNote
 * @property {string} path
 * @property {string} name
 * @property {string} title
 * @property {string} content
 * @property {Object} frontmatter
 * @property {string[]} tags
 * @property {string[]} links — outgoing wiki-links
 * @property {string[]} backlinks — incoming wiki-links
 */

/**
 * @typedef {Object} SyncResult
 * @property {number} notesExported
 * @property {number} notesImported
 * @property {number} linksCreated
 * @property {string[]} errors
 */

// Default vault path — auto-detect Obsidian vault location
function getDefaultObsidianVault() {
  const docPath = join(homedir(), 'Documents');
  
  // Common Obsidian vault locations
  const candidates = [
    join(docPath, 'Obsidian Vault'),
    join(docPath, 'Obsidian'),
    join(docPath, 'vault'),
    docPath, // The Documents folder itself might be the vault
    join(homedir(), 'Obsidian Vault'),
    join(homedir(), 'obsidian-vault'),
  ];
  
  for (const path of candidates) {
    if (existsSync(path)) {
      // Check if it looks like an Obsidian vault (has .obsidian folder or .md files)
      const obsidianConfig = join(path, '.obsidian');
      const hasMdFiles = readdirSync(path).some(f => f.endsWith('.md'));
      
      if (existsSync(obsidianConfig) || hasMdFiles) {
        return path;
      }
    }
  }
  
  return docPath; // Fallback to Documents
}

const DEFAULT_VAULT = getDefaultObsidianVault();
const SYNC_STATE_FILE = join(homedir(), '.openclaw', 'memory', 'obsidian_sync_state.json');

/**
 * Parse YAML frontmatter from markdown content
 */
export function parseFrontmatter(content) {
  if (!content || !content.startsWith('---')) {
    return { frontmatter: {}, body: content || '' };
  }
  
  const endIdx = content.indexOf('---', 3);
  if (endIdx < 0) {
    return { frontmatter: {}, body: content };
  }
  
  const fmText = content.slice(3, endIdx).trim();
  const body = content.slice(endIdx + 3).trim();
  
  const frontmatter = {};
  const lines = fmText.split('\n');
  
  for (const line of lines) {
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim();
      let value = line.slice(colonIdx + 1).trim();
      
      // Handle array values (comma-separated or YAML list)
      if (value.startsWith('[') && value.endsWith(']')) {
        value = value.slice(1, -1).split(',').map(v => v.trim().replace(/^["']|["']$/g, ''));
      }
      
      frontmatter[key] = value;
    }
  }
  
  return { frontmatter, body };
}

/**
 * Serialize frontmatter to YAML string
 */
export function serializeFrontmatter(fm) {
  const lines = ['---'];
  
  for (const [key, value] of Object.entries(fm)) {
    if (Array.isArray(value)) {
      lines.push(`${key}: [${value.join(', ')}]`);
    } else if (typeof value === 'string' && value.includes(':')) {
      lines.push(`${key}: "${value}"`);
    } else {
      lines.push(`${key}: ${value}`);
    }
  }
  
  lines.push('---');
  return lines.join('\n');
}

/**
 * Extract wiki-links from content
 */
export function extractWikiLinks(content) {
  const regex = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
  const links = [];
  let match;
  while ((match = regex.exec(content)) !== null) {
    links.push({ target: match[1].trim(), alias: match[2] || match[1].trim() });
  }
  return links;
}

/**
 * Extract #tags from content
 */
export function extractTags(content) {
  const regex = /#([a-zA-Z][a-zA-Z0-9_-]+)/g;
  const tags = [];
  let match;
  while ((match = regex.exec(content)) !== null) {
    tags.push(match[1].toLowerCase());
  }
  return [...new Set(tags)];
}

/**
 * Read all markdown notes from a vault directory
 */
export function readVault(vaultPath) {
  const notes = [];
  
  function scanDir(dir) {
    if (!existsSync(dir)) return;
    
    const entries = readdirSync(dir);
    for (const entry of entries) {
      if (entry.startsWith('.')) continue; // Skip .obsidian, etc.
      
      const fullPath = join(dir, entry);
      try {
        const stat = statSync(fullPath);
        
        if (stat.isDirectory()) {
          scanDir(fullPath);
        } else if (entry.endsWith('.md')) {
          const content = readFileSync(fullPath, 'utf-8');
          const { frontmatter, body } = parseFrontmatter(content);
          const links = extractWikiLinks(content);
          const tags = extractTags(content);
          
          // Get all notes that link TO this note (backlinks)
          const noteName = entry.replace('.md', '');
          
          notes.push({
            path: fullPath,
            relativePath: relative(vaultPath, fullPath),
            name: noteName,
            title: frontmatter.title || noteName,
            content,
            frontmatter,
            body,
            tags,
            links,
            created: stat.birthtime,
            modified: stat.mtime,
          });
        }
      } catch (e) {
        // Skip unreadable files
      }
    }
  }
  
  scanDir(vaultPath);
  
  // Build backlinks
  const notesByName = new Map(notes.map(n => [n.name.toLowerCase(), n]));
  
  for (const note of notes) {
    note.backlinks = [];
    for (const link of note.links) {
      const targetLower = link.target.toLowerCase();
      if (notesByName.has(targetLower)) {
        const targetNote = notesByName.get(targetLower);
        if (!targetNote.backlinks.includes(note.name)) {
          targetNote.backlinks.push(note.name);
        }
      }
    }
  }
  
  return notes;
}

/**
 * Write a note to the vault
 */
export function writeNote(vaultPath, noteName, content, options = {}) {
  const folder = options.folder || '';
  const notePath = join(vaultPath, folder, `${noteName}.md`);
  
  mkdirSync(dirname(notePath), { recursive: true });
  writeFileSync(notePath, content, 'utf-8');
  
  return notePath;
}

/**
 * Create a new note with frontmatter
 */
export function createNote(vaultPath, name, body, frontmatter = {}) {
  const fm = {
    title: frontmatter.title || name,
    created: new Date().toISOString(),
    tags: frontmatter.tags || [],
    ...frontmatter,
  };
  
  const content = serializeFrontmatter(fm) + '\n\n' + body;
  return writeNote(vaultPath, name, content, { folder: frontmatter.folder || '' });
}

/**
 * Generate daily note content
 */
export function generateDailyNote(date = new Date()) {
  const dateStr = date.toISOString().split('T')[0];
  const dayName = date.toLocaleDateString('en-US', { weekday: 'long' });
  
  const fm = {
    title: `${dateStr} — ${dayName}`,
    date: dateStr,
    tags: ['daily'],
  };
  
  const body = [
    `# ${dateStr} — ${dayName}`,
    '',
    '## Morning Intentions',
    '',
    '- [ ] ',
    '',
    '## Tasks',
    '',
    '## Notes',
    '',
    '## Reflections',
    '',
    '## End of Day Review',
    '',
  ].join('\n');
  
  return { frontmatter: fm, body };
}

/**
 * Export OpenClaw memories to Obsidian notes
 */
export function exportMemoriesToVault(memories, vaultPath, options = {}) {
  mkdirSync(vaultPath, { recursive: true });
  
  const folder = options.folder || 'OpenClaw';
  const folderPath = join(vaultPath, folder);
  mkdirSync(folderPath, { recursive: true });
  
  let exported = 0;
  const errors = [];
  
  for (const memory of memories) {
    try {
      const noteName = memory.id || `memory_${Date.now()}`;
      const fm = {
        title: memory.title || noteName,
        created: memory.createdAt ? new Date(memory.createdAt).toISOString() : new Date().toISOString(),
        tags: memory.tags || [],
        source: 'openclaw',
        memory_id: memory.id,
      };
      
      const body = memory.content || JSON.stringify(memory, null, 2);
      createNote(vaultPath, noteName, body, { ...fm, folder });
      exported++;
    } catch (e) {
      errors.push(`Failed to export ${memory.id}: ${e.message}`);
    }
  }
  
  return { notesExported: exported, errors };
}

/**
 * Generate MOC (Map of Content) for a tag or folder
 */
export function generateMOC(vaultPath, scope, notes) {
  const lines = [
    `# ${scope} — MOC`,
    '',
    `> Auto-generated Map of Content. Last updated: ${new Date().toISOString()}`,
    '',
  ];
  
  if (scope.includes('tag:')) {
    const tag = scope.replace('tag:', '');
    lines.push(`Notes tagged with #${tag}:`);
  } else {
    lines.push(`Notes in ${scope}:`);
  }
  
  lines.push('');
  
  const sortedNotes = [...notes].sort((a, b) => a.title.localeCompare(b.title));
  
  for (const note of sortedNotes) {
    const alias = note.title !== note.name ? note.title : '';
    lines.push(`- [[${note.name}${alias ? '|' + alias : ''}]]`);
  }
  
  lines.push('');
  lines.push(`---\n*Total: ${notes.length} notes*\n`);
  
  return lines.join('\n');
}

/**
 * Generate index MOC for the entire vault
 */
export function generateVaultIndex(notes, options = {}) {
  const lines = [
    '# Vault Index',
    '',
    `> Auto-generated index. ${notes.length} notes. ${new Date().toISOString()}`,
    '',
  ];
  
  // Group by folder
  const byFolder = {};
  for (const note of notes) {
    const folder = note.relativePath.includes('/') 
      ? note.relativePath.split('/').slice(0, -1).join('/') 
      : 'root';
    if (!byFolder[folder]) byFolder[folder] = [];
    byFolder[folder].push(note);
  }
  
  // Group by tag
  const byTag = {};
  for (const note of notes) {
    for (const tag of note.tags) {
      if (!byTag[tag]) byTag[tag] = [];
      byTag[tag].push(note);
    }
  }
  
  // Folders section
  lines.push('## By Folder');
  lines.push('');
  for (const [folder, folderNotes] of Object.entries(byFolder)) {
    lines.push(`### ${folder === 'root' ? 'Root' : folder}`);
    lines.push('');
    for (const note of folderNotes.sort((a, b) => a.title.localeCompare(b.title))) {
      lines.push(`- [[${note.name}]]`);
    }
    lines.push('');
  }
  
  // Tags section
  const topTags = Object.entries(byTag)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 10);
  
  if (topTags.length > 0) {
    lines.push('## By Tag (Top 10)');
    lines.push('');
    for (const [tag, tagNotes] of topTags) {
      lines.push(`### #${tag} (${tagNotes.length} notes)`);
      lines.push('');
      for (const note of tagNotes.slice(0, 5)) {
        lines.push(`- [[${note.name}]]`);
      }
      if (tagNotes.length > 5) {
        lines.push(`- _...and ${tagNotes.length - 5} more_`);
      }
      lines.push('');
    }
  }
  
  // Recent notes
  const recent = [...notes]
    .sort((a, b) => new Date(b.modified) - new Date(a.modified))
    .slice(0, 10);
  
  lines.push('## Recently Modified');
  lines.push('');
  for (const note of recent) {
    const date = new Date(note.modified).toLocaleDateString();
    lines.push(`- [[${note.name}]] — ${date}`);
  }
  lines.push('');
  
  return lines.join('\n');
}

/**
 * Sync state management
 */
export function loadSyncState() {
  if (existsSync(SYNC_STATE_FILE)) {
    try {
      return JSON.parse(readFileSync(SYNC_STATE_FILE, 'utf-8'));
    } catch (e) {
      return null;
    }
  }
  return null;
}

export function saveSyncState(state) {
  mkdirSync(dirname(SYNC_STATE_FILE), { recursive: true });
  writeFileSync(SYNC_STATE_FILE, JSON.stringify(state, null, 2));
}

/**
 * Main ObsidianSync class
 */
export class ObsidianSync {
  constructor(vaultPath = null) {
    this.vaultPath = vaultPath || DEFAULT_VAULT;
    this.state = loadSyncState();
    this.notes = [];
  }
  
  /**
   * Scan the vault
   */
  scan() {
    this.notes = readVault(this.vaultPath);
    return this;
  }
  
  /**
   * Get all notes
   */
  getNotes() {
    if (this.notes.length === 0) this.scan();
    return this.notes;
  }
  
  /**
   * Find note by name
   */
  findNote(name) {
    if (this.notes.length === 0) this.scan();
    return this.notes.find(n => n.name.toLowerCase() === name.toLowerCase());
  }
  
  /**
   * Get notes by tag
   */
  getNotesByTag(tag) {
    if (this.notes.length === 0) this.scan();
    return this.notes.filter(n => n.tags.includes(tag.toLowerCase()));
  }
  
  /**
   * Get daily notes
   */
  getDailyNotes() {
    return this.getNotesByTag('daily');
  }
  
  /**
   * Get orphan notes (no backlinks)
   */
  getOrphans() {
    if (this.notes.length === 0) this.scan();
    return this.notes.filter(n => n.backlinks.length === 0 && n.links.length === 0);
  }
  
  /**
   * Create daily note for today
   */
  createDailyNote(date = new Date()) {
    const { frontmatter, body } = generateDailyNote(date);
    const dateStr = date.toISOString().split('T')[0];
    
    const notePath = join(this.vaultPath, 'daily', `${dateStr}.md`);
    mkdirSync(dirname(notePath), { recursive: true });
    
    const content = serializeFrontmatter(frontmatter) + '\n\n' + body;
    writeFileSync(notePath, content, 'utf-8');
    
    // Refresh notes
    this.scan();
    
    return notePath;
  }
  
  /**
   * Create a note from OpenClaw memory
   */
  createMemoryNote(memory, options = {}) {
    const fm = {
      title: memory.title || memory.id,
      created: memory.createdAt ? new Date(memory.createdAt).toISOString() : new Date().toISOString(),
      tags: ['openclaw', 'memory', ...(memory.tags || [])],
      source: 'openclaw',
      memory_id: memory.id,
      memory_tier: memory.tier || 'warm',
    };
    
    const body = typeof memory.content === 'string' 
      ? memory.content 
      : JSON.stringify(memory, null, 2);
    
    const name = options.name || `memory_${memory.id}_${Date.now()}`;
    const notePath = createNote(this.vaultPath, name, body, { ...fm, folder: options.folder || 'OpenClaw/Memories' });
    
    this.scan();
    return notePath;
  }
  
  /**
   * Update vault index MOC
   */
  updateIndex() {
    if (this.notes.length === 0) this.scan();
    
    const indexContent = generateVaultIndex(this.notes);
    const indexPath = join(this.vaultPath, 'Index.md');
    
    writeFileSync(indexPath, indexContent, 'utf-8');
    return indexPath;
  }
  
  /**
   * Generate MOC for a tag
   */
  generateTagMOC(tag) {
    const taggedNotes = this.getNotesByTag(tag);
    if (taggedNotes.length === 0) return null;
    
    const content = generateMOC(this.vaultPath, `tag: ${tag}`, taggedNotes);
    const mocPath = join(this.vaultPath, 'MOC', `tag_${tag}.md`);
    
    mkdirSync(dirname(mocPath), { recursive: true });
    writeFileSync(mocPath, content, 'utf-8');
    
    return mocPath;
  }
  
  /**
   * Get stats
   */
  getStats() {
    if (this.notes.length === 0) this.scan();
    
    const allTags = new Set();
    for (const note of this.notes) {
      for (const tag of note.tags) allTags.add(tag);
    }
    
    return {
      totalNotes: this.notes.length,
      totalTags: allTags.size,
      orphanNotes: this.getOrphans().length,
      totalLinks: this.notes.reduce((sum, n) => sum + n.links.length, 0),
      totalBacklinks: this.notes.reduce((sum, n) => sum + n.backlinks.length, 0),
    };
  }
  
  /**
   * Format vault as markdown summary
   */
  formatSummary() {
    const stats = this.getStats();
    const lines = [
      `# Obsidian Vault: ${basename(this.vaultPath)}`,
      '',
      `**Path**: ${this.vaultPath}`,
      `**Notes**: ${stats.totalNotes}`,
      `**Tags**: ${stats.totalTags}`,
      `**Orphan Notes**: ${stats.orphanNotes}`,
      '',
    ];
    
    // Top tags
    const tagCounts = {};
    for (const note of this.notes) {
      for (const tag of note.tags) {
        tagCounts[tag] = (tagCounts[tag] || 0) + 1;
      }
    }
    
    const topTags = Object.entries(tagCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);
    
    if (topTags.length > 0) {
      lines.push('## Top Tags');
      for (const [tag, count] of topTags) {
        lines.push(`- #${tag} (${count})`);
      }
      lines.push('');
    }
    
    return lines.join('\n');
  }
}

export default ObsidianSync;
