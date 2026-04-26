---
name: tools-to-final-output
description: >
  ToolsToFinalOutput pattern - mark tool results as final agent output.
  Inspired by OpenAI Agents SDK ToolsToFinalOutputResult.
triggers:
  - "/tools-to-final-output --register [tool-name]"
  - "/tools-to-final-output --list"
  - "/tools-to-final-output --unregister [tool-name]"
  - "/tools-to-final-output --test [tool-name] [input]"

---

# ============================================================
# ToolsToFinalOutput Pattern
# ============================================================
#
# In OpenAI Agents SDK, tools can return is_final_output=true
# to signal the agent loop should terminate.
#
# This skill provides a similar pattern for OpenClaw skills:
#   - Register a skill as "always final"
#   - When that skill's tool is called, output is marked final
#   - Agent loop terminates after that tool
#
# Use cases:
#   - Calculator tools (definitive answer)
#   - Lookup tools (no more reasoning needed)
#   - Summary tools (final answer provided)
#   - Any tool that definitively answers the user's question
#
# Files:
#   ~/.openclaw/memory/final_output_tools.json

# ============================================================
# Usage
# ============================================================
#
# Register a tool as final output:
#   /tools-to-final-output --register my-calculator
#
# List registered tools:
#   /tools-to-final-output --list
#
# Unregister:
#   /tools-to-final-output --unregister my-calculator
#
# Test (simulate tool result):
#   /tools-to-final-output --test my-calculator "2+2"

# ============================================================
# How it works
# ============================================================
#
# When a tool is registered:
#   1. Skill name is added to final_output_tools.json
#   2. When skill handler returns, it includes is_final_output=true
#   3. The skill system checks this flag after tool execution
#   4. If true, agent loop terminates
#
# Skill handlers should return:
#   {
#     output: "the answer",
#     is_final_output: true  // <-- this signals termination
#   }
