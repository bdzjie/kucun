"""
_skill_chain.py — Skill Composition / Chaining DSL

Enables declarative multi-step skill workflows: A → B → C → ...

Design goals:
  - Declarative: chain = skill("invest") | skill("web-scraping") | skill("report")
  - Error recovery: mid-chain failure triggers fallback to alternate skill
  - Partial results: allow_partial=True lets downstream skills use partial outputs
  - Context passing: each skill receives the previous skill's output as context

Usage:
    from skills._skill_chain import SkillChain, SkillChainResult

    # Build a chain:
    chain = SkillChain()
    chain.then("web-scraping", params={"topic": "AAPL news"})
    chain.then("invest", params={"mode": "sentiment", "news": "PREVIOUS_OUTPUT"})
    chain.then("report", params={"format": "markdown"})

    result = chain.execute(allow_partial=True)
    print(result.final_output)
    print(result.steps_completed)   # ["web-scraping", "invest", "report"]
    print(result.errors)            # any errors encountered

    # Pipe syntax:
    from skills._skill_chain import skill

    report_chain = skill("web-scraping") | skill("invest") | skill("report")

    # Error recovery:
    chain.with_fallback("web-scraping", fallback="web-search")

CLI:
    python skills/_skill_chain.py --run invest news AAPL
    python skills/_skill_chain.py --define invest news AAPL
"""

import json
import re
import sys
import time
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any, Callable, Optional

WORKSPACE = Path("C:/Users/Administrator/.openclaw/workspace")
CHAIN_LOG = WORKSPACE / "memory" / "_chain_log.jsonl"


