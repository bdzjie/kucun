/**
 * vault_health.mjs
 * 
 * Obsidian vault self-maintenance system.
 * Inspired by: agent-second-brain vault-health skill
 * 
 * Over time, note systems rot:
 * - Orphan notes (no links in or out)
 * - Broken wiki-links
 * - Missing descriptions
 * - Divergent tags
 * 
 * This module scores vault health and suggests/makes repairs.
 */

import { existsSync, readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from 'fs';
import { join, dirname, basename } from 'path';
import { homedir } from 'os';

/**
 * @typedef {Object} VaultHealthReport
 * @property {number} score — 0-100
 * @property {number} totalNotes
 * @property {number} orphanNotes
 * @property {number} brokenLinks
 * @property {number} missingDescriptions
 * @property {string[]} suggestions
 * @property {OrphanNote[]} orphans
 * @property {BrokenLink[]} brokenLinksList
 */

const VAULT_DIR = join(homedir(), '.obsidian', 'vault');
const HEALTH_FILE = join(homedir(), '.openclaw', 'memory', 'vault_health.json');

/**
 * Parse wiki-links from markdown content
 * Matches [[link]] and [[link|alias]]
 */
function extractWikiLinks(content) {
  const regex = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
  const links = [];
  let match;
  while ((match = regex.exec(content)) !== null) {
    links.push(match[1].toLowerCase());
  }
  return links;
}

/**
 * Extract YAML frontmatter
 */
function extractFrontmatter(content) {
  if (!content.startsWith('---')) return {};
  
  const endIdx = content.indexOf('---', 3);
  if (endIdx < 0) return {};
  
  const fm = content.slice(3, endIdx);
  const result = {};
  
  // Simple YAML parsing
  const lines = fm.split('\n');
  for (const line of lines) {
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim();
      const value = line.slice(colonIdx + 1).trim();
      result[key] = value;
    }
  }
  
  return result;
}

/**
 * Scan a vault directory for markdown files
 */
function scanVault(vaultPath) {
  const notes = [];
  
  function scanDir(dir) {
    if (!existsSync(dir)) return;
    
    const entries = readdirSync(dir);
    for (const entry of entries) {
      const fullPath = join(dir, entry);
      
      // Skip hidden directories and non-markdown
      if (entry.startsWith('.')) continue;
      
      try {
        const stat = statSync(fullPath);
        
        if (stat.isDirectory()) {
          scanDir(fullPath);
        } else if (entry.endsWith('.md')) {
          const content = readFileSync(fullPath, 'utf-8');
          const frontmatter = extractFrontmatter(content);
          const wikiLinks = extractWikiLinks(content);
          
          notes.push({
            path: fullPath,
            name: entry.replace('.md', ''),
            title: frontmatter.title || entry.replace('.md', ''),
            tags: frontmatter.tags || [],
            aliases: frontmatter.aliases ? frontmatter.aliases.split(',').map(a => a.trim()) : [],
            wikiLinks,
            content: content.slice(0, 500), // First 500 chars for description check
            hasDescription: !!frontmatter.description,
          });
        }
      } catch (e) {
        // Skip unreadable files
      }
    }
  }
  
  scanDir(vaultPath);
  return notes;
}

/**
 * Find orphan notes (no incoming or outgoing links)
 */
function findOrphans(notes) {
  const orphans = [];
  const allLinks = new Set();
  
  // Collect all link targets
  for (const note of notes) {
    for (const link of note.wikiLinks) {
      allLinks.add(link);
    }
  }
  
  // Find orphans
  for (const note of notes) {
    const noteNameLower = note.name.toLowerCase();
    const hasIncoming = allLinks.has(noteNameLower);
    const hasOutgoing = note.wikiLinks.length > 0;
    
    if (!hasIncoming && !hasOutgoing) {
      orphans.push({
        ...note,
        reason: 'completely orphan (no links in or out)',
      });
    } else if (!hasIncoming) {
      orphans.push({
        ...note,
        reason: 'no incoming links (dead end)',
      });
    } else if (!hasOutgoing) {
      orphans.push({
        ...note,
        reason: 'no outgoing links (isolated)',
      });
    }
  }
  
  return orphans;
}

/**
 * Find broken wiki-links (links to non-existent notes)
 */
