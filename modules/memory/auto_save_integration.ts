/**
 * auto_save_integration.ts — Auto-Save Integration for OpenClaw
 * ============================================================
 *
 * 将 memory hooks 系统、SessionStore 和 BM25 搜索连接成完整的自动记忆系统。
 *
 * 架构:
 *   SessionStore.appendMessage()
 *         ↓
 *   SessionMemoryBridge (消息路由)
 *         ↓
 *   onMessageCount() [hooks.ts]  ──→ 达到 saveInterval
 *         ↓
 *   executeAutoSave() [hooks.ts] ──→ Extractor.extractMemories()
 *         ↓                              ↓
 *   addDrawer() [palace.ts]       分类保存
 *         ↓
 *   PalaceSearch.indexDocument() [BM25]
 *
 * 使用方式:
 *
 * ```typescript
 * import { AutoSave } from './auto_save_integration'
 *
 * const autoSave = new AutoSave({
 *   sessionId: 'session-123',
 *   saveInterval: 10,        // 每 10 条消息保存一次
 *   wing: 'wing_user',
 *   enableBM25: true,        // 同步到 BM25 搜索
 * })
 *
 * await autoSave.start()
 *
 * // 在每次新消息时调用
 * await autoSave.onMessage('user', '我决定使用 Postgres')
 *
 * // 结束会话时
 * await autoSave.end()
 * ```
 */

import { EventEmitter } from '../eventEmitter'
import {
  triggerHook,
  executeAutoSave,
  executePreCompactSave,
  onSessionStart,
  onSessionEnd,
  getSessionHookState,
} from './hooks'
import { Palace, addDrawer } from './palace'
import { getGlobalPalaceSearch, indexDrawer } from '../search/palace_search'
import { Extractor } from './extractor'
import type { Drawer } from './types'
import type { SearchableMessage } from '../search/types'

// ============================================================================
// Configuration
// ============================================================================

export interface AutoSaveConfig {
  /** 会话 ID */
  sessionId: string
  /** 每多少条消息触发一次保存 */
  saveInterval: number
  /** 保存到的 wing */
  wing: string
  /** 是否启用 BM25 索引 */
  enableBM25: boolean
  /** 是否在会话结束时保存 */
  saveOnEnd: boolean
  /** 是否在压缩前保存 */
  saveOnPreCompact: boolean
  /** 会话结束前等待新消息的静默期 (ms) */
  sessionEndDelayMs: number
  /** 最低重要性分数才保存 */
  minImportance: number
  /** 自动提取消息内容用于保存 */
  extractFromMessages: (sessionId: string) => MessageSnapshot[]
}

interface MessageSnapshot {
  role: string
  content: string
  timestamp: number
}

// ============================================================================
// Memory Extractor — filters and transforms session messages
// ============================================================================

/**
 * Convert session messages to a single content string for extraction.
 */
function messagesToContent(messages: MessageSnapshot[]): string {
  return messages
    .filter(m => m.content && m.content.trim().length > 0)
    .map(m => `[${m.role}]: ${m.content}`)
    .join('\n')
}

// ============================================================================
// AutoSave Integration
// ============================================================================

export class AutoSave extends EventEmitter {
  private config: Required<AutoSaveConfig>
  private messageCount: number = 0
  private lastSaveCount: number = 0
  private isRunning: boolean = false
  private pendingSave: Promise<Drawer[] | null> | null = null
  private search = getGlobalPalaceSearch()
  private recentMessages: MessageSnapshot[] = []
  private maxRecentMessages: number = 50

