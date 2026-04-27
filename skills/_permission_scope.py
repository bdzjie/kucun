"""
_permission_scope.py — Skill Permission Scope Enforcement

Declarative permission scopes per skill, enforced at runtime during routing.

Permission model:
  - network:  can make external HTTP requests
  - filesystem: can read/write local files
  - exec:      can run shell commands / spawn processes
  - memory_read: can read memory/*.jsonl files
  - memory_write: can write to memory/*.jsonl files
  - skill_spawn: can spawn sub-agents

Permission templates (shortcuts):
  READ_ONLY   = network:true, filesystem:true,  exec:false, skill_spawn:false
  NETWORK_ONLY= network:true, filesystem:false, exec:false, skill_spawn:false
  SANDBOXED   = network:false, filesystem:false, exec:false, skill_spawn:false

Usage:
    from skills._permission_scope import (
        check_permissions, enforce_permissions,
        PermissionDenied, get_skill_permissions,
        render_manifest,
    )

    try:
        enforce_permissions("invest", required={"exec": True})
    except PermissionDenied as e:
        print(f"Blocked: {e}")

    # Read a skill's declared permissions:
    perms = get_skill_permissions("invest")
    print(perms)  # {"network": True, "filesystem": False, "exec": False, ...}

CLI:
    python skills/_permission_scope.py --check invest exec
    python skills/_permission_scope.py --manifest invest
"""

import json
import re
import sys
import yaml
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

WORKSPACE = Path("C:/Users/Administrator/.openclaw/workspace")
SKILLS_DIR = WORKSPACE / "skills"

PERMISSION_TEMPLATES = {
    "READ_ONLY": {
        "network": True,
        "filesystem": True,
        "exec": False,
        "memory_read": True,
        "memory_write": True,
        "skill_spawn": False,
    },
    "NETWORK_ONLY": {
        "network": True,
        "filesystem": False,
        "exec": False,
        "memory_read": False,
        "memory_write": False,
        "skill_spawn": False,
    },
    "SANDBOXED": {
        "network": False,
        "filesystem": False,
        "exec": False,
        "memory_read": False,
        "memory_write": False,
        "skill_spawn": False,
    },
    "FULL_ACCESS": {
        "network": True,
        "filesystem": True,
        "exec": True,
        "memory_read": True,
        "memory_write": True,
        "skill_spawn": True,
    },
}

DEFAULT_PERMISSIONS = {
    "network": False,
    "filesystem": False,
    "exec": False,
    "memory_read": False,
    "memory_write": False,
    "skill_spawn": False,
}


@dataclass
class PermissionDenied(Exception):
    skill_id: str
    required_permission: str
    available_permissions: dict
    message: str = ""

    def __str__(self):
        return (f"PermissionDenied: skill '{self.skill_id}' requires "
                f"'{self.required_permission}' but does not have it. "
                f"Available: {list(self.available_permissions.keys())}")


@dataclass
class PermissionScope:
    skill_id: str
    network: bool = False
    filesystem: bool = False
    exec: bool = False
    memory_read: bool = False
    memory_write: bool = False
    skill_spawn: bool = False
    template: str = ""
    source: str = "SKILL_MD"   # SKILL_MD | TEMPLATE | DEFAULT

    def get_all(self) -> dict[str, bool]:
        return {
            "network": self.network,
            "filesystem": self.filesystem,
            "exec": self.exec,
            "memory_read": self.memory_read,
            "memory_write": self.memory_write,
            "skill_spawn": self.skill_spawn,
        }

    def has(self, permission: str) -> bool:
        return getattr(self, permission, False)

    def grant(self, permission: str) -> "PermissionScope":
        """Return a new scope with the permission granted."""
        import copy
        new_scope = copy.copy(self)
        if permission in ["network", "filesystem", "exec", "memory_read",
                           "memory_write", "skill_spawn"]:
            setattr(new_scope, permission, True)
        return new_scope

    def restrict(self, permission: str) -> "PermissionScope":
        """Return a new scope with the permission revoked."""
        import copy
        new_scope = copy.copy(self)
        if permission in ["network", "filesystem", "exec", "memory_read",
                           "memory_write", "skill_spawn"]:
            setattr(new_scope, permission, False)
        return new_scope


# ── Permission Resolution ──────────────────────────────────────────────

def _read_skill_permissions_from_md(skill_dir: Path) -> Optional[dict]:
    """Read permissions from SKILL.md frontmatter."""
    skill_md = skill_dir / "SKILL.md"
    if not skill_md.exists():
        return None
    try:
        content = skill_md.read_text(encoding="utf-8")
        if not content.startswith("---"):
            return None
        end = content.find("\n---", 4)
        if end < 0:
            return None
        fm = yaml.safe_load(content[3:end])
        if isinstance(fm, dict) and "permissions" in fm:
            perms = fm["permissions"]
            if isinstance(perms, str):
                # Template reference
                return {"$template": perms}
            return perms
    except Exception:
        pass
    return None


