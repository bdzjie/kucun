"""
_session_snapshot.py — Session Persistence & Handoff Continuity

Minimal state needed to resume a session without loading full message history.
Based on Letta's BlockMemory pattern.

Minimal snapshot:
    - session_id, created_at, last_active_at
    - core_memory: labeled key-value blocks (most important facts)
    - skill_context: active skill state (not full handler, just context)
    - routing_preferences: learned routing decisions
    - compilation_tokens: last compaction baseline

Snapshot + recall_memory (from cone_graph) = full resume.

Usage:
    from skills._session_snapshot import SessionSnapshot, save_snapshot, load_snapshot

    snap = SessionSnapshot()
    snap.core_memory["current_project"] = "Claude Code analysis"
    snap.skill_context["invest"] = {"last_query": "AAPL", "mode": "quote"}
    save_snapshot("sess_abc123", snap)

    restored = load_snapshot("sess_abc123")
"""

import json, time
from pathlib import Path
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from typing import Optional

WORKSPACE = Path("C:/Users/Administrator/.openclaw/workspace")
SNAPSHOT_DIR = WORKSPACE / "memory" / "snapshots"


@dataclass
class SessionSnapshot:
    """
    Minimal state for session resume.
    Does NOT include message history — that's fetched from recall memory on demand.
    """

    session_id: str
    created_at: str = ""           # ISO-8601 UTC
    last_active_at: str = ""        # ISO-8601 UTC
    version: str = "2026-04-27"     # schema version for migrations

    # Core memory: most important facts (key = block label)
    # Analogous to Letta's core_memory blocks
    # Each entry: {"value": str, "provenance": "user_said|inferred|external_api|derived"}
    core_memory: dict[str, dict] = field(default_factory=dict)


    # Provenance tracker for core_memory blocks
    # Maps label -> provenance source
    provenance: dict[str, str] = field(default_factory=dict)

    # Active skill context (not full handler state, just last-known context)
    # skill_id -> {last_query, mode, active_params, last_result_summary}
    skill_context: dict[str, dict] = field(default_factory=dict)

    # Learned routing preferences: task_pattern -> expert_name
    routing_preferences: dict[str, str] = field(default_factory=dict)

    # Last compaction baseline (tokens remaining after compaction)
    compaction_tokens: int = 0

    # Tags for this session
    tags: list[str] = field(default_factory=list)

    # Optional: summary of what this session accomplished
    summary: str = ""

    def __post_init__(self):
        if not self.created_at:
            self.created_at = datetime.now(timezone.utc).isoformat()
        self.last_active_at = datetime.now(timezone.utc).isoformat()

    def set_core_memory(self, label: str, value: str, provenance: str = "inferred") -> None:
        """
        Set a core memory block with provenance tracking.

        provenance: user_said | inferred | external_api | derived
        """
        valid = {"user_said", "inferred", "external_api", "derived"}
        if provenance not in valid:
            provenance = "inferred"
        self.core_memory[label] = {"value": value, "provenance": provenance}
        self.provenance[label] = provenance

    def get_core_memory(self, label: str) -> Optional[str]:
        """Get core memory block value."""
        block = self.core_memory.get(label)
        return block["value"] if block else None

    def get_provenance(self, label: str) -> Optional[str]:
        """Get provenance for a block."""
        return self.provenance.get(label)

    def touch(self):
        """Update last_active_at timestamp."""
        self.last_active_at = datetime.now(timezone.utc).isoformat()

    def to_dict(self) -> dict:
        d = asdict(self)
        # Preserve provenance as flat dict for backward compat
        d["provenance"] = self.provenance
        return d

    @classmethod
    def from_dict(cls, d: dict) -> "SessionSnapshot":
        """Restore from dict, handling schema migrations."""
        version = d.get("version", "0.0.0")
        if version != cls.__annotations__.get("version", "2026-04-27"):
            # Future: run migration functions based on version
            pass
        # Handle core_memory that might be stored as dicts (new format) or strings (old format)
        core_mem = {}
        provenance = d.pop("provenance", {})
        for k, v in d.get("core_memory", {}).items():
            if isinstance(v, str):
                core_mem[k] = {"value": v, "provenance": provenance.get(k, "inferred")}
            else:
                core_mem[k] = v
        d["core_memory"] = core_mem
        # Handle provenance field
        if "provenance" not in d.get("__annotations__", {}):
            d["provenance"] = provenance
        return cls(**{k: v for k, v in d.items() if k in cls.__annotations__})


