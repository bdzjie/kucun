---

## 11:52 GitHub Research — addyosmani/agent-skills

Repo: `addyosmani/agent-skills` ⭐ ~9K | MIT | 20 structured skills for AI coding agents
Docs: https://github.com/addyosmani/agent-skills
参考: Google SWE at Google + engineering practices guide

---

### 定位

Production-grade engineering skills for AI coding agents. 将资深工程师的工作流程、质量门控和最佳实践打包成 AI agent 可遵循的结构化技能。

**核心主张**: AI coding agents 默认走最短路径——跳过 spec、tests、security review，导致软件质量下降。agent-skills 提供结构化工作流，让 AI agent 达到 senior engineer 的工程标准。

---

### 架构总览

```
7 个 slash commands 作为入口:
/spec  → 定义阶段
/plan  → 规划阶段
/build → 构建阶段
/test  → 测试阶段
/review → 评审阶段
/ship  → 上线阶段
/code-simplify → 简化阶段

每个 command 激活对应技能（20个核心技能）:
Define(2) / Plan(1) / Build(6) / Verify(2) / Review(4) / Ship(5)
```

---

### 20 个核心技能

| 技能 | 阶段 | 用途 |
|------|------|------|
| idea-refine | Define | 发散/收敛思维，将模糊想法具体化 |
| spec-driven-development | Define | 写 PRD（目标/命令/结构/代码风格/测试/边界） |
| planning-and-task-breakdown | Plan | 拆解为小、可验证、带验收标准的任务 |
| incremental-implementation | Build | 薄垂直切片——实现/测试/验证/提交，特性开关 |
| context-engineering | Build | 在正确时间给 agent 正确信息 |
| source-driven-development | Build | 基于官方文档做框架决策，引用来源 |
| frontend-ui-engineering | Build | 组件架构/设计系统/状态管理/响应式/WCAG 2.1 AA |
| test-driven-development | Build | 红绿重构，测试金字塔(80/15/5)，DAMP>DRY |
| api-and-interface-design | Build | 契约优先设计，Hyrum's Law，One-Version Rule |
| browser-testing-with-devtools | Verify | Chrome DevTools MCP 实时运行时数据 |
| debugging-and-error-recovery | Verify | 五步 triage: 重现/定位/缩小/修复/防护 |
| code-review-and-quality | Review | 五轴 review，~100 行变更，severity 标签 |
| code-simplification | Review | Chesterton's Fence，Rule of 500，降低复杂度 |
| security-and-hardening | Review | OWASP Top 10，认证模式，密钥管理 |
| performance-optimization | Review | Measure-first，Core Web Vitals，profiling |
| git-workflow-and-versioning | Ship | TBD，atomic commits，~100 行变更 |
| ci-cd-and-automation | Ship | Shift Left，Feature Flags，Quality Gate Pipelines |
| deprecation-and-migration | Ship | Code-as-liability，compulsory vs advisory |
| documentation-and-adrs | Ship | ADR 记录架构决策，API docs |
| shipping-and-launch | Ship | Pre-launch checklists，staged rollouts |

---

### Skill Anatomy（技能结构）

每个 SKILL.md 遵循一致的结构:

```
┌─────────────────────────────────────────┐
│ SKILL.md                                 │
│                                          │
│ ┌─ Frontmatter ───────────────────────┐  │
│ │ name: lowercase-hyphen-name          │  │
│ │ description: Guides agents through   │  │
│ │ [task]. Use when…                    │  │
│ └───────────────────────────────────────┘  │
│                                          │
│ Overview → What this skill does          │
│ When to Use → Triggering conditions      │
│ Process → Step-by-step workflow          │
│ Rationalizations → Excuses + rebuttals   │
│ Red Flags → Signs something's wrong      │
│ Verification → Evidence requirements     │
└─────────────────────────────────────────┘
```

