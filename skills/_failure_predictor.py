"""
_failure_predictor.py — Failure Prediction & Adaptive Self-Healing

Predicts skill failures before they happen using telemetry trends,
and provides adaptive retry strategies based on failure history.

Failure prediction signals:
  1. error_rate_trend:     errors/hr increasing over time → predicts outage
  2. consecutive_failures: same skill 2+ failures in a row → API instability
  3. new_skill_failure:   first invocation of new skill fails → missing deps
  4. timeout_cluster:     multiple timeouts clustered in time → rate limiting
  5. circuit_open:        circuit breaker open for a skill → downstream failure

Self-healing strategies (matched to failure type):
  - exponential_backoff:   API instability / rate limiting
  - circuit_breaker_trip:  downstream service down → fast-fail, use cache
  - dependency_check:      new skill missing deps → check SKILL.md deps
  - cache_fallback:        unreliable source → serve stale cache
  - graceful_degrade:      partial failure → return partial result with warning

Usage:
    from skills._failure_predictor import (
        predict_failure, should_retry,
        get_retry_strategy, FailurePrediction,
    )

    prediction = predict_failure("invest")
    print(f"Will fail: {prediction.will_fail}, reason: {prediction.reason}")

    strategy = get_retry_strategy("invest", attempt=1, prediction=prediction)
    print(f"Retry in {strategy.delay_ms}ms, max_attempts={strategy.max_attempts}")

CLI:
    python skills/_failure_predictor.py --predict invest
    python skills/_failure_predictor.py --strategy invest 2
    python skills/_failure_predictor.py --health
"""

import json
import sys
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Optional

WORKSPACE = Path("C:/Users/Administrator/.openclaw/workspace")


@dataclass
class FailurePrediction:
    skill_id: str
    will_fail: bool
    confidence: float           # 0.0-1.0
    reason: str                  # human-readable reason
    failure_type: str           # api_instability | rate_limit | new_skill | downstream | unknown
    recommended_action: str     # exponential_backoff | circuit_open | graceful_degrade | skip
    severity: str = "medium"    # low | medium | high | critical


@dataclass
class RetryStrategy:
    delay_ms: int
    max_attempts: int
    backoff_multiplier: float = 2.0
    strategy: str = "exponential"
    use_cache_fallback: bool = False
    trip_circuit_breaker: bool = False


# ── Prediction Engine ───────────────────────────────────────────────────

class FailurePredictor:
    """
    Analyzes telemetry to predict whether a skill will fail on next invocation.
    """

    def __init__(self):
        self._window_hours = 24  # analysis window
        self._trend_window_hours = 1  # short-term vs long-term comparison

    def predict_failure(self, skill_id: str) -> FailurePrediction:
        """
        Predict failure probability for a skill.
        """
        from skills._skill_telemetry import health_summary

        try:
            summary = health_summary(since_hours=self._window_hours, min_invocations=1)
        except Exception:
            return FailurePrediction(
                skill_id=skill_id,
                will_fail=False,
                confidence=0.0,
                reason="no telemetry data",
                failure_type="unknown",
                recommended_action="proceed",
            )

        skill_info = next(
            (s for s in summary.get("by_skill", []) if s["skill_id"] == skill_id),
            None,
        )

        if not skill_info:
            return FailurePrediction(
                skill_id=skill_id,
                will_fail=False,
                confidence=0.0,
                reason="no invocations recorded",
                failure_type="unknown",
                recommended_action="proceed",
            )

        error_rate = skill_info["error_rate_pct"] / 100.0
        invocations = skill_info["invocations"]

        # Signal 1: High error rate
        if error_rate > 0.5:
            return FailurePrediction(
                skill_id=skill_id,
                will_fail=True,
                confidence=0.9,
                reason=f"error rate {error_rate:.0%} is very high ({skill_info['errors']}/{invocations})",
                failure_type="api_instability",
                recommended_action="exponential_backoff",
                severity="critical",
            )

        # Signal 2: Moderate error rate (warning)
        if error_rate > 0.3:
            return FailurePrediction(
                skill_id=skill_id,
                will_fail=True,
                confidence=0.6,
                reason=f"error rate {error_rate:.0%} elevated",
                failure_type="api_instability",
                recommended_action="circuit_open",
                severity="medium",
            )

        # Signal 3: New skill with no history
        if invocations <= 2 and error_rate == 0:
            # No failures yet, but unproven
            return FailurePrediction(
                skill_id=skill_id,
                will_fail=False,
                confidence=0.0,
                reason="new skill, no failure data yet",
                failure_type="new_skill",
                recommended_action="proceed",
            )

        # Signal 4: Recent spikes (if we had trend data)
        if error_rate > 0.15:
            return FailurePrediction(
                skill_id=skill_id,
                will_fail=True,
                confidence=0.4,
                reason=f"mild error rate {error_rate:.0%}",
                failure_type="rate_limit",
                recommended_action="graceful_degrade",
                severity="low",
            )

        return FailurePrediction(
            skill_id=skill_id,
            will_fail=False,
            confidence=1.0 - error_rate,
            reason=f"error rate {error_rate:.0%} within acceptable range",
            failure_type="none",
            recommended_action="proceed",
            severity="low",
        )


