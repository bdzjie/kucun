"""
modules/ontology_v2.py
=======================
Ontology Knowledge Graph with Version History + Soft Delete

Inspired by OpenMetadata Entity Versioning:
  - Every entity update creates a new version
  - Previous versions are preserved (append-only)
  - Soft delete (isDeleted flag) instead of physical deletion
  - Version history with diff tracking

Backwards compatible with existing graph.jsonl format.
"""

import json
import os
import sqlite3
from pathlib import Path
from datetime import datetime
from typing import Dict, List, Optional, Any
from dataclasses import dataclass, asdict
from enum import Enum

WORKSPACE = Path(r'C:\Users\Administrator\.openclaw\workspace')
ONTOLOGY_DIR = Path.home() / '.openclaw' / 'memory' / 'ontology'
GRAPH_FILE = ONTOLOGY_DIR / 'graph.jsonl'
GRAPH_V2_DB = ONTOLOGY_DIR / 'ontology_v2.db'


class EntityType(Enum):
    PROJECT = 'Project'
    TASK = 'Task'
    PERSON = 'Person'
    AGENT = 'Agent'
    ACTION = 'Action'
    MEMORY = 'Memory'
    SESSION = 'Session'
    SKILL = 'Skill'


class RelationType(Enum):
    HAS_OWNER = 'has_owner'
    PART_OF = 'part_of'
    BLOCKS = 'blocks'
    RELATES_TO = 'relates_to'
    DERIVES_FROM = 'derives_from'
    CITES = 'cites'
    INVOKES = 'invokes'


@dataclass
class EntityVersion:
    """A versioned entity snapshot."""
    id: str
    entity_type: str
    properties: Dict[str, Any]
    version: int
    prev_version: Optional[int]
    is_deleted: bool
    created_at: str
    updated_at: str
    created_by: Optional[str] = None
    extension: Optional[Dict[str, Any]] = None  # Free-form metadata (OpenMetadata extension pattern)


@dataclass
class Relation:
    from_id: str
    rel: str
    to_id: str
    created_at: str


# ─── Database Layer ──────────────────────────────────────────────────────────

def _get_db() -> sqlite3.Connection:
    ONTOLOGY_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(GRAPH_V2_DB))
    conn.execute('''
      CREATE TABLE IF NOT EXISTS entities (
        id TEXT PRIMARY KEY,
        entity_type TEXT NOT NULL,
        properties TEXT NOT NULL,  -- JSON
        version INTEGER NOT NULL DEFAULT 1,
        prev_version INTEGER,
        is_deleted INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        created_by TEXT,
        extension TEXT  -- JSON
      )
    ''')
    conn.execute('''
      CREATE TABLE IF NOT EXISTS relations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        from_id TEXT NOT NULL,
        rel TEXT NOT NULL,
        to_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(from_id, rel, to_id)
      )
    ''')
    conn.execute('''
      CREATE TABLE IF NOT EXISTS version_history (
        entity_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        snapshot TEXT NOT NULL,  -- JSON of EntityVersion
        created_at TEXT NOT NULL,
        PRIMARY KEY (entity_id, version)
      )
    ''')
    conn.create_index('idx_entities_type', 'entities', ['entity_type'])
    conn.create_index('idx_entities_deleted', 'entities', ['is_deleted'])
    conn.create_index('idx_relations_from', 'relations', ['from_id'])
    conn.create_index('idx_relations_to', 'relations', ['to_id'])
    return conn


# ─── Core API ────────────────────────────────────────────────────────────────

