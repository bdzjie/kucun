/**
 * tool_registry_autoload.ts — Hermes-style Tool Self-Registration
 * ================================================================
 *
 * 工具自注册 + 自发现系统
 *
 * 自注册模式（工具模块）:
 *   import { registerTool } from '../registry/index'
 *   registerTool({
 *     name: 'MyTool',
 *     description: '...',
 *     category: 'filesystem',
 *     parameters: {...},
 *     async execute(input, ctx) { ... }
 *   })
 *
 * 自动发现:
 *   import { globalToolRegistry } from '../registry/index'
 *   await globalToolRegistry.discoverTools(['./tools', './skills'])
 *
 * 灵感: Hermes Agent 的 AST-based tool discovery
 */

import { ToolRegistry, globalToolRegistry, registerTool, registerToolset } from '../registry/index'
import type { Tool, DiscoveredTool, DiscoveryResult, Toolset } from '../registry/types'

// Re-export for convenience
export { globalToolRegistry, registerTool, registerToolset }

// ============================================================================
// Built-in Tools — Self-Registration Pattern
// ============================================================================
//
// These tools use the Hermes-style registerTool() call at module import time.
// When this module is imported, all tools auto-register with globalToolRegistry.

// ─── FileSystem Tools ────────────────────────────────────────────────────────

registerTool({
  name: 'Read',
  description: 'Read file contents from the filesystem. Supports offset/limit for partial reads.',
  category: 'filesystem',
  riskLevel: 'low',
  toolset: 'filesystem',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Absolute or relative file path' },
      offset: { type: 'number', description: 'Line offset to start reading (1-indexed)' },
      limit: { type: 'number', description: 'Maximum lines to read' },
    },
    required: ['path'],
  },
  async execute(input, _ctx) {
    const fs = await import('fs')
    const path = await import('path')
    try {
      const filePath = (input as any).path as string
      const offset = (input as any).offset as number | undefined
      const limit = (input as any).limit as number | undefined

      if (!fs.existsSync(filePath)) {
        return { success: false, error: `File not found: ${filePath}` }
      }

      let content: string
      if (offset !== undefined || limit !== undefined) {
        const lines = fs.readFileSync(filePath, 'utf-8').split('\n')
        const start = Math.max(0, (offset || 1) - 1)
        const end = limit !== undefined ? start + limit : lines.length
        content = lines.slice(start, end).join('\n')
      } else {
        content = fs.readFileSync(filePath, 'utf-8')
      }

      return { success: true, output: content }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  },
})

registerTool({
  name: 'Write',
  description: 'Create or overwrite a file with content. Creates parent directories automatically.',
  category: 'filesystem',
  riskLevel: 'high',
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
    const fs = await import('fs')
    const path = await import('path')
    try {
      const filePath = (input as any).path as string
      const content = (input as any).content as string

      // Ensure directory exists
      const dir = path.dirname(filePath)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }

      fs.writeFileSync(filePath, content, 'utf-8')
      return { success: true, output: `Written ${content.length} bytes to ${filePath}` }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  },
})

registerTool({
  name: 'Edit',
  description: 'Edit file with precise text replacement. Replaces first occurrence of exact text.',
  category: 'filesystem',
  riskLevel: 'medium',
  toolset: 'filesystem',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path' },
      find: { type: 'string', description: 'Exact text to find' },
      replace: { type: 'string', description: 'Replacement text' },
    },
    required: ['path', 'find', 'replace'],
  },
  async execute(input, _ctx) {
    const fs = await import('fs')
    try {
      const filePath = (input as any).path as string
      const find = (input as any).find as string
      const replace = (input as any).replace as string

      if (!fs.existsSync(filePath)) {
        return { success: false, error: `File not found: ${filePath}` }
      }

      let content = fs.readFileSync(filePath, 'utf-8')
      if (!content.includes(find)) {
        return { success: false, error: `Text not found in file: ${find}` }
      }

      content = content.replace(find, replace)
      fs.writeFileSync(filePath, content, 'utf-8')
      return { success: true, output: `Edited ${filePath}` }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  },
})

registerTool({
  name: 'Glob',
  description: 'Find files matching a glob pattern (e.g., **/*.ts, src/*.js).',
  category: 'filesystem',
  riskLevel: 'low',
  toolset: 'filesystem',
  parameters: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Glob pattern (supports **, *, ?)' },
      cwd: { type: 'string', description: 'Working directory for search' },
    },
    required: ['pattern'],
  },
  async execute(input, _ctx) {
    try {
      const { globSync } = await import('glob')
      const pattern = (input as any).pattern as string
      const cwd = (input as any).cwd as string | undefined
      const files = globSync(pattern, { cwd })
      return { success: true, output: files }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  },
})

registerTool({
  name: 'Grep',
  description: 'Search for text pattern in files. Returns matching lines with line numbers.',
  category: 'filesystem',
  riskLevel: 'low',
  toolset: 'filesystem',
  parameters: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Text pattern to search' },
      path: { type: 'string', description: 'Directory or file to search in' },
      regex: { type: 'boolean', description: 'Treat pattern as regex' },
      caseSensitive: { type: 'boolean', description: 'Case sensitive search' },
    },
    required: ['pattern'],
  },
  async execute(input, _ctx) {
    const fs = await import('fs')
    const path = await import('path')
    try {
      const searchPath = (input as any).path as string || '.'
      const pattern = (input as any).pattern as string
      const isRegex = (input as any).regex as boolean | undefined
      const caseSensitive = (input as any).caseSensitive as boolean | undefined

      const results: Array<{ file: string; line: number; content: string }> = []

      function searchDir(dir: string) {
        const entries = fs.readdirSync(dir, { withFileTypes: true })
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name)
          if (entry.isDirectory()) {
            searchDir(fullPath)
          } else if (entry.isFile()) {
            try {
              const content = fs.readFileSync(fullPath, 'utf-8')
              const lines = content.split('\n')
              lines.forEach((line, i) => {
                const matches = isRegex
                  ? new RegExp(pattern, caseSensitive ? '' : 'i').test(line)
                  : line.includes(pattern)
                if (matches) {
                  results.push({ file: fullPath, line: i + 1, content: line.trim() })
                }
              })
            } catch {
              // Skip binary files
            }
          }
        }
      }

      searchDir(searchPath)
      return { success: true, output: results }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  },
})

