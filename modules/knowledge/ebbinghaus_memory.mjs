/**
 * ebbinghaus_memory.mjs
 * 
 * Ebbinghaus forgetting curve memory system.
 * Inspired by: agent-second-brain (smixs/agent-second-brain)
 * 
 * Human memory starts strong and gradually fades unless accessed.
 * This implements a 5-tier memory system based on the Ebbinghaus curve.
 * 
 * Tier boundaries (configurable):
 *   Core   — always in context
 *   Active — checked every session
 *   Warm   — recalled on search
 *   Cold   — deep search only
 *   Archive — occasional random recall
 */

import { existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';

/**
 * @typedef {'core' | 'active' | 'warm' | 'cold' | 'archive'} MemoryTier
 */

/**
 * @typedef {Object} MemoryEntry
 * @property {string} id
 * @property {string} content
 * @property {MemoryTier} tier
 * @property {number} strength — 0.0 to 1.0 (Ebbinghaus retention)
 * @property {number} lastAccess — timestamp of last access
 * @property {number} createdAt — creation timestamp
 * @property {number} accessCount — number of times accessed
 * @property {string[]} tags
 * @property {string} source — where this memory came from
 */

const MEMORY_DIR = join(homedir(), '.openclaw', 'memory', 'ebbinghaus');
const CONFIG_FILE = join(MEMORY_DIR, 'config.json');
const MEMORY_FILE = join(MEMORY_DIR, 'memories.jsonl');

/**
 * Default configuration — Ebbinghaus-inspired decay
 */
const DEFAULT_CONFIG = {
  tiers: {
    core:    { minStrength: 0.95, decayRate: 0.001,  checkIntervalMs: 0 },
    active:  { minStrength: 0.80, decayRate: 0.005,  checkIntervalMs: 24 * 60 * 60 * 1000 },
    warm:    { minStrength: 0.50, decayRate: 0.02,   checkIntervalMs: 7 * 24 * 60 * 60 * 1000 },
    cold:    { minStrength: 0.20, decayRate: 0.05,   checkIntervalMs: 30 * 24 * 60 * 60 * 1000 },
    archive: { minStrength: 0.01, decayRate: 0.10,   checkIntervalMs: 90 * 24 * 60 * 60 * 1000 },
  },
  archiveRecallChance: 0.05,  // 5% chance of archive recall
  promotionThreshold: 0.85,   // Promote to higher tier if above this
  demotionThreshold: 0.15,    // Demote to lower tier if below this
  maxMemoriesPerTier: {
    core: 20,
    active: 100,
    warm: 500,
    cold: 2000,
    archive: 10000,
  },
};

/**
 * Calculate decay based on time since last access
 * Based on Ebbinghaus forgetting curve: R = e^(-t/S)
 * where S is stability (memory strength)
 */
function calculateDecay(entry, config) {
  const tier = config.tiers[entry.tier];
  if (!tier) return 0;
  
  const elapsed = Date.now() - entry.lastAccess;
  const intervals = elapsed / tier.checkIntervalMs;
  
  // Apply decay rate per interval
  const decay = 1 - Math.pow(1 - tier.decayRate, intervals);
  return Math.max(0, entry.strength * (1 - decay));
}

/**
 * Load memory entries from file
 */
function loadMemories() {
  mkdirSync(MEMORY_DIR, { recursive: true });
  
  if (!existsSync(MEMORY_FILE)) {
    return [];
  }
  
  try {
    const content = readFileSync(MEMORY_FILE, 'utf-8');
    return content.trim().split('\n')
      .filter(l => l.trim())
      .map(l => JSON.parse(l));
  } catch (e) {
    return [];
  }
}

/**
 * Save memories to file (append-only)
 */
function saveMemory(entry) {
  mkdirSync(MEMORY_DIR, { recursive: true });
  appendFileSync(MEMORY_FILE, JSON.stringify(entry) + '\n');
}

/**
 * Load config
 */
function loadConfig() {
  mkdirSync(MEMORY_DIR, { recursive: true });
  
  if (existsSync(CONFIG_FILE)) {
    try {
      return { ...DEFAULT_CONFIG, ...JSON.parse(readFileSync(CONFIG_FILE, 'utf-8')) };
    } catch (e) {
      return DEFAULT_CONFIG;
    }
  }
  return DEFAULT_CONFIG;
}

/**
 * Save config
 */
function saveConfig(config) {
  mkdirSync(MEMORY_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

/**
 * Determine initial tier based on content type
 */
function determineInitialTier(content, tags = []) {
  const lower = content.toLowerCase();
  
  // Core: current projects, active goals, key people
  if (tags.includes('current') || tags.includes('active') || tags.includes('goal')) {
    return 'core';
  }
  
  // Active: recent decisions, ongoing work
  if (tags.includes('decision') || tags.includes('ongoing')) {
    return 'active';
  }
  
  // Warm: recent learnings, reflections
  if (tags.includes('learned') || tags.includes('reflection')) {
    return 'warm';
  }
  
  // Cold: old projects, archived items
  if (tags.includes('archived') || tags.includes('old')) {
    return 'cold';
  }
  
  // Default to warm
  return 'warm';
}

/**
 * Generate unique ID
 */
function genId() {
  return `mem_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Main EbbinghausMemory class
 */
export class EbbinghausMemory {
  constructor(config = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.memories = loadMemories();
  }
  
  /**
   * Add a new memory
   */
  add(content, options = {}) {
    const tier = options.tier || determineInitialTier(content, options.tags || []);
    
    const entry = {
      id: genId(),
      content,
      tier,
      strength: 1.0,
      lastAccess: Date.now(),
      createdAt: Date.now(),
      accessCount: 1,
      tags: options.tags || [],
      source: options.source || 'manual',
      metadata: options.metadata || {},
    };
    
    this.memories.push(entry);
    saveMemory(entry);
    
    return entry;
  }
  
  /**
   * Access (recall) a memory — boosts strength
   */
  access(id) {
    const entry = this.memories.find(m => m.id === id);
    if (!entry) return null;
    
    entry.lastAccess = Date.now();
    entry.accessCount++;
    
    // Boost strength on access
    entry.strength = Math.min(1.0, entry.strength + 0.1 * (1 - entry.strength));
    
    // Check for tier promotion
    if (entry.strength > this.config.promotionThreshold) {
      const tiers = ['core', 'active', 'warm', 'cold', 'archive'];
      const idx = tiers.indexOf(entry.tier);
      if (idx > 0) {
        entry.tier = tiers[idx - 1];
      }
    }
    
    return entry;
  }
  
  /**
   * Search memories — activates warm/cold recall
   */
  search(query, options = {}) {
    const limit = options.limit || 20;
    const minTier = options.minTier || 'warm'; // Don't return archives unless specified
    
    const tierOrder = { core: 0, active: 1, warm: 2, cold: 3, archive: 4 };
    const minTierIdx = tierOrder[minTier];
    
    const queryLower = query.toLowerCase();
    
    const results = [];
    
    for (const entry of this.memories) {
      const entryTierIdx = tierOrder[entry.tier];
      
      // Skip tiers below minimum
      if (entryTierIdx > tierOrder.cold && minTierIdx > tierOrder.cold) {
        continue;
      }
      
      // Apply decay
      const decayedStrength = calculateDecay(entry, this.config);
      
      // Calculate relevance
      const contentMatch = entry.content.toLowerCase().includes(queryLower);
      const tagMatch = (entry.tags || []).some(t => t.toLowerCase().includes(queryLower));
      
      if (contentMatch || tagMatch) {
        results.push({
          ...entry,
          strength: decayedStrength,
          relevance: contentMatch ? 1.0 : 0.5,
          score: decayedStrength * (contentMatch ? 1.0 : 0.5),
        });
      }
    }
    
    // Sort by score
    results.sort((a, b) => b.score - a.score);
    
    return results.slice(0, limit);
  }
  
  /**
   * Get memories for a specific tier (for context injection)
   */
  getByTier(tier, limit = 20) {
    const tierData = this.config.tiers[tier];
    if (!tierData) return [];
    
    return this.memories
      .filter(m => m.tier === tier)
      .map(m => ({
        ...m,
        strength: calculateDecay(m, this.config),
      }))
      .filter(m => m.strength >= tierData.minStrength)
      .sort((a, b) => b.strength - a.strength)
      .slice(0, limit);
  }
  
  /**
   * Get core memories (always in context)
   */
  getCoreMemories() {
    return this.getByTier('core', this.config.maxMemoriesPerTier.core);
  }
  
  /**
   * Get active memories (current session)
   */
  getActiveMemories() {
    return this.getByTier('active', this.config.maxMemoriesPerTier.active);
  }
  
  /**
   * Apply decay to all memories (call periodically)
   */
  applyDecay() {
    let decayed = 0;
    let demoted = 0;
    
    for (const entry of this.memories) {
      const oldStrength = entry.strength;
      const newStrength = calculateDecay(entry, this.config);
      
      if (Math.abs(oldStrength - newStrength) > 0.001) {
        decayed++;
        entry.strength = newStrength;
      }
      
      // Check for tier demotion
      if (entry.strength < this.config.demotionThreshold) {
        const tiers = ['core', 'active', 'warm', 'cold', 'archive'];
        const idx = tiers.indexOf(entry.tier);
        if (idx < tiers.length - 1) {
          entry.tier = tiers[idx + 1];
          demoted++;
        }
      }
    }
    
    return { decayed, demoted };
  }
  
  /**
   * Random archive recall — for creative connections
   */
  getRandomArchiveMemory() {
    if (Math.random() > this.config.archiveRecallChance) {
      return null;
    }
    
    const archives = this.memories.filter(m => m.tier === 'archive');
    if (archives.length === 0) return null;
    
    const chosen = archives[Math.floor(Math.random() * archives.length)];
    chosen.lastAccess = Date.now();
    chosen.strength = Math.min(1.0, chosen.strength + 0.05);
    
    return chosen;
  }
  
  /**
   * Get memory statistics
   */
  getStats() {
    const byTier = { core: 0, active: 0, warm: 0, cold: 0, archive: 0 };
    const bySource = {};
    let totalAccess = 0;
    
    for (const m of this.memories) {
      byTier[m.tier] = (byTier[m.tier] || 0) + 1;
      bySource[m.source] = (bySource[m.source] || 0) + 1;
      totalAccess += m.accessCount;
    }
    
    return {
      total: this.memories.length,
      byTier,
      bySource,
      totalAccess,
      avgStrength: this.memories.reduce((s, m) => s + m.strength, 0) / Math.max(1, this.memories.length),
    };
  }
  
  /**
   * Generate context for injection
   */
  generateContext(options = {}) {
    const core = this.getCoreMemories();
    const active = this.getActiveMemories();
    const archive = this.getRandomArchiveMemory();
    
    const lines = ['## Memory Context'];
    
    if (core.length > 0) {
      lines.push('\n### Core (Always in context)');
      for (const m of core) {
        lines.push(`- ${m.content} [${(m.strength * 100).toFixed(0)}%]`);
      }
    }
    
    if (active.length > 0) {
      lines.push('\n### Active (Recent)');
      for (const m of active.slice(0, 10)) {
        lines.push(`- ${m.content.slice(0, 100)} [${(m.strength * 100).toFixed(0)}%]`);
      }
    }
    
    if (archive) {
      lines.push('\n### Archive Recall');
      lines.push(`> ${archive.content.slice(0, 200)}...`);
    }
    
    return lines.join('\n');
  }
  
  /**
   * Save config changes
   */
  saveConfig() {
    saveConfig(this.config);
  }
}

// Singleton instance
let _instance = null;

export function getEbbinghausMemory() {
  if (!_instance) {
    _instance = new EbbinghausMemory();
  }
  return _instance;
}

export default { EbbinghausMemory, getEbbinghausMemory };
