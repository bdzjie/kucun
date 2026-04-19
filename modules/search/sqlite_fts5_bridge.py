"""
SQLite FTS5 Bridge — 暴露 Python FTS5 功能给 JavaScript
"""

import subprocess
import sys
import os
import io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

# 确保父级目录在 Python path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlite_fts5 import (
    create_index,
    search_sessions,
    get_summary,
    get_stats,
    list_sessions,
    SqliteFts5
)

if __name__ == '__main__':
    # CLI 模式测试
    import json

    if len(sys.argv) < 2:
        print("Usage: python sqlite_fts5_bridge.py <command> [args...]")
        sys.exit(1)

    cmd = sys.argv[1]

    if cmd == 'index':
        sessions_dir = sys.argv[2] if len(sys.argv) > 2 else os.path.expanduser('~/.openclaw/agents/main/sessions')
        db_path = sys.argv[3] if len(sys.argv) > 3 else os.path.expanduser('~/.openclaw/memory/fts5.db')
        result = create_index(sessions_dir, db_path)
        print(result)

    elif cmd == 'search':
        query = sys.argv[2] if len(sys.argv) > 2 else ''
        db_path = sys.argv[3] if len(sys.argv) > 3 else os.path.expanduser('~/.openclaw/memory/fts5.db')
        limit = int(sys.argv[4]) if len(sys.argv) > 4 else 20
        result = search_sessions(query, db_path, limit)
        print(result)

    elif cmd == 'summary':
        session_id = sys.argv[2] if len(sys.argv) > 2 else ''
        db_path = sys.argv[3] if len(sys.argv) > 3 else os.path.expanduser('~/.openclaw/memory/fts5.db')
        result = get_summary(session_id, db_path)
        print(result)

    elif cmd == 'stats':
        db_path = sys.argv[2] if len(sys.argv) > 2 else os.path.expanduser('~/.openclaw/memory/fts5.db')
        result = get_stats(db_path)
        print(result)

    elif cmd == 'list':
        db_path = sys.argv[2] if len(sys.argv) > 2 else os.path.expanduser('~/.openclaw/memory/fts5.db')
        result = list_sessions(db_path)
        print(result)

    else:
        print(f"Unknown command: {cmd}")
        sys.exit(1)
