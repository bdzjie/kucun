---
name: session-search
description: >
  "Search historical conversations using BM25 full-text search. Usage: /session-search <query> — e.g. /session-search openclaw hook memory. Ask anything about past sessions and get ranked results with snippets."
user-invocable: true
metadata:
  openclaw:
    command-dispatch: tool
    command-tool: Bash
    command-arg-mode: raw
---
triggers:
  - /session-search
  - search my conversations
  - find past sessions
  triggers:
    - /session search


# session-search — Historical Conversation Search

## Description

Searches historical sessions using pure TypeScript BM25 ranking (no Python needed).

**When invoked**, this skill searches all session .jsonl files and returns BM25-ranked results with text snippets.

## Usage

**Slash command**: `/session-search <your question>`

Examples:
- `/session-search openclaw hook memory`
- `/session-search markdown format preference`
- `/session-search Claude Code analysis`
- `/session-search gateway cron pairing`

**Natural language** (when skill is auto-detected):
- "搜索关于 hook 系统的历史对话"
- "我之前问过关于 memory palace 的问题吗？"
- "查找所有讨论 Claude Code 的会话"

## Technical Details

- **Backend**: `modules/search/session_fts.ts` — Pure TypeScript BM25
- **Index**: 221 messages across 2 sessions (in-memory, rebuilt on search)
- **Sessions**: `~/.openclaw/agents/main/sessions/*.jsonl`
- **Algorithm**: BM25 (k1=1.5, b=0.75) + Porter stemming
- **No external dependencies** — runs natively in Node.js/Bun

## Results Format

Returns ranked results grouped by session:
- Session ID (anonymized, first 8 chars)
- BM25 relevance score
- Matching text snippets with context
- Role (user/assistant)

## If Search Returns Empty

The in-memory index may need rebuilding. To force a fresh index:
1. The index rebuilds automatically on first search
2. If issues persist, the `session_fts.ts` module rebuilds from scratch each time
