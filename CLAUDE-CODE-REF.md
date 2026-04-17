# Claude Code 架构速查

## 源码位置
`E:\claude-code-main`

## 核心入口
- `main.tsx` — Bun + Ink 渲染入口
- `App.tsx` — React 组件树根
- `query.ts` + `QueryEngine.ts` — 查询执行

## 工具系统
- `tools.ts` — 16 个内置工具注册
- `services/tools/StreamingToolExecutor.ts` — 流式执行
- `tools/BashTool/` — Bash 命令 + 分类器
- `tools/MCPTool/` — MCP 协议工具

## 权限系统
- `hooks/toolPermission/PermissionContext.ts` — 权限上下文
- `hooks/toolPermission/handlers/` — 5 种处理器
- `utils/permissions/permissions.ts` — 权限规则引擎

## 上下文压缩
- `services/compact/compact.ts` — 核心压缩
- `services/compact/autoCompact.ts` — 自动触发
- 阈值: 13k buffer / 20k warning / 20k error

## MCP 系统
- `services/mcp/client.ts` — MCP 客户端 (3149 行)
- 4 种传输: stdio / HTTP / SSE / WebSocket
- OAuth 支持 + 自动刷新

## 状态管理
- `state/AppStateStore.ts` — AppState 类型
- `state/store.ts` — Zustand store

## 任务系统
7 种任务: LocalAgent / RemoteAgent / InProcessTeammate / Dream / Queue / Suspended / Background

## Hooks (核心)
- `useCanUseTool` — 权限决策
- `useInputBuffer` — Undo/Redo
- `useCancelRequest` — Escape/Ctrl+C
- `usePromptSuggestion` — 补全建议
- `useHistorySearch` — 历史搜索

## 组件 (439 文件)
- `PromptInput/` — 输入框 (2000+ 行)
- `GlobalSearchDialog.tsx` — 全局搜索
- `BackgroundTasksDialog.tsx` — 后台任务
- `Spinner.tsx` — 旋转动画

## 特性开关
`COORDINATOR_MODE` / `KAIROS` / `VOICE_MODE` / `PROACTIVE` / `BASH_CLASSIFIER` / `CONTEXT_COLLAPSE` / `REACTIVE_COMPACT` / `MCP_SKILLS`

## 设计模式
管道模式 / 策略模式 / 观察者模式 / 中介者模式 / 状态机 / React Compiler 缓存

## 详细文档
- `memory/claude-code-architecture.md` — 完整知识库
- `memory/2026-04-17-claude-code-analysis.md` — 深度笔记
