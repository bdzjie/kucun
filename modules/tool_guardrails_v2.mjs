/**
 * tool_guardrails_v2.mjs
 * 
 * Inspired by OpenAI Agents SDK tool_guardrails.py.
 * Provides ToolInputGuardrail and ToolOutputGuardrail with behavior system.
 * 
 * Behaviors:
 * - allow: Continue normally (default)
 * - reject_content: Continue but replace output with message
 * - raise_exception: Halt execution
 * 
 * Usage:
 *   import { tool_input_guardrail, tool_output_guardrail } from './modules';
 *   
 *   const pathCheck = tool_input_guardrail(async (data) => {
 *     if (data.context.toolArguments.path.includes('..')) {
 *       return ToolGuardrailOutput.reject_content('Path traversal detected');
 *     }
 *     return ToolGuardrailOutput.allow();
 *   });
 */

import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';

// ============================================================
// Tool Guardrail Output
// ============================================================

export const GUARDRAIL_BEHAVIORS = {
  ALLOW: 'allow',
  REJECT_CONTENT: 'reject_content',
  RAISE_EXCEPTION: 'raise_exception',
};

export class ToolGuardrailOutput {
  constructor(outputInfo, behavior) {
    this.output_info = outputInfo;
    this.behavior = behavior;
  }

  static allow(outputInfo = null) {
    return new ToolGuardrailOutput(outputInfo, {
      type: GUARDRAIL_BEHAVIORS.ALLOW,
    });
  }

  static rejectContent(message, outputInfo = null) {
    return new ToolGuardrailOutput(outputInfo, {
      type: GUARDRAIL_BEHAVIORS.REJECT_CONTENT,
      message,
    });
  }

  static raiseException(outputInfo = null) {
    return new ToolGuardrailOutput(outputInfo, {
      type: GUARDRAIL_BEHAVIORS.RAISE_EXCEPTION,
    });
  }

  get isAllow() {
    return this.behavior.type === GUARDRAIL_BEHAVIORS.ALLOW;
  }

  get isRejectContent() {
    return this.behavior.type === GUARDRAIL_BEHAVIORS.REJECT_CONTENT;
  }

  get isRaiseException() {
    return this.behavior.type === GUARDRAIL_BEHAVIORS.RAISE_EXCEPTION;
  }

  toJSON() {
    return {
      output_info: this.output_info,
      behavior: this.behavior,
    };
  }
}

// ============================================================
// Tool Context
// ============================================================

export class ToolContext {
  constructor(options = {}) {
    this.toolName = options.toolName || 'unknown';
    this.toolCallId = options.toolCallId || generateId('toolcall');
    this.toolArguments = options.toolArguments || {};
    this.agentName = options.agentName || 'unknown';
    this.runId = options.runId || null;
    this.metadata = options.metadata || {};
  }

  get(key, defaultValue = null) {
    return this.metadata[key] ?? defaultValue;
  }

  set(key, value) {
    this.metadata[key] = value;
  }

  toJSON() {
    return {
      toolName: this.toolName,
      toolCallId: this.toolCallId,
      toolArguments: this.toolArguments,
      agentName: this.agentName,
      runId: this.runId,
      metadata: this.metadata,
    };
  }
}

// ============================================================
// Tool Guardrail Base
// ============================================================

export class ToolGuardrail {
  constructor(guardrailFunction, name = null) {
    this.guardrailFunction = guardrailFunction;
    this.name = name || guardrailFunction.name || 'anonymous';
  }

  getName() {
    return this.name;
  }

  async run(data) {
    const result = this.guardrailFunction(data);
    if (result && typeof result.then === 'function') {
      return await result;
    }
    return result;
  }
}

export class ToolInputGuardrail extends ToolGuardrail {
  constructor(guardrailFunction, name = null) {
    super(guardrailFunction, name);
  }

  /**
   * Run this input guardrail
   */
  async check(context, agent, tool, input) {
    const data = {
      context: context instanceof ToolContext ? context : new ToolContext({
        toolName: tool,
        toolArguments: typeof input === 'object' ? input : { input },
        agentName: agent,
      }),
      agent,
      tool,
      input,
    };
    return await this.run(data);
  }
}

export class ToolOutputGuardrail extends ToolGuardrail {
  constructor(guardrailFunction, name = null) {
    super(guardrailFunction, name);
  }