  constructor(config: Partial<AutoSaveConfig> & { sessionId: string }) {
    super()

    this.config = {
      sessionId: config.sessionId,
      saveInterval: config.saveInterval ?? 10,
      wing: config.wing ?? 'wing_user',
      enableBM25: config.enableBM25 ?? true,
      saveOnEnd: config.saveOnEnd ?? true,
      saveOnPreCompact: config.saveOnPreCompact ?? true,
      sessionEndDelayMs: config.sessionEndDelayMs ?? 1000,
      minImportance: config.minImportance ?? 0.2,
      extractFromMessages: config.extractFromMessages ?? (() => this.recentMessages),
    }
  }

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  /**
   * Start auto-save for the session.
   */
  async start(): Promise<void> {
    if (this.isRunning) return
    this.isRunning = true
    this.messageCount = 0
    this.lastSaveCount = 0
    this.recentMessages = []

    await onSessionStart(this.config.sessionId)
    this.emit('started', { sessionId: this.config.sessionId })
    console.log(`[AutoSave] Started for session ${this.config.sessionId}`)
  }

  /**
   * Stop and optionally save remaining content.
   */
  async stop(saveFinal: boolean = true): Promise<void> {
    if (!this.isRunning) return
    this.isRunning = false

    if (saveFinal) {
      await this._doSave('session_end')
    }

    await onSessionEnd(this.config.sessionId)
    this.emit('stopped', { sessionId: this.config.sessionId })
    console.log(`[AutoSave] Stopped for session ${this.config.sessionId}`)
  }

  /**
   * End the session (alias for stop).
   */
  async end(): Promise<void> {
    await this.stop(true)
  }

  // ─── Message Handling ───────────────────────────────────────────────────────

  /**
   * Called for each new message in the session.
   * Tracks message count and triggers auto-save at intervals.
   */
  async onMessage(role: string, content: string): Promise<void> {
    if (!this.isRunning) return

    this.messageCount++

    // Keep rolling window of recent messages
    this.recentMessages.push({
      role,
      content,
      timestamp: Date.now(),
    })
    if (this.recentMessages.length > this.maxRecentMessages) {
      this.recentMessages.shift()
    }

    // Trigger hook
    const decision = await triggerHook('message_count', {
      sessionId: this.config.sessionId,
      messageCount: this.messageCount,
    })

    if (decision.decision === 'block') {
      await this._doSave('auto')
    }
  }

  /**
   * Called when the session is about to be compacted.
   * Performs an emergency save of all remaining content.
   */
  async onPreCompact(fullContent: string): Promise<void> {
    if (!this.isRunning) {
      // Still do a pre-compact save even if not "running"
      await this._doSave('pre_compact', fullContent)
      return
    }

    if (this.config.saveOnPreCompact) {
      await this._doSave('pre_compact', fullContent)
    }
  }

  /**
   * Manually trigger a save.
   */
  async save(label?: string): Promise<Drawer[]> {
    const drawers = await this._doSave(label || 'manual')
    return drawers || []
  }

  // ─── Status ───────────────────────────────────────────────────────────────

  /**
   * Get current hook state for this session.
   */
  getState() {
    return getSessionHookState(this.config.sessionId)
  }

  /**
   * Check if a save is currently in progress.
   */
  isSaving(): boolean {
    return this.pendingSave !== null
  }

  // ─── Private ───────────────────────────────────────────────────────────────

  /**
   * Perform the actual save operation.
   */
  private async _doSave(
    reason: 'auto' | 'pre_compact' | 'session_end' | 'manual',
    fullContent?: string
  ): Promise<Drawer[] | null> {
    // Serialize saves to prevent concurrent saves
    if (this.pendingSave) {
      console.log('[AutoSave] Save already in progress, queuing...')
      return this.pendingSave
    }

    this.pendingSave = this._performSave(reason, fullContent)

    try {
      const drawers = await this.pendingSave
      this.pendingSave = null
      return drawers
    } catch (error) {
      this.pendingSave = null
      console.error('[AutoSave] Save failed:', error)
      return null
    }
  }

