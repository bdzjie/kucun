/**
 * handoff_aware_session.mjs
 * 
 * Inspired by OpenAI Agents SDK Session protocol.
 * Provides a session wrapper that tracks agent handoffs and maintains context.
 * 
 * Features:
 * - Handoff history tracking
 * - Automatic context preservation between agents
 * - Nested handoff detection (prevents infinite loops)
 * - Session state snapshots at each handoff point
 * 
 * Usage:
 *   import { HandoffAwareSession } from './modules';
 *   
 *   const session = new HandoffAwareSession({
 *     sessionId: 'my-session',
 *     maxHandoffDepth: 5,
 *   });
 *   
 *   // Add items
 *   await session.addItems([{ role: 'user', content: 'Hello' }]);
 *   
 *   // Handoff to another agent
 *   await session.handoffTo('researcher', { query: 'research this' });
 *   
 *   // Get items
 *   const items = await session.getItems();
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';

// ============================================================
// Session Item Types
// ============================================================

const ITEM_TYPES = {
  MESSAGE: 'message',
  HANDOFF_OUT: 'handoff_output',
  HANDOFF_IN: 'handoff_input',
  SYSTEM: 'system',
  TOOL_CALL: 'tool_call',
  TOOL_RESULT: 'tool_result',
};

// ============================================================
// Handoff Record
// ============================================================

class HandoffRecord {
  constructor(fromAgent, toAgent, input, metadata = {}) {
    this.id = generateId('handoff');
    this.fromAgent = fromAgent;
    this.toAgent = toAgent;
    this.input = input;
    this.timestamp = Date.now();
    this.metadata = metadata;
  }
}

// ============================================================
// HandoffAwareSession
// ============================================================

export class HandoffAwareSession {
  constructor(options = {}) {
    this.sessionId = options.sessionId || generateId('session');
    this.maxHandoffDepth = options.maxHandoffDepth || 5;
    this.items = [];
    this.handoffHistory = [];
    this.currentAgent = options.initialAgent || 'root';
    this._snapshotId = 0;
    this.metadata = options.metadata || {};
  }

  /**
   * Generate a unique ID
   */
  generateId = generateId;

  /**
   * Add items to the session
   */
  async addItems(newItems) {
    if (!Array.isArray(newItems)) {
      newItems = [newItems];
    }
    
    for (const item of newItems) {
      this.items.push({
        ...item,
        id: item.id || generateId('item'),
        sessionId: this.sessionId,
        timestamp: item.timestamp || Date.now(),
      });
    }
  }

  /**
   * Get all session items
   */
  async getItems(limit = null) {
    if (limit) {
      return this.items.slice(-limit);
    }
    return this.items;
  }

  /**
   * Get items since last handoff
   */
  async getItemsSinceHandoff() {
    const lastHandoffIndex = this.items.findLastIndex(
      item => item.type === ITEM_TYPES.HANDOFF_OUT
    );
    
    if (lastHandoffIndex < 0) {
      return this.items;
    }
    
    return this.items.slice(lastHandoffIndex + 1);
  }

  /**
   * Remove and return the last item
   */
  async popItem() {
    return this.items.pop();
  }

  /**
   * Clear all session items
   */
  async clearSession() {
    const snapshot = this.items.slice();
    this.metadata.lastSnapshot = snapshot;
    this.items = [];
    return snapshot;
  }

  /**
   * Record a handoff to another agent
   */
  async handoffTo(toAgent, input = null, metadata = {}) {
    // Check depth limit
    const currentDepth = this.handoffHistory.length;
    if (currentDepth >= this.maxHandoffDepth) {
      throw new Error(
        `Max handoff depth (${this.maxHandoffDepth}) exceeded. ` +
        `Cannot handoff to ${toAgent}.`
      );
    }

    const record = new HandoffRecord(
      this.currentAgent,
      toAgent,
      input,
      { depth: currentDepth + 1, ...metadata }
    );

    this.handoffHistory.push(record);

    // Add handoff output item
    await this.addItems({
      type: ITEM_TYPES.HANDOFF_OUT,
      fromAgent: record.fromAgent,
      toAgent: record.toAgent,
      transferMessage: `Transferring from ${record.fromAgent} to ${record.toAgent}...`,
      timestamp: record.timestamp,
    });

    // Add handoff input item if provided
    if (input) {
      await this.addItems({
        type: ITEM_TYPES.HANDOFF_IN,
        agent: toAgent,
        content: input.content || input,
        timestamp: Date.now(),
      });
    }

    // Update current agent
    this.currentAgent = toAgent;

    return record;
  }

  /**
   * Get handoff history
   */
  async getHandoffHistory() {
    return this.handoffHistory;
  }

  /**
   * Take a snapshot of current state
   */
  async snapshot() {
    this._snapshotId++;
    const snapshot = {
      id: this._snapshotId,
      timestamp: Date.now(),
      agent: this.currentAgent,
      itemCount: this.items.length,
      handoffDepth: this.handoffHistory.length,
      items: this.items.slice(),
      handoffHistory: this.handoffHistory.slice(),
    };
    
    this.metadata.snapshots = this.metadata.snapshots || [];
    this.metadata.snapshots.push(snapshot);
    
    return snapshot;
  }

  /**
   * Restore from a snapshot
   */
  async restore(snapshotId) {
    const snapshots = this.metadata.snapshots || [];
    const snapshot = snapshots.find(s => s.id === snapshotId);
    
    if (!snapshot) {
      throw new Error(`Snapshot not found: ${snapshotId}`);
    }
    
    this.items = snapshot.items;
    this.handoffHistory = snapshot.handoffHistory;
    this.currentAgent = snapshot.agent;
    
    return snapshot;
  }

  /**
   * Get session summary
   */
  async getSummary() {
    const messageCount = this.items.filter(i => i.type === ITEM_TYPES.MESSAGE).length;
    const toolCallCount = this.items.filter(i => i.type === ITEM_TYPES.TOOL_CALL).length;
    const handoffCount = this.handoffHistory.length;

    return {
      sessionId: this.sessionId,
      currentAgent: this.currentAgent,
      itemCount: this.items.length,
      messageCount,
      toolCallCount,
      handoffCount,
      handoffDepth: this.handoffHistory.length,
      firstItemTime: this.items[0]?.timestamp,
      lastItemTime: this.items[this.items.length - 1]?.timestamp,
    };
  }

  /**
   * Export session to JSON
   */
  toJSON() {
    return {
      sessionId: this.sessionId,
      currentAgent: this.currentAgent,
      items: this.items,
      handoffHistory: this.handoffHistory,
      metadata: this.metadata,
    };
  }

  /**
   * Create from JSON
   */
  static fromJSON(json) {
    const session = new HandoffAwareSession({
      sessionId: json.sessionId,
    });
    session.items = json.items || [];
    session.handoffHistory = json.handoffHistory || [];
    session.currentAgent = json.currentAgent || 'root';
    session.metadata = json.metadata || {};
    return session;
  }
}

