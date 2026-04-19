name: lifecycle-trace-hook
description: >
  Integrates span tracing into OpenClaw hooks.
  Traces agent lifecycle events to ~/.openclaw/memory/traces.jsonl
  Inspired by OpenAI Agents SDK tracing system.
version: 1.0.0
entry_point: handler.js

# ============================================================
# Lifecycle Trace Hook
# ============================================================
#
# This hook integrates span_tracing.mjs into OpenClaw's
# hook lifecycle. It traces:
#   - onMessage (turn start/end)
#   - onToolResult (tool execution)
#   - onHookContext (hook calls)
#
# Traces are written to:
#   ~/.openclaw/memory/traces.jsonl
#
# Enable/disable via:
#   /lifecycle-tracing --enable
#   /lifecycle-tracing --disable

metadata:
  openclaw:
    events:
      - onMessage
      - onToolResult
