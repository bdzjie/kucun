"""
Conversation Analyst — Hermes Deep Feature
==========================================

分析会话历史，生成结构化报告：
1. 对话频率统计
2. 高频主题提取
3. 工具使用模式
4. 记忆密度分析
5. SOP 触发指标

输出格式：
- 控制台摘要
- 结构化 JSON
- 可被 agent 读取并告知用户
"""

import os
import re
import json
import hashlib
from datetime import datetime, timedelta
from collections import defaultdict
from typing import Dict, List, Any, Optional

STATE_DIR = os.path.expanduser('~/.openclaw')
MEMORY_DIR = STATE_DIR + '/memory'
SESSIONS_DIR = STATE_DIR + '/agents/main/sessions'
DB_PATH = MEMORY_DIR + '/fts5.db'


def parse_timestamp(ts) -> Optional[datetime]:
    """解析时间戳"""
    if isinstance(ts, (int, float)):
        return datetime.fromtimestamp(ts / 1000)
    elif isinstance(ts, str):
        try:
            return datetime.fromisoformat(ts.replace('Z', '+00:00'))
        except:
            return None
    return None


def analyze_session_file(file_path: str) -> Dict[str, Any]:
    """分析单个会话文件"""
    stats = {
        'session_id': os.path.splitext(os.path.basename(file_path))[0],
        'file_size_kb': os.path.getsize(file_path) / 1024,
        'messages': 0,
        'user_messages': 0,
        'assistant_messages': 0,
        'tool_calls': 0,
        'total_chars': 0,
        'first_ts': None,
        'last_ts': None,
        'duration_minutes': 0,
        'topics': [],
        'tools_used': defaultdict(int),
        'avg_message_length': 0,
        'hourly_distribution': defaultdict(int),
    }

    user_texts = []
    tool_sequence = []

    try:
        with open(file_path, 'r', encoding='utf-8') as f:
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

                if role not in ('user', 'assistant', 'tool'):
                    continue

                stats['messages'] += 1

                # Extract content
                content = msg.get('content', [])
                text_content = ''
                if isinstance(content, list):
                    for block in content:
                        if block.get('type') == 'text':
                            text_content += block.get('text', '') + ' '
                        elif block.get('type') == 'toolResult':
                            tool_name = block.get('name', 'unknown')
                            tool_sequence.append(tool_name)
                            stats['tools_used'][tool_name] += 1
                            stats['tool_calls'] += 1
                        elif block.get('type') == 'toolUse' or block.get('type') == 'tool_call':
                            tool_name = block.get('name', 'unknown')
                            tool_sequence.append(tool_name)
                            stats['tools_used'][tool_name] += 1
                            stats['tool_calls'] += 1

                text_content = text_content.strip()
                if text_content:
                    stats['total_chars'] += len(text_content)
                    if role == 'user':
                        user_texts.append(text_content)
                        stats['user_messages'] += 1
                    elif role == 'assistant':
                        stats['assistant_messages'] += 1

                # Timestamp tracking
                if ts:
                    dt = parse_timestamp(ts)
                    if dt:
                        if stats['first_ts'] is None:
                            stats['first_ts'] = dt
                        stats['last_ts'] = dt
                        stats['hourly_distribution'][dt.hour] += 1

    except Exception as e:
        return {'error': str(e)}

    # Duration
    if stats['first_ts'] and stats['last_ts']:
        delta = stats['last_ts'] - stats['first_ts']
        stats['duration_minutes'] = delta.total_seconds() / 60

    # Average message length
    if stats['messages'] > 0:
        stats['avg_message_length'] = stats['total_chars'] / stats['messages']

    # Topics from user messages
    stats['topics'] = extract_topics(user_texts)

    # Tool sequence summary
    stats['tools_used'] = dict(sorted(
        stats['tools_used'].items(),
        key=lambda x: -x[1]
    ))

    stats['hourly_distribution'] = dict(stats['hourly_distribution'])

    return stats


