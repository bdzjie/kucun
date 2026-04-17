/**
 * Permission Module - Permission Manager
 * 权限管理器
 */

import { EventEmitter } from '../eventEmitter'
import type {
  PermissionContext,
  PermissionDecision,
  PermissionMode,
  PermissionRequest,
  PermissionRule,
  PermissionConfig,
  PermissionEvent,
  ToolRiskAssessment,
  RiskLevel,
  ToolCategory,
} from './types'
import { RiskAssessor, defaultRiskAssessor } from './assessor'

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_CONFIG: PermissionConfig = {
  defaultMode: PermissionMode.ASK,
  enabled: true,
  logAllRequests: true,
  askTimeout: 60000, // 1 minute
  maxHistory: 1000,
  dangerousCommands: ['rm -rf', 'dd if=', 'curl | sh', 'wget | sh'],
}

// ============================================================================
// Permission Manager
// ============================================================================

/**
 * 权限管理器
 */
export class PermissionManager extends EventEmitter {
  private mode: PermissionMode
  private config: PermissionConfig
  private requests: Map<string, PermissionRequest> = new Map()
  private rules: PermissionRule[] = []
  private allowList: Set<string> = new Set()
  private denyList: Set<string> = new Set()
  private riskAssessor: RiskAssessor
  private pendingPrompts: Map<string, {
    resolve: (decision: 'allow' | 'deny' | 'cancel') => void
    reject: (error: Error) => void
    timeout: ReturnType<typeof setTimeout>
  }> = new Map()

  constructor(config: Partial<PermissionConfig> = {}) {
    super()
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.mode = this.config.defaultMode
    this.riskAssessor = defaultRiskAssessor
    this.initDefaultRules()
  }

  /**
   * 初始化默认规则
   */
  private initDefaultRules(): void {
    // 低风险操作自动允许
    this.addRule({
      id: 'auto-allow-low-risk',
      name: 'Auto Allow Low Risk',
      tools: ['Read', 'Glob', 'Grep', 'WebFetch', 'View', 'LS', 'Search'],
      allowedRiskLevels: ['low'],
      defaultDecision: 'allow',
      enabled: true,
      priority: 0,
    })

    // 高风险操作自动拒绝
    this.addRule({
      id: 'auto-deny-critical',
      name: 'Auto Deny Critical',
      tools: ['*'],
      allowedRiskLevels: ['critical'],
      defaultDecision: 'deny',
      enabled: true,
      priority: 100,
    })

    // 破坏性操作需要询问
    this.addRule({
      id: 'ask-destructive',
      name: 'Ask for Destructive',
      tools: ['*'],
      allowedRiskLevels: ['high'],
      defaultDecision: 'ask',
      enabled: true,
      priority: 50,
    })
  }

  // ============================================================================
  // Configuration
  // ============================================================================

  /**
   * 获取当前模式
   */
  getMode(): PermissionMode {
    return this.mode
  }

  /**
   * 设置模式
   */
  setMode(mode: PermissionMode): void {
    this.mode = mode
  }

  /**
   * 获取配置
   */
  getConfig(): PermissionConfig {
    return { ...this.config }
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<PermissionConfig>): void {
    this.config = { ...this.config, ...config }
  }

  // ============================================================================
  // Rules
  // ============================================================================

  /**
   * 添加规则
   */
  addRule(rule: PermissionRule): void {
    this.rules.push(rule)
    this.rules.sort((a, b) => b.priority - a.priority)
  }

  /**
   * 移除规则
   */
  removeRule(ruleId: string): void {
    this.rules = this.rules.filter(r => r.id !== ruleId)
  }

  /**
   * 获取规则列表
   */
  getRules(): PermissionRule[] {
    return [...this.rules]
  }

  /**
   * 清空规则
   */
  clearRules(): void {
    this.rules = []
  }

  // ============================================================================
  // Allow/Deny Lists
  // ============================================================================

  /**
   * 添加到允许列表
   */
  addToAllowList(pattern: string): void {
    this.allowList.add(pattern)
  }

  /**
   * 从允许列表移除
   */
  removeFromAllowList(pattern: string): void {
    this.allowList.delete(pattern)
  }

  /**
   * 添加到拒绝列表
   */
  addToDenyList(pattern: string): void {
    this.denyList.add(pattern)
  }

  /**
   * 从拒绝列表移除
   */
  removeFromDenyList(pattern: string): void {
    this.denyList.delete(pattern)
  }

  /**
   * 检查是否在允许列表
   */
  isAllowed(tool: string, input?: Record<string, unknown>): boolean {
    for (const pattern of this.allowList) {
      if (this.matchPattern(pattern, tool, input)) {
        return true
      }
    }
    return false
  }

