"""
_contradiction_detector.py — Contradiction Detection for Knowledge Graph

Before adding a 'contradicts' edge (or any edge that might conflict),
check if the graph already has a path that would be logically inconsistent.

Based on Letta Context Constitution's memory integrity principles:
  - Cross-reference: new memories compared against existing ones for contradictions
  - Temporal consistency: ordering conflicts detected
  - Provenance: distinguish user_said vs inferred vs external_api

Usage:
    from skills._contradiction_detector import ContradictionDetector

    detector = ContradictionDetector(graph)  # pass existing ConeGraph instance
    result = detector.check_and_add_edge(edge)
    if result.has_contradiction:
        print(f"WARNING: {result.message}")

CLI:
    python skills/_contradiction_detector.py --check <text1> <text2>
    python skills/_contradiction_detector.py --entity <entity>
"""

import json
import re
import sys
from dataclasses import dataclass, field
from typing import Optional


# ── Contradiction Types ─────────────────────────────────────────────────────

# Simple keyword pairs: (positive_term, negative_term)
# These are matched as whole words.
CONTRADICTION_PAIRS = [
    ("rises", "falls"),
    ("up", "down"),
    ("increases", "decreases"),
    ("gains", "loses"),
    ("higher", "lower"),
    ("positive", "negative"),
    ("bullish", "bearish"),
    ("active", "inactive"),
    ("enabled", "disabled"),
    ("success", "fail"),
    ("successfully", "failed"),
    ("all", "none"),
    ("always", "never"),
    ("more", "less"),
    ("bigger", "smaller"),
    ("larger", "smaller"),
    ("better", "worse"),
    ("correct", "incorrect"),
    ("right", "wrong"),
    ("true", "false"),
    ("good", "bad"),
    ("yes", "no"),
    ("before", "after"),
]

# Build a compiled pattern for each pair
def _build_pair_pattern(pos: str, neg: str) -> tuple:
    """Return (pos_re, neg_re) as compiled patterns."""
    return (
        re.compile(r"\b" + re.escape(pos) + r"\b", re.IGNORECASE),
        re.compile(r"\b" + re.escape(neg) + r"\b", re.IGNORECASE),
    )

CONTRADICTION_PATTERNS = [_build_pair_pattern(p, n) for p, n in CONTRADICTION_PAIRS]


@dataclass
class ContradictionResult:
    has_contradiction: bool
    message: str = ""
    severity: str = "none"       # none | warning | error
    conflicting_edges: list = field(default_factory=list)
    resolution_hint: str = ""


