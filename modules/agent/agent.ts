/**
 * AIAgent - Enhanced Core Conversation Loop
 * AIAgent - 增强版核心对话循环
 * 
 * 优化点:
 * 1. 更好的状态机管理
 * 2. 改进的压缩逻辑
 * 3. 更完整的回调系统
 * 4. 改进的错误处理
 * 5. 更好的资源清理
 */

import type {
  AgentConfig,
  AgentStatus,
  AgentCallbacks,
  AgentResult,
  Turn,
  ToolResult,
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
  CallResult,
} from '../provider/types'

import type { ToolCall } from '../registry/types'

import {
  ProviderResolver,
  ApiClient,
  resolveRuntimeProvider,
  chatCompleteWithInterrupt,
  ApiError,
} from '../provider/provider'

import { globalToolRegistry, type ToolContext } from '../registry/registry'

import { RoutingService, routingService } from './routing_service'

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_MAX_TURNS = 90
const DEFAULT_TIMEOUT = 120000
const COMPRESSION_THRESHOLD = 0.5
const COMPRESSION_AGGRESSIVE_THRESHOLD = 0.85
const COMPRESSION_PROTECT_LAST_N = 20
const COMPRESSION_AGGRESSIVE_PROTECT_N = 5

// ============================================================================
// State Machine
// ============================================================================

type AgentState =
  | 'created'
  | 'running'
  | 'thinking'
  | 'waiting_for_response'
  | 'executing_tools'
  | 'completed'
  | 'interrupted'
  | 'error'
  | 'max_turns_exceeded'

const STATE_TRANSITIONS: Record<AgentState, AgentStatus[]> = {
  created: ['running'],
  running: ['thinking', 'waiting_for_response', 'completed', 'error'],
  thinking: ['waiting_for_response', 'error', 'interrupted'],
  waiting_for_response: ['executing_tools', 'completed', 'error', 'interrupted'],
  executing_tools: ['running', 'thinking', 'error', 'interrupted'],
  completed: [],
  interrupted: [],
  error: [],
  max_turns_exceeded: [],
}

function isValidTransition(from: AgentState, to: AgentStatus): boolean {
  return STATE_TRANSITIONS[from]?.includes(to) ?? false
}

// ============================================================================
// AIAgent
// ============================================================================

export class AIAgent {
  // Configuration
  private config: Required<AgentConfig>

  // Runtime
  private providerResolver: ProviderResolver
  private runtimeProvider: RuntimeProvider | null = null

  // State machine
  private state: AgentState = 'created'
  private previousState: AgentState = 'created'

  // Session
  private session: Session
  private currentTurn: Turn | null = null
  private iterationNumber = 0

  // Messages
  private messages: Message[] = []
  private pendingToolResults: Map<string, ToolResult> = new Map()

  // Interrupt
  private interrupted = false
  private abortController: AbortController | null = null

  // Callbacks
  private callbacks: AgentCallbacks

  // Lifecycle
  private disposed = false

  // Routing
  private routingService: RoutingService
  private currentRoute: ReturnType<RoutingService['classify']> | null = null

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
    this.routingService = routingService  // Use singleton
    this.session = this.createSession()

