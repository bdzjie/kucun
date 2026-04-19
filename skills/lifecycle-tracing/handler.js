/**
 * lifecycle-tracing skill handler
 * 
 * CLI for the span tracing system.
 * 
 * Usage:
 *   /lifecycle-tracing --status
 *   /lifecycle-tracing --spans [trace-id]
 *   /lifecycle-tracing --enable
 *   /lifecycle-tracing --disable
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const TRACES_PATH = join(homedir(), '.openclaw', 'memory', 'traces.jsonl');
const CONFIG_PATH = join(homedir(), '.openclaw', 'memory', 'tracing_config.json');

function loadConfig() {
  try {
    if (existsSync(CONFIG_PATH)) {
      return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
    }
  } catch (e) {}
  return { enabled: true, logToConsole: true, logToFile: true };
}

function saveConfig(config) {
  try {
    const dir = dirname(CONFIG_PATH);
    if (!existsSync(dir)) {
      require('fs').mkdirSync(dir, { recursive: true });
    }
    require('fs').writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  } catch (e) {}
}

function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

function formatTimestamp(ts) {
  const d = new Date(ts);
  return d.toISOString().replace('T', ' ').slice(0, 19);
}

function readSpans(traceId = null) {
  if (!existsSync(TRACES_PATH)) return [];
  
  try {
    const data = readFileSync(TRACES_PATH, 'utf-8');
    const lines = data.split('\n').filter(l => l.trim());
    
    return lines
      .map(l => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter(s => s && (!traceId || s.traceId === traceId));
  } catch (e) {
    return [];
  }
}

function groupByTrace(spans) {
  const traces = {};
  for (const span of spans) {
    if (!traces[span.traceId]) {
      traces[span.traceId] = [];
    }
    traces[span.traceId].push(span);
  }
  return traces;
}

function renderSpan(span, indent = 0) {
  const prefix = '  '.repeat(indent);
  const attrs = span.attributes || {};
  
  let line = `${prefix}└─ ${span.name} (${span.type})`;
  if (span.duration !== undefined) {
    line += ` - ${formatDuration(span.duration)}`;
  }
  if (span.statusCode === 'error') {
    line += ` [ERROR: ${span.statusMessage || 'unknown'}]`;
  }
  
  const lines = [line];
  
  // Show key attributes
  if (attrs.model) {
    lines.push(`${prefix}   model: ${attrs.model}`);
  }
  if (attrs.tool) {
    lines.push(`${prefix}   tool: ${attrs.tool}`);
  }
  if (attrs.tokens) {
    lines.push(`${prefix}   tokens: ${attrs.tokens}`);
  }
  
  return lines.join('\n');
}

export default async function handler(args) {
  const parts = args.trim().split(/\s+/);
  const flags = parts.filter(p => p.startsWith('--'));
  const positional = parts.filter(p => !p.startsWith('--'));
  
  const config = loadConfig();
  
  // Status command
  if (flags.includes('--status') || positional[0] === 'status') {
    const spans = readSpans();
    const traces = groupByTrace(spans);
    const traceIds = Object.keys(traces).slice(-10); // Last 10 traces
    
    const traceSummary = traceIds.map(tid => {
      const traceSpans = traces[tid];
      const totalDuration = Math.max(...traceSpans.map(s => s.startTime + (s.duration || 0))) -
                           Math.min(...traceSpans.map(s => s.startTime));
      const spanCount = traceSpans.length;
      const startTime = formatTimestamp(Math.min(...traceSpans.map(s => s.startTime)));
      return { tid, spanCount, totalDuration, startTime };
    });
    
    return {
      output: `=== Lifecycle Tracing Status ===

Tracing: ${config.enabled ? 'ENABLED' : 'DISABLED'}
Log to console: ${config.logToConsole ? 'YES' : 'NO'}
Log to file: ${config.logToFile ? 'YES' : 'NO'}
Spans file: ${TRACES_PATH}

Recent traces (${traceIds.length}):

${traceSummary.length === 0 ? '  No traces recorded.' : traceSummary.map(t => 
  `  ${t.tid.slice(0, 20)}...  ${t.spanCount} spans  ${formatDuration(t.totalDuration)}  ${t.startTime}`
).join('\n')}

Total spans recorded: ${spans.length}`
    };
  }
  
  // Spans command
  if (flags.includes('--spans') || positional[0] === 'spans') {
    const traceId = positional[1] || positional[2] || null;
    const spans = readSpans(traceId);
    
    if (spans.length === 0) {
      return { output: `No spans found${traceId ? ` for trace ${traceId}` : ''}` };
    }
    
    // Group by trace
    const traces = groupByTrace(spans);
    const output = [];
    
    for (const [tid, traceSpans] of Object.entries(traces).slice(-5)) {
      const sorted = traceSpans.sort((a, b) => a.startTime - b.startTime);
      
      output.push(`\n=== Trace: ${tid.slice(0, 20)}... (${sorted.length} spans) ===`);
      output.push(`Start: ${formatTimestamp(sorted[0]?.startTime || 0)}`);
      
      // Build tree structure
      const root = sorted.find(s => s.type === 'trace' || !s.parentSpanId);
      if (root) {
        output.push(renderSpan(root, 0));
        
        // Render children recursively
        const renderChildren = (parentId, indent) => {
          const children = sorted.filter(s => s.parentSpanId === parentId);
          for (const child of children) {
            output.push(renderSpan(child, indent));
            renderChildren(child.spanId, indent + 1);
          }
        };
        
        renderChildren(root.spanId, 1);
      } else {
        // Flat render if no hierarchy
        for (const span of sorted) {
          output.push(renderSpan(span, 0));
        }
      }
    }
    
    return { output: output.join('\n') };
  }
  
  // Enable/disable
  if (flags.includes('--enable')) {
    config.enabled = true;
    saveConfig(config);
    return { output: 'Lifecycle tracing ENABLED' };
  }
  
  if (flags.includes('--disable')) {
    config.enabled = false;
    saveConfig(config);
    return { output: 'Lifecycle tracing DISABLED' };
  }
  
  // Help
  return {
    output: `Lifecycle Tracing — Span-based tracing for OpenClaw runs

Usage:
  /lifecycle-tracing --status     Show tracing status and recent traces
  /lifecycle-tracing --spans [id] Show spans for a trace (or last trace)
  /lifecycle-tracing --enable     Enable tracing
  /lifecycle-tracing --disable    Disable tracing

Examples:
  /lifecycle-tracing --status
  /lifecycle-tracing --spans abc123
  
Span types: trace, turn, agent, llm, tool, handoff, guardrail, function
Spans are written to: ~/.openclaw/memory/traces.jsonl`
  };
}