function findBrokenLinks(notes) {
  const existingNotes = new Set(notes.map(n => n.name.toLowerCase()));
  const broken = [];
  
  for (const note of notes) {
    for (const link of note.wikiLinks) {
      // Check if linked note exists
      const linkTarget = link.replace(/\s+/g, '-').toLowerCase();
      
      if (!existingNotes.has(linkTarget) && !existingNotes.has(link)) {
        broken.push({
          sourceNote: note.name,
          sourcePath: note.path,
          brokenLink: link,
          suggestion: linkTarget,
        });
      }
    }
  }
  
  return broken;
}

/**
 * Find notes missing descriptions
 */
function findMissingDescriptions(notes) {
  return notes.filter(n => !n.hasDescription && n.content.length < 50);
}

/**
 * Suggest MOC candidates (notes with many incoming links)
 */
function suggestMOCs(notes) {
  const incomingCounts = {};
  
  // Count incoming links
  for (const note of notes) {
    for (const link of note.wikiLinks) {
      const linkKey = link.toLowerCase();
      incomingCounts[linkKey] = (incomingCounts[linkKey] || 0) + 1;
    }
  }
  
  // Notes with 5+ incoming links are good MOC candidates
  const candidates = notes
    .filter(n => (incomingCounts[n.name.toLowerCase()] || 0) >= 5)
    .map(n => ({
      name: n.name,
      title: n.title,
      incomingLinks: incomingCounts[n.name.toLowerCase()] || 0,
    }))
    .sort((a, b) => b.incomingLinks - a.incomingLinks);
  
  return candidates;
}

/**
 * Calculate vault health score
 */
function calculateScore(notes, orphans, brokenLinks, missingDescriptions) {
  if (notes.length === 0) return 100;
  
  const orphanPenalty = Math.min(30, (orphans.length / notes.length) * 100);
  const brokenLinkPenalty = Math.min(30, (brokenLinks.length / notes.length) * 100);
  const missingDescPenalty = Math.min(20, (missingDescriptions.length / notes.length) * 100);
  
  return Math.max(0, Math.round(100 - orphanPenalty - brokenLinkPenalty - missingDescPenalty));
}

/**
 * Main VaultHealth class
 */
export class VaultHealth {
  constructor(vaultPath = null) {
    this.vaultPath = vaultPath || VAULT_DIR;
    this.notes = [];
  }
  
  /**
   * Scan the vault
   */
  scan() {
    this.notes = scanVault(this.vaultPath);
    return this;
  }
  
  /**
   * Generate full health report
   */
  generateReport() {
    if (this.notes.length === 0) {
      this.scan();
    }
    
    const orphans = findOrphans(this.notes);
    const brokenLinks = findBrokenLinks(this.notes);
    const missingDescriptions = findMissingDescriptions(this.notes);
    const mocCandidates = suggestMOCs(this.notes);
    
    const score = calculateScore(this.notes, orphans, brokenLinks, missingDescriptions);
    
    const suggestions = [];
    
    if (orphans.length > 0) {
      suggestions.push(`Connect ${orphans.length} orphan note(s) to your knowledge graph`);
    }
    if (brokenLinks.length > 0) {
      suggestions.push(`Fix ${brokenLinks.length} broken wiki-link(s)`);
    }
    if (missingDescriptions.length > 0) {
      suggestions.push(`Add descriptions to ${missingDescriptions.length} note(s)`);
    }
    if (mocCandidates.length > 0) {
      suggestions.push(`Consider creating MOCs for ${mocCandidates.length} hub note(s)`);
    }
    
    return {
      score,
      totalNotes: this.notes.length,
      orphanNotes: orphans.length,
      brokenLinks: brokenLinks.length,
      missingDescriptions: missingDescriptions.length,
      suggestions,
      orphans: orphans.slice(0, 10),
      brokenLinksList: brokenLinks.slice(0, 10),
      mocCandidates: mocCandidates.slice(0, 10),
      scannedAt: new Date().toISOString(),
    };
  }
  
  /**
   * Get orphan notes
   */
  getOrphans() {
    if (this.notes.length === 0) this.scan();
    return findOrphans(this.notes);
  }
  
  /**
   * Get broken links
   */
  getBrokenLinks() {
    if (this.notes.length === 0) this.scan();
    return findBrokenLinks(this.notes);
  }
  
