# Evolver 源码分析

**仓库**: github.com/EvoMap/evolver
**分析日期**: 2026-04-19
**语言**: Node.js (>= 18)
**许可证**: GPL-3.0

---

## 核心定位

> **"Evolution is not optional. Adapt or die."**

Evolver 是基于 **GEP（Genome Evolution Protocol）** 的 AI Agent 自进化引擎。它的核心不是执行任务，而是**引导进化**——通过结构化的 Gene/Capsule 体系，让 Agent 的能力进化变得可审计、可复用、可共享。

**与 GenericAgent 的关键区别**：

| 维度 | GenericAgent | Evolver |
|------|------------|---------|
| **核心** | 执行循环 (~100行) | 进化协议 (731KB引擎) |
| **进化方式** | AI自主固化为SKILL.md | 结构化Gene选择→验证→固化 |
| **记忆** | 4层分层记忆 | GEP + EvolutionEvent 审计 |
| **共享** | 无 | EvoMap网络（技能商店） |
| **形态** | ~3K行自包含 | Node.js模块 + GEP协议 |

---

## 核心概念：GEP 协议

### Genome Evolution Protocol

GEP 是一种**结构化的进化协议**，定义了进化的标准流程和产物格式。

```
[Signal] → [Selector] → [Gene] → [Strategy] → [Validation] → [Solidify] → [EvolutionEvent]
   ↑                                                          ↓
   └────────────────── [Audit Trail] ←────────────────────────┘
```

### Gene — 进化的原子单元

```json
{
  "type": "Gene",
  "id": "gene_gep_repair_from_errors",
  "category": "repair",
  "signals_match": ["error", "exception", "failed", "unstable"],
  "preconditions": ["signals contains error-related indicators"],
  "strategy": [
    "Extract structured signals from logs and user instructions",
    "Select an existing Gene by signals match (no improvisation)",
    "Estimate blast radius (files, lines) before editing",
    "Apply smallest reversible patch",
    "Validate using declared validation steps; rollback on failure",
    "Solidify knowledge: append EvolutionEvent, update Gene/Capsule store"
  ],
  "constraints": {
    "max_files": 20,
    "forbidden_paths": [".git", "node_modules"]
  },
  "validation": [
    "node scripts/validate-modules.js ...",
    "node scripts/validate-suite.js"
  ]
}
```

**3种内置Gene**：

| Gene ID | Category | Trigger Signals |
|---------|----------|----------------|
| `gene_gep_repair_from_errors` | repair | error, exception, failed, unstable |
| `gene_gep_optimize_prompt_and_assets` | optimize | protocol, gep, prompt, audit, reusable |
| `gene_gep_innovate_from_opportunity` | innovate | user_feature_request, perf_bottleneck, capability_gap |

### Capsule — 可复用的Gene序列

```json
{
  "type": "Capsule",
  "id": "capsule_xxx",
  "genes": ["gene_gep_repair_from_errors", "gene_gep_optimize_prompt_and_assets"],
  "description": "修复后优化的完整流程"
}
```

### EvolutionEvent — 审计轨迹

```json
{
  "type": "EvolutionEvent",
  "event_id": "evt_xxx",
  "gene_id": "gene_gep_repair_from_errors",
  "timestamp": "2026-04-19T...",
  "intent": "repair",
  "strategy_used": "...",
  "result": "success|failed|rolled_back",
  "validation_output": "...",
  "capsule_id": "capsule_xxx"
}
```

---

## 核心架构

```
Evolver/
├── index.js                # ⭐ 主入口 (40KB CLI + daemon loop)
├── SKILL.md                # Evolver自身也是Skill!
│
├── src/
│   ├── evolve.js           # 核心进化引擎
│   │
│   ├── gep/
│   │   ├── selector.js     # 根据Signal选择最匹配的Gene
│   │   ├── prompt.js       # 构建GEP协议提示词
│   │   ├── solidify.js     # 验证+固化EvolutionEvent
│   │   ├── a2aProtocol.js  # A2A协议
│   │   ├── a2a.js          # A2A网络通信
│   │   ├── policyCheck.js  # 安全策略检查
│   │   ├── mutation.js     # 突变协议
│   │   ├── personality.js  # 人格进化
│   │   ├── memoryGraph.js  # 记忆图谱
│   │   ├── skillDistiller.js  # Skill蒸馏
│   │   ├── explore.js      # 探索模块
│   │   ├── idleScheduler.js # OMLS空闲调度
│   │   └── paths.js        # 路径工具
│   │
│   ├── ops/                # 运维工具 (可移植!)
│   │   ├── lifecycle.js    # start/stop/status/check
│   │   ├── cleanup.js      # 磁盘清理
│   │   ├── commentary.js  # 注解生成
│   │   ├── diskmon.js     # 磁盘监控
│   │   ├── git.js         # Git自修复
│   │   ├── skillHealth.js # 技能健康检查
│   │   └── sysmon.js      # 系统监控
│   │
│   ├── adapters/          # 平台适配器
│   │   ├── cursor.js
│   │   ├── claude-code.js
│   │   └── openclaw.js    # OpenClaw集成!
│   │
│   ├── atp/               # Auto-Target Protocol (merchant agent)
│   ├── proxy/             # 邮件/代理传输
│   ├── canary.js          # 完整性校验
│   └── config.js          # 配置管理
│
└── assets/gep/
    ├── genes.json         # Gene库
    ├── capsules.json      # Capsule库
    └── events.jsonl       # EvolutionEvent审计日志
```

