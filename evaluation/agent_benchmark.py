"""
agent_benchmark.py — OpenClaw Agent Evaluation Framework
=========================================================
Inspired by Skyvern evaluation/ structure.

评估 AIAgent 在不同任务类型上的表现：
  - code_expert: 代码生成/调试
  - analysis_expert: 架构分析/推理
  - memory_expert: 记忆召回
  - web_expert: 信息检索
  - system_expert: 配置/系统操作

Usage:
  python evaluation/agent_benchmark.py
  python evaluation/agent_benchmark.py --suite routing --model minimax
  python evaluation/agent_benchmark.py --report  # 输出 HTML 报告
"""

import json
import os
import sys
import time
import statistics
from dataclasses import dataclass, asdict
from datetime import datetime
from pathlib import Path
from typing import Optional

# ============================================================================
# Paths
# ============================================================================

WORKSPACE = Path(__file__).parent.parent.resolve()
EVAL_DIR = WORKSPACE / "evaluation"
RESULTS_DIR = EVAL_DIR / "results"
DATASETS_DIR = EVAL_DIR / "datasets"
DATASETS_DIR.mkdir(parents=True, exist_ok=True)
RESULTS_DIR.mkdir(parents=True, exist_ok=True)

# ============================================================================
# Task Suites
# ============================================================================

SUITES = {
    "routing": {
        "name": "Expert Router Routing Quality",
        "tasks": [
            {
                "id": "route_code_1",
                "input": "写一个 Python 函数计算斐波那契数列",
                "expected_expert": "code_expert",
                "expected_depth": "normal",
            },
            {
                "id": "route_code_2",
                "input": "分析这段代码的性能并给出优化建议",
                "expected_expert": "code_expert",
                "expected_depth": "deep",
            },
            {
                "id": "route_analysis_1",
                "input": "分析 Claude Code 的架构设计",
                "expected_expert": "analysis_expert",
                "expected_depth": "deep",
            },
            {
                "id": "route_memory_1",
                "input": "记得我们上次讨论的内容吗",
                "expected_expert": "memory_expert",
                "expected_depth": "normal",
            },
            {
                "id": "route_system_1",
                "input": "配置 OpenClaw gateway",
                "expected_expert": "system_expert",
                "expected_depth": "fast",
            },
            {
                "id": "route_web_1",
                "input": "搜索 GitHub 上的 Claude Mythos 仓库",
                "expected_expert": "web_expert",
                "expected_depth": "normal",
            },
        ],
    },
    "compression": {
        "name": "Context Compression Quality",
        "tasks": [
            {
                "id": "comp_50pct",
                "input": "在上下文达到 50% 时压缩，验证关键信息是否保留",
                "expected_expert": "general",
                "expected_depth": "normal",
            },
        ],
    },
    "skill_chain": {
        "name": "Skill Chain Execution",
        "tasks": [
            {
                "id": "chain_code",
                "input": "/eval [1,2,3,4,5].reduce((a,b)=>a*b, 1)",
                "expected_expert": "code_expert",
                "expected_depth": "fast",
            },
        ],
    },
}


@dataclass
class TaskResult:
    task_id: str
    suite: str
    input: str
    expected_expert: str
    expected_depth: str
    actual_expert: str = ""
    actual_depth: str = ""
    expert_correct: bool = False
    depth_correct: bool = False
    duration_ms: int = 0
    success: bool = False
    error: str = ""
    timestamp: str = ""


@dataclass
class SuiteResult:
    suite: str
    name: str
    total: int
    passed: int
    accuracy: float
    task_results: list
    duration_ms: int = 0


# ============================================================================
# Router Evaluator
# ============================================================================

