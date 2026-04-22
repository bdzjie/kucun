/**
 * skill_dispatcher.ts — Skill execution orderer based on Expert Router priority
 * =============================================================================
 *
 * Takes routingResult from AIAgent and dispatches skills in priority order.
 * Skills are invoked via SkillRegistry lookups + handler execution.
 *
 * Usage:
 *   const dispatcher = new SkillDispatcher()
 *   const chain = await dispatcher.buildChain(routingResult)
 *   await dispatcher.executeChain(chain, context)
 */

import { resolve } from 'path'
import * as fs from 'fs'

// ============================================================================
// Types
// ============================================================================

export interface SkillChainItem {
  slug: string
  priority: number      // Lower = more priority
  source: 'router' | 'expert' | 'default'
  reason: string
}

export interface DispatchResult {
  skill: string
  success: boolean
  output?: unknown
  error?: string
  duration: number
}

export interface ChainExecutionResult {
  totalDuration: number
  results: DispatchResult[]
  succeeded: number
  failed: number
  aborted: boolean
}

// ============================================================================
// Skill Dispatcher
// ============================================================================

export class SkillDispatcher {
  private skillsDir: string
  private registry: Map<string, SkillMeta>

  constructor(skillsDir: string = resolve(process.env.HOME || process.env.USERPROFILE || 'C:/Users/Administrator/.openclaw', '.openclaw/workspace/skills')) {
    this.skillsDir = skillsDir
    this.registry = new Map()
    this.loadRegistry()
  }

  /**
   * Build execution chain from routing result.
   * Returns skills in priority order (first = execute first).
   */
  buildChain(params: {
    expert: string
    taskType: string
    depth: 'fast' | 'normal' | 'deep'
    confidence: number
    skills: string[]
  }): SkillChainItem[] {
    const chain: SkillChainItem[] = []

    // 1. Router-provided skills (highest priority if confidence > 0.8)
    if (params.skills.length > 0) {
      const priorityOffset = params.confidence > 0.8 ? 0 : 10
      params.skills.forEach((slug, i) => {
        chain.push({
          slug,
          priority: priorityOffset + i,
          source: 'router',
          reason: `router[${params.taskType}] confidence=${params.confidence.toFixed(2)}`,
        })
      })
    }

    // 2. Expert-specific skill chains (OpenMythos MoE pattern)
    const expertSkills = this.getExpertSkills(params.expert)
    expertSkills.forEach((slug, i) => {
      if (!chain.find(c => c.slug === slug)) {
        chain.push({
          slug,
          priority: 20 + i,
          source: 'expert',
          reason: `expert=${params.expert}`,
        })
      }
    })

    // 3. Depth-mode defaults (fallback)
    const depthDefaults = this.getDepthDefaults(params.depth)
    depthDefaults.forEach((slug, i) => {
      if (!chain.find(c => c.slug === slug)) {
        chain.push({
          slug,
          priority: 30 + i,
          source: 'default',
          reason: `depth=${params.depth}`,
        })
      }
    })

    // Sort by priority
    return chain.sort((a, b) => a.priority - b.priority)
  }

  /**
   * Execute a skill by slug.
   * Passes skillContext so handlers can adapt behavior (depth-aware timeouts, etc.)
   */
  async dispatchSkill(
    slug: string,
    context: Record<string, unknown>,
    skillContext?: { chain: SkillChainItem[]; expert: string; depth: string; confidence: number; iteration: number }
  ): Promise<DispatchResult> {
    const start = Date.now()
    const skillPath = resolve(this.skillsDir, slug, 'SKILL.md')
    const handlerPath = resolve(this.skillsDir, slug, 'handler.js')

    // Check skill exists
    if (!fs.existsSync(skillPath)) {
      return { skill: slug, success: false, error: 'Skill not found', duration: Date.now() - start }
    }

    // Try handler.js if exists
    if (fs.existsSync(handlerPath)) {
      try {
        // Dynamic import of ESM handler
        const handler = await import(handlerPath)
        const fn = handler.handle || handler.execute || handler.run
        if (typeof fn === 'function') {
          // Inject skillContext into event so handlers can read depth/expert/chain
          const event = { ...context, skillContext }
          const output = await fn(event)
          return { skill: slug, success: true, output, duration: Date.now() - start }
        }
      } catch (err: any) {
        return { skill: slug, success: false, error: err.message, duration: Date.now() - start }
      }
    }

    // Fallback: return skill metadata (no custom handler)
    try {
      const content = fs.readFileSync(skillPath, 'utf-8')
      return {
        skill: slug,
        success: true,
        output: { description: 'No handler; skill loaded as context', slug, skillContext },
        duration: Date.now() - start,
      }
    } catch (err: any) {
      return { skill: slug, success: false, error: err.message, duration: Date.now() - start }
    }
  }

