/**
 * tool_guardrail_hook.mjs
 * 
 * Inspired by OpenAI Agents SDK Guardrail pattern.
 * Provides pre-tool and post-tool validation hooks with tripwire support.
 * 
 * Features:
 * - Pre-tool input validation (before execution)
 * - Post-tool output validation (after execution)
 * - Tripwire: block tool execution on validation failure
 * - Async support for all validators
 * - Persistent guardrail config in ~/.openclaw/memory/tool_guardrails.json
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const GUARDRAIL_CONFIG_PATH = join(homedir(), '.openclaw', 'memory', 'tool_guardrails.json');

// ============================================================
// Types
// ============================================================

/**
 * @typedef {Object} GuardrailResult
 * @property {boolean} allowed - Whether to allow the operation
 * @property {string} [reason] - Reason if blocked
 * @property {object} [output_info] - Additional info about the check
 */

/**
 * @typedef {Object} ToolGuardrail
 * @property {string} name - Unique name for this guardrail
 * @property {string} description - What this guardrail checks
 * @property {string} tool_pattern - Glob pattern for tool names (e.g., "Edit", "Bash", "Write")
 * @property {Function} validate_input - Async function(input, toolName) => GuardrailResult
 * @property {Function} [validate_output] - Async function(output, toolName) => GuardrailResult
 * @property {boolean} enabled - Whether this guardrail is active
 * @property {number} priority - Lower = runs first
 */

// ============================================================
// Built-in Validators
// ============================================================

const BUILT_IN_VALIDATORS = {
  /**
   * Block dangerous file operations outside workspace
   */
  path_traversal_check: {
    name: 'path_traversal_check',
    description: 'Blocks path traversal attempts (..) in file paths',
    tool_pattern: 'Write|Edit|Read|Glob|Grep',
    validate_input: async (input, toolName) => {
      if (!input || typeof input !== 'object') return { allowed: true, output_info: { check: 'skip_no_input' } };
      
      // Extract paths from input
      const paths = [];
      if (input.path) paths.push(input.path);
      if (input.file_path) paths.push(input.file_path);
      if (input.target) paths.push(input.target);
      if (input.files) input.files.forEach(f => paths.push(f));
      
      for (const p of paths) {
        if (typeof p === 'string') {
          // Check for path traversal
          if (p.includes('..') || p.includes('~\\') || p.includes('~/')) {
            return {
              allowed: false,
              reason: `Path traversal detected: ${p}`,
              output_info: { tool: toolName, path: p }
            };
          }
        }
      }
      return { allowed: true, output_info: { checked: paths.length } };
    },
    enabled: true,
    priority: 10
  },

  /**
   * Block dangerous Bash commands
   */
  bash_dangerous_command_check: {
    name: 'bash_dangerous_command_check',
    description: 'Blocks dangerous shell commands (rm -rf, format, fdisk, etc.)',
    tool_pattern: 'Bash',
    validate_input: async (input, toolName) => {
      if (!input || !input.command) return { allowed: true, output_info: { check: 'skip_no_command' } };
      
      const cmd = String(input.command).toLowerCase();
      const dangerous = [
        'rm -rf /', 'rm -rf /*', 'format c:', 'fdisk',
        'dd if=', 'mkfs', ':(){:|:&};:', 'curl -s|bash',
        'wget -o-|bash', 'eval $(curl', 'eval $(wget'
      ];
      
      for (const d of dangerous) {
        if (cmd.includes(d.toLowerCase())) {
          return {
            allowed: false,
            reason: `Dangerous command blocked: ${d}`,
            output_info: { tool: toolName, command: input.command }
          };
        }
      }
      
      // Check for rm -rf without --no-preserve-root
      if (cmd.includes('rm -rf') && !cmd.includes('--no-preserve-root') && !cmd.includes('-no-preserve')) {
        const match = cmd.match(/rm\s+-rf\s+(\/\w*)/);
        if (match) {
          return {
            allowed: false,
            reason: `rm -rf without --no-preserve-root is dangerous: ${match[1]}`,
            output_info: { tool: toolName, command: input.command }
          };
        }
      }
      
      return { allowed: true, output_info: { checked: true } };
    },
    enabled: true,
    priority: 5
  },

  /**
   * Log all tool executions for audit
   */
  execution_audit_logger: {
    name: 'execution_audit_logger',
    description: 'Logs all tool executions to audit file',
    tool_pattern: '*',
    validate_input: async (input, toolName) => {
      const logPath = join(homedir(), '.openclaw', 'memory', 'tool_audit.jsonl');
      const entry = {
        timestamp: new Date().toISOString(),
        tool: toolName,
        action: 'pre',
        input_preview: typeof input === 'string' ? input.slice(0, 200) : JSON.stringify(input).slice(0, 200)
      };
      
      try {
        const { appendFileSync } = await import('fs');
        appendFileSync(logPath, JSON.stringify(entry) + '\n');
      } catch (e) {
        // Silently fail if log can't be written
      }
      
      return { allowed: true, output_info: { logged: true } };
    },
    validate_output: async (output, toolName) => {
      return { allowed: true, output_info: { tool: toolName } };
    },
    enabled: true,
    priority: 100
  }
};

