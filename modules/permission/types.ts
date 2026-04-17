/**
 * Permission Module - Type Definitions
 * 基于 Claude Code 权限系统设计
 */

// ============================================================================
// Risk Level & Permission Mode
// ============================================================================

/** 风险等级 */
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical'

/** 权限模式 */
export enum PermissionMode {
  /** 仅允许低风险操作 */
  SAFE = 'safe',
  /** 执行前询问 */
  ASK = 'ask',
  /** 完全信任（危险） */
  BYPASS = 'bypass',
}

/** 权限决策结果 */
export type PermissionDecision =
  | { type: 'allow' }
  | { type: 'deny'; reason: string }
  | { type: 'ask'; prompt: string; context: PermissionContext }

// ============================================================================
// Permission Context
// ============================================================================

/** 权限请求上下文 */
export interface PermissionContext {
  /** 工具名称 */
  tool: string
  /** 工具输入参数 */
  input: Record<string, unknown>
  /** 会话 ID */
  sessionId?: string
  /** 用户 ID */
  userId?: string
  /** 请求时间戳 */
  timestamp: number
  /** 风险等级 */
  riskLevel: RiskLevel
  /** 工具类别 */
  category: ToolCategory
  /** 是否为破坏性操作 */
  destructive?: boolean
  /** 操作的路径（如果有） */
  paths?: string[]
}

/** 工具类别 */
export type ToolCategory =
  | 'filesystem'   // 文件操作
  | 'network'      // 网络请求
  | 'process'      // 进程管理
  | 'system'       // 系统操作
  | 'agent'        // Agent 调用
  | 'mcp'          // MCP 工具
  | 'skill'        // 技能调用
  | 'other'        // 其他

// ============================================================================
// Permission Rule
// ============================================================================

/** 权限规则 */
export interface PermissionRule {
  /** 规则 ID */
  id: string
  /** 规则名称 */
  name: string
  /** 匹配的工具体 */
  tools: string[]
  /** 允许的风险等级 */
  allowedRiskLevels: RiskLevel[]
  /** 默认决策 */
  defaultDecision: PermissionDecision['type']
  /** 是否启用 */
  enabled: boolean
  /** 优先级（数字越大优先级越高） */
  priority: number
}

// ============================================================================
// Permission Request
// ============================================================================

/** 权限请求 */
export interface PermissionRequest {
  /** 请求 ID */
  id: string
  /** 权限上下文 */
  context: PermissionContext
  /** 请求时间 */
  requestedAt: number
  /** 响应时间 */
  respondedAt?: number
  /** 决策 */
  decision?: PermissionDecision
  /** 用户响应 */
  userResponse?: 'allow' | 'deny' | 'cancel'
  /** TTL（毫秒） */
  ttl?: number
}

// ============================================================================
// Permission Store
// ============================================================================

/** 权限存储状态 */
export interface PermissionStore {
  /** 当前权限模式 */
  mode: PermissionMode
  /** 历史请求 */
  requests: PermissionRequest[]
  /** 规则 */
  rules: PermissionRule[]
  /** 允许列表 */
  allowList: string[]  // tool:pattern 格式
  /** 拒绝列表 */
  denyList: string[]
}

// ============================================================================
// Permission Config
// ============================================================================

/** 权限配置 */
export interface PermissionConfig {
  /** 默认模式 */
  defaultMode: PermissionMode
  /** 是否启用 */
  enabled: boolean
  /** 是否记录所有请求 */
  logAllRequests: boolean
  /** 询问超时（毫秒） */
  askTimeout: number
  /** 最大历史记录数 */
  maxHistory: number
  /** 危险命令模式 */
  dangerousCommands?: string[]
}

// ============================================================================
// Tool Risk Assessment
// ============================================================================

/** 工具风险评估结果 */
export interface ToolRiskAssessment {
  /** 风险等级 */
  level: RiskLevel
  /** 风险因素 */
  factors: string[]
  /** 建议 */
  suggestions?: string[]
  /** 是否可自动批准 */
  autoApprove: boolean
}

/** 风险评估规则 */
export interface RiskRule {
  pattern: RegExp | string
  level: RiskLevel
  reason: string
}

// ============================================================================
// Permission Event
// ============================================================================

/** 权限事件类型 */
export type PermissionEventType =
  | 'permission_request'
  | 'permission_allow'
  | 'permission_deny'
  | 'permission_ask'
  | 'permission_timeout'
  | 'permission_cancel'

/** 权限事件 */
export interface PermissionEvent {
  type: PermissionEventType
  context: PermissionContext
  decision?: PermissionDecision
  timestamp: number
  duration?: number
}