  /**
   * Run this output guardrail
   */
  async check(context, agent, tool, output) {
    const data = {
      context: context instanceof ToolContext ? context : new ToolContext({
        toolName: tool,
        agentName: agent,
      }),
      agent,
      tool,
      output,
    };
    return await this.run(data);
  }
}

// ============================================================
// Guardrail Decorators
// ============================================================

/**
 * Decorator to create a ToolInputGuardrail
 */
export function toolInputGuardrailDecorator(name = null) {
  return function(target) {
    return new ToolInputGuardrail(target, name);
  };
}

/**
 * Decorator to create a ToolOutputGuardrail
 */
export function toolOutputGuardrailDecorator(name = null) {
  return function(target) {
    return new ToolOutputGuardrail(target, name);
  };
}

// ============================================================
// Built-in Guardrails
// ============================================================

/**
 * Path traversal check - prevents .. in paths
 */
export function pathTraversalGuardrail() {
  return new ToolInputGuardrail(async (data) => {
    const args = data.context.toolArguments;
    const pathValue = args.path || args.file || args.filePath || args.target;
    
    if (pathValue && typeof pathValue === 'string') {
      if (pathValue.includes('..') || pathValue.includes('~')) {
        return ToolGuardrailOutput.rejectContent(
          'Path contains disallowed characters (.. or ~)',
          { blockedPath: pathValue, reason: 'path_traversal' }
        );
      }
      
      // Check for absolute paths outside allowed directories
      const allowedRoots = [
        join(homedir(), '.openclaw'),
        'C:\\Users\\Administrator',
        '/home',
      ];
      
      const isAbsolute = pathValue.startsWith('/') || pathValue.match(/^[A-Z]:/i);
      if (isAbsolute) {
        const isAllowed = allowedRoots.some(root => pathValue.startsWith(root));
        if (!isAllowed) {
          return ToolGuardrailOutput.rejectContent(
            'Path outside allowed directories',
            { blockedPath: pathValue, reason: 'path_not_allowed' }
          );
        }
      }
    }
    
    return ToolGuardrailOutput.allow({ check: 'path_traversal', passed: true });
  }, 'path_traversal_check');
}

/**
 * Bash command dangerous check
 */
export function bashDangerousCommandGuardrail() {
  return new ToolInputGuardrail(async (data) => {
    const args = data.context.toolArguments;
    const command = args.command || args.cmd || args.script;
    
    if (command && typeof command === 'string') {
      const dangerous = [
        'rm -rf /',
        'rm -rf /*',
        'del /f /q',
        'format c:',
        '> /dev/null',
        '2>&1',
        'curl | sh',
        'wget | sh',
      ];
      
      const lower = command.toLowerCase();
      for (const pattern of dangerous) {
        if (lower.includes(pattern.toLowerCase())) {
          return ToolGuardrailOutput.rejectContent(
            `Command contains dangerous pattern: ${pattern}`,
            { blocked: true, reason: 'dangerous_command' }
          );
        }
      }
    }
    
    return ToolGuardrailOutput.allow({ check: 'bash_dangerous', passed: true });
  }, 'bash_dangerous_check');
}

/**
 * Output size guardrail - prevents huge outputs
 */
export function outputSizeGuardrail(maxSize = 100_000) {
  return new ToolOutputGuardrail(async (data) => {
    const output = data.output;
    const outputStr = typeof output === 'string' ? output : JSON.stringify(output);
    
    if (outputStr.length > maxSize) {
      return ToolGuardrailOutput.rejectContent(
        `Output exceeds maximum size (${maxSize} chars)`,
        { size: outputStr.length, maxSize, reason: 'output_too_large' }
      );
    }
    
    return ToolGuardrailOutput.allow({ size: outputStr.length, withinLimit: true });
  }, 'output_size_check');
}

/**
 * SQL injection check for query parameters
 */
export function sqlInjectionGuardrail() {
  return new ToolInputGuardrail(async (data) => {
    const args = data.context.toolArguments;
    const query = args.query || args.sql || args.statement;
    
    if (query && typeof query === 'string') {
      const sqlPatterns = [
        /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|UNION)\b)/i,
        /(--|\/\*|\*\/|;)/,
        /('|"|\\bx\\b)/,
      ];
      
      const matches = [];
      for (const pattern of sqlPatterns) {
        const found = query.match(pattern);
        if (found) {
          matches.push(found[0]);
        }
      }
      
      if (matches.length >= 2) {
        return ToolGuardrailOutput.rejectContent(
          'Query looks like SQL injection',
          { patterns: matches, reason: 'sql_injection' }
        );
      }
    }
    
    return ToolGuardrailOutput.allow({ check: 'sql_injection', passed: true });
  }, 'sql_injection_check');
}