  private async _performSave(
    reason: string,
    fullContent?: string
  ): Promise<Drawer[]> {
    // Get content to save
    const content = fullContent ?? messagesToContent(this.recentMessages)

    if (content.trim().length < 20) {
      console.log('[AutoSave] Content too short, skipping save')
      return []
    }

    // Extract memories using the classifier
    const extracted = Extractor.extractMemories(content)

    let drawers: Drawer[] = []

    if (extracted.length === 0) {
      // No classified memories — save whole block as a general event
      const drawer = await addDrawer(
        this.config.wing,
        'general',
        content.slice(0, 5000),  // Cap at 5000 chars
        {
          sourceFile: `session:${this.config.sessionId}`,
          addedBy: `auto-save:${reason}`,
        }
      )
      drawers = [drawer]
    } else {
      // Save each extracted memory as a separate drawer
      for (const memory of extracted) {
        const drawer = await addDrawer(
          this.config.wing,
          memory.memoryType,
          memory.content,
          {
            sourceFile: `session:${this.config.sessionId}`,
            addedBy: `auto-save:${reason}`,
            importance: memory.importance,
            emotionalWeight: memory.emotionalWeight,
          }
        )
        drawers.push(drawer)
      }
    }

    // Index into BM25 search
    if (this.config.enableBM25 && drawers.length > 0) {
      for (const drawer of drawers) {
        try {
          indexDrawer(this.search, drawer)
        } catch (error) {
          console.warn('[AutoSave] BM25 indexing failed for drawer:', drawer.id, error)
        }
      }
      console.log(`[AutoSave] Saved ${drawers.length} drawers, indexed to BM25`)
    } else {
      console.log(`[AutoSave] Saved ${drawers.length} drawers`)
    }

    // Update last save count
    this.lastSaveCount = this.messageCount
    this.recentMessages = []  // Clear after save

    this.emit('saved', {
      reason,
      drawerCount: drawers.length,
      drawerIds: drawers.map(d => d.id),
    })

    return drawers
  }
}

// ============================================================================
// Session Store Bridge — wires SessionStore → AutoSave
// ============================================================================

/**
 * Wire AutoSave to a SessionStore instance.
 * Returns a cleanup function.
 */
export function wireSessionStoreToAutoSave(
  sessionStore: {
    appendMessage(opts: any): number
    getSessionMessages(sessionId: string): any[]
    on(event: string, handler: (...args: any[]) => void): void
  },
  config: Partial<AutoSaveConfig> & { sessionId: string }
): { autoSave: AutoSave; cleanup: () => void } {
  const autoSave = new AutoSave({
    ...config,
    extractFromMessages: (sessionId: string) => {
      return sessionStore.getSessionMessages(sessionId).map((m: any) => ({
        role: m.role,
        content: m.content || '',
        timestamp: m.timestamp || Date.now(),
      }))
    },
  })

  // Listen to session store events
  const handleMessage = (msg: any) => {
    if (msg.sessionId === config.sessionId && msg.content) {
      autoSave.onMessage(msg.role, msg.content)
    }
  }

  sessionStore.on('message', handleMessage)

  const cleanup = () => {
    sessionStore.on === sessionStore.removeListener
      ? sessionStore.removeListener('message', handleMessage)
      : sessionStore.off('message', handleMessage)
  }

  return { autoSave, cleanup }
}

// ============================================================================
// Quick helpers
// ============================================================================

/**
 * One-liner to save a piece of text to memory.
 * Does not require starting a session.
 */
export async function quickSave(
  content: string,
  wing: string = 'wing_user',
  room: string = 'general'
): Promise<Drawer[]> {
  const extracted = Extractor.extractMemories(content)
  const drawers: Drawer[] = []
  const search = getGlobalPalaceSearch()

  if (extracted.length === 0) {
    const drawer = await addDrawer(wing, room, content, { addedBy: 'quick-save' })
    drawers.push(drawer)
  } else {
    for (const memory of extracted) {
      const drawer = await addDrawer(wing, memory.memoryType, memory.content, {
        addedBy: 'quick-save',
        importance: memory.importance,
      })
      drawers.push(drawer)
    }
  }

  // Index
  for (const drawer of drawers) {
    try {
      indexDrawer(search, drawer)
    } catch { /* ignore */ }
  }

  return drawers
}
