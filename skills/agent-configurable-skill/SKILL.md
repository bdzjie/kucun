name: agent-configurable-skill
description: >
  Design pattern for skills that can be used as tools by other agents.
  Inspired by OpenAI Agents SDK Agent-as-Tool pattern.
  When a skill defines agents/openai.yaml, it becomes callable as a tool
  by the main agent, with its own instructions, tools, and behavior.
triggers:
  - "use {skill-name} as a tool"
  - "delegate to {skill-name} agent"
  - "call {skill-name} skill"

# OpenAI Agents SDK Pattern:
# Each skill can have an agents/ directory with openai.yaml:
#   agents/
#     openai.yaml    # Agent configuration
#     *.md           # Additional agent instructions
#
# The main agent can call this skill as a tool, passing context
# and receiving structured results.

# ============================================================
# Agent Configuration Format (agents/openai.yaml)
# ============================================================
# name: skill-name
# description: What this agent skill does
# model: gpt-4o
# instructions: |
#   You are a {role} agent...
# tools:
#   - type: function
#     name: skill-specific-tool
#     description: ...
# handoffs:
#   - another-skill
# output_type: AgentResult

# ============================================================
# Integration with OpenClaw
# ============================================================
# When a skill has agents/openai.yaml:
# 1. The skill becomes callable via RunAgentAsTool
# 2. The sub-agent runs with its own instructions
# 3. Results are returned as structured output
# 4. The main agent continues with the result

# ============================================================
# Example: A code review skill as agent
# ============================================================
# skills/code-review-agent/
# ├── SKILL.md           # This file
# ├── agents/
# │   └── openai.yaml    # Agent config
# ├── tools/
# │   └── review_tool.py # Skill-specific tools
# └── references/
#     └── review-checklist.md

# ============================================================
# Implementation Notes
# ============================================================
# This skill demonstrates the pattern. Actual agent execution
# requires the openclaw agent runner to support agent-as-tool.
#
# The pattern enables:
# - Nested agent calls (agent calling agent)
# - Specialized sub-agents for specific tasks
# - Tool-like behavior with full agent capabilities
# - Handoff between specialized agents
