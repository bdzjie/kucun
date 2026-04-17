/**
 * Provider Module - Enhanced with Robust Error Handling
 * 提供者模块 - 增强错误处理与重试机制
 */

import type {
  ApiMode,
  Provider,
  RuntimeProvider,
  Message,
  AssistantMessage,
  ChatCompletionsRequest,
  ChatCompletionsResponse,
  AnthropicMessagesRequest,
  AnthropicMessagesResponse,
  InterruptibleCallConfig,
  CallResult,
  ResolveProviderOptions,
  ProviderConfig,
  FallbackConfig,
  FallbackResult,
  ToolDefinition,
  ApiError,
  ApiErrorCode,
  RateLimitInfo,
  ProviderStats,
  RetryStrategy,
  DEFAULT_RETRY_STRATEGY,
} from './types'

import { ApiErrorCode } from './types'

import type { ToolCall } from '../registry/types'

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_RETRY_STRATEGY_CONFIG: RetryStrategy = {
  maxAttempts: 3,
  baseDelay: 1000,
  maxDelay: 30000,
  exponentialBase: 2,
  jitter: true,
}

// ============================================================================
// Provider Registry
// ============================================================================

const PROVIDER_CONFIGS: Record<string, ProviderConfig> = {
  anthropic: {
    name: 'anthropic',
    mode: 'anthropic_messages',
    baseUrl: 'https://api.anthropic.com/v1',
    apiKeyEnv: 'ANTHROPIC_API_KEY',
  },
  openai: {
    name: 'openai',
    mode: 'chat_completions',
    baseUrl: 'https://api.openai.com/v1',
    apiKeyEnv: 'OPENAI_API_KEY',
  },
  openrouter: {
    name: 'openrouter',
    mode: 'chat_completions',
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKeyEnv: 'OPENROUTER_API_KEY',
  },
  'nous-portal': {
    name: 'nous-portal',
    mode: 'chat_completions',
    baseUrl: 'https://portal.nousresearch.com/api/v1',
    apiKeyEnv: 'NOUS_API_KEY',
  },
  'xiaomi-mimo': {
    name: 'xiaomi-mimo',
    mode: 'chat_completions',
    baseUrl: 'https://platform.xiaomimimo.com/v1',
    apiKeyEnv: 'MIMO_API_KEY',
  },
  'z-ai': {
    name: 'z-ai',
    mode: 'chat_completions',
    baseUrl: 'https://z.ai/api/v1',
    apiKeyEnv: 'Z_API_KEY',
  },
  kimi: {
    name: 'kimi',
    mode: 'chat_completions',
    baseUrl: 'https://api.moonshot.cn/v1',
    apiKeyEnv: 'KIMI_API_KEY',
  },
  minimax: {
    name: 'minimax',
    mode: 'chat_completions',
    baseUrl: 'https://api.minimax.chat/v1',
    apiKeyEnv: 'MINIMAX_API_KEY',
  },
  huggingface: {
    name: 'huggingface',
    mode: 'chat_completions',
    baseUrl: 'https://api-inference.huggingface.co/models',
    apiKeyEnv: 'HF_API_KEY',
  },
}

// ============================================================================
// Error Factory
// ============================================================================

function createApiError(
  code: ApiErrorCode,
  message: string,
  options: {
    status?: number
    retryable?: boolean
    retryAfter?: number
    provider?: string
    model?: string
    cause?: Error
  } = {}
): ApiError {
  const error = new Error(message) as ApiError
  error.code = code
  error.status = options.status
  error.retryable = options.retryable ?? isRetryableCode(code)
  error.retryAfter = options.retryAfter
  error.provider = options.provider
  error.model = options.model
  error.cause = options.cause
  return error
}

function isRetryableCode(code: ApiErrorCode): boolean {
  return [
    ApiErrorCode.RATE_LIMITED,
    ApiErrorCode.SERVER_ERROR,
    ApiErrorCode.SERVICE_UNAVAILABLE,
    ApiErrorCode.MODEL_OVERLOADED,
    ApiErrorCode.TIMEOUT,
    ApiErrorCode.CONNECTION_FAILED,
  ].includes(code)
}