def _resolve_template(template_name: str) -> dict:
    """Resolve a template name to a permission dict."""
    name = template_name.upper().strip()
    if name in PERMISSION_TEMPLATES:
        return dict(PERMISSION_TEMPLATES[name])
    return {}


def get_skill_permissions(skill_id: str) -> PermissionScope:
    """
    Get the effective permission scope for a skill.

    Resolution order:
      1. SKILL.md permissions field (explicit)
      2. Template reference in SKILL.md
      3. DEFAULT_PERMISSIONS
    """
    skill_dir = SKILLS_DIR / skill_id
    if not skill_dir.exists():
        return PermissionScope(skill_id=skill_id, source="DEFAULT")

    # Try reading from SKILL.md
    perms = _read_skill_permissions_from_md(skill_dir)

    if perms is None:
        return PermissionScope(skill_id=skill_id, source="DEFAULT")

    # Template reference
    if "$template" in perms:
        template_name = perms["$template"]
        resolved = _resolve_template(template_name)
        scope = PermissionScope(skill_id=skill_id, template=template_name, source="TEMPLATE")
        for k, v in resolved.items():
            if hasattr(scope, k):
                setattr(scope, k, v)
        return scope

    # Explicit permissions
    scope = PermissionScope(skill_id=skill_id, source="SKILL_MD")
    for k, v in perms.items():
        if hasattr(scope, k):
            setattr(scope, k, bool(v))
    return scope


def check_permissions(
    skill_id: str,
    required: dict[str, bool],
) -> tuple[bool, PermissionScope]:
    """
    Check if a skill has the required permissions.

    Args:
        skill_id: which skill to check
        required: dict of {permission_name: True/False} — True means "must be allowed"

    Returns:
        (allowed: bool, effective_scope: PermissionScope)
    """
    scope = get_skill_permissions(skill_id)

    for perm, required_value in required.items():
        if required_value and not scope.has(perm):
            return False, scope
    return True, scope


def enforce_permissions(
    skill_id: str,
    required: dict[str, bool],
) -> PermissionScope:
    """
    Enforce permissions. Raises PermissionDenied if check fails.
    Returns the effective PermissionScope if allowed.
    """
    allowed, scope = check_permissions(skill_id, required)
    if not allowed:
        denied = PermissionDenied(
            skill_id=skill_id,
            required_permission=next(
                (p for p, v in required.items() if v and not scope.has(p)), "?"
            ),
            available_permissions=scope.get_all(),
        )
        raise denied
    return scope


# ── Manifest / Audit ────────────────────────────────────────────────────

def render_manifest(skill_id: str = "") -> dict:
    """
    Render a permission manifest for a skill or all skills.
    """
    if skill_id:
        scope = get_skill_permissions(skill_id)
        return {
            "skill_id": scope.skill_id,
            "source": scope.source,
            "template": scope.template,
            "permissions": scope.get_all(),
        }

    # All skills
    manifest = {}
    for p in SKILLS_DIR.iterdir():
        if not p.is_dir():
            continue
        skill_md = p / "SKILL.md"
        if not skill_md.exists():
            continue
        scope = get_skill_permissions(p.name)
        manifest[p.name] = {
            "source": scope.source,
            "permissions": scope.get_all(),
        }
    return manifest


# ── CLI ─────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--check":
        skill_id = sys.argv[2] if len(sys.argv) > 2 else ""
        perm = sys.argv[3] if len(sys.argv) > 3 else ""
        if not perm:
            print("Usage: --check <skill_id> <permission>")
            sys.exit(1)
        required = {perm: True}
        try:
            scope = enforce_permissions(skill_id, required)
            print(f"ALLOWED: {skill_id} has {perm}")
        except PermissionDenied as e:
            print(f"DENIED: {e}")

    elif len(sys.argv) > 1 and sys.argv[1] == "--manifest":
        skill_id = sys.argv[2] if len(sys.argv) > 2 else ""
        m = render_manifest(skill_id)
        if skill_id:
            print(f"Skill: {m['skill_id']}")
            print(f"  Source: {m['source']}")
            print(f"  Template: {m.get('template', 'none')}")
            print(f"  Permissions:")
            for perm, val in m["permissions"].items():
                icon = "[X]" if val else "[ ]"
                print(f"    {icon} {perm}")
        else:
            print(f"Permission manifest ({len(m)} skills):")
            for sid, info in sorted(m.items()):
                perms = info["permissions"]
                granted = [p for p, v in perms.items() if v]
                print(f"  {sid}: {', '.join(granted) if granted else '(none)'}")

    elif len(sys.argv) > 1 and sys.argv[1] == "--templates":
        print("Available templates:")
        for name, perms in PERMISSION_TEMPLATES.items():
            granted = [p for p, v in perms.items() if v]
            print(f"  {name}: {', '.join(granted)}")

    else:
        print("Usage:")
        print("  --check <skill_id> <permission>   Check a specific permission")
        print("  --manifest [skill_id]             Show permission manifest")
        print("  --templates                        List permission templates")
