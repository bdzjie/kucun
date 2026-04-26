"""
memory_query_bridge.py — Bridge between canvas UI and MemoryOrchestrator

Reads memory_query_trigger.json (written by agent on user query)
  → calls MemoryOrchestrator.query()
  → writes results to memory_query_state.json
  → canvas polls and displays

Usage (run as subprocess from agent):
  python memory_query_bridge.py "deadline communication" [episodic|lexical|unified] [--hybrid-weight 0.3]
"""

import sys, json, shutil
from pathlib import Path

WORKSPACE = Path("C:/Users/Administrator/.openclaw/workspace")
CANVAS_DIR = Path("C:/Users/Administrator/.openclaw/canvas")
TRIGGER_FILE = WORKSPACE / "memory_query_trigger.json"
STATE_FILE = WORKSPACE / "memory_query_state.json"


def main():
    if len(sys.argv) < 2:
        print("Usage: python memory_query_bridge.py <query> [mode]")
        sys.exit(1)

    query_text = sys.argv[1].strip()
    if not query_text:
        error_state = {"error": "Empty query", "query": "", "results": []}
        with open(STATE_FILE, "w", encoding="utf-8") as f:
            json.dump(error_state, f)
        shutil.copy2(STATE_FILE, CANVAS_DIR / "memory_query_state.json")
        print("ERROR: empty query")
        sys.exit(0)

    # Parse mode and optional hybrid_weight
    mode = "episodic"
    hybrid_weight = 0.3
    for arg in sys.argv[2:]:
        if arg in ("episodic", "lexical", "unified", "procedural"):
            mode = arg
        elif arg.startswith("--hybrid-weight="):
            try:
                hybrid_weight = float(arg.split("=", 1)[1])
            except (ValueError, IndexError):
                pass

    # Add workspace to path
    sys.path.insert(0, str(WORKSPACE))

    try:
        from modules.memory.memory_orchestrator import MemoryOrchestrator

        orch = MemoryOrchestrator()
        bundle = orch.query(query_text, mode=mode, top_k=5, hybrid_weight=hybrid_weight)

        # Serialize results for canvas
        results = []
        for ep in bundle.episodes:
            facets = []
            for fac in bundle.facets:
                if fac.id in ep.facet_ids:
                    facets.append({"id": fac.id, "topic": fac.topic, "summary": fac.summary})

            results.append({
                "id": ep.id,
                "summary": ep.summary,
                "score": bundle.scores.get(ep.id, 0.0),
                "source_session": ep.source_session,
                "source_type": ep.source_type,
                "timestamp": ep.timestamp,
                "facets": facets,
            })

        state = {
            "query": query_text,
            "mode": mode,
            "hybrid_weight": hybrid_weight,
            "retrieval_mode": bundle.retrieval_mode,
            "router_result": {
                "layer": bundle.router_result.layer.value,
                "confidence": bundle.router_result.confidence,
                "keywords": bundle.router_result.keywords,
            },
            "results": results,
            "total_episodes": len(results),
        }

        with open(STATE_FILE, "w", encoding="utf-8") as f:
            json.dump(state, f, ensure_ascii=False, indent=2)

        # Sync to canvas directory for UI polling
        canvas_state = CANVAS_DIR / "memory_query_state.json"
        shutil.copy2(STATE_FILE, canvas_state)

        print(f"OK: {len(results)} episodes, mode={bundle.retrieval_mode}, layer={bundle.router_result.layer.value}, hybrid_weight={hybrid_weight}")

    except Exception as e:
        error_state = {"error": str(e), "query": query_text}
        with open(STATE_FILE, "w", encoding="utf-8") as f:
            json.dump(error_state, f)
        print(f"ERROR: {e}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    main()
