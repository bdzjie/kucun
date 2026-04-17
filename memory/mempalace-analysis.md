# MemPalace 深度分析报告

> 分析日期: 2026-04-18
> 来源: https://github.com/milla-jovovich/mempalace
> 文档: https://mempalace.ai

---

## 一、项目概述

| 指标 | 值 |
|------|-----|
| **开发方** | Milla Jovovich & Ben Sigman |
| **语言** | Python |
| **定位** | AI 记忆系统（Memory System for AI） |
| **核心创新** | 记忆宫殿（Method of Loci）+ 原始逐字存储 |
| **许可证** | MIT |
| **Benchmark** | 96.6% LongMemEval R@5（raw mode，零 API 调用） |

### 核心理念

**"Store everything, then make it findable."**

其他记忆系统让 AI 决定什么值得记住 → MemPalace 让用户保留所有内容，通过结构提供可导航地图。

---

## 二、系统架构

### 2.1 整体架构图

```
┌─────────────────────────────────────────────────────────────────────┐
│                         User / AI Agent                              │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        MCP Server (19 tools)                         │
│  status / list_wings / list_rooms / search / kg_query / diary_*     │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
          ┌────────────────────┼────────────────────┐
          ▼                    ▼                    ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────────┐
│    ChromaDB     │  │     SQLite      │  │    File System          │
│  (mempalace_    │  │  (knowledge_    │  │  ~/.mempalace/         │
│   drawers)      │  │   graph)        │  │  identity.txt           │
│                 │  │                 │  │  entity_registry.json   │
│  Semantic Search│  │  Temporal KG   │  │  write_log.jsonl (WAL)  │
└─────────────────┘  └─────────────────┘  └─────────────────────────┘
          │                    │                    │
          └────────────────────┼────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Palace Graph (Wings → Rooms)                      │
│                                                                      │
│  ┌──────────┐  ──hall──  ┌──────────┐                              │
│  │  Room A  │            │  Room B  │   ← Tunnels跨wing连接         │
│  └────┬─────┘            └──────────┘                                │
│       │                                                                │
│       ▼                                                                │
│  ┌──────────┐      ┌──────────┐                                     │
│  │  Closet  │ ───▶ │  Drawer  │  ← 原始逐字文件                    │
│  └──────────┘      └──────────┘                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.2 目录结构

```
mempalace/
├── palace.py              # ChromaDB 集合操作（读取/去重）
├── searcher.py            # 语义搜索接口
├── miner.py               # 项目文件挖掘（读取/分块/路由）
├── convo_miner.py         # 对话挖掘（exchange-pair 分块）
├── general_extractor.py   # 5类记忆提取（无 LLM）
├── entity_detector.py     # 实体自动检测（双阶段）
├── entity_registry.py      # 持久化实体注册表
├── knowledge_graph.py      # 时序知识图谱（SQLite）
├── palace_graph.py         # 图遍历引擎
├── room_detector_local.py # 本地 Room 检测（无需 API）
├── layers.py               # 4层记忆栈（L0-L3）
├── dialect.py              # AAAK 缩写方言
├── normalize.py            # 对话格式标准化
├── spellcheck.py           # 拼写检查
├── mcp_server.py           # MCP 协议服务器
├── config.py               # 配置管理
├── cli.py                  # CLI 入口
├── onboarding.py           # 初始化引导
├── hooks_cli.py            # 钩子 CLI
├── instructions_cli.py     # 指令 CLI
├── version.py              # 版本
└── instructions/          # 各指令帮助文档
    ├── help.md / init.md / mine.md / search.md / status.md
```

---

## 三、核心模块详解

### 3.1 记忆组织结构（Palace）

```
Wing（翼）
  └── Room（房间）—— 连接同 wing 内的房间
  │     └── Closet（储藏室）—— 摘要，指向原始内容
  │           └── Drawer（抽屉）—— 原始逐字文件
  │
  └── Hall（走廊）—— 5种记忆类型
        hall_facts       — 决定的事实
        hall_events     — 会议/里程碑/调试
        hall_discoveries — 突破、新洞察
        hall_preferences — 习惯、偏好、意见
        hall_advice      — 建议和解决方案
