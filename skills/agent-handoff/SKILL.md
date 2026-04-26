---
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
#   2. Handoff handler filters/transforms context
#   3. Agent B receives updated context
#   4. Agent B continues with refined task
#
# Features:
#   - Named agent configurations
#   - Input filtering (whitelist context keys)
#   - Context injection during handoff
#   - Handoff history tracking
#
# Files:
#   ~/.openclaw/memory/handoff_config.json
#   ~/.openclaw/memory/handoff_history.jsonl
