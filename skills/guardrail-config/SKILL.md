name: guardrail-config
description: >
  Manage tool guardrail configurations.
  View, enable/disable guardrails from OpenAI Agents SDK-inspired system.
triggers:
  - "/guardrail-config --list"
  - "/guardrail-config --status [name]"
  - "/guardrail-config --enable [name]"
  - "/guardrail-config --disable [name]"
  - "/guardrail-config --add [config]"

# ============================================================
# Tool Guardrail Configuration
# ============================================================
#
# Tool guardrails provide pre/post tool execution validation.
# Inspired by OpenAI Agents SDK tool_guardrails.py.
#
# Built-in Guardrails:
#   path_traversal_check    - Prevents .. path traversal
#   bash_dangerous_check    - Prevents dangerous bash commands
#   output_size_check       - Limits tool output size
#   sql_injection_check     - Detects SQL injection patterns
#
# Behaviors:
#   allow          - Continue normally (default)
#   reject_content - Continue but replace output with message
#   raise_exception - Halt execution
#
# Files:
#   ~/.openclaw/memory/tool_guardrails_v2.json

# ============================================================
# Usage
# ============================================================
#
# List all guardrails:
#   /guardrail-config --list
#
# Check specific guardrail:
#   /guardrail-config --status path_traversal_check
#
# Enable/disable:
#   /guardrail-config --enable sql_injection_check
#   /guardrail-config --disable output_size_check
#
# Add custom guardrail (JSON config):
#   /guardrail-config --add {"name":"my_check","type":"input","description":"..."}