### Evolve 流程

```
1. Scan memory/  →  提取 signals (error/feature_request/opportunity)
2. Selector     →  根据 signals 选择最匹配的 Gene
3. Build Prompt →  组装 GEP 协议提示词
4. LLM 执行     →  输出结构化的进化指令
5. Validation  →  执行 Gene.validation 中的命令验证
6. Solidify    →  记录 EvolutionEvent，更新 Gene/Capsule store
7. Report      →  通过 sessions_spawn() 向宿主报告
```

### index.js Daemon Loop 特性

```javascript
// 单例锁 — 防止多个daemon实例
acquireLock() → evolver.pid

// 自适应休眠
dt < idleThresholdMs → currentSleepMs *= 2 (后退)
正常完成         → currentSleepMs = minSleepMs (重置)

// OMLS空闲调度
idleScheduler.getScheduleRecommendation()
  → should_distill: 空闲时失败蒸馏
  → should_explore: 空闲时主动探索
  → sleep_multiplier: 空闲时休眠加倍

// 自杀/自我重启
memory > EVOLVER_MAX_RSS_MB  → spawn新进程 → exit(0)
cycleCount > MAX_CYCLES     → 同上

// Pending Solidify Gate
上一轮未完成solidify → 跳过本轮 (等待120s)

// Bridge禁用时自动拒绝
EVOLVE_BRIDGE=false → rejectPendingRun() (无git回滚)
```

---

## 进化策略

| 策略 | 创新 | 优化 | 修复 | 适用场景 |
|------|------|------|------|---------|
| `balanced` | 50% | 30% | 20% | 日常运行 |
| `innovate` | 80% | 15% | 5% | 系统稳定，快速出新功能 |
| `harden` | 20% | 40% | 40% | 大改动后稳固 |
| `repair-only` | 0% | 20% | 80% | 紧急修复 |

---

## 安全模型

### Validation 命令白名单

Gene 的 `validation` 数组中的命令必须通过 `isValidationCommandAllowed()`：

```
✅ node scripts/validate-modules.js ...
✅ npm run test
✅ npx mocha

❌ rm -rf
❌ curl | bash
❌ $(whoami)
❌ any command with backticks or $()
```

### 命令执行约束

- 前缀白名单：`node` / `npm` / `npx` 开头
- 禁止 shell 操作符：`;` `&` `|` `>` `<` after quote stripping
- 超时限制：每条命令 180 秒
- 工作目录：仓库根目录

### sessions_spawn 协议

```
sessions_spawn(sessionId, task)  ← stdout 纯文本
```

Evolver 输出到 stdout，宿主运行时（如 OpenClaw）捕获并执行。**Evolver 本身不执行任何系统命令**。

---

## OpenClaw 集成

README 明确提到 OpenClaw：

```
OpenClaw 会识别 Evolver 向 stdout 输出的 sessions_spawn(...) 协议，
无需安装 hooks。将 Evolver 克隆到 OpenClaw workspace 中，在会话内运行即可。
```

**OpenClaw adapter** (`src/adapters/openclaw.js`) 负责 stdout 协议解析。

---

## 与现有系统的关系

### vs GenericAgent

| 维度 | GenericAgent | Evolver |
|------|------------|---------|
| 规模 | ~3K 行核心 | 40KB index.js + 模块化 |
| 进化 | AI自举Skill | 结构化Gene选择 |
| 审计 | 无 | EvolutionEvent |
| 共享 | 无 | EvoMap网络 |
| 安全 | 无 | Validation白名单 |
| Daemon | 无 | 单例锁+自适应休眠+自杀重启 |

### vs OpenClaw 现有系统

| 组件 | OpenClaw | Evolver |
|------|----------|---------|
| 技能 | SKILL.md | Gene + Capsule |
| 记忆 | Palace (Wing/Room/Hall) | GEP + memoryGraph |
| 进化 | auto_skill_creator | Selector + Gene |
| 审计 | WAL | EvolutionEvent |
| 共享 | 无 | Skill Store |

---

## 核心创新点

