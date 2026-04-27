"""
_retrieval_quality.py — Retrieval Quality Scoring

Scores each retrieval event to measure "did the retrieved memories help?"
Based on Letta's Recovery Bench concept.

Scoring method (zero-LLM, lightweight):
  - relevance_score: Jaccard keyword overlap between query and retrieved text
  - coverage_score: fraction of query keywords covered by retrieved content
  - novelty_score: fraction of retrieved content that is new (not redundant)
  - final quality: weighted combination

The score is stored per retrieval_id (UUID) in memory/_retrieval_quality.jsonl.
Query this log during heartbeat to detect degradation.

Usage:
    from skills._retrieval_quality import score_retrieval, quality_stats

    score = score_retrieval(
        query="What is the current project status?",
        retrieved=[{"text": "Project is Claude Code analysis", "source": "core_memory"}],
        task_success=True,   # did the overall task succeed with this retrieval?
    )
    print(f"quality={score['final']:.2f}")  # 0.0-1.0

    # Heartbeat check:
    stats = quality_stats(since_hours=24)
    if stats["avg_quality"] < 0.4:
        print("WARNING: retrieval quality degraded!")

CLI:
    python skills/_retrieval_quality.py --stats
    python skills/_retrieval_quality.py --recent 10
"""

import json, re, sys, uuid
from pathlib import Path
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from typing import Optional

WORKSPACE = Path("C:/Users/Administrator/.openclaw/workspace")
QUALITY_LOG = WORKSPACE / "memory" / "_retrieval_quality.jsonl"

STOPWORDS = set("the a an is are were was be been being have has had do does did "
                "will would could should may might can must shall".split())


def _keywords(text: str) -> set[str]:
    if not text:
        return set()
    return set(w.lower() for w in re.findall(r"\w+", text) if w.lower() not in STOPWORDS)


def _jaccard(a: set[str], b: set[str]) -> float:
    if not a or not b:
        return 0.0
    return len(a & b) / max(len(a | b), 1)


# ── Scoring ────────────────────────────────────────────────────────────────

@dataclass
class RetrievalScore:
    retrieval_id: str
    timestamp: str
    query: str
    retrieved_count: int
    relevance: float      # avg Jaccard (query vs each retrieved doc)
    coverage: float        # fraction of query keywords covered
    novelty: float         # avg Jaccard between retrieved docs (lower=more overlap/redundant)
    task_success: bool     # did task succeed with this retrieval?
    final: float           # weighted combination
    quality_level: str     # "high" | "medium" | "low"

    def to_dict(self) -> dict:
        return asdict(self)


def score_retrieval(
    query: str,
    retrieved: list[dict],
    task_success: bool = True,
    retrieval_id: Optional[str] = None,
) -> RetrievalScore:
    """
    Score a retrieval event.

    Args:
        query: the search/query text
        retrieved: list of {"text": str, "source": str} dicts
        task_success: whether the task succeeded using these results
        retrieval_id: optional UUID (generated if not provided)

    Returns RetrievalScore with sub-scores and final quality rating.
    """
    retrieval_id = retrieval_id or str(uuid.uuid4())[:8]
    timestamp = datetime.now(timezone.utc).isoformat()
    query_kws = _keywords(query)

    if not retrieved:
        # No results = automatic low quality
        score = RetrievalScore(
            retrieval_id=retrieval_id,
            timestamp=timestamp,
            query=query[:200],
            retrieved_count=0,
            relevance=0.0,
            coverage=0.0,
            novelty=1.0,
            task_success=False,
            final=0.0,
            quality_level="low",
        )
        _log_score(score)
        return score

    # Relevance: avg Jaccard of query vs each retrieved doc
    relevances = []
    for doc in retrieved:
        doc_kws = _keywords(doc.get("text", ""))
        relevances.append(_jaccard(query_kws, doc_kws))
    relevance = sum(relevances) / len(relevances) if relevances else 0.0

    # Coverage: fraction of query keywords found in any retrieved doc
    all_retrieved_kws: set[str] = set()
    for doc in retrieved:
        all_retrieved_kws |= _keywords(doc.get("text", ""))
    coverage = len(query_kws & all_retrieved_kws) / max(len(query_kws), 1)

    # Novelty: avg pairwise Jaccard between retrieved docs (lower=more redundant)
    novelties = []
    for i in range(len(retrieved)):
        for j in range(i + 1, len(retrieved)):
            ki = _keywords(retrieved[i].get("text", ""))
            kj = _keywords(retrieved[j].get("text", ""))
            novelties.append(_jaccard(ki, kj))
    novelty = 1.0 - (sum(novelties) / len(novelties)) if novelties else 1.0

    # Task success bonus/penalty
    success_bonus = 0.1 if task_success else -0.15

    # Weighted final score
    final = round(0.5 * relevance + 0.3 * coverage + 0.2 * novelty + success_bonus, 3)
    final = max(0.0, min(1.0, final))

    if final >= 0.7:
        level = "high"
    elif final >= 0.4:
        level = "medium"
    else:
        level = "low"

    score = RetrievalScore(
        retrieval_id=retrieval_id,
        timestamp=timestamp,
        query=query[:200],
        retrieved_count=len(retrieved),
        relevance=round(relevance, 3),
        coverage=round(coverage, 3),
        novelty=round(novelty, 3),
        task_success=task_success,
        final=final,
        quality_level=level,
    )

    _log_score(score)
    return score


