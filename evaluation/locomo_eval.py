"""
evaluation/locomo_eval.py — LoCoMo-10 Benchmark Evaluation for Cone Graph

LoCoMo-10: Long Conversation Memory benchmark (10-session version)
Metric: R@K (Recall at K) — is the correct session in top K retrieved?

Since we can't download the full dataset here, this framework:
1. Loads from local JSON if available
2. Falls back to generating synthetic sessions
3. Runs MemoryOrchestrator.query() for each query
4. Computes R@K metrics

Usage:
    python evaluation/locomo_eval.py [--data path/to/locomo.json]
"""

import sys
import json
import argparse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from modules.memory.memory_orchestrator import MemoryOrchestrator
from modules.memory.cone_graph import ConeGraphStore, Entity

# ─── Synthetic LoCoMo-style Test Data ─────────────────────────────────────────

SYNTHETIC_SESSIONS = [
    {
        "session_id": "sess_001",
        "date": "2024-01-15",
        "turns": [
            {"role": "user", "content": "Hey, can you remind me about the Q1 product launch deadline?"},
            {"role": "assistant", "content": "The Q1 product launch is scheduled for March 15th, 2024."},
        ],
        "has_answer": True,
    },
    {
        "session_id": "sess_002",
        "date": "2024-02-03",
        "turns": [
            {"role": "user", "content": "What did Maria say in the last standup about the deadline?"},
            {"role": "assistant", "content": "Maria said she was not told about the deadline change."},
        ],
        "has_answer": True,
    },
    {
        "session_id": "sess_003",
        "date": "2024-02-10",
        "turns": [
            {"role": "user", "content": "Let's schedule the design review for next Tuesday."},
            {"role": "assistant", "content": "I've scheduled the design review for February 20th."},
        ],
        "has_answer": False,
    },
    {
        "session_id": "sess_004",
        "date": "2024-02-18",
        "turns": [
            {"role": "user", "content": "The client sent over their feedback on the proposal."},
            {"role": "assistant", "content": "Great, I've received the client feedback and will review it today."},
        ],
        "has_answer": False,
    },
    {
        "session_id": "sess_005",
        "date": "2024-02-25",
        "turns": [
            {"role": "user", "content": "Can you summarize the key points from the all-hands meeting?"},
            {"role": "assistant", "content": "The main points were: 1) Q1 targets on track, 2) New hire starting March 1st."},
        ],
        "has_answer": False,
    },
    {
        "session_id": "sess_006",
        "date": "2024-03-01",
        "turns": [
            {"role": "user", "content": "The new engineer starts today. Her name is Sarah."},
            {"role": "assistant", "content": "Welcome Sarah! I've added her to the team channel."},
        ],
        "has_answer": False,
    },
    {
        "session_id": "sess_007",
        "date": "2024-03-05",
        "turns": [
            {"role": "user", "content": "We need to push the launch date back by two weeks."},
            {"role": "assistant", "content": "I've updated the launch date to March 29th in the project tracker."},
        ],
        "has_answer": True,
    },
    {
        "session_id": "sess_008",
        "date": "2024-03-08",
        "turns": [
            {"role": "user", "content": "The marketing team sent the final assets for review."},
            {"role": "assistant", "content": "Got them. I'll review the marketing assets this afternoon."},
        ],
        "has_answer": False,
    },
    {
        "session_id": "sess_009",
        "date": "2024-03-12",
        "turns": [
            {"role": "user", "content": "What's the status on the API integration work?"},
            {"role": "assistant", "content": "The API integration is complete. We passed all QA tests yesterday."},
        ],
        "has_answer": False,
    },
    {
        "session_id": "sess_010",
        "date": "2024-03-14",
        "turns": [
            {"role": "user", "content": "The launch is tomorrow! Are we ready?"},
            {"role": "assistant", "content": "Yes, all systems are go. The final checklist is complete."},
        ],
        "has_answer": False,
    },
]

# Query -> relevant session_ids
GROUND_TRUTH = [
    {"query": "Q1 product launch deadline", "relevant": ["sess_001"]},
    {"query": "What did Maria say about the deadline", "relevant": ["sess_002"]},
    {"query": "launch date change", "relevant": ["sess_007"]},
    {"query": "design review scheduled", "relevant": ["sess_003"]},
    {"query": "new engineer starting", "relevant": ["sess_006"]},
    {"query": "client feedback on proposal", "relevant": ["sess_004"]},
    {"query": "all-hands meeting key points", "relevant": ["sess_005"]},
    {"query": "API integration status", "relevant": ["sess_009"]},
    {"query": "marketing assets review", "relevant": ["sess_008"]},
    {"query": "launch tomorrow ready", "relevant": ["sess_010"]},
]


