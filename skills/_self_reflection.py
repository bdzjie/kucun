"""
_self_reflection.py — Self-Reflection Loop for Skill Failure Analysis

Triggered when a skill fails or returns poor results.
Stores reflection in a reflexion buffer for future retrieval.

Based on Reflexion pattern (Shinn et al.):
  - Verbal self-reflection: "what went wrong and why"
  - Stored as episodic memory with failure flag
  - Retrieved when similar task patterns are encountered

Usage:
    from skills._self_reflection import SelfReflector, reflect_on_failure

    reflector = SelfReflector()

    # After a skill failure:
    result = reflect_on_failure(
        skill_id="invest",
        task="Get AAPL quote",
        error="API timeout",
        context={"mode": "quote", "symbol": "AAPL"},
    )
    print(result["reflection"])  # verbalized self-analysis

    # When starting a new task, check for relevant past failures:
    past_failures = reflector.retrieve_similar("invest", "Get AAPL quote")
    if past_failures:
        print(f"Warning: similar task failed before: {past_failures[0]['reflection']}")

CLI:
    python skills/_self_reflection.py --reflect invest "Get AAPL quote" "API timeout"
    python skills/_self_reflection.py --recall invest "Get quote"
    python skills/_self_reflection.py --stats
"""

import json, sys, re
from pathlib import Path
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from typing import Optional

WORKSPACE = Path("C:/Users/Administrator/.openclaw/workspace")
REFLEXION_FILE = WORKSPACE / "memory" / "_reflexion_buffer.jsonl"
REFLEXION_INDEX = WORKSPACE / "memory" / "_reflexion_index.json"

# Simple keyword overlap for similarity
STOPWORDS = set("the a an is are were was be been being have has had do does did "
                "will would could should may might can must shall".split())


def _keywords(text: str) -> set[str]:
    return set(re.findall(r'\w+', text.lower())) - STOPWORDS


def _keyword_overlap(a: str, b: str) -> float:
    """Jaccard-like overlap between two texts."""
    ka, kb = _keywords(a), _keywords(b)
    if not ka or not kb:
        return 0.0
    return len(ka & kb) / max(len(ka | kb), 1)


@dataclass
class ReflexionEntry:
    """A single reflection on a skill task outcome."""

    id: int
    skill_id: str
    task: str                    # what was attempted
    success: bool               # True if task succeeded
    reflection: str             # verbal self-analysis
    error_type: str = ""        # if success=False
    error_msg: str = ""
    context: dict = field(default_factory=dict)  # additional context
    timestamp: str = ""         # ISO-8601 UTC
    keywords: list[str] = field(default_factory=list)  # extracted keywords

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict) -> "ReflexionEntry":
        return cls(**d)


