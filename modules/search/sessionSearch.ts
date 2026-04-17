/**
 * Session Search - Hermes FTS5-style Full-text Search
 * 会话搜索 - Hermes FTS5 风格实现
 */

import type {
  SearchableMessage,
  SearchResult,
  SessionSearchOptions,
  SessionInfo,
  SearchQuery,
  SearchStats,
  SessionStoreConfig,
  CreateSessionOptions,
  AppendMessageOptions,
  EndSessionOptions,
} from './types'

// ============================================================================
// In-Memory FTS5-style Index
// ============================================================================

interface Fts5Index {
  term: string
  docIds: Set<number>
  positions: Map<number, number[]>
}

interface IndexedDocument {
  id: number
  sessionId: string
  role: string
  content: string
  timestamp: number
}

/**
 * Simple FTS5-style in-memory index
 * Tokenizes text and builds inverted index
 */
class FtsIndex {
  private index: Map<string, Fts5Index> = new Map()
  private documents: Map<number, IndexedDocument> = new Map()
  private docIdCounter = 0

  /**
   * Tokenize text into searchable terms
   */
  private tokenize(text: string): string[] {
    if (!text) return []
    
    // Convert to lowercase and split on non-word characters
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(term => term.length >= 2)
  }

  /**
   * Index a document
   */
  indexDocument(doc: Omit<IndexedDocument, 'id'>, existingId?: number): number {
    const id = existingId ?? ++this.docIdCounter
    const docWithId = { ...doc, id }
    
    // Remove old indexing if updating
    if (existingId) {
      this.removeFromIndex(existingId)
    }
    
    // Store document
    this.documents.set(id, docWithId)
    
    // Build inverted index
    const terms = this.tokenize(doc.content)
    const positions = new Map<number, number[]>()
    
    terms.forEach((term, pos) => {
      if (!this.index.has(term)) {
        this.index.set(term, {
          term,
          docIds: new Set(),
          positions: new Map(),
        })
      }
      
      const entry = this.index.get(term)!
      entry.docIds.add(id)
      
      if (!entry.positions.has(id)) {
        entry.positions.set(id, [])
      }
      entry.positions.get(id)!.push(pos)
    })
    
    return id
  }

  /**
   * Remove document from index
   */
  private removeFromIndex(docId: number): void {
    for (const entry of this.index.values()) {
      entry.docIds.delete(docId)
      entry.positions.delete(docId)
    }
  }

  /**
   * Remove document
   */
  deleteDocument(docId: number): void {
    this.removeFromIndex(docId)
    this.documents.delete(docId)
  }

