/**
 * session_compaction_protocol.mjs
 * 
 * Inspired by OpenAI Agents SDK OpenAIResponsesCompactionAwareSession protocol.
 * Defines a standard interface for session memory compaction.
 * 
 * Key concepts:
 * - Session maintains conversation history
 * - Compaction reduces history to save tokens
 * - Different compaction modes: auto, aggressive, conservative
 * - Compaction can be triggered by token threshold or manually
 * 
 * The protocol defines:
 * - SessionProvider: Storage backend (file, memory, external)
 * - CompactionStrategy: How to reduce history
 * - SessionCompactor: Orchestrates compaction
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';

// ============================================================
// Types / Protocols
// ============================================================

/**
 * @typedef {Object} CompactionResult
 * @property {boolean} success
 * @property {number} original_count - Original message count
 * @property {number} compacted_count - Messages after compaction
 * @property {number} tokens_saved - Estimated tokens saved
 * @property {string} strategy - Strategy used
 */

/**
 * @typedef {Object} SessionItem
 * @property {string} id
 * @property {'user'|'assistant'|'system'|'tool'} role
 * @property {string} content
 * @property {number} timestamp
 * @property {object} [metadata]
 */

/**
 * CompactionMode:
 * - 'auto': Let the strategy decide based on threshold
 * - 'aggressive': Keep only essential messages (system, last N)
 * - 'conservative': Keep more context, only compress mid-section
 * - 'summary': Replace message groups with summaries
 */
export const COMPACTION_MODES = {
  AUTO: 'auto',
  AGGRESSIVE: 'aggressive',
  CONSERVATIVE: 'conservative',
  SUMMARY: 'summary'
};

// ============================================================
// Compaction Strategies
// ============================================================

const STRATEGIES = {
  /**
   * Aggressive: Keep only system prompt + last N messages
   */
  aggressive: (items, keepLast = 5) => {
    const system = items.filter(i => i.role === 'system');
    const rest = items.filter(i => i.role !== 'system');
    const kept = rest.slice(-keepLast);
    return [...system, ...kept];
  },

  /**
   * Conservative: Keep first N, compress middle, keep last N
   */
  conservative: (items, keepFirst = 10, keepLast = 10) => {
    if (items.length <= keepFirst + keepLast + 5) {
      return items; // Nothing to compress
    }
    
    const system = items.filter(i => i.role === 'system');
    const nonSystem = items.filter(i => i.role !== 'system');
    
    const first = nonSystem.slice(0, keepFirst);
    const middle = nonSystem.slice(keepFirst, -keepLast);
    const last = nonSystem.slice(-keepLast);
    
    // Compress middle into a summary message
    const middleSummary = {
      id: `compact_${Date.now()}`,
      role: 'system',
      content: `[${middle.length} messages compressed. Topics discussed: ${extractTopics(middle)}]`,
      timestamp: Date.now(),
      metadata: { is_compacted: true, original_count: middle.length }
    };
    
    return [...system, ...first, middleSummary, ...last];
  },

  /**
   * Summary: Replace groups of messages with summaries
   */
  summary: (items, groupSize = 10) => {
    if (items.length < groupSize * 2) {
      return items;
    }
    
    const system = items.filter(i => i.role === 'system');
    const nonSystem = items.filter(i => i.role !== 'system');
    
    const result = [...system];
    
    for (let i = 0; i < nonSystem.length; i += groupSize) {
      const group = nonSystem.slice(i, i + groupSize);
      
      if (group.length < groupSize && i + groupSize < nonSystem.length) {
        // Partial group at the end, compress it
        result.push({
          id: `compact_${Date.now()}_${i}`,
          role: 'system',
          content: `[${group.length} messages compressed. Summary: ${generateSummary(group)}]`,
          timestamp: group[0].timestamp,
          metadata: { is_compacted: true, original_count: group.length }
        });
      } else {
        result.push(...group);
      }
    }
    
    return result;
  }
};

// ============================================================
// Token Estimation
// ============================================================

function estimateTokens(text) {
  // Rough estimate: ~4 chars per token for English
  return Math.ceil((text?.length || 0) / 4);
}

function estimateSessionTokens(items) {
  return items.reduce((sum, item) => {
    return sum + estimateTokens(item.content) + 10; // +10 for message overhead
  }, 0);
}

// ============================================================
// Topic Extraction (simple)
// ============================================================

function extractTopics(messages) {
  const words = [];
  for (const msg of messages) {
    const text = msg.content || '';
    // Extract significant words (5+ chars, not stop words)
    const stopWords = new Set(['the', 'this', 'that', 'with', 'from', 'have', 'been', 'were', 'they', 'their', 'what', 'when', 'where', 'which', 'about', 'would', 'could', 'should', 'there', 'here', 'into', 'some', 'more']);
    const found = text.match(/\b[a-zA-Z]{5,}\b/g) || [];
    words.push(...found.filter(w => !stopWords.has(w.toLowerCase())));
  }
  
  // Count frequency
  const freq = {};
  for (const w of words) {
    freq[w] = (freq[w] || 0) + 1;
  }
  
  // Get top 5
  const top = Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([w]) => w);
  
  return top.join(', ') || 'various topics';
}

