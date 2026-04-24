# FlowElement-ai/m_flow 分析笔记

**分析日期**: 2026-04-24
**仓库**: github.com/FlowElement-ai/m_flow
**Star**: (未获取)
**定位**: Bio-inspired Cognitive Memory Engine — Graph RAG 新范式

---

## 核心创新

**Path-Cost 检索** vs 传统相似度匹配：

```
传统 RAG：Query → 向量最近邻 → Flat ranking
M-flow：    Query → 向量入口 → 图传播 → 按最强证据链评分
```

**核心洞察**：similar ≠ relevant。相关 = 能通过连贯的证据链连接到查询。

---

## 四层锥图（Cone Graph）

```
Episode（事件/决策/工作流）
    ↑
Facet（一个主题维度）
    ↑
FacetPoint（原子断言）
    ↑
Entity（跨 Episode 链接的命名实体）
```

| 层 | 捕获 | 查询示例 |
|----|------|---------|
| Episode | 有界语义焦点 | "Q3 规划怎么样了" |
| Facet | 主题切面 | "deadline 沟通问题" |
| FacetPoint | 原子事实 | "'我没被告知 deadline'" |
| Entity | 跨 Episode 实体 | "关于 Maria 的所有事" |

---

## 核心技术特性

1. **Coreference 解决**：代词在摄取时解析为具体先行词
2. **Face-aware 分区**：生物识别自动路由到个人记忆分区
3. **Procedural Memory**：提取可复用抽象模式（习惯/工作流/决策规则）
4. **5 种检索模式**：episodic/procedural/triplet/lexical/cypher
5. **多 DB 支持**：Neo4j/PostgreSQL/pgvector/LanceDB/ChromaDB/Pinecone

---

## Benchmark

| 测试集 | M-flow | Cognee | Zep | Mem0 |
|--------|--------|--------|-----|------|
| LoCoMo-10 | **81.8%** | 79.4% | 73.4% | 67.1% |
| LongMemEval | **89%** | 57% | 61% | 71% |

---

## 项目结构

```
m_flow/core/models/     # Episode, Facet, FacetPoint, Entity, Edge
m_flow/memory/
  ├── episodic/          # 情景记忆处理
  └── procedural/        # 程序性记忆处理
m_flow/retrieval/
  ├── episodic_retriever.py   # 图路由 Bundle Search
  ├── procedural_retriever.py
  ├── memory_orchestrator.py  # 检索编排器
  └── gating/                 # 门控机制
m_flow-frontend/         # Next.js Web Console
m_flow-mcp/             # MCP Server
```

---

## 对 OpenClaw 的启发

| 特性 | 参考模块 |
|------|---------|
| Cone Graph 四层 | `modules/memory/lineage.ts` 可扩展 |
| Path-cost 检索 | 现有 BM25 flat ranking 可增强 |
| Coreference | `memory/memoryStack.ts` 需指代消解 |
| Procedural Memory | `skill-evolution` 思路相似 |
| Multi-DB 适配器 | `modules/invest/data_connectors.py` 模式 |

---

## 集成方案

已生成：`memory/MEMORY-M-FLOW-INTEGRATION.md`

核心实现计划：
1. Phase 1：`cone_graph.py` + `coreference.py`
2. Phase 2：`granularity_router.py` + `graph_propagator.py` + `orchestrator.py`
3. Phase 3：UI 集成到 `routing-dashboard.html`
4. Phase 4：Benchmark 对比测试

---
