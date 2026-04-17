/**
 * Analytics Module - Analytics Manager
 * 分析系统 - 事件追踪 + 特性开关
 */

import { EventEmitter } from '../eventEmitter'
import type {
  AnalyticsEvent,
  AnalyticsConfig,
  AnalyticsExporter,
  EventType,
  FeatureFlag,
  FeatureValue,
  Experiment,
  BucketResult,
  ToolUseEvent,
  PermissionEvent,
} from './types'
import { DEFAULT_ANALYTICS_CONFIG } from './types'

// ============================================================================
// Console Exporter
// ============================================================================

class ConsoleExporter implements AnalyticsExporter {
  async export(events: AnalyticsEvent[]): Promise<void> {
    for (const event of events) {
      console.log(`[Analytics] ${event.type}:`, JSON.stringify(event.properties, null, 2))
    }
  }

  async flush(): Promise<void> {
    // No-op for console
  }
}

// ============================================================================
// HTTP Exporter
// ============================================================================

class HttpExporter implements AnalyticsExporter {
  constructor(private endpoint: string) {}

  async export(events: AnalyticsEvent[]): Promise<void> {
    try {
      await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ events }),
      })
    } catch (error) {
      console.error('Failed to export analytics:', error)
    }
  }

  async flush(): Promise<void> {
    // HTTP usually handles batching internally
  }
}

// ============================================================================
// Analytics Manager
// ============================================================================

/**
 * 分析管理器
 */
export class AnalyticsManager extends EventEmitter {
  private config: AnalyticsConfig
  private eventQueue: AnalyticsEvent[] = []
  private exporter: AnalyticsExporter
  private flushTimer: ReturnType<typeof setInterval> | null = null
  private featureFlags: Map<string, FeatureFlag> = new Map()
  private experiments: Map<string, Experiment> = new Map()
  private userBucketCache: Map<string, BucketResult> = new Map()

  constructor(config: Partial<AnalyticsConfig> = {}) {
    super()
    this.config = { ...DEFAULT_ANALYTICS_CONFIG, ...config }
    
    // Setup exporter
    if (this.config.endpoint) {
      this.exporter = new HttpExporter(this.config.endpoint)
    } else {
      this.exporter = new ConsoleExporter()
    }

    // Start flush timer
    if (this.config.enabled) {
      this.startFlushTimer()
    }

    // Initialize default features
    this.initDefaultFeatures()
  }

  // ============================================================================
  // Event Tracking
  // ============================================================================

  /**
   * 追踪事件
   */
  track(
    type: EventType,
    properties: Record<string, unknown>
  ): void {
    if (!this.config.enabled) return

    // Sampling
    if (Math.random() > this.config.sampleRate) return

    const event: AnalyticsEvent = {
      id: this.generateId(),
      type,
      timestamp: Date.now(),
      userId: this.config.userId,
      sessionId: this.config.sessionId,
      properties,
    }

    this.eventQueue.push(event)

    // Check queue size
    if (this.eventQueue.length >= this.config.maxQueueSize) {
      void this.flush()
    }
  }

  /**
   * 追踪工具使用
   */
  trackToolUse(tool: string, duration: number, success: boolean, error?: string): void {
    this.track('tool_use', { tool, duration, success, error })
  }

  /**
   * 追踪权限请求
   */
  trackPermission(
    tool: string,
    riskLevel: string,
    decision: 'allow' | 'deny' | 'ask',
    reason?: string
  ): void {
    this.track('permission_request', { tool, riskLevel, decision, reason })
  }

  /**
   * 追踪 API 请求
   */
  trackApiRequest(
    model: string,
    inputTokens: number,
    outputTokens: number,
    duration: number,
    status: number
  ): void {
    this.track('api_request', {
      model,
      inputTokens,
      outputTokens,
      duration,
      status,
    })
  }

  /**
   * 追踪错误
   */
  trackError(error: Error, context?: Record<string, unknown>): void {
    this.track('error', {
      message: error.message,
      stack: error.stack,
      ...context,
    })
  }

  /**
   * 追踪会话事件
   */
  trackSession(event: 'start' | 'end', metadata?: Record<string, unknown>): void {
    this.track(event === 'start' ? 'session_start' : 'session_end', metadata || {})
  }

  // ============================================================================
  // Flush
  // ============================================================================

  /**
   * 刷新事件队列
   */
  async flush(): Promise<void> {
    if (this.eventQueue.length === 0) return

    const events = [...this.eventQueue]
    this.eventQueue = []

    try {
      await this.exporter.export(events)
    } catch (error) {
      // Re-queue on failure
      this.eventQueue.unshift(...events)
      console.error('Failed to export analytics:', error)
    }
  }

  /**
   * 启动刷新定时器
   */
  private startFlushTimer(): void {
    this.flushTimer = setInterval(() => {
      void this.flush()
    }, this.config.flushInterval)
  }

