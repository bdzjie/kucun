/**
 * session-compactor skill handler
 * 
 * CLI interface to the session compaction protocol.
 * 
 * Usage:
 *   /session-compactor [session-id] [--mode auto|aggressive|conservative|summary]
 *   /session-compactor --list
 *   /session-compactor --stats [session-id]
 */

import { readFileSync, existsSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Import the compaction module
async function getCompactor() {
  const paths = [
    join(process.cwd(), 'modules', 'session_compaction_protocol.mjs'),
    join(homedir(), '.openclaw', 'workspace', 'modules', 'session_compaction_protocol.mjs')
  ];
  
  for (const p of paths) {
    if (existsSync(p)) {
      const mod = await import(p);
      return mod;
    }
  }
  
  throw new Error('session_compaction_protocol.mjs not found');
}

function getSessionsDir() {
  return join(homedir(), '.openclaw', 'memory', 'sessions');
}

function estimateTokens(text) {
  return Math.ceil((text?.length || 0) / 4);
}

function estimateSessionTokens(items) {
  return items.reduce((sum, item) => {
    return sum + estimateTokens(item.content) + 10;
  }, 0);
}

async function loadSessionItems(sessionId) {
  const path = join(getSessionsDir(), `${sessionId}.jsonl`);
  if (!existsSync(path)) return [];
  
  try {
    const data = readFileSync(path, 'utf-8');
    const lines = data.split('\n').filter(l => l.trim());
    return lines.map(l => {
      try {
        const obj = JSON.parse(l);
        if (obj.message) {
          return {
            id: obj.id || `msg_${Date.now()}`,
            role: obj.message.role,
            content: obj.message.content,
            timestamp: obj.timestamp || Date.now(),
            metadata: obj.metadata
          };
        }
        return obj;
      } catch {
        return null;
      }
    }).filter(Boolean);
  } catch (e) {
    return [];
  }
}

async function listSessions() {
  const dir = getSessionsDir();
  if (!existsSync(dir)) return [];
  
  try {
    const files = readdirSync(dir).filter(f => f.endsWith('.jsonl'));
    return files.map(f => f.replace('.jsonl', ''));
  } catch {
    return [];
  }
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function formatAge(timestamp) {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export default async function handler(args) {
  const parts = args.trim().split(/\s+/);
  const flags = parts.filter(p => p.startsWith('--'));
  const positional = parts.filter(p => !p.startsWith('--'));
  
  const mode = flags.includes('--aggressive') ? 'aggressive' :
               flags.includes('--conservative') ? 'conservative' :
               flags.includes('--summary') ? 'summary' :
               flags.includes('--auto') ? 'auto' : 'auto';
  
  const dryRun = flags.includes('--dry-run');
  const listMode = flags.includes('--list') || flags.includes('--stats');
  const help = flags.includes('--help');
  
  if (help || positional.includes('help')) {
    return {
      output: `Session Compactor - Token-aware session memory compression

Usage:
  /session-compactor [session-id] [options]
  /session-compactor --list
  /session-compactor --stats [session-id]

Options:
  --auto         Use automatic mode (default)
  --aggressive   Keep only system + last 5 messages
  --conservative Keep first 10, compress middle, keep last 10
  --summary      Replace groups of messages with summaries
  --dry-run      Preview compaction without applying
  --list         List all sessions
  --stats        Show token stats for sessions

Examples:
  /session-compactor                     # Compact default session
  /session-compactor my-project         # Compact specific session
  /session-compactor --mode aggressive  # Aggressive compaction
  /session-compactor --list             # List all sessions
`
    };
  }
  
  // List mode
  if (listMode) {
    const sessions = await listSessions();
    const sessionId = positional[1];
    
    if (sessionId) {
      const items = await loadSessionItems(sessionId);
      const tokens = estimateSessionTokens(items);
      const path = join(getSessionsDir(), `${sessionId}.jsonl`);
      
      let size = 0;
      try {
        size = require('fs').statSync(path).size;
      } catch {}
      
      return {
        output: `Session: ${sessionId}

Messages: ${items.length}
Tokens: ~${tokens.toLocaleString()}
Size: ${formatBytes(size)}
Latest: ${items.length > 0 ? formatAge(items[items.length - 1].timestamp) : 'none'}

Role breakdown:
${['user', 'assistant', 'system', 'tool'].map(role => {
  const count = items.filter(i => i.role === role).length;
  return `  ${role}: ${count}`;
}).join('\n')}`
      };
    }
    
    // List all sessions
    const results = [];
    for (const sid of sessions.slice(0, 20)) {
      const items = await loadSessionItems(sid);
      const tokens = estimateSessionTokens(items);
      const latest = items.length > 0 ? formatAge(items[items.length - 1].timestamp) : '-';
      results.push({ id: sid, messages: items.length, tokens, latest });
    }
    
    results.sort((a, b) => b.tokens - a.tokens);
    
    const table = results.map(r => 
      `  ${r.id.padEnd(40)} ${String(r.messages).padStart(4)} msg  ~${String(r.tokens).padStart(6)} tok  ${r.latest}`
    ).join('\n');
    
    return {
      output: `Sessions (sorted by token count):

${table || '  No sessions found.'}

Total: ${sessions.length} sessions`
    };
  }
  
  // Compaction
  const sessionId = positional[1] || 'default';
  const compactorMod = await getCompactor();
  const compactor = new compactorMod.SessionCompactor();
  
  const items = await loadSessionItems(sessionId);
  const beforeTokens = estimateSessionTokens(items);
  
  if (dryRun) {
    const recommended = compactor.getRecommendedMode(items);
    return {
      output: `[DRY RUN] Session: ${sessionId}

Current state:
  Messages: ${items.length}
  Tokens: ~${beforeTokens.toLocaleString()}

Would compact with mode: ${recommended}
Threshold: ${compactor.tokenThreshold.toLocaleString()} tokens`
    };
  }
  
  const result = await compactor.compact(sessionId, mode);
  
  const afterItems = await loadSessionItems(sessionId);
  const afterTokens = estimateSessionTokens(afterItems);
  
  return {
    output: `Session Compaction Complete

Session: ${sessionId}
Mode: ${flags.length > 1 ? mode : `auto → ${result.strategy}`}

Before: ${result.original_count} messages, ~${beforeTokens.toLocaleString()} tokens
After:  ${result.compacted_count} messages, ~${afterTokens.toLocaleString()} tokens
Saved:  ~${result.tokens_saved.toLocaleString()} tokens (${Math.round(result.tokens_saved / beforeTokens * 100)}%)`
  };
}
