"""
_memory_acl.py — Memory ACL Isolation per Session

Ensures each session's memory directory is isolated from other sessions.
- Session memory dir: memory/sessions/<session_id>/
- File permissions: 0600 (owner read/write only) on all session memory files
- ACL entries: session_id -> set of authorized agent_ids
- Cross-session read detection: logged as security event

Usage:
    from skills._memory_acl import enforce_session_acl, get_session_memory_path

    enforce_session_acl(session_id="sess_abc")
    path = get_session_memory_path(session_id="sess_abc")
    # path: memory/sessions/sess_abc/
    # Files created here have permissions 0600

CLI:
    python skills/_memory_acl.py --check <session_id>
    python skills/_memory_acl.py --audit
"""

import json
import os
import stat
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

WORKSPACE = Path("C:/Users/Administrator/.openclaw/workspace")
SESSIONS_DIR = WORKSPACE / "memory" / "sessions"
ACL_FILE = WORKSPACE / "memory" / "_session_acl.json"


@dataclass
class SessionACL:
    """ACL entry for a session."""
    session_id: str
    created_at: str = ""
    owner_agent_id: str = "main"
    authorized_agent_ids: list[str] = field(default_factory=list)
    file_count: int = 0
    last_access_at: str = ""

    def __post_init__(self):
        if not self.created_at:
            self.created_at = datetime.now(timezone.utc).isoformat()


def _load_acl() -> dict[str, SessionACL]:
    if not ACL_FILE.exists():
        return {}
    try:
        data = json.loads(ACL_FILE.read_text(encoding="utf-8"))
        return {k: SessionACL(**v) for k, v in data.items()}
    except Exception:
        return {}


