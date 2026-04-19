/**
 * memory_graph.mjs
 * 
 * Lightweight Knowledge Graph for OpenClaw Memory
 * 
 * Simple entity-relationship store using SQLite FTS5 as the backend.
 * Inspired by TrustGraph's GraphRAG but simplified for personal agent use.
 * 
 * Features:
 * - Entity extraction from conversation
 * - Relationship triples (subject, predicate, object)
 * - Bidirectional traversal
 * - Confidence scoring for edges
 * - Provenance for each triple
 * 
 * Does NOT require: Neo4j, Cassandra, Pulsar
 * Uses: SQLite (already available in OpenClaw)
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';

// We'll use a simple JSON file store for now
// Can be upgraded to SQLite later
const GRAPH_DIR = join(homedir(), '.openclaw', 'memory', 'graph');
const ENTITIES_FILE = join(GRAPH_DIR, 'entities.json');
const RELATIONSHIPS_FILE = join(GRAPH_DIR, 'relationships.jsonl');

/**
 * Relationship predicates we care about
 */
export const Predicate = {
  // Entity relationships
  IS_A: 'is_a',                   // Cat is_a Animal
  PART_OF: 'part_of',             // Tail part_of Cat
  WORKS_FOR: 'works_for',         // Alice works_for Acme
  KNOWS: 'knows',                 // Alice knows Bob
  BELONGS_TO: 'belongs_to',       // File belongs_to Project
  DEPENDS_ON: 'depends_on',       // Module depends_on Library
  SIMILAR_TO: 'similar_to',       // Concept similar_to Concept
  OPPOSITE_OF: 'opposite_of',     // Cat opposite_of Dog
  UPDATED: 'updated',             // File updated Date
  CREATED_BY: 'created_by',       // File created_by User
  LOCATED_AT: 'located_at',       // File located_at Path
  HAS_CAPABILITY: 'has_capability', // Tool has_capability Function
  USED_IN: 'used_in',             // Tool used_in Project
  LEARNED_FROM: 'learned_from',   // Memory learned_from Source
  CONTRADICTS: 'contradicts',     // Fact contradicts Fact
  SUPPORTS: 'supports',           // Evidence supports Claim
};

// High-level relationship categories
export const RelationshipType = {
  TAXONOMY: 'taxonomy',         // is_a, part_of
  SOCIAL: 'social',             // knows, works_for
  KNOWLEDGE: 'knowledge',        // learned_from, supports
  TECHNICAL: 'technical',       // depends_on, used_in, belongs_to
  TEMPORAL: 'temporal',         // updated, created_by
  SEMANTIC: 'semantic',         // similar_to, opposite_of
  CONFLICT: 'conflict',         // contradicts
};

/**
 * Triple: subject --predicate--> object
 */
export class Triple {
  constructor(subject, predicate, object, metadata = {}) {
    this.id = 'triple_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
    this.subject = subject.trim();
    this.predicate = predicate.trim();
    this.object = object.trim();
    this.confidence = metadata.confidence || 0.7;
    this.source = metadata.source || 'inferred';
    this.provenanceId = metadata.provenanceId || null;
    this.createdAt = metadata.createdAt || new Date().toISOString();
    this.updatedAt = this.createdAt;
    this.reversed = false; // For bidirectional queries
  }

