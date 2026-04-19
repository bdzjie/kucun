"""
FTS5 Indexer — Cron Script
============================
定时索引 OpenClaw session .jsonl 文件到 SQLite FTS5
可被 memory_cron.mjs 调用，或独立运行
"""

import sys
import os
import json
import argparse

# Add modules/search to path
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'modules', 'search'))

from sqlite_fts5 import create_index, get_stats, SqliteFts5

STATE_DIR = os.path.expanduser('~/.openclaw')
MEMORY_DIR = os.path.join(STATE_DIR, 'memory')
SESSIONS_DIR = os.path.join(STATE_DIR, 'agents', 'main', 'sessions')
DB_PATH = os.path.join(MEMORY_DIR, 'fts5.db')


def run_index():
    """执行索引并输出结果"""
    if not os.path.exists(SESSIONS_DIR):
        print(json.dumps({'error': f'Sessions dir not found: {SESSIONS_DIR}'}))
        return

    # Count files first
    jsonl_files = [f for f in os.listdir(SESSIONS_DIR) if f.endswith('.jsonl') and not f.endswith('.lock')]
    total_files = len(jsonl_files)

    # Index all sessions
    result = create_index(SESSIONS_DIR, DB_PATH)

    # Get updated stats
    try:
        fts = SqliteFts5(DB_PATH)
        stats = fts.get_stats()
        fts.close()
    except Exception as e:
        stats = {'error': str(e)}

    output = {
        'indexed_sessions': result.get('indexed_sessions', 0),
        'total_session_files': total_files,
        'stats': stats
    }

    print(json.dumps(output, ensure_ascii=False))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='FTS5 Indexer')
    parser.add_argument('--stats', action='store_true', help='Show current stats only')
    args = parser.parse_args()

    if args.stats:
        try:
            fts = SqliteFts5(DB_PATH)
            stats = fts.get_stats()
            fts.close()
            print(json.dumps(stats, ensure_ascii=False))
        except Exception as e:
            print(json.dumps({'error': str(e)}))
    else:
        run_index()
