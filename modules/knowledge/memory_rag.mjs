/**
 * memory_rag.mjs
 * 
 * TrustGraph-inspired Memory Retrieval
 * Upgrades from pure BM25 to concept extraction + relationship-aware retrieval
 * 
 * Key innovations (from TrustGraph GraphRAG):
 * 1. LLM-driven concept extraction from query
 * 2. Entity retrieval from knowledge graph
 * 3. Subgraph exploration (traverse relationships)
 * 4. Edge scoring (LLM judges relevance)
 * 5. Provenance tracking through retrieval chain
 * 
 * This is a simplified version suitable for personal agent use.
 * Full TrustGraph implementation requires Pulsar + Cassandra + Qdrant.
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { getKnowledgeGraph, Predicate, extractFromText } from './memory_graph.mjs';
import { getProvenanceStore, SourceType, ConfidenceLevel } from './memory_provenance.mjs';

/**
 * Concept extraction patterns
 * In full implementation, this would use an LLM.
 * Here we use pattern-based extraction as fallback.
 */
const CONCEPT_PATTERNS = [
  /what is (a |an )?([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/gi,  // "What is X"
  /how do (I |you )?([a-z]+(?:\s+\w+)*)/gi,                // "How do I X"
  /why (does|is|did|didn't)(?:n'?t\s+)?(\w+)/gi,            // "Why does X"
  /when (did|does|is|was|didn't)(\w+)/gi,                   // "When did X"
  /who (is|does|did|didn't|can|should)/gi,                  // "Who is X"
  /where (is|are|did|does|was|were)/gi,                     // "Where is X"
  /can (I |you )?([a-z]+(?:\s+\w+)*)/gi,                    // "Can I X"
  /should (I |you )?([a-z]+(?:\s+\w+)*)/gi,                 // "Should I X"
  /(?:the |a |an )?([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/g,      // Capitalized nouns
];

/**
 * Retrieval result with provenance
 */
export class RetrievalResult {
  constructor(content, options = {}) {
    this.content = content;
    this.score = options.score || 0.5;
    this.source = options.source || 'unknown';
    this.provenanceId = options.provenanceId || null;
    this.pathway = options.pathway || 'direct';
    this.concepts = options.concepts || [];
    this.relationships = options.relationships || [];
    this.explanation = options.explanation || '';
  }

  toJSON() {
    return {
      content: this.content,
      score: this.score,
      source: this.source,
      provenanceId: this.provenanceId,
      pathway: this.pathway,
      concepts: this.concepts,
      relationships: this.relationships,
      explanation: this.explanation,
    };
  }
}

/**
 * MemoryRAG — concept-extraction + relationship-aware retrieval
 */
export class MemoryRAG {
  constructor(options = {}) {
    this.graph = options.graph || getKnowledgeGraph();
    this.provenance = options.provenance || getProvenanceStore();
    this.maxResults = options.maxResults || 10;
    this.maxSubgraphDepth = options.maxSubgraphDepth || 2;
    this.minScore = options.minScore || 0.1;
  }

  /**
   * Main retrieval method
   * 
   * Flow (from TrustGraph GraphRAG):
   * 1. Concept extraction from query
   * 2. Entity retrieval from knowledge graph
   * 3. Subgraph exploration
   * 4. Relationship scoring
   * 5. Provenance tracking
   * 6. Synthesize answer
   */
  async retrieve(query, options = {}) {
    const {
      maxResults = this.maxResults,
      includeGraph = true,
      includeProvenance = true,
      concepts = null, // Pass concepts if already extracted
    } = options;

    // Step 1: Extract concepts from query
    const extractedConcepts = concepts || this.extractConcepts(query);

    // Step 2: Retrieve entities from knowledge graph
    const entities = this.findEntitiesForConcepts(extractedConcepts);

    // Step 3: Explore subgraph if entities found
    let subgraphTriples = [];
    if (includeGraph && entities.length > 0) {
      subgraphTriples = this.exploreSubgraph(entities, this.maxSubgraphDepth);
    }

    // Step 4: Score and rank results
    const results = this.scoreAndRank(
      query,
      [...entities.map(e => e.name), ...extractedConcepts],
      subgraphTriples,
      options
    );

    // Step 5: Attach provenance
    if (includeProvenance) {
      this.attachProvenance(results, query);
    }

    // Return top results
    return results.slice(0, maxResults);
  }

  /**
   * Extract concepts from a query
   * Simplified version — full version would use LLM
   */
  extractConcepts(query) {
    const concepts = new Set();

    // Pattern-based extraction
    for (const pattern of CONCEPT_PATTERNS) {
      let match;
      const regex = new RegExp(pattern.source, 'gi');
      while ((match = regex.exec(query)) !== null) {
        const concept = (match[2] || match[1] || match[0]).trim();
        if (concept.length > 2 && concept.length < 50) {
          concepts.add(concept);
        }
      }
    }

    // Also add significant words (length > 4, not common stop words)
    const stopWords = new Set(['this', 'that', 'what', 'when', 'where', 'which', 'their', 'there']);
    const words = query.split(/\s+/);
    for (const word of words) {
      const clean = word.replace(/[^a-zA-Z]/g, '');
      if (clean.length > 4 && !stopWords.has(clean.toLowerCase())) {
        concepts.add(clean);
      }
    }

    return Array.from(concepts);
  }

  /**
   * Find entities in the knowledge graph matching concepts
   */
  findEntitiesForConcepts(concepts) {
    const entities = [];

    for (const concept of concepts) {
      // Try exact match first
      const entity = this.graph.getEntityByName(concept);
      if (entity) {
        entities.push(entity);
        continue;
      }

      // Try partial match
      const lower = concept.toLowerCase();
      for (const e of this.graph.entities.values()) {
        if (e.name.toLowerCase().includes(lower) || lower.includes(e.name.toLowerCase())) {
          entities.push(e);
        }
      }
    }

    return entities;
  }

  /**
   * Explore subgraph from entities
   */
  exploreSubgraph(entities, maxDepth) {
    const allTriples = [];

    for (const entity of entities) {
      const traversed = this.graph.traverse(entity.name, maxDepth);
      allTriples.push(...traversed);
    }

    return allTriples;
  }

  /**
   * Score and rank results
   */
  scoreAndRank(query, concepts, subgraphTriples, options = {}) {
    const results = [];
    const conceptSet = new Set(concepts.map(c => c.toLowerCase()));

    // Score subgraph triples
    for (const triple of subgraphTriples) {
      let score = triple.confidence || 0.5;

      // Boost if predicate matches query concepts
      if (conceptSet.has(triple.predicate.toLowerCase())) {
        score *= 1.5;
      }

      // Boost if depth is shallow (more direct relevance)
      if (triple.depth === 0) {
        score *= 1.3;
      } else if (triple.depth === 1) {
        score *= 1.1;
      }

      if (score >= this.minScore) {
        results.push(new RetrievalResult(
          `${triple.from} ${triple.predicate} ${triple.to}`,
          {
            score,
            source: 'graph_traversal',
            pathway: 'inferred',
            concepts: [triple.from, triple.to],
            relationships: [triple.predicate],
            explanation: `Found via ${triple.direction} relationship: ${triple.path.join(' → ')}`,
          }
        ));
      }
    }

    // Also search in entity descriptions
    for (const entity of this.graph.entities.values()) {
      if (entity.description) {
        let score = 0.3; // Base score for text match

        const descLower = entity.description.toLowerCase();
        const queryLower = query.toLowerCase();
        const words = queryLower.split(/\s+/);

        for (const word of words) {
          if (descLower.includes(word)) {
            score += 0.1;
          }
        }

        if (score >= this.minScore) {
          results.push(new RetrievalResult(
            entity.description,
            {
              score,
              source: `entity:${entity.name}`,
              pathway: 'direct',
              concepts: [entity.name],
              explanation: `Entity match: ${entity.name} (${entity.type})`,
            }
          ));
        }
      }
    }

    // Sort by score descending
    results.sort((a, b) => b.score - a.score);

    return results;
  }

  /**
   * Attach provenance to results
   */
  attachProvenance(results, query) {
    for (const result of results) {
      // Try to find provenance for this source
      const provChain = this.provenance.getProvenanceChain(result.source);
      if (provChain.length > 0) {
        result.provenanceChain = provChain;
        result.provenanceExplanation = this.provenance.formatProvenanceChain(provChain);
      }
    }
  }

  /**
   * Ingest new memory into the graph
   * 
   * Flow: content → extract entities → extract relationships → store in graph
   */
  ingest(content, options = {}) {
    const { source = SourceType.USER_INPUT, autoProvenance = true } = options;

    // Extract entities (simple noun phrase detection)
    const entities = this.extractEntities(content);

    // Extract relationships using patterns
    const triples = extractFromText(content);

    // Add to graph
    for (const entityName of entities) {
      const entity = this.graph.addEntity({
        name: entityName,
        type: this.inferEntityType(entityName, content),
        description: this.extractDescription(entityName, content),
        confidence: 0.6,
        source: 'text_extraction',
      });
    }

    for (const triple of triples) {
      this.graph.addTriple(triple.subject, triple.predicate, triple.object, {
        confidence: triple.confidence || 0.6,
        source: triple.source || 'text_extraction',
      });
    }

    // Add provenance
    if (autoProvenance) {
      this.provenance.addEntityProvenance(
        entities[0] || 'unknown',
        'memory',
        content.slice(0, 200),
        {
          source,
          pathway: 'extracted',
          confidence: ConfidenceLevel.MEDIUM,
          notes: `Ingested from query context`,
        }
      );
    }

    // Persist
    this.graph.persist();

    return {
      entitiesAdded: entities.length,
      triplesAdded: triples.length,
    };
  }

  /**
   * Simple entity extraction (noun phrases)
   */
  extractEntities(text) {
    const entities = new Set();

    // Capitalized phrases
    const capitalizedPattern = /[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*/g;
    let match;
    while ((match = capitalizedPattern.exec(text)) !== null) {
      const phrase = match[0];
      // Filter out very common words
      if (!['The', 'This', 'That', 'There', 'What', 'When', 'Where', 'Which', 'Who'].includes(phrase)) {
        entities.add(phrase);
      }
    }

    // Pronouns replaced by context (simplified)
    // Full implementation would use coreference resolution

    return Array.from(entities);
  }

  /**
   * Infer entity type from context
   */
  inferEntityType(name, content) {
    const lower = content.toLowerCase();

    if (/\b(file|folder|directory|path|config|script)\b/.test(lower)) return 'file';
    if (/\b(project|repo|module|package|library)\b/.test(lower)) return 'project';
    if (/\b(person|user|admin|developer)\b/.test(lower)) return 'person';
    if (/\b(skill|tool|command|workflow)\b/.test(lower)) return 'skill';
    if (/\b(setting|option|config|flag)\b/.test(lower)) return 'config';
    if (/\b(memory|storage|persist|retrieve)\b/.test(lower)) return 'memory';

    return 'concept';
  }

  /**
   * Extract description around an entity name
   */
  extractDescription(name, content) {
    // Find the sentence containing the entity
    const sentences = content.split(/[.!?]+/);
    for (const sentence of sentences) {
      if (sentence.includes(name)) {
        return sentence.trim();
      }
    }
    return content.slice(0, 200);
  }

  /**
   * Answer a question using the knowledge graph
   */
  async answer(question, options = {}) {
    const results = await this.retrieve(question, options);

    if (results.length === 0) {
      return {
        answer: null,
        confidence: 0,
        reasoning: 'No relevant information found in memory',
        sources: [],
      };
    }

    // Synthesize answer from top results
    const topResult = results[0];
    const supporting = results.slice(0, 3);

    return {
      answer: topResult.content,
      confidence: topResult.score,
      reasoning: topResult.explanation || `Found ${results.length} relevant entries`,
      sources: supporting.map(s => ({
        content: s.content.slice(0, 100),
        score: s.score,
        source: s.source,
        provenanceId: s.provenanceId,
      })),
      relationships: [...new Set(supporting.flatMap(s => s.relationships || []))],
    };
  }

  /**
   * Get stats
   */
  getStats() {
    return {
      graph: this.graph.getStats(),
      provenanceEntries: this.provenance.getHighConfidence().length,
    };
  }
}

// Singleton
let _rag = null;

export function getMemoryRAG() {
  if (!_rag) {
    _rag = new MemoryRAG();
  }
  return _rag;
}

export default {
  MemoryRAG,
  RetrievalResult,
  getMemoryRAG,
  extractConcepts: (q) => new MemoryRAG().extractConcepts(q),
};