function parseErrorFromResponse(status: number, data: unknown, provider?: string): ApiErrorCode {
  const dataStr = typeof data === 'string' ? data : JSON.stringify(data)
  
  if (status === 401) return ApiErrorCode.AUTH_FAILED
  if (status === 403) return ApiErrorCode.AUTH_EXPIRED
  if (status === 429) return ApiErrorCode.RATE_LIMITED
  if (status === 400 && dataStr.includes('maximum context')) return ApiErrorCode.CONTEXT_OVERFLOW
  if (status === 400 && dataStr.includes('model')) return ApiErrorCode.INVALID_MODEL
  if (status === 400) return ApiErrorCode.INVALID_REQUEST
  if (status >= 500) return ApiErrorCode.SERVER_ERROR
  
  return ApiErrorCode.UNKNOWN_ERROR
}

// ============================================================================
// Provider Resolver
// ============================================================================

export class ProviderResolver {
  private configs: Map<string, ProviderConfig>
  private credentials: Map<string, string>
  private stats: Map<string, ProviderStats>

  constructor() {
    this.configs = new Map(Object.entries(PROVIDER_CONFIGS))
    this.credentials = new Map()
    this.stats = new Map()
  }

  registerConfig(config: ProviderConfig): void {
    this.configs.set(config.name, config)
  }

  setCredential(provider: string, apiKey: string): void {
    this.credentials.set(provider, apiKey)
    this.ensureStats(provider)
  }

  loadCredentialsFromEnv(): void {
    for (const [name, config] of this.configs) {
      if (config.apiKeyEnv) {
        const apiKey = process.env[config.apiKeyEnv]
        if (apiKey) {
          this.setCredential(name, apiKey)
        }
      }
    }
  }

  resolve(options: ResolveProviderOptions = {}): RuntimeProvider | null {
    const { provider, model, explicitMode } = options

    if (!provider) return null

    const config = this.configs.get(provider)
    if (!config) return null

    const apiKey = this.credentials.get(provider)
    if (!apiKey) return null

    let mode = explicitMode || config.mode
    if (!explicitMode && !mode) {
      mode = this.detectModeFromBaseUrl(config.baseUrl)
    }

    return {
      provider: config,
      mode: mode || 'chat_completions',
      apiKey,
      baseUrl: config.baseUrl,
    }
  }

  listAvailableProviders(): string[] {
    return Array.from(this.configs.keys()).filter(p => this.credentials.has(p))
  }

  getStats(provider: string): ProviderStats | undefined {
    return this.stats.get(provider)
  }

  updateStats(provider: string, update: Partial<ProviderStats>): void {
    this.ensureStats(provider)
    const stats = this.stats.get(provider)!
    Object.assign(stats, update)
  }

  private ensureStats(provider: string): void {
    if (!this.stats.has(provider)) {
      this.stats.set(provider, {
        provider,
        totalRequests: 0,
        successfulRequests: 0,
        failedRequests: 0,
        rateLimitedRequests: 0,
        avgLatency: 0,
        lastRequestAt: null,
        lastErrorAt: null,
      })
    }
  }

  private detectModeFromBaseUrl(baseUrl: string): ApiMode {
    if (baseUrl.includes('anthropic.com')) return 'anthropic_messages'
    return 'chat_completions'
  }
}

// ============================================================================
// API Client with Enhanced Error Handling
// ============================================================================

export class ApiClient {
  private resolver: ProviderResolver

  constructor(resolver: ProviderResolver) {
    this.resolver = resolver
  }

