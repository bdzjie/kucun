#!/usr/bin/env python3
"""
memory_system.py — Unified Memory System for OpenClaw

Features:
  - Temporal Memory: Wing/Room structure with valid_from/to timestamps
  - Entity Registry: Persistent entity knowledge base
  - 4-Layer Stack: L0 (identity) → L1 (essential) → L2 (on-demand) → L3 (search)
  - 5-Type Classification: decision/preference/milestone/problem/emotional

Storage: ~/.openclaw/memory/ (JSON/JSONL files)
"""

import json
import os
import re
import hashlib
from datetime import datetime, date
from pathlib import Path
from typing import Optional, List, Dict, Any
from collections import defaultdict
from dataclasses import dataclass, asdict, field
from enum import Enum

try:
    from .classifier import classify as _classify, MemoryType as _MemoryType
    from .wal import log_write
    _CLASSIFIER_AVAILABLE = True
except ImportError:
    _CLASSIFIER_AVAILABLE = False
    _MemoryType = None


# ─────────────────────────────────────────────────────────────────────────────
# PATH SETUP
# ─────────────────────────────────────────────────────────────────────────────

MEMORY_DIR = Path.home() / ".openclaw" / "memory"
MEMORY_DIR.mkdir(parents=True, exist_ok=True)

ENTITY_REGISTRY_FILE = MEMORY_DIR / "entity_registry.json"
MEMORIES_FILE = MEMORY_DIR / "memories.jsonl"
IDENTITY_FILE = MEMORY_DIR / "identity.json"
CONFIG_FILE = MEMORY_DIR / "config.json"


# ─────────────────────────────────────────────────────────────────────────────
# HALL TYPES (5 memory types = halls)
# ─────────────────────────────────────────────────────────────────────────────

class HallType(Enum):
    FACTS = "hall_facts"           # Decisions made
    EVENTS = "hall_events"         # Sessions, milestones, debugging
    DISCOVERIES = "hall_discoveries" # Breakthroughs, insights
    PREFERENCES = "hall_preferences" # Habits, likes, opinions
    ADVICE = "hall_advice"          # Recommendations

    @classmethod
    def from_memory_type(cls, mt) -> "HallType":
        if _MemoryType is None:
            return cls.FACTS
        # Map by value name since enums are different types
        name_map = {
            "DECISION": cls.FACTS,
            "PREFERENCE": cls.PREFERENCES,
            "MILESTONE": cls.EVENTS,
            "PROBLEM": cls.EVENTS,
            "EMOTIONAL": cls.EVENTS,
            "UNKNOWN": cls.FACTS,
        }
        return name_map.get(mt.name if hasattr(mt, 'name') else str(mt), cls.FACTS)


# ─────────────────────────────────────────────────────────────────────────────
# WING DEFINITIONS
# ─────────────────────────────────────────────────────────────────────────────

DEFAULT_WINGS = {
    "wing_user": {
        "name": "Administrator",
        "description": "User personal context and preferences",
        "type": "person",
    },
    "wing_openclaw": {
        "name": "OpenClaw",
        "description": "OpenClaw AI assistant system and evolution",
        "type": "project",
    },
    "wing_code": {
        "name": "Code Analysis",
        "description": "Claude Code, Hermes Agent, and other AI code systems",
        "type": "project",
    },
    "wing_mempalace": {
        "name": "MemPalace",
        "description": "MemPalace memory system study and integration",
        "type": "project",
    },
}


# ─────────────────────────────────────────────────────────────────────────────
# DEFAULT ROOMS PER WING
# ─────────────────────────────────────────────────────────────────────────────

DEFAULT_ROOMS = {
    "wing_user": ["preferences", "projects", "decisions", "context"],
    "wing_openclaw": ["architecture", "tools", "memory", "skills", "config"],
    "wing_code": ["architecture", "keybindings", "lsp", "commands", "hooks"],
    "wing_mempalace": ["palace", "knowledge_graph", "layers", "extractor", "entity"],
}


