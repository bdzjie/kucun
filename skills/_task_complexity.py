"""
_task_complexity.py — Task Complexity Classifier

Decides whether to spawn a sub-agent based on message complexity.
  simple   → handle inline
  moderate → parallel skill calls
  complex  → spawn sub-agent

Based on patterns from ChatDev / AutoGen multi-agent research.

Usage:
    from skills._task_complexity import classify_complexity, should_spawn

    level = classify_complexity("Analyze Claude Code's tool system and summarize")
    spawn = should_spawn(level)
    print(f"level={level}, spawn={spawn}")

CLI:
    python skills/_task_complexity.py "Your message here"
"""

import re, sys
from dataclasses import dataclass
from enum import Enum
from typing import Optional

# ── Complexity Level ────────────────────────────────────────────────────────

class Level(Enum):
    SIMPLE    = "simple"
    MODERATE  = "moderate"
    COMPLEX   = "complex"


# ── Keyword Sets ─────────────────────────────────────────────────────────────

# Strong signals for HIGH complexity (+2 each)
HIGH_COMPLEXITY_KEYWORDS = [
    "analyze", "architect", "design system", "full stack", "end-to-end",
    "multi-agent", "workflow", "strategy", "evaluate",
    "reasoning", "trade-off", "explain why", "across the entire",
]

# Delegation keywords → immediately COMPLEX
DELEGATION_KEYWORDS = [
    "delegate", "spawn", "sub-agent", "handoff", "let another agent",
]

# Domain-switch keywords (+1 each, up to 2 = +2 max)
DOMAIN_SWITCH_KEYWORDS = [
    "write code", "debug", "refactor", "implement",
    "research", "web search", "scrape",
    "invest", "finance", "stock",
    "memory", "remember", "forget",
    "read file", "write file", "edit file",
]

# Keywords that indicate moderate complexity
MODERATE_KEYWORDS = [
    "investigate", "find all", "search for", "look up", "retrieve",
    "write a", "create a", "build a", "generate a",
    "compile", "collect", "gather", "list all",
    "compare", "differentiate",
    "summarize", "round up",
    "follow up",
    "recommend",
    "scrape", "crawl",
]


def _count_ask_patterns(text: str) -> int:
    """Count question/follow-up patterns."""
    patterns = [
        r"\b(what|why|how|when|where|which|who)\b.*\?",
        r"\b(can you|could you|would you)\b",
    ]
    return len([p for p in patterns if re.search(p, text, re.IGNORECASE)])


def _count_tool_mentions(text: str) -> int:
    """Count tool/skill mentions."""
    tools = ["bash", "read", "write", "edit", "glob", "grep",
             "web fetch", "web search", "invest", "web-scraping",
             "cone-memory", "session-search", "session-replay"]
    return sum(1 for t in tools if t in text.lower())


def _contains_all(text: str) -> bool:
    """Check if text contains 'all' as a separate word (not substring)."""
    return bool(re.search(r"\ball\b", text, re.IGNORECASE))


# ── Core Classifier ─────────────────────────────────────────────────────────

def classify_complexity(message: str, skill_id: Optional[str] = None) -> Level:
    """
    Classify a message into simple / moderate / complex.
    """
    if not message or not message.strip():
        return Level.SIMPLE

    text = message.strip()

    # ── Simple shortcuts ──────────────────────────────────────────────────
    # Single word / greeting / slash command
    if len(text.split()) <= 2 and re.match(r"^\s*(hi|hello|hey|thanks?|ok|okay|yes|no|lol|/)\w*$", text, re.IGNORECASE):
        return Level.SIMPLE

    # ── Delegation keyword → immediately COMPLEX ─────────────────────────
    if any(kw in text.lower() for kw in DELEGATION_KEYWORDS):
        return Level.COMPLEX

    # ── Score-based classification ──────────────────────────────────────
    score = 0

    # Length
    if len(text) > 200:
        score += 2
    elif len(text) > 80:
        score += 1

    # High-complexity keywords (+2 each)
    for kw in HIGH_COMPLEXITY_KEYWORDS:
        if kw in text.lower():
            score += 2

    # "all of / both / every" pattern → bumps to complex
    if re.search(r"\b(all of |both |every |entire )\b", text, re.IGNORECASE):
        score += 2

    # Question/follow-up density
    score += min(_count_ask_patterns(text), 3)

    # Tool mention density
    tool_count = _count_tool_mentions(text)
    if tool_count >= 3:
        score += 2
    elif tool_count >= 1:
        score += 1

    # "find all" phrase → moderate signal (not just "find")
    if re.search(r"\bfind all\b", text, re.IGNORECASE):
        score += 1

    # Domain switch keywords
    domain_matches = [kw for kw in DOMAIN_SWITCH_KEYWORDS if re.search(kw, text, re.IGNORECASE)]
    score += min(len(domain_matches), 2)

    # Moderate keyword presence
    for kw in MODERATE_KEYWORDS:
        if re.search(r"\b" + re.escape(kw) + r"\b", text, re.IGNORECASE):
            score += 1

    # Multi-part instruction (verb + 3+ words + noun)
    if re.search(r"\b(analyze|compare|evaluate|assess|review|explain)\b.*(\w+\s+){3,}\w+", text, re.IGNORECASE):
        score += 2

    # ── Map score to level ───────────────────────────────────────────────
    if score <= 2:
        return Level.SIMPLE
    elif score <= 4:
        return Level.MODERATE
    else:
        return Level.COMPLEX


