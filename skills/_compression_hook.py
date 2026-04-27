"""
_compression_hook.py — Context Budget Monitoring & Compression Trigger

Monitors session context size and triggers autonomous consolidation
when the token budget approaches capacity.

Usage:
    from skills._compression_hook import CompressionHook, check_and_compress

    hook = CompressionHook()
    result = hook.check()  # returns {near_budget, budget_pct, action}
    if result["action"]:
        hook.trigger_consolidation(result["action"])

    # CLI:
    python skills/_compression_hook.py --check
    python skills/_compression_hook.py --trigger --reason "heartbeat"
"""

import json, argparse
from pathlib import Path
from datetime import datetime, timezone

WORKSPACE = Path("C:/Users/Administrator/.openclaw/workspace")
SESSION_STATS_FILE = WORKSPACE / "memory" / "_session_stats.json"
COMPRESSION_LOG = WORKSPACE / "memory" / "_compression_log.jsonl"

# Thresholds
DEFAULT_MAX_TOKENS = 120_000   # conservative limit
WARNING_THRESHOLD = 0.75       # trigger warning at 75%
ACTION_THRESHOLD = 0.90        # trigger consolidation at 90%


class CompressionHook:
    """
    Monitors session context budget and triggers consolidation.

    Token estimation: counts messages in session + approximate characters.
    For accurate token tracking, OpenClaw's internal compact() should call
    this hook after each compaction cycle.
    """

    def __init__(
        self,
        max_tokens: int = DEFAULT_MAX_TOKENS,
        warning_pct: float = WARNING_THRESHOLD,
        action_pct: float = ACTION_THRESHOLD,
    ):
        self._max_tokens = max_tokens
        self._warning_pct = warning_pct
        self._action_pct = action_pct
        self._session_tokens = 0
        self._message_count = 0
        self._last_compaction_tokens = 0
        self._load_stats()

    # ── Stats persistence ──────────────────────────────────────────────────

    def _load_stats(self) -> None:
        if SESSION_STATS_FILE.exists():
            try:
                data = json.loads(SESSION_STATS_FILE.read_text(encoding="utf-8"))
                self._session_tokens = data.get("session_tokens", 0)
                self._message_count = data.get("message_count", 0)
                self._last_compaction_tokens = data.get("last_compaction_tokens", 0)
            except Exception:
                pass

    def _save_stats(self) -> None:
        SESSION_STATS_FILE.parent.mkdir(parents=True, exist_ok=True)
        SESSION_STATS_FILE.write_text(
            json.dumps({
                "session_tokens": self._session_tokens,
                "message_count": self._message_count,
                "last_compaction_tokens": self._last_compaction_tokens,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }, indent=2),
            encoding="utf-8"
        )

    def _log(self, action: str, detail: str) -> None:
        entry = {
            "time": datetime.now(timezone.utc).isoformat(),
            "action": action,
            "detail": detail,
            "session_tokens": self._session_tokens,
            "budget_pct": round(self.budget_pct * 100, 1),
        }
        COMPRESSION_LOG.parent.mkdir(parents=True, exist_ok=True)
        with open(str(COMPRESSION_LOG), "a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")

    # ── Token tracking ──────────────────────────────────────────────────────

    @property
    def budget_pct(self) -> float:
        return min(self._session_tokens / self._max_tokens, 1.0)

    def record_messages(self, count: int, chars: int) -> None:
        """
        Call this after each user/assistant message exchange.
        Updates token estimate and checks budget.
        """
        # Rough estimate: ~4 chars per token for English, ~2 for Chinese
        # Use average 3.0 chars/token
        self._message_count += count
        self._session_tokens += int(chars / 3.0)
        self._save_stats()

    def on_compaction(self, tokens_remaining: int) -> None:
        """
        Call this after OpenClaw's internal compaction.
        Records the new baseline after compaction.
        """
        self._last_compaction_tokens = tokens_remaining
        self._session_tokens = tokens_remaining
        self._save_stats()
        self._log("compaction", f"tokens_after_compaction={tokens_remaining}")

    # ── Budget check ───────────────────────────────────────────────────────

    def check(self) -> dict:
        """
        Check if budget is near limit.

        Returns:
            {
                "near_budget": bool,
                "budget_pct": float,
                "action": None | "warn" | "consolidate",
                "tokens_remaining": int,
                "tokens_over": int,
            }
        """
        pct = self.budget_pct
        remaining = self._max_tokens - self._session_tokens
        over = max(0, self._session_tokens - int(self._action_pct * self._max_tokens))

        if pct >= self._action_pct:
            action = "consolidate"
        elif pct >= self._warning_pct:
            action = "warn"
        else:
            action = None

        return {
            "near_budget": action is not None,
            "budget_pct": round(pct, 4),
            "action": action,
            "tokens_remaining": max(0, remaining),
            "tokens_over": over,
            "message_count": self._message_count,
        }

    def trigger_consolidation(self, reason: str = "budget") -> dict:
        """
        Trigger autonomous consolidation via _autonomous_consolidation.

        Returns result dict from the consolidation run.
        """
        self._log("triggered", f"reason={reason}, budget_pct={self.budget_pct:.1%}")

        # Import dynamically to avoid circular dependency
        import sys
        sys.path.insert(0, str(WORKSPACE))
        try:
            from skills._autonomous_consolidation import run_consolidation
            results = run_consolidation(age_threshold_days=3, dry_run=False)
            self._log("consolidation_complete", f"files={len(results)}")
            return {"ok": True, "files_processed": len(results), "results": results}
        except Exception as e:
            self._log("consolidation_error", str(e))
            return {"ok": False, "error": str(e)}


# ── CLI ─────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Context Budget Compression Hook")
    parser.add_argument("--check", action="store_true", help="Check budget and report")
    parser.add_argument("--trigger", action="store_true", help="Trigger consolidation")
    parser.add_argument("--reason", default="cli", help="Reason for trigger")
    parser.add_argument("--record", metavar="COUNT", type=int, help="Record N messages")
    parser.add_argument("--compaction", metavar="TOKENS", type=int, help="Report post-compaction TOKENS")
    args = parser.parse_args()

    hook = CompressionHook()

    if args.record:
        hook.record_messages(args.record, 500 * args.record)  # ~500 chars per msg
        print(f"Recorded {args.record} messages")
        print(f"budget_pct={hook.budget_pct:.1%}")

    if args.compaction is not None:
        hook.on_compaction(args.compaction)
        print(f"Compaction reported: {args.compaction} tokens remaining")

    if args.check:
        result = hook.check()
        print(json.dumps(result, indent=2))
        if result["action"]:
            print(f"\nAction recommended: {result['action']}")

    if args.trigger:
        print("Triggering consolidation...")
        result = hook.trigger_consolidation(args.reason)
        print(json.dumps(result, indent=2))
