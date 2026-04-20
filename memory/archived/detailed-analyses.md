# MEMORY.md Archived Sections

_Archived 2026-04-20 — Detailed analyses moved here to reduce bootstrap size_

---

## Claude Code Architecture (Full Details)

### Detailed Architecture Notes

**Source**: Lines 38-265 of original MEMORY.md

Claude Code 是一个**流式 AI Agent + 工具化 + 分层权限 + 智能上下文管理**的系统。

#### 五大核心支柱

1. **工具化 Agent**: 16 个内置工具（Bash/File/WebSearch/WebFetch/MCP 等）
2. **权限 gating**: 3 层权限模式（safe/skipDev/bypassPermissions）
3. **上下文管理**: Token 预算 + 自动压缩 + 微压缩
4. **流式执行**: AsyncIterable 工具结果 + SSE/MCP 协议
5. **多任务协调**: 7 种任务类型 + Coordinator 模式

#### 设计模式

- 管道模式：工具执行（pre-hook → tool → post-hook → analytics）
- 策略模式：查询引擎（local/remote/base）
- 观察者模式：AppState → React 组件
- 中介者模式：Coordinator 管理多 Agent
- 状态机：Buddy 伙伴动画

#### 新增覆盖模块（第二轮）

- ExtractMemories 记忆提取
- PromptSuggestion 提示词建议
- toolUseSummary 工具摘要
- autoDream 自动记忆整合
- Entrypoints 入口点
- CLI Transport System
- StructuredIO SDK 协议
- Remote Session 远程会话
- UpstreamProxy 上游代理
- OutputStyles 输出样式
- Graceful Shutdown
- Doctor 诊断

#### 新增覆盖模块（第一轮）

- Keybindings 系统
- MagicDocs 系统
- LSP 系统
- 新增 Services

#### 详细文档

- `memory/claude-code-architecture.md` — 完整架构知识库（包含 42 个章节）
- `memory/2026-04-17-claude-code-analysis.md` — 深度分析笔记

#### 项目结构

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
└── utils/          — ~400 工具函数
```

#### 关键实现

##### 工具执行管道

```
toolHooks.pre() → Tool.use() → toolExecution.onResult() → toolHooks.post()

