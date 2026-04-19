/**
 * agent-handoff skill handler
 * 
 * CLI for the agent handoff system.
 * 
 * Usage:
 *   /agent-handoff --list
 *   /agent-handoff --status [name]
 *   /agent-handoff --register [config-json]
 */

import { readFileSync, existsSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';

const CONFIG_PATH = join(homedir(), '.openclaw', 'memory', 'handoffs.json');

function loadHandoffs() {
  try {
    if (existsSync(CONFIG_PATH)) {
      return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
    }
  } catch (e) {}
  return { handoffs: [], history: [] };
}

function saveHandoffs(data) {
  try {
    const dir = dirname(CONFIG_PATH);
    if (!existsSync(dir)) {
      require('fs').mkdirSync(dir, { recursive: true });
    }
    require('fs').writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2));
  } catch (e) {}
}

function registerHandoff(config) {
  const data = loadHandoffs();
  
  // Validate config
  if (!config.toAgent && !config.agentName) {
    return { error: 'Missing required field: toAgent or agentName' };
  }
  
  const name = config.toAgent || config.agentName;
  
  // Check if already exists
  const existing = data.handoffs.find(h => h.agentName === name);
  if (existing) {
    // Update
    Object.assign(existing, {
      description: config.description || existing.description,
      inputFilter: config.inputFilter || 'none',
      nestHistory: config.nestHistory !== undefined ? config.nestHistory : true,
      tools: config.tools || existing.tools,
      updatedAt: Date.now(),
    });
  } else {
    // Add new
    data.handoffs.push({
      agentName: name,
      description: config.description || `Transfer to ${name}`,
      inputFilter: config.inputFilter || 'none',
      nestHistory: config.nestHistory !== undefined ? config.nestHistory : true,
      tools: config.tools || [],
      metadata: config.metadata || {},
      registeredAt: Date.now(),
    });
  }
  
  saveHandoffs(data);
  
  return { success: true, agentName: name };
}

export default async function handler(args) {
  const parts = args.trim().split(/\s+/);
  const flags = parts.filter(p => p.startsWith('--'));
  const positional = parts.filter(p => !p.startsWith('--'));
  
  const data = loadHandoffs();
  
  // List command
  if (flags.includes('--list') || positional[0] === 'list') {
    if (data.handoffs.length === 0) {
      return { output: 'No handoffs registered. Use /agent-handoff --register to add one.' };
    }
    
    const lines = ['=== Registered Handoffs ===', ''];
    for (const h of data.handoffs) {
      lines.push(`Agent: ${h.agentName}`);
      lines.push(`  Description: ${h.description}`);
      lines.push(`  Input Filter: ${h.inputFilter}`);
      lines.push(`  Nest History: ${h.nestHistory ? 'Yes' : 'No'}`);
      lines.push(`  Registered: ${new Date(h.registeredAt).toISOString()}`);
      lines.push('');
    }
    
    lines.push(`Total: ${data.handoffs.length} handoff(s)`);
    
    return { output: lines.join('\n') };
  }
  
  // Status command
  if (flags.includes('--status') || positional[0] === 'status') {
    const name = flags.includes('--status') ? (positional[0] || null) : (positional[1] || null);
    
    if (!name) {
      return { output: 'Usage: /agent-handoff --status [agent-name]' };
    }
    
    const handoff = data.handoffs.find(h => h.agentName === name);
    
    if (!handoff) {
      return { output: `Handoff not found: ${name}` };
    }
    
    // Find recent history for this handoff
    const recent = data.history
      .filter(h => h.to === name)
      .slice(-5);
    
    const lines = [
      `=== Handoff Status: ${name} ===`,
      '',
      `Description: ${handoff.description}`,
      `Input Filter: ${handoff.inputFilter}`,
      `Nest History: ${handoff.nestHistory ? 'Enabled' : 'Disabled'}`,
      `Tools: ${(handoff.tools || []).length > 0 ? handoff.tools.join(', ') : 'None'} `,
      '',
      `Registered: ${new Date(handoff.registeredAt).toISOString()}`,
      `Last Updated: ${new Date(handoff.updatedAt || handoff.registeredAt).toISOString()}`,
    ];
    
    if (recent.length > 0) {
      lines.push('');
      lines.push('Recent Transfers:');
      for (const r of recent) {
        lines.push(`  - ${new Date(r.timestamp).toISOString()} (${r.from || 'initial'} → ${r.to})`);
      }
    }
    
    return { output: lines.join('\n') };
  }
  
  // Register command
  if (flags.includes('--register') || positional[0] === 'register') {
    let config;
    
    // Get config from positional args or next argument
    const configStr = flags.includes('--register') ? (positional[0] || null) : (positional[1] || null);
    
    if (configStr) {
      try {
        config = JSON.parse(configStr);
      } catch (e) {
        return { output: `Invalid JSON: ${e.message}` };
      }
    } else {
      return { output: 'Usage: /agent-handoff --register {"toAgent":"name","description":"..."}' };
    }
    
    const result = registerHandoff(config);
    
    if (result.error) {
      return { output: `Error: ${result.error}` };
    }
    
    return { output: `Handoff registered: ${result.agentName}` };
  }
  
  // History command
  if (flags.includes('--history') || positional[0] === 'history') {
    const limit = parseInt(flags.includes('--history') ? (positional[0] || '10') : (positional[1] || '10'));
    
    const recent = data.history.slice(-limit);
    
    if (recent.length === 0) {
      return { output: 'No handoff history recorded.' };
    }
    
    const lines = ['=== Recent Handoff History ===', ''];
    for (const h of recent.reverse()) {
      lines.push(`${new Date(h.timestamp).toISOString()} ${h.from || 'initial'} → ${h.to}`);
      if (h.completed) {
        lines.push(`  Completed: ${h.completed}`);
      }
      if (h.error) {
        lines.push(`  Error: ${h.error}`);
      }
    }
    
    return { output: lines.join('\n') };
  }
  
  // Default help
  return {
    output: `Agent Handoff System — OpenAI Agents SDK-inspired agent transfer

Usage:
  /agent-handoff --list              List all registered handoffs
  /agent-handoff --status [name]    Show status of a specific handoff
  /agent-handoff --register [json]  Register a new handoff
  /agent-handoff --history [n]      Show recent transfer history

Examples:
  /agent-handoff --list
  
  /agent-handoff --register {"toAgent":"researcher","description":"Transfer to research specialist","nestHistory":true}
  
  /agent-handoff --status researcher

Handoff Config Options:
  toAgent      - Target agent name (required)
  description  - Human-readable description
  inputFilter  - "none" | "summarize" | "context_add"
  nestHistory  - true/false, preserve conversation context
  tools        - Array of tool names to pass to target

Files:
  ~/.openclaw/memory/handoffs.json`
  };
}