  /**
   * 检查是否在拒绝列表
   */
  isDenied(tool: string, input?: Record<string, unknown>): boolean {
    for (const pattern of this.denyList) {
      if (this.matchPattern(pattern, tool, input)) {
        return true
      }
    }
    return false
  }

  /**
   * 匹配模式
   */
  private matchPattern(
    pattern: string,
    tool: string,
    input?: Record<string, unknown>
  ): boolean {
    // tool:command 格式
    if (pattern.includes(':')) {
      const [t, cmd] = pattern.split(':')
      if (t !== tool) return false
      if (input?.command) {
        return String(input.command).includes(cmd)
      }
      return false
    }
    // 仅工具名
    return pattern === tool || pattern === '*'
  }

  // ============================================================================
  // Permission Check
  // ============================================================================

  /**
   * 检查权限
   */
  async checkPermission(context: PermissionContext): Promise<PermissionDecision> {
    const requestId = this.generateId()
    const request: PermissionRequest = {
      id: requestId,
      context,
      requestedAt: Date.now(),
    }

    // 1. 记录请求
    this.requests.set(requestId, request)
    this.emit('request', this.createEvent('permission_request', context))

    // 2. BYPASS 模式 - 直接允许
    if (this.mode === PermissionMode.BYPASS) {
      const decision: PermissionDecision = { type: 'allow' }
      this.updateRequest(requestId, decision)
      return decision
    }

    // 3. SAFE 模式 - 检查规则
    if (this.mode === PermissionMode.SAFE) {
      const decision = this.checkRules(context)
      this.updateRequest(requestId, decision)
      return decision
    }

    // 4. ASK 模式 - 交互式询问
    const decision = await this.askUser(requestId, context)
    this.updateRequest(requestId, decision)
    return decision
  }

  /**
   * 同步检查权限（不等待用户响应）
   */
  checkPermissionSync(context: PermissionContext): PermissionDecision {
    // BYPASS 模式
    if (this.mode === PermissionMode.BYPASS) {
      return { type: 'allow' }
    }

    // 检查允许列表
    if (this.isAllowed(context.tool, context.input)) {
      return { type: 'allow' }
    }

    // 检查拒绝列表
    if (this.isDenied(context.tool, context.input)) {
      return { type: 'deny', reason: 'Tool or pattern is in deny list' }
    }

    // 风险评估
    const assessment = this.riskAssessor.assess(context)

    // 低风险 - 自动允许
    if (assessment.level === 'low' && assessment.autoApprove) {
      return { type: 'allow' }
    }

    // 高风险 - 自动拒绝
    if (assessment.level === 'critical') {
      return {
        type: 'deny',
        reason: `Critical risk: ${assessment.factors.join(', ')}`,
      }
    }

    // 规则检查
    return this.checkRules(context)
  }

  /**
   * 检查规则
   */
  private checkRules(context: PermissionContext): PermissionDecision {
    for (const rule of this.rules) {
      if (!rule.enabled) continue

      // 检查工具匹配
      if (!this.matchTool(rule.tools, context.tool)) continue

      // 检查风险等级匹配
      if (!rule.allowedRiskLevels.includes(context.riskLevel)) continue

      // 返回规则决策
      switch (rule.defaultDecision) {
        case 'allow':
          return { type: 'allow' }
        case 'deny':
          return { type: 'deny', reason: `Denied by rule: ${rule.name}` }
        case 'ask':
          return {
            type: 'ask',
            prompt: this.generatePrompt(context),
            context,
          }
      }
    }

    // 默认 ASK
    return {
      type: 'ask',
      prompt: this.generatePrompt(context),
      context,
    }
  }

  /**
   * 匹配工具模式
   */
  private matchTool(tools: string[], tool: string): boolean {
    return tools.includes(tool) || tools.includes('*')
  }

  /**
   * 生成询问提示
   */
  private generatePrompt(context: PermissionContext): string {
    const lines = [
      `工具: ${context.tool}`,
      `类别: ${context.category}`,
      `风险: ${context.riskLevel}`,
    ]

    if (context.paths && context.paths.length > 0) {
      lines.push(`路径: ${context.paths.join(', ')}`)
    }

    if (context.input.command) {
      lines.push(`命令: ${String(context.input.command).substring(0, 100)}`)
    }

    lines.push('')
    lines.push('是否允许执行?')

    return lines.join('\n')
  }

  // ============================================================================
  // User Interaction
  // ============================================================================

