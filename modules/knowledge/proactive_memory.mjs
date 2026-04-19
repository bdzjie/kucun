/**
 * proactive_memory.mjs
 * 
 * Proactive Memory Activation System
 * 
 * Monitors the current session for topics and proactively surfaces
 * relevant memories BEFORE the user asks for them.
 * 
 * How it works:
 * 1. Topic detection: Analyze current conversation for themes
 * 2. Memory retrieval: Find relevant memories using memory_rag
 * 3. Relevance scoring: Score memories by relevance to current topic
 * 4. Proactive surfacing: Present memories at appropriate moments
 * 
 * Surfaces memories when:
 * - New topic detected (conversation shifts)
 * - Memory about current topic exists (reminder)
 * - Context suggests memory would be helpful (prediction)
 * - Time-based trigger (episodic memory refresh)
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { getMemoryRAG } from './memory_rag.mjs';
import { getFeedbackStore, recordRetrievalUsed } from './memory_feedback.mjs';
import { getContextCoreLoader } from './context_core_loader.mjs';

const PROACTIVE_DIR = join(homedir(), '.openclaw', 'memory', 'proactive');

/**
 * Topic — detected theme in conversation
 */
export class Topic {
  constructor(name, keywords, confidence = 0.5) {
    this.name = name;
    this.keywords = keywords;
    this.confidence = confidence;
    this.firstSeen = new Date().toISOString();
    this.lastSeen = this.firstSeen;
    this.mentionCount = 1;
  }

  update() {
    this.lastSeen = new Date().toISOString();
    this.mentionCount++;
  }
}

/**
 * ProactiveMemory — manages proactive surfacing
 */
export class ProactiveMemory {
  constructor(options = {}) {
    this.rag = options.rag || getMemoryRAG();
    this.feedback = options.feedback || getFeedbackStore();
    this.loader = options.loader || getContextCoreLoader();
    
    this.windowSize = options.windowSize || 10; // Last N messages to analyze
    this.topicThreshold = options.topicThreshold || 0.3; // Min confidence for topic
    this.memoryThreshold = options.memoryThreshold || 0.4; // Min relevance for surfacing
    this.maxMemories = options.maxMemories || 3; // Max memories to surface at once
    
    this.currentTopics = new Map(); // topicName → Topic
    this.lastSurfaced = new Map(); // memoryId → timestamp
    this.surfacingCooldown = options.surfacingCooldown || 60000; // 1 min between same memory
    
    this.enabled = options.enabled !== false;
    this.lastCheck = null;
  }

  /**
   * Analyze conversation and detect topics
   */
  detectTopics(messages) {
    const recentMessages = messages.slice(-this.windowSize);
    const text = recentMessages.map(m => m.content || '').join(' ');
    const textLower = text.toLowerCase();

    // Known topic patterns
    const topicPatterns = [
      {
        name: 'coding',
        keywords: ['code', 'function', 'bug', 'debug', 'refactor', 'import', 'export', 'class', 'api'],
        weight: 1.0,
      },
      {
        name: 'git',
        keywords: ['git', 'commit', 'branch', 'merge', 'pull', 'push', 'github'],
        weight: 1.0,
      },
      {
        name: 'openclaw',
        keywords: ['openclaw', 'skill', 'hook', 'memory', 'agent', 'session'],
        weight: 1.2,
      },
      {
        name: 'windows',
        keywords: ['windows', 'desktop', 'gui', 'click', 'automation'],
        weight: 1.0,
      },
      {
        name: 'data',
        keywords: ['data', 'database', 'query', 'sqlite', 'json', 'csv'],
        weight: 0.9,
      },
      {
        name: 'ai',
        keywords: ['ai', 'llm', 'model', 'train', 'embed', 'rag', 'gpt', 'claude'],
        weight: 1.0,
      },
      {
        name: 'evolve',
        keywords: ['evolution', 'evolve', 'genetic', 'mutate', 'fitness', 'optimize'],
        weight: 1.2,
      },
      {
        name: 'project',
        keywords: ['project', 'repo', 'module', 'package', 'setup', 'install'],
        weight: 0.8,
      },
    ];

    const detectedTopics = [];

    for (const topic of topicPatterns) {
      let matches = 0;
      for (const keyword of topic.keywords) {
        if (textLower.includes(keyword)) matches++;
      }
      
      const confidence = (matches / topic.keywords.length) * topic.weight;
      
      if (confidence >= this.topicThreshold) {
        const existing = this.currentTopics.get(topic.name);
        if (existing) {
          existing.update();
          detectedTopics.push(existing);
        } else {
          const newTopic = new Topic(topic.name, topic.keywords, confidence);
          this.currentTopics.set(topic.name, newTopic);
          detectedTopics.push(newTopic);
        }
      }
    }

    return detectedTopics;
  }

  /**
   * Find relevant memories for current topics
   */
  async findRelevantMemories(topics, options = {}) {
    const { maxResults = this.maxMemories, includeGraph = true } = options;
    const results = [];

    for (const topic of topics) {
      // Search with topic name as query
      const searchResults = await this.rag.retrieve(
        topic.name,
        { maxResults: maxResults * 2, includeGraph }
      );

      for (const result of searchResults) {
        // Skip if recently surfaced
        const lastSurfacedTime = this.lastSurfaced.get(result.content.slice(0, 100));
        if (lastSurfacedTime && Date.now() - lastSurfacedTime < this.surfacingCooldown) {
          continue;
        }

        // Apply feedback weight boost
        const feedbackBoost = this.feedback.getBoostedWeight(result.provenanceId, 1);
        result.score *= feedbackBoost;

        if (result.score >= this.memoryThreshold) {
          results.push({
            memory: result,
            topic: topic.name,
            topicConfidence: topic.confidence,
            relevance: result.score * topic.confidence,
          });
        }
      }
    }

    // Dedupe by content
    const seen = new Set();
    const deduped = [];
    for (const r of results) {
      const key = r.memory.content.slice(0, 50);
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(r);
      }
    }

