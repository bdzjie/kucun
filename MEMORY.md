# MEMORY.md — 长期记忆

---

## 关于 Claude Code 源码分析

**补充学习日期**: 2026-04-17（第三轮：CLI Transport + Remote Session + UpstreamProxy + Doctor）

**分析日期**: 2026-04-17
**源码位置**: `E:\claude-code-main`
**规模**: ~1,900 文件，~512,000+ 行 TypeScript
**运行时**: Bun + React + Ink (终端 UI)

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

## 新增覆盖模块（第二轮）

### ExtractMemories 记忆提取
- `extractMemories.ts` — Forked 子 Agent 写入 auto-memory
- 工具限制：Read/Grep/Glob 无限制，Bash 只读，Edit/Write 只允许 auto-memory
- 节流：tengu_bramble_lintel 控制执行频率
- 互斥保护：主 Agent 已写入则跳过

### PromptSuggestion 提示词建议
- `promptSuggestion.ts` — Haiku 生成用户意图预测
- 过滤器：done/meta/evaluative/claude_voice
- 关键：不 override API 参数，否则 cache hit 率从 92.7% 暴跌至 61%

### toolUseSummary 工具摘要
- `toolUseSummaryGenerator.ts` — Haiku 生成工具完成摘要
- 规则：动词过去式 + distinctive 名词，~30 字符

### autoDream 自动记忆整合
- `autoDream.ts` — 后台记忆整合
- Gate：时间（24h）+ 会话数（5）+ 锁
- consolidationLock.ts — 分布式锁机制
- DreamTask 集成进度追踪

### Entrypoints 入口点
- `entrypoints/cli.tsx` — 特殊标志快速路径
- `entrypoints/init.ts` — 完整初始化流水线（17 个步骤）
- Feature 门控：BRIDGE_MODE/DAEMON/BG_SESSIONS/TEMPLATES

### CLI Transport System
- `cli/transports/` — HybridTransport + SSETransport + WebSocketTransport
- 特性：自动重连 + 心跳 + 背压 + 消息缓冲

### StructuredIO SDK 协议
- `cli/structuredIO.ts` — SDK 消息协议
- pendingRequests + resolvedToolUseIds 去重

### Remote Session 远程会话
- `remote/RemoteSessionManager.ts` — 远程 CCR 会话管理
- `server/createDirectConnectSession.ts` — DirectConnect 会话创建

### UpstreamProxy 上游代理
- `upstreamproxy/` — CCR 容器内 HTTPS MITM 代理
- CONNECT-over-WebSocket relay

### OutputStyles 输出样式
- `outputStyles/loadOutputStylesDir.ts` — Markdown 样式加载

### Graceful Shutdown
- `utils/gracefulShutdown.ts` — 信号处理 + 优雅退出

### Doctor 诊断
- `screens/Doctor.tsx` — 诊断检查 UI

---

## 新增覆盖模块（第一轮）

### Keybindings 系统
- 14 个文件：resolver/parser/match/useKeybinding/defaultBindings
- 支持 Chord 多键序列（ctrl+k ctrl+s）
- 19 个 Context（Global/Chat/Settings/Confirmation 等）

### MagicDocs 系统
- `# MAGIC DOC: [title]` 头自动检测
- Post-Sampling Hook 自动更新文档
- 只允许 Edit 工具，限制文件路径

### LSP 系统
- 7 个文件：manager/config/LSPClient/LSPServerInstance/LSPServerManager/LSPDiagnosticRegistry/passiveFeedback
- 插件驱动配置（getAllLspServers 从插件加载）
- 诊断去重：LRU Cache 跨会话去重
- ContentModified 自动重试（最多 3 次）

### 新增 Services
- extractMemories / toolUseSummary / PromptSuggestion
- autoDream / settingsSync / remoteManagedSettings
- teamMemorySync / oauth / tips

