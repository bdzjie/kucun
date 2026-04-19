name: session-compactor
description: >
  Compact session memory to save tokens and improve performance.
  Inspired by OpenAI Agents SDK OpenAIResponsesCompactionAwareSession protocol.
  Run manually or automatically when token threshold is exceeded.
triggers:
  - "/session-compactor [session-id] [--mode auto|aggressive|conservative|summary]"

# ============================================================
# Session Compaction Protocol
# ============================================================
# Sessions accumulate messages over time. When they grow large,
# compaction reduces token count while preserving essential context.
#
# Modes:
# - auto:      Let the system decide based on token threshold
# - aggressive: Keep only system + last 5 messages
# - conservative: Keep first 10, compress middle, keep last 10
# - summary:    Replace groups of 10 messages with summaries

# ============================================================
# Token Thresholds
# ============================================================
# Default: 50,000 tokens
# Warning at 40,000 tokens
# Auto-compact at 50,000 tokens
#
# Configure in:
# ~/.openclaw/memory/compactor_config.json

# ============================================================
# Usage
# ============================================================
# /session-compactor                    # Compact default session (auto mode)
# /session-compactor my-session         # Compact specific session
# /session-compactor --mode aggressive  # Force aggressive compaction
# /session-compactor --dry-run          # Preview what would be compacted

# ============================================================
# Session Files
# ============================================================
# Sessions stored at:
# ~/.openclaw/memory/sessions/{session-id}.jsonl
#
# Format (JSONL - one message per line):
# {"id":"msg_1","role":"user","content":"...","timestamp":1234567890}
# {"id":"msg_2","role":"assistant","content":"...","timestamp":1234567891}

# ============================================================
# Example
# ============================================================
# $ openclaw session-compactor my-project --mode conservative
#
# === Session Compaction ===
# Session: my-project
# Mode: conservative
# Before: 150 messages, ~48000 tokens
# After: 45 messages, ~12000 tokens
# Saved: ~36000 tokens (75%)
