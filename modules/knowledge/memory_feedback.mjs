/**
 * memory_feedback.mjs
 * 
 * Feedback Signal System for Memory and Retrieval
 * 
 * Core idea: Track when memories/retrieval results are actually USED,
 * and use that signal to improve future retrieval quality.
 * 
 * Feedback types:
 * - retrieval_used: A retrieval result was actually referenced in a response
 * - memory_cited: A stored memory was explicitly mentioned
 * - memory_applied: A memory was applied to solve a problem
 * - retrieval_rejected: A retrieval result was wrong/useful → decrease weight
 * - memory_contradicted: Contradicted by new information
 * 
 * Signals flow:
 *   User feedback → FeedbackSignal → WeightUpdate → KnowledgeGraph
 *                    ↓
 *              Reinforcement learning for retrieval ranking
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';

const FEEDBACK_DIR = join(homedir(), '.openclaw', 'memory', 'feedback');

export const FeedbackType = {
  // Positive signals
  RETRIEVAL_USED: 'retrieval_used',     // Retrieved result was referenced
  MEMORY_CITED: 'memory_cited',         // Memory was explicitly mentioned
  MEMORY_APPLIED: 'memory_applied',      // Memory helped solve a problem
  RETRIEVAL_HELPED: 'retrieval_helped',  // Retrieval result led to good outcome
  
  // Negative signals
  RETRIEVAL_REJECTED: 'retrieval_rejected', // Retrieved result was wrong
  RETRIEVAL_IGNORED: 'retrieval_ignored',  // Retrieved result was ignored
  MEMORY_WRONG: 'memory_wrong',            // Memory was incorrect
  MEMORY_OUTDATED: 'memory_outdated',      // Memory is stale
  
  // Neutral signals
  RETRIEVAL_VIEWED: 'retrieval_viewed',   // Retrieved but outcome unknown
  MEMORY_ACCESSED: 'memory_accessed',     // Memory was read but not necessarily used
};

export const SignalStrength = {
  STRONG_POSITIVE: 1.0,   // Explicit confirmation
  MEDIUM_POSITIVE: 0.5,   // Implicit signal
  WEAK_POSITIVE: 0.2,     // Speculative
  NEUTRAL: 0.0,
  WEAK_NEGATIVE: -0.2,
  MEDIUM_NEGATIVE: -0.5,
  STRONG_NEGATIVE: -1.0,
};

/**
 * Feedback entry
 */
export class FeedbackEntry {
  constructor(type, targetId, targetType, signal = SignalStrength.NEUTRAL, metadata = {}) {
    this.id = 'fb_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
    this.type = type; // FeedbackType
    this.targetId = targetId; // ID of the memory/entity/triple being feedbacked
    this.targetType = targetType; // 'memory' | 'entity' | 'triple' | 'retrieval_result'
    this.signal = signal; // SignalStrength or custom value
    this.signalStrength = this.computeSignalStrength();
    this.metadata = {
      ...metadata,
      timestamp: new Date().toISOString(),
    };
    this.createdAt = new Date().toISOString();
    this.weightDelta = 0; // Will be computed
  }

  computeSignalStrength() {
    if (typeof this.signal === 'number') return this.signal;
    return SignalStrength[this.signal] || SignalStrength.NEUTRAL;
  }
}

/**
 * FeedbackStore — persists and aggregates feedback signals
 */
export class FeedbackStore {
  constructor(options = {}) {
    this.dir = options.dir || FEEDBACK_DIR;
    this.feedbackFile = join(this.dir, 'feedback_log.jsonl');
    this.weightsFile = join(this.dir, 'weights.json');
    this.statsFile = join(this.dir, 'stats.json');
    
    this.weights = {}; // targetId → cumulative weight
    this.stats = {
      totalFeedback: 0,
      byType: {},
      byTargetType: {},
      lastUpdated: new Date().toISOString(),
    };
  }

  init() {
    if (!existsSync(this.dir)) {
      mkdirSync(this.dir, { recursive: true });
    }
    this.load();
  }

  load() {
    // Load weights
    if (existsSync(this.weightsFile)) {
      try {
        this.weights = JSON.parse(readFileSync(this.weightsFile, 'utf8'));
      } catch { /* ignore */ }
    }

    // Load stats
    if (existsSync(this.statsFile)) {
      try {
        this.stats = JSON.parse(readFileSync(this.statsFile, 'utf8'));
      } catch { /* ignore */ }
    }
  }

  persist() {
    writeFileSync(this.weightsFile, JSON.stringify(this.weights, null, 2), 'utf8');
    writeFileSync(this.statsFile, JSON.stringify(this.stats, null, 2), 'utf8');
  }

  /**
   * Record a feedback signal
   */
  record(type, targetId, targetType, signal = SignalStrength.NEUTRAL, metadata = {}) {
    this.init();

    const entry = new FeedbackEntry(type, targetId, targetType, signal, metadata);
    
    // Compute weight delta based on signal strength and current weight
    const currentWeight = this.weights[targetId] || 0;
    const delta = this.computeWeightDelta(entry, currentWeight);
    entry.weightDelta = delta;

    // Update weights
    this.weights[targetId] = Math.max(-1, Math.min(2, currentWeight + delta));
    
    // Update stats
    this.stats.totalFeedback++;
    this.stats.byType[type] = (this.stats.byType[type] || 0) + 1;
    this.stats.byTargetType[targetType] = (this.stats.byTargetType[targetType] || 0) + 1;
    this.stats.lastUpdated = new Date().toISOString();

