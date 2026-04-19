/**
 * lifecycle-trace-hook handler
 * 
 * Integrates span_tracing.mjs into OpenClaw hooks.
 * Traces: onMessage (turn), onToolResult (tool)
 * 
 * Hooks: onMessage, onToolResult
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync, readFileSync, mkdirSync } from 'fs';
import { homedir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = join(homedir(), '.openclaw', 'memory', 'tracing_config.json');

let traceModule = null;
let currentTrace = null;
let turnSpan = null;

async function getTracer() {
  if (!traceModule) {
    try {
      traceModule = await import('../../modules/span_tracing.mjs');
    } catch (e) {
      // Module not found, tracing disabled
      return null;
    }
  }
  return traceModule;
}

function isEnabled() {
  try {
    if (existsSync(CONFIG_PATH)) {
      const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
      return config.enabled !== false;
    }
  } catch (e) {}
  return true; // Default enabled
}

export async function onMessage(message, sessionId, userId) {
  if (!isEnabled()) return;
  
  const tracer = await getTracer();
  if (!tracer) return;
  
  try {
    const now = Date.now();
    
    // Start trace on first message
    if (!currentTrace) {
      currentTrace = tracer.createTrace('openclaw-run');
      currentTrace.start();
      
      // Create root turn span
      turnSpan = currentTrace.span('turn', { type: 'turn', turnNumber: 1, sessionId });
      turnSpan.start();
    }
    
    // Track message count
    const msgCount = (currentTrace._msgCount || 0) + 1;
    currentTrace._msgCount = msgCount;
    
    // Create message span as child of turn
    const msgSpan = currentTrace.span('message', { 
      type: 'function',
      role: message?.role || 'user',
      sessionId,
      messageNumber: msgCount,
    });
    
    // Store span info in message for timing
    message._trace = {
      traceId: currentTrace.traceId,
      spanId: msgSpan.spanId,
      startTime: now,
    };
    
    // Use setTimeout to end span after message processing
    // (actual end time will be approximate)
    setTimeout(() => {
      if (msgSpan && !msgSpan.endTime) {
        msgSpan.end();
      }
    }, 10);
    
  } catch (e) {
    // Silently fail - tracing should not break hooks
  }
}

export async function onToolResult(toolName, result, sessionId) {
  if (!isEnabled()) return;
  
  const tracer = await getTracer();
  if (!tracer || !currentTrace) return;
  
  try {
    // Create tool span
    const toolSpan = currentTrace.span('tool', {
      type: 'tool',
      toolName: toolName || 'unknown',
      sessionId,
    });
    
    toolSpan.start();
    
    if (result && typeof result === 'object') {
      if (result.success === false) {
        toolSpan.setStatus('error', result.error || 'Tool failed');
      }
      
      // Add key attributes
      if (result.output) {
        const outputStr = typeof result.output === 'string' 
          ? result.output 
          : JSON.stringify(result.output);
        toolSpan.setAttribute('outputLength', outputStr.length);
      }
    }
    
    toolSpan.end();
    
  } catch (e) {
    // Silently fail
  }
}

export async function onHookContext(hookName, context) {
  if (!isEnabled()) return;
  
  const tracer = await getTracer();
  if (!tracer || !currentTrace) return;
  
  try {
    const span = currentTrace.span(`hook:${hookName}`, {
      type: 'custom',
      hookName,
    });
    span.start();
    span.end();
  } catch (e) {
    // Silently fail
  }
}

// Flush traces when session ends
export async function onSessionEnd(sessionId) {
  if (!currentTrace) return;
  
  const tracer = await getTracer();
  if (!tracer) return;
  
  try {
    if (turnSpan) {
      turnSpan.end();
      turnSpan = null;
    }
    
    currentTrace.end();
    
    // Force flush
    for (const processor of tracer.getTracer().processors) {
      if (processor.flush) {
        processor.flush();
      }
    }
    
    currentTrace = null;
  } catch (e) {
    // Silently fail
  }
}
