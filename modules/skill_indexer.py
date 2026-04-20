"""
Skill Indexer — Build searchable index of all installed skills.
Run: python skill_indexer.py
"""
import os
import re
import json
import yaml
from pathlib import Path

WORKSPACE = Path(os.path.expanduser("C:/Users/Administrator/.openclaw/workspace"))
SKILLS_DIR = WORKSPACE / "skills"
INDEX_PATH = WORKSPACE / "memory" / "skill_index.json"

def extract_frontmatter(content):
    """Extract YAML frontmatter from SKILL.md"""
    match = re.match(r'^---\n(.*?)\n---', content, re.DOTALL)
    if not match:
        return {}
    try:
        fm = yaml.safe_load(match.group(1))
        return fm if isinstance(fm, dict) else {}
    except:
        return {}

def extract_first_paragraph(content):
    """Extract first paragraph after frontmatter as description"""
    parts = re.split(r'\n(?=#)', content)
    for part in parts[1:]:
        text = part.strip()
        if text and not text.startswith('#'):
            return text[:300]
    return ""

def scan_skills():
    skills = []
    for skill_dir in SKILLS_DIR.iterdir():
        if not skill_dir.is_dir():
            continue
        skill_md = skill_dir / "SKILL.md"
        if not skill_md.exists():
            continue
        
        try:
            content = skill_md.read_text(encoding='utf-8')
        except:
            continue
        
        fm = extract_frontmatter(content)
        
        # Get description
        desc = fm.get('description', '') or extract_first_paragraph(content)
        desc = re.sub(r'\s+', ' ', desc).strip()[:200]
        
        # Get triggers (list or inline)
        triggers = []
        t = fm.get('triggers', [])
        if isinstance(t, list):
            triggers = [str(x).strip() for x in t if x]
        elif isinstance(t, str):
            triggers = [x.strip() for x in re.split(r'[,;]', t) if x.strip()]
        
        # Get references
        references = []
        ref_dir = skill_dir / "references"
        if ref_dir.exists():
            references = [f.name for f in ref_dir.iterdir() if f.is_file()]
        
        # Get scripts
        scripts = []
        scripts_dir = skill_dir / "scripts"
        if scripts_dir.exists():
            scripts = [f.name for f in scripts_dir.iterdir() if f.is_file()]
        
        # Check for handler
        has_handler = (skill_dir / "handler.js").exists()
        
        skills.append({
            "id": skill_dir.name,
            "name": fm.get('name', skill_dir.name),
            "description": desc,
            "triggers": triggers,
            "references": references,
            "scripts": scripts,
            "has_handler": has_handler,
            "path": str(skill_dir.relative_to(WORKSPACE)),
        })
    
    return skills

def build_index():
    skills = scan_skills()
    index = {
        "generated": "2026-04-20T14:58:00Z",
        "total": len(skills),
        "skills": skills
    }
    
    INDEX_PATH.parent.mkdir(parents=True, exist_ok=True)
    INDEX_PATH.write_text(json.dumps(index, indent=2, ensure_ascii=False), encoding='utf-8')
    
    # Build readable text index
    text_lines = []
    for s in sorted(skills, key=lambda x: x['id']):
        triggers_str = " | ".join(s['triggers'][:5]) if s['triggers'] else "—"
        text_lines.append(f"{s['id']} | {s['name']} | {triggers_str}")
    
    text_path = WORKSPACE / "memory" / "skill_index.txt"
    text_path.write_text("\n".join(text_lines), encoding='utf-8')
    
    return index

def query_skills(query):
    """Search skills by query string"""
    idx = json.loads(INDEX_PATH.read_text(encoding='utf-8'))
    q = query.lower()
    results = []
    for s in idx['skills']:
        score = 0
        if q in s['id'].lower(): score += 10
        if q in s['name'].lower(): score += 5
        if q in s['description'].lower(): score += 2
        if any(q in t.lower() for t in s['triggers']): score += 8
        if score > 0:
            results.append((score, s))
    return sorted(results, reverse=True, key=lambda x: x[0])

if __name__ == "__main__":
    index = build_index()
    print(f"[skill-indexer] Indexed {index['total']} skills\n")
    
    # Show all skills
    for s in sorted(index['skills'], key=lambda x: x['id']):
        triggers = ", ".join(s['triggers'][:3]) if s['triggers'] else "—"
        handler = "[H]" if s['has_handler'] else "[D]"
        print(f"{handler} {s['id']:30s} -> {triggers[:60]}")
    
    print(f"\nIndex: {INDEX_PATH}")
    print(f"\nQuery example: python -c \"import sys; sys.path.insert(0,'modules'); from skill_indexer import query_skills; print(query_skills('browser'))\"")
