"""
_skill_tracer.py — OpenTelemetry-style Skill Tracing

Decorator @trace_skill(skill_id) wraps skill handlers with span telemetry.
Each span records: skill_id, operation, start/end time, latency_ms,
success/error, and optional attributes.

Output formats:
  - dict (for memory/_session_trace.jsonl)
  - OTLP-compatible JSON (for OTEL_COLLECTOR endpoint)
  - AgentOps event dict (for agentops.track())

Usage:
    from skills._skill_tracer import trace_skill, get_tracer

    tracer = get_tracer()
    with tracer.span("invest", "get_quote") as span:
        span.add_attribute("symbol", "AAPL")
        result = await get_quote("AAPL")
        span.set_success()

    @trace_skill("invest", operation="get_quote")
    async def get_quote(symbol: str): ...

CLI:
    python skills/_skill_tracer.py --recent
    python skills/_skill_tracer.py --stats
"""

import asyncio
import functools
import json
import sys
import time
import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any, Callable, Optional

WORKSPACE = Path("C:/Users/Administrator/.openclaw/workspace")
TRACE_LOG = WORKSPACE / "memory" / "_session_trace.jsonl"


# ── Utilities ────────────────────────────────────────────────────────────

def _json_serializable(v: Any) -> Any:
    if isinstance(v, (str, int, float, bool)):
        return v
    if v is None:
        return "null"
    return str(v)


def _unix_nano(iso_str: str) -> int:
    if not iso_str:
        return 0
    dt = datetime.fromisoformat(iso_str)
    return int(dt.timestamp() * 1e9)


class SpanStatus(Enum):
    UNSTARTED = "unstarted"
    OK = "ok"
    ERROR = "error"


# ── SkillSpan ────────────────────────────────────────────────────────────

@dataclass
class SkillSpan:
    span_id: str = ""
    trace_id: str = ""
    parent_span_id: str = ""
    skill_id: str = ""
    operation: str = ""
    status: str = SpanStatus.UNSTARTED.value
    start_ts: str = ""
    end_ts: str = ""
    latency_ms: float = 0.0
    error_type: str = ""
    error_msg: str = ""
    attributes: dict = field(default_factory=dict)
    events: list = field(default_factory=list)

    def __post_init__(self):
        self.span_id = f"span_{uuid.uuid4().hex[:12]}"
        if not self.trace_id:
            self.trace_id = f"trace_{uuid.uuid4().hex[:16]}"

    def start(self) -> "SkillSpan":
        self.start_ts = datetime.now(timezone.utc).isoformat()
        self.status = SpanStatus.UNSTARTED.value
        return self

    def end(self) -> "SkillSpan":
        self.end_ts = datetime.now(timezone.utc).isoformat()
        if self.start_ts:
            start_dt = datetime.fromisoformat(self.start_ts)
            end_dt = datetime.fromisoformat(self.end_ts)
            self.latency_ms = (end_dt - start_dt).total_seconds() * 1000
        return self

    def set_success(self) -> "SkillSpan":
        self.status = SpanStatus.OK.value
        return self

    def set_error(self, error_type: str = "", error_msg: str = "") -> "SkillSpan":
        self.status = SpanStatus.ERROR.value
        self.error_type = error_type
        self.error_msg = error_msg
        return self

    def add_attribute(self, key: str, value: Any) -> "SkillSpan":
        self.attributes[key] = _json_serializable(value)
        return self

    def add_event(self, name: str, attributes: dict = None) -> "SkillSpan":
        self.events.append({
            "name": name,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "attributes": {k: _json_serializable(v) for k, v in (attributes or {}).items()},
        })
        return self

    def to_dict(self) -> dict:
        return asdict(self)

    def to_otlp(self) -> dict:
        return {
            "trace_id": self.trace_id,
            "span_id": self.span_id,
            "parent_span_id": self.parent_span_id,
            "name": f"{self.skill_id}.{self.operation}",
            "kind": 1,
            "status": {"code": 1 if self.status == "ok" else 2},
            "start_time": _unix_nano(self.start_ts),
            "end_time": _unix_nano(self.end_ts),
            "attributes": [
                {"key": k, "value": {"string_value": str(v)}}
                for k, v in self.attributes.items()
            ],
        }


