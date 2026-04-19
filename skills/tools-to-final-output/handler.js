/**
 * tools-to-final-output skill handler
 * 
 * Implements ToolsToFinalOutput pattern from OpenAI Agents SDK.
 * Registers tools as "final output" - when they return,
 * the agent loop terminates.
 * 
 * Usage:
 *   /tools-to-final-output --register [tool-name]
 *   /tools-to-final-output --list
 *   /tools-to-final-output --unregister [tool-name]
 *   /tools-to-final-output --test [tool-name] [input]
 */

import { readFileSync, existsSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';

const CONFIG_PATH = join(homedir(), '.openclaw', 'memory', 'final_output_tools.json');

function loadConfig() {
  try {
    if (existsSync(CONFIG_PATH)) {
      return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
    }
  } catch (e) {}
  return { tools: [], history: [] };
}

function saveConfig(config) {
  try {
    const dir = dirname(CONFIG_PATH);
    if (!existsSync(dir)) {
      require('fs').mkdirSync(dir, { recursive: true });
    }
    writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  } catch (e) {}
}

/**
 * Mark a tool result as final output
 */
export function markAsFinalOutput(toolName, result) {
  return {
    output: result,
    is_final_output: true,
    toolName,
    _meta: {
      finalizedAt: Date.now(),
      pattern: 'ToolsToFinalOutput',
    }
  };
}

/**
 * Check if a tool is registered as final output
 */
export function isFinalOutputTool(toolName) {
  const config = loadConfig();
  return config.tools.includes(toolName);
}

/**
 * Wrapper for skill handlers - automatically marks as final if registered
 */
export function wrapHandler(toolName, handler) {
  return async function(...args) {
    const result = await handler.apply(this, args);
    
    if (isFinalOutputTool(toolName) && !result.is_final_output) {
      return markAsFinalOutput(toolName, result.output || result);
    }
    
    return result;
  };
}

export default async function handler(args) {
  const parts = args.trim().split(/\s+/);
  const flags = parts.filter(p => p.startsWith('--'));
  const positional = parts.filter(p => !p.startsWith('--'));
  
  const config = loadConfig();
  
  // List command
  if (flags.includes('--list') || positional[0] === 'list') {
    if (config.tools.length === 0) {
      return { 
        output: 'No tools registered as final output.\n\n' +
                'Use /tools-to-final-output --register [tool-name] to add one.\n' +
                '\nThis pattern signals the agent loop to terminate after this tool executes.' 
      };
    }
    
    const lines = [
      '=== ToolsToFinalOutput Registry ===',
      '',
      `Registered tools (${config.tools.length}):`,
      '',
    ];
    
    for (const tool of config.tools) {
      const info = config.toolsInfo?.[tool] || {};
      lines.push(`  ${tool}`);
      if (info.description) {
        lines.push(`    ${info.description}`);
      }
      if (info.registeredAt) {
        lines.push(`    Registered: ${new Date(info.registeredAt).toISOString()}`);
      }
      lines.push('');
    }
    
    if (config.history && config.history.length > 0) {
      lines.push(`Recent final outputs (${config.history.length}):`);
      for (const h of config.history.slice(-5).reverse()) {
        lines.push(`  ${h.tool} → ${new Date(h.timestamp).toISOString()}`);
      }
    }
    
    return { output: lines.join('\n') };
  }
  
  // Register command
  if (flags.includes('--register') || positional[0] === 'register') {
    const toolName = positional[1] || positional[2] || null;
    
    if (!toolName) {
      return { output: 'Usage: /tools-to-final-output --register [tool-name]' };
    }
    
    if (!config.tools.includes(toolName)) {
      config.tools.push(toolName);
      config.toolsInfo = config.toolsInfo || {};
      config.toolsInfo[toolName] = {
        registeredAt: Date.now(),
        description: positional[3] || '',
      };
      saveConfig(config);
    }
    
    return { 
      output: `Tool registered as final output: ${toolName}\n` +
              'When this tool returns, the agent loop will terminate.'
    };
  }
  
  // Unregister command
  if (flags.includes('--unregister') || positional[0] === 'unregister') {
    const toolName = positional[1] || positional[2] || null;
    
    if (!toolName) {
      return { output: 'Usage: /tools-to-final-output --unregister [tool-name]' };
    }
    
    const idx = config.tools.indexOf(toolName);
    if (idx >= 0) {
      config.tools.splice(idx, 1);
      saveConfig(config);
      return { output: `Tool unregistered: ${toolName}` };
    }
    
    return { output: `Tool not found: ${toolName}` };
  }
  
  // Test command
  if (flags.includes('--test') || positional[0] === 'test') {
    const toolName = positional[1] || positional[2] || null;
    const input = positional[3] || positional[4] || '';
    
    if (!toolName) {
      return { output: 'Usage: /tools-to-final-output --test [tool-name] [input]' };
    }
    
    const isRegistered = config.tools.includes(toolName);
    
    const lines = [
      `=== ToolsToFinalOutput Test ===`,
      '',
      `Tool: ${toolName}`,
      `Registered: ${isRegistered ? 'YES' : 'NO'}`,
      `Input: "${input}"`,
      '',
    ];
    
    if (isRegistered) {
      lines.push('Result would be marked as FINAL OUTPUT');
      lines.push('');
      lines.push('Return structure:');
      lines.push('  {');
      lines.push('    output: "...",');
      lines.push('    is_final_output: true,');
      lines.push('    toolName: "' + toolName + '",');
      lines.push('    _meta: { finalizedAt: <timestamp> }');
      lines.push('  }');
    } else {
      lines.push('Result would be returned normally');
    }
    
    return { output: lines.join('\n') };
  }
  
  // Default help
  return {
    output: `ToolsToFinalOutput Pattern Manager

Inspired by OpenAI Agents SDK ToolsToFinalOutputResult.
Registers tools that signal the agent loop to terminate.

Usage:
  /tools-to-final-output --register [name]  Register a tool as final output
  /tools-to-final-output --list             List registered tools
  /tools-to-final-output --unregister [n]  Unregister a tool
  /tools-to-final-output --test [n] [in]    Test the pattern

Examples:
  /tools-to-final-output --register calculator
  /tools-to-final-output --list
  /tools-to-final-output --unregister calculator
  /tools-to-final-output --test calculator "2+2"

How it works:
  1. Register a skill as final output
  2. When that skill returns, include is_final_output=true
  3. The agent loop terminates after that tool

Use cases:
  - Calculator tools (definitive answer)
  - Lookup tools (no more reasoning)
  - Any tool that definitively answers

Config: ${CONFIG_PATH}`
  };
}