def _log_score(score: RetrievalScore) -> None:
    QUALITY_LOG.parent.mkdir(parents=True, exist_ok=True)
    with open(str(QUALITY_LOG), "a", encoding="utf-8") as f:
        f.write(json.dumps(score.to_dict(), ensure_ascii=False) + "\n")


# ── Stats ──────────────────────────────────────────────────────────────────

def quality_stats(since_hours: int = 24) -> dict:
    """Return quality statistics over a time window."""
    if not QUALITY_LOG.exists():
        return {"avg_quality": 1.0, "count": 0, "by_level": {}}

    cutoff = datetime.now(timezone.utc).timestamp() - since_hours * 3600
    scores = []
    counts = {"high": 0, "medium": 0, "low": 0}

    try:
        lines = QUALITY_LOG.read_text(encoding="utf-8").strip().split("\n")
        for line in lines:
            if not line.strip():
                continue
            try:
                d = json.loads(line)
                ts = datetime.fromisoformat(d["timestamp"]).timestamp()
                if ts < cutoff:
                    continue
                scores.append(d["final"])
                counts[d.get("quality_level", "?")] += 1
            except Exception:
                continue
    except Exception:
        pass

    total = len(scores)
    avg = sum(scores) / total if total > 0 else 1.0
    return {
        "avg_quality": round(avg, 3),
        "count": total,
        "high_count": counts["high"],
        "medium_count": counts["medium"],
        "low_count": counts["low"],
        "degraded": total > 0 and avg < 0.4,
    }


def recent_scores(limit: int = 10) -> list[RetrievalScore]:
    """Return most recent retrieval scores."""
    if not QUALITY_LOG.exists():
        return []
    scores = []
    try:
        lines = QUALITY_LOG.read_text(encoding="utf-8").strip().split("\n")
        for line in reversed(lines):
            if not line.strip():
                continue
            try:
                scores.append(RetrievalScore(**json.loads(line)))
            except Exception:
                continue
            if len(scores) >= limit:
                break
    except Exception:
        pass
    return scores


# ── CLI ──────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--stats":
        stats = quality_stats()
        print(f"Retrieval quality stats (24h):")
        print(f"  avg_quality: {stats['avg_quality']}")
        print(f"  total retrievals: {stats['count']}")
        print(f"  high/medium/low: {stats['high_count']}/{stats['medium_count']}/{stats['low_count']}")
        print(f"  DEGRADED: {stats.get('degraded', False)}")

    elif len(sys.argv) > 1 and sys.argv[1] == "--recent":
        limit = int(sys.argv[2]) if len(sys.argv) > 2 else 10
        scores = recent_scores(limit)
        print(f"Recent {len(scores)} retrieval score(s):")
        for s in scores:
            print(f"  [{s.quality_level}] q={s.final:.2f} r={s.relevance:.2f} c={s.coverage:.2f} "
                  f"n={s.novelty:.2f} retrieved={s.retrieved_count} | {s.query[:50]}")

    else:
        # Smoke test
        score = score_retrieval(
            query="What is the current project status?",
            retrieved=[
                {"text": "Project is Claude Code analysis", "source": "core_memory"},
                {"text": "User Administrator is working on Claude Code", "source": "session"},
            ],
            task_success=True,
        )
        print(f"Test score: {score.final} ({score.quality_level})")
        print(f"  relevance={score.relevance}, coverage={score.coverage}, novelty={score.novelty}")
        print("\nStats:")
        stats = quality_stats()
        print(f"  {stats}")