class OntologyV2:
    """
    Versioned Ontology with soft delete and version history.
    """

    def __init__(self):
        self.db = _get_db()

    # ─── Entity Operations ───────────────────────────────────────────────────

    def create_entity(
        self,
        id: str,
        entity_type: str,
        properties: Dict[str, Any],
        created_by: Optional[str] = None,
        extension: Optional[Dict[str, Any]] = None,
    ) -> EntityVersion:
        """Create a new entity (v1)."""
        now = datetime.utcnow().isoformat() + 'Z'
        entity = EntityVersion(
            id=id,
            entity_type=entity_type,
            properties=properties,
            version=1,
            prev_version=None,
            is_deleted=False,
            created_at=now,
            updated_at=now,
            created_by=created_by,
            extension=extension,
        )

        # Insert entity
        self.db.execute('''
          INSERT INTO entities (id, entity_type, properties, version, prev_version,
                                is_deleted, created_at, updated_at, created_by, extension)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            entity.id, entity.entity_type, json.dumps(entity.properties, ensure_ascii=False),
            entity.version, entity.prev_version, 0 if not entity.is_deleted else 1,
            entity.created_at, entity.updated_at, entity.created_by,
            json.dumps(entity.extension, ensure_ascii=False) if entity.extension else None,
        ))

        # Snapshot v1 in history
        self._snapshot(entity)
        self.db.commit()
        return entity

    def update_entity(
        self,
        id: str,
        properties: Dict[str, Any],
        updated_by: Optional[str] = None,
        extension: Optional[Dict[str, Any]] = None,
    ) -> Optional[EntityVersion]:
        """
        Update an entity — creates a NEW version, preserves history.
        Returns the new version, or None if entity not found / deleted.
        """
        current = self._get_current(id)
        if not current:
            return None

        now = datetime.utcnow().isoformat() + 'Z'
        new_version = EntityVersion(
            id=id,
            entity_type=current.entity_type,
            properties=properties,
            version=current.version + 1,
            prev_version=current.version,
            is_deleted=False,
            created_at=current.created_at,
            updated_at=now,
            created_by=current.created_by,
            extension=extension or current.extension,
        )

        self.db.execute('''
          UPDATE entities
          SET properties=?, version=?, prev_version=?, updated_at=?, extension=?
          WHERE id=? AND is_deleted=0
        ''', (
            json.dumps(properties, ensure_ascii=False),
            new_version.version, new_version.prev_version, now,
            json.dumps(new_version.extension, ensure_ascii=False) if new_version.extension else None,
            id,
        ))

        self._snapshot(new_version)
        self.db.commit()
        return new_version

    def soft_delete(self, id: str) -> bool:
        """Soft delete — marks isDeleted=True, preserves history."""
        result = self.db.execute(
            'UPDATE entities SET is_deleted=1, updated_at=? WHERE id=? AND is_deleted=0',
            (datetime.utcnow().isoformat() + 'Z', id)
        )
        self.db.commit()
        return result.rowcount > 0

    def restore(self, id: str) -> bool:
        """Restore a soft-deleted entity."""
        result = self.db.execute(
            'UPDATE entities SET is_deleted=0, updated_at=? WHERE id=? AND is_deleted=1',
            (datetime.utcnow().isonow() + 'Z', id)
        )
        self.db.commit()
        return result.rowcount > 0

    def get_entity(self, id: str, version: Optional[int] = None) -> Optional[EntityVersion]:
        """
        Get entity. If version is None, returns latest.
        If version is specified, returns that specific version from history.
        """
        if version is not None:
            return self._get_version(id, version)
        return self._get_current(id)

    def get_history(self, id: str) -> List[EntityVersion]:
        """Get all versions of an entity."""
        rows = self.db.execute(
            'SELECT snapshot FROM version_history WHERE entity_id=? ORDER BY version DESC',
            (id,)
        ).fetchall()
        return [EntityVersion(**json.loads(r[0])) for r in rows]

    def list_entities(
        self,
        entity_type: Optional[str] = None,
        include_deleted: bool = False,
    ) -> List[EntityVersion]:
        """List all entities, optionally filtered by type."""
        query = 'SELECT snapshot FROM entities WHERE 1=1'
        params: List[Any] = []
        if not include_deleted:
            query += ' AND is_deleted=0'
        if entity_type:
            query += ' AND entity_type=?'
            params.append(entity_type)

        rows = self.db.execute(query, params).fetchall()
        return [EntityVersion(**json.loads(r[0])) for r in rows]

    def get_deleted(self) -> List[EntityVersion]:
        """List soft-deleted entities (recoverable)."""
        rows = self.db.execute(
            "SELECT snapshot FROM entities WHERE is_deleted=1"
        ).fetchall()
        return [EntityVersion(**json.loads(r[0])) for r in rows]

    # ─── Relation Operations ─────────────────────────────────────────────────

    def relate(self, from_id: str, rel: str, to_id: str) -> Optional[Relation]:
        """Create a relation between two entities."""
        # Verify both entities exist
        if not self._get_current(from_id) or not self._get_current(to_id):
            return None

        now = datetime.utcnow().isoformat() + 'Z'
        try:
            self.db.execute(
                'INSERT INTO relations (from_id, rel, to_id, created_at) VALUES (?, ?, ?, ?)',
                (from_id, rel, to_id, now)
            )
            self.db.commit()
        except sqlite3.IntegrityError:
            # Relation already exists
            pass

        return Relation(from_id=from_id, rel=rel, to_id=to_id, created_at=now)

    def get_outgoing(self, entity_id: str) -> List[Relation]:
        """Get all outgoing relations from an entity."""
        rows = self.db.execute(
            'SELECT from_id, rel, to_id, created_at FROM relations WHERE from_id=?',
            (entity_id,)
        ).fetchall()
        return [Relation(from_id=r[0], rel=r[1], to_id=r[2], created_at=r[3]) for r in rows]

    def get_incoming(self, entity_id: str) -> List[Relation]:
        """Get all incoming relations to an entity."""
        rows = self.db.execute(
            'SELECT from_id, rel, to_id, created_at FROM relations WHERE to_id=?',
            (entity_id,)
        ).fetchall()
        return [Relation(from_id=r[0], rel=r[1], to_id=r[2], created_at=r[3]) for r in rows]

    # ─── Query Helpers ──────────────────────────────────────────────────────

    def find_entities(
        self,
        entity_type: str,
        properties_filter: Optional[Dict[str, Any]] = None,
    ) -> List[EntityVersion]:
        """Find entities by type and property values."""
        entities = self.list_entities(entity_type=entity_type)
        if not properties_filter:
            return entities

        results = []
        for e in entities:
            if all(e.properties.get(k) == v for k, v in properties_filter.items()):
                results.append(e)
        return results

    def get_stats(self) -> Dict[str, Any]:
        """Get ontology statistics."""
        total = self.db.execute('SELECT COUNT(*) FROM entities WHERE is_deleted=0').fetchone()[0]
        deleted = self.db.execute('SELECT COUNT(*) FROM entities WHERE is_deleted=1').fetchone()[0]
        relations = self.db.execute('SELECT COUNT(*) FROM relations').fetchone()[0]
        versions = self.db.execute('SELECT COUNT(*) FROM version_history').fetchone()[0]

        type_counts: Dict[str, int] = {}
        for row in self.db.execute(
            'SELECT entity_type, COUNT(*) FROM entities WHERE is_deleted=0 GROUP BY entity_type'
        ).fetchall():
            type_counts[row[0]] = row[1]

        return {
            'total_entities': total,
            'soft_deleted': deleted,
            'total_relations': relations,
            'total_versions': versions,
            'by_type': type_counts,
        }

    # ─── Import from v1 format ──────────────────────────────────────────────

    def import_v1(self, v1_path: Path = GRAPH_FILE) -> int:
        """Import entities from existing graph.jsonl (v1 format)."""
        if not v1_path.exists():
            return 0

        count = 0
        with open(v1_path, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    record = json.loads(line)
                    op = record.get('op', '')
                    entity = record.get('entity') or record.get('relation', {})
                    eid = entity.get('id', '')
                    etype = entity.get('type', 'Unknown')
                    props = entity.get('properties', {})

                    if op == 'create' and eid and etype != 'Unknown':
                        self.create_entity(id=eid, entity_type=etype, properties=props)
                        count += 1
                    elif op == 'relate':
                        self.relate(
                            from_id=record.get('from', ''),
                            rel=record.get('rel', ''),
                            to_id=record.get('to', ''),
                        )
                except Exception:
                    continue

        return count

    # ─── Private ────────────────────────────────────────────────────────────

    def _get_current(self, id: str) -> Optional[EntityVersion]:
        row = self.db.execute(
            'SELECT snapshot FROM entities WHERE id=? AND is_deleted=0'
        ).fetchone()
        return EntityVersion(**json.loads(row[0])) if row else None

    def _get_version(self, id: str, version: int) -> Optional[EntityVersion]:
        row = self.db.execute(
            'SELECT snapshot FROM version_history WHERE entity_id=? AND version=?'
        ).fetchone()
        return EntityVersion(**json.loads(row[0])) if row else None

    def _snapshot(self, entity: EntityVersion) -> None:
        self.db.execute(
            'INSERT OR REPLACE INTO version_history (entity_id, version, snapshot, created_at) VALUES (?, ?, ?, ?)',
            (entity.id, entity.version, json.dumps(asdict(entity), ensure_ascii=False), entity.updated_at)
        )


# ─── Singleton ──────────────────────────────────────────────────────────────

_ontology: Optional[OntologyV2] = None

def get_ontology_v2() -> OntologyV2:
    global _ontology
    if _ontology is None:
        _ontology = OntologyV2()
    return _ontology


# ─── CLI ─────────────────────────────────────────────────────────────────────

if __name__ == '__main__':
    import sys

    ontology = get_ontology_v2()

    if len(sys.argv) > 1 and sys.argv[1] == 'import':
        count = ontology.import_v1()
        print(f'Imported {count} entities from v1 format')

    elif len(sys.argv) > 1 and sys.argv[1] == 'stats':
        stats = ontology.get_stats()
        print(json.dumps(stats, indent=2, ensure_ascii=False))

    elif len(sys.argv) > 1 and sys.argv[1] == 'deleted':
        for e in ontology.get_deleted():
            print(f"[{e.id}] v{e.version} | {e.entity_type} | deleted at {e.updated_at}")

    elif len(sys.argv) > 1 and sys.argv[1] == 'history':
        if len(sys.argv) < 3:
            print('Usage: python ontology_v2.py history <entity_id>')
        else:
            for v in ontology.get_history(sys.argv[2]):
                print(f"v{v.version} | {v.properties} | {v.updated_at}")

    else:
        print('Usage: python ontology_v2.py [import|stats|deleted|history <entity_id>]')
