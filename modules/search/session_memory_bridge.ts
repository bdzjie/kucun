/**
 * session_memory_bridge.ts — Session → Memory Palace Bridge
 * ===========================================================
 *
 * 将 SessionStore 中的会话内容自动沉淀到 Memory Palace。
 * 支持两种模式:
 *
 * 1. Auto-save (自动沉淀): 每个会话结束后自动保存摘要
 * 2. Real-time index (实时索引): 会话消息实时索引到 L3 BM25 搜索
 *
 * 使用方式:
 *   import { SessionMemoryBridge } from './session_memory_bridge'
 *   const bridge = new SessionMemoryBridge()
 *   bridge.start()  // 开始监听会话事件
 */

import type { SessionInfo, SearchableMessage } from '../search/types'
import { getGlobalPalaceSearch, indexDrawer } from '../search/palace_search'
import { Palace, addDrawer } from '../memory/palace'
import { EventEmitter } from '../eventEmitter'

// ============================================================================
// Event Types
// ============================================================================

export interface MemoryBridgeConfig {
  /** 是否在会话结束时自动保存 */
  autoSaveOnEnd: boolean
  /** 自动保存的间隔 (ms) */
  autoSaveIntervalMs: number
  /** 每个会话最多保存多少条消息 */
  maxMessagesPerSession: number
  /** 最低重要性分数才保存 */
  minImportanceScore: number
  /** 默认 wing */
  defaultWing: string
  /** 实时索引模式 */
  realTimeIndex: boolean
  /** 会话沉寂多久后开始自动保存 (ms) */
  idleThresholdMs: number
}

const DEFAULT_CONFIG: MemoryBridgeConfig = {
  autoSaveOnEnd: true,
  autoSaveIntervalMs: 5 * 60 * 1000,      // 5 分钟
  maxMessagesPerSession: 100,
  minImportanceScore: 0.3,
  defaultWing: 'wing_user',
  realTimeIndex: true,
  idleThresholdMs: 30 * 60 * 1000,       // 30 分钟沉寂
}

// ============================================================================
// Importance Scoring
// ============================================================================

/**
 * 简单的消息重要性评分.
 * 考虑: 消息长度 / 是否包含决策词汇 / 是否包含情感词汇
 */
