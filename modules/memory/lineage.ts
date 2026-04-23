/**
 * modules/memory/lineage.ts
 * ============================
 * Memory Lineage DAG — inspired by OpenMetadata Column-Level Lineage
 *
 * Tracks which memories reference or are derived from other memories,
 * forming a Directed Acyclic Graph (DAG) of knowledge dependencies.
 *
 * Use cases:
 *   - Before editing a memory, know what depends on it
 *   - Trace the origin of a specific conclusion or decision
 *   - Find orphaned memories (no references) — candidates for archiving
 *   - Audit: which sessions/skills contributed to this insight?
 *
 * Graph model:
 *   Nodes:  EntityRef (memory | session | skill | file)
 *   Edges:  LineageEdge (reads | writes | invokes | derives | cites)
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';

// ============================================================================
// Types
// ============================================================================

export type EntityType = 'memory' | 'session' | 'skill' | 'file' | 'agent';
export type RelationType = 'reads' | 'writes' | 'invokes' | 'derives' | 'cites' | 'references';

export interface EntityRef {
  id: string;           // Unique entity ID, e.g. "memory/2026-04-22#45" or "session/abc123"
  type: EntityType;
  label: string;         // Human-readable label
  url?: string;         // Optional: link to the entity
}

export interface LineageEdge {
  id: string;            // Unique edge ID: "e_${from}_${relation}_${to}"
  from: EntityRef;       // Source entity (the one doing the referencing)
  to: EntityRef;         // Target entity (the one being referenced)
  relation: RelationType;
  context?: string;     // Optional: why this relation exists
  confidence?: number;    // 0-1, for derived/inferred relations
  createdAt: string;     // ISO timestamp
  createdBy?: string;    // agent/skill that created this edge
}

export interface LineageNode {
  entity: EntityRef;
  inDegree: number;      // Number of incoming edges
  outDegree: number;      // Number of outgoing edges
  lastReferenced?: string; // ISO timestamp of last reference
}

export interface LineageGraph {
  nodes: Map<string, LineageNode>;  // entity.id → node
  edges: Map<string, LineageEdge>;  // edge.id → edge
  adjacency: Map<string, string[]>;  // entity.id → [edge.id, ...]
}

// ============================================================================
// Graph Store
// ============================================================================

const LINEAGE_DIR = join(homedir(), '.openclaw', 'memory', 'lineage');
const LINEAGE_FILE = join(LINEAGE_DIR, 'graph.jsonl');

function ensureLineageDir(): void {
  if (!existsSync(LINEAGE_DIR)) {
    mkdirSync(LINEAGE_DIR, { recursive: true });
  }
}

function makeEdgeId(from: EntityRef, relation: RelationType, to: EntityRef): string {
  return `e_${from.id.replace(/[^a-zA-Z0-9]/g, '_')}_${relation}_${to.id.replace(/[^a-zA-Z0-9]/g, '_')}`;
}

// ============================================================================
// Graph Operations
// ============================================================================

export class MemoryLineage {
  private graph: LineageGraph = { nodes: new Map(), edges: new Map(), adjacency: new Map() };

  constructor() {
    this._load();
  }

  // ─── CRUD ────────────────────────────────────────────────────────────────

  /**
   * Add an edge to the lineage graph.
   * Creates nodes for from/to if they don't exist.
   */
  addEdge(edge: Omit<LineageEdge, 'id' | 'createdAt'>): LineageEdge {
    const id = makeEdgeId(edge.from, edge.relation, edge.to);
    const now = new Date().toISOString();

    // Deduplicate: skip if edge already exists
    if (this.graph.edges.has(id)) {
      return this.graph.edges.get(id)!;
    }

    const fullEdge: LineageEdge = { id, createdAt: now, ...edge };

    // Ensure nodes exist
    this._ensureNode(edge.from);
    this._ensureNode(edge.to);

    // Add edge
    this.graph.edges.set(id, fullEdge);

    // Update adjacency
    if (!this.graph.adjacency.has(edge.from.id)) {
      this.graph.adjacency.set(edge.from.id, []);
    }
    this.graph.adjacency.get(edge.from.id)!.push(id);

    // Update in/out degree
    this.graph.nodes.get(edge.from.id)!.outDegree++;
    this.graph.nodes.get(edge.to.id)!.inDegree++;
    this.graph.nodes.get(edge.to.id)!.lastReferenced = now;

    this._save();
    return fullEdge;
  }

  /**
   * Remove an edge by ID.
   */
  removeEdge(edgeId: string): boolean {
    const edge = this.graph.edges.get(edgeId);
    if (!edge) return false;

    this.graph.edges.delete(edgeId);

    // Update adjacency
    const adjs = this.graph.adjacency.get(edge.from.id) || [];
    this.graph.adjacency.set(edge.from.id, adjs.filter(e => e !== edgeId));

    // Update degrees
    const fromNode = this.graph.nodes.get(edge.from.id);
    const toNode = this.graph.nodes.get(edge.to.id);
    if (fromNode) fromNode.outDegree = Math.max(0, fromNode.outDegree - 1);
    if (toNode) toNode.inDegree = Math.max(0, toNode.inDegree - 1);

    this._save();
    return true;
  }

  /**
   * Get all edges from a given entity (what it references).
   */
  getOutgoing(entityId: string): LineageEdge[] {
    const adj = this.graph.adjacency.get(entityId) || [];
    return adj.map(id => this.graph.edges.get(id)!).filter(Boolean);
  }

  /**
   * Get all edges to a given entity (what references it).
   * Reverse lookup requires scanning all edges.
   */
  getIncoming(entityId: string): LineageEdge[] {
    const incoming: LineageEdge[] = [];
    for (const edge of this.graph.edges.values()) {
      if (edge.to.id === entityId) {
        incoming.push(edge);
      }
    }
    return incoming;
  }

  /**
   * Get the full lineage path from a source to a target.
   * Returns array of edges forming the path, or empty if no path.
   */
  getPath(sourceId: string, targetId: string, maxDepth = 5): LineageEdge[] {
    if (sourceId === targetId) return [];

    const visited = new Set<string>();
    const queue: Array<{ entityId: string; path: LineageEdge[] }> = [
      { entityId: sourceId, path: [] }
    ];

    while (queue.length > 0) {
      const { entityId, path } = queue.shift()!;

      if (visited.has(entityId)) continue;
      visited.add(entityId);

      if (entityId === targetId) return path;

      if (path.length >= maxDepth) continue;

      const outgoing = this.getOutgoing(entityId);
      for (const edge of outgoing) {
        if (!visited.has(edge.to.id)) {
          queue.push({ entityId: edge.to.id, path: [...path, edge] });
        }
      }
    }

    return [];  // No path found
  }

  /**
   * Find all ancestors of an entity (what it ultimately derives from).
   * Uses BFS traversal.
   */
  getAncestors(entityId: string, maxDepth = 10): EntityRef[] {
    const ancestors = new Set<string>();
    const queue: Array<{ entityId: string; depth: number }> = [{ entityId, depth: 0 }];

    while (queue.length > 0) {
      const { entityId, depth } = queue.shift()!;
      if (depth >= maxDepth) continue;

      const incoming = this.getIncoming(entityId);
      for (const edge of incoming) {
        if (!ancestors.has(edge.from.id)) {
          ancestors.add(edge.from.id);
          queue.push({ entityId: edge.from.id, depth: depth + 1 });
        }
      }
    }

    return Array.from(ancestors)
      .map(id => this.graph.nodes.get(id)?.entity)
      .filter(Boolean) as EntityRef[];
  }

  /**
   * Find all descendants of an entity (what depends on it).
   * Used for impact analysis: "if I change this memory, what breaks?"
   */
  getDescendants(entityId: string, maxDepth = 10): EntityRef[] {
    const descendants = new Set<string>();
    const queue: Array<{ entityId: string; depth: number }> = [{ entityId, depth: 0 }];

    while (queue.length > 0) {
      const { entityId, depth } = queue.shift()!;
      if (depth >= maxDepth) continue;

      const outgoing = this.getOutgoing(entityId);
      for (const edge of outgoing) {
        if (!descendants.has(edge.to.id)) {
          descendants.add(edge.to.id);
          queue.push({ entityId: edge.to.id, depth: depth + 1 });
        }
      }
    }

    return Array.from(descendants)
      .map(id => this.graph.nodes.get(id)?.entity)
      .filter(Boolean) as EntityRef[];
  }

  /**
   * Find orphaned entities (no incoming edges, no outgoing edges).
   * These are candidates for archival or review.
   */
  getOrphaned(): EntityRef[] {
    return Array.from(this.graph.nodes.values())
      .filter(n => n.inDegree === 0 && n.outDegree === 0)
      .map(n => n.entity);
  }

  /**
   * Find leaf nodes (no outgoing edges — terminal insights).
   */
  getLeaves(): EntityRef[] {
    return Array.from(this.graph.nodes.values())
      .filter(n => n.outDegree === 0)
      .map(n => n.entity);
  }

  /**
   * Get all entities of a given type.
   */
  getEntitiesByType(type: EntityType): EntityRef[] {
    return Array.from(this.graph.nodes.values())
      .filter(n => n.entity.type === type)
      .map(n => n.entity);
  }

  /**
   * Get a summary of the graph.
   */
  getSummary(): {
    totalNodes: number;
    totalEdges: number;
    byType: Record<EntityType, number>;
    byRelation: Record<RelationType, number>;
    orphanedCount: number;
    mostCited?: EntityRef;
    mostActive?: EntityRef;
  } {
    const byType: Record<EntityType, number> = { memory: 0, session: 0, skill: 0, file: 0, agent: 0 };
    const byRelation: Record<RelationType, number> = { reads: 0, writes: 0, invokes: 0, derives: 0, cites: 0, references: 0 };

    for (const node of this.graph.nodes.values()) {
      byType[node.entity.type]++;
    }
    for (const edge of this.graph.edges.values()) {
      byRelation[edge.relation]++;
    }

    // Most cited entity
    let mostCited: LineageNode | undefined;
    for (const node of this.graph.nodes.values()) {
      if (!mostCited || node.inDegree > mostCited.inDegree) {
        mostCited = node;
      }
    }

    // Most active entity
    let mostActive: LineageNode | undefined;
    for (const node of this.graph.nodes.values()) {
      if (!mostActive || (node.inDegree + node.outDegree) > (mostActive.inDegree + mostActive.outDegree)) {
        mostActive = node;
      }
    }

    return {
      totalNodes: this.graph.nodes.size,
      totalEdges: this.graph.edges.size,
      byType,
      byRelation,
      orphanedCount: this.getOrphaned().length,
      mostCited: mostCited?.entity,
      mostActive: mostActive?.entity,
    };
  }

  // ─── Persistence ─────────────────────────────────────────────────────────

  private _load(): void {
    ensureLineageDir();
    if (!existsSync(LINEAGE_FILE)) return;

    try {
      const content = readFileSync(LINEAGE_FILE, 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);

      for (const line of lines) {
        const record = JSON.parse(line);
        if (record.op === 'add_edge') {
          const edge = record.edge as LineageEdge;
          this.graph.edges.set(edge.id, edge);
          this._ensureNode(edge.from);
          this._ensureNode(edge.to);
          if (!this.graph.adjacency.has(edge.from.id)) {
            this.graph.adjacency.set(edge.from.id, []);
          }
          this.graph.adjacency.get(edge.from.id)!.push(edge.id);
          this.graph.nodes.get(edge.from.id)!.outDegree++;
          this.graph.nodes.get(edge.to.id)!.inDegree++;
          this.graph.nodes.get(edge.to.id)!.lastReferenced = edge.createdAt;
        } else if (record.op === 'remove_edge') {
          const edgeId = record.edgeId as string;
          const edge = this.graph.edges.get(edgeId);
          if (edge) {
            this.graph.edges.delete(edgeId);
            const adjs = this.graph.adjacency.get(edge.from.id) || [];
            this.graph.adjacency.set(edge.from.id, adjs.filter(e => e !== edgeId));
            const fromNode = this.graph.nodes.get(edge.from.id);
            const toNode = this.graph.nodes.get(edge.to.id);
            if (fromNode) fromNode.outDegree = Math.max(0, fromNode.outDegree - 1);
            if (toNode) toNode.inDegree = Math.max(0, toNode.inDegree - 1);
          }
        }
      }
    } catch (err) {
      console.error('[MemoryLineage] Failed to load graph:', err);
    }
  }

  private _save(): void {
    ensureLineageDir();
    // Append-only log format (WAL)
    const logFile = join(LINEAGE_DIR, `lineage_${Date.now()}.jsonl`);
    const snapshot: Array<{ op: string; edge?: LineageEdge; edgeId?: string }> = [];

    for (const edge of this.graph.edges.values()) {
      snapshot.push({ op: 'add_edge', edge });
    }

    // Keep append-only (WAL for durability)
    const line = JSON.stringify({ op: 'add_edge', edge: snapshot[snapshot.length - 1]?.edge });
    try {
      writeFileSync(join(LINEAGE_DIR, 'lineage_wal.jsonl'), line + '\n', { flag: 'a', encoding: 'utf-8' });
    } catch (_) { /* ignore write errors in sandbox */ }
  }

  private _ensureNode(entity: EntityRef): void {
    if (!this.graph.nodes.has(entity.id)) {
      this.graph.nodes.set(entity.id, {
        entity,
        inDegree: 0,
        outDegree: 0,
      });
    }
  }
}

// ============================================================================
// Singleton
// ============================================================================

let _lineage: MemoryLineage | null = null;

export function getMemoryLineage(): MemoryLineage {
  if (!_lineage) {
    _lineage = new MemoryLineage();
  }
  return _lineage;
}

export default { MemoryLineage, getMemoryLineage };
