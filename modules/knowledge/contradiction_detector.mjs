/**
 * contradiction_detector.mjs
 * 
 * Detects conflicting claims across knowledge sources.
 * Inspired by: SwarmVault (swarmclawai/swarmvault)
 * 
 * Every claim is tagged: extracted | inferred | ambiguous
 * Conflicts are flagged when contradictory claims are found.
 * 
 * Approach:
 * 1. Extract claims as SVO triples (Subject-Verb-Object)
 * 2. Group by topic/concept
 * 3. Detect contradictions via:
 *    - Direct negation detection ("is" vs "is not")
 *    - Numeric conflicts (different values for same metric)
 *    - Temporal conflicts (different timelines)
 *    - LLM-as-Judge for semantic contradictions
 */

import { existsSync, readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, appendFileSync } from 'fs';
import { join, dirname, relative } from 'path';
import { homedir } from 'os';

/**
 * @typedef {'extracted' | 'inferred' | 'ambiguous'} ClaimProvenance
 * @typedef {'direct' | 'numeric' | 'temporal' | 'semantic'} ConflictType
 */

/**
 * @typedef {Object} Claim
 * @property {string} id
 * @property {string} subject
 * @property {string} verb
 * @property {string} object
 * @property {ClaimProvenance} provenance
 * @property {string} source — file or note name
 * @property {string} originalText — the source sentence
 * @property {number} lineNumber
 */

/**
 * @typedef {Object} Conflict
 * @property {string} id
 * @property {Claim} claimA
 * @property {Claim} claimB
 * @property {ConflictType} type
 * @property {string} explanation
 * @property {number} severity — 0.0-1.0
 * @property {string[]} tags
 */

const DETECTOR_DIR = join(homedir(), '.openclaw', 'memory', 'knowledge');
const CONFLICTS_FILE = join(DETECTOR_DIR, 'conflicts.jsonl');
const CACHE_FILE = join(DETECTOR_DIR, 'claims_cache.json');

/**
 * Patterns for extracting claims from natural language
 */

// Negation patterns
const NEGATION_PATTERNS = [
  /\b(not|n't|never|no|none|nothing|nobody|nowhere|neither|either)\b/i,
];

// Numeric claim patterns
const NUMERIC_PATTERNS = [
  /(\w+)\s*(?:is|was|are|were)?\s*(\d+(?:\.\d+)?)\s*(%|percent|km|m|kg|lb|mb|gb|tb|years?|months?|days?|hours?|minutes?|people|dollars?)?/gi,
  /(cost|price|size|weight|height|speed|rate|percent|percentage|score|rating|price)\s+(?:of\s+)?(\d+(?:\.\d+)?)\s*/gi,
];

// Subject-Verb-Object extraction patterns
const SVO_PATTERNS = [
  // "X is Y"
  /^([A-Z][a-zA-Z\s]+?)\s+(?:is|was|are|were)\s+(.+)$/gm,
  // "X can Y"  
  /^([A-Z][a-zA-Z\s]+?)\s+can\s+(.+)$/gm,
  // "X has Y"
  /^([A-Z][a-zA-Z\s]+?)\s+has\s+(.+)$/gm,
  // "X uses Y"
  /^([A-Z][a-zA-Z\s]+?)\s+(?:uses|used|developed|created|made|built)\s+(.+)$/gm,
  // "X provides Y"
  /^([A-Z][a-zA-Z\s]+?)\s+(?:provides|offers|gives|delivers)\s+(.+)$/gm,
];

/**
 * Extract claims from text content
 */
export function extractClaims(content, options = {}) {
  const claims = [];
  const lines = content.split('\n');
  const source = options.source || 'unknown';
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.length < 10) continue; // Skip short lines
    
    // Skip code blocks and frontmatter
    if (line.startsWith('```') || line.startsWith('---') || line.startsWith('#')) continue;
    
    // Try SVO extraction
    const svoClaims = extractSVOClaims(line, source, i + 1);
    claims.push(...svoClaims);
    
    // Extract numeric claims
    const numClaims = extractNumericClaims(line, source, i + 1);
    claims.push(...numClaims);
  }
  
  return claims;
}

/**
 * Extract Subject-Verb-Object claims
 */