def extract_topics(texts: List[str]) -> List[str]:
    """提取主题关键词"""
    stop_words = {
        'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
        'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should',
        'may', 'might', 'can', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by',
        'from', 'as', 'or', 'and', 'it', 'its', 'this', 'that', 'these', 'those',
        'i', 'me', 'my', 'we', 'our', 'you', 'your', 'he', 'she', 'they', 'them',
        'what', 'which', 'who', 'whom', 'when', 'where', 'why', 'how',
        '的', '了', '在', '是', '和', '就', '都', '也', '要', '会', '能', '这', '那',
        '我', '你', '他', '她', '它', '们', '个', '上', '下', '来', '去', '着',
    }

    word_counts = defaultdict(int)
    for text in texts:
        words = re.findall(r'\b[a-zA-Z\u4e00-\u9fff]{2,}\b', text.lower())
        for word in words:
            if word not in stop_words and len(word) >= 2:
                word_counts[word] += 1

    sorted_words = sorted(word_counts.items(), key=lambda x: -x[1])
    return [w for w, c in sorted_words[:8]]


def generate_report(sessions_dir: str) -> Dict[str, Any]:
    """生成完整分析报告"""
    session_files = sorted([
        os.path.join(sessions_dir, f)
        for f in os.listdir(sessions_dir)
        if f.endswith('.jsonl') and not f.endswith('.lock')
    ], key=lambda p: os.path.getmtime(p), reverse=True)

    # Analyze recent 10 sessions
    recent = session_files[:10]
    all_stats = []
    for fp in recent:
        stats = analyze_session_file(fp)
        if 'error' not in stats:
            all_stats.append(stats)

    if not all_stats:
        return {'error': 'No sessions analyzed'}

    # Aggregate stats
    total_messages = sum(s['messages'] for s in all_stats)
    total_user = sum(s['user_messages'] for s in all_stats)
    total_assistant = sum(s['assistant_messages'] for s in all_stats)
    total_tool_calls = sum(s['tool_calls'] for s in all_stats)
    total_duration = sum(s['duration_minutes'] for s in all_stats)

    # Topic aggregation
    all_topics = defaultdict(int)
    for s in all_stats:
        for topic in s.get('topics', []):
            all_topics[topic] += 1

    # Tool aggregation
    all_tools = defaultdict(int)
    for s in all_stats:
        for tool, count in s.get('tools_used', {}).items():
            all_tools[tool] += count

    # Hourly distribution
    hourly = defaultdict(int)
    for s in all_stats:
        for hour, count in s.get('hourly_distribution', {}).items():
            hourly[hour] += count

    # Peak hour
    peak_hour = max(hourly.items(), key=lambda x: x[1])[0] if hourly else 12

    # Memory density (user messages per session)
    memory_density = total_user / len(all_stats) if all_stats else 0

    # Engagement score (assistant messages per user message)
    engagement = total_assistant / total_user if total_user > 0 else 0

    # Sophistication (tool calls per assistant message)
    sophistication = total_tool_calls / total_assistant if total_assistant > 0 else 0

    # Score components
    activity_score = min(total_messages / 100, 1.0)  # Normalize to 100 msgs
    depth_score = min(tool_calls_per_session / 5, 1.0) if (tool_calls_per_session := total_tool_calls / len(all_stats)) else 0
    breadth_score = min(len(all_tools) / 10, 1.0)  # Normalize to 10 tools

    report = {
        'generated_at': datetime.now().isoformat(),
        'sessions_analyzed': len(all_stats),
        'total_sessions': len(session_files),
        'time_range': {
            'oldest': all_stats[-1]['first_ts'].isoformat() if all_stats[-1].get('first_ts') else None,
            'newest': all_stats[0]['first_ts'].isoformat() if all_stats[0].get('first_ts') else None,
        },
        'aggregate': {
            'total_messages': total_messages,
            'total_user_messages': total_user,
            'total_assistant_messages': total_assistant,
            'total_tool_calls': total_tool_calls,
            'total_duration_minutes': round(total_duration, 1),
        },
        'averages': {
            'messages_per_session': round(total_messages / len(all_stats), 1),
            'user_messages_per_session': round(total_user / len(all_stats), 1),
            'tool_calls_per_session': round(total_tool_calls / len(all_stats), 1),
            'minutes_per_session': round(total_duration / len(all_stats), 1),
            'avg_message_chars': round(sum(s['avg_message_length'] for s in all_stats) / len(all_stats)),
        },
        'engagement': {
            'ratio': round(engagement, 2),  # assistant per user
            'memory_density': round(memory_density, 1),  # user msgs per session
        },
        'top_topics': dict(sorted(all_topics.items(), key=lambda x: -x[1])[:10]),
        'top_tools': dict(sorted(all_tools.items(), key=lambda x: -x[1])[:10]),
        'peak_activity_hour': peak_hour,
        'hourly_distribution': dict(sorted(hourly.items())),
        'scores': {
            'activity': round(activity_score * 100, 1),
            'depth': round(depth_score * 100, 1),
            'breadth': round(breadth_score * 100, 1),
            'overall': round((activity_score * 0.3 + depth_score * 0.4 + breadth_score * 0.3) * 100, 1),
        },
        'sessions': [
            {
                'session_id': s['session_id'][:8],
                'messages': s['messages'],
                'user_msgs': s['user_messages'],
                'tool_calls': s['tool_calls'],
                'duration_min': round(s['duration_minutes'], 1),
                'topics': s['topics'][:3],
            }
            for s in all_stats[:5]
        ],
    }

    return report


