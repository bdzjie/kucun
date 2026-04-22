---
name: expert-router
description: "MoE-inspired task routing with OpenMythos-style reasoning depth control. Classifies incoming tasks and routes to optimal skill chains with configurable depth (fast/normal/deep)."
triggers:
  - /route
  - /expert-router
  - expert routing
  - reasoning depth
  - task classification
---

# Expert Router — MoE-Inspired Task Routing

## Overview

Expert Router implements a **Mixture-of-Experts** routing system for OpenClaw tasks, inspired by OpenMythos's Sparse MoE architecture and reasoning depth control.

## Core Concept

Instead of a single monolithic agent handling everything, Expert Router maintains multiple "expert" skill chains and routes each task to the optimal expert(s).

## Reasoning Depth Modes

| Mode | Tool Calls | Iterations | Use Case |
|------|-----------|------------|----------|
| `fast` | 1 | 1 | Quick answers, simple file ops |
| `normal` | 3 | 3 | Standard tasks, code writing |
| `deep` | 8 | 8 | Deep analysis, research, architecture study |

## Expert Categories

| Expert | Skills | Best For |
|--------|--------|----------|
| `code_expert` | tdd, code-review, debugging, exec-inline | Code writing, review, refactor |
| `analysis_expert` | conversation-analyst, invest, web-scraping | Deep analysis, research |
| `memory_expert` | memory-assistant, fluid-memory, ontology | Memory management, recall |
| `web_expert` | web-scraping, agent-browser | Web search, scraping |
| `file_expert` | windows-gui, git-workflow | File operations |
| `system_expert` | gateway-rpc, studio, sandbox-config | OpenClaw config, skills |

## Usage

```bash
# Route a task (auto-detect depth)
python modules/expert_router.py "帮我写一个 Python 函数计算斐波那契数列"

# Get routing stats
python -c "from modules.expert_router import ExpertRouter; r=ExpertRouter(); print(r.get_stats())"
```

## Integration

The router is called automatically when the Context Manager initializes. Set depth manually:

```python
from modules.context.types import DEPTH_CONFIG

# Override depth for this task
context_budget = {
    **DEFAULT_CONTEXT_BUDGET,
    'reasoningDepth': 'deep'  # Force deep reasoning
}
```

## Architecture

```
User Message
    │
    ▼
┌─────────────────────────┐
│   ExpertRouter.classify │  ← 分析消息，分类任务
└─────────────────────────┘
    │
    ▼
┌─────────────────────────┐
│   RouteResult           │  ← 返回: expert, skills[], depth
└─────────────────────────┘
    │
    ▼
┌─────────────────────────┐
│   ContextManager        │  ← 使用 depth 配置管理 token 预算
│   (depth-aware)         │
└─────────────────────────┘
    │
    ▼
┌─────────────────────────┐
│   should_stop_loop()    │  ← 对应 OpenMythos max_loop_iters
└─────────────────────────┘
```

## Comparison with OpenMythos

| OpenMythos Concept | Expert Router Mapping |
|--------------------|-----------------------|
| `max_loop_iters` | `DEPTH_CONFIG[depth].maxToolCalls` |
| Sparse MoE experts | Expert skill chains |
| Hidden state update | Context budget accumulation |
| Attention routing | Keyword + weight scoring |
