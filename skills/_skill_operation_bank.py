"""
_skill_operation_bank.py — Skill Usage Tracking with EMA

Tracks which skills are used, how recently, and with what success rate.
Uses Exponential Moving Average (EMA) to balance exploration/exploitation —
recently-used skills get boosted, unused skills decay, making room for new skills.

Inspired by ViktorAxelsen/MemSkill's Operation Bank pattern.

Usage:
    from skills._skill_operation_bank import SkillOpBank

    bank = SkillOpBank()

    # Record a skill invocation
    bank.record(skill_id="invest", success=True, latency_ms=1200)

    # Record a failure
    bank.record(skill_id="invest", success=False)

    # Get skills sorted by exploration score (for routing decisions)
    top = bank.top_k(k=5)
    print(top)
"""

import json, time
from pathlib import Path
from dataclasses import dataclass, asdict, field
from datetime import datetime, timezone
from typing import Optional

WORKSPACE = Path("C:/Users/Administrator/.openclaw/workspace")
OPBANK_FILE = WORKSPACE / "memory" / "_skill_opbank.json"

# EMA decay factor — higher = more weight on recent
# e.g., EMA_HALF_LIFE=10 means usage 10 calls ago contributes half
EMA_HALF_LIFE = 10
MIN_USAGE_FOR_REWARD = 3  # only compute avg_reward after this many uses


@dataclass
class SkillOp:
    skill_id: str
    usage_count: int = 0
    success_count: int = 0
    failure_count: int = 0
    total_latency_ms: float = 0.0
    last_used: Optional[str] = None          # ISO-8601 UTC
    last_success: Optional[str] = None
    last_failure: Optional[str] = None
    # EMA of recent usage frequency (higher = more recently used)
    usage_ema: float = 0.0
    # EMA of success rate [0..1]
    success_ema: float = 0.5
    # Exploration score: combination of recency + success + usage
    # Higher = more preferred for routing
    exploration_score: float = 0.0
    tags: list[str] = field(default_factory=list)  # e.g. ["finance", "web", "memory"]


class SkillOpBank:
    """
    Tracks skill invocations and computes an exploration score
    for dynamic skill routing.
    """

    def __init__(self, decay: float = 0.9):
        """
        Args:
            decay: EMA decay factor (0 < decay < 1).
                   Higher = more weight on most recent usage.
                   Default 0.9 means each usage step multiplies by decay.
        """
        self._decay = decay
        self._ops: dict[str, SkillOp] = {}
        self._load()

    # ── Persistence ─────────────────────────────────────────────────────────

    def _load(self) -> None:
        if OPBANK_FILE.exists():
            try:
                data = json.loads(OPBANK_FILE.read_text(encoding="utf-8"))
                self._ops = {k: SkillOp(**v) for k, v in data.get("ops", {}).items()}
            except Exception:
                self._ops = {}

    def save(self) -> None:
        OPBANK_FILE.parent.mkdir(parents=True, exist_ok=True)
        data = {"ops": {k: asdict(v) for k, v in self._ops.items()}}
        OPBANK_FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")

    # ── Recording ──────────────────────────────────────────────────────────

    def record(
        self,
        skill_id: str,
        success: bool,
        latency_ms: float = 0.0,
        tags: list[str] = None,
    ) -> None:
        """
        Record a single invocation of a skill.

        Updates usage_ema (exponential decay on non-selected),
        success_ema, and exploration_score.
        """
        now = datetime.now(timezone.utc).isoformat()

        if skill_id not in self._ops:
            self._ops[skill_id] = SkillOp(skill_id=skill_id, tags=tags or [])

        op = self._ops[skill_id]
        op.usage_count += 1
        op.total_latency_ms += latency_ms
        op.last_used = now

        if success:
            op.success_count += 1
            op.last_success = now
        else:
            op.failure_count += 1
            op.last_failure = now

        if tags:
            op.tags = list(set(op.tags) | set(tags))

        # Update EMAs
        alpha = 1 - self._decay  # smoothing factor

        # usage_ema: decay all ops, then boost this one
        # (called each time any skill is recorded)
        self._decay_all_ema()

        # usage_ema for this skill: +1 contribution
        op.usage_ema = op.usage_ema + alpha * (1.0 - op.usage_ema)

        # success_ema: exponential moving average
        op.success_ema = op.success_ema + alpha * (float(success) - op.success_ema)

        # exploration_score: composite of recency × success × frequency
        recency_factor = op.usage_ema  # 0..1 (0=never used recently, 1=just used)
        success_factor = op.success_ema  # 0..1
        frequency_factor = min(1.0, op.usage_count / 20)  # caps at 20 uses
        op.exploration_score = recency_factor * success_factor * (0.5 + 0.5 * frequency_factor)

        self.save()

    def _decay_all_ema(self) -> None:
        """Decay usage_ema for all ops (called each time any skill is recorded)."""
        for op in self._ops.values():
            op.usage_ema *= self._decay

    # ── Queries ─────────────────────────────────────────────────────────────

    def top_k(self, k: int = 5, min_success_rate: float = 0.0) -> list[tuple[str, float, float]]:
        """
        Return top k skills by exploration_score.

        Returns: [(skill_id, exploration_score, success_rate), ...]
        """
        ops = [
            op for op in self._ops.values()
            if op.usage_count > 0 and (op.success_count / op.usage_count) >= min_success_rate
        ]
        ops.sort(key=lambda op: op.exploration_score, reverse=True)
        return [
            (op.skill_id, round(op.exploration_score, 4), round(op.success_ema, 3))
            for op in ops[:k]
        ]

    def get(self, skill_id: str) -> Optional[SkillOp]:
        return self._ops.get(skill_id)

    def stats(self) -> dict:
        """Return summary statistics."""
        ops = list(self._ops.values())
        if not ops:
            return {"total_skills": 0, "total_invocations": 0, "avg_success_rate": 0.0}
        total = sum(o.usage_count for o in ops)
        avg_s = sum(o.success_ema for o in ops) / len(ops)
        return {
            "total_skills": len(ops),
            "total_invocations": total,
            "avg_success_rate": round(avg_s, 3),
            "top_5": self.top_k(5),
        }

    # ── Cleanup ────────────────────────────────────────────────────────────

    def prune(self, max_ops: int = 200) -> int:
        """
        Remove lowest-exploration-score ops if bank exceeds max_ops.
        Returns number of ops removed.
        """
        if len(self._ops) <= max_ops:
            return 0
        # Sort by exploration_score ascending, drop bottom N
        sorted_ops = sorted(self._ops.items(), key=lambda kv: kv[1].exploration_score)
        to_remove = sorted_ops[: len(self._ops) - max_ops]
        for skill_id, _ in to_remove:
            del self._ops[skill_id]
        self.save()
        return len(to_remove)


if __name__ == "__main__":
    # Smoke test
    bank = SkillOpBank()

    print("Initial:", bank.stats())

    bank.record("invest", success=True, latency_ms=500)
    bank.record("invest", success=True, latency_ms=600)
    bank.record("invest", success=False)
    bank.record("cone-memory", success=True, latency_ms=300)
    bank.record("web-scraping", success=True, latency_ms=1000)

    print("After invocations:", bank.stats())
    print("Top 3:", bank.top_k(3))

    op = bank.get("invest")
    print(f"invest: count={op.usage_count}, success={op.success_ema:.2f}, "
          f"exploration={op.exploration_score:.4f}")
