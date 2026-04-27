"""
_event_bus.py — Lightweight In-Memory Event Bus for Inter-Skill Coordination

No MQ infrastructure. Pure Python pub/sub with SQLite persistence for replay.

Event types:
    skill_started(skill_id)
    skill_completed(skill_id, result_summary, latency_ms)
    skill_failed(skill_id, error_type, error_msg)
    memory_updated(episodic_summary)
    routing_decision(expert, skills, confidence)
    circuit_opened(skill_id, fallback)

Usage:
    from skills._event_bus import EventBus, emit, on

    bus = EventBus()

    # Subscribe
    def my_handler(event):
        print(f"Skill {event['skill_id']} finished!")

    bus.subscribe("skill_completed", my_handler)

    # Emit
    emit("skill_completed", skill_id="invest", result_summary="AAPL quote", latency_ms=1200)

    # Canvas SSE: already has polling on memory_query_state.json
    # Can upgrade to: SSE on /__openclaw__/canvas/event-bus stream
"""

import json, time, threading
from pathlib import Path
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from typing import Callable, Optional
from collections import defaultdict

WORKSPACE = Path("C:/Users/Administrator/.openclaw/workspace")
EVENT_LOG = WORKSPACE / "memory" / "_event_log.jsonl"


# ── Event Types ───────────────────────────────────────────────────────────────

EVENT_TYPES = [
    "skill_started",
    "skill_completed",
    "skill_failed",
    "memory_updated",
    "routing_decision",
    "circuit_opened",
    "session_snapshot_saved",
    "compaction_triggered",
]


# ── Event dataclass ─────────────────────────────────────────────────────────

@dataclass
class Event:
    id: int          # monotonically increasing
    type: str        # one of EVENT_TYPES
    data: dict       # arbitrary payload
    timestamp: str   # ISO-8601 UTC
    session_id: str = "default"


# ── EventBus ────────────────────────────────────────────────────────────────

class EventBus:
    """
    Thread-safe in-memory pub/sub with optional SQLite persistence.
    Subscribers are called synchronously in the emitting thread.
    """

    def __init__(self, persist: bool = True):
        self._subscribers: dict[str, list[Callable]] = defaultdict(list)
        self._lock = threading.RLock()
        self._next_id = 1
        self._event_log_path = EVENT_LOG if persist else None
        self._log_buffer: list[str] = []
        self._session_id = "default"

        if self._event_log_path:
            self._event_log_path.parent.mkdir(parents=True, exist_ok=True)

    def set_session(self, session_id: str) -> None:
        self._session_id = session_id

    # ── Subscribe ─────────────────────────────────────────────────────────

    def subscribe(self, event_type: str, handler: Callable[[dict], None]) -> None:
        """Register a handler for an event type."""
        with self._lock:
            self._subscribers[event_type].append(handler)

    def unsubscribe(self, event_type: str, handler: Callable) -> None:
        """Remove a handler."""
        with self._lock:
            if handler in self._subscribers[event_type]:
                self._subscribers[event_type].remove(handler)

    # ── Emit ──────────────────────────────────────────────────────────────

    def emit(self, event_type: str, **data) -> Event:
        """
        Emit an event. All subscribers for event_type are called synchronously.
        Returns the Event object.
        """
        event = Event(
            id=self._next_id,
            type=event_type,
            data=data,
            timestamp=datetime.now(timezone.utc).isoformat(),
            session_id=self._session_id,
        )
        self._next_id += 1

        # Call subscribers (outside lock to avoid deadlock)
        handlers = []
        with self._lock:
            handlers = list(self._subscribers.get(event_type, []))

        for handler in handlers:
            try:
                handler(event.data)
            except Exception as e:
                # Never let subscriber error break the emitter
                pass

        # Persist to disk
        if self._event_log_path:
            self._log_event(event)

        return event

    def _log_event(self, event: Event) -> None:
        """Append event to JSONL log."""
        line = json.dumps(asdict(event), ensure_ascii=False)
        self._log_buffer.append(line)
        if len(self._log_buffer) >= 10:
            self._flush_log()

    def _flush_log(self) -> None:
        if self._log_buffer and self._event_log_path:
            with open(str(self._event_log_path), "a", encoding="utf-8") as f:
                f.write("\n".join(self._log_buffer) + "\n")
            self._log_buffer.clear()

    def flush(self) -> None:
        """Force flush pending events to disk."""
        with self._lock:
            self._flush_log()

    # ── Query ─────────────────────────────────────────────────────────────

    def recent(self, event_type: Optional[str] = None, limit: int = 50) -> list[Event]:
        """Read recent events from log file (for replay/recovery)."""
        if not self._event_log_path or not self._event_log_path.exists():
            return []
        events = []
        try:
            lines = self._event_log_path.read_text(encoding="utf-8").strip().split("\n")
            for line in reversed(lines):
                if not line.strip():
                    continue
                try:
                    e = Event(**json.loads(line))
                    if event_type is None or e.type == event_type:
                        events.append(e)
                except Exception:
                    continue
                if len(events) >= limit:
                    break
        except Exception:
            pass
        return events

    def stats(self) -> dict:
        """Return event counts by type from log."""
        if not self._event_log_path or not self._event_log_path.exists():
            return {}
        counts = defaultdict(int)
        try:
            lines = self._event_log_path.read_text(encoding="utf-8").strip().split("\n")
            for line in lines:
                if not line.strip():
                    continue
                try:
                    e = json.loads(line)
                    counts[e.get("type", "?")] += 1
                except Exception:
                    pass
        except Exception:
            pass
        return dict(counts)


