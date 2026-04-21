"""
skill_registry.py — OpenClaw Skill Registry (CLI-Hub Inspired)
==============================================================

Inspired by CLI-Anything's CLI-Hub:
  pip install cli-anything-hub  →  cli-hub install <name>

OpenClaw Skill Registry 提供:
  1. 本地 skill 注册表 (~/.openclaw/memory/skill_registry.json)
  2. clawhub 远程注册表 (https://clawhub.ai/api/v1/)
  3. 安装/更新/卸载/搜索 功能
  4. SKILL.md 渐进式分发

Usage:
  from modules.skill_registry import SkillRegistry
  registry = SkillRegistry()
  registry.install('HKUDS/CLI-Anything', '--skill', 'cli-anything-blender')
  registry.search('browser')
  registry.list_installed()
  registry.update_all()
"""

import os
import re
import json
import hashlib
import shutil
import tempfile
import urllib.request
import urllib.error
from pathlib import Path
from datetime import datetime
from typing import Dict, List, Optional, Any

# ============================================================================
# Config
# ============================================================================

WORKSPACE = Path(r'C:\Users\Administrator\.openclaw\workspace')
SKILLS_DIR = WORKSPACE / 'skills'
STATE_DIR = Path.home() / '.openclaw'
REGISTRY_FILE = STATE_DIR / 'memory' / 'skill_registry.json'
CACHE_DIR = STATE_DIR / 'cache' / 'skill_registry'
CLAWHUB_API = 'https://clawhub.ai/api/v1'
LOCAL_INDEX = CACHE_DIR / 'index.json'
INSTALL_LOG = STATE_DIR / 'memory' / 'install_log.jsonl'

MAX_CACHE_AGE_HOURS = 24

# ============================================================================
# Types
# ============================================================================

@dataclass
class SkillMetadata:
    name: str
    slug: str
    description: str
    version: str
    author: str
    tags: List[str]
    triggers: List[str]
    size_kb: int
    installed_at: Optional[str] = None
    updated_at: Optional[str] = None
    source: str = 'local'  # 'local' | 'clawhub' | 'github'
    source_url: Optional[str] = None
    readme_preview: str = ''
    quality_score: Optional[float] = None

from dataclasses import dataclass


# ============================================================================
# Registry Core
# ============================================================================

