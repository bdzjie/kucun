# OpenClaw 进化指南

> 基于 Claude Code 架构分析的 OpenClaw 改进方案

---

## 一、权限系统进化

### Claude Code 设计

```typescript
// 3 层权限模式
PERMISSION_MODES = {
  safe: '仅允许安全操作',
  ask: '执行前询问',
  bypass: '完全信任'
}

// 权限决策流程
hasPermissionsToUseTool(tool)
  ├── allow → 直接执行
  ├── deny → 直接拒绝
  └── ask → 交互式询问
```

### OpenClaw 现状

- 无精细化权限控制
- 所有操作直接执行或拒绝

### 进化方案

```typescript
// 新增权限上下文
interface PermissionContext {
  tool: string
  input: Record<string, unknown>
  session: Session
  riskLevel: 'low' | 'medium' | 'high' | 'critical'
}

// 权限决策器
async function checkPermission(ctx: PermissionContext): Promise<Decision>

// 决策类型
type Decision =
  | { type: 'allow' }
  | { type: 'deny', reason: string }
  | { type: 'ask', prompt: string }
```

---

## 二、上下文管理进化

### Claude Code 设计

```typescript
// Token 预算
AUTOCOMPACT_BUFFER_TOKENS = 13_000
WARNING_THRESHOLD = 20_000
ERROR_THRESHOLD = 20_000

// 压缩策略
compact()
  → 分析对话历史
  → 找到安全断点
  → 生成摘要
  → 替换原始内容
```

### OpenClaw 现状

- 无上下文大小管理
- 长期对话可能导致性能问题

### 进化方案

```typescript
// 上下文预算
interface ContextBudget {
  maxTokens: number        // 最大 token 数
  warningThreshold: number // 警告阈值
  errorThreshold: number   // 错误阈值
  autoCompact: boolean     // 自动压缩
}

// 压缩策略
interface CompactionStrategy {
  findSafeBreakpoint(messages: Message[]): number
  generateSummary(messages: Message[]): string
  executeCompact(): Promise<void>
}
```

---

## 三、工具系统进化

### Claude Code 设计

```typescript
// 工具注册表
class ToolRegistry {
  tools: Map<string, Tool>
  
  register(tool: Tool)
  get(name: string): Tool
  list(): Tool[]
}

// 工具执行管道
toolHooks.pre() → Tool.use() → toolExecution.onResult() → toolHooks.post()
```

### OpenClaw 现状

- Skills 作为独立模块
- 无统一工具抽象

### 进化方案

```typescript
// 统一工具接口
interface Tool {
  name: string
  description: string
  parameters: JSONSchema
  execute(input: unknown, ctx: Context): Promise<Result>
}

// 工具分类
type ToolCategory = 
  | 'filesystem'  // 文件操作
  | 'network'     // 网络请求
  | 'process'     // 进程管理
  | 'mcp'         // MCP 工具
  | 'agent'       // Agent 调用

// 工具注册表
class ToolRegistry {
  private tools: Map<string, Tool>
  
  register(tool: Tool, category?: ToolCategory)
  unregister(name: string)
  get(name: string): Tool | undefined
  list(category?: ToolCategory): Tool[]
}
```

---

## 四、多 Agent 协调进化

### Claude Code 设计

```typescript
// 7 种任务类型
type TaskType =
  | 'LocalAgentTask'      // 本地 Agent
  | 'RemoteAgentTask'     // 远程 API
  | 'InProcessTeammate'  // 同进程 Swarm
  | 'DreamTask'          // 规划任务
  | 'QueueAgentTask'     // 队列调度
  | 'SuspendedAgentTask'  // 暂停恢复
  | 'BackgroundTask'     // 后台任务

// Coordinator 模式
class Coordinator {
  tasks: TaskManager
  resources: ResourceManager
  
  coordinate(prompt: string): Promise<Result>
}
```

### OpenClaw 现状

- TaskFlow 提供基础任务管理
- 无多样化任务类型

### 进化方案

```typescript
// Agent 类型
type AgentType = 
  | 'local'      // 本地 Bun 进程
  | 'remote'     // 远程 API
  | 'subagent'   // 子 Agent
  | 'coordinator' // 协调者

// 任务接口
interface Task {
  id: string
  type: AgentType
  status: 'pending' | 'running' | 'completed' | 'failed'
  input: unknown
  output?: unknown
}

// 任务协调器
interface TaskCoordinator {
  create(task: Task): Promise<string>
  execute(taskId: string): Promise<void>
  cancel(taskId: string): Promise<void>
  getStatus(taskId: string): TaskStatus
}
```

---

## 五、分析系统进化

### Claude Code 设计

```typescript
// 事件类型
type AnalyticsEvent =
  | { type: 'tool_use', tool: string, duration: number }
  | { type: 'permission_request', tool: string, decision: string }
  | { type: 'api_request', model: string, tokens: number }

// A/B 测试
feature('FLAG_NAME') // 特性开关
getFeatureValue('flag', defaultValue) // 特性值
```

