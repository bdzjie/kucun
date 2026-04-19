# SwarmVault Bridge

**Command**: `/swarmvault`
**Category**: knowledge-management
**Emoji**: 🧩
**Description**: Local-first knowledge compiler. Based on SwarmVault (Karpathy LLM Wiki pattern). Provides graph-based knowledge management, contradiction detection, and hybrid search.

## Commands

### `/swarmvault --status`
Check SwarmVault CLI availability and vault status.

### `/swarmvault --init [--obsidian] [--lite]`
Initialize a new SwarmVault vault.

### `/swarmvault --scan <path>`
Scan a directory into the vault.

### `/swarmvault --ingest <path> [--guide]`
Ingest a source into the vault.

### `/swarmvault --compile [--approve] [--max-tokens N]`
Compile raw sources into wiki.

### `/swarmvault --query "<question>"`
Query the knowledge base.

### `/swarmvault --lint [--conflicts]`
Run lint checks (contradiction detection).

### `/swarmvault --graph [--serve] [--report] [--obsidian <path>]`
Get knowledge graph.

### `/swarmvault --sources`
List all sources.

### `/swarmvault --detect-conflicts <path>`
Run local contradiction detection on a directory.

## Usage Examples

```
/swarmvault --status
/swarmvault --init --obsidian
/swarmvault --scan ./my-research
/swarmvault --query "What are the main findings?"
/swarmvault --lint --conflicts
/swarmvault --detect-conflicts ./notes
```

## Technical Details

**Requires**: SwarmVault CLI (`npm install -g @swarmvaultai/cli`)

**Modules**:
- `modules/knowledge/swarmvault_bridge.mjs` — SwarmVault CLI bridge
- `modules/knowledge/contradiction_detector.mjs` — Local contradiction detection

**Vault Structure**:
```
vault/
├── raw/                  — Immutable source files
├── wiki/                 — Compiled knowledge wiki
├── state/                — Graph, search index, embeddings
├── agent/                — Agent-facing helpers
└── swarmvault.schema.md  — Vault conventions
```