def get_snapshot_path(session_id: str) -> Path:
    return SNAPSHOT_DIR / f"{session_id}.json"


def save_snapshot(session_id: str, snap: SessionSnapshot) -> Path:
    """
    Persist snapshot to disk. Returns the path.
    """
    snap.touch()
    SNAPSHOT_DIR.mkdir(parents=True, exist_ok=True)
    path = get_snapshot_path(session_id)
    path.write_text(
        json.dumps(snap.to_dict(), indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    return path


def load_snapshot(session_id: str) -> Optional[SessionSnapshot]:
    """
    Load snapshot from disk. Returns None if not found.
    """
    path = get_snapshot_path(session_id)
    if not path.exists():
        return None
    try:
        d = json.loads(path.read_text(encoding="utf-8"))
        return SessionSnapshot.from_dict(d)
    except Exception:
        return None


def delete_snapshot(session_id: str) -> bool:
    """Delete a snapshot. Returns True if deleted."""
    path = get_snapshot_path(session_id)
    if path.exists():
        path.unlink()
        return True
    return False


def list_snapshots(limit: int = 50) -> list[SessionSnapshot]:
    """
    List all snapshots, most recent first.
    """
    if not SNAPSHOT_DIR.exists():
        return []
    snaps = []
    for p in sorted(SNAPSHOT_DIR.glob("*.json"), key=lambda x: -x.stat().st_mtime):
        try:
            d = json.loads(p.read_text(encoding="utf-8"))
            snaps.append(SessionSnapshot.from_dict(d))
        except Exception:
            continue
        if len(snaps) >= limit:
            break
    return snaps


def update_core_memory(session_id: str, label: str, value: str) -> None:
    """
    Atomically update a single core memory block.
    """
    snap = load_snapshot(session_id) or SessionSnapshot(session_id=session_id)
    snap.core_memory[label] = value
    save_snapshot(session_id, snap)


def get_core_memory(session_id: str, label: str) -> Optional[str]:
    """Get a single core memory block value."""
    snap = load_snapshot(session_id)
    return snap.core_memory.get(label) if snap else None


if __name__ == "__main__":
    import sys

    if len(sys.argv) > 1 and sys.argv[1] == "--list":
        snaps = list_snapshots()
        print(f"Snapshots ({len(snaps)}):")
        for s in snaps:
            print(f"  {s.session_id}: {s.last_active_at[:19]} "
                  f"[{len(s.core_memory)} blocks, {len(s.skill_context)} skills] "
                  f"{s.summary[:40] if s.summary else ''}")
    elif len(sys.argv) > 1 and sys.argv[1] == "--save":
        snap = SessionSnapshot(session_id="test-001")
        snap.core_memory["project"] = "Claude Code analysis"
        snap.core_memory["user_name"] = "Administrator"
        snap.skill_context["invest"] = {"mode": "quote", "symbol": "AAPL"}
        snap.summary = "Learning Claude Code architecture"
        snap.tags = ["analysis", "coding"]
        path = save_snapshot("test-001", snap)
        print(f"Saved: {path}")

        # Verify
        restored = load_snapshot("test-001")
        print(f"Restored: {restored.session_id}, "
              f"core_memory={restored.core_memory}, "
              f"skill_context={restored.skill_context}")
        delete_snapshot("test-001")
        print("Deleted test snapshot")
    else:
        print("Usage: python _session_snapshot.py [--list|--save]")
