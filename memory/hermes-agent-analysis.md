# Hermes Agent 深度分析报告

> 分析日期: 2026-04-17
> 来源: https://github.com/NousResearch/hermes-agent
> 文档: https://hermes-agent.nousresearch.com/docs/

---

## 一、项目概述

| 指标 | 值 |
|------|-----|
| **开发方** | Nous Research |
| **语言** | Python |
| **定位** | 自我改进的 AI Agent |
| **安装量** | 开源项目 |
| **许可证** | MIT |

### 核心创新: 内置学习循环

```
┌─────────────────────────────────────────────────────────────┐
│                    Hermes Learning Loop                      │
│                                                              │
│  1. 任务执行 → 生成经验                                      │
│  2. Agent 自动创建 Skills (复杂任务后)                       │
│  3. Skills 在使用中自我改进                                  │
│  4. Nudges 自己保存知识                                       │
│  5. 搜索过去对话 (FTS5 + LLM)                                │
│  6. 建立用户模型 (Honcho dialectic)                          │
└─────────────────────────────────────────────────────────────┘
```

---

## 二、系统架构

### 2.1 整体架构图

```
┌─────────────────────────────────────────────────────────────────────┐
│ Entry Points                                                         │
│ CLI (cli.py) │ Gateway (gateway/run.py) │ ACP (acp_adapter/)        │
│ Batch Runner │ API Server │ Python Library                             │
└──────────┬──────────────┬───────────────────────┬───────────────────┘
           │              │                       │
           ▼              ▼                       ▼
┌─────────────────────────────────────────────────────────────────────┐
│ AIAgent (run_agent.py)                                              │
│                                                                      │
│ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐                 │
│ │ Prompt       │ │ Provider     │ │ Tool         │                 │
│ │ Builder      │ │ Resolution   │ │ Dispatch     │                 │
│ │ (prompt_     │ │ (runtime_    │ │ (model_      │                 │
│ │ builder.py)  │ │ provider.py) │ │ tools.py)    │                 │
│ └──────┬───────┘ └──────┬───────┘ └──────┬───────┘                 │
│        │                │                │                         │
│ ┌──────┴───────┐ ┌──────┴───────┐ ┌──────┴───────┐                 │
│ │ Compression  │ │ 3 API Modes │ │ Tool Registry│                 │
│ │ & Caching    │ │ chat_compl. │ │ (registry.py)│                 │
│ │              │ │ codex_resp. │ │ 47 tools     │                 │
│ │              │ │ anthropic   │ │ 19 toolsets  │                 │
│ └──────────────┘ └──────────────┘ └──────────────┘                 │
└─────────────────────────────────────────────────────────────────────┘
           │              │
           ▼              ▼
┌───────────────────┐ ┌──────────────────────┐
│ Session Storage   │ │ Tool Backends       │
│ (SQLite + FTS5)   │ │ Terminal (6 backends)│
│ hermes_state.py   │ │ Browser (5 backends) │
│ gateway/session.py│ │ Web (4 backends)     │
└───────────────────┘ │ MCP (dynamic)        │
                      │ File, Vision, etc.  │
                      └──────────────────────┘
```

### 2.2 目录结构

