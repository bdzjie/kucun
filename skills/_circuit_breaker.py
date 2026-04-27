"""
_circuit_breaker.py — Per-Skill Circuit Breaker

Prevents cascading failures: if a skill fails too many times,
it temporarily opens (disables) and falls back to an alternate skill.

Usage:
    from skills._circuit_breaker import CircuitBreakerStore, SOFT, HARD, SKIP

    store = CircuitBreakerStore()

    # Check if skill is available
    result = store.call("invest", lambda: run_invest(args))
    if result.status == OPEN:
        # fallback triggered automatically

    # Or manually:
    cb = store.get("invest")
    print(cb.failure_rate, cb.state)

Degradation levels:
    SOFT  = skill returned empty/error, keep it enabled but log warning
    HARD  = skill failed completely, next call goes to fallback
    SKIP  = circuit fully open, always use fallback immediately
"""

import json, time
from pathlib import Path
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from enum import Enum

WORKSPACE = Path("C:/Users/Administrator/.openclaw/workspace")
CB_FILE = WORKSPACE / "memory" / "_circuit_breakers.json"

# Thresholds
DEFAULT_FAILURE_THRESHOLD = 3     # failures before HALF-OPEN
DEFAULT_TIMEOUT_SECONDS = 60     # seconds before trying again (HALF-OPEN)
DEFAULT_RATE_WINDOW = 300        # seconds for failure rate calculation


class DegradationLevel(Enum):
    SOFT = "soft"   # degraded but still enabled
    HARD = "hard"   # fallback recommended
    SKIP = "skip"   # always fallback


class CircuitState(Enum):
    CLOSED = "closed"    # normal operation
    HALF_OPEN = "half_open"  # testing if skill recovered
    OPEN = "open"        # blocked, fallback active


@dataclass
class CircuitBreaker:
    skill_id: str
    state: str = "closed"
    failure_count: int = 0
    success_count: int = 0
    last_failure: str = ""       # ISO-8601
    last_success: str = ""       # ISO-UTC
    last_failure_count_reset: str = ""  # ISO-8601, when failure count was last reset
    consecutive_failures: int = 0  # reset to 0 on any success
    failure_rate: float = 0.0      # failures / (failures + successes) in window
    failure_timestamps: list = None  # list of failure times (for rate calc)
    timeout_started: str = ""       # ISO-8601 when OPEN state began

    def __post_init__(self):
        if self.failure_timestamps is None:
            self.failure_timestamps = []

    @property
    def degradation(self) -> DegradationLevel:
        if self.state == "open":
            return DegradationLevel.SKIP
        elif self.consecutive_failures >= 2:
            return DegradationLevel.HARD
        elif self.consecutive_failures >= 1:
            return DegradationLevel.SOFT
        return DegradationLevel.SOFT