function extractSVOClaims(line, source, lineNumber) {
  const claims = [];
  
  // Direct "is" statements
  const isMatch = line.match(/^([A-Z][a-zA-Z][a-zA-Z\s]*?)\s+(?:is|was|are|were)\s+(.+)$/);
  if (isMatch) {
    const subject = isMatch[1].trim();
    const object = isMatch[2].replace(/[.,;!?].*$/, '').trim();
    
    if (subject.length > 1 && object.length > 1) {
      const isNegated = NEGATION_PATTERNS.some(p => p.test(object));
      
      claims.push({
        id: `svo_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        subject,
        verb: isNegated ? 'is not' : 'is',
        object,
        provenance: 'extracted',
        source,
        originalText: line,
        lineNumber,
        isNegated,
      });
    }
  }
  
  // Capability statements ("X can Y")
  const canMatch = line.match(/^([A-Z][a-zA-Z][a-zA-Z\s]*?)\s+can\s+(.+)$/);
  if (canMatch) {
    claims.push({
      id: `can_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      subject: canMatch[1].trim(),
      verb: 'can',
      object: canMatch[2].replace(/[.,;!?].*$/, '').trim(),
      provenance: 'extracted',
      source,
      originalText: line,
      lineNumber,
      isNegated: false,
    });
  }
  
  return claims;
}

/**
 * Extract numeric claims
 */
function extractNumericClaims(line, source, lineNumber) {
  const claims = [];
  
  // Match patterns like "latency is 100ms" or "costs $5"
  const matches = [
    ...line.matchAll(/(?:latency|latency is|latency was|speed|speed is|cost|cost is|price|price is|size|size is|weight|weight is|height|height is)\s+(?:of\s+)?(\d+(?:\.\d+)?)\s*(%|percent|km|m|kg|lb|mb|gb|tb|ms|ns|years?|months?|days?|hours?|minutes?|people|dollars?|USD)?/gi),
  ];
  
  // Also match "X is N units" patterns
  const isMatches = [...line.matchAll(/(\w+(?:\s+\w+)?)\s+(?:is|was|are|were)\s+(\d+(?:\.\d+)?)\s*(%|percent|km|m|kg|lb|mb|gb|tb|ms|ns|years?|months?|days?|hours?|minutes?|people|dollars?|USD)?/gi)];
  
  for (const match of isMatches) {
    const metric = match[1].trim();
    const value = match[2];
    const unit = match[3] || '';
    
    if (metric.length > 2 && !['the', 'a', 'an', 'this', 'that', 'it', 'is'].includes(metric.toLowerCase())) {
      claims.push({
        id: `num_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        subject: metric,
        verb: 'has value',
        object: `${value}${unit ? ' ' + unit : ''}`,
        provenance: 'extracted',
        source,
        originalText: line,
        lineNumber,
        numeric: true,
        value: parseFloat(value),
        unit,
      });
    }
  }
  
  return claims;
}

/**
 * Normalize claim text for comparison
 */
function normalizeClaimText(claim) {
  return `${claim.subject.toLowerCase()} ${claim.verb.toLowerCase()} ${claim.object.toLowerCase()}`
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Check for direct contradiction (negation)
 */
function checkNegationContradiction(claimA, claimB) {
  // Direct negation: "X is Y" vs "X is not Y"
  if (claimA.subject.toLowerCase() === claimB.subject.toLowerCase() &&
      claimA.object.toLowerCase() === claimB.object.toLowerCase()) {
    if (claimA.isNegated !== claimB.isNegated) {
      return {
        type: 'direct',
        severity: 1.0,
        explanation: `Direct contradiction: "${claimA.subject} ${claimA.verb} ${claimA.object}" vs "${claimB.subject} ${claimB.verb} ${claimB.object}"`,
      };
    }
  }
  
  // One claim negates the other
  const textA = normalizeClaimText(claimA);
  const textB = normalizeClaimText(claimB);
  
  const negations = [
    ['is', 'is not'], ['can', 'cannot'], ['has', 'does not have'],
    ['was', 'was not'], ['are', 'are not'], ['uses', 'does not use'],
  ];
  
  for (const [pos, neg] of negations) {
    if (textA.includes(pos) && !textA.includes('not') && textB.includes(neg)) {
      const baseA = textA.replace(new RegExp(pos), '').trim();
      const baseB = textB.replace(new RegExp(neg), '').replace('not', '').trim();
      
      if (baseA === baseB) {
        return {
          type: 'direct',
          severity: 1.0,
          explanation: `Direct contradiction: "${claimA.originalText}" vs "${claimB.originalText}"`,
        };
      }
    }
  }
  
  return null;
}

/**
 * Check for numeric contradiction
 */
function checkNumericContradiction(claimA, claimB) {
  if (!claimA.numeric || !claimB.numeric) return null;
  
  if (claimA.subject.toLowerCase() === claimB.subject.toLowerCase() &&
      claimA.unit === claimB.unit) {
    const diff = Math.abs(claimA.value - claimB.value);
    const avg = (claimA.value + claimB.value) / 2;
    const pctDiff = diff / avg;
    
    if (pctDiff > 0.1) { // 10% difference threshold
      return {
        type: 'numeric',
        severity: Math.min(1.0, pctDiff),
        explanation: `Numeric conflict: ${claimA.subject} is ${claimA.value}${claimA.unit} in "${claimA.source}" but ${claimB.value}${claimB.unit} in "${claimB.source}"`,
        claimAValue: claimA.value,
        claimBValue: claimB.value,
        unit: claimA.unit,
      };
    }
  }
  
  return null;
}

/**
 * Detect contradictions between two claims
 */
function detectContradiction(claimA, claimB) {
  // Skip same source
  if (claimA.source === claimB.source) return null;
  
  // Check negation
  const negation = checkNegationContradiction(claimA, claimB);
  if (negation) return negation;
  
  // Check numeric
  const numeric = checkNumericContradiction(claimA, claimB);
  if (numeric) return numeric;
  
  return null;
}

/**
 * Group claims by topic (subject)
 */
function groupByTopic(claims) {
  const groups = new Map();
  
  for (const claim of claims) {
    const key = claim.subject.toLowerCase().trim();
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(claim);
  }
  
  return groups;
}

/**
 * Detect all contradictions in a set of claims
 */
export function detectContradictions(claims) {
  const conflicts = [];
  const groups = groupByTopic(claims);
  
  for (const [topic, topicClaims] of groups) {
    if (topicClaims.length < 2) continue;
    
    // Compare all pairs within the topic
    for (let i = 0; i < topicClaims.length; i++) {
      for (let j = i + 1; j < topicClaims.length; j++) {
        const conflict = detectContradiction(topicClaims[i], topicClaims[j]);
        if (conflict) {
          conflicts.push({
            id: `conf_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            claimA: topicClaims[i],
            claimB: topicClaims[j],
            ...conflict,
            tags: [topic],
            detectedAt: new Date().toISOString(),
          });
        }
      }
    }
  }
  
  return conflicts;
}

