/**
 * modules/agent/feed.ts
 * ========================
 * Agent Collaboration Feed — inspired by OpenMetadata Feed/Thread Pattern
 *
 * Enables multi-agent coordination through messages, task assignments,
 * and event broadcasts. Agents communicate through a shared feed rather
 * than direct function calls, enabling loose coupling and audit trails.
 *
 * Use cases:
 *   - Agent A assigns a task to Agent B via a message
 *   - When a memory is updated, broadcast to all interested agents
 *   - Track conversation threads between human and agents
 *   - Handoff: Agent A passes context to Agent B cleanly
 *
 * Architecture:
 *   Feed → Threads → Messages
 *   Events are emitted for subscription by agents
 */

import { EventEmitter } from 'events';
import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';

// ============================================================================
// Types
// ============================================================================

export type AgentRef = string;  // e.g. "expert_router", "invest_skill", "memory_agent"
export type MessageType = 'request' | 'response' | 'handoff' | 'alert' | 'notification' | 'thread_reply';
export type ThreadType = 'task' | 'context' | 'alert' | 'general';

export interface AgentMessage {
  id: string;                  // Unique message ID: "msg_${timestamp}_${seq}"
  from: AgentRef;
  to: AgentRef | 'broadcast';
  type: MessageType;
  subject?: string;            // Short subject line
  content: string;              // Message body (Markdown supported)
  contextRefs?: string[];      // Referenced entity IDs (memory/session/tool)
  threadId?: string;           // Parent thread ID
  replyTo?: string;            // Parent message ID (for threading)
  priority?: 'low' | 'normal' | 'high' | 'urgent';
  status?: 'pending' | 'read' | 'acknowledged' | 'resolved';
  createdAt: string;          // ISO timestamp
  readAt?: string;
  resolvedAt?: string;
  expiresAt?: string;          // Optional TTL
  metadata?: Record<string, unknown>;
}

export interface Thread {
  id: string;                  // "thr_${timestamp}_${seq}"
  type: ThreadType;
  subject: string;
  participants: AgentRef[];
  createdAt: string;
  lastActivity: string;
  isOpen: boolean;
  messageCount: number;
  tags?: string[];
}

export interface FeedEvent {
  type: 'message_sent' | 'message_read' | 'message_resolved' | 'thread_created' | 'thread_closed' | 'task_assigned';
  payload: Record<string, unknown>;
  timestamp: string;
}

export interface TaskAssignment {
  id: string;
  threadId: string;
  from: AgentRef;
  to: AgentRef;
  description: string;
  status: 'pending' | 'in_progress' | 'done' | 'cancelled';
  createdAt: string;
  deadline?: string;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  result?: string;
  resolvedAt?: string;
}

// ============================================================================
// Feed Store (append-only log)
// ============================================================================

const FEED_DIR = join(homedir(), '.openclaw', 'memory', 'agent_feed');
const FEED_FILE = join(FEED_DIR, 'feed.jsonl');
const THREAD_FILE = join(FEED_DIR, 'threads.jsonl');

function ensureFeedDir(): void {
  if (!existsSync(FEED_DIR)) {
    mkdirSync(FEED_DIR, { recursive: true });
  }
}

// ============================================================================
// Feed Core
// ============================================================================

export class AgentFeed extends EventEmitter {
  private messages: Map<string, AgentMessage> = new Map();
  private threads: Map<string, Thread> = new Map();
  private subscriptions: Map<AgentRef, Set<string>> = new Map();  // agent → Set<event types>
  private sequence = 0;

  constructor() {
    super();
    this._load();
  }

  // ─── Messaging ────────────────────────────────────────────────────────────

  /**
   * Send a message from one agent to another (or broadcast).
   */
  send(msg: Omit<AgentMessage, 'id' | 'createdAt' | 'status'>): AgentMessage {
    ensureFeedDir();
    const id = `msg_${Date.now()}_${++this.sequence}`;
    const now = new Date().toISOString();

    const full: AgentMessage = {
      id,
      createdAt: now,
      status: 'pending',
      ...msg,
    };

    this.messages.set(id, full);
    this._appendLog({ op: 'add_message', message: full });

    // Update thread
    if (full.threadId) {
      this._updateThreadActivity(full.threadId);
    }

    // Emit event
    this.emit('message_sent', full);
    this.emit(full.type, full);  // Also emit type-specific event

    // Emit to recipient if subscribed
    if (full.to !== 'broadcast') {
      this.emit(`to:${full.to}`, full);
    } else {
      this.emit('broadcast', full);
    }

    return full;
  }

