import json
r = json.load(open('C:/Users/Administrator/.openclaw/workspace/memory/skill-audit.json'))
missing = [s for s in r['skills'] if s['triggerCount'] == 0]
print(f'Total missing: {len(missing)}')
for s in missing:
    print(f"  {s['id']}: score={s['qualityScore']}, issues={s['issues']}")
