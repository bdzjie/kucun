"""
deep_reflection.py — OpenMythos-style deep reasoning self-analysis
=================================================================
分析 Expert Router 的决策质量 + 深度推理链有效性。

触发时机（每 4 小时一次）:
  - 分析最近 4h 的 routing 反馈
  - 识别置信度边界案例（0.75-0.85）
  - 评估 deep mode 任务是否真正需要深度
  - 生成自我改进建议

输出到: memory/dreaming/deep/<timestamp>.md
"""

import json
import os
from datetime import datetime, timedelta
from pathlib import Path
from collections import defaultdict

STATE_DIR = Path.home() / ".openclaw"
FEEDBACK_FILE = STATE_DIR / ".openclaw/memory/routing_feedback.jsonl"
OUTPUT_DIR = STATE_DIR / ".openclaw/memory/dreaming/deep"

QUALITY_REPORT = """
# 🧠 Deep Reflection — {timestamp}

## 分析窗口
- 时间范围: {window_start} → {window_end}
- 反馈记录数: {total_entries}

---

## Expert 分布
{expert_dist}

---

## 深度模式分布
{depth_dist}

---

## 置信度分布
{confidence_buckets}

---

## 边界案例（置信度 0.70-0.85）
{borderline_cases}

---

## Deep Mode 有效性
{deep_analysis}

---

## 自我改进建议
{recommendations}

---

*由 deep_reflection.py 自动生成 · Expert Router v2*
"""


