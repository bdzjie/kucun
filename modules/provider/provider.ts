/**
 * Provider Module - Multi-API Mode Abstraction
 * 提供者模块 - Hermes 三 API 模式统一实现
 * 
 * 核心设计:
 * 1. 三种 API 模式统一抽象
 * 2. Provider 自动检测与回退链
 * 3. 可中断的 API 调用
 * 4. 凭证管理与 OAuth 支持
 */

import type {
  ApiMode,
  Provider,
  RuntimeProvider,
  Message,
  AssistantMessage,
  ToolMessage,
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
} from './types'

import type { ToolCall } from '../registry/types'

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
// Provider Resolver
// ============================================================================

/**
 * 解析运行时 Provider
 * 
 * 模式检测顺序:
 * 1. explicit mode (最高优先级)
 * 2. Provider 特定检测 (e.g., anthropic → anthropic_messages)
 * 3. Base URL 启发式 (e.g., api.anthropic.com → anthropic_messages)
 * 4. 默认: chat_completions
 */
export class ProviderResolver {
  private configs: Map<string, ProviderConfig>
  private credentials: Map<string, string>

  constructor() {
    this.configs = new Map(Object.entries(PROVIDER_CONFIGS))
    this.credentials = new Map()
  }

  /**
   * 注册自定义 Provider
   */
  registerConfig(config: ProviderConfig): void {
    this.configs.set(config.name, config)
  }

  /**
   * 设置凭证
   */
  setCredential(provider: string, apiKey: string): void {
    this.credentials.set(provider, apiKey)
  }

  /**
   * 从环境变量加载凭证
   */
  loadCredentialsFromEnv(): void {
    for (const [name, config] of this.configs) {
      if (config.apiKeyEnv) {
        const apiKey = process.env[config.apiKeyEnv]
        if (apiKey) {
          this.credentials.set(name, apiKey)
        }
      }
    }
  }

  /**
   * 解析运行时 Provider
   */
  resolve(options: ResolveProviderOptions = {}): RuntimeProvider | null {
    const { provider, model, explicitMode } = options

    if (!provider) {
      return null
    }

    const config = this.configs.get(provider)
    if (!config) {
      return null
    }

    const apiKey = this.credentials.get(provider)
    if (!apiKey) {
      return null
    }

    // 确定 API 模式
    let mode = explicitMode || config.mode

    // Base URL 启发式检测
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

  /**
   * 从 Base URL 检测 API 模式
   */
  private detectModeFromBaseUrl(baseUrl: string): ApiMode {
    if (baseUrl.includes('anthropic.com')) {
      return 'anthropic_messages'
    }
    if (baseUrl.includes('openrouter.ai')) {
      return 'chat_completions'
    }
    return 'chat_completions'
  }

  /**
   * 获取可用 Provider 列表
   */
  listAvailableProviders(): string[] {
    return Array.from(this.configs.keys()).filter(p => this.credentials.has(p))
  }
}

// ============================================================================
// API Client (Three Modes Unified)
// ============================================================================

/**
 * Hermes-style API Client
 * 
 * 支持三种 API 模式，统一到相同内部消息格式
 */
export class ApiClient {
  private resolver: ProviderResolver

  constructor(resolver: ProviderResolver) {
    this.resolver = resolver
  }

  /**
   * 统一聊天完成接口
   * 
   * 内部自动选择正确的 API 模式
   */
  async chat(
    runtime: RuntimeProvider,
    request: {
      model: string
      messages: Message[]
      tools?: ToolDefinition[]
      max_tokens?: number
      temperature?: number
      stream?: boolean
    }
  ): Promise<{
    message: AssistantMessage
    usage: { input_tokens: number; output_tokens: number; total_tokens: number }
  }> {
    switch (runtime.mode) {
      case 'anthropic_messages':
        return this.chatAnthropic(runtime, request)
      case 'codex_responses':
        return this.chatCodex(runtime, request)
      case 'chat_completions':
      default:
        return this.chatOpenAI(runtime, request)
    }
  }

