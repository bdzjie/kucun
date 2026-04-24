# M-flow Cognitive Memory Integration Proposal

**Date**: 2026-04-24
**Author**: Q仔 (AI 商务助理)
**Status**: Draft

---

## 1. 背景与目标

### 现状

OpenClaw 当前记忆系统：
- **MemPalace**：Wing → Room → Closet → Drawer 四层层级结构
- **Temporal Knowledge Graph**：SQLite 时序三元组，支持时间旅行查询
- **BM25 全文搜索**：L3 Deep Search
- **Lineage DAG**：记忆依赖追踪（OpenMetadata 启发）

### 问题

1. **Flat BM25 Ranking**：当前 L3 Deep Search 是 flat 相似度排序，无法捕捉"证据链强度"
2. **无指代消解**：代词（他/她/它）无法关联到具体实体
3. **无层级检索路由**：query 不知道该匹配哪个粒度层
4. **无记忆关联传播**：A 记忆和 B 记忆的关系只能通过显式 link，无法通过图传播发现隐含关联

### M-flow 核心借鉴

> **相似 ≠ 相关**。M-flow 的核心洞察： relevance = 最强证据链，而不是最高相似度。

---

## 2. 设计原则

1. **不破坏现有结构**：MemPalace 4 层 + Temporal KG 保持不变
2. **增量扩展**：新增 M-flow 层作为检索增强
3. **可选开关**：现有 BM25 检索保持默认，新检索模式通过 flag 启用
4. **Python-first**：核心算法用 Python 实现（与现有 `modules/invest/` 一致）

---

## 3. 目标架构

```
OpenClaw Memory (after enhancement)
├── MemPalace (existing 4-layer structure)
│   ├── Wing / Room / Closet / Drawer
│   └── Temporal KG (SQLite)
│
├── M-flow Cone Graph (NEW)
│   ├── Entity Layer    ← 跨记忆的命名实体（人/工具/项目）
│   ├── FacetPoint      ← 原子断言（可独立引用的事实）
│   ├── Facet           ← 主题维度（关联的 FacetPoints）
│   └── Episode         ← 有界记忆束（一个完整事件/决策/会话）
│
├── Retrieval Orchestrator (NEW)
│   ├── Granularity Router     ← 根据 query 粒度路由
│   ├── Graph Propagator       ← 证据链传播评分
│   └── Bundle Assembler       ← 组装 Episode 返回
│
├── Coreference Resolver (NEW)
│   └── 代词 → 实体 消解（摄取时）
│
└── BM25 + Lineage (existing, fallback)
```

---

## 4. 核心模块设计

### 4.1 Cone Graph（锥图）

新增 `modules/memory/cone_graph.py`：

```python
class Entity:
    """跨 Episode 链接的命名实体"""
    id: str
    name: str
    type: str  # person / tool / project / concept
    episode_ids: list[str]  # 关联的 Episode


class FacetPoint:
    """原子断言/事实"""
    id: str
    content: str  # 原始文本
    entity_ids: list[str]  # 关联的 Entity
    facet_id: str


class Facet:
    """一个主题维度"""
    id: str
    topic: str  # "deadline沟通" / "性能问题"
    facetpoint_ids: list[str]
    episode_id: str


class Episode:
    """有界记忆束"""
    id: str
    summary: str  # 摘要
    facet_ids: list[str]
    source_session: str
    timestamp: datetime
    score: float = 0  # 图传播计算的分值


class EvidenceEdge:
    """带语义的边（不只是结构关系）"""
    source_id: str
    target_id: str
    edge_type: str  # "caused_by" / "contradicts" / "refines" / "mentions"
    edge_text: str  # "Maria mentioned deadline was missed"
    propagation_cost: float  # 传播代价
```

**数据存储**：SQLite（与现有 Temporal KG 共用 DB）

### 4.2 Granularity Router（粒度路由器）

根据 query 特征自动路由到正确层：

```python
def route_query(query: str) -> RetrievalLayer:
    """
    Broad query  → Episode (直接匹配摘要，penalized)
    Mid query    → Facet (主题维度的关键词匹配)
    Precise query → FacetPoint (原子事实精确匹配)
    Entity query → Entity (跨 Episode 搜索)
    """
    # 实现：规则 + embedding 分类
    pass
```

| Query 类型 | 入口层 | 策略 |
|-----------|--------|------|
| "Q3 规划怎么样了" | Episode | 直接匹配，penalized |
| "deadline 沟通问题" | Facet | 主题匹配 |
| "'我没被告知 deadline'" | FacetPoint | 精确锚点 |
| "关于 Maria 的所有事" | Entity | 跨 Episode 桥接 |