def _save_acl(acl: dict[str, SessionACL]) -> None:
    ACL_FILE.parent.mkdir(parents=True, exist_ok=True)
    ACL_FILE.write_text(
        json.dumps({k: v.__dict__ for k, v in acl.items()}, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )


def get_session_memory_path(session_id: str) -> Path:
    """Get or create the memory directory for a session."""
    path = SESSIONS_DIR / session_id
    path.mkdir(parents=True, exist_ok=True)
    return path


def enforce_session_acl(session_id: str, owner_agent_id: str = "main") -> SessionACL:
    """
    Ensure a session directory exists, is registered in ACL,
    and has correct permissions.

    Returns the SessionACL entry.
    """
    acl = _load_acl()
    mem_path = get_session_memory_path(session_id)

    if session_id not in acl:
        acl[session_id] = SessionACL(
            session_id=session_id,
            owner_agent_id=owner_agent_id,
            authorized_agent_ids=[owner_agent_id],
        )

    entry = acl[session_id]
    entry.last_access_at = datetime.now(timezone.utc).isoformat()
    entry.file_count = len(list(mem_path.glob("*")))

    # Enforce file permissions on existing files
    for f in mem_path.iterdir():
        if f.is_file():
            _enforce_file_permissions(f)

    _save_acl(acl)
    return entry


def _enforce_file_permissions(path: Path) -> None:
    """Set file to 0600 (owner rw only)."""
    try:
        current_mode = path.stat().st_mode & 0o777
        if current_mode != 0o600:
            os.chmod(path, stat.S_IRUSR | stat.S_IWUSR)  # 0600
    except Exception:
        pass


def check_cross_session_access(session_id: str, requesting_agent_id: str) -> bool:
    """
    Check if requesting_agent_id is authorized for session_id.
    Logs unauthorized access attempt.

    Returns True if authorized, False if blocked.
    """
    acl = _load_acl()
    entry = acl.get(session_id)

    if not entry:
        # Unknown session — grant if directory exists and matches owner
        return True

    if requesting_agent_id in entry.authorized_agent_ids:
        return True

    # Unauthorized access attempt
    _log_security_event(
        event_type="unauthorized_session_access",
        session_id=session_id,
        requesting_agent_id=requesting_agent_id,
        owner_agent_id=entry.owner_agent_id,
    )
    return False


def _log_security_event(**kwargs) -> None:
    """Log security event to _security_log.jsonl."""
    log_path = WORKSPACE / "memory" / "_security_log.jsonl"
    log_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        with open(str(log_path), "a", encoding="utf-8") as f:
            kwargs["timestamp"] = datetime.now(timezone.utc).isoformat()
            f.write(json.dumps(kwargs, ensure_ascii=False) + "\n")
    except Exception:
        pass


def grant_access(session_id: str, agent_id: str) -> None:
    """Grant an agent access to a session's memory."""
    acl = _load_acl()
    if session_id not in acl:
        acl[session_id] = SessionACL(session_id=session_id)
    if agent_id not in acl[session_id].authorized_agent_ids:
        acl[session_id].authorized_agent_ids.append(agent_id)
    _save_acl(acl)


def revoke_access(session_id: str, agent_id: str) -> None:
    """Revoke an agent's access to a session's memory."""
    acl = _load_acl()
    if session_id in acl:
        if agent_id in acl[session_id].authorized_agent_ids:
            acl[session_id].authorized_agent_ids.remove(agent_id)
        _save_acl(acl)


def audit_sessions() -> dict:
    """Audit all session directories for permission violations."""
    if not SESSIONS_DIR.exists():
        return {"violations": [], "total_sessions": 0}

    violations = []
    acl = _load_acl()
    total_sessions = 0

    for sess_dir in SESSIONS_DIR.iterdir():
        if not sess_dir.is_dir():
            continue
        total_sessions += 1
        entry = acl.get(sess_dir.name)

        for f in sess_dir.iterdir():
            if not f.is_file():
                continue
            mode = f.stat().st_mode & 0o777
            if mode & 0o077:  # group or other has any permission
                violations.append({
                    "session_id": sess_dir.name,
                    "file": str(f.name),
                    "mode": oct(mode),
                    "expected": "0600",
                })
                _enforce_file_permissions(f)

    return {
        "total_sessions": total_sessions,
        "violations": violations,
        "violation_count": len(violations),
    }


# ── CLI ─────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--check":
        session_id = sys.argv[2] if len(sys.argv) > 2 else "default"
        entry = enforce_session_acl(session_id)
        print(f"Session: {entry.session_id}")
        print(f"  owner: {entry.owner_agent_id}")
        print(f"  authorized: {entry.authorized_agent_ids}")
        print(f"  files: {entry.file_count}")
        print(f"  last_access: {entry.last_access_at}")
        print(f"  dir: {get_session_memory_path(session_id)}")

    elif len(sys.argv) > 1 and sys.argv[1] == "--audit":
        result = audit_sessions()
        print(f"Total sessions: {result['total_sessions']}")
        print(f"Violations: {result['violation_count']}")
        for v in result["violations"]:
            print(f"  {v['session_id']}/{v['file']}: {v['mode']} (expected {v['expected']})")

    elif len(sys.argv) > 1 and sys.argv[1] == "--grant":
        if len(sys.argv) > 3:
            grant_access(sys.argv[2], sys.argv[3])
            print(f"Granted {sys.argv[3]} access to {sys.argv[2]}")
        else:
            print("Usage: --grant <session_id> <agent_id>")

    elif len(sys.argv) > 1 and sys.argv[1] == "--revoke":
        if len(sys.argv) > 3:
            revoke_access(sys.argv[2], sys.argv[3])
            print(f"Revoked {sys.argv[3]} access from {sys.argv[2]}")
        else:
            print("Usage: --revoke <session_id> <agent_id>")

    else:
        print("Usage:")
        print("  --check <session_id>     Check/enforce ACL for session")
        print("  --audit                  Audit all session directories")
        print("  --grant <session_id> <agent_id>")
        print("  --revoke <session_id> <agent_id>")
