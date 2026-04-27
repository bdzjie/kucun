"""
_context_budget.py — Context Window Budget Allocation

Dynamically allocates the context window budget across layers:
  core_memory / recent_episodic / retrieved_knowledge / current_turn

Based on Letta's Context Constitution and MemGPT's layered memory approach.

Usage:
    from skills._context_budget import ContextBudget, allocate_budget

    budget = ContextBudget(max_tokens=150_000)
    allocation = budget.allocate(skill_id="invest", priority="high")
    print(allocation)
    # {core_memory: 15000, recent_episodic: 45000, retrieved: 60000, current: 20000}

    # Or one-shot:
    result = allocate_budget("invest", "high", max_tokens=150_000)

CLI:
    python skills/_context_budget.py --plan invest high
    python skills/_context_budget.py --layers
"""

import json
import sys
from dataclasses import dataclass, field
from typing import Optional

DEFAULT_BUDGET_RATIOS = {
    "core_memory":      0.10,   # 10% — permanent high-priority facts
    "recent_episodic": 0.30,   # 30% — current task context
    "retrieved":       0.40,   # 40% — retrieval-augmented knowledge
    "current_turn":    0.20,   # 20% — minimum for current input
}

# Skill-specific overrides (higher priority = more budget for this skill's domain)
SKILL_BUDGET_OVERRIDES = {
    "invest":    {"retrieved": 0.50, "recent_episodic": 0.25, "core_memory": 0.10, "current_turn": 0.15},
    "research":  {"retrieved": 0.55, "recent_episodic": 0.20, "core_memory": 0.10, "current_turn": 0.15},
    "code":      {"core_memory": 0.20, "recent_episodic": 0.25, "retrieved": 0.35, "current_turn": 0.20},
    "creative":  {"current_turn": 0.30, "recent_episodic": 0.30, "retrieved": 0.25, "core_memory": 0.15},
}

# Priority modifiers
PRIORITY_MODIFIERS = {
    "critical": {"retrieved": +0.15, "current_turn": +0.10, "core_memory": -0.15, "recent_episodic": -0.10},
    "high":      {},
    "medium":    {"core_memory": -0.05, "retrieved": +0.05},
    "low":       {"retrieved": -0.10, "current_turn": +0.05, "recent_episodic": +0.05},
}


@dataclass
class BudgetAllocation:
    """Result of budget allocation across layers."""
    total: int                          # total context window size
    layers: dict[str, int] = field()    # layer_name -> token_budget
    skill_id: str = ""
    priority: str = ""
    overflow_tokens: int = 0           # tokens that exceed window
    truncated_layers: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "total": self.total,
            "layers": {k: int(v) for k, v in self.layers.items()},
            "skill_id": self.skill_id,
            "priority": self.priority,
            "overflow_tokens": self.overflow_tokens,
            "truncated_layers": self.truncated_layers,
        }


