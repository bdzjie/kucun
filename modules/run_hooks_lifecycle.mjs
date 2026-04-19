/**
 * run_hooks_lifecycle.mjs
 * 
 * Inspired by OpenAI Agents SDK lifecycle.py RunHooks system.
 * Provides comprehensive lifecycle hooks for OpenClaw agent runs.
 * 
 * Hook Types:
 * - on_llm_start/end: LLM call lifecycle
 * - on_agent_start/end: Agent invocation lifecycle
 * - on_handoff: Agent-to-agent transfer
 * - on_tool_start/end: Individual tool lifecycle
 * - on_turn_start/end: Turn lifecycle
 * 
 * Usage:
 *   import { createAgentRunner } from './modules';
 *   
 *   const runner = createAgentRunner({
 *     hooks: {
 *       async on_turn_start(ctx) { ... },
 *       async on_tool_end(ctx, tool, result) { ... },
 *     }
 *   });
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// ============================================================
// Types
// ============================================================

/**
 * @typedef {Object} LifecycleContext
 * @property {string} runId - Unique run identifier
 * @property {string} agentName - Current agent name
 * @property {number} turnNumber - Current turn number
 * @property {object} usage - Token usage info
 * @property {object} metadata - Custom metadata
 */

/**
 * @typedef {Object} ToolContext
 * @property {string} toolName - Tool name
 * @property {string} toolCallId - Tool call ID
 * @property {object} arguments - Tool arguments
 * @property {string} output - Tool output (on_tool_end)
 */

/**
 * @typedef {Object} HandoffContext
 * @property {string} fromAgent - Source agent
 * @property {string} toAgent - Target agent
 * @property {object} input - Handoff input
 */

// ============================================================
// Lifecycle Hooks Interface
// ============================================================

export const LIFECYCLE_HOOKS = {
  // Turn-level hooks
  on_turn_start: 'on_turn_start',
  on_turn_end: 'on_turn_end',
  
  // LLM-level hooks
  on_llm_start: 'on_llm_start',
  on_llm_end: 'on_llm_end',
  
  // Agent-level hooks
  on_agent_start: 'on_agent_start',
  on_agent_end: 'on_agent_end',
  
  // Handoff hooks
  on_handoff: 'on_handoff',
  on_handoff_end: 'on_handoff_end',
  
  // Tool-level hooks
  on_tool_start: 'on_tool_start',
  on_tool_end: 'on_tool_end',
  
  // Error hooks
  on_error: 'on_error',
  on_retry: 'on_retry',
  
  // Stream hooks
  on_stream_start: 'on_stream_start',
  on_stream_end: 'on_stream_end',
};

// ============================================================
// Base Hooks Implementation
// ============================================================

class BaseRunHooks {
  constructor() {
    this._hooks = {};
    this._setupDefaultHooks();
  }
  
  _setupDefaultHooks() {
    // Default no-op implementations
    for (const [, name] of Object.entries(LIFECYCLE_HOOKS)) {
      this._hooks[name] = async (...args) => {};
    }
  }
  
  /**
   * Register a hook handler
   */
  register(hookName, handler) {
    if (!LIFECYCLE_HOOKS[hookName]) {
      throw new Error(`Unknown hook: ${hookName}`);
    }
    this._hooks[hookName] = handler;
  }
  
  /**
   * Get a hook handler
   */
  getHook(hookName) {
    return this._hooks[hookName] || async (...args) => {};
  }
  
  // ============================================================
  // Turn Lifecycle
  // ============================================================
  
  async onTurnStart(ctx) {
    return this.getHook('on_turn_start')(ctx);
  }
  
  async onTurnEnd(ctx, output) {
    return this.getHook('on_turn_end')(ctx, output);
  }
  
  // ============================================================
  // LLM Lifecycle
  // ============================================================
  
  async onLLMStart(ctx, { systemPrompt, inputItems, model }) {
    return this.getHook('on_llm_start')(ctx, { systemPrompt, inputItems, model });
  }
  
  async onLLMEnd(ctx, { response, usage }) {
    return this.getHook('on_llm_end')(ctx, { response, usage });
  }
  
  // ============================================================
  // Agent Lifecycle
  // ============================================================
  
  async onAgentStart(ctx, { agent, input }) {
    return this.getHook('on_agent_start')(ctx, { agent, input });
  }
  
  async onAgentEnd(ctx, { agent, output }) {
    return this.getHook('on_agent_end')(ctx, { agent, output });
  }
  
  // ============================================================
  // Handoff Lifecycle
  // ============================================================
  
  async onHandoff(ctx, { fromAgent, toAgent, input }) {
    return this.getHook('on_handoff')(ctx, { fromAgent, toAgent, input });
  }
  
