"""
add_triggers.py — Add missing triggers to skills that have handlers.
Run: python add_triggers.py
"""
import re
from pathlib import Path

WORKSPACE = Path("C:/Users/Administrator/.openclaw/workspace/skills")

# Triggers to add for each skill
TRIGGERS = {
    "clawcore": [
        "design openclaw core system",
        "improve openclaw architecture",
        "implement permission context",
        "token budget management",
    ],
    "conversation-analyst": [
        "/conversation-analyst",
        "analyze my conversations",
        "conversation patterns",
        "usage analytics",
    ],
    "e2e-testing-patterns": [
        "write e2e tests",
        "playwright test",
        "cypress test",
        "end-to-end test",
    ],
    "fluid-memory": [
        "forget memories",
        "memory decay",
        "ebbinghaus forgetting curve",
        "fluid memory",
    ],
    "git-workflow": [
        "/git commit",
        "push to remote",
        "git workflow",
        "manage git repos",
    ],
    "git-workflow-cn": [
        "提交代码",
        "推送远程",
        "Git 工作流",
        "分支管理",
    ],
    "lobster-debugging": [
        "root cause analysis",
        "debugging framework",
        "4-phase debug",
        "defense in depth",
    ],
    "self-evolving-skill": [
        "evolve skill",
        "skill self-improvement",
        "meta-cognitive",
        "predictive coding",
    ],
    "skill-creator-operator": [
        "/create skill",
        "create a skill",
        "author a skill",
        "skill creator operator",
    ],
    "task-development-workflow": [
        "/task-workflow",
        "tdd workflow",
        "trello board",
        "development planning",
    ],
    "web-scraping": [
        "/scrape",
        "scrape website",
        "extract data from",
        "web scraping",
    ],
    "windows-gui-automation-cn": [
        "Windows GUI 自动化",
        "打开应用",
        "点击按钮",
        "PyAutoGUI",
    ],
    "ontology": [
        "remember",
        "what do you know about",
        "knowledge graph",
        "link entities",
        "ontological",
    ],
    "session-search": [
        "/session-search",
        "search my conversations",
        "find past sessions",
    ],
    "verify-memory": [
        "/verify-memory",
        "verify memory authenticity",
        "watermark check",
    ],
    "taskflow": [
        "/taskflow",
        "workflow state",
        "multi-step task",
    ],
    "taskflow-inbox-triage": [
        "triage inbox",
        "inbox routing",
        "message triage",
    ],
    "swarmvault": [
        "swarm coordination",
        "multi-agent coordination",
    ],
    "agent-teams": [
        "manage agent teams",
        "team coordination",
    ],
    "agent-handoff": [
        "agent handoff",
        "transfer between agents",
    ],
    "session-compactor": [
        "compact session",
        "session compaction",
        "reduce context",
    ],
    "session-manager": [
        "manage session",
        "session management",
    ],
    "skill-evolution": [
        "skill evolution",
        "evolve existing skill",
    ],
    "tools-to-final-output": [
        "final output",
        "tool to output pipeline",
    ],
    "agent-configurable-skill": [
        "configurable skill",
    ],
    "evolution-events": [
        "evolution events",
        "track agent evolution",
    ],
    "guardrail-config": [
        "guardrail configuration",
        "safety config",
    ],
    "lifecycle-tracing": [
        "lifecycle tracing",
        "trace lifecycle events",
    ],
    "obsidian-knowledge": [
        "obsidian knowledge",
        "vault knowledge",
    ],
    "proactive-memory": [
        "proactive memory",
        "anticipate memory needs",
    ],
    "sandbox-config": [
        "sandbox configuration",
        "security sandbox",
    ],
    "pref_61e6a00a": [
        "user preference markdown",
        "prefer markdown format",
    ],
}

def add_triggers(skill_id: str, triggers: list) -> bool:
    skill_dir = WORKSPACE / skill_id
    skill_md = skill_dir / "SKILL.md"
    
    if not skill_md.exists():
        return False
    
    content = skill_md.read_text(encoding='utf-8')
    
    # Check if triggers already exist
    if re.search(r'^triggers:', content, re.MULTILINE):
        return False
    
    # Add triggers after description
    trigger_lines = ["triggers:"]
    for t in triggers:
        trigger_lines.append(f"  - {t}")
    trigger_block = "\n" + "\n".join(trigger_lines)
    
    # Try to insert after description line
    new_content = re.sub(
        r'^description:\s*(.+?)(\n---|\n#[^\n]+\n)',
        r'\1\2' + trigger_block + r'\n',
        content,
        count=1,
        flags=re.MULTILINE | re.DOTALL
    )
    
    if new_content == content:
        # Try inserting after frontmatter ---
        new_content = re.sub(
            r'^---\n(.+?)\n---\n',
            r'---\n\1\n---\n' + trigger_block + r'\n',
            content,
            count=1,
            flags=re.DOTALL
        )
    
    if new_content != content:
        skill_md.write_text(new_content, encoding='utf-8')
        return True
    return False

def main():
    fixed = []
    skipped = []
    errors = []
    
    for skill_id, triggers in sorted(TRIGGERS.items()):
        try:
            if add_triggers(skill_id, triggers):
                print(f"  + {skill_id}")
                fixed.append(skill_id)
            else:
                skipped.append(skill_id)
        except Exception as e:
            print(f"  ! {skill_id}: {e}")
            errors.append((skill_id, str(e)))
    
    print(f"\nFixed: {len(fixed)} | Skipped: {len(skipped)} | Errors: {len(errors)}")
    
    if skipped:
        print(f"\nSkipped (already has triggers or not found): {skipped}")
    
    return fixed, skipped, errors

if __name__ == "__main__":
    main()
