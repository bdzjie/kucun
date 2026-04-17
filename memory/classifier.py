#!/usr/bin/env python3
"""
classifier.py — 5-Type Memory Classifier for OpenClaw

No LLM required. Pure keyword/pattern heuristics.
Classifies memory entries into 5 types:
  1. DECISIONS    — choices made, trade-offs considered
  2. PREFERENCES  — habits, likes, dislikes, conventions
  3. MILESTONES   — breakthroughs, things that finally worked
  4. PROBLEMS     — what broke, root causes, solutions
  5. EMOTIONAL    — feelings, vulnerability, relationships

Usage:
    from classifier import classify, MemoryType
    
    result = classify("we decided to go with PostgreSQL because...")
    print(result.type)      # MemoryType.DECISION
    print(result.confidence)  # 0.85
    print(result.signals)   # ["decided", "because", "trade-off"]
"""

import re
from dataclasses import dataclass
from enum import Enum
from typing import List, Optional, Tuple


class MemoryType(Enum):
    DECISION = "decision"
    PREFERENCE = "preference"
    MILESTONE = "milestone"
    PROBLEM = "problem"
    EMOTIONAL = "emotional"
    UNKNOWN = "unknown"


@dataclass
class ClassificationResult:
    type: MemoryType
    confidence: float
    signals: List[str]
    original_text: str


# =============================================================================
# MARKER SETS — One per memory type
# =============================================================================

DECISION_MARKERS = [
    r"\b(we|I)\s+(decided|chose|went with|picked|settled on|agreed)\b",
    r"\blet'?s\s+(use|go with|try|pick|choose|switch to)\b",
    r"\bbetter\s+(to|than|approach|option|choice)\b",
    r"\binstead\s+of\b",
    r"\brather\s+than\b",
    r"\bthe\s+reason\s+(is|was|being)\b",
    r"\bbecause\b.*\b(so|therefore|hence)\b",
    r"\btrade-?off\b",
    r"\bpros\s+and\s+cons\b",
    r"\barchitecture\s+decision\b",
    r"\btech\s+stack\b",
    r"\b(stack|framework|infrastructure)\s+(decision|choice|selected)\b",
    r"\bwe\s+(should|must|need\s+to)\s+(go\s+with|choose|pick|use)\b",
    r"\bapproach\b.*\b(chosen|selected|decided)\b",
    r"\b strategy\b",
    r"\bset\s+(it\s+|this\s+)?to\b",
    r"\bconfigured?\b",
    r"\bdefault\s+(is|was|to)\b",
    r"\bmigrated?\b.*\bto\b",
    r"\bswitched?\b.*\bfrom\b.*\bto\b",
    r"\babandoned?\b.*\bin\s+favor\s+of\b",
    r"\bdeprecated?\b",
]

PREFERENCE_MARKERS = [
    r"\bI\s+prefer\b",
    r"\bI\s+like\b.*\b(style|way|approach)\b",
    r"\bI\s+hate\b.*\b(when|how)\b",
    r"\balways\s+use\b",
    r"\bnever\s+use\b",
    r"\bdon'?t\s+ever\b",
    r"\bmy\s+(rule|preference|style|convention)\s+is\b",
    r"\bwe\s+(always|never)\b",
    r"\bplease\s+(always|never|don'?t)\b",
    r"\bstyle\s+guide\b",
    r"\bnaming\s+convention\b",
    r"\bsnake_?case\b",
    r"\bcamel_?case\b",
    r"\bpascal_?case\b",
    r"\bkebab-?case\b",
    r"\btabs\b.*\bspaces\b",
    r"\bspaces\b.*\btabs\b",
    r"\blinting\b.*\b(rule|format|config)\b",
    r"\bcode\s+review\b.*\b(prefer|like|hate)\b",
    r"\bcommit\s+(message|style|convention)\b",
    r"\bgit\s+flow\b",
    r"\bbranching\s+strategy\b",
    r"\bCI\s+(pipeline|config)\b.*\bprefer\b",
    r"\bfunctional\b.*\bstyle\b",
    r"\bimperative\b.*\bvs\b",
    r"\bobject-?oriented\b.*\bstyle\b",
]

