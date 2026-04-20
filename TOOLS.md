# TOOLS.md - Local Notes

*Last updated: 2026-04-20*

---

## 内置工具

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

## 工具执行管道

```
preHook() → Tool.execute() → onResult() → postHook()
```

## 权限层级

| 模式 | 说明 |
|------|------|
| SAFE | 仅安全操作 |
| ASK | 执行前询问 |
| BYPASS | 完全信任 |

## Token 预算

| 字段 | 默认值 |
|------|--------|
| maxTokens | 150,000 |
| warningThreshold | 120,000 (80%) |
| errorThreshold | 150,000 (100%) |
| autoCompact | true |

## 压缩阈值

```
AUTOCOMPACT_BUFFER_TOKENS = 13_000
WARNING_THRESHOLD = 20_000
ERROR_THRESHOLD = 20,000
MANUAL_COMPACT_BUFFER = 3,000
```

## 7 种任务类型

| 类型 | 说明 |
|------|------|
| LocalAgentTask | Bun 进程内 Agent |
| RemoteAgentTask | 远程 API |
| InProcessTeammate | 同进程 Swarm |
| DreamTask | Marble 规划 |
| QueueAgentTask | 队列调度 |
| SuspendedAgentTask | 暂停恢复 |
| BackgroundTask | 后台任务 |

## MCP 传输

- StdioClientTransport — 本地进程
- StreamableHTTP — HTTP 长连接
- SSEClientTransport — Server-Sent Events
- WebSocketTransport — WebSocket

## 特性开关

| 开关 | 说明 |
|------|------|
| COORDINATOR_MODE | 多 Agent 协调 |
| KAIROS | 实时模式 |
| VOICE_MODE | 语音输入 |
| PROACTIVE | 主动模式 |
| BASH_CLASSIFIER | Bash 命令分类器 |
| CONTEXT_COLLAPSE | 上下文折叠 |
| REACTIVE_COMPACT | 反应式压缩 |
| MCP_SKILLS | MCP 技能 |

## 工具注册表

```typescript
// 9个自注册工具
Read / Write / Edit / Glob / Grep / WebFetch / Bash / Remember / Recall
```

---

*详细文档: `memory/archived/detailed-analyses.md` (工具系统详细设计)*
