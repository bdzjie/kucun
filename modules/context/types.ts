/**
 * Context Module - Type Definitions
 * 上下文管理模块 - 基于 Claude Code 压缩系统设计
 * 支持 OpenMythos 风格的推理深度模式
 */

// ============================================================================
// Reasoning Depth (OpenMythos-style loop control)
// ============================================================================

/**
 * 推理深度级别 — 对应 OpenMythos 的 max_loop_iters
 * - fast:    1 tool call, no iteration (类似单步推理)
 * - normal:  3 tool calls, basic loop (标准工具链)
 * - deep:    8 tool calls, full loop (深度推理，类似 OpenMythos RDT)
 */
export type ReasoningDepth = 'fast' | 'normal' | 'deep'

export const DEPTH_CONFIG: Record<ReasoningDepth, {
  maxToolCalls: number
  maxIterations: number
  compactThreshold: number   // 触发压缩的 token 使用比例
  warningThreshold: number
}> = {
  fast: {
    maxToolCalls: 1,
    maxIterations: 1,
    compactThreshold: 0.90,
    warningThreshold: 0.95,
  },
  normal: {
    maxToolCalls: 3,
    maxIterations: 3,
    compactThreshold: 0.75,
    warningThreshold: 0.85,
  },
  deep: {
    maxToolCalls: 8,
    maxIterations: 8,
    compactThreshold: 0.60,  // 更早压缩，保留空间给深度推理
    warningThreshold: 0.75,
  },
}

// ============================================================================
// Message Types
// ============================================================================

/** 消息类型 */
export type MessageRole = 'user' | 'assistant' | 'system' | 'tool'

/** 消息 */
export interface Message {
  id: string
  role: MessageRole
  content: string
  tokens?: number
  timestamp: number
  metadata?: Record<string, unknown>
}

/** 工具结果消息 */
export interface ToolMessage extends Message {
  role: 'tool'
  toolName: string
  toolInput?: Record<string, unknown>
  toolOutput?: unknown
}

// ============================================================================
// Context Budget
// ============================================================================

/** 上下文预算 */
export interface ContextBudget {
  /** 最大 Token 数 */
  maxTokens: number
  /** 已使用 Token 数 */
  usedTokens: number
  /** 警告阈值（百分比） */
  warningThreshold: number
  /** 错误阈值（百分比） */
  errorThreshold: number
  /** 自动压缩启用 */
  autoCompact: boolean
  /** 压缩阈值（百分比） */
  compactThreshold: number
  /** 推理深度模式 — OpenMythos-style loop control */
  reasoningDepth: ReasoningDepth
}

// ============================================================================
// Compaction Types
// ============================================================================

/** 压缩结果 */
export interface CompactionResult {
  /** 原始 Token 数 */
  originalTokens: number
  /** 压缩后 Token 数 */
  compactedTokens: number
  /** 摘要 Token 数 */
  summaryTokens: number
  /** 移除的消息数 */
  removedMessages: number
  /** 保留的消息数 */
  retainedMessages: number
  /** 压缩后的消息 */
  messages: Message[]
  /** 执行时间（毫秒） */
  duration: number
}

/** 安全断点 */
export interface SafeBreakpoint {
  /** 断点位置 */
  index: number
  /** 断点前 Token 数 */
  tokensBefore: number
  /** 断点后 Token 数 */
  tokensAfter: number
  /** 是否有效 */
  valid: boolean
}

// ============================================================================
// Compaction Strategy
// ============================================================================

/** 压缩策略接口 */
export interface CompactionStrategy {
  /** 名称 */
  name: string
  /** 描述 */
  description: string
  
  /** 找到安全断点 */
  findSafeBreakpoint(
    messages: Message[],
    budget: ContextBudget
  ): SafeBreakpoint
  
  /** 生成摘要 */
  generateSummary(messages: Message[]): Promise<string>
  
  /** 执行压缩 */
  compact(
    messages: Message[],
    budget: ContextBudget
  ): Promise<CompactionResult>
}

// ============================================================================
// Token Counter
// ============================================================================

/** Token 计数配置 */
export interface TokenCounterConfig {
  /** 编码名称 */
  encoding: 'cl100k_base' | 'p50k_base' | 'r50k_base' | 'dummy'
  /** 每 Token 平均字符数 */
  charsPerToken: number
}

// ============================================================================
// Default Config
// ============================================================================

export const DEFAULT_CONTEXT_BUDGET: ContextBudget = {
  maxTokens: 150_000,
  usedTokens: 0,
  warningThreshold: 0.8,    // 80%
  errorThreshold: 1.0,      // 100%
  autoCompact: true,
  compactThreshold: 0.85,   // 85% (normal 模式的默认值)
  reasoningDepth: 'normal', // 默认深度模式 (OpenMythos-style)
}

export const DEFAULT_TOKEN_CONFIG: TokenCounterConfig = {
  encoding: 'cl100k_base',
  charsPerToken: 4,  // 约 4 字符 per token
}

// ============================================================================
// Context Events
// ============================================================================

export type ContextEventType =
  | 'budget_warning'
  | 'budget_exceeded'
  | 'compaction_start'
  | 'compaction_complete'
  | 'compaction_reverted'

export interface ContextEvent {
  type: ContextEventType
  budget: ContextBudget
  timestamp: number
  details?: Record<string, unknown>
}