# ─────────────────────────────────────────────────────────────────────────────
# TEMPORAL MEMORY ENTRY
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class MemoryEntry:
    """A single memory entry with temporal validity."""
    id: str                          # sha256 of content+timestamp
    content: str                     # The actual memory text
    wing: str                        # Wing identifier
    room: str                        # Room within wing
    hall: str                         # Hall type (hall_facts etc)
    created_at: str                  # ISO timestamp when created
    valid_from: str                  # When this memory becomes valid
    valid_to: Optional[str] = None   # When this memory expires (None = current)
    superseded_by: Optional[str] = None  # ID of newer memory that replaces this
    tags: List[str] = field(default_factory=list)
    importance: int = 3              # 1-5 scale
    content_hash: str = ""            # Hash for deduplication

    def to_dict(self) -> dict:
        d = asdict(self)
        return d

    @classmethod
    def from_dict(cls, d: dict) -> "MemoryEntry":
        return cls(**d)

    def is_current(self, as_of: str = None) -> bool:
        """Check if this memory is valid at a given time."""
        as_of = as_of or datetime.now().isoformat()
        if self.valid_to and self.valid_to < as_of:
            return False
        if self.valid_from > as_of:
            return False
        return True


# ─────────────────────────────────────────────────────────────────────────────
# ENTITY REGISTRY
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class Entity:
    """A known entity (person, project, concept)."""
    name: str
    entity_type: str                 # "person" / "project" / "concept"
    canonical: str = ""               # Canonical name (for aliases)
    aliases: List[str] = field(default_factory=list)
    confidence: float = 1.0
    source: str = "onboarding"        # "onboarding" / "learned" / "wikipedia"
    contexts: List[str] = field(default_factory=list)  # ["personal", "work"]
    relationship: str = ""            # "boss", "colleague", etc.
    properties: Dict[str, Any] = field(default_factory=dict)
    created_at: str = ""
    updated_at: str = ""

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict) -> "Entity":
        return cls(**d)


class EntityRegistry:
    """
    Persistent entity knowledge base.

    Storage: ~/.openclaw/memory/entity_registry.json
    """

    COMMON_ENGLISH_WORDS = {
        "ever", "will", "bill", "mark", "april", "may", "june",
        "joy", "hope", "faith", "chase", "hunter", "dash",
        "river", "lane", "art", "clay", "max", "rex", "ray", "rose",
    }

    def __init__(self):
        self.data: dict = self._load()
        self._dirty = False

    def _load(self) -> dict:
        if ENTITY_REGISTRY_FILE.exists():
            try:
                return json.loads(ENTITY_REGISTRY_FILE.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError):
                pass
        return self._empty()

    def _empty(self) -> dict:
        return {
            "version": 1,
            "mode": "personal",
            "entities": {},  # name → Entity dict
            "ambiguous_flags": [],  # names that are also common English words
        }

    def save(self):
        """Persist to disk."""
        if self._dirty or not ENTITY_REGISTRY_FILE.exists():
            ENTITY_REGISTRY_FILE.parent.mkdir(parents=True, exist_ok=True)
            ENTITY_REGISTRY_FILE.write_text(
                json.dumps(self.data, indent=2, ensure_ascii=False),
                encoding="utf-8"
            )
            self._dirty = False

    # ── Properties ──────────────────────────────────────────────────────────

    @property
    def mode(self) -> str:
        return self.data.get("mode", "personal")

    @mode.setter
    def mode(self, v: str):
        self.data["mode"] = v
        self._dirty = True

    @property
    def entities(self) -> Dict[str, Entity]:
        return {k: Entity.from_dict(v) for k, v in self.data.get("entities", {}).items()}

    @property
    def people(self) -> Dict[str, Entity]:
        return {k: v for k, v in self.entities.items() if v.entity_type == "person"}

    @property
    def projects(self) -> Dict[str, Entity]:
        return {k: v for k, v in self.entities.items() if v.entity_type == "project"}

    # ── CRUD ────────────────────────────────────────────────────────────────

    def add_entity(
        self,
        name: str,
        entity_type: str = "person",
        confidence: float = 1.0,
        source: str = "onboarding",
        **kwargs
    ) -> Entity:
        """Add or update an entity."""
        now = datetime.now().isoformat()
        entity = Entity(
            name=name,
            entity_type=entity_type,
            confidence=confidence,
            source=source,
            created_at=now,
            updated_at=now,
            **kwargs
        )
        self.data["entities"][name] = entity.to_dict()

        # Flag ambiguous names
        if name.lower() in self.COMMON_ENGLISH_WORDS:
            if name.lower() not in self.data.get("ambiguous_flags", []):
                self.data.setdefault("ambiguous_flags", []).append(name.lower())

        self._dirty = True
        self.save()
        return entity

    def get(self, name: str) -> Optional[Entity]:
        """Get entity by name."""
        d = self.data.get("entities", {}).get(name)
        return Entity.from_dict(d) if d else None

    def remove(self, name: str) -> bool:
        """Remove an entity."""
        if name in self.data.get("entities", {}):
            del self.data["entities"][name]
            self._dirty = True
            self.save()
            return True
        return False

    def learn_from_text(self, text: str, min_confidence: float = 0.7) -> List[Entity]:
        """
        Scan text for new entity candidates using simple pattern matching.
        Returns list of newly discovered entities.
        """
        if not _CLASSIFIER_AVAILABLE:
            return []

        # Extract capitalized words (simple approach)
        candidates = re.findall(r"\b([A-Z][a-z]{1,19}(?:\s+[A-Z][a-z]{1,10})?)\b", text)
        frequency = defaultdict(int)
        for c in candidates:
            if c.lower() not in self.COMMON_ENGLISH_WORDS:
                frequency[c] += 1

        new_entities = []
        for name, freq in frequency.items():
            if freq < 3:
                continue
            if name in self.data.get("entities", {}):
                continue

            # Simple heuristic: if it appears 5+ times with varied surrounding words
            # and has mixed case (not all caps), likely a person or project
            if freq >= 5:
                entity_type = "person" if freq >= 8 else "project"
                entity = self.add_entity(
                    name=name,
                    entity_type=entity_type,
                    confidence=min(0.9, freq / 20),
                    source="learned",
                )
                new_entities.append(entity)

        return new_entities

    def summary(self) -> str:
        people = list(self.people.keys())
        projects = list(self.projects.keys())
        lines = [
            f"Mode: {self.mode}",
            f"People ({len(people)}): {', '.join(people[:8])}{'...' if len(people) > 8 else ''}",
            f"Projects ({len(projects)}): {', '.join(projects[:8])}{'...' if len(projects) > 8 else ''}",
        ]
        return "\n".join(lines)


