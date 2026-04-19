# OpenAI Agents SDK 分析

**分析日期**: 2026-04-19
**仓库**: openai/openai-agents-python
**规模**: Python SDK, ~100+ 模块

---

## 核心架构

### Agent 运行循环

```
Runner.run(starting_agent, input)
  → turn loop:
    1. Agent 接收输入
    2. 模型调用 → 工具调用 或 Handoff 或 Final Output
    3. 工具执行 → 结果回传 → 下一轮
    4. Handoff → 切换 Agent → 下一轮
    5. Final Output → 终止
```

### 核心组件

| 组件 | 文件 | 职责 |
|------|------|------|
| `Agent` | `agent.py` | 指令/工具/Guardrail/Handoff 配置 |
| `Runner` | `run.py` | 运行循环 + 生命周期管理 |
| `Tool` | `tool.py` | 工具基类 (FunctionTool/ComputerTool/MCPTool) |
| `Handoff` | `handoffs.py` | Agent 间切换机制 |
| `Guardrail` | `guardrail.py` | 输入/输出安全检查 |
| `Session` | `memory/session.py` | 对话历史管理协议 |
| `Model` | `models/` | 多提供商支持 |

---

## 核心概念

### 1. Agent 类

```python
@dataclass
class Agent(AgentBase[TContext]):
    instructions: str | Callable[[RunContextWrapper[TContext], Agent], str] | None
    tools: list[Tool] = field(default_factory=list)
    handoffs: list[Handoff] = field(default_factory=list)
    input_guardrails: list[InputGuardrail[TContext]] = field(default_factory=list)
    output_guardrails: list[OutputGuardrail[TContext]] = field(default_factory=list)
    output_type: type | None = None  # 最终输出类型
```

### 2. Handoff 系统

```python
@dataclass
class Handoff(Generic[TContext]):
    agent: Agent[TContext]
    handoff_input_filter: HandoffInputFilter | None = None
    input_items: list[TResponseInputItem] | None = None
```

Handoff 允许 Agent 之间转移控制权，并可携带额外输入过滤/转换。

### 3. Guardrail 模式

```python
@input_guardrail
async def check_topic(ctx, agent, input):
    if is_off_topic(input):
        return GuardrailFunctionOutput(output_info={...}, tripwire_triggered=True)
    return GuardrailFunctionOutput(output_info={...}, tripwire_triggered=False)
```

- **Input Guardrail**: 并行或串行运行于 Agent 执行前
- **Output Guardrail**: 运行于 Agent 输出后
- **Tripwire**: 触发则立即停止 Agent

### 4. ToolsToFinalOutput

```python
ToolsToFinalOutputFunction = Callable[
    [RunContextWrapper[TContext], list[FunctionToolResult]],
    MaybeAwaitable[ToolsToFinalOutputResult]
]
```

工具可以直接返回最终输出，跳过模型再调用。

### 5. Agent-as-Tool

一个 Agent 可以被用作另一个 Agent 的工具：
```python
Agent(
    tools=[...],
    mcp_servers=[...]
)
# → get_all_tools() 包含 MCP + self.tools + agent.tools
```

### 6. ComputerTool

```python
ComputerTool(
    environment=Environment.LOCAL,
    provider=computer_provider  # create/dispose hooks
)
```

### 7. Session Protocol

```python
class Session(Protocol):
    session_id: str
    async def get_items(self, limit: int | None = None) -> list[TResponseInputItem]: ...
    async def add_items(self, items: list[TResponseInputItem]) -> None: ...
    async def pop_item(self) -> TResponseInputItem | None: ...
    async def clear_session(self) -> None: ...
```

支持 OpenAI Responses API 的服务端压缩：
```python
class OpenAIResponsesCompactionAwareSession(Session, Protocol):
    async def run_compaction(self, args: OpenAIResponsesCompactionArgs) -> None: ...
```

---

## 工具类型

| 类型 | 说明 |
|------|------|
| `FunctionTool` | Python 函数包装 |
| `ComputerTool` | 浏览器/桌面自动化 |
| `FileSearchTool` | 向量搜索 |
| `ImageGenerationTool` | 图像生成 |
| `MCPTool` | MCP 服务器工具 |
| `HostedMCPTool` | 托管 MCP |
| `ApplyPatchTool` | 代码编辑 (apply_diff) |
| `CodeInterpreterTool` | 代码解释器 |
| `ShellTool` | 本地 shell |

---

## 生命周期 Hooks

```python
class RunHooks(Generic[TContext]):
    async def on_agent_start(self, ctx, agent): ...
    async def on_agent_end(self, ctx, agent, output): ...
    async def on_tool_call_start(self, ctx, tool, input): ...
    async def on_tool_call_end(self, ctx, tool, result): ...
    async def on_handoff(self, ctx, from_agent, to_agent): ...
    async def on_tone_end(self, ctx, agent, output): ...
```

---

## .agents/skills 系统

