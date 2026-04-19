/**
 * agent_handoff.mjs
 * 
 * Inspired by OpenAI Agents SDK handoff system.
 * Provides agent-to-agent transfer with input filtering and history nesting.
 * 
 * Handoff Flow:
 *   Agent A runs → requests handoff to Agent B
 *   → HandoffInputFilter transforms input (optional)
 *   → nest_handoff_history preserves context (optional)
 *   → Agent B receives transformed input
 * 
 * Usage:
 *   import { createHandoff, createHandoffRouter } from './modules';
 *   
 *   const handoff = createHandoff({
 *     toAgent: 'researcher',
 *     description: 'Transfer to research specialist',
 *     inputFilter: (input) => ({ ...input, mode: 'research' }),
 *   });
 */

import { createSecureRandomHex } from 'crypto';

// ============================================================
// Types
// ============================================================

/**
 * @typedef {Object} HandoffInput
 * @property {string} content - The input content
 * @property {Array} items - Conversation items
 */

/**
 * @typedef {Object} HandoffResult
 * @property {string} toAgent - Target agent name
 * @property {string} transferMessage - Message for the user
 * @property {HandoffInput} input - Transformed input
 */

// ============================================================
// Handoff Class
// ============================================================

export class Handoff {
  constructor(options = {}) {
    this.agentName = options.toAgent || options.agentName || 'unknown';
    this.description = options.description || `Transfer to ${this.agentName}`;
    this.inputFilter = options.inputFilter || null;
    this.nestHistory = options.nestHistory !== undefined ? options.nestHistory : true;
    this.onInvoke = options.onInvoke || null;
    this.tools = options.tools || [];
    this.metadata = options.metadata || {};
  }

  /**
   * Create a handoff from a plain object
   */
  static from(obj) {
    return new Handoff(obj);
  }

  /**
   * Get the transfer message shown to the user
   */
  getTransferMessage(targetAgent) {
    return `Handing off to ${targetAgent || this.agentName}...`;
  }

  /**
   * Invoke the handoff - determine the target agent
   */
  async onInvokeHandoff(context, toolCallArguments) {
    if (this.onInvoke) {
      return await this.onInvoke(context, toolCallArguments);
    }
    // Return the default agent
    return { name: this.agentName, agent: null };
  }

  /**
   * Apply input filter if present
   */
  async applyInputFilter(input, context) {
    if (this.inputFilter) {
      return await this.inputFilter(input, context);
    }
    return input;
  }
}

// ============================================================
// Handoff Router - manages multiple handoffs
// ============================================================

export class HandoffRouter {
  constructor() {
    this.handoffs = new Map();
    this._registerDefaultHandoffs();
  }

  _registerDefaultHandoffs() {
    // Default handoff registry
  }

  /**
   * Register a handoff
   */
  register(handoff) {
    const name = handoff.agentName;
    this.handoffs.set(name, handoff);
    return this;
  }

  /**
   * Register multiple handoffs
   */
  registerAll(handoffs) {
    for (const h of handoffs) {
      this.register(handoff);
    }
    return this;
  }

  /**
   * Get a handoff by name
   */
  get(name) {
    return this.handoffs.get(name);
  }

  /**
   * List all registered handoffs
   */
  list() {
    return Array.from(this.handoffs.values());
  }

  /**
   * Find handoff by agent name
   */
  findByAgent(agentName) {
    return this.handoffs.get(agentName);
  }
}

// ============================================================
// Handoff Input Filter
// ============================================================

/**
 * Create an input filter that adds context
 */
export function addContextFilter(context additions) {
  return async (input) => {
    return {
      ...input,
      metadata: {
        ...(input.metadata || {}),
        ...additions,
        handoffTimestamp: Date.now(),
      }
    };
  };
}

/**
 * Create an input filter that preserves message history
 */
export function preserveHistoryFilter(options = {}) {
  const maxItems = options.maxItems || 50;
  
  return async (input) => {
    if (!input.items) return input;
    
    return {
      ...input,
      items: input.items.slice(-maxItems),
      metadata: {
        ...(input.metadata || {}),
        historyPreserved: true,
        originalItemCount: input.items.length,
      }
    };
  };
}

