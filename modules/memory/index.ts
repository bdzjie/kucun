/**
 * Memory Module - MemPalace 风格记忆系统
 * =======================================
 *
 * 整合 MemPalace 核心概念到 OpenClaw:
 *
 * 1. Palace - 记忆宫殿 (Wings/Rooms/Drawers)
 * 2. KnowledgeGraph - 时态知识图谱
 * 3. MemoryStack - 4层记忆栈
 * 4. Extractor - 通用记忆提取器
 * 5. Hooks - 自动保存钩子
 * 6. MemoryManager - 统一管理器
 *
 * 使用示例:
 *
 * ```typescript
 * import { Memory, MemoryManager, Palace, KnowledgeGraph } from './modules/memory'
 *
 * // 使用 MemoryManager (推荐)
 * const memory = new MemoryManager('session-123')
 *
 * // 保存记忆
 * await memory.addDrawer('project-x', 'auth', 'Decided to use Clerk for auth')
 *
 * // 搜索
 * const results = await memory.search({ query: 'auth decision' })
 *
 * // 查询知识图谱
 * await memory.addTriple('Kai', 'works_on', 'Orion')
 * const facts = await memory.queryEntity('Kai')
 *
 * // 唤醒 - 获取 L0 + L1
 * const stack = await memory.wakeUp()
 *
 * // 提取记忆类型
 * const memories = await memory.extractMemories('We decided to use Postgres...')
 *
 * // 自动保存钩子
 * memory.onSessionStart()
 * const decision = await memory.triggerHook('message_count', { messageCount: 15 })
 * ```
 */

// Main Manager
export {
  MemoryManager,
  getMemoryManager,
  createMemoryManager,
  defaultMemoryManager,
  Memory,
} from './memoryManager'

// Palace
export {
  Palace,
  addDrawer,
  addDrawerBulk,
  getDrawer,
  deleteDrawer,
  getAllDrawers,
  getDrawersByWing,
  getDrawersByRoom,
  searchDrawers,
  getTaxonomy,
  listWings,
  listRooms,
  checkDuplicate,
  getGraphStats,
} from './palace'

// Knowledge Graph
export {
  KnowledgeGraph,
  addEntity,
  getEntity,
  getAllEntities,
  hasEntity,
  addTriple,
  invalidateTriple,
  queryEntity,
  queryRelationship,
  timeline,
  getKGStats,
  registerEntity,
  lookupEntity,
  detectEntity,
  registerEntities,
  seedFromFacts,
  RELATIONSHIP_TYPES,
} from './knowledgeGraph'

// Memory Stack
export {
  MemoryStack,
  getLayer0,
  setLayer0,
  getLayer1,
  getLayer2,
  searchLayer3,
  searchLayer3Raw,
  wakeUp,
  getFullStack,
  estimateTokens,
  fitsBudget,
} from './memoryStack'

// Extractor
export {
  Extractor,
  extractMemories,
  classifyText,
  getSentiment,
  hasResolution,
  isCodeLine,
  extractProse,
  chunkText,
} from './extractor'

// Hooks
export {
  Hooks,
  triggerHook,
  onHookEvent,
  executeAutoSave,
  executePreCompactSave,
  onSessionStart,
  onSessionEnd,
  onMessageCount,
  onPreCompact,
  getSessionHookState,
  createHookManager,
} from './hooks'

// Types
export type {
  // Palace
  Wing,
  Room,
  HallType,
  Drawer,
  MemoryTaxonomy,
  WingInfo,
  RoomInfo,
  // Knowledge Graph
  Entity,
  Triple,
  KGStats,
  EntityType,
  EntityEntry,
  DisambiguationResult,
  TemporalQuery,
  // Memory Stack
  Layer0Identity,
  Layer1Essential,
  Layer2OnDemand,
  Layer3SearchResult,
  SearchHit,
  MemoryStack as MemoryStackType,
  // Extractor
  MemoryType,
  ExtractedMemory,
  ExtractorConfig,
  // Hooks
  HookEvent,
  HookConfig,
  HookState,
  HookEventData,
  HookDecision,
  HookManager,
  // Search
  SearchRequest,
  SearchResult,
  TraverseRequest,
  // Config
  MemoryConfig,
  IMemoryManager,
} from './types'

