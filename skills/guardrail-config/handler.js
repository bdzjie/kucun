/**
 * guardrail-config skill handler
 * 
 * Manage tool guardrail configurations.
 * 
 * Usage:
 *   /guardrail-config --list
 *   /guardrail-config --status [name]
 *   /guardrail-config --enable [name]
 *   /guardrail-config --disable [name]
 *   /guardrail-config --add [json]
 */

import { readFileSync, existsSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';

const CONFIG_PATH = join(homedir(), '.openclaw', 'memory', 'tool_guardrails_v2.json');

// Built-in guardrails info
const BUILTIN_GUARDRAILS = {
  path_traversal_check: {
    type: 'input',
    description: 'Prevents path traversal attacks (.. or ~ in paths)',
    behavior: 'reject_content',
  },
  bash_dangerous_check: {
    type: 'input', 
    description: 'Detects dangerous bash commands (rm -rf, format, etc)',
    behavior: 'reject_content',
  },
  output_size_check: {
    type: 'output',
    description: 'Limits tool output size to 100KB',
    behavior: 'reject_content',
  },
  sql_injection_check: {
    type: 'input',
    description: 'Detects SQL injection patterns in queries',
    behavior: 'reject_content',
  },
};

function loadConfig() {
  try {
    if (existsSync(CONFIG_PATH)) {
      return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
    }
  } catch (e) {}
  return { enabled: {}, custom: [] };
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

export default async function handler(args) {
  const parts = args.trim().split(/\s+/);
  const flags = parts.filter(p => p.startsWith('--'));
  const positional = parts.filter(p => !p.startsWith('--'));
  
  const config = loadConfig();
  
  // List command
  if (flags.includes('--list') || positional[0] === 'list') {
    const lines = ['=== Tool Guardrail Configuration ===', ''];
    lines.push('Built-in Guardrails:');
    lines.push('');
    
    for (const [name, info] of Object.entries(BUILTIN_GUARDRAILS)) {
      const enabled = config.enabled?.[name] !== false; // Default true
      const status = enabled ? 'ENABLED' : 'DISABLED';
      lines.push(`  [${status}] ${name}`);
      lines.push(`    Type: ${info.type}`);
      lines.push(`    ${info.description}`);
      lines.push(`    Behavior: ${info.behavior}`);
      lines.push('');
    }
    
    if (config.custom && config.custom.length > 0) {
      lines.push('Custom Guardrails:');
      lines.push('');
      for (const g of config.custom) {
        lines.push(`  ${g.name} (${g.type})`);
        lines.push(`    ${g.description || 'No description'}`);
        lines.push('');
      }
    }
    
    lines.push(`Config file: ${CONFIG_PATH}`);
    
    return { output: lines.join('\n') };
  }
  
  // Status command
  if (flags.includes('--status') || positional[0] === 'status') {
    const name = positional[1] || positional[2] || null;
    
    if (!name) {
      return { output: 'Usage: /guardrail-config --status [name]' };
    }
    
    const builtin = BUILTIN_GUARDRAILS[name];
    const custom = config.custom?.find(g => g.name === name);
    const enabled = config.enabled?.[name] !== false;
    
    if (!builtin && !custom) {
      return { output: `Guardrail not found: ${name}` };
    }
    
    const info = builtin || custom;
    const lines = [
      `=== Guardrail: ${name} ===`,
      '',
      `Type: ${info.type}`,
      `Status: ${enabled ? 'ENABLED' : 'DISABLED'}`,
      `Behavior: ${info.behavior || 'allow'}`,
      `Description: ${info.description || 'N/A'}`,
    ];
    
    if (info.keywords) {
      lines.push(`Keywords: ${info.keywords.join(', ')}`);
    }
    
    return { output: lines.join('\n') };
  }
  
  // Enable command
  if (flags.includes('--enable')) {
    const name = positional[1] || positional[2] || null;
    
    if (!name) {
      return { output: 'Usage: /guardrail-config --enable [name]' };
    }
    
    if (!BUILTIN_GUARDRAILS[name] && !config.custom?.find(g => g.name === name)) {
      return { output: `Guardrail not found: ${name}` };
    }
    
    config.enabled = config.enabled || {};
    config.enabled[name] = true;
    saveConfig(config);
    
    return { output: `Guardrail ENABLED: ${name}` };
  }
  
  // Disable command
  if (flags.includes('--disable')) {
    const name = positional[1] || positional[2] || null;
    
    if (!name) {
      return { output: 'Usage: /guardrail-config --disable [name]' };
    }
    
    if (!BUILTIN_GUARDRAILS[name] && !config.custom?.find(g => g.name === name)) {
      return { output: `Guardrail not found: ${name}` };
    }
    
    config.enabled = config.enabled || {};
    config.enabled[name] = false;
    saveConfig(config);
    
    return { output: `Guardrail DISABLED: ${name}` };
  }
  
  // Add command
  if (flags.includes('--add')) {
    const configStr = positional[1] || positional[2] || null;
    
    if (!configStr) {
      return { output: 'Usage: /guardrail-config --add [json]' };
    }
    
    let newConfig;
    try {
      newConfig = JSON.parse(configStr);
    } catch (e) {
      return { output: `Invalid JSON: ${e.message}` };
    }
    
    if (!newConfig.name || !newConfig.type) {
      return { output: 'Required fields: name, type (input/output)' };
    }
    
    config.custom = config.custom || [];
    
    const existing = config.custom.findIndex(g => g.name === newConfig.name);
    if (existing >= 0) {
      config.custom[existing] = { ...config.custom[existing], ...newConfig };
    } else {
      config.custom.push({
        name: newConfig.name,
        type: newConfig.type,
        description: newConfig.description || '',
        behavior: newConfig.behavior || 'allow',
        keywords: newConfig.keywords || [],
        enabled: true,
      });
    }
    
    saveConfig(config);
    
    return { output: `Guardrail added: ${newConfig.name}` };
  }
  
  // Default help
  return {
    output: `Tool Guardrail Configuration Manager

Usage:
  /guardrail-config --list              List all guardrails
  /guardrail-config --status [name]    Show guardrail details
  /guardrail-config --enable [name]     Enable a guardrail
  /guardrail-config --disable [name]    Disable a guardrail
  /guardrail-config --add [json]        Add custom guardrail

Built-in Guardrails:
  path_traversal_check   - Prevents .. path traversal
  bash_dangerous_check   - Detects dangerous commands
  output_size_check     - Limits output to 100KB
  sql_injection_check   - Detects SQL injection

Behaviors:
  allow            - Continue normally
  reject_content   - Replace output with message
  raise_exception  - Halt execution

Config file: ${CONFIG_PATH}`
  };
}
