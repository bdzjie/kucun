/**
 * Registry Module - Tool Registry
 * 工具注册表 - 统一工具管理
 */

import type {
  Tool,
  ToolCategory,
  RiskLevel,
  ToolContext,
  ToolResult,
  RegistryConfig,
  RegistryStats,
} from './types'

// ============================================================================
// Default Config
// ============================================================================

const DEFAULT_CONFIG: RegistryConfig = {
  autoRegisterBuiltin: true,
  allowDuplicate: false,
  caseSensitive: true,
}

// ============================================================================
// Default Tools (Built-in)
// ============================================================================

/**
 * 创建默认工具
 */
function createDefaultTools(): Tool[] {
  return [
    // Read Tool
    {
      name: 'Read',
      description: 'Read file contents',
      category: 'filesystem',
      riskLevel: 'low',
      enabled: true,
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path to read' },
        },
        required: ['path'],
      },
      async execute(input, _ctx) {
        try {
          const { readFileSync } = await import('fs')
          const content = readFileSync(input.path as string, 'utf-8')
          return { success: true, output: content }
        } catch (error) {
          return { success: false, error: String(error) }
        }
      },
    },

    // Write Tool
    {
      name: 'Write',
      description: 'Write content to a file',
      category: 'filesystem',
      riskLevel: 'high',
      enabled: true,
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path to write' },
          content: { type: 'string', description: 'Content to write' },
        },
        required: ['path', 'content'],
      },
      async execute(input, _ctx) {
        try {
          const { writeFileSync } = await import('fs')
          writeFileSync(input.path as string, input.content as string, 'utf-8')
          return { success: true, output: `Written to ${input.path}` }
        } catch (error) {
          return { success: false, error: String(error) }
        }
      },
    },

    // Edit Tool
    {
      name: 'Edit',
      description: 'Edit file content',
      category: 'filesystem',
      riskLevel: 'medium',
      enabled: true,
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path to edit' },
          find: { type: 'string', description: 'Text to find' },
          replace: { type: 'string', description: 'Replacement text' },
        },
        required: ['path', 'find', 'replace'],
      },
      async execute(input, _ctx) {
        try {
          const { readFileSync, writeFileSync } = await import('fs')
          let content = readFileSync(input.path as string, 'utf-8')
          content = content.replace(input.find as string, input.replace as string)
          writeFileSync(input.path as string, content, 'utf-8')
          return { success: true, output: `Edited ${input.path}` }
        } catch (error) {
          return { success: false, error: String(error) }
        }
      },
    },

    // Glob Tool
    {
      name: 'Glob',
      description: 'Find files matching a pattern',
      category: 'filesystem',
      riskLevel: 'low',
      enabled: true,
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Glob pattern' },
        },
        required: ['pattern'],
      },
      async execute(input, _ctx) {
        try {
          const { globSync } = await import('glob')
          const files = globSync(input.pattern as string)
          return { success: true, output: files }
        } catch (error) {
          return { success: false, error: String(error) }
        }
      },
    },

    // Grep Tool
    {
      name: 'Grep',
      description: 'Search for text in files',
      category: 'filesystem',
      riskLevel: 'low',
      enabled: true,
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Pattern to search' },
          path: { type: 'string', description: 'Path to search in' },
        },
        required: ['pattern'],
      },
      async execute(input, _ctx) {
        try {
          const { readFileSync } = await import('fs')
          const { readFileSync: fsRead } = await import('fs')
          const content = fsRead(input.path as string || '.', 'utf-8')
          const lines = content.split('\n')
          const matches = lines.filter(l => l.includes(input.pattern as string))
          return { success: true, output: matches }
        } catch (error) {
          return { success: false, error: String(error) }
        }
      },
    },

    // Bash Tool
    {
      name: 'Bash',
      description: 'Execute shell commands',
      category: 'process',
      riskLevel: 'medium',
      enabled: true,
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Shell command to execute' },
          cwd: { type: 'string', description: 'Working directory' },
        },
        required: ['command'],
      },
      async execute(input, ctx) {
        try {
          const { execSync } = await import('child_process')
          const result = execSync(input.command as string, {
            cwd: (input.cwd || ctx.cwd) as string,
            encoding: 'utf-8',
            stdio: 'pipe',
          })
          return { success: true, output: result }
        } catch (error: any) {
          return { success: false, error: error.message }
        }
      },
    },

    // WebFetch Tool
    {
      name: 'WebFetch',
      description: 'Fetch content from a URL',
      category: 'network',
      riskLevel: 'low',
      enabled: true,
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL to fetch' },
        },
        required: ['url'],
      },
      async execute(input, _ctx) {
        try {
          const response = await fetch(input.url as string)
          const text = await response.text()
          return { success: true, output: text }
        } catch (error) {
          return { success: false, error: String(error) }
        }
      },
    },
  ]
}

// ============================================================================
// Tool Registry
// ============================================================================

/**
 * 工具注册表
 */
export class ToolRegistry {
  private tools: Map<string, Tool> = new Map()
  private categories: Map<ToolCategory, Set<string>> = new Map()
  private config: RegistryConfig

  constructor(config: Partial<RegistryConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    
    if (this.config.autoRegisterBuiltin) {
      this.registerDefaultTools()
    }
  }

  // ============================================================================
  // Registration
  // ============================================================================

  /**
   * 注册工具
   */
  register(tool: Tool): void {
    const key = this.getKey(tool.name)
    
    if (this.tools.has(key) && !this.config.allowDuplicate) {
      throw new Error(`Tool already registered: ${tool.name}`)
    }
    
    this.tools.set(key, tool)
    
    // 按类别索引
    if (!this.categories.has(tool.category)) {
      this.categories.set(tool.category, new Set())
    }
    this.categories.get(tool.category)!.add(key)
  }

