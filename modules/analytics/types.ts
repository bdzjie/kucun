/**
 * Analytics Module - Type Definitions
 * 分析系统 - 基于 Claude Code 分析系统设计
 */

// ============================================================================
// Event Types
// ============================================================================

export type EventType =
  | 'tool_use'
  | 'permission_request'
  | 'permission_decision'
  | 'api_request'
  | 'api_response'
  | 'error'
  | 'session_start'
  | 'session_end'
  | 'task_start'
  | 'task_complete'
  | 'compaction'
  | 'custom'

// ============================================================================
// Event Definitions
// ============================================================================

export interface AnalyticsEvent {
  id: string
  type: EventType
  timestamp: number
  userId?: string
  sessionId?: string
  properties: Record<string, unknown>
}

export interface ToolUseEvent extends AnalyticsEvent {
  type: 'tool_use'
  properties: {
    tool: string
    duration: number
    success: boolean
    error?: string
  }
}

export interface PermissionEvent extends AnalyticsEvent {
  type: 'permission_request' | 'permission_decision'
  properties: {
    tool: string
    riskLevel: string
    decision: 'allow' | 'deny' | 'ask'
    reason?: string
  }
}

export interface ApiEvent extends AnalyticsEvent {
  type: 'api_request' | 'api_response'
  properties: {
    model: string
    inputTokens: number
    outputTokens: number
    duration: number
    status: number
  }
}

// ============================================================================
// Feature Flags
// ============================================================================

export type FeatureValue = boolean | string | number | object

export interface FeatureFlag {
  name: string
  value: FeatureValue
  defaultValue: FeatureValue
  enabled: boolean
  rollout?: number  // 0-100 percentage
  metadata?: Record<string, unknown>
}

// ============================================================================
// A/B Testing
// ============================================================================

export interface Experiment {
  id: string
  name: string
  variants: string[]
  active: boolean
  metadata?: Record<string, unknown>
}

export interface BucketResult {
  experimentId: string
  variant: string
  bucket: number
}

// ============================================================================
// Analytics Config
// ============================================================================

export interface AnalyticsConfig {
  enabled: boolean
  endpoint?: string
  flushInterval: number
  maxQueueSize: number
  sampleRate: number
  userId?: string
  sessionId?: string
}

// ============================================================================
// Default Config
// ============================================================================

export const DEFAULT_ANALYTICS_CONFIG: AnalyticsConfig = {
  enabled: true,
  flushInterval: 5000, // 5 seconds
  maxQueueSize: 100,
  sampleRate: 1.0, // 100%
}

// ============================================================================
// Exporter Types
// ============================================================================

export interface AnalyticsExporter {
  export(events: AnalyticsEvent[]): Promise<void>
  flush(): Promise<void>
}

export type ExporterType = 'console' | 'http' | 'otlp' | 'custom'
