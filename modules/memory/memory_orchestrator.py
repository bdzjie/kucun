"""
memory_orchestrator.py — Unified Memory Retrieval Orchestrator

Combines all Cone Graph components into a single retrieval interface:

  1. Granularity Router     → determines entry layer
  2. Vector/keyword search  → finds candidate anchors
  3. Graph Propagator       → scores Episodes by evidence path
  4. Bundle Assembler       → returns structured MemoryBundle

Supports 5 retrieval modes:
  - episodic  : Cone Graph Bundle Search (primary, best accuracy)
  - procedural: Abstract pattern extraction (workflows/habits)
  - lexical   : BM25/keyword fallback (for simple queries)
  - unified   : episodic + lexical hybrid
  - cypher    : (reserved for future graph DB queries)
"""

from dataclasses import dataclass, field
from typing import Optional
from modules.memory.cone_graph import (
    ConeGraphStore, Episode, Facet, FacetPoint, Entity, EvidenceEdge,
)
from modules.memory.granularity_router import (
    RetrievalLayer, RouterResult, classify,
)
from modules.memory.graph_propagator import GraphPropagator, BundleAssembler
from modules.memory.cone_vector import ConeVectorIndex


@dataclass
class MemoryBundle:
    """Structured response from memory query."""
    episodes: list[Episode]
    facets: list[Facet]
    facetpoints: list[FacetPoint]
    entities: list[Entity]
    scores: dict[str, float]  # ep_id → relevance score
    retrieval_mode: str
    router_result: RouterResult


