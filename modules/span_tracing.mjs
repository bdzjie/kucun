/**
 * span_tracing.mjs
 * 
 * Inspired by OpenAI Agents SDK tracing system.
 * Provides distributed tracing with spans for OpenClaw agent runs.
 * 
 * Features:
 * - Span hierarchy: Trace > Turn > Agent > LLM > Tool
 * - Span data with timestamps and attributes
 * - Tracing processors (console, file, batch export)
 * - Context propagation across async operations
 * 
 * Usage:
 *   import { trace, span, getCurrentSpan } from './modules/span_tracing.mjs';
 *   
 *   const t = trace('my-run');
 *   await t.run(async () => {
 *     const s = span('llm-call', { model: 'gpt-4' });
 *     await s.run(async () => {
 *       const result = await callModel();
 *       s.setAttribute('output_tokens', result.usage.outputTokens);
 *     });
 *   });
 */

import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { createSecureRandomHex } from 'crypto';

// ============================================================
// Utilities
// ============================================================

function generateId(prefix = '') {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  return prefix ? `${prefix}_${hex.slice(0, 16)}` : hex.slice(0, 16);
}

function timestamp() {
  return Date.now();
}

function formatDuration(start, end) {
  return end && start ? end - start : 0;
}

// ============================================================
// Span Data Types
// ============================================================

const SPAN_TYPES = {
  TRACE: 'trace',
  TURN: 'turn',
  AGENT: 'agent',
  LLM: 'llm',
  TOOL: 'tool',
  HANDOFF: 'handoff',
  GUARDRAIL: 'guardrail',
  FUNCTION: 'function',
  CUSTOM: 'custom',
};

const STATUS_CODES = {
  OK: 'ok',
  ERROR: 'error',
  CANCELLED: 'cancelled',
};

// ============================================================
// Base Span
// ============================================================

class Span {
  constructor(name, options = {}) {
    this.name = name;
    this.spanId = generateId('span');
    this.traceId = options.traceId || generateId('trace');
    this.parentSpanId = options.parentSpanId || null;
    this.type = options.type || SPAN_TYPES.CUSTOM;
    this.startTime = options.startTime || timestamp();
    this.endTime = null;
    this.statusCode = null;
    this.statusMessage = null;
    this.attributes = new Map(Object.entries(options.attributes || {}));
    this.events = [];
    this.children = [];
  }
  
  setAttribute(key, value) {
    this.attributes.set(key, value);
    return this;
  }
  
  setAttributes(attributes) {
    for (const [key, value] of Object.entries(attributes)) {
      this.attributes.set(key, value);
    }
    return this;
  }
  
  addEvent(name, attributes = {}) {
    this.events.push({
      name,
      timestamp: timestamp(),
      attributes
    });
    return this;
  }
  
  setStatus(code, message = '') {
    this.statusCode = code;
    this.statusMessage = message;
    return this;
  }
  
  end(statusCode = STATUS_CODES.OK, statusMessage = '') {
    if (this.endTime) return; // Already ended
    this.endTime = timestamp();
    this.statusCode = statusCode;
    this.statusMessage = statusMessage;
  }
  
  get duration() {
    return formatDuration(this.startTime, this.endTime);
  }
  
  toJSON() {
    return {
      name: this.name,
      spanId: this.spanId,
      traceId: this.traceId,
      parentSpanId: this.parentSpanId,
      type: this.type,
      startTime: this.startTime,
      endTime: this.endTime,
      duration: this.duration,
      statusCode: this.statusCode,
      statusMessage: this.statusMessage,
      attributes: Object.fromEntries(this.attributes),
      events: this.events,
    };
  }
}

// ============================================================
// Trace (Top-level container)
// ============================================================

class Trace {
  constructor(name, options = {}) {
    this.traceId = generateId('trace');
    this.name = name;
    this.startTime = timestamp();
    this.endTime = null;
    this.rootSpan = null;
    this.spans = [];
    this._currentSpan = null;
  }
  
