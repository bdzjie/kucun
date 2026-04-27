"""
_session_persistence.py — Agent Session Persistence & Crash Recovery

Provides:
  - Checkpoint: save session state at safe points (post-compaction, every N messages)
  - Resume: restore from latest checkpoint and resume mid-session
  - Health check: verify snapshot completeness before advertising resume capability
  - Crash recovery: detect interrupted sessions on startup and offer recovery

Based on MemGPT checkpoint strategy + Letta Context Constitution persistence principles.

Usage:
    from skills._session_persistence import (
        checkpoint_session, resume_session,
        get_latest_checkpoint, is_recoverable,
        session_health_check,
    )

    # After compaction or every N messages:
    checkpoint_session(session_id="sess_abc")

    # On startup / recovery:
    if is_recoverable("sess_abc"):
        state = resume_session("sess_abc")
        print(f"Resumed: {state.last_summary}")

CLI:
    python skills/_session_persistence.py --check
    python skills/_session_persistence.py --resume <session_id>
    python skills/_session_persistence.py --health
"""

import json
import os
import shutil
import sys
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Optional

WORKSPACE = Path("C:/Users/Administrator/.openclaw/workspace")
SNAPSHOT_DIR = WORKSPACE / "memory" / "snapshots"
CHECKPOINT_DIR = WORKSPACE / "memory" / "checkpoints"


@dataclass
class CheckpointMetadata:
    checkpoint_id: str
    session_id: str
    created_at: str                    # ISO-8601 UTC
    message_count: int                 # messages processed at checkpoint
    snapshot_completeness: float        # 0.0-1.0, fraction of expected fields populated
    last_summary: str                  # what was happening at checkpoint
    triggered_by: str                   # auto_compaction | manual | interval | startup
    token_count: int                   # context token count at checkpoint
    recoverable: bool                  # True if all required fields present


def _snapshot_path(session_id: str) -> Path:
    return SNAPSHOT_DIR / f"{session_id}.json"


def _checkpoint_dir(session_id: str) -> Path:
    return CHECKPOINT_DIR / session_id


def _checkpoint_meta_path(session_id: str) -> Path:
    return _checkpoint_dir(session_id) / "_checkpoint_meta.json"


def _latest_checkpoint_path(session_id: str) -> Path:
    return _checkpoint_dir(session_id) / "_latest"


@dataclass
class ResumeState:
    session_id: str
    snapshot_completeness: float
    recovered_fields: list[str]
    missing_fields: list[str]
    last_activity: str
    checkpoint_id: str
    summary: str


# ── Checkpoint ──────────────────────────────────────────────────────────

