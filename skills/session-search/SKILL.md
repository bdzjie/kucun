---
metadata:
  openclaw:
    version: 1.0
    type: skill
    name: session-search
    description: Search historical conversations using SQLite FTS5 full-text search. Ask anything about past sessions and get BM25-ranked results with snippets.
    autoCreated: false
    examples:
      - "搜索关于 OpenClaw hook 的历史对话"
      - "我之前问过关于 memory 系统的问题吗？"
      - "查找所有讨论 Claude Code 的会话"
---

# session-search — Historical Conversation Search

## Description

Uses SQLite FTS5 BM25 search to find relevant passages from historical sessions.
Index is rebuilt every 6 hours via the memory cron daemon.

## Usage

Ask in natural language — no special syntax needed.

Example prompts:
- "搜索关于 hook 系统的会话"
- "我之前问过 memory palace 吗？"
- "查找所有讨论 GitHub API 的对话"
- "我第一次提到 Claude Code 是什么时候？"

## Technical Details

- Backend: Python sqlite3 FTS5 with Porter stemming + BM25 ranking
- Index: `~/.openclaw/memory/fts5.db`
- Sessions: `~/.openclaw/agents/main/sessions/`
- Update: Every 6 hours (automatic via memory_cron.mjs)

## Results

Returns ranked results with:
- Session ID and timestamp
- BM25 relevance score
- Matching text snippets with context
- Role (user or assistant)
