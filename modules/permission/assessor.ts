/**
 * Permission Module - Risk Assessor
 * 风险评估器
 */

import type {
  RiskLevel,
  ToolCategory,
  ToolRiskAssessment,
  RiskRule,
  PermissionContext,
} from './types'

// ============================================================================
// Default Risk Rules
// ============================================================================

/** 默认低风险工具 */
const LOW_RISK_TOOLS: Set<string> = new Set([
  'Read', 'Glob', 'Grep', 'WebFetch', 'Fetch',
  'View', 'LS', 'Search', 'LookUp', 'Find',
  'Weather', 'Time', 'Date', 'Calc',
])

/** 默认中风险工具 */
const MEDIUM_RISK_TOOLS: Set<string> = new Set([
  'Bash', 'Shell', 'Exec', 'Run',
  'Edit', 'EditBlock', 'MultiEdit',
  'Write', 'Create', 'Mkdir',
  'TodoWrite', 'TaskCreate',
  'Agent', 'Ask',
])

/** 默认高风险工具 */
const HIGH_RISK_TOOLS: Set<string> = new Set([
  'WriteFile', 'Delete', 'Remove', 'Rm',
  'BashTool', 'Bash',
  'AgentTool', 'ForkAgent',
  'MCP', 'MCPTool',
])

/** 默认危险命令模式 */
const DANGEROUS_COMMAND_PATTERNS: RegExp[] = [
  /^rm\s+-rf\s+/i,
  /^dd\s+/i,
  /^mkfs/i,
  /^dd if=/i,
  /^>:?\s*\//i,
  /\|.*sudo/i,
  /^chmod\s+-R\s+777/i,
  /^chown\s+/i,
  /^kill\s+-9/i,
  /^curl.*\|.*sh/i,
  /wget.*\|.*sh/i,
  /^mv.*\/\.$/i,
  /^cat.*\/>.*\/dev\//i,
]

// ============================================================================
// Risk Assessor
// ============================================================================

/**
 * 风险评估器
 */
export class RiskAssessor {
  private rules: RiskRule[] = []
  private customToolLevels: Map<string, RiskLevel> = new Map()
  private customCategoryLevels: Map<ToolCategory, RiskLevel> = new Map()

  constructor() {
    this.initDefaultRules()
  }

  /**
   * 初始化默认规则
   */
  private initDefaultRules(): void {
    // 默认命令模式规则
    this.addRule({
      pattern: /^rm\s+-rf\s+\//,
      level: 'critical',
      reason: 'Recursively delete from root',
    })
    
    this.addRule({
      pattern: /^sudo\s+/,
      level: 'high',
      reason: 'Elevated privileges',
    })
    
    this.addRule({
      pattern: /curl.*\|.*sh/,
      level: 'critical',
      reason: 'Remote code execution via pipe to shell',
    })
    
    this.addRule({
      pattern: /wget.*\|.*sh/,
      level: 'critical',
      reason: 'Remote code execution via pipe to shell',
    })
    
    this.addRule({
      pattern: /^dd\s+/,
      level: 'critical',
      reason: 'Direct disk write',
    })
  }

  /**
   * 添加风险规则
   */
  addRule(rule: RiskRule): void {
    this.rules.push(rule)
  }

  /**
   * 设置工具风险等级
   */
  setToolLevel(tool: string, level: RiskLevel): void {
    this.customToolLevels.set(tool, level)
  }

  /**
   * 设置类别风险等级
   */
  setCategoryLevel(category: ToolCategory, level: RiskLevel): void {
    this.customCategoryLevels.set(category, level)
  }

