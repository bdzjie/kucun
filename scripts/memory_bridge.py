#!/usr/bin/env python3
"""
memory_bridge.py — Python 记忆系统 JSON-RPC 接口
memory_hook.mjs 通过 subprocess 调用，获取结构化数据

用法:
  python memory_bridge.py <command> [args...]

命令:
  identity                   → 获取 L0 身份上下文（供注入）
  recall <wing> [room]       → 检索记忆（返回 JSON）
  remember <JSON>            → 存储新记忆（通过 stdin JSON）
  entities                   → 获取实体注册表
  detect_entities <text>     → 检测文本中的实体
  stats                      → 获取记忆统计
"""

import sys
import json
import os
from pathlib import Path

MEMORY_DIR = Path.home() / ".openclaw" / "memory"
WORKSPACE_DIR = Path.home() / ".openclaw" / "workspace"
sys.path.insert(0, str(WORKSPACE_DIR))

def read_json(fname, fallback=None):
    path = MEMORY_DIR / fname
    if not path.exists():
        return fallback
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except:
        return fallback

def write_json(fname, data):
    path = MEMORY_DIR / fname
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

# ─── Commands ────────────────────────────────────────────────

def cmd_identity():
    """返回 L0 身份字符串，供注入到 agent 上下文"""
    identity = read_json("identity.json", {})
    name = identity.get("name", "未知")
    role = identity.get("role", "AI助理")
    vibe = identity.get("vibe", "")
    lines = [
        f"[Identity] Name: {name} | Role: {role}",
    ]
    if vibe:
        lines.append(f"Vibe: {vibe}")
    return "\n".join(lines)

def cmd_recall(wing=None, room=None, limit=10):
    """检索记忆，返回 JSON 数组"""
    memories = read_json("memories.jsonl", [])
    if not isinstance(memories, list):
        memories = []

    results = []
    for m in memories:
        if m.get("superseded_by"):
            continue
        if wing and m.get("wing") != wing:
            continue
        if room and m.get("room") and m.get("room") != room:
            continue
        results.append({
            "id": m.get("id", ""),
            "content": m.get("content", ""),
            "hall": m.get("hall", "general"),
            "wing": m.get("wing", ""),
            "room": m.get("room", ""),
            "confidence": m.get("confidence", 0),
            "created_at": m.get("created_at", ""),
        })
    results.sort(key=lambda x: x.get("created_at", ""), reverse=True)
    return results[:limit]

def cmd_remember(content, wing="wing_user", room="general", hall=None):
    """存储新记忆，自动分类（复用 classifier）"""
    try:
        from memory.classifier import MemoryClassifier
        classifier = MemoryClassifier()
        classification = classifier.classify(content)
        hall = hall or classification.get("hall", "general")
        confidence = classification.get("confidence", 0.5)
    except Exception as e:
        hall = hall or "general"
        confidence = 0.5

    import uuid
    from datetime import datetime
    entry = {
        "id": f"mem_{uuid.uuid4().hex[:12]}",
        "wing": wing,
        "room": room,
        "hall": hall,
        "content": content,
        "confidence": confidence,
        "created_at": datetime.now().isoformat(),
        "valid_from": datetime.now().isoformat(),
    }

    memories = read_json("memories.jsonl", [])
    if not isinstance(memories, list):
        memories = []
    memories.append(entry)
    write_json("memories.jsonl", memories)
    return {"stored": True, "id": entry["id"], "hall": hall, "confidence": confidence}

def cmd_entities():
    """返回实体注册表"""
    return read_json("entity_registry.json", {"entities": {}})

def cmd_stats():
    """返回记忆统计"""
    memories = read_json("memories.jsonl", [])
    halls = {}
    for m in memories:
        h = m.get("hall", "unknown")
        halls[h] = halls.get(h, 0) + 1
    return {
        "total": len(memories) if isinstance(memories, list) else 0,
        "by_hall": halls,
    }

# ─── CLI Dispatch ────────────────────────────────────────────

def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else "help"
    args = sys.argv[2:]

    if cmd == "identity":
        print(cmd_identity())
    elif cmd == "recall":
        # args: [wing, room?] or [wing]
        # Use JSON stdin for complex data
        input_data = {}
        if len(args) > 0:
            input_data["wing"] = args[0]
        if len(args) > 1:
            input_data["room"] = args[1]
        if len(args) > 2:
            input_data["limit"] = int(args[2])
        result = cmd_recall(**input_data)
        print(json.dumps(result, ensure_ascii=False))
    elif cmd == "remember":
        # Read JSON from stdin: {"content": "...", "wing": "...", "room": "...", "hall": "..."}
        input_data = json.loads(sys.stdin.read())
        content = input_data.get("content", "")
        wing = input_data.get("wing", "wing_user")
        room = input_data.get("room", "general")
        hall = input_data.get("hall", None)
        result = cmd_remember(content, wing=wing, room=room, hall=hall)
        print(json.dumps(result, ensure_ascii=False))
    elif cmd == "entities":
        print(json.dumps(cmd_entities(), ensure_ascii=False))
    elif cmd == "stats":
        print(json.dumps(cmd_stats(), ensure_ascii=False))
    elif cmd == "help":
        print(__doc__)
    else:
        print(json.dumps({"error": f"unknown command: {cmd}"}), file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