# ── Global instance ─────────────────────────────────────────────────────────

_bus: Optional[EventBus] = None


def get_bus() -> EventBus:
    global _bus
    if _bus is None:
        _bus = EventBus()
    return _bus


def emit(event_type: str, **data) -> Event:
    """Emit an event on the global bus."""
    return get_bus().emit(event_type, **data)


def on(event_type: str, handler: Callable[[dict], None]) -> None:
    """Subscribe to an event type on the global bus."""
    get_bus().subscribe(event_type, handler)


# ── Convenience emitters for skill integration ──────────────────────────────

def emit_skill_started(skill_id: str, **kwargs) -> Event:
    return emit("skill_started", skill_id=skill_id, **kwargs)


def emit_skill_completed(skill_id: str, result_summary: str = "", latency_ms: float = 0.0, **kwargs) -> Event:
    return emit("skill_completed", skill_id=skill_id, result_summary=result_summary, latency_ms=latency_ms, **kwargs)


def emit_skill_failed(skill_id: str, error_type: str = "", error_msg: str = "", **kwargs) -> Event:
    return emit("skill_failed", skill_id=skill_id, error_type=error_type, error_msg=error_msg, **kwargs)


def emit_circuit_opened(skill_id: str, fallback: str = "", **kwargs) -> Event:
    return emit("circuit_opened", skill_id=skill_id, fallback=fallback, **kwargs)


# ── CLI ─────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import sys

    bus = EventBus()

    # Test
    def log_skill(event):
        print(f"  [handler] skill event: {event}")

    bus.subscribe("skill_completed", log_skill)
    bus.subscribe("skill_failed", log_skill)
    bus.subscribe("circuit_opened", log_skill)

    emit_skill_started("invest")
    emit_skill_completed("invest", result_summary="AAPL quote $182.50", latency_ms=1200.0)
    emit_skill_failed("web-scraping", error_type="TimeoutError", error_msg="Request timed out")
    emit_circuit_opened("invest", fallback="web-scraping")

    bus.flush()

    print("\nEvent log stats:", bus.stats())
    print("Recent events:")
    for e in bus.recent(limit=5):
        print(f"  [{e.id}] {e.type}: {e.data}")

    if len(sys.argv) > 1 and sys.argv[1] == "--stats":
        print("\nAll-time event counts:")
        for t, c in bus.stats().items():
            print(f"  {t}: {c}")
