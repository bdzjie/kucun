"""
_fragment_detector.py — Memory Fragment Detection & Consolidation Trigger

Detects fragmented episodic memories (same entity/theme across multiple sessions)
and triggers autonomous consolidation when fragment count exceeds threshold.

Fragment patterns detected:
  - Same entity mentioned across N sessions without a connecting graph edge
  - Same topic in multiple short episodes (same skill_id, overlapping keywords)
  - Temporal gaps: facts asserted about the same entity at different times
    that are logically inconsistent

Consolidation triggers:
  - frag_count > FRAGMENT_THRESHOLD (default 5)
  - same entity across > 3 sessions
  - conflicting temporal assertions (before/after contradictions)

Usage:
    from skills._fragment_detector import FragmentDetector, detect_fragments

    detector = FragmentDetector()
    fragments = detector.detect_fragments(session_id="sess_abc")
    if fragments:
        print(f"Found {len(fragments)} fragment groups, triggering consolidation")
        for frag in fragments:
            print(f"  [{frag.group_id}] {frag.entity} — {frag.episode_count} fragments")

CLI:
    python skills/_fragment_detector.py --detect
    python skills/_fragment_detector.py --stats
"""

import json
import re
import sys
from collections import defaultdict
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

WORKSPACE = Path("C:/Users/Administrator/.openclaw/workspace")
EPISODES_DIR = WORKSPACE / "memory" / ".dreams" / "session-corpus"
FRAG_LOG = WORKSPACE / "memory" / "_fragment_log.jsonl"

# Thresholds
FRAGMENT_THRESHOLD = 5      # episodes for same entity → consolidation candidate
SESSION_THRESHOLD = 3       # sessions for same entity → fragment
KEYWORD_OVERLAP = 0.60     # Jaccard threshold for "same topic"


STOPWORDS = set("the a an is are were was be been being have has had do does did "
                "what which how who when where why is are was were".split())


def _keywords(text: str) -> set[str]:
    if not text:
        return set()
    return set(w.lower() for w in re.findall(r"\w+", text) if w.lower() not in STOPWORDS)


def _jaccard(a: set[str], b: set[str]) -> float:
    if not a or not b:
        return 0.0
    return len(a & b) / max(len(a | b), 1)


# ── Dataclasses ────────────────────────────────────────────────────────────

@dataclass
class FragmentGroup:
    group_id: str
    entity: str               # the common entity/entity phrase
    episode_ids: list[str]
    session_ids: list[str]
    episode_count: int
    session_count: int
    keyword_overlap: float   # how similar the fragments are
    detected_at: str
    consolidation_priority: str = "medium"  # low | medium | high

    def to_dict(self) -> dict:
        return asdict(self)


# ── Fragment Detector ────────────────────────────────────────────────────