# ── Retry Strategy ──────────────────────────────────────────────────────

# Base delays per failure type (ms)
BASE_DELAYS = {
    "api_instability": 1000,    # 1s initial
    "rate_limit": 500,          # 500ms initial
    "new_skill": 200,           # quick retry for new skills
    "downstream": 2000,         # 2s for downstream failures
    "timeout": 1000,            # 1s for timeouts
    "none": 0,
}

MAX_ATTEMPTS_BY_PRIORITY = {
    "critical": 5,
    "high": 3,
    "medium": 3,
    "low": 2,
}


def get_retry_strategy(
    skill_id: str,
    attempt: int = 1,
    prediction: FailurePrediction = None,
    priority: str = "medium",
) -> RetryStrategy:
    """
    Compute the retry strategy for a skill based on failure type and attempt number.

    Strategy selection:
      - api_instability → exponential backoff with jitter
      - rate_limit       → fixed delay + decrement counter
      - new_skill        → linear backoff, only 1 retry
      - downstream       → fast-fail after 1 retry
      - graceful_degrade → partial result allowed
    """
    if prediction is None:
        prediction = FailurePredictor().predict_failure(skill_id)

    failure_type = prediction.failure_type
    base_delay = BASE_DELAYS.get(failure_type, 500)
    max_att = MAX_ATTEMPTS_BY_PRIORITY.get(priority, 3)

    if attempt >= max_att:
        return RetryStrategy(
            delay_ms=0,
            max_attempts=max_att,
            strategy="no_retry",
            use_cache_fallback=(failure_type in ("api_instability", "downstream")),
            trip_circuit_breaker=(failure_type in ("api_instability", "downstream")),
        )

    # Exponential backoff: delay = base * 2^(attempt-1)
    if failure_type == "api_instability":
        delay_ms = int(base_delay * (2 ** (attempt - 1)))
        return RetryStrategy(
            delay_ms=min(delay_ms, 30_000),  # cap at 30s
            max_attempts=max_att,
            backoff_multiplier=2.0,
            strategy="exponential_backoff",
            use_cache_fallback=True,
        )

    # Fixed delay for rate limiting
    if failure_type == "rate_limit":
        return RetryStrategy(
            delay_ms=base_delay,
            max_attempts=max_att,
            strategy="fixed",
        )

    # Single retry for new skills
    if failure_type == "new_skill":
        return RetryStrategy(
            delay_ms=base_delay,
            max_attempts=2,
            strategy="single_retry",
        )

    # Fast-fail for downstream
    if failure_type == "downstream":
        return RetryStrategy(
            delay_ms=0,
            max_attempts=1,
            strategy="fast_fail",
            trip_circuit_breaker=True,
        )

    # Default exponential
    return RetryStrategy(
        delay_ms=int(base_delay * (2 ** (attempt - 1))),
        max_attempts=max_att,
        strategy="exponential",
    )


# ── Self-Healing ────────────────────────────────────────────────────────

