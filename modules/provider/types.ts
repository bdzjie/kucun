/**
 * Provider Types - Enhanced Error Handling
 * 提供者类型 - 增强错误处理
 */

import type { ToolCall } from '../registry/types'

// ============================================================================
// API Modes
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
// Error Types (Enhanced)
// ============================================================================

export enum ApiErrorCode {
  // Authentication
  AUTH_REQUIRED = 'AUTH_REQUIRED',
  AUTH_FAILED = 'AUTH_FAILED',
  AUTH_EXPIRED = 'AUTH_EXPIRED',
  
  // Rate Limiting
  RATE_LIMITED = 'RATE_LIMITED',
  QUOTA_EXCEEDED = 'QUOTA_EXCEEDED',
  TOKENS_EXCEEDED = 'TOKENS_EXCEEDED',
  
  // Server Errors
  SERVER_ERROR = 'SERVER_ERROR',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
  MODEL_OVERLOADED = 'MODEL_OVERLOADED',
  
  // Client Errors
  INVALID_REQUEST = 'INVALID_REQUEST',
  INVALID_MODEL = 'INVALID_MODEL',
  CONTEXT_OVERFLOW = 'CONTEXT_OVERFLOW',
  
  // Network
  NETWORK_ERROR = 'NETWORK_ERROR',
  TIMEOUT = 'TIMEOUT',
  CONNECTION_FAILED = 'CONNECTION_FAILED',
  
  // General
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
  INTERRUPTED = 'INTERRUPTED',
}

export interface ApiError extends Error {
  code: ApiErrorCode
  status?: number
  retryable: boolean
  retryAfter?: number  // seconds
  provider?: string
  model?: string
}

export interface RateLimitInfo {
  limited: boolean
  retryAfter?: number
  remaining?: number
  resetAt?: number
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
  onRateLimit?: (info: RateLimitInfo) => void
  onError?: (error: ApiError) => void
}

export interface CallResult {
  success: boolean
  response?: unknown
  error?: ApiError
  interrupted?: boolean
  duration?: number
  attempts?: number
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
  name: string
  mode: ApiMode
  baseUrl: string
  apiKeyEnv?: string
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
  exponentialBackoff?: boolean
}

export interface FallbackResult {
  success: boolean
  provider?: string
  model?: string
  response?: unknown
  error?: ApiError
  attempts: number
  totalDuration: number
}

// ============================================================================
// Retry Strategy
// ============================================================================

export interface RetryStrategy {
  maxAttempts: number
  baseDelay: number
  maxDelay: number
  exponentialBase: number
  jitter: boolean
}

export const DEFAULT_RETRY_STRATEGY: RetryStrategy = {
  maxAttempts: 3,
  baseDelay: 1000,
  maxDelay: 30000,
  exponentialBase: 2,
  jitter: true,
}

// ============================================================================
// Provider Stats
// ============================================================================

export interface ProviderStats {
  provider: string
  totalRequests: number
  successfulRequests: number
  failedRequests: number
  rateLimitedRequests: number
  avgLatency: number
  lastRequestAt: number | null
  lastErrorAt: number | null
  lastError?: ApiError
}