class SelfReflector:
    """
    Self-reflection loop: reflect on failures, store in buffer, retrieve on similar tasks.
    """

    def __init__(self):
        self._entries: list[ReflexionEntry] = []
        self._next_id = 1
        self._load()

    # ── Persistence ───────────────────────────────────────────────────────

    def _load(self) -> None:
        if not REFLEXION_FILE.exists():
            return
        try:
            lines = REFLEXION_FILE.read_text(encoding="utf-8").strip().split("\n")
            for line in lines:
                if not line.strip():
                    continue
                entry = ReflexionEntry(**json.loads(line))
                self._entries.append(entry)
                self._next_id = max(self._next_id, entry.id + 1)
        except Exception:
            self._entries = []

    def _save(self) -> None:
        REFLEXION_FILE.parent.mkdir(parents=True, exist_ok=True)
        with open(str(REFLEXION_FILE), "w", encoding="utf-8") as f:
            for entry in self._entries:
                f.write(json.dumps(entry.to_dict(), ensure_ascii=False) + "\n")

    # ── Core API ──────────────────────────────────────────────────────────

    def reflect(
        self,
        skill_id: str,
        task: str,
        success: bool,
        error_type: str = "",
        error_msg: str = "",
        context: dict = None,
    ) -> ReflexionEntry:
        """
        Generate a self-reflection and store it.
        Returns the ReflexionEntry with the reflection text.
        """
        now = datetime.now(timezone.utc).isoformat()
        kws = list(_keywords(task))[:20]  # cap keywords

        # Simple template-based reflection (no LLM call needed for baseline)
        if success:
            reflection = self._reflect_success(skill_id, task, context or {})
        else:
            reflection = self._reflect_failure(skill_id, task, error_type, error_msg, context or {})

        entry = ReflexionEntry(
            id=self._next_id,
            skill_id=skill_id,
            task=task,
            success=success,
            reflection=reflection,
            error_type=error_type,
            error_msg=error_msg,
            context=context or {},
            timestamp=now,
            keywords=kws,
        )
        self._next_id += 1
        self._entries.append(entry)
        self._save()
        return entry

    def _reflect_success(self, skill_id: str, task: str, context: dict) -> str:
        """Template-based success reflection."""
        return (f"Skill '{skill_id}' succeeded for task: {task}. "
                f"Mode used: {context.get('mode', 'default')}. "
                f"Key learning: standard execution path worked well.")

    def _reflect_failure(self, skill_id: str, task: str, error_type: str, error_msg: str, context: dict) -> str:
        """Template-based failure reflection."""
        suggestions = {
            "TimeoutError": "Timeout suggests the operation is slow. "
                             "Consider adding retry logic or using a faster alternative.",
            "APIError": "API error may indicate rate limiting or invalid input. "
                        "Check API key validity and input parameters.",
            "ValueError": "Input validation error. Ensure parameters are in correct format.",
            "ConnectionError": "Network connectivity issue. May be intermittent.",
            "PermissionError": "Access denied. Check credentials and permissions.",
        }
        suggestion = suggestions.get(error_type, "Analyze the error pattern and consider a different approach.")
        return (f"Skill '{skill_id}' failed on task: {task}. "
                f"Error: {error_type} — {error_msg}. "
                f"Suggestion: {suggestion}")

    def retrieve_similar(
        self,
        skill_id: str,
        task: str,
        max_results: int = 3,
        failure_only: bool = False,
    ) -> list[ReflexionEntry]:
        """
        Retrieve past reflections with similar task keywords.
        """
        if failure_only:
            entries = [e for e in self._entries if not e.success and e.skill_id == skill_id]
        else:
            entries = [e for e in self._entries if e.skill_id == skill_id]

        if not entries:
            return []

        # Score by keyword overlap with task
        scored = []
        task_kws = _keywords(task)
        for entry in entries:
            entry_kws = set(entry.keywords)
            if not entry_kws:
                score = 0.0
            else:
                score = len(task_kws & entry_kws) / max(len(task_kws | entry_kws), 1)
            scored.append((score, entry))

        scored.sort(key=lambda x: -x[0])
        return [entry for _, entry in scored[:max_results] if _ > 0]

    def recent(self, limit: int = 10, failure_only: bool = False) -> list[ReflexionEntry]:
        """Return most recent reflections."""
        entries = self._entries
        if failure_only:
            entries = [e for e in entries if not e.success]
        return sorted(entries, key=lambda e: e.timestamp, reverse=True)[:limit]

    def stats(self) -> dict:
        """Return summary statistics."""
        total = len(self._entries)
        failures = sum(1 for e in self._entries if not e.success)
        by_skill = {}
        for e in self._entries:
            by_skill.setdefault(e.skill_id, {"total": 0, "failures": 0})
            by_skill[e.skill_id]["total"] += 1
            if not e.success:
                by_skill[e.skill_id]["failures"] += 1
        return {
            "total": total,
            "failures": failures,
            "success_rate": round((total - failures) / max(total, 1), 3),
            "by_skill": by_skill,
        }


# ── Convenience function ──────────────────────────────────────────────────────

def reflect_on_failure(
    skill_id: str,
    task: str,
    error: str,
    error_type: str = "Error",
    context: dict = None,
) -> dict:
    """
    One-shot reflect on failure. Stores and returns the entry.
    """
    reflector = SelfReflector()
    entry = reflector.reflect(
        skill_id=skill_id,
        task=task,
        success=False,
        error_type=error_type,
        error_msg=str(error)[:200],
        context=context or {},
    )
    return entry.to_dict()


# ── CLI ─────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    reflector = SelfReflector()

    if len(sys.argv) > 1 and sys.argv[1] == "--reflect":
        if len(sys.argv) < 5:
            print("Usage: --reflect <skill_id> <task> <error_type> [error_msg]")
            sys.exit(1)
        skill_id, task, error_type = sys.argv[2], sys.argv[3], sys.argv[4]
        error_msg = sys.argv[5] if len(sys.argv) > 5 else ""
        entry = reflector.reflect(skill_id, task, success=False,
                                   error_type=error_type, error_msg=error_msg)
        print(f"Reflection [{entry.id}]:\n  {entry.reflection}")

    elif len(sys.argv) > 1 and sys.argv[1] == "--recall":
        skill_id = sys.argv[2] if len(sys.argv) > 2 else ""
        task = sys.argv[3] if len(sys.argv) > 3 else ""
        if task:
            results = reflector.retrieve_similar(skill_id or "unknown", task, failure_only=True)
        else:
            results = reflector.recent(failure_only=True)
        print(f"Found {len(results)} reflection(s):")
        for e in results:
            icon = "❌" if not e.success else "✅"
            print(f"  {icon} [{e.skill_id}] {e.task[:50]} — {e.reflection[:80]}")

    elif len(sys.argv) > 1 and sys.argv[1] == "--stats":
        print("Reflexion stats:", json.dumps(reflector.stats(), indent=2))

    else:
        print("Usage:")
        print("  --reflect <skill_id> <task> <error_type> [error_msg]")
        print("  --recall [skill_id] [task]")
        print("  --stats")