  start(options = {}) {
    this.rootSpan = new Span(this.name, {
      traceId: this.traceId,
      type: SPAN_TYPES.TRACE,
      ...options
    });
    this._currentSpan = this.rootSpan;
    this.spans.push(this.rootSpan);
    return this;
  }
  
  /**
   * Create a child span
   */
  span(name, options = {}) {
    const parent = this._currentSpan;
    const child = new Span(name, {
      traceId: this.traceId,
      parentSpanId: parent?.spanId,
      ...options
    });
    if (parent) {
      parent.children.push(child);
    }
    return child;
  }
  
  /**
   * Run a function within a span
   */
  async run(fn, name, options = {}) {
    const s = this.span(name, options);
    const prev = this._currentSpan;
    this._currentSpan = s;
    
    try {
      const result = await fn(s);
      s.end(STATUS_CODES.OK);
      return result;
    } catch (error) {
      s.end(STATUS_CODES.ERROR, error.message);
      s.addEvent('exception', { error: error.message });
      throw error;
    } finally {
      this._currentSpan = prev;
    }
  }
  
  /**
   * Run a synchronous function within a span
   */
  runSync(fn, name, options = {}) {
    const s = this.span(name, options);
    const prev = this._currentSpan;
    this._currentSpan = s;
    
    try {
      const result = fn(s);
      s.end(STATUS_CODES.OK);
      return result;
    } catch (error) {
      s.end(STATUS_CODES.ERROR, error.message);
      s.addEvent('exception', { error: error.message });
      throw error;
    } finally {
      this._currentSpan = prev;
    }
  }
  
  end() {
    if (this.rootSpan && !this.rootSpan.endTime) {
      this.rootSpan.end(STATUS_CODES.OK);
    }
    this.endTime = timestamp();
  }
  
  getSpans() {
    return this.spans;
  }
  
  toJSON() {
    return {
      traceId: this.traceId,
      name: this.name,
      startTime: this.startTime,
      endTime: this.endTime,
      duration: formatDuration(this.startTime, this.endTime),
      spans: this.spans.map(s => s.toJSON()),
    };
  }
}

// ============================================================
// Tracing Context (TLS for current span)
// ============================================================

const _contextStack = [];

export function getCurrentSpan() {
  return _contextStack[_contextStack.length - 1] || null;
}

export function getCurrentTrace() {
  const span = getCurrentSpan();
  return span ? span.traceId : null;
}

export function withSpan(span, fn) {
  _contextStack.push(span);
  try {
    return fn(span);
  } finally {
    _contextStack.pop();
  }
}

export function withTrace(trace, fn) {
  const span = trace.rootSpan;
  _contextStack.push(span);
  try {
    return fn(trace);
  } finally {
    _contextStack.pop();
  }
}

// ============================================================
// Tracing Processors
// ============================================================

/**
 * Console processor - logs spans to console
 */
class ConsoleTraceProcessor {
  constructor(options = {}) {
    this.logger = options.logger || console;
    this.minLevel = options.minLevel || 'debug';
  }
  
  onSpanEnd(span) {
    if (span.type === SPAN_TYPES.TRACE) return; // Don't log traces, only spans
    
    const level = span.statusCode === STATUS_CODES.ERROR ? 'error' : 'debug';
    const msg = `[Span] ${span.name} (${span.type}) - ${span.duration}ms`;
    
    if (level === 'error') {
      this.logger.error(msg, span.toJSON());
    } else {
      this.logger.debug(msg, span.toJSON());
    }
  }
  
  onTraceEnd(trace) {
    this.logger.log(`[Trace] ${trace.name} completed in ${trace.duration}ms`);
  }
}

/**
 * File processor - writes spans to file
 */
class FileTraceProcessor {
  constructor(options = {}) {
    this.path = options.path || join(homedir(), '.openclaw', 'memory', 'traces.jsonl');
    this._ensureDir();
  }
  
  _ensureDir() {
    const dir = dirname(this.path);
    if (!existsSync(dir)) {
      require('fs').mkdirSync(dir, { recursive: true });
    }
  }
  
  onSpanEnd(span) {
    if (span.type === SPAN_TYPES.TRACE) return;
    try {
      appendFileSync(this.path, JSON.stringify(span.toJSON()) + '\n');
    } catch (e) {
      // Silently fail
    }
  }
  