### OpenClaw 现状

- 有限的遥测
- 无特性开关

### 进化方案

```typescript
// 事件追踪
interface Analytics {
  track(event: string, properties?: Record<string, unknown>)
  flush(): Promise<void>
}

// 特性开关
interface FeatureFlags {
  isEnabled(flag: string): boolean
  getValue<T>(flag: string, defaultValue: T): T
}

// 内置特性
FEATURE_FLAGS = {
  'enhanced_permissions': false,  // 增强权限
  'context_compaction': false,   // 上下文压缩
  'multi_agent': false,          // 多 Agent
  'analytics': true              // 分析
}
```

---

## 六、传输层进化

### Claude Code 设计

```typescript
// 多种传输模式
type Transport = 
  | HybridTransport   // WebSocket + HTTP
  | SSETransport      // Server-Sent Events
  | WebSocketTransport // WebSocket 全双工

// 特性
- 自动重连
- 心跳检测
- 消息缓冲
- 背压控制
```

### OpenClaw 现状

- 基础传输
- 无高级特性

### 进化方案

```typescript
// 传输接口
interface Transport {
  connect(): Promise<void>
  send(message: Message): Promise<void>
  onMessage(handler: (msg: Message) => void): void
  close(): void
}

// 重连策略
interface ReconnectStrategy {
  maxAttempts: number
  baseDelay: number
  maxDelay: number
  backoff: 'exponential' | 'linear'
}
```

---

## 七、实施路线图

### Phase 1: 基础增强 ✅ 已完成

- [x] 权限上下文接口 ✅
- [x] 基本风险评估 ✅
- [x] 工具注册表基础版 ✅

### Phase 2: 中级进化 ✅ 已完成

- [x] 完整权限系统 ✅
- [x] Token 预算监控 ✅
- [x] 基础压缩策略 ✅
- [x] 任务协调器 ✅

### Phase 3: 高级特性 ✅ 已完成

- [x] 多 Agent 支持 ✅
- [x] 完整分析系统 ✅
- [x] 特性开关系统 ✅
- [x] 增强传输层 ✅

### Phase 2: 中级进化（3-4 周）

- [ ] 完整权限系统
- [ ] Token 预算监控
- [ ] 基础压缩策略
- [ ] 任务协调器

### Phase 3: 高级特性（5-8 周）

- [ ] 多 Agent 支持
- [ ] 完整分析系统
- [ ] 特性开关系统
- [ ] 增强传输层

---

## 八、优先级建议

| 优先级 | 功能 | 原因 |
|--------|------|------|
| P0 | 权限系统 | 安全关键 |
| P1 | 上下文管理 | 性能关键 |
| P2 | 工具系统 | 可扩展性 |
| P3 | 多 Agent | 高级功能 |
| P4 | 分析系统 | 可观测性 |

---

## 九、MemPalace 记忆系统整合 - 完成

### 来源
MemPalace (E:\mempalace-main) - 96.6% LongMemEval R@5 开源记忆系统

### 已实现模块

```
modules/memory/
├── types.ts          # 类型定义 (Palace + KG + 4-Layer)
├── palace.ts         # 记忆宫殿 (Wings/Rooms/Drawers)
├── knowledgeGraph.ts # 时态知识图谱
├── memoryStack.ts    # 4层记忆栈
├── extractor.ts      # 通用记忆提取器 (5种类型)
├── hooks.ts          # 自动保存钩子
├── memoryManager.ts  # 统一管理器
└── index.ts          # 导出
```

### 核心功能

1. **Palace 结构** - Wing (人/项目) → Room (主题) → Drawer (原文)
2. **Temporal KG** - 实体关系 + valid_from/valid_to 时间窗
3. **4-Layer Stack** - L0 Identity (~50) + L1 Essential (~500) + L2 On-Demand + L3 Deep Search
4. **General Extractor** - 自动分类: decision/preference/milestone/problem/emotional
5. **Auto-Save Hooks** - 每15条消息保存 + 压缩前紧急保存
6. **Entity Registry** - 实体消解 (歧义词/上下文判断)

### 使用示例

```typescript
import { MemoryManager, extractMemories } from './modules/memory'

const memory = new MemoryManager('session-123')

// 保存记忆
await memory.addDrawer('project-x', 'architecture', 'Using microservices')

// 提取记忆类型
const memories = await memory.extractMemories('We decided to switch to...')
// → [{ type: 'decision', content: '...', confidence: 0.8 }]

// 知识图谱
await memory.addTriple('Team', 'decided', 'Microservices')
const facts = await memory.queryEntity('Team')

// 唤醒
const { layer0, layer1 } = await memory.wakeUp()

// 自动保存钩子
memory.onSessionStart()
const decision = await memory.triggerHook('pre_compact')
if (decision.decision === 'block') {
  await memory.preCompactSave(conversationContent)
}
```

---

## 十、参考实现

