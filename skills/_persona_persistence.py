"""
_persona_persistence.py — Agent Identity & Persona Persistence

Stores and manages agent identity across sessions using Letta-style identity blocks.

Identity layers:
  - Core Identity: name, role, personality traits (stable, rarely changes)
  - Relational Identity: relationship with user, shared history summary
  - Evolving Identity: learned skills, preferences, growth over time

Stored as identity_blocks in SessionSnapshot, persisted to memory/_persona.json.

Usage:
    from skills._persona_persistence import (
        get_persona, update_persona,
        get_identity_summary, detect_identity_drift,
        PersonaBlock,
    )

    # Get current persona for a session:
    persona = get_persona(session_id="sess_abc")
    print(persona.core.name)  # "Q仔"

    # Update after positive interaction:
    update_persona("sess_abc", skill_id="invest",
                   interaction="success",
                   learning="better at financial analysis")

    # Check for drift from base identity:
    drift = detect_identity_drift("sess_abc")
    if drift.confidence > 0.7:
        print(f"Identity drift detected: {drift.description}")

CLI:
    python skills/_persona_persistence.py --persona
    python skills/_persona_persistence.py --drift
    python skills/_persona_persistence.py --update invest success "learned to check VaR first"
"""

import hashlib
import json
import re
import sys
from collections import defaultdict
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

WORKSPACE = Path("C:/Users/Administrator/.openclaw/workspace")
PERSONA_FILE = WORKSPACE / "memory" / "_persona.json"
PERSONA_HISTORY = WORKSPACE / "memory" / "_persona_history.jsonl"


@dataclass
class PersonaBlock:
    """A single block of identity."""
    block_type: str = ""   # core | relational | evolving
    label: str = ""
    content: str = ""
    source: str = ""      # system_init | user_said | skill_feedback | self_reflection
    updated_at: str = ""
    confidence: float = 1.0  # how certain we are this is accurate
    version: int = 1

    def to_dict(self) -> dict:
        return asdict(self)

    def update_content(self, content: str, source: str = "") -> "PersonaBlock":
        self.content = content
        self.updated_at = datetime.now(timezone.utc).isoformat()
        self.version += 1
        if source:
            self.source = source
        return self


@dataclass
class PersonaState:
    """Full persona state across all blocks."""
    session_id: str = ""
    created_at: str = ""
    updated_at: str = ""
    checksum: str = ""     # SHA-256 of all block contents
    core: dict[str, PersonaBlock] = field(default_factory=dict)
    relational: dict[str, PersonaBlock] = field(default_factory=dict)
    evolving: dict[str, PersonaBlock] = field(default_factory=dict)

    def __post_init__(self):
        if not self.created_at:
            self.created_at = datetime.now(timezone.utc).isoformat()
        self.updated_at = self.created_at
        if not self.checksum:
            self._recompute_checksum()

    def _recompute_checksum(self) -> str:
        all_content = []
        for block in self.all_blocks():
            all_content.append(f"{block.block_type}:{block.label}:{block.content}")
        content_str = "|".join(all_content)
        self.checksum = hashlib.sha256(content_str.encode()).hexdigest()[:16]
        return self.checksum

    def all_blocks(self) -> list[PersonaBlock]:
        return list(self.core.values()) + list(self.relational.values()) + list(self.evolving.values())

    def to_dict(self) -> dict:
        d = asdict(self)
        d["all_blocks"] = [b.to_dict() for b in self.all_blocks()]
        return d

    @classmethod
    def from_dict(cls, d: dict) -> "PersonaState":
        core = {k: PersonaBlock(**v) for k, v in d.get("core", {}).items()}
        relational = {k: PersonaBlock(**v) for k, v in d.get("relational", {}).items()}
        evolving = {k: PersonaBlock(**v) for k, v in d.get("evolving", {}).items()}
        d["core"] = core
        d["relational"] = relational
        d["evolving"] = evolving
        return cls(**{k: v for k, v in d.items() if k not in ("all_blocks",)})


# ── Persistence ─────────────────────────────────────────────────────────

def _persona_path(session_id: str) -> Path:
    return WORKSPACE / "memory" / "personas" / f"{session_id}.json"


def load_persona(session_id: str) -> PersonaState:
    """Load persona state for a session."""
    path = _persona_path(session_id)
    if not path.exists():
        return PersonaState(session_id=session_id)
    try:
        d = json.loads(path.read_text(encoding="utf-8"))
        return PersonaState.from_dict(d)
    except Exception:
        return PersonaState(session_id=session_id)