    // Log to file
    appendFileSync(this.feedbackFile, JSON.stringify(entry.toJSON()) + '\n', 'utf8');

    this.persist();

    return {
      entry,
      newWeight: this.weights[targetId],
      delta,
    };
  }

  computeWeightDelta(entry, currentWeight) {
    const base = entry.signalStrength;
    
    // Diminishing returns for high weights
    if (currentWeight > 1.0 && base > 0) {
      return base * (1 - (currentWeight - 1.0));
    }
    
    // Recovery for very negative weights
    if (currentWeight < -0.5 && base > 0) {
      return base * 1.5; // Faster recovery
    }
    
    return base;
  }

  /**
   * Get weight for a target
   */
  getWeight(targetId) {
    return this.weights[targetId] || 0;
  }

  /**
   * Get boosted weight (applies to retrieval score)
   */
  getBoostedWeight(targetId, baseScore) {
    const weight = this.getWeight(targetId);
    // Weight is in range [-1, 2], normalize to [0.5, 1.5] for boosting
    const boost = 1 + (weight / 2); // Range: [0.5, 1.5]
    return baseScore * boost;
  }

  /**
   * Get stats for a target
   */
  getTargetStats(targetId) {
    if (!existsSync(this.feedbackFile)) {
      return { count: 0, types: [], avgSignal: 0 };
    }

    const lines = readFileSync(this.feedbackFile, 'utf8').split('\n').filter(Boolean);
    const entries = [];

    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (entry.targetId === targetId) {
          entries.push(entry);
        }
      } catch { /* skip */ }
    }

    if (entries.length === 0) {
      return { count: 0, types: [], avgSignal: 0 };
    }

    const types = [...new Set(entries.map(e => e.type))];
    const avgSignal = entries.reduce((sum, e) => sum + e.signalStrength, 0) / entries.length;

    return {
      count: entries.length,
      types,
      avgSignal,
      lastFeedback: entries[entries.length - 1]?.createdAt,
    };
  }

  /**
   * Get top performers (highest weight)
   */
  getTopPerforming(targetType = null, limit = 10) {
    const filtered = Object.entries(this.weights)
      .filter(([id, weight]) => {
        if (weight === 0) return false;
        if (targetType) {
          // We can't know targetType from weights alone without reading log
          // This would need a secondary index
        }
        return true;
      })
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit);

    return filtered.map(([id, weight]) => ({
      targetId: id,
      weight,
      stats: this.getTargetStats(id),
    }));
  }

  /**
   * Prune old feedback (keep recent only)
   */
  prune(maxAgeDays = 30) {
    if (!existsSync(this.feedbackFile)) return { pruned: 0 };

    const cutoff = Date.now() - (maxAgeDays * 24 * 60 * 60 * 1000);
    const lines = readFileSync(this.feedbackFile, 'utf8').split('\n').filter(Boolean);
    const kept = [];
    let pruned = 0;

    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (new Date(entry.createdAt).getTime() > cutoff) {
          kept.push(line);
        } else {
          pruned++;
        }
      } catch {
        pruned++;
      }
    }

    writeFileSync(this.feedbackFile, kept.join('\n') + '\n', 'utf8');

    return { pruned, remaining: kept.length };
  }
}

FeedbackEntry.prototype.toJSON = function() {
  return {
    id: this.id,
    type: this.type,
    targetId: this.targetId,
    targetType: this.targetType,
    signal: this.signal,
    signalStrength: this.signalStrength,
    metadata: this.metadata,
    createdAt: this.createdAt,
    weightDelta: this.weightDelta,
  };
};

// Singleton
let _store = null;

export function getFeedbackStore() {
  if (!_store) {
    _store = new FeedbackStore();
  }
  return _store;
}

/**
 * Shortcut: record that a retrieval result was used
 */
export function recordRetrievalUsed(retrievalResultId, metadata = {}) {
  return getFeedbackStore().record(
    FeedbackType.RETRIEVAL_USED,
    retrievalResultId,
    'retrieval_result',
    SignalStrength.MEDIUM_POSITIVE,
    metadata
  );
}

/**
 * Shortcut: record that a retrieval result was wrong
 */
export function recordRetrievalRejected(retrievalResultId, metadata = {}) {
  return getFeedbackStore().record(
    FeedbackType.RETRIEVAL_REJECTED,
    retrievalResultId,
    'retrieval_result',
    SignalStrength.MEDIUM_NEGATIVE,
    metadata
  );
}

/**
 * Shortcut: record that a memory was applied to solve a problem
 */
export function recordMemoryApplied(memoryId, metadata = {}) {
  return getFeedbackStore().record(
    FeedbackType.MEMORY_APPLIED,
    memoryId,
    'memory',
    SignalStrength.STRONG_POSITIVE,
    metadata
  );
}

/**
 * Shortcut: record that a memory was wrong
 */
export function recordMemoryWrong(memoryId, metadata = {}) {
  return getFeedbackStore().record(
    FeedbackType.MEMORY_WRONG,
    memoryId,
    'memory',
    SignalStrength.MEDIUM_NEGATIVE,
    metadata
  );
}

export default {
  FeedbackType,
  SignalStrength,
  FeedbackEntry,
  FeedbackStore,
  getFeedbackStore,
  recordRetrievalUsed,
  recordRetrievalRejected,
  recordMemoryApplied,
  recordMemoryWrong,
};
