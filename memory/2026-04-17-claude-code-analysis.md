# Claude Code 源码深度分析笔记

> 日期: 2026-04-17
> 源码: `E:\claude-code-main`
> 规模: ~1,900 文件，~512,000+ 行 TypeScript

---

## 一、工具系统实现细节

### 1.1 BashTool 执行管道

```typescript
// BashTool.execute() 核心流程
async *execute(command, options) {
  // 1. 分类器检查
  const classification = await BashClassifier.classify(command)
  
  // 2. 创建子进程
  const proc = spawn('bash', ['-c', command], {
    env: { ...process.env, ...env },
    cwd: options.cwd
  })
  
  // 3. 流式收集 stdout/stderr
  proc.stdout.on('data', (chunk) => {
    const lines = parseProgressLines(chunk)
    for (const line of lines) {
      yield { type: 'progress', content: line }
    }
  })
  
  // 4. 退出码处理
  proc.on('exit', (code) => {
    if (code !== 0) yield { type: 'error', exitCode: code }
  })
}
```

### 1.2 BashClassifier 规则

```typescript
// tools/BashTool/bashPermissions.ts
const RULE_PRIORITY = [
  // 精确匹配拒绝
  { pattern: /^rm -rf \/$/, action: 'deny', confidence: 'high' },
  
  // 允许列表
  { pattern: /^git (status|log|diff|branch)$/, action: 'allow', confidence: 'high' },
  { pattern: /^npm (install|test|run|lint)$/, action: 'allow', confidence: 'high' },
  
  // 模式允许（需确认）
  { pattern: /^rm /, action: 'ask', confidence: 'low' },
]
```

### 1.3 MCPTool 调用

```typescript
async *use(input, context) {
  const client = await mcpClientManager.getClient(this.serverName)
  const result = await client.callTool(this.toolName, input)
  
  if (result._meta?.progress) {
    yield { type: 'progress', ...result._meta }
  }
  
  return { type: 'content', content: formatMcpContent(result.content) }
}
```

---

## 二、权限系统完整流程

### 2.1 PermissionContext

```typescript
interface PermissionContext {
  tool: Tool
  input: Record<string, unknown>
  toolUseContext: ToolUseContext
  toolUseID: string
  
  pushToQueue(item: ToolUseConfirm)
  removeFromQueue()
  updateQueueItem(patch: Partial<ToolUseConfirm>)
  
  handleUserAllow(updatedInput, permissionUpdates, feedback?): Promise<PermissionDecision>
  cancelAndAbort(signal?, fromBridge?): Promise<PermissionDecision>
  
  logDecision(decision, metadata)
  logCancelled()
}
```

### 2.2 interactiveHandler 流程

```typescript
// handleInteractivePermission() 内部
// 1. 生成 bridgeRequestId
// 2. 推送确认队列项到 UI
// 3. 异步运行自动化检查（与 UI 竞速）
// 4. 等待用户交互（onAbort/onAllow/onReject）
// 5. 清理分类器指标
```

### 2.3 Coordinator 权限预审

```typescript
async function handleCoordinatorPermission(params) {
  if (!feature('COORDINATOR_MODE')) return null
  
  const decision = await coordinatorClient.preApprove({
    tool: ctx.tool.name,
    input: updatedInput,
  })
  
  if (decision?.action === 'allow') {
    return ctx.buildAllow(updatedInput, {
      decisionReason: { type: 'coordinator', reason: decision.reason }
    })
  }
  return null
}
```

---

## 三、压缩系统算法

### 3.1 compact() 主逻辑

```typescript
async function compactConversation(messages, model, options) {
  // 1. Token 预算计算
  const contextWindow = getContextWindowForModel(model)
  const maxOutputTokens = getMaxOutputTokensForModel(model)
  const maxInputTokens = contextWindow - maxOutputTokens - 2000
  
  // 2. 当前 token 统计
  const currentTokens = await tokenCountWithEstimation(messages)
  
  // 3. 寻找安全断点
  const chunks = findSafeBreakpoints(messages, tokensToRemove)
  
  // 4. 对每个块生成摘要
  const summaries = await Promise.all(
    chunks.map(chunk => generateSummary(chunk, model))
  )
  
  // 5. 重建消息列表
  return rebuildWithSummaries(messages, chunks, summaries)
}
```

### 3.2 安全断点优先级

```
TOOL_RESULT_PRIORITY = 1    // 工具结果（先删）
USER_MESSAGE_PRIORITY = 2    // 用户消息
ASSISTANT_MESSAGE_PRIORITY = 3  // Assistant 消息
SYSTEM_MESSAGE_PRIORITY = 99 // System 永远保留
```

### 3.3 微压缩

