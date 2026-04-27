"""
_registry.py — Skill Registry with Version Management

Tracks installed skills: version, installed_at, checksum, status, rollback_version.

Usage:
    from skills._registry import SkillRegistry, check_upgrades

    reg = SkillRegistry()
    reg.install("invest", version="2026-04-20", checksum="abc123")
    print(reg.get("invest"))

    # Check for upgrades
    upgrades = check_upgrades()
    for skill_id, info in upgrades.items():
        print(f"  {skill_id}: current={info['current']} latest={info['latest']}")

CLI:
    python skills/_registry.py --list
    python skills/_registry.py --check-upgrades
    python skills/_registry.py --install <skill_id>
    python skills/_registry.py --rollback <skill_id>
"""

import json, hashlib, re, subprocess
from pathlib import Path
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from typing import Optional

WORKSPACE = Path("C:/Users/Administrator/.openclaw/workspace")
REGISTRY_FILE = WORKSPACE / "memory" / "_skill_registry.json"


@dataclass
class SkillEntry:
    skill_id: str
    version: str = ""
    installed_at: str = ""        # ISO-8601 UTC
    last_used: str = ""           # ISO-8601 UTC
    checksum: str = ""            # MD5 of SKILL.md at install time
    status: str = "active"        # active | disabled | upgrade_available
    rollback_version: str = ""    # version to rollback to
    skill_dir: str = ""           # relative path from workspace root
    upgrade_available: str = ""    # latest available version if different


def _compute_skill_checksum(skill_dir: Path) -> str:
    """MD5 of the SKILL.md file."""
    skill_md = skill_dir / "SKILL.md"
    if skill_md.exists():
        return hashlib.md5(skill_md.read_bytes()).hexdigest()[:12]
    return ""


def _read_skill_version(skill_dir: Path) -> str:
    """Read version from SKILL.md frontmatter."""
    skill_md = skill_dir / "SKILL.md"
    if not skill_md.exists():
        return ""
    try:
        import yaml
        content = skill_md.read_text(encoding="utf-8")
        # Simple frontmatter extraction
        if content.startswith("---"):
            end = content.find("\n---", 4)
            if end > 0:
                fm = yaml.safe_load(content[:end + 4])
                return fm.get("version", "") if isinstance(fm, dict) else ""
    except Exception:
        pass
    return ""


class SkillRegistry:
    """
    In-memory + disk-backed skill registry.
    """

    def __init__(self):
        self._entries: dict[str, SkillEntry] = {}
        self._load()

    # ── Persistence ───────────────────────────────────────────────────────

    def _load(self) -> None:
        if not REGISTRY_FILE.exists():
            return
        try:
            data = json.loads(REGISTRY_FILE.read_text(encoding="utf-8"))
            self._entries = {k: SkillEntry(**v) for k, v in data.get("skills", {}).items()}
        except Exception:
            self._entries = {}

    def _save(self) -> None:
        REGISTRY_FILE.parent.mkdir(parents=True, exist_ok=True)
        REGISTRY_FILE.write_text(
            json.dumps(
                {"skills": {k: asdict(v) for k, v in self._entries.items()}},
                indent=2, ensure_ascii=False
            ),
            encoding="utf-8"
        )

    # ── Core API ─────────────────────────────────────────────────────────

    def get(self, skill_id: str) -> Optional[SkillEntry]:
        return self._entries.get(skill_id)

    def register(self, skill_id: str, skill_dir: Path) -> SkillEntry:
        """Register (or refresh) a skill from its directory."""
        version = _read_skill_version(skill_dir)
        checksum = _compute_skill_checksum(skill_dir)
        now = datetime.now(timezone.utc).isoformat()

        existing = self._entries.get(skill_id)

        entry = SkillEntry(
            skill_id=skill_id,
            version=version,
            installed_at=existing.installed_at if existing else now,
            last_used=now,
            checksum=checksum,
            status="active",
            rollback_version=existing.version if existing else "",
            skill_dir=str(skill_dir.relative_to(WORKSPACE)),
        )
        self._entries[skill_id] = entry
        self._save()
        return entry

    def scan_workspace(self) -> dict[str, SkillEntry]:
        """
        Scan skills/ directory and register all found skills.
        Returns dict of {skill_id: entry} for newly registered or updated.
        """
        skills_dir = WORKSPACE / "skills"
        updated = {}
        for p in skills_dir.iterdir():
            if not p.is_dir():
                continue
            skill_md = p / "SKILL.md"
            if not skill_md.exists():
                continue
            skill_id = p.name
            existing = self._entries.get(skill_id)
            new_version = _read_skill_version(p)
            new_checksum = _compute_skill_checksum(p)

            if existing:
                # Check if changed
                if existing.checksum != new_checksum:
                    existing.rollback_version = existing.version
                    existing.version = new_version
                    existing.checksum = new_checksum
                    existing.last_used = datetime.now(timezone.utc).isoformat()
                    if existing.status == "disabled":
                        existing.status = "upgrade_available"
                        existing.upgrade_available = new_version
                    updated[skill_id] = existing
            else:
                # New registration
                entry = self.register(skill_id, p)
                updated[skill_id] = entry

        if updated:
            self._save()
        return updated

    def record_use(self, skill_id: str) -> None:
        """Update last_used timestamp."""
        if skill_id in self._entries:
            self._entries[skill_id].last_used = datetime.now(timezone.utc).isoformat()
            self._save()

    def disable(self, skill_id: str) -> None:
        if skill_id in self._entries:
            self._entries[skill_id].status = "disabled"
            self._save()

    def enable(self, skill_id: str) -> None:
        if skill_id in self._entries:
            self._entries[skill_id].status = "active"
            self._save()

    def rollback(self, skill_id: str) -> bool:
        """
        Rollback to rollback_version if available.
        Returns True if rollback was performed.
        """
        entry = self._entries.get(skill_id)
        if not entry or not entry.rollback_version:
            return False
        entry.version = entry.rollback_version
        entry.rollback_version = ""
        entry.status = "active"
        self._save()
        return True

    def list_all(self) -> list[SkillEntry]:
        return sorted(self._entries.values(), key=lambda e: e.skill_id)


