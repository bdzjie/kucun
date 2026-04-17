# Claude Code 源码分析 — 完整知识库

> 集成到 OpenClaw 工作区
> 日期: 2026-04-17
> 状态: ✅ 完成

---

## 📚 知识库文件

| 文件 | 内容 |
|------|------|
| `CLAUDE-CODE-REF.md` | 快速参考卡（速查表） |
| `MEMORY.md` | 长期记忆 + 架构总结 |
| `memory/claude-code-architecture.md` | 完整架构知识库（~11KB） |
| `memory/2026-04-17-claude-code-analysis.md` | 深度分析笔记（~11KB） |

---

## 🎯 分析范围

### 覆盖模块

| 模块 | 文件数 | 状态 |
|------|--------|------|
| 核心架构 | ~20 | ✅ 完整 |
| 工具系统 | ~50 | ✅ 完整 |
| 权限系统 | ~30 | ✅ 完整 |
| 上下文压缩 | ~10 | ✅ 完整 |
| MCP 系统 | ~20 | ✅ 完整 |
| 命令系统 | ~20 | ✅ 完整 |
| API 客户端 | ~15 | ✅ 完整 |
| 会话持久化 | ~15 | ✅ 完整 |
| Git 操作 | ~15 | ✅ 完整 |
| **Hooks** | **~100+** | ✅ 完整 |
| **Components** | **~439** | ✅ 完整 |
| **Voice** | **~10** | ✅ 完整 |
| **Migrations** | **11** | ✅ 完整 |
| Buddy 伙伴 | ~5 | ✅ 完整 |
| 工具函数库 | ~400 | 部分 |

---

## 🏗️ 核心架构

```
src/
├── main.tsx                    # Bun + Ink 渲染入口
├── App.tsx                     # React 组件树根
├── query.ts                   # 查询执行器
├── QueryEngine.ts             # 查询引擎（3 种路径）
├── context.ts                 # 上下文收集（7 种）
├── tools.ts                   # 工具注册中心
├── coordinator/               # 多 Agent 协调
├── bridge/                    # IDE 远程桥接
├── commands/                  # 命令（/commit /review）
├── hooks/                     # 100+ React Hooks
├── skills/                    # 技能系统
├── plugins/                   # 插件系统
├── memdir/                    # MEMORY.md 管理
├── migrations/                # 11 个迁移脚本
├── voice/                     # 语音模式
├── buddy/                     # 伙伴系统
├── tasks/                     # 7 种任务类型
├── services/
│   ├── api/                   # Claude API 客户端
│   ├── compact/               # 上下文压缩
│   ├── mcp/                   # MCP 协议
│   ├── analytics/              # 遥测
│   └── tools/                  # 工具执行
├── state/                     # Zustand 状态
├── components/                 # 439 个 UI 组件
└── utils/                     # ~400 工具函数
```

---

## 📦 五大核心系统

### 1. 工具系统
- 16 个内置工具（Bash/File/WebSearch/MCP 等）
- 工具执行管道（pre-hook → tool → post-hook）
- BashClassifier 命令分类（allow/deny/ask）

### 2. 权限系统
- 3 层权限模式（safe/skipDev/bypassPermissions）
- PermissionContext 权限上下文
- 5 种处理器（allow/deny/ask/interactive/coordinator）

### 3. 上下文压缩
- Token 预算管理（13k buffer / 20k warning）
- 自动压缩触发器
- 微压缩（工具结果针对性清理）
- 墓碑机制（OOM 保护）

### 4. MCP 系统
- 4 种传输协议（stdio/HTTP/SSE/WebSocket）
- OAuth2 + 自动刷新
- Session 过期重连

### 5. 任务系统
- 7 种任务类型
- LocalAgent / RemoteAgent / InProcessTeammate
- DreamTask（Marble 规划）
- BackgroundTask（后台任务）

---

## 🔧 设计模式

| 模式 | 应用 |
|------|------|
| 管道模式 | 工具执行 |
| 策略模式 | 查询引擎 |
| 观察者模式 | AppState 订阅 |
| 中介者模式 | Coordinator |
| 状态机 | Buddy 伙伴动画 |
| React Compiler | 组件缓存优化 |

---

## 🔑 关键特性

```
feature('COORDINATOR_MODE')    — 多 Agent 协调
feature('KAIROS')              — 实时模式
feature('VOICE_MODE')         — 语音输入
feature('BASH_CLASSIFIER')    — Bash 分类器
feature('CONTEXT_COLLAPSE')   — 上下文折叠
feature('REACTIVE_COMPACT')    — 反应式压缩
feature('MCP_SKILLS')         — MCP 技能
```

---

## 📊 React Hooks 核心

| Hook | 职责 |
|------|------|
| `useCanUseTool` | 工具权限决策 |
| `useCancelRequest` | Escape/Ctrl+C |
| `useInputBuffer` | Undo/Redo |
| `usePromptSuggestion` | 补全建议 |
| `useHistorySearch` | 历史搜索 |
| `useMainLoopModel` | 模型选择 |

---

## 📁 组件库（439 文件）

| 组件 | 职责 |
|------|------|
| `PromptInput/` | 主输入框（2000+ 行） |
| `GlobalSearchDialog` | 全局搜索（Ctrl+Shift+F） |
| `BackgroundTasksDialog` | 后台任务（Shift+Down） |
| `Spinner` | 旋转动画 |
| `ThinkingToggle` | 思考模式开关 |

---

## 🚀 使用方式

查阅知识库：
1. **快速定位** → `CLAUDE-CODE-REF.md`
2. **系统了解** → `MEMORY.md`
3. **完整知识** → `memory/claude-code-architecture.md`
4. **实现细节** → `memory/2026-04-17-claude-code-analysis.md`

---

## ✅ 下一步

如需深入特定模块：
- 工具系统 → `tools.ts` + `services/tools/`
- 权限系统 → `hooks/toolPermission/`
- MCP → `services/mcp/client.ts`
- 压缩 → `services/compact/`
- Hooks → `hooks/useCanUseTool.tsx`
- Components → `components/PromptInput/`

---

*分析完成: 2026-04-17*
