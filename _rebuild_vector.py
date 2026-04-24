"""_rebuild_vector.py — Rebuild FAISS/TF-IDF vector index for cone_vector"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))

from modules.memory.cone_graph import ConeGraphStore

# Load episodes from cone_graph.db
store = ConeGraphStore()
episodes = list(store.get_all_episodes())

ep_data = [
    {"id": ep.id, "summary": ep.summary, "type": "episode"}
    for ep in episodes
]

print(f"Building vector index for {len(ep_data)} episodes...")

from modules.memory.cone_vector import ConeVectorIndex
vectorizer = ConeVectorIndex()
vectorizer.fit(episodes=ep_data)

# Save
index_dir = Path(__file__).parent / "memory" / "cone_vector"
idx_path = index_dir / "cone_vector.npz"
vectorizer.save(str(idx_path))
print(f"Saved to {idx_path}")

# Verify query works
test_results = vectorizer.search("deadline", node_type="all", top_k=3)
print(f"Query 'deadline' -> {len(test_results)} results")
for ep_id, node_type, score in test_results[:3]:
    print(f"  {ep_id} ({node_type}): {score:.4f}")