### Assistant + CLI
- HybridTransport / SSETransport / WebSocketTransport
- DirectConnect 会话管理

---

## 详细文档

更多内容存储在：

- `memory/claude-code-architecture.md` — 完整架构知识库（包含 42 个章节）
- `memory/2026-04-17-claude-code-analysis.md` — 深度分析笔记

---

## 项目结构

```
src/
├── main.tsx, App.tsx, query.ts, QueryEngine.ts, context.ts, tools.ts
├── coordinator/     — 多 Agent 协调
├── bridge/          — IDE 远程桥接
├── commands/        — /commit, /review 等命令
├── hooks/           — 100+ React Hooks
├── skills/          — 技能系统
├── plugins/         — 插件加载器
├── memdir/          — MEMORY.md 管理
├── migrations/      — 11 个数据迁移脚本
├── voice/           — 语音模式
├── buddy/           — 伙伴系统
├── tasks/           — 7 种任务类型
├── services/
│   ├── api/         — Claude API 客户端
│   ├── compact/     — 上下文压缩
│   ├── mcp/         — MCP 协议客户端
│   ├── analytics/   — 遥测
│   └── tools/       — 工具执行管道
├── state/           — Zustand 状态管理
├── components/      — 439 个 React UI 组件
└── utils/           — ~400 工具函数
```

---

## 关键实现

### 工具执行管道

```
toolHooks.pre() → Tool.use() → toolExecution.onResult() → toolHooks.post()

StreamingToolExecutor.ts — 流式执行器
toolExecution.ts — analytics + blob 存储
toolHooks.ts — pre/post 钩子
```

### 权限决策

```
hasPermissionsToUseTool()
  ├── allow → 直接执行
  ├── deny → 直接拒绝
  └── ask
        ├── BashClassifier
        ├── Coordinator
        ├── Swarm Worker
        └── InteractiveUI
```

### 压缩阈值

```
AUTOCOMPACT_BUFFER_TOKENS = 13_000
WARNING_THRESHOLD = 20_000
ERROR_THRESHOLD = 20,000
MANUAL_COMPACT_BUFFER = 3,000
```

### MCP 传输

```
StdioClientTransport      — 本地进程
StreamableHTTP — HTTP 长连接
SSEClientTransport — Server-Sent Events
WebSocketTransport — WebSocket
```

### 7 种任务类型

```
LocalAgentTask      — Bun 进程内 Agent
RemoteAgentTask     — 远程 API
InProcessTeammate  — 同进程 Swarm
DreamTask          — Marble 规划
QueueAgentTask     — 队列调度
SuspendedAgentTask  — 暂停恢复
BackgroundTask     — 后台任务
```

---

## 特性开关（feature('FLAG')）

```
COORDINATOR_MODE    — 多 Agent 协调
KAIROS             — 实时模式
VOICE_MODE         — 语音输入
PROACTIVE          — 主动模式
BASH_CLASSIFIER    — Bash 命令分类器
CONTEXT_COLLAPSE   — 上下文折叠
REACTIVE_COMPACT   — 反应式压缩
TRANSCRIPT_CLASSIFIER — 转录分类器
MCP_SKILLS         — MCP 技能
REVIEW_ARTIFACT    — 审查产物
WORKFLOW_SCRIPTS   — 工作流脚本
MONITOR_TOOL       — 监控工具
```

---

## React Compiler 模式

所有组件使用 `c as _c` 缓存模式：

```typescript
function Component(t0) {
  const $ = _c(N)  // N = 缓存槽数量
  
  if ($[0] !== dep1 || $[1] !== dep2) {
    $[0] = dep1; $[1] = dep2
    $[2] = compute(dep1, dep2)
  }
  return $[2]
}
```

---

## 学习总结

Claude Code 的设计亮点：

