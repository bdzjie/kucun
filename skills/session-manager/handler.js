/**
 * session-manager skill handler
 * 
 * Manage HandoffAwareSession sessions.
 * 
 * Usage:
 *   /session-manager --list
 *   /session-manager --show [session-id]
 *   /session-manager --history [session-id]
 *   /session-manager --snapshot [session-id]
 *   /session-manager --restore [session-id] [snapshot-id]
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const SESSIONS_DIR = join(homedir(), '.openclaw', 'memory', 'sessions');

function listSessions() {
  try {
    if (!existsSync(SESSIONS_DIR)) {
      return [];
    }
    const files = require('fs').readdirSync(SESSIONS_DIR);
    return files
      .filter(f => f.endsWith('.json'))
      .map(f => f.replace('.json', ''));
  } catch (e) {
    return [];
  }
}

function loadSession(sessionId) {
  const path = join(SESSIONS_DIR, `${sessionId}.json`);
  if (!existsSync(path)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch (e) {
    return null;
  }
}

function formatTimestamp(ts) {
  if (!ts) return 'N/A';
  return new Date(ts).toISOString().replace('T', ' ').slice(0, 19);
}

function formatDuration(ms) {
  if (!ms) return '0ms';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

export default async function handler(args) {
  const parts = args.trim().split(/\s+/);
  const flags = parts.filter(p => p.startsWith('--'));
  const positional = parts.filter(p => !p.startsWith('--'));
  
  // List command
  if (flags.includes('--list') || positional[0] === 'list') {
    const sessions = listSessions();
    
    if (sessions.length === 0) {
      return { 
        output: 'No sessions found.\n\nSessions are stored at:\n' + SESSIONS_DIR 
      };
    }
    
    const lines = [
      '=== Session Manager ===',
      '',
      `Sessions (${sessions.length}):`,
      '',
    ];
    
    for (const sessionId of sessions) {
      const data = loadSession(sessionId);
      if (!data) continue;
      
      const itemCount = data.items?.length || 0;
      const handoffCount = data.handoffHistory?.length || 0;
      const lastTime = data.items?.length > 0 
        ? formatTimestamp(data.items[data.items.length - 1].timestamp)
        : 'N/A';
      
      lines.push(`  ${sessionId}`);
      lines.push(`    Items: ${itemCount}, Handoffs: ${handoffCount}`);
      lines.push(`    Last activity: ${lastTime}`);
      lines.push(`    Current agent: ${data.currentAgent || 'root'}`);
      lines.push('');
    }
    
    return { output: lines.join('\n') };
  }
  
  // Show command
  if (flags.includes('--show') || positional[0] === 'show') {
    const sessionId = positional[1] || positional[2] || null;
    
    if (!sessionId) {
      return { output: 'Usage: /session-manager --show [session-id]' };
    }
    
    const data = loadSession(sessionId);
    
    if (!data) {
      return { output: `Session not found: ${sessionId}` };
    }
    
    const lines = [
      `=== Session: ${sessionId} ===`,
      '',
      `Current Agent: ${data.currentAgent || 'root'}`,
      `Items: ${data.items?.length || 0}`,
      `Handoffs: ${data.handoffHistory?.length || 0}`,
      '',
      'Items:',
    ];
    
    const items = (data.items || []).slice(-10);
    for (const item of items) {
      const type = item.type || 'message';
      const role = item.role || '-';
      const content = String(item.content || item.output || '').slice(0, 60);
      const time = formatTimestamp(item.timestamp);
      lines.push(`  [${time}] ${type} (${role}): ${content}...`);
    }
    
    if (data.items?.length > 10) {
      lines.push(`  ... and ${data.items.length - 10} more items`);
    }
    
    return { output: lines.join('\n') };
  }
  
  // History command
  if (flags.includes('--history') || positional[0] === 'history') {
    const sessionId = positional[1] || positional[2] || null;
    
    if (!sessionId) {
      return { output: 'Usage: /session-manager --history [session-id]' };
    }
    
    const data = loadSession(sessionId);
    
    if (!data) {
      return { output: `Session not found: ${sessionId}` };
    }
    
    const history = data.handoffHistory || [];
    
    if (history.length === 0) {
      return { 
        output: `No handoff history for session: ${sessionId}\n\n` +
                'Use /agent-handoff --register to set up handoffs.'
      };
    }
    
    const lines = [
      `=== Handoff History: ${sessionId} ===`,
      '',
      `Total handoffs: ${history.length}`,
      '',
    ];
    
    for (const h of history) {
      lines.push(`  ${h.fromAgent} → ${h.toAgent}`);
      lines.push(`    ID: ${h.id}`);
      lines.push(`    Time: ${formatTimestamp(h.timestamp)}`);
      if (h.metadata?.depth) {
        lines.push(`    Depth: ${h.metadata.depth}`);
      }
      if (h.input) {
        lines.push(`    Input: ${String(h.input).slice(0, 50)}...`);
      }
      lines.push('');
    }
    
    return { output: lines.join('\n') };
  }
  
  // Snapshot command
  if (flags.includes('--snapshot') || positional[0] === 'snapshot') {
    const sessionId = positional[1] || positional[2] || null;
    
    if (!sessionId) {
      return { output: 'Usage: /session-manager --snapshot [session-id]' };
    }
    
    const data = loadSession(sessionId);
    
    if (!data) {
      return { output: `Session not found: ${sessionId}` };
    }
    
    const snapshots = data.metadata?.snapshots || [];
    const newSnapshotId = (snapshots.length > 0 
      ? Math.max(...snapshots.map(s => s.id)) 
      : 0) + 1;
    
    const snapshot = {
      id: newSnapshotId,
      timestamp: Date.now(),
      agent: data.currentAgent,
      itemCount: data.items?.length || 0,
      handoffDepth: data.handoffHistory?.length || 0,
    };
    
    data.metadata = data.metadata || {};
    data.metadata.snapshots = data.metadata.snapshots || [];
    data.metadata.snapshots.push(snapshot);
    
    // Save
    const path = join(SESSIONS_DIR, `${sessionId}.json`);
    require('fs').writeFileSync(path, JSON.stringify(data, null, 2));
    
    return { 
      output: `Snapshot ${newSnapshotId} created for session: ${sessionId}\n\n` +
              `Agent: ${snapshot.agent}\n` +
              `Items: ${snapshot.itemCount}\n` +
              `Handoff depth: ${snapshot.handoffDepth}\n` +
              `Time: ${formatTimestamp(snapshot.timestamp)}`
    };
  }
  
  // Restore command
  if (flags.includes('--restore') || positional[0] === 'restore') {
    const sessionId = positional[1] || positional[2] || null;
    const snapshotId = parseInt(positional[2] || positional[3] || '0');
    
    if (!sessionId || !snapshotId) {
      return { output: 'Usage: /session-manager --restore [session-id] [snapshot-id]' };
    }
    
    const data = loadSession(sessionId);
    
    if (!data) {
      return { output: `Session not found: ${sessionId}` };
    }
    
    const snapshots = data.metadata?.snapshots || [];
    const snapshot = snapshots.find(s => s.id === snapshotId);
    
    if (!snapshot) {
      return { output: `Snapshot not found: ${snapshotId}` };
    }
    
    // For now, just report what would be restored
    // Full implementation would actually restore items/handoffHistory
    
    return { 
      output: `Snapshot ${snapshotId} details:\n\n` +
              `Agent: ${snapshot.agent}\n` +
              `Items: ${snapshot.itemCount}\n` +
              `Handoff depth: ${snapshot.handoffDepth}\n` +
              `Time: ${formatTimestamp(snapshot.timestamp)}\n\n` +
              `Note: Full snapshot restore requires implementation.`
    };
  }
  
  // Default help
  return {
    output: `Session Manager — HandoffAwareSession management

Usage:
  /session-manager --list              List all sessions
  /session-manager --show [id]         Show session details
  /session-manager --history [id]       Show handoff history
  /session-manager --snapshot [id]      Take a snapshot
  /session-manager --restore [id] [s]  Restore from snapshot

Sessions are stored at:
  ${SESSIONS_DIR}

Session Format:
  {
    sessionId: string,
    currentAgent: string,
    items: [...],
    handoffHistory: [...],
    metadata: { snapshots: [...] }
  }

Examples:
  /session-manager --list
  /session-manager --show abc123
  /session-manager --history abc123
  /session-manager --snapshot abc123
  /session-manager --restore abc123 1`
  };
}