def evaluate_routing(task: dict) -> TaskResult:
    """Evaluate routing decision for a given task input."""
    result = TaskResult(
        task_id=task["id"],
        suite="routing",
        input=task["input"],
        expected_expert=task["expected_expert"],
        expected_depth=task["expected_depth"],
        timestamp=datetime.now().isoformat(),
    )

    start = time.time()
    try:
        # Call Expert Router (Python)
        import subprocess
        proc = subprocess.run(
            [sys.executable, str(WORKSPACE / "modules" / "expert_router.py"), "--json", task["input"]],
            capture_output=True,
            text=True,
            timeout=10,
        )
        if proc.returncode == 0 and proc.stdout.strip():
            data = json.loads(proc.stdout.strip())
            result.actual_expert = data.get("expert", "")
            result.actual_depth = data.get("depth", "")
            result.expert_correct = result.actual_expert == result.expected_expert
            result.depth_correct = result.actual_depth == result.expected_depth
            result.success = True
        else:
            result.error = proc.stderr.strip() or "No output"
    except Exception as e:
        result.error = str(e)
    finally:
        result.duration_ms = int((time.time() - start) * 1000)

    return result


def run_suite(suite_id: str) -> SuiteResult:
    """Run all tasks in a suite."""
    if suite_id not in SUITES:
        raise ValueError(f"Unknown suite: {suite_id}")

    suite = SUITES[suite_id]
    print(f"\n{'='*60}")
    print(f"Suite: {suite['name']} ({suite_id})")
    print(f"{'='*60}")

    results: list[TaskResult] = []
    start = time.time()

    for task in suite["tasks"]:
        print(f"\n  Task: {task['id']}")
        print(f"  Input: {task['input'][:60]}...")
        result = evaluate_routing(task)
        results.append(result)

        status = "[PASS]" if (result.expert_correct and result.depth_correct) else "[FAIL]"
        print(f"  {status} expert={result.actual_expert or '?'} (exp={task['expected_expert']}) | "
              f"depth={result.actual_depth or '?'} (exp={task['expected_depth']}) | "
              f"{result.duration_ms}ms")
        if result.error:
            print(f"     ERROR: {result.error[:80]}")

    passed = sum(1 for r in results if r.expert_correct and r.depth_correct)
    duration_ms = int((time.time() - start) * 1000)
    accuracy = passed / len(results) * 100 if results else 0

    suite_result = SuiteResult(
        suite=suite_id,
        name=suite["name"],
        total=len(results),
        passed=passed,
        accuracy=accuracy,
        task_results=[asdict(r) for r in results],
        duration_ms=duration_ms,
    )

    print(f"\n  Suite Result: {passed}/{len(results)} passed ({accuracy:.0f}%) in {duration_ms}ms")
    return suite_result