1. **完整性**: 从源码可见一个生产级 AI Agent 的完整工程实现
2. **模块化**: 高度解耦，工具/权限/压缩/MCP 均可独立演进
3. **容错性**: 多层重试、墓碑机制、优雅退出
4. **可观测性**: 完整的 analytics + telemetry
5. **用户可控**: 细粒度权限控制、透明度高

---

## 关于 MemPalace 源码分析

**分析日期**: 2026-04-18
**源码位置**: `E:\mempalace-main`
**规模**: ~25 个核心模块，~15,000 行 Python
**Benchmark**: 96.6% LongMemEval R@5（raw mode，零 API 调用）

### 核心创新

- **记忆宫殿结构**: Wing → Room → Closet → Drawer
- **原始逐字存储**: ChromaDB，96.6% 来自 raw mode
- **Temporal Knowledge Graph**: SQLite 时序三元组，支持时间旅行查询
- **零 LLM 提取**: 5类记忆（decision/preference/milestone/problem/emotional）纯模式匹配
- **WAL 审计**: 每次写入先落日志，支持回滚

### 关键模块

| 模块 | 功能 |
|------|------|
| `miner.py` | 项目文件挖掘（gitignore + 分块 + 路由） |
| `convo_miner.py` | 对话挖掘（exchange-pair 分块） |
| `general_extractor.py` | 5类记忆提取（无 LLM） |
| `entity_detector.py` | 双阶段实体检测（候选提取 → 信号打分） |
| `entity_registry.py` | 持久化实体注册表（onboarding/learned/wiki） |
| `knowledge_graph.py` | 时序 KG（SQLite） |
| `palace_graph.py` | 图遍历（tunnel 发现） |
| `layers.py` | 4层记忆栈（L0~L3） |
| `mcp_server.py` | 19 个 MCP 工具 + WAL |
| `dialect.py` | AAAK 压缩方言 |

### 详细文档

- `memory/mempalace-analysis.md` — 完整架构分析报告

### 可借鉴思想

1. **WAL 审计日志** — 外部写入先落日志，支持审计和回滚
2. **Temporal KG** — 事实带时间戳，支持"2025年的架构决策"时间旅行查询
3. **实体注册表 + Wikipedia 研究** — 未知实体自动查询并缓存
4. **通用记忆分类器** — 纯模式匹配，无 LLM 也可分类
5. **增量挖掘** — 基于 mtime 的增量重挖

---

## OpenClaw 记忆系统 v2 — 已实现

**实现日期**: 2026-04-18
**模块位置**: `memory/memory_system.py` (~790行)

### 核心组件

| 组件 | 文件 | 功能 |
|------|------|------|
| MemoryStack | `memory_system.py` | 统一入口，4层栈 |
| TemporalMemoryStore | `memory_system.py` | 时序记忆存储（Wing/Room/Hall） |
| EntityRegistry | `memory_system.py` | 实体注册表 |
| HallType | `memory_system.py` | 5类→Hall映射 |
| 5类分类器 | `classifier.py` | decision/preference/milestone/problem/emotional |
| WAL审计 | `wal.py` | 写入前置日志 |

### 数据存储（~/.openclaw/memory/）

| 文件 | 内容 |
|------|------|
| `identity.json` | L0身份（name/role/personality/用户偏好） |
| `entity_registry.json` | 实体注册表（person/project/concept） |
| `memories.jsonl` | 时序记忆（append-only） |
| `config.json` | 配置 |

### 4层记忆栈

| 层级 | Token | 内容 |
|------|-------|------|
| L0 Identity | ~28 | 身份+用户+角色 |
| L1 Essential | ~272 | Wing/Room分类的关键记忆 |
| L2 On-Demand | ~200-500/次 | 按wing/room过滤检索 |
| L3 Deep | 无限制 | 全量搜索（当前L2过滤） |

**Wake-up成本**: ~300 tokens（当前）

### Wing/Room 结构

