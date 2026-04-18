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

*最后更新: 2026-04-18*
