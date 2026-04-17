# TOOLS.md - Local Notes

Skills define _how_ tools work. This file is for _your_ specifics — the stuff that's unique to your setup.

---

## 一、工具系统设计（基于 Claude Code）

### 1.1 工具分类

```typescript
// 工具类型
type ToolCategory = 
  | 'filesystem'  // 文件操作
  | 'network'     // 网络请求
  | 'process'     // 进程管理
  | 'mcp'         // MCP 工具
  | 'skill'       // 技能工具
  | 'agent'       // Agent 调用
```

### 1.2 内置工具清单

| 工具 | 类别 | 说明 |
|------|------|------|
| Bash | process | 执行 Shell 命令 |
| FileRead | filesystem | 读取文件 |
| FileEdit | filesystem | 编辑文件 |
| FileWrite | filesystem | 写入文件 |
| Glob | filesystem | 文件搜索 |
| Grep | filesystem | 内容搜索 |
| WebFetch | network | HTTP GET |
| WebSearch | network | 搜索引擎 |
| MCP | mcp | MCP 服务器工具 |
| Skill | skill | 技能调用 |
| Agent | agent | 子 Agent |

### 1.3 工具执行管道

```
preHook() → Tool.execute() → onResult() → postHook()

前置钩子：参数验证、权限检查
执行：调用工具逻辑
结果处理：结果验证、格式化
后置钩子：日志记录、分析追踪
```

---

## 二、权限系统设计（基于 Claude Code）

### 2.1 权限层级

```typescript
enum PermissionMode {
  SAFE = 'safe',       // 仅安全操作
  ASK = 'ask',         // 执行前询问
  BYPASS = 'bypass'   // 完全信任
}
```

### 2.2 风险等级

```typescript
type RiskLevel = 'low' | 'medium' | 'high' | 'critical'

// 风险评估规则
function assessRisk(tool: string, input: unknown): RiskLevel {
  const safeTools = ['Read', 'Glob', 'Grep']
  const mediumTools = ['Bash']
  const highTools = ['Write', 'Edit']
  
  if (safeTools.includes(tool)) return 'low'
  if (mediumTools.includes(tool)) return 'medium'
  if (highTools.includes(tool)) return 'high'
  return 'critical'
}
```

### 2.3 权限决策

```typescript
interface PermissionRequest {
  tool: string
  input: Record<string, unknown>
  riskLevel: RiskLevel
  timestamp: number
}

interface PermissionResult {
  allowed: boolean | null  // null = 需要询问
  reason?: string
  prompt?: string
}
```

---

## 三、上下文管理设计（基于 Claude Code）

### 3.1 Token 预算

```typescript
interface ContextBudget {
  maxTokens: number           // 最大 Token 数
  usedTokens: number         // 已使用
  warningThreshold: number   // 警告阈值（80%）
  errorThreshold: number     // 错误阈值（100%）
}
```

### 3.2 压缩策略

```typescript
interface CompactionStrategy {
  // 找到安全的消息断点
  findSafeBreakpoint(messages: Message[]): number
  
  // 生成摘要
  generateSummary(messages: Message[]): string
  
  // 执行压缩
  compact(): Promise<void>
}

// 默认阈值
const DEFAULT_BUDGET = {
  maxTokens: 150_000,
  warningThreshold: 120_000,
  errorThreshold: 150_000,
  autoCompact: true
}
```

---

## 四、多 Agent 设计（基于 Claude Code）

### 4.1 Agent 类型

```typescript
type AgentType = 
  | 'local'       // 本地 Bun 进程
  | 'remote'      // 远程 API
  | 'subagent'     // 子 Agent（Fork）
  | 'coordinator'  // 协调者

interface Agent {
  id: string
  type: AgentType
  model?: string
  tools?: Tool[]
  systemPrompt?: string
}
```

### 4.2 任务类型

```typescript
type TaskType =
  | 'local'        // 本地任务
  | 'background'   // 后台任务
  | 'suspended'     // 暂停恢复
  | 'dream'        // 规划任务

interface Task {
  id: string
  type: TaskType
  status: 'pending' | 'running' | 'completed' | 'failed'
  input: unknown
  output?: unknown
}
```

---

## 五、特性开关（基于 Claude Code）

```typescript
// 特性开关
const FEATURES = {
  enhanced_permissions: false,
  context_compaction: false,
  multi_agent: false,
  analytics: true,
  vim_mode: true
}

function feature(name: string): boolean {
  return FEATURES[name] ?? false
}

function getFeatureValue<T>(name: string, defaultValue: T): T {
  return FEATURES[name] ?? defaultValue
}
```

---

