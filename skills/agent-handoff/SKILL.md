name: agent-handoff
description: >
  Agent-to-agent handoff system inspired by OpenAI Agents SDK.
  Transfer control between specialized agents with input filtering.
triggers:
  - "/agent-handoff --list"
  - "/agent-handoff --status [name]"
  - "/agent-handoff --register [config]"

# ============================================================
# Agent Handoff System
# ============================================================
#
# Purpose: Transfer control from one agent to another
# while preserving context and optionally filtering input.
#
# Handoff Flow:
#   1. Agent A completes its specialized task
#   2. Handoff is triggered to Agent B
#   3. Optional: HandoffInputFilter transforms input
#   4. Optional: History nesting preserves context
#   5. Agent B receives transformed input
#
# Example Config:
#   {
#     "toAgent": "researcher",
#     "description": "Transfer to research specialist",
#     "inputFilter": "summarize",
#     "nestHistory": true
#   }

# ============================================================
# Handoff Configuration
# ============================================================
#
# Registered handoffs stored at:
#   ~/.openclaw/memory/handoffs.json
#
# Each handoff:
#   - agentName: Target agent name
#   - description: Human-readable description
#   - inputFilter: "none" | "summarize" | "context_add"
#   - nestHistory: true | false
#   - tools: Tools to pass to target agent

# ============================================================
# Usage
# ============================================================
#
# List registered handoffs:
#   /agent-handoff --list
#
# Check handoff status:
#   /agent-handoff --status researcher
#
# Register a new handoff:
#   /agent-handoff --register {"toAgent":"researcher","description":"...","nestHistory":true}
