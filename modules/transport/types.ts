/**
 * Transport Module - Type Definitions
 * 传输层模块 - 基于 Claude Code 传输系统设计
 */

// ============================================================================
// Message Types
// ============================================================================

export interface Message {
  id: string
  type: string
  payload: unknown
  timestamp: number
}

export interface StreamMessage extends Message {
  type: 'stream_event' | 'stream_data' | 'stream_end'
}

export interface ControlMessage extends Message {
  type: 'control_request' | 'control_response' | 'control_cancel'
}

// ============================================================================
// Transport Types
// ============================================================================

export type TransportType = 
  | 'websocket'   // WebSocket 全双工
  | 'sse'         // Server-Sent Events
  | 'http'        // HTTP POST
  | 'hybrid'      // 混合模式

export type TransportState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'closing'
  | 'closed'

// ============================================================================
// Reconnection Strategy
// ============================================================================

export interface ReconnectStrategy {
  maxAttempts: number
  baseDelay: number
  maxDelay: number
  backoff: 'exponential' | 'linear' | 'fixed'
  jitter: boolean
}

export const DEFAULT_RECONNECT_STRATEGY: ReconnectStrategy = {
  maxAttempts: 10,
  baseDelay: 1000,    // 1 second
  maxDelay: 30000,    // 30 seconds
  backoff: 'exponential',
  jitter: true,
}

// ============================================================================
// Transport Config
// ============================================================================

export interface TransportConfig {
  url: string
  type: TransportType
  reconnect: boolean | ReconnectStrategy
  heartbeat: boolean
  heartbeatInterval: number
  timeout: number
  headers?: Record<string, string>
}

// ============================================================================
// Transport Events
// ============================================================================

export type TransportEventType =
  | 'connect'
  | 'disconnect'
  | 'reconnecting'
  | 'message'
  | 'error'
  | 'close'

export interface TransportEvent {
  type: TransportEventType
  timestamp: number
  data?: unknown
}

// ============================================================================
// Heartbeat
// ============================================================================

export interface HeartbeatConfig {
  enabled: boolean
  interval: number
  timeout: number
  pingMessage?: string
  pongMessage?: string
}

export const DEFAULT_HEARTBEAT_CONFIG: HeartbeatConfig = {
  enabled: true,
  interval: 30000,   // 30 seconds
  timeout: 10000,    // 10 seconds
}

// ============================================================================
// Buffer
// ============================================================================

export interface BufferConfig {
  maxSize: number
  flushInterval: number
  flushOn: 'manual' | 'size' | 'interval' | 'both'
}

export const DEFAULT_BUFFER_CONFIG: BufferConfig = {
  maxSize: 100,
  flushInterval: 100,  // 100ms
  flushOn: 'both',
}
