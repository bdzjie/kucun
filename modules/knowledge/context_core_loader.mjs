/**
 * context_core_loader.mjs
 * 
 * Runtime Context Core Loader
 * 
 * Automatically loads relevant Context Cores based on:
 * 1. Current working directory / project context
 * 2. Recent file access patterns
 * 3. Active session topic
 * 
 * And unloads cores when switching projects.
 * 
 * Usage:
 *   const loader = new ContextCoreLoader()
 *   await loader.start()
 *   
 *   // Changes to a new project directory
 *   await loader.onProjectChange('/path/to/new/project')
 *   
 *   // Get currently loaded context
 *   const context = loader.getLoadedContext()
 */

import { existsSync, readFileSync, watch, watchFile, unwatchFile } from 'fs';
import { join, dirname, basename } from 'path';
import { homedir } from 'os';
import { ContextCore, CoreDomain } from './context_core.mjs';
import { getKnowledgeGraph } from './memory_graph.mjs';
import { getFeedbackStore } from './memory_feedback.mjs';

const LOADER_STATE_FILE = join(homedir(), '.openclaw', 'memory', 'cores', 'loader_state.json');

/**
 * Project fingerprint — identifies a project by its key files
 */
export class ProjectFingerprint {
  constructor(path) {
    this.path = path;
    this.keyFiles = [
      'package.json',
      'requirements.txt',
      'Cargo.toml',
      'go.mod',
      'pyproject.toml',
      '.git',
      'SKILL.md',
      'skill.yaml',
      '.openclaw',
      'MEMORY.md',
      '*.code-workspace',
      'Makefile',
      'Dockerfile',
      'docker-compose.yml',
    ];
    this.fingerprint = null;
  }

  /**
   * Generate a fingerprint based on present key files
   */
  generate() {
    const present = [];
    
    for (const pattern of this.keyFiles) {
      if (pattern.startsWith('*.')) {
        // Extension pattern
        const ext = pattern.slice(1);
        const { readdirSync } = require('fs');
        try {
          const files = readdirSync(this.path);
          present.push(...files.filter(f => f.endsWith(ext)));
        } catch { /* skip */ }
      } else {
        if (existsSync(join(this.path, pattern))) {
          present.push(pattern);
        }
      }
    }

    this.fingerprint = present.sort().join('|');
    return this.fingerprint;
  }

  /**
   * Match a fingerprint to known project cores
   */
  match(knownFingerprints) {
    if (!this.fingerprint) this.generate();

    for (const { fingerprint, coreId } of knownFingerprints) {
      if (this.fingerprint === fingerprint) {
        return { match: true, coreId, fingerprint };
      }
    }

    // Partial match — check overlap
    let bestScore = 0;
    let bestCoreId = null;

    for (const { fingerprint, coreId } of knownFingerprints) {
      const a = new Set(this.fingerprint.split('|'));
      const b = new Set(fingerprint.split('|'));
      const intersection = [...a].filter(x => b.has(x));
      const score = intersection.length / Math.max(a.size, b.size);
      
      if (score > 0.5 && score > bestScore) {
        bestScore = score;
        bestCoreId = coreId;
      }
    }

    if (bestCoreId) {
      return { match: true, coreId: bestCoreId, score: bestScore, partial: true };
    }

    return { match: false };
  }
}

/**
 * ContextCoreLoader — runtime core loading/unloading
 */
export class ContextCoreLoader {
  constructor(options = {}) {
    this.stateFile = options.stateFile || LOADER_STATE_FILE;
    this.pollInterval = options.pollInterval || 5000; // 5 seconds
    this.autoDetectInterval = options.autoDetectInterval || 30000; // 30 seconds
    
    this.state = {
      currentCores: [], // Currently loaded core IDs
      currentProject: null,
      currentProjectFingerprint: null,
      lastProjectCheck: null,
      autoLoaded: false,
    };

    this.graph = getKnowledgeGraph();
    this.feedback = getFeedbackStore();
    
    this.loadedCores = new Map(); // coreId → ContextCore instance
    this.entityIndex = new Map(); // entityName → coreId (for fast lookup)
    this.intervalHandle = null;
  }

