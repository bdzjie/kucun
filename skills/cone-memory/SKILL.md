---
name: cone-memory
description: "Query the M-flow Cone Graph memory system. Use when: user asks about past events, decisions, or conversations stored in memory. Provides graph-routed episodic retrieval with vector search. Usage: /memory <query> [episodic|lexical|unified]"
triggers:
  - /memory
  - search memory
  - query memory
  - recall something
  - what do you remember
  - do you remember
---

# Cone Graph Memory Skill

Query the M-flow inspired Cone Graph memory system for episodic recall.

## Usage

```
/memory <query> [mode]
/memory deadline communication
/memory what did Maria say about the deadline
/memory how did Q3 planning go episodic
```

## Modes

| Mode | Algorithm | Best for |
|------|-----------|---------|
| `episodic` (default) | Graph propagation + path-cost scoring | Precise memory recall |
| `lexical` | BM25 keyword search | Simple queries |
| `unified` | Episodic + lexical hybrid | Mixed queries |

## What it does

1. **Router** classifies query granularity → entry layer (Episode / Facet / FacetPoint / Entity)
2. **Vector Search** (TF-IDF + FAISS) finds anchor candidates
3. **Graph Propagation** scores Episodes by strongest evidence path
4. **Bundle** returns top episodes with facets and facetpoints

## Output

Returns structured memory bundle with episode summaries, relevance scores, and linked facets.

## Implementation

- Handler: `memory_query_bridge.py` → calls `MemoryOrchestrator.query()`
- State: `memory_query_state.json` (polled by canvas dashboard)
- Vector index: `memory/cone_vector/cone_vector.npz`
- Graph store: `memory/cone_graph.db`