  toJSON() {
    return {
      id: this.id,
      subject: this.subject,
      predicate: this.predicate,
      object: this.object,
      confidence: this.confidence,
      source: this.source,
      provenanceId: this.provenanceId,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }

  static fromJSON(json) {
    const triple = new Triple(json.subject, json.predicate, json.object, {
      confidence: json.confidence,
      source: json.source,
      provenanceId: json.provenanceId,
      createdAt: json.createdAt,
    });
    triple.id = json.id;
    triple.updatedAt = json.updatedAt || json.createdAt;
    return triple;
  }

  /**
   * Get the reversed triple (object --predicate--> subject)
   */
  reversedTriple() {
    const rev = new Triple(this.object, this.predicate, this.subject, {
      confidence: this.confidence,
      source: this.source,
      provenanceId: this.provenanceId,
      createdAt: this.createdAt,
    });
    rev.id = this.id + '_rev';
    rev.reversed = true;
    return rev;
  }

  toString() {
    return `${this.subject} --[${this.predicate}]--> ${this.object}`;
  }
}

/**
 * Entity in the knowledge graph
 */
export class Entity {
  constructor(name, type, metadata = {}) {
    this.id = 'entity_' + name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '') +
      '_' + Date.now().toString(36).slice(-4);
    this.name = name.trim();
    this.type = type; // 'person' | 'project' | 'concept' | 'file' | 'tool' | 'skill' | 'memory'
    this.description = metadata.description || '';
    this.aliases = metadata.aliases || [];
    this.confidence = metadata.confidence || 0.7;
    this.source = metadata.source || 'extracted';
    this.tags = metadata.tags || [];
    this.createdAt = metadata.createdAt || new Date().toISOString();
    this.updatedAt = this.createdAt;
    this.lastAccessedAt = null;
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      type: this.type,
      description: this.description,
      aliases: this.aliases,
      confidence: this.confidence,
      source: this.source,
      tags: this.tags,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      lastAccessedAt: this.lastAccessedAt,
    };
  }

  static fromJSON(json) {
    const entity = new Entity(json.name, json.type, {
      description: json.description,
      aliases: json.aliases,
      confidence: json.confidence,
      source: json.source,
      tags: json.tags,
      createdAt: json.createdAt,
    });
    entity.id = json.id;
    entity.updatedAt = json.updatedAt || json.createdAt;
    entity.lastAccessedAt = json.lastAccessedAt;
    return entity;
  }
}

/**
 * KnowledgeGraph — lightweight entity-relationship store
 */
export class KnowledgeGraph {
  constructor(options = {}) {
    this.dir = options.dir || GRAPH_DIR;
    this.entitiesFile = join(this.dir, 'entities.json');
    this.relationshipsFile = join(this.dir, 'relationships.jsonl');
    this.entities = new Map();
    this.triples = [];
  }

  init() {
    if (!existsSync(this.dir)) {
      mkdirSync(this.dir, { recursive: true });
    }
    this.load();
  }

  load() {
    // Load entities
    if (existsSync(this.entitiesFile)) {
      try {
        const data = JSON.parse(readFileSync(this.entitiesFile, 'utf8'));
        this.entities = new Map(data.entities || []);
      } catch { /* ignore */ }
    }

    // Load relationships
    if (existsSync(this.relationshipsFile)) {
      try {
        const lines = readFileSync(this.relationshipsFile, 'utf8').split('\n').filter(Boolean);
        this.triples = lines.map(line => Triple.fromJSON(JSON.parse(line)));
      } catch { /* ignore */ }
    }
  }

  persist() {
    // Persist entities
    const entitiesArray = Array.from(this.entities.values());
    writeFileSync(this.entitiesFile, JSON.stringify({
      entities: entitiesArray,
      count: entitiesArray.length,
    }, null, 2), 'utf8');

    // Persist relationships (append new ones)
    // For simplicity, rewrite all (could optimize with append-only log)
    const lines = this.triples.map(t => JSON.stringify(t.toJSON())).join('\n');
    writeFileSync(this.relationshipsFile, lines + '\n', 'utf8');
  }

  /**
   * Add or update an entity
   */
  addEntity(entity) {
    if (!(entity instanceof Entity)) {
      entity = new Entity(entity.name, entity.type, entity);
    }

    this.entities.set(entity.id, entity);
    return entity;
  }

  /**
   * Get entity by name (case-insensitive)
   */
  getEntityByName(name) {
    const lower = name.toLowerCase();
    for (const entity of this.entities.values()) {
      if (entity.name.toLowerCase() === lower) {
        entity.lastAccessedAt = new Date().toISOString();
        return entity;
      }
    }
    return null;
  }

  /**
   * Add a relationship triple
   */
  addTriple(subject, predicate, object, metadata = {}) {
    // Ensure entities exist
    if (!this.getEntityByName(subject)) {
      this.addEntity(new Entity(subject, 'unknown', { source: metadata.source || 'triple_inference' }));
    }
    if (!this.getEntityByName(object)) {
      this.addEntity(new Entity(object, 'unknown', { source: metadata.source || 'triple_inference' }));
    }

    const triple = new Triple(subject, predicate, object, metadata);
    this.triples.push(triple);
    return triple;
  }

