# Ontology Agent Integration

## Overview

Integrate the knowledge graph (`memory/ontology/graph.jsonl`) into the agent's reasoning loop so that project context, task state, and entity relationships inform every response.

## Integration Points

### 1. Pre-Turn Hook — Inject Relevant Context

When a user message arrives, the agent should query the ontology for:
- **Active projects** related to the message
- **Pending tasks** for the current user
- **Recent decisions** that might be relevant

### 2. After Tool Execution — Update Graph

After completing a task, the agent should:
- Update task status (open → done)
- Record the decision made
- Log key outcomes as events

### 3. On Session Start — Wake-up Context

On bootstrap, the ontology provides structured context:
- Current project status
- Blocked tasks (what's waiting)
- Next actions

## Usage

```bash
# Query the graph
python modules/ontology_query.py "what projects are active"

# Update a task
python modules/ontology_update.py task_done <task_id>

# Add a finding
python modules/ontology_update.py add_finding "<text>"
```

## API

```javascript
// From any handler or hook
import { queryOntology } from './modules/ontology.mjs'

// Find active projects
const projects = await queryOntology({ type: 'Project', status: 'active' })

// Find pending tasks
const tasks = await queryOntology({ type: 'Task', status: 'in_progress' })

// Get task blockers
const blockers = await queryOntology({ type: 'Task', blocks: 'task_apply-skills' })
```

## Graph Schema

```
Person ←has_owner— Project ←part_of— Task ←blocks— Task
                ↓
              Event
```

## Trigger

Ontology is consulted when:
- User asks "what am I working on"
- User asks "status" or "progress"
- A task is completed or blocked
- A new project is mentioned
