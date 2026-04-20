---
name: what am i working on
description: Query the ontology knowledge graph to report current project and task status. Use when asked "what am I working on", "status", "progress", or "show me my tasks".
triggers:
  - what am i working on
  - what am i doing
  - show my tasks
  - project status
  - progress report
  - what are my active projects
command-dispatch: tool
---

# What Am I Working On?

Query the ontology knowledge graph and report structured status.

## Usage

```
/what-am-i-working-on
```

## Output

- **Active Projects**: Currently active work areas
- **In-Progress Tasks**: What needs attention now
- **Blocked Tasks**: Tasks waiting on something
- **Recent Completions**: What finished recently

## Integration

Reads from: `memory/ontology/graph.jsonl`
Query module: `modules/ontology.py`

## Examples

```
User: what am i working on
Assistant: 
- Active: OpenClaw Skills 学习 (in progress)
- 3 tasks in progress
- 5 tasks completed
- 1 task blocked: Apply Skills (waiting on Ontology setup)
```
