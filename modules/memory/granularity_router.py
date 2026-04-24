"""
granularity_router.py — Query Granularity Router

Maps an incoming query to the appropriate Cone Graph entry layer.

Layer selection rules (M-flow inspired):
  - Broad/thematic query  → Episode (summary match, penalized)
  - Mid-grained/topical   → Facet (topic keyword match)
  - Precise/atomic        → FacetPoint (content exact match)
  - Entity-centered       → Entity (cross-Episode bridge)

Uses lightweight rule-based classification + keyword heuristics.
"""

import re
from enum import Enum
from dataclasses import dataclass


class RetrievalLayer(Enum):
    EPISODE = "episode"
    FACET = "facet"
    FACETPOINT = "facetpoint"
    ENTITY = "entity"
    UNKNOWN = "unknown"


@dataclass
class RouterResult:
    layer: RetrievalLayer
    confidence: float  # 0.0–1.0
    keywords: list[str]
    reasoning: str


# ── Pattern definitions ───────────────────────────────────────────────────

# Episode indicators: broad, summary-like queries
EPISODE_PATTERNS = [
    (r"\bhow (did|did it|was|did|went)\b.*\b(g|go|goes|going)\b", 0.7),
    (r"\bwhat happened\b", 0.8),
    (r"\bwhat('s| is) the (status|progress|update)\b", 0.75),
    (r"\bhow('s| is| was).*(going|doing|doing)\b", 0.7),
    (r"\bsummary\b", 0.8),
    (r"\boverview\b", 0.7),
    (r"\brecap\b", 0.8),
    (r"\bwhy did\b", 0.6),
    (r"\btell me about\b", 0.5),
    # Chinese
    (r"怎么(样|了|回事)", 0.7),
    (r"怎么样了|怎么回事|是什么", 0.6),
    (r"总结|概述|回顾|复盘", 0.7),
    (r"整个.*过程|发生了什么", 0.6),
]

# Facet indicators: mid-grained, topical queries
FACET_PATTERNS = [
    (r"\b(issue|problem|bug|error|failure)\b.*\b(with|in|on)\b", 0.7),
    (r"\bperformance\b.*\b(slow|fast|issue|problem)\b", 0.7),
    (r"\bdeadline\b.*\b(communication|missed|delay)\b", 0.8),
    (r"\bcommunication\b.*\b(gap|issue|breakdown)\b", 0.8),
    (r"\b(technical|design|architecture)\b.*\b(decision|choice|issue)\b", 0.7),
    (r"\b(performance|security|reliability)\b.*\b(target|goal|requirement)\b", 0.7),
    # Chinese
    (r"(性能|安全|架构|设计|技术).*(问题|决策|方案|选择)", 0.7),
    (r"(deadline|截止日期|交付).*(沟通|延误|变更)", 0.8),
    (r"(沟通|协作|协调).*(问题|障碍|缺口)", 0.7),
    (r"(需求|功能|特性).*(变更|调整|修改)", 0.6),
]

# FacetPoint indicators: precise, atomic queries
FACETPOINT_PATTERNS = [
    (r"['\"].+['\"]", 0.9),  # quoted exact phrase
    (r"\bexactly\b.*\b(said|told|stated|mentioned)\b", 0.8),
    (r"\bwho (told|said|told|mentioned)\b.*\b(that|about)\b", 0.7),
    (r"\bwhat exactly\b", 0.6),
    (r"\bspecifically\b", 0.6),
    (r"\bprecisely\b", 0.6),
    (r"\bwas .+ (told|said|asked|mentioned|notified)\b", 0.7),
    # Chinese
    (r"['\"].+['\"]", 0.9),  # Chinese quotes
    (r"(具体|精确|准确).*(说|描述|告诉)", 0.7),
    (r"谁.+(说|告诉|提到|通知)", 0.7),
    (r"具体.+(是什么|怎么说|怎么做的)", 0.6),
]

# Entity indicators: name-anchored queries
ENTITY_PATTERNS = [
    (r"\b(anything|everything|all).*(about|with|on|related to)\b", 0.6),
    (r"\btell me about\b", 0.5),
    (r"\b(about|related to|concerning)\b.*\b(Maria|John|Project|Company)\b", 0.7),
    (r"关于.*的项目|关于.*的决定", 0.6),
    (r"关于.*的所有", 0.7),
]


