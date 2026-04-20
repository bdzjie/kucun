import yaml, re, json
content = open('C:/Users/Administrator/.openclaw/workspace/skills/clawcore/SKILL.md', encoding='utf-8').read()
m = re.match(r'^---\n(.*?)\n---', content, re.DOTALL)
if m:
    fm = yaml.safe_load(m.group(1))
    desc = fm.get('description', '')
    print('Type:', type(desc))
    print('Value:', desc[:100] if desc else '')
    print('All keys:', list(fm.keys()))
