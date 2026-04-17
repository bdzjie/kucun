/**
 * Hooks - 自动保存钩子系统
 * ===========================
 *
 * 基于 MemPalace 的 Auto-Save Hooks:
 * 1. Save Hook — 每 N 条消息保存一次
 * 2. PreCompact Hook — 上下文压缩前紧急保存
 * 3. Session Hooks — 会话开始/结束
 *
 * 使用方式:
 * - 注入到 AI 会话生命周期
 * - 触发时调用 triggerHook()
 * - 返回决策决定是否阻止/放行
 */

import { EventEmitter } from '../eventEmitter'
import {
  HookEvent,
  HookEventData,
  HookConfig,
  HookState,
  DEFAULT_MEMORY_CONFIG,
  Drawer,
} from './types'
import { Palace, addDrawer } from './palace'
import { MemoryStack } from './memoryStack'
import { Extractor } from './extractor'

// ============================================================================
// Hook State
// ============================================================================

const hookStates = new Map<string, HookState>()

function getHookState(sessionId: string): HookState {
  if (!hookStates.has(sessionId)) {
    hookStates.set(sessionId, {
      lastSaveExchange: 0,
      lastSaveTime: new Date(),
      sessionMessageCount: 0,
      totalSaves: 0,
    })
  }
  return hookStates.get(sessionId)!
}

function updateHookState(
  sessionId: string,
  updates: Partial<HookState>
): void {
  const state = getHookState(sessionId)
  Object.assign(state, updates)
}

// ============================================================================
// Event Emitter
// ============================================================================

const hookEmitter = new EventEmitter()

/**
 * 监听钩子事件
 */
export function onHookEvent(
  event: HookEvent,
  handler: (data: HookEventData) => void | Promise<void>
): () => void {
  return hookEmitter.on(event, handler)
}

/**
 * 触发钩子
 */
export async function triggerHook(
  event: HookEvent,
  data: Partial<HookEventData> & { sessionId: string }
): Promise<HookDecision> {
  const config = DEFAULT_MEMORY_CONFIG.hooks

  const eventData: HookEventData = {
    type: event,
    sessionId: data.sessionId,
    messageCount: data.messageCount,
    reason: data.reason,
    timestamp: new Date(),
  }

  // 触发事件处理器
  await hookEmitter.emit(event, eventData)

  // 根据事件类型返回决策
  switch (event) {
    case 'session_start':
      return { decision: 'allow', reason: 'Session start' }

    case 'session_end':
      return { decision: 'allow', reason: 'Session end' }

    case 'message_count':
      return handleMessageCountHook(eventData, config)

    case 'pre_compact':
      return handlePreCompactHook(eventData, config)

    case 'preempt_save':
      return handlePreemptSaveHook(eventData, config)

    case 'memory_full':
      return { decision: 'block', reason: 'Memory full - save before continuing' }

    default:
      return { decision: 'allow' }
  }
}

// ============================================================================
// Hook Handlers
// ============================================================================

interface HookDecision {
  decision: 'allow' | 'block'
  reason?: string
}

function handleMessageCountHook(
  data: HookEventData,
  config: HookConfig
): HookDecision {
  if (!config.enableAutoSave) {
    return { decision: 'allow' }
  }

  const state = getHookState(data.sessionId)
  state.sessionMessageCount++

  const sinceLast = state.sessionMessageCount - state.lastSaveExchange

  // 达到保存间隔
  if (sinceLast >= config.saveInterval) {
    updateHookState(data.sessionId, {
      lastSaveExchange: state.sessionMessageCount,
      lastSaveTime: new Date(),
      totalSaves: state.totalSaves + 1,
    })

    return {
      decision: 'block',
      reason: buildSaveReason(data.sessionId),
    }
  }

  return { decision: 'allow' }
}

function handlePreCompactHook(
  data: HookEventData,
  config: HookConfig
): HookDecision {
  if (!config.enablePreCompact) {
    return { decision: 'allow' }
  }

  const state = getHookState(data.sessionId)

  // 总是阻止压缩前保存
  return {
    decision: 'block',
    reason: buildPreCompactReason(data.sessionId),
  }
}

function handlePreemptSaveHook(
  data: HookEventData,
  config: HookConfig
): HookDecision {
  const state = getHookState(data.sessionId)

  return {
    decision: 'block',
    reason: buildSaveReason(data.sessionId),
  }
}

// ============================================================================
// Save Reasons (AI 看到的提示)
// ============================================================================

function buildSaveReason(sessionId: string): string {
  return `AUTO-SAVE checkpoint. Save key topics, decisions, quotes, and code from this session to your memory system. Organize into appropriate categories (wing/room). Use verbatim quotes where possible. Continue conversation after saving.`
}

function buildPreCompactReason(sessionId: string): string {
  return `COMPACTION IMMINENT. Save ALL topics, decisions, quotes, code, and important context from this session to your memory system. Be thorough — after compaction, detailed context will be lost. Organize into appropriate categories. Use verbatim quotes where possible. Save everything, then allow compaction to proceed.`
}

// ============================================================================
// Auto-Save Actions (实际保存逻辑)
// ============================================================================