```
hermes-agent/
├── run_agent.py           # AIAgent — 核心对话循环 (~10,700 行)
├── cli.py                 # HermesCLI — 交互式 TUI (~10,000 行)
├── model_tools.py         # 工具发现、模式收集、分发
├── toolsets.py            # 工具分组和平台预设
├── hermes_state.py        # SQLite 会话/状态数据库 (FTS5)
├── hermes_constants.py    # HERMES_HOME, profile-aware 路径
├── batch_runner.py        # 批量轨迹生成
│
├── agent/                 # Agent 内部模块
│   ├── prompt_builder.py          # 系统提示组装
│   ├── context_engine.py          # ContextEngine ABC (可插拔)
│   ├── context_compressor.py      # 默认引擎 — 有损摘要
│   ├── prompt_caching.py          # Anthropic prompt caching
│   ├── auxiliary_client.py         # 辅助 LLM (视觉、摘要)
│   ├── model_metadata.py          # 模型上下文长度、token 估算
│   ├── models_dev.py              # models.dev 注册集成
│   ├── anthropic_adapter.py        # Anthropic Messages API 格式转换
│   ├── display.py                 # KawaiiSpinner, 工具预览格式
│   ├── skill_commands.py           # Skill 斜杠命令
│   ├── memory_manager.py           # 记忆管理器编排
│   ├── memory_provider.py          # Memory Provider ABC
│   └── trajectory.py              # 轨迹保存辅助
│
├── hermes_cli/            # CLI 子命令和设置
│   ├── main.py                    # 入口点 (~6,000 行)
│   ├── config.py                  # DEFAULT_CONFIG, 迁移
│   ├── commands.py                # COMMAND_REGISTRY
│   ├── auth.py                     # PROVIDER_REGISTRY, 凭证解析
│   ├── runtime_provider.py         # Provider → api_mode + 凭证
│   ├── models.py                   # 模型目录
│   ├── model_switch.py             # /model 命令逻辑
│   ├── setup.py                    # 交互式设置向导 (~3,100 行)
│   ├── skin_engine.py              # CLI 主题引擎
│   ├── skills_config.py            # hermes skills 配置
│   ├── skills_hub.py               # /skills 斜杠命令
│   ├── tools_config.py             # hermes tools 配置
│   ├── plugins.py                  # PluginManager
│   ├── callbacks.py                # 终端回调
│   └── gateway.py                  # hermes gateway
│
├── tools/                 # 工具实现
│   ├── registry.py                # 中央工具注册表
│   ├── approval.py                # 危险命令检测
│   ├── terminal_tool.py            # 终端编排
│   ├── process_registry.py         # 后台进程管理
│   ├── file_tools.py               # read/write/patch/search
│   ├── web_tools.py                # web_search, web_extract
│   ├── browser_tool.py             # 10 浏览器自动化工具
│   ├── code_execution_tool.py       # execute_code 沙箱
│   ├── delegate_tool.py            # 子Agent委托
│   ├── mcp_tool.py                 # MCP 客户端 (~2,200 行)
│   ├── credential_files.py         # 凭证文件传递
│   ├── env_passthrough.py          # 环境变量传递
│   ├── ansi_strip.py               # ANSI 转义剥离
│   └── environments/               # 终端后端 (local, docker, ssh, modal, daytona, singularity)
│
├── gateway/               # 消息平台网关
│   ├── run.py                     # GatewayRunner (~9,000 行)
│   ├── session.py                 # SessionStore
│   ├── delivery.py                # 出站消息投递
│   ├── pairing.py                 # DM 配对授权
│   ├── hooks.py                   # 钩子发现和生命周期事件
│   ├── mirror.py                  # 跨会话消息镜像
│   ├── status.py                  # Token 锁
│   ├── builtin_hooks/             # 内置钩子
│   └── platforms/                 # 18 个平台适配器
│
├── acp_adapter/          # ACP 服务器 (VS Code / Zed / JetBrains)
├── cron/                  # 调度器
├── plugins/memory/        # 记忆提供者插件
├── plugins/context_engine/ # 上下文引擎插件
├── environments/          # RL 训练环境 (Atropos)
├── skills/                # 捆绑技能 (始终可用)
├── optional-skills/       # 官方可选技能
├── website/               # Docusaurus 文档
└── tests/                # Pytest 套件 (~3,000+ 测试)
```

---

## 三、核心模块详解

### 3.1 AIAgent (run_agent.py) — 核心对话循环

**规模**: ~10,700 行

#### 核心职责

1. 通过 prompt_builder.py 组装有效系统提示和工具模式
2. 选择正确的 provider/API 模式
3. 支持中断的模型调用 (Cancellation 支持)
4. 执行工具调用 (顺序或并发 via ThreadPoolExecutor)
5. 维护对话历史 (OpenAI 消息格式)
6. 处理压缩、重试、回退模型切换
7. 跨父/子 Agent 追踪迭代预算
8. 在上下文丢失前刷新持久化内存

