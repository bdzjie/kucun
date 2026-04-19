/**
 * knowledge_graph.mjs
 * 
 * Knowledge graph for tracking relationships between notes, entities, and concepts.
 * Inspired by: agent-second-brain graph-builder skill
 * 
 * Builds a graph from wiki-links and entity extractions,
 * enables graph traversal for finding related concepts.
 */

import { existsSync, readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, appendFileSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';

/**
 * @typedef {Object} GraphNode
 * @property {string} id — unique node ID
 * @property {string} name — display name
 * @property {string} type — 'note' | 'person' | 'project' | 'concept' | 'tag'
 * @property {string[]} aliases — alternative names
 * @property {string[]} tags — associated tags
 * @property {string[]} links — outgoing link IDs
 * @property {number} incomingCount — number of notes linking to this
 * @property {number} createdAt
 * @property {number} lastSeen
 */

/**
 * @typedef {Object} GraphEdge
 * @property {string} from — source node ID
 * @property {string} to — target node ID
 * @property {string} type — 'links' | 'mentions' | 'related' | 'part-of'
 * @property {number} weight — edge weight (0-1)
 * @property {number} lastSeen
 */

const GRAPH_DIR = join(homedir(), '.openclaw', 'memory', 'knowledge_graph');
const GRAPH_FILE = join(GRAPH_DIR, 'graph.jsonl');

/**
 * Extract wiki-links from content
 */
function extractLinks(content) {
  const regex = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
  const links = [];
  let match;
  while ((match = regex.exec(content)) !== null) {
    links.push(match[1].trim());
  }
  return links;
}

/**
 * Extract #tags from content
 */
function extractTags(content) {
  const regex = /#([a-zA-Z][a-zA-Z0-9_-]+)/g;
  const tags = [];
  let match;
  while ((match = regex.exec(content)) !== null) {
    tags.push(match[1].toLowerCase());
  }
  return [...new Set(tags)];
}

/**
 * Extract potential entity names (capitalized phrases)
 */
function extractEntities(content) {
  const regex = /\b([A-Z][a-z]+(?: [A-Z][a-z]+)*)\b/g;
  const entities = [];
  let match;
  while ((match = regex.exec(content)) !== null) {
    if (match[1].length > 3 && !['The', 'This', 'That', 'There', 'When', 'What', 'Where', 'How', 'Why'].includes(match[1])) {
      entities.push(match[1]);
    }
  }
  return [...new Set(entities)];
}

/**
 * Build graph from a directory of markdown notes
 */
export function buildGraphFromVault(vaultPath) {
  const nodes = new Map();
  const edges = [];
  
  function processFile(filePath, content) {
    const name = filePath.replace(/\\/g, '/').split('/').pop().replace('.md', '');
    const id = name.toLowerCase().replace(/\s+/g, '-');
    
    const links = extractLinks(content);
    const tags = extractTags(content);
    const entities = extractEntities(content);
    
    // Create/update node
    const existing = nodes.get(id);
    if (existing) {
      existing.links = [...new Set([...existing.links, ...links])];
      existing.tags = [...new Set([...existing.tags, ...tags])];
      existing.lastSeen = Date.now();
    } else {
      nodes.set(id, {
        id,
        name,
        type: 'note',
        aliases: [],
        tags,
        links: [...new Set(links)],
        incomingCount: 0,
        createdAt: Date.now(),
        lastSeen: Date.now(),
      });
    }
    
    // Create edges for links
    for (const linkTarget of links) {
      const targetId = linkTarget.toLowerCase().replace(/\s+/g, '-');
      
      // Ensure target node exists
      if (!nodes.has(targetId)) {
        nodes.set(targetId, {
          id: targetId,
          name: linkTarget,
          type: 'note',
          aliases: [],
          tags: [],
          links: [],
          incomingCount: 0,
          createdAt: Date.now(),
          lastSeen: Date.now(),
        });
      }
      
      edges.push({
        from: id,
        to: targetId,
        type: 'links',
        weight: 1.0,
        lastSeen: Date.now(),
      });
    }
    
    // Create edges for tags
    for (const tag of tags) {
      const tagId = `tag_${tag}`;
      
      if (!nodes.has(tagId)) {
        nodes.set(tagId, {
          id: tagId,
          name: `#${tag}`,
          type: 'tag',
          aliases: [],
          tags: [],
          links: [],
          incomingCount: 0,
          createdAt: Date.now(),
          lastSeen: Date.now(),
        });
      }
      
      edges.push({
        from: id,
        to: tagId,
        type: 'related',
        weight: 0.5,
        lastSeen: Date.now(),
      });
    }
    
    // Create nodes for entities
    for (const entity of entities) {
      const entityId = `entity_${entity.toLowerCase().replace(/\s+/g, '-')}`;
      
      if (!nodes.has(entityId)) {
        nodes.set(entityId, {
          id: entityId,
          name: entity,
          type: 'concept',
          aliases: [],
          tags: [],
          links: [],
          incomingCount: 0,
          createdAt: Date.now(),
          lastSeen: Date.now(),
        });
      }
      
      edges.push({
        from: id,
        to: entityId,
        type: 'mentions',
        weight: 0.3,
        lastSeen: Date.now(),
      });
    }
  }
  
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
          processFile(fullPath, content);
        }
      } catch (e) {
        // Skip errors
      }
    }
  }
  
  scanDir(vaultPath);
  
  // Count incoming links
  for (const edge of edges) {
    if (edge.type === 'links') {
      const target = nodes.get(edge.to);
      if (target) {
        target.incomingCount = (target.incomingCount || 0) + 1;
      }
    }
  }
  
  return {
    nodes: Array.from(nodes.values()),
    edges,
  };
}

