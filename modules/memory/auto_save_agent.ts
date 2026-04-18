/**
 * auto_save_agent.ts — AutoSave-wired AIAgent
 * ===========================================
 *
 * 将 AutoSave 系统接入 AIAgent 的最简方式:
 *
 * ```typescript
 * import { createAutoSaveAgent } from './modules/memory/auto_save_agent'
 *
 * // 创建带 AutoSave 的 Agent
 * const agent = createAutoSaveAgent({
 *   sessionId: 'my-session',
 *   model: 'claude-sonnet',
 *   provider: 'anthropic',
 * })
 *
 * // 运行 — 每次 turn 自动保存
 * const result = await agent.run('帮我写一个 WebSocket 服务器')
 *
 * // 结束会话时自动保存
 * await agent.end()
 * ```
 *
 * 或者在现有 Agent 上注入 AutoSave 回调:
 *
 * ```typescript
 * import { createAutoSaveCallbacks } from './modules/memory/auto_save_agent'
 *
 * const agent = createAgent(config, {
 *   ...createAutoSaveCallbacks({ sessionId: 'my-session' }),
 *   onTurnEnd: (turn) => { /* your logic */ },
 * })
 * ```
 */

import { AIAgent, createAgent, type AgentConfig, type AgentCallbacks, type Turn, type ToolResult } from '../agent/agent'
import { AutoSave, quickSave } from './auto_save_integration'
import { globalSessionStore } from '../search/sessionSearch'
import { addDrawer } from './palace'
import { getGlobalPalaceSearch, indexDrawer } from '../search/palace_search'
import type { Drawer } from './types'

// ============================================================================
// AutoSave Callbacks Factory
// ============================================================================

export interface AutoSaveCallbacksConfig {
  /** 会话 ID (用于 wing/room 命名) */
  sessionId: string
  /** 保存到的 wing */
  wing?: string
  /** 每多少条消息保存一次 */
  saveInterval?: number
  /** 是否启用 BM25 索引 */
  enableBM25?: boolean
  /** 会话结束时是否保存 */
  saveOnEnd?: boolean
  /** 压缩前是否保存 */
  saveOnPreCompact?: boolean
  /** 自定义 Agent 回调 (会与 AutoSave 合并) */
  customCallbacks?: AgentCallbacks
}

/**
 * 创建 AutoSave 回调对象，可与 createAgent 一起使用:
 *
 *   createAgent(config, {
 *     ...createAutoSaveCallbacks({ sessionId: 's1' }),
 *     onTurnEnd: myHandler,
 *   })
 */
export function createAutoSaveCallbacks(
  config: AutoSaveCallbacksConfig
): AgentCallbacks {
  // Lazy-initialized AutoSave instance per sessionId
  const autoSaveMap = new Map<string, AutoSave>()

  function getAutoSave(sessionId: string): AutoSave {
    if (!autoSaveMap.has(sessionId)) {
      autoSaveMap.set(sessionId, new AutoSave({
        sessionId,
        wing: config.wing || 'wing_user',
        saveInterval: config.saveInterval ?? 10,
        enableBM25: config.enableBM25 ?? true,
        saveOnEnd: config.saveOnEnd ?? true,
        saveOnPreCompact: config.saveOnPreCompact ?? true,
      }))
    }
    return autoSaveMap.get(sessionId)!
  }

  const turnCounter = new Map<string, number>()

  return {
    onTurnStart(turn: Turn) {
      const as = getAutoSave(config.sessionId)
      const count = (turnCounter.get(config.sessionId) || 0) + 1
      turnCounter.set(config.sessionId, count)
      as.onMessage('user', turn.userMessage || '').catch(console.warn)
    },

    onTurnEnd(turn: Turn) {
      const as = getAutoSave(config.sessionId)
      // Count assistant responses in this turn
      if (turn.assistantMessage) {
        as.onMessage('assistant', turn.assistantMessage).catch(console.warn)
      }
      // Also save any tool results that might contain important info
      for (const tool of turn.tools || []) {
        if (tool.result && typeof tool.result === 'string') {
          if (tool.result.length > 50) {
            as.onMessage('tool', tool.result).catch(console.warn)
          }
        }
      }
    },

    onToolCallEnd(toolCall: ToolCall, result: ToolResult) {
      // Tools with significant output are worth saving
      const output = result.output || ''
      if (output.length > 200) {
        const as = getAutoSave(config.sessionId)
        as.onMessage('tool', `[${toolCall.name}]: ${output}`).catch(console.warn)
      }
    },

    async onInterrupt() {
      // On interrupt, save everything before the interrupt context is lost
      const as = getAutoSave(config.sessionId)
      await as.onPreCompact('[interrupt — context about to be lost]')
    },

    onStatusChange(status) {
      if (status === 'completed' || status === 'error') {
        // End all active AutoSave sessions
        for (const [, as] of autoSaveMap) {
          as.end().catch(console.warn)
        }
        autoSaveMap.clear()
      }
    },

    // Chain to custom callbacks
    ...(config.customCallbacks && {
      onThinkingStart: config.customCallbacks.onThinkingStart,
      onThinkingEnd: config.customCallbacks.onThinkingEnd,
      onToolCallStart: config.customCallbacks.onToolCallStart,
      onToolCallEnd: (turn, result) => {
        config.customCallbacks!.onToolCallEnd?.(turn, result)
      },
      onTurnStart: (turn) => {
        config.customCallbacks!.onTurnStart?.(turn)
      },
      onTurnEnd: (turn) => {
        config.customCallbacks!.onTurnEnd?.(turn)
      },
      onError: config.customCallbacks.onError,
      onInterrupt: config.customCallbacks.onInterrupt,
      onStatusChange: (status) => {
        config.customCallbacks!.onStatusChange?.(status)
      },
    }),
  }
}

// ============================================================================
// Convenience: Create pre-wired Agent
// ============================================================================

/**
 * 创建已接入 AutoSave 的 AIAgent。
 *
 * 相当于:
 *   createAgent(config, createAutoSaveCallbacks({ sessionId, ... }))
 */
export function createAutoSaveAgent(
  config: AgentConfig,
  autoSaveConfig: Omit<AutoSaveCallbacksConfig, 'customCallbacks'>
): AIAgent {
  const callbacks = createAutoSaveCallbacks({
    ...autoSaveConfig,
    customCallbacks: config.callbacks,
  })

  return new AIAgent(
    { ...config, callbacks: undefined },  // callbacks passed separately
    callbacks
  )
}

// ============================================================================
// Session persistence helpers
// ============================================================================

/**
 * 将会话消息从 SessionStore 迁移到 Memory Palace。
 * 用于在服务重启后重建记忆。
 */
export async function migrateSessionToMemory(
  sessionId: string,
  wing: string = 'wing_user'
): Promise<Drawer[]> {
  try {
    const messages = (globalSessionStore as any).messages.get(sessionId) || []
    if (messages.length === 0) return []

    const drawers: Drawer[] = []

    // Group consecutive messages from same role into chunks
    let currentRole = ''
    let currentContent: string[] = []

    for (const msg of messages) {
      if (msg.role === currentRole && msg.content) {
        currentContent.push(msg.content)
      } else {
        // Save previous group
        if (currentContent.length > 0) {
          const drawer = await addDrawer(wing, 'sessions', currentContent.join('\n'), {
            sourceFile: `session://${sessionId}`,
            hall: 'hall_events',
            addedBy: 'migrate',
          })
          drawers.push(drawer)
          indexDrawer(getGlobalPalaceSearch(), drawer)
        }
        currentRole = msg.role || 'unknown'
        currentContent = msg.content ? [msg.content] : []
      }
    }

    // Don't forget last group
    if (currentContent.length > 0) {
      const drawer = await addDrawer(wing, 'sessions', currentContent.join('\n'), {
        sourceFile: `session://${sessionId}`,
        hall: 'hall_events',
        addedBy: 'migrate',
      })
      drawers.push(drawer)
      indexDrawer(getGlobalPalaceSearch(), drawer)
    }

    console.log(`[AutoSave] Migrated ${messages.length} messages → ${drawers.length} drawers`)
    return drawers
  } catch (error) {
    console.error('[AutoSave] Migration failed:', error)
    return []
  }
}

/**
 * 从会话 ID 列表批量迁移到 Memory Palace。
 */
export async function migrateAllSessionsToMemory(
  sessionIds: string[],
  wing: string = 'wing_user'
): Promise<Map<string, Drawer[]>> {
  const results = new Map<string, Drawer[]>()

  for (const sessionId of sessionIds) {
    const drawers = await migrateSessionToMemory(sessionId, wing)
    results.set(sessionId, drawers)
  }

  return results
}
