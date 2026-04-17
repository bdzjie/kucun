/**
 * MemoryManager - 统一记忆管理器
 * =================================
 *
 * 整合所有 Memory 模块组件:
 * - Palace (Wings/Rooms/Drawers)
 * - KnowledgeGraph (Temporal KG)
 * - MemoryStack (4-Layer)
 * - Extractor (记忆分类)
 * - Hooks (生命周期钩子)
 */

import { Palace, addDrawer, searchDrawers, getTaxonomy } from './palace'
import {
  KnowledgeGraph,
  addTriple,
  queryEntity,
  invalidateTriple,
} from './knowledgeGraph'
import {
  MemoryStack,
  getLayer0,
  getLayer1,
  getLayer2,
  searchLayer3,
  wakeUp,
} from './memoryStack'
import { Extractor, extractMemories, classifyText } from './extractor'
import {
  Hooks,
  executeAutoSave,
  executePreCompactSave,
  onSessionStart,
  onSessionEnd,
} from './hooks'

import {
  IMemoryManager,
  Drawer,
  MemoryTaxonomy,
  Triple,
  Layer0Identity,
  Layer1Essential,
  Layer2OnDemand,
  Layer3SearchResult,
  ExtractedMemory,
  DisambiguationResult,
  SearchRequest,
  SearchResult,
  HookEvent,
  HookEventData,
  HookDecision,
  EntityEntry,
  DEFAULT_MEMORY_CONFIG,
  MemoryConfig,
} from './types'

// ============================================================================
// MemoryManager Implementation
// ============================================================================

export class MemoryManager implements IMemoryManager {
  private sessionId: string
  private config: MemoryConfig

  constructor(sessionId: string, config?: Partial<MemoryConfig>) {
    this.sessionId = sessionId
    this.config = { ...DEFAULT_MEMORY_CONFIG, ...config }
  }

  // ── Palace Operations ────────────────────────────────────────────────────

  /**
   * 添加记忆抽屉
   */
  async addDrawer(
    wing: string,
    room: string,
    content: string,
    metadata: {
      sourceFile?: string
      hall?: string
      addedBy?: string
      importance?: number
      emotionalWeight?: number
    } = {}
  ): Promise<Drawer> {
    return addDrawer(wing, room, content, {
      sourceFile: metadata.sourceFile,
      addedBy: metadata.addedBy || this.sessionId,
      importance: metadata.importance,
      emotionalWeight: metadata.emotionalWeight,
    })
  }

  /**
   * 搜索记忆
   */
  async search(request: SearchRequest): Promise<SearchResult[]> {
    return searchDrawers(request)
  }

  /**
   * 获取分类树
   */
  async getTaxonomy(): Promise<MemoryTaxonomy> {
    return getTaxonomy()
  }

  // ── Knowledge Graph Operations ────────────────────────────────────────────

  /**
   * 添加三元组
   */
  async addTriple(
    subject: string,
    predicate: string,
    object: string,
    validFrom?: Date
  ): Promise<Triple> {
    return addTriple(subject, predicate, object, { validFrom })
  }

  /**
   * 查询实体
   */
  async queryEntity(entity: string, asOf?: Date): Promise<Triple[]> {
    return queryEntity(entity, { asOf })
  }

  /**
   * 使三元组失效
   */
  async invalidateTriple(
    subject: string,
    predicate: string,
    object: string
  ): Promise<void> {
    invalidateTriple(subject, predicate, object)
  }

  // ── Memory Stack Operations ───────────────────────────────────────────────

  /**
   * 获取 L0 Identity
   */
  async getLayer0(): Promise<Layer0Identity> {
    return getLayer0()
  }

  /**
   * 获取 L1 Essential Story
   */
  async getLayer1(wing?: string): Promise<Layer1Essential> {
    return getLayer1(wing)
  }

  /**
   * 获取 L2 On-Demand
   */
  async getLayer2(wing?: string, room?: string): Promise<Layer2OnDemand> {
    return getLayer2(wing, room)
  }

  /**
   * 搜索 L3 Deep Search
   */
  async searchLayer3(
    query: string,
    wing?: string,
    room?: string
  ): Promise<Layer3SearchResult> {
    return searchLayer3(query, wing, room)
  }

  /**
   * 完整唤醒
   */
  async wakeUp(wing?: string) {
    return wakeUp(wing)
  }

  // ── Extractor Operations ──────────────────────────────────────────────────