  async chat(
    runtime: RuntimeProvider,
    request: {
      model: string
      messages: Message[]
      tools?: ToolDefinition[]
      max_tokens?: number
      temperature?: number
    }
  ): Promise<{
    message: AssistantMessage
    usage: { input_tokens: number; output_tokens: number; total_tokens: number }
  }> {
    const startTime = Date.now()

    try {
      let result: { message: AssistantMessage; usage: { input_tokens: number; output_tokens: number; total_tokens: number } }

      switch (runtime.mode) {
        case 'anthropic_messages':
          result = await this.chatAnthropic(runtime, request)
          break
        case 'codex_responses':
          result = await this.chatCodex(runtime, request)
          break
        default:
          result = await this.chatOpenAI(runtime, request)
      }

      // Update stats
      this.resolver.updateStats(runtime.provider.name, {
        totalRequests: (this.resolver.getStats(runtime.provider.name)?.totalRequests || 0) + 1,
        successfulRequests: (this.resolver.getStats(runtime.provider.name)?.successfulRequests || 0) + 1,
        lastRequestAt: Date.now(),
      })

      return result

    } catch (error: any) {
      // Update error stats
      this.resolver.updateStats(runtime.provider.name, {
        failedRequests: (this.resolver.getStats(runtime.provider.name)?.failedRequests || 0) + 1,
        lastErrorAt: Date.now(),
        lastError: error as ApiError,
      })
      throw error
    }
  }

  async chatWithInterrupt(
    runtime: RuntimeProvider,
    request: {
      model: string
      messages: Message[]
      tools?: ToolDefinition[]
      max_tokens?: number
      temperature?: number
    },
    config: InterruptibleCallConfig = {}
  ): Promise<CallResult> {
    const startTime = Date.now()
    const timeout = config.timeout || 120000

    let abortController: AbortController | null = null
    let timeoutId: ReturnType<typeof setTimeout> | null = null

    if (typeof AbortController !== 'undefined') {
      abortController = new AbortController()
    }

    // Set timeout
    if (timeout > 0) {
      timeoutId = setTimeout(() => {
        abortController?.abort()
        config.onInterrupt?.()
      }, timeout)
    }

    // External signal
    if (config.signal) {
      config.signal.addEventListener('abort', () => {
        abortController?.abort()
        config.onInterrupt?.()
      })
    }

    try {
      const result = await this.chat(runtime, request)

      if (timeoutId) clearTimeout(timeoutId)

      return {
        success: true,
        response: result,
        duration: Date.now() - startTime,
      }

    } catch (error: any) {
      if (timeoutId) clearTimeout(timeoutId)

      if (abortController?.signal.aborted || error?.name === 'AbortError') {
        return {
          success: false,
          interrupted: true,
          error: createApiError(ApiErrorCode.INTERRUPTED, 'Request interrupted'),
          duration: Date.now() - startTime,
        }
      }

      const apiError = this.normalizeError(error, runtime.provider.name)
      config.onError?.(apiError)

      return {
        success: false,
        error: apiError,
        duration: Date.now() - startTime,
      }
    }
  }

  private async chatAnthropic(
    runtime: RuntimeProvider,
    request: {
      model: string
      messages: Message[]
      tools?: ToolDefinition[]
      max_tokens?: number
      temperature?: number
    }
  ): Promise<{
    message: AssistantMessage
    usage: { input_tokens: number; output_tokens: number; total_tokens: number }
  }> {
    const anthropicMessages = this.convertToAnthropicFormat(request.messages)

    const body: AnthropicMessagesRequest = {
      model: request.model,
      messages: anthropicMessages,
      max_tokens: request.max_tokens || 4096,
      temperature: request.temperature,
    }

    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools.map(t => ({
        name: t.name,
        description: t.description,
        input_schema: t.input_schema,
      }))
    }

