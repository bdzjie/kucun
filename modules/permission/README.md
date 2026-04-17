# Permission Module - OpenClaw 权限模块

基于 Claude Code 权限系统设计的 OpenClaw 核心模块。

## 📦 模块结构

```
modules/permission/
├── types.ts       # 类型定义
├── assessor.ts   # 风险评估器
├── manager.ts    # 权限管理器
├── index.ts     # 导出 & 示例
└── README.md    # 本文件
```

## 🚀 快速开始

### 1. 导入

```typescript
import {
  PermissionManager,
  PermissionMode,
  checkPermission,
  type PermissionContext,
} from './modules/permission'
```

### 2. 创建管理器

```typescript
const pm = new PermissionManager({
  defaultMode: PermissionMode.ASK,
  askTimeout: 60000,  // 1 分钟
})
```

### 3. 检查权限

```typescript
const context: PermissionContext = {
  tool: 'Bash',
  input: { command: 'ls -la' },
  timestamp: Date.now(),
  riskLevel: 'medium',
  category: 'process',
}

const decision = await pm.checkPermission(context)

switch (decision.type) {
  case 'allow':
    // 执行操作
    break
  case 'deny':
    console.error('拒绝:', decision.reason)
    break
  case 'ask':
    // 显示询问提示
    showPrompt(decision.prompt)
    break
}
```

### 4. 用户响应

```typescript
// 用户允许
pm.respond(requestId, 'allow')

// 用户拒绝
pm.respond(requestId, 'deny')

// 用户取消
pm.respond(requestId, 'cancel')
```

## ⚙️ 配置

### 权限模式

```typescript
enum PermissionMode {
  SAFE = 'safe',      // 仅允许低风险操作
  ASK = 'ask',        // 执行前询问
  BYPASS = 'bypass',  // 完全信任（危险）
}
```

### 风险等级

```typescript
type RiskLevel = 'low' | 'medium' | 'high' | 'critical'

// 低风险: Read, Glob, Grep, WebFetch
// 中风险: Bash, Edit, Write
// 高风险: Delete, Agent, MCP
// 极高风险: sudo, rm -rf, curl | sh
```

## 📝 规则

### 添加规则

```typescript
pm.addRule({
  id: 'my-rule',
  name: 'My Custom Rule',
  tools: ['Bash'],
  allowedRiskLevels: ['low', 'medium'],
  defaultDecision: 'allow',  // 'allow' | 'deny' | 'ask'
  enabled: true,
  priority: 10,  // 数字越大优先级越高
})
```

### 允许/拒绝列表

```typescript
// 允许特定工具
pm.addToAllowList('Read')
pm.addToAllowList('Bash:ls')
pm.addToAllowList('Bash:git')

// 拒绝特定工具
pm.addToDenyList('Bash:rm')
pm.addToDenyList('Bash:dd')
```

## 🔧 风险评估

### 自定义工具等级

```typescript
const assessor = new RiskAssessor()

assessor.setToolLevel('MyTool', 'high')
assessor.setCategoryLevel('filesystem', 'medium')
```

### 添加风险规则

```typescript
assessor.addRule({
  pattern: /^find.*-delete/,
  level: 'high',
  reason: 'Delete operations in find',
})
```

## 📊 事件

```typescript
pm.on('request', (event) => {
  console.log('权限请求:', event.context.tool)
})

pm.on('ask', ({ requestId, context, prompt }) => {
  // 显示给用户
  showPermissionPrompt(prompt)
})

pm.on('allow', (event) => {
  console.log('已允许:', event.context.tool)
})

pm.on('deny', (event) => {
  console.log('已拒绝:', event.context.tool)
})

pm.on('timeout', (event) => {
  console.log('请求超时')
})
```

## 🔗 集成

### 工具执行集成

```typescript
async function executeToolWithPermission(
  tool: string,
  input: Record<string, unknown>,
  category: ToolCategory
) {
  const context = pm.createContext(tool, input, category)

  const decision = await pm.checkPermission(context)

  if (decision.type === 'allow') {
    return executeTool(tool, input)
  }

  if (decision.type === 'ask') {
    // 等待用户响应
    return new Promise((resolve, reject) => {
      pm.once('allow', () => resolve(executeTool(tool, input)))
      pm.once('deny', () => reject(new Error('Permission denied')))
    })
  }

  throw new Error(decision.reason)
}
```

### 中间件集成

```typescript
function permissionMiddleware(tool: string) {
  return async (ctx, next) => {
    const context = pm.createContext(tool, ctx.request.body, 'process')
    const decision = await pm.checkPermission(context)

    if (decision.type === 'allow') {
      return next()
    }

    ctx.status = 403
    ctx.body = { error: decision.reason }
  }
}
```

## 📈 历史记录

```typescript
// 获取最近 100 条记录
const history = pm.getHistory(100)

// 获取特定请求
const request = pm.getRequest(requestId)
```

## 🔒 安全建议

1. **生产环境使用 ASK 或 SAFE 模式**
2. **BYPASS 模式仅用于可信环境**
3. **定期审查 allowList 和 denyList**
4. **监控权限请求历史**
5. **为高风险操作设置严格的规则**

## 📄 许可证

MIT
