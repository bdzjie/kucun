"""
routing_feedback_analyzer.py — Nightly analysis of Expert Router feedback
=======================================================================

分析路由反馈数据，调整 expert 权重建议。
由 Cron job 每晚调用。

Usage:
  python modules/routing_feedback_analyzer.py
"""

import json
import sys
import os
from datetime import datetime, timedelta
from pathlib import Path
from collections import defaultdict

STATE_DIR = Path.home() / ".openclaw"
FEEDBACK_FILE = STATE_DIR / ".openclaw/memory/routing_feedback.jsonl"
WEIGHTS_FILE = STATE_DIR / ".openclaw/memory/routing_weights.json"
ANALYSIS_LOG = STATE_DIR / ".openclaw/memory/routing_analysis_log.jsonl"


def load_feedback():
    """Load all feedback entries."""
    if not FEEDBACK_FILE.exists():
        return []

    entries = []
    with open(FEEDBACK_FILE, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                try:
                    entries.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
    return entries


def analyze_expert_quality(entries):
    """Analyze each expert's success rate and quality distribution."""
    expert_stats = defaultdict(lambda: {"good": 0, "partial": 0, "poor": 0, "total": 0, "tool_calls": []})

    for entry in entries:
        expert = entry.get("expert", "unknown")
        quality = entry.get("quality", "partial")
        success = entry.get("taskSuccess", False)
        tool_calls = entry.get("toolCallCount", 0)
        max_calls = entry.get("expectedToolCalls", 3)

        expert_stats[expert]["total"] += 1
        expert_stats[expert]["tool_calls"].append(tool_calls)

        if success and quality == "good":
            expert_stats[expert]["good"] += 1
        elif quality == "poor" or not success:
            expert_stats[expert]["poor"] += 1
        else:
            expert_stats[expert]["partial"] += 1

    return dict(expert_stats)


def analyze_depth_mismatch(entries):
    """Check if depth mode consistently under/over-shoots tool call budget."""
    depth_stats = defaultdict(lambda: {"over_budget": 0, "under_budget": 0, "at_budget": 0, "total": 0})

    for entry in entries:
        depth = entry.get("depth", "normal")
        actual = entry.get("toolCallCount", 0)
        expected = entry.get("expectedToolCalls", 3)

        depth_stats[depth]["total"] += 1
        if actual >= expected:
            depth_stats[depth]["over_budget"] += 1
        elif actual < expected * 0.5:
            depth_stats[depth]["under_budget"] += 1
        else:
            depth_stats[depth]["at_budget"] += 1

    return dict(depth_stats)


def compute_weight_adjustments(expert_stats, depth_stats):
    """Compute suggested weight adjustments based on feedback."""
    adjustments = []
    recommendations = []

    # Expert-level adjustments
    for expert, stats in expert_stats.items():
        if stats["total"] < 3:
            continue

        success_rate = stats["good"] / stats["total"]
        avg_calls = sum(stats["tool_calls"]) / len(stats["tool_calls"])

        if success_rate < 0.5:
            adjustments.append({
                "expert": expert,
                "action": "reduce",
                "reason": f"success_rate={success_rate:.1%}, samples={stats['total']}",
                "confidence": "low" if stats["total"] < 10 else "medium",
            })
            recommendations.append(
                f"WARN: {expert} success rate {success_rate:.0%} ({stats['total']} samples) — "
                f"below 50%. Consider reviewing routing criteria or skill chain."
            )
        elif success_rate > 0.9 and stats["total"] >= 5:
            adjustments.append({
                "expert": expert,
                "action": "promote",
                "reason": f"success_rate={success_rate:.1%}, samples={stats['total']}",
                "confidence": "high",
            })
            recommendations.append(
                f"OK: {expert} performing well ({success_rate:.0%} success, {stats['total']} samples)"
            )

        # Tool call analysis per expert
        for depth, dstats in depth_stats.items():
            if dstats["total"] < 3:
                continue
            over_pct = dstats["over_budget"] / dstats["total"]
            if over_pct > 0.5:
                recommendations.append(
                    f"HINT: {depth} mode overshoots budget {over_pct:.0%} of the time "
                    f"({dstats['over_budget']}/{dstats['total']}). "
                    f"Consider auto-upgrading to deeper mode for {expert} tasks."
                )

    return adjustments, recommendations


def generate_report():
    """Generate full analysis report."""
    entries = load_feedback()

    if not entries:
        print("No feedback entries found.")
        return

    # Filter to last 7 days
    cutoff = datetime.now() - timedelta(days=7)
    recent = [
        e for e in entries
        if datetime.fromtimestamp(e["timestamp"] / 1000) > cutoff
    ]

    if not recent:
        print(f"No feedback entries in the last 7 days (total: {len(entries)}).")
        return

    expert_stats = analyze_expert_quality(recent)
    depth_stats = analyze_depth_mismatch(recent)
    adjustments, recommendations = compute_weight_adjustments(expert_stats, depth_stats)

    report = {
        "generatedAt": datetime.now().isoformat(),
        "period": "7d",
        "totalEntries": len(recent),
        "expertStats": expert_stats,
        "depthStats": depth_stats,
        "adjustments": adjustments,
        "recommendations": recommendations,
    }

    # Log to file
    with open(ANALYSIS_LOG, "a", encoding="utf-8") as f:
        f.write(json.dumps(report, ensure_ascii=False) + "\n")

    return report


if __name__ == "__main__":
    print("=" * 60)
    print("Expert Router — Nightly Feedback Analysis")
    print(f"Time: {datetime.now().isoformat()}")
    print("=" * 60)

    report = generate_report()

    if report:
        print(f"\nAnalyzed {report['totalEntries']} feedback entries over {report['period']}.")
        print(f"\nRecommendations:")
        for rec in report.get("recommendations", []):
            print(f"  • {rec}")

        if report.get("adjustments"):
            print(f"\nWeight Adjustments:")
            for adj in report["adjustments"]:
                print(f"  [{adj['action']:8}] {adj['expert']} — {adj['reason']} (confidence: {adj['confidence']})")
    else:
        print("No analysis generated.")
