/**
 * tool-guardrail-hook handler.js
 * 
 * Integrates tool_guardrail_hook.mjs into OpenClaw's hook system.
 * Runs pre-tool validation and post-tool validation.
 */

import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Dynamic import of the guardrail module
async function getGuardrailModule() {
  // Try workspace modules first
  const localPath = join(process.cwd(), 'modules', 'tool_guardrail_hook.mjs');
  if (existsSync(localPath)) {
    return import(localPath);
  }
  
  // Fallback to global module
  const globalPath = join(homedir(), '.openclaw', 'workspace', 'modules', 'tool_guardrail_hook.mjs');
  if (existsSync(globalPath)) {
    return import(globalPath);
  }
  
  throw new Error('tool_guardrail_hook.mjs not found');
}

// ============================================================
// Pre-Tool Validation (onMessagePreprocessed)
// ============================================================

export async function onMessagePreprocessed({ message, tools, context }) {
  try {
    const { run_pre_guardrail } = await getGuardrailModule();
    
    // Extract tool calls from message if present
    const toolCalls = extractToolCalls(message);
    
    for (const tc of toolCalls) {
      const result = await run_pre_guardrail(tc.tool, tc.input);
      
      if (!result.allowed) {
        console.error(`[tool-guardrail-hook] BLOCKED: ${tc.tool}`);
        return {
          allowed: false,
          reason: result.reason,
          guardrail: result.guardrail,
          tool: tc.tool,
          blocked: true
        };
      }
    }
    
    return { allowed: true };
  } catch (e) {
    console.error('[tool-guardrail-hook] Error:', e.message);
    // Don't block on errors, let the tool execute
    return { allowed: true, error: e.message };
  }
}

// ============================================================
// Post-Tool Validation (onToolResult)
// ============================================================

export async function onToolResult({ tool, input, output, result }) {
  try {
    const { run_post_guardrail } = await getGuardrailModule();
    
    const checkResult = await run_post_guardrail(tool, output);
    
    if (!checkResult.allowed) {
      console.error(`[tool-guardrail-hook] POST-BLOCKED: ${tool}`);
      return {
        flagged: true,
        reason: checkResult.reason,
        guardrail: checkResult.guardrail,
        output: output
      };
    }
    
    return { flagged: false };
  } catch (e) {
    console.error('[tool-guardrail-hook] Post-check error:', e.message);
    return { flagged: false, error: e.message };
  }
}

// ============================================================
// Utility: Extract Tool Calls
// ============================================================

function extractToolCalls(message) {
  const calls = [];
  
  if (!message) return calls;
  
  // Handle OpenClaw message format
  if (message.tools) {
    for (const t of message.tools) {
      if (t.function) {
        calls.push({
          tool: t.function.name,
          input: JSON.parse(t.function.arguments || '{}')
        });
      } else if (t.name && t.input) {
        calls.push({
          tool: t.name,
          input: t.input
        });
      }
    }
  }
  
  // Handle raw content with tool calls
  if (typeof message.content === 'string') {
    const toolMatches = message.content.matchAll(/tool_call\{([^}]+)\}/g);
    for (const match of toolMatches) {
      try {
        calls.push(JSON.parse(match[1]));
      } catch {
        // Skip malformed
      }
    }
  }
  
  return calls;
}

// ============================================================
// Admin Functions
// ============================================================

export async function listGuardrails() {
  try {
    const { list_guardrails } = await getGuardrailModule();
    return list_guardrails();
  } catch (e) {
    return { error: e.message };
  }
}

export async function addGuardrail(guardrail) {
  try {
    const { register_guardrail } = await getGuardrailModule();
    register_guardrail(guardrail);
    return { success: true };
  } catch (e) {
    return { error: e.message };
  }
}