仓库内置 8 个技能：

| 技能 | 目录结构 | 职责 |
|------|---------|------|
| `code-change-verification` | SKILL.md + agents/openai.yaml + scripts/ | 格式化/lint/类型检查/测试 |
| `docs-sync` | SKILL.md + agents/openai.yaml + references/ | 文档同步 |
| `examples-auto-run` | SKILL.md + agents/openai.yaml + scripts/ | 示例自动运行 |
| `final-release-review` | SKILL.md + agents/openai.yaml + references/ | 发布前审查 |
| `implementation-strategy` | SKILL.md + agents/openai.yaml | 实现策略建议 |
| `openai-knowledge` | SKILL.md + agents/openai.yaml | OpenAI API 知识 |
| `pr-draft-summary` | SKILL.md + agents/openai.yaml | PR 草稿生成 |
| `runtime-behavior-probe` | SKILL.md + agents/openai.yaml + references/ + templates/ | 运行时行为探测 |
| `test-coverage-improver` | SKILL.md + agents/openai.yaml | 测试覆盖率改进 |

**每个技能的结构**:
```
skill-name/
├── SKILL.md                    # 技能描述 + 触发条件
├── agents/
│   └── openai.yaml             # Agent 配置（模型/工具/指令）
├── scripts/                    # Shell 脚本
│   └── run.sh / run.ps1
├── references/                 # 参考文档
│   └── *.md
└── templates/                 # 代码模板
    └── *.py
```

**openai.yaml 格式**:
```yaml
model: gpt-4o
tools:
  - type: function
    name: bash
    description: Run shell commands
    # ...
```

---

## OpenClaw 可借鉴点

### 1. Guardrail 安全模式

OpenClaw 目前缺少 Input/Output Guardrail。可借鉴：
- 输入检查：在工具执行前增加检查层
- Tripwire 模式：触发则中断执行
- 并行/串行执行配置

**可实现**: 在 `tools.ts` 或 `hooks/` 层增加 pre-tool guardrail。

### 2. Session Compaction 协议

OpenAI 的 `OpenAIResponsesCompactionAwareSession` 协议：
- 定义了标准的 compaction 接口
- 支持服务端历史压缩

**可实现**: OpenClaw 的 SessionStore 可实现类似 compaction 接口。

### 3. ToolsToFinalOutput 模式

工具直接返回最终输出：
- 减少不必要的模型再调用
- 适用于确定性工具（如计算器、查询工具）

**可实现**: 在 OpenClaw 工具系统中增加 `is_final_output` 标志。

### 4. Agent-as-Tool

一个 Agent 可被另一个 Agent 用作工具：
- 子 Agent 可独立运行 + 返回结果
- 主 Agent 控制子 Agent 的调用

**可实现**: OpenClaw 的 subagent 机制已类似，但缺少 `agent.tools` 合并逻辑。

### 5. Handoff 系统

Agent 间的优雅切换：
- 带输入过滤
- 带状态传递
- 触发条件由 LLM 决定

**可实现**: OpenClaw 缺乏此机制，可在 skill 系统上模拟。

### 6. .agents/skills 目录结构

每个技能包含：
- SKILL.md（技能定义）
- agents/openai.yaml（Agent 配置）
- scripts/（执行脚本）
- references/（参考文档）
- templates/（代码模板）

**可实现**: OpenClaw skill 可增加 `agents/` 和 `references/` 子目录。

---

## 与 OpenClaw 架构对比

| 维度 | OpenAI Agents SDK | OpenClaw |
|------|-------------------|----------|
| 运行时 | Python asyncio | Bun/Node ESM |
| Agent 定义 | `@dataclass Agent` | SKILL.md + Hook |
| 工具类型 | FunctionTool, ComputerTool, MCPTool | Bash, Read, Edit, Glob, Grep |
| 生命周期 | RunHooks | Hooks (onMessage 等) |
| 安全 | Guardrail + Tool Approval | permission gating |
| 多 Agent | Handoff | subagent/sessions_spawn |
| 记忆 | Session Protocol | Memory Palace (Wing/Room) |
| 追踪 | Span/Tracy | analytics |

---

## 关键文件索引

```
src/agents/
├── __init__.py           # 公开 API
├── agent.py              # Agent/Handoff 定义
├── run.py                # Runner 运行循环
├── tool.py               # 工具基类 + FunctionTool
├── guardrail.py          # Input/Output Guardrail
├── handoffs.py           # Handoff 系统
├── run_context.py        # RunContextWrapper[TContext]
├── lifecycle.py          # RunHooks
├── memory/
│   └── session.py        # Session Protocol
├── models/
│   ├── interface.py      # Model Provider 接口
│   ├── openai_provider.py
│   └── multi_provider.py  # 多提供商路由
├── computer.py           # ComputerTool
├── mcp/                   # MCP 集成
├── tracing/              # Span 追踪
└── exceptions.py          # 异常类型
```