  /**
   * Find triples where entity is subject or object
   */
  findTriples(entityName, options = {}) {
    const lower = entityName.toLowerCase();
    const includeReversed = options.includeReversed !== false;

    return this.triples.filter(t => {
      const match = t.subject.toLowerCase() === lower || t.object.toLowerCase() === lower;

      if (!match) return false;
      if (options.predicate && t.predicate !== options.predicate) return false;
      if (options.minConfidence && t.confidence < options.minConfidence) return false;
      if (options.source && t.source !== options.source) return false;

      return true;
    });
  }

  /**
   * Traverse from an entity to its neighbors (depth N)
   */
  traverse(startEntity, maxDepth = 2, options = {}) {
    const visited = new Set();
    const results = [];
    const queue = [{ entity: startEntity, depth: 0, path: [] }];

    while (queue.length > 0) {
      const { entity, depth, path } = queue.shift();
      const key = entity.toLowerCase();

      if (visited.has(key)) continue;
      visited.add(key);

      const triples = this.findTriples(entity, options);

      for (const triple of triples) {
        const direction = triple.subject.toLowerCase() === key ? 'out' : 'in';
        const neighbor = direction === 'out' ? triple.object : triple.subject;

        results.push({
          from: triple.subject,
          predicate: triple.predicate,
          to: triple.object,
          direction,
          depth,
          confidence: triple.confidence,
          path: [...path, triple.predicate],
        });

        if (depth < maxDepth - 1 && !visited.has(neighbor.toLowerCase())) {
          queue.push({ entity: neighbor, depth: depth + 1, path: [...path, triple.predicate] });
        }
      }
    }

    return results;
  }

  /**
   * Find hub entities (most connections)
   */
  findHubs(limit = 10) {
    const counts = new Map();

    for (const triple of this.triples) {
      counts.set(triple.subject, (counts.get(triple.subject) || 0) + 1);
      counts.set(triple.object, (counts.get(triple.object) || 0) + 1);
    }

    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([name, count]) => ({ entity: this.getEntityByName(name), connections: count }));
  }

  /**
   * Find clusters (entities that share many relationships)
   */
  findClusters(minShared = 2) {
    const clusters = [];
    const entityTriples = new Map();

    // Group triples by entity
    for (const triple of this.triples) {
      if (!entityTriples.has(triple.subject)) entityTriples.set(triple.subject, new Set());
      if (!entityTriples.has(triple.object)) entityTriples.set(triple.object, new Set());
      entityTriples.get(triple.subject).add(triple.predicate + triple.object);
      entityTriples.get(triple.object).add(triple.predicate + triple.subject);
    }

    // Find entities with shared connections
    const entities = Array.from(entityTriples.keys());
    for (let i = 0; i < entities.length; i++) {
      for (let j = i + 1; j < entities.length; j++) {
        const shared = [...entityTriples.get(entities[i])].filter(
          x => entityTriples.get(entities[j]).has(x)
        ).length;

        if (shared >= minShared) {
          clusters.push({
            entity1: entities[i],
            entity2: entities[j],
            sharedPredicates: shared,
          });
        }
      }
    }

    return clusters.sort((a, b) => b.sharedPredicates - a.sharedPredicates);
  }

  /**
   * Query: "What does X relate to Y through?"
   */
  findConnection(entity1, entity2) {
    const e1Lower = entity1.toLowerCase();
    const e2Lower = entity2.toLowerCase();

    // Direct connection
    const direct = this.triples.find(t =>
      (t.subject.toLowerCase() === e1Lower && t.object.toLowerCase() === e2Lower) ||
      (t.subject.toLowerCase() === e2Lower && t.object.toLowerCase() === e1Lower)
    );

    if (direct) {
      return {
        path: [entity1, direct.predicate, entity2],
        type: 'direct',
        confidence: direct.confidence,
      };
    }

    // 2-hop connection through intermediate
    const e1Triples = new Set(this.findTriples(entity1).map(t => t.object.toLowerCase()));
    const e2Triples = new Set(this.findTriples(entity2).map(t => t.subject.toLowerCase()));

    const intermediate = [...e1Triples].filter(x => e2Triples.has(x));
    if (intermediate.length > 0) {
      const mid = intermediate[0];
      const t1 = this.findTriples(entity1).find(t => t.object.toLowerCase() === mid);
      const t2 = this.findTriples(entity2).find(t => t.subject.toLowerCase() === mid);
      return {
        path: [entity1, t1?.predicate, mid, t2?.predicate, entity2],
        type: '2-hop',
        intermediate: mid,
        confidence: Math.min(t1?.confidence || 0, t2?.confidence || 0),
      };
    }

    return null;
  }

  /**
   * Get stats
   */
  getStats() {
    const entityTypes = {};
    for (const entity of this.entities.values()) {
      entityTypes[entity.type] = (entityTypes[entity.type] || 0) + 1;
    }

    const predicateCounts = {};
    for (const triple of this.triples) {
      predicateCounts[triple.predicate] = (predicateCounts[triple.predicate] || 0) + 1;
    }

    return {
      totalEntities: this.entities.size,
      totalTriples: this.triples.length,
      entityTypes,
      predicateCounts,
      hubs: this.findHubs(5),
    };
  }

  /**
   * Format as mermaid diagram for visualization
   */
  toMermaid(maxEntities = 20) {
    const lines = ['```mermaid', 'graph TD', ''];

    // Limit to most connected entities
    const hubs = this.findHubs(maxEntities).map(h => h.entity?.name).filter(Boolean);
    const hubSet = new Set(hubs);

    const usedEntities = new Set();
    for (const triple of this.triples) {
      if (!hubSet.has(triple.subject) && !usedEntities.size < maxEntities) continue;
      usedEntities.add(triple.subject);
      usedEntities.add(triple.object);

      const safeName = (name) => name.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 20);
      lines.push(`  ${safeName(triple.subject)} -->|"${triple.predicate}"| ${safeName(triple.object)}`);
    }

    lines.push('', '```');
    return lines.join('\n');
  }
}

