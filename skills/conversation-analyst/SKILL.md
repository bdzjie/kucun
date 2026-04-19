---
metadata:
  openclaw:
    version: 1.0
    type: skill
    name: conversation-analyst
    description: Analyze conversation history patterns and generate structured reports. Ask "分析最近的对话" or "给出会话报告" to get insights about activity, topics, engagement, and tool usage.
    autoCreated: false
    examples:
      - "分析最近的对话"
      - "给出会话统计报告"
      - "我使用最多的工具是什么？"
---

# conversation-analyst — Conversation History Analytics

## Description

Analyzes the conversation history across recent sessions and generates a structured report with insights about activity patterns, engagement quality, topic trends, and tool usage.

## Usage

Simply ask in natural language:
- "分析最近的对话"
- "给出会话统计报告"
- "我使用最多的工具是什么？"
- "最近的活动情况怎么样？"

## Technical Details

- Backend: Python `modules/conversation_analyst.py`
- Sessions analyzed: Last 10 sessions from `~/.openclaw/agents/main/sessions/`
- Output: JSON (for machines) + Markdown (for humans)

## Report Sections

1. **Activity Overview** — total messages, user/assistant ratio, duration
2. **Engagement Quality** — assistant/user ratio, memory density
3. **Scoring** — activity / depth / breadth / overall scores
4. **Top Topics** — most frequently discussed themes
5. **Top Tools** — most used tools ranked
6. **Recent Sessions** — per-session breakdown

## Examples

```
Sessions analyzed: 2
Total messages: 829
Engagement ratio: 2.96 (assistant per user)
Top topic: openclaw (42 occurrences)
Top tool: Read (28 calls)
Overall score: 78%
```
