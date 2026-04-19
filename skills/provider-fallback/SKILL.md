---
name: provider-fallback
description: "Multi-provider chat with automatic fallback. Use this when the primary model fails or you want to try alternative providers. Usage: /provider-fallback <model>@<provider> <prompt> — e.g. /provider-fallback gpt-4o@openai Explain quantum entanglement, or /provider-fallback claude-3.5@anthropic Write a Python script"
user-invocable: true
metadata:
  openclaw:
    command-dispatch: tool
    command-tool: Bash
    command-arg-mode: raw
---

# provider-fallback — Multi-Provider Chat with Fallback

## Description

Provides access to multiple LLM providers with automatic fallback.
When the primary provider fails (rate limit, API error, timeout), automatically tries the next provider in the chain.

## Supported Providers

| Provider | Mode | Env Variable |
|----------|------|-------------|
| anthropic | anthropic_messages | ANTHROPIC_API_KEY |
| openai | chat_completions | OPENAI_API_KEY |
| openrouter | chat_completions | OPENROUTER_API_KEY |
| kimi | chat_completions | KIMI_API_KEY |
| minimax | chat_completions | MINIMAX_API_KEY |
| nous-portal | chat_completions | NOUS_API_KEY |
| xiaomi-mimo | chat_completions | MIMO_API_KEY |
| z-ai | chat_completions | Z_API_KEY |
| huggingface | chat_completions | HF_API_KEY |

## Usage

```
/provider-fallback <model>@<provider> <prompt>
```

Examples:
- `/provider-fallback gpt-4o@openai 解释量子纠缠`
- `/provider-fallback claude-3.5-sonnet@anthropic 写一个 Python 异步服务器`
- `/provider-fallback deepseek-chat@openrouter 分析这段代码的性能`

## Fallback Behavior

If the primary provider fails, the system automatically tries the next available provider in this order:
1. Primary requested provider
2. openai (if different from primary)
3. anthropic (if different from primary)
4. openrouter (last resort)

Each provider gets 3 retry attempts with exponential backoff.

## If All Providers Fail

Returns an error message. In that case, try:
- Waiting a moment and retrying (rate limits usually clear)
- Using a different model
- Checking your API key configuration

## Technical Details

- Backend: `modules/provider/` — Pure TypeScript provider system
- No OpenClaw gateway dependency — calls providers directly
- Requires API keys to be set as environment variables
- Timeout: 120 seconds per request