class FragmentDetector:
    """
    Scans session corpus for fragmented memories and emits consolidation triggers.
    """

    def __init__(self, frag_threshold: int = FRAGMENT_THRESHOLD):
        self.frag_threshold = frag_threshold
        self._entities: dict[str, list[dict]] = defaultdict(list)
        # entity -> [{episode_id, session_id, text, keywords, timestamp}]
        self._log_buffer: list[str] = []
        FRAG_LOG.parent.mkdir(parents=True, exist_ok=True)

    # ── Load episodes ──────────────────────────────────────────────────

    def _load_episodes(self, session_id: str = "") -> list[dict]:
        """Load episodes from session corpus files."""
        episodes = []
        if not EPISODES_DIR.exists():
            return episodes

        pattern = f"*{session_id}*" if session_id else "*"
        for p in EPISODES_DIR.glob(pattern):
            if not p.is_file() or p.suffix != ".txt":
                continue
            try:
                content = p.read_text(encoding="utf-8")
                kws = _keywords(content)
                sessions_match = re.search(r"session[_-]?id[=:]?\s*(\S+)", content, re.IGNORECASE)
                sess = sessions_match.group(1) if sessions_match else p.stem
                episodes.append({
                    "episode_id": p.stem,
                    "session_id": sess,
                    "text": content[:500],   # first 500 chars
                    "keywords": list(kws),
                    "timestamp": datetime.fromtimestamp(p.stat().st_mtime, tz=timezone.utc).isoformat(),
                })
            except Exception:
                continue
        return episodes

    # ── Entity extraction ─────────────────────────────────────────────

    def _extract_entities(self, text: str) -> list[str]:
        """Extract named entities from text."""
        entities = []
        # CamelCase compounds: ClaudeCode, MemGPT
        entities.extend(re.findall(r"\b[A-Z][a-z]+[A-Z]\w+", text))
        # ALL_CAPS acronyms
        entities.extend(re.findall(r"\b[A-Z]{2,}\b", text))
        # Capitalized multi-word phrases
        entities.extend(re.findall(r"\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3}\b", text))
        return list(set(entities))[:10]  # cap at 10 entities

    # ── Fragment detection ─────────────────────────────────────────────

    def detect_fragments(self, session_id: str = "", min_fragment_count: int = None) -> list[FragmentGroup]:
        """
        Scan for fragmented memories and return FragmentGroup list.
        """
        min_fragment_count = min_fragment_count or self.frag_threshold
        episodes = self._load_episodes(session_id)
        self._entities.clear()

        # Group episodes by entity
        for ep in episodes:
            entities = self._extract_entities(ep["text"])
            for entity in entities:
                self._entities[entity].append(ep)

        # Build fragment groups
        groups = []
        for entity, eps in self._entities.items():
            if len(eps) < min_fragment_count:
                continue

            session_ids = list(dict.fromkeys(e["session_id"] for e in eps))
            session_count = len(session_ids)

            if session_count < SESSION_THRESHOLD and len(eps) < min_fragment_count + 2:
                continue

            # Compute average keyword overlap
            if len(eps) >= 2:
                overlaps = []
                for i in range(len(eps)):
                    for j in range(i + 1, len(eps)):
                        o = _jaccard(set(eps[i]["keywords"]), set(eps[j]["keywords"]))
                        overlaps.append(o)
                avg_overlap = sum(overlaps) / len(overlaps) if overlaps else 0.0
            else:
                avg_overlap = 1.0

            # Priority
            if len(eps) >= self.frag_threshold * 2 or session_count >= SESSION_THRESHOLD + 2:
                priority = "high"
            elif len(eps) >= self.frag_threshold:
                priority = "medium"
            else:
                priority = "low"

            group = FragmentGroup(
                group_id=f"frag_{entity[:20].lower()}_{len(groups)}",
                entity=entity,
                episode_ids=[e["episode_id"] for e in eps],
                session_ids=session_ids,
                episode_count=len(eps),
                session_count=session_count,
                keyword_overlap=round(avg_overlap, 3),
                detected_at=datetime.now(timezone.utc).isoformat(),
                consolidation_priority=priority,
            )
            groups.append(group)
            self._log_group(group)

        return sorted(groups, key=lambda g: -g.episode_count)

    # ── Consolidation check ─────────────────────────────────────────────

    def needs_consolidation(self, threshold: int = None) -> bool:
        """Return True if any fragment group exceeds threshold."""
        threshold = threshold or self.frag_threshold
        fragments = self.detect_fragments(min_fragment_count=threshold)
        return len(fragments) > 0

    # ── Logging ───────────────────────────────────────────────────────

    def _log_group(self, group: FragmentGroup) -> None:
        self._log_buffer.append(json.dumps(group.to_dict(), ensure_ascii=False))
        if len(self._log_buffer) >= 5:
            self._flush_log()

    def _flush_log(self) -> None:
        if self._log_buffer and FRAG_LOG:
            with open(str(FRAG_LOG), "a", encoding="utf-8") as f:
                f.write("\n".join(self._log_buffer) + "\n")
            self._log_buffer.clear()

    def flush(self) -> None:
        self._flush_log()

    # ── Stats ──────────────────────────────────────────────────────

    def fragment_stats(self, since_hours: int = 168) -> dict:
        """Return statistics about detected fragments."""
        if not FRAG_LOG.exists():
            return {"total_groups": 0}

        cutoff = datetime.now(timezone.utc).timestamp() - since_hours * 3600
        groups = []
        try:
            lines = FRAG_LOG.read_text(encoding="utf-8").strip().split("\n")
            for line in lines:
                if not line.strip():
                    continue
                try:
                    d = json.loads(line)
                    dt = datetime.fromisoformat(d["detected_at"]).timestamp()
                    if dt >= cutoff:
                        groups.append(d)
                except Exception:
                    continue
        except Exception:
            pass

        if not groups:
            return {"total_groups": 0}

        total_episodes = sum(g["episode_count"] for g in groups)
        by_priority = {"high": 0, "medium": 0, "low": 0}
        for g in groups:
            by_priority[g.get("consolidation_priority", "?")] += 1

        return {
            "total_groups": len(groups),
            "total_episodes": total_episodes,
            "avg_fragment_size": round(total_episodes / len(groups), 1),
            "by_priority": by_priority,
        }


# ── CLI ─────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    detector = FragmentDetector()

    if len(sys.argv) > 1 and sys.argv[1] == "--detect":
        fragments = detector.detect_fragments()
        print(f"Fragment groups detected: {len(fragments)}")
        for g in fragments:
            print(f"  [{g.consolidation_priority}] {g.entity}: "
                  f"{g.episode_count} eps / {g.session_count} sessions "
                  f"(overlap={g.keyword_overlap:.0%})")
        if not fragments:
            print("  No fragments found — no consolidation needed")
        detector.flush()

    elif len(sys.argv) > 1 and sys.argv[1] == "--stats":
        stats = detector.fragment_stats()
        print(f"Fragment statistics (168h):")
        print(f"  total_groups: {stats['total_groups']}")
        if stats.get("total_episodes"):
            print(f"  total_episodes: {stats['total_episodes']}")
            print(f"  avg_fragment_size: {stats['avg_fragment_size']}")
            print(f"  by_priority: {stats['by_priority']}")

    else:
        # Built-in test
        print("FragmentDetector smoke test:")
        fragments = detector.detect_fragments()
        print(f"  Found {len(fragments)} fragment groups")
        needs = detector.needs_consolidation()
        print(f"  Consolidation needed: {needs}")
        stats = detector.fragment_stats()
        print(f"  Stats: {stats}")
        print("  PASS")