function generateSummary(messages) {
  const userMsgs = messages.filter(m => m.role === 'user');
  const asstMsgs = messages.filter(m => m.role === 'assistant');
  
  return `User asked ${userMsgs.length} questions, assistant responded ${asstMsgs.length} times.`;
}

// ============================================================
// SessionCompactor
// ============================================================

export class SessionCompactor {
  constructor(options = {}) {
    this.strategies = options.strategies || STRATEGIES;
    this.tokenThreshold = options.tokenThreshold || 50000; // 50k tokens default
    this.compactionProvider = options.provider || new FileSessionProvider();
  }

  /**
   * Check if compaction is needed
   */
  needsCompaction(items, threshold = this.tokenThreshold) {
    const tokens = estimateSessionTokens(items);
    return tokens > threshold;
  }

  /**
   * Get recommended mode based on excess
   */
  getRecommendedMode(items, threshold = this.tokenThreshold) {
    const tokens = estimateSessionTokens(items);
    const ratio = tokens / threshold;
    
    if (ratio > 3) return COMPACTION_MODES.AGGRESSIVE;
    if (ratio > 2) return COMPACTION_MODES.CONSERVATIVE;
    if (ratio > 1.5) return COMPACTION_MODES.SUMMARY;
    return COMPACTION_MODES.AUTO;
  }

  /**
   * Compact a session
   * @param {string} sessionId
   * @param {string} mode - CompactionMode
   * @returns {Promise<CompactionResult>}
   */
  async compact(sessionId, mode = COMPACTION_MODES.AUTO) {
    const items = await this.compactionProvider.loadItems(sessionId);
    const originalCount = items.length;
    const originalTokens = estimateSessionTokens(items);
    
    if (originalTokens < this.tokenThreshold && mode !== COMPACTION_MODES.AGGRESSIVE) {
      return {
        success: true,
        original_count: originalCount,
        compacted_count: originalCount,
        tokens_saved: 0,
        strategy: 'none_needed'
      };
    }
    
    // Determine actual mode
    const actualMode = mode === COMPACTION_MODES.AUTO 
      ? this.getRecommendedMode(items)
      : mode;
    
    const strategy = this.strategies[actualMode];
    if (!strategy) {
      throw new Error(`Unknown compaction mode: ${actualMode}`);
    }
    
    const compacted = strategy(items);
    const compactedTokens = estimateSessionTokens(compacted);
    
    await this.compactionProvider.saveItems(sessionId, compacted);
    
    return {
      success: true,
      original_count: originalCount,
      compacted_count: compacted.length,
      tokens_saved: originalTokens - compactedTokens,
      strategy: actualMode
    };
  }
}

// ============================================================
// Session Provider Interface
// ============================================================

class FileSessionProvider {
  constructor(options = {}) {
    this.baseDir = options.baseDir || join(homedir(), '.openclaw', 'memory', 'sessions');
  }

  _getPath(sessionId) {
    return join(this.baseDir, `${sessionId}.jsonl`);
  }

  async loadItems(sessionId) {
    const path = this._getPath(sessionId);
    if (!existsSync(path)) return [];
    
    try {
      const data = readFileSync(path, 'utf-8');
      const lines = data.split('\n').filter(l => l.trim());
      return lines.map(l => {
        try {
          const obj = JSON.parse(l);
          // Support both {type, id, message: {role, content}} and flat {role, content}
          if (obj.message) {
            return {
              id: obj.id || `msg_${Date.now()}`,
              role: obj.message.role,
              content: obj.message.content,
              timestamp: obj.timestamp || Date.now(),
              metadata: obj.metadata
            };
          }
          return obj;
        } catch {
          return null;
        }
      }).filter(Boolean);
    } catch (e) {
      return [];
    }
  }

  async saveItems(sessionId, items) {
    const path = this._getPath(sessionId);
    const dir = dirname(path);
    
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    
    const data = items.map(item => JSON.stringify(item)).join('\n');
    writeFileSync(path, data + '\n', 'utf-8');
  }
}

// ============================================================
// Global Compactor
// ============================================================

let globalCompactor = null;

export function getGlobalCompactor() {
  if (!globalCompactor) {
    globalCompactor = new SessionCompactor();
  }
  return globalCompactor;
}

// ============================================================
// CLI Helpers
// ============================================================

export async function runCompaction(sessionId, options = {}) {
  const compactor = new SessionCompactor(options);
  
  const beforeItems = await compactor.compactionProvider.loadItems(sessionId);
  const beforeTokens = estimateSessionTokens(beforeItems);
  
  const result = await compactor.compact(sessionId, options.mode || COMPACTION_MODES.AUTO);
  
  console.log(`\n=== Session Compaction ===`);
  console.log(`Session: ${sessionId}`);
  console.log(`Mode: ${options.mode || 'auto'} → ${result.strategy}`);
  console.log(`Before: ${result.original_count} messages, ~${beforeTokens} tokens`);
  console.log(`After: ${result.compacted_count} messages, ~${beforeTokens - result.tokens_saved} tokens`);
  console.log(`Saved: ~${result.tokens_saved} tokens`);
  
  return result;
}

// Run from CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const sessionId = process.argv[2] || 'default';
  const mode = process.argv[3] || COMPACTION_MODES.AUTO;
  runCompaction(sessionId, { mode }).catch(console.error);
}