def should_spawn(level: Optional[Level] = None, message: str = "", skill_id: Optional[str] = None) -> bool:
    """
    Returns True if a sub-agent should be spawned.
    Pass level directly, or pass message to classify first.
    """
    if level is None:
        level = classify_complexity(message, skill_id)
    return level == Level.COMPLEX


def complexity_reason(message: str) -> dict:
    """
    Return breakdown of complexity score.
    """
    if not message:
        return {"level": "simple", "score": 0, "factors": [], "should_spawn": False}

    text = message.strip()
    level = classify_complexity(message)
    score = 0
    factors = []

    if len(text) > 200:
        score += 2; factors.append("length>200")
    elif len(text) > 80:
        score += 1; factors.append("length>80")

    for kw in HIGH_COMPLEXITY_KEYWORDS:
        if kw in text.lower():
            score += 2; factors.append(f"high_kw:{kw}")

    if re.search(r"\b(all of |both |every |entire )\b", text, re.IGNORECASE):
        score += 2; factors.append("all_of_pattern")

    ask_count = _count_ask_patterns(text)
    if ask_count:
        score += min(ask_count, 3); factors.append(f"ask={ask_count}")

    tool_count = _count_tool_mentions(text)
    if tool_count:
        score += min(tool_count, 3) if tool_count < 3 else 2; factors.append(f"tools={tool_count}")

    if re.search(r"\bfind all\b", text, re.IGNORECASE):
        score += 1; factors.append("find_all")

    domain_matches = [kw for kw in DOMAIN_SWITCH_KEYWORDS if re.search(kw, text, re.IGNORECASE)]
    if domain_matches:
        score += min(len(domain_matches), 2)
        for kw in domain_matches[:2]:
            factors.append(f"domain:{kw[:15]}")

    for kw in MODERATE_KEYWORDS:
        if re.search(r"\b" + re.escape(kw) + r"\b", text, re.IGNORECASE):
            score += 1; factors.append(f"moderate_kw:{kw}"); break

    if re.search(r"\b(analyze|compare|evaluate|assess|review|explain)\b.*(\w+\s+){3,}\w+", text, re.IGNORECASE):
        score += 2; factors.append("multi_part_instruction")

    return {
        "level": level.value,
        "score": score,
        "factors": factors,
        "should_spawn": level == Level.COMPLEX,
    }


# ── CLI ─────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    if len(sys.argv) > 1:
        msg = " ".join(sys.argv[1:])
        reason = complexity_reason(msg)
        print(f"[{reason['level']}] score={reason['score']} spawn={reason['should_spawn']}")
        print(f"  factors: {', '.join(reason['factors']) if reason['factors'] else 'none'}")
        sys.exit(0)

    # Built-in test cases
    tests = [
        ("hi",                               "simple"),
        ("what time is it",                  "simple"),
        ("hello!",                           "simple"),
        ("invest AAPL",                       "simple"),
        ("find all files with 'TODO'",        "simple"),  # find via glob/skill, handled inline
        ("compare Claude Code vs GenericAgent architecture", "complex"),
        ("analyze the tool system and design a new routing strategy for it", "complex"),
        ("scrape news from BBC",              "simple"),  # single scrape via skill, handled inline
        ("delegate this to the memory agent", "complex"),
    ]
    print("Task Complexity Classifier tests:")
    all_ok = True
    for msg, expected in tests:
        level = classify_complexity(msg)
        ok = "OK" if level.value == expected else "FAIL"
        if level.value != expected:
            all_ok = False
        print(f"  {ok} [{level.value}] expected={expected}: {msg[:60]}")
    print(f"\nAll tests passed: {all_ok}")
