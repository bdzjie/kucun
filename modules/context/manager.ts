/**
 * Context Module - Context Manager
 * 上下文管理器 - Token 预算 + 自动压缩
 */

import { EventEmitter } from '../eventEmitter'
import type {
  Message,
  ContextBudget,
  CompactionResult,
  SafeBreakpoint,
  CompactionStrategy,
  ContextEvent,
  TokenCounterConfig,
} from './types'
import {
  DEFAULT_CONTEXT_BUDGET,
  DEFAULT_TOKEN_CONFIG,
} from './types'

// ============================================================================
// Default Compaction Strategy
// ============================================================================

/**
 * 默认压缩策略
 * 基于 Claude Code 的 safe breakpoint 思想
 */
export class DefaultCompactionStrategy implements CompactionStrategy {
  name = 'default'
  description = 'Default compaction strategy using safe breakpoints'

  findSafeBreakpoint(messages: Message[], budget: ContextBudget): SafeBreakpoint {
    const maxTokens = budget.maxTokens * budget.compactThreshold
    
    let totalTokens = 0
    let breakpointIndex = messages.length
    
    // 从最新消息开始，找到预算范围内的断点
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i]
      const tokens = msg.tokens ?? this.estimateTokens(msg.content)
      totalTokens += tokens
      
      if (totalTokens > maxTokens) {
        // 找到第一个超过阈值的消息
        breakpointIndex = i + 1
        break
      }
    }
    
    // 确保断点有效（至少保留最近 2 条消息）
    if (breakpointIndex < messages.length - 2) {
      return {
        index: breakpointIndex,
        tokensBefore: this.countTokens(messages.slice(0, breakpointIndex)),
        tokensAfter: this.countTokens(messages.slice(breakpointIndex)),
        valid: true,
      }
    }
    
    return {
      index: messages.length,
      tokensBefore: this.countTokens(messages),
      tokensAfter: 0,
      valid: false,  // 无需压缩
    }
  }

  async generateSummary(messages: Message[]): Promise<string> {
    // 简单的摘要生成
    // 实际实现可以使用 LLM
    const summaryParts: string[] = []
    
    for (const msg of messages) {
      if (msg.role === 'user') {
        summaryParts.push(`User: ${msg.content.substring(0, 100)}...`)
      } else if (msg.role === 'tool') {
        summaryParts.push(`Tool: ${(msg as any).toolName} executed`)
      }
    }
    
    return [
      `【对话摘要 - ${messages.length} 条消息】`,
      ...summaryParts.slice(0, 10),
      '...',
    ].join('\n')
  }

  async compact(
    messages: Message[],
    budget: ContextBudget
  ): Promise<CompactionResult> {
    const startTime = Date.now()
    
    // 1. 找到安全断点
    const breakpoint = this.findSafeBreakpoint(messages, budget)
    
    if (!breakpoint.valid) {
      return {
        originalTokens: breakpoint.tokensBefore,
        compactedTokens: breakpoint.tokensBefore,
        summaryTokens: 0,
        removedMessages: 0,
        retainedMessages: messages.length,
        messages,
        duration: Date.now() - startTime,
      }
    }
    
    // 2. 提取要压缩的消息
    const toCompact = messages.slice(0, breakpoint.index)
    const toKeep = messages.slice(breakpoint.index)
    
    // 3. 生成摘要
    const summaryContent = await this.generateSummary(toCompact)
    const summaryTokens = this.estimateTokens(summaryContent)
    
    // 4. 创建摘要消息
    const summaryMessage: Message = {
      id: `summary_${Date.now()}`,
      role: 'system',
      content: summaryContent,
      tokens: summaryTokens,
      timestamp: Date.now(),
      metadata: { isSummary: true, compactedCount: toCompact.length },
    }
    
    // 5. 组合结果
    const compactedMessages = [summaryMessage, ...toKeep]
    const compactedTokens = summaryTokens + breakpoint.tokensAfter
    
    return {
      originalTokens: breakpoint.tokensBefore,
      compactedTokens,
      summaryTokens,
      removedMessages: toCompact.length,
      retainedMessages: toKeep.length + 1,
      messages: compactedMessages,
      duration: Date.now() - startTime,
    }
  }

  private estimateTokens(text: string): number {
    return Math.ceil(text.length / DEFAULT_TOKEN_CONFIG.charsPerToken)
  }

  private countTokens(messages: Message[]): number {
    return messages.reduce((sum, m) => sum + (m.tokens ?? this.estimateTokens(m.content)), 0)
  }
}

// ============================================================================
// Context Manager
// ============================================================================

/**
 * 上下文管理器
 */
export class ContextManager extends EventEmitter {
  private budget: ContextBudget
  private messages: Message[] = []
  private strategy: CompactionStrategy
  private tokenConfig: TokenCounterConfig
  private compactionHistory: CompactionResult[] = []

  constructor(
    config: Partial<ContextBudget> = {},
    strategy?: CompactionStrategy
  ) {
    super()
    this.budget = { ...DEFAULT_CONTEXT_BUDGET, ...config }
    this.strategy = strategy ?? new DefaultCompactionStrategy()
    this.tokenConfig = DEFAULT_TOKEN_CONFIG
  }

  // ============================================================================
  // Budget Management
  // ============================================================================

  /**
   * 获取当前预算
   */
  getBudget(): ContextBudget {
    return { ...this.budget }
  }

  /**
   * 更新预算
   */
  updateBudget(config: Partial<ContextBudget>): void {
    this.budget = { ...this.budget, ...config }
    this.checkBudget()
  }

  /**
   * 获取已使用 Token
   */
  getUsedTokens(): number {
    return this.messages.reduce(
      (sum, m) => sum + (m.tokens ?? this.estimateTokens(m.content)),
      0
    )
  }