MILESTONE_MARKERS = [
    r"\bit\s+works\b",
    r"\bit\s+worked\b",
    r"\bgot\s+it\s+working\b",
    r"\bfixed\b.*\b(once\s+and\s+for\s+all|finally)\b",
    r"\bsolved\b",
    r"\tbreakthrough\b",
    r"\bfigured\s+(it\s+)?out\b",
    r"\bnailed\s+it\b",
    r"\bcracked\s+(it|the)\b",
    r"\bfinally\b",
    r"\bfirst\s+time\b",
    r"\bfirst\s+ever\b",
    r"\bnever\s+(done|been|had)\s+before\b",
    r"\bdiscovered\b",
    r"\brealized\b",
    r"\bfound\s+(out|that)\b",
    r"\bturns\s+out\b",
    r"\bthe\s+key\s+(insight|is|was)\b",
    r"\bthe\s+trick\s+(is|was)\b",
    r"\bnow\s+I\s+(understand|see|get\s+it)\b",
    r"\bbuilt\b.*\b(from\s+scratch|ourselves)\b",
    r"\bcreated\b.*\b(original|first)\b",
    r"\bimplemented\b.*\b(from\s+scratch)\b",
    r"\bshipped\b",
    r"\blaunched\b",
    r"\bdeployed\b.*\b(production|prod)\b",
    r"\breleased\b",
    r"\bprototype\b",
    r"\bproof\s+of\s+concept\b",
    r"\bdemo\b.*\b(ready|works)\b",
    r"\bv\d+\.\d+\s+(released|deployed|shipped)\b",
    r"\b\d+x\s+(faster|better|improvement)\b",
    r"\b\d+%\s+(reduction|improvement|faster|better)\b",
    r"\bfinished\b",
    r"\bcompleted\b",
    r"\bdone\b.*\b(finally|at\s+last)\b",
]

PROBLEM_MARKERS = [
    r"\b(bug|error|crash|fail|broke|broken|issue)\b",
    r"\bdoesn'?t\s+work\b",
    r"\bnot\s+working\b",
    r"\bwon'?t\b.*\bwork\b",
    r"\bkeeps?\s+(failing|crashing|breaking)\b",
    r"\broot\s+cause\b",
    r"\bthe\s+(problem|issue|bug)\s+(is|was)\b",
    r"\bturns\s+out\b.*\b(was|because|due\s+to)\b",
    r"\bthe\s+fix\s+(is|was)\b",
    r"\bworkaround\b",
    r"\bthat'?s\s+why\b",
    r"\bthe\s+reason\s+it\b",
    r"\bfixed\s+(it\s+the\s+|by\s+)\b",
    r"\bsolution\s+(is|was)\b",
    r"\bresolved\b",
    r"\bpatched\b",
    r"\bthe\s+answer\s+(is|was)\b",
    r"\b(had|need)\s+to\b.*\binstead\b",
    r"\bstruggled?\s+with\b",
    r"\bstuck\s+on\b",
    r"\bblocked\s+by\b",
    r"\bspike\b.*\b(hours|days|weeks)\b",
    r"\btried\b.*\bbut\s+failed\b",
    r"\bdebugging\b.*\bfor\s+(hours|days)\b",
    r"\btook\s+forever\b.*\b(find|fix)\b",
]

EMOTION_MARKERS = [
    r"\bI\s+feel\b",
    r"\bI'?m\s+(scared|worried|anxious|nervous)\b",
    r"\bI\s+(love|hate)\b",
    r"\bI'?m\s+(proud|excited|thrilled)\b",
    r"\bI\s+(miss|need|want)\b",
    r"\bi\s+wish\b",
    r"\bI'?m\s+(sorry|grateful)\b",
    r"\bI\s+(can'?t|couldn'?t)\b.*\b(believe|understand|explain)\b",
    r"\bnever\s+told\s+anyone\b",
    r"\bnobody\s+knows\b",
    r"\b\*[^*]+\*\b",  # *italic markers* often indicate emotion
    r"\blove\s+(the\s+way|how|it\s+when)\b",
    r"\b(proud|happy)\s+(of|to)\b.*\b(you|we|team)\b",
    r"\b(beautiful|amazing|wonderful|incredible)\b.*\b(thing|work|job)\b",
    r"\bheartwarming\b",
    r"\btouching\b",
    r"\brelieved\b.*\b(that|to)\b",
    r"\bpanicked?\b",
    r"\bterrified\b",
    r"\bhurt\b.*\b(when|that|to)\b",
    r"\blaughed?\b",
    r"\bsmiled?\b",
    r"\bcried?\b",
    r"\bemotional\b",
    r"\bvulnerable\b",
    r"\bhonest(?:ly)?\b.*\b(feel|think|believe)\b",
    r"\braw\b.*\b(thought|feeling|honest)\b",
]