// ─── Network Tools ───────────────────────────────────────────────────────────

registerTool({
  name: 'WebFetch',
  description: 'Fetch and extract readable content from a URL. Returns markdown or plain text.',
  category: 'network',
  riskLevel: 'medium',
  toolset: 'network',
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'HTTP or HTTPS URL to fetch' },
      extractMode: { type: 'string', enum: ['markdown', 'text'], description: 'Content extraction mode' },
      maxChars: { type: 'number', description: 'Maximum characters to return' },
    },
    required: ['url'],
  },
  async execute(input, _ctx) {
    try {
      const url = (input as any).url as string
      const extractMode = (input as any).extractMode as string || 'markdown'
      const maxChars = (input as any).maxChars as number | undefined

      const response = await fetch(url)
      if (!response.ok) {
        return { success: false, error: `HTTP ${response.status}: ${response.statusText}` }
      }

      const text = await response.text()
      let output = text

      if (maxChars && output.length > maxChars) {
        output = output.slice(0, maxChars) + '...'
      }

      return { success: true, output }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  },
})

// ─── Process Tools ──────────────────────────────────────────────────────────

registerTool({
  name: 'Bash',
  description: 'Execute shell commands. Supports PowerShell on Windows, bash on Unix.',
  category: 'process',
  riskLevel: 'high',
  toolset: 'process',
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'Shell command to execute' },
      cwd: { type: 'string', description: 'Working directory' },
      timeout: { type: 'number', description: 'Timeout in seconds' },
    },
    required: ['command'],
  },
  async execute(input, _ctx) {
    const { exec: execModule } = await import('child_process')
    const util = await import('util')
    const execAsync = util.promisify(execModule.exec)

    try {
      const command = (input as any).command as string
      const cwd = (input as any).cwd as string | undefined
      const timeout = (input as any).timeout as number | undefined

      const { stdout, stderr } = await execAsync(command, {
        cwd,
        timeout: timeout ? timeout * 1000 : undefined,
        shell: process.platform === 'win32' ? 'powershell' : '/bin/bash',
      })

      return {
        success: true,
        output: stdout + (stderr ? '\nSTDERR: ' + stderr : ''),
      }
    } catch (error: any) {
      return {
        success: false,
        error: error.stdout + '\n' + error.stderr || String(error),
      }
    }
  },
})

// ─── Memory Tools ────────────────────────────────────────────────────────────

registerTool({
  name: 'Remember',
  description: 'Store a memory in the temporal memory system. Classifies and stores in appropriate hall.',
  category: 'memory',
  riskLevel: 'low',
  toolset: 'memory',
  parameters: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'Memory text to store' },
      wing: { type: 'string', description: 'Wing: wing_user, wing_openclaw, wing_code, wing_mempalace' },
      room: { type: 'string', description: 'Room within wing (optional, auto-detected)' },
    },
    required: ['text'],
  },
  async execute(input, _ctx) {
    // TODO: Wire to TypeScript memory stack (modules/memory/memoryStack.ts)
    // import { remember } from './memory/memoryStack'
    return { success: false, error: 'Remember tool: wiring to TS memory stack pending' }
  },
})

registerTool({
  name: 'Recall',
  description: 'Query the temporal memory system. Supports wing/room filtering and semantic search.',
  category: 'memory',
  riskLevel: 'low',
  toolset: 'memory',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query' },
      wing: { type: 'string', description: 'Filter by wing' },
      room: { type: 'string', description: 'Filter by room' },
      hall: { type: 'string', description: 'Filter by hall type' },
      limit: { type: 'number', description: 'Max results' },
      asOf: { type: 'string', description: 'ISO timestamp for time-travel query' },
    },
    required: ['query'],
  },
  async execute(input, _ctx) {
    // TODO: Wire to TypeScript memory stack (modules/memory/memoryStack.ts)
    return { success: false, error: 'Recall tool: wiring to TS memory stack pending' }
  },
})

// ============================================================================
// Toolset: Memory
// ============================================================================

registerToolset({
  name: 'memory',
  description: 'Memory system tools — Remember and Recall',
  tools: ['Remember', 'Recall'],
})

// Toolset: FileSystem
registerToolset({
  name: 'filesystem',
  description: 'File operations — Read, Write, Edit, Glob, Grep',
  tools: ['Read', 'Write', 'Edit', 'Glob', 'Grep'],
})

// Toolset: Network
registerToolset({
  name: 'network',
  description: 'Network tools — WebFetch',
  tools: ['WebFetch'],
})

// Toolset: Process
registerToolset({
  name: 'process',
  description: 'Process tools — Bash',
  tools: ['Bash'],
})

console.log('[tool_registry_autoload] Registered 9 self-registering tools + 4 toolsets')