**关键设计选择**:
1. **Process, not prose** — 技能是 agent 遵循的工作流，不是参考文档
2. **Anti-rationalization** — 每技能都有常见借口表格（如"I'll add tests later"）和反驳论据
3. **Verification is non-negotiable** — 每技能结尾有证据要求（tests passing, build output）
4. **Progressive disclosure** — SKILL.md 是入口，supporting references 只在需要时加载

---

### 关键工程实践

#### TDD — Test-Driven Development

```
RED GREEN REFACTOR
Write test → Write minimal code → Clean up
  that fails    to make it pass    implementation
```

**测试金字塔**:
```
        ╱╲
       ╱  ╲ E2E Tests (~5%)
      ╱────╲
     ╱      ╲ Integration Tests (~15%)
    ╱──────────╲
   ╱            ╲ Unit Tests (~80%)
  ╱──────────────────╲
```

**Beyonce Rule**: "If you liked it, you should have put a test on it."

**DAMP over DRY**: Tests should read like specifications. Self-contained > Shared helpers.

**Prove-It Pattern** (for bug fixes):
```
Bug report → Write test that reproduces bug (FAILS) → Fix bug → Test PASSES
```

#### Debugging — Stop-the-Line Rule

```
1. STOP adding features
2. PRESERVE evidence (error output, logs, repro steps)
3. DIAGNOSE using triage checklist
4. FIX root cause
5. GUARD against recurrence
6. RESUME only after verification passes
```

**Five-Step Triage Checklist**:
1. **Reproduce** — Make the failure happen reliably
2. **Localize** — Narrow down WHERE (UI/API/DB/Build/External/Test)
3. **Reduce** — Create minimal failing case
4. **Fix** — Fix underlying issue, not symptom
5. **Guard** — Write test that catches this failure

#### Spec-Driven Development — Gated Workflow

```
SPECIFY ──→ PLAN ──→ TASKS ──→ IMPLEMENT
   │          │        │          │
   ▼          ▼        ▼          ▼
 Human      Human    Human      Human
 reviews   reviews  reviews   reviews
```

**Spec 必须覆盖 6 个核心领域**:
1. **Objective** — 目标、用户、成功标准
2. **Commands** — 完整可执行命令（含 flags）
3. **Project Structure** — 源码/测试/文档位置
4. **Code Style** — 一个真实代码片段 > 三段描述
5. **Testing Strategy** — 框架、位置、覆盖率期望
6. **Boundaries** — Always/Ask First/Never

#### Code Review — Five-Axis Review

Change sizing: ~100 lines per review
Severity labels: Nit/Optional/FYI

---

### Rationalization 表格示例

| Rationalization | Reality |
|-----------------|---------|
| "I'll write tests after the code works" | You won't. And tests written after test implementation, not behavior. |
| "This is too simple to test" | Simple code gets complicated. The test documents the expected behavior. |
| "Tests slow me down" | Tests slow you down now. They speed you up every time you change the code later. |
| "I tested it manually" | Manual testing doesn't persist. Tomorrow's change might break it. |
| "The code is self-explanatory" | Tests ARE the specification. |

---

### OpenClaw 对比

| 维度 | agent-skills | OpenClaw 当前 |
|------|-------------|--------------|
| Skills 数量 | 20 | 30 (但结构松散) |
| Skill 结构 | 标准化 (name/desc/overview/when/process/rationalization/red flags/verification) | 基础 (name/desc/commands) |
| Anti-rationalization | 有（借口+反驳表格） | 无 |
| Verification gates | 每技能有明确退出标准 | 无 |
| Slash commands | 7 个入口命令 | 无 |
| Auto-activation | 基于上下文的自动激活 | 手动触发 |
| 测试金字塔 | 明确 (80/15/5) | 无 |
| Stop-the-line rule | 有 | 无 |
| Spec before code | 有 (spec-driven-development) | 无 |
| Specialist agents | 3 个 (code-reviewer/test-engineer/security-auditor) | 无 |

