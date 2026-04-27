"""
_preference_buffer.py — User Preference Learning from Implicit/Explicit Feedback

Stores user reactions to skill results and retrieves them to guide future routing.

Feedback types:
  - explicit_positive: user said "good", 👍, "thanks", etc.
  - explicit_negative: user said "no", "wrong", 👎, "that's not right", etc.
  - implicit_positive: user acted on the result (e.g. copied, forwarded)
  - implicit_negative: user ignored the result (> 3 min silence after result)
  - correction: user provided the correct answer (overrides previous result)

Stored in memory/_preference_buffer.jsonl.
Query before routing a skill to get user's known preferences for similar tasks.

Usage:
    from skills._preference_buffer import record_feedback, get_preference, best_skill_for

    record_feedback(skill_id="invest", query="AAPL analysis", signal=+1)
    pref = get_preference("invest", "AAPL analysis")
    print(f"Confidence: {pref['confidence']}")  # 0.0-1.0

    # When routing:
    best = best_skill_for(task="stock analysis", available_skills=["invest", "web-scraping"])
    print(f"Recommended: {best}")

CLI:
    python skills/_preference_buffer.py --recent
    python skills/_preference_buffer.py --signal invest "AAPL analysis" +1
    python skills/_preference_buffer.py --best "stock analysis"
"""

import json
import re
import sys
import time
from collections import defaultdict
from dataclasses import dataclass, asdict, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

WORKSPACE = Path("C:/Users/Administrator/.openclaw/workspace")
PREF_LOG = WORKSPACE / "memory" / "_preference_buffer.jsonl"

STOPWORDS = set("the a an is are were was be been being have has had do does did "
                "what which how who when where why".split())


def _keywords(text: str) -> set[str]:
    if not text:
        return set()
    return set(w.lower() for w in re.findall(r"\w+", text) if w.lower() not in STOPWORDS)


def _jaccard(a: set[str], b: set[str]) -> float:
    if not a or not b:
        return 0.0
    return len(a & b) / max(len(a | b), 1)


@dataclass
class PreferenceEntry:
    id: int
    skill_id: str
    query: str
    keywords: list[str]
    signal: int             # +1 positive, -1 negative
    feedback_type: str       # explicit_positive | explicit_negative | implicit_positive | implicit_negative | correction
    timestamp: str
    context: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return asdict(self)


class PreferenceBuffer:
    """
    Stores and retrieves user preferences for skill routing.
    """

    def __init__(self):
        self._entries: list[PreferenceEntry] = []
        self._next_id = 1
        self._load()

    def _load(self) -> None:
        if not PREF_LOG.exists():
            return
        try:
            lines = PREF_LOG.read_text(encoding="utf-8").strip().split("\n")
            for line in lines:
                if not line.strip():
                    continue
                try:
                    entry = PreferenceEntry(**json.loads(line))
                    self._entries.append(entry)
                    self._next_id = max(self._next_id, entry.id + 1)
                except Exception:
                    continue
        except Exception:
            self._entries = []

    def _save(self, entry: PreferenceEntry) -> None:
        PREF_LOG.parent.mkdir(parents=True, exist_ok=True)
        with open(str(PREF_LOG), "a", encoding="utf-8") as f:
            f.write(json.dumps(entry.to_dict(), ensure_ascii=False) + "\n")
        self._entries.append(entry)

    def record(
        self,
        skill_id: str,
        query: str,
        signal: int,
        feedback_type: str = "explicit_positive",
        context: dict = None,
    ) -> PreferenceEntry:
        """
        Record a preference signal for a skill+query combination.

        Args:
            skill_id: which skill was called
            query: the user's query text
            signal: +1 (positive) or -1 (negative)
            feedback_type: one of the feedback type constants
            context: optional additional context
        """
        now = datetime.now(timezone.utc).isoformat()
        entry = PreferenceEntry(
            id=self._next_id,
            skill_id=skill_id,
            query=query[:200],
            keywords=list(_keywords(query))[:20],
            signal=signal,
            feedback_type=feedback_type,
            timestamp=now,
            context=context or {},
        )
        self._next_id += 1
        self._save(entry)
        return entry

    def get_preference(
        self,
        skill_id: str,
        query: str,
        lookback_hours: int = 168,
    ) -> dict:
        """
        Get preference score for a skill+query pair.
        Returns {signal_count, confidence, last_signal}.
        """
        cutoff = datetime.now(timezone.utc).timestamp() - lookback_hours * 3600
        query_kws = _keywords(query)
        pos, neg = 0, 0

        for entry in self._entries:
            if entry.skill_id != skill_id:
                continue
            ts = datetime.fromisoformat(entry.timestamp).timestamp()
            if ts < cutoff:
                continue
            # Keyword overlap
            entry_kws = set(entry.keywords)
            if query_kws:
                overlap = len(query_kws & entry_kws) / max(len(query_kws | entry_kws), 1)
                if overlap < 0.1:
                    continue
            # Tally
            if entry.signal > 0:
                pos += 1
            else:
                neg += 1

        total = pos + neg
        confidence = 0.5  # neutral
        if total > 0:
            confidence = pos / total
        last_signal = self._entries[-1].signal if self._entries else 0

        return {
            "skill_id": skill_id,
            "query": query[:50],
            "positive_count": pos,
            "negative_count": neg,
            "total_count": total,
            "confidence": round(confidence, 3),   # 0.0-1.0, 0.5=neutral
            "last_signal": last_signal,
            "verdict": "prefer" if confidence > 0.6 else ("avoid" if confidence < 0.4 else "neutral"),
        }

    def best_skill_for(
        self,
        task: str,
        available_skills: list[str],
        lookback_hours: int = 168,
    ) -> Optional[str]:
        """
        Given a task and list of available skills, return the best skill
        based on accumulated preference signals.
        """
        scores = {}
        for skill in available_skills:
            pref = self.get_preference(skill, task, lookback_hours)
            scores[skill] = pref["confidence"]

        if not scores or max(scores.values()) <= 0.5:
            return None  # no clear preference

        return max(scores, key=scores.get)

    def recent(self, limit: int = 20) -> list[PreferenceEntry]:
        """Return most recent preference entries."""
        return sorted(self._entries, key=lambda e: e.timestamp, reverse=True)[:limit]

    def stats(self) -> dict:
        by_skill = defaultdict(lambda: {"pos": 0, "neg": 0})
        by_type = defaultdict(int)
        for e in self._entries:
            by_skill[e.skill_id]["pos" if e.signal > 0 else "neg"] += 1
            by_type[e.feedback_type] += 1
        return {
            "total": len(self._entries),
            "by_skill": dict(by_skill),
            "by_feedback_type": dict(by_type),
        }