```typescript
// 示例：权限检查
async function checkPermission(
  tool: string,
  input: Record<string, unknown>
): Promise<PermissionResult> {
  const riskLevel = assessRisk(tool, input)
  
  if (riskLevel === 'low') {
    return { allowed: true }
  }
  
  if (riskLevel === 'high') {
    return { 
      allowed: false, 
      reason: `High-risk operation: ${tool}` 
    }
  }
  
  // Medium risk - ask
  return { 
    allowed: null, 
    prompt: `Allow ${tool}?` 
  }
}

// 示例：Token 预算
class ContextBudget {
  private used = 0
  private readonly max = 150_000
  
  add(tokens: number) {
    this.used += tokens
    if (this.used > this.max * 0.8) {
      this.triggerWarning()
    }
    if (this.used > this.max) {
      throw new Error('Context budget exceeded')
    }
  }
  
  private triggerWarning() {
    console.warn('Context budget warning')
  }
}
```

---

## 十一、实施路线图 (完整版)

### Phase 1: 基础增强 ✅ 已完成

- [x] 权限上下文接口 ✅
- [x] 基本风险评估 ✅
- [x] 工具注册表基础版 ✅

### Phase 2: 中级进化 ✅ 已完成

- [x] 完整权限系统 ✅
- [x] Token 预算监控 ✅
- [x] 基础压缩策略 ✅
- [x] 任务协调器 ✅

### Phase 3: 高级特性 ✅ 已完成

- [x] 多 Agent 支持 ✅
- [x] 完整分析系统 ✅
- [x] 特性开关系统 ✅
- [x] 增强传输层 ✅

### Phase 4: 记忆系统 ✅ 已完成

- [x] Palace 记忆宫殿 ✅
- [x] Temporal KG ✅
- [x] 4-Layer Stack ✅
- [x] General Extractor ✅
- [x] Entity Registry ✅
- [x] Auto-Save Hooks ✅

### Phase 5: 搜索系统 (Hermes FTS5 风格) ✅ 新完成

- [x] FTS5 内存索引 ✅
- [x] 会话存储 (SessionStore) ✅
- [x] 全文搜索 + snippet 高亮 ✅
- [x] 工具自注册 (Hermes 风格) ✅
- [x] 工具集 (Toolsets) 支持 ✅
- [x] OpenAI Function Calling Schema ✅

**新增模块**:
```
modules/search/
├── types.ts          # 搜索类型定义
├── sessionSearch.ts  # FTS5 索引 + 会话存储
└── index.ts          # 导出
```

**增强模块**:
```
modules/registry/      # Hermes 风格重写
├── types.ts          # 增强类型 (Toolset, check_fn)
├── registry.ts       # 自注册 + AST 发现
└── index.ts
```

---

## 十二、进化后状态

| 指标 | 进化前 | 进化后 | 增加 |
|------|--------|--------|------|
| **模块数** | 1 | **9** | +8 |
| **代码文件** | ~10 | **31** | +21 |
| **代码行数** | ~500 | **8,577** | +8,077 |
| **内置工具** | 0 | **10** | +10 |
| **权限模式** | 0 | **3** | +3 |
| **Agent 类型** | 1 | **5** | +4 |
| **任务类型** | 1 | **6** | +5 |
| **记忆类型** | 0 | **5** | +5 |
| **记忆层** | 0 | **4** | +4 |
| **搜索索引** | 0 | **FTS5** | ✅ |

---

*最后更新: 2026-04-17 23:02*
*基于 Claude Code + MemPalace + Hermes Agent 架构分析*


---

## 进化记录 (2026-04-19)

### 1. Session Replay (GenericAgent L4启发)

**来源**: github.com/lsdefine/GenericAgent L4 Session Archive

**实现**:
- scripts/session_replay.py — 纯Python BM25，无FTS5依赖
- skills/session-replay/ — /replay skill

**用法**: /replay <task_description>

**原理**: BM25评分 + Porter词干 + 稀有词分布水印验证

### 2. Memory Watermarking (X-SIR启发)

**来源**: Dive Into LLMs Ch5 X-SIR Watermark

**实现**:
- modules/memory_watermark.py — Statistical watermark (无需LLM)
- hooks/memory-hook/ — addPalaceDrawer存储watermark_seed
- skills/verify-memory/ — /verify-memory skill

**原理**: 
- embed_watermark(content, seed) — 稀有词分布编码
- verify_watermark(content, seed) → authentic/modified/uncertain
- 验证: marked内容100% authentic，原始内容uncertain

### 3. Exec Inline (GenericAgent inline_eval启发)

**来源**: GenericAgent code_run inline_eval

**实现**:
- skills/exec-inline/ — /eval skill

**原理**: 直接node -e执行，无需临时文件

### 4. auto_skill_creator Handler增强

**来源**: GenericAgent Self-Bootstrapping

**实现**:
- modules/auto_skill_creator.py — handler.js模板升级
- GenericAgent风格: confidence + exact+fuzzy匹配 + 证据保留

*最后更新: 2026-04-19 13:55*
