/**
 * Transport Module - Transport Manager
 * 传输层 - 自动重连 + 心跳 + 消息缓冲
 */

import { EventEmitter } from '../eventEmitter'
import type {
  Message,
  TransportType,
  TransportState,
  TransportConfig,
  TransportEvent,
  ReconnectStrategy,
  HeartbeatConfig,
  BufferConfig,
} from './types'
import {
  DEFAULT_RECONNECT_STRATEGY,
  DEFAULT_HEARTBEAT_CONFIG,
  DEFAULT_BUFFER_CONFIG,
} from './types'

// ============================================================================
// Message Buffer
// ============================================================================

/**
 * 消息缓冲区
 */
class MessageBuffer {
  private messages: Message[] = []
  private config: BufferConfig

  constructor(config: Partial<BufferConfig> = {}) {
    this.config = { ...DEFAULT_BUFFER_CONFIG, ...config }
  }

  /**
   * 添加消息
   */
  push(message: Message): void {
    this.messages.push(message)
    
    if (this.config.flushOn === 'size' || this.config.flushOn === 'both') {
      if (this.messages.length >= this.config.maxSize) {
        this.flush()
      }
    }
  }

  /**
   * 获取并清空
   */
  flush(): Message[] {
    const result = [...this.messages]
    this.messages = []
    return result
  }

  /**
   * 获取数量
   */
  size(): number {
    return this.messages.length
  }

  /**
   * 清空
   */
  clear(): void {
    this.messages = []
  }
}

// ============================================================================
// Base Transport
// ============================================================================

/**
 * 传输管理器抽象基类
 */
export abstract class BaseTransport extends EventEmitter {
  protected url: string
  protected type: TransportType
  protected state: TransportState = 'idle'
  protected config: TransportConfig
  protected reconnectStrategy: ReconnectStrategy
  protected heartbeatConfig: HeartbeatConfig
  protected buffer: MessageBuffer
  protected reconnectAttempts = 0
  protected reconnectTimer: ReturnType<typeof setTimeout> | null = null
  protected heartbeatTimer: ReturnType<typeof setInterval> | null = null
  protected heartbeatPongTimer: ReturnType<typeof setTimeout> | null = null

  constructor(config: TransportConfig) {
    super()
    this.url = config.url
    this.type = config.type
    this.config = config
    
    // Parse reconnect strategy
    if (config.reconnect === true) {
      this.reconnectStrategy = DEFAULT_RECONNECT_STRATEGY
    } else if (config.reconnect === false) {
      this.reconnectStrategy = { ...DEFAULT_RECONNECT_STRATEGY, maxAttempts: 0 }
    } else {
      this.reconnectStrategy = { ...DEFAULT_RECONNECT_STRATEGY, ...config.reconnect }
    }

    this.heartbeatConfig = {
      ...DEFAULT_HEARTBEAT_CONFIG,
      enabled: config.heartbeat,
      interval: config.heartbeatInterval,
    }

    this.buffer = new MessageBuffer()
  }

  // ============================================================================
  // Connection
  // ============================================================================

  /**
   * 连接
   */
  abstract connect(): Promise<void>

  /**
   * 断开
   */
  abstract disconnect(): Promise<void>

  /**
   * 发送消息
   */
  abstract send(message: Message): Promise<void>

  /**
   * 获取状态
   */
  getState(): TransportState {
    return this.state
  }

  /**
   * 是否已连接
   */
  isConnected(): boolean {
    return this.state === 'connected'
  }

  // ============================================================================
  // Reconnection
  // ============================================================================

  /**
   * 计算重连延迟
   */
  protected calculateDelay(): number {
    let delay: number

    switch (this.reconnectStrategy.backoff) {
      case 'exponential':
        delay = Math.min(
          this.reconnectStrategy.baseDelay * Math.pow(2, this.reconnectAttempts),
          this.reconnectStrategy.maxDelay
        )
        break
      case 'linear':
        delay = Math.min(
          this.reconnectStrategy.baseDelay * (this.reconnectAttempts + 1),
          this.reconnectStrategy.maxDelay
        )
        break
      case 'fixed':
      default:
        delay = this.reconnectStrategy.baseDelay
    }

    // Add jitter
    if (this.reconnectStrategy.jitter) {
      delay = delay * (0.5 + Math.random() * 0.5)
    }

    return delay
  }

