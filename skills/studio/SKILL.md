---
name: studio
description: OpenClaw system dashboard and control center. Query gateway health, cost, sessions, cron jobs, skills, tasks, and routing stats via RPC API. Use for system overview, debugging, or control.
triggers:
  - /studio
  - /studio routing
  - /studio all
  - system dashboard
  - gateway status
  - openclaw status
  - system health
command-dispatch: tool
---

# Studio — OpenClaw System Dashboard

## Usage

```
/studio
/studio health
/studio cost
/studio sessions
/studio cron
/studio skills
/studio tasks
/studio routing
/studio all
```

## Commands

| Command | RPC Method | Description |
|---------|-----------|-------------|
| health | `health` | Gateway health + channel status |
| cost | `usage.cost` | Daily cost breakdown |
| sessions | `sessions.list` | Active sessions |
| cron | `cron.list` | Scheduled jobs |
| skills | `skills.status` | Skill eligibility |
| tasks | `tasks.list` | Background tasks |
| routing | — | Expert Router 状态 + 推理深度 + 分布统计 |
| all | — | Full system report |

## Routing Panel (`/studio routing`)

显示 Expert Router 当前状态，包括：

- **推理深度指示器**: ⚡ fast | 🔍 normal | 🧠 deep
- **Expert 分布**: 各 Expert 累计使用次数
- **深度分布**: fast/normal/deep 模式使用比例
- **Top Expert**: 累计使用最高的 Expert
- **反馈统计**: routing_feedback.jsonl 中的质量数据

### 深度指示器说明

| 深度 | 压缩阈值 | 最大 Tool Calls | 适用场景 |
|------|---------|----------------|----------|
| ⚡ fast | 90% | 1 | 简单问答、配置 |
| 🔍 normal | 50% | 3 | 标准任务 |
| 🧠 deep | 60% | 8 | 深度分析、代码生成 |

### 置信度阈值

路由置信度 ≤ 0.8 时，自动降级到 `normal` 模式。

## Examples

```
User: /studio
→ Gateway: ok | Sessions: 1 | Tasks: 3 active | Cost today: $22.72

User: /studio routing
→ 🧠 deep | analysis_expert | 0.91
→ Expert: code_expert (42%) | analysis (28%) | system (18%)
→ Depth: deep (35%) | normal (55%) | fast (10%)
→ Top Expert: code_expert (127 calls)
→ Feedback entries: 312

User: /studio cost
→ Daily costs for last 4 days
→ 04-20: $22.72 (107M tokens)
→ 04-19: $216.37 (968M tokens) ⚠️ HIGH
→ 04-18: $52.54 (209M tokens)
→ 04-17: $27.93 (107M tokens)
```

## Cost Warning

Daily cost > $50 triggers ⚠️ indicator.
Daily cost > $200 triggers 🚨 alert.

## Integration Points

- `getRoutingBadge()` — AIAgent 方法，返回格式化的推理深度 Badge
- `getRoutingInfo()` — AIAgent 方法，返回完整路由信息
- `getSkillPriority()` — AIAgent 方法，返回当前任务的技能优先级列表
- `RoutingService.formatRoutingBadge()` — 格式化 Badge: `⚡ fast | code_expert | 0.92`
