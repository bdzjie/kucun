"""
ontology_task_update.py — Auto-update task status in the knowledge graph.
Run after completing a task: python ontology_task_update.py done <task_id>
"""
import sys
import json
from pathlib import Path

GRAPH_PATH = Path("C:/Users/Administrator/.openclaw/workspace/memory/ontology/graph.jsonl")

def mark_done(task_id: str, outcome: str = "success") -> dict:
    """Mark a task as done in the ontology graph."""
    if not GRAPH_PATH.exists():
        return {"error": "Graph not found"}
    
    # Read existing graph
    entries = []
    with GRAPH_PATH.open(encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                entries.append(json.loads(line))
            except:
                continue
    
    # Find task and check if already done
    task_found = False
    for entry in entries:
        entity = entry.get("entity", {})
        if entity.get("id") == task_id and entity.get("type") == "Task":
            task_found = True
            current_status = entity.get("properties", {}).get("status")
            if current_status in ("done", "completed", "cancelled"):
                return {"ok": True, "skipped": True, "reason": f"Already {current_status}"}
            break
    
    if not task_found:
        return {"error": f"Task {task_id} not found"}
    
    # Append status update as new entry
    update_entry = {
        "op": "update",
        "entity": {
            "id": task_id,
            "type": "Task",
            "properties": {
                "status": "completed" if outcome == "success" else outcome,
                "completed_at": "2026-04-21T06:57:00Z"
            }
        }
    }
    
    with GRAPH_PATH.open('a', encoding='utf-8') as f:
        f.write(json.dumps(update_entry, ensure_ascii=False) + "\n")
    
    return {"ok": True, "task_id": task_id, "status": "completed"}

def mark_blocked(task_id: str, blocked_by: str) -> dict:
    """Mark a task as blocked by another task."""
    # Add blocks relation
    rel_entry = {
        "op": "relate",
        "from": task_id,
        "rel": "blocked_by",
        "to": blocked_by
    }
    with GRAPH_PATH.open('a', encoding='utf-8') as f:
        f.write(json.dumps(rel_entry, ensure_ascii=False) + "\n")
    
    return {"ok": True, "task_id": task_id, "blocked_by": blocked_by}

def mark_in_progress(task_id: str) -> dict:
    """Mark a task as in progress."""
    update_entry = {
        "op": "update",
        "entity": {
            "id": task_id,
            "type": "Task",
            "properties": {
                "status": "in_progress",
                "started_at": "2026-04-21T06:57:00Z"
            }
        }
    }
    with GRAPH_PATH.open('a', encoding='utf-8') as f:
        f.write(json.dumps(update_entry, ensure_ascii=False) + "\n")
    
    return {"ok": True, "task_id": task_id, "status": "in_progress"}

def add_project(name: str, project_id: str = None, status: str = "active") -> dict:
    """Add a new project to the graph."""
    if project_id is None:
        project_id = "proj_" + name.lower().replace(" ", "-")
    
    entry = {
        "op": "create",
        "entity": {
            "id": project_id,
            "type": "Project",
            "properties": {
                "name": name,
                "status": status,
                "created_at": "2026-04-21T06:57:00Z"
            }
        }
    }
    with GRAPH_PATH.open('a', encoding='utf-8') as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    
    return {"ok": True, "project_id": project_id, "name": name}

def add_task(title: str, task_id: str = None, project: str = None, status: str = "open") -> dict:
    """Add a new task to the graph."""
    if task_id is None:
        task_id = "task_" + title.lower().replace(" ", "-").replace("/", "-")
    
    entry = {
        "op": "create",
        "entity": {
            "id": task_id,
            "type": "Task",
            "properties": {
                "title": title,
                "status": status,
                "project": project,
                "created_at": "2026-04-21T06:57:00Z"
            }
        }
    }
    with GRAPH_PATH.open('a', encoding='utf-8') as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    
    return {"ok": True, "task_id": task_id, "title": title}

def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else "status"
    
    if cmd == "done":
        task_id = sys.argv[2] if len(sys.argv) > 2 else ""
        outcome = sys.argv[3] if len(sys.argv) > 3 else "success"
        if not task_id:
            print("Usage: ontology_task_update.py done <task_id> [outcome]")
            sys.exit(1)
        result = mark_done(task_id, outcome)
        print(json.dumps(result, indent=2, ensure_ascii=False))
    
    elif cmd == "blocked":
        task_id = sys.argv[2] if len(sys.argv) > 2 else ""
        blocked_by = sys.argv[3] if len(sys.argv) > 3 else ""
        if not task_id or not blocked_by:
            print("Usage: ontology_task_update.py blocked <task_id> <blocked_by_task_id>")
            sys.exit(1)
        result = mark_blocked(task_id, blocked_by)
        print(json.dumps(result, indent=2, ensure_ascii=False))
    
    elif cmd == "in-progress":
        task_id = sys.argv[2] if len(sys.argv) > 2 else ""
        if not task_id:
            print("Usage: ontology_task_update.py in-progress <task_id>")
            sys.exit(1)
        result = mark_in_progress(task_id)
        print(json.dumps(result, indent=2, ensure_ascii=False))
    
    elif cmd == "add-project":
        name = sys.argv[2] if len(sys.argv) > 2 else ""
        if not name:
            print("Usage: ontology_task_update.py add-project <name>")
            sys.exit(1)
        result = add_project(name)
        print(json.dumps(result, indent=2, ensure_ascii=False))
    
    elif cmd == "add-task":
        title = sys.argv[2] if len(sys.argv) > 2 else ""
        if not title:
            print("Usage: ontology_task_update.py add-task <title>")
            sys.exit(1)
        result = add_task(title)
        print(json.dumps(result, indent=2, ensure_ascii=False))
    
    else:
        print(f"Commands: done | blocked | in-progress | add-project | add-task")
        print(f"Usage examples:")
        print(f"  python ontology_task_update.py done task_apply-skills")
        print(f"  python ontology_task_update.py add-task 'New Feature' --project proj_openclaw-skills")

if __name__ == "__main__":
    main()
