# OpenAI Agents SDK 分析

**分析日期**: 2026-04-19
**仓库**: openai/openai-agents-python
**规模**: Python SDK, ~100+ 模块

---

## 深度分析补充（第二轮）

### 核心文件分析

#### turn_resolution.py — 执行引擎核心

```python
# 关键函数
async def _maybe_finalize_from_tool_results(...):
    # 检查工具是否返回了最终输出
    check_tool_use = await check_for_final_output_from_tools(...)
    if check_tool_use.is_final_output:
        return await execute_final_output(...)

async def execute_handoffs(...):
    # 执行 agent-to-agent 切换
    with handoff_span(from_agent=public_agent.name) as span_handoff:
        new_agent = await handoff.on_invoke_handoff(context, args)
        # 调用 on_handoff hooks
        await asyncio.gather(
            hooks.on_handoff(ctx, from_agent, to_agent),
            public_agent.hooks.on_handoff(ctx, to_agent, source),
        )
        # 处理输入过滤和历史嵌套
        input_filter = handoff.input_filter or run_config.handoff_input_filter
        should_nest = handoff.nest_history if handoff.nest_history is not None else run_config.nest_handoff_history
```

**关键洞察**:
- 多个 handoff 在同一 turn：只执行第一个，其余返回 "Multiple handoffs detected"
- `handoff_span` 用于追踪整个切换过程
- 输入过滤可嵌套，通过 `nest_handoff_history_fn` 支持自定义

#### lifecycle.py — RunHooksBase 完整定义

```python
class RunHooksBase(Generic[TContext, TAgent]):
    # Turn 生命周期
    async def on_llm_start(self, context, agent, system_prompt, input_items): pass
    async def on_llm_end(self, context, agent, response): pass
    
    # Agent 生命周期
    async def on_agent_start(self, context, agent): pass
    async def on_agent_end(self, context, agent, output): pass
    
    # Tool 生命周期
    async def on_tool_start(self, context, agent, tool): pass
    async def on_tool_end(self, context, agent, tool, result): pass
    
    # Handoff 生命周期
    async def on_handoff(self, context, from_agent, to_agent): pass

class AgentHooksBase(Generic[TContext, TAgent]):
    # 每个 Agent 自己的 hooks
    async def on_start(self, context, agent): pass
    async def on_end(self, context, agent, output): pass
    async def on_handoff(self, context, agent, source): pass
```

**洞察**: 两级 Hook 系统 — 全局 RunHooks + 单个 Agent Hooks。

#### tool_guardrails.py — Tool 级别 Guardrail

```python
# 三种行为
class ToolGuardrailFunctionOutput:
    behavior = {
        "type": "allow" | "reject_content" | "raise_exception",
        "message": str  # reject_content 时显示给模型的消息
    }

# ToolInputGuardrail — 工具执行前检查
@dataclass
class ToolInputGuardrail(Generic[TContext_co]):
    guardrail_function: Callable[[ToolInputGuardrailData], ...]
    
    async def run(self, data: ToolInputGuardrailData):
        # data.context 是 ToolContext
        # 包含 tool_name, tool_call_id, tool_arguments

# ToolOutputGuardrail — 工具执行后检查
@dataclass  
class ToolOutputGuardrail(Generic[TContext_co]):
    guardrail_function: Callable[[ToolOutputGuardrailData], ...]
    # data 额外包含 output
```

**洞察**: 
- `reject_content` 允许继续执行但替换输出内容
- `raise_exception` 真正中断执行
- `ToolContext` 包含完整的调用上下文（tool_call_id 等）

#### tracing/spans.py — Span 实现

```python
class SpanImpl(Span[TSpanData]):
    __slots__ = ("_trace_id", "_span_id", "_parent_id", 
                 "_started_at", "_ended_at", "_error", 
                 "_prev_span_token", "_processor", "_span_data")
    
    # Contextvars 用于 async-safe TLS
    def start(self, mark_as_current=False):
        self._started_at = util.time_iso()
        self._processor.on_span_start(self)
        if mark_as_current:
            self._prev_span_token = Scope.set_current_span(self)

# NoOpSpan - tracing 禁用时的无操作实现
class NoOpSpan(Span[TSpanData]):
    # 所有操作都是 no-op，不记录任何数据
```

**洞察**:
- 使用 `__slots__` 优化内存
- ISO 时间戳 (`util.time_iso()`) 替代 Unix ms
- `Scope.set_current_span()` 使用 contextvars 实现异步安全的当前 span 追踪

#### agent.py — Agent 完整定义