// ============================================================
// GuardrailStore
// ============================================================

class GuardrailStore {
  constructor() {
    this.custom_guardrails = [];
    this.load();
  }

  load() {
    try {
      if (existsSync(GUARDRAIL_CONFIG_PATH)) {
        const data = readFileSync(GUARDRAIL_CONFIG_PATH, 'utf-8');
        const parsed = JSON.parse(data);
        this.custom_guardrails = parsed.custom_guardrails || [];
      }
    } catch (e) {
      this.custom_guardrails = [];
    }
  }

  save() {
    try {
      const dir = join(homedir(), '.openclaw', 'memory');
      const data = JSON.stringify({ custom_guardrails: this.custom_guardrails }, null, 2);
      writeFileSync(GUARDRAIL_CONFIG_PATH, data, 'utf-8');
    } catch (e) {
      console.error('Failed to save guardrail config:', e.message);
    }
  }

  /**
   * Get all active guardrails sorted by priority
   */
  get_active_guardrails() {
    const all = [
      ...Object.values(BUILT_IN_VALIDATORS).filter(g => g.enabled),
      ...this.custom_guardrails.filter(g => g.enabled)
    ];
    return all.sort((a, b) => a.priority - b.priority);
  }

  /**
   * Add a custom guardrail
   */
  add_guardrail(guardrail) {
    this.custom_guardrails.push({
      ...guardrail,
      enabled: guardrail.enabled !== false
    });
    this.save();
  }

  /**
   * Remove a guardrail by name
   */
  remove_guardrail(name) {
    this.custom_guardrails = this.custom_guardrails.filter(g => g.name !== name);
    this.save();
  }

  /**
   * Enable/disable a guardrail
   */
  set_enabled(name, enabled) {
    const g = this.custom_guardrails.find(g => g.name === name);
    if (g) {
      g.enabled = enabled;
      this.save();
    }
    // Also can toggle built-ins
    if (BUILT_IN_VALIDATORS[name]) {
      BUILT_IN_VALIDATORS[name].enabled = enabled;
    }
  }
}

// Singleton
const store = new GuardrailStore();

// ============================================================
// Main API
// ============================================================

/**
 * Run pre-tool validation
 * @param {string} toolName - Name of the tool being executed
 * @param {any} input - Tool input
 * @returns {Promise<GuardrailResult>}
 */
export async function run_pre_guardrail(toolName, input) {
  const guardrails = store.get_active_guardrails();
  
  for (const g of guardrails) {
    // Check if this guardrail applies to this tool
    if (g.tool_pattern !== '*' && !matchGlob(toolName, g.tool_pattern)) {
      continue;
    }
    
    try {
      const result = await g.validate_input(input, toolName);
      if (!result.allowed) {
        console.error(`[Guardrail] BLOCKED by ${g.name}: ${result.reason}`);
        return {
          allowed: false,
          reason: result.reason,
          guardrail: g.name,
          output_info: result.output_info
        };
      }
    } catch (e) {
      console.error(`[Guardrail] Error in ${g.name}:`, e.message);
      // Continue on validator error
    }
  }
  
  return { allowed: true };
}

/**
 * Run post-tool validation
 * @param {string} toolName - Name of the tool that was executed
 * @param {any} output - Tool output
 * @returns {Promise<GuardrailResult>}
 */
export async function run_post_guardrail(toolName, output) {
  const guardrails = store.get_active_guardrails();
  
  for (const g of guardrails) {
    if (g.tool_pattern !== '*' && !matchGlob(toolName, g.tool_pattern)) {
      continue;
    }
    
    if (!g.validate_output) continue;
    
    try {
      const result = await g.validate_output(output, toolName);
      if (!result.allowed) {
        console.error(`[Guardrail] POST BLOCKED by ${g.name}: ${result.reason}`);
        return {
          allowed: false,
          reason: result.reason,
          guardrail: g.name,
          output_info: result.output_info
        };
      }
    } catch (e) {
      console.error(`[Guardrail] Post-error in ${g.name}:`, e.message);
    }
  }
  
  return { allowed: true };
}

/**
 * Register a custom guardrail
 */
export function register_guardrail(guardrail) {
  store.add_guardrail(guardrail);
}

/**
 * List all active guardrails
 */
export function list_guardrails() {
  return store.get_active_guardrails().map(g => ({
    name: g.name,
    description: g.description,
    tool_pattern: g.tool_pattern,
    enabled: g.enabled,
    priority: g.priority
  }));
}

// ============================================================
// Utilities
// ============================================================

/**
 * Simple glob pattern matching
 * Supports: * (any chars), ? (single char)
 */
function matchGlob(str, pattern) {
  const regex = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${regex}$`, 'i').test(str);
}

export { store, BUILT_IN_VALIDATORS };
