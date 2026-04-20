"""
ontology.py — Query and update the knowledge graph from agent workflows.
"""
import os
import json
import re
from pathlib import Path
from datetime import datetime

GRAPH_PATH = Path(os.path.expanduser("C:/Users/Administrator/.openclaw/workspace/memory/ontology/graph.jsonl"))
SCHEMA_PATH = Path(os.path.expanduser("C:/Users/Administrator/.openclaw/workspace/memory/ontology/schema.yaml"))

# In-memory cache
_cache = None
_cache_time = 0
_CACHE_TTL = 60  # 60 seconds

def _load_graph():
    """Load graph from JSONL, return list of (op, entity) tuples."""
    global _cache, _cache_time
    
    now = datetime.now().timestamp()
    if _cache is not None and (now - _cache_time) < _CACHE_TTL:
        return _cache
    
    if not GRAPH_PATH.exists():
        _cache = []
        _cache_time = now
        return _cache
    
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
    
    _cache = entries
    _cache_time = now
    return entries

def _save_entry(op: str, entity: dict):
    """Append a JSONL entry to the graph."""
    GRAPH_PATH.parent.mkdir(parents=True, exist_ok=True)
    with GRAPH_PATH.open('a', encoding='utf-8') as f:
        f.write(json.dumps({"op": op, "entity": entity}, ensure_ascii=False) + "\n")
    global _cache, _cache_time
    _cache = None  # Invalidate cache

def query(filters: dict = None, limit: int = 50) -> list:
    """
    Query the graph.
    
    Args:
        filters: {type: 'Project', status: 'active', id: 'xxx'}
        limit: max results
    
    Returns:
        List of matching entities
    """
    entries = _load_graph()
    results = []
    
    # Separate entities and relations
    for entry in entries:
        op = entry.get("op")
        
        if op == "relate":
            # Only return relations if explicitly querying relations
            if filters and filters.get("_relation"):
                from_id = entry.get("from")
                rel = entry.get("rel")
                to_id = entry.get("to")
                match = True
                if filters.get("rel") and filters["rel"] != rel:
                    match = False
                if filters.get("from") and filters["from"] != from_id:
                    match = False
                if filters.get("to") and filters["to"] != to_id:
                    match = False
                if match:
                    results.append({
                        "type": "Relation",
                        "rel": rel,
                        "from": from_id,
                        "to": to_id,
                    })
            continue
        
        if op != "create":
            continue
        
        entity = entry.get("entity", {})
        if not entity:
            continue
        
        props = entity.get("properties", {})
        entity_type = entity.get("type", "")
        
        # Apply filters
        match = True
        if filters:
            if filters.get("type") and filters["type"] != entity_type:
                match = False
            if filters.get("id") and entity.get("id") != filters["id"]:
                match = False
            if filters.get("status") and props.get("status") != filters["status"]:
                match = False
            if filters.get("project") and props.get("project") != filters["project"]:
                match = False
            if filters.get("priority") and props.get("priority") != filters["priority"]:
                match = False
        
        if match:
            results.append({
                "id": entity.get("id"),
                "type": entity_type,
                "properties": props,
            })
        
        if len(results) >= limit:
            break
    
    return results

def query_text(q: str) -> list:
    """
    Full-text search across entity properties.
    
    Args:
        q: Search query
    
    Returns:
        List of (score, entity) tuples, sorted by relevance
    """
    entries = _load_graph()
    q_lower = q.lower()
    results = []
    
    for entry in entries:
        if entry.get("op") != "create":
            continue
        
        entity = entry.get("entity", {})
        if not entity:
            continue
        props = entity.get("properties", {})
        
        # Score by keyword match
        score = 0
        searchable = json.dumps(props, ensure_ascii=False).lower()
        if q_lower in searchable:
            score = searchable.count(q_lower)
        
        if score > 0:
            results.append((score, {
                "id": entity.get("id"),
                "type": entity.get("type"),
                "properties": props
            }))
    
    return sorted(results, reverse=True, key=lambda x: x[0])[:20]

def create_entity(id: str, entity_type: str, properties: dict):
    """Create a new entity."""
    entity = {
        "id": id,
        "type": entity_type,
        "properties": properties
    }
    _save_entry("create", entity)
    return entity

def update_entity(id: str, properties: dict):
    """Update an existing entity (appends new version)."""
    # For simplicity, we create a new entry with updated props
    # In production, you'd track versions
    create_entity(id, "", properties)

def add_relation(from_id: str, rel: str, to_id: str):
    """Add a relation between two entities."""
    _save_entry("relate", {
        "from": from_id,
        "rel": rel,
        "to": to_id
    })

def get_status() -> dict:
    """Get overall project/task status summary."""
    projects = query({"type": "Project"})
    tasks = query({"type": "Task"})
    
    project_status = {}
    for p in projects:
        props = p.get("properties", {})
        project_status[props.get("name", p.get("id", "?"))] = props.get("status", "unknown")
    
    task_status = {}
    for t in tasks:
        props = t.get("properties", {})
        task_status[props.get("title", t.get("id", "?"))] = props.get("status", "unknown")
    
    return {
        "projects": project_status,
        "tasks": task_status,
        "summary": {
            "total_projects": len(projects),
            "active_projects": sum(1 for p in projects if p["properties"].get("status") == "active"),
            "total_tasks": len(tasks),
            "in_progress_tasks": sum(1 for t in tasks if t["properties"].get("status") == "in_progress"),
            "completed_tasks": sum(1 for t in tasks if t["properties"].get("status") == "completed"),
        }
    }

if __name__ == "__main__":
    import sys
    
    cmd = sys.argv[1] if len(sys.argv) > 1 else "status"
    
    if cmd == "status":
        status = get_status()
        print(f"\n=== Ontology Status ===")
        print(f"Projects: {status['summary']['total_projects']} total, {status['summary']['active_projects']} active")
        print(f"Tasks: {status['summary']['total_tasks']} total, {status['summary']['in_progress_tasks']} in progress, {status['summary']['completed_tasks']} done")
        print(f"\nActive Projects:")
        for name, st in status['projects'].items():
            print(f"  [{st}] {name}")
        print(f"\nTasks:")
        for title, st in status['tasks'].items():
            print(f"  [{st}] {title}")
    
    elif cmd == "query":
        q = sys.argv[2] if len(sys.argv) > 2 else ""
        if not q:
            print("Usage: ontology.py query <text>")
            sys.exit(1)
        results = query_text(q)
        print(f"\n=== Results for '{q}' ===")
        for score, entity in results:
            print(f"  [{score}] {entity['type']}: {entity['properties']}")
    
    elif cmd == "find":
        filters = {}
        if len(sys.argv) > 2:
            for arg in sys.argv[2:]:
                if '=' in arg:
                    k, v = arg.split('=', 1)
                    filters[k] = v
        results = query(filters)
        print(f"\n=== Query: {filters} ===")
        for r in results:
            print(f"  {r['type']}: {r.get('id', '?')} — {r.get('properties', {})}")
    
    elif cmd == "create":
        # create <type> <id> <json_props>
        if len(sys.argv) < 5:
            print("Usage: ontology.py create <type> <id> <json_props>")
            sys.exit(1)
        entity_type = sys.argv[2]
        entity_id = sys.argv[3]
        props = json.loads(sys.argv[4])
        create_entity(entity_id, entity_type, props)
        print(f"Created: {entity_type}::{entity_id}")
    
    else:
        print(f"Commands: status | query <text> | find [key=val...] | create <type> <id> <json>")