```

**Tunnel（隧道）** — 跨 wing 连接相同 room：

```
wing_kai     / hall_events / auth-migration → "Kai debugged OAuth token refresh"
wing_driftwood / hall_facts / auth-migration → "team decided to migrate to Clerk"
wing_priya   / hall_advice / auth-migration → "Priya approved Clerk over Auth0"
```

### 3.2 存储层

#### ChromaDB（语义搜索）

```
Collection: mempalace_drawers
├── id:         drawer_{wing}_{room}_{sha24(source_file+chunk_index)}
├── document:   原始逐字文本（800字符分块）
├── metadata:
│   ├── wing         — 项目/人名
│   ├── room         — 具体话题
│   ├── source_file  — 原始文件路径
│   ├── chunk_index  — 分块编号
│   ├── added_by     — 挖掘来源
│   ├── filed_at     — ISO 时间戳
│   ├── source_mtime — 文件修改时间（用于增量重挖）
│   ├── hall         — 记忆类型
│   └── importance   — 重要性权重
```

#### SQLite（时序知识图谱）

```sql
CREATE TABLE entities (
    id TEXT PRIMARY KEY,     -- 小写化 name
    name TEXT NOT NULL,
    type TEXT DEFAULT 'unknown',
    properties TEXT DEFAULT '{}',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE triples (
    id TEXT PRIMARY KEY,
    subject TEXT NOT NULL,    -- entity id
    predicate TEXT NOT NULL, -- 关系类型（child_of/works_on/loves）
    object TEXT NOT NULL,    -- entity id
    valid_from TEXT,         -- 有效期起始
    valid_to TEXT,          -- 有效期结束（NULL=当前有效）
    confidence REAL DEFAULT 1.0,
    source_closet TEXT,
    source_file TEXT,
    extracted_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- 索引
idx_triples_subject / idx_triples_object / idx_triples_predicate / idx_triples_valid
```

**Temporal Query（时间旅行查询）**：

```python
# 查询 Max 在 2026年1月 的所有关系
kg.query_entity("Max", as_of="2026-01-15")

# 查询所有当前有效的 "works_on" 关系
kg.query_relationship("works_on")
```

### 3.3 挖掘系统（Miner）

#### 项目挖掘流程

```
scan_project()
  → 遍历文件树
  → .gitignore 模式匹配（GitignoreMatcher）
  → 文件类型过滤（READABLE_EXTENSIONS）
  → 增量挖掘检查（mtime）

process_file()
  → 读取文件（UTF-8，容错）
  → 文件过小检查（<50字符跳过）
  → chunk_text() 分块（800字符/块，100字符重叠）
  → detect_room() 路由到 room
  → add_drawer() 写入 ChromaDB
```

#### 对话挖掘流程

```
mine_convos()
  → normalize() 格式标准化
  → extract_mode:
  │   ├── "exchange" — Q+A 配对分块
  │   └── "general" — 5类记忆提取
  → detect_convo_room() 按话题路由
  → add_drawer() 写入
```

#### Room 路由优先级

```
1. 文件夹路径匹配 room 名称或关键词
2. 文件名匹配 room 名称
3. 内容关键词打分
4. Fallback: "general"
```

#### 本地 Room 检测（无需 API）

```python
FOLDER_ROOM_MAP = {
    "frontend": "frontend", "backend": "backend",
    "docs": "documentation", "tests": "testing",
    "config": "configuration", "deploy": "configuration",
    "meetings": "meetings", "team": "team",
    ...
}

detect_rooms_from_folders()   # 优先：文件夹结构
detect_rooms_from_files()      # 其次：文件名模式
```

### 3.4 实体检测系统（Entity Detector）

#### 双阶段检测

**Pass 1: 候选词提取**

```python
# 提取所有 3+ 次出现的大写词
extract_candidates(text)
  → re.findall(r"\b([A-Z][a-z]{1,19})\b", text)  # 单词
  → re.findall(r"\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b", text)  # 多词
  → STOPWORDS 过滤
  → 频率 >= 3 才保留
```

**Pass 2: 信号打分**

| 信号类型 | Person 分值 | Project 分值 |
|---------|-------------|-------------|
| 对话标记（"Riley said..."） | +3/次 | — |
| 人称动词（"Max laughed..."） | +2/次 | — |
| 代词邻近（pronoun within 3 lines） | +2/次 | — |
| 直接称呼（"hey Max"） | +4/次 | — |
| 项目动词（"built X"） | — | +2/次 |
| 版本号（"MemPal v2"） | — | +3/次 |
| 代码引用（"mempalace.py"） | — | +3/次 |

**分类阈值**：

```python
# 需要 TWO 个不同信号类别才能分类为 person
person_ratio >= 0.7 AND signal_types >= 2 AND person_score >= 5 → person
person_ratio <= 0.3 → project
其他 → uncertain
```

### 3.5 通用记忆提取（General Extractor）

**无需 LLM，纯模式匹配**

| 类型 | 标记词数量 | 典型模式 |
|------|----------|---------|
| DECISIONS | 21 | "we decided to..." "because..." "instead of..." |
| PREFERENCES | 16 | "I prefer..." "always use..." "never do..." |
| MILESTONES | 32 | "it works!" "finally!" "first time..." "built..." |
| PROBLEMS | 22 | "bug" "doesn't work" "root cause" "fixed by..." |
| EMOTIONAL | 27+ | "I love..." "I feel..." "proud" "*markers*" |

**消歧规则**：

```python
# 已解决的问题 → milestone
if memory_type == "problem" and has_resolution(text):
    return "milestone"

# problem + positive sentiment → milestone 或 emotional
if memory_type == "problem" and sentiment == "positive":
    return scores.get("milestone") > 0 ? "milestone" : "emotional"
```

**代码行过滤**：

```python
_CODE_LINE_PATTERNS = [
    r"^\s*\$#",                          # shell prompt
    r"^\s*import|from|def|class",        # code keywords
    r"^\s*```",                          # code blocks
    r"^\s*|",                            # table rows
    r"^\s*if|for|while|try",             # control flow
]
```

### 3.6 实体注册表（Entity Registry）

**持久化实体知识库，3 层来源（优先级递减）**：

```
1. Onboarding     — 用户明确告知（confidence=1.0）
2. Learned        — 从会话历史高置信度推断
3. Wikipedia      — 未知词自动查询（可缓存）
```

**歧义消解**（Common English Words）：

```python
COMMON_ENGLISH_WORDS = {
    "ever", "grace", "will", "bill", "mark",
    "hunter", "river", "ash", "sage", "max", ...
}

PERSON_CONTEXT_PATTERNS = [
    r"\b{name}\s+said\b", r"\b{name}\s+was\b",
    r"\bhey\s+{name}\b", r"\b{name}'s\b",
]
CONCEPT_CONTEXT_PATTERNS = [
    r"\bhave\s+you\s+{name}\b",  # "have you ever"
    r"\bif\s+you\s+{name}\b",    # "if you ever"
]
```

**Wikipedia 研究**：

```python
_wikipedia_lookup(word)
  → REST API: https://en.wikipedia.org/api/rest_v1/page/summary/{word}
  → 页面类型检测（disambiguation / standard）
  → 短语匹配：
      NAME_INDICATOR_PHRASES → person（confidence=0.80-0.90）
      PLACE_INDICATOR_PHRASES → place（confidence=0.80）
  → 404 → 非常用名 → person（confidence=0.70）
```

### 3.7 知识图谱（Knowledge Graph）

**Temporal Entity-Relationship Graph**

```python
kg.add_triple("Max", "child_of", "Alice", valid_from="2015-04-01")
kg.add_triple("Max", "does", "swimming", valid_from="2025-01-01")
kg.add_triple("Max", "loves", "chess", valid_from="2025-10-01")

# 时间旅行查询
kg.query_entity("Max", as_of="2026-01-15")  # 查询某时间点的事实

# 关系失效
kg.invalidate("Max", "has_issue", "sports_injury", ended="2026-02-15")
```

**图谱统计**：

```python
kg.stats()
→ entities / triples / current_facts / expired_facts / relationship_types
```

### 3.8 图遍历引擎（Palace Graph）

**构建图结构**：

```python
build_graph()
→ 遍历 ChromaDB 所有 drawer 元数据
→ 节点：room（-wing 集合，-hall 集合，-count，-dates）
→ 边：跨 wing 的相同 room = Tunnel
```

**遍历查询**：

```python
traverse(start_room="auth-migration", max_hops=2)
→ BFS 遍历
→ 找共享 wing 的连通房间
→ 返回路径列表

find_tunnels(wing_a="wing_kai", wing_b="wing_priya")
→ 找连接两个 wing 的所有 tunnel rooms
```

### 3.9 4层记忆栈（Layers）

| 层级 | Token 估算 | 加载时机 | 来源 |
|------|----------|---------|------|
| **L0** | ~100 | 始终 | `~/.mempalace/identity.txt` |
| **L1** | ~500-800 | 始终 | ChromaDB top-15 权重 drawer |
| **L2** | ~200-500/次 | 按需（wing/room 触发） | ChromaDB wing/room 过滤 |
| **L3** | 无限制 | 按需（显式查询） | ChromaDB 语义搜索 |

**Wake-up 成本**：L0 + L1 ≈ 600-900 tokens → leaves 95%+ context free

```python
stack = MemoryStack()
stack.wake_up()           # L0 + L1
stack.recall(wing="my_app", room="auth")  # L2
stack.search("pricing change")              # L3
```

### 3.10 MCP 服务器

**19 个工具**：

| 读取工具 | 功能 |
|---------|------|
| `mempalace_status` | 总 drawer 数，wing/room 分解 |
| `mempalace_list_wings` | 所有 wing 及 drawer 数量 |
| `mempalace_list_rooms` | wing 内的 rooms |
| `mempalace_get_taxonomy` | wing → room → count 树 |
| `mempalace_search` | 语义搜索，可选 wing/room 过滤 |
| `mempalace_check_duplicate` | 检查内容是否已存在 |
| `mempalace_get_aaak_spec` | AAAK 方言规范 |

| 写入工具 | 功能 |
|---------|------|
| `mempalace_add_drawer` | 写入原始内容到 wing/room |
| `mempalace_delete_drawer` | 按 ID 删除 drawer |

| 知识图谱工具 | 功能 |
|-------------|------|
| `mempalace_kg_query` | 实体查询（支持时间旅行） |
| `mempalace_kg_add` | 添加三元组 |
| `mempalace_kg_invalidate` | 失效旧关系 |
| `mempalace_kg_timeline` | 时间线查询 |
| `mempalace_kg_stats` | 图谱统计 |

| 导航工具 | 功能 |
|---------|------|
| `mempalace_traverse` | 图遍历 |
| `mempalace_find_tunnels` | 跨 wing tunnel 发现 |
| `mempalace_graph_stats` | 图统计 |

| Agent 日记 | 功能 |
|-----------|------|
| `mempalace_diary_write` | 写入会话日记 |
| `mempalace_diary_read` | 读取日记 |

#### WAL（Write-Ahead Log）

```python
# 每次写入前先记 WAL
_wal_log(operation="add_drawer", params={...}, result={...})

# WAL 文件：~/.mempalace/wal/write_log.jsonl
# 用途：审计追溯 / 记忆污染检测 / 外部写入回滚
```

### 3.11 AAAK 方言

**损耗性缩写格式，用于压缩**

```
FORMAT:
  ENTITIES: 3-letter uppercase codes. ALC=Alice, JOR=Jordan
  EMOTIONS: *action markers*. *warm*=joy, *fierce*=determination
  STRUCTURE: Pipe-separated. FAM: family | PROJ: projects | ⚠: warnings
  DATES: ISO format (2026-03-31)
  COUNTS: Nx = N mentions (e.g., 570x)
  IMPORTANCE: ★ to ★★★★★
  HALLS: hall_facts / hall_events / hall_discoveries / hall_preferences / hall_advice

EXAMPLE:
  FAM: ALC→♡JOR | 2D(kids): RIL(18,sports) MAX(11,chess+swimming)
  | BEN(contributor)
```

**注意**：benchmark 96.6% 来自 raw mode，AAAK mode 得分 84.2%（回归 12.4 分）

---

## 四、设计亮点

### 4.1 零 API 调用的语义搜索

- 96.6% LongMemEval R@5 完全来自 ChromaDB 语义搜索
- 无需 LLM 做摘要/提取
- 原始文本直接建索引

### 4.2 Temporal Knowledge Graph

- 事实有时间戳（valid_from/valid_to）
- 支持时间旅行查询
- 关系失效机制（invalidate）

### 4.3 WAL 审计

- 所有写入操作先落 WAL
- 支持记忆污染检测
- 可回滚外部错误写入

### 4.4 本地优先（Local-First）

- 无云服务依赖
- 所有数据在本地
- 100% 离线可用（除 Wikipedia 研究外）

### 4.5 渐进式实体学习

```
1. Onboarding（用户告知）→ confidence=1.0
2. Entity Detector（自动推断）→ confidence=0.5-0.99
3. Wikipedia Research（自动补全）→ confidence=0.7-0.9
4. User Confirmation → 最终确认
```

### 4.6 多挖掘模式

| 模式 | 用途 | 分块策略 |
|------|------|---------|
| `projects` | 代码/文档 | 800字符重叠 |
| `convos/exchange` | 对话 | Q+A 配对 |
| `convos/general` | 对话 | 5类记忆提取 |

---

## 五、与 OpenClaw 记忆系统的对比

| 维度 | MemPalace | OpenClaw（当前） |
|------|-----------|----------------|
| **存储** | ChromaDB + SQLite | MEMORY.md 文件 |
| **搜索** | 语义搜索（ChromaDB） | 全文搜索 + 语义搜索 |
| **组织** | Wing/Room/Hall/Drawer 结构 | 线性文件 + 文件夹 |
| **知识图谱** | Temporal KG（SQLite） | 无 |
| **提取** | 5类模式匹配（无需 LLM） | 无自动分类 |
| **4层记忆** | L0-L3 渐进加载 | 无分层 |
| **实体消歧** | Context patterns + Wikipedia | 无 |
| **AAAK** | 压缩格式（损耗性） | 无 |
| **WAL** | 完整审计日志 | 无 |
| **安装** | pip + MCP 协议 | 内置 |
| **Benchmark** | 96.6% LongMemEval | 无公开 benchmark |

---

## 六、关键设计决策记录

### 6.1 为什么用 ChromaDB 而不是向量数据库？

- 本地持久化（PersistentClient）
- 简单部署（pip install）
- 元数据过滤强大（wing/room/hall 多维过滤）
- 与 SQLite 组合形成"向量+结构化"双存储

### 6.2 为什么优先 raw mode 而非摘要？

- LLM 摘要会丢失上下文
- 96.6% vs 84.2% 的 benchmark 差距证明原始文本的价值
- 摘要只是 closet 层，指向 drawer 而非替代

### 6.3 为什么不用外部 KG 数据库（Neo4j）？

- SQLite 本地免费，Neo4j 云服务 $25/月+
- 时序查询性能足够
- 零依赖

### 6.4 Hall 为什么固定 5 种？

- 通用记忆类型的最小完备集
- 覆盖事实/事件/发现/偏好/建议
- 跨 wing 一致，方便 tunnel 发现

---

## 七、可借鉴思想

### 7.1 WAL 审计日志
任何外部写入操作先落 WAL，用于审计和回滚。

### 7.2 Temporal KG
事实带时间戳，支持时间旅行查询（"2025年的架构决策是什么"）。

### 7.3 实体注册表 + Wikipedia 研究
未知实体自动 Wikipedia 查询并缓存。

### 7.4 通用记忆分类器
5类模式匹配，无需 LLM 即可分类记忆。

### 7.5 增量挖掘
基于 mtime 的增量重挖，避免重复处理。

---

*最后更新: 2026-04-18*
