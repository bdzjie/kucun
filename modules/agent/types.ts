/**
 * Agent Types - Core AIAgent Loop
 * Agent 类型 - Hermes AIAgent 核心循环
 */

import type { ApiMode, Message, RuntimeProvider, ToolDefinition } from '../provider/types'
import type { ToolCall } from '../registry/types'

// ============================================================================
// Agent Types
// ============================================================================

export type AgentType = 'local' | 'remote' | 'subagent' | 'coordinator'

export type AgentStatus = 'idle' | 'thinking' | 'executing' | 'waiting' | 'completed' | 'interrupted' | 'error'

export interface AgentConfig {
  id: string
  name: string
  type: AgentType
  model?: string
  provider?: string
  maxTurns?: number
  timeout?: number
}

// ============================================================================
// Turn & Iteration
// ============================================================================

export interface Turn {
  turnNumber: number
  userMessage: string
  assistantMessage?: string
  toolCalls: ToolCall[]
  toolResults: ToolResult[]
  startTime: number
  endTime?: number
  status: 'pending' | 'completed' | 'interrupted' | 'failed'
}

export interface ToolResult {
  toolCallId: string
  toolName: string
  result: unknown
  success: boolean
  duration: number
}

export interface Iteration {
  iterationNumber: number
  turn: Turn
  messages: Message[]
  budget: IterationBudget
}

export interface IterationBudget {
  total: number
  used: number
  remaining: number
}

// ============================================================================
// Session Lineage (Hermes-style)
// ============================================================================

export interface SessionLineage {
  sessionId: string
  parentSessionId: string | null
  rootSessionId: string
  generation: number  // 1 = original, 2 = child, 3 = grandchild
  lineage: string[]   // Full path: [root, child, grandchild]
}

export interface Session {
  id: string
  lineage: SessionLineage
  status: AgentStatus
  config: AgentConfig
  turns: Turn[]
  messages: Message[]
  createdAt: number
  updatedAt: number
  endedAt?: number
  endReason?: 'completed' | 'interrupted' | 'budget_exceeded' | 'error' | 'user_exit'
  // Routing metadata (from Expert Router)
  routingResult?: {
    expert: string
    taskType: string
    depth: 'fast' | 'normal' | 'deep'
    confidence: number
    skills: string[]
  }
}

// ============================================================================
// Callbacks (Hermes-style)
// ============================================================================

export interface AgentCallbacks {
  onThinkingStart?: () => void
  onThinkingEnd?: () => void
  onToolCallStart?: (toolCall: ToolCall) => void
  onToolCallEnd?: (toolCall: ToolCall, result: ToolResult) => void
  onTurnStart?: (turn: Turn) => void
  onTurnEnd?: (turn: Turn) => void
  onInterrupt?: () => void
  onError?: (error: Error) => void
  onStatusChange?: (status: AgentStatus) => void
}

// ============================================================================
// Agent Result
// ============================================================================

export interface AgentResult {
  success: boolean
  message: string
  turns: Turn[]
  usage?: {
    inputTokens: number
    outputTokens: number
    totalTokens: number
    cost?: number
  }
  endReason?: string
}

// ============================================================================
// Preflight Compression (Hermes-style)
// ============================================================================

export interface PreflightCheck {
  needsCompression: boolean
  contextUsage: number
  contextLimit: number
  percentUsed: number
}

export interface CompressionDecision {
  shouldCompress: boolean
  reason?: string
  protectedMessages: number  // Last N messages protected
}
