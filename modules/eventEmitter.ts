/**
 * Event Emitter - Simple implementation
 */

type EventHandler = (...args: unknown[]) => void

export class EventEmitter {
  private events: Map<string, Set<EventHandler>> = new Map()

  /**
   * 注册事件监听器
   */
  on(event: string, handler: EventHandler): void {
    if (!this.events.has(event)) {
      this.events.set(event, new Set())
    }
    this.events.get(event)!.add(handler)
  }

  /**
   * 注册一次性事件监听器
   */
  once(event: string, handler: EventHandler): void {
    const wrapped = (...args: unknown[]) => {
      this.off(event, wrapped)
      handler(...args)
    }
    this.on(event, wrapped)
  }

  /**
   * 移除事件监听器
   */
  off(event: string, handler: EventHandler): void {
    const handlers = this.events.get(event)
    if (handlers) {
      handlers.delete(handler)
      if (handlers.size === 0) {
        this.events.delete(event)
      }
    }
  }

  /**
   * 触发事件
   */
  emit(event: string, ...args: unknown[]): void {
    const handlers = this.events.get(event)
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(...args)
        } catch (error) {
          console.error(`Error in event handler for ${event}:`, error)
        }
      }
    }
  }

  /**
   * 移除所有监听器
   */
  removeAllListeners(event?: string): void {
    if (event) {
      this.events.delete(event)
    } else {
      this.events.clear()
    }
  }

  /**
   * 获取监听器数量
   */
  listenerCount(event: string): number {
    return this.events.get(event)?.size ?? 0
  }

  /**
   * 获取所有事件名
   */
  eventNames(): string[] {
    return Array.from(this.events.keys())
  }
}
