"""
_correction_hook.py — User Correction Hook for Skill Results

Hooks into onMessagePreprocessed to detect [CORRECT: ...] patterns.
When a user corrects a skill result, the correction is stored and
applied to future similar queries (via PreferenceBuffer).

Correction format:
  [CORRECT: original_claim -> corrected_claim]

Or shorthand:
  [CORRECT: the correct answer is X]

Storage: memory/_corrections.jsonl
Query: corrections are checked during skill routing to override wrong outputs.

Usage:
    from skills._correction_hook import process_corrections, extract_correction

    # In onMessagePreprocessed:
    correction = extract_correction(message)
    if correction:
        store_correction(correction)
        # Optionally override the skill result directly

CLI:
    python skills/_correction_hook.py --recent
    python skills/_correction_hook.py --check "the answer is 42"
"""

import json
import re
import sys
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

WORKSPACE = Path("C:/Users/Administrator/.openclaw/workspace")
CORRECTIONS_LOG = WORKSPACE / "memory" / "_corrections.jsonl"


@dataclass
class CorrectionEntry:
    id: int
    skill_id: str            # which skill produced the wrong output
    original_query: str      # the user's original query
    wrong_output: str        # what the skill said
    correction: str          # what the user says is correct
    timestamp: str
    keywords: list[str] = field(default_factory=list)
    applied_count: int = 0   # how many times this correction was applied

    def to_dict(self) -> dict:
        return asdict(self)


# ── Correction Patterns ────────────────────────────────────────────────────

CORRECTION_PATTERNS = [
    # Primary pattern: [CORRECT: wrong -> right]
    re.compile(r"\[CORRECT:\s*(.+?)\s*->\s*(.+?)\]", re.IGNORECASE | re.DOTALL),
    # Shorthand: [CORRECT: the answer is X]  (no "->")
    re.compile(r"\[CORRECT:\s*(.+?)\](?:\s|$)", re.IGNORECASE),
    # Full sentence: "the correct answer is X" or "actually it's X"
    re.compile(r"correct(?:ion)?[:\s]+(.+?)(?:\.|$)", re.IGNORECASE),
    re.compile(r"actually[:\s]+(?:it[' ]?s? )?(.+?)(?:\.|$)", re.IGNORECASE),
    re.compile(r"not ['\"]?(.+?)['\"]?,?\s+(?:but |should be |actually |right )(.+?)(?:\.|$)", re.IGNORECASE),
]

# Patterns that override the entire skill output
OUTPUT_OVERRIDE_PATTERNS = [
    re.compile(r"override[:\s]+(.+)", re.IGNORECASE),
    re.compile(r"use this instead[:\s]+(.+)", re.IGNORECASE),
    re.compile(r"replace with[:\s]+(.+)", re.IGNORECASE),
]


def extract_correction(message: str) -> Optional[dict]:
    """
    Extract a correction from user message.
    Returns dict with {pattern, wrong, right} or None.
    """
    message = message.strip()

    # Primary pattern: [CORRECT: wrong -> right]
    m = CORRECTION_PATTERNS[0].search(message)
    if m:
        wrong = m.group(1).strip()
        right = m.group(2).strip()
        return {"pattern": "explicit", "wrong": wrong, "right": right}

    # Shorthand: [CORRECT: right answer only]
    m = CORRECTION_PATTERNS[1].search(message)
    if m:
        correction = m.group(1).strip()
        return {"pattern": "shorthand", "wrong": "", "right": correction}

    # "the correct answer is X"
    m = CORRECTION_PATTERNS[2].search(message)
    if m:
        return {"pattern": "correct_answer", "wrong": "", "right": m.group(1).strip()}

    # "actually it's X"
    m = CORRECTION_PATTERNS[3].search(message)
    if m:
        return {"pattern": "actually", "wrong": "", "right": m.group(1).strip()}

    # "not X, but Y"
    m = CORRECTION_PATTERNS[4].search(message)
    if m:
        return {"pattern": "not_but", "wrong": m.group(1).strip(), "right": m.group(2).strip()}

    return None


# ── Storage ────────────────────────────────────────────────────────────────

