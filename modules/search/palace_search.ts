/**
 * palace_search.ts — BM25 Full-text Search for Memory Palace
 * ============================================================
 *
 * L3 Deep Search 引擎，基于以下设计:
 * - BM25 排名算法 (Okapi BM25)
 * - 倒排索引 (Inverted Index)
 * - 词项权重 TF/IDF
 * - 结果高亮摘要
 *
 * 可独立使用，也可通过 Palace 接口调用:
 *   import { PalaceSearch } from './palace_search'
 *   const search = new PalaceSearch()
 *   search.indexDocument({ id, content, metadata })
 *   const results = search.search('query', { limit: 10, wing: 'wing_user' })
 */

import type { Drawer } from '../memory/types'

// ============================================================================
// BM25 Parameters
// ============================================================================

const BM25_K1 = 1.5       // Term frequency saturation
const BM25_B = 0.75       // Document length normalization
const AVG_DOC_LEN = 200   // Placeholder; computed dynamically

// ============================================================================
// Indexed Document
// ============================================================================

interface SearchDocument {
  id: string
  content: string
  wing?: string
  room?: string
  hall?: string
  timestamp?: number
  metadata?: Record<string, unknown>
}

// ============================================================================
// Inverted Index Entry
// ============================================================================

interface IndexEntry {
  term: string
  docIds: Set<string>
  // docId -> [positions]
  positions: Map<string, number[]>
  // docId -> term frequency in that doc
  docFreq: Map<string, number>
}

// ============================================================================
// Tokenizer
// ============================================================================

/**
 * Tokenize text into searchable terms.
 * Lowercases, splits on non-word chars, filters short terms.
 */
function tokenize(text: string): string[] {
  if (!text) return []
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(term => term.length >= 2)
}

// ============================================================================
// BM25 Scorer
// ============================================================================

/**
 * Compute average document length (in tokens).
 */
function avgDocLen(docs: SearchDocument[]): number {
  if (docs.length === 0) return AVG_DOC_LEN
  const total = docs.reduce((sum, d) => sum + tokenize(d.content).length, 0)
  return total / docs.length
}

/**
 * BM25 score for a single document.
 */
function bm25Score(
  doc: SearchDocument,
  queryTerms: string[],
  index: Map<string, IndexEntry>,
  docLengths: Map<string, number>,
  avgLen: number,
  N: number
): number {
  let score = 0
  const docId = doc.id

  for (const term of queryTerms) {
    const entry = index.get(term)
    if (!entry) continue

    const df = entry.docFreq.get(docId) || 0
    if (df === 0) continue

    // TF
    const tf = df
    // IDF: log((N - n + 0.5) / (n + 0.5))
    const n = entry.docIds.size
    const idf = Math.log((N - n + 0.5) / (n + 0.5) + 1)

    // BM25 TF component
    const tfComponent = (tf * (BM25_K1 + 1)) / (tf + BM25_K1 * (1 - BM25_B + BM25_B * docLengths.get(docId)! / avgLen))

    score += idf * tfComponent
  }

  return score
}

// ============================================================================
// PalaceSearch — BM25 Search Engine
// ============================================================================

export interface SearchOptions {
  wing?: string
  room?: string
  hall?: string
  limit?: number
  threshold?: number
  fromTimestamp?: number
  toTimestamp?: number
}

export interface SearchHit<T = SearchDocument> {
  doc: T
  score: number
  snippet: string
  highlights: string[]
}

/**
 * PalaceSearch — BM25-powered full-text search engine.
 *
 * Usage:
 *   const search = new PalaceSearch()
 *   search.indexDocument({ id: 'd1', content: 'User prefers Markdown', wing: 'wing_user' })
 *   const results = search.search('Markdown preferences')
 */
export class PalaceSearch {
  private index: Map<string, IndexEntry> = new Map()
  private documents: Map<string, SearchDocument> = new Map()
  private docLengths: Map<string, number> = new Map()
  private avgLen: number = AVG_DOC_LEN

  /**
   * Index a document.
   * Re-indexing same ID replaces the existing document.
   */
  indexDocument(doc: SearchDocument): void {
    const { id, content } = doc
    const terms = tokenize(content)

    // Remove old indexing if re-indexing
    if (this.documents.has(id)) {
      this._removeFromIndex(id)
    }

    // Store document
    this.documents.set(id, doc)

    // Tokenize and build inverted index
    const positions = new Map<string, number[]>()
    const docFreq = new Map<string, number>()

    terms.forEach((term, pos) => {
      if (!this.index.has(term)) {
        this.index.set(term, {
          term,
          docIds: new Set(),
          positions: new Map(),
          docFreq: new Map(),
        })
      }

      const entry = this.index.get(term)!
      entry.docIds.add(id)

      if (!entry.positions.has(id)) {
        entry.positions.set(id, [])
      }
      entry.positions.get(id)!.push(pos)

      docFreq.set(id, (docFreq.get(id) || 0) + 1)
    })

    // Update index entries with per-doc freq
    for (const [term, freq] of docFreq) {
      this.index.get(term)!.docFreq.set(id, freq)
    }

    // Store doc length
    this.docLengths.set(id, terms.length)

    // Recompute average
    this._recomputeAvgLen()
  }

  /**
   * Index multiple documents at once.
   */
  indexDocuments(docs: SearchDocument[]): void {
    for (const doc of docs) {
      this.indexDocument(doc)
    }
  }

  /**
   * Remove a document from the index.
   */
  removeDocument(id: string): void {
    this._removeFromIndex(id)
    this.documents.delete(id)
    this.docLengths.delete(id)
    this._recomputeAvgLen()
  }

