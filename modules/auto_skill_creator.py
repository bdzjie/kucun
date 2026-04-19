"""
Auto Skill Creator — Hermes Feature
====================================

从使用模式中自动创建技能。

触发条件：
1. 同一任务被重复执行 3+ 次
2. 用户明确说"每次都..." / "记住我总是..."
3. 高频操作模式（同一工具链 5+ 次使用）

创建流程：
1. 检测模式 → skill_name, description, trigger_patterns
2. 生成 SKILL.md (描述)
3. 生成 handler.js (逻辑)
4. 注册到 skill registry
5. 通知主人确认
"""

import os
import re
import json
import hashlib
from datetime import datetime
from typing import Dict, List, Optional
from collections import defaultdict

# ============================================================================
# Config
# ============================================================================

STATE_DIR = os.path.expanduser('~/.openclaw')
WORKSPACE = os.path.expanduser('C:/Users/Administrator/.openclaw/workspace')
SKILLS_DIR = WORKSPACE + '/skills'
SKILL_REGISTRY_FILE = STATE_DIR + '/memory/skill_registry.json'

MIN_REPEAT_COUNT = 3
MIN_TOOL_CHAIN_COUNT = 5

# ============================================================================
# Constraint System — Evolver-inspired safety checks
# ============================================================================

FORBIDDEN_SKILL_NAMES = {
    'system', 'kernel', 'root', 'admin', 'sudo', 'password', 'secret',
    'eval', 'exec', 'exec-inline', 'windows-gui', 'windows-gui-workflow',
    'memory-hook', 'hooks', 'scripts', 'modules',
}

FORBIDDEN_PATH_PATTERNS = [
    '..', '/.git/', '\\.git\\', '/node_modules/', '\\node_modules\\',
    '/.openclaw/', '\\.openclaw\\', '/windows/', '\\windows\\',
    '/System32/', '\\System32\\', '/Windows/', '\\Windows\\',
    '/usr/bin/', '\\usr\\bin\\', '/bin/', '\\bin\\',
]

def validate_constraint(skill_name: str) -> tuple[bool, str]:
    """
    Check if skill creation is safe (Evolver Constraint-inspired).
    Returns (allowed, reason).
    """
    # 1. Forbidden names check
    if skill_name.lower() in FORBIDDEN_SKILL_NAMES:
        return False, f'Forbidden skill name: {skill_name}'

    # 2. Path traversal check
    if '..' in skill_name or '/' in skill_name or '\\' in skill_name:
        return False, f'Path traversal attempt: {skill_name}'

    # 3. Alphanumeric + underscore + dash only
    if not re.match(r'^[a-zA-Z0-9_-]+$', skill_name):
        return False, f'Invalid characters in skill name: {skill_name}'

    # 4. Length check
    if len(skill_name) < 3 or len(skill_name) > 64:
        return False, f'Skill name length must be 3-64: {skill_name}'

    # 5. Reserved prefix check
    for prefix in ['openclaw', 'hook', 'skill', 'system']:
        if skill_name.lower().startswith(prefix + '-'):
            return False, f'Reserved prefix ({prefix}): {skill_name}'

    # 6. Pattern blacklist check
    skill_lower = skill_name.lower()
    for pattern in FORBIDDEN_PATH_PATTERNS:
        if pattern.lstrip('/\\').lower() in skill_lower:
            return False, f'Forbidden pattern in name: {pattern}'

    return True, 'OK'


def check_file_constraint(file_path: str) -> tuple[bool, str]:
    """Check if a file path is safe to write."""
    path_lower = file_path.lower().replace('\\', '/')
    for forbidden in FORBIDDEN_PATH_PATTERNS:
        f_lower = forbidden.lower().replace('\\', '/')
        if f_lower in path_lower:
            return False, f'Forbidden path: {forbidden}'
    return True, 'OK'

# ============================================================================
# Types
# ============================================================================

class Pattern:
    def __init__(
        self,
        pattern_id: str,
        pattern_type: str,
        content: str,
        occurrences: int,
        first_seen: str,
        last_seen: str,
        skill_name: Optional[str] = None,
    ):
        self.pattern_id = pattern_id
        self.pattern_type = pattern_type
        self.content = content
        self.occurrences = occurrences
        self.first_seen = first_seen
        self.last_seen = last_seen
        self.skill_name = skill_name


class SkillCandidate:
    def __init__(
        self,
        skill_name: str,
        description: str,
        trigger_patterns: List[str],
        confidence: float,
        evidence: List[str],
        created_at: str,
    ):
        self.skill_name = skill_name
        self.description = description
        self.trigger_patterns = trigger_patterns
        self.confidence = confidence
        self.evidence = evidence
        self.created_at = created_at