class ContextBudget:
    """
    Plans token budget allocation across memory layers.

    Strategy:
    1. Start from DEFAULT_BUDGET_RATIOS
    2. Apply skill-specific override (if skill_id in SKILL_BUDGET_OVERRIDES)
    3. Apply priority modifier
    4. Convert ratios to absolute token counts
    5. Enforce minimum floor (core_memory >= 2_000, current_turn >= 1_000)
    """

    MIN_CORE_MEMORY = 2_000
    MIN_CURRENT_TURN = 1_000

    def __init__(self, max_tokens: int = 150_000):
        self.max_tokens = max_tokens
        self._ratios = dict(DEFAULT_BUDGET_RATIOS)

    def allocate(self, skill_id: str = "", priority: str = "high",
                min_tokens: dict = None) -> BudgetAllocation:
        """
        Compute token budget allocation.

        Args:
            skill_id: which skill is being called (for skill-specific override)
            priority: critical | high | medium | low
            min_tokens: optional overrides for minimum floor per layer
        """
        ratios = self._compute_ratios(skill_id, priority)
        layers = {name: int(self.max_tokens * ratio) for name, ratio in ratios.items()}

        # Enforce minimum floors
        min_tokens = min_tokens or {}
        for layer, floor in [
            ("core_memory", min_tokens.get("core_memory", self.MIN_CORE_MEMORY)),
            ("current_turn", min_tokens.get("current_turn", self.MIN_CURRENT_TURN)),
        ]:
            if layers[layer] < floor:
                deficit = floor - layers[layer]
                layers[layer] = floor
                # Take deficit from the largest layer
                largest = max(layers, key=lambda k: layers[k])
                layers[largest] -= deficit

        # Detect overflow (> max_tokens total)
        total_allocated = sum(layers.values())
        overflow = max(0, total_allocated - self.max_tokens)
        truncated = []
        if overflow > 0:
            # Proportionally reduce non-floor layers
            reducible = {k: v for k, v in layers.items()
                         if k not in ("core_memory", "current_turn")}
            for layer in sorted(reducible, key=lambda k: -ratios.get(k, 0)):
                if overflow <= 0:
                    break
                reduction = min(layers[layer], int(overflow * 0.5))
                layers[layer] -= reduction
                overflow -= reduction
                truncated.append(layer)

        return BudgetAllocation(
            total=self.max_tokens,
            layers=layers,
            skill_id=skill_id,
            priority=priority,
            overflow_tokens=overflow,
            truncated_layers=truncated,
        )

    def _compute_ratios(self, skill_id: str, priority: str) -> dict[str, float]:
        ratios = dict(self._ratios)

        # Skill-specific override
        if skill_id and skill_id in SKILL_BUDGET_OVERRIDES:
            overrides = SKILL_BUDGET_OVERRIDES[skill_id]
            for layer, ratio in overrides.items():
                ratios[layer] = ratio

        # Priority modifier
        modifiers = PRIORITY_MODIFIERS.get(priority, {})
        for layer, delta in modifiers.items():
            ratios[layer] = max(0.0, ratios.get(layer, 0) + delta)

        # Re-normalize to sum to 1.0
        total = sum(ratios.values())
        if abs(total - 1.0) > 0.001:
            ratios = {k: v / total for k, v in ratios.items()}

        return ratios

    def what_if(self, skill_id: str, priority: str) -> dict:
        """
        Preview allocation without committing it.
        Useful for comparing different skill/priority combinations.
        """
        alloc = self.allocate(skill_id, priority)
        return alloc.to_dict()


# ── One-shot function ────────────────────────────────────────────────────────

def allocate_budget(skill_id: str = "", priority: str = "high",
                   max_tokens: int = 150_000) -> BudgetAllocation:
    budget = ContextBudget(max_tokens=max_tokens)
    return budget.allocate(skill_id=skill_id, priority=priority)


# ── CLI ──────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    budget = ContextBudget()

    if len(sys.argv) > 1 and sys.argv[1] == "--plan":
        skill_id = sys.argv[2] if len(sys.argv) > 2 else ""
        priority = sys.argv[3] if len(sys.argv) > 3 else "high"
        result = budget.allocate(skill_id=skill_id, priority=priority)
        print(f"Budget allocation for skill={skill_id or '(none)'} priority={priority}")
        print(f"  total: {result.total:,} tokens")
        for layer, tokens in result.layers.items():
            pct = tokens / result.total * 100
            print(f"  {layer:<20}: {tokens:>7,} tokens ({pct:.1f}%)")
        if result.overflow_tokens:
            print(f"  OVERFLOW: {result.overflow_tokens} tokens — truncated: {result.truncated_layers}")
        sys.exit(0)

    if len(sys.argv) > 1 and sys.argv[1] == "--layers":
        print("Default layer ratios:")
        for layer, ratio in DEFAULT_BUDGET_RATIOS.items():
            print(f"  {layer:<20}: {ratio:.0%}")
        print("\nSkill overrides:")
        for skill, overrides in SKILL_BUDGET_OVERRIDES.items():
            dominant = max(overrides, key=lambda k: overrides[k])
            print(f"  {skill}: dominant={dominant} ({overrides[dominant]:.0%})")
        print("\nPriority modifiers:")
        for p, mods in PRIORITY_MODIFIERS.items():
            print(f"  {p}: {mods or 'none'}")
        sys.exit(0)

    # Default: show baseline allocation
    result = budget.allocate()
    print(f"Baseline budget allocation (max_tokens={budget.max_tokens}):")
    for layer, tokens in result.layers.items():
        print(f"  {layer:<20}: {tokens:>7,} tokens")