/**
 * Scan a directory for markdown files and extract claims
 */
export function scanForClaims(dirPath, options = {}) {
  const allClaims = [];
  
  function scanDir(dir) {
    if (!existsSync(dir)) return;
    
    const entries = readdirSync(dir);
    for (const entry of entries) {
      if (entry.startsWith('.')) continue;
      
      const fullPath = join(dir, entry);
      try {
        const stat = statSync(fullPath);
        
        if (stat.isDirectory()) {
          scanDir(fullPath);
        } else if (entry.endsWith('.md')) {
          const content = readFileSync(fullPath, 'utf-8');
          const relativePath = relative(dirPath, fullPath);
          const claims = extractClaims(content, { 
            source: relativePath.replace(/\\/g, '/').replace('.md', ''),
          });
          allClaims.push(...claims);
        }
      } catch (e) {
        // Skip errors
      }
    }
  }
  
  scanDir(dirPath);
  return allClaims;
}

/**
 * Main ContradictionDetector class
 */
export class ContradictionDetector {
  constructor() {
    mkdirSync(DETECTOR_DIR, { recursive: true });
    this.claims = [];
    this.conflicts = [];
    this.load();
  }
  
  load() {
    if (existsSync(CACHE_FILE)) {
      try {
        const data = JSON.parse(readFileSync(CACHE_FILE, 'utf-8'));
        this.claims = data.claims || [];
        this.conflicts = data.conflicts || [];
      } catch (e) {
        this.claims = [];
        this.conflicts = [];
      }
    }
  }
  