    // Sort by relevance
    return deduped
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, maxResults);
  }

  /**
   * Check for memories that contradict current context
   */
  async detectContradictions(topics) {
    const contradictions = [];

    // Check for recently updated memories that might conflict
    for (const topic of topics) {
      const stats = this.feedback.getTargetStats(topic.name);
      
      // If a memory was recently marked wrong, surface the correction
      if (stats.types.includes('memory_wrong')) {
        contradictions.push({
          type: 'correction_needed',
          topic: topic.name,
          originalMemory: stats,
        });
      }
    }

    return contradictions;
  }

  /**
   * Get proactive suggestions for current conversation
   */
  async getProactiveSuggestions(messages, options = {}) {
    if (!this.enabled) {
      return { suggestions: [], reason: 'disabled' };
    }

    this.lastCheck = new Date().toISOString();

    // Step 1: Detect topics
    const topics = this.detectTopics(messages);
    
    if (topics.length === 0) {
      return { suggestions: [], reason: 'no_topics_detected', topics: [] };
    }

    // Step 2: Find relevant memories
    const relevantMemories = await this.findRelevantMemories(topics, options);

    if (relevantMemories.length === 0) {
      return { suggestions: [], reason: 'no_relevant_memories', topics };
    }

    // Step 3: Check for contradictions
    const contradictions = await this.detectContradictions(topics);

    // Step 4: Build suggestions
    const suggestions = relevantMemories.map(({ memory, topic, topicConfidence, relevance }) => {
      // Mark as surfaced
      this.lastSurfaced.set(memory.content.slice(0, 100), Date.now());

      return {
        type: 'memory_surfaced',
        content: memory.content,
        source: memory.source,
        topic,
        topicConfidence,
        relevance,
        score: memory.score,
        provenance: memory.provenanceId,
        explanation: `Relevant to current ${topic} discussion (${(relevance * 100).toFixed(0)}% match)`,
      };
    });

    // Add contradiction alerts
    for (const contr of contradictions) {
      suggestions.push({
        type: 'contradiction_alert',
        topic: contr.topic,
        explanation: contr.type === 'correction_needed' 
          ? 'A previously stored memory about this topic was marked as incorrect'
          : 'Potential conflict detected',
      });
    }

    return {
      suggestions: suggestions.slice(0, this.maxMemories),
      topics,
      reason: suggestions.length > 0 ? 'memories_found' : 'none_above_threshold',
    };
  }

  /**
   * Called when user confirms a memory was helpful
   */
  async onMemoryUsed(suggestion, metadata = {}) {
    if (suggestion.provenance) {
      const result = recordRetrievalUsed(suggestion.provenance, {
        topic: suggestion.topic,
        proactive: true,
        ...metadata,
      });

      // Also update topic weight
      const topic = this.currentTopics.get(suggestion.topic);
      if (topic) {
        topic.confidence = Math.min(1, topic.confidence * 1.1);
      }

      return result;
    }
  }

  /**
   * Called when user rejects a suggested memory
   */
  async onMemoryRejected(suggestion, metadata = {}) {
    if (suggestion.provenance) {
      return recordRetrievalUsed(suggestion.provenance, {
        topic: suggestion.topic,
        proactive: true,
        rejected: true,
        ...metadata,
      });
    }
  }

  /**
   * Refresh episodic memories (called periodically)
   */
  async refreshEpisodicMemories() {
    // Find memories that haven't been accessed recently
    // but are highly weighted (important memories)
    
    const topPerforming = this.feedback.getTopPerforming('memory', 10);
    const surfacingCandidates = [];

    for (const { targetId, weight } of topPerforming) {
      // Skip if recently surfaced
      const lastTime = this.lastSurfaced.get(targetId);
      if (lastTime && Date.now() - lastTime < 3600000) { // 1 hour
        continue;
      }

      if (weight > 0.5) { // High performing memory
        surfacingCandidates.push({
          memoryId: targetId,
          weight,
          reason: 'high_value_unaccessed',
        });
      }
    }

    return surfacingCandidates.slice(0, this.maxMemories);
  }

  /**
   * Get current state
   */
  getState() {
    return {
      enabled: this.enabled,
      topics: Array.from(this.currentTopics.entries()).map(([name, topic]) => ({
        name,
        confidence: topic.confidence,
        mentionCount: topic.mentionCount,
        lastSeen: topic.lastSeen,
      })),
      recentSuggestions: this.lastSurfaced.size,
      lastCheck: this.lastCheck,
    };
  }

  /**
   * Enable/disable
   */
  setEnabled(enabled) {
    this.enabled = enabled;
    console.log(`[ProactiveMemory] ${enabled ? 'Enabled' : 'Disabled'}`);
  }
}

// Singleton
let _proactive = null;

export function getProactiveMemory() {
  if (!_proactive) {
    _proactive = new ProactiveMemory();
  }
  return _proactive;
}

export default {
  Topic,
  ProactiveMemory,
  getProactiveMemory,
};
