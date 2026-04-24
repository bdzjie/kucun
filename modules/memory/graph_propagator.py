"""
graph_propagator.py — Graph Propagation for Evidence Path Scoring

Core algorithm (M-flow inspired):
  1. Anchor: query lands at matching-granularity node
  2. Propagate: spread evidence along typed edges, accumulating cost
  3. Score: each Episode scored by its strongest (minimum cost) evidence path

Key insight: relevance = strongest path, not highest similarity score.
"""

from dataclasses import dataclass
from typing import Optional
from modules.memory.cone_graph import ConeGraphStore, Episode, EvidenceEdge, FacetPoint, Facet


@dataclass
class PathResult:
    """Result of a single propagation path."""
    episode_id: str
    path_cost: float
    path: list[str]  # list of edge_ids
    hops: int


@dataclass
class PropagationResult:
    """Result of full graph propagation from an anchor."""
    episode_scores: dict[str, float]  # episode_id → score (lower = stronger)
    episode_paths: dict[str, list[str]]  # episode_id → strongest path (edge_ids)
    anchor_id: str
    anchor_type: str
    total_propagated: int  # number of episodes reached


class GraphPropagator:
    """
    Graph propagation scorer.

    Algorithm:
      - BFS from anchor node through evidence edges
      - Each hop adds edge.propagation_cost to path cost
      - Episode score = min(path_cost) across all paths reaching it
      - Strongest path = path with minimum cost
    """

    def __init__(self, store: ConeGraphStore):
        self.store = store

    def propagate(
        self,
        anchor_id: str,
        anchor_type: str,
        max_hops: int = 3,
        edge_type_filter: Optional[list[str]] = None,
    ) -> PropagationResult:
        """
        Propagate from an anchor node and score all reachable Episodes.

        Args:
            anchor_id: Starting node ID (any node type)
            anchor_type: Type hint ("entity" / "facetpoint" / "facet" / "episode")
            max_hops: Maximum propagation depth
            edge_type_filter: Only follow these edge types (None = all)

        Returns:
            PropagationResult with episode_scores, episode_paths, anchor info
        """
        episode_scores: dict[str, float] = {}
        episode_paths: dict[str, list[str]] = {}

        # BFS state: (node_id, accumulated_cost, path_edge_ids)
        queue: list[tuple[str, float, list[str], int]] = [(anchor_id, 0.0, [], 0)]
        visited: dict[str, float] = {anchor_id: 0.0}

        while queue:
            current_id, current_cost, current_path, depth = queue.pop(0)

            if depth >= max_hops:
                continue

            # Get outgoing edges from current node
            edges = self.store.get_outgoing_edges(current_id)

            for edge in edges:
                # Filter by edge type if specified
                if edge_type_filter and edge.edge_type not in edge_type_filter:
                    continue

                new_cost = current_cost + edge.propagation_cost
                new_path = current_path + [edge.id]
                new_depth = depth + 1

                # Skip if we've found a cheaper path to this node
                if edge.target_id in visited and visited[edge.target_id] <= new_cost:
                    continue
                visited[edge.target_id] = new_cost

                # Check if target is an Episode → score it
                target_ep = self.store.get_episode(edge.target_id)
                if target_ep:
                    if target_ep.id not in episode_scores or new_cost < episode_scores[target_ep.id]:
                        episode_scores[target_ep.id] = new_cost
                        episode_paths[target_ep.id] = new_path

                # Continue BFS from target
                queue.append((edge.target_id, new_cost, new_path, new_depth))

        # Also check if the anchor itself is an Episode
        anchor_ep = self.store.get_episode(anchor_id)
        if anchor_ep:
            if anchor_ep.id not in episode_scores or 0.0 < episode_scores[anchor_ep.id]:
                episode_scores[anchor_ep.id] = 0.0
                episode_paths[anchor_ep.id] = []

        # Normalize scores to 0-1 range (lower cost = higher score)
        if episode_scores:
            min_cost = min(episode_scores.values())
            max_cost = max(episode_scores.values())
            range_cost = max_cost - min_cost if max_cost != min_cost else 1.0
            episode_scores = {
                ep_id: 1.0 - (cost - min_cost) / range_cost
                for ep_id, cost in episode_scores.items()
            }
            # Update store with computed scores
            for ep_id, score in episode_scores.items():
                path = episode_paths[ep_id]
                actual_cost = episode_scores.get(ep_id, 999)
                self.store.update_episode_score(ep_id, score, actual_cost, path)

        return PropagationResult(
            episode_scores=episode_scores,
            episode_paths=episode_paths,
            anchor_id=anchor_id,
            anchor_type=anchor_type,
            total_propagated=len(episode_scores),
        )

    def propagate_to_episodes(
        self,
        anchor_ids: list[str],
        anchor_type: str,
        max_hops: int = 3,
    ) -> dict[str, float]:
        """
        Propagate from multiple anchors and aggregate Episode scores.

        Aggregation: for each Episode, take the minimum (strongest) score
        across all anchors that can reach it.
        """
        combined_scores: dict[str, float] = {}
        combined_paths: dict[str, list[str]] = {}

        for anchor_id in anchor_ids:
            result = self.propagate(anchor_id, anchor_type, max_hops=max_hops)
            for ep_id, score in result.episode_scores.items():
                if ep_id not in combined_scores or score > combined_scores[ep_id]:
                    combined_scores[ep_id] = score
                    combined_paths[ep_id] = result.episode_paths[ep_id]

        return combined_scores


