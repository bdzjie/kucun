---
name: session-replay
description: "Replay past session experiences to find similar tasks and their solutions. Usage: /replay <task_description>. Finds relevant past sessions using BM25 search and shows what was done."
user-invocable: true
metadata:
  openclaw:
    command-dispatch: tool
    command-tool: Bash
    command-arg-mode: raw
---

# session-replay — Past Experience Replay

## Description

Searches past session histories using BM25 full-text search to find similar tasks and their solutions. Inspired by GenericAgent's L4 Session Archive — replay past experiences to accelerate current tasks.

## Usage

**Slash command**: `/replay <task_description>`

Examples:
- `/replay 如何配置 OpenClaw gateway`
- `/replay 分析 Claude Code 源码`
- `/replay 创建新 skill`

## How It Works

1. Extracts task/query text from past sessions
2. Runs BM25 search against session index
3. Returns top-k similar sessions with outcomes
4. Shows the skill path used (if skill was invoked)

## Output Format

```
=== Session Replay ===
Query: <task_description>

Top 3 Similar Past Sessions:

[1] Session: <session_id> | Score: <bm25>
    Task: <task_summary>
    Outcome: <what_happened>
    Skill Path: <skills_used>

[2] ...
```

## Features

- BM25 ranking with Porter stemming
- Configurable result limit (default: 3)
- Session metadata: timestamp, message count, skill usage
- Highlights key tool calls and decisions

## Examples

```
/replay openclaw skill 创建
/replay 帮我写一个 WebSocket 服务器
/replay 分析 memory 系统架构
```
