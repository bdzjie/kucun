---
name: memory-assistant
description: >
  Unified memory system CLI — provenance tracking, knowledge graph, GraphRAG retrieval,
  Context Core packaging, feedback-driven weights, and proactive memory activation.
  Use when you need to query, inspect, or manage the full memory pipeline.
triggers:
  - "/memory-assistant --query <text>"
  - "/memory-assistant --status"
  - "/memory-assistant --graph [--mermaid]"
  - "/memory-assistant --provenance <entry-id>"
  - "/memory-assistant --core [--export|--import <path>]"
  - "/memory-assistant --feedback <id> [--used|--rejected]"
  - "/memory-assistant --stats"
  - "/memory-assistant --topics"
  - "/memory-assistant --suggest"
  - "/memory-assistant --bm25 <query>"
---

# memory-assistant — Unified Memory System

## Commands

### `--query <text>`
Full retrieval pipeline: concept extraction → graph traversal → BM25 fallback → proactive suggestions.

### `--status`
Show current memory system status (counts of memories, triples, loaded cores).

### `--graph [--mermaid]`
Display the knowledge graph. With `--mermaid`, output as Mermaid diagram.

### `--provenance <entry-id>`
Show provenance chain for a memory entry (source, confidence, pathway).

### `--core --export [domain] [--path <path>]`
Export current state as a portable Context Core (.core.json).
domain: persona | project | skill | memory | all (default: all)

### `--core --import <path>`
Load a Context Core file into the current runtime.

### `--feedback <id> [--used|--rejected]`
Record feedback on a retrieval result (updates weights dynamically).

### `--stats`
Show feedback statistics: top performing memories, weight distributions.

### `--topics`
Detect current conversation topics.

### `--suggest`
Get proactive memory suggestions for the current conversation.

### `--bm25 <query>`
Direct BM25 search across all memories (L3 deep search).

## Architecture

```
Query → memory_rag (concept extraction + graph traversal)
         ↓
     memory_graph (triples)
         ↓
     memory_provenance (source tracking)
         ↓
     ebbinghaus_memory (wing/room/hall/drawer)
         ↓
     context_core (portable export/import)
         ↓
     context_core_loader (auto-load by project)
         ↓
     memory_feedback (weight feedback loop)
```
