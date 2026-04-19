#!/usr/bin/env python3
"""
Session Replay CLI
=================

Search past sessions using BM25 and return formatted results.
Takes a query string as argument.

Usage:
    python session_replay.py "<query>" [limit]
"""

import sys
import json
import os
import re

SESSIONS_DIR = 'C:/Users/Administrator/.openclaw/agents/main/sessions'
MEMORY_DIR = 'C:/Users/Administrator/.openclaw/memory'


def get_all_sessions():
    """Get all session .jsonl files."""
    if not os.path.exists(SESSIONS_DIR):
        return []
    sessions = []
    for entry in os.scandir(SESSIONS_DIR):
        if entry.is_file() and entry.name.endswith('.jsonl'):
            sessions.append(entry.name.replace('.jsonl', ''))
    return sessions


def load_session_messages(session_id):
    """Load messages from a session .jsonl file."""
    path = os.path.join(SESSIONS_DIR, f'{session_id}.jsonl')
    if not os.path.exists(path):
        return []
    messages = []
    try:
        with open(path, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                    if obj.get('type') == 'message':
                        msg = obj.get('message', {})
                        role = msg.get('role', '')
                        content = msg.get('content', '')
                        if isinstance(content, list):
                            content = ' '.join(
                                b.get('text', '') for b in content
                                if b.get('type') == 'text'
                            )
                        ts = obj.get('timestamp', 0)
                        messages.append({
                            'role': role,
                            'content': content[:500] if content else '',
                            'timestamp': ts,
                            'sessionId': session_id,
                        })
                except json.JSONDecodeError:
                    continue
    except Exception:
        pass
    return messages


def tokenize(text):
    """Simple tokenizer."""
    if not text:
        return []
    text = text.lower()
    tokens = re.findall(r'\b[a-z0-9\u4e00-\u9fff]{2,}\b', text)
    return tokens


def stem(word):
    """Simple Porter-like stemmer (simplified)."""
    # Very simplified - just handles common suffixes
    for suffix in ['ing', 'ed', 'es', 's', 'ly', 'er', 'est']:
        if word.endswith(suffix) and len(word) > len(suffix) + 2:
            return word[:-len(suffix)]
    return word


def bm25_score(query_terms, doc_terms, N, doc_freqs, avgdl, k1=1.5, b=0.75):
    """Calculate BM25 score for a document."""
    if not doc_terms:
        return 0.0
    doc_len = len(doc_terms)
    doc_tf = {}
    for t in doc_terms:
        doc_tf[t] = doc_tf.get(t, 0) + 1

    score = 0.0
    for term in query_terms:
        if term not in doc_tf:
            continue
        tf = doc_tf[term]
        df = doc_freqs.get(term, 0)
        if df == 0:
            continue
        idf = max(0, (N - df + 0.5) / (df + 0.5))
        idf = (N - df + 0.5) / (df + 0.5)
        tf_component = (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * doc_len / avgdl))
        score += idf * tf_component
    return score


def search_sessions(query, limit=5):
    """BM25 search across all sessions."""
    sessions = get_all_sessions()
    if not sessions:
        return []

    # Load all messages
    all_docs = {}  # session_id -> [tokens]
    doc_contents = {}  # session_id -> content for snippet
    doc_timestamps = {}  # session_id -> latest timestamp
    doc_messages = {}  # session_id -> message count

    N = 0
    doc_freqs = {}
    all_terms = []

    for sid in sessions:
        messages = load_session_messages(sid)
        if not messages:
            continue

        doc_timestamps[sid] = max(m['timestamp'] for m in messages if m['timestamp'])
        doc_messages[sid] = len(messages)

        # Combine all message content
        combined = ' '.join(m.get('content', '') for m in messages if m.get('content'))
        combined = combined[:5000]  # Limit per session

        terms = tokenize(combined)
        stemmed = [stem(t) for t in terms]
        all_docs[sid] = stemmed
        doc_contents[sid] = combined[:500]
        all_terms.extend(stemmed)
        N += 1

        for t in set(stemmed):
            doc_freqs[t] = doc_freqs.get(t, 0) + 1

    if N == 0:
        return []

    avgdl = sum(len(d) for d in all_docs.values()) / N

    # Score each session
    query_terms = [stem(t) for t in tokenize(query)]
    query_terms = [t for t in query_terms if t in doc_freqs]

    if not query_terms:
        return []

    scores = {}
    for sid, doc_terms in all_docs.items():
        scores[sid] = bm25_score(query_terms, doc_terms, N, doc_freqs, avgdl)

    # Sort and take top-k
    sorted_sids = sorted(scores.items(), key=lambda x: x[1], reverse=True)[:limit]

    results = []
    for sid, score in sorted_sids:
        if score <= 0:
            continue
        # Find relevant snippet
        content = doc_contents.get(sid, '')
        # Extract snippet around first query term match
        snippet = extract_snippet(content, query, query_terms, 150)
        ts = doc_timestamps.get(sid, 0)
        ts_str = ''
        if ts:
            try:
                from datetime import datetime
                ts_str = datetime.fromtimestamp(ts).strftime('%Y-%m-%d %H:%M')
            except:
                pass

        results.append({
            'sessionId': sid,
            'score': round(score, 3),
            'snippet': snippet,
            'timestamp': ts_str,
            'messageCount': doc_messages.get(sid, 0),
        })

    return results


def extract_snippet(content, query, query_terms, max_len=150):
    """Extract a snippet from content around query term matches."""
    if not content:
        return ''

    content_lower = content.lower()
    best_pos = 0
    for term in query_terms:
        pos = content_lower.find(term)
        if pos >= 0:
            best_pos = pos
            break

    start = max(0, best_pos - 30)
    end = min(len(content), start + max_len)
    snippet = content[start:end].strip()

    if start > 0:
        snippet = '...' + snippet
    if end < len(content):
        snippet = snippet + '...'

    return snippet


def main():
    if len(sys.argv) < 2:
        print(json.dumps({'error': 'Usage: session_replay.py <query> [limit]'}, ensure_ascii=False))
        sys.exit(1)

    query = sys.argv[1]
    limit = int(sys.argv[2]) if len(sys.argv) > 2 else 5

    try:
        results = search_sessions(query, limit=limit)

        if not results:
            print(json.dumps({
                'query': query,
                'count': 0,
                'results': [],
                'message': f'No similar sessions found for: {query}'
            }, ensure_ascii=False))
            return

        output = {
            'query': query,
            'count': len(results),
            'results': results,
        }
        print(json.dumps(output, ensure_ascii=False, indent=2))

    except Exception as e:
        print(json.dumps({'error': str(e)}, ensure_ascii=False))
        sys.exit(1)


if __name__ == '__main__':
    main()
