/**
 * swarmvault_bridge.mjs
 * 
 * Bridge to SwarmVault MCP server for OpenClaw.
 * Inspired by: SwarmVault (swarmclawai/swarmvault) MCP server
 * 
 * Provides tools:
 * - vault_scan: Scan a directory into a SwarmVault vault
 * - vault_query: Query the knowledge base
 * - vault_compile: Compile raw sources into wiki
 * - vault_graph: Get knowledge graph
 * - vault_lint: Run contradiction checks
 * - vault_export: Export to Obsidian format
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, execSync, spawnSync } from 'fs';
import { join, dirname, homedir } from 'path';
import { fileURLToPath } from 'url';

/**
 * @typedef {Object} VaultConfig
 * @property {string} vaultPath
 * @property {string} [schemaPath]
 * @property {string} [profile]
 */

/**
 * @typedef {Object} QueryResult
 * @property {string} answer
 * @property {string[]} sources
 * @property {Object} metadata
 */

const SWARM_DIR = join(homedir(), '.swarmvault');
const CONFIG_FILE = join(SWARM_DIR, 'config.json');

/**
 * Check if SwarmVault CLI is available
 */
export function isSwarmVaultAvailable() {
  try {
    const result = spawnSync('swarmvault', ['--version'], { 
      encoding: 'utf-8',
      timeout: 5000,
    });
    return result.status === 0;
  } catch (e) {
    return false;
  }
}

/**
 * Get SwarmVault version
 */
export function getVersion() {
  try {
    const result = spawnSync('swarmvault', ['--version'], {
      encoding: 'utf-8',
      timeout: 5000,
    });
    return result.stdout?.trim() || 'unknown';
  } catch (e) {
    return null;
  }
}

/**
 * Run swarmvault command
 */
function runSwarmVaultCommand(args, options = {}) {
  const cwd = options.cwd || process.cwd();
  
  try {
    const result = spawnSync('swarmvault', args, {
      encoding: 'utf-8',
      timeout: options.timeout || 60000,
      cwd,
      maxBuffer: 10 * 1024 * 1024, // 10MB
    });
    
    return {
      success: result.status === 0,
      stdout: result.stdout || '',
      stderr: result.stderr || '',
      status: result.status,
    };
  } catch (e) {
    return {
      success: false,
      error: e.message,
      stdout: '',
      stderr: '',
    };
  }
}

/**
 * SwarmVaultBridge class
 */
export class SwarmVaultBridge {
  constructor(vaultPath = null) {
    this.vaultPath = vaultPath || join(homedir(), 'swarm-vault');
    this.available = isSwarmVaultAvailable();
    this.version = this.available ? getVersion() : null;
  }
  
  /**
   * Initialize a new vault
   */
  init(options = {}) {
    if (!this.available) {
      return { success: false, error: 'SwarmVault CLI not installed. Run: npm install -g @swarmvaultai/cli' };
    }
    
    const args = ['init'];
    
    if (options.obsidian) args.push('--obsidian');
    if (options.profile) args.push('--profile', options.profile);
    if (options.lite) args.push('--lite');
    
    const result = runSwarmVaultCommand(args, { cwd: this.vaultPath });
    
    if (result.success) {
      mkdirSync(this.vaultPath, { recursive: true });
    }
    
    return result;
  }
  
  /**
   * Scan a directory into the vault
   */
  scan(sourcePath, options = {}) {
    if (!this.available) {
      return { success: false, error: 'SwarmVault CLI not installed' };
    }
    
    const args = ['scan', sourcePath];
    
    if (options.noServe) args.push('--no-serve');
    if (options.commit) args.push('--commit');
    
    return runSwarmVaultCommand(args, { cwd: this.vaultPath });
  }
  
  /**
   * Ingest a source
   */
  ingest(sourcePath, options = {}) {
    if (!this.available) {
      return { success: false, error: 'SwarmVault CLI not installed' };
    }
    
    const args = ['ingest', sourcePath];
    
    if (options.guide) args.push('--guide');
    if (options.commit) args.push('--commit');
    
    return runSwarmVaultCommand(args, { cwd: this.vaultPath });
  }
  
  /**
   * Compile raw sources into wiki
   */
  compile(options = {}) {
    if (!this.available) {
      return { success: false, error: 'SwarmVault CLI not installed' };
    }
    
    const args = ['compile'];
    
    if (options.approve) args.push('--approve');
    if (options.maxTokens) args.push('--max-tokens', options.maxTokens.toString());
    if (options.commit) args.push('--commit');
    
    return runSwarmVaultCommand(args, { cwd: this.vaultPath, timeout: 120000 });
  }
  