```
wing_user       → preferences, projects, decisions, context
wing_openclaw   → architecture, tools, memory, skills, config
wing_code       → architecture, keybindings, lsp, commands, hooks
wing_mempalace → palace, knowledge_graph, layers, extractor, entity
```

### Hall 类型（5类记忆）

```
hall_facts       ← decision 类型
hall_events      ← milestone/problem/emotional 类型
hall_discoveries ← 突破性洞察
hall_preferences ← preference 类型
hall_advice      ← 建议和解决方案
```

### Temporal 记忆特性

```python
# 支持时间旅行查询
query(as_of="2026-03-15")  # 查询当时有效的记忆

# 支持替代机制
supersede(old_entry_id, new_entry_id)  # 标记旧记忆被替代
valid_from / valid_to  # 时间窗口
```

### 实体注册表

```json
{
  "Administrator": {"type": "person", "confidence": 1.0, "relationship": "雇主"},
  "Claude Code": {"type": "project", "confidence": 1.0},
  "MemPalace": {"type": "project", "confidence": 1.0},
  "Hermes Agent": {"type": "project", "confidence": 1.0}
}
```

### 使用方式

```python
from memory.memory_system import get_stack

stack = get_stack()
stack.remember("用户偏好Markdown格式")  # 自动分类+存储
stack.wake_up()     # L0+L1 唤醒文本
stack.recall(wing='wing_code')  # 检索代码分析记忆
stack.registry.add_entity("新项目", "project")  # 添加实体
```

---

## 工具自注册系统 v3

**构建日期**: 2026-04-18
**灵感**: Hermes Agent 的 AST-based tool discovery

### 架构

```
modules/
├── tool_discovery.py          # Python AST/regex 扫描器
├── tool_registry_autoload.ts  # 9个自注册工具 (TypeScript)
└── discovered_tools.json      # 运行时工具清单
```

### 自注册模式 (Hermes 风格)

```typescript
// 工具模块: import 时自动注册
import { registerTool } from '../registry/index'

registerTool({
  name: 'Read',
  description: 'Read file contents...',
  category: 'filesystem',
  riskLevel: 'low',
  toolset: 'filesystem',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path' },
    },
    required: ['path'],
  },
  async execute(input, ctx) {
    const fs = await import('fs')
    return { success: true, output: fs.readFileSync(...) }
  },
})
```

### tool_discovery.py 扫描器

| 特性 | 说明 |
|------|------|
| **JS/TS** | 正则 + 括号计数处理嵌套对象 |
| **Python** | ast.NodeVisitor 遍历 register_tool() 调用 |
| **注释过滤** | 移除 `//` 和 `/* */` 避免 doc example 假阳性 |
| **字段提取** | `extract_nested_field()` 支持任意深度嵌套 |
| **工具集** | 按 category / toolset 分组统计 |

### 已发现工具 (9个)

| 工具 | 类别 | 工具集 |
|------|------|--------|
| Read | filesystem | filesystem |
| Write | filesystem | filesystem |
| Edit | filesystem | filesystem |
| Glob | filesystem | filesystem |
| Grep | filesystem | filesystem |
| WebFetch | network | network |
| Bash | process | process |
| Remember | memory | memory |
| Recall | memory | memory |

```bash
# 扫描并生成清单
python tool_discovery.py scan --dir modules --output discovered_tools.json

# 查看清单
python tool_discovery.py manifest --tools discovered_tools.json
```

### 与 Hermes 的差异

| 特性 | Hermes Agent | OpenClaw |
|------|-------------|----------|
| 发现方式 | TypeScript compiler API (tSC) | Python regex + ast |
| 注册触发 | 动态 import | 动态 import |
| 工具 schema | 完整 TypeScript 类型 | JSON-compatible schema |
| 执行环境 | Bun | Bun + Python (扫描器) |

---

## L3 Deep Search — BM25 全文搜索

**构建日期**: 2026-04-18

### 架构

