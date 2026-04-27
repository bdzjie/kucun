"""
_signal_store.py — Sentinel Tag Inter-Skill Signaling System

Lightweight pub/sub using SQLite as backing store.
No extra infrastructure needed.

Usage:
    from skills._signal_store import publish, poll, tags_for

    # Skill A signals Skill B
    publish("msg:to-memory_expert", {"action": "reindex", "target": "cone_graph"})

    # Skill B polls for its messages (call at start of handler)
    for signal in poll("msg:to-memory_expert", since=None):
        print(signal["payload"])
"""

import sqlite3, json, time
from pathlib import Path
from typing import Optional
from dataclasses import dataclass, asdict
from datetime import datetime, timezone

WORKSPACE = Path("C:/Users/Administrator/.openclaw/workspace")
SIGNAL_DB = WORKSPACE / "memory" / "_signals.db"


@dataclass
class Signal:
    id: int
    tag: str
    sender: str       # skill id that published
    payload: dict    # arbitrary JSON payload
    created_at: str   # ISO-8601 UTC


def _get_db() -> sqlite3.Connection:
    SIGNAL_DB.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(SIGNAL_DB))
    conn.execute("""
        CREATE TABLE IF NOT EXISTS signals (
            id        INTEGER PRIMARY KEY AUTOINCREMENT,
            tag       TEXT NOT NULL,
            sender    TEXT NOT NULL,
            payload   TEXT NOT NULL,
            created_at TEXT NOT NULL
        )
    """)
    conn.execute('CREATE INDEX IF NOT EXISTS idx_signals_tag ON signals(tag)')
    conn.execute('CREATE INDEX IF NOT EXISTS idx_signals_created ON signals(created_at)')
    conn.commit()
    return conn


def publish(tag: str, payload: dict, sender: str = "unknown") -> Signal:
    """Publish a signal under tag. Returns the Signal."""
    conn = _get_db()
    now = datetime.now(timezone.utc).isoformat()
    cursor = conn.execute(
        "INSERT INTO signals (tag, sender, payload, created_at) VALUES (?, ?, ?, ?)",
        (tag, sender, json.dumps(payload), now)
    )
    conn.commit()
    signal = Signal(id=cursor.lastrowid, tag=tag, sender=sender, payload=payload, created_at=now)
    conn.close()
    return signal


def poll(tag: str, since: Optional[str] = None, limit: int = 50) -> list[Signal]:
    """
    Poll for signals with given tag.
    
    Args:
        tag: Tag to subscribe to (e.g. "msg:to-memory_expert")
        since: ISO-8601 timestamp — return signals newer than this.
               None = return all signals for this tag.
        limit: Maximum signals to return (most recent first)
    
    Returns:
        List of Signal objects, most recent first.
    """
    conn = _get_db()
    if since:
        cursor = conn.execute(
            "SELECT id, tag, sender, payload, created_at FROM signals "
            "WHERE tag=? AND created_at>? ORDER BY id DESC LIMIT ?",
            (tag, since, limit)
        )
    else:
        cursor = conn.execute(
            "SELECT id, tag, sender, payload, created_at FROM signals "
            "WHERE tag=? ORDER BY id DESC LIMIT ?",
            (tag, limit)
        )
    rows = cursor.fetchall()
    conn.close()
    return [
        Signal(id=r[0], tag=r[1], sender=r[2], payload=json.loads(r[3]), created_at=r[4])
        for r in rows
    ]


def tags_for(skill_id: str, since: Optional[str] = None, limit: int = 100) -> list[str]:
    """
    Return all unique tags that have been published, optionally
    since a given timestamp. Useful for a skill to discover
    if anyone is trying to communicate with it.
    """
    conn = _get_db()
    if since:
        cursor = conn.execute(
            "SELECT DISTINCT tag FROM signals WHERE created_at>? ORDER BY id DESC LIMIT ?",
            (since, limit)
        )
    else:
        cursor = conn.execute(
            "SELECT DISTINCT tag FROM signals ORDER BY id DESC LIMIT ?",
            (limit,)
        )
    return [r[0] for r in cursor.fetchall()]


def consume(signal_id: int) -> None:
    """Delete a signal after processing to prevent re-delivery."""
    conn = _get_db()
    conn.execute("DELETE FROM signals WHERE id=?", (signal_id,))
    conn.commit()
    conn.close()


def pending_count(tag: str, since: Optional[str] = None) -> int:
    """Return count of unread signals for a tag."""
    conn = _get_db()
    if since:
        cursor = conn.execute(
            "SELECT COUNT(*) FROM signals WHERE tag=? AND created_at>?",
            (tag, since)
        )
    else:
        cursor = conn.execute("SELECT COUNT(*) FROM signals WHERE tag=?", (tag,))
    count = cursor.fetchone()[0]
    conn.close()
    return count


if __name__ == "__main__":
    # Smoke test
    publish("msg:test", {"hello": "world"}, sender="test_skill")
    signals = poll("msg:test")
    print(f"poll msg:test: {signals}")
    consume(signals[0].id)
    print(f"after consume: {pending_count('msg:test')}")
