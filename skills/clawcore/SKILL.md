---
name: clawcore
description: Core system enhancements inspired by Claude Code architecture. Implements permission context, token budget management, tool registry, and multi-agent coordination patterns. Use when you need to design or improve OpenClaw's core systems.
metadata:
  {
    "openclaw": {
      "emoji": "⚙️",
      "requires": {},
      "phase": "core"
    }
  }
---

# ClawCore - OpenClaw 核心系统增强

基于 Claude Code 架构的 OpenClaw 核心系统改进实现。

## 模块概览

| 模块 | 说明 | 优先级 |
|------|------|--------|
| Permission | 权限上下文与风险评估 | P0 |
| Context | Token 预算与压缩管理 | P1 |
| Registry | 统一工具注册表 | P2 |
| Coordinator | 多 Agent 协调器 | P3 |

---

## 一、Permission 权限系统

### 1.1 权限上下文

```typescript
// 权限上下文
interface PermissionContext {
  tool: string
  input: Record<string, unknown>
  session: Session
  riskLevel: RiskLevel
  timestamp: number
}

// 风险等级
type RiskLevel = 'low' | 'medium' | 'high' | 'critical'

// 权限决策
type PermissionDecision =
  | { type: 'allow' }
  | { type: 'deny'; reason: string }
  | { type: 'ask'; prompt: string }

// 风险评估规则
function assessRisk(tool: string, input: unknown): RiskLevel {
  const safe = ['Read', 'Glob', 'Grep', 'WebFetch']
  const medium = ['Bash', 'Edit']
  const high = ['Write', 'Delete', 'Agent']
  
  if (safe.includes(tool)) return 'low'
  if (medium.includes(tool)) return 'medium'
  if (high.includes(tool)) return 'high'
  return 'critical'
}
```

### 1.2 权限检查流程

```
hasPermission(tool, input)
  → assessRisk(tool, input)
  → RiskLevel === 'low'  → allow
  → RiskLevel === 'high' → deny
  → RiskLevel === 'medium' → ask
  → RiskLevel === 'critical' → deny
```

### 1.3 使用示例

```typescript
// 检查权限
const decision = await checkPermission({
  tool: 'Bash',
  input: { command: 'rm -rf /' },
  session: currentSession,
  riskLevel: assessRisk('Bash', { command: 'rm -rf /' }),
  timestamp: Date.now()
})

if (decision.type === 'deny') {
  return { error: decision.reason }
}

if (decision.type === 'ask') {
  // 显示确认提示
  const confirmed = await promptUser(decision.prompt)
  if (!confirmed) return { error: 'Permission denied' }
}

// 执行工具
```

---

## 二、Context 上下文管理

### 2.1 Token 预算

```typescript
// 上下文预算
interface ContextBudget {
  maxTokens: number
  usedTokens: number
  warningThreshold: number  // 80%
  errorThreshold: number   // 100%
  autoCompact: boolean
}

// 默认配置
const DEFAULT_BUDGET: ContextBudget = {
  maxTokens: 150_000,
  usedTokens: 0,
  warningThreshold: 120_000,
  errorThreshold: 150_000,
  autoCompact: true
}
```

### 2.2 压缩策略

```typescript
// 压缩结果
interface CompactionResult {
  originalTokens: number
  compactedTokens: number
  summaryTokens: number
  removedMessages: number
}

// 执行压缩
async function compactContext(
  messages: Message[],
  budget: ContextBudget
): Promise<CompactionResult> {
  // 1. 找到安全断点
  const breakpoint = findSafeBreakpoint(messages, budget)
  
  // 2. 提取要压缩的消息
  const toCompact = messages.slice(0, breakpoint)
  
  // 3. 生成摘要
  const summary = await generateSummary(toCompact)
  
  // 4. 替换原始消息
  return {
    originalTokens: countTokens(toCompact),
    compactedTokens: countTokens(summary),
    summaryTokens: countTokens(summary),
    removedMessages: toCompact.length
  }
}

// 找到安全的消息断点
function findSafeBreakpoint(
  messages: Message[],
  budget: ContextBudget
): number {
  let tokens = 0
  for (let i = messages.length - 1; i >= 0; i--) {
    tokens += countTokens(messages[i])
    if (tokens > budget.maxTokens - budget.warningThreshold) {
      return i + 1
    }
  }
  return messages.length
}
```

### 2.3 使用示例

```typescript
// 创建预算管理器
const budget = new ContextBudget(DEFAULT_BUDGET)

// 添加消息
function addMessage(msg: Message) {
  const tokens = countTokens(msg)
  budget.usedTokens += tokens
  
  // 检查阈值
  if (budget.usedTokens >= budget.errorThreshold) {
    throw new Error('Context budget exceeded')
  }
  
  if (budget.usedTokens >= budget.warningThreshold) {
    console.warn('Context budget warning')
    if (budget.autoCompact) {
      compactContext(messages, budget)
    }
  }
}
```

---

## 三、Registry 工具注册表

### 3.1 工具接口

```typescript
// 工具接口
interface Tool {
  name: string
  description: string
  parameters: JSONSchema
  execute(input: unknown, ctx: ToolContext): Promise<ToolResult>
  category?: ToolCategory
  riskLevel?: RiskLevel
}

// 工具类别
type ToolCategory = 
  | 'filesystem'
  | 'network'
  | 'process'
  | 'mcp'
  | 'skill'
  | 'agent'
  | 'other'

// 工具上下文
interface ToolContext {
  session: Session
  permissions: PermissionContext
  budget: ContextBudget
}
```

### 3.2 注册表实现

