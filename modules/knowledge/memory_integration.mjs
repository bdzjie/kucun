/**
 * memory_integration.mjs
 * 
 * Unified Memory System — 整合所有记忆模块为统一入口
 * 
 * Architecture (TrustGraph-inspired):
 * 
 *   User Query
 *       │
 *       ▼
 *   ┌─────────────────────────────────────────────────────┐
 *   │               memory_rag.ts                         │
 *   │   Concept Extraction → Entity Retrieval              │
 *   │   → Subgraph Traversal → Edge Scoring               │
 *   │   → Provenance Chain → Answer                       │
 *   └─────────────────────────────────────────────────────┘
 *       │                           │
 *       ▼                           ▼
 *   ┌──────────────┐         ┌──────────────────────────┐
 *   │ memory_graph │◄────────│   memory_provenance      │
 *   │  (Triples)   │  attach  │   (Source Tracking)      │
 *   └──────────────┘          └──────────────────────────┘
 *       │                           │
 *       │                           │
 *       ▼                           ▼
 *   ┌──────────────────────────────────────────────────────┐
 *   │              ebbinghaus_memory.mjs                     │
 *   │   Wing → Room → Hall → Drawer                         │
 *   │   (Temporal Knowledge Store + Entity Registry)       │
 *   └──────────────────────────────────────────────────────┘
 *       │
 *       ▼
 *   ┌──────────────────────────────────────────────────────┐
 *   │             context_core.mjs                         │
 *   │   Portable Knowledge Package                          │
 *   │   export/import/share cores                          │
 *   └──────────────────────────────────────────────────────┘
 *       │
 *       ▼
 *   ┌──────────────────────────────────────────────────────┐
 *   │           context_core_loader.mjs                    │
 *   │   Auto-load cores based on project fingerprint        │
 *   └──────────────────────────────────────────────────────┘
 *       │
 *       ▼
 *   ┌──────────────────────────────────────────────────────┐
 *   │          memory_feedback.mjs                          │
 *   │   Retrieval weight feedback loop                     │
 *   │   retrieval_used/rejected → weight boost              │
 *   └──────────────────────────────────────────────────────┘
 */

import { MemoryRAG } from './memory_rag.mjs';
import { getKnowledgeGraph } from './memory_graph.mjs';
import { getProvenanceStore } from './memory_provenance.mjs';
import { getFeedbackStore } from './memory_feedback.mjs';
import { getProactiveMemory } from './proactive_memory.mjs';
import { getTemporalMemoryStore } from './ebbinghaus_memory.mjs';
import { ContextCore, ContextCoreLoader, CoreDomain } from './context_core.mjs';
import { getGlobalPalaceSearch } from '../search/palace_search.mjs';

let _instance = null;

/**
 * Unified Memory System
 */
export class MemoryIntegration {
  constructor() {
    this.rag = new MemoryRAG();
    this.provenance = getProvenanceStore();
    this.feedback = getFeedbackStore();
    this.proactive = getProactiveMemory();
    this.graph = getKnowledgeGraph();
    this.store = getTemporalMemoryStore();
    this.loader = null; // Lazy init
    this.palace = getGlobalPalaceSearch();
  }

  /**
   * Singleton
   */
  static getInstance() {
    if (!_instance) {
      _instance = new MemoryIntegration();
    }
    return _instance;
  }

  // ─── Provenance ────────────────────────────────────────────

  /**
   * Attach source metadata to a memory entry
   */
  attachSource(entryId, source, confidence, pathway) {
    return this.provenance.attachToMemory(entryId, source, confidence, pathway);
  }

  /**
   * Query provenance chain for a memory
   */
  getProvenanceChain(entryId) {
    return this.provenance.getChain(entryId);
  }

  // ─── Knowledge Graph ───────────────────────────────────────

  /**
   * Add a triple to the graph
   */
  addTriple(subject, predicate, object, metadata = {}) {
    return this.graph.addTriple(subject, predicate, object, metadata);
  }

  /**
   * Extract triples from text and add to graph
   */
  extractAndGraph(text, options = {}) {
    const triples = this.graph.extractFromText(text);
    for (const t of triples) {
      this.graph.addTriple(t.subject, t.predicate, t.object, {
        source: options.source,
        text: options.text,
      });
    }
    return triples;
  }

  /**
   * Traverse the graph from an entity
   */
  traverseGraph(entity, depth = 2) {
    return this.graph.traverse(entity, depth);
  }

  /**
   * Visualize graph as Mermaid
   */
  toMermaid() {
    return this.graph.toMermaid();
  }

  // ─── RAG Retrieval ─────────────────────────────────────────

  /**
   * Main retrieval: concept extraction + graph traversal + scoring
   */
  async retrieve(query, options = {}) {
    return this.rag.retrieve(query, {
      knowledgeGraph: this.graph,
      provenanceStore: this.provenance,
      feedbackStore: this.feedback,
      ...options,
    });
  }

