/**
 * app_context.ts — ForgeApp-style Service Container
 * ==================================================
 *
 * Inspired by Skyvern's ForgeApp:
 *   - Single container holds all shared services
 *   - Services are initialized once and injected
 *   - Type-safe access via getters
 *
 * Usage:
 *   const ctx = AppContext.getInstance()
 *   ctx.setProvider(runtimeProvider)
 *   const provider = ctx.getProvider()
 */

import type { RuntimeProvider } from '../provider/types'
import type { ToolContext } from '../registry/registry'

// ============================================================================
// Service Interfaces
// ============================================================================

export interface LLMConfig {
  model: string
  provider: string
  maxTokens?: number
  temperature?: number
}

export interface ProviderService {
  get(): RuntimeProvider | null
  set(provider: RuntimeProvider): void
  reset(): void
}

export interface StorageService {
  read(key: string): string | null
  write(key: string, value: string): void
  delete(key: string): void
  list(prefix?: string): string[]
}

export interface CacheService {
  get<T>(key: string): T | null
  set<T>(key: string, value: T, ttlMs?: number): void
  delete(key: string): void
  clear(): void
}

// ============================================================================
// AppContext — Service Container
// ============================================================================

export class AppContext {
  private static _instance: AppContext | null = null

  // ─── Services ───────────────────────────────────────────────────────────
  private _provider: RuntimeProvider | null = null
  private _routingResult: RoutingContext | null = null
  private _toolContext: ToolContext | null = null

  // Cost tracking
  private _totalCost: number = 0
  private _sessionCosts: Map<string, number> = new Map()

  // Provider pool for multi-model fallback
  private _providerPool: Map<string, RuntimeProvider> = new Map()
  private _activeProvider: string = 'default'

  private constructor() {}

  static getInstance(): AppContext {
    if (!AppContext._instance) {
      AppContext._instance = new AppContext()
    }
    return AppContext._instance
  }

  // ─── Provider ──────────────────────────────────────────────────────────
  getProvider(): RuntimeProvider | null {
    return this._provider
  }

  setProvider(provider: RuntimeProvider, name: string = 'default'): void {
    this._provider = provider
    this._activeProvider = name
    this._providerPool.set(name, provider)
  }

  getProviderPool(): Map<string, RuntimeProvider> {
    return new Map(this._providerPool)
  }

  getActiveProviderName(): string {
    return this._activeProvider
  }

  /**
   * Switch to a different provider in the pool (for fallback)
   */
  switchProvider(name: string): boolean {
    const provider = this._providerPool.get(name)
    if (!provider) return false
    this._provider = provider
    this._activeProvider = name
    return true
  }

  /**
   * Get next available provider (cycling for load distribution)
   */
  getNextProvider(): RuntimeProvider | null {
    const names = [...this._providerPool.keys()]
    if (names.length <= 1) return this._provider
    const idx = names.indexOf(this._activeProvider)
    const next = names[(idx + 1) % names.length]
    return this._providerPool.get(next) || null
  }

  // ─── Routing Context ───────────────────────────────────────────────────
  getRoutingContext(): RoutingContext | null {
    return this._routingResult
  }

  setRoutingContext(ctx: RoutingContext): void {
    this._routingResult = ctx
  }

  // ─── Tool Context ──────────────────────────────────────────────────────
  getToolContext(): ToolContext | null {
    return this._toolContext
  }

  setToolContext(ctx: ToolContext): void {
    this._toolContext = ctx
  }

  // ─── Cost Tracking ─────────────────────────────────────────────────────
  getTotalCost(): number {
    return this._totalCost
  }

  addCost(amount: number, sessionId?: string): void {
    this._totalCost += amount
    if (sessionId) {
      const prev = this._sessionCosts.get(sessionId) || 0
      this._sessionCosts.set(sessionId, prev + amount)
    }
  }

  getSessionCost(sessionId: string): number {
    return this._sessionCosts.get(sessionId) || 0
  }

  resetSessionCost(sessionId: string): void {
    this._sessionCosts.delete(sessionId)
  }

  // ─── Health ────────────────────────────────────────────────────────────
  getHealth(): ContextHealth {
    return {
      provider: this._provider ? 'ok' : 'uninitialized',
      routingResult: this._routingResult ? 'set' : 'none',
      totalCost: this._totalCost,
      activeProvider: this._activeProvider,
      poolSize: this._providerPool.size,
    }
  }

  // ─── Reset ─────────────────────────────────────────────────────────────
  reset(): void {
    this._provider = null
    this._routingResult = null
    this._toolContext = null
    this._totalCost = 0
    // Keep provider pool
  }
}

// ============================================================================
// Routing Context (carried through the request lifetime)
// ============================================================================

export interface RoutingContext {
  expert: string
  taskType: string
  depth: 'fast' | 'normal' | 'deep'
  confidence: number
  skills: string[]
  chain: SkillChainItem[]
  iteration: number
  startedAt: number
}

export interface SkillChainItem {
  slug: string
  priority: number
  source: 'router' | 'expert' | 'default'
  reason: string
}

// ============================================================================
// Health Report
// ============================================================================

export interface ContextHealth {
  provider: 'ok' | 'uninitialized' | 'error'
  routingResult: 'set' | 'none'
  totalCost: number
  activeProvider: string
  poolSize: number
}

// ============================================================================
// Singleton export
// ============================================================================

export const appContext = AppContext.getInstance()