// ============================================================
// Session Manager
// ============================================================

const SESSIONS_DIR = join(homedir(), '.openclaw', 'memory', 'sessions');

export class SessionManager {
  constructor() {
    this.sessions = new Map();
    this._ensureDir();
  }

  _ensureDir() {
    if (!existsSync(SESSIONS_DIR)) {
      mkdirSync(SESSIONS_DIR, { recursive: true });
    }
  }

  _sessionPath(sessionId) {
    return join(SESSIONS_DIR, `${sessionId}.json`);
  }

  /**
   * Create or get a session
   */
  getOrCreate(sessionId, options = {}) {
    if (this.sessions.has(sessionId)) {
      return this.sessions.get(sessionId);
    }
    
    // Try to load from disk
    const path = this._sessionPath(sessionId);
    if (existsSync(path)) {
      try {
        const data = JSON.parse(readFileSync(path, 'utf-8'));
        const session = HandoffAwareSession.fromJSON(data);
        this.sessions.set(sessionId, session);
        return session;
      } catch (e) {
        // Failed to load, create new
      }
    }
    
    const session = new HandoffAwareSession({
      sessionId,
      ...options,
    });
    this.sessions.set(sessionId, session);
    return session;
  }

  /**
   * Save a session to disk
   */
  async save(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    
    const path = this._sessionPath(sessionId);
    writeFileSync(path, JSON.stringify(session.toJSON(), null, 2));
  }

  /**
   * List all sessions
   */
  async list() {
    const files = require('fs').readdirSync(SESSIONS_DIR);
    return files
      .filter(f => f.endsWith('.json'))
      .map(f => f.replace('.json', ''));
  }

  /**
   * Delete a session
   */
  async delete(sessionId) {
    this.sessions.delete(sessionId);
    const path = this._sessionPath(sessionId);
    if (existsSync(path)) {
      require('fs').unlinkSync(path);
    }
  }
}

// Singleton
let _sessionManager = null;

export function getSessionManager() {
  if (!_sessionManager) {
    _sessionManager = new SessionManager();
  }
  return _sessionManager;
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

export { ITEM_TYPES, HandoffRecord };