---

## 对 OpenClaw 的启发

### 1. 技能结构标准化（Priority: HIGH）

当前 OpenClaw skills 只有 `name/description/commands`，缺少：
- Overview（技能做什么）
- When to Use（触发条件）
- Process（步骤）
- Rationalizations（常见借口+反驳）
- Red Flags（警告信号）
- Verification（验收标准）

**行动**: 选择 3-5 个核心 skills，按 agent-skills 格式重构

**候选技能**:
1. `spec-driven` — 基于 spec-driven-development
2. `tdd` — 基于 test-driven-development
3. `debugging` — 基于 debugging-and-error-recovery
4. `code-review` — 基于 code-review-and-quality

### 2. 添加 Anti-Rationalization 表格（Priority: HIGH）

每个技能添加 "Common Rationalizations" 表格，列出 agent 常用借口和反驳论据。

例如 `tdd/SKILL.md`:
```
| Rationalization | Reality |
|-----------------|---------|
| "I'll add tests later" | You won't. Write tests first. |
| "This is too simple to test" | Simple code gets complicated. |
```

### 3. 添加 Verification Gates（Priority: HIGH）

每个技能结尾添加明确验收标准：
- [ ] 所有新行为有对应测试
- [ ] 所有测试通过
- [ ] Bug fix 包含 reproduction test
- [ ] 无测试被跳过

### 4. 创建 Slash Commands（Priority: MEDIUM）

实现 7 个 slash commands 作为入口：
- `/spec` — 激活 spec-driven-development
- `/plan` — 激活 planning-and-task-breakdown
- `/build` — 激活 incremental-implementation
- `/test` — 激活 test-driven-development
- `/review` — 激活 code-review-and-quality
- `/ship` — 激活 shipping-and-launch
- `/code-simplify` — 激活 code-simplification

### 5. 添加 Auto-Activation 规则（Priority: MEDIUM）

基于上下文自动激活技能：
- 设计 API → 自动激活 api-and-interface-design
- 构建 UI → 自动激活 frontend-ui-engineering
- Bug report → 自动激活 debugging-and-error-recovery
- PR review → 自动激活 code-review-and-quality

### 6. 添加 Specialist Personas（Priority: LOW）

3 个专家角色：
- `agents/code-reviewer.md` — Senior Staff Engineer 视角
- `agents/test-engineer.md` — QA Specialist 视角
- `agents/security-auditor.md` — Security Engineer 视角

### 7. 借鉴测试金字塔（Priority: MEDIUM）

当前 OpenClaw 无测试策略。可以：
- 添加 `test-strategy.md` 参考文档
- 在 skills 中强调 80/15/5 比例
- 添加 `DAMP over DRY` 原则

### 8. Stop-the-Line Rule（Priority: HIGH）

借鉴 debugging-and-error-recovery 的 stop-the-line rule：
- Fails → 停止添加功能
- 保留证据
- 系统化诊断
- 修复根因
- 添加 regression guard
- 验证后恢复

**与 OpenClaw 当前 guardianails 系统的整合点**:
- `guardrail-config` skill 可以增加 "stop-the-line" 模式
- 工具执行失败时自动触发 debugging 流程

---

## 下一步行动

### 第一阶段（立即）: 重构核心 Skills

选择 4 个技能按 agent-skills 格式重构:

1. **`skills/spec-driven/`** (新建)
   - 基于 spec-driven-development
   - 添加 Overview/When/Process/Rationalization/Red Flags/Verification
   - Gated workflow: Spec → Plan → Tasks → Implement

2. **`skills/tdd/`** (新建)
   - 基于 test-driven-development
   - Red-Green-Refactor 流程
   - 测试金字塔
   - Prove-It Pattern for bugs

3. **`skills/debugging/`** (新建)
   - 基于 debugging-and-error-recovery
   - Stop-the-Line Rule
   - 五步 triage checklist
   - Error-specific patterns