// Singleton
let _graph = null;

export function getKnowledgeGraph() {
  if (!_graph) {
    _graph = new KnowledgeGraph();
    _graph.init();
  }
  return _graph;
}

/**
 * Extract entities and relationships from text
 * Simple pattern-based extraction (no LLM required)
 */
export function extractFromText(text, options = {}) {
  const triples = [];

  // Simple patterns for relationship extraction
  const patterns = [
    // "X is a Y" → X is_a Y
    { regex: /(\w[\w\s]*)\s+is\s+a\s+(\w[\w\s]*)/gi, predicate: Predicate.IS_A },
    // "X is part of Y" → X part_of Y
    { regex: /(\w[\w\s]*)\s+is\s+part\s+of\s+(\w[\w\s]*)/gi, predicate: Predicate.PART_OF },
    // "X depends on Y" → X depends_on Y
    { regex: /(\w[\w\s]*)\s+depends\s+on\s+(\w[\w\s]*)/gi, predicate: Predicate.DEPENDS_ON },
    // "X used by Y" → Y uses X → X used_in Y
    { regex: /(\w[\w\s]*)\s+used\s+(?:in|by)\s+(\w[\w\s]*)/gi, predicate: Predicate.USED_IN },
    // "X belongs to Y" → X belongs_to Y
    { regex: /(\w[\w\s]*)\s+belongs\s+to\s+(\w[\w\s]*)/gi, predicate: Predicate.BELONGS_TO },
    // "X knows Y" → X knows Y
    { regex: /(\w[\w\s]*)\s+knows\s+(\w[\w\s]*)/gi, predicate: Predicate.KNOWS },
    // "X created Y" → X created_by Y / Y created_by X
    { regex: /(\w[\w\s]*)\s+created\s+(\w[\w\s]*)/gi, predicate: Predicate.CREATED_BY },
  ];

  for (const { regex, predicate } of patterns) {
    let match;
    while ((match = regex.exec(text)) !== null) {
      triples.push({
        subject: match[1].trim(),
        predicate,
        object: match[2].trim(),
        confidence: 0.6,
        source: 'pattern_match',
      });
    }
  }

  return triples;
}

export default {
  Predicate,
  RelationshipType,
  Triple,
  Entity,
  KnowledgeGraph,
  getKnowledgeGraph,
  extractFromText,
};
