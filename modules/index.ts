/**
 * OpenClaw Core Modules
 * 六大进化方向完整实现
 *
 * 包含：
 * 1. Permission - 权限系统
 * 2. Context - 上下文管理
 * 3. Registry - 工具注册表
 * 4. Coordinator - 多 Agent 协调
 * 5. Analytics - 分析系统
 * 6. Transport - 传输层
 */

// Permission Module
export {
  PermissionManager,
  defaultPermissionManager,
  checkPermission,
  checkPermissionSync,
  RiskAssessor,
  defaultRiskAssessor,
  assessRisk,
  PermissionMode,
  type PermissionContext,
  type RiskLevel,
  type PermissionDecision,
  type PermissionRule,
  type ToolCategory,
} from './permission'

// Memory Module (MemPalace 风格)
export {
  MemoryManager,
  getMemoryManager,
  createMemoryManager,
  defaultMemoryManager,
  Memory,
  Palace,
  KnowledgeGraph,
  MemoryStack,
  Extractor,
  Hooks,
  DEFAULT_MEMORY_CONFIG,
  type Wing,
  type Room,
  type HallType,
  type Drawer,
  type MemoryTaxonomy,
  type WingInfo,
  type RoomInfo,
  type Entity,
  type Triple,
  type KGStats,
  type EntityType,
  type EntityEntry,
  type DisambiguationResult,
  type Layer0Identity,
  type Layer1Essential,
  type Layer2OnDemand,
  type Layer3SearchResult,
  type SearchHit,
  type MemoryType,
  type ExtractedMemory,
  type HookEvent,
  type HookConfig,
  type HookState,
  type HookDecision,
  type HookManager,
  type SearchRequest,
  type SearchResult,
  type IMemoryManager,
  type MemoryConfig,
} from './memory'

// Context Module
export {
  ContextManager,
  defaultContextManager,
  DefaultCompactionStrategy,
  addUserMessage,
  addAssistantMessage,
  getMessages,
  getContextUsage,
  type ContextBudget,
  type Message,
  type CompactionResult,
  type CompactionStrategy,
} from './context'

// Registry Module
export {
  ToolRegistry,
  globalToolRegistry,
  registerTool,
  getTool,
  executeTool,
  listTools,
  type Tool,
  type ToolCategory,
  type ToolContext,
  type ToolResult,
} from './registry'

// Coordinator Module
export {
  Coordinator,
  defaultCoordinator,
  createTask,
  executeTask,
  registerAgent,
  type Agent,
  type AgentConfig,
  type Task,
  type TaskType,
  type AgentType,
  type TaskStatus,
} from './coordinator'

// Analytics Module
export {
  AnalyticsManager,
  globalAnalytics,
  track,
  feature,
  getFeatureValue,
  trackToolUse,
  trackApiRequest,
  type AnalyticsEvent,
  type FeatureFlag,
  type Experiment,
} from './analytics'

// Transport Module
export {
  BaseTransport,
  WebSocketTransport,
  HttpTransport,
  createTransport,
  createDefaultTransport,
  type TransportConfig,
  type Message,
  type ReconnectStrategy,
} from './transport'

// EventEmitter (shared)
export { EventEmitter } from './eventEmitter'

// ============================================================================
// Quick Start Guide
// ============================================================================

/**
 * OpenClaw 核心模块快速开始
 *
 * ```typescript
 * import {
 *   // 权限系统
 *   checkPermission,
 *   PermissionMode,
 *
 *   // 上下文管理
 *   defaultContextManager,
 *   addUserMessage,
 *   getContextUsage,
 *
 *   // 工具注册表
 *   globalToolRegistry,
 *   registerTool,
 *   executeTool,
 *
 *   // 多 Agent 协调
 *   defaultCoordinator,
 *   createTask,
 *   registerAgent,
 *
 *   // 分析系统
 *   globalAnalytics,
 *   track,
 *   feature,
 *
 *   // 传输层
 *   createDefaultTransport,
 * } from './modules'
 *
 * // 1. 权限检查
 * const decision = await checkPermission({
 *   tool: 'Bash',
 *   input: { command: 'ls' },
 *   timestamp: Date.now(),
 *   riskLevel: 'medium',
 *   category: 'process',
 * })
 *
 * // 2. 上下文管理
 * defaultContextManager.addUserMessage('Hello')
 * const usage = getContextUsage()
 * console.log(`使用: ${usage.percent * 100}%`)
 *
 * // 3. 工具注册表
 * registerTool({
 *   name: 'MyTool',
 *   description: 'My custom tool',
 *   category: 'other',
 *   riskLevel: 'low',
 *   execute: async (input) => ({ success: true, output: input })
 * })
 *
 * // 4. 多 Agent 协调
 * const agent = registerAgent({ id: 'agent1', name: 'Agent 1', type: 'local' })
 * const task = createTask('local', { prompt: 'Do something' })
 *
 * // 5. 分析追踪
 * track('custom_event', { data: 'value' })
 * if (feature('my_feature')) {
 *   // do something
 * }
 *
 * // 6. 传输层
 * const transport = createDefaultTransport('wss://example.com/ws')
 * transport.on('message', (msg) => console.log(msg))
 * await transport.connect()
 * ```
 */

// ============================================================================
// Integration Example
// ============================================================================

/**
 * 完整集成示例
 *
 * ```typescript
 * import {
 *   // 权限
 *   PermissionManager,
 *   PermissionMode,
 *
 *   // 上下文
 *   ContextManager,
 *
 *   // 工具
 *   ToolRegistry,
 *
 *   // 协调器
 *   Coordinator,
 *
 *   // 分析
 *   AnalyticsManager,
 * } from './modules'
 *
 * // 创建集成的 AI Agent
 * class AIAgent {
 *   private permissions = new PermissionManager()
 *   private context = new ContextManager()
 *   private tools = new ToolRegistry()
 *   private coordinator = new Coordinator()
 *   private analytics = new AnalyticsManager()
 *
 *   constructor() {
 *     // 设置权限模式
 *     this.permissions.setMode(PermissionMode.ASK)
 *
 *     // 监听权限询问
 *     this.permissions.on('ask', ({ prompt }) => {
 *       // 显示给用户
 *     })
 *
 *     // 上下文警告
 *     this.context.on('budget_warning', () => {
 *       // 触发压缩
 *     })
 *
 *     // 分析追踪
 *     this.context.on('compaction_complete', ({ result }) => {
 *       this.analytics.track('compaction', {
 *         savedTokens: result.originalTokens - result.compactedTokens,
 *       })
 *     })
 *   }
 *
 *   async processMessage(content: string) {
 *     // 1. 添加用户消息
 *     this.context.addUserMessage(content)
 *
 *     // 2. 追踪
 *     this.analytics.trackSession('start')
 *
 *     // 3. 检查权限 + 执行
 *     const context = this.permissions.createContext('Bash', { command: 'ls' }, 'process')
 *     const decision = await this.permissions.checkPermission(context)
 *
 *     if (decision.type === 'allow') {
 *       const result = await this.tools.execute('Bash', { command: 'ls' })
 *       this.analytics.trackToolUse('Bash', result.duration!, result.success)
 *     }
 *
 *     // 4. 添加响应
 *     this.context.addAssistantMessage('Done')
 *
 *     return this.context.getMessages()
 *   }
 * }
 * ```
 */
