/**
 * provider-fallback skill handler
 * Parses /provider-fallback <model>@<provider> <prompt>
 * Calls provider_wrapper.mjs for multi-provider chat with fallback
 */

let _chain = null;

async function getChain() {
  if (_chain) return _chain;
  try {
    const mod = await import('../../modules/provider/provider_wrapper.mjs');
    mod.loadCredentials();
    _chain = {
      chatWithFallback: mod.chatWithFallback,
      listProviders: mod.listProviders,
    };
    return _chain;
  } catch (e) {
    console.warn('[provider-fallback] Load failed:', e.message);
    return null;
  }
}

export default async function providerFallbackHandler(event) {
  // Extract input
  let input = '';
  if (event.type === 'message' && event.context?.content) {
    input = event.context.content;
  } else if (event.message?.content) {
    input = event.message.content;
  }

  // Parse: /provider-fallback <model>@<provider> <prompt>
  const match = input.match(/^\/provider-fallback\s+(\S+?)@(openai|anthropic|openrouter|kimi|minimax|nous-portal|xiaomi-mimo|z-ai|huggingface)\s+(.+)$/i);

  if (!match) {
    const chain = await getChain();
    const provList = chain ? chain.listProviders().filter(p => p.hasApiKey).map(p => p.name).join(', ') : 'none configured';
    return {
      handled: true,
      skill: 'provider-fallback',
      response: `Usage: /provider-fallback <model>@<provider> <prompt>\n\nExamples:\n/provider-fallback gpt-4o@openai 解释量子纠缠\n/provider-fallback claude-3.5-sonnet@anthropic 写一个 Python 脚本\n/provider-fallback deepseek-chat@openrouter 分析代码性能\n\nConfigured providers: ${provList}\n\nAvailable providers: openai, anthropic, openrouter, kimi, minimax, nous-portal, xiaomi-mimo, z-ai, huggingface`,
    };
  }

  const [, model, provider, prompt] = match;

  const chain = await getChain();
  if (!chain) {
    return {
      handled: true,
      skill: 'provider-fallback',
      response: 'Provider system failed to load. Check modules/provider/provider_wrapper.mjs.',
    };
  }

  // Check provider availability
  const available = chain.listProviders().filter(p => p.hasApiKey).map(p => p.name);
  if (!available.includes(provider.toLowerCase())) {
    return {
      handled: true,
      skill: 'provider-fallback',
      response: `Provider "${provider}" has no API key configured.\n\nConfigured: ${available.join(', ') || 'none'}\n\nSet environment variables:\nANTHROPIC_API_KEY, OPENAI_API_KEY, OPENROUTER_API_KEY, KIMI_API_KEY, MINIMAX_API_KEY, etc.`,
    };
  }

  try {
    const messages = [{ role: 'user', content: prompt }];
    const result = await chain.chatWithFallback(
      { model, messages, max_tokens: 4096 },
      { primaryProvider: provider, maxRetries: 3, retryDelay: 2000 }
    );

    if (!result.success) {
      return {
        handled: true,
        skill: 'provider-fallback',
        response: `All providers failed.\n\nError: ${result.error}\nTried ${result.attempts} provider(s) over ${(result.duration / 1000).toFixed(1)}s`,
      };
    }

    const msg = result.response.message;
    const content = typeof msg.content === 'string'
      ? msg.content
      : msg.content?.[0]?.text || JSON.stringify(msg.content);

    return {
      handled: true,
      skill: 'provider-fallback',
      response: content,
      metadata: {
        provider: result.provider,
        model,
        usage: result.response.usage,
        duration_seconds: (result.duration / 1000).toFixed(1),
      },
    };
  } catch (e) {
    return {
      handled: true,
      skill: 'provider-fallback',
      response: `Error: ${e.message}`,
    };
  }
}