  /**
   * Reply to a specific message (creates threaded conversation).
   */
  reply(
    parentId: string,
    from: AgentRef,
    content: string,
    type: MessageType = 'thread_reply'
  ): AgentMessage | null {
    const parent = this.messages.get(parentId);
    if (!parent) {
      console.warn(`[AgentFeed] Reply to unknown message: ${parentId}`);
      return null;
    }

    const threadId = parent.threadId || parentId;  // Use parent's thread or create one
    return this.send({
      from,
      to: parent.from,
      type,
      content,
      subject: `Re: ${parent.subject || '(no subject)'}`,
      threadId,
      replyTo: parentId,
    });
  }

  /**
   * Assign a task to an agent.
   */
  assignTask(assignment: Omit<TaskAssignment, 'id' | 'createdAt' | 'status'>): TaskAssignment {
    const id = `task_${Date.now()}_${++this.sequence}`;
    const now = new Date().toISOString();

    const task: TaskAssignment = {
      id,
      status: 'pending',
      createdAt: now,
      ...assignment,
    };

    // Create a task thread if needed
    let threadId = assignment.threadId;
    if (!threadId) {
      const thread = this.createThread({
        type: 'task',
        subject: `Task: ${assignment.description.substring(0, 50)}`,
        participants: [assignment.from, assignment.to],
      });
      threadId = thread.id;
    }

    // Send notification message
    this.send({
      from: assignment.from,
      to: assignment.to,
      type: 'request',
      subject: `Task assigned: ${assignment.description.substring(0, 40)}`,
      content: assignment.description,
      threadId,
      priority: assignment.priority,
    });

    this.emit('task_assigned', task);
    return task;
  }

  /**
   * Mark a message as read.
   */
  markRead(messageId: string, reader: AgentRef): boolean {
    const msg = this.messages.get(messageId);
    if (!msg) return false;
    if (msg.to !== reader && msg.to !== 'broadcast') return false;

    msg.status = 'read';
    msg.readAt = new Date().toISOString();
    this.emit('message_read', { messageId, reader, readAt: msg.readAt });
    return true;
  }

  /**
   * Resolve a message (mark as resolved + optionally add result).
   */
  resolve(messageId: string, result?: string): boolean {
    const msg = this.messages.get(messageId);
    if (!msg) return false;

    msg.status = 'resolved';
    msg.resolvedAt = new Date().toISOString();
    if (result) {
      msg.content += `\n\n---\n**Resolution:** ${result}`;
    }

    this.emit('message_resolved', { messageId, result });
    return true;
  }

  // ─── Threads ───────────────────────────────────────────────────────────────

  /**
   * Create a new thread.
   */
  createThread(thread: Omit<Thread, 'id' | 'createdAt' | 'lastActivity' | 'messageCount' | 'isOpen'>): Thread {
    ensureFeedDir();
    const id = `thr_${Date.now()}_${++this.sequence}`;
    const now = new Date().toISOString();

    const full: Thread = {
      id,
      messageCount: 0,
      isOpen: true,
      lastActivity: now,
      createdAt: now,
      ...thread,
    };

    this.threads.set(id, full);
    this._appendThreadLog({ op: 'add_thread', thread: full });
    this.emit('thread_created', full);
    return full;
  }