```typescript
const COMPACTABLE_TOOLS = new Set([
  'FileRead', 'Bash', 'Glob', 'Grep',
  'WebSearch', 'WebFetch', 'FileEdit', 'FileWrite',
])

function compactToolResultIfNeeded(result) {
  if (!COMPACTABLE_TOOLS.has(result.toolName)) return result
  
  if (result.toolName === 'Bash' && isImageOutput(result.content)) {
    return { ...result, content: '[Image output truncated]' }
  }
  
  if (result.toolName === 'FileRead' && tokens > 5000) {
    return { ...result, content: keepHeadAndTail(result.content) }
  }
}
```

---

## 四、MCP 协议实现

### 4.1 传输层选择

```typescript
switch (transport) {
  case 'stdio':
    return new StdioClientTransport({ command, args, env })
  case 'streamable-http':
    return new StreamableHTTPClientTransport({ url, auth, headers })
  case 'sse':
    return new SSEClientTransport({ url })
  case 'websocket':
    return new WebSocketTransport({ url, tls, proxy })
}
```

### 4.2 工具调用重试

```typescript
for (let i = 0; i < retries; i++) {
  try {
    return await this.client.callTool(toolName, args)
  } catch (error) {
    if (isMcpSessionExpiredError(error)) {
      await this.ensureConnectedClient()
      continue
    }
    if (i < retries - 1) {
      await sleep(Math.pow(2, i) * 1000)
      continue
    }
    throw error
  }
}
```

---

## 五、会话持久化

### 5.1 消息追加

```typescript
async function appendMessage(entry, options = {}) {
  const line = jsonStringify(serializeEntry(entry)) + '\n'
  const fd = await open(filePath, 'a')
  try {
    await fd.write(line, undefined, 'utf8')
    if (options.fsync) await fd.sync()
  } finally {
    await fd.close()
  }
}
```

### 5.2 墓碑机制

```typescript
// MAX_TOMBSTONE_REWRITE_BYTES = 50MB
// 当文件超过此大小时，将旧消息替换为墓碑标记
async function rewriteTombstones(filePath) {
  const content = await readFile(filePath, 'utf8')
  const lines = content.split('\n')
  
  // 前半部分替换为墓斑
  for (let i = 0; i < midpoint; i++) {
    const entry = jsonParse(lines[i])
    if (isOldTranscriptEntry(entry)) {
      newLines.push(jsonStringify({
        type: 'tombstone',
        originalType: entry.type,
        timestamp: entry.timestamp,
        tokens: estimateTokens(entry)
      }))
    }
  }
}
```

---

## 六、React Hooks 详解

### 6.1 useCancelRequest

```typescript
// Escape/Ctrl+C 处理
// 优先级：
// 1. 有运行中任务 → 取消任务
// 2. 命令队列有内容 → 弹出队列
// 3. 无运行任务 → 取消

// 两击杀 Agent 模式（3 秒窗口）
const KILL_AGENTS_CONFIRM_WINDOW_MS = 3000

useKeybinding('chat:cancel', handleCancel, { context: 'Chat' })
useKeybinding('app:interrupt', handleInterrupt, { context: 'Global' })
useKeybinding('chat:killAgents', handleKillAgents, { context: 'Chat' })
```

### 6.2 usePromptSuggestion

```typescript
// 追踪指标
interface PromptSuggestionState {
  text: string | null
  promptId: string | null
  shownAt: number        // 显示时间
  acceptedAt: number     // 接受时间
  generationRequestId: string | null
}

// 遥测事件
logEvent('tengu_prompt_suggestion', {
  outcome: 'accepted' | 'ignored',
  acceptMethod: 'tab' | 'enter',
  timeToAcceptMs: number,
  timeToFirstKeystrokeMs: number,
})
```

### 6.3 useInputBuffer

```typescript
// Undo/Redo 缓冲
interface BufferEntry {
  text: string
  cursorOffset: number
  pastedContents: Record<number, PastedContent>
  timestamp: number
}

// 防抖 + 限制大小
// currentIndex >= 0 时新推送截断 buffer
```

### 6.4 useHistorySearch

```typescript
// 渐进式历史搜索
// AsyncGenerator 逐条读取
// AbortController 取消
// 必须调用 .return() 关闭文件句柄
closeHistoryReader() // 在 useEffect cleanup 中调用
```

---

## 七、任务系统

### 7.1 DreamTask 状态

```typescript
interface DreamTaskState extends TaskStateBase {
  type: 'dream'
  phase: 'starting' | 'updating'
  sessionsReviewing: number
  filesTouched: string[]  // 不完整变更反射
  turns: DreamTurn[]      // 工具调用已折叠为计数
}

// 注册/更新/完成/失败
registerDreamTask()
addDreamTurn()
completeDreamTask()
failDreamTask()
```

### 7.2 BackgroundTasksDialog 支持的任务

