# Agent Teams

**Command**: `/agent-teams`
**Category**: multi-agent
**Emoji**: 👥
**Description**: Multi-Agent Role System inspired by MetaGPT (Software Company) and CrewAI. Manage teams of specialized agents with role-based handoffs.

## Commands

### `/agent-teams --create <team-name> [--role <role>]`
Create a new agent team.

### `/agent-teams --add <role> [--name <name>]`
Add an agent to the current team.

### `/agent-teams --assign <task>`
Assign a task to the current agent.

### `/agent-teams --handoff <to-role> [--message <message>]`
Hand off to another agent.

### `/agent-teams --status`
Show team status.

### `/agent-teams --list-roles`
List available roles.

### `/agent-teams -- pipelines`
Show predefined skill pipelines.

### `/agent-teams --run <pipeline> [--input <input>]`
Run a skill pipeline.

## Available Roles

| Role | Name | Goal |
|------|------|------|
| pm | Product Manager | Define requirements, prioritize features |
| architect | Software Architect | Design scalable architectures |
| engineer | Software Engineer | Implement code |
| reviewer | Code Reviewer | Ensure quality |
| researcher | Research Analyst | Gather information |
| planner | Strategic Planner | Break down tasks |
| executor | Task Executor | Execute and deliver |

## Pipeline Templates

| Pipeline | Description |
|----------|-------------|
| research_and_write | Search → Process → Write |
| code_review | Analyze → Review → Report |
| daily_scrum | Parallel: yesterday + today + blockers |

## Usage Examples

```
/agent-teams --create my-team
/agent-teams --add architect
/agent-teams --assign "Design a REST API"
/agent-teams --handoff engineer
/agent-teams --status
/agent-teams --run research_and_write --input "OpenClaw architecture"
```

## Technical Details

**Modules**:
- `modules/agent_roles.mjs` — Role definitions, AgentRoster, handoff system
- `modules/skill_pipeline.mjs` — Pipeline builder, templates, execution

**MetaGPT 启发**: PM → Architect → Engineer → Reviewer 流水线
**CrewAI 启发**: 角色扮演 + 协作智能
