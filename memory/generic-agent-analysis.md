# GenericAgent 源码分析

**仓库**: github.com/lsdefine/GenericAgent
**分析日期**: 2026-04-19
**语言**: Python 3
**核心哲学**: 不预设技能，靠进化获得能力

---

## 核心架构

```
GenericAgent (~3K 行核心代码)
├── agent_loop.py    — ~100行，Agent 执行循环（生成器驱动）
├── ga.py            — GenericAgentHandler，7个原子工具
├── agentmain.py     — GeneraticAgent 主类，LLM客户端管理
├── TMWebDriver.py   — 真实浏览器注入控制
└── llmcore/         — LLM 会话抽象层
```

---

## Agent Loop — ~100行核心循环

```python
# agent_loop.py — agent_runner_loop()

while turn < handler.max_turns:
    response = yield from client.chat(messages, tools=tools_schema)  # LLM 调用
    tool_calls = parse_function_calls(response)                       # 解析工具调用
    
    for tc in tool_calls:
        outcome = handler.dispatch(tool_name, args, response)
        if outcome.should_exit: break
        if outcome.next_prompt.startswith('未知工具'): client.last_tools = ''  # 重置工具描述
    
    next_prompt = handler.turn_end_callback(response, ..., exit_reason)
    messages = [{"role": "user", "content": next_prompt}]  # 仅保留最新消息
```

**关键设计**:
- Generator-based：流式输出，每轮yield显示进度
- `last_tools = ''` 每10轮重置：避免上下文膨胀导致模型性能下降
- **History kept in Session**：只发最新消息，但 LLM 客户端保留完整历史
- `should_exit` / `next_prompt` 控制流：决定继续、退出还是任务完成
- `turn_end_callback`：钩子，任务结束时触发记忆固化

---

## 工具系统 — 7个原子工具

### GenericAgentHandler (ga.py)

| 工具 | 函数 | 核心能力 |
|------|------|---------|
| `code_run` | `do_code_run()` | 执行 Python/PowerShell/Bash 代码 |
| `file_read` | `do_file_read()` | 读取文件（支持关键字搜索） |
| `file_write` | `do_file_write()` | 写入文件（overwrite/append/prepend） |
| `file_patch` | `do_file_patch()` | 局部修改（唯一old_content匹配） |
| `web_scan` | `do_web_scan()` | 获取简化HTML + 标签页列表 |
| `web_execute_js` | `do_web_execute_js()` | 执行JS控制浏览器 |
| `ask_user` | `do_ask_user()` | 人机协作确认 |

### code_run 详解

```python
def code_run(code, code_type="python", timeout=60, ...):
    if code_type == "python":
        # 写入 tempfile.NamedTemporaryFile(.ai.py)
        # 执行: python -X utf8 -u tmp_path
    elif code_type in ["powershell", "bash"]:
        cmd = ["powershell", "-NoProfile", "-NonInteractive", "-Command", code]
    
    # 子进程stdout流式读取 + 超时控制
    # FAILSAGE: stop_signal 列表
```

**设计亮点**:
- Python 优先，系统操作才用 PowerShell
- `inline_eval` 参数：内联 eval/exec，不写文件
- `code_cwd`：代码执行的工作目录

### web_scan / web_execute_js

```python
# 使用 TMWebDriver（浏览器注入）
driver = TMWebDriver()  # 真实Chrome，保留登录态
simphtml.get_html(driver, maxchars=35000)  # 简化HTML，减少token

# JS执行后监控页面变化
result = simphtml.execute_js_rich(script, driver, no_monitor=no_monitor)
```

**关键**：`simphtml` 过滤边栏/浮动元素，只保留主体内容，减少token消耗。

### file_patch

```python
def file_patch(path, old_content, new_content):
    # 精确匹配：count == 0 → 报错；count > 1 → 报错
    # 唯一匹配才执行，防止意外修改
```

---

## 分层记忆系统

GenericAgent 的记忆分为 4 层：