ALL_MARKERS = {
    MemoryType.DECISION: DECISION_MARKERS,
    MemoryType.PREFERENCE: PREFERENCE_MARKERS,
    MemoryType.MILESTONE: MILESTONE_MARKERS,
    MemoryType.PROBLEM: PROBLEM_MARKERS,
    MemoryType.EMOTIONAL: EMOTION_MARKERS,
}


# =============================================================================
# SENTIMENT — for disambiguation
# =============================================================================

POSITIVE_WORDS = {
    "proud", "joy", "happy", "love", "beautiful", "amazing", "wonderful",
    "fantastic", "brilliant", "perfect", "excited", "thrilled", "grateful",
    "warm", "breakthrough", "success", "works", "working", "solved", "fixed",
    "nailed", "love", "adore", "relieved",
}

NEGATIVE_WORDS = {
    "bug", "error", "crash", "crashing", "failed", "failing", "failure",
    "broken", "broke", "breaking", "issue", "problem", "wrong", "stuck",
    "blocked", "terrible", "horrible", "awful", "worst", "panic", "disaster",
    "mess", "frustrated", "angry", "scared", "worried",
}


def _get_sentiment(text: str) -> str:
    """Quick sentiment: 'positive', 'negative', or 'neutral'."""
    words = set(w.lower() for w in re.findall(r"\b\w+\b", text))
    pos = len(words & POSITIVE_WORDS)
    neg = len(words & NEGATIVE_WORDS)
    if pos > neg:
        return "positive"
    elif neg > pos:
        return "negative"
    return "neutral"


def _has_resolution(text: str) -> bool:
    """Check if text describes a RESOLVED problem."""
    patterns = [
        r"\bfixed\b", r"\bsolved\b", r"\bresolved\b", r"\bpatched\b",
        r"\bit\s+works\b", r"\bnailed\s+it\b", r"\bfigured\s+(it\s+)?out\b",
        r"\bthe\s+(fix|answer|solution)\b",
    ]
    text_lower = text.lower()
    return any(re.search(p, text_lower) for p in patterns)


# =============================================================================
# CODE LINE FILTERING
# =============================================================================

_CODE_LINE_PATTERNS = [
    re.compile(r"^\s*[\$#]\s"),
    re.compile(r"^\s*(cd|source|echo|export|pip|npm|git|python|bash|curl|wget|mkdir|rm|cp|mv|ls|cat|grep|find|chmod|sudo|brew|docker)\s"),
    re.compile(r"^\s*```"),
    re.compile(r"^\s*(import|from|def|class|function|const|let|var|return)\s"),
    re.compile(r"^\s*[A-Z_]{2,}="),
    re.compile(r"^\s*\|"),
    re.compile(r"^\s*[-]{2,}"),
    re.compile(r"^\s*[{}\[\]]\s*$"),
    re.compile(r"^\s*(if|for|while|try|except|elif|else:)\b"),
    re.compile(r"^\s*\w+\.\w+\("),
    re.compile(r"^\s*\w+\s*=\s*\w+\.\w+"),
]


def _is_code_line(line: str) -> bool:
    stripped = line.strip()
    if not stripped:
        return False
    for pattern in _CODE_LINE_PATTERNS:
        if pattern.match(stripped):
            return True
    alpha_ratio = sum(1 for c in stripped if c.isalpha()) / max(len(stripped), 1)
    if alpha_ratio < 0.4 and len(stripped) > 10:
        return True
    return False


def _extract_prose(text: str) -> str:
    """Extract only prose lines (skip code) for classification scoring."""
    lines = text.split("\n")
    prose = []
    in_code = False
    for line in lines:
        if line.strip().startswith("```"):
            in_code = not in_code
            continue
        if in_code:
            continue
        if not _is_code_line(line):
            prose.append(line)
    result = "\n".join(prose).strip()
    return result if result else text


# =============================================================================
# SCORING
# =============================================================================


