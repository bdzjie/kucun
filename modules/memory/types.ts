/**
 * Memory Module Types - MemPalace 风格记忆系统
 * =============================================
 *
 * 整合 MemPalace 的核心概念:
 * - Palace 结构 (Wings/Rooms/Drawers)
 * - Temporal Knowledge Graph
 * - 4-Layer Memory Stack
 * - General Extractor (5种记忆类型)
 * - Entity Registry (实体消解)
 */

// ============================================================================
// Palace Structure (宫殿结构)
// ============================================================================

/** Wing - 人或项目 */
export interface Wing {
  name: string
  description?: string
  createdAt: Date
  updatedAt: Date
  drawerCount: number
}

/** Room - 具体主题 */
export interface Room {
  name: string
  wing: string
  description?: string
  keywords: string[]
  drawerCount: number
}

/** Hall - 记忆类型走廊 */
export type HallType =
  | 'hall_facts'      // 决策
  | 'hall_events'     // 事件
  | 'hall_discoveries' // 发现
  | 'hall_preferences' // 偏好
  | 'hall_advice'     // 建议

/** Drawer - 原始记忆块 */
export interface Drawer {
  id: string
  wing: string
  room: string
  hall?: HallType
  content: string           // verbatim 原文
  sourceFile?: string       // 来源文件
  chunkIndex: number        // 分块索引
  addedBy: string          // 添加者
  filedAt: Date
  importance?: number       // 重要性 1-5
  emotionalWeight?: number  // 情感权重
}

/** Memory Taxonomy - 完整分类树 */
export interface MemoryTaxonomy {
  wings: Record<string, WingInfo>
  rooms: Record<string, RoomInfo>
  totalDrawers: number
}

export interface WingInfo {
  name: string
  drawerCount: number
  rooms: Record<string, number>
}

export interface RoomInfo {
  name: string
  wing: string
  drawerCount: number
}

// ============================================================================
// Knowledge Graph (时态知识图谱)
// ============================================================================

/** Entity - 实体节点 */
export interface Entity {
  id: string
  name: string
  type: EntityType
  properties?: Record<string, unknown>
  createdAt: Date
}

export type EntityType =
  | 'person'
  | 'project'
  | 'concept'
  | 'tool'
  | 'event'
  | 'preference'
  | 'unknown'

/** Triple - 关系三元组 (时态) */
export interface Triple {
  id: string
  subject: string
  predicate: string
  object: string
  validFrom?: Date          // 生效时间
  validTo?: Date            // 失效时间 (null = 当前有效)
  confidence: number        // 置信度 0-1
  sourceCloset?: string     // 来源抽屉
  sourceFile?: string
  extractedAt: Date
}

/** Temporal Query - 时间点查询 */
export interface TemporalQuery {
  entity: string
  asOf?: Date               // 查询的时间点
  direction?: 'outgoing' | 'incoming' | 'both'
}

/** KG Stats - 知识图谱统计 */
export interface KGStats {
  entities: number
  triples: number
  currentFacts: number
  expiredFacts: number
  relationshipTypes: string[]
}

// ============================================================================
// 4-Layer Memory Stack (4层记忆栈)
// ============================================================================

/** Layer 0 - Identity (身份, ~50 tokens) */
export interface Layer0Identity {
  content: string
  tokenEstimate: number
}

/** Layer 1 - Essential Story (关键事实, ~500-800 tokens) */
export interface Layer1Essential {
  content: string
  tokenEstimate: number
  drawerCount: number
  rooms: string[]
}

/** Layer 2 - On-Demand (按需加载, ~200-500 tokens) */
export interface Layer2OnDemand {
  content: string
  tokenEstimate: number
  drawerCount: number
  wing?: string
  room?: string
}

/** Layer 3 - Deep Search (深度搜索) */
export interface Layer3SearchResult {
  query: string
  results: SearchHit[]
  totalResults: number
}

export interface SearchHit {
  drawer: Drawer
  similarity: number
  room: string
  wing: string
}

/** Memory Stack - 完整4层栈 */
export interface MemoryStack {
  layer0: Layer0Identity
  layer1: Layer1Essential
  layer2?: Layer2OnDemand
  layer3?: Layer3SearchResult
  totalTokens: number
}

// ============================================================================
// General Extractor (5种记忆类型)
// ============================================================================

/** 5种记忆类型 */
export type MemoryType =
  | 'decision'     // 决策
  | 'preference'   // 偏好
  | 'milestone'    // 里程碑
  | 'problem'      // 问题
  | 'emotional'    // 情感
  | 'general'      // 通用

/** 提取的记忆块 */
export interface ExtractedMemory {
  content: string
  memoryType: MemoryType
  chunkIndex: number
  confidence: number
  markers: string[]           // 匹配的标记词
  sentiment?: 'positive' | 'negative' | 'neutral'
  importance?: number
}

/** Extractor 配置 */
export interface ExtractorConfig {
  minChunkSize: number
  maxChunkSize: number
  includeCode: boolean
  sentimentAnalysis: boolean
}