#### 两种入口

```python
# 简单接口 — 返回最终响应字符串
response = agent.chat("Fix the bug in main.py")

# 完整接口 — 返回带消息、元数据、使用统计的 dict
result = agent.run_conversation(
    user_message="Fix the bug in main.py",
    system_message=None,  # 自动构建
    conversation_history=None,  # 自动从会话加载
    task_id="task_abc123"
)
```

#### API 模式

| API 模式 | 用于 | 客户端 |
|----------|------|--------|
| chat_completions | OpenAI 兼容端点 (OpenRouter, custom) | openai.OpenAI |
| codex_responses | OpenAI Codex / Responses API | openai.OpenAI |
| anthropic_messages | Native Anthropic Messages API | anthropic.Anthropic |

#### Turn 生命周期

```
run_conversation()
  1. 生成 task_id (如未提供)
  2. 将用户消息追加到对话历史
  3. 构建或重用缓存的系统提示
  4. 检查预压缩是否需要 (>50% context)
  5. 从对话历史构建 API 消息
  6. 注入临时提示层 (预算警告、上下文压力)
  7. 应用 Anthropic 的 prompt caching 标记
  8. 进行可中断的 API 调用
  9. 解析响应:
     - 如有 tool_calls: 执行并循环回第5步
     - 如为文本响应: 持久化会话，刷新内存(如需要)，返回
```

#### 消息格式

```json
{"role": "system", "content": "..."}
{"role": "user", "content": "..."}
{"role": "assistant", "content": "...", "tool_calls": [...]}
{"role": "tool", "tool_call_id": "...", "content": "..."}
```

#### 可中断 API 调用

```
┌────────────────────────────────────────────────────┐
│ Main thread          │ API thread                   │
│                      │                              │
│ wait on: HTTP POST   │                              │
│ - response ready ───▶│ to provider                  │
│ - interrupt event    │                              │
│ - timeout            │                              │
└────────────────────────────────────────────────────┘
```

#### 工具执行

- **单工具调用** → 主线程直接执行
- **多工具调用** → ThreadPoolExecutor 并发执行
- **交互式工具** (clarify) → 强制顺序执行

#### 预算与回退

- **迭代预算**: 默认 90 次 (agent.max_turns 可配置)
- **子 Agent**: 独立预算，默认上限 50 次
- **回退模型**: 主模型失败时按顺序尝试回退列表

#### 压缩触发条件

| 类型 | 触发时机 |
|------|----------|
| 预压缩 | 对话超过模型上下文窗口的 50% |
| Gateway 自动压缩 | 对话超过 85% |

---

### 3.2 提示系统 (Prompt Assembly)

#### 缓存的系统提示层次

```
1. Agent Identity (SOUL.md)
2. Tool-aware behavior guidance
3. Honcho static block (当激活时)
4. Optional system message
5. Frozen MEMORY snapshot
6. Frozen USER profile snapshot
7. Skills index
8. Context files (AGENTS.md, .cursorrules, etc.)
9. Timestamp / Session ID
10. Platform hint
```

#### 上下文文件优先级