class CorrectionStore:
    def __init__(self):
        self._entries: list[CorrectionEntry] = []
        self._next_id = 1
        self._load()

    def _load(self) -> None:
        if not CORRECTIONS_LOG.exists():
            return
        try:
            lines = CORRECTIONS_LOG.read_text(encoding="utf-8").strip().split("\n")
            for line in lines:
                if not line.strip():
                    continue
                try:
                    entry = CorrectionEntry(**json.loads(line))
                    self._entries.append(entry)
                    self._next_id = max(self._next_id, entry.id + 1)
                except Exception:
                    continue
        except Exception:
            self._entries = []

    def _save(self, entry: CorrectionEntry) -> None:
        CORRECTIONS_LOG.parent.mkdir(parents=True, exist_ok=True)
        with open(str(CORRECTIONS_LOG), "a", encoding="utf-8") as f:
            f.write(json.dumps(entry.to_dict(), ensure_ascii=False) + "\n")
        self._entries.append(entry)

    def store(
        self,
        skill_id: str,
        original_query: str,
        wrong_output: str,
        correction: str,
    ) -> CorrectionEntry:
        """Store a correction entry."""
        entry = CorrectionEntry(
            id=self._next_id,
            skill_id=skill_id,
            original_query=original_query[:200],
            wrong_output=wrong_output[:200],
            correction=correction[:200],
            timestamp=datetime.now(timezone.utc).isoformat(),
            keywords=list(_extract_keywords(original_query))[:10],
            applied_count=0,
        )
        self._next_id += 1
        self._save(entry)
        return entry

    def lookup_correction(self, query: str, skill_id: str = "") -> Optional[CorrectionEntry]:
        """
        Find a correction relevant to this query.
        Returns the best matching correction or None.
        """
        query_kws = set(_extract_keywords(query))
        best_entry: Optional[CorrectionEntry] = None
        best_score = 0.0

        for entry in reversed(self._entries):
            if skill_id and entry.skill_id != skill_id:
                continue
            entry_kws = set(entry.keywords)
            if not entry_kws:
                score = 0.0
            else:
                score = len(query_kws & entry_kws) / max(len(query_kws | entry_kws), 1)
            if score > best_score and score >= 0.15:
                best_score = score
                best_entry = entry

        if best_entry:
            best_entry.applied_count += 1
            self._save(best_entry)  # update applied_count

        return best_entry

    def recent(self, limit: int = 20) -> list[CorrectionEntry]:
        return sorted(self._entries, key=lambda e: e.timestamp, reverse=True)[:limit]


def _extract_keywords(text: str) -> list[str]:
    if not text:
        return []
    STOPWORDS = set("the a an is are were was be been being have has had do does did "
                   "what which how who when where why".split())
    return [w.lower() for w in re.findall(r"\w+", text) if w.lower() not in STOPWORDS and len(w) > 2]


# ── Process function ─────────────────────────────────────────────────────

def process_corrections(message: str, skill_id: str = "", wrong_output: str = "") -> Optional[CorrectionEntry]:
    """
    Check if a message contains a correction. If so, store it.

    Returns the CorrectionEntry if a correction was found, else None.
    """
    correction = extract_correction(message)
    if not correction:
        return None

    store = CorrectionStore()
    entry = store.store(
        skill_id=skill_id or "unknown",
        original_query=message[:200],
        wrong_output=wrong_output,
        correction=correction["right"],
    )
    return entry


# ── CLI ─────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--recent":
        store = CorrectionStore()
        entries = store.recent(limit=10)
        print(f"Recent corrections ({len(entries)}):")
        for e in entries:
            print(f"  [{e.skill_id}] {e.correction[:60]}"
                  f" (applied {e.applied_count}x)")

    elif len(sys.argv) > 1 and sys.argv[1] == "--check":
        text = " ".join(sys.argv[2:])
        corr = extract_correction(text)
        if corr:
            print(f"Pattern: {corr['pattern']}")
            print(f"  wrong: {corr.get('wrong', '')}")
            print(f"  right: {corr['right']}")
            store = CorrectionStore()
            entry = store.lookup_correction(text)
            if entry:
                print(f"Stored correction found: {entry.correction[:60]}")
        else:
            print("No correction detected")

    elif len(sys.argv) > 1 and sys.argv[1] == "--test":
        tests = [
            "[CORRECT: the price is $182 -> $175]",
            "actually it's $175, not $182",
            "not $180, but $175",
            "the correct answer is $175",
            "Get me AAPL quote please",
        ]
        print("Correction extraction tests:")
        for text in tests:
            corr = extract_correction(text)
            print(f"  {'EXTRACTED' if corr else 'none'}: {text[:60]}")
            if corr:
                print(f"    pattern={corr['pattern']} right={corr['right'][:40]}")

    else:
        print("Usage:")
        print("  --recent           Show recent corrections")
        print("  --check <text>     Check text for correction pattern")
        print("  --test            Run extraction tests")
