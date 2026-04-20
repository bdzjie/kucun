---
name: Gateway RPC Reference
description: Complete reference for OpenClaw Gateway RPC methods
triggers:
  - gateway rpc
  - openclaw gateway call
  - gateway methods
  - rpc api
---

# Gateway RPC Reference

## Quick Reference

```bash
# List all methods
openclaw gateway call methods.map --token <token>

# Health check
openclaw gateway call health --token <token>

# List sessions
openclaw gateway call sessions.list --token <token>

# List cron jobs
openclaw gateway call cron.list --token <token>

# Search skills
openclaw gateway call skills.search --token <token> --params '{"query":"debug"}'

# Get tool catalog
openclaw gateway call tools.catalog --token <token>
```

## Common Workflows

### Manage Cron Jobs
```bash
# List
openclaw gateway call cron.list --token <token>

# Run immediately
openclaw gateway call cron.run --token <token> --params '{"jobId":"<id>"}'

# Add new job
openclaw gateway call cron.add --token <token> --params '{
  "name":"my job",
  "schedule":{"kind":"every","everyMs":3600000},
  "payload":{"kind":"systemEvent","text":"do something"}
}'
```

### Session Management
```bash
# List sessions
openclaw gateway call sessions.list --token <token>

# Get session details
openclaw gateway call sessions.get --token <token> --params '{"sessionId":"<id>"}'

# Compact session
openclaw gateway call sessions.compact --token <token> --params '{"sessionId":"<id>"}'
```

## Full Documentation

See: `C:\Users\AppData\Roaming\npm\node_modules\openclaw\docs\reference\gateway-rpc.md`

Or run:
```bash
openclaw gateway call --help
```