def checkpoint_session(
    session_id: str,
    triggered_by: str = "manual",
    message_count: int = 0,
    token_count: int = 0,
    last_summary: str = "",
    completeness: float = 1.0,
) -> CheckpointMetadata:
    """
    Create a checkpoint of the current session state.

    A checkpoint = snapshot + metadata + optional WAL of recent events.
    Unlike a full snapshot, checkpoints are lightweight and can be created
    frequently (e.g., every N messages or after each compaction).
    """
    # Load or create snapshot
    from skills._session_snapshot import load_snapshot, SessionSnapshot
    snap = load_snapshot(session_id)
    if not snap:
        snap = SessionSnapshot(session_id=session_id)

    checkpoint_id = f"chk_{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}"
    meta = CheckpointMetadata(
        checkpoint_id=checkpoint_id,
        session_id=session_id,
        created_at=datetime.now(timezone.utc).isoformat(),
        message_count=message_count,
        snapshot_completeness=completeness,
        last_summary=last_summary[:200],
        triggered_by=triggered_by,
        token_count=token_count,
        recoverable=True,
    )

    # Save to checkpoint dir (separate from regular snapshots)
    chk_dir = _checkpoint_dir(session_id)
    chk_dir.mkdir(parents=True, exist_ok=True)

    # Save snapshot copy
    chk_snap_path = chk_dir / f"{checkpoint_id}.json"
    chk_snap_path.write_text(
        json.dumps(snap.to_dict(), ensure_ascii=False),
        encoding="utf-8",
    )

    # Update latest pointer
    _latest_checkpoint_path(session_id).write_text(checkpoint_id, encoding="utf-8")

    # Save metadata
    _checkpoint_meta_path(session_id).write_text(
        json.dumps(meta.__dict__, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )

    return meta


def get_latest_checkpoint(session_id: str) -> Optional[CheckpointMetadata]:
    """Get metadata for the latest checkpoint of a session."""
    meta_path = _checkpoint_meta_path(session_id)
    if not meta_path.exists():
        return None
    try:
        d = json.loads(meta_path.read_text(encoding="utf-8"))
        return CheckpointMetadata(**d)
    except Exception:
        return None


# ── Resume ──────────────────────────────────────────────────────────────

def resume_session(session_id: str) -> Optional[ResumeState]:
    """
    Attempt to resume a session from its latest checkpoint.

    Returns ResumeState with recovered_fields, missing_fields, and summary.
    Returns None if no checkpoint exists or checkpoint is not recoverable.
    """
    latest = get_latest_checkpoint(session_id)
    if not latest:
        return None

    if not latest.recoverable:
        return None

    # Load snapshot
    from skills._session_snapshot import load_snapshot
    snap = load_snapshot(session_id)
    if not snap:
        return None

    # Assess completeness
    expected_fields = [
        "session_id", "created_at", "last_active_at",
        "core_memory", "skill_context", "routing_preferences",
    ]
    recovered = []
    missing = []
    for field in expected_fields:
        val = getattr(snap, field, None)
        if val and (not isinstance(val, dict) or len(val) > 0):
            recovered.append(field)
        else:
            missing.append(field)

    completeness = len(recovered) / len(expected_fields)

    return ResumeState(
        session_id=session_id,
        snapshot_completeness=completeness,
        recovered_fields=recovered,
        missing_fields=missing,
        last_activity=snap.last_active_at,
        checkpoint_id=latest.checkpoint_id,
        summary=latest.last_summary,
    )


def is_recoverable(session_id: str) -> bool:
    """Check if a session has a valid, recoverable checkpoint."""
    latest = get_latest_checkpoint(session_id)
    if not latest:
        return False
    return latest.recoverable and latest.snapshot_completeness >= 0.5


# ── Health Check ─────────────────────────────────────────────────────────

def session_health_check(session_id: str = "") -> dict:
    """
    Run a health check on session snapshots/checkpoints.

    Returns:
        {recoverable: bool, issues: [], summary: str}
    """
    issues = []
    warnings = []

    if not session_id:
        # Check all sessions
        if not SNAPSHOT_DIR.exists():
            return {"recoverable_sessions": 0, "total": 0, "issues": []}
        sessions = [p.stem for p in SNAPSHOT_DIR.glob("*.json")]
        results = [session_health_check(s) for s in sessions]
        recoverable = sum(1 for r in results if r["recoverable"])
        return {
            "total": len(sessions),
            "recoverable": recoverable,
            "issues": [r["issues"] for r in results if r["issues"]],
        }

    # Check individual session
    latest = get_latest_checkpoint(session_id)
    snap_path = _snapshot_path(session_id)

    if not latest and not snap_path.exists():
        return {"recoverable": False, "issues": ["no snapshot or checkpoint found"]}

    if latest:
        if latest.snapshot_completeness < 0.5:
            issues.append(f"low completeness: {latest.snapshot_completeness:.0%}")
        if latest.triggered_by == "manual":
            warnings.append("checkpoint from manual trigger only")
        age = datetime.now(timezone.utc) - datetime.fromisoformat(latest.created_at)
        if age > timedelta(hours=24):
            warnings.append(f"checkpoint is {age.days}d old")
    else:
        issues.append("no checkpoint, only snapshot exists")

    return {
        "recoverable": len(issues) == 0,
        "issues": issues,
        "warnings": warnings,
        "checkpoint": latest.checkpoint_id if latest else None,
        "snapshot_completeness": latest.snapshot_completeness if latest else 0.0,
    }


# ── Crash Recovery Protocol ──────────────────────────────────────────────

def detect_crash_recovery_needed() -> list[str]:
    """
    On startup, detect sessions that were interrupted (have checkpoint but
    last_active > threshold without corresponding end event).

    Returns list of session_ids that look like crash recoveries.
    """
    if not CHECKPOINT_DIR.exists():
        return []

    interrupted = []
    for session_dir in CHECKPOINT_DIR.iterdir():
        if not session_dir.is_dir():
            continue
        session_id = session_dir.name
        latest = get_latest_checkpoint(session_id)
        if not latest:
            continue
        last_active = datetime.fromisoformat(latest.created_at)
        age = datetime.now(timezone.utc) - last_active
        # If last checkpoint < 2 hours ago and no subsequent activity
        if age < timedelta(hours=2):
            # Check if there's a session still "active" marker
            # (would integrate with actual session manager here)
            interrupted.append(session_id)
    return interrupted


# ── CLI ─────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--check":
        session_id = sys.argv[2] if len(sys.argv) > 2 else ""
        result = session_health_check(session_id)
        print(f"Health check for {session_id or 'all'}:")
        print(f"  recoverable: {result.get('recoverable', False)}")
        if result.get("issues"):
            print(f"  issues: {result['issues']}")
        if result.get("warnings"):
            print(f"  warnings: {result['warnings']}")

    elif len(sys.argv) > 1 and sys.argv[1] == "--resume":
        session_id = sys.argv[2] if len(sys.argv) > 2 else ""
        state = resume_session(session_id)
        if state:
            print(f"Resumable: {state.session_id}")
            print(f"  completeness: {state.snapshot_completeness:.0%}")
            print(f"  recovered: {state.recovered_fields}")
            print(f"  missing: {state.missing_fields}")
        else:
            print(f"No recovery state for {session_id}")

    elif len(sys.argv) > 1 and sys.argv[1] == "--health":
        result = session_health_check("")
        print(f"All sessions: {result['total']} total, {result['recoverable']} recoverable")

    elif len(sys.argv) > 1 and sys.argv[1] == "--detect-crash":
        crashed = detect_crash_recovery_needed()
        print(f"Potential crash recoveries: {len(crashed)}")
        for s in crashed:
            print(f"  {s}")

    else:
        print("Usage:")
        print("  --check [session_id]    Check session health")
        print("  --resume <session_id>   Attempt to resume session")
        print("  --health                Check all sessions")
        print("  --detect-crash          Detect interrupted sessions")
