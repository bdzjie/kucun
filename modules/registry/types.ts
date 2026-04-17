/**
 * Registry Types - Enhanced with Hermes-style Features
 * 增强版工具注册表 - Hermes 自注册 + AST 发现
 */

import type { ZodSchema } from 'zod'

// ============================================================================
// Tool Types
// ============================================================================

export type ToolCategory =
  | 'filesystem'
  | 'network'
  | 'process'
  | 'system'
  | 'agent'
  | 'mcp'
  | 'skill'
  | 'search'
  | 'memory'
  | 'other'

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical'

export type ApiMode = 'chat_completions' | 'codex_responses' | 'anthropic_messages'

// ============================================================================
// Tool Schema (OpenAI Function Calling Format)
// ============================================================================

export interface ToolParameterProperty {
  type: string
  description?: string
  enum?: string[]
  default?: unknown
  minimum?: number
  maximum?: number
  items?: ToolParameterProperty
  properties?: Record<string, ToolParameterProperty>
  required?: string[]
}

export interface ToolParameters {
  type: 'object'
  properties: Record<string, ToolParameterProperty>
  required?: string[]
  additionalProperties?: boolean
}

// ============================================================================
// Tool Definition (Hermes-style)
// ============================================================================

export interface Tool {
  /** Unique tool name (used in API schemas) */
  name: string
  /** Human-readable description */
  description: string
  /** Tool category */
  category: ToolCategory
  /** Risk level */
  riskLevel: RiskLevel
  /** Whether tool is enabled */
  enabled: boolean
  /** JSON Schema for parameters (OpenAI function format) */
  parameters: ToolParameters
  /** Optional Zod schema for validation */
  zodSchema?: ZodSchema
  /** Check function - returns true when tool is available */
  check_fn?: () => boolean | Promise<boolean>
  /** Required environment variables */
  requires_env?: string[]
  /** Whether handler is async */
  is_async?: boolean
  /** Emoji for display */
  emoji?: string
  /** Toolset this tool belongs to */
  toolset?: string
  /** Execution handler */
  execute: ToolExecutor
}

// ============================================================================
// Tool Executor
// ============================================================================

export interface ToolContext {
  cwd?: string
  sessionId?: string
  userId?: string
  env?: Record<string, string>
  metadata?: Record<string, unknown>
}

export interface ToolResult {
  success: boolean
  output?: unknown
  error?: string
  duration?: number
  toolCallId?: string
}

export type ToolExecutor = (
  input: unknown,
  context: ToolContext
) => Promise<ToolResult> | ToolResult

// ============================================================================
// Tool Entry (Internal)
// ============================================================================

export interface ToolEntry {
  tool: Tool
  key: string
  registeredAt: number
  callCount: number
}

// ============================================================================
// Toolset
// ============================================================================

export interface Toolset {
  name: string
  description: string
  tools: string[]  // tool names
  check_fn?: () => boolean | Promise<boolean>
  enabled_by_default?: boolean
}

// ============================================================================
// Registry Config
// ============================================================================

export interface RegistryConfig {
  /** Auto-register built-in tools */
  autoRegisterBuiltin: boolean
  /** Allow duplicate tool names */
  allowDuplicate: boolean
  /** Case sensitive tool names */
  caseSensitive: boolean
  /** Auto-discover tools via AST scanning */
  autoDiscover: boolean
  /** Directories to scan for tools */
  scanDirs?: string[]
  /** Enable toolset support */
  enableToolsets: boolean
}

// ============================================================================
// Registry Stats
// ============================================================================

export interface RegistryStats {
  totalTools: number
  totalToolsets: number
  byCategory: Record<ToolCategory, number>
  byRiskLevel: Record<RiskLevel, number>
  byToolset: Record<string, number>
  enabledTools: number
  disabledTools: number
  availableTools: number  // passed check_fn
  unavailableTools: number  // failed check_fn
  totalCalls: number
}

// ============================================================================
// Discovery
// ============================================================================

export interface DiscoveredTool {
  name: string
  file: string
  line: number
  toolset?: string
}

export interface DiscoveryResult {
  tools: DiscoveredTool[]
  errors: Array<{ file: string; error: string }>
  duration: number
}

// ============================================================================
// Hermes-style API
// ============================================================================

export interface ToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: ToolParameters
  }
}

export interface ToolCall {
  id: string
  name: string
  arguments: string | Record<string, unknown>
}

export interface ToolCallResult {
  tool_call_id: string
  output: string
  is_error?: boolean
}