  /**
   * Search the index
   */
  search(query: string, limit = 10): Array<{ docId: number; score: number }> {
    const terms = this.tokenize(query)
    if (terms.length === 0) return []
    
    // Count document frequency across terms
    const docScores = new Map<number, number>()
    
    for (const term of terms) {
      // Handle prefix matching
      const matchingEntries = Array.from(this.index.entries())
        .filter(([key]) => key.startsWith(term) || term.startsWith(key))
      
      for (const [key, entry] of matchingEntries) {
        for (const docId of entry.docIds) {
          const baseScore = entry.positions.get(docId)!.length
          // Boost exact matches
          const exactBoost = key === term ? 2 : 1
          const currentScore = docScores.get(docId) || 0
          docScores.set(docId, currentScore + baseScore * exactBoost)
        }
      }
    }
    
    // Sort by score descending
    return Array.from(docScores.entries())
      .map(([docId, score]) => ({ docId, score }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
  }

  /**
   * Generate FTS5-style snippet with highlights
   */
  generateSnippet(doc: IndexedDocument, query: string, maxLength = 150): string {
    const terms = this.tokenize(query)
    const content = doc.content || ''
    
    if (content.length <= maxLength) {
      return content
    }
    
    // Find first occurrence of any term
    let firstPos = -1
    for (const term of terms) {
      const pos = content.toLowerCase().indexOf(term)
      if (pos !== -1 && (firstPos === -1 || pos < firstPos)) {
        firstPos = pos
      }
    }
    
    if (firstPos === -1) {
      // No match, return beginning
      return content.substring(0, maxLength) + '...'
    }
    
    // Center snippet around match
    const start = Math.max(0, firstPos - 50)
    const end = Math.min(content.length, start + maxLength)
    
    let snippet = content.substring(start, end)
    
    // Add ellipsis
    if (start > 0) snippet = '...' + snippet
    if (end < content.length) snippet = snippet + '...'
    
    // Highlight matches with >>>
    for (const term of terms) {
      const regex = new RegExp(`(${term})`, 'gi')
      snippet = snippet.replace(regex, '>>>\$1<<<')
    }
    
    return snippet
  }

  /**
   * Clear all indexes
   */
  clear(): void {
    this.index.clear()
    this.documents.clear()
    this.docIdCounter = 0
  }

  /**
   * Get document count
   */
  get size(): number {
    return this.documents.size
  }

  /**
   * Get index size (unique terms)
   */
  get indexSize(): number {
    return this.index.size
  }
}

// ============================================================================
// Session Store
// ============================================================================

/**
 * In-memory session store with FTS5-style search
 * Mirrors Hermes's hermes_state.py SQLite + FTS5 approach
 */
export class SessionStore {
  private sessions: Map<string, SessionInfo> = new Map()
  private messages: Map<string, SearchableMessage[]> = new Map()
  private ftsIndex: FtsIndex = new FtsIndex()
  private config: Required<SessionStoreConfig>
  private stats: SearchStats = {
    totalSearches: 0,
    totalResults: 0,
    avgQueryTime: 0,
    lastSearchAt: null,
  }

  constructor(config: SessionStoreConfig = {}) {
    this.config = {
      dbPath: config.dbPath || 'memory://sessions',
      walMode: config.walMode ?? true,
      checkpointEvery: config.checkpointEvery ?? 50,
      writeTimeout: config.writeTimeout ?? 1000,
      maxRetries: config.maxRetries ?? 15,
    }
  }

  // ============================================================================
  // Session Management
  // ============================================================================

  /**
   * Create a new session
   */
  createSession(options: CreateSessionOptions): void {
    const session: SessionInfo = {
      id: options.sessionId,
      title: options.title || null,
      source: options.source,
      model: options.model || null,
      startedAt: Date.now(),
      endedAt: null,
      lastActive: Date.now(),
      messageCount: 0,
      preview: null,
    }
    
    this.sessions.set(options.sessionId, session)
    this.messages.set(options.sessionId, [])
  }

  /**
   * End a session
   */
  endSession(options: EndSessionOptions): void {
    const session = this.sessions.get(options.sessionId)
    if (session) {
      session.endedAt = Date.now()
      // Don't remove from sessions - keep for history
    }
  }

  /**
   * Reopen an ended session
   */
  reopenSession(sessionId: string): boolean {
    const session = this.sessions.get(sessionId)
    if (session) {
      session.endedAt = null
      session.lastActive = Date.now()
      return true
    }
    return false
  }

  /**
   * Set session title
   */
  setSessionTitle(sessionId: string, title: string): void {
    const session = this.sessions.get(sessionId)
    if (session) {
      session.title = title
    }
  }

  /**
   * Get session info
   */
  getSession(sessionId: string): SessionInfo | undefined {
    return this.sessions.get(sessionId)
  }

  /**
   * List sessions
   */
  listSessions(limit = 20, sourceFilter?: string[]): SessionInfo[] {
    let sessions = Array.from(this.sessions.values())
    
    if (sourceFilter && sourceFilter.length > 0) {
      sessions = sessions.filter(s => sourceFilter.includes(s.source))
    }
    
    return sessions
      .sort((a, b) => b.lastActive - a.lastActive)
      .slice(0, limit)
  }

  // ============================================================================
  // Message Management
  // ============================================================================

  /**
   * Append a message to session
   */
  appendMessage(options: AppendMessageOptions): number {
    const messages = this.messages.get(options.sessionId)
    if (!messages) {
      // Auto-create session if it doesn't exist
      this.createSession({
        sessionId: options.sessionId,
        source: 'unknown',
      })
    }
    
    const sessionMessages = this.messages.get(options.sessionId)!
    const id = sessionMessages.length + 1
    
    const message: SearchableMessage = {
      id,
      sessionId: options.sessionId,
      role: options.role,
      content: options.content || null,
      toolCallId: options.toolCallId || null,
      toolCalls: options.toolCalls || null,
      toolName: options.toolName || null,
      timestamp: Date.now(),
    }
    
    sessionMessages.push(message)
    
    // Update session stats
    const session = this.sessions.get(options.sessionId)
    if (session) {
      session.messageCount = sessionMessages.length
      session.lastActive = Date.now()
      // Update preview with first user message
      if (options.role === 'user' && !session.preview && options.content) {
        session.preview = options.content.substring(0, 63)
      }
    }
    
    // Index for FTS
    if (options.content) {
      this.ftsIndex.indexDocument({
        sessionId: options.sessionId,
        role: options.role,
        content: options.content,
        timestamp: message.timestamp,
      })
    }
    
    return id
  }

  /**
   * Get messages for a session
   */
  getMessages(sessionId: string): SearchableMessage[] {
    return this.messages.get(sessionId) || []
  }

  /**
   * Get messages as conversation format
   */
  getMessagesAsConversation(sessionId: string): Array<{ role: string; content: string }> {
    const messages = this.getMessages(sessionId)
    return messages
      .filter(m => m.content)
      .map(m => ({
        role: m.role,
        content: m.content as string,
      }))
  }

  /**
   * Clear messages but keep session
   */
  clearMessages(sessionId: string): void {
    const messages = this.messages.get(sessionId)
    if (messages) {
      // Remove from FTS index
      for (const msg of messages) {
        this.ftsIndex.deleteDocument(msg.id)
      }
    }
    this.messages.set(sessionId, [])
    
    const session = this.sessions.get(sessionId)
    if (session) {
      session.messageCount = 0
    }
  }

  /**
   * Delete session and all messages
   */
  deleteSession(sessionId: string): boolean {
    this.clearMessages(sessionId)
    return this.sessions.delete(sessionId)
  }

  // ============================================================================
  // FTS5-style Search
  // ============================================================================

  /**
   * Search messages (FTS5-style)
   */
  searchMessages(options: SessionSearchOptions): SearchResult[] {
    const startTime = Date.now()
    this.stats.totalSearches++
    this.stats.lastSearchAt = Date.now()
    
    const {
      query,
      sourceFilter,
      excludeSources,
      roleFilter,
      limit = 20,
      offset = 0,
    } = options
    
    // Search FTS index
    const docScores = this.ftsIndex.search(query, limit * 2)
    
    // Build result map
    const results: SearchResult[] = []
    
    for (const { docId, score } of docScores) {
      // We'd need to track docId -> message mapping in real impl
      // This is simplified
    }
    
    // Get matching messages from sessions
    const allMessages: SearchableMessage[] = []
    for (const [sessionId, messages] of this.messages) {
      const session = this.sessions.get(sessionId)
      
      // Apply source filter
      if (sourceFilter && sourceFilter.length > 0) {
        if (!session || !sourceFilter.includes(session.source)) continue
      }
      
      // Apply exclude filter
      if (excludeSources && excludeSources.length > 0) {
        if (session && excludeSources.includes(session.source)) continue
      }
      
      // Apply role filter
      if (roleFilter && roleFilter.length > 0) {
        if (!roleFilter.includes(message.role)) continue
      }
      
      allMessages.push(...messages.filter(m => m.content))
    }
    
    // Score and rank results
    const queryTerms = query.toLowerCase().split(/\s+/)
    
    const scoredResults = allMessages
      .map(msg => {
        const content = (msg.content || '').toLowerCase()
        let score = 0
        
        for (const term of queryTerms) {
          if (content.includes(term)) {
            // Count occurrences
            const matches = (content.match(new RegExp(term, 'g')) || []).length
            score += matches
            // Boost exact phrase matches
            if (content.includes(query.toLowerCase())) {
              score *= 2
            }
          }
        }
        
        return { msg, score }
      })
      .filter(r => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(offset, offset + limit)
    
    // Build results with snippets
    for (const { msg, score } of scoredResults) {
      const session = this.sessions.get(msg.sessionId)
      
      results.push({
        id: msg.id,
        sessionId: msg.sessionId,
        role: msg.role,
        content: msg.content || '',
        snippet: this.ftsIndex.generateSnippet({
          id: msg.id,
          sessionId: msg.sessionId,
          role: msg.role,
          content: msg.content || '',
          timestamp: msg.timestamp,
        }, query),
        timestamp: msg.timestamp,
        score,
        sessionTitle: session?.title || undefined,
      })
    }
    
    // Update stats
    this.stats.totalResults += results.length
    this.stats.avgQueryTime =
      (this.stats.avgQueryTime * (this.stats.totalSearches - 1) + (Date.now() - startTime)) /
      this.stats.totalSearches
    
    return results
  }

  /**
   * High-level search (matches Hermes session_search tool)
   */
  async sessionSearch(query: SearchQuery): Promise<SearchResult[]> {
    return this.searchMessages({
      query: query.query,
      sourceFilter: query.sources,
      roleFilter: query.roles,
      limit: query.limit,
    })
  }

  // ============================================================================
  // Utilities
  // ============================================================================

  /**
   * Get search statistics
   */
  getStats(): SearchStats {
    return { ...this.stats }
  }

  /**
   * Get FTS index size
   */
  getIndexSize(): number {
    return this.ftsIndex.indexSize
  }

  /**
   * Get total message count
   */
  getTotalMessages(): number {
    let total = 0
    for (const messages of this.messages.values()) {
      total += messages.length
    }
    return total
  }

  /**
   * Export session data
   */
  exportSession(sessionId: string): {
    session: SessionInfo | undefined
    messages: SearchableMessage[]
  } {
    return {
      session: this.getSession(sessionId),
      messages: this.getMessages(sessionId),
    }
  }

  /**
   * Prune old sessions
   */
  pruneSessions(olderThanDays: number, source?: string): number {
    const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000
    let deleted = 0
    
    for (const [sessionId, session] of this.sessions) {
      if (session.endedAt && session.endedAt < cutoff) {
        if (!source || session.source === source) {
          this.deleteSession(sessionId)
          deleted++
        }
      }
    }
    
    return deleted
  }

  /**
   * Clear all data
   */
  clear(): void {
    this.sessions.clear()
    this.messages.clear()
    this.ftsIndex.clear()
    this.stats = {
      totalSearches: 0,
      totalResults: 0,
      avgQueryTime: 0,
      lastSearchAt: null,
    }
  }
}

// ============================================================================
// Global Session Store
// ============================================================================

export const globalSessionStore = new SessionStore()

/**
 * Search across all sessions
 */
export async function searchSessions(
  query: string,
  options?: Partial<SessionSearchOptions>
): Promise<SearchResult[]> {
  return globalSessionStore.searchMessages({ query, ...options })
}

/**
 * Get session info
 */
export function getSession(sessionId: string): SessionInfo | undefined {
  return globalSessionStore.getSession(sessionId)
}

/**
 * List recent sessions
 */
export function listSessions(limit?: number, sourceFilter?: string[]): SessionInfo[] {
  return globalSessionStore.listSessions(limit, sourceFilter)
}