# ── SkillTracer ──────────────────────────────────────────────────────────

class SkillTracer:
    def __init__(self, export_otlp: bool = False, otlp_endpoint: str = ""):
        self._export_otlp = export_otlp
        self._otlp_endpoint = otlp_endpoint
        self._active_spans: dict[str, SkillSpan] = {}
        self._log_buffer: list[str] = []
        TRACE_LOG.parent.mkdir(parents=True, exist_ok=True)

    def start_span(self, skill_id: str, operation: str,
                   parent_span_id: str = "", attributes: dict = None) -> SkillSpan:
        span = SkillSpan(
            skill_id=skill_id, operation=operation,
            parent_span_id=parent_span_id,
            attributes=(attributes or {}),
        )
        span.start()
        self._active_spans[span.span_id] = span
        return span

    def end_span(self, span: SkillSpan) -> None:
        span.end()
        self._flush_span(span)
        self._active_spans.pop(span.span_id, None)

    def span(self, skill_id: str, operation: str,
             parent_span_id: str = "", attributes: dict = None):
        return _SpanContext(self, skill_id, operation, parent_span_id, attributes)

    def flush(self) -> None:
        if self._log_buffer and TRACE_LOG:
            with open(str(TRACE_LOG), "a", encoding="utf-8") as f:
                f.write("\n".join(self._log_buffer) + "\n")
            self._log_buffer.clear()

    def _flush_span(self, span: SkillSpan) -> None:
        self._log_buffer.append(json.dumps(span.to_dict(), ensure_ascii=False))
        if len(self._log_buffer) >= 10:
            self.flush()
        if self._export_otlp and self._otlp_endpoint:
            self._export_otlp_span(span)

    def _export_otlp_span(self, span: SkillSpan) -> None:
        try:
            import urllib.request
            payload = json.dumps([span.to_otlp()]).encode("utf-8")
            req = urllib.request.Request(
                self._otlp_endpoint,
                data=payload,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            urllib.request.urlopen(req, timeout=2)
        except Exception:
            pass

    def recent_spans(self, limit: int = 50) -> list[SkillSpan]:
        if not TRACE_LOG.exists():
            return []
        spans = []
        try:
            lines = TRACE_LOG.read_text(encoding="utf-8").strip().split("\n")
            for line in reversed(lines):
                if not line.strip():
                    continue
                try:
                    spans.append(SkillSpan(**json.loads(line)))
                except Exception:
                    continue
                if len(spans) >= limit:
                    break
        except Exception:
            pass
        return spans

    def trace_stats(self, since_hours: int = 24) -> dict:
        if not TRACE_LOG.exists():
            return {}
        cutoff = datetime.now(timezone.utc).timestamp() - since_hours * 3600
        counts, errors, latencies = {}, {}, {}
        try:
            lines = TRACE_LOG.read_text(encoding="utf-8").strip().split("\n")
            for line in lines:
                if not line.strip():
                    continue
                try:
                    d = json.loads(line)
                    ts = datetime.fromisoformat(d["start_ts"]).timestamp()
                    if ts < cutoff:
                        continue
                    sid = d["skill_id"]
                    counts[sid] = counts.get(sid, 0) + 1
                    if d["status"] == "error":
                        errors[sid] = errors.get(sid, 0) + 1
                    lat = d.get("latency_ms", 0)
                    latencies.setdefault(sid, []).append(lat)
                except Exception:
                    continue
        except Exception:
            pass
        return {
            sid: {
                "count": counts[sid],
                "errors": errors.get(sid, 0),
                "error_rate": round(errors.get(sid, 0) / counts[sid], 3),
                "avg_latency_ms": round(sum(latencies[sid]) / len(latencies[sid]), 1)
                    if latencies.get(sid) else 0,
            }
            for sid in counts
        }


class _SpanContext:
    """Context manager for SkillTracer.span()."""
    def __init__(self, tracer, skill_id, operation, parent_span_id, attributes):
        self._tracer = tracer
        self._span = tracer.start_span(skill_id, operation, parent_span_id, attributes)

    def __enter__(self) -> SkillSpan:
        return self._span

    def __exit__(self, exc_type, exc_val, exc_tb):
        if exc_type:
            self._span.set_error(exc_type.__name__, str(exc_val)[:200])
        self._tracer.end_span(self._span)
        return None


# ── Global tracer ─────────────────────────────────────────────────────────

_tracer: Optional[SkillTracer] = None


def get_tracer() -> SkillTracer:
    global _tracer
    if _tracer is None:
        _tracer = SkillTracer()
    return _tracer


# ── Decorator ────────────────────────────────────────────────────────────

def trace_skill(skill_id: str, operation: str = "default"):
    def decorator(func: Callable) -> Callable:
        @functools.wraps(func)
        def sync_wrapper(*args, **kwargs):
            tracer = get_tracer()
            with tracer.span(skill_id, operation) as span:
                span.add_attribute("skill", skill_id)
                span.add_attribute("operation", operation)
                try:
                    result = func(*args, **kwargs)
                    span.set_success()
                    return result
                except Exception as e:
                    span.set_error(type(e).__name__, str(e)[:200])
                    raise

        @functools.wraps(func)
        async def async_wrapper(*args, **kwargs):
            tracer = get_tracer()
            with tracer.span(skill_id, operation) as span:
                span.add_attribute("skill", skill_id)
                span.add_attribute("operation", operation)
                try:
                    result = await func(*args, **kwargs)
                    span.set_success()
                    return result
                except Exception as e:
                    span.set_error(type(e).__name__, str(e)[:200])
                    raise

        if asyncio.iscoroutinefunction(func):
            return async_wrapper
        return sync_wrapper

    return decorator


# ── AgentOps Integration ─────────────────────────────────────────────────

def to_agentops_event(span: SkillSpan) -> dict:
    return {
        "event_type": "agent_skill",
        "skill_id": span.skill_id,
        "operation": span.operation,
        "success": span.status == "ok",
        "latency_ms": span.latency_ms,
        "error_type": span.error_type,
        "trace_id": span.trace_id,
        "span_id": span.span_id,
        "parent_span_id": span.parent_span_id,
        "attributes": span.attributes,
    }


# ── CLI ─────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    tracer = get_tracer()

    if len(sys.argv) > 1 and sys.argv[1] == "--recent":
        spans = tracer.recent_spans(limit=20)
        print(f"Recent {len(spans)} span(s):")
        for s in spans:
            icon = "OK" if s.status == "ok" else "ERR"
            print(f"  [{icon}] {s.skill_id}.{s.operation} "
                  f"{s.latency_ms:.0f}ms trace={s.trace_id[:16]}")

    elif len(sys.argv) > 1 and sys.argv[1] == "--stats":
        stats = tracer.trace_stats(since_hours=24)
        print("Trace stats by skill (24h):")
        for sid, info in sorted(stats.items(), key=lambda x: -x[1]["count"]):
            print(f"  {sid}: count={info['count']} "
                  f"errors={info['errors']}({info['error_rate']:.1%}) "
                  f"avg_lat={info['avg_latency_ms']:.0f}ms")

    else:
        # Smoke test
        with tracer.span("invest", "get_quote", attributes={"symbol": "AAPL"}) as span:
            time.sleep(0.05)
            span.set_success()
        with tracer.span("invest", "get_quote", attributes={"symbol": "TSLA"}) as span:
            span.set_error("TimeoutError", "Request timed out")
        tracer.flush()
        spans = tracer.recent_spans(limit=5)
        print(f"Trace test: {len(spans)} spans recorded")
        for s in spans:
            print(f"  [{s.status}] {s.skill_id}.{s.operation} {s.latency_ms:.1f}ms")