class SkillRegistry:
    """
    OpenClaw Skill Registry — local + remote (clawhub) registry interface.
    """

    def __init__(self, workspace: Path = WORKSPACE):
        self.workspace = workspace
        self.skills_dir = workspace / 'skills'
        self.registry_file = STATE_DIR / 'memory' / 'skill_registry.json'
        self.cache_dir = CACHE_DIR
        self._ensure_dirs()

    def _ensure_dirs(self):
        """Ensure necessary directories exist"""
        (self.registry_file.parent).mkdir(parents=True, exist_ok=True)
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.skills_dir.mkdir(parents=True, exist_ok=True)

    # ─── Registry I/O ────────────────────────────────────────────────────────

    def _load_registry(self) -> Dict:
        """Load local skill registry"""
        if self.registry_file.exists():
            try:
                with open(self.registry_file, 'r', encoding='utf-8') as f:
                    return json.load(f)
            except (json.JSONDecodeError, FileNotFoundError):
                pass
        return {'version': '1.0', 'skills': {}, 'installed': [], 'cache': {}}

    def _save_registry(self, registry: Dict):
        """Save local skill registry"""
        self.registry_file.parent.mkdir(parents=True, exist_ok=True)
        with open(self.registry_file, 'w', encoding='utf-8') as f:
            json.dump(registry, f, indent=2, ensure_ascii=False)

    def _log_install(self, action: str, skill_slug: str, metadata: Dict):
        """Log install/update/uninstall action"""
        log_entry = {
            'action': action,
            'skill_slug': skill_slug,
            'timestamp': datetime.now().isoformat(),
            'metadata': metadata,
        }
        INSTALL_LOG.parent.mkdir(parents=True, exist_ok=True)
        with open(INSTALL_LOG, 'a', encoding='utf-8') as f:
            f.write(json.dumps(log_entry, ensure_ascii=False) + '\n')

    # ─── Local Operations ────────────────────────────────────────────────────

    def list_installed(self) -> List[Dict]:
        """List all installed skills with metadata"""
        registry = self._load_registry()
        skills = []

        for skill_dir in self.skills_dir.iterdir():
            if not skill_dir.is_dir():
                continue
            skill_md = skill_dir / 'SKILL.md'
            if not skill_md.exists():
                continue

            slug = skill_dir.name

            # Check if in registry
            reg_data = registry.get('skills', {}).get(slug, {})

            # Parse frontmatter
            fm = self._parse_skill_fm(skill_md)

            skills.append({
                'slug': slug,
                'name': fm.get('name', slug),
                'description': fm.get('description', reg_data.get('description', '')),
                'version': fm.get('version', reg_data.get('version', '0.0.0')),
                'triggers': fm.get('triggers', reg_data.get('triggers', [])),
                'tags': fm.get('tags', reg_data.get('tags', [])),
                'size_kb': self._calc_dir_size(skill_dir) // 1024,
                'installed_at': reg_data.get('installed_at'),
                'updated_at': fm.get('updated_at') or reg_data.get('updated_at'),
                'source': reg_data.get('source', 'local'),
                'has_handler': (skill_dir / 'handler.js').exists(),
                'has_tests': (skill_dir / 'tests').exists(),
                'has_references': (skill_dir / 'references').exists(),
            })

        return sorted(skills, key=lambda s: s['slug'])

    def _parse_skill_fm(self, skill_md_path: Path) -> Dict:
        """Parse YAML frontmatter from SKILL.md"""
        try:
            with open(skill_md_path, 'r', encoding='utf-8') as f:
                content = f.read(2000)
            if content.startswith('---'):
                end = content.index('---', 3)
                fm_text = content[3:end]
                fm = {}
                for line in fm_text.split('\n'):
                    if ':' in line:
                        k, v = line.split(':', 1)
                        fm[k.strip()] = v.strip().strip('"\'')
                return fm
        except Exception:
            pass
        return {}

    def _calc_dir_size(self, path: Path) -> int:
        """Calculate directory size in bytes"""
        total = 0
        for f in path.rglob('*'):
            if f.is_file():
                total += f.stat().st_size
        return total

    def get_skill(self, slug: str) -> Optional[Dict]:
        """Get a specific skill's metadata"""
        skills = self.list_installed()
        for s in skills:
            if s['slug'] == slug:
                return s
        return None

    def uninstall(self, slug: str, backup: bool = True) -> Dict:
        """
        Uninstall a skill.

        Args:
            slug: skill directory name
            backup: if True, move to ~/.openclaw/.trash/ before deleting

        Returns:
            Dict with status, message
        """
        skill_path = self.skills_dir / slug

        if not skill_path.exists():
            return {'status': 'failed', 'message': f'Skill not found: {slug}'}

        # Remove from registry
        registry = self._load_registry()
        skill_meta = registry.get('skills', {}).pop(slug, {})
        if slug in registry.get('installed', []):
            registry['installed'].remove(slug)
        self._save_registry(registry)

        # Backup or delete
        if backup:
            trash = STATE_DIR / '.trash' / 'skills'
            trash.mkdir(parents=True, exist_ok=True)
            dest = trash / f'{slug}_{datetime.now().strftime("%Y%m%d%H%M%S")}'
            shutil.move(str(skill_path), str(dest))
            message = f'Backed up to {dest.name}'
        else:
            shutil.rmtree(skill_path)
            message = 'Permanently deleted'

        self._log_install('uninstall', slug, {'backup': backup, 'path': str(skill_path)})

        return {'status': 'success', 'message': message, 'slug': slug}

    # ─── Remote Operations ────────────────────────────────────────────────────

    def fetch_remote_index(self, force: bool = False) -> Dict:
        """
        Fetch remote clawhub skill index.
        Caches result for MAX_CACHE_AGE_HOURS.
        """
        if not force and LOCAL_INDEX.exists():
            age_seconds = (datetime.now() - datetime.fromtimestamp(LOCAL_INDEX.stat().st_mtime)).total_seconds()
            if age_seconds < MAX_CACHE_AGE_HOURS * 3600:
                with open(LOCAL_INDEX, 'r', encoding='utf-8') as f:
                    return json.load(f)

        try:
            req = urllib.request.Request(
                f'{CLAWHUB_API}/skills',
                headers={'User-Agent': 'OpenClaw/1.0', 'Accept': 'application/json'},
            )
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = json.loads(resp.read().decode())

            with open(LOCAL_INDEX, 'w', encoding='utf-8') as f:
                json.dump(data, f, ensure_ascii=False)

            return data
        except (urllib.error.URLError, urllib.error.HTTPError, json.JSONDecodeError, TimeoutError) as e:
            # Return cached if available
            if LOCAL_INDEX.exists():
                with open(LOCAL_INDEX, 'r', encoding='utf-8') as f:
                    return json.load(f)
            return {'skills': [], 'error': str(e)}

    def search(self, query: str, source: str = 'all', limit: int = 10) -> List[Dict]:
        """
        Search skills by name, description, tags, or triggers.

        Args:
            query: search query
            source: 'local' | 'remote' | 'all'
            limit: max results

        Returns:
            List of matching skill metadata dicts
        """
        results = []
        query_lower = query.lower()
        matched_fields = []

        # Search local
        if source in ('local', 'all'):
            for skill in self.list_installed():
                if self._skill_matches(skill, query_lower):
                    skill['source'] = 'local'
                    skill['matched_on'] = matched_fields
                    results.append(skill)
                    if len(results) >= limit:
                        return results

        # Search remote (clawhub)
        if source in ('remote', 'all') and len(results) < limit:
            try:
                remote_index = self.fetch_remote_index()
                for item in remote_index.get('skills', []):
                    if len(results) >= limit:
                        break
                    # Match against name, description, tags
                    item_lower = {k: v.lower() if isinstance(v, str) else v for k, v in item.items()}
                    if query_lower in str(item_lower.get('name', '')) or \
                       query_lower in str(item_lower.get('description', '')) or \
                       query_lower in ' '.join(str(t) for t in item_lower.get('tags', [])):
                        results.append({**item, 'source': 'clawhub'})
            except Exception:
                pass  # Silent fail for remote

        return results[:limit]

    def _skill_matches(self, skill: Dict, query: str) -> bool:
        """Check if a skill matches a query"""
        searchable = ' '.join([
            str(skill.get('slug', '')),
            str(skill.get('description', '')),
            ' '.join(str(t) for t in skill.get('triggers', [])),
            ' '.join(str(tag) for tag in skill.get('tags', [])),
        ]).lower()
        return query in searchable

    def install_from_github(self, repo: str, sub_path: Optional[str] = None) -> Dict:
        """
        Install a skill from GitHub.

        Args:
            repo: 'owner/repo' or 'owner/repo/sub/path'
            sub_path: optional subdirectory within the repo (for --skill flag equivalent)

        Returns:
            Dict with status, slug, message
        """
        # Parse repo and sub_path
        parts = repo.split('/')
        if len(parts) < 2:
            return {'status': 'failed', 'message': f'Invalid repo format: {repo}'}

        owner = parts[-2]
        repo_name = parts[-1].replace('.git', '')

        if sub_path:
            # e.g. HKUDS/CLI-Anything --skill cli-anything-blender
            skill_slug = sub_path.split('/')[-1]
            raw_url = f'https://raw.githubusercontent.com/{owner}/{repo_name}/main/{sub_path}/SKILL.md'
            skill_dir_sub = sub_path
        else:
            # e.g. owner/skill-name as a skill directory
            skill_slug = repo_name
            raw_url = f'https://raw.githubusercontent.com/{owner}/{repo_name}/main/SKILL.md'
            skill_dir_sub = None

        # Fetch SKILL.md
        try:
            req = urllib.request.Request(
                raw_url,
                headers={'User-Agent': 'OpenClaw/1.0'},
            )
            with urllib.request.urlopen(req, timeout=10) as resp:
                skill_md_content = resp.read().decode('utf-8')
        except Exception as e:
            return {'status': 'failed', 'message': f'Failed to fetch SKILL.md: {e}'}

        # Parse slug from frontmatter
        fm_match = re.match(r'^---\nname:\s*(.+?)\n', skill_md_content, re.MULTILINE)
        if fm_match:
            skill_slug = fm_match.group(1).strip().replace(' ', '-').lower()

        # Destination
        dest = self.skills_dir / skill_slug
        if dest.exists():
            return {'status': 'skipped', 'message': f'Skill already installed: {skill_slug}', 'slug': skill_slug}

        # Create skill directory
        dest.mkdir(parents=True, exist_ok=True)

        # Write SKILL.md
        with open(dest / 'SKILL.md', 'w', encoding='utf-8') as f:
            f.write(skill_md_content)

        # Try to fetch handler.js (best effort)
        if skill_dir_sub:
            handler_urls = [
                f'https://raw.githubusercontent.com/{owner}/{repo_name}/main/{skill_dir_sub}/handler.js',
            ]
            for url in handler_urls:
                try:
                    req = urllib.request.Request(url, headers={'User-Agent': 'OpenClaw/1.0'})
                    with urllib.request.urlopen(req, timeout=5) as resp:
                        content = resp.read().decode('utf-8')
                    with open(dest / 'handler.js', 'w', encoding='utf-8') as f:
                        f.write(content)
                    break
                except Exception:
                    pass

        # Register
        registry = self._load_registry()
        registry['skills'][skill_slug] = {
            'name': skill_slug,
            'description': '',
            'version': '0.0.0',
            'installed_at': datetime.now().isoformat(),
            'source': 'github',
            'source_url': f'https://github.com/{owner}/{repo_name}',
            'sub_path': skill_dir_sub,
        }
        if skill_slug not in registry.get('installed', []):
            registry.setdefault('installed', []).append(skill_slug)
        self._save_registry(registry)
        self._log_install('install', skill_slug, {'source': 'github', 'repo': repo})

        return {
            'status': 'success',
            'message': f'Installed {skill_slug} from {owner}/{repo_name}',
            'slug': skill_slug,
            'path': str(dest),
        }

    def update(self, slug: str) -> Dict:
        """Update a skill from its source (GitHub)"""
        registry = self._load_registry()
        skill_meta = registry.get('skills', {}).get(slug, {})
        source_url = skill_meta.get('source_url', '')

        if not source_url:
            return {'status': 'failed', 'message': f'No source URL for {slug}'}

        result = self.install_from_github(source_url.replace('https://github.com/', ''))
        if result['status'] == 'success':
            self._log_install('update', slug, {'source': 'github'})
        return result

    def update_all(self) -> Dict:
        """Update all installed skills from their sources"""
        registry = self._load_registry()
        updated = []
        failed = []

        for slug, meta in registry.get('skills', {}).items():
            if meta.get('source') == 'github':
                result = self.update(slug)
                if result['status'] == 'success':
                    updated.append(slug)
                else:
                    failed.append({'slug': slug, 'error': result.get('message')})

        return {
            'updated': updated,
            'failed': failed,
            'total': len(updated) + len(failed),
        }

    # ─── Info ────────────────────────────────────────────────────────────────

    def info(self, slug: str) -> Dict:
        """Get detailed info about an installed skill"""
        skill = self.get_skill(slug)
        if not skill:
            return {'status': 'failed', 'message': f'Skill not found: {slug}'}

        skill_path = self.skills_dir / slug

        # Read SKILL.md content preview
        skill_md = skill_path / 'SKILL.md'
        preview = ''
        if skill_md.exists():
            with open(skill_md, 'r', encoding='utf-8') as f:
                preview = f.read(500)

        # List references
        refs_dir = skill_path / 'references'
        references = []
        if refs_dir.exists():
            references = [f.name for f in refs_dir.iterdir() if f.suffix == '.md']

        return {
            **skill,
            'path': str(skill_path),
            'readme_preview': preview,
            'references': references,
        }

    def stats(self) -> Dict:
        """Get registry statistics"""
        skills = self.list_installed()
        return {
            'total_installed': len(skills),
            'with_handler': sum(1 for s in skills if s.get('has_handler')),
            'with_tests': sum(1 for s in skills if s.get('has_tests')),
            'with_references': sum(1 for s in skills if s.get('has_references')),
            'registry_size_kb': self._calc_dir_size(self.skills_dir) // 1024,
            'clawhub_index_age_hours': self._get_index_age(),
        }

    def _get_index_age(self) -> Optional[float]:
        """Get age of local clawhub index cache in hours"""
        if not LOCAL_INDEX.exists():
            return None
        age_seconds = (datetime.now() - datetime.fromtimestamp(LOCAL_INDEX.stat().st_mtime)).total_seconds()
        return round(age_seconds / 3600, 1)


