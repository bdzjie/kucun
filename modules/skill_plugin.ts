/**
 * modules/skill_plugin.ts
 * ========================
 * Skill Plugin Interface — inspired by OpenMetadata Connector Pattern
 *
 * Standard interface for auto-discovered tools to register with OpenClaw.
 * Each plugin declares: name, version, priority, detection logic, metadata.
 *
 * Usage:
 *   import { SkillPluginRegistry } from './skill_plugin';
 *   const registry = new SkillPluginRegistry();
 *   registry.register(myPlugin);
 *   const tools = await registry.detectAll(context);
 */

import { EventEmitter } from 'events';

// ============================================================================
// Types
// ============================================================================

export interface Tool {
  id: string;
  name: string;
  description: string;
  parameters?: Record<string, unknown>;
  dangerous?: boolean;
  timeout?: number;
  retries?: number;
}

export interface SkillMetadata {
  name: string;
  version: string;
  description: string;
  author?: string;
  tags: string[];
  triggers: string[];
  size_kb: number;
  quality_score?: number;
  source: 'local' | 'registry';
}

export interface DetectContext {
  workspace: string;
  sessionId?: string;
  timestamp: string;
  config?: Record<string, unknown>;
}

export interface DetectResult {
  tools: Tool[];
  metadata: SkillMetadata;
  errors: string[];
  duration_ms: number;
}

export type Priority = 0 | 1 | 2 | 3;  // 0=highest (always tried first)

export interface SkillPlugin {
  /** Unique plugin identifier */
  readonly id: string;

  /** Human-readable name */
  readonly name: string;

  /** Semantic version */
  readonly version: string;

  /**
   * Detection priority.
   * 0 = highest (fast/expert skills — always run first)
   * 1 = normal
   * 2 = deep (slow analysis — run only when confident)
   * 3 = fallback (last resort)
   */
  readonly priority: Priority;

  /**
   * File patterns this plugin handles.
   * Glob patterns relative to workspace root.
   * E.g. ['*.py', 'src/**/*.ts']
   */
  readonly patterns: string[];

  /**
   * Languages this plugin supports (for code analysis).
   * E.g. ['python', 'typescript', 'javascript']
   */
  readonly languages: string[];

  /**
   * Optional: static tools this plugin always provides.
   * These are registered regardless of detection.
   */
  readonly staticTools?: Tool[];

  /**
   * Detect tools in the given workspace context.
   * Called once per session or on-demand.
   */
  detect(ctx: DetectContext): Promise<DetectResult>;

  /**
   * Validate that a detected tool is legitimate.
   * Return false to exclude from registry.
   */
  validate?(tool: Tool): boolean;

  /**
   * Return plugin metadata for the registry.
   */
  metadata(): SkillMetadata;

  /**
   * Optional: handle plugin-specific events.
   */
  onEvent?(event: PluginEvent): void;
}

// Supported event types
export type PluginEvent =
  | { type: 'tool_registered'; tool: Tool; plugin: string }
  | { type: 'tool_removed'; toolId: string; plugin: string }
  | { type: 'detection_complete'; count: number; duration_ms: number; plugin: string }
  | { type: 'error'; plugin: string; error: string };

// ============================================================================
// Registry
// ============================================================================

export class SkillPluginRegistry extends EventEmitter {
  private plugins = new Map<string, SkillPlugin>();
  private toolIndex = new Map<string, Tool>();  // toolId → tool
  private pluginOrder: string[] = [];  // sorted by priority

  constructor() {
    super();
  }

  /**
   * Register a plugin.
   * Plugins with priority=0 are always registered first.
   */
  register(plugin: SkillPlugin): void {
    if (this.plugins.has(plugin.id)) {
      console.warn(`[SkillPlugin] Plugin ${plugin.id} already registered — skipping`);
      return;
    }

    this.plugins.set(plugin.id, plugin);
    this._rebuildOrder();
    console.log(`[SkillPlugin] Registered: ${plugin.id} v${plugin.version} (priority=${plugin.priority})`);

    // Emit registration event
    this.emit('plugin_registered', {
      id: plugin.id,
      version: plugin.version,
      priority: plugin.priority,
      toolCount: plugin.staticTools?.length ?? 0,
    });
  }

  /**
   * Unregister a plugin and remove all its tools.
   */
  unregister(pluginId: string): void {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) return;

    // Remove all tools from this plugin
    for (const [toolId, tool] of this.toolIndex) {
      if ((tool as unknown as { _plugin?: string })._plugin === pluginId) {
        this.toolIndex.delete(toolId);
        this.emit('tool_removed', { toolId, plugin: pluginId });
      }
    }

