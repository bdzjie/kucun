"""
_autonomous_consolidation.py — Background Memory Consolidation

Compresses old session corpus files older than `age_threshold_days`.
Uses extractive summarization (TF-IDF sentence scoring) by default,
with a pluggable LLM hook for abstractive summarization.

Run as: python skills/_autonomous_consolidation.py [--age 7] [--dry-run]
"""

import os, sys, json, argparse, warnings
from pathlib import Path
from datetime import datetime, timezone, timedelta

WORKSPACE = Path("C:/Users/Administrator/.openclaw/workspace")
CORPUS_DIR = WORKSPACE / "memory" / ".dreams" / "session-corpus"
STATE_FILE = WORKSPACE / "memory" / ".dreams" / "consolidation_state.json"


# ── Extractive Summarizer ────────────────────────────────────────────────────

def extractive_summarize(text: str, target_sentences: int = 5) -> str:
    """
    Simple TF-IDF extractive summarization.
    Selects the `target_sentences` most "important" sentences.
    """
    try:
        from sklearn.feature_extraction.text import TfidfVectorizer
        import numpy as np
    except ImportError:
        return text[:500] + "..." if len(text) > 500 else text

    # Split into sentences (crude)
    lines = [l.strip() for l in text.split("\n") if l.strip() and len(l.strip()) > 20]
    if len(lines) <= target_sentences:
        return text

    try:
        vectorizer = TfidfVectorizer(stop_words="english", max_features=500)
        tfidf = vectorizer.fit_transform(lines)
        # Score each line by sum of its tfidf values
        scores = np.array(tfidf.sum(axis=1)).flatten()
        top_indices = scores.argsort()[-target_sentences:][::-1]
        top_indices = sorted(top_indices)  # preserve original order
        summary_lines = [lines[i] for i in top_indices]
        return "\n".join(summary_lines)
    except Exception:
        return text[:500] + "..." if len(text) > 500 else text


# ── State Management ────────────────────────────────────────────────────────

def load_state() -> dict:
    if STATE_FILE.exists():
        return json.loads(STATE_FILE.read_text(encoding="utf-8"))
    return {"consolidated": [], "last_run": None}


def save_state(state: dict) -> None:
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps(state, indent=2, ensure_ascii=False), encoding="utf-8")


# ── Core Consolidation ──────────────────────────────────────────────────────

def consolidate_file(filepath: Path, dry_run: bool = False, llm_hook=None) -> dict:
    """
    Consolidate a single session corpus file.

    Returns dict with: {file, status, summary_len, original_len, savings_pct}
    """
    stat = filepath.stat()
    original_len = stat.st_size
    content = filepath.read_text(encoding="utf-8", errors="replace")

    # Generate summary
    if llm_hook:
        summary = llm_hook(content)
    else:
        summary = extractive_summarize(content, target_sentences=8)

    # Build consolidated entry
    meta = {
        "original_file": filepath.name,
        "consolidated_at": datetime.now(timezone.utc).isoformat(),
        "original_size": original_len,
        "summary_size": len(summary.encode("utf-8")),
        "original_head": content[:200],
    }

    # Write .consolidated file (summary + meta, not the full content)
    out_path = filepath.with_suffix(".consolidated.txt")
    out_content = f"# Session Summary — {filepath.name}\n# Consolidated at {meta['consolidated_at']}\n\n{summary}\n\n---\nMetadata: {json.dumps(meta, indent=2)}"
    out_path.write_text(out_content, encoding="utf-8")

    if not dry_run:
        # Backup original
        bak_path = filepath.with_suffix(".txt.bak")
        filepath.rename(bak_path)

    savings = (1 - len(summary) / max(len(content), 1)) * 100
    return {
        "file": filepath.name,
        "status": "consolidated" if not dry_run else "dry-run",
        "summary_len": len(summary),
        "original_len": original_len,
        "savings_pct": round(max(0, savings), 1),
        "out_file": str(out_path.name),
    }


def run_consolidation(age_threshold_days: int = 7, dry_run: bool = False, llm_hook=None) -> list[dict]:
    """
    Find all session corpus files older than `age_threshold_days` and consolidate them.
    """
    state = load_state()
    already_done = set(state.get("consolidated", []))
    results = []

    if not CORPUS_DIR.exists():
        return results

    cutoff = datetime.now(timezone.utc) - timedelta(days=age_threshold_days)

    for filepath in sorted(CORPUS_DIR.iterdir()):
        if not filepath.suffix == ".txt" or filepath.name.startswith("."):
            continue
        if filepath.name in already_done:
            continue

        file_mtime = datetime.fromtimestamp(filepath.stat().st_mtime, tz=timezone.utc)
        if file_mtime > cutoff:
            continue  # too recent

        result = consolidate_file(filepath, dry_run=dry_run, llm_hook=llm_hook)
        results.append(result)

        if not dry_run:
            state["consolidated"].append(filepath.name)

    state["last_run"] = datetime.now(timezone.utc).isoformat()
    if not dry_run:
        save_state(state)

    return results


# ── CLI ─────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Autonomous Memory Consolidation")
    parser.add_argument("--age", type=int, default=7, help="Age threshold in days (default: 7)")
    parser.add_argument("--dry-run", action="store_true", help="Preview without modifying files")
    parser.add_argument("--status", action="store_true", help="Show consolidation status only")
    args = parser.parse_args()

    if args.status:
        state = load_state()
        print(f"Last run: {state.get('last_run', 'never')}")
        print(f"Consolidated files: {len(state.get('consolidated', []))}")
        for f in state.get("consolidated", []):
            print(f"  - {f}")
        sys.exit(0)

    print(f"Consolidation run — age_threshold={args.age} days, dry_run={args.dry_run}")

    results = run_consolidation(age_threshold_days=args.age, dry_run=args.dry_run)

    if not results:
        print("No files to consolidate (all recent or already done).")
    else:
        print(f"\nConsolidated {len(results)} file(s):")
        for r in results:
            print(f"  [{r['status']}] {r['file']}: {r['original_len']} → {r['summary_len']} bytes "
                  f"(saved {r['savings_pct']}%) → {r['out_file']}")

    if not args.dry_run:
        print("\nOriginal files moved to .txt.bak — delete .bak after verifying.")