  /**
   * Get a thread with its messages.
   */
  getThread(threadId: string): { thread: Thread; messages: AgentMessage[] } | null {
    const thread = this.threads.get(threadId);
    if (!thread) return null;

    const messages = Array.from(this.messages.values())
      .filter(m => m.threadId === threadId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    return { thread, messages };
  }

  /**
   * Close a thread.
   */
  closeThread(threadId: string): boolean {
    const thread = this.threads.get(threadId);
    if (!thread) return false;

    thread.isOpen = false;
    thread.lastActivity = new Date().toISOString();
    this.emit('thread_closed', thread);
    return true;
  }

  /**
   * Get threads for a specific agent.
   */
  getThreadsForAgent(agent: AgentRef, includeClosed = false): Thread[] {
    return Array.from(this.threads.values())
      .filter(t => t.participants.includes(agent) && (includeClosed || t.isOpen))
      .sort((a, b) => b.lastActivity.localeCompare(a.lastActivity));
  }

  // ─── Queries ───────────────────────────────────────────────────────────────

  /**
   * Get messages for an agent (received or broadcast).
   */
  getMessagesForAgent(agent: AgentRef, options?: {
    type?: MessageType;
    status?: AgentMessage['status'];
    since?: string;
    limit?: number;
  }): AgentMessage[] {
    let msgs = Array.from(this.messages.values())
      .filter(m => m.to === agent || m.to === 'broadcast')
      .filter(m => !options?.type || m.type === options.type)
      .filter(m => !options?.status || m.status === options.status)
      .filter(m => !options?.since || m.createdAt >= options.since);

    msgs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    if (options?.limit) {
      msgs = msgs.slice(0, options.limit);
    }

    return msgs;
  }

  /**
   * Get pending tasks for an agent.
   */
  getPendingTasks(agent: AgentRef): AgentMessage[] {
    return this.getMessagesForAgent(agent, { type: 'request', status: 'pending' });
  }

  /**
   * Get all unread messages for an agent.
   */
  getUnread(agent: AgentRef): AgentMessage[] {
    return this.getMessagesForAgent(agent, { status: 'pending' });
  }

  /**
   * Broadcast an alert to all agents.
   */
  alert(from: AgentRef, subject: string, content: string, priority: AgentMessage['priority'] = 'high'): AgentMessage {
    return this.send({
      from,
      to: 'broadcast',
      type: 'alert',
      subject,
      content,
      priority,
    });
  }

  /**
   * Get feed summary/stats.
   */
  getStats(): {
    totalMessages: number;
    totalThreads: number;
    openThreads: number;
    pendingForAgent: Record<AgentRef, number>;
    recentActivity: AgentMessage[];
  } {
    const pendingForAgent: Record<string, number> = {};
    for (const msg of this.messages.values()) {
      if (msg.status === 'pending' && msg.to !== 'broadcast') {
        pendingForAgent[msg.to] = (pendingForAgent[msg.to] || 0) + 1;
      }
    }

    const openThreads = Array.from(this.threads.values()).filter(t => t.isOpen).length;
    const recentActivity = Array.from(this.messages.values())
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 10);

    return {
      totalMessages: this.messages.size,
      totalThreads: this.threads.size,
      openThreads,
      pendingForAgent,
      recentActivity,
    };
  }

  // ─── Persistence ──────────────────────────────────────────────────────────

  private _load(): void {
    ensureFeedDir();

    try {
      if (existsSync(FEED_FILE)) {
        const lines = readFileSync(FEED_FILE, 'utf-8').trim().split('\n').filter(Boolean);
        for (const line of lines) {
          try {
            const record = JSON.parse(line);
            if (record.op === 'add_message') {
              this.messages.set(record.message.id, record.message);
            }
          } catch (_) { /* skip corrupt lines */ }
        }
      }

      if (existsSync(THREAD_FILE)) {
        const lines = readFileSync(THREAD_FILE, 'utf-8').trim().split('\n').filter(Boolean);
        for (const line of lines) {
          try {
            const record = JSON.parse(line);
            if (record.op === 'add_thread') {
              this.threads.set(record.thread.id, record.thread);
            }
          } catch (_) { /* skip corrupt lines */ }
        }
      }
    } catch (_) {
      // Start fresh on errors
    }
  }

  private _appendLog(entry: { op: string; message?: AgentMessage }): void {
    try {
      ensureFeedDir();
      appendFileSync(FEED_FILE, JSON.stringify(entry) + '\n', 'utf-8');
    } catch (_) { /* ignore write errors */ }
  }

  private _appendThreadLog(entry: { op: string; thread?: Thread }): void {
    try {
      ensureFeedDir();
      appendFileSync(THREAD_FILE, JSON.stringify(entry) + '\n', 'utf-8');
    } catch (_) { /* ignore write errors */ }
  }

  private _updateThreadActivity(threadId: string): void {
    const thread = this.threads.get(threadId);
    if (thread) {
      thread.lastActivity = new Date().toISOString();
      thread.messageCount++;
    }
  }
}

// ============================================================================
// Singleton
// ============================================================================

let _feed: AgentFeed | null = null;

export function getAgentFeed(): AgentFeed {
  if (!_feed) {
    _feed = new AgentFeed();
  }
  return _feed;
}

export default { AgentFeed, getAgentFeed };