def ingest_sessions(sessions, orch):
    """Ingest LoCoMo sessions into Cone Graph."""
    for session in sessions:
        turns_text = "\n".join(
            f"{t['role']}: {t['content']}" for t in session["turns"]
        )
        # Extract key entity names from turns
        entity_names = []
        for turn in session["turns"]:
            words = turn["content"].split()
            for word in words:
                w = word.strip(".,!?:;\"")
                if w and w[0].isupper() and len(w) > 2 and w not in entity_names:
                    entity_names.append(w)
                    if len(entity_names) >= 5:
                        break

        orch.add_episode(
            summary=turns_text,
            source_session=session["session_id"],
            source_type="conversation",
            entity_names=entity_names,
        )


def recall_at_k(query, relevant_ids, orch, k_values=(1, 3, 5)):
    """
    Run query and check if relevant session_ids appear in top-k results.
    Returns R@{k} for each k.
    """
    bundle = orch.query(query, mode="episodic", top_k=max(k_values))

    # Extract session IDs from returned episodes
    returned_sessions = []
    for ep in bundle.episodes:
        # Episode source_session is the session_id
        returned_sessions.append(ep.source_session)

    results = {}
    for k in k_values:
        top_k_sessions = set(returned_sessions[:k])
        relevant_set = set(relevant_ids)
        recall = 1.0 if relevant_set & top_k_sessions else 0.0
        results[f"R@{k}"] = recall

    return results, returned_sessions[:max(k_values)]


def run_evaluation(data_path=None, k_values=(1, 3, 5)):
    """Run full LoCoMo-10 evaluation."""
    print("=" * 60)
    print("LoCoMo-10 Benchmark Evaluation — Cone Graph")
    print("=" * 60)

    if data_path and Path(data_path).exists():
        print(f"\nLoading real dataset from {data_path}")
        with open(data_path, encoding="utf-8") as f:
            dataset = json.load(f)
        # Real dataset format: list of {question, answer, haystack_sessions, ...}
        # For now, fall back to synthetic
        print("Real dataset loaded but format not yet supported — using synthetic")
        sessions = SYNTHETIC_SESSIONS
        queries = GROUND_TRUTH
    else:
        print("\nUsing synthetic LoCoMo-style sessions (10 sessions)")
        sessions = SYNTHETIC_SESSIONS
        queries = GROUND_TRUTH

    # Ingest sessions
    print(f"\nIngesting {len(sessions)} sessions into Cone Graph...")
    orch = MemoryOrchestrator()
    ingest_sessions(sessions, orch)
    print(f"Done. Episodes: {len(list(orch.store.get_all_episodes()))}")

    # Run evaluation
    print(f"\nRunning evaluation on {len(queries)} queries...")
    print("-" * 60)

    all_results = {f"R@{k}": [] for k in k_values}
    all_details = []

    for i, item in enumerate(queries):
        query = item["query"]
        relevant = item["relevant"]

        recalls, returned = recall_at_k(query, relevant, orch, k_values)

        for k in k_values:
            all_results[f"R@{k}"].append(recalls[f"R@{k}"])

        detail = {
            "query": query,
            "relevant": relevant,
            "returned": returned,
            "recalls": recalls,
        }
        all_details.append(detail)

        status = "HIT" if recalls["R@1"] else "MISS"
        print(f"  {status} Q{i+1}: {query[:40]}")
        print(f"       Relevant: {relevant} | Returned: {returned[:3]}")
        print(f"       Recalls: {recalls}")
        print()

    # Aggregate
    print("=" * 60)
    print("RESULTS")
    print("=" * 60)
    print(f"{'Metric':<10} {'Score':>8}  {'Hit/Total':>12}")
    print("-" * 40)
    for k in k_values:
        scores = all_results[f"R@{k}"]
        avg = sum(scores) / len(scores) if scores else 0
        hits = sum(1 for s in scores if s > 0)
        print(f"R@{k:<8} {avg:>8.1%}  {hits:>5}/{len(scores):<5}")
    print("-" * 40)

    # Per-query breakdown
    print("\nPer-query breakdown:")
    for d in all_details:
        r1 = "HIT" if d["recalls"]["R@1"] else "MISS"
        print(f"  {r1} {d['query'][:45]} -> {d['returned'][:2]}")

    return all_results, all_details


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="LoCoMo-10 Benchmark Evaluation")
    parser.add_argument("--data", help="Path to LoCoMo JSON dataset")
    parser.add_argument("--k", nargs="+", type=int, default=[1, 3, 5],
                        help="K values for Recall@K (default: 1 3 5)")
    args = parser.parse_args()

    run_evaluation(data_path=args.data, k_values=tuple(args.k))
