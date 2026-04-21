---
name: obsidian-knowledge
description: "Bidirectional sync between OpenClaw memory and Obsidian vault."
triggers:
  - /obsidian-knowledge
  - obsidian sync
  - vault scan
---

# Obsidian Knowledge Base

**Command**: `/obsidian-knowledge`
**Category**: knowledge-management
**Emoji**: 🧠
**Description**: Bidirectional sync between OpenClaw memory and Obsidian vault. Based on SwarmVault (Karpathy LLM Wiki) + agent-second-brain (Ebbinghaus memory) patterns.

## Commands

### `/obsidian-knowledge --scan`
Scan the Obsidian vault and display a summary.

### `/obsidian-knowledge --scan --path <path>`
Scan a specific vault path.

### `/obsidian-knowledge --orphans`
Show orphan notes (no links in or out).

### `/obsidian-knowledge --links <note-name>`
Show all links (in + out) for a specific note.

### `/obsidian-knowledge --daily [--date YYYY-MM-DD]`
Create today's daily note (or specified date).

### `/obsidian-knowledge --export-memories`
Export OpenClaw memories to the vault as notes.

### `/obsidian-knowledge --generate-moc [--tag <tag>]`
Generate a Map of Content (MOC) for a tag or the whole vault.

### `/obsidian-knowledge --index`
Update the vault index (Index.md).

### `/obsidian-knowledge --health`
Run vault health check (orphans, broken links, missing descriptions).

### `/obsidian-knowledge --graph [--depth N]`
Show knowledge graph connectivity for a note.

### `/obsidian-knowledge --stats`
Display vault statistics.

## Usage Examples

```
/obsidian-knowledge --scan
/obsidian-knowledge --orphans
/obsidian-knowledge --daily
/obsidian-knowledge --export-memories
/obsidian-knowledge --health
```

## Technical Details

**Modules**:
- `modules/knowledge/obsidian_sync.mjs` — Vault reading/writing, note CRUD
- `modules/knowledge/vault_health.mjs` — Health scoring, orphan detection
- `modules/knowledge/knowledge_graph.mjs` — Graph traversal, hub finding
- `modules/knowledge/ebbinghaus_memory.mjs` — 5-tier memory with decay

**Vault Path**: `~/Documents/Obsidian Vault` (default)
**State File**: `~/.openclaw/memory/obsidian_sync_state.json`