def _score_markers(text: str, markers: List[str]) -> Tuple[float, List[str]]:
    """Score text against regex markers. Returns (score, matched_keywords)."""
    text_lower = text.lower()
    score = 0.0
    keywords = []
    for marker in markers:
        try:
            matches = re.findall(marker, text_lower)
            if matches:
                score += len(matches)
                keywords.extend(m if isinstance(m, str) else m[0] if m else marker for m in matches)
        except re.error:
            continue
    return score, list(set(keywords))


def _disambiguate(memory_type: MemoryType, text: str, scores: dict) -> MemoryType:
    """Fix misclassifications using sentiment + resolution."""
    if memory_type == MemoryType.UNKNOWN:
        return memory_type
    
    sentiment = _get_sentiment(text)

    # Resolved problems are milestones
    if memory_type == MemoryType.PROBLEM and _has_resolution(text):
        if scores.get(MemoryType.EMOTIONAL, 0) > 0 and sentiment == "positive":
            return MemoryType.EMOTIONAL
        return MemoryType.MILESTONE

    # Problem + positive sentiment → milestone or emotional
    if memory_type == MemoryType.PROBLEM and sentiment == "positive":
        if scores.get(MemoryType.MILESTONE, 0) > 0:
            return MemoryType.MILESTONE
        if scores.get(MemoryType.EMOTIONAL, 0) > 0:
            return MemoryType.EMOTIONAL

    return memory_type


# =============================================================================
# MAIN CLASSIFICATION
# =============================================================================


def classify(text: str, min_confidence: float = 0.2) -> ClassificationResult:
    """
    Classify a text string into one of 5 memory types.
    
    Args:
        text: The text to classify
        min_confidence: Minimum confidence threshold (0.0-1.0)
        
    Returns:
        ClassificationResult with type, confidence, signals
    """
    if not text or len(text.strip()) < 20:
        return ClassificationResult(
            type=MemoryType.UNKNOWN,
            confidence=0.0,
            signals=[],
            original_text=text[:200] if text else "",
        )
    
    # Extract prose (skip code lines)
    prose = _extract_prose(text)
    
    # Score against all types
    scores = {}
    all_signals = {}
    for mem_type, markers in ALL_MARKERS.items():
        score, keywords = _score_markers(prose, markers)
        if score > 0:
            scores[mem_type] = score
            all_signals[mem_type] = keywords
    
    if not scores:
        return ClassificationResult(
            type=MemoryType.UNKNOWN,
            confidence=0.0,
            signals=[],
            original_text=text[:200],
        )
    
    # Length bonus
    if len(prose) > 500:
        length_bonus = 2
    elif len(prose) > 200:
        length_bonus = 1
    else:
        length_bonus = 0
    
    # Get best match
    max_type = max(scores, key=scores.get)
    max_score = scores[max_type] + length_bonus
    
    # Disambiguate
    max_type = _disambiguate(max_type, prose, scores)
    
    # Calculate confidence
    confidence = min(1.0, max_score / 5.0)
    
    if confidence < min_confidence:
        return ClassificationResult(
            type=MemoryType.UNKNOWN,
            confidence=confidence,
            signals=[],
            original_text=text[:200],
        )
    
    return ClassificationResult(
        type=max_type,
        confidence=round(confidence, 2),
        signals=all_signals.get(max_type, []),
        original_text=text[:200],
    )


def classify_batch(texts: list, min_confidence: float = 0.3) -> List[ClassificationResult]:
    """Classify multiple texts."""
    return [classify(t, min_confidence) for t in texts]


def stats_by_type(results: List[ClassificationResult]) -> dict:
    """Get statistics from a batch of classification results."""
    from collections import Counter
    
    type_counts = Counter(r.type for r in results)
    total = len(results)
    
    return {
        "total": total,
        "by_type": {
            t.value: {
                "count": type_counts.get(t, 0),
                "percentage": round(type_counts.get(t, 0) / total * 100, 1) if total > 0 else 0,
            }
            for t in MemoryType
        },
        "average_confidence": round(
            sum(r.confidence for r in results) / total, 2
        ) if total > 0 else 0,
    }


if __name__ == "__main__":
    import sys
    import json
    
    if len(sys.argv) < 2:
        print("Usage: classifier.py <text>")
        print("Classifies text into: decision/preference/milestone/problem/emotional")
        sys.exit(1)
    
    text = sys.argv[1]
    result = classify(text)
    
    print(json.dumps({
        "type": result.type.value,
        "confidence": result.confidence,
        "signals": result.signals,
        "text": result.original_text[:100],
    }, indent=2))
