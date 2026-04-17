/**
 * AIAgent - Core Conversation Loop
 * AIAgent - Hermes 风格核心对话循环
 * 
 * 核心功能:
 * 1. 统一的三 API 模式调用
 * 2. 可中断的 API 调用
 * 3. 会话血脉追踪 (Session Lineage)
 * 4. 迭代预算管理
 * 5. 预压缩检查
 * 6. 工具并发执行
 */

import type {
  AgentConfig,
  AgentStatus,
  AgentCallbacks,
  AgentResult,
  Turn,
  ToolResult,
  Iteration,
  IterationBudget,
  Session,
  SessionLineage,
  PreflightCheck,
  CompressionDecision,
} from './types'

import type {
  RuntimeProvider,
  Message,
  ToolDefinition,
  InterruptibleCallConfig,
} from '../provider/types'

import type { ToolCall } from '../registry/types'

import {
  ProviderResolver,
  ApiClient,
  resolveRuntimeProvider,
  chatComplete,
  chatCompleteWithInterrupt,
} from '../provider/provider'

import { globalToolRegistry, type ToolContext } from '../registry/registry'

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_MAX_TURNS = 90
const DEFAULT_TIMEOUT = 120000
const COMPRESSION_THRESHOLD = 0.5  // 50% context usage triggers preflight
const COMPRESSION_PROTECT_LAST_N = 20  // Last 20 messages protected

// ============================================================================
// AIAgent (Hermes-style core loop)
// ============================================================================

/**
 * AIAgent - 核心对话循环引擎
 * 
 * 灵感来源: Hermes run_agent.py (~10,700 行)
 */
export class AIAgent {
  // Configuration
  private config: Required<AgentConfig>
  
  // Runtime
  private providerResolver: ProviderResolver
  private runtimeProvider: RuntimeProvider | null = null
  
  // State
  private status: AgentStatus = 'idle'
  private session: Session
  private currentTurn: Turn | null = null
  private iterationNumber = 0
  
  // Messages
  private messages: Message[] = []
  private systemPrompt: string = ''
  
  // Callbacks
  private callbacks: AgentCallbacks
  
  // Interrupt
  private interrupted = false
  private abortController: AbortController | null = null

  constructor(config: AgentConfig, callbacks: AgentCallbacks = {}) {
    this.config = {
      id: config.id,
      name: config.name,
      type: config.type,
      model: config.model || 'claude-sonnet-4',
      provider: config.provider || 'anthropic',
      maxTurns: config.maxTurns || DEFAULT_MAX_TURNS,
      timeout: config.timeout || DEFAULT_TIMEOUT,
    }
    
    this.callbacks = callbacks
    this.providerResolver = new ProviderResolver()
    
    // Initialize session
    this.session = this.createSession()
  }

  // ============================================================================
  // Session Management (Hermes-style Lineage)
  // ============================================================================