  /**
   * Load state from disk
   */
  loadState() {
    if (existsSync(this.stateFile)) {
      try {
        const data = JSON.parse(readFileSync(this.stateFile, 'utf8'));
        this.state = { ...this.state, ...data };
      } catch { /* ignore */ }
    }
  }

  /**
   * Save state to disk
   */
  saveState() {
    const dir = dirname(this.stateFile);
    if (!existsSync(dir)) {
      require('fs').mkdirSync(dir, { recursive: true });
    }
    require('fs').writeFileSync(this.stateFile, JSON.stringify(this.state, null, 2), 'utf8');
  }

  /**
   * Start the loader
   */
  async start() {
    this.loadState();
    
    // Start polling for project changes
    this.intervalHandle = setInterval(() => {
      this.checkForProjectChange();
    }, this.pollInterval);

    console.log('[ContextCoreLoader] Started');
    return this;
  }

  /**
   * Stop the loader
   */
  stop() {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
    this.saveState();
    console.log('[ContextCoreLoader] Stopped');
  }

  /**
   * Check for project directory change
   */
  checkForProjectChange() {
    const cwd = process.cwd();
    
    if (cwd !== this.state.currentProject) {
      this.onProjectChange(cwd);
    }
  }

  /**
   * Called when project directory changes
   */
  async onProjectChange(newPath) {
    const oldProject = this.state.currentProject;
    
    // Generate new fingerprint
    const fp = new ProjectFingerprint(newPath);
    const fingerprint = fp.generate();
    
    // Check if this is a new/unseen project
    if (fingerprint === this.state.currentProjectFingerprint) {
      return; // Same project, no change needed
    }

    console.log(`[ContextCoreLoader] Project change detected: ${oldProject} → ${newPath}`);
    console.log(`[ContextCoreLoader] Fingerprint: ${fingerprint.slice(0, 50)}...`);

    // Unload old cores
    await this.unloadCurrentCores();

    // Find matching core
    const match = fp.match(this.getKnownProjectCores());

    if (match.match) {
      console.log(`[ContextCoreLoader] Found matching core: ${match.coreId}`);
      await this.loadCore(match.coreId);
      this.state.autoLoaded = true;
    } else {
      console.log(`[ContextCoreLoader] No matching core found, loading defaults`);
      await this.loadDefaultCores();
      this.state.autoLoaded = false;
    }

    this.state.currentProject = newPath;
    this.state.currentProjectFingerprint = fingerprint;
    this.state.lastProjectCheck = new Date().toISOString();
    this.saveState();
  }

  /**
   * Get list of known project cores from disk
   */
  getKnownProjectCores() {
    const cores = ContextCore.listCores({ domain: CoreDomain.PROJECT });
    
    return cores.map(core => {
      // Generate fingerprint from core's metadata
      const meta = core.data?.metadata || {};
      const fingerprint = (meta.fingerprint || core.name + '|' + core.domain);
      return { coreId: core.coreId, fingerprint };
    });
  }

  /**
   * Load a specific core
   */
  async loadCore(coreId) {
    const cores = ContextCore.listCores({ includeContent: true });
    const coreData = cores.find(c => c.coreId === coreId);
    
    if (!coreData) {
      console.warn(`[ContextCoreLoader] Core not found: ${coreId}`);
      return false;
    }

    const core = await ContextCore.load(
      join(homedir(), '.openclaw', 'memory', 'cores', `${coreData.name}_${coreId}.core.json`)
    );

    // Load entities into graph
    for (const entity of core.entities) {
      this.graph.addEntity(entity);
      this.entityIndex.set(entity.name.toLowerCase(), coreId);
    }

    // Load triples into graph
    for (const triple of core.triples) {
      this.graph.addTriple(triple.subject, triple.predicate, triple.object, {
        confidence: triple.confidence,
        source: `core:${coreId}`,
      });
    }

    // Track loaded core
    this.loadedCores.set(coreId, core);
    this.state.currentCores.push(coreId);
    this.state.currentCores = [...new Set(this.state.currentCores)]; // Dedupe

    console.log(`[ContextCoreLoader] Loaded core: ${core.name} (${core.coreId})`);
    console.log(`[ContextCoreLoader]   Entities: ${core.entities.length}`);
    console.log(`[ContextCoreLoader]   Triples: ${core.triples.length}`);
    console.log(`[ContextCoreLoader]   Memories: ${core.memories.length}`);

    return true;
  }