class ContradictionDetector:
    """
    Wraps a ConeGraph to detect contradictions before adding edges.

    Detection strategies:
    1. Text-pattern contradiction: scan for explicit opposite keywords
    2. Entity-value tracking: watch numeric assertions on same entity
    3. Graph-based: check existing 'contradicts' edges in the graph
    """

    def __init__(self, graph=None):
        self._graph = graph
        self._entity_cache: dict[str, dict] = {}  # entity::attribute -> {value, edge_text}
        self._last_edge_text: str = ""

    # ── Pattern-based contradiction ───────────────────────────────────────

    def _check_text_pattern(self, text1: str, text2: str) -> Optional[str]:
        """Check if two texts contain contradictory keyword pairs."""
        t1, t2 = text1.lower(), text2.lower()
        for pos_re, neg_re in CONTRADICTION_PATTERNS:
            has_pos = bool(pos_re.search(t1))
            has_neg = bool(neg_re.search(t2))
            if has_pos and has_neg:
                pos_word = pos_re.pattern.replace(r"\b", "").replace("\\", "")
                neg_word = neg_re.pattern.replace(r"\b", "").replace("\\", "")
                return f"contradiction: '{pos_word}' in text1 vs '{neg_word}' in text2"
        return None

    # ── Numeric entity-value contradiction ────────────────────────────────

    def _entity_key(self, entity: str, attribute: str) -> str:
        return f"{entity}::{attribute}"

    def _check_entity_conflict(
        self, entity: str, attribute: str, value: str, edge_text: str
    ) -> Optional[str]:
        """Check if a new assertion conflicts with a cached entity::attribute value."""
        key = self._entity_key(entity, attribute)
        cached = self._entity_cache.get(key)
        if not cached:
            return None

        cached_val = cached["value"].lower()
        new_val = value.lower()

        # Numeric conflict: extract numbers and compare
        cached_nums = re.findall(r"\d+(?:\.\d+)?", cached_val)
        new_nums = re.findall(r"\d+(?:\.\d+)?", new_val)
        if cached_nums and new_nums:
            if cached_nums[0] != new_nums[0]:
                return (f"numeric conflict: {entity}.{attribute} "
                        f"was '{cached['value']}', now '{value}'")

        # Boolean conflict: yes/no signals
        yes_words = re.compile(
            r"\b(yes|yeah|yep|true|success|active|enabled|positive|bullish)\b",
            re.IGNORECASE
        )
        no_words = re.compile(
            r"\b(no|nope|nah|false|fail|error|disabled|negative|bearish)\b",
            re.IGNORECASE
        )
        cached_yes = bool(yes_words.search(cached_val))
        cached_no = bool(no_words.search(cached_val))
        new_yes = bool(yes_words.search(new_val))
        new_no = bool(no_words.search(new_val))
        if (cached_yes and new_no) or (cached_no and new_yes):
            return f"boolean conflict: {entity}.{attribute} was '{cached['value']}', now '{value}'"

        return None

    def track_assertion(self, entity: str, attribute: str, value: str, edge_text: str) -> None:
        """Register an entity::attribute assertion for future conflict checks."""
        key = self._entity_key(entity, attribute)
        self._entity_cache[key] = {"value": value, "edge_text": edge_text}

    # ── Graph-based contradiction ───────────────────────────────────────

    def _check_graph_contradiction(self, edge) -> list[dict]:
        """Check existing edges in the graph for conflicts."""
        if not self._graph:
            return []
        conflicts = []
        try:
            outgoing = self._graph.get_outgoing_edges(edge.source_id)
            for existing in outgoing:
                if (existing.target_id == edge.target_id and
                        existing.edge_type == "contradicts"):
                    conflicts.append({
                        "edge_id": existing.id,
                        "edge_text": existing.edge_text,
                        "type": "already_has_contradiction",
                    })
                if (existing.source_id == edge.source_id and
                        existing.target_id == edge.target_id and
                        existing.edge_type == edge.edge_type and
                        existing.id != edge.id):
                    conflicts.append({
                        "edge_id": existing.id,
                        "type": "duplicate_edge",
                    })
        except Exception:
            pass
        return conflicts

    # ── Main entry point ────────────────────────────────────────────────

    def check_and_add_edge(self, edge, skip_graph_check: bool = False) -> ContradictionResult:
        """
        Check an edge for contradictions before adding to the graph.
        Adds the edge if no severe contradictions are found.

        Returns ContradictionResult.
        """
        conflicts = []

        # 1. Text pattern contradiction
        if edge.edge_text and self._last_edge_text:
            pattern_conflict = self._check_text_pattern(self._last_edge_text, edge.edge_text)
            if pattern_conflict:
                conflicts.append({
                    "type": "text_pattern",
                    "message": pattern_conflict,
                    "severity": "warning",
                })

        # 2. Entity-value conflict
        entities = re.findall(r"\b[A-Z]{2,}\b", edge.edge_text or "")
        for entity in entities[:3]:
            entity_conflict = self._check_entity_conflict(
                entity, "assertion", edge.edge_text, edge.edge_text
            )
            if entity_conflict:
                conflicts.append({
                    "type": "entity_value",
                    "message": entity_conflict,
                    "severity": "warning",
                })

        # 3. Graph contradiction check
        if not skip_graph_check:
            graph_conflicts = self._check_graph_contradiction(edge)
            conflicts.extend(graph_conflicts)

        # Update last edge text
        if edge.edge_text:
            self._last_edge_text = edge.edge_text

        # Add to graph if no severe conflicts
        severe = [c for c in conflicts if c.get("severity") == "error"]
        if not severe and self._graph:
            try:
                self._graph.add_edge(edge)
            except Exception:
                pass

        if not conflicts:
            return ContradictionResult(has_contradiction=False)

        has_contradiction = len(conflicts) > 0
        severity = "error" if severe else "warning"
        msg = "; ".join(c.get("message", c.get("type", "?")) for c in conflicts)

        return ContradictionResult(
            has_contradiction=has_contradiction,
            message=msg,
            severity=severity,
            conflicting_edges=conflicts,
            resolution_hint="review: merge the contradiction or flag for human review",
        )


# ── CLI ──────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    detector = ContradictionDetector()

    if len(sys.argv) > 1 and sys.argv[1] == "--check":
        text1 = sys.argv[2] if len(sys.argv) > 2 else ""
        text2 = sys.argv[3] if len(sys.argv) > 3 else ""
        result = detector._check_text_pattern(text1, text2)
        print(f"Text1: {text1}")
        print(f"Text2: {text2}")
        print(f"Contradiction: {result or 'none'}")

    elif len(sys.argv) > 1 and sys.argv[1] == "--entity":
        entity = sys.argv[2] if len(sys.argv) > 2 else "AAPL"
        detector.track_assertion(entity, "price", "AAPL price rises to $182", "$182")
        conflict = detector._check_entity_conflict(
            entity, "price", "AAPL price falls to $175", "$175"
        )
        print(f"Entity: {entity}")
        print(f"Conflict: {conflict or 'none'}")

    else:
        print("Usage:")
        print("  --check <text1> <text2>   Check text pattern contradiction")
        print("  --entity <entity>         Test entity-value contradiction")