  /**
   * 提取记忆
   */
  async extractMemories(content: string): Promise<ExtractedMemory[]> {
    return extractMemories(content)
  }

  // ── Entity Registry Operations ───────────────────────────────────────────

  /**
   * 检测实体
   */
  async detectEntity(
    name: string,
    context?: string
  ): Promise<DisambiguationResult> {
    return KnowledgeGraph.detectEntity(name, context)
  }

  /**
   * 注册实体
   */
  async registerEntity(entry: EntityEntry): Promise<void> {
    KnowledgeGraph.registerEntity(entry)
  }

  // ── Hook Operations ──────────────────────────────────────────────────────

  /**
   * 触发钩子
   */
  async triggerHook(
    event: HookEvent,
    data?: Partial<HookEventData>
  ): Promise<HookDecision> {
    return Hooks.triggerHook(event, {
      sessionId: this.sessionId,
      ...data,
    })
  }

  // ── Convenience Methods ──────────────────────────────────────────────────

  /**
   * 自动保存
   */
  async autoSave(
    content: string,
    options?: { wing?: string; room?: string }
  ): Promise<Drawer[]> {
    return executeAutoSave(this.sessionId, content, options)
  }

  /**
   * 压缩前保存
   */
  async preCompactSave(
    content: string,
    options?: { wing?: string }
  ): Promise<Drawer[]> {
    return executePreCompactSave(this.sessionId, content, options)
  }

  /**
   * 会话开始
   */
  async sessionStart(): Promise<void> {
    await onSessionStart(this.sessionId)
  }

  /**
   * 会话结束
   */
  async sessionEnd(): Promise<void> {
    await onSessionEnd(this.sessionId)
  }

  /**
   * 快速保存 + 提取
   */
  async saveAndExtract(
    content: string,
    wing = 'session',
    room?: string
  ): Promise<{
    drawers: Drawer[]
    memories: ExtractedMemory[]
  }> {
    // 提取记忆
    const memories = await this.extractMemories(content)

    // 保存
    const drawers: Drawer[] = []

    if (memories.length === 0) {
      // 无分类，整块保存
      const drawer = await this.addDrawer(wing, room || 'general', content)
      drawers.push(drawer)
    } else {
      // 按类型保存
      for (const memory of memories) {
        const drawer = await this.addDrawer(wing, memory.memoryType, memory.content, {
          importance: memory.importance,
          emotionalWeight: memory.importance,
        })
        drawers.push(drawer)
      }
    }

    return { drawers, memories }
  }

  /**
   * 快速查询 + 记忆
   */
  async queryAndRemember(
    query: string,
    wing?: string
  ): Promise<{
    searchResults: SearchResult[]
    kgResults: Triple[]
    layer2?: Layer2OnDemand
  }> {
    const [searchResults, layer2] = await Promise.all([
      this.search({ query, wing, limit: 5 }),
      wing ? this.getLayer2(wing) : Promise.resolve(undefined),
    ])

    // 从搜索结果提取实体并查询 KG
    const kgResults: Triple[] = []
    const entityNames = new Set<string>()

    for (const result of searchResults) {
      // 简单提取大写开头的词作为实体
      const matches = result.drawer.content.match(/[A-Z][a-z]+/g)
      if (matches) {
        matches.forEach(m => entityNames.add(m))
      }
    }

    for (const entity of entityNames) {
      const triples = await this.queryEntity(entity)
      kgResults.push(...triples)
    }

    return { searchResults, kgResults, layer2 }
  }
}

// ============================================================================
// Singleton Factory
// ============================================================================

let globalMemoryManager: MemoryManager | null = null

/**
 * 获取全局 MemoryManager
 */
export function getMemoryManager(sessionId = 'default'): MemoryManager {
  if (!globalMemoryManager) {
    globalMemoryManager = new MemoryManager(sessionId)
  }
  return globalMemoryManager
}

/**
 * 创建新的 MemoryManager
 */
export function createMemoryManager(
  sessionId: string,
  config?: Partial<MemoryConfig>
): MemoryManager {
  return new MemoryManager(sessionId, config)
}

// ============================================================================
// Default Instance
// ============================================================================

export const defaultMemoryManager = new MemoryManager('default')

// ============================================================================
// Export
// ============================================================================

export const Memory = {
  MemoryManager,
  getMemoryManager,
  createMemoryManager,
  defaultMemoryManager,
  // Sub-modules for direct access
  Palace,
  KnowledgeGraph,
  MemoryStack,
  Extractor,
  Hooks,
}

export default Memory