  /**
   * 创建新会话
   */
  private createSession(parentSession?: Session): Session {
    const sessionId = this.generateId()
    
    let lineage: SessionLineage
    if (parentSession) {
      // Child session - inherit lineage
      lineage = {
        sessionId,
        parentSessionId: parentSession.lineage.sessionId,
        rootSessionId: parentSession.lineage.rootSessionId,
        generation: parentSession.lineage.generation + 1,
        lineage: [...parentSession.lineage.lineage, sessionId],
      }
    } else {
      // Root session
      lineage = {
        sessionId,
        parentSessionId: null,
        rootSessionId: sessionId,
        generation: 1,
        lineage: [sessionId],
      }
    }
    
    return {
      id: sessionId,
      lineage,
      status: 'idle',
      config: this.config,
      turns: [],
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
  }

  /**
   * 从现有会话恢复
   */
  static async fromSession(
    sessionId: string,
    messages: Message[],
    config: Partial<AgentConfig> = {},
    callbacks: AgentCallbacks = {}
  ): Promise<AIAgent> {
    const agent = new AIAgent(
      {
        id: sessionId,
        name: config.name || 'agent',
        type: config.type || 'local',
        ...config,
      },
      callbacks
    )
    
    agent.messages = messages
    agent.session.status = 'idle'
    
    return agent
  }

  /**
   * 获取会话血脉信息
   */
  getLineage(): SessionLineage {
    return this.session.lineage
  }

  /**
   * 获取父会话 ID
   */
  getParentSessionId(): string | null {
    return this.session.lineage.parentSessionId
  }

  /**
   * 获取根会话 ID
   */
  getRootSessionId(): string {
    return this.session.lineage.rootSessionId
  }

  // ============================================================================
  // Main Loop (Hermes-style)
  // ============================================================================

  /**
   * 运行对话
   * 
   * Hermes-style main loop:
   * 1. 预压缩检查
   * 2. 构建消息
   * 3. API 调用
   * 4. 解析响应
   * 5. 执行工具调用
   * 6. 循环直到完成
   */
  async run(userMessage: string): Promise<AgentResult> {
    this.status = 'thinking'
    this.callbacks.onStatusChange?.('thinking')
    
    try {
      // Add user message
      this.messages.push({ role: 'user', content: userMessage })
      
      // Create first turn
      this.startTurn(userMessage)
      
      // Main loop
      while (this.iterationNumber < this.config.maxTurns) {
        // Check for interrupt
        if (this.interrupted) {
          this.handleInterrupt()
          break
        }
        
        // Preflight compression check
        const preflight = await this.checkPreflight()
        if (preflight.needsCompression) {
          const decision = await this.shouldCompress(preflight)
          if (decision.shouldCompress) {
            await this.compress(decision.protectedMessages)
          }
        }
        
        // Build API request
        const runtime = await this.resolveProvider()
        const toolDefs = this.getToolDefinitions()
        
        // Make API call with interrupt support
        this.status = 'waiting'
        this.callbacks.onThinkingStart?.()
        
        const callConfig: InterruptibleCallConfig = {
          timeout: this.config.timeout,
          signal: this.abortController?.signal,
          onInterrupt: () => {
            this.interrupted = true
            this.callbacks.onInterrupt?.()
          },
        }
        
        const callResult = await chatCompleteWithInterrupt(
          runtime,
          {
            messages: this.messages,
            tools: toolDefs,
            max_tokens: 4096,
          },
          callConfig
        )
        
        this.callbacks.onThinkingEnd?.()
        
        if (callResult.interrupted) {
          this.handleInterrupt()
          break
        }
        
        if (!callResult.success) {
          throw new Error(callResult.error)
        }
        
        const { message, usage } = callResult.response as any
        
        // Add assistant message
        this.messages.push(message)
        
        // Check for tool calls
        if (message.tool_calls && message.tool_calls.length > 0) {
          this.status = 'executing'
          this.callbacks.onStatusChange?.('executing')
          
          // Execute tools concurrently
          const results = await this.executeTools(message.tool_calls)
          
          // Add tool results
          for (const result of results) {
            this.messages.push({
              role: 'tool',
              tool_call_id: result.toolCallId,
              content: JSON.stringify(result.result),
            })
            
            this.currentTurn!.toolCalls.push(message.tool_calls.find(
              tc => tc.id === result.toolCallId
            )!)
            this.currentTurn!.toolResults.push(result)
          }
          
          // Continue loop
          this.iterationNumber++
          continue
        }
        
        // No tool calls - we're done
        this.currentTurn!.assistantMessage = message.content as string
        this.currentTurn!.endTime = Date.now()
        this.currentTurn!.status = 'completed'
        
        this.status = 'completed'
        this.callbacks.onStatusChange?.('completed')
        
        return {
          success: true,
          message: message.content as string,
          turns: this.session.turns,
          usage,
        }
      }
      
      // Max turns exceeded
      return this.handleMaxTurnsExceeded()
      
    } catch (error: any) {
      this.status = 'error'
      this.callbacks.onError?.(error)
      this.callbacks.onStatusChange?.('error')
      
      return {
        success: false,
        message: error?.message || 'Agent error',
        turns: this.session.turns,
        endReason: 'error',
      }
    }
  }

  /**
   * 中断当前运行
   */
  interrupt(): void {
    this.interrupted = true
    this.abortController?.abort()
  }

  // ============================================================================
  // Turn Management
  // ============================================================================

  private startTurn(userMessage: string): Turn {
    const turn: Turn = {
      turnNumber: this.session.turns.length + 1,
      userMessage,
      toolCalls: [],
      toolResults: [],
      startTime: Date.now(),
      status: 'pending',
    }
    
    this.currentTurn = turn
    this.session.turns.push(turn)
    this.callbacks.onTurnStart?.(turn)
    
    return turn
  }

  private endTurn(): void {
    if (this.currentTurn) {
      this.currentTurn.endTime = Date.now()
      this.currentTurn.status = this.interrupted ? 'interrupted' : 'completed'
      this.callbacks.onTurnEnd?.(this.currentTurn)
    }
  }

  private handleInterrupt(): void {
    this.endTurn()
    this.status = 'interrupted'
    this.callbacks.onStatusChange?.('interrupted')
  }

  private handleMaxTurnsExceeded(): AgentResult {
    const summary = `Agent reached maximum iterations (${this.config.maxTurns})`
    
    return {
      success: false,
      message: summary,
      turns: this.session.turns,
      endReason: 'budget_exceeded',
    }
  }

  // ============================================================================
  // Provider Resolution
  // ============================================================================

  private async resolveProvider(): Promise<RuntimeProvider> {
    if (!this.runtimeProvider) {
      this.runtimeProvider = resolveRuntimeProvider(
        this.config.provider,
        this.config.model
      )
      
      if (!this.runtimeProvider) {
        throw new Error(`Provider not available: ${this.config.provider}`)
      }
    }
    
    return this.runtimeProvider
  }

  // ============================================================================
  // Tool Execution (Hermes-style concurrent)
  // ============================================================================

  private async executeTools(toolCalls: ToolCall[]): Promise<ToolResult[]> {
    // Single tool - execute directly
    if (toolCalls.length === 1) {
      return [await this.executeSingleTool(toolCalls[0])]
    }
    
    // Multiple tools - execute concurrently
    const promises = toolCalls.map(tc => this.executeSingleTool(tc))
    return Promise.all(promises)
  }

  private async executeSingleTool(toolCall: ToolCall): Promise<ToolResult> {
    const startTime = Date.now()
    
    this.callbacks.onToolCallStart?.(toolCall)
    
    try {
      const context: ToolContext = {
        cwd: process.cwd(),
        sessionId: this.session.id,
      }
      
      const result = await globalToolRegistry.execute(
        toolCall.name,
        typeof toolCall.arguments === 'string'
          ? JSON.parse(toolCall.arguments)
          : toolCall.arguments,
        context
      )
      
      const toolResult: ToolResult = {
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        result: result.output,
        success: result.success,
        duration: Date.now() - startTime,
      }
      
      this.callbacks.onToolCallEnd?.(toolCall, toolResult)
      
      return toolResult
      
    } catch (error: any) {
      const toolResult: ToolResult = {
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        result: { error: error.message },
        success: false,
        duration: Date.now() - startTime,
      }
      
      this.callbacks.onToolCallEnd?.(toolCall, toolResult)
      
      return toolResult
    }
  }

  private getToolDefinitions(): ToolDefinition[] | undefined {
    const tools = globalToolRegistry.listEnabled()
    
    if (tools.length === 0) return undefined
    
    return tools.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters as Record<string, unknown>,
    }))
  }

  // ============================================================================
  // Compression (Hermes-style)
  // ============================================================================

  /**
   * 预压缩检查
   */
  private async checkPreflight(): Promise<PreflightCheck> {
    // Estimate context usage
    const contextUsage = this.estimateContextUsage()
    const contextLimit = 150000  // Approximate for most models
    
    return {
      needsCompression: contextUsage > contextLimit * COMPRESSION_THRESHOLD,
      contextUsage,
      contextLimit,
      percentUsed: contextUsage / contextLimit,
    }
  }

  /**
   * 判断是否应该压缩
   */
  private shouldCompress(preflight: PreflightCheck): CompressionDecision {
    return {
      shouldCompress: preflight.percentUsed > 0.5,
      reason: preflight.percentUsed > 0.5 ? 'Context exceeds 50% threshold' : undefined,
      protectedMessages: COMPRESSION_PROTECT_LAST_N,
    }
  }

  /**
   * 执行压缩 (创建子会话)
   */
  private async compress(protectedMessages: number): Promise<void> {
    // Create child session for compressed context
    const compressedSession = this.createSession(this.session)
    
    // Keep only protected messages
    const preservedMessages = this.messages.slice(-protectedMessages)
    
    // Generate summary of older messages (simplified)
    const olderMessages = this.messages.slice(0, -protectedMessages)
    const summary = this.summarizeMessages(olderMessages)
    
    // Add summary as system message
    const summaryMessage: Message = {
      role: 'system',
      content: `[Previous conversation summary]\n${summary}`,
    }
    
    // Rebuild messages with summary
    this.messages = [summaryMessage, ...preservedMessages]
    
    // Update session
    this.session = compressedSession
  }

  /**
   * 生成消息摘要 (简化版)
   */
  private summarizeMessages(messages: Message[]): string {
    // Simplified - real impl would use LLM
    const userMessages = messages.filter(m => m.role === 'user')
    const assistantMessages = messages.filter(m => m.role === 'assistant')
    
    return `Conversation had ${userMessages.length} user turns and ${assistantMessages.length} assistant turns. `
      + `Key topics discussed.`
  }

  private estimateContextUsage(): number {
    // Simplified token estimation
    // In real impl, use proper tokenizer
    const totalChars = this.messages.reduce((sum, m) => {
      return sum + (typeof m.content === 'string' ? m.content.length : 0)
    }, 0)
    
    return Math.ceil(totalChars / 4)  // Rough estimate: 4 chars per token
  }

  // ============================================================================
  // Utilities
  // ============================================================================

  private generateId(): string {
    return `agent_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  /**
   * 获取当前状态
   */
  getStatus(): AgentStatus {
    return this.status
  }

  /**
   * 获取消息历史
   */
  getMessages(): Message[] {
    return [...this.messages]
  }

  /**
   * 获取会话
   */
  getSession(): Session {
    return { ...this.session }
  }

  /**
   * 获取迭代预算
   */
  getIterationBudget(): IterationBudget {
    return {
      total: this.config.maxTurns,
      used: this.iterationNumber,
      remaining: this.config.maxTurns - this.iterationNumber,
    }
  }
}

// ============================================================================
// Convenience Methods
// ============================================================================

/**
 * 创建 Agent 的便捷方法
 */
export function createAgent(
  config: AgentConfig,
  callbacks?: AgentCallbacks
): AIAgent {
  return new AIAgent(config, callbacks)
}

/**
 * 运行简单对话
 */
export async function chat(
  userMessage: string,
  config: {
    model?: string
    provider?: string
  } = {}
): Promise<AgentResult> {
  const agent = new AIAgent({
    id: 'temp',
    name: 'chat',
    type: 'local',
    model: config.model,
    provider: config.provider,
  })
  
  return agent.run(userMessage)
}