  /**
   * 停止刷新
   */
  stop(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer)
      this.flushTimer = null
    }
    void this.flush()
  }

  // ============================================================================
  // Feature Flags
  // ============================================================================

  /**
   * 初始化默认特性
   */
  private initDefaultFeatures(): void {
    const defaults: FeatureFlag[] = [
      { name: 'enhanced_permissions', value: false, defaultValue: false, enabled: true },
      { name: 'context_compaction', value: false, defaultValue: false, enabled: true },
      { name: 'multi_agent', value: false, defaultValue: false, enabled: true },
      { name: 'analytics', value: true, defaultValue: true, enabled: true },
      { name: 'vim_mode', value: true, defaultValue: true, enabled: true },
      { name: 'auto_compact', value: true, defaultValue: true, enabled: true },
      { name: 'permission_ask', value: true, defaultValue: true, enabled: true },
    ]

    for (const feature of defaults) {
      this.featureFlags.set(feature.name, feature)
    }
  }

  /**
   * 设置特性值
   */
  setFeature(name: string, value: FeatureValue): void {
    const flag = this.featureFlags.get(name)
    if (flag) {
      flag.value = value
    } else {
      this.featureFlags.set(name, {
        name,
        value,
        defaultValue: value,
        enabled: true,
      })
    }
  }

  /**
   * 获取特性值
   */
  getFeature<T extends FeatureValue>(name: string): T | undefined {
    const flag = this.featureFlags.get(name)
    return flag?.value as T | undefined
  }

  /**
   * 获取特性值（带默认值）
   */
  getFeatureValue<T extends FeatureValue>(name: string, defaultValue: T): T {
    const flag = this.featureFlags.get(name)
    if (!flag || !flag.enabled) return defaultValue
    if (typeof flag.value !== typeof defaultValue) return defaultValue
    return flag.value as T
  }

  /**
   * 检查特性是否启用
   */
  isFeatureEnabled(name: string): boolean {
    const flag = this.featureFlags.get(name)
    return flag?.enabled ?? false
  }

  /**
   * 获取所有特性
   */
  listFeatures(): FeatureFlag[] {
    return Array.from(this.featureFlags.values())
  }

  /**
   * 批量设置特性
   */
  setFeatures(features: Record<string, FeatureValue>): void {
    for (const [name, value] of Object.entries(features)) {
      this.setFeature(name, value)
    }
  }

  // ============================================================================
  // A/B Testing
  // ============================================================================

  /**
   * 注册实验
   */
  registerExperiment(experiment: Experiment): void {
    this.experiments.set(experiment.id, experiment)
  }

  /**
   * 获取用户 bucket
   */
  getBucket(experimentId: string, userId?: string): BucketResult {
    const cacheKey = `${experimentId}:${userId || 'anonymous'}`
    
    if (this.userBucketCache.has(cacheKey)) {
      return this.userBucketCache.get(cacheKey)!
    }

    const experiment = this.experiments.get(experimentId)
    if (!experiment || !experiment.active) {
      return { experimentId, variant: experiment?.variants[0] || '', bucket: 0 }
    }

    // Simple hashing for bucket assignment
    const hashInput = `${experimentId}:${userId || Math.random()}`
    const hash = this.simpleHash(hashInput)
    const bucket = hash % 100

    // Select variant based on bucket
    const variantIndex = Math.floor((bucket / 100) * experiment.variants.length)
    const variant = experiment.variants[variantIndex] || experiment.variants[0]

    const result: BucketResult = { experimentId, variant, bucket }
    this.userBucketCache.set(cacheKey, result)
    
    return result
  }

  /**
   * 简单哈希
   */
  private simpleHash(str: string): number {
    let hash = 0
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i)
      hash = ((hash << 5) - hash) + char
      hash = hash & hash
    }
    return Math.abs(hash)
  }

  // ============================================================================
  // Configuration
  // ============================================================================

  /**
   * 更新配置
   */
  updateConfig(config: Partial<AnalyticsConfig>): void {
    this.config = { ...this.config, ...config }
  }

  /**
   * 获取配置
   */
  getConfig(): AnalyticsConfig {
    return { ...this.config }
  }

  /**
   * 启用
   */
  enable(): void {
    this.config.enabled = true
    this.startFlushTimer()
  }

  /**
   * 禁用
   */
  disable(): void {
    this.config.enabled = false
    this.stop()
  }

  // ============================================================================
  // Utilities
  // ============================================================================

  private generateId(): string {
    return `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  /**
   * 获取队列状态
   */
  getQueueStatus(): { size: number; maxSize: number } {
    return {
      size: this.eventQueue.length,
      maxSize: this.config.maxQueueSize,
    }
  }
}

// ============================================================================
// Global Analytics
// ============================================================================

export const globalAnalytics = new AnalyticsManager()

/**
 * 快捷追踪
 */
export function track(type: EventType, properties: Record<string, unknown>): void {
  globalAnalytics.track(type, properties)
}

/**
 * 快捷特性检查
 */
export function feature(name: string): boolean {
  return globalAnalytics.isFeatureEnabled(name)
}

/**
 * 快捷特性值获取
 */
export function getFeatureValue<T extends FeatureValue>(name: string, defaultValue: T): T {
  return globalAnalytics.getFeatureValue(name, defaultValue)
}

/**
 * 追踪工具使用
 */
export function trackToolUse(tool: string, duration: number, success: boolean, error?: string): void {
  globalAnalytics.trackToolUse(tool, duration, success, error)
}

/**
 * 追踪 API 请求
 */
export function trackApiRequest(
  model: string,
  inputTokens: number,
  outputTokens: number,
  duration: number,
  status: number
): void {
  globalAnalytics.trackApiRequest(model, inputTokens, outputTokens, duration, status)
}