```typescript
// 工具注册表
class ToolRegistry {
  private tools: Map<string, Tool> = new Map()
  private categories: Map<ToolCategory, Set<string>> = new Map()
  
  // 注册工具
  register(tool: Tool): void {
    this.tools.set(tool.name, tool)
    
    const category = tool.category ?? 'other'
    if (!this.categories.has(category)) {
      this.categories.set(category, new Set())
    }
    this.categories.get(category)!.add(tool.name)
  }
  
  // 获取工具
  get(name: string): Tool | undefined {
    return this.tools.get(name)
  }
  
  // 列出所有工具
  list(category?: ToolCategory): Tool[] {
    if (category) {
      const names = this.categories.get(category) ?? []
      return names.map(n => this.tools.get(n)!).filter(Boolean)
    }
    return Array.from(this.tools.values())
  }
  
  // 按风险等级筛选
  byRiskLevel(level: RiskLevel): Tool[] {
    return this.list().filter(t => t.riskLevel === level)
  }
}

// 全局注册表
const globalRegistry = new ToolRegistry()
```

### 3.3 内置工具注册

```typescript
// 注册内置工具
globalRegistry.register({
  name: 'Bash',
  description: 'Execute shell commands',
  category: 'process',
  riskLevel: 'medium',
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string' }
    }
  },
  execute: async (input, ctx) => {
    // 权限检查
    const decision = await checkPermission({
      tool: 'Bash',
      input,
      ...ctx
    })
    if (decision.type !== 'allow') {
      return { error: decision.reason }
    }
    // 执行命令
    return exec(input.command)
  }
})
```

---

## 四、Coordinator 多 Agent 协调

### 4.1 Agent 类型

```typescript
// Agent 类型
type AgentType = 
  | 'local'       // 本地执行
  | 'remote'      // 远程 API
  | 'subagent'     // 子 Agent
  | 'coordinator' // 协调者

// Agent 配置
interface AgentConfig {
  id: string
  type: AgentType
  model?: string
  tools?: string[]  // 工具名称列表
  systemPrompt?: string
}

// Agent 实例
interface Agent {
  id: string
  type: AgentType
  status: 'idle' | 'running' | 'waiting' | 'stopped'
  config: AgentConfig
  
  run(input: unknown): Promise<AgentResult>
  stop(): void
}
```

### 4.2 任务类型

```typescript
// 任务类型
type TaskType =
  | 'local'        // 本地任务
  | 'background'   // 后台任务
  | 'suspended'    // 暂停恢复
  | 'dream'        // 规划任务

// 任务接口
interface Task {
  id: string
  type: TaskType
  status: 'pending' | 'running' | 'completed' | 'failed'
  agent?: Agent
  input: unknown
  output?: unknown
  createdAt: number
  updatedAt: number
}
```

### 4.3 协调器

```typescript
// 协调器
class Coordinator {
  private agents: Map<string, Agent> = new Map()
  private tasks: Map<string, Task> = new Map()
  
  // 注册 Agent
  registerAgent(agent: Agent): void {
    this.agents.set(agent.id, agent)
  }
  
  // 创建任务
  async createTask(
    type: TaskType,
    input: unknown,
    agentId?: string
  ): Promise<string> {
    const taskId = generateId()
    const agent = agentId ? this.agents.get(agentId) : undefined
    
    const task: Task = {
      id: taskId,
      type,
      status: 'pending',
      agent,
      input,
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
    
    this.tasks.set(taskId, task)
    return taskId
  }
  
  // 执行任务
  async executeTask(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId)
    if (!task) throw new Error(`Task not found: ${taskId}`)
    
    task.status = 'running'
    task.updatedAt = Date.now()
    
    try {
      if (task.agent) {
        const result = await task.agent.run(task.input)
        task.output = result
        task.status = 'completed'
      }
    } catch (error) {
      task.status = 'failed'
      task.output = { error: String(error) }
    }
    
    task.updatedAt = Date.now()
  }
  
  // 获取任务状态
  getTask(taskId: string): Task | undefined {
    return this.tasks.get(taskId)
  }
  
  // 列出所有任务
  listTasks(status?: Task['status']): Task[] {
    const tasks = Array.from(this.tasks.values())
    if (status) {
      return tasks.filter(t => t.status === status)
    }
    return tasks
  }
}
```

---

## 五、Feature Flags 特性开关

```typescript
// 特性开关
const FEATURES: Record<string, boolean> = {
  enhanced_permissions: false,
  context_compaction: false,
  multi_agent: false,
  analytics: true,
  vim_mode: true
}

// 检查特性
function feature(name: string): boolean {
  return FEATURES[name] ?? false
}

// 获取特性值
function getFeatureValue<T>(name: string, defaultValue: T): T {
  return FEATURES[name] ?? defaultValue
}

// 设置特性（运行时）
function setFeature(name: string, value: boolean): void {
  FEATURES[name] = value
}
```

---

## 六、使用示例

```typescript
// 1. 初始化
const coordinator = new Coordinator()

// 2. 注册工具
globalRegistry.register({
  name: 'MyTool',
  description: 'Custom tool',
  category: 'other',
  riskLevel: 'low',
  execute: async (input, ctx) => {
    return { result: 'success' }
  }
})

// 3. 创建任务
const taskId = await coordinator.createTask(
  'local',
  { prompt: 'Hello' },
  'my-agent'
)

// 4. 执行
await coordinator.executeTask(taskId)

// 5. 检查结果
const task = coordinator.getTask(taskId)
console.log(task.status, task.output)
```

---

## 七、实施建议

| 阶段 | 内容 | 时间 |
|------|------|------|
| Phase 1 | Permission + Registry | 1 周 |
| Phase 2 | Context Budget | 1 周 |
| Phase 3 | Coordinator | 2 周 |

---

*基于 Claude Code 架构分析 - 2026-04-17*