/**
 * Create an input filter that summarizes long history
 */
export function summarizeHistoryFilter(analyzer) {
  return async (input) => {
    if (!input.items || input.items.length < 20) return input;
    
    // Summarize older items
    const recentItems = input.items.slice(-10);
    const summary = await analyzer.summarize(input.items.slice(0, -10));
    
    return {
      ...input,
      items: [
        { type: 'system', content: `Conversation summary: ${summary}` },
        ...recentItems,
      ],
      metadata: {
        ...(input.metadata || {}),
        historySummarized: true,
        originalItemCount: input.items.length,
      }
    };
  };
}

// ============================================================
// History Nesting
// ============================================================

/**
 * Nest handoff history - wrap previous agent context
 */
export function nestHandoffHistory(input, options = {}) {
  const { prefix = 'Previous agent context:', maxDepth = 5 } = options;
  
  if (!input.items || input.items.length === 0) {
    return input;
  }

  // Build nested context
  const depth = (input.metadata?.handoffDepth || 0) + 1;
  if (depth > maxDepth) {
    // Too deep - just keep recent items
    return {
      ...input,
      items: input.items.slice(-20),
      metadata: {
        ...(input.metadata || {}),
        handoffDepth: depth,
        handoffTruncated: true,
      }
    };
  }

  // Wrap in nested context
  const nestedContent = input.items
    .map(item => `[${item.role}]: ${item.content}`)
    .join('\n');

  return {
    ...input,
    items: [
      {
        type: 'user',
        content: `${prefix}\n\`\`\`\n${nestedContent.slice(0, 2000)}\n\`\`\``
      }
    ],
    metadata: {
      ...(input.metadata || {}),
      handoffDepth: depth,
      nestedContext: true,
    }
  };
}

// ============================================================
// Handoff State Machine
// ============================================================

const HANDOFF_STATES = {
  IDLE: 'idle',
  TRANSFERRING: 'transferring',
  COMPLETING: 'completing',
  FAILED: 'failed',
};

export class HandoffStateMachine {
  constructor() {
    this.state = HANDOFF_STATES.IDLE;
    this.history = [];
    this.currentHandoff = null;
  }

  /**
   * Start a handoff
   */
  start(handoff, input) {
    if (this.state !== HANDOFF_STATES.IDLE) {
      throw new Error(`Cannot start handoff in state: ${this.state}`);
    }
    
    this.state = HANDOFF_STATES.TRANSFERRING;
    this.currentHandoff = handoff;
    this.history.push({
      from: null,
      to: handoff.agentName,
      timestamp: Date.now(),
    });
  }

  /**
   * Complete the handoff
   */
  complete(targetAgent) {
    if (this.state !== HANDOFF_STATES.TRANSFERRING) {
      throw new Error(`Cannot complete handoff in state: ${this.state}`);
    }
    
    this.state = HANDOFF_STATES.IDLE;
    this.history[this.history.length - 1].completed = true;
    this.currentHandoff = null;
    return targetAgent;
  }

  /**
   * Fail the handoff
   */
  fail(error) {
    this.state = HANDOFF_STATES.FAILED;
    this.history[this.history.length - 1].error = error.message;
  }

  /**
   * Reset to idle
   */
  reset() {
    this.state = HANDOFF_STATES.IDLE;
    this.currentHandoff = null;
  }

  /**
   * Get handoff history
   */
  getHistory() {
    return this.history;
  }

  /**
   * Get current state
   */
  getState() {
    return this.state;
  }
}

// ============================================================
// Integration with OpenClaw
// ============================================================

let _globalRouter = null;

export function getGlobalHandoffRouter() {
  if (!_globalRouter) {
    _globalRouter = new HandoffRouter();
  }
  return _globalRouter;
}

export function setGlobalHandoffRouter(router) {
  _globalRouter = router;
}

/**
 * Create a simple handoff object
 */
export function createHandoff(options) {
  return new Handoff(options);
}

/**
 * Create a handoff router with multiple handoffs
 */
export function createHandoffRouter(handoffs) {
  const router = new HandoffRouter();
  if (handoffs) {
    router.registerAll(handoffs);
  }
  return router;
}
