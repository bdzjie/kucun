/**
 * Registry Module - Type Definitions
 * 工具注册表模块 - 基于 Claude Code 工具系统设计
 */

// ============================================================================
// Tool Category
// ============================================================================

export type ToolCategory =
  | 'filesystem'  // 文件操作
  | 'network'     // 网络请求
  | 'process'     // 进程管理
  | 'system'      // 系统操作
  | 'agent'       // Agent 调用
  | 'mcp'         // MCP 工具
  | 'skill'       // 技能调用
  | 'other'       // 其他

// ============================================================================
// Tool Definition
// ============================================================================

/** 工具参数 Schema */
export interface ToolParameterSchema {
  type: 'object'
  properties: Record<string, ToolParameterProperty>
  required?: string[]
}

export interface ToolParameterProperty {
  type: string
  description?: string
  default?: unknown
  enum?: string[]
}

/** 工具执行上下文 */
export interface ToolContext {
  sessionId?: string
  userId?: string
  cwd?: string
  env?: Record<string, string>
}

/** 工具执行结果 */
export interface ToolResult {
  success: boolean
  output?: unknown
  error?: string
  duration?: number
}

/** 工具元数据 */
export interface ToolMetadata {
  version?: string
  author?: string
  tags?: string[]
  examples?: string[]
}

/** 工具接口 */
export interface Tool {
  /** 工具名称 */
  name: string
  /** 工具描述 */
  description: string
  /** 参数 Schema */
  parameters: ToolParameterSchema
  /** 执行函数 */
  execute(input: unknown, context: ToolContext): Promise<ToolResult>
  /** 工具类别 */
  category: ToolCategory
  /** 风险等级 */
  riskLevel: RiskLevel
  /** 是否启用 */
  enabled: boolean
  /** 元数据 */
  metadata?: ToolMetadata
}

// ============================================================================
// Risk Level (from Permission Module)
// ============================================================================

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical'

// ============================================================================
// Registry Types
// ============================================================================

/** 注册表配置 */
export interface RegistryConfig {
  /** 自动注册内置工具 */
  autoRegisterBuiltin: boolean
  /** 允许重复注册 */
  allowDuplicate: boolean
  /** 大小写敏感 */
  caseSensitive: boolean
}

/** 注册表统计 */
export interface RegistryStats {
  totalTools: number
  byCategory: Record<ToolCategory, number>
  byRiskLevel: Record<RiskLevel, number>
  enabledTools: number
  disabledTools: number
}