  /**
   * Anthropic Messages API
   */
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
    // 转换消息格式
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
      }
    )

    const data = response as AnthropicMessagesResponse

    // 转换回统一格式
    const assistantMessage: AssistantMessage = {
      role: 'assistant',
      content: this.extractAnthropicContent(data.content),
    }

    // 提取工具调用
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

  /**
   * OpenAI Chat Completions API
   */
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
      }
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

  /**
   * OpenAI Codex Responses API (simplified)
   */
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
    // Codex uses similar format to chat completions
    return this.chatOpenAI(runtime, request)
  }

  /**
   * 可中断的 API 请求
   * 
   * Hermes-style interruptible call
   */
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

    // 创建 AbortController
    let abortController: AbortController | null = null
    let timeoutId: ReturnType<typeof setTimeout> | null = null

    if (typeof AbortController !== 'undefined') {
      abortController = new AbortController()
    }

    // 设置超时
    if (timeout > 0) {
      timeoutId = setTimeout(() => {
        abortController?.abort()
        config.onInterrupt?.()
      }, timeout)
    }

    try {
      // 设置外部 signal
      if (config.signal) {
        config.signal.addEventListener('abort', () => {
          abortController?.abort()
          config.onInterrupt?.()
        })
      }

      const result = await this.chat(runtime, request)

      // 清除超时
      if (timeoutId) clearTimeout(timeoutId)

      return {
        success: true,
        response: result,
        duration: Date.now() - startTime,
      }
    } catch (error: any) {
      // 清除超时
      if (timeoutId) clearTimeout(timeoutId)

      // 检查是否被中断
      if (abortController?.signal.aborted || error?.name === 'AbortError') {
        return {
          success: false,
          interrupted: true,
          error: 'Request interrupted',
          duration: Date.now() - startTime,
        }
      }

      return {
        success: false,
        error: error?.message || String(error),
        duration: Date.now() - startTime,
      }
    }
  }

  /**
   * 发送 HTTP 请求
   */
  private async makeRequest(
    url: string,
    options: {
      method: string
      headers: Record<string, string>
      body: string
    }
  ): Promise<unknown> {
    const response = await fetch(url, {
      method: options.method,
      headers: options.headers,
      body: options.body,
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`API request failed: ${response.status} ${error}`)
    }

    return response.json()
  }

  /**
   * 转换消息格式 (unified → Anthropic)
   */
  private convertToAnthropicFormat(messages: Message[]): Message[] {
    // Anthropic 格式: user/assistant 交替, system 单独
    const result: Message[] = []
    let hasSystem = false

    for (const msg of messages) {
      if (msg.role === 'system') {
        hasSystem = true
      }
      result.push(msg)
    }

    return result
  }

  /**
   * 提取 Anthropic 内容块
   */
  private extractAnthropicContent(
    content: Array<{ type: string; text?: string }>
  ): string {
    const texts: string[] = []

    for (const block of content) {
      if (block.type === 'text' && block.text) {
        texts.push(block.text)
      }
    }

    return texts.join('\n')
  }
}

// ============================================================================
// Fallback Chain
// ============================================================================

/**
 * Provider 回退链
 * 
 * 当主 Provider 失败时，自动尝试回退列表
 */
export class FallbackChain {
  private resolver: ProviderResolver
  private client: ApiClient

  constructor(resolver: ProviderResolver) {
    this.resolver = resolver
    this.client = new ApiClient(resolver)
  }

  /**
   * 带回退的请求
   */
  async execute(
    request: {
      messages: Message[]
      tools?: ToolDefinition[]
      max_tokens?: number
      temperature?: number
    },
    config: FallbackConfig
  ): Promise<FallbackResult> {
    const { providers, maxRetries = 3, retryDelay = 1000 } = config
    let attempts = 0

    for (const p of providers) {
      const runtime = this.resolver.resolve({
        provider: p.provider,
        model: p.model,
        explicitMode: p.mode,
      })

      if (!runtime) {
        continue
      }

      attempts++

      // 重试逻辑
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
          }
        } catch (error: any) {
          // 401/403 不重试 - 认证问题
          if (error?.status === 401 || error?.status === 403) {
            break
          }

          // 速率限制重试
          if (error?.status === 429 && i < maxRetries - 1) {
            await this.delay(retryDelay * Math.pow(2, i)) // 指数退避
            continue
          }

          // 服务器错误重试
          if (error?.status >= 500 && i < maxRetries - 1) {
            await this.delay(retryDelay)
            continue
          }
        }
      }
    }

    return {
      success: false,
      error: 'All providers failed',
      attempts,
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}

// ============================================================================
// Global Provider
// ============================================================================

export const globalProviderResolver = new ProviderResolver()
export const globalApiClient = new ApiClient(globalProviderResolver)
export const globalFallbackChain = new FallbackChain(globalProviderResolver)

/**
 * 快捷方法: 解析 Provider
 */
export function resolveRuntimeProvider(
  provider: string,
  model?: string
): RuntimeProvider | null {
  return globalProviderResolver.resolve({ provider, model })
}

/**
 * 快捷方法: 发送聊天请求
 */
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

/**
 * 快捷方法: 带超时的请求
 */
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