  /**
   * Execute full chain until first success or all complete.
   * Stops early if a skill succeeds (fail-fast for most cases).
   */
  async executeChain(
    chain: SkillChainItem[],
    context: Record<string, unknown>,
    skillContext?: { chain: SkillChainItem[]; expert: string; depth: string; confidence: number; iteration: number }
  ): Promise<ChainExecutionResult> {
    const results: DispatchResult[] = []
    const start = Date.now()

    for (const item of chain) {
      const result = await this.dispatchSkill(item.slug, context, skillContext)
      results.push(result)

      // Fail-fast: stop on first success for fast/normal depth
      // For deep mode, try all (OpenMythos-style exploration)
      if (result.success && item.source !== 'default') {
        // Skill succeeded — stop early unless in deep mode with low confidence
        const depth = item.reason.includes('deep') ? 'deep' : 'normal'
        if (depth !== 'deep') {
          break
        }
      }
    }

    const succeeded = results.filter(r => r.success).length
    const failed = results.filter(r => !r.success).length

    return {
      totalDuration: Date.now() - start,
      results,
      succeeded,
      failed,
      aborted: false,
    }
  }

  /**
   * Load skill metadata from disk into registry map.
   */
  private loadRegistry(): void {
    if (!fs.existsSync(this.skillsDir)) return

    const entries = fs.readdirSync(this.skillsDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const skillPath = resolve(this.skillsDir, entry.name, 'SKILL.md')
      if (!fs.existsSync(skillPath)) continue

      try {
        const content = fs.readFileSync(skillPath, 'utf-8')
        const fm = this.parseFrontmatter(content)
        this.registry.set(entry.name, {
          slug: entry.name,
          name: fm.name || entry.name,
          description: fm.description || '',
          triggers: fm.triggers || [],
        })
      } catch {
        // Skip malformed skills
      }
    }
  }

  private parseFrontmatter(content: string): Record<string, any> {
    if (!content.startsWith('---')) return {}
    const end = content.indexOf('---', 3)
    if (end === -1) return {}
    const fmText = content.slice(3, end)
    const fm: Record<string, any> = {}
    for (const line of fmText.split('\n')) {
      const idx = line.indexOf(':')
      if (idx === -1) continue
      const k = line.slice(0, idx).trim()
      const v = line.slice(idx + 1).trim().replace(/^["']|["']$/g, '')
      fm[k] = v
    }
    return fm
  }

  private getExpertSkills(expert: string): string[] {
    const map: Record<string, string[]> = {
      code_expert: ['exec-inline', 'tdd', 'debugging'],
      analysis_expert: ['session-replay', 'session-search'],
      memory_expert: ['memory-assistant', 'fluid-memory'],
      web_expert: ['web-scraping', 'agent-browser'],
      system_expert: ['studio', 'healthcheck'],
      general: ['session-manager'],
    }
    return map[expert] ?? []
  }

  private getDepthDefaults(depth: string): string[] {
    if (depth === 'deep') {
      return ['session-replay', 'session-search', 'memory-assistant', 'session-manager']
    }
    if (depth === 'fast') {
      return ['exec-inline', 'windows-gui']
    }
    return ['session-manager', 'session-replay']
  }
}

interface SkillMeta {
  slug: string
  name: string
  description: string
  triggers: string[]
}

// ============================================================================
// Singleton
// ============================================================================

export const skillDispatcher = new SkillDispatcher()