// ============================================================================
// Entity Registry (实体注册表)
// ============================================================================

/** 实体来源 */
export type EntitySource = 'onboarding' | 'learned' | 'researched'

/** 实体条目 */
export interface EntityEntry {
  name: string
  type: EntityType
  confidence: number         // 0-1
  source: EntitySource
  aliases?: string[]        // 别名
  properties?: Record<string, unknown>
}

/** 歧义消解结果 */
export interface DisambiguationResult {
  isEntity: boolean
  type?: EntityType
  confidence?: number
  source?: EntitySource
  requiresContext?: boolean
  contextPatterns?: string[]
}

// ============================================================================
// Auto-Save Hooks (自动保存钩子)
// ============================================================================

/** Hook 事件类型 */
export type HookEvent =
  | 'session_start'      // 会话开始
  | 'session_end'        // 会话结束
  | 'message_count'      // 消息计数触发
  | 'pre_compact'        // 压缩前
  | 'preempt_save'       // 抢占保存
  | 'memory_full'        // 记忆满

/** Hook 配置 */
export interface HookConfig {
  saveInterval: number              // 多少条消息保存一次
  enablePreCompact: boolean         // 启用压缩前保存
  enableAutoSave: boolean          // 启用自动保存
  maxDrawersPerSession: number     // 每会话最大抽屉数
  hooksDir?: string                // 钩子脚本目录
}

/** Hook 状态 */
export interface HookState {
  lastSaveExchange: number
  lastSaveTime: Date
  sessionMessageCount: number
  totalSaves: number
}

/** Hook 事件 */
export interface HookEventData {
  type: HookEvent
  sessionId: string
  messageCount?: number
  reason?: string
  timestamp: Date
}

// ============================================================================
// Palace Config (宫殿配置)
// ============================================================================

/** 默认配置 */
export const DEFAULT_MEMORY_CONFIG: MemoryConfig = {
  palacePath: '~/.openclaw/memory/palace',
  maxDrawerSize: 800,           // chars
  drawerOverlap: 100,            // chars
  minChunkSize: 50,
  maxFileSize: 10 * 1024 * 1024, // 10MB
  maxDrawersPerWing: 10000,
  defaultWing: 'default',
  autoCreateWings: true,
  enableTemporalKG: true,
  enableAAAK: false,            // AAAK 默认关闭
  layer0Path: '~/.openclaw/memory/identity.txt',
  hooks: {
    saveInterval: 15,
    enablePreCompact: true,
    enableAutoSave: true,
    maxDrawersPerSession: 100,
  },
}

export interface MemoryConfig {
  palacePath: string
  maxDrawerSize: number
  drawerOverlap: number
  minChunkSize: number
  maxFileSize: number
  maxDrawersPerWing: number
  defaultWing: string
  autoCreateWings: boolean
  enableTemporalKG: boolean
  enableAAAK: boolean
  layer0Path: string
  hooks: HookConfig
}

// ============================================================================
// Search & Query (搜索查询)
// ============================================================================

/** 搜索请求 */
export interface SearchRequest {
  query: string
  wing?: string
  room?: string
  hall?: HallType
  memoryType?: MemoryType
  limit?: number
  threshold?: number          // 相似度阈值
}

/** 搜索结果 */
export interface SearchResult {
  drawer: Drawer
  similarity: number
  highlight?: string          // 高亮片段
}

/** 图遍历请求 */
export interface TraverseRequest {
  startRoom: string
  maxHops?: number
  wingFilter?: string[]
}

// ============================================================================
// Memory Manager (记忆管理器 - 统一接口)
// ============================================================================

export interface IMemoryManager {
  // Palace 操作
  addDrawer(wing: string, room: string, content: string, metadata?: Partial<Drawer>): Promise<Drawer>
  search(request: SearchRequest): Promise<SearchResult[]>
  getTaxonomy(): Promise<MemoryTaxonomy>
  
  // Knowledge Graph 操作
  addTriple(subject: string, predicate: string, object: string, validFrom?: Date): Promise<Triple>
  queryEntity(entity: string, asOf?: Date): Promise<Triple[]>
  invalidateTriple(subject: string, predicate: string, object: string): Promise<void>
  
  // Memory Stack
  getLayer0(): Promise<Layer0Identity>
  getLayer1(wing?: string): Promise<Layer1Essential>
  getLayer2(wing?: string, room?: string): Promise<Layer2OnDemand>
  searchLayer3(query: string, wing?: string, room?: string): Promise<Layer3SearchResult>
  wakeUp(wing?: string): Promise<MemoryStack>
  
  // Extractor
  extractMemories(content: string): Promise<ExtractedMemory[]>
  
  // Entity Registry
  detectEntity(name: string, context?: string): Promise<DisambiguationResult>
  registerEntity(entry: EntityEntry): Promise<void>
  
  // Hooks
  triggerHook(event: HookEvent, data?: Partial<HookEventData>): Promise<void>
}
