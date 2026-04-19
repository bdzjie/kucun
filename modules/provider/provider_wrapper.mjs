/**
 * provider_wrapper.mjs — Pure JS Provider Fallback (ESM)
 * =====================================================
 *
 * Bundled fallback chain for OpenClaw skills.
 * Works in Node.js/Bun without TypeScript compilation.
 *
 * Usage:
 *   import { chatWithFallback } from './provider_wrapper.mjs';
 *   const result = await chatWithFallback({ model: 'gpt-4o', messages: [...] });
 */

import { resolve } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';

// ============================================================================
// Config
// ============================================================================

const PROVIDER_CONFIGS = {
  anthropic: {
    name: 'anthropic',
    mode: 'anthropic_messages',
    baseUrl: 'https://api.anthropic.com/v1',
    apiKeyEnv: 'ANTHROPIC_API_KEY',
  },
  openai: {
    name: 'openai',
    mode: 'chat_completions',
    baseUrl: 'https://api.openai.com/v1',
    apiKeyEnv: 'OPENAI_API_KEY',
  },
  openrouter: {
    name: 'openrouter',
    mode: 'chat_completions',
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKeyEnv: 'OPENROUTER_API_KEY',
  },
  kimi: {
    name: 'kimi',
    mode: 'chat_completions',
    baseUrl: 'https://api.moonshot.cn/v1',
    apiKeyEnv: 'KIMI_API_KEY',
  },
  minimax: {
    name: 'minimax',
    mode: 'chat_completions',
    baseUrl: 'https://api.minimax.chat/v1',
    apiKeyEnv: 'MINIMAX_API_KEY',
  },
  'nous-portal': {
    name: 'nous-portal',
    mode: 'chat_completions',
    baseUrl: 'https://portal.nousresearch.com/api/v1',
    apiKeyEnv: 'NOUS_API_KEY',
  },
  'xiaomi-mimo': {
    name: 'xiaomi-mimo',
    mode: 'chat_completions',
    baseUrl: 'https://platform.xiaomimimo.com/v1',
    apiKeyEnv: 'MIMO_API_KEY',
  },
  'z-ai': {
    name: 'z-ai',
    mode: 'chat_completions',
    baseUrl: 'https://z.ai/api/v1',
    apiKeyEnv: 'Z_API_KEY',
  },
  huggingface: {
    name: 'huggingface',
    mode: 'chat_completions',
    baseUrl: 'https://api-inference.huggingface.co/models',
    apiKeyEnv: 'HF_API_KEY',
  },
};

// ============================================================================
// Credentials
// ============================================================================

const credentials = new Map();

function loadCredentials() {
  for (const [name, config] of Object.entries(PROVIDER_CONFIGS)) {
    const apiKey = process.env[config.apiKeyEnv];
    if (apiKey) {
      credentials.set(name, apiKey);
    }
  }
}

function getCredential(provider) {
  if (!credentials.has(provider)) {
    const config = PROVIDER_CONFIGS[provider];
    if (config) {
      const apiKey = process.env[config.apiKeyEnv];
      if (apiKey) credentials.set(provider, apiKey);
    }
  }
  return credentials.get(provider);
}

function listAvailableProviders() {
  loadCredentials();
  return Object.keys(PROVIDER_CONFIGS).filter(p => credentials.has(p));
}

// ============================================================================
// HTTP Client
// ============================================================================

async function anthropicChat(apiKey, baseUrl, request) {
  const body = {
    model: request.model,
    messages: request.messages,
    max_tokens: request.max_tokens || 4096,
    temperature: request.temperature,
  };
  if (request.tools && request.tools.length > 0) {
    body.tools = request.tools.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema,
    }));
  }

  const response = await fetch(`${baseUrl}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Anthropic API error ${response.status}: ${text.slice(0, 200)}`);
  }

  const data = await response.json();

  // Extract text content
  let content = '';
  for (const block of data.content || []) {
    if (block.type === 'text') content += block.text;
  }

  return {
    message: { role: 'assistant', content },
    usage: data.usage || { input_tokens: 0, output_tokens: 0 },
  };
}

async function openaiChat(apiKey, baseUrl, request) {
  const body = {
    model: request.model,
    messages: request.messages,
    max_tokens: request.max_tokens || 4096,
    temperature: request.temperature,
  };
  if (request.tools && request.tools.length > 0) {
    body.tools = request.tools;
  }

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI API error ${response.status}: ${text.slice(0, 200)}`);
  }

  const data = await response.json();
  const choice = data.choices?.[0]?.message;
  return {
    message: { role: choice?.role || 'assistant', content: choice?.content || '' },
    usage: data.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}

async function chatDirect(provider, request) {
  const config = PROVIDER_CONFIGS[provider];
  if (!config) throw new Error(`Unknown provider: ${provider}`);

  const apiKey = getCredential(provider);
  if (!apiKey) throw new Error(`No API key for provider: ${provider}`);

  if (config.mode === 'anthropic_messages') {
    return anthropicChat(apiKey, config.baseUrl, request);
  } else {
    return openaiChat(apiKey, config.baseUrl, request);
  }
}

// ============================================================================
// Retry with backoff
// ============================================================================

async function chatWithRetry(provider, request, maxRetries = 3, baseDelay = 1000) {
  let lastError;

  for (let i = 0; i < maxRetries; i++) {
    try {
      return await chatDirect(provider, request);
    } catch (error) {
      lastError = error;

      // Don't retry on auth errors
      if (error.message.includes('401') || error.message.includes('403') || error.message.includes('401')) {
        throw error;
      }

      if (i < maxRetries - 1) {
        const delay = Math.min(baseDelay * Math.pow(2, i), 30000);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }

  throw lastError;
}

// ============================================================================
// Fallback Chain
// ============================================================================

export async function chatWithFallback(request, options = {}) {
  const {
    primaryProvider = 'openai',
    maxRetries = 3,
    retryDelay = 2000,
  } = options;

  loadCredentials();

  const providers = [primaryProvider];

  // Add fallbacks (exclude primary)
  const fallbackOrder = ['openai', 'anthropic', 'openrouter', 'kimi', 'minimax'];
  for (const p of fallbackOrder) {
    if (p !== primaryProvider && credentials.has(p)) {
      providers.push(p);
    }
  }

  let lastError;
  const startTime = Date.now();

  for (const provider of providers) {
    try {
      const result = await chatWithRetry(provider, request, maxRetries, retryDelay);
      return {
        success: true,
        provider,
        model: request.model,
        response: result,
        attempts: providers.indexOf(provider) + 1,
        duration: Date.now() - startTime,
      };
    } catch (error) {
      lastError = error;
      console.warn(`[provider-fallback] ${provider} failed: ${error.message.slice(0, 100)}`);
    }
  }

  return {
    success: false,
    provider: primaryProvider,
    error: lastError?.message || 'All providers failed',
    attempts: providers.length,
    duration: Date.now() - startTime,
  };
}

export function listProviders() {
  loadCredentials();
  const available = [];
  for (const [name, config] of Object.entries(PROVIDER_CONFIGS)) {
    const hasKey = !!getCredential(name);
    available.push({ name, mode: config.mode, hasApiKey: hasKey });
  }
  return available;
}

export { loadCredentials };
