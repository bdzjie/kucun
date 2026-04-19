# Obsidian Knowledge Base — GitHub 研究

**分析日期**: 2026-04-19
**核心项目**: agent-second-brain + SwarmVault

---

## 项目发现

### 1. agent-second-brain ⭐ 236

**仓库**: github.com/smixs/agent-second-brain
**核心**: OpenClaw + Obsidian + Telegram + Ebbinghaus 遗忘曲线

#### 创新点

**Ebbinghaus 遗忘曲线记忆**
人类记忆会随时间衰减，除非定期访问。

| Tier | 层级 | 行为 |
|------|------|------|
| **Core** | 核心 | 始终在上下文。当前项目/客户/目标 |
| **Active** | 活跃 | 定期检查。最近的想法/对话 |
| **Warm** | 温热 | 搜索时找到。上个月的笔记/过去的决定 |
| **Cold** | 寒冷 | 仅深度搜索时浮现。旧项目/归档的计划 |
| **Archive** | 归档 | 几乎消失——但偶尔会被随机唤起用于创意连接 |

**Vault Health — 知识库自愈**
- Orphan notes → 自动建议连接
- Broken wiki-links → 自动修复
- MOC 生成 → Maps of Content

**每日处理**: Capture → Classify → Execute → Reflect

---

### 2. SwarmVault — 本地优先 RAG

**仓库**: github.com/swarmclawai/swarmvault
**核心**: Karpathy LLM Wiki 模式的生产级实现

#### 三层架构

```
raw/          — 原始源（不可变）
wiki/         — LLM 生成 + 人类编辑的 markdown
swarmvault.schema.md — 知识库结构定义
```

#### 核心特性

| 特性 | 说明 |
|------|------|
| **知识图谱** | 节点：source/concept/entity/code |
| **矛盾检测** | 自动标记冲突声明 |
| **30+ 输入格式** | 支持任意文件/URL/代码/音视频 |
| **离线运行** | heuristic provider 无需 API |
| **MCP Server** | Claude Code / Codex / OpenClaw 集成 |
| **混合搜索** | SQLite FTS + embeddings |
| **Obsidian 导出** | `graph export --obsidian` |

#### SwarmVault vs agent-second-brain

| 特性 | SwarmVault | agent-second-brain |
|------|------------|--------------------|
| 架构 | 本地 RAG + wiki | OpenClaw + Telegram |
| 记忆 | 知识积累 | Ebbinghaus 衰减 |
| 图谱 | Neo4j + 本地 | Obsidian 内置 |
| 用途 | 研究/文档 | 生活管理 |
| MCP | 是 | 否 |
| 离线 | 是 | 部分 |

---

## OpenClaw 知识库实现

### 模块清单

| 模块 | 功能 | 文件 |
|------|------|------|
| **EbbinghausMemory** | 5层记忆衰减系统 | `modules/knowledge/ebbinghaus_memory.mjs` |
| **VaultHealth** | 知识库自愈/健康分 | `modules/knowledge/vault_health.mjs` |
| **KnowledgeGraph** | 笔记关系图/聚类 | `modules/knowledge/knowledge_graph.mjs` |
| **ObsidianSync** | 双向同步 | `modules/knowledge/obsidian_sync.mjs` |

### Skill

| Skill | 命令 |
|-------|------|
| **obsidian-knowledge** | `--scan\|--orphans\|--daily\|--health\|--stats\|--export-memories\|--generate-moc\|--index` |

### 文件

```
skills/obsidian-knowledge/SKILL.md   — Skill 定义
skills/obsidian-knowledge/handler.js — 命令处理
modules/knowledge/*.mjs              — 4个核心模块
memory/obsidian-knowledge-base-analysis.md — 本文档
```

---

## 可借鉴思想

### 高优先级

| 启发 | OpenClaw 实现 |
|------|-------------|
| **Ebbinghaus 记忆衰减** | `ebbinghaus_memory.mjs` — 5层记忆 |
| **Vault Health** | `vault_health.mjs` — 自愈系统 |
| **知识图谱** | `knowledge_graph.mjs` — 关系图 |
| **MOC 生成器** | `obsidian_sync.mjs` — Map of Content |

### 中优先级

| 启发 | 状态 |
|------|------|
| **Obsidian 同步** | `obsidian_sync.mjs` 已实现 |
| **SwarmVault MCP** | 待集成 |
| **矛盾检测** | 待实现 |

---

*分析完成: 2026-04-19*
