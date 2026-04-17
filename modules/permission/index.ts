/**
 * Permission Module - Index
 * OpenClaw 权限系统
 * 基于 Claude Code 权限设计
 */

// Types
export * from './types'

// Risk Assessor
export { RiskAssessor, defaultRiskAssessor, assessRisk } from './assessor'

// Permission Manager
export {
  PermissionManager,
  defaultPermissionManager,
  checkPermission,
  checkPermissionSync,
} from './manager'

// ============================================================================
// Quick Usage
// ============================================================================

/**
 * 示例用法
 *
 * ```typescript
 * import { PermissionManager, PermissionMode, checkPermission } from './permission'
 *
 * // 1. 创建管理器
 * const pm = new PermissionManager({
 *   defaultMode: PermissionMode.ASK,
 *   askTimeout: 60000,
 * })
 *
 * // 2. 注册事件监听
 * pm.on('ask', ({ requestId, context, prompt }) => {
 *   // 显示给用户
 *   showPermissionPrompt(prompt)
 * })
 *
 * // 3. 检查权限
 * const decision = await pm.checkPermission({
 *   tool: 'Bash',
 *   input: { command: 'rm -rf /tmp/test' },
 *   timestamp: Date.now(),
 *   riskLevel: 'high',
 *   category: 'process',
 * })
 *
 * // 4. 用户响应
 * pm.respond(requestId, 'allow')
 *
 * // 或者使用快捷函数
 * const result = await checkPermission(context)
 * ```
 */

// ============================================================================
// Integration Example
// ============================================================================

/**
 * 工具执行集成示例
 *
 * ```typescript
 * import { defaultPermissionManager, checkPermissionSync } from './permission'
 *
 * async function executeToolWithPermission(
 *   tool: string,
 *   input: Record<string, unknown>,
 *   category: ToolCategory
 * ) {
 *   // 1. 创建上下文
 *   const context = defaultPermissionManager.createContext(
 *     tool,
 *     input,
 *     category
 *   )
 *
 *   // 2. 同步检查（用于已知的低风险操作）
 *   const syncDecision = checkPermissionSync(context)
 *   if (syncDecision.type === 'allow') {
 *     return executeTool(tool, input)
 *   }
 *
 *   // 3. 同步检查返回 ask，需要交互式询问
 *   if (syncDecision.type === 'ask') {
 *     const decision = await defaultPermissionManager.checkPermission(context)
 *     if (decision.type === 'allow') {
 *       return executeTool(tool, input)
 *     }
 *     throw new Error(decision.reason)
 *   }
 *
 *   // 4. 直接拒绝
 *   throw new Error(syncDecision.reason)
 * }
 * ```
 */

// ============================================================================
// Middleware Example
// ============================================================================

/**
 * Express/Koa 中间件示例
 *
 * ```typescript
 * import { defaultPermissionManager } from './permission'
 *
 * function permissionMiddleware(tool: string, category: ToolCategory) {
 *   return async (ctx, next) => {
 *     const context = defaultPermissionManager.createContext(
 *       tool,
 *       ctx.request.body,
 *       category,
 *       { sessionId: ctx.session?.id }
 *     )
 *
 *     const decision = await defaultPermissionManager.checkPermission(context)
 *
 *     if (decision.type === 'allow') {
 *       await next()
 *     } else if (decision.type === 'ask') {
 *       ctx.status = 403
 *       ctx.body = { error: 'Permission required', prompt: decision.prompt }
 *     } else {
 *       ctx.status = 403
 *       ctx.body = { error: decision.reason }
 *     }
 *   }
 * }
 *
 * // 使用
 * app.post('/api/bash', permissionMiddleware('Bash', 'process'), bashHandler)
 * ```
 */

// ============================================================================
// CLI Integration Example
// ============================================================================

/**
 * CLI 集成示例
 *
 * ```typescript
 * import { defaultPermissionManager, PermissionMode } from './permission'
 *
 * // 设置模式
 * defaultPermissionManager.setMode(PermissionMode.SAFE)
 *
 * // 添加规则
 * defaultPermissionManager.addRule({
 *   id: 'my-allow-rule',
 *   name: 'Allow specific commands',
 *   tools: ['Bash'],
 *   allowedRiskLevels: ['low', 'medium'],
 *   defaultDecision: 'allow',
 *   enabled: true,
 *   priority: 10,
 * })
 *
 * // 监听事件
 * defaultPermissionManager.on('ask', ({ prompt }) => {
 *   console.log(prompt)
 *   const answer = readline.question('Allow? (y/n) ')
 *   return answer.toLowerCase() === 'y' ? 'allow' : 'deny'
 * })
 * ```
 */

// ============================================================================
// Configuration
// ============================================================================

/**
 * 默认配置
 *
 * ```typescript
 * {
 *   defaultMode: PermissionMode.ASK,  // 默认询问模式
 *   enabled: true,                    // 启用权限检查
 *   logAllRequests: true,             // 记录所有请求
 *   askTimeout: 60000,                // 询问超时 1 分钟
 *   maxHistory: 1000,                 // 最大历史记录
 *   dangerousCommands: [              // 危险命令
 *     'rm -rf',
 *     'dd if=',
 *     'curl | sh',
 *     'wget | sh',
 *   ]
 * }
 * ```
 */

// ============================================================================
// Tool Categories
// ============================================================================

/**
 * 工具类别
 *
 * - filesystem: 文件操作 (Read, Write, Edit, Delete, Glob, Grep)
 * - network: 网络请求 (WebFetch, WebSearch, HTTP)
 * - process: 进程管理 (Bash, Exec, Run)
 * - system: 系统操作 (sudo, chmod, chown, kill)
 * - agent: Agent 调用 (Agent, Fork, Spawn)
 * - mcp: MCP 工具 (MCP server tools)
 * - skill: 技能调用 (Skill execution)
 * - other: 其他
 */

// ============================================================================
// Risk Levels
// ============================================================================

/**
 * 风险等级
 *
 * - low: 低风险，只读操作
 * - medium: 中风险，可能修改数据
 * - high: 高风险，破坏性操作
 * - critical: 极高风险，系统级操作
 */
