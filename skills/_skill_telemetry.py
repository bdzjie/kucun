"""
_skill_telemetry.py — Skill Invocation Telemetry

SQLite-backed skill invocation log for heartbeat health monitoring.
Every skill invocation is recorded with latency, success/failure, and error type.

Usage:
    from skills._skill_telemetry import record_invocation, health_summary

    record_invocation(
        skill_id="invest",
        success=True,
        latency_ms=1200,
        error_type=None,
        depth="normal",
    )

    # In heartbeat:
    print(health_summary(threshold_p95_ms=5000))
"""

import sqlite3, json, time
from pathlib import Path
from datetime import datetime, timezone, timedelta
from typing import Optional

WORKSPACE = Path("C:/Users/Administrator/.openclaw/workspace")
TELEM_DB = WORKSPACE / "memory" / "_skill_telemetry.db"


def _get_db() -> sqlite3.Connection:
    TELEM_DB.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(TELEM_DB))
    conn.execute("""
        CREATE TABLE IF NOT EXISTS skill_invocations (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            skill_id     TEXT NOT NULL,
            success      INTEGER NOT NULL,      -- 1 or 0
            latency_ms   REAL DEFAULT 0.0,
            error_type   TEXT,
            error_msg    TEXT,
            depth        TEXT,                  -- fast/normal/deep
            timestamp    TEXT NOT NULL          -- ISO-8601 UTC
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_inv_skill ON skill_invocations(skill_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_inv_ts ON skill_invocations(timestamp)")
    conn.commit()
    return conn


def record_invocation(
    skill_id: str,
    success: bool,
    latency_ms: float = 0.0,
    error_type: Optional[str] = None,
    error_msg: Optional[str] = None,
    depth: str = "normal",
) -> int:
    """
    Record a skill invocation. Returns the row ID.
    Call this from skill handlers (or from CircuitBreaker.call wrapper).
    """
    conn = _get_db()
    now = datetime.now(timezone.utc).isoformat()
    cursor = conn.execute(
        "INSERT INTO skill_invocations "
        "(skill_id, success, latency_ms, error_type, error_msg, depth, timestamp) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (skill_id, int(success), latency_ms, error_type, error_msg, depth, now)
    )
    conn.commit()
    row_id = cursor.lastrowid
    conn.close()
    return row_id


def health_summary(
    since_hours: int = 24,
    threshold_p95_ms: float = 5000.0,
    min_invocations: int = 2,
) -> dict:
    """
    Compute skill health summary from telemetry DB.

    Returns dict:
      - total_invocations: int
      - total_errors: int
      - error_rate_pct: float
      - by_skill: [{skill_id, invocations, errors, error_rate_pct, p95_ms, p50_ms}]
      - alerting_skills: [skill_ids where p95_ms > threshold or error_rate > 0.3]
    """
    conn = _get_db()
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=since_hours)).isoformat()

    total = conn.execute(
        "SELECT COUNT(*), SUM(success=0) FROM skill_invocations WHERE timestamp >= ?",
        (cutoff,)
    ).fetchone()
    total_invocations = total[0] or 0
    total_errors = total[1] or 0

    # Per-skill stats
    rows = conn.execute("""
        SELECT
            skill_id,
            COUNT(*) as invocations,
            SUM(success=0) as errors,
            AVG(latency_ms) as avg_ms,
            MAX(latency_ms) as max_ms
        FROM skill_invocations
        WHERE timestamp >= ?
        GROUP BY skill_id
        HAVING invocations >= ?
        ORDER BY errors DESC
    """, (cutoff, min_invocations)).fetchall()

    by_skill = []
    alerting = []
    for (skill_id, inv, err, avg_ms, max_ms) in rows:
        err_rate = err / max(inv, 1)
        # Compute p95
        p95_ms = conn.execute("""
            SELECT latency_ms FROM skill_invocations
            WHERE skill_id=? AND timestamp>=? AND latency_ms>0
            ORDER BY latency_ms
            LIMIT 1 OFFSET (SELECT COUNT(*) FROM skill_invocations
                            WHERE skill_id=? AND timestamp>=? AND latency_ms>0) * 95 / 100
        """, (skill_id, cutoff, skill_id, cutoff)).fetchone()
        p95_val = p95_ms[0] if p95_ms else 0.0

        entry = {
            "skill_id": skill_id,
            "invocations": inv,
            "errors": err,
            "error_rate_pct": round(err_rate * 100, 1),
            "avg_ms": round(avg_ms or 0, 1),
            "p95_ms": round(p95_val, 1),
            "max_ms": round(max_ms or 0, 1),
        }
        by_skill.append(entry)
        if err_rate > 0.3 or p95_val > threshold_p95_ms:
            alerting.append(skill_id)

    conn.close()
    return {
        "total_invocations": total_invocations,
        "total_errors": total_errors,
        "error_rate_pct": round(total_errors / max(total_invocations, 1) * 100, 1),
        "since_hours": since_hours,
        "by_skill": by_skill,
        "alerting_skills": alerting,
    }


if __name__ == "__main__":
    # Smoke test
    record_invocation("invest", True, 1200.0, depth="normal")
    record_invocation("invest", False, 500.0, error_type="APIError", error_msg="rate limit", depth="normal")
    record_invocation("web-scraping", True, 3000.0, depth="deep")

    summary = health_summary(since_hours=1)
    print("Health Summary:", json.dumps(summary, indent=2))