function scoreImportance(role: string, content: string): number {
  let score = 0.0

  // 长度得分 (越长通常信息越多)
  score += Math.min(content.length / 500, 1.0) * 0.2

  // 角色权重
  if (role === 'user') score += 0.3
  else if (role === 'assistant') score += 0.2

  // 决策关键词
  const decisionWords = [
    '决定', '选择', 'will', 'must', 'should', 'need to',
    '应该', '必须', '要', '选择', '决定', '规划',
    'commit', 'implement', 'create', 'build', 'fix', 'update',
  ]
  for (const w of decisionWords) {
    if (content.includes(w)) { score += 0.15; break }
  }

  // 情感关键词
  const emotionalWords = [
    '!', '?', 'interesting', 'great', 'thanks', 'please',
    '谢谢', '好的', '太棒了', '不对', '不对', '糟糕',
    'love', 'hate', 'want', 'feel', 'think',
  ]
  for (const w of emotionalWords) {
    if (content.includes(w)) { score += 0.1; break }
  }

  // 代码/技术内容
  if (/```|function|class|import|export|def |=>|->/.test(content)) {
    score += 0.1
  }

  // 文件操作
  if (/read|write|edit|delete|create|modify/.test(content.toLowerCase())) {
    score += 0.1
  }

  return Math.min(score, 1.0)
}

/**
 * 判断内容是否值得保存为记忆.
 */
function isMemorable(role: string, content: string): boolean {
  if (!content || content.trim().length < 10) return false
  if (role === 'system') return false
  const score = scoreImportance(role, content)
  return score >= 0.3
}

/**
 * 提取会话摘要 (用于作为记忆内容).
 */
function extractSessionSummary(session: SessionInfo, messages: SearchableMessage[]): string {
  const lines: string[] = []

  lines.push(`## Session: ${session.title || session.sessionId}`)
  lines.push(`Source: ${session.source}`)

  if (session.preview) {
    lines.push(`Preview: ${session.preview}`)
  }

  // 关键消息摘录
  const keyMessages = messages
    .filter(m => m.content && isMemorable(m.role, m.content))
    .slice(-20)  // 最近 20 条重要消息

  if (keyMessages.length > 0) {
    lines.push('\n--- Key Messages ---')
    for (const msg of keyMessages) {
      const prefix = msg.role === 'user' ? 'User' : 'Assistant'
      const content = msg.content!.slice(0, 300)
      lines.push(`[${prefix}]: ${content}`)
    }
  }

  return lines.join('\n')
}

// ============================================================================
// Session Memory Bridge
// ============================================================================

export class SessionMemoryBridge extends EventEmitter {
  private config: MemoryBridgeConfig
  private sessionTimers: Map<string, NodeJS.Timeout> = new Map()
  private pendingSaves: Set<string> = new Set()
  private search = getGlobalPalaceSearch()

  // External dependencies (can be replaced with DI)
  private getSessionMessages: (sessionId: string) => SearchableMessage[]
  private listSessions: () => SessionInfo[]
  private getSession: (sessionId: string) => SessionInfo | undefined

  constructor(
    config: Partial<MemoryBridgeConfig> = {},
    deps?: {
      getSessionMessages?: (sessionId: string) => SearchableMessage[]
      listSessions?: () => SessionInfo[]
      getSession?: (sessionId: string) => SessionInfo | undefined
    }
  ) {
    super()
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.getSessionMessages = deps?.getSessionMessages ?? (() => [])
    this.listSessions = deps?.listSessions ?? (() => [])
    this.getSession = deps?.getSession ?? (() => undefined)
  }

  /**
   * Start the bridge — begin listening to session events.
   */
  start(): void {
    if (this.config.realTimeIndex) {
      this.on('message', this._handleMessage.bind(this))
    }
    this.on('session_end', this._handleSessionEnd.bind(this))
    this.on('session_idle', this._handleSessionIdle.bind(this))
    console.log('[SessionMemoryBridge] Started')
  }

  /**
   * Stop the bridge.
   */
  stop(): void {
    this.removeAllListeners()
    for (const timer of this.sessionTimers.values()) {
      clearTimeout(timer)
    }
    this.sessionTimers.clear()
    console.log('[SessionMemoryBridge] Stopped')
  }

  /**
   * Manually trigger memory save for a session.
   */
  async saveSession(sessionId: string, wing?: string): Promise<void> {
    const session = this.getSession(sessionId)
    if (!session) return

    const messages = this.getSessionMessages(sessionId)
    if (messages.length === 0) return

    const summary = extractSessionSummary(session, messages)

    const drawer = await addDrawer(
      wing || this.config.defaultWing,
      'sessions',
      summary,
      {
        sourceFile: `session://${sessionId}`,
        hall: 'hall_events',
        metadata: {
          sessionId,
          source: session.source,
          messageCount: messages.length,
        },
      }
    )

    // Also index for BM25 search
    indexDrawer(this.search, drawer)

    console.log(`[SessionMemoryBridge] Saved session ${sessionId} as drawer ${drawer.id}`)
    this.emit('session_saved', { sessionId, drawerId: drawer.id })
  }

  /**
   * Index a single session message into BM25 search.
   */
  indexMessage(sessionId: string, role: string, content: string): void {
    if (!this.config.realTimeIndex) return
    if (!content || content.trim().length < 10) return

    this.search.indexDocument({
      id: `session:${sessionId}:${Date.now()}`,
      content: `[${role}]: ${content}`,
      wing: 'wing_user',
      room: 'sessions',
      hall: role === 'user' ? 'hall_events' : 'hall_facts',
      timestamp: Date.now(),
      metadata: { sessionId, role },
    })
  }

  // ─── Event handlers ────────────────────────────────────────────────────────

  private _handleMessage(payload: { sessionId: string; role: string; content: string }): void {
    const { sessionId, role, content } = payload

    // Real-time BM25 index
    this.indexMessage(sessionId, role, content)

    // Reset idle timer
    this._resetIdleTimer(sessionId)
  }

  private _handleSessionEnd(payload: { sessionId: string }): void {
    if (!this.config.autoSaveOnEnd) return

    const { sessionId } = payload
    this.sessionTimers.delete(sessionId)
    this.saveSession(sessionId).catch(console.error)
  }

  private async _handleSessionIdle(payload: { sessionId: string }): Promise<void> {
    if (!this.config.autoSaveOnEnd) return
    if (this.pendingSaves.has(payload.sessionId)) return

    this.pendingSaves.add(payload.sessionId)
    try {
      await this.saveSession(payload.sessionId)
    } finally {
      this.pendingSaves.delete(payload.sessionId)
    }
  }

  // ─── Idle timer ────────────────────────────────────────────────────────────

  private _resetIdleTimer(sessionId: string): void {
    const existing = this.sessionTimers.get(sessionId)
    if (existing) clearTimeout(existing)

    const timer = setTimeout(() => {
      this.emit('session_idle', { sessionId })
    }, this.config.idleThresholdMs)

    this.sessionTimers.set(sessionId, timer)
  }
}

// ============================================================================
// Global bridge instance (connects to globalSessionStore)
// ============================================================================

let _globalBridge: SessionMemoryBridge | null = null

/**
 * Create and start the global session-memory bridge.
 * Requires globalSessionStore to be available.
 */
export async function startGlobalBridge(): Promise<SessionMemoryBridge> {
  if (_globalBridge) return _globalBridge

  // Dynamic import to avoid circular deps
  const { globalSessionStore } = await import('../search/sessionSearch')

  _globalBridge = new SessionMemoryBridge(
    {
      autoSaveOnEnd: true,
      realTimeIndex: true,
      idleThresholdMs: 30 * 60 * 1000,
    },
    {
      getSessionMessages: (sessionId) => {
        const store = (globalSessionStore as any)
        return store.messages.get(sessionId) || []
      },
      listSessions: () => {
        const store = (globalSessionStore as any)
        return Array.from(store.sessions.values())
      },
      getSession: (sessionId) => {
        const store = (globalSessionStore as any)
        return store.sessions.get(sessionId)
      },
    }
  )

  // Listen to session store events if available
  try {
    const { globalSessionStore } = await import('../search/sessionSearch')
    const store = globalSessionStore as any
    if (store.on) {
      store.on('message', (msg: any) => {
        _globalBridge!.emit('message', {
          sessionId: msg.sessionId,
          role: msg.role,
          content: msg.content,
        })
      })
      store.on('session_end', (payload: any) => {
        _globalBridge!.emit('session_end', payload)
      })
    }
  } catch {
    // Session store may not support events
  }

  _globalBridge.start()
  return _globalBridge
}

export function getGlobalBridge(): SessionMemoryBridge | null {
  return _globalBridge
}