# ============================================================================
# CLI Entry Point
# ============================================================================

if __name__ == '__main__':
    import argparse

    parser = argparse.ArgumentParser(description='OpenClaw Skill Registry')
    sub = parser.add_subcommands(dest='command')

    # list
    sub.add_parser('list', help='List installed skills')

    # search
    search_p = sub.add_parser('search', help='Search skills')
    search_p.add_argument('query', help='Search query')
    search_p.add_argument('--source', choices=['local', 'remote', 'all'], default='all')

    # install
    install_p = sub.add_parser('install', help='Install skill from GitHub')
    install_p.add_argument('repo', help='GitHub repo (owner/repo) or (owner/repo --skill sub/path)')
    install_p.add_argument('--skill', help='Subdirectory for --skill flag equivalent')

    # uninstall
    uninstall_p = sub.add_parser('uninstall', help='Uninstall a skill')
    uninstall_p.add_argument('slug', help='Skill slug')
    uninstall_p.add_argument('--no-backup', action='store_true')

    # update
    update_p = sub.add_parser('update', help='Update a skill')
    update_p.add_argument('slug', nargs='?', help='Skill slug (or all if omitted)')
    update_p.add_argument('--all', action='store_true')

    # stats
    sub.add_parser('stats', help='Show registry statistics')

    args = parser.parse_args()
    registry = SkillRegistry()

    if args.command == 'list':
        skills = registry.list_installed()
        print(f'\n{len(skills)} installed skills:\n')
        for s in skills:
            src = f'[{s["source"]}]'
            handlers = '✓handler' if s.get('has_handler') else '✗'
            tests = '✓tests' if s.get('has_tests') else '✗'
            refs = '✓refs' if s.get('has_references') else '✗'
            print(f'  {s["slug"]:30s} {src:10s} {handlers} {tests} {refs}')
            if s.get('description'):
                print(f'    {s["description"][:60]}')

    elif args.command == 'search':
        results = registry.search(args.query, source=args.source)
        print(f'\n{len(results)} results for "{args.query}":\n')
        for r in results:
            print(f'  [{r["source"]}] {r["slug"]}: {r.get("description", "")[:60]}')

    elif args.command == 'install':
        repo = args.repo
        if args.skill:
            repo = f'{args.repo} --skill {args.skill}'
        result = registry.install_from_github(repo)
        print(json.dumps(result, indent=2, ensure_ascii=False))

    elif args.command == 'uninstall':
        result = registry.uninstall(args.slug, backup=not args.no_backup)
        print(json.dumps(result, indent=2, ensure_ascii=False))

    elif args.command == 'update':
        if args.all:
            result = registry.update_all()
            print(json.dumps(result, indent=2, ensure_ascii=False))
        elif args.slug:
            result = registry.update(args.slug)
            print(json.dumps(result, indent=2, ensure_ascii=False))

    elif args.command == 'stats':
        print(json.dumps(registry.stats(), indent=2))

    else:
        parser.print_help()