# ─── Bundle Assembler ────────────────────────────────────────────────────────

class BundleAssembler:
    """
    Assembles a MemoryBundle from scored Episodes.

    A Bundle contains:
      - Top-scored Episodes
      - Their Facets and FacetPoints
      - Linked Entities
      - Evidence paths
    """

    def __init__(self, store: ConeGraphStore):
        self.store = store

    def assemble(
        self,
        episode_scores: dict[str, float],
        top_k: int = 5,
    ) -> dict:
        """
        Assemble a MemoryBundle from scored Episode IDs.

        Returns:
            {
                "episodes": [...],
                "facets": [...],
                "facetpoints": [...],
                "entities": [...],
                "scores": {ep_id: score}
            }
        """
        # Sort by score descending
        sorted_eps = sorted(episode_scores.items(), key=lambda x: x[1], reverse=True)[:top_k]

        bundle = {
            "episodes": [],
            "facets": [],
            "facetpoints": [],
            "entities": [],
            "scores": {},
        }

        all_entity_ids = set()

        for ep_id, score in sorted_eps:
            ep = self.store.get_episode(ep_id)
            if not ep:
                continue

            ep.score = score
            bundle["episodes"].append(ep)
            bundle["scores"][ep_id] = score
            all_entity_ids.update(ep.entity_ids)

            # Get facets for this episode
            facets = self.store.get_facets_by_episode(ep_id)
            for facet in facets:
                bundle["facets"].append(facet)

                # Get facetpoints for this facet
                fps = self.store.get_facetpoints_by_facet(facet.id)
                bundle["facetpoints"].extend(fps)
                for fp in fps:
                    all_entity_ids.update(fp.entity_ids)

        # Deduplicate entities
        for ent_id in all_entity_ids:
            ent = self.store.get_entity(ent_id)
            if ent:
                bundle["entities"].append(ent)

        return bundle


# ─── CLI ───────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import argparse
    from modules.memory.cone_graph import ConeGraphStore

    parser = argparse.ArgumentParser(description="Graph Propagation CLI")
    parser.add_argument("--anchor-id", required=True, help="Anchor node ID")
    parser.add_argument("--anchor-type", default="facetpoint", help="Anchor type")
    parser.add_argument("--max-hops", type=int, default=3, help="Max propagation hops")
    args = parser.parse_args()

    store = ConeGraphStore()
    propagator = GraphPropagator(store)

    result = propagator.propagate(args.anchor_id, args.anchor_type, max_hops=args.max_hops)

    print(f"Anchor: {result.anchor_id} ({result.anchor_type})")
    print(f"Episodes reached: {result.total_propagated}")
    print("Top episodes by score:")
    for ep_id, score in sorted(result.episode_scores.items(), key=lambda x: x[1], reverse=True)[:10]:
        print(f"  [{ep_id}] score={score:.4f} path={result.episode_paths[ep_id]}")