  /**
   * Query the knowledge base
   */
  query(question, options = {}) {
    if (!this.available) {
      return { success: false, error: 'SwarmVault CLI not installed' };
    }
    
    const args = ['query', `"${question}"`];
    
    if (options.commit) args.push('--commit');
    
    const result = runSwarmVaultCommand(args, { cwd: this.vaultPath, timeout: 60000 });
    
    return result;
  }
  
  /**
   * Lint for contradictions
   */
  lint(options = {}) {
    if (!this.available) {
      return { success: false, error: 'SwarmVault CLI not installed' };
    }
    
    const args = ['lint'];
    
    if (options.conflicts) args.push('--conflicts');
    if (options.deep) args.push('--deep');
    
    return runSwarmVaultCommand(args, { cwd: this.vaultPath, timeout: 60000 });
  }
  
  /**
   * Get graph data
   */
  graph(options = {}) {
    if (!this.available) {
      return { success: false, error: 'SwarmVault CLI not installed' };
    }
    
    const args = ['graph'];
    
    if (options.blast) args.push('blast', options.blast);
    if (options.serve) args.push('serve');
    if (options.export) args.push('export', '--html', options.export);
    if (options.obsidian) args.push('export', '--obsidian', options.obsidian);
    if (options.neo4j) args.push('push', 'neo4j');
    
    return runSwarmVaultCommand(args, { cwd: this.vaultPath, timeout: 60000 });
  }
  
  /**
   * Add a remote source
   */
  sourceAdd(url, options = {}) {
    if (!this.available) {
      return { success: false, error: 'SwarmVault CLI not installed' };
    }
    
    const args = ['source', 'add', url];
    
    if (options.guide) args.push('--guide');
    
    return runSwarmVaultCommand(args, { cwd: this.vaultPath });
  }
  
  /**
   * List sources
   */
  sourceList() {
    if (!this.available) {
      return { success: false, error: 'SwarmVault CLI not installed' };
    }
    
    return runSwarmVaultCommand(['source', 'list'], { cwd: this.vaultPath });
  }
  
  /**
   * Generate graph report
   */
  generateReport(outputPath = null) {
    if (!this.available) {
      return { success: false, error: 'SwarmVault CLI not installed' };
    }
    
    const args = ['graph', 'export', '--report'];
    
    if (outputPath) {
      args.push(outputPath);
    }
    
    return runSwarmVaultCommand(args, { cwd: this.vaultPath, timeout: 60000 });
  }
  
  /**
   * Get vault status
   */
  getStatus() {
    const stateFile = join(this.vaultPath, 'state', 'graph.json');
    
    return {
      available: this.available,
      version: this.version,
      vaultPath: this.vaultPath,
      vaultExists: existsSync(this.vaultPath),
      graphExists: existsSync(stateFile),
      configured: existsSync(CONFIG_FILE),
    };
  }
  
  /**
   * Get vault structure
   */
  getStructure() {
    const structure = {
      vault: this.vaultPath,
      exists: existsSync(this.vaultPath),
      folders: {},
    };
    
    if (!structure.exists) return structure;
    
    const requiredFolders = ['raw', 'wiki', 'state', 'agent'];
    
    for (const folder of requiredFolders) {
      const path = join(this.vaultPath, folder);
      structure.folders[folder] = {
        exists: existsSync(path),
        path,
      };
    }
    
    // Check schema
    const schemaPath = join(this.vaultPath, 'swarmvault.schema.md');
    structure.schema = {
      exists: existsSync(schemaPath),
      path: schemaPath,
    };
    
    return structure;
  }
  
  /**
   * Format status as markdown
   */
  formatStatus() {
    const status = this.getStatus();
    const structure = this.getStructure();
    
    const lines = [
      '# SwarmVault Status',
      '',
      `**SwarmVault CLI**: ${status.available ? `✅ Installed (${status.version})` : '❌ Not installed'}`,
      `**Vault Path**: ${status.vaultPath}`,
      `**Vault Exists**: ${status.vaultExists ? '✅ Yes' : '❌ No'}`,
      '',
    ];
    
    if (structure.exists) {
      lines.push('## Vault Structure');
      
      for (const [folder, info] of Object.entries(structure.folders)) {
        lines.push(`- **${folder}/**: ${info.exists ? '✅' : '❌'}`);
      }
      
      lines.push(`- **swarmvault.schema.md**: ${structure.schema.exists ? '✅' : '❌'}`);
    }
    
    if (!status.available) {
      lines.push('');
      lines.push('## Install SwarmVault');
      lines.push('```bash');
      lines.push('npm install -g @swarmvaultai/cli');
      lines.push('swarmvault --version');
      lines.push('```');
    }
    
    return lines.join('\n');
  }
}

export default SwarmVaultBridge;
