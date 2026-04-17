/**
 * Registry Module - Enhanced Tool Registry
 * 增强版工具注册表 - Hermes 风格自注册 + AST 发现
 */

import type {
  Tool,
  ToolCategory,
  RiskLevel,
  ToolContext,
  ToolResult,
  RegistryConfig,
  RegistryStats,
  ToolEntry,
  Toolset,
  DiscoveredTool,
  DiscoveryResult,
  ToolDefinition,
  ToolCall,
} from './types'

// ============================================================================
// Default Config
// ============================================================================

const DEFAULT_CONFIG: RegistryConfig = {
  autoRegisterBuiltin: true,
  allowDuplicate: false,
  caseSensitive: true,
  autoDiscover: false,
  enableToolsets: true,
}

// ============================================================================
// Default Tools (Built-in)
// ============================================================================

/**
 * Default tool executor - wraps fs/network/process operations
 */
function createDefaultTools(): Tool[] {
  return [
    // Read Tool
    {
      name: 'Read',
      description: 'Read file contents from the filesystem',
      category: 'filesystem',
      riskLevel: 'low',
      enabled: true,
      emoji: '📄',
      toolset: 'filesystem',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path to read' },
          offset: { type: 'number', description: 'Line offset to start reading' },
          limit: { type: 'number', description: 'Maximum lines to read' },
        },
        required: ['path'],
      },
      async execute(input, _ctx) {
        try {
          const fs = await import('fs')
          const content = fs.readFileSync((input as any).path as string, 'utf-8')
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
      emoji: '✍️',
      toolset: 'filesystem',
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
          const fs = await import('fs')
          fs.writeFileSync((input as any).path as string, (input as any).content as string, 'utf-8')
          return { success: true, output: `Written to ${(input as any).path}` }
        } catch (error) {
          return { success: false, error: String(error) }
        }
      },
    },

    // Edit Tool (patch)
    {
      name: 'Edit',
      description: 'Edit file content with precise text replacement',
      category: 'filesystem',
      riskLevel: 'medium',
      enabled: true,
      emoji: '✏️',
      toolset: 'filesystem',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path to edit' },
          find: { type: 'string', description: 'Exact text to find' },
          replace: { type: 'string', description: 'Replacement text' },
        },
        required: ['path', 'find', 'replace'],
      },
      async execute(input, _ctx) {
        try {
          const fs = await import('fs')
          let content = fs.readFileSync((input as any).path as string, 'utf-8')
          content = content.replace((input as any).find as string, (input as any).replace as string)
          fs.writeFileSync((input as any).path as string, content, 'utf-8')
          return { success: true, output: `Edited ${(input as any).path}` }
        } catch (error) {
          return { success: false, error: String(error) }
        }
      },
    },

    // Glob Tool
    {
      name: 'Glob',
      description: 'Find files matching a glob pattern',
      category: 'filesystem',
      riskLevel: 'low',
      enabled: true,
      emoji: '🔍',
      toolset: 'filesystem',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Glob pattern (e.g., **/*.ts)' },
          cwd: { type: 'string', description: 'Working directory' },
        },
        required: ['pattern'],
      },
      async execute(input, _ctx) {
        try {
          const { globSync } = await import('glob')
          const files = globSync((input as any).pattern as string, {
            cwd: (input as any).cwd as string | undefined,
          })
          return { success: true, output: files }
        } catch (error) {
          return { success: false, error: String(error) }
        }
      },
    },

    // Grep Tool
    {
      name: 'Grep',
      description: 'Search for text patterns in files',
      category: 'filesystem',
      riskLevel: 'low',
      enabled: true,
      emoji: '🔎',
      toolset: 'filesystem',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Pattern to search' },
          path: { type: 'string', description: 'Path to search in' },
          regex: { type: 'boolean', description: 'Treat pattern as regex' },
        },
        required: ['pattern'],
      },
      async execute(input, _ctx) {
        try {
          const fs = await import('fs')
          const content = fs.readFileSync(((input as any).path || '.') as string, 'utf-8')
          const lines = content.split('\n')
          const matches = lines
            .map((l, i) => ({ line: i + 1, content: l }))
            .filter(l => l.content.includes((input as any).pattern as string))
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
      emoji: '💻',
      toolset: 'terminal',
      check_fn: () => true,
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Shell command to execute' },
          cwd: { type: 'string', description: 'Working directory' },
          timeout: { type: 'number', description: 'Timeout in seconds' },
        },
        required: ['command'],
      },
      async execute(input, ctx) {
        try {
          const { execSync } = await import('child_process')
          const result = execSync((input as any).command as string, {
            cwd: (input as any).cwd || ctx.cwd || process.cwd(),
            encoding: 'utf-8',
            stdio: 'pipe',
            timeout: ((input as any).timeout || 30) * 1000,
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
      emoji: '🌐',
      toolset: 'web',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL to fetch' },
          method: { type: 'string', description: 'HTTP method', enum: ['GET', 'POST', 'PUT', 'DELETE'] },
          headers: { type: 'object', description: 'HTTP headers' },
          body: { type: 'string', description: 'Request body' },
        },
        required: ['url'],
      },
      async execute(input, _ctx) {
        try {
          const url = (input as any).url as string
          const method = ((input as any).method as string) || 'GET'
          const headers = (input as any).headers as Record<string, string> | undefined
          const body = (input as any).body as string | undefined
          
          const response = await fetch(url, { method, headers, body })
          const text = await response.text()
          return { success: true, output: text }
        } catch (error) {
          return { success: false, error: String(error) }
        }
      },
    },

    // Search Tool (Hermes FTS5-style)
    {
      name: 'Search',
      description: 'Full-text search across sessions and files',
      category: 'search',
      riskLevel: 'low',
      enabled: true,
      emoji: '🔎',
      toolset: 'search',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          type: { type: 'string', description: 'Search type', enum: ['session', 'file', 'all'] },
          limit: { type: 'number', description: 'Max results' },
        },
        required: ['query'],
      },
      async execute(input, _ctx) {
        // Placeholder - actual implementation would use FTS5
        return {
          success: true,
          output: `Search for: ${(input as any).query}`,
        }
      },
    },

    // Memory Tool (MemPalace-style)
    {
      name: 'Memory',
      description: 'Persistent memory management',
      category: 'memory',
      riskLevel: 'low',
      enabled: true,
      emoji: '🧠',
      toolset: 'memory',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', description: 'Action', enum: ['add', 'replace', 'remove', 'search'] },
          target: { type: 'string', description: 'Target memory store', enum: ['memory', 'user'] },
          content: { type: 'string', description: 'Memory content' },
          old_text: { type: 'string', description: 'Text to replace/remove' },
          query: { type: 'string', description: 'Search query' },
        },
        required: ['action', 'target'],
      },
      async execute(input, _ctx) {
        // Placeholder - actual implementation would use memory module
        return {
          success: true,
          output: `Memory ${(input as any).action} on ${(input as any).target}`,
        }
      },
    },

    // Delegate Tool (Hermes-style subagent)
    {
      name: 'Delegate',
      description: 'Delegate task to a subagent',
      category: 'agent',
      riskLevel: 'medium',
      enabled: true,
      emoji: '🎭',
      toolset: 'agent',
      parameters: {
        type: 'object',
        properties: {
          task: { type: 'string', description: 'Task description for subagent' },
          agent_type: { type: 'string', description: 'Agent type', enum: ['researcher', 'coder', 'reviewer', 'general'] },
          max_iterations: { type: 'number', description: 'Max iterations' },
        },
        required: ['task'],
      },
      async execute(input, _ctx) {
        // Placeholder - actual implementation would use coordinator module
        return {
          success: true,
          output: `Delegating: ${(input as any).task}`,
        }
      },
    },
  ]
}

// ============================================================================
// Default Toolsets (Hermes-style)
// ============================================================================

const DEFAULT_TOOLSETS: Toolset[] = [
  {
    name: 'filesystem',
    description: 'File system operations',
    tools: ['Read', 'Write', 'Edit', 'Glob', 'Grep'],
    enabled_by_default: true,
  },
  {
    name: 'terminal',
    description: 'Shell command execution',
    tools: ['Bash'],
    enabled_by_default: true,
  },
  {
    name: 'web',
    description: 'Web fetching and API calls',
    tools: ['WebFetch'],
    enabled_by_default: true,
  },
  {
    name: 'search',
    description: 'Full-text search',
    tools: ['Search'],
    enabled_by_default: true,
  },
  {
    name: 'memory',
    description: 'Persistent memory',
    tools: ['Memory'],
    enabled_by_default: true,
  },
  {
    name: 'agent',
    description: 'Agent delegation',
    tools: ['Delegate'],
    enabled_by_default: false,
  },
]

// ============================================================================
// Tool Registry (Hermes-style)
// ============================================================================

/**
 * Hermes-style Tool Registry with:
 * - Self-registration at import time
 * - Tool availability checking (check_fn)
 * - Toolset grouping
 * - OpenAI function calling schema generation
 * - Tool execution hooks (pre/post)
 */
export class ToolRegistry {
  private tools: Map<string, ToolEntry> = new Map()
  private categories: Map<ToolCategory, Set<string>> = new Map()
  private toolsets: Map<string, Toolset> = new Map()
  private config: RegistryConfig
  private stats: RegistryStats
  private hooks: ToolHooks = {}

  constructor(config: Partial<RegistryConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.stats = this.initStats()
    
    if (this.config.enableToolsets) {
      this.registerDefaultToolsets()
    }
    
    if (this.config.autoRegisterBuiltin) {
      this.registerDefaultTools()
    }
  }

  // ============================================================================
  // Hook System (Hermes-style)
  // ============================================================================

  /**
   * Register tool hooks
   */
  registerHooks(hooks: ToolHooks): void {
    if (hooks.pre_tool_call) {
      this.hooks.pre_tool_call = [
        ...(this.hooks.pre_tool_call || []),
        ...hooks.pre_tool_call,
      ]
    }
    if (hooks.post_tool_call) {
      this.hooks.post_tool_call = [
        ...(this.hooks.post_tool_call || []),
        ...hooks.post_tool_call,
      ]
    }
    if (hooks.tool_call_error) {
      this.hooks.tool_call_error = [
        ...(this.hooks.tool_call_error || []),
        ...hooks.tool_call_error,
      ]
    }
  }

  /**
   * Run pre-tool hooks
   */
  private async runPreHooks(ctx: ToolHookContext): Promise<{ allow: boolean; input: unknown }> {
    const preHooks = this.hooks.pre_tool_call || []
    let input = ctx.input

    for (const hook of preHooks) {
      try {
        const result = await Promise.resolve(hook(ctx))
        if (!result.allow) {
          return { allow: false, input }
        }
        if (result.modified?.input) {
          input = result.modified.input
        }
      } catch {
        // Hook error doesn't block execution
      }
    }

    return { allow: true, input }
  }

  /**
   * Run post-tool hooks
   */
  private async runPostHooks(
    ctx: ToolHookContext,
    result: ToolResult
  ): Promise<ToolResult> {
    const postHooks = this.hooks.post_tool_call || []
    let modifiedResult = result

    for (const hook of postHooks) {
      try {
        const hookResult = await Promise.resolve(hook({
          ...ctx,
          input: modifiedResult,
        }))
        if (!hookResult.allow) {
          return { success: false, error: hookResult.error || 'Hook denied' }
        }
        if (hookResult.modified?.output) {
          modifiedResult = { ...modifiedResult, output: hookResult.modified.output }
        }
      } catch {
        // Hook error doesn't modify result
      }
    }

    return modifiedResult
  }

  /**
   * Run error hooks
   */
  private async runErrorHooks(
    ctx: ToolHookContext,
    error: Error
  ): Promise<void> {
    const errorHooks = this.hooks.tool_call_error || []

    for (const hook of errorHooks) {
      try {
        await Promise.resolve(hook({
          ...ctx,
          input: error,
        }))
      } catch {
        // Hook error is ignored
      }
    }
  }

  private initStats(): RegistryStats {
    return {
      totalTools: 0,
      totalToolsets: 0,
      byCategory: {
        filesystem: 0, network: 0, process: 0, system: 0,
        agent: 0, mcp: 0, skill: 0, search: 0, memory: 0, other: 0,
      },
      byRiskLevel: { low: 0, medium: 0, high: 0, critical: 0 },
      byToolset: {},
      enabledTools: 0,
      disabledTools: 0,
      availableTools: 0,
      unavailableTools: 0,
      totalCalls: 0,
    }
  }

  // ============================================================================
  // Registration (Hermes-style self-registration)
  // ============================================================================

  /**
   * Register a tool (Hermes-style)
   * Called at module import time by tools themselves
   */
  register(tool: Tool): void {
    const key = this.getKey(tool.name)
    
    if (this.tools.has(key) && !this.config.allowDuplicate) {
      console.warn(`[Registry] Tool already registered: ${tool.name}, skipping duplicate`)
      return
    }
    
    const entry: ToolEntry = {
      tool,
      key,
      registeredAt: Date.now(),
      callCount: 0,
    }
    
    this.tools.set(key, entry)
    
    // Index by category
    if (!this.categories.has(tool.category)) {
      this.categories.set(tool.category, new Set())
    }
    this.categories.get(tool.category)!.add(key)
    
    // Update stats
    this.updateStats()
  }

  /**
   * Batch register tools
   */
  registerMany(tools: Tool[]): void {
    for (const tool of tools) {
      this.register(tool)
    }
  }

  /**
   * Register a toolset
   */
  registerToolset(toolset: Toolset): void {
    this.toolsets.set(toolset.name, toolset)
    this.stats.totalToolsets = this.toolsets.size
    this.stats.byToolset[toolset.name] = toolset.tools.length
  }

  /**
   * Register default toolsets
   */
  private registerDefaultToolsets(): void {
    for (const toolset of DEFAULT_TOOLSETS) {
      this.registerToolset(toolset)
    }
  }

  /**
   * Register default built-in tools
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
   * Get a tool by name
   */
  get(name: string): Tool | undefined {
    return this.tools.get(this.getKey(name))?.tool
  }

  /**
   * Get tool entry (internal)
   */
  getEntry(name: string): ToolEntry | undefined {
    return this.tools.get(this.getKey(name))
  }

  /**
   * List all tools
   */
  list(): Tool[] {
    return Array.from(this.tools.values()).map(e => e.tool)
  }

  /**
   * List tools by category
   */
  listByCategory(category: ToolCategory): Tool[] {
    const keys = this.categories.get(category)
    if (!keys) return []
    return Array.from(keys)
      .map(k => this.tools.get(k)?.tool)
      .filter((t): t is Tool => t !== undefined)
  }

  /**
   * List tools by risk level
   */
  listByRiskLevel(riskLevel: RiskLevel): Tool[] {
    return this.list().filter(t => t.riskLevel === riskLevel)
  }

  /**
   * List enabled tools
   */
  listEnabled(): Tool[] {
    return this.list().filter(t => t.enabled)
  }

  /**
   * List available tools (passed check_fn)
   */
  async listAvailable(): Promise<Tool[]> {
    const available: Tool[] = []
    
    for (const entry of this.tools.values()) {
      const tool = entry.tool
      if (!tool.enabled) continue
      
      // Run check_fn if present
      if (tool.check_fn) {
        try {
          const result = await Promise.resolve(tool.check_fn())
          if (!result) continue
        } catch {
          continue
        }
      }
      
      available.push(tool)
    }
    
    return available
  }

  /**
   * List tools in a toolset
   */
  listByToolset(toolsetName: string): Tool[] {
    const toolset = this.toolsets.get(toolsetName)
    if (!toolset) return []
    return toolset.tools
      .map(name => this.get(name))
      .filter((t): t is Tool => t !== undefined && t.enabled)
  }

  // ============================================================================
  // Modification
  // ============================================================================

  /**
   * Enable a tool
   */
  enable(name: string): boolean {
    const entry = this.tools.get(this.getKey(name))
    if (entry) {
      entry.tool.enabled = true
      this.updateStats()
      return true
    }
    return false
  }

  /**
   * Disable a tool
   */
  disable(name: string): boolean {
    const entry = this.tools.get(this.getKey(name))
    if (entry) {
      entry.tool.enabled = false
      this.updateStats()
      return true
    }
    return false
  }

  /**
   * Unregister a tool
   */
  unregister(name: string): boolean {
    const key = this.getKey(name)
    const entry = this.tools.get(key)
    if (entry) {
      this.tools.delete(key)
      this.categories.get(entry.tool.category)?.delete(key)
      this.updateStats()
      return true
    }
    return false
  }

  // ============================================================================
  // Execution
  // ============================================================================

  /**
   * Execute a tool with hooks (Hermes-style)
   */
  async execute(
    name: string,
    input: unknown,
    context: ToolContext = {}
  ): Promise<ToolResult> {
    const entry = this.getEntry(name)

    if (!entry) {
      return { success: false, error: `Tool not found: ${name}` }
    }

    const tool = entry.tool

    if (!tool.enabled) {
      return { success: false, error: `Tool disabled: ${name}` }
    }

    // Build hook context
    const hookCtx: ToolHookContext = {
      toolName: name,
      input,
      context,
      sessionId: context.sessionId,
      userId: context.userId,
    }

    // Run check_fn if present
    if (tool.check_fn) {
      try {
        const result = await Promise.resolve(tool.check_fn())
        if (!result) {
          return { success: false, error: `Tool unavailable: ${name}` }
        }
      } catch (error) {
        return { success: false, error: `Tool check failed: ${name}` }
      }
    }

    // Run pre-tool hooks
    const preResult = await this.runPreHooks(hookCtx)
    if (!preResult.allow) {
      return { success: false, error: `Tool blocked by pre-hook: ${name}` }
    }

    const startTime = Date.now()
    entry.callCount++
    this.stats.totalCalls++

    try {
      let result: ToolResult

      // Execute with potentially modified input from hooks
      if (tool.is_async) {
        result = await tool.execute(preResult.input, context)
      } else {
        result = tool.execute(preResult.input, context) as ToolResult
        if (result && typeof result.then === 'function') {
          result = await result
        }
      }

      // Run post-tool hooks
      result = await this.runPostHooks(hookCtx, result)

      return {
        ...result,
        duration: Date.now() - startTime,
      }
    } catch (error: any) {
      // Run error hooks
      await this.runErrorHooks(hookCtx, error)

      return {
        success: false,
        error: String(error),
        duration: Date.now() - startTime,
      }
    }
  }

  /**
   * Execute multiple tools concurrently (Hermes-style)
   */
  async executeMany(
    requests: Array<{ name: string; input: unknown }>,
    context: ToolContext = {}
  ): Promise<Map<string, ToolResult>> {
    const promises = requests.map(async ({ name, input }) => {
      const result = await this.execute(name, input, context)
      return { name, result }
    })
    
    const results = await Promise.all(promises)
    return new Map(results.map(r => [r.name, r.result]))
  }

  /**
   * Execute tools concurrently with thread pool (Hermes-style)
   */
  async executeConcurrent(
    requests: Array<{ name: string; input: unknown }>,
    context: ToolContext = {},
    maxConcurrency = 5
  ): Promise<Map<string, ToolResult>> {
    const queue = [...requests]
    const results = new Map<string, ToolResult>()
    const executing: Promise<void>[] = []
    
    const executeOne = async (req: { name: string; input: unknown }): Promise<void> => {
      const result = await this.execute(req.name, req.input, context)
      results.set(req.name, result)
    }
    
    while (queue.length > 0 || executing.length > 0) {
      while (executing.length < maxConcurrency && queue.length > 0) {
        const req = queue.shift()!
        executing.push(executeOne(req).finally(() => {
          const idx = executing.indexOf(executeOne(req))
          if (idx >= 0) executing.splice(idx, 1)
        }))
      }
      
      if (executing.length > 0) {
        await Promise.race(executing)
      }
    }
    
    return results
  }

  // ============================================================================
  // OpenAI Function Calling Schema (Hermes-style)
  // ============================================================================

  /**
   * Get OpenAI function calling schema for available tools
   */
  getDefinitions(enabledToolsets?: string[]): ToolDefinition[] {
    const tools = this.listEnabled()
    
    return tools
      .filter(tool => {
        // Run check_fn if present
        if (tool.check_fn) {
          try {
            const result = tool.check_fn()
            if (result === false) return false
          } catch {
            return false
          }
        }
        
        // Filter by toolset if specified
        if (enabledToolsets && enabledToolsets.length > 0) {
          const toolset = tool.toolset || 'other'
          if (!enabledToolsets.includes(toolset)) {
            return false
          }
        }
        
        return true
      })
      .map(tool => ({
        type: 'function' as const,
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        },
      }))
  }

  /**
   * Get tool definition for a single tool
   */
  getDefinition(name: string): ToolDefinition | undefined {
    const tool = this.get(name)
    if (!tool || !tool.enabled) return undefined
    
    return {
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }
  }

  // ============================================================================
  // Tool Call Handling (Hermes-style)
  // ============================================================================

  /**
   * Parse and execute a tool call
   */
  async handleToolCall(toolCall: ToolCall, context: ToolContext = {}): Promise<ToolCallResult> {
    const { id, name, arguments: args } = toolCall
    
    let parsedArgs: unknown
    if (typeof args === 'string') {
      try {
        parsedArgs = JSON.parse(args)
      } catch {
        return {
          tool_call_id: id,
          output: JSON.stringify({ success: false, error: 'Invalid JSON arguments' }),
          is_error: true,
        }
      }
    } else {
      parsedArgs = args
    }
    
    const result = await this.execute(name, parsedArgs, context)
    
    return {
      tool_call_id: id,
      output: JSON.stringify(result),
      is_error: !result.success,
    }
  }

  /**
   * Parse and execute multiple tool calls (Hermes-style concurrent)
   */
  async handleToolCalls(
    toolCalls: ToolCall[],
    context: ToolContext = {}
  ): Promise<ToolCallResult[]> {
    // Execute concurrently like Hermes does
    const results = await this.executeConcurrent(
      toolCalls.map(tc => ({ name: tc.name, input: tc.arguments })),
      context
    )
    
    return toolCalls.map(tc => {
      const result = results.get(tc.name)
      return {
        tool_call_id: tc.id,
        output: result ? JSON.stringify(result) : JSON.stringify({ success: false, error: 'Tool not found' }),
        is_error: !result?.success,
      }
    })
  }

  // ============================================================================
  // Statistics
  // ============================================================================

  /**
   * Get registry statistics
   */
  stats(): RegistryStats {
    return { ...this.stats }
  }

  /**
   * Get tool call statistics
   */
  getCallStats(name: string): { callCount: number; avgDuration: number } | undefined {
    const entry = this.getEntry(name)
    if (!entry) return undefined
    
    return {
      callCount: entry.callCount,
      avgDuration: 0, // Would need to track per-call duration
    }
  }

  /**
   * Update internal statistics
   */
  private updateStats(): void {
    const stats = this.initStats()
    
    for (const entry of this.tools.values()) {
      const tool = entry.tool
      
      stats.totalTools++
      stats.byCategory[tool.category]++
      stats.byRiskLevel[tool.riskLevel]++
      
      if (tool.enabled) {
        stats.enabledTools++
      } else {
        stats.disabledTools++
      }
      
      // Run check_fn to determine availability
      if (tool.check_fn) {
        try {
          const result = tool.check_fn()
          if (result === true) {
            stats.availableTools++
          } else {
            stats.unavailableTools++
          }
        } catch {
          stats.unavailableTools++
        }
      } else {
        stats.availableTools++
      }
      
      stats.totalCalls += entry.callCount
    }
    
    this.stats = stats
  }

  // ============================================================================
  // Utilities
  // ============================================================================

  /**
   * Check if tool exists
   */
  has(name: string): boolean {
    return this.tools.has(this.getKey(name))
  }

  /**
   * Get tool count
   */
  size(): number {
    return this.tools.size
  }

  /**
   * Clear all tools
   */
  clear(): void {
    this.tools.clear()
    this.categories.clear()
    this.updateStats()
  }

  /**
   * Search tools by name or description
   */
  search(query: string): Tool[] {
    const q = query.toLowerCase()
    return this.list().filter(t =>
      t.name.toLowerCase().includes(q) ||
      t.description.toLowerCase().includes(q)
    )
  }

  /**
   * Get key (case-sensitive or insensitive)
   */
  private getKey(name: string): string {
    return this.config.caseSensitive ? name : name.toLowerCase()
  }

  // ============================================================================
  // AST-based Tool Discovery (Hermes-style)
  // ============================================================================

  /**
   * Discover tools by scanning directory for self-registering modules
   * This is the Hermes-style auto-discovery mechanism
   */
  async discoverTools(dirs: string[]): Promise<DiscoveryResult> {
    const result: DiscoveryResult = {
      tools: [],
      errors: [],
      duration: 0,
    }
    
    const startTime = Date.now()
    
    for (const dir of dirs) {
      try {
        const discovered = await this.scanDirectory(dir)
        result.tools.push(...discovered)
      } catch (error) {
        result.errors.push({
          file: dir,
          error: String(error),
        })
      }
    }
    
    result.duration = Date.now() - startTime
    return result
  }

  /**
   * Scan a directory for tool files
   */
  private async scanDirectory(dir: string): Promise<DiscoveredTool[]> {
    const discovered: DiscoveredTool[] = []
    
    try {
      const { readdirSync } = await import('fs')
      const { join } = await import('path')
      
      const files = readdirSync(dir)
      
      for (const file of files) {
        if (!file.endsWith('.ts') && !file.endsWith('.js')) continue
        if (file === 'index.ts' || file === 'index.js') continue
        
        const filePath = join(dir, file)
        
        try {
          const { readFileSync } = await import('fs')
          const content = readFileSync(filePath, 'utf-8')
          
          // Look for registry.register() calls
          const registerMatches = content.matchAll(/registry\.register\s*\(/g)
          
          for (const match of registerMatches) {
            const lineNumber = content.substring(0, match.index!).split('\n').length
            discovered.push({
              name: 'Unknown', // Would need AST parsing to get actual name
              file: filePath,
              line: lineNumber,
            })
          }
        } catch {
          // Skip files that can't be read
        }
      }
    } catch {
      // Directory doesn't exist or can't be read
    }
    
    return discovered
  }

  /**
   * Import a tool module and trigger self-registration
   */
  async importToolModule(modulePath: string): Promise<void> {
    try {
      await import(modulePath)
    } catch (error) {
      throw new Error(`Failed to import tool module ${modulePath}: ${error}`)
    }
  }
}

// ============================================================================
// Global Registry
// ============================================================================

export const globalToolRegistry = new ToolRegistry()

/**
 * Helper for tool self-registration (called at module import time)
 * This is the Hermes-style pattern
 */
export function registerTool(tool: Tool): void {
  globalToolRegistry.register(tool)
}

/**
 * Helper for toolset registration
 */
export function registerToolset(toolset: Toolset): void {
  globalToolRegistry.registerToolset(toolset)
}

/**
 * Get a tool
 */
export function getTool(name: string): Tool | undefined {
  return globalToolRegistry.get(name)
}

/**
 * Execute a tool
 */
export async function executeTool(
  name: string,
  input: unknown,
  context?: ToolContext
): Promise<ToolResult> {
  return globalToolRegistry.execute(name, input, context)
}

/**
 * List all tools
 */
export function listTools(): Tool[] {
  return globalToolRegistry.list()
}

/**
 * Get OpenAI function definitions
 */
export function getToolDefinitions(enabledToolsets?: string[]): ToolDefinition[] {
  return globalToolRegistry.getDefinitions(enabledToolsets)
}

/**
 * Handle a tool call
 */
export async function handleToolCall(
  toolCall: ToolCall,
  context?: ToolContext
): Promise<ToolCallResult> {
  return globalToolRegistry.handleToolCall(toolCall, context || {})
}

/**
 * Handle multiple tool calls concurrently
 */
export async function handleToolCalls(
  toolCalls: ToolCall[],
  context?: ToolContext
): Promise<ToolCallResult[]> {
  return globalToolRegistry.handleToolCalls(toolCalls, context || {})
}