```
modules/search/
├── palace_search.ts          # BM25 搜索核心 (PalaceSearch 类)
├── session_memory_bridge.ts  # Session → Memory 桥接
├── sessionSearch.ts          # FTS5 会话搜索
└── types.ts                  # 类型定义
```

### PalaceSearch — BM25 搜索引擎

```typescript
import { PalaceSearch, getGlobalPalaceSearch } from './modules'

const search = getGlobalPalaceSearch()

// 索引文档
search.indexDocument({
  id: 'drawer_001',
  content: '用户偏好 Markdown 格式输出',
  wing: 'wing_user',
  room: 'preferences',
  hall: 'hall_preferences',
})

// 搜索
const results = search.search('Markdown 偏好', {
  wing: 'wing_user',
  limit: 10,
  threshold: 0.1,
})

// results[0].doc.content    // 原始文档
// results[0].score         // BM25 分数
// results[0].snippet       // 上下文摘要
// results[0].highlights    // 高亮片段
```

### BM25 参数

| 参数 | 值 | 说明 |
|------|-----|------|
| k1 | 1.5 | 词频饱和度 |
| b | 0.75 | 文档长度归一化 |
| IDF | log((N-n+0.5)/(n+0.5)+1) | 逆文档频率 |

### 与 palace.ts 的关系

`palace.ts` 的 `searchDrawers()` 现在委托给 `PalaceSearch`:

```typescript
// palace.ts 中的搜索现在使用 BM25
const results = getGlobalPalaceSearch().search(query, { wing, room })
```

---

## Session-Memory 桥接

**文件**: `modules/search/session_memory_bridge.ts`

将 SessionStore 中的会话自动沉淀到 Memory Palace:

```typescript
import { SessionMemoryBridge, startGlobalBridge } from './modules'

// 启动全局桥接
const bridge = await startGlobalBridge()

// 监听事件
bridge.on('session_saved', ({ sessionId, drawerId }) => {
  console.log(`Session ${sessionId} → drawer ${drawerId}`)
})
```

### 自动保存规则

| 触发条件 | 行为 |
|---------|------|
| 会话结束 | 保存会话摘要到 wing_user/sessions |
| 30 分钟沉寂 | 保存沉寂前的内容 |
| 每条新消息 | 实时 BM25 索引 |

---

## Auto-Save 集成

**文件**: `modules/memory/auto_save_integration.ts`

连接 memory hooks → SessionStore → BM25 搜索的完整管道:

```typescript
import { AutoSave } from './modules/memory/auto_save_integration'

const autoSave = new AutoSave({
  sessionId: 'session-123',
  saveInterval: 10,      // 每 10 条消息保存一次
  wing: 'wing_user',
  enableBM25: true,
})

await autoSave.start()

// 每条新消息时调用
await autoSave.onMessage('user', '我决定使用 Postgres')

// 压缩前保存
await autoSave.onPreCompact(fullConversationContent)

// 结束会话
await autoSave.end()
```

### 保存管道

```
onMessage() → triggerHook('message_count')
  ↓ [每 saveInterval 条消息]
executeAutoSave() → Extractor.extractMemories()
  ↓ [按类型分类]
addDrawer(wing, memoryType, content)
  ↓
PalaceSearch.indexDocument() [BM25]
```

### 5 种记忆类型自动分类

| 类型 | 关键词 | Hall |
|------|--------|------|
| DECISIONS | decided, chose, going with, because | hall_facts |
| PREFERENCES | prefer, always, never, my rule | hall_preferences |
| MILESTONES | finally, breakthrough, worked!, achieved | hall_events |
| PROBLEMS | broke, fix, issue, bug, failed | hall_discoveries |
| EMOTIONAL | !, ?, love, hate, feel, think | hall_advice |

---

## AutoSave Agent 集成

**文件**: `modules/memory/auto_save_agent.ts`

将 AutoSave 接入 AIAgent 的最简方式:

```typescript
import { createAutoSaveAgent } from './modules'

const agent = createAutoSaveAgent(
  { id: 's1', name: 'my-agent', type: 'local', model: 'claude-sonnet' },
  { sessionId: 's1', wing: 'wing_user', saveInterval: 10 }
)

const result = await agent.run('帮我写一个 WebSocket 服务器')
await agent.end()  // 自动保存
```

### 回调接线

| AIAgent 回调 | AutoSave 行为 |
|-------------|-------------|
| `onTurnStart` | 记录用户消息 |
| `onTurnEnd` | 记录助手消息 + 工具结果 |
| `onToolCallEnd` | 重要输出(>200字)自动保存 |
| `onInterrupt` | 压缩前紧急保存 |
| `onStatusChange('completed')` | 结束所有 AutoSave |

### 会话迁移

```typescript
import { migrateSessionToMemory } from './modules'

// 服务重启后重建记忆
const drawers = await migrateSessionToMemory('session-id', 'wing_user')
```

---

## palace.ts L3 集成

**变更**:
- `addDrawer()` 自动同步到 BM25 索引
- `searchDrawers()` 替换为 BM25 搜索
- 保留 keyword fallback (BM25 失败时)

```typescript
// 添加记忆 → 自动索引
const drawer = await addDrawer('wing_user', 'preferences', '喜欢 Markdown')
// → BM25 indexDocument() 在后台同步

// 搜索 → BM25
const results = searchDrawers({ query: 'Markdown 偏好', wing: 'wing_user' })
// → PalaceSearch.search() 返回 BM25 排名结果
```

---

## 持久化层

**文件**: `modules/memory/palace.ts`

JSON 文件持久化，重启不丢失:

```
~/.openclaw/memory/palace_state.json
```

| 操作 | 持久化方式 |
|------|-----------|
| `addDrawer()` | 追加到内存 Map，2s 防抖写入 |
| `deleteDrawer()` | 更新内存 Map，2s 防抖写入 |
| 服务重启 | 启动时从 JSON 文件恢复 |
| `flushStorage()` | 强制立即写入 |

```typescript
import { Palace } from './modules/memory/palace'

// 强制保存
Palace.flushStorage()
```

---

## Extractor 质量改进

**文件**: `modules/memory/extractor.ts`

### 改进点

| 改进 | 说明 |
|------|------|
| **带权重标记** | 强标记(如"decided")=2分，弱标记(如"finally")=1分 |
| **最低阈值** | 需要 ≥2 分才分类为具体类型，否则为 general |
| **置信度重算** | `0.4 + score/10 + strongBonus`，无匹配=0.05 |
| **强匹配 bonus** | 每个强标记 +0.1 |
| **最低置信度** | 只保存 confidence ≥0.3 的记忆 |

### 标记权重示例

| 类型 | 强标记(2分) | 弱标记(1分) |
|------|------------|------------|
| decision | we decided, because..., trade-off | better to, approach |
| preference | I prefer, always use, never use | I like, imperative |
| milestone | fixed it, breakthrough, first time ever | finally, demo |
| problem | bug, root cause, the fix was | workaround, that's why |
| emotional | I love, I hate, I feel | angry, sorry |

---

## SessionStore 事件系统

**文件**: `modules/search/sessionSearch.ts`

`SessionStore` 现在继承 `EventEmitter`，支持以下事件:

```typescript
const store = new SessionStore()

store.on('message', (msg) => {
  // msg.sessionId, msg.role, msg.content, msg.timestamp
})

store.on('session_end', ({ sessionId }) => {
  // 会话结束
})

store.appendMessage({ sessionId: 's1', role: 'user', content: 'Hello' })
// → 触发 'message' 事件
```

---

## SQLite FTS5 — Hermes 风格会话全文搜索

**构建日期**: 2026-04-19
**文件**: `modules/search/sqlite_fts5.py` (~500行)

### 架构