### 4.3 Graph Propagator（图传播器）

```python
class GraphPropagator:
    """
    核心算法：基于证据链强度的路径评分
    1. 在入口层找到锚点
    2. 沿边传播，计算每条路径的累积 cost
    3. 每个 Episode 得分 = 最强（最低 cost）路径
    """
    def propagate(self, anchor_id: str, max_hops: int = 3) -> dict[str, float]:
        """
        返回: {episode_id: path_cost}
        """
        pass
```

**Path Cost 公式**：
```
EpisodeScore = min(path_cost for all evidence paths)
path_cost = Σ(edge.propagation_cost for each hop)
```

### 4.4 Coreference Resolver（指代消解器）

摄取时解决代词，存入 FacetPoint 时使用实体名替换：

```python
def resolve_coreference(session_text: str, known_entities: list[Entity]) -> str:
    """
    Input: "She said she wasn't told about the change"
    Output: "Maria said Maria wasn't told about the deadline change"

    使用滑动窗口 + 实体消歧（轻量实现，不依赖重型 NLP）
    """
    pass
```

### 4.5 Retrieval Orchestrator（检索编排器）

```python
class MemoryOrchestrator:
    """
    统一检索入口：
    1. Granularity Router 确定入口层
    2. 向量搜索找到候选锚点
    3. Graph Propagator 传播计算 Episode 分值
    4. Bundle Assembler 组装 Episode + Facets + FacetPoints
    """

    async def query(self, text: str, mode: str = "episodic") -> MemoryBundle:
        """
        返回 MemoryBundle:
        {
            episodes: [Episode],
            facets: [Facet],
            facetpoints: [FacetPoint],
            entities: [Entity],
            scores: {episode_id: path_cost}
        }
        """
        pass
```

---

## 5. 检索模式

| 模式 | 算法 | 适用场景 |
|------|------|---------|
| `episodic` | Cone Graph + Path Cost | 主模式，精确记忆检索 |
| `procedural` | Abstract Pattern Extraction | 工作流/习惯/决策规则 |
| `lexical` | BM25 (现有 fallback) | 关键词搜索 |
| `unified` | Episodic + Lexical 混合 | 混合检索 |

---

## 6. 与现有模块的集成

### 6.1 集成点

| 现有模块 | 集成方式 |
|---------|---------|
| `modules/memory/memoryStack.ts` | 新增 `add_to_cone_graph()` 写入 |
| `modules/search/palace_search.ts` | 新增 `cone_graph_search()` 检索 |
| `modules/ontology.py` | Entity 与 ontology 共用 Entity 模型 |
| `modules/memory/lineage.ts` | Lineage DAG 可转换为 EvidenceEdge |
| `skills/invest/stock_data.py` | 可复用 Python-first 架构 |

### 6.2 数据流

```
记忆摄取时：
Session Text → Coreference Resolver → Cone Graph Builder → SQLite

记忆检索时：
Query → Granularity Router → Vector Search (候选) → Graph Propagator → Bundle
```

---

## 7. 实现计划

### Phase 1：基础设施（1-2天）
- [ ] `modules/memory/cone_graph.py` — 域模型 + SQLite 存储
- [ ] `modules/memory/coreference.py` — 轻量指代消解
- [ ] 单元测试（pytest）

### Phase 2：检索核心（2-3天）
- [ ] `modules/memory/granularity_router.py` — 粒度分类
- [ ] `modules/memory/graph_propagator.py` — 图传播算法
- [ ] `modules/memory/orchestrator.py` — 统一检索入口
- [ ] BM25 Fallback 集成

### Phase 3：UI 集成（1-2天）
- [ ] `routing-dashboard.html` — 新增 M-flow 检索面板
- [ ] 记忆写入时自动构建 Cone Graph

### Phase 4：Benchmarks（1天）
- [ ] 对比现有 BM25 vs M-flow 检索准确率
- [ ] LoCoMo-10 / LongMemEval 基准测试适配

---

## 8. 风险与备选

| 风险 | 缓解 |
|------|------|
| 图传播性能（大规模记忆） | 限制 max_hops=3，缓存热点路径 |
| Coreference 准确率 | 轻量规则优先，复杂场景 fallback BM25 |
| 实现复杂度 | Python-first，与现有模块风格一致 |

---

## 9. 参考

- M-flow 原版：`FlowElement-ai/m_flow`
- 检索架构文档：`docs/RETRIEVAL_ARCHITECTURE.md`
- 现有 MemPalace：`modules/memory/memoryStack.ts`
- 现有 Lineage DAG：`modules/memory/lineage.ts`

---

*Generated: 2026-04-24*
