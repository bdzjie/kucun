/**
 * RoutingService - TypeScript wrapper for Python Expert Router
 * ===========================================================
 *
 * Bridges AIAgent with the Python expert_router.py module.
 * Spawns Python subprocess for classification, parses result.
 */

import { spawn } from 'child_process'
import { resolve } from 'path'
import * as fs from 'fs'

// ============================================================================
// Types (mirror of Python RouteResult)
// ============================================================================

export type ReasoningDepth = 'fast' | 'normal' | 'deep'

export interface RouteResult {
  task_type: string
  expert: string
  skills: string[]
  depth: ReasoningDepth
  confidence: number
  matched_keywords: string[]
}

export interface RoutingStats {
  total: number
  expert_distribution: Record<string, number>
  depth_distribution: Record<string, number>
  top_expert: string | null
}

// ============================================================================
// Routing Service
// ============================================================================

export class RoutingService {
  private pythonPath: string
  private routerScript: string
  private stateDir: string
  private feedbackPath: string
  private weightsPath: string
  private cache: RouteResult | null = null
  private cacheMessage: string = ''

  constructor(
    stateDir: string = resolve(process.env.HOME || process.env.USERPROFILE || 'C:/Users/Administrator/.openclaw')
  ) {
    this.pythonPath = 'python'
    this.routerScript = resolve(stateDir, '.openclaw/workspace/modules/expert_router.py')
    this.stateDir = resolve(stateDir, '.openclaw')
    this.feedbackPath = resolve(stateDir, '.openclaw/memory/routing_feedback.jsonl')
    this.weightsPath = resolve(stateDir, '.openclaw/memory/routing_weights.json')

    // Ensure feedback file exists
    if (!fs.existsSync(this.feedbackPath)) {
      fs.mkdirSync(resolve(stateDir, '.openclaw/memory'), { recursive: true })
      fs.writeFileSync(this.feedbackPath, '')
    }
  }

  /**
   * Classify a user message and return routing decision
   * Uses cache if same message is classified twice
   */
  async classify(message: string): Promise<RouteResult> {
    // Check cache (short-term, same message)
    if (this.cache && this.cacheMessage === message) {
      return this.cache
    }

    try {
      const result = await this.runPythonRouter(message)
      this.cache = result
      this.cacheMessage = message
      return result
    } catch (err) {
      console.error('[RoutingService] Python router failed:', err)
      // Fallback: return default routing
      return {
        task_type: 'general',
        expert: 'general',
        skills: [],
        depth: 'normal',
        confidence: 0,
        matched_keywords: [],
      }
    }
  }

  /**
   * Run Python Expert Router as subprocess
   */
  private runPythonRouter(message: string): Promise<RouteResult> {
    return new Promise((resolve, reject) => {
      const proc = spawn(this.pythonPath, [this.routerScript, message], {
        cwd: resolve(this.pythonPath === 'python' ? process.cwd() : this.stateDir),
        shell: true,
        timeout: 10000,
      })

      let stdout = ''
      let stderr = ''

      proc.stdout?.on('data', (data) => {
        stdout += data.toString()
      })

      proc.stderr?.on('data', (data) => {
        stderr += data.toString()
      })

      proc.on('close', (code) => {
        if (code !== 0 && stderr) {
          console.warn('[RoutingService] Router stderr:', stderr)
        }

        try {
          // Parse JSON output from Python router
          // Router outputs RouteResult dict
          const parsed = JSON.parse(stdout.trim())
          resolve({
            task_type: parsed.task_type,
            expert: parsed.expert,
            skills: parsed.skills || [],
            depth: parsed.depth || 'normal',
            confidence: parsed.confidence || 0,
            matched_keywords: parsed.matched_keywords || [],
          })
        } catch {
          // Fallback if JSON parse fails
          reject(new Error(`Failed to parse router output: ${stdout.slice(0, 100)}`))
        }
      })

      proc.on('error', (err) => {
        reject(err)
      })
    })
  }

  /**
   * Record feedback after task completion
   * Used for adaptive weight adjustment
   */
  recordFeedback(
    routeResult: RouteResult,
    taskSuccess: boolean,
    quality: 'good' | 'partial' | 'poor',
    toolCallCount: number
  ): void {
    const entry = {
      timestamp: Date.now(),
      expert: routeResult.expert,
      depth: routeResult.depth,
      confidence: routeResult.confidence,
      taskSuccess,
      quality,
      toolCallCount,
      expectedToolCalls: this.getMaxToolCalls(routeResult.depth),
    }

    const line = JSON.stringify(entry) + '\n'
    fs.appendFileSync(this.feedbackPath, line)
  }