    this.plugins.delete(pluginId);
    this._rebuildOrder();
    console.log(`[SkillPlugin] Unregistered: ${pluginId}`);
  }

  /**
   * Run detection on all plugins, in priority order.
   * Results are merged into the tool index.
   */
  async detectAll(ctx: DetectContext): Promise<DetectResult[]> {
    const results: DetectResult[] = [];
    const start = Date.now();

    for (const pluginId of this.pluginOrder) {
      const plugin = this.plugins.get(pluginId)!;
      const t0 = Date.now();

      try {
        const result = await plugin.detect(ctx);

        // Validate and index tools
        for (const tool of result.tools) {
          if (plugin.validate && !plugin.validate(tool)) {
            console.log(`[SkillPlugin] ${plugin.id}: excluded ${tool.name} (validation failed)`);
            continue;
          }
          (tool as unknown as { _plugin?: string })._plugin = pluginId;
          this.toolIndex.set(tool.id, tool);
          this.emit('tool_registered', { tool, plugin: pluginId });
        }

        result.duration_ms = Date.now() - t0;
        results.push(result);
        this.emit('detection_complete', {
          count: result.tools.length,
          duration_ms: result.duration_ms,
          plugin: pluginId,
        });

      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error(`[SkillPlugin] ${plugin.id} detection failed: ${errorMsg}`);
        results.push({
          tools: [],
          metadata: plugin.metadata(),
          errors: [errorMsg],
          duration_ms: Date.now() - t0,
        });
        this.emit('error', { plugin: pluginId, error: errorMsg });
      }
    }

    const total = Date.now() - start;
    console.log(`[SkillPlugin] Detection complete: ${this.toolIndex.size} tools from ${results.length} plugins in ${total}ms`);
    return results;
  }

  /**
   * Get all registered tools, sorted by priority.
   */
  getTools(): Tool[] {
    return Array.from(this.toolIndex.values());
  }

  /**
   * Get a specific tool by ID.
   */
  getTool(id: string): Tool | undefined {
    return this.toolIndex.get(id);
  }

  /**
   * Get all plugins.
   */
  getPlugins(): SkillPlugin[] {
    return Array.from(this.plugins.values());
  }

  /**
   * Get a specific plugin by ID.
   */
  getPlugin(id: string): SkillPlugin | undefined {
    return this.plugins.get(id);
  }

  /**
   * Get tools by priority level.
   */
  getToolsByPriority(priority: Priority): Tool[] {
    return this.getTools().filter(t =>
      (t as unknown as { _priority?: Priority })._priority === priority
    );
  }

  /**
   * Get registry stats.
   */
  getStats(): {
    pluginCount: number;
    toolCount: number;
    plugins: Array<{ id: string; version: string; priority: Priority; toolCount: number }>;
  } {
    const plugins = this.getPlugins();
    return {
      pluginCount: plugins.length,
      toolCount: this.toolIndex.size,
      plugins: plugins.map(p => ({
        id: p.id,
        version: p.version,
        priority: p.priority,
        toolCount: p.staticTools?.length ?? 0,
      })),
    };
  }

  // ─── Internal ─────────────────────────────────────────────────────────────

  private _rebuildOrder(): void {
    this.pluginOrder = Array.from(this.plugins.values())
      .sort((a, b) => a.priority - b.priority)
      .map(p => p.id);
  }
}

// ============================================================================
// Built-in Plugin: File Pattern Detector
// ============================================================================

/**
 * Detects tools based on file patterns in the workspace.
 * Priority 1 (normal) — always available.
 */
export class FilePatternPlugin implements SkillPlugin {
  readonly id = 'file_pattern';
  readonly name = 'File Pattern Detector';
  readonly version = '1.0.0';
  readonly priority: Priority = 1;
  readonly patterns = ['**/*'];
  readonly languages: string[] = [];

  async detect(ctx: DetectContext): Promise<DetectResult> {
    const tools: Tool[] = [];
    const errors: string[] = [];

    // File-based tools are discovered by skill_indexer.py
    // This plugin just registers the standard tool interface
    // The actual tool detection is handled by modules/tool_discovery.ts

    return {
      tools,
      metadata: this.metadata(),
      errors,
      duration_ms: 0,
    };
  }

  metadata(): SkillMetadata {
    return {
      name: this.name,
      version: this.version,
      description: 'Detects tools based on workspace file patterns',
      tags: ['discovery', 'filesystem'],
      triggers: [],
      size_kb: 0,
      source: 'local',
    };
  }
}

// ============================================================================
// Built-in Plugin: CLI Tool Detector
// ============================================================================

/**
 * Detects available CLI tools (git, node, python, etc.)
 * Priority 0 (highest) — fast, always available.
 */
export class CLIToolPlugin implements SkillPlugin {
  readonly id = 'cli_tools';
  readonly name = 'CLI Tool Detector';
  readonly version = '1.0.0';
  readonly priority: Priority = 0;
  readonly patterns = [];
  readonly languages: string[] = [];

  readonly staticTools: Tool[] = [
    { id: 'cli.git', name: 'git', description: 'Git version control' },
    { id: 'cli.node', name: 'node', description: 'Node.js runtime' },
    { id: 'cli.python', name: 'python', description: 'Python interpreter' },
    { id: 'cli.powershell', name: 'powershell', description: 'PowerShell shell' },
  ];

  async detect(ctx: DetectContext): Promise<DetectResult> {
    // CLI tools are always available — no runtime detection needed
    return {
      tools: this.staticTools ?? [],
      metadata: this.metadata(),
      errors: [],
      duration_ms: 0,
    };
  }

  metadata(): SkillMetadata {
    return {
      name: this.name,
      version: this.version,
      description: 'Provides standard CLI tools (git, node, python, powershell)',
      tags: ['discovery', 'cli', 'system'],
      triggers: ['git', 'node', 'python', 'shell', 'exec'],
      size_kb: 0,
      source: 'local',
    };
  }
}

// ============================================================================
// Singleton registry instance
// ============================================================================

let _registry: SkillPluginRegistry | null = null;

export function getSkillPluginRegistry(): SkillPluginRegistry {
  if (!_registry) {
    _registry = new SkillPluginRegistry();
    // Auto-register built-in plugins
    _registry.register(new CLIToolPlugin());
    _registry.register(new FilePatternPlugin());
  }
  return _registry;
}

export default { SkillPluginRegistry, getSkillPluginRegistry, FilePatternPlugin, CLIToolPlugin };