def load_recent_feedback(hours=4):
    if not FEEDBACK_FILE.exists():
        return []

    cutoff = datetime.now() - timedelta(hours=hours)
    entries = []
    with open(FEEDBACK_FILE, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
                ts = datetime.fromtimestamp(entry["timestamp"] / 1000)
                if ts > cutoff:
                    entries.append(entry)
            except (json.JSONDecodeError, KeyError, OSError):
                continue
    return entries


def analyze_confidence_buckets(entries):
    buckets = {
        "high (>0.9)": [],
        "good (0.8-0.9)": [],
        "borderline (0.7-0.8)": [],
        "low (0.5-0.7)": [],
        "very low (<0.5)": [],
    }
    for e in entries:
        c = e.get("confidence", 0)
        if c > 0.9:
            buckets["high (>0.9)"].append(e)
        elif c >= 0.8:
            buckets["good (0.8-0.9)"].append(e)
        elif c >= 0.7:
            buckets["borderline (0.7-0.8)"].append(e)
        elif c >= 0.5:
            buckets["low (0.5-0.7)"].append(e)
        else:
            buckets["very low (<0.5)"].append(e)
    return buckets


def analyze_deep_effectiveness(entries):
    deep_entries = [e for e in entries if e.get("depth") == "deep"]
    if not deep_entries:
        return "无 deep mode 记录"

    success_count = sum(1 for e in deep_entries if e.get("taskSuccess"))
    avg_calls = sum(e.get("toolCallCount", 0) for e in deep_entries) / len(deep_entries)
    expected_calls = 8

    rate = success_count / len(deep_entries)
    return (
        f"deep mode 任务: {len(deep_entries)} 个\n"
        f"  成功率: {rate:.0%}\n"
        f"  平均 Tool Calls: {avg_calls:.1f} / {expected_calls} 预期\n"
        f"  结论: {'✅ 有效 — deep mode 任务成功率高' if rate > 0.7 else '⚠️ 效果一般 — 考虑调整 deep 触发条件'}"
    )


def generate_recommendations(buckets, expert_stats, depth_stats):
    recs = []

    # Borderline 分析
    borderline = buckets.get("borderline (0.7-0.8)", [])
    if len(borderline) >= 3:
        recs.append(f"⚠️  置信度边界（0.7-0.8）有 {len(borderline)} 个案例，建议增加训练数据或调整阈值")

    # Expert 分布
    if expert_stats:
        low_experts = [e for e, s in expert_stats.items() if s["total"] >= 3 and s["good"] / s["total"] < 0.6]
        for e in low_experts:
            recs.append(f"🔧 Expert '{e}' 成功率偏低，建议审查路由关键词或技能链配置")

    # Deep mode 效率
    deep_under = depth_stats.get("deep", {}).get("under_budget", 0)
    deep_total = depth_stats.get("deep", {}).get("total", 0)
    if deep_total >= 3 and deep_under / deep_total > 0.5:
        recs.append(f"💡 deep mode 有 {deep_under}/{deep_total} 任务未用满预算，考虑降低 deep 触发置信度阈值")

    if not recs:
        recs.append("✅ Expert Router 整体表现良好，无需紧急调整")

    return "\n".join(f"- {r}" for r in recs)


def main():
    print(f"[deep_reflection] Starting analysis at {datetime.now().isoformat()}")

    entries = load_recent_feedback(hours=4)
    print(f"[deep_reflection] Found {len(entries)} entries in last 4 hours")

    if not entries:
        print("[deep_reflection] No recent feedback, skipping.")
        return

    # Expert stats
    expert_stats = defaultdict(lambda: {"good": 0, "poor": 0, "total": 0})
    depth_stats = defaultdict(lambda: {"over_budget": 0, "under_budget": 0, "total": 0})

    for e in entries:
        expert_stats[e.get("expert", "unknown")]["total"] += 1
        if e.get("taskSuccess"):
            expert_stats[e.get("expert", "unknown")]["good"] += 1
        else:
            expert_stats[e.get("expert", "unknown")]["poor"] += 1

        depth = e.get("depth", "normal")
        actual = e.get("toolCallCount", 0)
        expected = e.get("expectedToolCalls", 3)
        depth_stats[depth]["total"] += 1
        if actual >= expected:
            depth_stats[depth]["over_budget"] += 1
        else:
            depth_stats[depth]["under_budget"] += 1

    # Confidence buckets
    buckets = analyze_confidence_buckets(entries)
    bucket_summary = "\n".join(
        f"  {k}: {len(v)} 个" for k, v in buckets.items()
    )

    # Expert distribution
    expert_dist = "\n".join(
        f"  {k}: {v['total']} 次 ({(v['good']/max(v['total'],1))*100:.0f}% 成功)" 
        for k, v in sorted(expert_stats.items(), key=lambda x: x[1]["total"], reverse=True)
    )

    # Depth distribution
    depth_dist = "\n".join(
        f"  {k}: {v['total']} 次" for k, v in depth_stats.items()
    )

    # Borderline cases
    borderline = buckets.get("borderline (0.7-0.8)", [])
    borderline_cases = "\n".join(
        f"  - [{e.get('expert')}] conf={e.get('confidence', 0):.2f} depth={e.get('depth')}"
        for e in borderline[:10]
    ) or "  无"

    # Deep effectiveness
    deep_analysis = analyze_deep_effectiveness(entries)

    # Recommendations
    recommendations = generate_recommendations(buckets, expert_stats, depth_stats)

    now = datetime.now()
    window_start = (now - timedelta(hours=4)).strftime("%Y-%m-%d %H:%M")
    window_end = now.strftime("%Y-%m-%d %H:%M")

    report = QUALITY_REPORT.format(
        timestamp=now.strftime("%Y-%m-%d %H:%M"),
        window_start=window_start,
        window_end=window_end,
        total_entries=len(entries),
        expert_dist=expert_dist or "  无数据",
        depth_dist=depth_dist or "  无数据",
        confidence_buckets=bucket_summary or "  无数据",
        borderline_cases=borderline_cases,
        deep_analysis=deep_analysis,
        recommendations=recommendations,
    )

    # Save
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    output_file = OUTPUT_DIR / f"{now.strftime('%Y-%m-%d-%H%M')}.md"
    with open(output_file, "w", encoding="utf-8") as f:
        f.write(report)

    print(f"[deep_reflection] Report saved to {output_file.name}")
    print("\n" + report)


if __name__ == "__main__":
    main()