| 优先级 | 文件 | 搜索范围 |
|--------|------|----------|
| 1 | .hermes.md, HERMES.md | CWD 向上到 git root |
| 2 | AGENTS.md | CWD only |
| 3 | CLAUDE.md | CWD only |
| 4 | .cursorrules, .cursor/rules/*.mdc | CWD only |

**关键设计**: 上下文文件只加载**第一个匹配项** (first match wins)

#### 记忆快照

- Local memory 和 user profile 以**冻结快照**形式在会话开始时注入
- 会话中的写入更新磁盘状态，但不会改变已构建的系统提示
- 变化只在新会话或强制重建时生效

---

### 3.3 会话存储 (Session Storage)

#### 数据库架构

```
~/.hermes/state.db (SQLite, WAL mode)
├── sessions          # 会话元数据、token 计数、计费
├── messages          # 完整消息历史
├── messages_fts      # FTS5 全文搜索虚拟表
└── schema_version    # 迁移状态跟踪
```

#### Sessions 表

```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,           -- cli, telegram, discord, etc.
  user_id TEXT,
  model TEXT,
  model_config TEXT,
  system_prompt TEXT,
  parent_session_id TEXT,         -- 压缩触发的会话分裂
  started_at REAL NOT NULL,
  ended_at REAL,
  end_reason TEXT,
  message_count INTEGER DEFAULT 0,
  tool_call_count INTEGER DEFAULT 0,
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  cache_read_tokens INTEGER DEFAULT 0,
  cache_write_tokens INTEGER DEFAULT 0,
  reasoning_tokens INTEGER DEFAULT 0,
  billing_provider TEXT,
  billing_base_url TEXT,
  billing_mode TEXT,
  estimated_cost_usd REAL,
  actual_cost_usd REAL,
  cost_status TEXT,
  cost_source TEXT,
  pricing_version TEXT,
  title TEXT
);
```

#### Messages 表

```sql
CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT,
  tool_call_id TEXT,
  tool_calls TEXT,               -- JSON 序列化
  tool_name TEXT,
  timestamp REAL NOT NULL,
  token_count INTEGER,
  finish_reason TEXT,
  reasoning TEXT,
  reasoning_details TEXT,
  codex_reasoning_items TEXT
);
```

#### FTS5 全文搜索

```sql
CREATE VIRTUAL TABLE messages_fts USING fts5(
  content,
  content=messages,
  content_rowid=id
);
```

#### 写入争用处理

- SQLite 超时: 1 秒 (而非默认 30s)
- 应用层重试 + 随机抖动 (20-150ms, 最多 15 次)
- BEGIN IMMEDIATE 事务
- 每 50 次成功写入执行 WAL 检查点

#### 会话血脉 (Session Lineage)

```sql
-- 查找会话的所有祖先
WITH RECURSIVE lineage AS (
  SELECT * FROM sessions WHERE id = ?
  UNION ALL
  SELECT s.* FROM sessions s
  JOIN lineage l ON s.id = l.parent_session_id
)
SELECT id, title, started_at, parent_session_id FROM lineage;

-- 查找会话的所有后代
WITH RECURSIVE descendants AS (
  SELECT * FROM sessions WHERE id = ?
  UNION ALL
  SELECT s.* FROM sessions s
  JOIN descendants d ON s.parent_session_id = d.id
)
SELECT id, title, started_at FROM descendants;
```

---

### 3.4 工具系统 (Tool System)

#### 工具注册模型

每个工具模块在导入时调用 `registry.register()`:

```python
registry.register(
    name="terminal",
    toolset="terminal",
    schema={...},  # OpenAI function-calling schema
    handler=handle_terminal,
    check_fn=check_terminal,  # 可选: 可用性检查
    requires_env=["SOME_VAR"],  # 可选: 需要的 Env Var
    is_async=False,
    description="Run commands",
    emoji="💻",
)
```

#### 自注册发现

```python
def discover_builtin_tools(tools_dir=None):
    tools_path = Path(tools_dir) if tools_dir else Path(__file__).parent
    for path in sorted(tools_path.glob("*.py")):
        if path.name in {"__init__.py", "registry.py", "mcp_tool.py"}:
            continue
        if _module_registers_tools(path):  # AST 检查
            importlib.import_module(f"tools.{path.stem}")
```

**关键**: 新工具文件自动被发现，无需手动维护列表

#### 危险命令检测 (DANGEROUS_PATTERNS)

```python
# 检测类型
- Recursive deletes (rm -rf)
- Filesystem formatting (mkfs, dd)
- SQL destructive operations (DROP TABLE, DELETE FROM without WHERE)
- System config overwrites (> /etc/)
- Service manipulation (systemctl stop)
- Remote code execution (curl | sh)
- Fork bombs, process kills, etc.
```

#### 批准流程

```
检测到危险命令
     ↓
CLI 模式 → 交互式提示 (approve/deny/allow permanently)
Gateway 模式 → 异步批准回调发送到消息平台
     ↓
可选: 辅助 LLM 自动批准低风险匹配 (如 rm -rf node_modules/)
     ↓
会话状态跟踪: 批准后同会话不再提示
```

#### 终端后端

| 后端 | 用途 |
|------|------|
| local | 本地执行 |
| docker | 容器化 |
| ssh | 远程 |
| singularity | HPC |
| modal | Serverless |
| daytona | 云端按需 |

---

### 3.5 消息网关 (Messaging Gateway)

#### 架构

```
┌─────────────────────────────────────────────────┐
│ GatewayRunner                                    │
│                                                  │
│ ┌──────────┐ ┌──────────┐ ┌──────────┐          │
│ │ Telegram │ │ Discord  │ │ Slack    │          │
│ │ Adapter  │ │ Adapter  │ │ Adapter  │          │
│ └────┬─────┘ └────┬─────┘ └────┬─────┘          │
│      │             │             │               │
│      └─────────────┼─────────────┘               │
│                    ▼                              │
│           _handle_message()                        │
│                    │                              │
│      ┌─────────────┼─────────────┐               │
│      ▼             ▼             ▼               │
│  Slash command  AIAgent    Queue/BG              │
│   dispatch     creation    sessions              │
│                    │                              │
│                    ▼                              │
│           SessionStore                            │
│        (SQLite persistence)                        │
└─────────────────────────────────────────────────┘
```

#### 会话密钥格式

```
agent:main:{platform}:{chat_type}:{chat_id}
例如: agent:main:telegram:private:123456789
```

#### 平台适配器 (18 个)

```
telegram, discord, slack, whatsapp, signal,
matrix, mattermost, email, sms, dingtalk,
feishu, wecom, weixin, bluebubbles, qqbot,
homeassistant, webhook, api_server
```

#### 双层消息守卫

| 层级 | 位置 | 行为 |
|------|------|------|
| Level 1 | Base Adapter | 活动会话 → 队列消息 + 设置中断事件 |
| Level 2 | Gateway Runner | 拦截 /stop, /new, /approve 等 |

#### 授权检查顺序

1. Per-platform allow-all flag
2. Platform allowlist
3. DM pairing
4. Global allow-all
5. Default: deny

#### 钩子系统

```python
# Gateway 钩子事件
gateway:startup      # Gateway 进程启动
session:start        # 新会话开始
session:end          # 会话完成或超时
session:reset        # 用户重置会话
agent:start          # Agent 开始处理消息
agent:step           # Agent 完成一次工具调用迭代
agent:end            # Agent 结束并返回响应
command:*            # 任意斜杠命令执行
```

---

### 3.6 技能系统 (Skills System)

#### 技能格式 (SKILL.md)

```yaml
---
name: my-skill
description: Brief description of what this skill does
version: 1.0.0
platforms: [macos, linux]  # 可选: 限制操作系统
metadata:
  hermes:
    tags: [python, automation]
    category: devops
    fallback_for_toolsets: [web]  # 条件激活
    requires_toolsets: [terminal]
    config:
      - key: my.setting
        description: "What this controls"
        default: "value"
        prompt: "Prompt for setup"
---
# Skill Title

## When to Use
Trigger conditions for this skill.

## Procedure
1. Step one
2. Step two

## Pitfalls
- Known failure modes and fixes

## Verification
How to confirm it worked.
```

#### 渐进式加载

```
Level 0: skills_list() → [{name, description, category}, ...] (~3k tokens)
Level 1: skill_view(name) → Full content + metadata (varies)
Level 2: skill_view(name, path) → Specific reference file (varies)
```

#### 条件激活

```yaml
fallback_for_toolsets: [web]  # 当 web 工具集不可用时显示
requires_toolsets: [terminal]  # 当 terminal 工具集可用时显示
```

#### Agent 创建的技能

```python
# skill_manage 工具操作
- create    # 从头创建新技能
- patch     # 定向修复 (首选)
- edit      # 重大重构
- delete    # 删除技能
- write_file # 添加/更新支持文件
- remove_file # 移除支持文件
```

#### 技能创建时机

- 完成复杂任务后 (5+ 工具调用)
- 遇到错误或死胡同后找到可行路径
- 用户纠正了方法
- 发现非平凡工作流

#### 技能中心 (Skills Hub)

```bash
hermes skills browse              # 浏览所有 hub 技能
hermes skills install official/security/1password
hermes skills install skills-sh/vercel-labs/agent-skills/vercel-react-best-practices
hermes skills install openai/skills/k8s
hermes skills check              # 检查更新
hermes skills audit              # 安全扫描
```

---

### 3.7 记忆系统 (Memory)

#### 两文件记忆

| 文件 | 用途 | 字符限制 |
|------|------|----------|
| MEMORY.md | Agent 个人笔记 — 环境事实、约定、学到的内容 | 2,200 chars (~800 tokens) |
| USER.md | 用户画像 — 偏好、沟通风格、期望 | 1,375 chars (~500 tokens) |

#### 记忆显示格式

```
══════════════════════════════════════════════
MEMORY (your personal notes) [67% — 1,474/2,200 chars]
══════════════════════════════════════════════
User's project is a Rust web service at ~/code/myapi using Axum + SQLx
§
This machine runs Ubuntu 22.04, has Docker and Podman installed
§
User prefers concise responses, dislikes verbose explanations
```

#### 记忆工具操作

```python
memory(action="add", target="memory", content="...")
memory(action="replace", target="memory", old_text="dark mode", content="...")
memory(action="remove", target="user", old_text="...")
```

#### 容量管理

| 存储 | 限制 | 典型条目数 |
|------|------|------------|
| memory | 2,200 chars | 8-15 entries |
| user | 1,375 chars | 5-10 entries |

#### 会话搜索 vs 记忆

| 特性 | 持久记忆 | 会话搜索 |
|------|----------|----------|
| 容量 | ~1,300 tokens 总计 | 无限 (所有会话) |
| 速度 | 即时 (在系统提示中) | 需要搜索 + LLM 摘要 |
| 用途 | 始终可用的关键事实 | 查找具体过去对话 |
| 管理 | Agent 手动管理 | 自动 — 所有会话存储 |
| Token 成本 | 每会话固定 (~1,300) | 按需 (需要时搜索) |

#### 外部记忆提供者

```bash
hermes memory setup   # 选择并配置提供者
hermes memory status  # 检查激活状态
```

支持的提供者: Honcho, OpenViking, Mem0, Hindsight, Holographic, RetainDB, ByteRover, Supermemory

---

### 3.8 Cron 系统

#### 调度格式

| 格式 | 示例 | 行为 |
|------|------|------|
| 相对延迟 | 30m, 2h, 1d | 一次性，一段时间后触发 |
| 间隔 | every 2h, every 30m | 循环，定期触发 |
| Cron 表达式 | 0 9 * * * | 标准 5 字段 cron 语法 |
| ISO 时间戳 | 2025-01-15T09:00:00 | 一次性，精确时间触发 |

#### 任务存储

```json
{
  "id": "a1b2c3d4e5f6",
  "name": "Daily briefing",
  "prompt": "Summarize today's AI news and funding rounds",
  "schedule": {
    "kind": "cron",
    "expr": "0 9 * * *",
    "display": "0 9 * * *"
  },
  "skills": ["ai-funding-daily-report"],
  "deliver": "telegram:-1001234567890",
  "repeat": {
    "times": null,
    "completed": 42
  },
  "state": "scheduled",
  "enabled": true,
  "next_run_at": "2025-01-16T09:00:00Z",
  "last_run_at": "2025-01-15T09:00:00Z",
  "last_status": "ok"
}
```

#### 投递目标

```
origin, local, telegram, discord, slack, whatsapp,
signal, matrix, mattermost, email, sms, dingtalk,
feishu, wecom, weixin, bluebubbles, qqbot, homeassistant
```

#### CLI 接口

```bash
hermes cron list                  # 显示所有任务
hermes cron create                # 交互式创建
hermes cron edit <job_id>         # 编辑任务
hermes cron pause <job_id>        # 暂停任务
hermes cron resume <job_id>      # 恢复任务
hermes cron run <job_id>          # 立即触发
hermes cron remove <job_id>       # 删除任务
```

---

### 3.9 提供者解析 (Provider Resolution)

#### 支持的提供商 (18+)

```
Nous Portal, OpenRouter (200+ models), Xiaomi MiMo,
z.ai/GLM, Kimi/Moonshot, MiniMax, Hugging Face,
OpenAI, Anthropic, 自定义端点
```

#### 凭证解析链

```
环境变量 → config.yaml → 平台特定存储
```

#### OAuth 流程支持

某些提供商支持 OAuth 认证流程

---

## 四、设计原则

| 原则 | 实践 |
|------|------|
| **提示稳定性** | 系统提示不会在会话中改变 |
| **可观察执行** | 每个工具调用通过回调对用户可见 |
| **可中断** | API 调用和工具执行可被用户输入或信号取消 |
| **平台无关核心** | 一个 AIAgent 类服务 CLI, Gateway, ACP, Batch, API Server |
| **松耦合** | MCP, 插件, 记忆提供者, RL 环境使用注册模式 |
| **Profile 隔离** | 每个 profile 有自己的 HERMES_HOME, config, memory, sessions, gateway PID |

---

## 五、关键文件依赖链

```
tools/registry.py (无依赖 — 所有工具文件导入)
     ↑
tools/*.py (每个在导入时调用 registry.register())
     ↑
model_tools.py (导入 tools/registry + 触发工具发现)
     ↑
run_agent.py, cli.py, batch_runner.py, environments/
```

**自注册机制**: 任何带顶层 `registry.register()` 调用的 `tools/*.py` 文件被自动发现

---

## 六、与 OpenClaw 对比

| 方面 | Hermes Agent | OpenClaw |
|------|-------------|-----------|
| **核心语言** | Python (~100+ 文件) | TypeScript |
| **学习循环** | ✅ 内置自我改进 | ❌ |
| **技能自创建** | ✅ 复杂任务后自动 | ❌ |
| **多平台** | 18 个平台适配器 | 依赖配置 |
| **多模型** | 200+ via OpenRouter | 主要 Claude |
| **记忆系统** | MEMORY.md/USER.md + FTS5 | MemPalace 结构 |
| **用户建模** | Honcho dialectic | ❌ |
| **Cron 调度** | ✅ 内置 + 投递到任意平台 | 外部 cron |
| **子 Agent** | ✅ 并行隔离 | ✅ |
| **RL/轨迹** | ✅ Atropos RL + 轨迹压缩 | ❌ |
| **OpenClaw 迁移** | ✅ 内置迁移路径 | N/A |
| **工具数量** | 47 工具, 19 工具集 | ~7 内置模块 |
| **代码规模** | ~30,000+ 行 Python | ~7,168 行 TypeScript |
| **会话存储** | SQLite + FTS5 | 文件系统 |
| **压缩方式** | 有损摘要 | 层级压缩 |
| **危险命令检测** | DANGEROUS_PATTERNS | Permission 模块 |
| **插件系统** | 内存/上下文引擎可插拔 | Skills 系统 |

---

## 七、值得借鉴的设计

### 7.1 高优先级借鉴

| 设计 | Hermes 实现 | OpenClaw 现状 | 建议 |
|------|------------|--------------|------|
| **FTS5 会话搜索** | SQLite FTS5 + LLM 摘要 | 文件搜索 | 新模块 `modules/search/` |
| **Periodic Nudges** | 定期记忆提醒 | Hooks 基础 | 增强 memory/hooks.ts |
| **子会话血脉** | parent_session_id 链 | 无 | Context 模块增强 |
| **Profile 隔离** | 独立 HERMES_HOME | 单一工作区 | 未来多 profile 支持 |
| **工具自注册** | AST 扫描 + register() | 手动注册 | Registry 模块增强 |

### 7.2 中优先级借鉴

| 设计 | Hermes 实现 | OpenClaw 现状 | 建议 |
|------|------------|--------------|------|
| **多 API 模式** | chat_completions / codex / anthropic | 仅 Anthropic | 新模块 `modules/provider/` |
| **Provider 回退链** | fallback_providers 配置 | ❌ | Provider 模块 |
| **技能 Hub** | agentskills.io 集成 | ClawHub | 增强互通性 |
| **OAuth 认证** | 部分提供商支持 | ❌ | 未来认证系统 |
| **会话计费** | 估算 + 实际成本跟踪 | ❌ | Analytics 模块增强 |

### 7.3 低优先级借鉴

| 设计 | Hermes 实现 | OpenClaw 现状 | 建议 |
|------|------------|--------------|------|
| **Skin 主题引擎** | CLI 外观定制 | ❌ | UI 层面 |
| **多终端后端** | local/docker/ssh/modal/daytona | ❌ | 架构层面 |
| **Batch 轨迹生成** | RL 训练数据 | ❌ | 研究方向 |

---

## 八、架构亮点总结

### 8.1 最值得学习的部分

1. **自注册工具发现** — 无需手动导入，AST 扫描自动发现
2. **三 API 模式统一** — chat_completions / codex_responses / anthropic_messages 汇聚到同一内部格式
3. **可中断 API 调用** — 线程级中断支持，用户可随时终止
4. **会话血脉追踪** — 压缩后保留父子关系，可追溯
5. **渐进式技能加载** — 3 级加载，按需获取
6. **FTS5 全文搜索** — SQLite 内置，无需外部服务
7. **双层消息守卫** — 适配器层 + 网关层，精确控制并发
8. **原子任务存储** — JSON 临时文件 + rename 保证一致性

### 8.2 Hermes 的独特优势

1. **真正的自我改进** — 任务后自动创建技能，技能在使用中改进
2. **18 平台统一** — 一个代码库，服务所有主流消息平台
3. **RL 研究就绪** — 内置轨迹生成和 Atropos RL 环境集成
4. **$5 VPS 运行** — 极低资源占用，serverless 成本近乎为零

---

## 九、OpenClaw 进化建议

基于 Hermes Agent 的深度分析，建议 OpenClaw 的下一步进化方向:

### Phase 5: 搜索与发现

```
modules/search/
├── types.ts
├── sqliteStore.ts      # SQLite + FTS5 集成
├── sessionSearch.ts     # 会话历史搜索
└── index.ts
```

### Phase 6: 提供者抽象

```
modules/provider/
├── types.ts
├── router.ts           # 多模型路由
├── fallbackChain.ts    # 回退链
└── index.ts
```

### Phase 7: 技能进化

```
modules/skill/
├── types.ts
├── creator.ts          # 任务后自动创建
├── improver.ts         # 使用中自我改进
├── hub.ts              # 技能市场集成
└── index.ts
```

---

## 十、总结

Hermes Agent 是一个**成熟的生产级 Agent 系统**，具有:

- ** ~30,000+ 行 Python 代码**
- **18 个消息平台适配器**
- **47 个内置工具, 19 个工具集**
- **内置自我改进循环**
- **完整的学习和记忆系统**
- **RL 研究工具链**

其架构设计体现了**工程化思维**: 清晰的分层、完善的错误处理、灵活的可扩展性。

对于 OpenClaw 来说，Hermes 的**最大学习价值**在于:
1. 自注册工具发现机制
2. 多 API 模式统一抽象
3. 可中断调用的线程设计
4. 会话血脉追踪
5. 渐进式技能加载

---

*文档生成时间: 2026-04-17*
*来源: Hermes Agent 官方文档 + GitHub 仓库分析*