  async onHandoffEnd(ctx, { fromAgent, toAgent, result }) {
    return this.getHook('on_handoff_end')(ctx, { fromAgent, toAgent, result });
  }
  
  // ============================================================
  // Tool Lifecycle
  // ============================================================
  
  async onToolStart(ctx, { agent, tool, input }) {
    return this.getHook('on_tool_start')(ctx, { agent, tool, input });
  }
  
  async onToolEnd(ctx, { agent, tool, output, error }) {
    return this.getHook('on_tool_end')(ctx, { agent, tool, output, error });
  }
  
  // ============================================================
  // Error Handling
  // ============================================================
  
  async onError(ctx, { error, phase }) {
    return this.getHook('on_error')(ctx, { error, phase });
  }
  
  async onRetry(ctx, { error, attempt, maxAttempts }) {
    return this.getHook('on_retry')(ctx, { error, attempt, maxAttempts });
  }
  
  // ============================================================
  // Stream Lifecycle
  // ============================================================
  
  async onStreamStart(ctx) {
    return this.getHook('on_stream_start')(ctx);
  }
  
  async onStreamEnd(ctx) {
    return this.getHook('on_stream_end')(ctx);
  }
}

// ============================================================
// Composed Hooks (multiple handlers)
// ============================================================

class ComposedRunHooks extends BaseRunHooks {
  constructor(hooks = []) {
    super();
    this._handlers = hooks;
  }
  
  /**
   * Add a hooks object to the composition
   */
  add(hooks) {
    this._handlers.push(hooks);
    return this;
  }
  
  _getChain(hookName) {
    return this._handlers
      .map(h => h[hookName] || h[`on_${hookName}`])
      .filter(Boolean);
  }
  
  async _executeChain(hookName, ctx, args) {
    const chain = this._getChain(hookName);
    let result;
    for (const handler of chain) {
      result = await handler.call(this, ctx, ...args);
    }
    return result;
  }
  
  // Override to use composition
  getHook(hookName) {
    const chain = this._getChain(hookName);
    if (chain.length === 0) {
      return async (...args) => {};
    }
    if (chain.length === 1) {
      return chain[0].bind(this);
    }
    return async (...args) => {
      let result;
      for (const handler of chain) {
        result = await handler.call(this, ...args);
      }
      return result;
    };
  }
}

// ============================================================
// Lifecycle-Aware Runner
// ============================================================

export class LifecycleRunner {
  constructor(options = {}) {
    this.hooks = options.hooks || new BaseRunHooks();
    this.tools = options.tools || [];
    this.model = options.model || 'default';
  }
  