4. **`skills/code-review/`** (新建)
   - 基于 code-review-and-quality
   - Five-axis review
   - ~100 line change sizing
   - Severity labels

### 第二阶段（本周）: 添加 Slash Commands

在 `hooks/` 或 `skills/` 中实现 7 个入口命令

### 第三阶段（长期）: Specialist Personas

创建 3 个专家角色 agent definitions

---

## 参考资源

- Google SWE Book: https://abseil.io/resources/swe-book
- Google Engineering Practices: https://google.github.io/eng-practices/
- Hyrum's Law: 接口的隐式契约
- Beyonce Rule: 测试一切重要内容
- Chesterton's Fence: 不理解为什么存在就不要移除

---

*最后更新: 2026-04-20*

---

## 12:20 GitHub Research — vercel-labs/agent-browser

Repo: `vercel-labs/agent-browser` | Rust CLI | Browser automation for AI agents
Docs: https://github.com/vercel-labs/agent-browser

### 定位

Native Rust CLI for browser automation. 核心创新：Accessibility Tree with Refs（AI友好的元素引用系统）。

### 核心架构

```
┌─────────────────────────────────────────────────────────────┐
│ agent-browser (Rust CLI)                                     │
│                                                              │
│  install → Download Chrome from Chrome for Testing           │
│  open <url> → Launch browser                                 │
│  snapshot → Get accessibility tree with @e1, @e2, @e3 refs   │
│  click @e2 → Click by reference (no fragile selectors)     │
│  close → Clean shutdown                                      │
└─────────────────────────────────────────────────────────────┘
```

### 核心创新：Accessibility Tree + Refs

```bash
# snapshot 输出示例
[1]  "Sign In" (button, disabled) @e1
[2]  "Email" (textbox) @e2
[3]  "Password" (textbox) @e3
[4]  "Submit" (button) @e4

# AI 使用 @e2 引用而非 CSS 选择器
agent-browser fill @e2 "test@example.com"
agent-browser click @e4
```

**优势**：
- 无需 CSS 选择器（不怕页面结构变化）
- AI 可读性强（accessibility tree 语义清晰）
- Refs 稳定（元素重新渲染后 ref 可能变化，但有 `@eN` 约定）

### 关键能力矩阵

| 能力 | 命令 | 说明 |
|------|------|------|
| 导航 | `open <url>` | 访问 URL |
| 快照 | `snapshot [-i]` | 无障碍树（含 refs），`-i` 交互式 |
| 点击 | `click @e2` | 通过 ref 点击 |
| 填写 | `fill @e3 "text"` | 清空并填写 |
| 输入 | `type @e3 "text"` | 追加输入 |
| 截图 | `screenshot [--annotate]` | 标注版带编号 |
| 等待 | `wait --text "Welcome"` | 文本/URL/条件等待 |
| 批量 | `batch "cmd1" "cmd2" "cmd3"` | 批量执行减少启动开销 |
| 差分 | `diff snapshot/screenshot` | 快照/截图对比 |
| Chat | `chat "自然语言指令"` | AI 自然语言控制 |

### 语义定位器（AI-Friendly）

```bash
# 不用 CSS，用语义
agent-browser find role button click --name "Submit"
agent-browser find text "Sign In" click
agent-browser find label "Email" fill "test@test.com"
agent-browser find nth 2 "a" text
```

### 网络控制

```bash
agent-browser network route <url> --abort      # 阻止请求
agent-browser network route <url> --body <json> # Mock 响应
agent-browser network requests --filter api     # 查看请求
agent-browser network har start/stop           # HAR 录制
```

### Tab 管理

```bash
agent-browser tab new --label docs https://...  # 带标签的新标签页
agent-browser tab docs                         # 按标签切换
agent-browser tab close docs                   # 按标签关闭
```

Tab ID 格式：`t1`, `t2` — 稳定字符串，会话内不重用

