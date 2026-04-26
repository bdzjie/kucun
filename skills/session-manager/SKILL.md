---
name: session-manager
description: >
  Manage HandoffAwareSession sessions.
  Track agent handoffs, view history, snapshot/restore sessions.
triggers:
  - "/session-manager --list"
  - "/session-manager --show [session-id]"
  - "/session-manager --history [session-id]"
  - "/session-manager --snapshot [session-id]"
  - "/session-manager --restore [session-id] [snapshot-id]"

---

# ============================================================
# Session Manager
# ============================================================
#
# Manages HandoffAwareSession sessions with handoff tracking.
# Inspired by OpenAI Agents SDK Session protocol.
#
# Features:
#   - Session storage at ~/.openclaw/memory/sessions/
#   - Handoff history tracking
#   - Session snapshots
#   - Automatic persistence
#
# Commands:
#   --list       List all sessions
#   --show       Show session summary
#   --history    Show handoff history
#   --snapshot   Take a snapshot
#   --restore    Restore from snapshot
