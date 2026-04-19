#!/usr/bin/env node
/**
 * handler.js — SwarmVault Bridge skill
 * 
 * Local-first knowledge compiler for OpenClaw.
 * Based on: SwarmVault (swarmclawai/swarmvault)
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname, homedir } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function loadModule(path) {
  return import(path).then(m => m);
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log('Usage: /swarmvault [--status|--init|--scan|--ingest|--compile|--query|--lint|--graph|--sources|--detect-conflicts]');
    process.exit(0);
  }
  
  // Parse flags
  const flags = {};
  const positional = [];
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--path') {
      flags.path = args[++i];
    } else if (args[i] === '--query') {
      flags.query = args[++i];
    } else if (args[i] === '--max-tokens') {
      flags.maxTokens = parseInt(args[++i]);
    } else if (args[i] === '--vault') {
      flags.vault = args[++i];
    } else if (args[i] === '--obsidian') {
      flags.obsidian = true;
    } else if (args[i] === '--lite') {
      flags.lite = true;
    } else if (args[i] === '--guide') {
      flags.guide = true;
    } else if (args[i] === '--approve') {
      flags.approve = true;
    } else if (args[i] === '--conflicts') {
      flags.conflicts = true;
    } else if (args[i] === '--deep') {
      flags.deep = true;
    } else if (args[i] === '--serve') {
      flags.serve = true;
    } else if (args[i] === '--report') {
      flags.report = true;
    } else if (args[i] === '--commit') {
      flags.commit = true;
    } else if (args[i] === '--no-serve') {
      flags.noServe = true;
    } else if (args[i].startsWith('--')) {
      flags[args[i].slice(2)] = true;
    } else {
      positional.push(args[i]);
    }
  }
  
  const cmd = positional[0];
  const target = positional[1];
  
  // Import modules
  let SwarmVaultBridge, ContradictionDetector;
  
  try {
    const bridgeModule = await loadModule('file://' + join(process.cwd(), 'modules', 'knowledge', 'swarmvault_bridge.mjs').replace(/\\/g, '/'));
    SwarmVaultBridge = bridgeModule.SwarmVaultBridge;
    
    const detectorModule = await loadModule('file://' + join(process.cwd(), 'modules', 'knowledge', 'contradiction_detector.mjs').replace(/\\/g, '/'));
    ContradictionDetector = detectorModule.ContradictionDetector;
  } catch (e) {
    // Fallback - just show SwarmVault status
    console.log('\n=== SwarmVault Bridge ===\n');
    console.log('Note: Running standalone mode (modules not in current directory).\n');
  }
  
  const vaultPath = flags.vault || join(homedir(), 'swarm-vault');
  
  try {
    if (cmd === 'status' || flags.status) {
      if (SwarmVaultBridge) {
        const bridge = new SwarmVaultBridge(vaultPath);
        console.log('\n' + bridge.formatStatus() + '\n');
      } else {
        console.log('\n=== SwarmVault Status ===\n');
        console.log('SwarmVault CLI: Checking...');
        console.log('Run: npm install -g @swarmvaultai/cli');
        console.log('Docs: https://www.swarmvault.ai');
      }
      
    } else if (cmd === 'init' || flags.init) {
      if (!SwarmVaultBridge) {
        console.log('SwarmVault bridge not available.');
        process.exit(1);
      }
      
      const bridge = new SwarmVaultBridge(vaultPath);
      const result = bridge.init({
        obsidian: flags.obsidian,
        lite: flags.lite,
      });
      
      console.log('\n=== SwarmVault Init ===\n');
      if (result.success) {
        console.log('✅ Vault initialized successfully.');
        console.log(`Vault path: ${vaultPath}`);
      } else {
        console.log('❌ Init failed:');
        console.log(result.stderr || result.error);
      }
      
    } else if (cmd === 'scan' || flags.scan) {
      if (!SwarmVaultBridge) {
        console.log('SwarmVault bridge not available.');
        process.exit(1);
      }
      
      const scanPath = target || flags.path || process.cwd();
      
      console.log(`\n=== Scanning ${scanPath} ===\n`);
      
      const bridge = new SwarmVaultBridge(vaultPath);
      const result = bridge.scan(scanPath, {
        noServe: flags.noServe,
        commit: flags.commit,
      });
      
      if (result.success) {
        console.log('✅ Scan complete.');
        console.log(result.stdout);
      } else {
        console.log('❌ Scan failed:');
        console.log(result.stderr || result.error);
      }
      
    } else if (cmd === 'ingest' || flags.ingest) {
      if (!SwarmVaultBridge) {
        console.log('SwarmVault bridge not available.');
        process.exit(1);
      }
      
      const ingestPath = target || flags.path;
      
      if (!ingestPath) {
        console.log('Usage: --ingest <path>');
        process.exit(1);
      }
      
      console.log(`\n=== Ingesting ${ingestPath} ===\n`);
      
      const bridge = new SwarmVaultBridge(vaultPath);
      const result = bridge.ingest(ingestPath, {
        guide: flags.guide,
        commit: flags.commit,
      });
      
      if (result.success) {
        console.log('✅ Ingest complete.');
        console.log(result.stdout);
      } else {
        console.log('❌ Ingest failed:');
        console.log(result.stderr || result.error);
      }
      
    } else if (cmd === 'compile' || flags.compile) {
      if (!SwarmVaultBridge) {
        console.log('SwarmVault bridge not available.');
        process.exit(1);
      }
      
      console.log('\n=== Compiling Wiki ===\n');
      
      const bridge = new SwarmVaultBridge(vaultPath);
      const result = bridge.compile({
        approve: flags.approve,
        maxTokens: flags.maxTokens,
        commit: flags.commit,
      });
      
      if (result.success) {
        console.log('✅ Compile complete.');
        console.log(result.stdout);
      } else {
        console.log('❌ Compile failed:');
        console.log(result.stderr || result.error);
      }
      
    } else if (cmd === 'query' || flags.query) {
      if (!SwarmVaultBridge) {
        console.log('SwarmVault bridge not available.');
        process.exit(1);
      }
      
      const question = flags.query || target;
      
      if (!question) {
        console.log('Usage: --query "<question>"');
        process.exit(1);
      }
      
      console.log(`\n=== Query ===\n`);
      console.log(`Q: ${question}\n`);
      
      const bridge = new SwarmVaultBridge(vaultPath);
      const result = bridge.query(question, { commit: flags.commit });
      
      if (result.success) {
        console.log('A:');
        console.log(result.stdout);
      } else {
        console.log('❌ Query failed:');
        console.log(result.stderr || result.error);
      }
      
    } else if (cmd === 'lint' || flags.lint) {
      if (!SwarmVaultBridge) {
        console.log('SwarmVault bridge not available.');
        process.exit(1);
      }
      
      console.log('\n=== Lint ===\n');
      
      const bridge = new SwarmVaultBridge(vaultPath);
      const result = bridge.lint({
        conflicts: flags.conflicts,
        deep: flags.deep,
      });
      
      if (result.success) {
        console.log(result.stdout || '✅ No issues found.');
      } else {
        console.log('⚠️ Lint results:');
        console.log(result.stdout);
        if (result.stderr) console.log(result.stderr);
      }
      
    } else if (cmd === 'graph' || flags.graph) {
      if (!SwarmVaultBridge) {
        console.log('SwarmVault bridge not available.');
        process.exit(1);
      }
      
      console.log('\n=== Knowledge Graph ===\n');
      
      const bridge = new SwarmVaultBridge(vaultPath);
      
      if (flags.serve) {
        const result = bridge.graph({ serve: true });
        if (result.success) {
          console.log('✅ Graph server started.');
          console.log(result.stdout);
        } else {
          console.log('❌ Failed:');
          console.log(result.stderr || result.error);
        }
      } else if (flags.report) {
        const result = bridge.generateReport();
        if (result.success) {
          console.log('✅ Report generated.');
          console.log(result.stdout);
        } else {
          console.log('❌ Failed:');
          console.log(result.stderr || result.error);
        }
      } else if (flags.obsidian) {
        const result = bridge.graph({ obsidian: flags.obsidian });
        if (result.success) {
          console.log('✅ Obsidian export complete.');
          console.log(result.stdout);
        } else {
          console.log('❌ Export failed:');
          console.log(result.stderr || result.error);
        }
      } else {
        // Just show graph status
        const structure = bridge.getStructure();
        console.log(`Vault: ${structure.vault}`);
        console.log(`Graph exists: ${structure.folders.state?.exists ? 'Yes' : 'No'}`);
        console.log('\nRun with --serve to start graph server, --report to generate report, or --obsidian <path> to export.');
      }
      
    } else if (cmd === 'sources' || flags.sources) {
      if (!SwarmVaultBridge) {
        console.log('SwarmVault bridge not available.');
        process.exit(1);
      }
      
      console.log('\n=== Sources ===\n');
      
      const bridge = new SwarmVaultBridge(vaultPath);
      const result = bridge.sourceList();
      
      if (result.success) {
        console.log(result.stdout || 'No sources configured.');
      } else {
        console.log('⚠️ Could not list sources:');
        console.log(result.stderr || result.error);
      }
      
    } else if (cmd === 'detect-conflicts' || flags.detectConflicts) {
      if (!ContradictionDetector) {
        console.log('Contradiction detector not available.');
        process.exit(1);
      }
      
      const detectPath = target || flags.path || vaultPath;
      
      console.log(`\n=== Contradiction Detection: ${detectPath} ===\n`);
      
      const detector = new ContradictionDetector();
      detector.scan(detectPath).detect();
      
      console.log(detector.formatReport());
      
      if (detector.conflicts.length > 0) {
        detector.saveConflicts();
        console.log(`\n💾 Conflicts saved.`);
      }
      
    } else {
      console.log(`Unknown command: ${cmd}`);
      console.log('Use: --status, --init, --scan, --ingest, --compile, --query, --lint, --graph, --sources, --detect-conflicts');
    }
    
  } catch (e) {
    console.error('Error:', e.message);
    process.exit(1);
  }
}

main();