  /**
   * Create a run context
   */
  createContext(metadata = {}) {
    return {
      runId: `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      agentName: this.model,
      turnNumber: 0,
      usage: { inputTokens: 0, outputTokens: 0 },
      metadata,
      _startTime: Date.now(),
    };
  }
  
  /**
   * Execute a turn with lifecycle hooks
   */
  async runTurn(ctx, input, agentLogic) {
    // Increment turn
    ctx.turnNumber++;
    
    // on_turn_start
    await this.hooks.onTurnStart(ctx);
    
    try {
      // on_agent_start
      await this.hooks.onAgentStart(ctx, { agent: ctx.agentName, input });
      
      // on_llm_start
      await this.hooks.onLLMStart(ctx, { 
        systemPrompt: ctx.systemPrompt,
        inputItems: Array.isArray(input) ? input : [input],
        model: this.model
      });
      
      // Execute the actual agent logic
      const result = await agentLogic(input, ctx);
      
      // on_llm_end
      await this.hooks.onLLMEnd(ctx, { response: result, usage: ctx.usage });
      
      // on_agent_end
      await this.hooks.onAgentEnd(ctx, { agent: ctx.agentName, output: result });
      
      // on_turn_end
      await this.hooks.onTurnEnd(ctx, result);
      
      return result;
      
    } catch (error) {
      // on_error
      await this.hooks.onError(ctx, { error, phase: 'turn_execution' });
      throw error;
    }
  }
  
  /**
   * Execute a tool with lifecycle hooks
   */
  async runTool(ctx, toolName, input) {
    const tool = this.tools.find(t => t.name === toolName);
    
    // on_tool_start
    await this.hooks.onToolStart(ctx, { agent: ctx.agentName, tool: toolName, input });
    
    try {
      const output = await tool.execute(input, ctx);
      
      // on_tool_end
      await this.hooks.onToolEnd(ctx, { agent: ctx.agentName, tool: toolName, output, error: null });
      
      return output;
      
    } catch (error) {
      // on_tool_end with error
      await this.hooks.onToolEnd(ctx, { agent: ctx.agentName, tool: toolName, output: null, error });
      throw error;
    }
  }
  
  /**
   * Execute a handoff with lifecycle hooks
   */
  async runHandoff(ctx, fromAgent, toAgent, input) {
    // on_handoff
    await this.hooks.onHandoff(ctx, { fromAgent, toAgent, input });
    
    // Update context
    const prevAgent = ctx.agentName;
    ctx.agentName = toAgent;
    
    try {
      const result = await this.runTurn(ctx, input, this._agentLogic);
      
      // on_handoff_end
      await this.hooks.onHandoffEnd(ctx, { fromAgent: prevAgent, toAgent, result });
      
      return result;
      
    } finally {
      ctx.agentName = prevAgent;
    }
  }
}

// ============================================================
// Preset Hook Configurations
// ============================================================

/**
 * Logging hooks - logs all lifecycle events
 */
export function createLoggingHooks(logger = console) {
  return {
    async on_turn_start(ctx) {
      logger.log(`[Lifecycle] Turn ${ctx.turnNumber} start`);
    },
    async on_turn_end(ctx, output) {
      logger.log(`[Lifecycle] Turn ${ctx.turnNumber} end, output:`, String(output).slice(0, 100));
    },
    async on_llm_start(ctx, { model }) {
      logger.log(`[Lifecycle] LLM start with model: ${model}`);
    },
    async on_llm_end(ctx, { usage }) {
      logger.log(`[Lifecycle] LLM end, usage:`, usage);
    },
    async on_tool_start(ctx, { tool, input }) {
      logger.log(`[Lifecycle] Tool start: ${tool}`);
    },
    async on_tool_end(ctx, { tool, output, error }) {
      if (error) {
        logger.error(`[Lifecycle] Tool error: ${tool}`, error.message);
      } else {
        logger.log(`[Lifecycle] Tool end: ${tool}`);
      }
    },
    async on_handoff(ctx, { fromAgent, toAgent }) {
      logger.log(`[Lifecycle] Handoff: ${fromAgent} → ${toAgent}`);
    },
    async on_error(ctx, { error, phase }) {
      logger.error(`[Lifecycle] Error in ${phase}:`, error.message);
    }
  };
}

/**
 * Analytics hooks - tracks metrics
 */
export function createAnalyticsHooks() {
  const events = [];
  
  return {
    events,
    async on_turn_start(ctx) {
      events.push({ type: 'turn_start', ctx, timestamp: Date.now() });
    },
    async on_turn_end(ctx, output) {
      events.push({ type: 'turn_end', ctx, timestamp: Date.now(), duration: Date.now() - ctx._startTime });
    },
    async on_tool_start(ctx, { tool }) {
      events.push({ type: 'tool_start', tool, timestamp: Date.now() });
    },
    async on_tool_end(ctx, { tool, error }) {
      events.push({ type: 'tool_end', tool, error: error?.message, timestamp: Date.now() });
    },
    getStats() {
      return {
        totalTurns: events.filter(e => e.type === 'turn_start').length,
        totalTools: events.filter(e => e.type === 'tool_start').length,
        errors: events.filter(e => e.error).length,
      };
    }
  };
}

/**
 * Debug hooks - verbose debugging
 */
export function createDebugHooks() {
  return {
    async on_turn_start(ctx) {
      console.debug('[DEBUG] Turn start:', JSON.stringify(ctx, null, 2));
    },
    async on_llm_start(ctx, params) {
      console.debug('[DEBUG] LLM start:', params);
    },
    async on_llm_end(ctx, params) {
      console.debug('[DEBUG] LLM end:', params);
    },
    async on_tool_start(ctx, params) {
      console.debug('[DEBUG] Tool start:', params);
    },
    async on_tool_end(ctx, params) {
      console.debug('[DEBUG] Tool end:', params);
    },
    async on_handoff(ctx, params) {
      console.debug('[DEBUG] Handoff:', params);
    },
    async on_error(ctx, params) {
      console.error('[DEBUG] Error:', params);
    }
  };
}

// ============================================================
// Integration with OpenClaw
// ============================================================

/**
 * Create OpenClaw-compatible hooks from a hooks config object
 */
export function fromConfig(config) {
  const hooks = new BaseRunHooks();
  
  for (const [key, handler] of Object.entries(config)) {
    if (typeof handler === 'function') {
      hooks.register(key, handler);
    }
  }
  
  return hooks;
}

/**
 * Convert OpenClaw hook format to RunHooks format
 */
export function fromOpenClawHooks(openClawHooks) {
  const config = {};
  
  if (openClawHooks.onMessage) {
    config.on_turn_start = openClawHooks.onMessage;
  }
  if (openClawHooks.onToolResult) {
    config.on_tool_end = async (ctx, { tool, output, error }) => {
      return openClawHooks.onToolResult({ tool, output, result: { output, error } });
    };
  }
  
  return fromConfig(config);
}

export { BaseRunHooks, ComposedRunHooks, LifecycleRunner };