    // Set up abort controller
    if (typeof AbortController !== 'undefined') {
      this.abortController = new AbortController()
    }
  }

  // ============================================================================
  // Session Management
  // ============================================================================

  private createSession(parentSession?: Session): Session {
    const sessionId = this.generateId()

    let lineage: SessionLineage
    if (parentSession) {
      lineage = {
        sessionId,
        parentSessionId: parentSession.lineage.sessionId,
        rootSessionId: parentSession.lineage.rootSessionId,
        generation: parentSession.lineage.generation + 1,
        lineage: [...parentSession.lineage.lineage, sessionId],
      }
    } else {
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
      config: { ...this.config },
      turns: [],
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
  }

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

  getLineage(): SessionLineage {
    return this.session.lineage
  }

  getParentSessionId(): string | null {
    return this.session.lineage.parentSessionId
  }

  getRootSessionId(): string {
    return this.session.lineage.rootSessionId
  }

  // ============================================================================
  // State Management
  // ============================================================================

  private setState(newState: AgentState): void {
    if (this.disposed) return

    const statusMap: Record<AgentState, AgentStatus> = {
      created: 'idle',
      running: 'idle',
      thinking: 'thinking',
      waiting_for_response: 'waiting',
      executing_tools: 'executing',
      completed: 'completed',
      interrupted: 'interrupted',
      error: 'error',
      max_turns_exceeded: 'completed',
    }

    const status = statusMap[newState]
    this.previousState = this.state
    this.state = newState
    this.session.status = status
    this.session.updatedAt = Date.now()

    this.callbacks.onStatusChange?.(status)
  }

  private getState(): AgentState {
    return this.state
  }

  // ============================================================================
  // Main Loop
  // ============================================================================

  async run(userMessage: string): Promise<AgentResult> {
    if (this.disposed) {
      throw new Error('Agent has been disposed')
    }

    this.setState('running')

    try {
      // ─────────────────────────────────────────────────────────────
      // Expert Router: Classify task and determine reasoning depth
      // ─────────────────────────────────────────────────────────────
      this.currentRoute = await this.routingService.classify(userMessage)
      this.session.routingResult = {
        expert: this.currentRoute.expert,
        taskType: this.currentRoute.task_type,
        depth: this.currentRoute.depth,
        confidence: this.currentRoute.confidence,
        skills: this.currentRoute.skills,
      }

      // Add user message
      this.messages.push({ role: 'user', content: userMessage })

      // Start first turn
      this.startTurn(userMessage)

      // Main loop
      while (this.iterationNumber < this.config.maxTurns) {
        // Check for interrupt
        if (this.interrupted) {
          return this.handleInterrupt()
        }

        // Check preflight
        const preflight = await this.checkPreflight()
        if (preflight.needsCompression) {
          const decision = this.shouldCompress(preflight)
          if (decision.shouldCompress) {
            await this.compress(decision.protectedMessages)
          }
        }

        // Resolve provider
        const runtime = await this.resolveProvider()
        const toolDefs = this.getToolDefinitions()

        // Thinking state
        this.setState('thinking')
        this.callbacks.onThinkingStart?.()

        // Make API call
        this.setState('waiting_for_response')

        const callConfig: InterruptibleCallConfig = {
          timeout: this.config.timeout,
          signal: this.abortController?.signal,
          onInterrupt: () => {
            this.interrupted = true
            this.callbacks.onInterrupt?.()
          },
          onError: (error: ApiError) => {
            this.callbacks.onError?.(error)
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
          return this.handleInterrupt()
        }

        if (!callResult.success) {
          throw callResult.error || new Error('API call failed')
        }

        const { message, usage } = callResult.response as any

        // Add assistant message
        this.messages.push(message)

        // Check for tool calls
        if (message.tool_calls && message.tool_calls.length > 0) {
          this.setState('executing_tools')

          const results = await this.executeTools(message.tool_calls)

          // Add tool results
          for (const result of results) {
            this.messages.push({
              role: 'tool',
              tool_call_id: result.toolCallId,
              content: JSON.stringify(result.result),
            })

            this.currentTurn!.toolCalls.push(
              message.tool_calls.find(tc => tc.id === result.toolCallId)!
            )
            this.currentTurn!.toolResults.push(result)
          }

          this.iterationNumber++
          this.setState('running')
          continue
        }

        // No tool calls - completed
        this.currentTurn!.assistantMessage = message.content as string
        this.endTurn('completed')

        // ─────────────────────────────────────────────────────────────
        // Record routing feedback (success case)
        // ─────────────────────────────────────────────────────────────
        this.recordRoutingFeedback(true, 'good')

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
      this.setState('error')
      this.callbacks.onError?.(error)

      // Record routing feedback (failure case)
      this.recordRoutingFeedback(false, 'poor')

      return {
        success: false,
        message: error?.message || 'Agent error',
        turns: this.session.turns,
        endReason: 'error',
      }
    }
  }

  /**
   * Interrupt the running agent
   */
  interrupt(): void {
    if (this.disposed) return

    this.interrupted = true
    this.abortController?.abort()
  }

  /**
   * Dispose of resources
   */
  dispose(): void {
    this.disposed = true
    this.abortController?.abort()
    this.abortController = null
    this.pendingToolResults.clear()
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

  private endTurn(status: Turn['status']): void {
    if (this.currentTurn) {
      this.currentTurn.endTime = Date.now()
      this.currentTurn.status = status
      this.callbacks.onTurnEnd?.(this.currentTurn)
    }

    this.setState(status === 'completed' ? 'completed' : status === 'interrupted' ? 'interrupted' : 'completed')
  }

  private handleInterrupt(): AgentResult {
    this.endTurn('interrupted')
    this.recordRoutingFeedback(false, 'partial')

    return {
      success: false,
      message: 'Agent was interrupted',
      turns: this.session.turns,
      endReason: 'interrupted',
    }
  }

  private handleMaxTurnsExceeded(): AgentResult {
    const summary = `Agent reached maximum iterations (${this.config.maxTurns})`

    this.endTurn('pending')
    this.setState('max_turns_exceeded')
    this.recordRoutingFeedback(false, 'partial')

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
  // Tool Execution
  // ============================================================================

  private async executeTools(toolCalls: ToolCall[]): Promise<ToolResult[]> {
    // Single tool - sequential
    if (toolCalls.length === 1) {
      return [await this.executeSingleTool(toolCalls[0])]
    }

    // Multiple tools - concurrent
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

      const parsedArgs =
        typeof toolCall.arguments === 'string'
          ? JSON.parse(toolCall.arguments)
          : toolCall.arguments

      const result = await globalToolRegistry.execute(
        toolCall.name,
        parsedArgs,
        context
      )

      const toolResult: ToolResult = {
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        result: result.output,
        success: result.success,
        duration: Date.now() - startTime,
      }

      this.pendingToolResults.set(toolCall.id, toolResult)
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

      this.pendingToolResults.set(toolCall.id, toolResult)
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
  // Compression (depth-aware via Expert Router)
  // ============================================================================

  private getDepthThreshold(): { normal: number; aggressive: number } {
    // OpenMythos-style: deep mode compresses earlier to leave room for reasoning
    if (this.currentRoute?.depth === 'deep') {
      return { normal: 0.60, aggressive: 0.75 }
    }
    if (this.currentRoute?.depth === 'fast') {
      return { normal: 0.90, aggressive: 0.95 }
    }
    return { normal: COMPRESSION_THRESHOLD, aggressive: COMPRESSION_AGGRESSIVE_THRESHOLD }
  }

  private async checkPreflight(): Promise<PreflightCheck> {
    const contextUsage = this.estimateContextUsage()
    const contextLimit = 150000

    return {
      needsCompression: contextUsage > contextLimit * COMPRESSION_THRESHOLD,
      contextUsage,
      contextLimit,
      percentUsed: contextUsage / contextLimit,
    }
  }

  private shouldCompress(preflight: PreflightCheck): CompressionDecision {
    const depthThreshold = this.getDepthThreshold()

    // Aggressive compression if above depth-specific threshold
    if (preflight.percentUsed > depthThreshold.aggressive) {
      return {
        shouldCompress: true,
        reason: `Context exceeds ${(depthThreshold.aggressive * 100).toFixed(0)}% - aggressive compression (${this.currentRoute?.depth} mode)`,
        protectedMessages: COMPRESSION_AGGRESSIVE_PROTECT_N,
      }
    }

    // Normal compression above depth-specific threshold
    if (preflight.percentUsed > depthThreshold.normal) {
      return {
        shouldCompress: true,
        reason: `Context exceeds ${(depthThreshold.normal * 100).toFixed(0)}% threshold (${this.currentRoute?.depth} mode)`,
        protectedMessages: COMPRESSION_PROTECT_LAST_N,
      }
    }

    return {
      shouldCompress: false,
      protectedMessages: COMPRESSION_PROTECT_LAST_N,
    }
  }

  private async compress(protectedMessages: number): Promise<void> {
    // Create child session
    const compressedSession = this.createSession(this.session)

    // Preserve last N messages
    const preservedMessages = this.messages.slice(-protectedMessages)

    // Generate summary of older messages
    const olderMessages = this.messages.slice(0, -protectedMessages)
    const summary = this.summarizeMessages(olderMessages)

    // Add summary as system message
    const summaryMessage: Message = {
      role: 'system',
      content: `[Previous conversation summary - ${olderMessages.length} messages]\n${summary}`,
    }

    // Rebuild messages with summary
    this.messages = [summaryMessage, ...preservedMessages]

    // Update session
    this.session = compressedSession
  }

  private summarizeMessages(messages: Message[]): string {
    const userMessages = messages.filter(m => m.role === 'user')
    const assistantMessages = messages.filter(m => m.role === 'assistant')

    return `Conversation had ${userMessages.length} user turns and ${assistantMessages.length} assistant turns. `
      + `Key topics and decisions discussed.`
  }

  private estimateContextUsage(): number {
    const totalChars = this.messages.reduce((sum, m) => {
      return sum + (typeof m.content === 'string' ? m.content.length : 0)
    }, 0)

    return Math.ceil(totalChars / 4)
  }

  // ============================================================================
  // Utilities
  // ============================================================================

  private generateId(): string {
    return `agent_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  getStatus(): AgentStatus {
    return this.session.status
  }

  getMessages(): Message[] {
    return [...this.messages]
  }

  /**
   * Record routing feedback after task completion
   * Used by feedback loop to adjust expert weights
   */
  private recordRoutingFeedback(
    taskSuccess: boolean,
    quality: 'good' | 'partial' | 'poor'
  ): void {
    if (!this.currentRoute) return

    try {
      this.routingService.recordFeedback(
        {
          task_type: this.currentRoute.task_type,
          expert: this.currentRoute.expert,
          skills: this.currentRoute.skills,
          depth: this.currentRoute.depth,
          confidence: this.currentRoute.confidence,
          matched_keywords: [],
        },
        taskSuccess,
        quality,
        this.iterationNumber
      )
    } catch (err) {
      // Non-fatal: feedback recording should not break the agent
      console.warn('[AIAgent] Failed to record routing feedback:', err)
    }
  }

  getSession(): Session {
    return { ...this.session }
  }

  getIterationBudget(): { total: number; used: number; remaining: number } {
    return {
      total: this.config.maxTurns,
      used: this.iterationNumber,
      remaining: this.config.maxTurns - this.iterationNumber,
    }
  }
}

// ============================================================================
// Convenience
// ============================================================================

export function createAgent(
  config: AgentConfig,
  callbacks?: AgentCallbacks
): AIAgent {
  return new AIAgent(config, callbacks)
}

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

  try {
    return await agent.run(userMessage)
  } finally {
    agent.dispose()
  }
}