  /**
   * Suggest connections for an orphan
   */
  suggestConnectionsForOrphan(orphanName) {
    if (this.notes.length === 0) this.scan();
    
    const orphan = this.notes.find(n => n.name.toLowerCase() === orphanName.toLowerCase());
    if (!orphan) return [];
    
    // Find notes with similar tags or content
    const orphanTags = new Set(orphan.tags.map(t => t.toLowerCase()));
    
    const suggestions = [];
    for (const note of this.notes) {
      if (note.name === orphan.name) continue;
      
      const noteTags = new Set(note.tags.map(t => t.toLowerCase()));
      const sharedTags = [...orphanTags].filter(t => noteTags.has(t));
      
      if (sharedTags.length > 0) {
        suggestions.push({
          note: note.name,
          title: note.title,
          sharedTags,
          linkText: `[[${note.name}]]`,
        });
      }
    }
    
    return suggestions.sort((a, b) => b.sharedTags.length - a.sharedTags.length).slice(0, 5);
  }
  
  /**
   * Generate MOC content for a hub note
   */
  generateMOC(mocName) {
    if (this.notes.length === 0) this.scan();
    
    const incomingCounts = {};
    for (const note of this.notes) {
      for (const link of note.wikiLinks) {
        const linkKey = link.toLowerCase();
        if (linkKey === mocName.toLowerCase()) {
          incomingCounts[note.name] = note;
        }
      }
    }
    
    const linkedNotes = Object.values(incomingCounts);
    if (linkedNotes.length === 0) return null;
    
    const lines = [
      `# ${mocName}`,
      '',
      `> This is an auto-generated Map of Content (MOC).`,
      '',
      `## Linked Notes (${linkedNotes.length})`,
      '',
    ];
    
    for (const note of linkedNotes) {
      const alias = note.title !== note.name ? note.title : '';
      lines.push(`- [[${note.name}${alias ? '|' + alias : ''}]]`);
    }
    
    lines.push('');
    lines.push(`---\n*Generated: ${new Date().toISOString()}*\n`);
    
    return lines.join('\n');
  }
  
  /**
   * Save health report
   */
  saveReport(report) {
    mkdirSync(dirname(HEALTH_FILE), { recursive: true });
    writeFileSync(HEALTH_FILE, JSON.stringify(report, null, 2));
    return HEALTH_FILE;
  }
  
  /**
   * Load last health report
   */
  loadLastReport() {
    if (existsSync(HEALTH_FILE)) {
      try {
        return JSON.parse(readFileSync(HEALTH_FILE, 'utf-8'));
      } catch (e) {
        return null;
      }
    }
    return null;
  }
  
  /**
   * Format report as markdown
   */
  formatReport(report) {
    const scoreColor = report.score >= 80 ? 'green' : report.score >= 60 ? 'yellow' : 'red';
    
    const lines = [
      `# Vault Health Report`,
      '',
      `**Score**: [${scoreColor}]${report.score}/100[/${scoreColor}]`,
      `**Total Notes**: ${report.totalNotes}`,
      `**Scanned**: ${new Date(report.scannedAt).toLocaleString()}`,
      '',
      '## Issues',
      `| Issue | Count |`,
      `|-------|-------|`,
      `| Orphan Notes | ${report.orphanNotes} |`,
      `| Broken Links | ${report.brokenLinks} |`,
      `| Missing Descriptions | ${report.missingDescriptions} |`,
    ];
    
    if (report.suggestions.length > 0) {
      lines.push('', '## Suggestions');
      for (const s of report.suggestions) {
        lines.push(`- ${s}`);
      }
    }
    
    if (report.orphans.length > 0) {
      lines.push('', '## Orphan Notes');
      for (const o of report.orphans.slice(0, 5)) {
        lines.push(`- [[${o.name}]] — ${o.reason}`);
      }
    }
    
    if (report.mocCandidates.length > 0) {
      lines.push('', '## MOC Candidates');
      for (const m of report.mocCandidates.slice(0, 5)) {
        lines.push(`- [[${m.name}]] — ${m.incomingLinks} incoming links`);
      }
    }
    
    return lines.join('\n');
  }
}

export default VaultHealth;