```
Python sqlite3 FTS5 (Porter stemmer + Unicode61 tokenizer)
├── BM25 排名算法 (k1=1.5, b=0.75)
├── 会话摘要表 (session_summaries)
├── BM25 统计缓存表
└── CLI bridge (index/search/summary/stats/list)

JS bridge: modules/search/sqlite_fts5.js
Cron集成: scripts/memory_cron.mjs (每6小时重建索引)
```

### CLI 用法

```bash
# 索引所有会话
python modules/search/sqlite_fts5_bridge.py index [sessions_dir] [db_path]

# 搜索
python modules/search/sqlite_fts5_bridge.py search "memory hook" [db_path] [limit]

# 会话摘要
python modules/search/sqlite_fts5_bridge.py summary <session_id> [db_path]

# 统计
python modules/search/sqlite_fts5_bridge.py stats [db_path]

# 列出已索引会话
python modules/search/sqlite_fts5_bridge.py list [db_path]
```

### 索引统计

| 指标 | 值 |
|------|-----|
| 已索引会话 | 2 |
| 已索引消息 | 190 |
| 数据库路径 | `~/.openclaw/memory/fts5.db` |
| 索引更新 | 每6小时 (memory_cron.mjs) |

### BM25 搜索结果示例

```json
[{"session_id": "4f6f0d6c...", "role": "assistant",
  "content": "查看 hooks 配置确认 memory_hook 注册状态：",
  "score": 1.733, "snippet": "..."}]
```

### 与 palace_search.ts 的关系

| 特性 | palace_search.ts (L3) | sqlite_fts5.py (Session) |
|------|---------------------|-------------------------|
| 数据源 | Memory Palace drawers | Session .jsonl 文件 |
| 索引时机 | 记忆存储时 | 定时 (每6h) |
| 算法 | BM25 (JS) | BM25 (SQLite FTS5) |
| 搜索范围 | 长期记忆 | 会话历史 |

---

## Hermes Auto Skill Creator

**构建日期**: 2026-04-19
**文件**: `modules/auto_skill_creator.py` (~450行)

### 核心功能

自动从使用模式中创建技能。检测3类模式：

| 模式 | 触发条件 | 置信度 |
|------|---------|--------|
| repeat_task | 同一任务执行 3+ 次 | 0.5 + count*0.1 |
| preference | 用户明确说明的习惯 | 0.8 |
| tool_chain | 同一工具链 5+ 次使用 | 0.4 + count*0.05 |

### 检测流程

```
detect_repeat_tasks()    → 从 memories.jsonl 检测重复任务哈希
detect_preferences()     → 从记忆检测偏好关键词 (prefer/always/不要/记住)
detect_tool_chains()     → 从会话 .jsonl 检测高频工具序列
        ↓
generate_skill_name()   → 从内容提取关键词生成技能名
create_skill()           → 生成 SKILL.md + handler.js + HOOK.md
_register_skill()         → 写入 skill_registry.json
```

### 已创建技能

| 技能名 | 触发 | 置信度 | 创建时间 |
|--------|------|--------|---------|
| `pref_61e6a00a` | 用户偏好 Markdown 格式输出 | 80% | 2026-04-19 |

### 用法

```bash
# 手动运行
python modules/auto_skill_creator.py

# 输出示例
[auto_skill] Checking for repeat tasks...
[auto_skill] Checking for preferences...
[auto_skill] Checking for tool chains...
[auto_skill] Created: pref_61e6a00a (confidence: 80%)
{"candidates_found": 1, "skills_created": 1, "created_skills": ["pref_61e6a00a"]}
```

### 生成的技能结构

```
skills/pref_61e6a00a/
├── SKILL.md     # 描述、触发模式、证据
├── handler.js   # 导出默认 async 函数
└── HOOK.md      # OpenClaw hook 元数据 (autoCreated: true)
```

---

*最后更新: 2026-04-19*
