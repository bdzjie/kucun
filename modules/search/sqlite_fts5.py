"""
SQLite FTS5 Module — Hermes FTS5-style Full-text Search
=======================================================

实现 Hermes 的 SQLite FTS5 会话搜索功能：
- BM25 排名算法
- Porter Stemming + Unicode61 Tokenizer
- Snippet 生成
- 会话摘要

数据源：OpenClaw session .jsonl 文件
"""

import sqlite3
import json
import re
import os
import math
from typing import List, Dict, Any, Optional, Tuple
from dataclasses import dataclass
from pathlib import Path

# ============================================================================
# BM25 Parameters (Hermes-inspired)
# ============================================================================

BM25_K1 = 1.5
BM25_B = 0.75

# ============================================================================
# Types
# ============================================================================

@dataclass
class Fts5Result:
    session_id: str
    message_id: str
    role: str
    content: str
    timestamp: int
    score: float
    snippet: str

@dataclass
class SessionSummary:
    session_id: str
    title: str
    first_message: str
    last_message: str
    message_count: int
    user_message_count: int
    assistant_message_count: int
    duration_minutes: float
    topics: List[str]

# ============================================================================
# FTS5 Database
# ============================================================================

class SqliteFts5:
    """
    SQLite FTS5 实现 — 对标 Hermes hermes_state.py
    """

    def __init__(self, db_path: str):
        self.db_path = db_path
        self.conn: Optional[sqlite3.Connection] = None
        self._connect()
        self._init_schema()

    def _connect(self):
        """建立数据库连接"""
        self.conn = sqlite3.connect(self.db_path, check_same_thread=False)
        self.conn.execute("PRAGMA journal_mode=WAL")
        self.conn.execute("PRAGMA synchronous=NORMAL")
        self.conn.execute("PRAGMA cache_size=-64000")  # 64MB cache

    def _init_schema(self):
        """初始化 FTS5 模式"""
        # FTS5 虚拟表
        self.conn.execute("""
            CREATE VIRTUAL TABLE IF NOT EXISTS sessions_fts USING fts5(
                session_id UNINDEXED,
                message_id UNINDEXED,
                role UNINDEXED,
                content,
                timestamp UNINDEXED,
                tokenize='porter unicode61'
            )
        """)

        # 会话摘要表
        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS session_summaries (
                session_id TEXT PRIMARY KEY,
                title TEXT,
                first_message TEXT,
                last_message TEXT,
                message_count INTEGER,
                user_message_count INTEGER,
                assistant_message_count INTEGER,
                duration_minutes REAL,
                topics TEXT,
                indexed_at INTEGER
            )
        """)

        # BM25 统计表
        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS fts5_stats (
                term TEXT PRIMARY KEY,
                doc_count INTEGER,
                idf REAL
            )
        """)

        # Commit
        self.conn.commit()

    def index_session_file(self, session_file: str, session_id: str = None) -> int:
        """
        索引单个 session .jsonl 文件
        返回索引的消息数
        """
        if session_id is None:
            session_id = Path(session_file).stem

        # 清理旧索引
        self.conn.execute(
            "DELETE FROM sessions_fts WHERE session_id = ?",
            (session_id,)
        )
        self.conn.execute(
            "DELETE FROM session_summaries WHERE session_id = ?",
            (session_id,)
        )

        indexed_count = 0
        first_message = ""
        last_message = ""
        user_count = 0
        assistant_count = 0
        first_ts = None
        last_ts = None
        all_user_texts = []

        with open(session_file, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue

                try:
                    obj = json.loads(line)
                except json.JSONDecodeError:
                    continue

                if obj.get('type') != 'message':
                    continue

                msg = obj.get('message', {})
                role = msg.get('role', '')
                ts = obj.get('timestamp')
                msg_id = obj.get('id', '')

                # 解析时间戳
                if isinstance(ts, str):
                    try:
                        from datetime import datetime
                        dt = datetime.fromisoformat(ts.replace('Z', '+00:00'))
                        ts = int(dt.timestamp() * 1000)
                    except:
                        ts = 0
                elif ts is None:
                    ts = 0

                if role not in ('user', 'assistant'):
                    continue

                # 提取文本内容
                content = ""
                content_blocks = msg.get('content', [])
                if isinstance(content_blocks, list):
                    for block in content_blocks:
                        if block.get('type') == 'text':
                            content += block.get('text', '') + "\n"
                        elif block.get('type') == 'toolResult':
                            content += f"[tool: {block.get('name', 'unknown')}]\n"
                content = content.strip()

                if not content:
                    continue

                # 索引
                self.conn.execute("""
                    INSERT INTO sessions_fts (session_id, message_id, role, content, timestamp)
                    VALUES (?, ?, ?, ?, ?)
                """, (session_id, msg_id, role, content, ts))

                indexed_count += 1

                # 统计
                if role == 'user':
                    user_count += 1
                    all_user_texts.append(content[:200])
                    if not first_message:
                        first_message = content[:150]
                    last_message = content[:150]
                elif role == 'assistant':
                    assistant_count += 1

                if first_ts is None:
                    first_ts = ts
                last_ts = ts

        # 计算 duration
        duration = 0.0
        if first_ts and last_ts:
            duration = (last_ts - first_ts) / 60000.0  # ms -> minutes

        # 生成标题（从第一条用户消息提取）
        title = first_message[:80] + "..." if len(first_message) > 80 else first_message

        # 简单主题提取
        topics = self._extract_topics(all_user_texts)

        # 保存摘要
        self.conn.execute("""
            INSERT OR REPLACE INTO session_summaries
            (session_id, title, first_message, last_message, message_count,
             user_message_count, assistant_message_count, duration_minutes, topics, indexed_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            session_id, title,
            first_message[:300] if first_message else "",
            last_message[:300] if last_message else "",
            indexed_count, user_count, assistant_count,
            duration, json.dumps(topics), int(os.path.getmtime(session_file) * 1000)
        ))

        self.conn.commit()
        return indexed_count

    def _extract_topics(self, texts: List[str]) -> List[str]:
        """从用户消息中提取主题关键词"""
        # 简单词频统计
        stop_words = {'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been',
                      'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
                      'could', 'should', 'may', 'might', 'can', 'to', 'of', 'in',
                      'for', 'on', 'with', 'at', 'by', 'from', 'as', 'or', 'and',
                      'the', 'i', 'me', 'my', 'we', 'our', 'you', 'your', 'it'}
        
        word_counts: Dict[str, int] = {}
        for text in texts:
            words = re.findall(r'\b[a-zA-Z\u4e00-\u9fff]{3,}\b', text.lower())
            for word in words:
                if word not in stop_words:
                    word_counts[word] = word_counts.get(word, 0) + 1

        # 取最常见的词
        sorted_words = sorted(word_counts.items(), key=lambda x: -x[1])
        return [w for w, c in sorted_words[:5]]

    def search(
        self,
        query: str,
        limit: int = 20,
        session_id: str = None,
        role: str = None
    ) -> List[Fts5Result]:
        """
        BM25 搜索
        返回匹配的 Fts5Result 列表
        """
        if not query.strip():
            return []

        # FTS5 MATCH 查询
        fts_query = self._build_fts_query(query)

        sql = """
            SELECT session_id, message_id, role, content, timestamp,
                   bm25(sessions_fts) as score
            FROM sessions_fts
            WHERE sessions_fts MATCH ?
        """
        params: List[Any] = [fts_query]

        if session_id:
            sql += " AND session_id = ?"
            params.append(session_id)

        if role:
            sql += " AND role = ?"
            params.append(role)

        sql += f" ORDER BY score LIMIT {limit}"

        cursor = self.conn.execute(sql, params)
        rows = cursor.fetchall()

        results = []
        for row in rows:
            s_id, msg_id, r, content, ts, score = row
            snippet = self._generate_snippet(content, query)
            results.append(Fts5Result(
                session_id=s_id,
                message_id=msg_id,
                role=r,
                content=content[:500],
                timestamp=ts,
                score=abs(score) if score else 0.0,
                snippet=snippet
            ))

        return results

    def _build_fts_query(self, query: str) -> str:
        """
        构建 FTS5 查询字符串
        处理 AND/OR/NOT 和引号包裹的短语
        """
        query = query.strip()
        if not query:
            return '""'

        # 短语查询：引号包裹的内容作为词组
        # 非短语：按空格分词
        tokens = []
        in_phrase = False
        current_phrase = []

        i = 0
        while i < len(query):
            ch = query[i]

            if ch == '"':
                if in_phrase:
                    # 结束短语
                    if current_phrase:
                        tokens.append('"' + ' '.join(current_phrase) + '"')
                        current_phrase = []
                    in_phrase = False
                else:
                    in_phrase = True
                i += 1
                continue

            if in_phrase:
                if ch == ' ':
                    if current_phrase:
                        current_phrase.append(query[i-1] if i > 0 else '')
                    current_phrase.append(' ')
                else:
                    current_phrase.append(ch)
            else:
                if ch == ' ':
                    if current_phrase:
                        token = ''.join(current_phrase).strip()
                        if token:
                            tokens.append(token)
                        current_phrase = []
                else:
                    current_phrase.append(ch)
            i += 1

        if current_phrase:
            token = ''.join(current_phrase).strip()
            if token:
                if in_phrase:
                    tokens.append('"' + token + '"')
                else:
                    tokens.append(token)

        if not tokens:
            return '""'

        # FTS5 支持 AND/OR 操作符
        return ' OR '.join(tokens)

    def _generate_snippet(self, content: str, query: str, max_len: int = 200) -> str:
        """
        生成查询结果片段 — 在匹配词周围高亮
        """
        if not content:
            return ""

        # 找第一个匹配词的位置
        query_words = query.lower().split()
        content_lower = content.lower()

        best_pos = -1
        for word in query_words:
            # 去除标点后的词
            clean_word = re.sub(r'[^\w]', '', word)
            if not clean_word:
                continue
            pos = content_lower.find(clean_word)
            if pos >= 0:
                best_pos = pos
                break

        if best_pos < 0:
            # 没有精确匹配，显示开头
            return content[:max_len] + ("..." if len(content) > max_len else "")

        # 在匹配词前后截取片段
        start = max(0, best_pos - 50)
        end = min(len(content), start + max_len)

        snippet = content[start:end]
        if start > 0:
            snippet = "..." + snippet
        if end < len(content):
            snippet = snippet + "..."

        return snippet

    def get_session_summary(self, session_id: str) -> Optional[SessionSummary]:
        """获取会话摘要"""
        cursor = self.conn.execute(
            "SELECT * FROM session_summaries WHERE session_id = ?",
            (session_id,)
        )
        row = cursor.fetchone()
        if not row:
            return None

        cols = [desc[0] for desc in self.conn.execute(
            "SELECT * FROM session_summaries LIMIT 0"
        ).description]

        data = dict(zip(cols, row))
        return SessionSummary(
            session_id=data['session_id'],
            title=data['title'] or "",
            first_message=data['first_message'] or "",
            last_message=data['last_message'] or "",
            message_count=data['message_count'] or 0,
            user_message_count=data['user_message_count'] or 0,
            assistant_message_count=data['assistant_message_count'] or 0,
            duration_minutes=data['duration_minutes'] or 0.0,
            topics=json.loads(data['topics'] or '[]')
        )

    def list_indexed_sessions(self) -> List[str]:
        """列出所有已索引的会话ID"""
        cursor = self.conn.execute(
            "SELECT DISTINCT session_id FROM session_summaries ORDER BY indexed_at DESC"
        )
        return [row[0] for row in cursor.fetchall()]

    def get_stats(self) -> Dict[str, Any]:
        """获取索引统计"""
        cursor = self.conn.execute("SELECT COUNT(*) FROM sessions_fts")
        total_messages = cursor.fetchone()[0]

        cursor = self.conn.execute("SELECT COUNT(DISTINCT session_id) FROM sessions_fts")
        total_sessions = cursor.fetchone()[0]

        cursor = self.conn.execute("SELECT COUNT(*) FROM session_summaries")
        total_summaries = cursor.fetchone()[0]

        return {
            'total_messages': total_messages,
            'total_sessions': total_sessions,
            'total_summaries': total_summaries,
            'db_path': self.db_path
        }

    def close(self):
        """关闭连接"""
        if self.conn:
            self.conn.close()
            self.conn = None


# ============================================================================
# Bridge — 暴露给 JavaScript
# ============================================================================

def create_index(sessions_dir: str, db_path: str) -> str:
    """索引 sessions 目录下的所有 .jsonl 文件"""
    fts = SqliteFts5(db_path)

    sessions_path = Path(sessions_dir)
    if not sessions_path.exists():
        return json.dumps({'error': f'Sessions dir not found: {sessions_dir}'})

    indexed = 0
    for jsonl_file in sorted(sessions_path.glob('*.jsonl')):
        if jsonl_file.name.endswith('.lock'):
            continue
        try:
            n = fts.index_session_file(str(jsonl_file))
            indexed += 1
        except Exception as e:
            print(f"Error indexing {jsonl_file.name}: {e}", flush=True)

    stats = fts.get_stats()
    fts.close()
    return json.dumps({'indexed_sessions': indexed, 'stats': stats})


def search_sessions(query: str, db_path: str, limit: int = 20, session_id: str = None) -> str:
    """搜索会话"""
    fts = SqliteFts5(db_path)
    results = fts.search(query, limit=limit, session_id=session_id)
    fts.close()

    return json.dumps([
        {
            'session_id': r.session_id,
            'message_id': r.message_id,
            'role': r.role,
            'content': r.content,
            'timestamp': r.timestamp,
            'score': r.score,
            'snippet': r.snippet
        }
        for r in results
    ], ensure_ascii=False)


def get_summary(session_id: str, db_path: str) -> str:
    """获取会话摘要"""
    fts = SqliteFts5(db_path)
    summary = fts.get_session_summary(session_id)
    fts.close()

    if not summary:
        return json.dumps({'error': f'Session {session_id} not found'})

    return json.dumps({
        'session_id': summary.session_id,
        'title': summary.title,
        'first_message': summary.first_message,
        'last_message': summary.last_message,
        'message_count': summary.message_count,
        'user_message_count': summary.user_message_count,
        'assistant_message_count': summary.assistant_message_count,
        'duration_minutes': summary.duration_minutes,
        'topics': summary.topics
    }, ensure_ascii=False)


def get_stats(db_path: str) -> str:
    """获取索引统计"""
    fts = SqliteFts5(db_path)
    stats = fts.get_stats()
    fts.close()
    return json.dumps(stats)


def list_sessions(db_path: str) -> str:
    """列出已索引的会话"""
    fts = SqliteFts5(db_path)
    sessions = fts.list_indexed_sessions()
    fts.close()
    return json.dumps(sessions)