def save_results(suite_results: list[SuiteResult]):
    """Save results to JSON + generate summary."""
    ts = datetime.now().strftime("%Y%m%d-%H%M%S")
    result_file = RESULTS_DIR / f"benchmark-{ts}.json"

    output = {
        "timestamp": datetime.now().isoformat(),
        "suites": [asdict(s) for s in suite_results],
        "summary": {
            "total_suites": len(suite_results),
            "total_tasks": sum(s.total for s in suite_results),
            "total_passed": sum(s.passed for s in suite_results),
            "overall_accuracy": (
                sum(s.passed for s in suite_results) /
                max(sum(s.total for s in suite_results), 1) * 100
            ),
            "total_duration_ms": sum(s.duration_ms for s in suite_results),
        },
    }

    with open(result_file, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    print(f"\n{'='*60}")
    print(f"Results saved: {result_file.name}")
    print(f"Overall: {output['summary']['total_passed']}/{output['summary']['total_tasks']} "
          f"({output['summary']['overall_accuracy']:.0f}%)")
    return result_file


def generate_report(result_file: Path):
    """Generate HTML report from results."""
    with open(result_file, "r", encoding="utf-8") as f:
        data = json.load(f)

    summary = data["summary"]
    suites = data["suites"]

    html = f"""<!doctype html>
<html><head>
<meta charset="utf-8"/>
<title>Agent Benchmark Report — {data['timestamp'][:10]}</title>
<style>
  body {{ font: 14px/1.5 system-ui; background: #0d0d0f; color: #e8e8f0; padding: 24px; }}
  h1 {{ font-size: 20px; margin-bottom: 20px; }}
  .summary {{ background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1);
              border-radius: 12px; padding: 16px 20px; margin-bottom: 24px; }}
  .summary-num {{ font-size: 28px; font-weight: 700;
                  color: {'#24e08a' if summary['overall_accuracy'] > 70 else '#f59e0b'}; }}
  .suite {{ background: rgba(255,255,255,0.04); border-radius: 12px; padding: 16px; margin-bottom: 16px; }}
  .suite-title {{ font-weight: 700; margin-bottom: 10px; }}
  table {{ width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 13px; }}
  th {{ text-align: left; color: rgba(255,255,255,0.5); font-size: 11px; text-transform: uppercase; }}
  td {{ padding: 6px 8px; border-bottom: 1px solid rgba(255,255,255,0.05); }}
  .pass {{ color: #24e08a; }} .fail {{ color: #ef4444; }}
  .badge {{ display: inline-block; padding: 1px 6px; border-radius: 6px; font-size: 11px; }}
  .pass-bg {{ background: rgba(36,224,138,0.15); }} .fail-bg {{ background: rgba(239,68,68,0.15); }}
</style></head><body>
<h1>Agent Benchmark Report — {data['timestamp'][:10]}</h1>

<div class="summary">
  <div class="summary-num">{summary['overall_accuracy']:.0f}%</div>
  <div>{summary['total_passed']}/{summary['total_tasks']} tasks passed · {summary['total_duration_ms']}ms total</div>
</div>
"""

    for suite in suites:
        acc = suite["accuracy"]
        acc_color = "#24e08a" if acc >= 70 else "#f59e0b" if acc >= 50 else "#ef4444"
        html += f"""
<div class="suite">
  <div class="suite-title">{suite['name']} <span style="color:{acc_color}">({acc:.0f}%)</span></div>
  <table>
    <tr><th>Task</th><th>Expert</th><th>Depth</th><th>Duration</th><th>Result</th></tr>
"""
        for tr in suite["task_results"]:
            ok = tr["expert_correct"] and tr["depth_correct"]
            cls = "pass" if ok else "fail"
            bg_cls = "pass-bg" if ok else "fail-bg"
            html += f"""<tr>
  <td>{tr['task_id']}</td>
  <td>{tr['actual_expert'] or '?'} / {tr['expected_expert']}</td>
  <td>{tr['actual_depth'] or '?'} / {tr['expected_depth']}</td>
  <td>{tr['duration_ms']}ms</td>
  <td><span class="badge {bg_cls} {cls}">{cls.upper()}</span></td>
</tr>"""
        html += "</table></div>"

    html += "</body></html>"

    report_file = result_file.with_suffix(".html")
    with open(report_file, "w", encoding="utf-8") as f:
        f.write(html)

    print(f"HTML report: {report_file.name}")
    return report_file


# ============================================================================
# Main
# ============================================================================

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="OpenClaw Agent Benchmark")
    parser.add_argument("--suite", choices=list(SUITES.keys()), help="Run specific suite")
    parser.add_argument("--report", action="store_true", help="Generate HTML report from latest results")
    parser.add_argument("--latest", action="store_true", help="Show latest results summary")
    args = parser.parse_args()

    if args.report:
        # Find latest results
        results = sorted(RESULTS_DIR.glob("benchmark-*.json"), reverse=True)
        if results:
            generate_report(results[0])
        else:
            print("No results found. Run benchmark first.")
        sys.exit(0)

    if args.latest:
        results = sorted(RESULTS_DIR.glob("benchmark-*.json"), reverse=True)
        if results:
            with open(results[0]) as f:
                data = json.load(f)
            print(json.dumps(data["summary"], indent=2))
        else:
            print("No results found.")
        sys.exit(0)

    # Run suites
    suite_ids = [args.suite] if args.suite else list(SUITES.keys())
    all_results = []

    for sid in suite_ids:
        result = run_suite(sid)
        all_results.append(result)

    # Save
    result_file = save_results(all_results)

    # Auto-generate HTML report
    generate_report(result_file)
