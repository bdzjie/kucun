"""_rebuild_data.py — Rebuild cone_graph.db with correct edge direction

Edge direction: FacetPoint → Episode (so BFS from fp_001 reaches ep_001)
The graph propagator starts at anchor (FacetPoint) and follows outgoing edges.
So edges must go FROM FacetPoint TO Episode (fp_001 is the SOURCE, ep_001 is the TARGET).
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))

from modules.memory.cone_graph import (
    ConeGraphStore, Episode, Facet, FacetPoint, Entity, EvidenceEdge
)

DB_PATH = Path(__file__).parent / "memory" / "cone_graph.db"
if DB_PATH.exists():
    DB_PATH.unlink()

store = ConeGraphStore()

# ── Entities ───────────────────────────────────────────────
entities_data = [
    ("ent_maria", "Maria", "person"),
    ("ent_sarah", "Sarah", "person"),
    ("ent_design_review", "design review", "event"),
    ("ent_launch", "launch", "event"),
    ("ent_api", "API integration", "project"),
]
for eid, name, etype in entities_data:
    store.add_entity(Entity(id=eid, name=name, entity_type=etype))

# ── Episodes ───────────────────────────────────────────────
episodes_data = [
    ("ep_001", "sess_001", "user: Hey, can you remind me about the Q1 product launch deadline?\nassistant: The Q1 product launch is scheduled for March 15th, 2024."),
    ("ep_002", "sess_002", "user: What did Maria say in the last standup about the deadline?\nassistant: Maria said she was not told about the deadline change."),
    ("ep_003", "sess_003", "user: Let's schedule the design review for next Tuesday.\nassistant: I've scheduled the design review for February 20th."),
    ("ep_004", "sess_004", "user: The client sent over their feedback on the proposal.\nassistant: Great, I've received the client feedback and will review it today."),
    ("ep_005", "sess_005", "user: Can you summarize the key points from the all-hands meeting?\nassistant: The main points were: 1) Q1 targets on track, 2) New hire starting March 1st."),
    ("ep_006", "sess_006", "user: The new engineer starts today. Her name is Sarah.\nassistant: Welcome Sarah! I've added her to the team channel."),
    ("ep_007", "sess_007", "user: We need to push the launch date back by two weeks.\nassistant: I've updated the launch date to March 29th in the project tracker."),
    ("ep_008", "sess_008", "user: The marketing team sent the final assets for review.\nassistant: Got them. I'll review the marketing assets this afternoon."),
    ("ep_009", "sess_009", "user: What's the status on the API integration work?\nassistant: The API integration is complete. We passed all QA tests yesterday."),
    ("ep_010", "sess_010", "user: The launch is tomorrow! Are we ready?\nassistant: Yes, all systems are go. The final checklist is complete."),
]
for ep_id, sess_id, summary in episodes_data:
    store.add_episode(Episode(id=ep_id, summary=summary, source_session=sess_id, source_type="conversation"))

# ── Facets ─────────────────────────────────────────────────
facets_data = [
    ("fac_001", "Project Deadlines", "All discussion around project deadlines and schedule changes"),
    ("fac_002", "Team Communication", "Meetings, standups, and team updates"),
    ("fac_003", "Launch Planning", "Product launch preparation and status checks"),
    ("fac_004", "Design Review", "Design review scheduling and feedback"),
]
for fac_id, topic, summary in facets_data:
    store.add_facet(Facet(id=fac_id, topic=topic, summary=summary))

# ── FacetPoints ─────────────────────────────────────────────
fp_data = [
    ("fp_001", "fac_001", "deadline"),
    ("fp_002", "fac_001", "launch date"),
    ("fp_003", "fac_002", "Maria"),
    ("fp_004", "fac_003", "launch"),
    ("fp_005", "fac_002", "standup"),
    ("fp_006", "fac_004", "design review"),
    ("fp_007", "fac_003", "QA tests"),
    ("fp_008", "fac_002", "team"),
    ("fp_009", "fac_003", "marketing assets"),
    ("fp_010", "fac_002", "client feedback"),
]
for fp_id, fac_id, content in fp_data:
    store.add_facetpoint(FacetPoint(id=fp_id, facet_id=fac_id, content=content))

# ── Evidence Edges — CORRECT DIRECTION: FacetPoint → Episode ──
# The graph propagator BFS starts at FacetPoint (anchor) and follows outgoing edges.
# So fp_001 must be the SOURCE, ep_001 must be the TARGET.
# Then BFS from fp_001 → ep_001 is valid.
edges_data = [
    # FacetPoint (source) → Episode (target)
    ("fp_001", "ep_001", "keyword"),  # "deadline" → ep_001 (launch deadline)
    ("fp_004", "ep_001", "keyword"),  # "launch" → ep_001
    ("fp_003", "ep_002", "entity"),   # "Maria" → ep_002 (Maria's standup comment)
    ("fp_005", "ep_002", "keyword"),  # "standup" → ep_002
    ("fp_001", "ep_002", "keyword"),  # "deadline" → ep_002
    ("fp_006", "ep_003", "keyword"),  # "design review" → ep_003
    ("fp_002", "ep_007", "keyword"),  # "launch date" → ep_007 (launch date change)
    ("fp_004", "ep_007", "keyword"),  # "launch" → ep_007
    ("fp_007", "ep_009", "keyword"),  # "QA tests" → ep_009 (API integration QA)
    ("fp_004", "ep_010", "keyword"),  # "launch" → ep_010 (launch tomorrow)
    # Entity → Episode (entity as anchor)
    ("ent_maria", "ep_002", "entity"),
    ("ent_sarah", "ep_006", "entity"),
    ("ent_design_review", "ep_003", "entity"),
    ("ent_launch", "ep_001", "entity"),
    ("ent_launch", "ep_007", "entity"),
    ("ent_launch", "ep_010", "entity"),
    ("ent_api", "ep_009", "entity"),
]
for src, tgt, edge_type in edges_data:
    store.add_edge(EvidenceEdge(id=f"edge_{src}_{tgt}", source_id=src, target_id=tgt, edge_type=edge_type))

print(f"DB rebuilt: {DB_PATH}")
stats = store.stats()
for k, v in stats.items():
    print(f"  {k}: {v}")