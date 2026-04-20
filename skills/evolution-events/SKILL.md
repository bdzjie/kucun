---
metadata:
  openclaw:
    version: 1.0
    type: skill
    name: evolution-events
    description: View EvolutionEvent audit trail (Evolver-inspired audit log)
    triggers:
      - evolution events
      - audit log
      - evolution history
      - skill creation history
      - skill audit
---

triggers:
  - evolution events
  - track agent evolution

# Evolution Events — Audit Trail

View the EvolutionEvent audit trail (Evolver-inspired). Records every skill creation attempt, success or blocked.

## Usage

```
/evolution-events [limit=10]
```

## Examples

```
/evolution-events
/evolution-events 20
```

## Output

Returns the most recent EvolutionEvents, showing:
- `event_id`, `timestamp`
- `intent` (pattern type that triggered)
- `skill_name`, `result` (success/constraint_blocked)
- `strategy` (confidence level)
- `validation_output`

## Source

Data from: `~/.openclaw/memory/evolution_events.jsonl`
