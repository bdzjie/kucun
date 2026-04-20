# MEMORY.md — 长期记忆

*最后更新: 2026-04-20*

---

## 关于 Claude Code 源码分析

**分析日期**: 2026-04-17
**源码位置**: `E:\claude-code-main`
**规模**: ~1,900 文件，~512,000+ 行 TypeScript
**详细分析**: `memory/claude-code-architecture.md`（42章节完整知识库）

---

## 核心架构总结

Claude Code 是一个**流式 AI Agent + 工具化 + 分层权限 + 智能上下文管理**的系统。

### 五大核心支柱

1. **工具化 Agent**: 16 个内置工具（Bash/File/WebSearch/WebFetch/MCP 等）
2. **权限 gating**: 3 层权限模式（safe/skipDev/bypassPermissions）
3. **上下文管理**: Token 预算 + 自动压缩 + 微压缩
4. **流式执行**: AsyncIterable 工具结果 + SSE/MCP 协议
5. **多任务协调**: 7 种任务类型 + Coordinator 模式

### 设计模式

- 管道模式：工具执行（pre-hook → tool → post-hook → analytics）
- 策略模式：查询引擎（local/remote/base）
- 观察者模式：AppState → React 组件
- 中介者模式：Coordinator 管理多 Agent
- 状态机：Buddy 伙伴动画

---

## 关于 MemPalace 源码分析

**分析日期**: 2026-04-18
**源码位置**: `E:\mempalace-main`
**Benchmark**: 96.6% LongMemEval R@5（raw mode，零 API 调用）
**详细分析**: `memory/mempalace-analysis.md`

### 核心创新

- **记忆宫殿结构**: Wing → Room → Closet → Drawer
- **Temporal Knowledge Graph**: SQLite 时序三元组，支持时间旅行查询
- **零 LLM 提取**: 5类记忆纯模式匹配
- **WAL 审计**: 每次写入先落日志

---

## GenericAgent 源码分析

**分析日期**: 2026-04-19
**仓库**: github.com/lsdefine/GenericAgent (~3K 行核心)
**详细分析**: `memory/generic-agent-analysis.md`

### 核心设计亮点

1. **极简工具集**: 7个工具 + code_run动态扩展
2. **生成器循环**: 每轮yield流式输出进度
3. **Token管理**: 每10轮重置last_tools防止膨胀
4. **Skill自举**: 任务完成自动生成SKILL.md沉淀经验

---

## OpenClaw 记忆系统 v2 — 已实现

**实现日期**: 2026-04-18
**模块位置**: `memory/memory_system.py` (~790行)

### 核心组件

| 组件 | 功能 |
|------|------|
| MemoryStack | 统一入口，4层栈 |
| TemporalMemoryStore | 时序记忆存储（Wing/Room/Hall） |
| EntityRegistry | 实体注册表 |
| 5类分类器 | decision/preference/milestone/problem/emotional |

### 数据存储（~/.openclaw/memory/）

| 文件 | 内容 |
|------|------|
| `identity.json` | L0身份 |
| `entity_registry.json` | 实体注册表 |
| `memories.jsonl` | 时序记忆（append-only） |

### 4层记忆栈

| 层级 | Token | 内容 |
|------|-------|------|
| L0 Identity | ~28 | 身份+用户+角色 |
| L1 Essential | ~272 | Wing/Room分类的关键记忆 |
| L2 On-Demand | ~200-500/次 | 按wing/room过滤检索 |
| L3 Deep | 无限制 | 全量BM25搜索 |

---

## 工具自注册系统 v3

**构建日期**: 2026-04-18

```
modules/tool_discovery.py       # Python AST/regex 扫描器
modules/tool_registry_autoload.ts  # 9个自注册工具
discovered_tools.json          # 运行时工具清单
```

### 已发现工具 (9个)

Read / Write / Edit / Glob / Grep / WebFetch / Bash / Remember / Recall

---

## L3 Deep Search — BM25 全文搜索

**构建日期**: 2026-04-18

```
modules/search/palace_search.ts  # BM25 搜索核心
modules/search/session_fts.ts   # 纯JS BM25（ESM兼容）
memory/skill_index.json         # Skill索引（41个技能）
```

### BM25 参数

| 参数 | 值 |
|------|-----|
| k1 | 1.5 |
| b | 0.75 |

---

## Session-Memory 桥接

**文件**: `modules/search/session_memory_bridge.ts`

自动将 SessionStore 中的会话沉淀到 Memory Palace。

### 自动保存规则

| 触发条件 | 行为 |
|---------|------|
| 会话结束 | 保存会话摘要到 wing_user/sessions |
| 30 分钟沉寂 | 保存沉寂前的内容 |
| 每条新消息 | 实时 BM25 索引 |

---

## Hermes Auto Skill Creator

**构建日期**: 2026-04-19

检测3类模式自动创建技能：

| 模式 | 触发条件 | 置信度 |
|------|---------|--------|
| repeat_task | 同一任务执行 3+ 次 | 0.5 + count*0.1 |
| preference | 用户明确说明的习惯 | 0.8 |
| tool_chain | 同一工具链 5+ 次使用 | 0.4 + count*0.05 |

---

## CAP 框架重构（2026-04-20）

基于 T0 学习文档，将 AGENTS.md 从松散结构重构为 CAP 四层：

| 层级 | 英文 | 核心内容 |
|------|------|---------|
| C | Context + Character | 身份/用户/背景/L0 Identity |
| A | Ability + Action | 工具集/29个Skills/行动原则 |
| P | Policy + Protection | 红线/安全机制/群组行为 |
| O | Output + Optimization | Markdown规范/自我进化机制 |

**Skills 安全审计**：30个skills全部通过，无恶意模式

**Skills 总数：41**（截至 2026-04-20）

---

## 实现优先级 (2026-04-20)

### 已完成
- [x] Skill 发现机制 — `modules/skill_indexer.py` + `memory/skill_index.json`
- [x] Hook 热重载 — `scripts/reload-hooks.ps1` + `scripts/watch-hooks.ps1`
- [x] 文档完善 — `docs/reference/gateway-rpc.md` + `skills/gateway-rpc/`
- [x] Rate Limit 缓解 — `modules/clawhub_cache.py` + `scripts/clawhub-cached.ps1`
- [x] Bootstrap 优化 — `memory/archived/detailed-analyses.md` 归档

### 依赖
- [ ] Git remote — Workspace 缺少 push destination

---

*详细历史记录: `memory/archived/detailed-analyses.md`*
