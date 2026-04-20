---
name: studio
description: OpenClaw system dashboard and control center. Query gateway health, cost, sessions, cron jobs, skills, and tasks via RPC API. Use for system overview, debugging, or control.
triggers:
  - /studio
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
| all | - | Full system report |

## Examples

```
User: /studio
→ Gateway: ok | Sessions: 1 | Tasks: 3 active | Cost today: $22.72

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
