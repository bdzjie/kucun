"""Query skills by keyword"""
import sys
sys.path.insert(0, 'modules')
from skill_indexer import query_skills

query = sys.argv[1] if len(sys.argv) > 1 else "browser"
results = query_skills(query)

print(f"Skills matching '{query}':\n")
for score, s in results[:10]:
    triggers = ", ".join(s['triggers'][:3]) if s['triggers'] else "no triggers"
    print(f"  [{score}] {s['id']}")
    print(f"       {s['description'][:80]}")
    print(f"       triggers: {triggers}")
    print()