  /**
   * 批量注册
   */
  registerMany(tools: Tool[]): void {
    for (const tool of tools) {
      this.register(tool)
    }
  }

  /**
   * 注册默认工具
   */
  private registerDefaultTools(): void {
    const defaults = createDefaultTools()
    for (const tool of defaults) {
      this.register(tool)
    }
  }

  // ============================================================================
  // Retrieval
  // ============================================================================

  /**
   * 获取工具
   */
  get(name: string): Tool | undefined {
    return this.tools.get(this.getKey(name))
  }

  /**
   * 获取所有工具
   */
  list(): Tool[] {
    return Array.from(this.tools.values())
  }

  /**
   * 按类别获取
   */
  listByCategory(category: ToolCategory): Tool[] {
    const keys = this.categories.get(category)
    if (!keys) return []
    return Array.from(keys).map(k => this.tools.get(k)!).filter(Boolean)
  }

  /**
   * 按风险等级获取
   */
  listByRiskLevel(riskLevel: RiskLevel): Tool[] {
    return this.list().filter(t => t.riskLevel === riskLevel)
  }

  /**
   * 获取启用的工具
   */
  listEnabled(): Tool[] {
    return this.list().filter(t => t.enabled)
  }

  // ============================================================================
  // Modification
  // ============================================================================

  /**
   * 启用工具
   */
  enable(name: string): boolean {
    const tool = this.get(name)
    if (tool) {
      tool.enabled = true
      return true
    }
    return false
  }

  /**
   * 禁用工具
   */
  disable(name: string): boolean {
    const tool = this.get(name)
    if (tool) {
      tool.enabled = false
      return true
    }
    return false
  }

  /**
   * 移除工具
   */
  unregister(name: string): boolean {
    const key = this.getKey(name)
    const tool = this.tools.get(key)
    if (tool) {
      this.tools.delete(key)
      this.categories.get(tool.category)?.delete(key)
      return true
    }
    return false
  }

  // ============================================================================
  // Execution
  // ============================================================================

  /**
   * 执行工具
   */
  async execute(
    name: string,
    input: unknown,
    context?: ToolContext
  ): Promise<ToolResult> {
    const tool = this.get(name)
    
    if (!tool) {
      return { success: false, error: `Tool not found: ${name}` }
    }
    
    if (!tool.enabled) {
      return { success: false, error: `Tool disabled: ${name}` }
    }
    
    const startTime = Date.now()
    
    try {
      const result = await tool.execute(input, context || {})
      return {
        ...result,
        duration: Date.now() - startTime,
      }
    } catch (error) {
      return {
        success: false,
        error: String(error),
        duration: Date.now() - startTime,
      }
    }
  }

  /**
   * 批量执行
   */
  async executeMany(
    requests: Array<{ name: string; input: unknown }>,
    context?: ToolContext
  ): Promise<Map<string, ToolResult>> {
    const results = new Map<string, ToolResult>()
    
    for (const { name, input } of requests) {
      results.set(name, await this.execute(name, input, context))
    }
    
    return results
  }

  // ============================================================================
  // Statistics
  // ============================================================================

  /**
   * 获取统计
   */
  stats(): RegistryStats {
    const stats: RegistryStats = {
      totalTools: this.tools.size,
      byCategory: {
        filesystem: 0,
        network: 0,
        process: 0,
        system: 0,
        agent: 0,
        mcp: 0,
        skill: 0,
        other: 0,
      },
      byRiskLevel: {
        low: 0,
        medium: 0,
        high: 0,
        critical: 0,
      },
      enabledTools: 0,
      disabledTools: 0,
    }
    
    for (const tool of this.tools.values()) {
      stats.byCategory[tool.category]++
      stats.byRiskLevel[tool.riskLevel]++
      if (tool.enabled) {
        stats.enabledTools++
      } else {
        stats.disabledTools++
      }
    }
    
    return stats
  }

  // ============================================================================
  // Utilities
  // ============================================================================

  /**
   * 检查工具是否存在
   */
  has(name: string): boolean {
    return this.tools.has(this.getKey(name))
  }

  /**
   * 获取工具数量
   */
  size(): number {
    return this.tools.size
  }

  /**
   * 清空注册表
   */
  clear(): void {
    this.tools.clear()
    this.categories.clear()
  }

  /**
   * 获取键
   */
  private getKey(name: string): string {
    return this.config.caseSensitive ? name : name.toLowerCase()
  }

  /**
   * 搜索工具
   */
  search(query: string): Tool[] {
    const q = query.toLowerCase()
    return this.list().filter(t =>
      t.name.toLowerCase().includes(q) ||
      t.description.toLowerCase().includes(q)
    )
  }
}

// ============================================================================
// Global Registry
// ============================================================================

export const globalToolRegistry = new ToolRegistry()

/**
 * 快捷注册
 */
export function registerTool(tool: Tool): void {
  globalToolRegistry.register(tool)
}

/**
 * 快捷获取
 */
export function getTool(name: string): Tool | undefined {
  return globalToolRegistry.get(name)
}

/**
 * 快捷执行
 */
export async function executeTool(
  name: string,
  input: unknown,
  context?: ToolContext
): Promise<ToolResult> {
  return globalToolRegistry.execute(name, input, context)
}

/**
 * 快捷列表
 */
export function listTools(): Tool[] {
  return globalToolRegistry.list()
}