  /**
   * 安排重连
   */
  protected scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.reconnectStrategy.maxAttempts) {
      this.state = 'closed'
      this.emit('error', { message: 'Max reconnection attempts reached' })
      return
    }

    this.state = 'reconnecting'
    const delay = this.calculateDelay()
    
    this.emit('reconnecting', { attempt: this.reconnectAttempts, delay })

    this.reconnectTimer = setTimeout(() => {
      this.reconnectAttempts++
      void this.connect()
    }, delay)
  }

  /**
   * 重置重连状态
   */
  protected resetReconnect(): void {
    this.reconnectAttempts = 0
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  // ============================================================================
  // Heartbeat
  // ============================================================================

  /**
   * 启动心跳
   */
  protected startHeartbeat(): void {
    if (!this.heartbeatConfig.enabled) return

    this.heartbeatTimer = setInterval(() => {
      if (this.state !== 'connected') return
      this.sendPing()
    }, this.heartbeatConfig.interval)
  }

  /**
   * 停止心跳
   */
  protected stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
    if (this.heartbeatPongTimer) {
      clearTimeout(this.heartbeatPongTimer)
      this.heartbeatPongTimer = null
    }
  }

  /**
   * 发送 Ping
   */
  protected abstract sendPing(): void

  /**
   * 处理 Pong
   */
  protected handlePong(): void {
    if (this.heartbeatPongTimer) {
      clearTimeout(this.heartbeatPongTimer)
      this.heartbeatPongTimer = null
    }
  }

  // ============================================================================
  // Buffer
  // ============================================================================

  /**
   * 缓冲并发送
   */
  protected async bufferSend(message: Message): Promise<void> {
    this.buffer.push(message)
    
    if (this.buffer.size() >= this.config.maxSize || !this.config.maxSize) {
      await this.flushBuffer()
    }
  }

  /**
   * 刷新缓冲区
   */
  protected async flushBuffer(): Promise<void> {
    const messages = this.buffer.flush()
    for (const msg of messages) {
      await this.send(msg)
    }
  }

  // ============================================================================
  // Events
  // ============================================================================

  /**
   * 触发事件
   */
  protected emitEvent(type: TransportEvent['type'], data?: unknown): void {
    this.emit(type, { type, timestamp: Date.now(), data } as TransportEvent)
  }

  // ============================================================================
  // Cleanup
  // ============================================================================

  /**
   * 清理
   */
  protected cleanup(): void {
    this.stopHeartbeat()
    this.resetReconnect()
    this.buffer.clear()
  }
}

// ============================================================================
// WebSocket Transport
// ============================================================================

/**
 * WebSocket 传输
 */
export class WebSocketTransport extends BaseTransport {
  private ws: WebSocket | null = null

  constructor(config: TransportConfig) {
    super(config)
  }

  async connect(): Promise<void> {
    if (this.state === 'connected' || this.state === 'connecting') return

    this.state = 'connecting'

    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.url, {
          headers: this.config.headers,
        })

        this.ws.onopen = () => {
          this.state = 'connected'
          this.resetReconnect()
          this.startHeartbeat()
          this.emitEvent('connect')
          resolve()
        }

        this.ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data) as Message
            this.emit('message', message)
            this.emitEvent('message', message)
          } catch {
            // Not JSON, ignore
          }
        }

        this.ws.onerror = (error) => {
          this.emit('error', error)
          if (this.state === 'connecting') {
            reject(error)
          }
        }

        this.ws.onclose = () => {
          this.state = 'closed'
          this.stopHeartbeat()
          this.emitEvent('disconnect')

          if (this.reconnectStrategy.maxAttempts > 0) {
            this.scheduleReconnect()
          }
        }
      } catch (error) {
        this.state = 'closed'
        reject(error)
      }
    })
  }

  async disconnect(): Promise<void> {
    this.state = 'closing'
    this.cleanup()
    
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
    
    this.state = 'closed'
    this.emitEvent('close')
  }

  async send(message: Message): Promise<void> {
    if (this.state !== 'connected' || !this.ws) {
      await this.bufferSend(message)
      return
    }

    this.ws.send(JSON.stringify(message))
  }

  protected sendPing(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }))
      
      // Set pong timeout
      this.heartbeatPongTimer = setTimeout(() => {
        // No pong received, connection may be dead
        this.ws?.close()
      }, this.heartbeatConfig.timeout)
    }
  }
}

// ============================================================================
// HTTP Transport
// ============================================================================

/**
 * HTTP 传输
 */
export class HttpTransport extends BaseTransport {
  constructor(config: TransportConfig) {
    super(config)
  }

  async connect(): Promise<void> {
    this.state = 'connected'
    this.emitEvent('connect')
  }

  async disconnect(): Promise<void> {
    this.state = 'closing'
    this.cleanup()
    this.state = 'closed'
    this.emitEvent('close')
  }

  async send(message: Message): Promise<void> {
    try {
      await fetch(this.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.config.headers,
        },
        body: JSON.stringify(message),
        signal: AbortSignal.timeout(this.config.timeout),
      })
    } catch (error) {
      this.emit('error', error)
      throw error
    }
  }

  protected sendPing(): void {
    // HTTP doesn't have ping/pong, just check connectivity
  }
}

// ============================================================================
// Transport Factory
// ============================================================================

/**
 * 创建传输
 */
export function createTransport(config: TransportConfig): BaseTransport {
  switch (config.type) {
    case 'websocket':
      return new WebSocketTransport(config)
    case 'http':
    case 'sse':
      return new HttpTransport(config)
    default:
      return new WebSocketTransport(config)
  }
}

// ============================================================================
// Default Export
// ============================================================================

/**
 * 创建默认 WebSocket 传输
 */
export function createDefaultTransport(url: string): WebSocketTransport {
  return new WebSocketTransport({
    url,
    type: 'websocket',
    reconnect: true,
    heartbeat: true,
    heartbeatInterval: 30000,
    timeout: 10000,
  })
}