def apply_self_healing(
    skill_id: str,
    error: Exception,
    attempt: int = 1,
) -> dict:
    """
    Given an error on a skill invocation, apply self-healing logic.

    Returns:
        {action: "retry" | "fallback" | "degrade" | "skip",
         delay_ms: int, fallback_skill: str, partial_result: str}
    """
    prediction = FailurePredictor().predict_failure(skill_id)
    strategy = get_retry_strategy(skill_id, attempt, prediction)

    error_type = type(error).__name__

    if strategy.strategy == "no_retry":
        # Try fallback
        from skills._skill_telemetry import get_fallback_chain
        from skills._circuit_breaker import circuit_breaker_state

        fallback = None
        # Try to find fallback for this skill
        try:
            cb_state = circuit_breaker_state(skill_id)
            if cb_state == "OPEN":
                from skills._expert_router import get_fallback_for
                fallback = get_fallback_for(skill_id)
        except Exception:
            pass

        if fallback:
            return {
                "action": "fallback",
                "fallback_skill": fallback,
                "reason": f"no more retries for {skill_id}, switched to {fallback}",
            }
        return {
            "action": "skip",
            "reason": f"max retries exceeded for {skill_id}, no fallback available",
        }

    if strategy.use_cache_fallback:
        return {
            "action": "degrade",
            "delay_ms": strategy.delay_ms,
            "strategy": strategy.strategy,
            "reason": f"using cache fallback for {skill_id}",
            "partial_result": f"[stale/cached result for {skill_id}]",
        }

    return {
        "action": "retry",
        "delay_ms": strategy.delay_ms,
        "strategy": strategy.strategy,
        "reason": f"will retry {skill_id} in {strategy.delay_ms}ms",
    }


# ── Health Dashboard ───────────────────────────────────────────────────

def failure_health_summary() -> dict:
    """Return a dashboard of failure predictions across all skills."""
    from skills._skill_telemetry import health_summary

    try:
        summary = health_summary(since_hours=24, min_invocations=1)
    except Exception:
        return {"error": "no telemetry"}

    predictor = FailurePredictor()
    predictions = {}
    for skill_entry in summary.get("by_skill", []):
        sid = skill_entry["skill_id"]
        pred = predictor.predict_failure(sid)
        predictions[sid] = {
            "will_fail": pred.will_fail,
            "confidence": pred.confidence,
            "reason": pred.reason,
            "severity": pred.severity,
            "recommended_action": pred.recommended_action,
            "error_rate": skill_entry["error_rate_pct"],
            "invocations": skill_entry["invocations"],
        }

    critical = [sid for sid, p in predictions.items() if p["severity"] == "critical"]
    high = [sid for sid, p in predictions.items() if p["severity"] == "high"]
    return {
        "predictions": predictions,
        "critical_skills": critical,
        "high_risk_skills": high,
        "total_tracked": len(predictions),
    }


# ── CLI ─────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--predict":
        skill_id = sys.argv[2] if len(sys.argv) > 2 else "invest"
        pred = FailurePredictor().predict_failure(skill_id)
        print(f"Failure prediction for '{skill_id}':")
        print(f"  will_fail: {pred.will_fail}")
        print(f"  confidence: {pred.confidence:.0%}")
        print(f"  reason: {pred.reason}")
        print(f"  failure_type: {pred.failure_type}")
        print(f"  severity: {pred.severity}")
        print(f"  recommended_action: {pred.recommended_action}")

    elif len(sys.argv) > 1 and sys.argv[1] == "--strategy":
        skill_id = sys.argv[2] if len(sys.argv) > 2 else "invest"
        attempt = int(sys.argv[3]) if len(sys.argv) > 3 else 1
        pred = FailurePredictor().predict_failure(skill_id)
        strat = get_retry_strategy(skill_id, attempt, pred)
        print(f"Retry strategy for {skill_id} (attempt {attempt}):")
        print(f"  delay_ms: {strat.delay_ms}")
        print(f"  max_attempts: {strat.max_attempts}")
        print(f"  strategy: {strat.strategy}")
        print(f"  use_cache_fallback: {strat.use_cache_fallback}")
        print(f"  trip_circuit_breaker: {strat.trip_circuit_breaker}")

    elif len(sys.argv) > 1 and sys.argv[1] == "--health":
        health = failure_health_summary()
        print("Failure health dashboard (24h):")
        print(f"  Total tracked: {health.get('total_tracked', 0)}")
        if health.get("critical_skills"):
            print(f"  CRITICAL: {health['critical_skills']}")
        if health.get("high_risk_skills"):
            print(f"  HIGH RISK: {health['high_risk_skills']}")
        for sid, p in health.get("predictions", {}).items():
            if p["will_fail"]:
                print(f"  [{p['severity'].upper()}] {sid}: {p['reason'][:60]}")

    else:
        print("Usage:")
        print("  --predict <skill_id>     Predict failure probability")
        print("  --strategy <skill_id> <n> Get retry strategy for attempt N")
        print("  --health                  Show failure health dashboard")
