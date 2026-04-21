"""
skill_progressive_disclosure.py
===============================

将大型 SKILL.md 拆分为 references/ 目录下的渐进式文档。

功能:
1. 分析 SKILL.md 内容，识别可拆分部分
2. 将长示例、变体详情、深度参考移入 references/
3. 生成简洁的 SKILL.md（仅保留摘要+索引）
4. 提供 load_reference() 按需加载参考文档

Usage:
  from modules.skill_progressive_disclosure import split_skill_md, load_reference

  # 拆分一个skill的SKILL.md
  result = split_skill_md('agent-browser')

  # 按需加载参考文档
  content = load_reference('agent-browser', 'commands')
"""

import os
import re
import hashlib
from pathlib import Path
from typing import Dict, List, Tuple, Optional

WORKSPACE = Path(r'C:\Users\Administrator\.openclaw\workspace')
SKILLS_DIR = WORKSPACE / 'skills'
REFERENCES_DIR = 'references'

# 内容类型识别模式
REFERENCE_SECTIONS = {
    'examples': {
        'patterns': [r'^#{1,3}\s*Examples?\s*$', r'^#{1,3}\s*Example[s]?\s*:', r'```[a-zA-Z]*\n.*```'],
        'threshold_lines': 20,
        'priority': 1,
    },
    'commands': {
        'patterns': [r'^#{1,3}\s*Commands?\s*$', r'^#{1,3}\s*Command[s]?\s*:', r'\|.*\|.*\|'],
        'threshold_lines': 15,
        'priority': 2,
    },
    'troubleshooting': {
        'patterns': [r'^#{1,3}\s*Troubleshoot', r'^#{1,3}\s*FAQ', r'^#{1,3}\s*Common Issues'],
        'threshold_lines': 10,
        'priority': 3,
    },
    'detailed_guide': {
        'patterns': [r'^#{1,3}\s*Detailed?', r'^#{1,3}\s*Guide', r'^#{1,3}\s*Advanced'],
        'threshold_lines': 30,
        'priority': 4,
    },
    'api_reference': {
        'patterns': [r'^#{1,3}\s*API', r'^#{1,3}\s*Reference', r'^#{1,3}\s*Endpoints?'],
        'threshold_lines': 20,
        'priority': 5,
    },
}


def parse_frontmatter(content: str) -> Tuple[Dict, str, int]:
    """解析 YAML frontmatter，返回 (frontmatter_dict, body, end_offset)"""
    if not content.startswith('---'):
        return {}, content, 0

    end_idx = content.index('---', 3)
    if end_idx < 0:
        return {}, content, 0

    fm_text = content[3:end_idx].strip()
    body = content[end_idx + 3:].strip()

    fm = {}
    for line in fm_text.split('\n'):
        if ':' in line:
            key, val = line.split(':', 1)
            fm[key.strip()] = val.strip().strip('"\'')

    return fm, body, end_idx + 3


def extract_sections(body: str) -> List[Dict]:
    """将 markdown body 拆分为节，返回 [{heading, level, content, lines}]"""
    lines = body.split('\n')
    sections = []
    current = {'heading': '', 'level': 0, 'content': [], 'lines': 0}

    for line in lines:
        m = re.match(r'^(#{1,6})\s+(.+)$', line)
        if m:
            if current['content'] or current['heading']:
                sections.append(current)
            level = len(m.group(1))
            heading = m.group(2).strip()
            current = {'heading': heading, 'level': level, 'content': [line], 'lines': 1}
        else:
            current['content'].append(line)
            current['lines'] += 1

    if current['content'] or current['heading']:
        sections.append(current)

    return sections


def classify_section(section: Dict) -> Optional[str]:
    """根据标题和内容类型将节分类"""
    heading_lower = section['heading'].lower()
    content_str = '\n'.join(section['content'][:50])  # 只看前50行

    for ref_type, config in REFERENCE_SECTIONS.items():
        for pattern in config['patterns']:
            if re.search(pattern, heading_lower, re.IGNORECASE):
                return ref_type
        # 也检查内容
        if re.search(r'(example|usage|demo)', content_str, re.IGNORECASE):
            if section['lines'] >= config['threshold_lines']:
                return ref_type

    return None