class MemoryOrchestrator:
    """
    Unified retrieval orchestrator for OpenClaw Memory.

    Usage:
        orchestrator = MemoryOrchestrator()
        bundle = await orchestrator.query("Why was Maria upset at Monday's standup?")
        print(bundle.episodes[0].summary)
    """

    def __init__(self, db_path: Optional[str] = None):
        self.store = ConeGraphStore(db_path=db_path)
        self.propagator = GraphPropagator(self.store)
        self.assembler = BundleAssembler(self.store)
        # Try to load vector index from disk
        # Lazy load vector index on first query (avoids startup cost)
        self.vector_index = ConeVectorIndex(lazy=True)
        self._vector_index_loaded = False

    # ── Public API ─────────────────────────────────────────────────────────

    def query(
        self,
        text: str,
        mode: str = "episodic",
        top_k: int = 5,
        max_hops: int = 3,
        hybrid_weight: float = 0.3,
    ) -> MemoryBundle:
        """
        Query the memory system.

        Args:
            text: Natural language query
            mode: "episodic" (default) | "procedural" | "lexical" | "unified"
            top_k: Number of Episodes to return
            max_hops: Max graph propagation hops (episodic mode only)
            hybrid_weight: BM25 weight in hybrid TF-IDF+BM25 scoring (0.0-1.0).
                          0.0 = pure TF-IDF, 1.0 = pure BM25. Default 0.3.

        Returns:
            MemoryBundle with episodes, facets, facetpoints, entities, scores
        """
        # Lazy load vector index on first use
        if not self._vector_index_loaded:
            self._vector_index_loaded = self.vector_index.load()

        # Step 1: Route query to appropriate layer
        router_result = classify(text)

        if mode == "lexical":
            return self._query_lexical(text, router_result, top_k, hybrid_weight)

        if mode == "procedural":
            return self._query_procedural(text, router_result, top_k)

        if mode == "unified":
            # Try episodic first, then merge with lexical
            episodic_bundle = self._query_episodic(text, router_result, top_k, max_hops, hybrid_weight)
            lexical_bundle = self._query_lexical(text, router_result, top_k, hybrid_weight)
            return self._merge_bundles(episodic_bundle, lexical_bundle)

        # Default: episodic (Cone Graph Bundle Search)
        return self._query_episodic(text, router_result, top_k, max_hops, hybrid_weight)

    # ── Episodic (Cone Graph Bundle Search) ───────────────────────────────

    def _query_episodic(
        self,
        text: str,
        router_result: RouterResult,
        top_k: int,
        max_hops: int,
        hybrid_weight: float = 0.3,
    ) -> MemoryBundle:
        """
        M-flow's primary retrieval mode:
        1. Route to entry layer
        2. Find anchor candidates via keyword + vector search
        3. Propagate along evidence graph
        4. Score Episodes by strongest path
        5. Assemble and return bundle
        """
        layer = router_result.layer

        # Find anchor candidates at the appropriate layer
        anchor_ids = self._find_anchors(text, layer, limit=20, hybrid_weight=hybrid_weight)

        if not anchor_ids:
            # Fallback: try broader search
            anchor_ids = self._find_anchors(text, RetrievalLayer.EPISODE, limit=10, hybrid_weight=hybrid_weight)
            if not anchor_ids:
                return self._empty_bundle(router_result, "episodic")

        # Propagate from anchors to score all reachable Episodes
        episode_scores = self.propagator.propagate_to_episodes(
            anchor_ids, layer.value, max_hops=max_hops
        )

        if not episode_scores:
            # No propagation paths found — fallback to lexical
            return self._query_lexical(text, router_result, top_k)

        # Assemble bundle from scored Episodes
        bundle_dict = self.assembler.assemble(episode_scores, top_k=top_k)

        return MemoryBundle(
            episodes=bundle_dict["episodes"],
            facets=bundle_dict["facets"],
            facetpoints=bundle_dict["facetpoints"],
            entities=bundle_dict["entities"],
            scores=bundle_dict["scores"],
            retrieval_mode="episodic",
            router_result=router_result,
        )

    # ── Lexical (BM25 Fallback) ──────────────────────────────────────────

    def _query_lexical(
        self,
        text: str,
        router_result: RouterResult,
        top_k: int,
        hybrid_weight: float = 0.3,
    ) -> MemoryBundle:
        """Simple keyword search — fallback mode."""
        # Search FacetPoints for keyword matches
        fps = self.store.search_facetpoints(text, limit=top_k * 3)
        fps = fps[:top_k]

        # Also search Episodes
        eps = self.store.search_episodes(text, limit=top_k)
        eps = eps[:top_k]

        bundle = {
            "episodes": eps,
            "facets": [],
            "facetpoints": fps,
            "entities": [],
            "scores": {},
        }

        # Score by simple text match ratio
        text_lower = text.lower()
        for ep in eps:
            score = sum(1 for kw in router_result.keywords if kw in ep.summary.lower()) / max(len(router_result.keywords), 1)
            bundle["scores"][ep.id] = score

        return MemoryBundle(
            episodes=eps,
            facets=[],
            facetpoints=fps,
            entities=[],
            scores=bundle["scores"],
            retrieval_mode="lexical",
            router_result=router_result,
        )

    # ── Procedural (Abstract Patterns) ───────────────────────────────────

    def _query_procedural(
        self,
        text: str,
        router_result: RouterResult,
        top_k: int,
    ) -> MemoryBundle:
        """
        Procedural memory: extract reusable abstract patterns.
        Stores habits, workflows, decision rules, naming conventions.
        """
        # Procedural mode: look for Episodes tagged as "procedure" or "workflow"
        with self.store._init_db or self.store:
            pass  # placeholder for now
        # TODO: implement procedural extraction
        return self._empty_bundle(router_result, "procedural")

    # ── Anchor Finding ───────────────────────────────────────────────────

    def _find_anchors(
        self,
        text: str,
        layer: RetrievalLayer,
        limit: int = 20,
        hybrid_weight: float = 0.3,
    ) -> list[str]:
        """
        Find entry-point anchor IDs at the specified layer.
        Uses vector search (TF-IDF + FAISS) when index is available,
        falls back to keyword matching.
        """
        keywords = " ".join(classify(text).keywords)

        # ── Vector search (FAISS/TF-IDF) ──────────────────────────
        if self._vector_index_loaded:
            type_map = {
                RetrievalLayer.FACETPOINT: "facetpoint",
                RetrievalLayer.FACET: "facetpoint",  # facets searched via their FPs
                RetrievalLayer.EPISODE: "episode",
                RetrievalLayer.ENTITY: "entity",
                RetrievalLayer.UNKNOWN: "all",
            }
            search_type = type_map.get(layer, "all")
            vec_results = self.vector_index.search(text, node_type=search_type, top_k=limit, hybrid_weight=hybrid_weight)
            if vec_results:
                return [nid for _, nid, _ in vec_results]

        # ── Keyword search fallback ────────────────────────────────
        if layer == RetrievalLayer.FACETPOINT:
            fps = self.store.search_facetpoints(keywords, limit=limit)
            return [fp.id for fp in fps]

        if layer == RetrievalLayer.FACET:
            facets = self.store.search_facets(keywords, limit=limit)
            return [f.id for f in facets]

        if layer == RetrievalLayer.EPISODE:
            eps = self.store.search_episodes(keywords, limit=limit)
            return [ep.id for ep in eps]

        if layer == RetrievalLayer.ENTITY:
            entities = self.store.find_entities(name_pattern=keywords)
            return [e.id for e in entities[:limit]]

        # Default: search episodes
        eps = self.store.search_episodes(keywords, limit=limit)
        return [ep.id for ep in eps]

    # ── Bundle Merging ──────────────────────────────────────────────────

    def _merge_bundles(self, a: MemoryBundle, b: MemoryBundle) -> MemoryBundle:
        """Merge two bundles, preferring higher scores."""
        combined_scores: dict[str, float] = {}
        combined_eps: dict[str, Episode] = {}

        for ep in a.episodes:
            combined_eps[ep.id] = ep
            combined_scores[ep.id] = a.scores.get(ep.id, 0.0)

        for ep in b.episodes:
            if ep.id in combined_eps:
                combined_scores[ep.id] = max(combined_scores[ep.id], b.scores.get(ep.id, 0.0))
            else:
                combined_eps[ep.id] = ep
                combined_scores[ep.id] = b.scores.get(ep.id, 0.0)

        sorted_eps = sorted(combined_eps.values(), key=lambda e: combined_scores[e.id], reverse=True)[:5]

        return MemoryBundle(
            episodes=sorted_eps,
            facets=a.facets + b.facets,
            facetpoints=a.facetpoints + b.facetpoints,
            entities=a.entities + b.entities,
            scores=combined_scores,
            retrieval_mode="unified",
            router_result=a.router_result,
        )

    def _empty_bundle(self, router_result: RouterResult, mode: str) -> MemoryBundle:
        return MemoryBundle(
            episodes=[],
            facets=[],
            facetpoints=[],
            entities=[],
            scores={},
            retrieval_mode=mode,
            router_result=router_result,
        )

    # ── Write API (for memory ingestion) ────────────────────────────────

    def add_episode(
        self,
        summary: str,
        source_session: str = "",
        source_type: str = "conversation",
        facet_summaries: list[str] = None,
        entity_names: list[str] = None,
    ) -> Episode:
        """
        Add a new Episode with Facets and FacetPoints.

        Args:
            summary: Episode summary
            source_session: Session ID that produced this
            source_type: conversation / document / action / decision
            facet_summaries: List of Facet topic strings
            entity_names: List of entity names to link
        """
        # Create Episode
        ep = Episode(
            summary=summary,
            source_session=source_session,
            source_type=source_type,
        )

        # Resolve entity names to IDs
        entity_ids = []
        for name in (entity_names or []):
            ents = self.store.find_entities(name_pattern=name)
            if ents:
                entity_ids.append(ents[0].id)
            else:
                new_ent = self.store.add_entity(Entity(name=name, entity_type="concept"))
                entity_ids.append(new_ent.id)

        ep.entity_ids = entity_ids

        # Create Facets and their FacetPoints
        facet_ids = []
        for topic in (facet_summaries or []):
            facet = Facet(topic=topic, episode_id=ep.id)
            self.store.add_facet(facet)
            facet_ids.append(facet.id)

            # Create one FacetPoint per Facet (the summary content itself)
            fp_obj = FacetPoint(
                content=summary,
                facet_id=facet.id,
                source=source_session,
                entity_ids=entity_ids,
            )
            fp = self.store.add_facetpoint(fp_obj)

            # Create part_of edge: FacetPoint → Facet
            edge_fp = EvidenceEdge(
                source_id=fp.id,
                target_id=facet.id,
                source_type="facetpoint",
                target_type="facet",
                edge_type="part_of",
                edge_text=f"FacetPoint belongs to Facet '{topic}'",
                propagation_cost=0.3,
            )
            self.store.add_edge(edge_fp)

            # Create belongs_to edge: Facet → Episode
            edge = EvidenceEdge(
                source_id=facet.id,
                target_id=ep.id,
                source_type="facet",
                target_type="episode",
                edge_type="belongs_to",
                edge_text=f"Facet '{topic}' is part of Episode",
                propagation_cost=0.5,
            )
            self.store.add_edge(edge)

        ep.facet_ids = facet_ids
        self.store.add_episode(ep)

        # Add entity edges
        for ent_id in entity_ids:
            edge = EvidenceEdge(
                source_id=ent_id,
                target_id=ep.id,
                source_type="entity",
                target_type="episode",
                edge_type="mentions",
                edge_text=f"Entity mentioned in Episode",
                propagation_cost=1.0,
            )
            self.store.add_edge(edge)

        return ep


# ─── CLI ───────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="MemoryOrchestrator CLI")
    parser.add_argument("query", nargs="*", help="Query text")
    parser.add_argument("--mode", default="episodic", choices=["episodic", "lexical", "unified", "procedural"])
    parser.add_argument("--top-k", type=int, default=5)
    parser.add_argument("--stats", action="store_true", help="Show store statistics")
    args = parser.parse_args()

    orch = MemoryOrchestrator()

    if args.stats:
        s = orch.store.stats()
        print(f"Store stats: {s}")
        exit(0)

    if not args.query:
        print("No query provided. Use --stats to see store stats.")
        exit(0)

    query = " ".join(args.query)
    bundle = orch.query(query, mode=args.mode, top_k=args.top_k)

    print(f"Query: {query}")
    print(f"Mode: {bundle.retrieval_mode} | Layer: {bundle.router_result.layer.value} (conf={bundle.router_result.confidence:.2f})")
    print(f"Keywords: {bundle.router_result.keywords}")
    print(f"Episodes: {len(bundle.episodes)}")
    for ep in bundle.episodes:
        score = bundle.scores.get(ep.id, 0)
        print(f"  [{ep.id[:12]}] score={score:.4f} | {ep.summary[:80]}")
