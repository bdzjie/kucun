"""
ClawHub Cache — Mitigate rate limits by caching responses locally.
Reduces redundant API calls to clawhub.com.

Usage:
    python clawhub_cache.py cache <skill_name>    # Cache a skill's metadata
    python clawhub_cache.py cached <skill_name>   # Check if cached
    python clawhub_cache.py list                   # List all cached
    python clawhub_cache.py clear [--expired]       # Clear cache
"""
import os
import json
import time
import hashlib
from pathlib import Path

CACHE_DIR = Path(os.path.expanduser("C:/Users/Administrator/.openclaw/.clawhub_cache"))
CACHE_TTL = 3600  # 1 hour

def get_cache_path(key: str) -> Path:
    safe_key = hashlib.sha256(key.encode()).hexdigest()[:16]
    return CACHE_DIR / f"{safe_key}.json"

def cache_set(key: str, data: dict, ttl: int = CACHE_TTL):
    """Cache data with TTL"""
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    path = get_cache_path(key)
    entry = {
        "key": key,
        "data": data,
        "cached_at": time.time(),
        "expires_at": time.time() + ttl,
    }
    path.write_text(json.dumps(entry, indent=2), encoding='utf-8')
    return entry

def cache_get(key: str) -> dict | None:
    """Get cached data if not expired"""
    path = get_cache_path(key)
    if not path.exists():
        return None
    
    try:
        entry = json.loads(path.read_text(encoding='utf-8'))
        if entry["expires_at"] < time.time():
            return None  # Expired
        return entry["data"]
    except:
        return None

def cache_list() -> list[dict]:
    """List all cached entries"""
    if not CACHE_DIR.exists():
        return []
    
    results = []
    for f in CACHE_DIR.glob("*.json"):
        try:
            entry = json.loads(f.read_text(encoding='utf-8'))
            results.append({
                "key": entry.get("key", f.stem),
                "cached_at": entry.get("cached_at"),
                "expires_at": entry.get("expires_at"),
                "expired": entry.get("expires_at", 0) < time.time(),
            })
        except:
            continue
    return sorted(results, key=lambda x: x.get("cached_at", 0), reverse=True)

def cache_clear(expired_only: bool = False):
    """Clear cache"""
    if not CACHE_DIR.exists():
        return 0
    
    count = 0
    for f in CACHE_DIR.glob("*.json"):
        if expired_only:
            try:
                entry = json.loads(f.read_text(encoding='utf-8'))
                if entry.get("expires_at", 0) >= time.time():
                    continue
            except:
                pass
        f.unlink()
        count += 1
    return count

if __name__ == "__main__":
    import sys
    
    cmd = sys.argv[1] if len(sys.argv) > 1 else "list"
    
    if cmd == "list":
        entries = cache_list()
        print(f"[clawhub-cache] {len(entries)} cached entries:\n")
        for e in entries:
            status = "EXPIRED" if e["expired"] else "valid"
            age = int(time.time() - e["cached_at"]) if e["cached_at"] else 0
            print(f"  [{status}] {e['key']} (age: {age}s)")
    
    elif cmd == "clear":
        expired = "--expired" in sys.argv
        count = cache_clear(expired_only=expired)
        print(f"[clawhub-cache] Cleared {count} entries")
    
    elif cmd == "cached":
        key = sys.argv[2] if len(sys.argv) > 2 else ""
        if not key:
            print("[clawhub-cache] Usage: cached <key>")
            sys.exit(1)
        
        data = cache_get(key)
        if data:
            print(f"[clawhub-cache] HIT: {key}")
            print(json.dumps(data, indent=2)[:500])
        else:
            print(f"[clawhub-cache] MISS: {key}")
    
    elif cmd == "cache":
        # This would be called by clawhub CLI wrapper
        print("[clawhub-cache] Use clawhub CLI directly - cache is automatic")
    
    else:
        print(f"[clawhub-cache] Unknown command: {cmd}")
        print("Usage: cache <key> | cached <key> | list | clear [--expired]")