def save_persona(state: PersonaState) -> None:
    """Save persona state to disk."""
    state.updated_at = datetime.now(timezone.utc).isoformat()
    state._recompute_checksum()
    path = _persona_path(state.session_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(state.to_dict(), indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    # Append to history
    _append_history(state)


def _append_history(state: PersonaState) -> None:
    """Append persona snapshot to history log."""
    PERSONA_HISTORY.parent.mkdir(parents=True, exist_ok=True)
    try:
        with open(str(PERSONA_HISTORY), "a", encoding="utf-8") as f:
            f.write(json.dumps(state.to_dict(), ensure_ascii=False) + "\n")
    except Exception:
        pass


# ── Persona Access ─────────────────────────────────────────────────────

def get_persona(session_id: str) -> PersonaState:
    """Get full persona state for a session."""
    return load_persona(session_id)


def get_identity_summary(state: PersonaState) -> str:
    """
    Synthesize a one-paragraph identity summary from persona blocks.
    Used to inject into system prompt on session resume.
    """
    lines = []

    core = state.core
    if "name" in core:
        lines.append(f"Name: {core['name'].content}")
    if "role" in core:
        lines.append(f"Role: {core['role'].content}")
    if "personality" in core:
        lines.append(f"Personality: {core['personality'].content}")

    rel = state.relational
    if "relationship" in rel:
        lines.append(f"Relationship: {rel['relationship'].content}")
    if "shared_history" in rel:
        lines.append(f"Shared history: {rel['shared_history'].content[:100]}")

    ev = state.evolving
    if "growth" in ev:
        lines.append(f"Growth areas: {ev['growth'].content}")
    if "skills_mastered" in ev:
        lines.append(f"Skills: {ev['skills_mastered'].content}")

    return " | ".join(lines) if lines else ""


# ── Identity Update ─────────────────────────────────────────────────────

def update_persona(
    session_id: str,
    block_type: str,   # core | relational | evolving
    label: str,
    content: str,
    source: str = "self_reflection",
    confidence: float = 1.0,
) -> PersonaState:
    """
    Update a specific persona block.

    Usage:
        update_persona("sess_abc", "evolving", "skills_mastered",
                       "Learned about financial risk metrics (VaR, Sharpe)",
                       source="skill_feedback")
    """
    state = load_persona(session_id)

    block = PersonaBlock(
        block_type=block_type,
        label=label,
        content=content,
        source=source,
        updated_at=datetime.now(timezone.utc).isoformat(),
        confidence=confidence,
    )

    if block_type == "core":
        state.core[label] = block
    elif block_type == "relational":
        state.relational[label] = block
    elif block_type == "evolving":
        state.evolving[label] = block

    save_persona(state)
    return state


# ── Identity Drift Detection ───────────────────────────────────────────

@dataclass
class IdentityDrift:
    session_id: str
    has_drift: bool
    confidence: float = 0.0
    description: str = ""
    drifted_blocks: list[str] = field(default_factory=list)


def detect_identity_drift(session_id: str, baseline_checksum: str = "") -> IdentityDrift:
    """
    Detect if current persona has drifted significantly from baseline.

    Uses checksum comparison + block-level content diff.
    """
    state = load_persona(session_id)
    current_checksum = state.checksum

    if not baseline_checksum:
        # Use first version checksum as baseline
        if PERSONA_HISTORY.exists():
            try:
                first_line = PERSONA_HISTORY.read_text(encoding="utf-8").strip().split("\n")[0]
                baseline = json.loads(first_line)
                baseline_checksum = baseline.get("checksum", "")
            except Exception:
                pass

    if not baseline_checksum:
        return IdentityDrift(
            session_id=session_id,
            has_drift=False,
            confidence=0.0,
            description="No baseline available",
        )

    if current_checksum == baseline_checksum:
        return IdentityDrift(
            session_id=session_id,
            has_drift=False,
            confidence=1.0,
            description="Persona unchanged from baseline",
        )

    # Compute drift by block comparison
    drifted = []
    state_dict = state.to_dict()

    try:
        baseline_data = json.loads(PERSONA_HISTORY.read_text(encoding="utf-8").strip().split("\n")[0])
        baseline_blocks = {b["label"]: b for b in baseline_data.get("all_blocks", [])}

        for block in state_dict.get("all_blocks", []):
            label = block["label"]
            if label in baseline_blocks:
                if block["content"] != baseline_blocks[label]["content"]:
                    drifted.append(f"{block['block_type']}.{label}")
    except Exception:
        pass

    confidence = min(1.0, len(drifted) * 0.2 + 0.3)  # more blocks changed = higher confidence

    return IdentityDrift(
        session_id=session_id,
        has_drift=True,
        confidence=confidence,
        description=f"Persona drifted in {len(drifted)} block(s): {', '.join(drifted)}",
        drifted_blocks=drifted,
    )


# ── Initialize from IDENTITY.md ─────────────────────────────────────────

def bootstrap_persona_from_identity(session_id: str) -> PersonaState:
    """
    On first session, bootstrap persona from SOUL.md / IDENTITY.md files.
    """
    state = PersonaState(session_id=session_id)

    identity_file = WORKSPACE / "IDENTITY.md"
    if identity_file.exists():
        content = identity_file.read_text(encoding="utf-8")
        # Extract name
        name_match = re.search(r"^\*\*Name:\*\*\s*(.+)$", content, re.MULTILINE)
        if name_match:
            state.core["name"] = PersonaBlock(
                block_type="core", label="name",
                content=name_match.group(1).strip(),
                source="system_init",
                updated_at=datetime.now(timezone.utc).isoformat(),
            )
        # Extract role
        role_match = re.search(r"^\*\*Role:\*\*\s*(.+)$", content, re.MULTILINE)
        if role_match:
            state.core["role"] = PersonaBlock(
                block_type="core", label="role",
                content=role_match.group(1).strip(),
                source="system_init",
                updated_at=datetime.now(timezone.utc).isoformat(),
            )

    soul_file = WORKSPACE / "SOUL.md"
    if soul_file.exists():
        content = soul_file.read_text(encoding="utf-8")
        state.core["personality"] = PersonaBlock(
            block_type="core", label="personality",
            content="Professional, efficient, direct — no filler words",
            source="system_init",
            updated_at=datetime.now(timezone.utc).isoformat(),
        )

    state.relational["relationship"] = PersonaBlock(
        block_type="relational", label="relationship",
        content="Professional assistant — Administrator is the primary user",
        source="system_init",
        updated_at=datetime.now(timezone.utc).isoformat(),
    )

    save_persona(state)
    return state


# ── CLI ─────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--persona":
        # Show persona for most recent session
        from skills._session_snapshot import list_snapshots
        snaps = list_snapshots(limit=1)
        if not snaps:
            print("No sessions found")
            sys.exit(0)
        session_id = snaps[0].session_id
        state = get_persona(session_id)
        print(f"Persona for {session_id}:")
        for block in state.all_blocks():
            print(f"  [{block.block_type}] {block.label}: {block.content[:60]}")

    elif len(sys.argv) > 1 and sys.argv[1] == "--drift":
        from skills._session_snapshot import list_snapshots
        snaps = list_snapshots(limit=1)
        if not snaps:
            print("No sessions found")
            sys.exit(0)
        session_id = snaps[0].session_id
        drift = detect_identity_drift(session_id)
        print(f"Identity drift for {session_id}:")
        print(f"  has_drift: {drift.has_drift}")
        print(f"  confidence: {drift.confidence:.0%}")
        print(f"  description: {drift.description}")
        if drift.drifted_blocks:
            print(f"  drifted blocks: {drift.drifted_blocks}")

    elif len(sys.argv) > 1 and sys.argv[1] == "--update":
        session_id = sys.argv[2] if len(sys.argv) > 2 else "default"
        block_type = sys.argv[3] if len(sys.argv) > 3 else "evolving"
        content = sys.argv[4] if len(sys.argv) > 4 else ""
        state = update_persona(session_id, block_type, "learning", content)
        print(f"Updated {block_type}.learning for {session_id}")

    elif len(sys.argv) > 1 and sys.argv[1] == "--bootstrap":
        from skills._session_snapshot import list_snapshots
        snaps = list_snapshots(limit=1)
        session_id = snaps[0].session_id if snaps else "default"
        state = bootstrap_persona_from_identity(session_id)
        print(f"Bootstrapped persona for {session_id}")
        print(f"Core blocks: {list(state.core.keys())}")

    else:
        print("Usage:")
        print("  --persona        Show current persona")
        print("  --drift          Detect identity drift")
        print("  --update <session_id> <block_type> <content>")
        print("  --bootstrap       Bootstrap persona from IDENTITY.md")