```typescript
type ListItem = 
  | { type: 'local_bash'; ... }
  | { type: 'remote_agent'; ... }
  | { type: 'local_agent'; ... }
  | { type: 'in_process_teammate'; ... }
  | { type: 'local_workflow'; ... }      // WORKFLOW_SCRIPTS
  | { type: 'monitor_mcp'; ... }         // MONITOR_TOOL
  | { type: 'dream'; ... }
  | { type: 'leader'; ... }
```

---

## 八、Buddy 伙伴系统

### 8.1 伙伴生成算法

```typescript
// Mulberry32 种子随机数
function mulberry32(seed: number): () => number

// 稀有度权重
const RARITY_WEIGHTS = {
  common: 60, uncommon: 25, rare: 10, epic: 4, legendary: 1
}

// 伙伴滚动（从 userId 派生确定性随机）
export function roll(userId: string): Roll {
  return rollFrom(mulberry32(hashString(userId + SALT)))
}
```

### 8.2 状态机

```
IDLE: [0,0,0,0,1,0,0,0,-1,0,0,2,0,0,0]  // idle/fidget/blink 序列
  ↓
FIDGET (frame 1-2)
  ↓
BLINK (frame -1 → frame 0 blink)
  ↓
SPEAK (显示气泡 SpeechBubble)
  ↓
PET (点击 → hearts 上升动画)
```

---

## 九、特性开关定义

```typescript
const ALL_FEATURES = [
  { name: 'COORDINATOR_MODE', defaultValue: false, rolloutPercentage: 10 },
  { name: 'KAIROS', defaultValue: false, rolloutPercentage: 5 },
  { name: 'VOICE_MODE', defaultValue: false },
  { name: 'PROACTIVE', defaultValue: false, rolloutPercentage: 20 },
  { name: 'AGENT_TRIGGERS', defaultValue: true },
  { name: 'TRANSCRIPT_CLASSIFIER', defaultValue: false, rolloutPercentage: 50 },
  { name: 'WEB_BROWSER_TOOL', defaultValue: false },
  { name: 'TOKEN_BUDGET', defaultValue: true },
  { name: 'CONTEXT_COLLAPSE', defaultValue: true },
  { name: 'TERMINAL_PANEL', defaultValue: false },
  { name: 'REACTIVE_COMPACT', defaultValue: false, rolloutPercentage: 10 },
  { name: 'BASH_CLASSIFIER', defaultValue: false, rolloutPercentage: 30 },
  { name: 'MCP_SKILLS', defaultValue: false },
  { name: 'REVIEW_ARTIFACT', defaultValue: false },
  { name: 'WORKFLOW_SCRIPTS', defaultValue: false },
  { name: 'MONITOR_TOOL', defaultValue: false },
]
```

---

## 十、关键工具函数

### 10.1 Token 计数

```typescript
async function tokenCountWithEstimation(messages: Message[]): Promise<number> {
  let total = 0
  for (const msg of messages) {
    total += 4  // role + content overhead
    if (typeof msg.content === 'string') {
      total += estimateTokenCount(msg.content)
    } else if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === 'text') {
          total += estimateTokenCount(block.text)
        } else if (block.type === 'image') {
          total += 85  // 图片块固定 token
        }
      }
    }
  }
  return total
}
```

### 10.2 Git 操作

```typescript
findGitRoot(startPath)     // 向上查找 .git，memoize LRU(50)
resolveCanonicalRoot(gitRoot)  // worktree → 主仓库
getBranch()               // 获取当前分支
getStashCount()           // stash 数量
getGitStatus()            // git status --short
isShallowClone()          // 浅克隆检测
getWorktreePaths()        // worktree 列表
```

### 10.3 错误恢复

```typescript
// Token Bucket 速率限制器
class TokenBucket {
  tryConsume(count = 1): boolean
  async consume(count = 1): Promise<void>
  getStatus(): { tokens, capacity, refillRate }
}

// 重试装饰器
function withRetry<T>(fn: () => Promise<T>, config: RetryConfig): Promise<T>
```

---

## 十一、API 客户端

### 11.1 ClaudeAPIClient

```typescript
class ClaudeAPIClient {
  createMessage(params): Promise<AsyncIterable<Message>>
  createMessageWithCache(params, cacheKey)
  tokenCountEstimate(content): Promise<number>
  getProjectContext(path): Promise<ProjectContext>
}
```

### 11.2 重试配置

```typescript
const RETRY_CONFIG = {
  maxRetries: 5,
  baseDelay: 1000,
  maxDelay: 30000,
  factor: 2,
}

const RETRYABLE_ERRORS = [
  'rate_limit_exceeded',
  'transient_failure',
  'prompt_too_long',  // 压缩后可重试
]
```

---

## 十二、测试架构

```
__tests__/
├── unit/           # 单元测试
├── integration/    # 集成测试
└── e2e/           # 端到端测试

测试框架: Bun test + Vitest
```

---

*分析日期: 2026-04-17*
