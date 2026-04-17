/**
 * Search Types - FTS5-style Session Search
 * 搜索模块类型 - Hermes FTS5 风格
 */

import type { ToolCall } from '../registry/types'

// ============================================================================
// Session Search
// ============================================================================

export interface SearchableMessage {
  id: number
  sessionId: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string | null
  toolCallId?: string | null
  toolCalls?: ToolCall[] | null
  toolName?: string | null
  timestamp: number
}

export interface SearchResult {
  id: number
  sessionId: string
  role: string
  content: string
  snippet: string  // FTS5-style highlighted snippet
  timestamp: number
  score: number
  sessionTitle?: string
}

export interface SessionSearchOptions {
  query: string
  sourceFilter?: string[]      // e.g., ['cli', 'telegram']
  excludeSources?: string[]     // e.g., ['gateway']
  roleFilter?: string[]        // e.g., ['user']
  limit?: number
  offset?: number
}

export interface SessionInfo {
  id: string
  title: string | null
  source: string
  model: string | null
  startedAt: number
  endedAt: number | null
  lastActive: number
  messageCount: number
  preview: string | null
}

// ============================================================================
// Full-text Search Query
// ============================================================================

export interface Fts5Query {
  /** Raw query string */
  query: string
  /** Enable prefix matching */
  prefixMatch?: boolean
  /** Enable phrase matching */
  phraseMatch?: boolean
  /** Boolean operators (AND/OR/NOT) */
  booleanMode?: boolean
}

export interface SearchQuery {
  /** Search query */
  query: string
  /** Search type */
  type: 'session' | 'file' | 'all' | 'memory'
  /** Max results */
  limit?: number
  /** Source filter */
  sources?: string[]
  /** Role filter */
  roles?: string[]
}

// ============================================================================
// Search Statistics
// ============================================================================

export interface SearchStats {
  totalSearches: number
  totalResults: number
  avgQueryTime: number
  lastSearchAt: number | null
}

// ============================================================================
// Hermes-style Session Store
// ============================================================================

export interface SessionStoreConfig {
  /** Database path */
  dbPath?: string
  /** Enable WAL mode */
  walMode?: boolean
  /** Checkpoint interval */
  checkpointEvery?: number
  /** Write timeout */
  writeTimeout?: number
  /** Max retries for write contention */
  maxRetries?: number
}

export interface CreateSessionOptions {
  sessionId: string
  source: string
  userId?: string
  model?: string
  modelConfig?: string
  systemPrompt?: string
  parentSessionId?: string | null
  title?: string | null
}

export interface AppendMessageOptions {
  sessionId: string
  role: 'system' | 'user' | 'assistant' | 'tool'
  content?: string | null
  toolCallId?: string | null
  toolCalls?: ToolCall[] | null
  toolName?: string | null
  tokenCount?: number
  finishReason?: string
  reasoning?: string | null
}

export interface EndSessionOptions {
  sessionId: string
  endReason: 'user_exit' | 'timeout' | 'error' | 'completed'
}

export interface ExportSessionOptions {
  sessionId: string
  includeMessages?: boolean
}