  /**
   * 评估风险等级
   */
  assess(context: PermissionContext): ToolRiskAssessment {
    const factors: string[] = []
    let level = this.getBaseLevel(context.tool, context.category)
    let autoApprove = level === 'low'

    // 1. 检查自定义工具等级
    const customToolLevel = this.customToolLevels.get(context.tool)
    if (customToolLevel) {
      level = customToolLevel
      factors.push(`Custom tool level: ${customToolLevel}`)
      autoApprove = level === 'low'
    }

    // 2. 检查自定义类别等级
    const customCategoryLevel = this.customCategoryLevels.get(context.category)
    if (customCategoryLevel) {
      if (this.levelToNumber(customCategoryLevel) > this.levelToNumber(level)) {
        level = customCategoryLevel
        factors.push(`Custom category level: ${customCategoryLevel}`)
      }
    }

    // 3. 检查危险命令模式
    if (context.input.command && typeof context.input.command === 'string') {
      const command = context.input.command
      for (const rule of this.rules) {
        if (this.matchPattern(rule.pattern, command)) {
          level = rule.level
          factors.push(rule.reason)
          autoApprove = false
          break
        }
      }
    }

    // 4. 检查破坏性标志
    if (context.destructive) {
      if (this.levelToNumber(level) < this.levelToNumber('high')) {
        level = 'high'
        factors.push('Destructive operation')
        autoApprove = false
      }
    }

    // 5. 检查路径
    if (context.paths && context.paths.length > 0) {
      for (const path of context.paths) {
        if (this.isSystemPath(path)) {
          level = this.elevateLevel(level)
          factors.push(`System path: ${path}`)
          autoApprove = false
          break
        }
        if (this.isHomePath(path)) {
          const homePath = process.env.HOME || process.env.USERPROFILE
          if (path === homePath || path.startsWith(homePath + '/.ssh')) {
            level = this.elevateLevel(level)
            factors.push(`Sensitive path: ${path}`)
          }
        }
      }
    }

    return {
      level,
      factors,
      autoApprove,
      suggestions: this.getSuggestions(level, factors),
    }
  }

  /**
   * 获取基础风险等级
   */
  private getBaseLevel(tool: string, category: ToolCategory): RiskLevel {
    // 检查内置低风险工具
    if (LOW_RISK_TOOLS.has(tool)) {
      return 'low'
    }
    
    // 检查内置中风险工具
    if (MEDIUM_RISK_TOOLS.has(tool)) {
      return 'medium'
    }
    
    // 检查内置高风险工具
    if (HIGH_RISK_TOOLS.has(tool)) {
      return 'high'
    }
    
    // 基于类别判断
    switch (category) {
      case 'filesystem':
        return 'medium'
      case 'network':
        return 'medium'
      case 'process':
        return 'high'
      case 'system':
        return 'critical'
      case 'agent':
        return 'high'
      case 'mcp':
        return 'high'
      default:
        return 'medium'
    }
  }

  /**
   * 匹配模式
   */
  private matchPattern(pattern: RegExp | string, text: string): boolean {
    if (typeof pattern === 'string') {
      return text.includes(pattern)
    }
    return pattern.test(text)
  }

  /**
   * 检查是否为系统路径
   */
  private isSystemPath(path: string): boolean {
    const systemPaths = [
      '/bin', '/sbin', '/usr/bin', '/usr/sbin', '/usr/local/bin',
      '/System', '/Windows', '/Program Files',
      '/etc', '/var', '/sys', '/proc',
    ]
    return systemPaths.some(sp => path.startsWith(sp))
  }

  /**
   * 检查是否为用户目录
   */
  private isHomePath(path: string): boolean {
    return path.startsWith('~') || path.includes('/home/') || path.includes('\\Users\\')
  }

  /**
   * 提升风险等级
   */
  private elevateLevel(level: RiskLevel): RiskLevel {
    const levels: RiskLevel[] = ['low', 'medium', 'high', 'critical']
    const index = levels.indexOf(level)
    if (index < levels.length - 1) {
      return levels[index + 1]
    }
    return level
  }

  /**
   * 风险等级转数字
   */
  private levelToNumber(level: RiskLevel): number {
    const map: Record<RiskLevel, number> = {
      low: 0,
      medium: 1,
      high: 2,
      critical: 3,
    }
    return map[level]
  }

  /**
   * 获取建议
   */
  private getSuggestions(level: RiskLevel, factors: string[]): string[] {
    const suggestions: string[] = []
    
    if (level === 'critical') {
      suggestions.push('强烈建议拒绝此操作')
      suggestions.push('考虑使用更安全的替代方案')
    } else if (level === 'high') {
      suggestions.push('建议仔细审查操作内容')
      suggestions.push('确认命令来源和目标')
    } else if (level === 'medium') {
      suggestions.push('建议了解具体操作内容')
    }
    
    if (factors.some(f => f.includes('sudo'))) {
      suggestions.push('考虑使用最小权限原则')
    }
    
    if (factors.some(f => f.includes('pipe to shell'))) {
      suggestions.push('避免通过管道执行未知脚本')
    }
    
    return suggestions
  }
}

// ============================================================================
// Default Export
// ============================================================================

export const defaultRiskAssessor = new RiskAssessor()

/**
 * 快速评估
 */
export function assessRisk(context: PermissionContext): ToolRiskAssessment {
  return defaultRiskAssessor.assess(context)
}
