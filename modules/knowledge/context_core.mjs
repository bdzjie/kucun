/**
 * context_core.mjs
 * 
 * TrustGraph-inspired Context Core for OpenClaw
 * 
 * A Context Core is a portable, versioned bundle of context that can be:
 * - Stored offline (as a file)
 * - Shared between environments
 * - Loaded/unloaded at runtime
 * - Versioned and promoted through environments
 * 
 * Structure (inspired by TrustGraph Context Cores):
 * {
 *   version: "1.0",
 *   coreId: "core_xxx",
 *   created: "ISO timestamp",
 *   domain: "persona|project|skill|memory|all",
 *   ontology: { ... },        // Schema definitions
 *   entities: [ ... ],        // Entity registry
 *   triples: [ ... ],        // Knowledge graph triples
 *   memories: [ ... ],       // Ebbinghaus memory entries
 *   policies: { ... },        // Retrieval policies
 *   provenance: [ ... ],      // Provenance log
 *   metadata: { ... }        // Tags, author, etc.
 * }
 * 
 * Usage:
 *   const core = await ContextCore.create('my-skill-context')
 *   await core.addEntity({ name: 'Alice', type: 'person' })
 *   await core.addMemory({ content: 'Alice prefers Markdown', type: 'preference' })
 *   await core.export()  // Save to file
 * 
 *   const loaded = await ContextCore.load('my-skill-context.core.json')
 *   await loaded.load()  // Load into active memory
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { createHash } from 'crypto';

const CORES_DIR = join(homedir(), '.openclaw', 'memory', 'cores');

export const CoreDomain = {
  PERSONA: 'persona',       // Identity, preferences, style
  PROJECT: 'project',       // Project-specific context
  SKILL: 'skill',           // Skill-related knowledge
  MEMORY: 'memory',         // General memories
  ALL: 'all',               // Everything
};

/**
 * Context Core — portable knowledge bundle
 */
export class ContextCore {
  constructor(options = {}) {
    this.version = '1.0';
    this.coreId = options.coreId || this.generateCoreId(options.name || 'core');
    this.name = options.name || 'unnamed-core';
    this.domain = options.domain || CoreDomain.ALL;
    this.createdAt = options.createdAt || new Date().toISOString();
    this.updatedAt = this.createdAt;
    this.description = options.description || '';

    // Content sections
    this.ontology = [];       // Schema/taxonomy definitions
    this.entities = [];       // Entity registry
    this.triples = [];        // Knowledge graph triples
    this.memories = [];        // Ebbinghaus memory entries
    this.policies = {};        // Retrieval policies
    this.provenance = [];      // Provenance log entries

    // Metadata
    this.metadata = {
      author: options.author || 'openclaw',
      tags: options.tags || [],
      environment: options.environment || 'local',
      ...options.metadata,
    };

    // Runtime state
    this.isLoaded = false;
    this.isModified = false;
  }

  generateCoreId(name) {
    const timestamp = Date.now().toString(36);
    const hash = createHash('sha256').update(name + timestamp).digest('hex').slice(0, 8);
    return `core_${hash}`;
  }

  /**
   * Add an entity to the core
   */
  addEntity(entity) {
    this.entities.push({
      ...entity,
      _coreId: this.coreId,
      _addedAt: new Date().toISOString(),
    });
    this.isModified = true;
    return this;
  }

  /**
   * Add a memory entry to the core
   */
  addMemory(memory) {
    this.memories.push({
      ...memory,
      _coreId: this.coreId,
      _addedAt: new Date().toISOString(),
    });
    this.isModified = true;
    return this;
  }

  /**
   * Add a knowledge triple to the core
   */
  addTriple(subject, predicate, object, metadata = {}) {
    this.triples.push({
      subject,
      predicate,
      object,
      confidence: metadata.confidence || 0.7,
      source: metadata.source || 'core_added',
      _coreId: this.coreId,
      _addedAt: new Date().toISOString(),
    });
    this.isModified = true;
    return this;
  }

  /**
   * Add an ontology entry (schema definition)
   */
  addOntology(ontology) {
    this.ontology.push({
      ...ontology,
      _coreId: this.coreId,
      _addedAt: new Date().toISOString(),
    });
    this.isModified = true;
    return this;
  }

  /**
   * Set retrieval policies
   */
  setPolicies(policies) {
    this.policies = {
      ...this.policies,
      ...policies,
      _updatedAt: new Date().toISOString(),
    };
    this.isModified = true;
    return this;
  }

  /**
   * Export core to JSON (for file saving)
   */
  toJSON() {
    return {
      version: this.version,
      coreId: this.coreId,
      name: this.name,
      domain: this.domain,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      description: this.description,
      ontology: this.ontology,
      entities: this.entities,
      triples: this.triples,
      memories: this.memories,
      policies: this.policies,
      provenance: this.provenance,
      metadata: this.metadata,
    };
  }

