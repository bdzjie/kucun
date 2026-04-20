"""
audit_skills.py — Audit all workspace skills for quality, triggers, and missing dependencies.
Run: python audit_skills.py [--fix] [--json]
"""
import os
import re
import json
from pathlib import Path
import yaml

WORKSPACE = Path(os.path.expanduser("C:/Users/Administrator/.openclaw/workspace"))
SKILLS_DIR = WORKSPACE / "skills"
REPORT_PATH = WORKSPACE / "memory" / "skill-audit.json"

def extract_frontmatter(content: str) -> dict:
    """Extract YAML frontmatter from SKILL.md"""
    match = re.match(r'^---\n(.*?)\n---', content, re.DOTALL)
    if not match:
        return {}
    try:
        fm = yaml.safe_load(match.group(1))
        return fm if isinstance(fm, dict) else {}
    except:
        return {}

def extract_body_triggers(content: str) -> list:
    """Extract triggers from markdown body (after frontmatter)."""
    # Remove frontmatter
    match = re.match(r'^---\n.*?\n---\n', content, re.DOTALL)
    body = content[match.end():] if match else content
    
    # Find triggers section: triggers:
    triggers = []
    trigger_match = re.search(r'^triggers:\s*\n((?:\s*-\s*.+\n)+)', body, re.MULTILINE)
    if trigger_match:
        for line in trigger_match.group(1).split('\n'):
            m = re.match(r'^\s*-\s*(.+)', line)
            if m:
                t = m.group(1).strip().strip('"').strip("'")
                if t:
                    triggers.append(t)
    
    return triggers

def audit_skill(skill_dir: Path) -> dict:
    """Audit a single skill directory"""
    skill_md = skill_dir / "SKILL.md"
    if not skill_md.exists():
        return None
    
    try:
        content = skill_md.read_text(encoding='utf-8')
    except:
        return None
    
    fm = extract_frontmatter(content)
    issues = []
    score = 100
    
    # Required fields
    if 'name' not in fm:
        issues.append("Missing field: name")
        score -= 15
    
    if 'description' not in fm or not fm['description']:
        issues.append("Missing field: description")
        score -= 15
    elif len(fm.get('description', '')) < 20:
        issues.append("Description too short (<20 chars)")
        score -= 5
    elif len(fm.get('description', '')) > 600:
        issues.append("Description too long (>600 chars)")
        score -= 5
    
    # Triggers (check frontmatter AND body)
    triggers = []
    t = fm.get('triggers', [])
    if isinstance(t, list):
        triggers = [str(x).strip() for x in t if x]
    elif isinstance(t, str):
        triggers = [x.strip() for x in re.split(r'[,;]', t) if x.strip()]
    
    # Also check body for triggers (after frontmatter)
    body_triggers = extract_body_triggers(content)
    if body_triggers:
        triggers = body_triggers
    
    if not triggers:
        issues.append("No triggers defined")
        score -= 10
    
    # Check for supporting files
    has_handler = (skill_dir / "handler.js").exists()
    has_ref = (skill_dir / "references").exists()
    has_manifest = (skill_dir / "skill.yaml").exists()
    
    if not has_handler and not has_ref:
        issues.append("No handler.js or references/")
        score -= 10
    
    # Count other files (include directories that aren't empty)
    files = [f for f in skill_dir.iterdir() if f.is_file() and f.name != 'SKILL.md']
    dirs = [d for d in skill_dir.iterdir() if d.is_dir() and d.name not in ['.git', 'node_modules']]
    non_empty_dirs = [d for d in dirs if any(True for _ in d.iterdir())]
    if len(files) == 0 and len(non_empty_dirs) == 0:
        issues.append("No supporting files")
        score -= 5
    
    # Bonus for manifest
    if has_manifest:
        score += 5
    
    return {
        "id": skill_dir.name,
        "name": fm.get('name', skill_dir.name),
        "description": fm.get('description', '')[:200],
        "triggers": triggers,
        "triggerCount": len(triggers),
        "qualityScore": max(0, score),
        "issues": issues,
        "hasHandler": has_handler,
        "hasRef": has_ref,
        "hasManifest": has_manifest,
        "fileCount": len(files),
    }