  /**
   * 询问用户
   */
  private async askUser(
    requestId: string,
    context: PermissionContext
  ): Promise<PermissionDecision> {
    const assessment = this.riskAssessor.assess(context)
    const prompt = this.generatePrompt(context)

    return new Promise((resolve, reject) => {
      // 设置超时
      const timeout = setTimeout(() => {
        this.pendingPrompts.delete(requestId)
        this.emit('timeout', this.createEvent('permission_timeout', context))
        resolve({
          type: 'deny',
          reason: 'Permission request timed out',
        })
      }, this.config.askTimeout)

      // 存储 Promise 解析器
      this.pendingPrompts.set(requestId, {
        resolve: (response) => {
          clearTimeout(timeout)
          switch (response) {
            case 'allow':
              this.emit('allow', this.createEvent('permission_allow', context))
              resolve({ type: 'allow' })
              break
            case 'deny':
              this.emit('deny', this.createEvent('permission_deny', context))
              resolve({ type: 'deny', reason: 'User denied' })
              break
            case 'cancel':
              this.emit('cancel', this.createEvent('permission_cancel', context))
              resolve({ type: 'deny', reason: 'User cancelled' })
              break
          }
        },
        reject,
        timeout,
      })

      // 触发询问事件
      this.emit('ask', {
        requestId,
        context,
        assessment,
        prompt,
      })
    })
  }

  /**
   * 用户响应
   */
  respond(requestId: string, response: 'allow' | 'deny' | 'cancel'): void {
    const pending = this.pendingPrompts.get(requestId)
    if (pending) {
      pending.resolve(response)
      this.pendingPrompts.delete(requestId)
    }
  }

  /**
   * 取消请求
   */
  cancelRequest(requestId: string): void {
    const pending = this.pendingPrompts.get(requestId)
    if (pending) {
      clearTimeout(pending.timeout)
      pending.reject(new Error('Request cancelled'))
      this.pendingPrompts.delete(requestId)
    }
  }

  // ============================================================================
  // Request Management
  // ============================================================================

  /**
   * 更新请求
   */
  private updateRequest(
    requestId: string,
    decision: PermissionDecision
  ): void {
    const request = this.requests.get(requestId)
    if (request) {
      request.decision = decision
      request.respondedAt = Date.now()
    }

    // 清理旧请求
    this.cleanupOldRequests()
  }

  /**
   * 清理旧请求
   */
  private cleanupOldRequests(): void {
    if (this.requests.size > this.config.maxHistory) {
      const entries = Array.from(this.requests.entries())
      entries.sort((a, b) => b[1].requestedAt - a[1].requestedAt)
      
      const toDelete = entries.slice(this.config.maxHistory)
      for (const [id] of toDelete) {
        this.requests.delete(id)
      }
    }
  }

  /**
   * 获取请求历史
   */
  getHistory(limit?: number): PermissionRequest[] {
    const all = Array.from(this.requests.values())
    all.sort((a, b) => b.requestedAt - a.requestedAt)
    return limit ? all.slice(0, limit) : all
  }

  /**
   * 获取请求
   */
  getRequest(requestId: string): PermissionRequest | undefined {
    return this.requests.get(requestId)
  }

  // ============================================================================
  // Utilities
  // ============================================================================

  /**
   * 生成 ID
   */
  private generateId(): string {
    return `perm_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  /**
   * 创建事件
   */
  private createEvent(
    type: PermissionEvent['type'],
    context: PermissionContext
  ): PermissionEvent {
    return {
      type,
      context,
      timestamp: Date.now(),
    }
  }

  /**
   * 创建权限上下文
   */
  createContext(
    tool: string,
    input: Record<string, unknown>,
    category: ToolCategory = 'other',
    options?: {
      sessionId?: string
      userId?: string
      destructive?: boolean
      paths?: string[]
    }
  ): PermissionContext {
    const assessment = this.riskAssessor.assess({
      tool,
      input,
      timestamp: Date.now(),
      category,
      ...options,
    })

    return {
      tool,
      input,
      timestamp: Date.now(),
      riskLevel: assessment.level,
      category,
      destructive: options?.destructive,
      paths: options?.paths,
      sessionId: options?.sessionId,
      userId: options?.userId,
    }
  }
}

// ============================================================================
// Default Export
// ============================================================================

export const defaultPermissionManager = new PermissionManager()

/**
 * 快速权限检查
 */
export async function checkPermission(
  context: PermissionContext
): Promise<PermissionDecision> {
  return defaultPermissionManager.checkPermission(context)
}

/**
 * 同步权限检查
 */
export function checkPermissionSync(
  context: PermissionContext
): PermissionDecision {
  return defaultPermissionManager.checkPermissionSync(context)
}