/**
 * Find connected nodes via graph traversal
 */
export function findConnected(graph, nodeId, options = {}) {
  const maxDepth = options.maxDepth || 2;
  const includeTypes = options.includeTypes || null;
  
  const visited = new Set();
  const result = [];
  const queue = [[nodeId, 0]];
  
  while (queue.length > 0) {
    const [currentId, depth] = queue.shift();
    
    if (visited.has(currentId)) continue;
    visited.add(currentId);
    
    const node = graph.nodes.find(n => n.id === currentId);
    if (node) {
      if (!includeTypes || includeTypes.includes(node.type)) {
        result.push({ ...node, depth });
      }
    }
    
    if (depth < maxDepth) {
      const outgoing = graph.edges.filter(e => e.from === currentId);
      for (const edge of outgoing) {
        if (!visited.has(edge.to)) {
          queue.push([edge.to, depth + 1]);
        }
      }
    }
  }
  
  return result;
}

/**
 * Find hub nodes (high connectivity)
 */
export function findHubs(graph, options = {}) {
  const minIncoming = options.minIncoming || 5;
  
  return graph.nodes
    .filter(n => n.incomingCount >= minIncoming && n.type === 'note')
    .sort((a, b) => b.incomingCount - a.incomingCount);
}

/**
 * Find clusters (notes that are heavily interconnected)
 */
export function findClusters(graph, options = {}) {
  const minConnections = options.minConnections || 3;
  
  // Build adjacency map
  const adjacency = new Map();
  for (const edge of graph.edges) {
    if (edge.type !== 'links') continue;
    
    if (!adjacency.has(edge.from)) adjacency.set(edge.from, new Set());
    if (!adjacency.has(edge.to)) adjacency.set(edge.to, new Set());
    
    adjacency.get(edge.from).add(edge.to);
    adjacency.get(edge.to).add(edge.from);
  }
  
  const visited = new Set();
  const clusters = [];
  
  for (const [nodeId] of adjacency) {
    if (visited.has(nodeId)) continue;
    
    const cluster = [];
    const queue = [nodeId];
    
    while (queue.length > 0) {
      const current = queue.shift();
      if (visited.has(current)) continue;
      visited.add(current);
      
      const connections = adjacency.get(current) || new Set();
      if (connections.size >= minConnections) {
        cluster.push(current);
        
        for (const neighbor of connections) {
          if (!visited.has(neighbor)) {
            queue.push(neighbor);
          }
        }
      }
    }
    
    if (cluster.length > 0) {
      clusters.push(cluster.map(id => {
        const node = graph.nodes.find(n => n.id === id);
        return node ? node.name : id;
      }));
    }
  }
  
  return clusters;
}

/**
 * KnowledgeGraph class for persistence
 */
export class KnowledgeGraph {
  constructor() {
    this.graph = { nodes: [], edges: [] };
    this.load();
  }
  
  load() {
    mkdirSync(GRAPH_DIR, { recursive: true });
    
    if (existsSync(GRAPH_FILE)) {
      try {
        const lines = readFileSync(GRAPH_FILE, 'utf-8').trim().split('\n').filter(l => l.trim());
        if (lines.length >= 2) {
          this.graph = {
            nodes: JSON.parse(lines[0]),
            edges: JSON.parse(lines[1]),
          };
        }
      } catch (e) {
        this.graph = { nodes: [], edges: [] };
      }
    }
  }
  
  save() {
    mkdirSync(GRAPH_DIR, { recursive: true });
    writeFileSync(GRAPH_FILE, JSON.stringify(this.graph.nodes) + '\n' + JSON.stringify(this.graph.edges));
  }
  
  rebuildFromVault(vaultPath) {
    this.graph = buildGraphFromVault(vaultPath);
    this.save();
    return this.graph;
  }
  
  findConnected(nodeId, options) {
    return findConnected(this.graph, nodeId, options);
  }
  
  findHubs(options) {
    return findHubs(this.graph, options);
  }
  
  findClusters(options) {
    return findClusters(this.graph, options);
  }
  
  getStats() {
    const nodesByType = {};
    for (const node of this.graph.nodes) {
      nodesByType[node.type] = (nodesByType[node.type] || 0) + 1;
    }
    
    return {
      totalNodes: this.graph.nodes.length,
      totalEdges: this.graph.edges.length,
      nodesByType,
      topHubs: this.graph.nodes
        .filter(n => n.type === 'note')
        .sort((a, b) => b.incomingCount - a.incomingCount)
        .slice(0, 5)
        .map(n => ({ name: n.name, incoming: n.incomingCount })),
    };
  }
}

export default KnowledgeGraph;
