#!/usr/bin/env node
/**
 * handler.js — Obsidian Knowledge Base skill
 * 
 * Bidirectional sync between OpenClaw memory and Obsidian vault.
 * Based on: SwarmVault (LLM Wiki) + agent-second-brain (Ebbinghaus)
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname, homedir } from 'path';
import { fileURLToPath } from 'url';

// ESM equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load modules
function loadModule(path) {
  return import(path).then(m => m);
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log('Usage: /obsidian-knowledge [--scan|--orphans|--daily|--export-memories|--generate-moc|--health|--stats] [--path <path>] [--tag <tag>] [--date <YYYY-MM-DD>] [--name <note>]');
    process.exit(0);
  }
  
  // Parse flags
  const flags = {};
  const positional = [];
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--path') {
      flags.path = args[++i];
    } else if (args[i] === '--tag') {
      flags.tag = args[++i];
    } else if (args[i] === '--date') {
      flags.date = args[++i];
    } else if (args[i] === '--name') {
      flags.name = args[++i];
    } else if (args[i] === '--depth') {
      flags.depth = parseInt(args[++i]) || 2;
    } else if (args[i].startsWith('--')) {
      flags[args[i].slice(2)] = true;
    } else {
      positional.push(args[i]);
    }
  }
  
  const cmd = positional[0];
  
  // Import modules
  let ObsidianSync, VaultHealth, KnowledgeGraph, EbbinghausMemory;
  
  try {
    const syncModule = await loadModule('file://' + join(process.cwd(), 'modules', 'knowledge', 'obsidian_sync.mjs').replace(/\\/g, '/'));
    ObsidianSync = syncModule.ObsidianSync;
    
    const healthModule = await loadModule('file://' + join(process.cwd(), 'modules', 'knowledge', 'vault_health.mjs').replace(/\\/g, '/'));
    VaultHealth = healthModule.VaultHealth;
    
    const graphModule = await loadModule('file://' + join(process.cwd(), 'modules', 'knowledge', 'knowledge_graph.mjs').replace(/\\/g, '/'));
    KnowledgeGraph = graphModule.KnowledgeGraph;
    
    const memoryModule = await loadModule('file://' + join(process.cwd(), 'modules', 'knowledge', 'ebbinghaus_memory.mjs').replace(/\\/g, '/'));
    EbbinghausMemory = memoryModule.EbbinghausMemory;
  } catch (e) {
    console.error('Failed to load modules:', e.message);
    
    // Fallback: provide helpful error message
    const modulePaths = [
      './modules/knowledge/obsidian_sync.mjs',
      './modules/knowledge/vault_health.mjs', 
      './modules/knowledge/knowledge_graph.mjs',
      './modules/knowledge/ebbinghaus_memory.mjs',
    ];
    
    console.log('\n=== Obsidian Knowledge Base ===\n');
    console.log('Status: Modules not found in current directory.');
    console.log('Expected modules location: modules/knowledge/*.mjs');
    console.log('\nAvailable commands:');
    console.log('  --scan              Scan vault');
    console.log('  --orphans            Show orphan notes');
    console.log('  --daily              Create daily note');
    console.log('  --health             Vault health check');
    console.log('  --stats              Show statistics');
    console.log('  --export-memories    Export memories');
    console.log('  --generate-moc       Generate MOC');
    console.log('  --index              Update index');
    process.exit(1);
  }
  
  // Execute command
  try {
    const vaultPath = flags.path || join(homedir(), 'Documents', 'Obsidian Vault');
    
    if (cmd === 'scan' || flags.scan) {
      console.log('\n=== Obsidian Vault Scan ===\n');
      
      if (!existsSync(vaultPath)) {
        console.log(`Vault not found at: ${vaultPath}`);
        console.log('Use --path to specify a different location.');
        process.exit(0);
      }
      
      const sync = new ObsidianSync(vaultPath);
      sync.scan();
      
      console.log(`Vault: ${vaultPath}`);
      console.log(sync.formatSummary());
      
    } else if (cmd === 'orphans' || flags.orphans) {
      console.log('\n=== Orphan Notes ===\n');
      
      const sync = new ObsidianSync(vaultPath);
      sync.scan();
      
      const orphans = sync.getOrphans();
      
      if (orphans.length === 0) {
        console.log('No orphan notes found. All notes have connections.');
      } else {
        console.log(`Found ${orphans.length} orphan note(s):\n`);
        for (const note of orphans) {
          console.log(`- [[${note.name}]]`);
          console.log(`  Path: ${note.relativePath}`);
          console.log(`  Links in: ${note.links.length} | Links out: ${note.backlinks.length}`);
          console.log('');
        }
      }
      
    } else if (cmd === 'daily' || flags.daily) {
      console.log('\n=== Daily Note ===\n');
      
      const sync = new ObsidianSync(vaultPath);
      const date = flags.date ? new Date(flags.date) : new Date();
      
      const notePath = sync.createDailyNote(date);
      console.log(`Created: ${notePath}`);
      
    } else if (cmd === 'health' || flags.health) {
      console.log('\n=== Vault Health Check ===\n');
      
      const health = new VaultHealth(vaultPath);
      health.scan();
      const report = health.generateReport();
      
      console.log(health.formatReport(report));
      
    } else if (cmd === 'stats' || flags.stats) {
      console.log('\n=== Vault Statistics ===\n');
      
      const sync = new ObsidianSync(vaultPath);
      sync.scan();
      const stats = sync.getStats();
      
      console.log(`Total Notes: ${stats.totalNotes}`);
      console.log(`Total Tags: ${stats.totalTags}`);
      console.log(`Orphan Notes: ${stats.orphanNotes}`);
      console.log(`Total Links: ${stats.totalLinks}`);
      console.log(`Total Backlinks: ${stats.totalBacklinks}`);
      
    } else if (cmd === 'export-memories' || flags.exportMemories) {
      console.log('\n=== Export Memories to Vault ===\n');
      
      // Load memories from Ebbinghaus system
      const mem = new EbbinghausMemory();
      const memories = mem.memories || [];
      
      if (memories.length === 0) {
        console.log('No memories found in OpenClaw memory system.');
        console.log('Add memories first, then run export.');
      } else {
        const sync = new ObsidianSync(vaultPath);
        const result = sync.exportMemoriesToVault(memories, vaultPath, { folder: 'OpenClaw/Memories' });
        
        console.log(`Exported ${result.notesExported} memories to ${vaultPath}/OpenClaw/Memories/`);
        
        if (result.errors.length > 0) {
          console.log('\nErrors:');
          for (const err of result.errors) {
            console.log(`  - ${err}`);
          }
        }
      }
      
    } else if (cmd === 'generate-moc' || flags.generateMoc) {
      console.log('\n=== Generate MOC ===\n');
      
      const sync = new ObsidianSync(vaultPath);
      sync.scan();
      
      if (flags.tag) {
        const mocPath = sync.generateTagMOC(flags.tag);
        console.log(`MOC generated: ${mocPath}`);
      } else {
        const indexPath = sync.updateIndex();
        console.log(`Index updated: ${indexPath}`);
      }
      
    } else if (cmd === 'index' || flags.index) {
      console.log('\n=== Update Vault Index ===\n');
      
      const sync = new ObsidianSync(vaultPath);
      sync.scan();
      
      const indexPath = sync.updateIndex();
      console.log(`Index updated: ${indexPath}`);
      
    } else if (cmd === 'links' || flags.links) {
      const noteName = flags.name || positional[1];
      
      if (!noteName) {
        console.log('Usage: --links <note-name>');
        process.exit(1);
      }
      
      console.log(`\n=== Links for [[${noteName}]] ===\n`);
      
      const sync = new ObsidianSync(vaultPath);
      sync.scan();
      
      const note = sync.findNote(noteName);
      
      if (!note) {
        console.log(`Note not found: ${noteName}`);
        process.exit(1);
      }
      
      console.log(`**Outgoing Links** (${note.links.length}):`);
      if (note.links.length === 0) {
        console.log('  (none)');
      } else {
        for (const link of note.links) {
          console.log(`  - [[${link.target}${link.alias !== link.target ? '|' + link.alias : ''}]]`);
        }
      }
      
      console.log(`\n**Incoming Links (Backlinks)** (${note.backlinks.length}):`);
      if (note.backlinks.length === 0) {
        console.log('  (none)');
      } else {
        for (const bl of note.backlinks) {
          console.log(`  - [[${bl}]]`);
        }
      }
      
    } else if (cmd === 'graph' || flags.graph) {
      const noteName = flags.name || positional[1];
      
      if (!noteName) {
        console.log('Usage: --graph [--name <note>] [--depth N]');
        process.exit(1);
      }
      
      console.log(`\n=== Knowledge Graph: ${noteName} ===\n`);
      
      const sync = new ObsidianSync(vaultPath);
      sync.scan();
      
      const note = sync.findNote(noteName);
      if (!note) {
        console.log(`Note not found: ${noteName}`);
        process.exit(1);
      }
      
      const kg = new KnowledgeGraph();
      const depth = flags.depth || 2;
      
      // Find connected notes
      const noteId = note.name.toLowerCase().replace(/\s+/g, '-');
      const connected = kg.findConnected({ 
        nodes: sync.notes.map(n => ({ id: n.name.toLowerCase(), name: n.name, type: 'note' })),
        edges: sync.notes.flatMap(n => n.links.map(l => ({ from: n.name.toLowerCase(), to: l.target.toLowerCase(), type: 'links' })))
      }, noteId, { maxDepth: depth });
      
      console.log(`Connected nodes (depth ${depth}):\n`);
      for (const node of connected.slice(0, 20)) {
        const indent = '  '.repeat(node.depth);
        console.log(`${indent}- ${node.name} [${node.type}]`);
      }
      
    } else {
      console.log(`Unknown command: ${cmd}`);
      console.log('Use --scan, --orphans, --daily, --health, --stats, --export-memories, --generate-moc');
    }
    
  } catch (e) {
    console.error('Error:', e.message);
    
    if (e.code === 'ENOENT') {
      console.log('\nVault not found. Use --path to specify vault location.');
    } else {
      console.error(e.stack);
    }
    
    process.exit(1);
  }
}

main();