StreamingToolExecutor.ts — 流式执行器
toolExecution.ts — analytics + blob 存储
toolHooks.ts — pre/post 钩子
```

##### 权限决策

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

##### 压缩阈值

```
AUTOCOMPACT_BUFFER_TOKENS = 13_000
WARNING_THRESHOLD = 20_000
ERROR_THRESHOLD = 20,000
MANUAL_COMPACT_BUFFER = 3,000
```

##### MCP 传输

```
StdioClientTransport      — 本地进程
StreamableHTTP — HTTP 长连接
SSEClientTransport — Server-Sent Events
WebSocketTransport — WebSocket
```

##### 7 种任务类型

```
LocalAgentTask      — Bun 进程内 Agent
RemoteAgentTask     — 远程 API
InProcessTeammate  — 同进程 Swarm
DreamTask          — Marble 规划
QueueAgentTask     — 队列调度
SuspendedAgentTask  — 暂停恢复
BackgroundTask     — 后台任务
```

##### 特性开关（feature('FLAG')）

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

##### React Compiler 模式

所有组件使用 `c as _c` 缓存模式。

##### 学习总结

Claude Code 的设计亮点：
1. **完整性**: 从源码可见一个生产级 AI Agent 的完整工程实现
2. **模块化**: 高度解耦，工具/权限/压缩/MCP 均可独立演进
3. **容错性**: 多层重试、墓碑机制、优雅退出
4. **可观测性**: 完整的 analytics + telemetry
5. **用户可控**: 细粒度权限控制、透明度高

---

## MemPalace Architecture (Full Details)

**Source**: Lines 266-309 of original MEMORY.md

MemPalace 是一个基于记忆宫殿结构的 AI 记忆系统。

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

### 可借鉴思想

1. **WAL 审计日志** — 外部写入先落日志，支持审计和回滚
2. **Temporal KG** — 事实带时间戳，支持"2025年的架构决策"时间旅行查询
3. **实体注册表 + Wikipedia 研究** — 未知实体自动查询并缓存
4. **通用记忆分类器** — 纯模式匹配，无 LLM 也可分类
5. **增量挖掘** — 基于 mtime 的增量重挖

---

## GenericAgent Architecture (Full Details)

**Source**: Lines 310-362 of original MEMORY.md

GenericAgent 是一个极简 AI Agent 框架。

### 关键架构

| 模块 | 功能 |
|------|------|
| `agent_loop.py` | ~100行生成器驱动执行循环 |
| `ga.py` | 7个原子工具：code_run/file_read/file_write/file_patch/web_scan/web_execute_js/ask_user |
| `agentmain.py` | GeneraticAgent 主类 + LLM客户端管理 |
| `TMWebDriver.py` | 真实Chrome注入（保留登录态）|

### 核心设计亮点

1. **极简工具集**: 7个工具 + code_run动态扩展
2. **生成器循环**: 每轮yield流式输出进度
3. **Token管理**: 每10轮重置last_tools防止膨胀
4. **inline_eval**: code_run支持内联eval，减少文件IO
5. **file_patch唯一性**: count==1才执行，防止意外修改
6. **真实浏览器**: TMWebDriver注入，保留登录态
7. **Skill自举**: 任务完成自动生成SKILL.md沉淀经验

### 4层记忆

| 层级 | 内容 |
|------|------|
| L0 Meta | 基础行为规则 |
| L1 Insight | 极简索引 |
| L2 Facts | 长期知识 |
| L3 Skills | 可复用工作流 |

### 自我进化机制

```
新任务 → 自主摸索(安装依赖/写脚本/调试) → 固化为Skill → 下次一句话执行
```

---

## OpenClaw Memory System v2 (Full Details)

**Source**: Lines 363-536 of original MEMORY.md

OpenClaw Memory System v2 已实现统一记忆系统。

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

## Tool Self-Registration System v3 (Full Details)

**Source**: Lines 454-536 of original MEMORY.md

工具自注册系统 v3 构建日期: 2026-04-18

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

---

## L3 Deep Search — BM25 Full Text Search (Full Details)

**Source**: Lines 537-598 of original MEMORY.md

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
```

### BM25 参数

| 参数 | 值 | 说明 |
|------|-----|------|
| k1 | 1.5 | 词频饱和度 |
| b | 0.75 | 文档长度归一化 |
| IDF | log((N-n+0.5)/(n+0.5)+1) | 逆文档频率 |

---

## Session-Memory Bridge (Full Details)

**Source**: Lines 599-626 of original MEMORY.md

文件: `modules/search/session_memory_bridge.ts`

将 SessionStore 中的会话自动沉淀到 Memory Palace。

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

## SQLite FTS5 — Hermes-Style Session Full-Text Search (Full Details)

**Source**: Lines 812-876 of original MEMORY.md

构建日期: 2026-04-19

### CLI 用法

```bash
# 索引所有会话
python modules/search/sqlite_fts5_bridge.py index [sessions_dir] [db_path]

# 搜索
python modules/search/sqlite_fts5_bridge.py search "memory hook" [db_path] [limit]

# 会话摘要
python modules/search/sqlite_fts5_bridge.py summary <session_id> [db_path]
```

### 索引统计

| 指标 | 值 |
|------|-----|
| 已索引会话 | 2 |
| 已索引消息 | 190 |
| 数据库路径 | `~/.openclaw/memory/fts5.db` |
| 索引更新 | 每6小时 (memory_cron.mjs) |

---

## Hermes Auto Skill Creator (Full Details)

**Source**: Lines 877-934 of original MEMORY.md

构建日期: 2026-04-19

### 核心功能

自动从使用模式中创建技能。检测3类模式：

| 模式 | 触发条件 | 置信度 |
|------|---------|--------|
| repeat_task | 同一任务执行 3+ 次 | 0.5 + count*0.1 |
| preference | 用户明确说明的习惯 | 0.8 |
| tool_chain | 同一工具链 5+ 次使用 | 0.4 + count*0.05 |

### 用法

```bash
# 手动运行
python modules/auto_skill_creator.py

# 输出示例
[auto_skill] Checking for repeat tasks...
[auto_skill] Checking for preferences...
[auto_skill] Checking for tool chains...
[auto_skill] Created: pref_61e6a00a (confidence: 80%)
```