## 六、传输层设计（基于 Claude Code）

### 6.1 传输类型

```typescript
type TransportType = 
  | 'websocket'   // WebSocket 全双工
  | 'sse'         // Server-Sent Events
  | 'http'        // HTTP POST

interface Transport {
  connect(): Promise<void>
  send(message: Message): Promise<void>
  onMessage(handler: (msg: Message) => void): void
  close(): void
}
```

### 6.2 重连策略

```typescript
interface ReconnectStrategy {
  maxAttempts: number      // 最大重试次数
  baseDelay: number         // 基础延迟（ms）
  maxDelay: number          // 最大延迟（ms）
  backoff: 'exponential' | 'linear'
}
```

---

## 七、工具注册表

```typescript
// 内置工具注册
const BUILTIN_TOOLS: Tool[] = [
  BashTool,
  FileReadTool,
  FileEditTool,
  FileWriteTool,
  GlobTool,
  GrepTool,
  WebFetchTool,
  WebSearchTool,
]

// 注册工具
function registerTool(tool: Tool) {
  toolRegistry.set(tool.name, tool)
}

// 获取工具
function getTool(name: string): Tool | undefined {
  return toolRegistry.get(name)
}

// 列出所有工具
function listTools(): Tool[] {
  return Array.from(toolRegistry.values())
}
```

---

## 八、Camera 和设备

### 8.1 相机

### 8.2 SSH

### 8.3 TTS

---

## 九、记忆系统设计（基于 MemPalace + Claude Code）

### 9.1 记忆结构（Wing/Room）

```
Wing（翼）  — 项目/人分类（如 wing_claude-code / wing_mempalace）
  └── Room（房间）— 具体话题（如 architecture / memory-system / tools）
        └── Hall（走廊）— 记忆类型
              hall_facts       — 决定的事实
              hall_events     — 会议/里程碑/调试
              hall_discoveries — 突破、新洞察
              hall_preferences — 习惯、偏好、约定
              hall_advice     — 建议和解决方案
```

### 9.2 5类记忆分类

| 类型 | 标记数量 | 典型模式 |
|------|---------|---------|
| DECISION | 22 | "decided to..." "because..." "instead of..." |
| PREFERENCE | 24 | "I prefer..." "always use..." "never do..." |
| MILESTONE | 35 | "it works!" "finally!" "first time..." "built..." |
| PROBLEM | 24 | "bug" "doesn't work" "root cause" "fixed by..." |
| EMOTIONAL | 27+ | "I feel..." "proud" "worried" "love..." |

分类器位置: `memory/classifier.py`

### 9.3 WAL 审计日志

```python
# 每次写入前先落 WAL
WAL_DIR = ~/.openclaw/wal/
WAL_FILE = write_log.jsonl

# 格式
{
  "timestamp": "2026-04-18T07:53:00",
  "operation": "write",
  "file_path": "memory/2026-04-18.md",
  "content_hash": "sha256...",
  "lines_delta": +15,
  "metadata": {"agent": "main", "channel": "webchat"}
}
```

WAL 功能:
- 审计追溯（谁在什么时候写了什么）
- 记忆污染检测（异常写入模式）
- 外部写入回滚

### 9.4 Temporal Memory（时间戳记忆）

```python
# 记忆带时间戳
{
  "content": "决定使用 PostgreSQL",
  "created_at": "2026-04-01",
  "valid_from": "2026-04-01",    # 事实生效时间
  "valid_to": null,               # null = 当前有效
  "superseded_by": null,          # 被新决定替代
}

# 查询特定时间点的事实
query_memories(as_of="2026-03-15")  # 当时有效的记忆
```

### 9.5 4层记忆栈（设计）

| 层级 | Token 估算 | 加载时机 | 内容 |
|------|----------|---------|------|
| **L0** | ~50 | 始终 | AI 身份（who am I） |
| **L1** | ~120 | 始终 | 关键事实（团队、项目、偏好） |
| **L2** | ~500/次 | 按需 | 近期 Room 记忆 |
| **L3** | 无限制 | 按需 | 全量语义搜索 |

Wake-up 成本: L0 + L1 ≈ 170 tokens

### 9.6 实体注册表（设计）

```python
# ~/.openclaw/entity_registry.json
{
  "people": {
    "Administrator": {
      "source": "onboarding",
      "confidence": 1.0,
      "contexts": ["main-user"],
      "relationship": "boss",
    }
  },
  "projects": ["Claude-Code-Analysis", "Mempalace-Study"],
  "ambiguous_flags": ["max", "will", "grace"],
}
```

---

*最后更新: 2026-04-18*
*基于 Claude Code + MemPalace 架构分析*