// Constants
export { DEFAULT_MEMORY_CONFIG } from './types'

// ============================================================================
// Quick Start Guide
// ============================================================================

/**
 * 快速开始
 *
 * ```typescript
 * import { MemoryManager, extractMemories, addTriple } from './modules/memory'
 *
 * // 1. 创建 Manager
 * const memory = new MemoryManager('my-session')
 *
 * // 2. 初始化会话
 * await memory.sessionStart()
 *
 * // 3. 保存记忆
 * await memory.addDrawer('project-x', 'architecture', 'Using microservices')
 * await memory.addDrawer('project-x', 'decision', 'Chose Postgres over MySQL')
 *
 * // 4. 提取记忆类型
 * const memories = await memory.extractMemories('We decided to switch to...')
 * memories.forEach(m => console.log(m.memoryType, m.content))
 *
 * // 5. 知识图谱
 * await memory.addTriple('Team', 'decided', 'Microservices', new Date())
 * const facts = await memory.queryEntity('Team')
 *
 * // 6. 唤醒
 * const { layer0, layer1, totalTokens } = await memory.wakeUp()
 * console.log(`Loaded ${totalTokens} tokens`)
 *
 * // 7. 搜索
 * const results = await memory.search({ query: 'database decision' })
 *
 * // 8. 钩子触发
 * const decision = await memory.triggerHook('pre_compact')
 * if (decision.decision === 'block') {
 *   await memory.preCompactSave(conversationContent)
 * }
 *
 * // 9. 结束会话
 * await memory.sessionEnd()
 * ```
 */

// ============================================================================
// Integration with Other Modules
// ============================================================================

/**
 * 与 Context 模块集成
 *
 * ```typescript
 * import { MemoryManager } from './modules/memory'
 * import { defaultContextManager } from './modules/context'
 *
 * const memory = new MemoryManager('session')
 *
 * // 唤醒时加载 L0 + L1 到上下文
 * async function onWakeUp(wing?: string) {
 *   const { layer0, layer1 } = await memory.wakeUp(wing)
 *
 *   // 添加到上下文
 *   defaultContextManager.addSystemMessage(layer0.content)
 *   defaultContextManager.addSystemMessage(layer1.content)
 * }
 *
 * // 压缩前保存
 * async function onPreCompact() {
 *   const messages = defaultContextManager.getMessages()
 *   const content = messages.map(m => m.content).join('\n')
 *   await memory.preCompactSave(content)
 * }
 * ```
 */

/**
 * 与 Analytics 模块集成
 *
 * ```typescript
 * import { MemoryManager } from './modules/memory'
 * import { globalAnalytics, track } from './modules/analytics'
 *
 * const memory = new MemoryManager('session')
 *
 * // 追踪记忆操作
 * memory.onHookEvent('pre_compact', async () => {
 *   track('memory_pre_compact_save', {
 *     sessionId: '...',
 *   })
 * })
 *
 * // 记忆使用分析
 * const taxonomy = await memory.getTaxonomy()
 * track('memory_taxonomy', {
 *   totalDrawers: taxonomy.totalDrawers,
 *   wingCount: Object.keys(taxonomy.wings).length,
 * })
 * ```
 */

// ============================================================================
// File Structure
// ============================================================================

/**
 * modules/memory/
 *
 * ├── types.ts          # 所有类型定义
 * ├── palace.ts         # 记忆宫殿 (Wings/Rooms/Drawers)
 * ├── knowledgeGraph.ts  # 时态知识图谱
 * ├── memoryStack.ts    # 4层记忆栈
 * ├── extractor.ts      # 通用记忆提取器
 * ├── hooks.ts          # 自动保存钩子
 * ├── memoryManager.ts  # 统一管理器
 * └── index.ts          # 导出
 */