/**
 * 执行自动保存
 */
export async function executeAutoSave(
  sessionId: string,
  content: string,
  metadata: {
    wing?: string
    room?: string
    sourceFile?: string
    addedBy?: string
  } = {}
): Promise<Drawer[]> {
  const wing = metadata.wing || 'session'
  const room = metadata.room || 'general'

  // 提取记忆
  const memories = Extractor.extractMemories(content)

  if (memories.length === 0) {
    // 没有识别出类型，整块保存
    const drawer = await addDrawer(wing, room, content, {
      sourceFile: metadata.sourceFile || `session:${sessionId}`,
      addedBy: metadata.addedBy || 'auto-save',
    })
    return [drawer]
  }

  // 按类型保存
  const drawers: Drawer[] = []

  for (const memory of memories) {
    const drawer = await addDrawer(
      wing,
      memory.memoryType,
      memory.content,
      {
        sourceFile: metadata.sourceFile || `session:${sessionId}`,
        addedBy: metadata.addedBy || 'auto-save',
        importance: memory.importance,
        emotionalWeight: memory.importance,
      }
    )
    drawers.push(drawer)
  }

  // 更新状态
  const state = getHookState(sessionId)
  state.lastSaveExchange = state.sessionMessageCount
  state.lastSaveTime = new Date()
  state.totalSaves++

  return drawers
}

/**
 * 执行压缩前保存
 */
export async function executePreCompactSave(
  sessionId: string,
  content: string,
  options: {
    wing?: string
    addedBy?: string
  } = {}
): Promise<Drawer[]> {
  // 提取所有类型的记忆
  const memories = Extractor.extractMemories(content, {
    includeCode: true, // 压缩前保存全部内容
  })

  if (memories.length === 0) {
    // 整块保存
    return executeAutoSave(sessionId, content, options)
  }

  // 全部保存，不分类
  const drawers: Drawer[] = []

  for (const memory of memories) {
    const drawer = await addDrawer(
      options.wing || 'session',
      memory.memoryType,
      memory.content,
      {
        sourceFile: `precompact:${sessionId}`,
        addedBy: options.addedBy || 'pre-compact',
        importance: memory.importance || 5, // 压缩前保存标记为高重要性
      }
    )
    drawers.push(drawer)
  }

  return drawers
}

// ============================================================================
// Lifecycle Helpers
// ============================================================================

/**
 * 会话开始
 */
export async function onSessionStart(sessionId: string): Promise<void> {
  // 初始化状态
  getHookState(sessionId)

  // 加载 L0 + L1
  const stack = await MemoryStack.wakeUp()
  console.log(`[Hooks] Session ${sessionId} started. Wake-up tokens: ${stack.totalTokens}`)

  // 触发事件
  await triggerHook('session_start', { sessionId })
}

/**
 * 会话结束
 */
export async function onSessionEnd(sessionId: string): Promise<void> {
  const state = getHookState(sessionId)

  console.log(
    `[Hooks] Session ${sessionId} ended. Total saves: ${state.totalSaves}, ` +
    `Messages: ${state.sessionMessageCount}`
  )

  // 清理状态
  hookStates.delete(sessionId)

  // 触发事件
  await triggerHook('session_end', { sessionId })
}

/**
 * 消息计数
 */
export async function onMessageCount(
  sessionId: string,
  count: number
): Promise<HookDecision> {
  return triggerHook('message_count', { sessionId, messageCount: count })
}

/**
 * 压缩前回调
 */
export async function onPreCompact(
  sessionId: string
): Promise<HookDecision> {
  return triggerHook('pre_compact', { sessionId })
}

/**
 * 获取会话状态
 */
export function getSessionHookState(sessionId: string): HookState | undefined {
  return hookStates.get(sessionId)
}

// ============================================================================
// Hook Manager (管理器)
// ============================================================================

/**
 * 创建 Hook Manager
 */
export function createHookManager(sessionId: string) {
  return {
    // 生命周期
    start: () => onSessionStart(sessionId),
    end: () => onSessionEnd(sessionId),

    // 消息触发
    onMessage: (content: string) => onMessageCount(sessionId, 1),

    // 保存操作
    save: (content: string, options?: { wing?: string; room?: string }) =>
      executeAutoSave(sessionId, content, options),

    preCompactSave: (content: string, options?: { wing?: string }) =>
      executePreCompactSave(sessionId, content, options),

    // 状态查询
    getState: () => getSessionHookState(sessionId),

    // 事件监听
    on: (event: HookEvent, handler: (data: HookEventData) => void) =>
      onHookEvent(event, handler),

    // 触发器
    trigger: (event: HookEvent, data?: Partial<HookEventData>) =>
      triggerHook(event, { sessionId, ...data }),
  }
}

export type HookManager = ReturnType<typeof createHookManager>

// ============================================================================
// Export
// ============================================================================

export const Hooks = {
  // Core
  triggerHook,
  onHookEvent,
  // Execution
  executeAutoSave,
  executePreCompactSave,
  // Lifecycle
  onSessionStart,
  onSessionEnd,
  onMessageCount,
  onPreCompact,
  // State
  getSessionHookState,
  createHookManager,
}

export default Hooks