# ============================================================================
# Pattern Detection
# ============================================================================

def detect_repeat_tasks(memories_jsonl_path: str, min_count: int = 3) -> List[Pattern]:
    """从 memories.jsonl 中检测重复任务模式"""
    task_hash_counts = defaultdict(lambda: {
        'count': 0, 'first': None, 'last': None, 'examples': []
    })

    if not os.path.exists(memories_jsonl_path):
        return []

    with open(memories_jsonl_path, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                continue

            # 只看 user 类型的记忆
            if entry.get('role') != 'user' and entry.get('type') != 'user_message':
                continue

            content = entry.get('content', entry.get('text', ''))
            if not content or len(content) < 10:
                continue

            # 简单任务哈希（取前100字符的SHA256）
            task_hash = hashlib.sha256(content[:100].encode()).hexdigest()[:16]
            ts = entry.get('timestamp', entry.get('created_at', ''))

            task_hash_counts[task_hash]['count'] += 1
            if not task_hash_counts[task_hash]['first']:
                task_hash_counts[task_hash]['first'] = ts
            task_hash_counts[task_hash]['last'] = ts
            if len(task_hash_counts[task_hash]['examples']) < 5:
                task_hash_counts[task_hash]['examples'].append(content[:200])

    # Filter by min count
    patterns = []
    for task_hash, data in task_hash_counts.items():
        if data['count'] >= min_count:
            first_example = data['examples'][0] if data['examples'] else ''
            patterns.append(Pattern(
                pattern_id=f"repeat_{task_hash}",
                pattern_type='repeat_task',
                content=first_example,
                occurrences=data['count'],
                first_seen=data['first'],
                last_seen=data['last'],
            ))

    return patterns


def detect_preferences(memories_jsonl_path: str) -> List[Pattern]:
    """从记忆中检测偏好模式（用户明确说明的习惯）"""
    patterns = []

    preference_markers = [
        r'我(总是|通常|一般)?[每每]?(.*?)[用用]|',
        r'(记住|记住我)',
        r'prefer|always|never|my rule',
        r'不要|别|禁止',
    ]

    if not os.path.exists(memories_jsonl_path):
        return []

    with open(memories_jsonl_path, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                continue

            content = entry.get('content', entry.get('text', ''))
            if not content:
                continue

            for marker in preference_markers:
                if re.search(marker, content, re.IGNORECASE):
                    patterns.append(Pattern(
                        pattern_id=f"pref_{hashlib.md5(content[:50].encode()).hexdigest()[:8]}",
                        pattern_type='preference',
                        content=content[:300],
                        occurrences=1,
                        first_seen=entry.get('timestamp', ''),
                        last_seen=entry.get('timestamp', ''),
                    ))
                    break

    return patterns


def detect_tool_chains(session_dir: str, min_count: int = 5) -> List[Pattern]:
    """从会话中检测高频工具链"""
    tool_sequences = defaultdict(lambda: {'count': 0, 'sequences': []})

    if not os.path.exists(session_dir):
        return []

    for jsonl_file in os.listdir(session_dir):
        if not jsonl_file.endswith('.jsonl') or jsonl_file.endswith('.lock'):
            continue

        file_path = os.path.join(session_dir, jsonl_file)
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                current_sequence = []
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        obj = json.loads(line)
                    except json.JSONDecodeError:
                        continue

                    if obj.get('type') == 'message':
                        msg = obj.get('message', {})
                        content = msg.get('content', [])

                        if isinstance(content, list):
                            for block in content:
                                if block.get('type') == 'toolResult':
                                    tool_name = block.get('name', 'unknown')
                                    current_sequence.append(tool_name)

                        # 检测重复序列
                        if current_sequence and len(current_sequence) >= 3:
                            seq_key = '->'.join(current_sequence[-5:])
                            tool_sequences[seq_key]['count'] += 1
                            if len(tool_sequences[seq_key]['sequences']) < 3:
                                tool_sequences[seq_key]['sequences'].append('->'.join(current_sequence))

        except Exception:
            continue

    # Filter and convert to Patterns
    result = []
    for seq, data in tool_sequences.items():
        if data['count'] >= min_count:
            result.append(Pattern(
                pattern_id=f"chain_{hashlib.md5(seq.encode()).hexdigest()[:8]}",
                pattern_type='tool_chain',
                content=f"Tool chain: {seq} (used {data['count']} times)",
                occurrences=data['count'],
                first_seen='',
                last_seen='',
            ))

    return result


# ============================================================================
# Skill Generation
# ============================================================================

def generate_skill_name(pattern: Pattern) -> str:
    """从模式内容生成技能名称"""
    # 提取关键词
    words = re.findall(r'[\w\u4e00-\u9fff]{3,}', pattern.content)
    # 过滤停用词
    stop_words = {
        'the', 'a', 'an', 'is', 'are', 'was', 'be', 'to', 'of', 'in', 'for', 'on',
        'with', 'at', 'by', 'and', 'or', 'but', 'if', 'then', 'else', 'when',
        '我', '你', '他', '她', '它', '的', '了', '在', '是', '和', '就', '都',
        '也', '要', '会', '能', '这', '那', '一个', '什么', '怎么', '如何',
    }
    words = [w for w in words if w.lower() not in stop_words and len(w) >= 2]

    if not words:
        return f"auto_skill_{pattern.pattern_id}"

    # 取前3个最有意义的词
    core = '_'.join(words[:3])
    # 清理特殊字符
    core = re.sub(r'[^\w_]', '', core)
    return f"auto_{core[:30]}"


def skill_exists(skill_name: str) -> bool:
    """检查技能是否已存在"""
    skill_path = os.path.join(SKILLS_DIR, skill_name)
    return os.path.exists(skill_path)


def create_skill(candidate: SkillCandidate) -> bool:
    """创建技能文件"""
    if skill_exists(candidate.skill_name):
        return False

    # Evolver Constraint check — prevent破坏性技能创建
    allowed, reason = validate_constraint(candidate.skill_name)
    if not allowed:
        print(f'[auto_skill_creator] Constraint blocked: {reason}', flush=True)
        return False

    skill_path = os.path.join(SKILLS_DIR, candidate.skill_name)

    # File-level constraint check
    allowed, reason = check_file_constraint(skill_path)
    if not allowed:
        print(f'[auto_skill_creator] File constraint blocked: {reason}', flush=True)
        return False
    os.makedirs(skill_path, exist_ok=True)

    # 生成 SKILL.md
    trigger_lines = '\n'.join(f'- {p[:150]}' for p in candidate.trigger_patterns[:5])
    evidence_lines = '\n'.join(f'- {e[:100]}' for e in candidate.evidence[:3])

    skill_md = f"""# {candidate.skill_name}

> Auto-created by Auto Skill Creator | {candidate.created_at}
> Confidence: {candidate.confidence:.0%}

## Description

{candidate.description}

## Trigger Patterns

{trigger_lines}

## Evidence

{evidence_lines}

## Auto-Generated

This skill was automatically created based on detected usage patterns.
Edit this file to refine the skill behavior.
"""

    # Generate handler.js — GenericAgent self-bootstrapping style
    trigger_list = json.dumps(candidate.trigger_patterns[:5], ensure_ascii=False)
    handler_js = f"""
/**
 * Auto-generated Skill Handler: {candidate.skill_name}
 * Created: {candidate.created_at}
 * Confidence: {candidate.confidence:.0%}
 *
 * Trigger Patterns:
 *   {chr(10).join(p[:70] for p in candidate.trigger_patterns[:3])}
 *
 * Evidence:
 *   {chr(10).join(e[:80] for e in candidate.evidence[:2])}
 *
 * GenericAgent Self-Bootstrapping: 任务成功后自动固化执行路径。
 */

export default async function handler(event) {{
    const skillName = '{candidate.skill_name}';
    const confidence = {candidate.confidence:.2f};

    let input = '';
    if (event?.context?.content) input = event.context.content;
    else if (event?.message?.content) input = event.message.content;

    // Trigger matching — exact + fuzzy
    const triggers = {trigger_list};
    const matched = triggers.find(t =>
        typeof t === 'string' && input.toLowerCase().includes(t.toLowerCase())
    );

    if (!matched) {{
        const triggerWords = triggers.flatMap(t =>
            t.split(/[\\s,_-]+/).filter(w => w.length > 2)
        );
        const inputWords = input.toLowerCase().split(/[\\s,_-]+/);
        const hit = triggerWords.some(w => inputWords.some(iw => iw.includes(w)));
        if (!hit) {{
            return {{
                handled: true,
                skill: skillName,
                status: 'no_match',
                triggers,
                message: `[$\{{skillName\}}] Trigger not matched. Try: $\{{triggers[0]?.slice(0,50)}}`,
            }};
        }}
    }}

    return {{
        handled: true,
        skill: skillName,
        status: 'executed',
        confidence,
        timestamp: new Date().toISOString(),
        trigger: matched || 'fuzzy',
        message: `[$\{{skillName\}}] Skill executed. Confidence: $\{{(confidence*100).toFixed(0)}}%`,
    }};
}}
"""

    # 生成 HOOK.md
    hook_md = f"""---
metadata:
  openclaw:
    version: 1.0
    type: skill
    name: {candidate.skill_name}
    description: {candidate.description}
    autoCreated: true
    confidence: {candidate.confidence}
    triggers: {json.dumps(candidate.trigger_patterns[:5])}
---

# {candidate.skill_name} — Auto Skill

## Description

{candidate.description}

## Behavior

Auto-generated skill handler. Modify `handler.js` to customize behavior.

## Evidence

{evidence_lines}
"""

    with open(os.path.join(skill_path, 'SKILL.md'), 'w', encoding='utf-8') as f:
        f.write(skill_md)

    with open(os.path.join(skill_path, 'handler.js'), 'w', encoding='utf-8') as f:
        f.write(handler_js)

    with open(os.path.join(skill_path, 'HOOK.md'), 'w', encoding='utf-8') as f:
        f.write(hook_md)

    # 注册到 skill registry
    _register_skill(candidate)

    return True


def _register_skill(candidate: SkillCandidate):
    """注册技能到本地 registry"""
    registry = {}
    if os.path.exists(SKILL_REGISTRY_FILE):
        try:
            with open(SKILL_REGISTRY_FILE, 'r', encoding='utf-8') as f:
                registry = json.load(f)
        except json.JSONDecodeError:
            registry = {}

    if 'skills' not in registry:
        registry['skills'] = {}

    registry['skills'][candidate.skill_name] = {
        'description': candidate.description,
        'autoCreated': True,
        'createdAt': candidate.created_at,
        'confidence': candidate.confidence,
        'triggerPatterns': candidate.trigger_patterns[:5],
        'evidenceCount': len(candidate.evidence),
    }

    with open(SKILL_REGISTRY_FILE, 'w', encoding='utf-8') as f:
        json.dump(registry, f, indent=2, ensure_ascii=False)


# ============================================================================
# Main Run
# ============================================================================

def run_auto_skill_creator():
    """执行 Auto Skill Creator"""
    memories_path = STATE_DIR + '/memory/memories.jsonl'
    sessions_dir = STATE_DIR + '/agents/main/sessions'

    candidates = []

    # 1. 检测重复任务
    print('[auto_skill] Checking for repeat tasks...')
    repeat_patterns = detect_repeat_tasks(memories_path, min_count=MIN_REPEAT_COUNT)
    for p in repeat_patterns:
        name = generate_skill_name(p)
        if not skill_exists(name):
            candidates.append(SkillCandidate(
                skill_name=name,
                description='Auto-detected repeated task pattern (%d occurrences)' % p.occurrences,
                trigger_patterns=[p.content[:100]],
                confidence=min(0.5 + p.occurrences * 0.1, 0.95),
                evidence=[p.content[:200]],
                created_at=datetime.now().isoformat(),
            ))

    # 2. 检测偏好
    print('[auto_skill] Checking for preferences...')
    pref_patterns = detect_preferences(memories_path)
    for p in pref_patterns:
        name = 'pref_' + hashlib.md5(p.content[:30].encode()).hexdigest()[:8]
        if not skill_exists(name):
            candidates.append(SkillCandidate(
                skill_name=name,
                description='User preference: %s' % p.content[:100],
                trigger_patterns=[p.content[:150]],
                confidence=0.8,
                evidence=[p.content[:200]],
                created_at=datetime.now().isoformat(),
            ))

    # 3. 检测工具链
    print('[auto_skill] Checking for tool chains...')
    chain_patterns = detect_tool_chains(sessions_dir, min_count=MIN_TOOL_CHAIN_COUNT)
    for p in chain_patterns:
        name = 'chain_' + hashlib.md5(p.content.encode()).hexdigest()[:8]
        if not skill_exists(name):
            candidates.append(SkillCandidate(
                skill_name=name,
                description=p.content,
                trigger_patterns=[p.content],
                confidence=min(0.4 + p.occurrences * 0.05, 0.9),
                evidence=[p.content],
                created_at=datetime.now().isoformat(),
            ))

    # 去重
    seen = set()
    unique_candidates = []
    for c in candidates:
        if c.skill_name not in seen:
            seen.add(c.skill_name)
            unique_candidates.append(c)

    # 创建技能（只创建高置信度的）
    created = []
    for candidate in unique_candidates:
        if candidate.confidence >= 0.6:
            if create_skill(candidate):
                created.append(candidate.skill_name)
                print('[auto_skill] Created: %s (confidence: %d%%)' % (
                    candidate.skill_name, int(candidate.confidence * 100)
                ))
            else:
                print('[auto_skill] Skipped (exists): %s' % candidate.skill_name)

    return {
        'candidates_found': len(unique_candidates),
        'skills_created': len(created),
        'created_skills': created,
    }


if __name__ == '__main__':
    result = run_auto_skill_creator()
    print(json.dumps(result, ensure_ascii=False))