  /**
   * Search the index.
   * Returns top results matching the query.
   */
  search(query: string, options: SearchOptions = {}): SearchHit[] {
    const {
      wing,
      room,
      hall,
      limit = 10,
      threshold = 0.1,
    } = options

    const queryTerms = tokenize(query)
    if (queryTerms.length === 0) return []

    const N = this.documents.size
    if (N === 0) return []

    const hits: SearchHit[] = []

    // Score all documents that contain at least one query term
    const scored = new Map<string, number>()

    for (const term of queryTerms) {
      const entry = this.index.get(term)
      if (!entry) continue

      for (const docId of entry.docIds) {
        const doc = this.documents.get(docId)!
        if (wing && doc.wing !== wing) continue
        if (room && doc.room !== room) continue
        if (hall && doc.hall !== hall) continue

        const score = bm25Score(
          doc, queryTerms, this.index,
          this.docLengths, this.avgLen, N
        )
        scored.set(docId, (scored.get(docId) || 0) + score)
      }
    }

    // Sort by score descending
    const sorted = Array.from(scored.entries())
      .sort((a, b) => b[1] - a[1])

    for (const [docId, score] of sorted) {
      if (score < threshold) break
      const doc = this.documents.get(docId)!

      // Calculate max_score for normalization (optional, for future use)
      hits.push({
        doc,
        score,
        snippet: this._generateSnippet(doc.content, queryTerms),
        highlights: this._extractHighlights(doc.content, queryTerms),
      })

      if (hits.length >= limit) break
    }

    return hits
  }

  /**
   * Prefix/auto-complete search — finds terms starting with prefix.
   */
  suggestTerms(prefix: string, limit = 5): string[] {
    const prefixLower = prefix.toLowerCase()
    const suggestions: Array<{ term: string; docFreq: number }> = []

    for (const [term, entry] of this.index.entries()) {
      if (term.startsWith(prefixLower)) {
        suggestions.push({ term, docFreq: entry.docIds.size })
      }
    }

    return suggestions
      .sort((a, b) => b.docFreq - a.docFreq)
      .slice(0, limit)
      .map(s => s.term)
  }

  /**
   * Get indexed document count.
   */
  get size(): number {
    return this.documents.size
  }

  /**
   * Get index statistics.
   */
  getStats(): { documentCount: number; termCount: number; avgDocLen: number } {
    return {
      documentCount: this.documents.size,
      termCount: this.index.size,
      avgDocLen: Math.round(this.avgLen),
    }
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  private _removeFromIndex(docId: string): void {
    for (const entry of this.index.values()) {
      entry.docIds.delete(docId)
      entry.positions.delete(docId)
      entry.docFreq.delete(docId)
    }
  }

  private _recomputeAvgLen(): void {
    const docs = Array.from(this.documents.values())
    this.avgLen = avgDocLen(docs)
  }

  /**
   * Generate a contextual snippet centered around the first match.
   */
  private _generateSnippet(content: string, queryTerms: string[], maxLen = 200): string {
    const lower = content.toLowerCase()

    // Find earliest query term occurrence
    let firstPos = -1
    for (const term of queryTerms) {
      const pos = lower.indexOf(term)
      if (pos !== -1 && (firstPos === -1 || pos < firstPos)) {
        firstPos = pos
      }
    }

    if (firstPos === -1) {
      // No direct match, return beginning
      return content.slice(0, maxLen) + (content.length > maxLen ? '...' : '')
    }

    // Center snippet around match
    const halfWindow = Math.floor(maxLen / 2)
    const start = Math.max(0, firstPos - halfWindow)
    const end = Math.min(content.length, start + maxLen)

    let snippet = content.slice(start, end)
    if (start > 0) snippet = '...' + snippet
    if (end < content.length) snippet = snippet + '...'

    return snippet
  }

  /**
   * Extract all highlighted fragments.
   */
  private _extractHighlights(content: string, queryTerms: string[]): string[] {
    const highlights: string[] = []
    const window = 40

    for (const term of queryTerms) {
      const lower = content.toLowerCase()
      let pos = 0
      while (true) {
        const idx = lower.indexOf(term, pos)
        if (idx === -1) break
        const start = Math.max(0, idx - window)
        const end = Math.min(content.length, idx + term.length + window)
        highlights.push(content.slice(start, end))
        pos = idx + 1
        if (highlights.length >= 3) break
      }
    }

    return [...new Set(highlights)].slice(0, 5)
  }
}

// ============================================================================
// Drawer Adapter — Index Drawer objects from Memory Palace
// ============================================================================

/**
 * Index a Drawer into PalaceSearch.
 */
export function indexDrawer(search: PalaceSearch, drawer: Drawer): void {
  search.indexDocument({
    id: drawer.id,
    content: drawer.content,
    wing: drawer.wing,
    room: drawer.room,
    hall: drawer.hall,
    timestamp: drawer.filedAt instanceof Date ? drawer.filedAt.getTime() : undefined,
    metadata: {
      sourceFile: drawer.sourceFile,
      importance: drawer.importance,
      emotionalWeight: drawer.emotionalWeight,
    },
  })
}

// ============================================================================
// Global singleton for L3 search
// ============================================================================

let _globalSearch: PalaceSearch | null = null

export function getGlobalPalaceSearch(): PalaceSearch {
  if (!_globalSearch) {
    _globalSearch = new PalaceSearch()
  }
  return _globalSearch
}