  onTraceEnd(trace) {
    try {
      appendFileSync(this.path, JSON.stringify({
        type: 'trace_complete',
        ...trace.toJSON()
      }) + '\n');
    } catch (e) {
      // Silently fail
    }
  }
}

/**
 * Batch processor - collects spans, exports in batches
 */
class BatchTraceProcessor {
  constructor(options = {}) {
    this.maxBatchSize = options.maxBatchSize || 100;
    this.maxWaitTime = options.maxWaitTime || 5000;
    this.processors = options.processors || [new ConsoleTraceProcessor()];
    this.buffer = [];
    this._timer = null;
  }
  
  _flush() {
    if (this.buffer.length === 0) return;
    
    for (const processor of this.processors) {
      try {
        for (const span of this.buffer) {
          processor.onSpanEnd(span);
        }
        for (const trace of this._traces || []) {
          processor.onTraceEnd(trace);
        }
      } catch (e) {
        // Silently fail
      }
    }
    
    this.buffer = [];
    this._traces = [];
  }
  
  _scheduleFlush() {
    if (this._timer) return;
    this._timer = setTimeout(() => {
      this._flush();
      this._timer = null;
    }, this.maxWaitTime);
  }
  
  onSpanEnd(span) {
    this.buffer.push(span);
    if (span.type === SPAN_TYPES.TRACE) {
      // Track traces separately for trace-end events
      this._traces = this._traces || [];
      this._traces.push(span);
    }
    if (this.buffer.length >= this.maxBatchSize) {
      this._flush();
    } else {
      this._scheduleFlush();
    }
  }
  
  onTraceEnd(trace) {
    // trace is already handled via onSpanEnd for root span
  }
  
  flush() {
    this._flush();
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
  }
}

// ============================================================
// Global Tracer
// ============================================================

class Tracer {
  constructor() {
    this.processors = [new ConsoleTraceProcessor(), new FileTraceProcessor()];
    this.enabled = true;
  }
  
  addProcessor(processor) {
    this.processors.push(processor);
  }
  
  setProcessors(processors) {
    this.processors = processors;
  }
  
  createTrace(name, options = {}) {
    return new Trace(name, options);
  }
  
  /**
   * Create and start a trace, run a function within it
   */
  async trace(name, options, fn) {
    if (!this.enabled) {
      return fn(null);
    }
    
    const trace = this.createTrace(name, options);
    trace.start();
    
    try {
      const result = await withTrace(trace, async () => {
        return await fn(trace);
      });
      trace.end();
      return result;
    } catch (error) {
      trace.end();
      throw error;
    } finally {
      for (const processor of this.processors) {
        processor.onTraceEnd(trace);
      }
    }
  }
  
  /**
   * Create a span and run a function within it
   */
  async span(name, options, fn) {
    const current = getCurrentSpan();
    if (!current) {
      return fn(null);
    }
    
    const s = current.span(name, options);
    return await withSpan(s, fn);
  }
  
  /**
   * Wrap a function with a span
   */
  wrap(name, options, fn) {
    return async (...args) => {
      const s = new Span(name, options);
      withSpan(s, () => {
        s.startTime = timestamp();
      });
      
      try {
        const result = await fn(...args);
        s.end(STATUS_CODES.OK);
        return result;
      } catch (error) {
        s.end(STATUS_CODES.ERROR, error.message);
        throw error;
      } finally {
        for (const processor of this.processors) {
          processor.onSpanEnd(s);
        }
      }
    };
  }
}

// Singleton
let globalTracer = null;

export function getTracer() {
  if (!globalTracer) {
    globalTracer = new Tracer();
  }
  return globalTracer;
}

export function setTracer(tracer) {
  globalTracer = tracer;
}

// ============================================================
// Convenient API
// ============================================================

export function trace(name, options, fn) {
  return getTracer().trace(name, options, fn);
}

export function span(name, options, fn) {
  return getTracer().span(name, options, fn);
}

export { Trace, Span, SPAN_TYPES, STATUS_CODES };
