name: tool-guardrail-hook
description: >
  Pre-tool and post-tool validation hooks inspired by OpenAI Agents SDK Guardrail pattern.
  Provides security checks before tool execution: path traversal detection,
  dangerous command blocking, and execution auditing.
triggers:
  - onMessagePreprocessed  # Runs before any tool execution
  - onToolResult           # Runs after tool execution

# ============================================================
# How It Works
# ============================================================
# This hook integrates tool_guardrail_hook.mjs into OpenClaw's
# message processing pipeline:
#
# 1. onMessagePreprocessed: Runs pre-tool guardrails
#    - Validates all tool inputs before execution
#    - Blocks dangerous operations (path traversal, rm -rf, etc.)
#    - Logs execution for audit
#
# 2. onToolResult: Runs post-tool guardrails
#    - Validates tool outputs
#    - Can flag suspicious results
#
# Guardrails run in priority order (lower = first)
# If any guardrail blocks, the tool is not executed

# ============================================================
# Configuration
# ============================================================
# Guardrails are defined in:
#   ~/.openclaw/memory/tool_guardrails.json
#
# Format:
# {
#   "custom_guardrails": [
#     {
#       "name": "my_check",
#       "description": "My custom check",
#       "tool_pattern": "Bash|Edit",  // glob pattern
#       "validate_input": "async (input, toolName) => ({allowed: true})",
#       "enabled": true,
#       "priority": 20
#     }
#   ]
# }

# ============================================================
# Built-in Guardrails
# ============================================================
# 1. path_traversal_check (priority: 10)
#    - Blocks Write/Edit/Read/Glob/Grep with ".." paths
#    - Blocks ~\\ and ~/ path prefixes
#
# 2. bash_dangerous_command_check (priority: 5)
#    - Blocks: rm -rf /, format c:, fdisk, dd if=, etc.
#    - Special handling for rm -rf without --no-preserve-root
#
# 3. execution_audit_logger (priority: 100)
#    - Logs all tool executions to tool_audit.jsonl
#    - Both pre and post execution

# ============================================================
# Usage
# ============================================================
# The hook is automatic once installed. No manual invocation needed.
# To see audit logs:
#   tail -f ~/.openclaw/memory/tool_audit.jsonl
#
# To add custom guardrails, edit tool_guardrails.json directly
# or use the register_guardrail() function from tool_guardrail_hook.mjs

# ============================================================
# Example: Custom Guardrail
# ============================================================
# To add a custom guardrail for blocking specific paths:
#
# 1. Edit ~/.openclaw/memory/tool_guardrails.json
# 2. Add to custom_guardrails array:
#    {
#      "name": "block_workspace_edit",
#      "description": "Block Edit operations on critical files",
#      "tool_pattern": "Edit",
#      "validate_input": "async (input) => { if (input?.path?.includes('openclaw.json')) return {allowed: false, reason: 'Protected file'}; return {allowed: true}; }",
#      "enabled": true,
#      "priority": 1
#    }
