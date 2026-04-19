name: lifecycle-tracing
description: >
  Comprehensive lifecycle tracing for OpenClaw agent runs.
  Inspired by OpenAI Agents SDK tracing system.
  Provides span hierarchy, event tracking, and batch export.
triggers:
  - "/lifecycle-tracing --status"
  - "/lifecycle-tracing --spans [trace-id]"
  - "/lifecycle-tracing --enable"
  - "/lifecycle-tracing --disable"

# ============================================================
# Tracing System
# ============================================================
# 
# Span Hierarchy:
#   Trace
#   └── Turn
#       └── Agent
#           ├── LLM
#           │   └── [model call]
#           ├── Tool
#           │   └── [tool execution]
#           └── Handoff
#               └── [agent transfer]
#
# Span Types:
#   - trace: Top-level run container
#   - turn: One agent turn
#   - agent: Agent invocation
#   - llm: LLM call
#   - tool: Tool execution
#   - handoff: Agent-to-agent transfer
#   - guardrail: Guardrail check
#   - function: Generic function span
#   - custom: User-defined span

# ============================================================
# Usage
# ============================================================
# 
# The tracing system is automatic when enabled.
# View spans:
#   /lifecycle-tracing --status
#   /lifecycle-tracing --spans [trace-id]
#
# Enable/disable:
#   /lifecycle-tracing --enable
#   /lifecycle-tracing --disable

# ============================================================
# Output
# ============================================================
# 
# Spans are written to:
#   ~/.openclaw/memory/traces.jsonl
#
# Format (JSONL):
# {"name":"llm-call","spanId":"span_abc123",...}
# {"name":"tool-exec","spanId":"span_def456",...}
#
# Use --spans to pretty-print a trace

# ============================================================
# Integration
# ============================================================
# 
# modules/span_tracing.mjs provides:
#   - trace(name, options, fn): Create and run within a trace
#   - span(name, options, fn): Create child span
#   - getCurrentSpan(): Get current span from TLS
#   - getTracer(): Get global tracer
#
# modules/run_hooks_lifecycle.mjs provides:
#   - LifecycleRunner: Run with hooks
#   - createLoggingHooks(): Log all events
#   - createAnalyticsHooks(): Track metrics