def main():
    import argparse
    parser = argparse.ArgumentParser(description='Audit workspace skills')
    parser.add_argument('--fix', action='store_true', help='Auto-fix issues')
    parser.add_argument('--json', action='store_true', help='Output JSON')
    args = parser.parse_args()
    
    skills = []
    for skill_dir in sorted(SKILLS_DIR.iterdir()):
        if not skill_dir.is_dir():
            continue
        if skill_dir.name.startswith('.'):
            continue
        
        result = audit_skill(skill_dir)
        if result:
            skills.append(result)
    
    # Sort by quality score (worst first)
    skills.sort(key=lambda x: (x['qualityScore'], -x['triggerCount']))
    
    # Summary
    total = len(skills)
    avg_score = sum(s['qualityScore'] for s in skills) / total if total else 0
    no_trigger = sum(1 for s in skills if s['triggerCount'] == 0)
    low_quality = sum(1 for s in skills if s['qualityScore'] < 70)
    
    if args.json:
        print(json.dumps({
            "summary": {"total": total, "avgScore": round(avg_score, 1), "noTrigger": no_trigger, "lowQuality": low_quality},
            "skills": skills
        }, indent=2, ensure_ascii=False))
        return
    
    # Print summary
    print(f"\n{'='*50}")
    print(f"  Skill Quality Audit")
    print(f"{'='*50}")
    print(f"  Total skills:    {total}")
    print(f"  Average score:   {avg_score:.1f} / 100")
    print(f"  No triggers:     {no_trigger}")
    print(f"  Low quality:     {low_quality}")
    print(f"{'='*50}\n")
    
    # Bottom 10
    print(f"[2m Bottom 10 (Needs Improvement) [0m")
    for s in skills[:10]:
        issues_str = f" | {', '.join(s['issues'])}" if s['issues'] else ""
        print(f"  [{s['qualityScore']:3d}] {s['id']}{issues_str}")
    
    print(f"\n[1;35m Skills Missing Triggers [0m")
    for s in skills:
        if s['triggerCount'] == 0:
            desc = s['description'][:60]
            print(f"  - {s['id']}: {desc}")
    
    print(f"\n[1;32m Top 10 (Good Quality) [0m")
    for s in sorted(skills, key=lambda x: -x['qualityScore'])[:10]:
        triggers_str = " | ".join(s['triggers'][:3]) if s['triggers'] else " (no triggers)"
        print(f"  [{s['qualityScore']:3d}] {s['id']}: {triggers_str}")
    
    # Auto-fix: Add missing triggers placeholder
    if args.fix:
        print(f"\n[1;33m Auto-fix mode — adding placeholder triggers [0m")
        fixed = 0
        for s in skills:
            if s['triggerCount'] == 0 and s['hasHandler']:
                skill_dir = SKILLS_DIR / s['id']
                skill_md = skill_dir / "SKILL.md"
                content = skill_md.read_text(encoding='utf-8')
                
                # Add triggers after description line
                new_trigger = f"  triggers:\n    - /{s['id'].replace('-', ' ')}"
                
                if re.search(r'^triggers:', content, re.MULTILINE):
                    continue  # Already has triggers
                
                # Insert after description line
                new_content = re.sub(
                    r'^description:\s*(.+?)(\n---|\n#[^\n]+\n)',
                    r'description: \1\2' + new_trigger + r'\n',
                    content,
                    count=1,
                    flags=re.MULTILINE | re.DOTALL
                )
                
                if new_content != content:
                    skill_md.write_text(new_content, encoding='utf-8')
                    print(f"  Fixed: {s['id']}")
                    fixed += 1
        
        print(f"\n  Fixed {fixed} skills")
    
    # Save report
    report = {
        "generated": "2026-04-20T15:14:00Z",
        "summary": {"total": total, "avgScore": round(avg_score, 1), "noTrigger": no_trigger, "lowQuality": low_quality},
        "skills": skills
    }
    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    REPORT_PATH.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding='utf-8')
    print(f"\nReport: {REPORT_PATH}")

if __name__ == "__main__":
    main()
