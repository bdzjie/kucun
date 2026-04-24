"""
cone_graph.py — M-flow inspired Cone Graph Memory Layer

Four-layer episodic memory structure:
  Entity (person/tool/project — cross-Episode links)
    ↑ belongs_to
  FacetPoint (atomic assertion/fact)
    ↑ part_of
  Facet (one topical dimension of an Episode)
    ↑ belongs_to
  Episode (bounded memory bundle — event/decision/conversation)

Core insight (from M-flow):
  Similarity ≠ Relevance. Relevance = strongest evidence path.
  Query anchors at matching granularity → graph propagation → scored Episode bundle.
"""

import json
import sqlite3
import uuid
from datetime import datetime
from dataclasses import dataclass, asdict, field
from typing import Optional
from pathlib import Path

WORKSPACE = Path("C:/Users/Administrator/.openclaw/workspace")
DB_PATH = WORKSPACE / "memory" / "cone_graph.db"


# ─── Domain Models ───────────────────────────────────────────────────────────

@dataclass
class Entity:
    """Cross-Episode named entity (person/tool/project/concept)."""
    id: str = field(default_factory=lambda: f"ent_{uuid.uuid4().hex[:12]}")
    name: str = ""
    entity_type: str = ""  # person / tool / project / concept / org
    metadata: dict = field(default_factory=dict)
    created_at: str = ""

    def __post_init__(self):
        if not self.created_at:
            self.created_at = datetime.utcnow().isoformat()


@dataclass
class EvidenceEdge:
    """Typed edge with semantic description and propagation cost."""
    id: str = field(default_factory=lambda: f"edge_{uuid.uuid4().hex[:12]}")
    source_id: str = ""
    target_id: str = ""
    source_type: str = ""  # episode / facet / facetpoint / entity
    target_type: str = ""
    edge_type: str = ""  # caused_by / mentions / contradicts / refines / part_of / belongs_to
    edge_text: str = ""  # natural language description of relationship
    propagation_cost: float = 1.0  # cost per hop
    metadata: dict = field(default_factory=dict)

    def __post_init__(self):
        if not self.id.startswith("edge_"):
            self.id = f"edge_{uuid.uuid4().hex[:12]}"


@dataclass
class FacetPoint:
    """Atomic assertion — a single verifiable fact or claim."""
    id: str = field(default_factory=lambda: f"fp_{uuid.uuid4().hex[:12]}")
    content: str = ""  # original text
    entity_ids: list = field(default_factory=list)  # linked entities
    facet_id: str = ""
    source: str = ""  # which session/tool produced this
    created_at: str = ""

    def __post_init__(self):
        if not self.created_at:
            self.created_at = datetime.utcnow().isoformat()
        if isinstance(self.entity_ids, str):
            self.entity_ids = json.loads(self.entity_ids)


@dataclass
class Facet:
    """One topical dimension of an Episode."""
    id: str = field(default_factory=lambda: f"fac_{uuid.uuid4().hex[:12]}")
    topic: str = ""  # "deadline communication" / "performance issue"
    summary: str = ""  # brief description of this facet
    facetpoint_ids: list = field(default_factory=list)
    episode_id: str = ""
    created_at: str = ""

    def __post_init__(self):
        if not self.created_at:
            self.created_at = datetime.utcnow().isoformat()
        if isinstance(self.facetpoint_ids, str):
            self.facetpoint_ids = json.loads(self.facetpoint_ids)


@dataclass
class Episode:
    """Bounded memory bundle — event, decision, or conversation."""
    id: str = field(default_factory=lambda: f"ep_{uuid.uuid4().hex[:12]}")
    summary: str = ""  # LLM-generated summary
    facet_ids: list = field(default_factory=list)
    entity_ids: list = field(default_factory=list)  # key entities in this episode
    source_session: str = ""  # which session produced this
    source_type: str = ""  # conversation / document / action / decision
    timestamp: str = ""
    # Computed during retrieval
    score: float = 0.0  # path-cost based score
    path_cost: float = 0.0  # strongest path cost
    strongest_path: list = field(default_factory=list)  # list of edge_ids

    def __post_init__(self):
        if not self.timestamp:
            self.timestamp = datetime.utcnow().isoformat()
        if isinstance(self.facet_ids, str):
            self.facet_ids = json.loads(self.facet_ids)
        if isinstance(self.entity_ids, str):
            self.entity_ids = json.loads(self.entity_ids)