def format_markdown(report: Dict[str, Any]) -> str:
    """格式化 Markdown 报告"""
    if 'error' in report:
        return f'分析失败: {report["error"]}'

    agg = report['aggregate']
    avg = report['averages']
    eng = report['engagement']
    scores = report['scores']

    peak = report['peak_activity_hour']

    md = f"""# Conversation Analyst Report

**生成时间**: {report['generated_at'][:19]}
**分析范围**: 最近 {report['sessions_analyzed']} / {report['total_sessions']} 个会话

---

## 活动概览

| 指标 | 值 |
|------|-----|
| 总消息数 | {agg['total_messages']} |
| 用户消息 | {agg['total_user_messages']} |
| 助手消息 | {agg['total_assistant_messages']} |
| 工具调用 | {agg['total_tool_calls']} |
| 总时长 | {agg['total_duration_minutes']} 分钟 |

**平均每会话**: {avg['messages_per_session']} 条消息 / {avg['minutes_per_session']} 分钟

---

## 互动质量

| 指标 | 值 | 说明 |
|------|-----|------|
| 助手/用户比 | {eng['ratio']} |越高越活跃 |
| 记忆密度 | {eng['memory_density']} | 每会话用户消息数 |
| 峰值时段 | {peak}:00 | 高频活动小时 |

---

## 评分

| 维度 | 分数 | 等级 |
|------|------|------|
| 活动度 | {scores['activity']}% | {'高' if scores['activity'] > 70 else '中' if scores['activity'] > 40 else '低'} |
| 深度(工具使用) | {scores['depth']}% | {'高' if scores['depth'] > 70 else '中' if scores['depth'] > 40 else '低'} |
| 广度(多样性) | {scores['breadth']}% | {'高' if scores['breadth'] > 70 else '中' if scores['breadth'] > 40 else '低'} |
| **综合** | **{scores['overall']}%** | {'优秀' if scores['overall'] > 70 else '良好' if scores['overall'] > 50 else '一般'} |

---

## 高频主题

{chr(10).join(f'{i+1}. **{t}** ({c}次)' for i, (t, c) in enumerate(list(report['top_topics'].items())[:8]))}

---

## 工具使用排行

{chr(10).join(f'{i+1}. `{t}` ({c}次)' for i, (t, c) in enumerate(list(report['top_tools'].items())[:8]))}

---

## 最近会话

| 会话 | 消息 | 用户 | 工具 | 时长 | 主题 |
|------|------|------|------|------|------|
{chr(10).join(f"| `{s['session_id']}` | {s['messages']} | {s['user_msgs']} | {s['tool_calls']} | {s['duration_min']}m | {', '.join(s['topics'])} |" for s in report['sessions'])}

---

_由 Conversation Analyst 自动生成_
"""

    return md


if __name__ == '__main__':
    report = generate_report(SESSIONS_DIR)
    print(json.dumps(report, ensure_ascii=False, indent=2))