def extract_keywords(text: str) -> list[str]:
    """Extract significant keywords from query (removing stopwords)."""
    stopwords = {
        "en": {"the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
               "have", "has", "had", "do", "does", "did", "will", "would", "could",
               "should", "may", "might", "can", "to", "of", "in", "for", "on", "with",
               "at", "by", "from", "as", "into", "through", "during", "before", "after",
               "above", "below", "between", "under", "again", "further", "then",
               "once", "here", "there", "when", "where", "why", "how", "all", "each",
               "other", "some", "these", "those", "what", "which", "who", "whom",
               "this", "that", "i", "me", "my", "we", "our", "you", "your", "he", "him",
               "she", "her", "it", "they", "them", "their", "and", "or", "but", "not",
               "no", "nor", "only", "own", "same", "so", "than", "too", "very", "just",
               "also", "now", "about", "up", "down", "out", "off", "over", "under"},
        "zh": {"的", "了", "是", "在", "有", "和", "与", "对", "为", "以", "于", "被",
               "把", "将", "给", "向", "到", "从", "由", "是", "我", "你", "他", "她",
               "它", "我们", "你们", "他们", "这", "那", "这个", "那个", "什么", "怎么",
               "如何", "为什么", "吗", "呢", "吧", "啊", "哦", "嗯"}
    }

    # Split on whitespace and punctuation
    words = re.split(r"[\s,.!?;:，。！？；：、]+", text.lower())
    keywords = [w for w in words if len(w) > 1 and w not in stopwords["en"]
                and w not in stopwords["zh"] and not w.isdigit()]
    return keywords


def classify(text: str) -> RouterResult:
    """
    Classify query granularity and return routing decision.

    Returns:
        RouterResult with layer, confidence, keywords, and reasoning
    """
    text_lower = text.lower()

    # Score each layer
    scores: dict[RetrievalLayer, float] = {
        RetrievalLayer.EPISODE: 0.0,
        RetrievalLayer.FACET: 0.0,
        RetrievalLayer.FACETPOINT: 0.0,
        RetrievalLayer.ENTITY: 0.0,
    }

    # Pattern-based scoring
    for pattern, weight in EPISODE_PATTERNS:
        if re.search(pattern, text_lower):
            scores[RetrievalLayer.EPISODE] += weight

    for pattern, weight in FACET_PATTERNS:
        if re.search(pattern, text_lower):
            scores[RetrievalLayer.FACET] += weight

    for pattern, weight in FACETPOINT_PATTERNS:
        if re.search(pattern, text_lower):
            scores[RetrievalLayer.FACETPOINT] += weight

    for pattern, weight in ENTITY_PATTERNS:
        if re.search(pattern, text_lower):
            scores[RetrievalLayer.ENTITY] += weight

    # Entity name detection (if query contains a known entity name)
    # This is a simple heuristic - presence of capitalized words
    capitalized = re.findall(r"\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b", text)
    if capitalized:
        scores[RetrievalLayer.ENTITY] += 0.3

    # Keyword count heuristic
    keywords = extract_keywords(text)
    if len(keywords) <= 3:
        scores[RetrievalLayer.FACETPOINT] += 0.2  # short = precise
    elif len(keywords) >= 8:
        scores[RetrievalLayer.EPISODE] += 0.2  # long = broad

    # Pick highest-scoring layer
    best_layer = max(scores, key=lambda k: scores[k])
    best_score = scores[best_layer]

    # Threshold: if all scores are low, default to EPISODE
    if best_score < 0.3:
        best_layer = RetrievalLayer.EPISODE
        best_score = max(0.3, best_score)

    reasoning = (
        f"layer={best_layer.value} "
        f"conf={best_score:.2f} "
        f"keywords={keywords[:5]}"
    )

    return RouterResult(
        layer=best_layer,
        confidence=min(best_score, 1.0),
        keywords=keywords,
        reasoning=reasoning,
    )


# ─── CLI ───────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Granularity Router CLI")
    parser.add_argument("query", nargs="*", help="Query text (or --query)")
    parser.add_argument("--query", dest="query_text", help="Query text")
    args = parser.parse_args()

    query = args.query_text or " ".join(args.query)

    result = classify(query)
    print(f"Query: {query}")
    print(f"Layer: {result.layer.value} (confidence: {result.confidence:.2f})")
    print(f"Keywords: {result.keywords}")