  /**
   * Get routing statistics from history
   */
  getStats(): RoutingStats {
    try {
      if (!fs.existsSync(this.feedbackPath)) {
        return { total: 0, expert_distribution: {}, depth_distribution: {}, top_expert: null }
      }

      const content = fs.readFileSync(this.feedbackPath, 'utf-8')
      const lines = content.trim().split('\n').filter(Boolean)

      if (lines.length === 0) {
        return { total: 0, expert_distribution: {}, depth_distribution: {}, top_expert: null }
      }

      const stats: RoutingStats = {
        total: lines.length,
        expert_distribution: {},
        depth_distribution: {},
        top_expert: null,
      }

      for (const line of lines) {
        try {
          const entry = JSON.parse(line)
          stats.expert_distribution[entry.expert] =
            (stats.expert_distribution[entry.expert] || 0) + 1
          stats.depth_distribution[entry.depth] =
            (stats.depth_distribution[entry.depth] || 0) + 1
        } catch {
          // Skip malformed lines
        }
      }

      // Find top expert
      const entries = Object.entries(stats.expert_distribution)
      if (entries.length > 0) {
        stats.top_expert = entries.sort((a, b) => b[1] - a[1])[0][0]
      }

      return stats
    } catch {
      return { total: 0, expert_distribution: {}, depth_distribution: {}, top_expert: null }
    }
  }

  /**
   * Analyze feedback and suggest weight adjustments
   * Called by nightly Cron job
   */
  async analyzeAndAdjustWeights(): Promise<{
    adjustedExperts: string[]
    recommendations: string[]
  }> {
    const stats = this.getStats()
    const recommendations: string[] = []
    const adjustedExperts: string[] = []

    if (stats.total < 10) {
      return { adjustedExperts, recommendations }
    }

    // Analyze expert performance
    const expertQuality: Record<string, { good: number; poor: number; total: number }> = {}

    try {
      const content = fs.readFileSync(this.feedbackPath, 'utf-8')
      const lines = content.trim().split('\n').filter(Boolean)

      for (const line of lines) {
        try {
          const entry = JSON.parse(line)
          if (!expertQuality[entry.expert]) {
            expertQuality[entry.expert] = { good: 0, poor: 0, total: 0 }
          }
          expertQuality[entry.expert].total++
          if (entry.quality === 'good' || entry.taskSuccess) {
            expertQuality[entry.expert].good++
          } else if (entry.quality === 'poor') {
            expertQuality[entry.expert].poor++
          }
        } catch {
          // Skip
        }
      }

      // Find underperforming experts
      for (const [expert, data] of Object.entries(expertQuality)) {
        const successRate = data.good / Math.max(data.total, 1)
        if (data.total >= 3 && successRate < 0.5) {
          adjustedExperts.push(expert)
          recommendations.push(
            `${expert}: success rate ${(successRate * 100).toFixed(0)}% is low (${data.total} samples). Consider reviewing routing criteria.`
          )
        }
      }

      // Check for depth mismatch (tasks consistently need more/fewer tool calls)
      const depthAnalysis: Record<string, { over: number; under: number }> = {}
      for (const line of lines) {
        try {
          const entry = JSON.parse(line)
          const maxCalls = this.getMaxToolCalls(entry.depth)
          if (!depthAnalysis[entry.depth]) {
            depthAnalysis[entry.depth] = { over: 0, under: 0 }
          }
          if (entry.toolCallCount > maxCalls) {
            depthAnalysis[entry.depth].over++
          } else if (entry.toolCallCount < maxCalls && entry.taskSuccess) {
            depthAnalysis[entry.depth].under++
          }
        } catch {
          // Skip
        }
      }

      for (const [depth, data] of Object.entries(depthAnalysis)) {
        if (data.over > 3) {
          recommendations.push(
            `${depth} mode: ${data.over} tasks hit max tool calls. Consider upgrading to deeper mode.`
          )
        }
      }

      // Save updated weights (incremental adjustment)
      await this.saveWeights(expertQuality)

    } catch (err) {
      console.error('[RoutingService] Failed to analyze feedback:', err)
    }

    return { adjustedExperts, recommendations }
  }

  private getMaxToolCalls(depth: ReasoningDepth): number {
    const map: Record<ReasoningDepth, number> = {
      fast: 1,
      normal: 3,
      deep: 8,
    }
    return map[depth] ?? 3
  }

  private async saveWeights(
    expertQuality: Record<string, { good: number; poor: number; total: number }>
  ): Promise<void> {
    const weights = {
      updatedAt: Date.now(),
      expertQuality,
    }
    fs.writeFileSync(this.weightsPath, JSON.stringify(weights, null, 2))
  }
}

// ============================================================================
// Singleton export
// ============================================================================

export const routingService = new RoutingService()
