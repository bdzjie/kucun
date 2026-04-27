"""
_skill_telemetry.py — Skill Invocation Telemetry

SQLite-backed skill invocation log for heartbeat health monitoring.
Every skill invocation is recorded with latency, success/failure, token usage, and estimated cost.

Usage:
    from skills._skill_telemetry import record_invocation, health_summary, estimate_tokens

    record_invocation(
        skill_id="invest",
        success=True,
        latency_ms=1200,
        input_text="Get AAPL quote",
        output_text="AAPL: $182.50",
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

# Model pricing (per 1M tokens) — configurable
MODEL_PRICING = {
    "default": {"input": 0.5, "output": 1.5},   # $0.5/1M in, $1.5/1M out
    "mini":   {"input": 0.1, "output": 0.4},
}


def _get_db() -> sqlite3.Connection:
    TELEM_DB.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(TELEM_DB))
    conn.execute("""
        CREATE TABLE IF NOT EXISTS skill_invocations (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            skill_id        TEXT NOT NULL,
            success         INTEGER NOT NULL,
            latency_ms      REAL DEFAULT 0.0,
            error_type      TEXT,
            error_msg       TEXT,
            depth           TEXT,
            timestamp       TEXT NOT NULL,
            input_tokens    INTEGER DEFAULT 0,
            output_tokens   INTEGER DEFAULT 0,
            estimated_cost  REAL DEFAULT 0.0,
            model           TEXT DEFAULT 'default'
        )
    """)
    # Add missing columns if table already exists (backward compat)
    for col, coltype in [
        ("input_tokens", "INTEGER DEFAULT 0"),
        ("output_tokens", "INTEGER DEFAULT 0"),
        ("estimated_cost", "REAL DEFAULT 0.0"),
        ("model", "TEXT DEFAULT 'default'"),
    ]:
        try:
            conn.execute(f"ALTER TABLE skill_invocations ADD COLUMN {col} {coltype}")
        except Exception:
            pass
    conn.execute("CREATE INDEX IF NOT EXISTS idx_inv_skill ON skill_invocations(skill_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_inv_ts ON skill_invocations(timestamp)")
    conn.commit()
    return conn


def estimate_tokens(text: str) -> int:
    """
    Estimate token count from text length.
    Rough heuristic: ~4 chars/token for English, ~2 chars/token for Chinese/mixed.
    Uses average 3.0 to be conservative.
    """
    if not text:
        return 0
    return max(1, int(len(text) / 3.0))


def estimate_cost(input_tokens: int, output_tokens: int, model: str = "default") -> float:
    """
    Estimate cost in USD based on token counts and model pricing.
    """
    rates = MODEL_PRICING.get(model, MODEL_PRICING["default"])
    cost = (input_tokens / 1_000_000) * rates["input"]
    cost += (output_tokens / 1_000_000) * rates["output"]
    return round(cost, 6)


def record_invocation(
    skill_id: str,
    success: bool,
    latency_ms: float = 0.0,
    error_type: Optional[str] = None,
    error_msg: Optional[str] = None,
    depth: str = "normal",
    input_text: str = "",
    output_text: str = "",
    model: str = "default",
) -> int:
    """
    Record a skill invocation with token and cost estimation.

    Args:
        skill_id: which skill was called
        success: True/False
        latency_ms: wall-clock time in ms
        input_text: raw text sent to the skill (for token estimation)
        output_text: raw text returned by the skill (for token estimation)
        model: pricing model key (default/mini)
    """
    input_tokens = estimate_tokens(input_text)
    output_tokens = estimate_tokens(output_text)
    estimated_cost = estimate_cost(input_tokens, output_tokens, model)

    conn = _get_db()
    now = datetime.now(timezone.utc).isoformat()
    cursor = conn.execute(
        "INSERT INTO skill_invocations "
        "(skill_id, success, latency_ms, error_type, error_msg, depth, timestamp, "
        "input_tokens, output_tokens, estimated_cost, model) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (skill_id, int(success), latency_ms, error_type, error_msg, depth, now,
         input_tokens, output_tokens, estimated_cost, model)
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

    Returns:
        {total_invocations, total_errors, error_rate_pct,
         total_cost_usd, by_skill: [{skill_id, invocations, errors,
         error_rate_pct, p95_ms, avg_cost_usd, total_cost_usd}], alerting_skills}
    """
    conn = _get_db()
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=since_hours)).isoformat()

    row = conn.execute(
        "SELECT COUNT(*), SUM(success=0), SUM(estimated_cost) "
        "FROM skill_invocations WHERE timestamp >= ?",
        (cutoff,)
    ).fetchone()
    total_inv = row[0] or 0
    total_err = row[1] or 0
    total_cost = row[2] or 0.0

    # Per-skill breakdown
    rows = conn.execute("""
        SELECT
            skill_id,
            COUNT(*) as inv,
            SUM(success=0) as errs,
            AVG(latency_ms) as avg_ms,
            SUM(estimated_cost) as total_cost,
            AVG(estimated_cost) as avg_cost
        FROM skill_invocations
        WHERE timestamp >= ?
        GROUP BY skill_id
        HAVING inv >= ?
        ORDER BY errs DESC
    """, (cutoff, min_invocations)).fetchall()

    by_skill = []
    alerting = []
    for (skill_id, inv, errs, avg_ms, total_cost_skill, avg_cost_skill) in rows:
        err_rate = errs / max(inv, 1)
        entry = {
            "skill_id": skill_id,
            "invocations": inv,
            "errors": errs,
            "error_rate_pct": round(err_rate * 100, 1),
            "avg_latency_ms": round(avg_ms or 0, 1),
            "total_cost_usd": round(total_cost_skill or 0, 6),
            "avg_cost_usd": round(avg_cost_skill or 0, 6),
        }
        by_skill.append(entry)
        if err_rate > 0.3:
            alerting.append(skill_id)

    conn.close()
    return {
        "total_invocations": total_inv,
        "total_errors": total_err,
        "error_rate_pct": round(total_err / max(total_inv, 1) * 100, 1),
        "total_cost_usd": round(total_cost, 6),
        "since_hours": since_hours,
        "by_skill": by_skill,
        "alerting_skills": alerting,
    }


if __name__ == "__main__":
    # Smoke test
    record_invocation(
        "invest", True, 1200.0,
        input_text="Get AAPL quote for today",
        output_text="AAPL: $182.50 USD",
        depth="normal",
    )
    record_invocation(
        "invest", False, 500.0,
        error_type="TimeoutError", error_msg="Request timed out",
        input_text="Get TSLA quote",
        output_text="",
        depth="normal",
    )
    record_invocation(
        "web-scraping", True, 3000.0,
        input_text="Scrape news from Reuters",
        output_text="[5 headlines extracted]",
        depth="deep",
    )

    import pprint
    summary = health_summary(since_hours=1)
    pprint.pprint(summary)
    print(f"\nTotal cost: ${summary['total_cost_usd']}")