| 层级 | 文件 | 内容 | Token |
|------|------|------|-------|
| **L0 Meta** | `assets/sys_prompt_*.txt` | 基础行为规则 | ~500 |
| **L1 Insight** | `memory/global_mem_insight.txt` | 极简索引，快速路由 | ~100 |
| **L2 Facts** | `memory/global_mem.txt` | 长期知识积累 | ~500 |
| **L3 Skills** | `skills/*.md` | 可复用工作流 | ~2K/个 |
| **L4 Archive** | `memory/session_archive/` | 归档会话记录 | — |

### 记忆更新工具

通过 `update_working_checkpoint` 和 `start_long_term_update` 实现：

- `update_working_checkpoint`：更新工作记忆（当前任务的关键信息）
- `start_long_term_update`：任务完成后，将经验写入 L2/L3 层

---

## 自我进化机制

```
[新任务]
  ↓ 首次执行（自主摸索）
安装依赖 → 编写脚本 → 调试验证 → 执行成功
  ↓
[将执行路径固化为 Skill]
skill_md = {
  "name": "任务类型",
  "trigger": "关键词",
  "steps": [执行步骤],
  "description": "..."
}
  ↓
写入 skills/ 目录
  ↓
[下次同类任务]
直接调用 skill → 一句话执行
```

---

## 与 OpenClaw 的关键差异

| 维度 | GenericAgent | OpenClaw |
|------|-------------|----------|
| **代码量** | ~3K | ~530K |
| **工具集** | 7个原子工具 | 16个内置 + MCP |
| **浏览器** | 真实Chrome注入 | headless/sandbox |
| **记忆** | 4层手动积累 | 4层自动提取 |
| **进化** | 自主固化Skill | 手动创建Skill |
| **执行循环** | ~100行生成器 | ~1000行状态机 |
| **部署** | pip + API Key | 多服务编排 |

### 值得借鉴的设计

1. **极简工具集**：7个工具覆盖所有场景，通过 `code_run` 动态扩展
2. **Token预算管理**：每10轮重置工具描述，避免上下文膨胀
3. **code_run + inline_eval**：简单代码内联执行，避免文件IO
4. **file_patch 唯一性检查**：防止意外批量修改
5. **真实浏览器注入**：保留登录态，比headless更真实
6. **流式生成器循环**：每轮yield进度，用户可见执行状态
7. **Skill 自举**：用AI完成任务后，让AI自己写Skill文档

---

## 架构亮点

### 1. 代码执行沙箱
- `code_run` 通过临时文件 + subprocess 执行
- 超时 + stop_signal 双重保护
- PowerShell 用于系统操作，Python 用于复杂逻辑

### 2. 文件操作安全
- `file_patch` 要求唯一匹配（count==1）
- 找不到或找到多处都报错
- `file_read` 支持关键字搜索和拼写纠正

### 3. 浏览器控制
- TMWebDriver 注入真实Chrome
- `simphtml` 简化HTML（35000 char限制）
- JS 执行后监控页面变化

### 4. 多模型支持
- `llmcore`: ClaudeSession / LLMSession / MixinSession / NativeSession
- `MixinSession`: 多个LLM客户端组合
- 动态切换：不同模型用不同工具schema

---

## 技术栈

```
Python 3
├── streamlit         — Web UI
├── pywebview          — 桌面嵌入浏览器
├── playwright         — 浏览器自动化
├── requests           — HTTP
└── Telegram Bot / Feishu / DingTalk / WeCom
```

---

## 总结

GenericAgent 的核心创新是**自我进化**：不预设技能树，而是让AI在完成任务过程中自动沉淀技能。它的设计哲学是**极简 + 自举**：
- 7个原子工具足够覆盖所有场景
- ~100行执行循环驱动整个系统
- ~3K行核心代码，无复杂依赖
- 通过 `code_run` 动态扩展能力

**对 OpenClaw 的启发**：
1. 在 `code_run` 类工具中支持 `inline_eval`，减少文件IO
2. 实现 Skill 自举：任务完成后自动生成 SKILL.md
3. 每 N 轮重置工具描述，防止上下文膨胀
4. 考虑真实浏览器注入方案（而非纯headless）