### Diff 功能

```bash
# 快照差分
agent-browser diff snapshot --baseline before.txt

# 截图像素差分
agent-browser diff screenshot --baseline b.png -t 0.2

# URL 对比
agent-browser diff url https://v1.com https://v2.com --screenshot
```

### Chat 模式

```bash
# 单次自然语言控制
agent-browser chat "Click the sign in button and fill email with test@example.com"

# 交互式 REPL
agent-browser chat
```

### 与 windows-gui skill 对比

| 维度 | windows-gui (PyAutoGUI) | agent-browser |
|------|-------------------------|---------------|
| 平台 | Windows 专用 | 跨平台（Win/Mac/Linux）|
| 速度 | Python，相对慢 | Rust，极快 |
| 元素定位 | 像素坐标（脆弱）| Accessibility refs（健壮）|
| 元素发现 | 需要坐标 | 语义定位器 + snapshot |
| 网络控制 | 无 | 完整（mock/block/har）|
| 截图 | 支持 | 支持 + 标注 |
| AI 友好度 | 低（坐标）| 高（refs + chat）|

### 对 OpenClaw 的启发

#### 1. Accessibility Refs 模式（Priority: HIGH）

agent-browser 的 `@e1/@e2` 模式非常适合 AI Agent。

**OpenClaw 现状**：windows-gui 使用 PyAutoGUI 坐标，脆弱。

**改进方案**：
- 如果 `agent-browser` 可用：用它替代 windows-gui
- 创建 `skills/agent-browser/` skill，封装 CLI
- 保留 `windows-gui` 作为 Windows fallback

#### 2. Chat 模式集成（Priority: MEDIUM）

`agent-browser chat` 可以作为 browser tool 的自然语言接口。

**潜在工作流**：
```
用户："帮我填表"
Agent：调用 agent-browser chat "fill form with name=Qian and email=q@q.com"
```

#### 3. Batch 模式优化（Priority: MEDIUM）

agent-browser 支持批量执行，减少进程启动开销。

**工作流优化**：
```bash
# 当前：每个命令启动一次
agent-browser open example.com
agent-browser snapshot
agent-browser click @e1

# 优化后：批量执行
agent-browser batch "open example.com" "snapshot -i" "click @e1"
```

#### 4. Snapshot + Annotated Screenshot（Priority: HIGH）

`agent-browser snapshot` 提供的 accessibility tree 比截图更易解析。

**结合 memory_provenance**：
- 每次 browser 操作记录 snapshot 到记忆
- 建立"页面结构知识图谱"

#### 5. Diff 作为测试工具（Priority: LOW）

agent-browser diff 可用于：
- UI 变更检测
- 截图回归测试
- A/B 测试对比

### 集成路径

**Phase 1：检测和封装**
```javascript
// 检查 agent-browser 是否安装
execSync('agent-browser --version')

// 如果存在：创建 agent-browser skill
// 如果不存在：回退到 windows-gui
```

**Phase 2：迁移工作流**
- 用 `agent-browser open <url>` 替代 PyAutoGUI 坐标点击
- 用 `snapshot` + `@eN` 替代像素定位
- 用 `find role/text/label` 替代 CSS 选择器

**Phase 3：增强功能**
- 网络 mock 用于测试
- Diff 用于回归检测
- Chat 模式用于自然语言控制

### 与现有模块的关系

| 模块 | 关系 |
|------|------|
| windows-gui skill | 竞争：agent-browser 更优 |
| memory_provenance | 补充：browser 操作可记录 snapshot |
| sandbox-config | 补充：browser 自动化需要沙箱 |
| proactive_memory | 补充：browser 行为可作为记忆 |

### 安装状态

```bash
# macOS
brew install agent-browser

# npm (全局)
npm install -g agent-browser
agent-browser install

# Rust 源码
cargo install agent-browser
agent-browser install
```

---

*最后更新: 2026-04-20*