  /**
   * Unload all currently loaded cores
   */
  async unloadCurrentCores() {
    for (const coreId of this.state.currentCores) {
      await this.unloadCore(coreId);
    }
    this.state.currentCores = [];
  }

  /**
   * Unload a specific core
   */
  async unloadCore(coreId) {
    const core = this.loadedCores.get(coreId);
    if (!core) return;

    // Remove entities from index
    for (const entity of core.entities) {
      this.entityIndex.delete(entity.name.toLowerCase());
    }

    // Remove from loaded map
    this.loadedCores.delete(coreId);

    console.log(`[ContextCoreLoader] Unloaded core: ${core.name} (${core.coreId})`);
  }

  /**
   * Load default cores (persona, general memory)
   */
  async loadDefaultCores() {
    const allCores = ContextCore.listCores();
    
    const defaults = allCores.filter(c => 
      c.domain === CoreDomain.PERSONA || 
      c.domain === CoreDomain.MEMORY ||
      c.domain === CoreDomain.ALL
    );

    for (const core of defaults.slice(0, 3)) { // Load max 3 default cores
      if (!this.loadedCores.has(core.coreId)) {
        await this.loadCore(core.coreId);
      }
    }
  }

  /**
   * Get currently loaded context (entities + triples)
   */
  getLoadedContext() {
    const entities = [];
    const triples = [];
    const memories = [];

    for (const core of this.loadedCores.values()) {
      entities.push(...core.entities);
      triples.push(...core.triples);
      memories.push(...core.memories);
    }

    return {
      cores: this.state.currentCores,
      project: this.state.currentProject,
      autoLoaded: this.state.autoLoaded,
      entities,
      triples,
      memories,
      stats: {
        totalEntities: entities.length,
        totalTriples: triples.length,
        totalMemories: memories.length,
        totalCores: this.loadedCores.size,
      },
    };
  }

  /**
   * Find entities relevant to current context
   */
  findRelevantEntities(query, limit = 5) {
    const context = this.getLoadedContext();
    const results = [];

    // Score entities by keyword match
    const queryWords = query.toLowerCase().split(/\s+/);
    
    for (const entity of context.entities) {
      let score = 0;
      const nameLower = entity.name.toLowerCase();
      const descLower = (entity.description || '').toLowerCase();

      for (const word of queryWords) {
        if (nameLower.includes(word)) score += 2;
        if (descLower.includes(word)) score += 1;
      }

      // Boost by feedback weight
      const weight = this.feedback.getWeight(entity.id);
      score *= (1 + weight / 2);

      if (score > 0) {
        results.push({ entity, score });
      }
    }

    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(r => r.entity);
  }

  /**
   * Get current state summary
   */
  getState() {
    return {
      currentProject: this.state.currentProject,
      currentProjectFingerprint: this.state.currentProjectFingerprint?.slice(0, 30),
      loadedCores: this.state.currentCores,
      autoLoaded: this.state.autoLoaded,
      totalLoadedCores: this.loadedCores.size,
    };
  }
}

// Singleton
let _loader = null;

export function getContextCoreLoader() {
  if (!_loader) {
    _loader = new ContextCoreLoader();
  }
  return _loader;
}

export default {
  ProjectFingerprint,
  ContextCoreLoader,
  getContextCoreLoader,
};
