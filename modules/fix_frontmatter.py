"""
fix_frontmatter.py — Fix malformed SKILL.md frontmatter.
Many skills are missing the 'description:' key before the description text.
The description text appears directly after 'name: xxx' without a key.
Run: python fix_frontmatter.py [--dry-run] [--fix]
"""
import re
from pathlib import Path

WORKSPACE = Path("C:/Users/Administrator/.openclaw/workspace/skills")

def check_and_fix(skill_dir: Path, dry_run: bool = True) -> tuple[bool, str]:
    """Check if frontmatter is malformed and fix it."""
    skill_md = skill_dir / "SKILL.md"
    if not skill_md.exists():
        return False, "No SKILL.md"
    
    content = skill_md.read_text(encoding='utf-8')
    
    # Find frontmatter: starts with ---, ends with next ---
    fm_match = re.match(r'^---\n(.+?)\n---\n', content, re.DOTALL)
    if not fm_match:
        return False, "No frontmatter"
    
    fm_text = fm_match.group(1)
    
    # Check if the second line starts with a description-like pattern
    # (starts with capital letter, no ':' at first word, not a yaml key)
    lines = fm_text.split('\n')
    if len(lines) < 2:
        return False, "Frontmatter too short"
    
    second_line = lines[1].strip()
    
    # If second line doesn't contain ':' in the first word, it's likely a description without a key
    # e.g. "Core system enhancements inspired by Claude Code..."
    # Valid keys look like "name: value" or "metadata:"
    if ':' not in second_line.split()[0] if second_line.split() else '':
        # This looks like a description without a key
        # Replace the bare description line with 'description: >\n  <text>'
        new_fm_lines = [lines[0]]  # keep first line (name: xxx)
        new_fm_lines.append(f"description: >")
        new_fm_lines.append(f"  {second_line}")
        new_fm_lines.extend(lines[2:])  # rest of frontmatter
        
        new_fm_text = '\n'.join(new_fm_lines)
        new_content = content.replace(fm_match.group(1), new_fm_text, 1)
        
        if not dry_run:
            skill_md.write_text(new_content, encoding='utf-8')
        
        return True, f"Fixed: added 'description: >' before description text"
    
    return False, "OK"

def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--dry-run', action='store_true', help='Show what would be fixed')
    parser.add_argument('--fix', action='store_true', help='Actually fix files')
    args = parser.parse_args()
    
    if not args.dry_run and not args.fix:
        print("Use --dry-run to preview or --fix to apply")
        return
    
    mode = "DRY-RUN" if args.dry_run else "FIXING"
    print(f"[{mode}] Scanning {WORKSPACE}...\n")
    
    fixed = []
    ok = []
    errors = []
    
    for skill_dir in sorted(WORKSPACE.iterdir()):
        if not skill_dir.is_dir():
            continue
        try:
            changed, msg = check_and_fix(skill_dir, dry_run=args.dry_run)
            if changed:
                print(f"  FIX: {skill_dir.name}")
                print(f"       {msg}")
                fixed.append(skill_dir.name)
            else:
                ok.append(skill_dir.name)
        except Exception as e:
            print(f"  ERROR: {skill_dir.name}: {e}")
            errors.append((skill_dir.name, str(e)))
    
    print(f"\n{len(fixed)} fixed | {len(ok)} OK | {len(errors)} errors")
    if fixed:
        print(f"Fixed: {', '.join(fixed)}")

if __name__ == "__main__":
    main()