def split_skill_md(skill_name: str, force: bool = False) -> Dict:
    """
    将 skill 的 SKILL.md 拆分为渐进式文档。

    Args:
        skill_name: 技能目录名
        force: 如果 True，即使已有 references/ 也会重新生成

    Returns:
        Dict: {
            status: 'success' | 'skipped' | 'failed',
            skill_md_lines: int,  # 新的SKILL.md行数
            references_created: [str],  # 创建的参考文件列表
            savings_lines: int,  # 减少的行数
            errors: [str],
        }
    """
    skill_path = SKILLS_DIR / skill_name
    skill_md_path = skill_path / 'SKILL.md'
    refs_path = skill_path / REFERENCES_DIR

    if not skill_md_path.exists():
        return {'status': 'failed', 'errors': [f'SKILL.md not found: {skill_md_path}']}

    with open(skill_md_path, 'r', encoding='utf-8') as f:
        content = f.read()

    if content.count('\n') < 60 and not force:
        return {
            'status': 'skipped',
            'reason': 'SKILL.md is already concise (<60 lines)',
            'skill_md_lines': content.count('\n'),
            'references_created': [],
            'savings_lines': 0,
            'errors': [],
        }

    frontmatter, body, fm_end = parse_frontmatter(content)
    sections = extract_sections(body)

    # 分类每个节
    ref_sections = {}  # ref_type -> [sections]
    kept_sections = []  # 保留在 SKILL.md 中的节

    for section in sections:
        ref_type = classify_section(section)
        if ref_type:
            if ref_type not in ref_sections:
                ref_sections[ref_type] = []
            ref_sections[ref_type].append(section)
        else:
            kept_sections.append(section)

    if not ref_sections and not force:
        return {
            'status': 'skipped',
            'reason': 'No reference-quality sections found',
            'skill_md_lines': content.count('\n'),
            'references_created': [],
            'savings_lines': 0,
            'errors': [],
        }

    # 创建 references 目录
    os.makedirs(refs_path, exist_ok=True)

    # 生成参考文件
    reference_files = {}
    for ref_type, secs in ref_sections.items():
        ref_content = f"# {skill_name} — {ref_type.title()} Reference\n\n"
        ref_content += f"> Auto-generated by progressive disclosure on {__import__('datetime').datetime.now().strftime('%Y-%m-%d')}\n\n"

        for i, section in enumerate(secs):
            if i > 0:
                ref_content += '---\n\n'
            ref_content += '\n'.join(section['content']) + '\n'

        filename = f'{ref_type}.md'
        ref_path = refs_path / filename
        with open(ref_path, 'w', encoding='utf-8') as f:
            f.write(ref_content)
        reference_files[ref_type] = filename

    # 生成简洁的 SKILL.md
    new_md = content[:fm_end] + '\n\n' if fm_end > 0 else ''

    for section in kept_sections:
        new_md += '\n'.join(section['content']) + '\n'

    # 添加参考索引
    if reference_files:
        new_md += '\n## References\n\n'
        new_md += '> Detailed documentation has been moved to `references/` (progressive disclosure).\n\n'
        for ref_type, filename in sorted(reference_files.items()):
            new_md += f'- [`references/{filename}`](references/{filename}) — {ref_type}\n'

    # 写回 SKILL.md
    with open(skill_md_path, 'w', encoding='utf-8') as f:
        f.write(new_md)

    original_lines = content.count('\n')
    new_lines = new_md.count('\n')
    savings = original_lines - new_lines

    return {
        'status': 'success',
        'skill_md_lines': new_lines,
        'references_created': [f'references/{f}' for f in reference_files.values()],
        'savings_lines': savings,
        'original_lines': original_lines,
        'errors': [],
    }


def load_reference(skill_name: str, ref_type: str) -> Optional[str]:
    """
    按需加载参考文档。

    Args:
        skill_name: 技能名
        ref_type: 参考类型 (examples|commands|troubleshooting|etc.)

    Returns:
        str: 参考文档内容，或 None 如果不存在
    """
    ref_path = SKILLS_DIR / skill_name / REFERENCES_DIR / f'{ref_type}.md'
    if not ref_path.exists():
        return None

    with open(ref_path, 'r', encoding='utf-8') as f:
        return f.read()


def load_all_references(skill_name: str) -> Dict[str, str]:
    """加载某技能的所有参考文档"""
    refs = {}
    refs_path = SKILLS_DIR / skill_name / REFERENCES_DIR
    if not refs_path.exists():
        return refs

    for f in refs_path.iterdir():
        if f.suffix == '.md' and f.is_file():
            with open(f, 'r', encoding='utf-8') as fp:
                refs[f.stem] = fp.read()

    return refs


def build_index() -> Dict[str, Dict]:
    """构建所有技能的渐进式披露索引"""
    index = {}

    for skill_dir in SKILLS_DIR.iterdir():
        if not skill_dir.is_dir():
            continue
        skill_md = skill_dir / 'SKILL.md'
        refs_dir = skill_dir / REFERENCES_DIR

        if not skill_md.exists():
            continue

        with open(skill_md, 'r', encoding='utf-8') as f:
            content = f.read()

        ref_files = []
        if refs_dir.exists():
            ref_files = [f.name for f in refs_dir.iterdir() if f.suffix == '.md']

        index[skill_dir.name] = {
            'skill_md_lines': content.count('\n'),
            'has_references': len(ref_files) > 0,
            'references': ref_files,
            'progressive': len(ref_files) > 0,
        }

    return index


if __name__ == '__main__':
    import json
    import sys

    if len(sys.argv) < 2:
        # 运行索引构建
        index = build_index()
        print(json.dumps(index, indent=2, ensure_ascii=False))
    elif sys.argv[1] == '--split-all':
        # 拆分所有超过阈值的skill
        for skill_dir in SKILLS_DIR.iterdir():
            if not skill_dir.is_dir():
                continue
            r = split_skill_md(skill_dir.name)
            if r['status'] == 'success':
                print(f"✓ {skill_dir.name}: -{r['savings_lines']} lines, +{len(r['references_created'])} refs")
            elif r['status'] == 'skipped':
                print(f"○ {skill_dir.name}: skipped ({r.get('reason', '')})")
            else:
                print(f"✗ {skill_dir.name}: {r.get('errors', [])}")
    elif sys.argv[1] == '--split' and len(sys.argv) >= 3:
        result = split_skill_md(sys.argv[2])
        print(json.dumps(result, indent=2, ensure_ascii=False))
    else:
        print(f"Usage: {sys.argv[0]} [--split <skill>|--split-all|--index]")