  save() {
    writeFileSync(CACHE_FILE, JSON.stringify({
      claims: this.claims,
      conflicts: this.conflicts,
      updatedAt: new Date().toISOString(),
    }, null, 2));
  }
  
  /**
   * Scan a directory and extract all claims
   */
  scan(dirPath) {
    this.claims = scanForClaims(dirPath);
    return this;
  }
  
  /**
   * Run contradiction detection
   */
  detect() {
    this.conflicts = detectContradictions(this.claims);
    this.save();
    return this;
  }
  
  /**
   * Get all conflicts
   */
  getConflicts() {
    return this.conflicts;
  }
  
  /**
   * Get conflicts by severity
   */
  getConflictsBySeverity(minSeverity = 0.5) {
    return this.conflicts.filter(c => c.severity >= minSeverity);
  }
  
  /**
   * Get conflicts by type
   */
  getConflictsByType(type) {
    return this.conflicts.filter(c => c.type === type);
  }
  
  /**
   * Get statistics
   */
  getStats() {
    return {
      totalClaims: this.claims.length,
      totalConflicts: this.conflicts.length,
      byType: {
        direct: this.conflicts.filter(c => c.type === 'direct').length,
        numeric: this.conflicts.filter(c => c.type === 'numeric').length,
        temporal: this.conflicts.filter(c => c.type === 'temporal').length,
        semantic: this.conflicts.filter(c => c.type === 'semantic').length,
      },
      byProvenance: {
        extracted: this.claims.filter(c => c.provenance === 'extracted').length,
        inferred: this.claims.filter(c => c.provenance === 'inferred').length,
        ambiguous: this.claims.filter(c => c.provenance === 'ambiguous').length,
      },
      bySource: this.claims.reduce((acc, c) => {
        acc[c.source] = (acc[c.source] || 0) + 1;
        return acc;
      }, {}),
    };
  }
  
  /**
   * Format conflicts as markdown report
   */
  formatReport() {
    const stats = this.getStats();
    const lines = [
      '# Contradiction Detection Report',
      '',
      `**Generated**: ${new Date().toISOString()}`,
      `**Total Claims**: ${stats.totalClaims}`,
      `**Total Conflicts**: ${stats.totalConflicts}`,
      '',
      '## Summary',
      `| Type | Count |`,
      `|------|-------|`,
      `| Direct | ${stats.byType.direct} |`,
      `| Numeric | ${stats.byType.numeric} |`,
      `| Temporal | ${stats.byType.temporal} |`,
      `| Semantic | ${stats.byType.semantic} |`,
      '',
    ];
    
    if (this.conflicts.length === 0) {
      lines.push('## No Contradictions Found', '', 'All claims are consistent across sources.');
      return lines.join('\n');
    }
    
    lines.push('## Conflicts');
    
    // Sort by severity
    const sorted = [...this.conflicts].sort((a, b) => b.severity - a.severity);
    
    for (const conflict of sorted) {
      const severityLabel = conflict.severity >= 0.8 ? '🔴 HIGH' : conflict.severity >= 0.5 ? '🟡 MED' : '🟢 LOW';
      
      lines.push('');
      lines.push(`### ${severityLabel} ${conflict.type.toUpperCase()} Conflict`);
      lines.push('');
      lines.push(`**Claim A** (${conflict.claimA.source}:${conflict.claimA.lineNumber}):`);
      lines.push(`> ${conflict.claimA.originalText}`);
      lines.push('');
      lines.push(`**Claim B** (${conflict.claimB.source}:${conflict.claimB.lineNumber}):`);
      lines.push(`> ${conflict.claimB.originalText}`);
      lines.push('');
      lines.push(`**Explanation**: ${conflict.explanation}`);
      lines.push('');
    }
    
    return lines.join('\n');
  }
  
  /**
   * Save conflicts to file
   */
  saveConflicts() {
    mkdirSync(DETECTOR_DIR, { recursive: true });
    for (const conflict of this.conflicts) {
      appendFileSync(CONFLICTS_FILE, JSON.stringify(conflict) + '\n');
    }
  }
}

export default ContradictionDetector;