// ============================================================
// Guardrail Store
// ============================================================

const CONFIG_PATH = join(homedir(), '.openclaw', 'memory', 'tool_guardrails_v2.json');

class GuardrailStore {
  constructor() {
    this.guardrails = new Map();
    this.enabled = new Map();
    this._loadConfig();
  }

  _loadConfig() {
    try {
      if (existsSync(CONFIG_PATH)) {
        const data = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
        // Load enabled state
        for (const [name, enabled] of Object.entries(data.enabled || {})) {
          this.enabled.set(name, enabled);
        }
      }
    } catch (e) {
      // Use defaults
    }
  }

  _saveConfig() {
    try {
      const dir = dirname(CONFIG_PATH);
      if (!existsSync(dir)) {
        require('fs').mkdirSync(dir, { recursive: true });
      }
      const enabled = Object.fromEntries(this.enabled);
      require('fs').writeFileSync(CONFIG_PATH, JSON.stringify({ enabled }, null, 2));
    } catch (e) {}
  }

  /**
   * Add a guardrail
   */
  add(guardrail) {
    this.guardrails.set(guardrail.getName(), guardrail);
    if (!this.enabled.has(guardrail.getName())) {
      this.enabled.set(guardrail.getName(), true);
    }
  }

  /**
   * Get a guardrail
   */
  get(name) {
    return this.guardrails.get(name);
  }

  /**
   * List all guardrails
   */
  list() {
    return Array.from(this.guardrails.values());
  }

  /**
   * Check if a guardrail is enabled
   */
  isEnabled(name) {
    return this.enabled.get(name) ?? true;
  }

  /**
   * Enable/disable a guardrail
   */
  setEnabled(name, enabled) {
    this.enabled.set(name, enabled);
    this._saveConfig();
  }

  /**
   * Run all enabled input guardrails
   */
  async runInputGuardrails(context, agent, tool, input) {
    const results = [];
    
    for (const [name, guardrail] of this.guardrails) {
      if (!this.isEnabled(name)) continue;
      if (!(guardrail instanceof ToolInputGuardrail)) continue;
      
      try {
        const result = await guardrail.check(context, agent, tool, input);
        results.push({ name, result });
        
        if (!result.isAllow) {
          return { allowed: false, result, guardrailName: name };
        }
      } catch (error) {
        results.push({ name, error: error.message });
      }
    }
    
    return { allowed: true, results };
  }

  /**
   * Run all enabled output guardrails
   */
  async runOutputGuardrails(context, agent, tool, output) {
    const results = [];
    
    for (const [name, guardrail] of this.guardrails) {
      if (!this.isEnabled(name)) continue;
      if (!(guardrail instanceof ToolOutputGuardrail)) continue;
      
      try {
        const result = await guardrail.check(context, agent, tool, output);
        results.push({ name, result });
        
        if (!result.isAllow) {
          return { allowed: false, result, guardrailName: name };
        }
      } catch (error) {
        results.push({ name, error: error.message });
      }
    }
    
    return { allowed: true, results };
  }
}

// Singleton
let _guardrailStore = null;

export function getGuardrailStore() {
  if (!_guardrailStore) {
    _guardrailStore = new GuardrailStore();
  }
  return _guardrailStore;
}

export function addGuardrail(guardrail) {
  getGuardrailStore().add(guardrail);
}

export function runInputGuardrails(context, agent, tool, input) {
  return getGuardrailStore().runInputGuardrails(context, agent, tool, input);
}

export function runOutputGuardrails(context, agent, tool, output) {
  return getGuardrailStore().runOutputGuardrails(context, agent, tool, output);
}

// ============================================================
// Utilities
// ============================================================

function generateId(prefix = '') {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  return prefix ? `${prefix}_${hex}` : hex;
}

// Initialize with built-in guardrails
export function initializeBuiltInGuardrails() {
  const store = getGuardrailStore();
  store.add(pathTraversalGuardrail());
  store.add(bashDangerousCommandGuardrail());
  store.add(outputSizeGuardrail());
  store.add(sqlInjectionGuardrail());
}

// Auto-initialize
initializeBuiltInGuardrails();