class CircuitBreakerStore:
    """
    Per-skill circuit breakers with automatic state transitions.
    """

    def __init__(
        self,
        failure_threshold: int = DEFAULT_FAILURE_THRESHOLD,
        timeout_seconds: int = DEFAULT_TIMEOUT_SECONDS,
        rate_window: int = DEFAULT_RATE_WINDOW,
    ):
        self._failure_threshold = failure_threshold
        self._timeout_seconds = timeout_seconds
        self._rate_window = rate_window
        self._breakers: dict[str, CircuitBreaker] = {}
        self._load()

    # ── Persistence ─────────────────────────────────────────────────────────

    def _load(self) -> None:
        if not CB_FILE.exists():
            return
        try:
            data = json.loads(CB_FILE.read_text(encoding="utf-8"))
            self._breakers = {
                k: CircuitBreaker(**v) for k, v in data.get("breakers", {}).items()
            }
        except Exception:
            self._breakers = {}

    def save(self) -> None:
        CB_FILE.parent.mkdir(parents=True, exist_ok=True)
        data = {"breakers": {k: asdict(v) for k, v in self._breakers.items()}}
        CB_FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")

    # ── Core API ─────────────────────────────────────────────────────────────

    def get(self, skill_id: str) -> CircuitBreaker:
        if skill_id not in self._breakers:
            self._breakers[skill_id] = CircuitBreaker(skill_id=skill_id)
        return self._breakers[skill_id]

    def is_open(self, skill_id: str) -> bool:
        """True if circuit is OPEN (fallback recommended)."""
        cb = self.get(skill_id)
        if cb.state == "closed":
            return False
        if cb.state == "open":
            # Check timeout
            if cb.timeout_started:
                opened_at = datetime.fromisoformat(cb.timeout_started.replace("Z", "+00:00"))
                if (datetime.now(timezone.utc) - opened_at).total_seconds() >= self._timeout_seconds:
                    # Transition to HALF-OPEN
                    cb.state = "half_open"
                    cb.failure_count = 0
                    cb.consecutive_failures = 0
                    cb.timeout_started = ""
                    self.save()
                    return False  # allow one test call
            return True
        return False  # half_open = allow through

    def record_success(self, skill_id: str) -> None:
        """Record a successful invocation."""
        cb = self.get(skill_id)
        now = datetime.now(timezone.utc).isoformat()
        cb.success_count += 1
        cb.last_success = now
        cb.consecutive_failures = 0
        if cb.state == "half_open":
            # Recovered!
            cb.state = "closed"
            cb.failure_count = 0
        self._prune_old_failures(cb)
        cb.failure_rate = cb.failure_count / max(cb.failure_count + cb.success_count, 1)
        self.save()

    def record_failure(self, skill_id: str) -> CircuitState:
        """Record a failed invocation. Returns the new state."""
        cb = self.get(skill_id)
        now = datetime.now(timezone.utc).isoformat()
        cb.last_failure = now
        cb.consecutive_failures += 1
        cb.failure_count += 1
        cb.failure_timestamps.append(now)

        self._prune_old_failures(cb)

        if cb.state == "half_open":
            # Still failing → re-open
            cb.state = "open"
            cb.timeout_started = now
        elif cb.consecutive_failures >= self._failure_threshold:
            cb.state = "open"
            cb.timeout_started = now

        cb.failure_rate = cb.failure_count / max(cb.failure_count + cb.success_count, 1)
        self.save()
        return CircuitState(cb.state)

    def _prune_old_failures(self, cb: CircuitBreaker) -> None:
        """Remove failures outside the rate window."""
        cutoff = datetime.now(timezone.utc).timestamp() - self._rate_window
        cb.failure_timestamps = [
            t for t in cb.failure_timestamps
            if datetime.fromisoformat(t.replace("Z", "+00:00")).timestamp() >= cutoff
        ]
        # Recompute failure_count from pruned list
        cb.failure_count = len(cb.failure_timestamps)

    # ── Call wrapper ─────────────────────────────────────────────────────────

    def call(
        self,
        skill_id: str,
        fn,
        fallback_fn=None,
        record_latency_ms: float = 0.0,
    ) -> "CallResult":
        """
        Execute fn with circuit breaker protection.

        Args:
            skill_id: which skill is being called
            fn: callable to execute
            fallback_fn: callable to use if circuit is open
            record_latency_ms: pass through for telemetry

        Returns CallResult(status, value, used_fallback)
        """
        from skills._skill_operation_bank import SkillOpBank
        bank = SkillOpBank()

        if self.is_open(skill_id):
            if fallback_fn:
                try:
                    result = fallback_fn()
                    self.record_success(skill_id)
                    bank.record(skill_id, success=True, latency_ms=record_latency_ms)
                    return CallResult(status=CircuitState.OPEN, value=result, used_fallback=True)
                except Exception as e:
                    bank.record(skill_id, success=False, latency_ms=record_latency_ms)
                    return CallResult(status=CircuitState.OPEN, value=e, used_fallback=True)
            return CallResult(status=CircuitState.OPEN, value=None, used_fallback=True)

        try:
            result = fn()
            self.record_success(skill_id)
            bank.record(skill_id, success=True, latency_ms=record_latency_ms)
            return CallResult(status=CircuitState.CLOSED, value=result, used_fallback=False)
        except Exception as e:
            new_state = self.record_failure(skill_id)
            bank.record(skill_id, success=False, latency_ms=record_latency_ms)
            if fallback_fn and new_state == CircuitState.OPEN:
                try:
                    fb_result = fallback_fn()
                    return CallResult(status=new_state, value=fb_result, used_fallback=True)
                except Exception:
                    return CallResult(status=new_state, value=e, used_fallback=True)
            return CallResult(status=new_state, value=e, used_fallback=False)

    # ── Stats ────────────────────────────────────────────────────────────────

    def stats(self) -> dict:
        """Summary of all breakers."""
        return {
            skill_id: {
                "state": cb.state,
                "consecutive_failures": cb.consecutive_failures,
                "failure_rate": round(cb.failure_rate, 3),
                "degradation": cb.degradation.value,
            }
            for skill_id, cb in self._breakers.items()
            if cb.failure_count > 0 or cb.success_count > 0
        }

    def reset(self, skill_id: str) -> None:
        """Manually reset a breaker to closed state."""
        cb = self.get(skill_id)
        cb.state = "closed"
        cb.failure_count = 0
        cb.consecutive_failures = 0
        cb.failure_timestamps = []
        cb.timeout_started = ""
        cb.failure_rate = 0.0
        self.save()


@dataclass
class CallResult:
    status: CircuitState
    value: any
    used_fallback: bool


# ── CLI ─────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import sys

    store = CircuitBreakerStore()

    if len(sys.argv) > 1 and sys.argv[1] == "--stats":
        import json
        print(json.dumps(store.stats(), indent=2))
    elif len(sys.argv) > 1 and sys.argv[1] == "--reset":
        if len(sys.argv) > 2:
            store.reset(sys.argv[2])
            print(f"Reset {sys.argv[2]}")
        else:
            print("Usage: python _circuit_breaker.py --reset <skill_id>")
    else:
        # Smoke test
        results = []
        def good(): return "ok"
        def bad(): raise RuntimeError("fail")

        for i in range(5):
            r = store.call(f"test-skill-{i % 2}", good if i % 2 == 0 else bad)
            results.append((i, r.status.value, r.used_fallback))
            print(f"call {i}: state={r.status.value}, fallback={r.used_fallback}")

        print("\nStats:", store.stats())