  /**
   * Get core as string (for file writing)
   */
  toString() {
    return JSON.stringify(this.toJSON(), null, 2);
  }

  /**
   * Get size in bytes (approximate)
   */
  getSize() {
    return Buffer.byteLength(this.toString(), 'utf8');
  }

  /**
   * Get content summary
   */
  getSummary() {
    return {
      coreId: this.coreId,
      name: this.name,
      domain: this.domain,
      size: this.getSize(),
      counts: {
        entities: this.entities.length,
        triples: this.triples.length,
        memories: this.memories.length,
        ontology: this.ontology.length,
      },
      createdAt: this.createdAt,
      isLoaded: this.isLoaded,
      isModified: this.isModified,
    };
  }

  /**
   * Export core to file
   */
  async export(filepath = null) {
    const filename = filepath || `${this.name.replace(/[^a-z0-9]/gi, '_')}_${this.coreId}.core.json`;
    const filepath_abs = filepath || join(CORES_DIR, filename);

    if (!existsSync(dirname(filepath_abs))) {
      mkdirSync(dirname(filepath_abs), { recursive: true });
    }

    writeFileSync(filepath_abs, this.toString(), 'utf8');
    this.isModified = false;

    return {
      filepath: filepath_abs,
      size: this.getSize(),
      coreId: this.coreId,
    };
  }

  /**
   * Load core from file
   */
  static async load(filepath) {
    if (!existsSync(filepath)) {
      throw new Error(`Core file not found: ${filepath}`);
    }

    const content = readFileSync(filepath, 'utf8');
    const data = JSON.parse(content);

    const core = new ContextCore({
      coreId: data.coreId,
      name: data.name,
      domain: data.domain,
      createdAt: data.createdAt,
      description: data.description,
      metadata: data.metadata,
    });

    core.updatedAt = data.updatedAt;
    core.ontology = data.ontology || [];
    core.entities = data.entities || [];
    core.triples = data.triples || [];
    core.memories = data.memories || [];
    core.policies = data.policies || {};
    core.provenance = data.provenance || [];
    core.isModified = false;

    return core;
  }

  /**
   * List all available cores
   */
  static listCores(options = {}) {
    const { domain = null, includeContent = false } = options;

    if (!existsSync(CORES_DIR)) {
      return [];
    }

    const { readdirSync, statSync } = require('fs');
    const files = readdirSync(CORES_DIR).filter(f => f.endsWith('.core.json'));

    const cores = [];
    for (const file of files) {
      try {
        const filepath = join(CORES_DIR, file);
        const stat = statSync(filepath);
        const content = readFileSync(filepath, 'utf8');
        const data = JSON.parse(content);

        if (domain && data.domain !== domain) continue;

        const summary = {
          coreId: data.coreId,
          name: data.name,
          domain: data.domain,
          size: stat.size,
          createdAt: data.createdAt,
          updatedAt: data.updatedAt,
          entities: (data.entities || []).length,
          triples: (data.triples || []).length,
          memories: (data.memories || []).length,
        };

        if (includeContent) {
          summary.data = data;
        }

        cores.push(summary);
      } catch { /* skip invalid files */ }
    }

    return cores.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  }

  /**
   * Create a new core from existing memory/graph data
   */
  static async createFromData(name, domain, data, options = {}) {
    const core = new ContextCore({
      name,
      domain,
      description: options.description || '',
      metadata: options.metadata || {},
    });

    if (data.entities) {
      for (const entity of data.entities) {
        core.addEntity(entity);
      }
    }

    if (data.triples) {
      for (const triple of data.triples) {
        core.addTriple(triple.subject, triple.predicate, triple.object, {
          confidence: triple.confidence,
          source: triple.source,
        });
      }
    }

    if (data.memories) {
      for (const memory of data.memories) {
        core.addMemory(memory);
      }
    }

    if (data.ontology) {
      for (const ont of data.ontology) {
        core.addOntology(ont);
      }
    }

    if (data.policies) {
      core.setPolicies(data.policies);
    }

    return core;
  }

  /**
   * Merge multiple cores into one
   */
  static merge(cores, name, options = {}) {
    const merged = new ContextCore({
      name: name || 'merged',
      domain: options.domain || CoreDomain.ALL,
      description: options.description || `Merged from ${cores.length} cores`,
      metadata: { mergedFrom: cores.map(c => c.coreId) },
    });

    for (const core of cores) {
      merged.entities.push(...core.entities);
      merged.triples.push(...core.triples);
      merged.memories.push(...core.memories);
      merged.ontology.push(...core.ontology);
      merged.provenance.push(...core.provenance);
    }

    // Deduplicate entities by name
    const seenEntities = new Set();
    merged.entities = merged.entities.filter(e => {
      const key = `${e.name}:${e.type}`;
      if (seenEntities.has(key)) return false;
      seenEntities.add(key);
      return true;
    });

    return merged;
  }
}

export default {
  ContextCore,
  CoreDomain,
};