class ChainStatus(Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    PARTIAL = "partial"   # completed with some steps failed
    FAILED = "failed"


@dataclass
class ChainStepResult:
    skill_id: str
    status: str           # ok | error | skipped
    output: Any = None
    error_type: str = ""
    error_msg: str = ""
    latency_ms: float = 0.0
    started_at: str = ""
    ended_at: str = ""


@dataclass
class SkillChainResult:
    chain_id: str
    skill_chain: list[str]           # ordered list of skill_ids
    status: str                      # COMPLETED | PARTIAL | FAILED
    steps: list[ChainStepResult]
    final_output: Any = None
    errors: list[dict] = field(default_factory=list)
    started_at: str = ""
    ended_at: str = ""
    total_latency_ms: float = 0.0
    allow_partial: bool = False

    def to_dict(self) -> dict:
        return asdict(self)

    @property
    def steps_completed(self) -> list[str]:
        return [s.skill_id for s in self.steps if s.status == "ok"]

    @property
    def steps_failed(self) -> list[str]:
        return [s.skill_id for s in self.steps if s.status == "error"]


class SkillChain:
    """
    Declarative skill chaining with error recovery and partial results.

    Usage:
        chain = SkillChain(allow_partial=True)
        chain.then("web-scraping", params={"topic": "AAPL"})
        chain.then("invest", params={"news": "PREVIOUS_OUTPUT"})
        result = chain.execute()
    """

    def __init__(self, allow_partial: bool = False, chain_id: str = ""):
        self.chain_id = chain_id or f"chain_{int(time.time())}"
        self._steps: list[dict] = []   # [{skill_id, params, fallback_skill_id}]
        self.allow_partial = allow_partial
        self._fallbacks: dict[str, str] = {}

    def then(self, skill_id: str, params: dict = None, fallback: str = None) -> "SkillChain":
        """Append a step to the chain."""
        self._steps.append({
            "skill_id": skill_id,
            "params": params or {},
            "fallback": fallback,
        })
        if fallback:
            self._fallbacks[skill_id] = fallback
        return self

    def with_fallback(self, skill_id: str, fallback: str) -> "SkillChain":
        """Register a fallback skill for a specific step."""
        self._fallbacks[skill_id] = fallback
        return self

    def execute(self, initial_context: Any = None) -> SkillChainResult:
        """
        Execute the chain steps in order.
        Each step receives the previous step's output as context.
        """
        started_at = datetime.now(timezone.utc).isoformat()
        results: list[ChainStepResult] = []
        prev_output = initial_context
        status = ChainStatus.PENDING
        errors = []

        for step_def in self._steps:
            skill_id = step_def["skill_id"]
            params = dict(step_def["params"])

            # Inject previous output where indicated
            for key, val in params.items():
                if val == "PREVIOUS_OUTPUT":
                    params[key] = prev_output

            step_result = self._run_step(skill_id, params)
            results.append(step_result)

            if step_result.status == "ok":
                prev_output = step_result.output
            elif step_result.status == "error":
                errors.append({
                    "step": skill_id,
                    "error": step_result.error_msg,
                })
                fallback_skill = self._fallbacks.get(skill_id)
                if fallback_skill:
                    # Try fallback instead
                    fb_result = self._run_step(fallback_skill, params)
                    results[-1] = fb_result
                    if fb_result.status == "ok":
                        prev_output = fb_result.output
                        errors.pop()  # fallback succeeded, remove error
                elif not self.allow_partial:
                    status = ChainStatus.FAILED
                    break
                else:
                    status = ChainStatus.PARTIAL

        # Determine overall status
        if status == ChainStatus.PENDING:
            if all(r.status == "ok" for r in results):
                status = ChainStatus.COMPLETED
            elif any(r.status == "ok" for r in results):
                status = ChainStatus.PARTIAL
            else:
                status = ChainStatus.FAILED

        ended_at = datetime.now(timezone.utc).isoformat()
        total_latency = sum(r.latency_ms for r in results)

        result = SkillChainResult(
            chain_id=self.chain_id,
            skill_chain=[s["skill_id"] for s in self._steps],
            status=status.value,
            steps=results,
            final_output=prev_output if status != ChainStatus.FAILED else None,
            errors=errors,
            started_at=started_at,
            ended_at=ended_at,
            total_latency_ms=total_latency,
            allow_partial=self.allow_partial,
        )

        _log_chain_result(result)
        return result

    def _run_step(self, skill_id: str, params: dict) -> ChainStepResult:
        """Run a single skill step (mock implementation)."""
        started_at = datetime.now(timezone.utc).isoformat()
        start = time.perf_counter()

        try:
            output = _execute_skill_mock(skill_id, params)
            latency_ms = (time.perf_counter() - start) * 1000
            return ChainStepResult(
                skill_id=skill_id,
                status="ok",
                output=output,
                latency_ms=latency_ms,
                started_at=started_at,
                ended_at=datetime.now(timezone.utc).isoformat(),
            )
        except Exception as e:
            latency_ms = (time.perf_counter() - start) * 1000
            return ChainStepResult(
                skill_id=skill_id,
                status="error",
                error_type=type(e).__name__,
                error_msg=str(e)[:200],
                latency_ms=latency_ms,
                started_at=started_at,
                ended_at=datetime.now(timezone.utc).isoformat(),
            )


def _execute_skill_mock(skill_id: str, params: dict) -> str:
    """
    Mock skill execution for testing.
    In production, this calls the actual skill handler.
    """
    if skill_id == "invest":
        return f"Invest analysis complete for: {params.get('symbol', 'UNKNOWN')}"
    elif skill_id == "web-scraping":
        return f"Scraped content about: {params.get('topic', 'UNKNOWN')}"
    elif skill_id == "report":
        return f"Report generated: {params.get('format', 'markdown')}"
    elif skill_id == "web-search":
        return f"Search results for: {params.get('query', 'UNKNOWN')}"
    else:
        return f"Output from {skill_id}"


# ── Pipe operator ─────────────────────────────────────────────────────────

class _SkillStep:
    """Represents a single step in a pipe chain."""
    def __init__(self, skill_id: str, params: dict = None, fallback: str = None):
        self.skill_id = skill_id
        self.params = params or {}
        self.fallback = fallback


class skill:
    """
    Pipe-compatible skill constructor for chain syntax.

    Usage:
        chain = skill("invest") | skill("web-scraping") | skill("report")
    """
    def __init__(self, skill_id: str, params: dict = None, fallback: str = None):
        self._step = _SkillStep(skill_id, params, fallback)

    def __or__(self, other) -> "skill":
        """Enables: skill("A") | skill("B")"""
        if isinstance(other, skill):
            return _ChainedSkill(self._step, other._step)
        return NotImplemented

    def then(self, skill_id: str, params: dict = None, fallback: str = None) -> "skill":
        """Add a step after this one."""
        return skill(self.skill_id).then(skill_id, params, fallback)


class _ChainedSkill:
    def __init__(self, *steps: _SkillStep):
        self._steps = list(steps)

    def __or__(self, other) -> "_ChainedSkill":
        if isinstance(other, skill):
            self._steps.append(other._step)
            return self
        return NotImplemented

    def execute(self, **kwargs) -> SkillChainResult:
        chain = SkillChain(**kwargs)
        for step in self._steps:
            chain.then(step.skill_id, step.params, step.fallback)
        return chain.execute()


# ── CLI ─────────────────────────────────────────────────────────────────────

def _run_chain_from_args(args: list[str]) -> SkillChainResult:
    """Build and run a chain from CLI arguments: skill1 skill2 skill3 ..."""
    chain = SkillChain(allow_partial=True)
    for skill_id in args:
        chain.then(skill_id)
    return chain.execute()


def _log_chain_result(result: SkillChainResult) -> None:
    CHAIN_LOG.parent.mkdir(parents=True, exist_ok=True)
    try:
        with open(str(CHAIN_LOG), "a", encoding="utf-8") as f:
            f.write(json.dumps(result.to_dict(), ensure_ascii=False) + "\n")
    except Exception:
        pass


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--run":
        skills = sys.argv[2:] if len(sys.argv) > 2 else ["invest", "web-scraping"]
        result = _run_chain_from_args(skills)
        print(f"Chain: {' -> '.join(result.skill_chain)}")
        print(f"Status: {result.status}")
        print(f"Completed: {result.steps_completed}")
        print(f"Failed: {result.steps_failed}")
        print(f"Total latency: {result.total_latency_ms:.0f}ms")
        if result.errors:
            print(f"Errors: {result.errors}")
        print(f"Final output: {str(result.final_output)[:100]}")

    elif len(sys.argv) > 1 and sys.argv[1] == "--define":
        print("Defining skills:")
        print("  skill('invest') | skill('web-scraping') | skill('report')")

    else:
        # Built-in test
        print("SkillChain smoke test:")
        chain = SkillChain(allow_partial=True)
        chain.then("web-scraping", params={"topic": "AI stocks"})
        chain.then("invest", params={"news": "PREVIOUS_OUTPUT"})
        result = chain.execute()
        print(f"  Status: {result.status}")
        print(f"  Completed steps: {result.steps_completed}")
        print(f"  Final output: {str(result.final_output)[:80]}")
        print(f"  Latency: {result.total_latency_ms:.1f}ms")
        print("  PASS" if result.status in ("completed", "partial") else "  FAIL")