def check_upgrades() -> dict[str, dict]:
    """
    Scan workspace and report skills with version/checksum changes.
    Returns {skill_id: {current, latest, status}}.
    """
    reg = SkillRegistry()
    updated = reg.scan_workspace()
    result = {}
    for skill_id, entry in reg._entries.items():
        if entry.upgrade_available:
            result[skill_id] = {
                "current": entry.version,
                "latest": entry.upgrade_available,
                "status": "upgrade_available",
            }
        elif entry.status == "disabled":
            result[skill_id] = {
                "current": entry.version,
                "latest": "",
                "status": "disabled",
            }
        else:
            result[skill_id] = {
                "current": entry.version,
                "latest": entry.version,
                "status": "active",
            }
    return result


if __name__ == "__main__":
    import sys

    reg = SkillRegistry()

    if len(sys.argv) > 1 and sys.argv[1] == "--list":
        entries = reg.list_all()
        print(f"Registry ({len(entries)} skills):")
        for e in entries:
            status_icon = {"active": "✅", "disabled": "❌", "upgrade_available": "⬆️"}.get(e.status, "?")
            print(f"  {status_icon} {e.skill_id}: v{e.version} installed={e.installed_at[:10]} "
                  f"last_used={e.last_used[:10] if e.last_used else 'never'}")

    elif len(sys.argv) > 1 and sys.argv[1] == "--check-upgrades":
        upgrades = check_upgrades()
        changed = {k: v for k, v in upgrades.items() if v["status"] != "active"}
        if not changed:
            print("All skills up to date.")
        else:
            print(f"Skills with changes ({len(changed)}):")
            for skill_id, info in changed.items():
                print(f"  {skill_id}: {info}")

    elif len(sys.argv) > 1 and sys.argv[1] == "--scan":
        updated = reg.scan_workspace()
        print(f"Scanned workspace: {len(updated)} skills registered/updated.")
        for skill_id, e in updated.items():
            print(f"  {skill_id}: v{e.version} checksum={e.checksum}")

    elif len(sys.argv) > 1 and sys.argv[1] == "--rollback":
        if len(sys.argv) > 2:
            ok = reg.rollback(sys.argv[2])
            print(f"Rollback {'ok' if ok else 'failed/no rollback version'}")
        else:
            print("Usage: --rollback <skill_id>")

    else:
        print("Usage: _registry.py [--list|--check-upgrades|--scan|--rollback <skill_id>]")