  /**
   * 获取剩余 Token
   */
  getRemainingTokens(): number {
    return this.budget.maxTokens - this.getUsedTokens()
  }

  /**
   * 获取使用百分比
   */
  getUsagePercent(): number {
    return this.getUsedTokens() / this.budget.maxTokens
  }

  // ============================================================================
  // Message Management
  // ============================================================================

  /**
   * 添加消息
   */
  addMessage(message: Message): void {
    const tokens = message.tokens ?? this.estimateTokens(message.content)
    message.tokens = tokens
    
    this.messages.push(message)
    this.budget.usedTokens += tokens
    
    this.checkBudget()
  }

  /**
   * 添加用户消息
   */
  addUserMessage(content: string): Message {
    const message: Message = {
      id: this.generateId(),
      role: 'user',
      content,
      timestamp: Date.now(),
      tokens: this.estimateTokens(content),
    }
    this.addMessage(message)
    return message
  }

  /**
   * 添加助手消息
   */
  addAssistantMessage(content: string): Message {
    const message: Message = {
      id: this.generateId(),
      role: 'assistant',
      content,
      timestamp: Date.now(),
      tokens: this.estimateTokens(content),
    }
    this.addMessage(message)
    return message
  }

  /**
   * 添加工具消息
   */
  addToolMessage(
    toolName: string,
    content: string,
    toolInput?: Record<string, unknown>,
    toolOutput?: unknown
  ): Message {
    const message: Message = {
      id: this.generateId(),
      role: 'tool',
      content,
      timestamp: Date.now(),
      tokens: this.estimateTokens(content),
      metadata: { toolName, toolInput, toolOutput },
    }
    this.addMessage(message)
    return message
  }

  /**
   * 获取所有消息
   */
  getMessages(): Message[] {
    return [...this.messages]
  }

  /**
   * 清空消息
   */
  clear(): void {
    this.messages = []
    this.budget.usedTokens = 0
  }

  // ============================================================================
  // Budget Checking
  // ============================================================================

  /**
   * 检查预算
   */
  private checkBudget(): void {
    const usedPercent = this.getUsagePercent()
    
    if (usedPercent >= this.budget.errorThreshold) {
      this.emit('budget_exceeded', this.createEvent('budget_exceeded'))
      throw new Error('Context budget exceeded')
    }
    
    if (usedPercent >= this.budget.warningThreshold) {
      this.emit('budget_warning', this.createEvent('budget_warning', {
        usedPercent,
        remainingTokens: this.getRemainingTokens(),
      }))
      
      if (this.budget.autoCompact) {
        this.compact()
      }
    }
  }

  // ============================================================================
  // Compaction
  // ============================================================================

  /**
   * 执行压缩
   */
  async compact(): Promise<CompactionResult | null> {
    const usedPercent = this.getUsagePercent()
    
    if (usedPercent < this.budget.compactThreshold) {
      return null
    }

    this.emit('compaction_start', this.createEvent('compaction_start'))

    try {
      const result = await this.strategy.compact(this.messages, this.budget)
      
      // 更新消息
      this.messages = result.messages
      this.budget.usedTokens = result.compactedTokens
      
      // 记录历史
      this.compactionHistory.push(result)
      
      this.emit('compaction_complete', this.createEvent('compaction_complete', {
        result,
      }))
      
      return result
    } catch (error) {
      // 压缩失败，尝试回滚
      this.emit('compaction_reverted', this.createEvent('compaction_reverted', {
        error: String(error),
      }))
      return null
    }
  }

  /**
   * 获取压缩历史
   */
  getCompactionHistory(): CompactionResult[] {
    return [...this.compactionHistory]
  }

  /**
   * 预估压缩效果
   */
  async estimateCompaction(): Promise<{
    wouldCompact: boolean
    savedTokens: number
    removedMessages: number
  }> {
    const breakpoint = this.strategy.findSafeBreakpoint(this.messages, this.budget)
    
    if (!breakpoint.valid) {
      return {
        wouldCompact: false,
        savedTokens: 0,
        removedMessages: 0,
      }
    }
    
    const summaryTokens = this.estimateTokens(
      await this.strategy.generateSummary(this.messages.slice(0, breakpoint.index))
    )
    
    const savedTokens = breakpoint.tokensBefore - (summaryTokens + breakpoint.tokensAfter)
    
    return {
      wouldCompact: true,
      savedTokens,
      removedMessages: breakpoint.index,
    }
  }

  // ============================================================================
  // Utilities
  // ============================================================================

  private estimateTokens(text: string): number {
    return Math.ceil(text.length / this.tokenConfig.charsPerToken)
  }

  private generateId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  private createEvent(
    type: ContextEvent['type'],
    details?: Record<string, unknown>
  ): ContextEvent {
    return {
      type,
      budget: this.getBudget(),
      timestamp: Date.now(),
      details,
    }
  }
}

// ============================================================================
// Default Export
// ============================================================================

export const defaultContextManager = new ContextManager()

/**
 * 快速添加用户消息
 */
export function addUserMessage(content: string): Message {
  return defaultContextManager.addUserMessage(content)
}

/**
 * 快速添加助手消息
 */
export function addAssistantMessage(content: string): Message {
  return defaultContextManager.addAssistantMessage(content)
}

/**
 * 获取所有消息
 */
export function getMessages(): Message[] {
  return defaultContextManager.getMessages()
}

/**
 * 获取当前使用情况
 */
export function getContextUsage(): {
  used: number
  max: number
  percent: number
  remaining: number
} {
  const used = defaultContextManager.getUsedTokens()
  const max = defaultContextManager.getBudget().maxTokens
  return {
    used,
    max,
    percent: used / max,
    remaining: max - used,
  }
}