  /**
   * Ingest content into RAG index
   */
  async ingest(content, options = {}) {
    return this.rag.ingest(content, {
      knowledgeGraph: this.graph,
      provenanceStore: this.provenance,
      ...options,
    });
  }

  /**
   * Get an answer with provenance
   */
  async answer(query, options = {}) {
    return this.rag.answer(query, {
      knowledgeGraph: this.graph,
      provenanceStore: this.provenance,
      feedbackStore: this.feedback,
      ...options,
    });
  }

  // ─── Context Core ─────────────────────────────────────────

  /**
   * Create a context core from current state
   */
  createCore(domain = CoreDomain.ALL, options = {}) {
    const core = new ContextCore({
      id: options.id || `core_${Date.now()}`,
      domain,
      name: options.name || `Context Core ${new Date().toISOString()}`,
    });

    if (domain === CoreDomain.ALL || domain === CoreDomain.MEMORY) {
      // Add current memories
      const drawers = this.store.getAllDrawers();
      for (const drawer of drawers) {
        core.addMemory(drawer);
      }
    }

    if (domain === CoreDomain.ALL || domain === CoreDomain.PROJECT) {
      // Add knowledge graph triples
      const triples = this.graph.getAllTriples();
      for (const t of triples) {
        core.addTriple(t);
      }
    }

    return core;
  }

  /**
   * Export current state as a portable .core.json
   */
  exportCore(path, domain = CoreDomain.ALL) {
    const core = this.createCore(domain);
    return core.export(path);
  }

  /**
   * Load a context core
   */
  async loadCore(path) {
    const core = await ContextCore.load(path);
    return this.mergeCore(core);
  }

  /**
   * Merge a core into current runtime state
   */
  mergeCore(core) {
    // Add memories
    const memories = core.getMemories();
    for (const m of memories) {
      this.store.remember(m.content, m.wing, m.room, m.type);
    }

    // Add triples
    const triples = core.getTriples();
    for (const t of triples) {
      this.graph.addTriple(t.subject, t.predicate, t.object);
    }

    // Add entities
    const entities = core.getEntities();
    for (const e of entities) {
      this.graph.addEntity(e);
    }

    return { memoriesAdded: memories.length, triplesAdded: triples.length };
  }

  /**
   * Start the project-aware core auto-loader
   */
  startAutoLoader(cwd) {
    if (!this.loader) {
      this.loader = new ContextCoreLoader();
    }
    this.loader.onProjectChange(cwd);
    return this.loader.start();
  }

  // ─── Feedback Loop ─────────────────────────────────────────

  /**
   * Record that a retrieval result was used
   */
  recordRetrievalUsed(provenanceId, metadata = {}) {
    return this.feedback.recordRetrievalUsed(provenanceId, metadata);
  }

  /**
   * Record that a retrieval result was rejected
   */
  recordRetrievalRejected(provenanceId, metadata = {}) {
    return this.feedback.recordRetrievalRejected(provenanceId, metadata);
  }

  /**
   * Get boosted weight for a provenance entry
   */
  getBoostedWeight(provenanceId, defaultWeight) {
    return this.feedback.getBoostedWeight(provenanceId, defaultWeight);
  }

  /**
   * Get top performing memories by type
   */
  getTopPerforming(type, limit = 5) {
    return this.feedback.getTopPerforming(type, limit);
  }

  // ─── Proactive Memory ───────────────────────────────────────

  /**
   * Get proactive suggestions based on current conversation
   */
  getProactiveSuggestions(messages) {
    return this.proactive.getProactiveSuggestions(messages);
  }

  /**
   * Detect topics in conversation
   */
  detectTopics(messages) {
    return this.proactive.detectTopics(messages);
  }

  /**
   * Record feedback on proactive suggestion
   */
  onMemoryUsed(suggestion) {
    return this.proactive.onMemoryUsed(suggestion);
  }

  onMemoryRejected(suggestion) {
    return this.proactive.onMemoryRejected(suggestion);
  }

  // ─── BM25 Fallback ─────────────────────────────────────────

  /**
   * Search memories using BM25 (L3 deep search)
   */
  bm25Search(query, options = {}) {
    return this.palace.search(query, options);
  }

  // ─── Combined Query Flow ────────────────────────────────────

  /**
   * Full query flow:
   * 1. Topic detection
   * 2. RAG retrieval (if graph has relevant data)
   * 3. BM25 fallback
   * 4. Proactive suggestions
   * 5. Return combined results with sources
   */
  async fullQuery(query, messages = [], options = {}) {
    const topics = this.detectTopics(messages);
    const ragResults = await this.retrieve(query, options);
    const bm25Results = this.bm25Search(query, options);
    const proactive = this.getProactiveSuggestions(messages);

    return {
      query,
      topics,
      rag: ragResults,
      bm25: bm25Results,
      proactive,
      timestamp: Date.now(),
    };
  }
}

export function getMemoryIntegration() {
  return MemoryIntegration.getInstance();
}