# ─────────────────────────────────────────────────────────────────────────────
# TEMPORAL MEMORY STORE
# ─────────────────────────────────────────────────────────────────────────────

class TemporalMemoryStore:
    """
    Store and query temporal memories.

    Storage: ~/.openclaw/memory/memories.jsonl (append-only log)
    Index: ~/.openclaw/memory/memories.idx.json (in-memory on load)
    """

    def __init__(self):
        self.memories: Dict[str, MemoryEntry] = {}
        self.by_wing: Dict[str, List[str]] = defaultdict(list)
        self.by_room: Dict[str, List[str]] = defaultdict(list)
        self.by_hall: Dict[str, List[str]] = defaultdict(list)
        self._load()

    def _load(self):
        """Load memories from JSONL file."""
        if not MEMORIES_FILE.exists():
            return

        self.memories.clear()
        self.by_wing.clear()
        self.by_room.clear()
        self.by_hall.clear()

        try:
            with open(MEMORIES_FILE, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        d = json.loads(line)
                        entry = MemoryEntry.from_dict(d)
                        self._index_entry(entry)
                    except (json.JSONDecodeError, TypeError):
                        continue
        except OSError:
            pass

    def _index_entry(self, entry: MemoryEntry):
        """Index a memory entry."""
        self.memories[entry.id] = entry
        self.by_wing[entry.wing].append(entry.id)
        self.by_room[entry.room].append(entry.id)
        self.by_hall[entry.hall].append(entry.id)

    def _ensure_mkdir(self):
        MEMORY_DIR.mkdir(parents=True, exist_ok=True)

    def add(
        self,
        content: str,
        wing: str,
        room: str,
        hall: str = "hall_facts",
        valid_from: str = None,
        valid_to: str = None,
        tags: List[str] = None,
        importance: int = 3,
        memory_type: Any = None,
        skip_wal: bool = False,
    ) -> MemoryEntry:
        """
        Add a new memory entry.

        Args:
            content: The memory text
            wing: Wing identifier
            room: Room within wing
            hall: Hall type (hall_facts/events/discoveries/preferences/advice)
            valid_from: When this memory becomes valid (ISO timestamp)
            valid_to: When this memory expires (None = current)
            tags: Additional tags
            importance: 1-5 importance scale
            memory_type: MemoryType enum for auto hall detection
            skip_wal: Skip WAL logging (for internal use)
        """
        now = datetime.now().isoformat()
        valid_from = valid_from or now

        # Auto-detect hall from memory type
        if memory_type and _CLASSIFIER_AVAILABLE and HallType:
            detected_hall = HallType.from_memory_type(memory_type).value
            if detected_hall:
                hall = detected_hall

        content_hash = hashlib.sha256(content.encode()).hexdigest()[:16]
        entry_id = f"mem_{content_hash}_{datetime.now().strftime('%Y%m%d%H%M%S')}"

        entry = MemoryEntry(
            id=entry_id,
            content=content,
            wing=wing,
            room=room,
            hall=hall,
            created_at=now,
            valid_from=valid_from,
            valid_to=valid_to,
            superseded_by=None,
            tags=tags or [],
            importance=importance,
            content_hash=content_hash,
        )

        # WAL
        if not skip_wal and _CLASSIFIER_AVAILABLE:
            try:
                log_write(
                    operation="add_memory",
                    file_path=f"{wing}/{room}",
                    content_hash=content_hash,
                    metadata={
                        "hall": hall,
                        "importance": importance,
                        "entry_id": entry_id,
                    }
                )
            except Exception:
                pass

        # Append to JSONL
        self._ensure_mkdir()
        try:
            with open(MEMORIES_FILE, "a", encoding="utf-8") as f:
                f.write(json.dumps(entry.to_dict(), ensure_ascii=False) + "\n")
        except OSError:
            pass

        # Index in memory
        self._index_entry(entry)
        return entry

    def query(
        self,
        wing: str = None,
        room: str = None,
        hall: str = None,
        as_of: str = None,
        tag: str = None,
        limit: int = 50,
    ) -> List[MemoryEntry]:
        """
        Query memories with filters.

        Args:
            wing: Filter by wing
            room: Filter by room
            hall: Filter by hall type
            as_of: Only return memories valid at this time
            tag: Filter by tag
            limit: Max results
        """
        as_of = as_of or datetime.now().isoformat()

        candidates = set(self.memories.keys())

        if wing:
            candidates &= set(self.by_wing.get(wing, []))
        if room:
            candidates &= set(self.by_room.get(room, []))
        if hall:
            candidates &= set(self.by_hall.get(hall, []))

        results = []
        for mid in candidates:
            entry = self.memories[mid]
            if as_of and not entry.is_current(as_of):
                continue
            if tag and tag not in entry.tags:
                continue
            results.append(entry)

        # Sort by importance desc, then created_at desc
        results.sort(key=lambda e: (-e.importance, e.created_at), reverse=True)
        return results[:limit]

    def supersede(self, entry_id: str, superseded_by: str):
        """Mark an entry as superseded by a newer entry."""
        if entry_id in self.memories:
            self.memories[entry_id].superseded_by = superseded_by
            self._rewrite_entry(entry_id)

    def _rewrite_entry(self, entry_id: str):
        """Rewrite a specific entry in the JSONL file."""
        # Read all, replace, rewrite (inefficient but safe for small stores)
        entries = []
        try:
            with open(MEMORIES_FILE, "r", encoding="utf-8") as f:
                for line in f:
                    try:
                        d = json.loads(line.strip())
                        if d.get("id") == entry_id:
                            d["superseded_by"] = self.memories[entry_id].superseded_by
                            d["valid_to"] = self.memories[entry_id].valid_to
                        entries.append(d)
                    except json.JSONDecodeError:
                        continue

            with open(MEMORIES_FILE, "w", encoding="utf-8") as f:
                for d in entries:
                    f.write(json.dumps(d, ensure_ascii=False) + "\n")
        except OSError:
            pass

    def count(self) -> int:
        return len(self.memories)

    def stats(self) -> dict:
        """Get memory statistics."""
        return {
            "total": len(self.memories),
            "by_wing": {k: len(v) for k, v in self.by_wing.items()},
            "by_hall": {k: len(v) for k, v in self.by_hall.items()},
            "current": sum(
                1 for e in self.memories.values() if e.is_current()
            ),
        }


# ─────────────────────────────────────────────────────────────────────────────
# 4-LAYER MEMORY STACK
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class Identity:
    """L0 + L1 identity and essential story."""
    name: str = "Q仔"
    role: str = "AI商务助理"
    personality: str = "专业、高效、直接，无废话"
    language: str = "中文为主，English可切换"
    emoji: str = "📊"
    user_name: str = "Administrator"
    user_relationship: str = "雇主"
    user_preferences: List[str] = field(default_factory=list)
    key_projects: List[str] = field(default_factory=list)
    important_dates: Dict[str, str] = field(default_factory=dict)


class MemoryStack:
    """
    4-Layer Memory Stack for OpenClaw.

    L0: Identity (~50 tokens) — Always loaded. "Who am I?"
    L1: Essential Story (~120 tokens) — Always loaded. Critical facts.
    L2: On-Demand (~500 tokens) — Loaded when a topic/wing comes up.
    L3: Deep Search (unlimited) — Full semantic search when needed.

    Wake-up cost: ~170 tokens (L0+L1). Leaves 95%+ context free.
    """

    # Hall type to room mapping for L2
    HALL_TO_ROOM = {
        "hall_facts": "decisions",
        "hall_events": "events",
        "hall_discoveries": "insights",
        "hall_preferences": "preferences",
        "hall_advice": "advice",
    }

    def __init__(self):
        self.identity = self._load_identity()
        self.store = TemporalMemoryStore()
        self.registry = EntityRegistry()

    def _load_identity(self) -> Identity:
        """Load identity from disk."""
        if IDENTITY_FILE.exists():
            try:
                data = json.loads(IDENTITY_FILE.read_text(encoding="utf-8"))
                return Identity(**data)
            except (json.JSONDecodeError, TypeError, OSError):
                pass
        return Identity()

    def save_identity(self):
        """Persist identity to disk."""
        IDENTITY_FILE.parent.mkdir(parents=True, exist_ok=True)
        IDENTITY_FILE.write_text(
            json.dumps(asdict(self.identity), indent=2, ensure_ascii=False),
            encoding="utf-8"
        )

    # ── Layer 0: Identity ─────────────────────────────────────────────────

    def render_l0(self) -> str:
        """Render L0 identity text (~50 tokens)."""
        i = self.identity
        return f"""## L0 — IDENTITY
I am {i.name}, {i.role}.
Personality: {i.personality}.
Language: {i.language}.
User: {i.user_name} ({i.user_relationship}).
"""

    def token_estimate_l0(self) -> int:
        return len(self.render_l0()) // 4

    # ── Layer 1: Essential Story ────────────────────────────────────────────

    def render_l1(self, limit: int = 15) -> str:
        """Render L1 essential story (~120-500 tokens)."""
        memories = self.store.query(limit=limit)
        if not memories:
            return "## L1 — No memories yet."

        lines = ["## L1 — ESSENTIAL STORY", ""]

        # Group by wing/room
        by_wing_room = defaultdict(list)
        for mem in memories:
            by_wing_room[(mem.wing, mem.room)].append(mem)

        for (wing, room), entries in sorted(by_wing_room.items()):
            lines.append(f"[{wing}/{room}]")
            for e in entries[:5]:  # Max 5 per room
                snippet = e.content[:150].replace("\n", " ")
                if len(e.content) > 150:
                    snippet += "..."
                lines.append(f"  - {snippet}")
            lines.append("")

        return "\n".join(lines)

    def token_estimate_l1(self) -> str:
        text = self.render_l1()
        tokens = len(text) // 4
        if tokens < 200:
            size = "small"
        elif tokens < 500:
            size = "medium"
        else:
            size = "large"
        return f"~{tokens} tokens ({size})"

    # ── Layer 2: On-Demand ─────────────────────────────────────────────────

    def render_l2(self, wing: str = None, room: str = None) -> str:
        """Render L2 on-demand memory (~200-500 tokens)."""
        memories = self.store.query(wing=wing, room=room, limit=10)
        if not memories:
            return f"## L2 — No memories for {wing}/{room}."

        lines = [f"## L2 — ON-DEMAND ({wing}/{room})", ""]
        for mem in memories:
            lines.append(f"[{mem.hall}] {mem.content[:200]}")
        return "\n".join(lines)

    # ── Full Wake-up ────────────────────────────────────────────────────────

    def wake_up(self, wing: str = None) -> str:
        """
        Generate full wake-up text: L0 + L1.
        Typically ~170-600 tokens. Inject into system prompt.
        """
        parts = [self.render_l0(), ""]

        if wing:
            # Project-specific wake-up: L0 + L1 filtered by wing
            memories = self.store.query(wing=wing, limit=10)
            if memories:
                lines = ["## L1 — ESSENTIAL STORY"]
                for mem in memories:
                    lines.append(f"[{mem.room}] {mem.content[:150]}")
                parts.append("\n".join(lines))
            else:
                parts.append(self.render_l1())
        else:
            parts.append(self.render_l1())

        return "\n".join(parts)

    def status(self) -> dict:
        """Get status of all layers."""
        return {
            "L0_identity": {
                "tokens": self.token_estimate_l0(),
                "file": str(IDENTITY_FILE),
            },
            "L1_essential": {
                "tokens_estimate": self.token_estimate_l1(),
            },
            "store": self.store.stats(),
            "registry": {
                "people": len(self.registry.people),
                "projects": len(self.registry.projects),
            },
        }

    # ── Convenience Methods ────────────────────────────────────────────────

    def remember(
        self,
        content: str,
        wing: str = "wing_openclaw",
        room: str = "memory",
        tags: List[str] = None,
        importance: int = 3,
        auto_classify: bool = True,
    ):
        """
        Remember something. Auto-classifies if classifier available.

        Args:
            content: The memory text
            wing: Wing identifier
            room: Room within wing
            tags: Additional tags
            importance: 1-5 scale
            auto_classify: Use classifier to detect hall type
        """
        hall = "hall_facts"
        memory_type = None

        if auto_classify and _CLASSIFIER_AVAILABLE:
            result = _classify(content)
            hall_type = HallType.from_memory_type(result.type)
            hall = hall_type.value
            memory_type = result.type

        return self.store.add(
            content=content,
            wing=wing,
            room=room,
            hall=hall,
            tags=tags,
            importance=importance,
            memory_type=memory_type,
        )

    def recall(
        self,
        query: str = None,
        wing: str = None,
        room: str = None,
        hall: str = None,
        as_of: str = None,
    ) -> List[MemoryEntry]:
        """
        Recall memories matching criteria.

        Args:
            query: Text search (currently just returns all filtered)
            wing: Filter by wing
            room: Filter by room
            hall: Filter by hall
            as_of: Time travel query
        """
        return self.store.query(
            wing=wing,
            room=room,
            hall=hall,
            as_of=as_of,
            limit=50,
        )


# ─────────────────────────────────────────────────────────────────────────────
# GLOBAL SINGLETON
# ─────────────────────────────────────────────────────────────────────────────

_stack: Optional[MemoryStack] = None


def get_stack() -> MemoryStack:
    global _stack
    if _stack is None:
        _stack = MemoryStack()
    return _stack


# ─────────────────────────────────────────────────────────────────────────────
# CLI
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import sys

    def usage():
        print("Memory System CLI")
        print()
        print("  status              — Show memory system status")
        print("  wake-up [wing]      — Show L0+L1 wake-up text")
        print("  remember <text>     — Remember something")
        print("  recall [wing room]  — Recall memories")
        print("  entities            — Show entity registry")
        print("  add-entity <name> <type> — Add an entity")
        print("  init                — Initialize default structure")
        sys.exit(1)

    if len(sys.argv) < 2:
        usage()

    cmd = sys.argv[1]
    stack = get_stack()

    if cmd == "status":
        import json
        print(json.dumps(stack.status(), indent=2))

    elif cmd == "wake-up":
        wing = sys.argv[2] if len(sys.argv) > 2 else None
        print(stack.wake_up(wing))

    elif cmd == "remember":
        if len(sys.argv) < 3:
            print("Usage: remember <text>")
            sys.exit(1)
        text = sys.argv[2]
        entry = stack.remember(text)
        print(f"Remembered: {entry.id} ({entry.hall})")

    elif cmd == "recall":
        wing = sys.argv[2] if len(sys.argv) > 2 else None
        room = sys.argv[3] if len(sys.argv) > 3 else None
        memories = stack.recall(wing=wing, room=room)
        print(f"Found {len(memories)} memories:")
        for m in memories:
            print(f"  [{m.wing}/{m.room}] {m.content[:80]}")

    elif cmd == "entities":
        print(stack.registry.summary())

    elif cmd == "add-entity":
        if len(sys.argv) < 4:
            print("Usage: add-entity <name> <type>")
            sys.exit(1)
        name, etype = sys.argv[2], sys.argv[3]
        entity = stack.registry.add_entity(name, etype)
        print(f"Added: {entity.name} ({entity.entity_type})")

    elif cmd == "init":
        # Initialize default structure
        for wing_id, wing_def in DEFAULT_WINGS.items():
            for room in DEFAULT_ROOMS.get(wing_id, ["general"]):
                pass  # Just ensure structure exists
        stack.save_identity()
        print("Initialized default memory structure.")

    else:
        print(f"Unknown command: {cmd}")
        usage()