### 1. OMLS Idle Scheduling — 空闲时激进操作
idleScheduler.getScheduleRecommendation() 检测系统空闲窗口，在idle时：
- `should_distill`: 失败蒸馏（autoDistillFromFailures()）
- `should_explore`: 主动探索新信号
- `sleep_multiplier`: 空闲时休眠时间加倍

这是 Evolver 的"反直觉"设计：**越闲越干活**，而不是传统的"越闲越休息"。

### 2. Gene Validation — 可信执行
- 每个Gene声明自己的验证命令
- Validation 命令白名单保护
- 失败自动回滚

### 3. EvolutionEvent — 完整审计
- 每个进化记录包含：intent/category/strategy/result/validation
- 可追溯、可审计、可复现

### 4. Constraint 约束系统
- `max_files`: 最大修改文件数
- `forbidden_paths`: 禁止修改的路径
- 防止进化过程破坏系统完整性

### 5. Signal 去重
- 自动检测重复修复（repair loop）
- 防止反复修同一个问题

### 6. A2A 网络
- 可选的分布式Worker池
- 技能商店：下载/发布可复用Gene/Capsule
- 进化排行榜

---

### 7. Daemon 自我修复
- 单例锁（evolver.pid）：防止多个实例
- 自适应休眠（dt < idleThreshold → 2x后退）
- 自杀重启（内存超限/循环超次 → spawn新进程 → exit）

### 8. Evolver 是 Skill
`SKILL.md` at root。Evolver 本身是一个 Node.js Skill，可被其他 Agent 系统调用。

---

## 技术栈

```
Node.js >= 18
├── @evomap/evolver (npm package)
├── A2A Hub (evomap.ai)
└── Git (required for solidification/rollback)
```

---

## 值得借鉴的思想

1. **Gene Validation 声明式验证** — 每个Skill声明自己的验证命令，进化时自动执行验证
2. **EvolutionEvent 审计** — 所有进化动作都有完整记录，可追溯
3. **Constraint 约束系统** — 防止进化过程破坏关键区域
4. **策略切换** — `balanced/innovate/harden/repair-only` 根据系统状态自适应
5. **Signal 去重** — 防止修复循环
6. **A2A 技能网络** — 共享进化资产
7. **OMLS Idle Scheduling** — 检测空闲窗口，在idle时执行激进操作（失败蒸馏+主动探索）
8. **Daemon 自我修复** — 单例锁防止重复，自适应休眠，内存超限自动重启
9. **Ops 可移植工具** — cleanup/diskmon/git/skillHealth/sysmon 零平台依赖
10. **Evolver本身是Skill** — `SKILL.md` at root，让Evolver也可被其他系统调用

---

## 对 OpenClaw 的启发

| 启发 | 当前状态 | 落地 |
|------|---------|------|
| **OMLS Idle** | heartbeat机制已存在 | ✅ `modules/idleScheduler.mjs` + `memory_cron.mjs`集成 |
| **EvolutionEvent 审计** | WAL仅日志 | ✅ `evolution_events.jsonl` 审计日志 |
| **Constraint 约束** | 无 | ✅ `validate_constraint()` 禁止危险技能名 |
| **Signal 去重** | 无 | ✅ Constraint + 重复触发检测 |
| **Daemon自我修复** | cron定时调度 | ⚙️ 单例锁可附加到cron守护进程 |
| **Gene Validation** | auto_skill_creator 无验证 | ⚙️ SKILL.md可声明validation字段 |
| **策略切换** | 固定 | ⚙️ 根据idle intensity调整行为 |
| **Skill Store** | 无 | ❌ 暂不适用（需要网络） |
| **Ops可移植** | 无 | ⚙️ cleanup/diskmon可单独实现 |

---

## 分析结论

**Evolver vs GenericAgent**：
- GenericAgent 是"极简自举"，用最少的代码实现自我进化
- Evolver 是"结构化进化协议"，用完整的Gene/Capsule体系实现可审计、可共享的进化

**核心洞察**：
- Evolver 731KB 的 `evolve.js` 说明"进化"本身是一个复杂的需求
- GenericAgent 的简单 Skill 自举适合个人使用
- Evolver 的 GEP 协议适合团队协作和长期维护
- OpenClaw 可以借鉴 Gene Validation 思想，让每个 Skill 声明验证方式

**落地优先级**：
1. **EvolutionEvent 审计** — 最低成本，最高价值
2. **Signal 去重** — 防止 auto_skill_creator 重复触发
3. **OMLS Idle Scheduling** — 在heartbeat空闲时执行主动探索 ⭐
4. **Constraint 约束** — 进化时保护关键目录
5. **Validation 声明** — 让 Skill 创建时自带验证命令
6. **Daemon自我修复** — 单例锁防止重复实例