# ─── SQLite Store ───────────────────────────────────────────────────────────

class ConeGraphStore:
    """
    SQLite-backed Cone Graph store.
    Schema:
      entities(id, name, entity_type, metadata, created_at)
      episodes(id, summary, facet_ids, entity_ids, source_session, source_type, timestamp, score, path_cost, strongest_path)
      facets(id, topic, summary, facetpoint_ids, episode_id, created_at)
      facetpoints(id, content, entity_ids, facet_id, source, created_at)
      evidence_edges(id, source_id, target_id, source_type, target_type, edge_type, edge_text, propagation_cost, metadata)
    """

    def __init__(self, db_path: Optional[str] = None):
        self.db_path = db_path or str(DB_PATH)
        self._init_db()

    def _init_db(self):
        Path(self.db_path).parent.mkdir(parents=True, exist_ok=True)
        with sqlite3.connect(self.db_path) as conn:
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS entities (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    entity_type TEXT DEFAULT '',
                    metadata TEXT DEFAULT '{}',
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS episodes (
                    id TEXT PRIMARY KEY,
                    summary TEXT NOT NULL DEFAULT '',
                    facet_ids TEXT DEFAULT '[]',
                    entity_ids TEXT DEFAULT '[]',
                    source_session TEXT DEFAULT '',
                    source_type TEXT DEFAULT '',
                    timestamp TEXT NOT NULL,
                    score REAL DEFAULT 0.0,
                    path_cost REAL DEFAULT 999999.0,
                    strongest_path TEXT DEFAULT '[]'
                );
                CREATE TABLE IF NOT EXISTS facets (
                    id TEXT PRIMARY KEY,
                    topic TEXT NOT NULL DEFAULT '',
                    summary TEXT DEFAULT '',
                    facetpoint_ids TEXT DEFAULT '[]',
                    episode_id TEXT DEFAULT '',
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS facetpoints (
                    id TEXT PRIMARY KEY,
                    content TEXT NOT NULL DEFAULT '',
                    entity_ids TEXT DEFAULT '[]',
                    facet_id TEXT DEFAULT '',
                    source TEXT DEFAULT '',
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS evidence_edges (
                    id TEXT PRIMARY KEY,
                    source_id TEXT NOT NULL,
                    target_id TEXT NOT NULL,
                    source_type TEXT DEFAULT '',
                    target_type TEXT DEFAULT '',
                    edge_type TEXT DEFAULT '',
                    edge_text TEXT DEFAULT '',
                    propagation_cost REAL DEFAULT 1.0,
                    metadata TEXT DEFAULT '{}'
                );
                CREATE INDEX IF NOT EXISTS idx_edges_source ON evidence_edges(source_id);
                CREATE INDEX IF NOT EXISTS idx_edges_target ON evidence_edges(target_id);
                CREATE INDEX IF NOT EXISTS idx_edges_type ON evidence_edges(edge_type);
                CREATE INDEX IF NOT EXISTS idx_facetpoints_facet ON facetpoints(facet_id);
                CREATE INDEX IF NOT EXISTS idx_facets_episode ON facets(episode_id);
                CREATE INDEX IF NOT EXISTS idx_episodes_session ON episodes(source_session);
            """)

    def _row_to_dict(self, row, cols):
        return dict(zip(cols, row))

    # ── Entity CRUD ──────────────────────────────────────────────────────

    def add_entity(self, entity: Entity) -> Entity:
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                """INSERT INTO entities(id,name,entity_type,metadata,created_at)
                   VALUES(?,?,?,?,?)""",
                (entity.id, entity.name, entity.entity_type,
                 json.dumps(entity.metadata), entity.created_at)
            )
        return entity

    def get_entity(self, eid: str) -> Optional[Entity]:
        with sqlite3.connect(self.db_path) as conn:
            row = conn.execute(
                "SELECT * FROM entities WHERE id=?", (eid,)).fetchone()
        if not row:
            return None
        cols = [c[1] for c in conn.execute("PRAGMA table_info(entities)").fetchall()]
        d = self._row_to_dict(row, cols)
        d['metadata'] = json.loads(d['metadata'])
        return Entity(**d)

    def find_entities(self, name_pattern: str = "", e_type: str = "") -> list[Entity]:
        query = "SELECT * FROM entities WHERE 1=1"
        params = []
        if name_pattern:
            query += " AND name LIKE ?"
            params.append(f"%{name_pattern}%")
        if e_type:
            query += " AND entity_type=?"
            params.append(e_type)
        with sqlite3.connect(self.db_path) as conn:
            rows = conn.execute(query, params).fetchall()
            cols = [c[1] for c in conn.execute("PRAGMA table_info(entities)").fetchall()]
        results = []
        for row in rows:
            d = self._row_to_dict(row, cols)
            d['metadata'] = json.loads(d['metadata'])
            results.append(Entity(**d))
        return results

    # ── Episode CRUD ──────────────────────────────────────────────────

    def add_episode(self, episode: Episode) -> Episode:
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                """INSERT INTO episodes(id,summary,facet_ids,entity_ids,source_session,source_type,timestamp,score,path_cost,strongest_path)
                   VALUES(?,?,?,?,?,?,?,?,?,?)""",
                (episode.id, episode.summary, json.dumps(episode.facet_ids),
                 json.dumps(episode.entity_ids), episode.source_session,
                 episode.source_type, episode.timestamp, episode.score,
                 episode.path_cost, json.dumps(episode.strongest_path))
            )
        return episode

    def get_episode(self, eid: str) -> Optional[Episode]:
        with sqlite3.connect(self.db_path) as conn:
            row = conn.execute(
                "SELECT * FROM episodes WHERE id=?", (eid,)).fetchone()
        if not row:
            return None
        cols = [c[1] for c in conn.execute("PRAGMA table_info(episodes)").fetchall()]
        d = self._row_to_dict(row, cols)
        d['facet_ids'] = json.loads(d['facet_ids'])
        d['entity_ids'] = json.loads(d['entity_ids'])
        d['strongest_path'] = json.loads(d['strongest_path'])
        return Episode(**d)

    def update_episode_score(self, eid: str, score: float, path_cost: float, strongest_path: list):
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                """UPDATE episodes SET score=?, path_cost=?, strongest_path=?
                   WHERE id=?""",
                (score, path_cost, json.dumps(strongest_path), eid))

    def get_all_episodes(self) -> list[Episode]:
        with sqlite3.connect(self.db_path) as conn:
            rows = conn.execute("SELECT * FROM episodes ORDER BY timestamp DESC").fetchall()
            cols = [c[1] for c in conn.execute("PRAGMA table_info(episodes)").fetchall()]
        results = []
        for row in rows:
            d = self._row_to_dict(row, cols)
            d['facet_ids'] = json.loads(d['facet_ids'])
            d['entity_ids'] = json.loads(d['entity_ids'])
            d['strongest_path'] = json.loads(d['strongest_path'])
            results.append(Episode(**d))
        return results

    # ── Facet CRUD ──────────────────────────────────────────────────────

    def add_facet(self, facet: Facet) -> Facet:
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                """INSERT INTO facets(id,topic,summary,facetpoint_ids,episode_id,created_at)
                   VALUES(?,?,?,?,?,?)""",
                (facet.id, facet.topic, facet.summary,
                 json.dumps(facet.facetpoint_ids), facet.episode_id, facet.created_at))
            return facet

    def get_facet(self, fid: str) -> Optional[Facet]:
        with sqlite3.connect(self.db_path) as conn:
            row = conn.execute("SELECT * FROM facets WHERE id=?", (fid,)).fetchone()
            cols = [c[1] for c in conn.execute("PRAGMA table_info(facets)").fetchall()]
        if not row:
            return None
        d = self._row_to_dict(row, cols)
        d['facetpoint_ids'] = json.loads(d['facetpoint_ids'])
        return Facet(**d)

    def get_facets_by_episode(self, episode_id: str) -> list[Facet]:
        with sqlite3.connect(self.db_path) as conn:
            rows = conn.execute(
                "SELECT * FROM facets WHERE episode_id=?", (episode_id,)).fetchall()
            cols = [c[1] for c in conn.execute("PRAGMA table_info(facets)").fetchall()]
        results = []
        for row in rows:
            d = self._row_to_dict(row, cols)
            d['facetpoint_ids'] = json.loads(d['facetpoint_ids'])
            results.append(Facet(**d))
        return results

    # ── FacetPoint CRUD ────────────────────────────────────────────────

    def add_facetpoint(self, fp: FacetPoint) -> FacetPoint:
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                """INSERT INTO facetpoints(id,content,entity_ids,facet_id,source,created_at)
                   VALUES(?,?,?,?,?,?)""",
                (fp.id, fp.content, json.dumps(fp.entity_ids),
                 fp.facet_id, fp.source, fp.created_at))
            return fp

    def get_facetpoint(self, fpid: str) -> Optional[FacetPoint]:
        with sqlite3.connect(self.db_path) as conn:
            row = conn.execute(
                "SELECT * FROM facetpoints WHERE id=?", (fpid,)).fetchone()
            cols = [c[1] for c in conn.execute("PRAGMA table_info(facetpoints)").fetchall()]
        if not row:
            return None
        d = self._row_to_dict(row, cols)
        d['entity_ids'] = json.loads(d['entity_ids'])
        return FacetPoint(**d)

    def get_facetpoints_by_facet(self, facet_id: str) -> list[FacetPoint]:
        with sqlite3.connect(self.db_path) as conn:
            rows = conn.execute(
                "SELECT * FROM facetpoints WHERE facet_id=?", (facet_id,)).fetchall()
            cols = [c[1] for c in conn.execute("PRAGMA table_info(facetpoints)").fetchall()]
        results = []
        for row in rows:
            d = self._row_to_dict(row, cols)
            d['entity_ids'] = json.loads(d['entity_ids'])
            results.append(FacetPoint(**d))
        return results

    # ── Evidence Edge CRUD ────────────────────────────────────────────

    def add_edge(self, edge: EvidenceEdge) -> EvidenceEdge:
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                """INSERT INTO evidence_edges(id,source_id,target_id,source_type,target_type,edge_type,edge_text,propagation_cost,metadata)
                   VALUES(?,?,?,?,?,?,?,?,?)""",
                (edge.id, edge.source_id, edge.target_id,
                 edge.source_type, edge.target_type, edge.edge_type,
                 edge.edge_text, edge.propagation_cost, json.dumps(edge.metadata)))
            return edge

    def get_outgoing_edges(self, node_id: str) -> list[EvidenceEdge]:
        with sqlite3.connect(self.db_path) as conn:
            rows = conn.execute(
                "SELECT * FROM evidence_edges WHERE source_id=?", (node_id,)).fetchall()
            cols = [c[1] for c in conn.execute("PRAGMA table_info(evidence_edges)").fetchall()]
        results = []
        for row in rows:
            d = self._row_to_dict(row, cols)
            d['metadata'] = json.loads(d['metadata'])
            results.append(EvidenceEdge(**d))
        return results

    def get_incoming_edges(self, node_id: str) -> list[EvidenceEdge]:
        with sqlite3.connect(self.db_path) as conn:
            rows = conn.execute(
                "SELECT * FROM evidence_edges WHERE target_id=?", (node_id,)).fetchall()
            cols = [c[1] for c in conn.execute("PRAGMA table_info(evidence_edges)").fetchall()]
        results = []
        for row in rows:
            d = self._row_to_dict(row, cols)
            d['metadata'] = json.loads(d['metadata'])
            results.append(EvidenceEdge(**d))
        return results

    # ── Search helpers ────────────────────────────────────────────────

    def search_facets(self, keyword: str, limit: int = 20) -> list[Facet]:
        """Text search in Facet topic and summary."""
        with sqlite3.connect(self.db_path) as conn:
            rows = conn.execute(
                """SELECT * FROM facets
                   WHERE topic LIKE ? OR summary LIKE ? ORDER BY created_at DESC LIMIT ?""",
                (f"%{keyword}%", f"%{keyword}%", limit)).fetchall()
            cols = [c[1] for c in conn.execute("PRAGMA table_info(facets)").fetchall()]
        results = []
        for row in rows:
            d = self._row_to_dict(row, cols)
            d['facetpoint_ids'] = json.loads(d.get('facetpoint_ids') or '[]')
            results.append(Facet(**d))
        return results

    def search_facetpoints(self, keyword: str, limit: int = 20) -> list[FacetPoint]:
        """Text search in FacetPoint content."""
        with sqlite3.connect(self.db_path) as conn:
            rows = conn.execute(
                """SELECT * FROM facetpoints
                   WHERE content LIKE ? ORDER BY created_at DESC LIMIT ?""",
                (f"%{keyword}%", limit)).fetchall()
            cols = [c[1] for c in conn.execute("PRAGMA table_info(facetpoints)").fetchall()]
        results = []
        for row in rows:
            d = self._row_to_dict(row, cols)
            d['entity_ids'] = json.loads(d['entity_ids'])
            results.append(FacetPoint(**d))
        return results

    def search_episodes(self, keyword: str, limit: int = 20) -> list[Episode]:
        """Text search in Episode summary."""
        with sqlite3.connect(self.db_path) as conn:
            rows = conn.execute(
                """SELECT * FROM episodes
                   WHERE summary LIKE ? ORDER BY score DESC LIMIT ?""",
                (f"%{keyword}%", limit)).fetchall()
            cols = [c[1] for c in conn.execute("PRAGMA table_info(episodes)").fetchall()]
        results = []
        for row in rows:
            d = self._row_to_dict(row, cols)
            d['facet_ids'] = json.loads(d['facet_ids'])
            d['entity_ids'] = json.loads(d['entity_ids'])
            d['strongest_path'] = json.loads(d['strongest_path'])
            results.append(Episode(**d))
        return results

    # ── Statistics ────────────────────────────────────────────────────

    def stats(self) -> dict:
        with sqlite3.connect(self.db_path) as conn:
            return {
                "entities": conn.execute("SELECT COUNT(*) FROM entities").fetchone()[0],
                "episodes": conn.execute("SELECT COUNT(*) FROM episodes").fetchone()[0],
                "facets": conn.execute("SELECT COUNT(*) FROM facets").fetchone()[0],
                "facetpoints": conn.execute("SELECT COUNT(*) FROM facetpoints").fetchone()[0],
                "edges": conn.execute("SELECT COUNT(*) FROM evidence_edges").fetchone()[0],
            }


# ─── CLI ───────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import argparse
    store = ConeGraphStore()

    parser = argparse.ArgumentParser(description="Cone Graph CLI")
    sub = parser.add_subparsers(dest="cmd")

    p = sub.add_parser("add-entity")
    p.add_argument("--name", required=True)
    p.add_argument("--type", default="concept")

    p = sub.add_parser("add-episode")
    p.add_argument("--summary", required=True)
    p.add_argument("--session", default="")
    p.add_argument("--type", default="conversation")

    p = sub.add_parser("stats")

    p = sub.add_parser("search")
    p.add_argument("keyword")
    p.add_argument("--limit", type=int, default=10)

    args = parser.parse_args()

    if args.cmd == "add-entity":
        e = Entity(name=args.name, entity_type=args.type)
        store.add_entity(e)
        print(f"Entity added: {e.id} ({e.name})")

    elif args.cmd == "add-episode":
        ep = Episode(summary=args.summary, source_session=args.session, source_type=args.type)
        store.add_episode(ep)
        print(f"Episode added: {ep.id}")

    elif args.cmd == "stats":
        s = store.stats()
        print(f"Entities: {s['entities']} | Episodes: {s['episodes']} | Facets: {s['facets']} | FacetPoints: {s['facetpoints']} | Edges: {s['edges']}")

    elif args.cmd == "search":
        eps = store.search_episodes(args.keyword, limit=args.limit)
        print(f"Episodes matching '{args.keyword}':")
        for e in eps:
            print(f"  [{e.id}] {e.summary[:60]} (score={e.score:.3f})")
        fps = store.search_facetpoints(args.keyword, limit=args.limit)
        print(f"FacetPoints matching '{args.keyword}':")
        for fp in fps:
            print(f"  [{fp.id}] {fp.content[:60]}")
