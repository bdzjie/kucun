#!/usr/bin/env python3
"""
wal.py — Write-Ahead Log for OpenClaw Memory

Every write operation is logged before execution.
Provides audit trail for detecting memory poisoning and enables review/rollback.

Log file: ~/.openclaw/wal/write_log.jsonl
"""

import json
import os
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

WAL_DIR = Path.home() / ".openclaw" / "wal"
WAL_FILE = WAL_DIR / "write_log.jsonl"


def _ensure_wal_dir():
    """Ensure WAL directory exists with correct permissions."""
    WAL_DIR.mkdir(parents=True, exist_ok=True)
    try:
        WAL_DIR.chmod(0o700)
    except (OSError, NotImplementedError):
        pass


def log_write(
    operation: str,
    file_path: Optional[str] = None,
    content_hash: Optional[str] = None,
    lines_delta: Optional[int] = None,
    metadata: Optional[dict] = None,
) -> str:
    """
    Log a write operation to the WAL.
    
    Returns the timestamp of the log entry.
    """
    _ensure_wal_dir()
    
    timestamp = datetime.now().isoformat()
    entry = {
        "timestamp": timestamp,
        "operation": operation,
        "file_path": file_path,
        "content_hash": content_hash,
        "lines_delta": lines_delta,
        "metadata": metadata or {},
    }
    
    try:
        with open(WAL_FILE, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry, default=str) + "\n")
        try:
            WAL_FILE.chmod(0o600)
        except (OSError, NotImplementedError):
            pass
    except Exception as e:
        print(f"WAL write failed: {e}", file=__import__("sys").stderr)
    
    return timestamp


def log_read(
    file_path: str,
    metadata: Optional[dict] = None,
) -> str:
    """Log a read operation (for audit completeness)."""
    _ensure_wal_dir()
    
    timestamp = datetime.now().isoformat()
    entry = {
        "timestamp": timestamp,
        "operation": "read",
        "file_path": file_path,
        "metadata": metadata or {},
    }
    
    try:
        with open(WAL_FILE, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry, default=str) + "\n")
    except Exception as e:
        print(f"WAL write failed: {e}", file=__import__("sys").stderr)
    
    return timestamp


def get_recent_wal(limit: int = 50) -> list:
    """Get the most recent WAL entries."""
    if not WAL_FILE.exists():
        return []
    
    entries = []
    try:
        with open(WAL_FILE, "r", encoding="utf-8") as f:
            lines = f.readlines()
        
        for line in reversed(lines[-limit:]):
            try:
                entries.append(json.loads(line.strip()))
            except json.JSONDecodeError:
                continue
        
        entries.reverse()
    except Exception:
        pass
    
    return entries


def search_wal(
    operation: Optional[str] = None,
    file_path: Optional[str] = None,
    since: Optional[str] = None,
    until: Optional[str] = None,
) -> list:
    """Search WAL entries by criteria."""
    if not WAL_FILE.exists():
        return []
    
    results = []
    try:
        with open(WAL_FILE, "r", encoding="utf-8") as f:
            for line in f:
                try:
                    entry = json.loads(line.strip())
                except json.JSONDecodeError:
                    continue
                
                if operation and entry.get("operation") != operation:
                    continue
                if file_path and file_path not in (entry.get("file_path") or ""):
                    continue
                if since and entry.get("timestamp", "") < since:
                    continue
                if until and entry.get("timestamp", "") > until:
                    continue
                
                results.append(entry)
    except Exception:
        pass
    
    return results


def wal_stats() -> dict:
    """Get WAL statistics."""
    if not WAL_FILE.exists():
        return {
            "total_entries": 0,
            "operations": {},
            "oldest_entry": None,
            "newest_entry": None,
        }
    
    operations = {}
    oldest = None
    newest = None
    total = 0
    
    try:
        with open(WAL_FILE, "r", encoding="utf-8") as f:
            for line in f:
                try:
                    entry = json.loads(line.strip())
                    total += 1
                    
                    op = entry.get("operation", "unknown")
                    operations[op] = operations.get(op, 0) + 1
                    
                    ts = entry.get("timestamp", "")
                    if ts:
                        if oldest is None or ts < oldest:
                            oldest = ts
                        if newest is None or ts > newest:
                            newest = ts
                except json.JSONDecodeError:
                    continue
    except Exception:
        pass
    
    return {
        "total_entries": total,
        "operations": operations,
        "oldest_entry": oldest,
        "newest_entry": newest,
        "wal_file": str(WAL_FILE),
    }


if __name__ == "__main__":
    import sys
    
    if len(sys.argv) < 2:
        print("Usage: wal.py <command>")
        print("Commands:")
        print("  log <op> <file>  — log an operation")
        print("  recent [n]       — show recent entries")
        print("  search <file>    — search by file path")
        print("  stats            — show WAL statistics")
        sys.exit(1)
    
    cmd = sys.argv[1]
    
    if cmd == "recent":
        limit = int(sys.argv[2]) if len(sys.argv) > 2 else 50
        for entry in get_recent_wal(limit):
            print(json.dumps(entry))
    elif cmd == "search":
        if len(sys.argv) < 3:
            print("Usage: wal.py search <file>")
            sys.exit(1)
        for entry in search_wal(file_path=sys.argv[2]):
            print(json.dumps(entry))
    elif cmd == "stats":
        print(json.dumps(wal_stats(), indent=2))
    else:
        print(f"Unknown command: {cmd}")
        sys.exit(1)