# ── Convenience functions ─────────────────────────────────────────────────

def record_feedback(skill_id: str, query: str, signal: int,
                    feedback_type: str = "explicit_positive",
                    context: dict = None) -> PreferenceEntry:
    buf = PreferenceBuffer()
    return buf.record(skill_id, query, signal, feedback_type, context)


def get_preference(skill_id: str, query: str) -> dict:
    buf = PreferenceBuffer()
    return buf.get_preference(skill_id, query)


def best_skill_for(task: str, available_skills: list[str]) -> Optional[str]:
    buf = PreferenceBuffer()
    return buf.best_skill_for(task, available_skills)


# ── Signal detection from natural language ─────────────────────────────

EXPLICIT_POSITIVE_PATTERNS = [
    r"\b(thanks?|thank you|great|perfect|awesome|excellent|good|nice|correct|yes|yeah|yep)\b",
    r"\b(that[' ]?s? (right|correct|good)|you[' ]?re (right|helpful))\b",
    r"👍",
    r"(that[' ]?s? (it|what i wanted|the answer))\b",
]

EXPLICIT_NEGATIVE_PATTERNS = [
    r"\b(no|nope|nah|wrong|incorrect|bad|terrible|not good|that[' ]?s? not right)\b",
    r"\b(not what i|i didn[' ]?t mean|that[' ]?s? not|i wanted)\b",
    r"👎",
    r"(can[' ]?t |unable to |failed to |doesn[' ]?t work)\b",
]

IMPLICIT_POSITIVE_PATTERNS = [
    r"(copied|forwarded|shared|saved|bookmarked)",
    r"(using this|the result|the info)",
]

IMPLICIT_NEGATIVE_PATTERNS = [
    r"(different result|wrong result|other answer|alternative)",
    r"(ignore|dismiss|disregard|skip)",
]


def detect_signal_from_text(text: str) -> tuple[int, str]:
    """
    Detect feedback signal from raw user text.
    Returns (signal, feedback_type).
    """
    t = text.lower()
    for pattern in EXPLICIT_POSITIVE_PATTERNS:
        if re.search(pattern, t, re.IGNORECASE):
            return +1, "explicit_positive"
    for pattern in EXPLICIT_NEGATIVE_PATTERNS:
        if re.search(pattern, t, re.IGNORECASE):
            return -1, "explicit_negative"
    for pattern in IMPLICIT_POSITIVE_PATTERNS:
        if re.search(pattern, t, re.IGNORECASE):
            return +1, "implicit_positive"
    for pattern in IMPLICIT_NEGATIVE_PATTERNS:
        if re.search(pattern, t, re.IGNORECASE):
            return -1, "implicit_negative"
    return 0, "none"


# ── CLI ─────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    buf = PreferenceBuffer()

    if len(sys.argv) > 1 and sys.argv[1] == "--signal":
        skill_id = sys.argv[2] if len(sys.argv) > 2 else "unknown"
        query = sys.argv[3] if len(sys.argv) > 3 else ""
        signal_str = sys.argv[4] if len(sys.argv) > 4 else "0"
        signal = int(signal_str)
        entry = buf.record(skill_id, query, signal)
        print(f"Recorded: [{'+1' if signal > 0 else '-1'}] {skill_id} — {query[:50]}")

    elif len(sys.argv) > 1 and sys.argv[1] == "--recent":
        entries = buf.recent(limit=10)
        print(f"Recent preferences ({len(entries)}):")
        for e in entries:
            icon = "+" if e.signal > 0 else "-"
            print(f"  [{icon}] {e.skill_id}: {e.query[:50]} ({e.feedback_type})")

    elif len(sys.argv) > 1 and sys.argv[1] == "--best":
        task = sys.argv[2] if len(sys.argv) > 2 else ""
        skills = sys.argv[3:] if len(sys.argv) > 3 else ["invest", "web-scraping"]
        best = buf.best_skill_for(task, skills)
        pref = buf.get_preference(best or skills[0], task)
        print(f"Best skill for '{task}': {best or 'none'}")
        print(f"  confidence={pref['confidence']} pos={pref['positive_count']} neg={pref['negative_count']}")

    elif len(sys.argv) > 1 and sys.argv[1] == "--stats":
        print("Preference stats:", json.dumps(buf.stats(), indent=2))

    else:
        print("Usage:")
        print("  --signal <skill_id> <query> <+1|-1>")
        print("  --recent")
        print("  --best <task> [skills...]")
        print("  --stats")
