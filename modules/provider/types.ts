/**
 * Provider Types - Multi-API Mode Abstraction
 * 提供者类型 - Hermes 三 API 模式统一抽象
 */

import type { ToolCall } from '../registry/types'

// ============================================================================
// API Modes (Hermes-style)
// ============================================================================

export type ApiMode = 'chat_completions' | 'codex_responses' | 'anthropic_messages'

// ============================================================================
// Provider Types
// ============================================================================

export interface Provider {
  name: string
  mode: ApiMode
  baseUrl: string
  apiKey?: string
  credentials?: ProviderCredentials
}

export interface ProviderCredentials {
  apiKey: string
  refreshToken?: string
  expiresAt?: number
}

export interface RuntimeProvider {
  provider: Provider
  mode: ApiMode
  apiKey: string
  baseUrl: string
}

// ============================================================================
// Message Format (Unified)
// ============================================================================

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content?: string | null
  tool_calls?: ToolCall[]
  tool_call_id?: string
  reasoning?: string | null
}

export interface AssistantMessage extends Message {
  role: 'assistant'
  content?: string | null
  tool_calls?: ToolCall[]
  reasoning?: string | null
}

export interface UserMessage extends Message {
  role: 'user'
  content: string
}

export interface ToolMessage extends Message {
  role: 'tool'
  tool_call_id: string
  content: string
}

export interface SystemMessage extends Message {
  role: 'system'
  content: string
}

// ============================================================================
// API Request/Response
// ============================================================================

export interface ChatCompletionsRequest {
  model: string
  messages: Message[]
  tools?: ToolDefinition[]
  tool_choice?: 'auto' | 'none' | { type: 'function'; function: { name: string } }
  temperature?: number
  max_tokens?: number
  top_p?: number
  stream?: boolean
}

export interface ChatCompletionsResponse {
  id: string
  model: string
  choices: Array<{
    index: number
    message: AssistantMessage
    finish_reason: string
  }>
  usage: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}

export interface AnthropicMessagesRequest {
  model: string
  messages: Message[]
  tools?: ToolDefinition[]
  max_tokens: number
  temperature?: number
  stream?: boolean
}

export interface AnthropicMessagesResponse {
  id: string
  type: 'message'
  role: 'assistant'
  content: Array<{
    type: 'text' | 'tool_use'
    text?: string
    id?: string
    name?: string
    input?: unknown
  }>
  usage: {
    input_tokens: number
    output_tokens: number
  }
}

// ============================================================================
// Tool Definitions
// ============================================================================

export interface ToolDefinition {
  name: string
  description: string
  input_schema: Record<string, unknown>
}

// ============================================================================
// Interruptible Call
// ============================================================================

export interface InterruptibleCallConfig {
  timeout?: number
  signal?: AbortSignal
  onInterrupt?: () => void
}

export interface CallResult {
  success: boolean
  response?: unknown
  error?: string
  interrupted?: boolean
  duration?: number
}

// ============================================================================
// Provider Resolution
// ============================================================================

export interface ResolveProviderOptions {
  provider?: string
  model?: string
  explicitMode?: ApiMode
}

export interface ProviderConfig {
  /** Provider name (e.g., 'anthropic', 'openai', 'openrouter') */
  name: string
  /** API mode */
  mode: ApiMode
  /** Base URL */
  baseUrl: string
  /** API key env var name */
  apiKeyEnv?: string
  /** OAuth config */
  oauth?: {
    clientId: string
    scopes: string[]
    authUrl: string
    tokenUrl: string
  }
}

// ============================================================================
// Fallback Chain
// ============================================================================

export interface FallbackConfig {
  providers: Array<{
    provider: string
    model: string
    mode?: ApiMode
  }>
  maxRetries?: number
  retryDelay?: number
}

export interface FallbackResult {
  success: boolean
  provider?: string
  model?: string
  response?: unknown
  error?: string
  attempts: number
}