    const response = await this.makeRequest(
      `${runtime.baseUrl}/messages`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': runtime.apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify(body),
      },
      runtime.provider.name,
      request.model
    )

    const data = response as AnthropicMessagesResponse

    const assistantMessage: AssistantMessage = {
      role: 'assistant',
      content: this.extractAnthropicContent(data.content),
    }

    const toolCalls: ToolCall[] = []
    for (const block of data.content) {
      if (block.type === 'tool_use' && block.id && block.name && block.input) {
        toolCalls.push({
          id: block.id,
          name: block.name,
          arguments: block.input as Record<string, unknown>,
        })
      }
    }
    if (toolCalls.length > 0) {
      assistantMessage.tool_calls = toolCalls
    }

    return {
      message: assistantMessage,
      usage: {
        input_tokens: data.usage.input_tokens,
        output_tokens: data.usage.output_tokens,
        total_tokens: data.usage.input_tokens + data.usage.output_tokens,
      },
    }
  }

  private async chatOpenAI(
    runtime: RuntimeProvider,
    request: {
      model: string
      messages: Message[]
      tools?: ToolDefinition[]
      max_tokens?: number
      temperature?: number
    }
  ): Promise<{
    message: AssistantMessage
    usage: { input_tokens: number; output_tokens: number; total_tokens: number }
  }> {
    const body: ChatCompletionsRequest = {
      model: request.model,
      messages: request.messages as ChatCompletionsRequest['messages'],
      max_tokens: request.max_tokens,
      temperature: request.temperature,
    }

    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools.map(t => ({
        type: 'function' as const,
        function: {
          name: t.name,
          description: t.description,
          parameters: t.input_schema,
        },
      }))
    }

    const response = await this.makeRequest(
      `${runtime.baseUrl}/chat/completions`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${runtime.apiKey}`,
        },
        body: JSON.stringify(body),
      },
      runtime.provider.name,
      request.model
    )

    const data = response as ChatCompletionsResponse
    const choice = data.choices[0]

    return {
      message: choice.message,
      usage: {
        input_tokens: data.usage.prompt_tokens,
        output_tokens: data.usage.completion_tokens,
        total_tokens: data.usage.total_tokens,
      },
    }
  }

  private async chatCodex(
    runtime: RuntimeProvider,
    request: {
      model: string
      messages: Message[]
      tools?: ToolDefinition[]
      max_tokens?: number
      temperature?: number
    }
  ): Promise<{
    message: AssistantMessage
    usage: { input_tokens: number; output_tokens: number; total_tokens: number }
  }> {
    return this.chatOpenAI(runtime, request)
  }

  private async makeRequest(
    url: string,
    options: {
      method: string
      headers: Record<string, string>
      body: string
    },
    provider: string,
    model?: string
  ): Promise<unknown> {
    const response = await fetch(url, {
      method: options.method,
      headers: options.headers,
      body: options.body,
    })

    if (!response.ok) {
      let errorData: unknown
      try {
        errorData = await response.json()
      } catch {
        errorData = await response.text()
      }

      const code = parseErrorFromResponse(response.status, errorData, provider)
      const retryAfter = this.extractRetryAfter(response, errorData)

      const error = createApiError(code, `API error ${response.status}`, {
        status: response.status,
        retryable: isRetryableCode(code),
        retryAfter,
        provider,
        model,
      })

      throw error
    }

    return response.json()
  }

  private extractRetryAfter(response: Response, data: unknown): number | undefined {
    const retryAfter = response.headers.get('retry-after')
    if (retryAfter) {
      const parsed = parseInt(retryAfter, 10)
      if (!isNaN(parsed)) return parsed
    }

    // Try to extract from error body
    if (typeof data === 'object' && data !== null) {
      const err = data as Record<string, unknown>
      if (err.retry_after) {
        return parseInt(String(err.retry_after), 10)
      }
      if (err.error?.retry_after) {
        return parseInt(String(err.error.retry_after), 10)
      }
    }

    return undefined
  }

  private normalizeError(error: unknown, provider?: string): ApiError {
    if (error instanceof Error) {
      if ('code' in error && typeof (error as any).code === 'string') {
        return error as ApiError
      }

      if (error.name === 'AbortError' || error.name === 'CancellationError') {
        return createApiError(ApiErrorCode.INTERRUPTED, 'Request interrupted', { provider })
      }

      if (error.message.includes('fetch') || error.message.includes('network')) {
        return createApiError(ApiErrorCode.NETWORK_ERROR, error.message, { provider, retryable: true })
      }

      if (error.message.includes('timeout')) {
        return createApiError(ApiErrorCode.TIMEOUT, error.message, { provider, retryable: true })
      }
    }

    return createApiError(ApiErrorCode.UNKNOWN_ERROR, String(error), { provider })
  }

  private convertToAnthropicFormat(messages: Message[]): Message[] {
    return messages.filter(m => m.role !== 'tool')
  }

  private extractAnthropicContent(
    content: Array<{ type: string; text?: string }>
  ): string {
    return content
      .filter(block => block.type === 'text' && block.text)
      .map(block => block.text!)
      .join('\n')
  }
}

// ============================================================================
// Fallback Chain with Exponential Backoff
// ============================================================================

export class FallbackChain {
  private resolver: ProviderResolver
  private client: ApiClient
  private strategy: RetryStrategy

  constructor(
    resolver: ProviderResolver,
    strategy: Partial<RetryStrategy> = {}
  ) {
    this.resolver = resolver
    this.client = new ApiClient(resolver)
    this.strategy = { ...DEFAULT_RETRY_STRATEGY_CONFIG, ...strategy }
  }

  async execute(
    request: {
      messages: Message[]
      tools?: ToolDefinition[]
      max_tokens?: number
      temperature?: number
    },
    config: FallbackConfig
  ): Promise<FallbackResult> {
    const startTime = Date.now()
    const { providers, maxRetries = 3, retryDelay = 1000, exponentialBackoff = true } = config
    let attempts = 0

    for (const p of providers) {
      const runtime = this.resolver.resolve({
        provider: p.provider,
        model: p.model,
        explicitMode: p.mode,
      })

      if (!runtime) continue

      attempts++

      // Retry with backoff for this provider
      for (let i = 0; i < maxRetries; i++) {
        try {
          const result = await this.client.chat(runtime, {
            model: p.model,
            messages: request.messages,
            tools: request.tools,
            max_tokens: request.max_tokens,
            temperature: request.temperature,
          })

          return {
            success: true,
            provider: p.provider,
            model: p.model,
            response: result,
            attempts,
            totalDuration: Date.now() - startTime,
          }

        } catch (error: any) {
          const apiError = this.normalizeError(error)

          // Non-retryable errors don't retry
          if (!apiError.retryable) {
            return {
              success: false,
              provider: p.provider,
              model: p.model,
              error: apiError,
              attempts,
              totalDuration: Date.now() - startTime,
            }
          }

          // Check if we should retry
          if (i < maxRetries - 1) {
            const delay = this.calculateDelay(i, retryDelay, exponentialBackoff, apiError.retryAfter)
            await this.delay(delay)
          }
        }
      }
    }

    return {
      success: false,
      error: createApiError(ApiErrorCode.UNKNOWN_ERROR, 'All providers failed'),
      attempts,
      totalDuration: Date.now() - startTime,
    }
  }

  private calculateDelay(
    attempt: number,
    baseDelay: number,
    exponential: boolean,
    retryAfter?: number
  ): number {
    // Honor server's retry-after if available
    if (retryAfter) {
      return retryAfter * 1000
    }

    let delay = exponential
      ? baseDelay * Math.pow(this.strategy.exponentialBase, attempt)
      : baseDelay

    delay = Math.min(delay, this.strategy.maxDelay)

    // Add jitter
    if (this.strategy.jitter) {
      delay = delay * (0.5 + Math.random() * 0.5)
    }

    return Math.floor(delay)
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  private normalizeError(error: unknown): ApiError {
    if (error instanceof Error && 'code' in error) {
      return error as ApiError
    }
    return createApiError(ApiErrorCode.UNKNOWN_ERROR, String(error))
  }
}

// ============================================================================
// Global Instances
// ============================================================================

export const globalProviderResolver = new ProviderResolver()
export const globalApiClient = new ApiClient(globalProviderResolver)
export const globalFallbackChain = new FallbackChain(globalProviderResolver)

export function resolveRuntimeProvider(
  provider: string,
  model?: string
): RuntimeProvider | null {
  return globalProviderResolver.resolve({ provider, model })
}

export async function chatComplete(
  runtime: RuntimeProvider,
  request: {
    messages: Message[]
    tools?: ToolDefinition[]
    max_tokens?: number
    temperature?: number
  }
): Promise<{ message: AssistantMessage; usage: { input_tokens: number; output_tokens: number; total_tokens: number } }> {
  return globalApiClient.chat(runtime, request)
}

export async function chatCompleteWithInterrupt(
  runtime: RuntimeProvider,
  request: {
    messages: Message[]
    tools?: ToolDefinition[]
    max_tokens?: number
    temperature?: number
  },
  config: InterruptibleCallConfig = {}
): Promise<CallResult> {
  return globalApiClient.chatWithInterrupt(runtime, request, config)
}