```python
@dataclass
class Agent(AgentBase[TContext]):
    # 核心
    instructions: str | Callable | None
    tools: list[Tool] = field(default_factory=list)
    handoffs: list[Handoff] = field(default_factory=list)
    
    # Guardrail
    input_guardrails: list[InputGuardrail[TContext]] = field(default_factory=list)
    output_guardrails: list[OutputGuardrail[TContext]] = field(default_factory=list)
    
    # 输出类型
    output_type: type | None = None
    tools_to_final_output: ToolsToFinalOutputFunction | None = None
    
    # MCP
    mcp_servers: list[MCPServer] = field(default_factory=list)
    
    # Hooks
    hooks: AgentHooks[TContext] | None = None

@dataclass
class ToolsToFinalOutputResult:
    is_final_output: bool
    final_output: Any | None = None

# get_all_tools() 合并 MCP + 启用状态的工具
async def get_all_tools(self, run_context):
    mcp_tools = await self.get_mcp_tools(run_context)
    # 过滤 is_enabled
    enabled = await asyncio.gather(*[_check_tool_enabled(t) for t in self.tools])
    all_tools = prune_orphaned_tool_search_tools([*mcp_tools, *enabled])
```

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

---

## 已实现功能（OpenClaw）

| 功能 | 状态 | 实现文件 |
|------|------|---------|
| Tool Guardrail (Input/Output) | ✅ v1 | `modules/tool_guardrail_hook.mjs` |
| Tool Guardrail (v2, with behaviors) | ✅ | `modules/tool_guardrails_v2.mjs` |
| Session Compaction Protocol | ✅ | `modules/session_compaction_protocol.mjs` |
| Lifecycle Hooks | ✅ | `modules/run_hooks_lifecycle.mjs` |
| Span Tracing | ✅ | `modules/span_tracing.mjs` |
| Agent Handoff System | ✅ | `modules/agent_handoff.mjs` |
| /lifecycle-tracing skill | ✅ | `skills/lifecycle-tracing/` |
| /agent-handoff skill | ✅ | `skills/agent-handoff/` |
| ToolsToFinalOutput pattern | 🔜 | 待实现 |
| Handoff with history nesting | 🔜 | `agent_handoff.mjs` 已支持 |
| ComputerTool (browser automation) | ❌ | 需要浏览器扩展 |

### Tool Guardrail v2 特性

```javascript
// 三种行为
ToolGuardrailOutput.allow({ check: 'path', passed: true })
ToolGuardrailOutput.rejectContent('Path traversal detected', { blocked: true })
ToolGuardrailOutput.raiseException({ reason: 'critical' })

// 内置检查器
pathTraversalGuardrail()    // 路径遍历检测
bashDangerousCommandGuardrail()  // 危险命令检测
outputSizeGuardrail(100000)      // 输出大小限制
sqlInjectionGuardrail()         // SQL 注入检测
```

### Span Tracing 特性

```javascript
import { trace, span, getCurrentSpan } from './modules/span_tracing.mjs';

// 创建 trace 并执行
const result = await trace('my-run', { metadata: {} }, async (t) => {
  const s = t.span('llm-call', { type: 'llm', model: 'gpt-4' });
  await s.run(async () => {
    const result = await callModel();
    s.setAttribute('tokens', result.usage.outputTokens);
  });
});
```

### Agent Handoff 特性

```javascript
import { createHandoff, nestHandoffHistory } from './modules/agent_handoff.mjs';

// 创建 handoff
const handoff = createHandoff({
  toAgent: 'researcher',
  description: 'Transfer to research specialist',
  inputFilter: async (input) => addContextFilter({ mode: 'research' }),
  nestHistory: true,
});

// 嵌套历史
const nested = nestHandoffHistory(input, { prefix: 'Prior context:', maxDepth: 5 });
```

---

## 深度学习总结

### SDK 架构设计亮点

1. **泛型 Context 类型** (`TContext`)
   - 所有组件都用 `Generic[TContext]` 声明
   - 允许用户定义自己的上下文类型，贯穿整个调用链

2. **分层 Hook 系统**
   - `RunHooks` (全局) + `AgentHooks` (单 Agent)
   - 两级都可以定义 `on_handoff`, `on_tool_*`, `on_llm_*`

3. **ToolContext 传递**
   - `ToolContext` 包含 `tool_call_id`, `tool_name`, `tool_arguments`
   - Guardrail 可以访问完整的调用上下文

4. **Span + Processor 分离**
   - `SpanImpl` / `NoOpSpan` 实现
   - `TracingProcessor` 接口（`on_span_start/end`, `on_trace_end`）
   - Batch processor 支持批量导出

5. **Handoff 的多重保障**
   - `input_filter` 转换输入
   - `nest_history` 保留历史
   - `on_invoke_handoff` 动态目标解析
   - `handoff_span` 追踪整个切换

6. **Guardrail 行为系统**
   - `allow` / `reject_content` / `raise_exception`
   - `reject_content` 巧妙：给模型一条消息而不是异常

### OpenClaw 适配策略

由于 OpenClaw 是 Bun 运行时且 skill 系统基于文件 + hook：

1. **Lifecycle Hooks** → `hooks/` 层实现
2. **Span Tracing** → `modules/span_tracing.mjs`（纯 ESM）
3. **Tool Guardrail** → `hooks/tool-guardrail-hook/`
4. **Agent Handoff** → `skills/agent-handoff/`（命令式）
5. **Session Compaction** → `modules/session_compaction_protocol.mjs`

Python 不能直接 import 到 Bun/Node ESM，所以所有核心模块都用纯 JavaScript/ESM 实现。
Python 模块（如 `auto_skill_creator.py`）通过 `child_process.spawn` 调用。
```
