---
name: conversation-analyst
"Analyze conversation history patterns and generate structured reports. Usage: /conversation-analyst — asks for a full analytics report including activity stats, engagement quality, top topics, and tool usage patterns."
user-invocable: true
metadata:
  openclaw:
    command-dispatch: tool
    command-tool: Bash
    command-arg-mode: raw
---
triggers:
  - /conversation-analyst
  - analyze my conversations
  - conversation patterns
  - usage analytics


# conversation-analyst — Conversation History Analytics

## Description

Analyzes the conversation history across recent sessions and generates a structured Markdown report with insights.

## Usage

**Slash command**: `/conversation-analyst`

**Natural language**:
- "分析最近的对话"
- "给出会话统计报告"
- "我使用最多的工具是什么？"
- "最近的活动情况怎么样？"

## Technical Details

- **Backend**: `modules/conversation_analyst.ts` — Pure TypeScript
- **Sessions analyzed**: Last 10 sessions from session store
- **No external dependencies** — runs natively in Node.js/Bun

## Report Sections

1. **Activity Overview** — total messages, user/assistant ratio, duration
2. **Engagement Quality** — assistant/user ratio, memory density
3. **Top Topics** — most frequently discussed themes (aggregated across sessions)
4. **Top Tools** — most used tools ranked
5. **Recent Sessions** — per-session breakdown

## Example Report

```
Sessions analyzed: 2
Total messages: 873
Engagement ratio: 2.96 (assistant per user)
Top topic: openclaw (42 occurrences)
Overall: High activity, good engagement
```
