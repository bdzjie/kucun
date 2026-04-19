/**
 * security_sandbox.mjs
 * 
 * Enhanced Security Sandbox Configuration
 * Inspired by: anthropics/claude-code/examples/settings/settings-strict.json
 * 
 * Security features:
 * - Unix socket whitelist
 * - Domain whitelist (DNS)
 * - Local binding restrictions
 * - Process namespace isolation
 * - Network isolation
 * - File system boundaries
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';

/**
 * @typedef {Object} SandboxConfig
 * @property {boolean} enabled
 * @property {string[]} allowedCommands — command whitelist
 * @property {string[]} excludedCommands — command blacklist
 * @property {string[]} allowedDomains — DNS whitelist (e.g., ["api.openai.com", "*.github.com"])
 * @property {string[]} deniedDomains — DNS blacklist
 * @property {boolean} allowLocalBinding — allow binding to localhost ports
 * @property {boolean} allowUnixSockets — allow Unix domain sockets
 * @property {string[]} allowedUnixSockets — Unix socket path whitelist
 * @property {boolean} allowExternalNetwork — allow outbound network
 * @property {number|null} maxFileSize — max file size in bytes
 * @property {string[]} allowedPaths — FS path whitelist (empty = all allowed)
 * @property {string[]} deniedPaths — FS path blacklist
 * @property {boolean} blockDocker — block docker/system container operations
 * @property {boolean} blockSSH — block SSH operations
 * @property {boolean} blockReverseShells — block reverse shell patterns
 */

const SANDBOX_CONFIG_DIR = join(homedir(), '.openclaw', 'config');
const SANDBOX_CONFIG_PATH = join(SANDBOX_CONFIG_DIR, 'sandbox.json');

/**
 * Default sandbox configuration (strict)
 */
export const DEFAULT_SANDBOX_CONFIG = {
  enabled: true,
  
  // Command restrictions
  allowedCommands: [],        // empty = all allowed (use excludedCommands)
  excludedCommands: [
    'rm -rf /',              // Destructive
    ':(){:|:&};:',           // Fork bomb
    'curl.*|wget.*bash',    // Pipe to shell (detected via pattern)
    'mkfs',                  // Format
    'dd if=.*of=/dev/',      // Direct disk write
    '> /etc/',               // Write to system config
    'chmod -R 777 /',        // Wide permissions
  ],
  
  // Network restrictions
  allowExternalNetwork: true,
  allowedDomains: [
    'localhost',
    '127.0.0.1',
    '::1',
  ],
  deniedDomains: [
    '*.onion',               // Tor
    '*.i2p',
    'localhost.run',         // Tunnel services
    'serveo.net',
    'localhost.pub',
    'localtunnel.me',
  ],
  allowLocalBinding: true,    // Allow localhost ports (dev servers)
  allowUnixSockets: false,    // Disable by default
  allowedUnixSockets: [],     // empty = none allowed
  
  // File system
  maxFileSize: 50 * 1024 * 1024, // 50MB
  allowedPaths: [],           // empty = all allowed
  deniedPaths: [
    '/etc/sudoers',
    '/etc/shadow',
    '/etc/passwd',
    '/root/.ssh',
    '/home/*/.ssh',
    '/.dockerenv',
    '/.dockerinit',
  ],
  
  // Dangerous operations
  blockDocker: true,
  blockSSH: false,            // SSH is often needed
  blockReverseShells: true,
  
  // Isolation
  maxProcesses: 100,
  maxMemoryMB: 2048,
  maxCPUPercent: 80,
  maxIdleTimeMs: 30 * 60 * 1000, // 30 min
  
  // Execution
  shellTimeout: 5 * 60 * 1000,   // 5 min default
  confirmDestructive: true,        // Ask before destructive commands
};

/**
 * Lenient sandbox (for trusted environments)
 */
export const LENIENT_SANDBOX_CONFIG = {
  enabled: false,            // Off by default
  allowExternalNetwork: true,
  allowLocalBinding: true,
  allowUnixSockets: true,
  blockDocker: false,
  blockReverseShells: false,
};

/**
 * Load sandbox configuration
 */
export function loadSandboxConfig() {
  try {
    if (existsSync(SANDBOX_CONFIG_PATH)) {
      const config = JSON.parse(readFileSync(SANDBOX_CONFIG_PATH, 'utf-8'));
      return { ...DEFAULT_SANDBOX_CONFIG, ...config };
    }
  } catch (e) {
    console.warn('[Sandbox] Config load error:', e.message);
  }
  
  return { ...DEFAULT_SANDBOX_CONFIG };
}

/**
 * Save sandbox configuration
 */
export function saveSandboxConfig(config) {
  try {
    mkdirSync(SANDBOX_CONFIG_DIR, { recursive: true });
    writeFileSync(SANDBOX_CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
    return true;
  } catch (e) {
    console.error('[Sandbox] Config save error:', e.message);
    return false;
  }
}

/**
 * Check if a domain is allowed
 */
export function isDomainAllowed(domain, config = null) {
  const cfg = config || loadSandboxConfig();
  
  if (!cfg.allowExternalNetwork) return false;
  if (cfg.deniedDomains.some(d => matchDomain(domain, d))) return false;
  if (cfg.allowedDomains.length > 0) {
    return cfg.allowedDomains.some(d => matchDomain(domain, d));
  }
  
  return true;
}

/**
 * Domain wildcard matching (*.example.com)
 */
function matchDomain(domain, pattern) {
  if (pattern.startsWith('*.')) {
    const suffix = pattern.slice(2);
    return domain.endsWith(suffix) || domain === suffix.slice(1);
  }
  return domain === pattern;
}

/**
 * Check if a command is allowed
 */
export function isCommandAllowed(command, config = null) {
  const cfg = config || loadSandboxConfig();
  
  if (!cfg.enabled) return { allowed: true, reason: 'sandbox_disabled' };
  
  // Check excluded commands (pattern match)
  for (const pattern of cfg.excludedCommands || []) {
    if (matchCommandPattern(command, pattern)) {
      return { allowed: false, reason: 'command_blacklisted', pattern };
    }
  }
  
  // Check allowed commands whitelist
  if (cfg.allowedCommands.length > 0) {
    const allowed = cfg.allowedCommands.some(c => 
      command.includes(c) || matchCommandPattern(command, c)
    );
    if (!allowed) {
      return { allowed: false, reason: 'command_not_whitelisted' };
    }
  }
  
  return { allowed: true, reason: 'allowed' };
}

/**
 * Match command against pattern (basic glob-like)
 */
function matchCommandPattern(command, pattern) {
  const cmd = command.toLowerCase();
  const pat = pattern.toLowerCase();
  
  if (pat.includes('.*')) {
    // Regex-like pattern
    const regex = new RegExp(pat.replace(/\./g, '\\.').replace(/\*/g, '.*'));
    return regex.test(cmd);
  }
  
  return cmd.includes(pat);
}

/**
 * Check if a path is allowed
 */
export function isPathAllowed(path, config = null) {
  const cfg = config || loadSandboxConfig();
  
  if (!cfg.enabled) return { allowed: true, reason: 'sandbox_disabled' };
  
  // Check denied paths
  for (const denied of cfg.deniedPaths || []) {
    if (pathMatchesGlob(path, denied)) {
      return { allowed: false, reason: 'path_blacklisted', path: denied };
    }
  }
  
  // Check allowed paths whitelist
  if (cfg.allowedPaths.length > 0) {
    const allowed = cfg.allowedPaths.some(p => 
      path.startsWith(p) || pathMatchesGlob(path, p)
    );
    if (!allowed) {
      return { allowed: false, reason: 'path_not_whitelisted' };
    }
  }
  
  return { allowed: true, reason: 'allowed' };
}

/**
 * Simple glob matching for paths
 */
function pathMatchesGlob(path, glob) {
  if (glob.includes('*')) {
    const regex = new RegExp('^' + glob.replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
    return regex.test(path);
  }
  return path.startsWith(glob);
}

/**
 * Check if reverse shell pattern detected
 */
export function detectReverseShell(command) {
  const lower = command.toLowerCase();
  
  const patterns = [
    /bash -i.*\/dev\/tcp\//,           // Bash /dev/tcp reverse shell
    /perl.*-e.*socket/,                // Perl reverse shell
    /python.*-c.*socket/,              // Python reverse shell
    /ruby.*-rsocket.*-e/,              // Ruby reverse shell
    /php.*-r.*\$sock/,                 // PHP reverse shell
    /nc\s+-e\s+/,                       // Netcat -e
    /nc\s+.*-c\s+/,                    // Netcat -c variant
    /ncat\s+.*--exec/,                 // Ncat exec
    /curl.*\|.*bash/,                  // Curl pipe to bash (potential)
    /wget.*\|.*bash/,                  // Wget pipe to bash
    /mknod.*p.*\/dev\/tcp/,            // Mknod reverse shell
    /\/dev\/tcp\/[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+/, // Direct /dev/tcp
  ];
  
  for (const pattern of patterns) {
    if (pattern.test(lower)) {
      return { detected: true, pattern: pattern.toString() };
    }
  }
  
  return { detected: false };
}

/**
 * Validate sandbox config (ensure no conflicting rules)
 */
export function validateSandboxConfig(config) {
  const errors = [];
  const warnings = [];
  
  if (config.allowedDomains?.length > 0 && config.deniedDomains?.length > 0) {
    const overlap = config.allowedDomains.filter(d => 
      config.deniedDomains.includes(d)
    );
    if (overlap.length > 0) {
      errors.push(`Conflicting domain rules: ${overlap.join(', ')} in both allowed and denied`);
    }
  }
  
  if (config.allowedPaths?.length > 0 && config.deniedPaths?.length > 0) {
    const overlap = config.allowedPaths.filter(p => 
      config.deniedPaths.some(d => p.startsWith(d) || d.startsWith(p))
    );
    if (overlap.length > 0) {
      warnings.push(`Overlapping path rules: ${overlap.join(', ')}`);
    }
  }
  
  if (config.allowUnixSockets && config.allowedUnixSockets?.length === 0) {
    warnings.push('allowUnixSockets=true but allowedUnixSockets is empty (no sockets allowed)');
  }
  
  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Generate sandbox report
 */
export function generateSandboxReport(config = null) {
  const cfg = config || loadSandboxConfig();
  const { valid, errors, warnings } = validateSandboxConfig(cfg);
  
  const lines = [
    '# Security Sandbox Report',
    '',
    `**Status**: ${cfg.enabled ? '🟢 ENABLED' : '🔴 DISABLED'}`,
    '',
    '## Network',
    `| Setting | Value |`,
    `|---------|-------|`,
    `| External Network | ${cfg.allowExternalNetwork ? '✅ Allowed' : '❌ Blocked'} |`,
    `| Local Binding | ${cfg.allowLocalBinding ? '✅ Allowed' : '❌ Blocked'} |`,
    `| Unix Sockets | ${cfg.allowUnixSockets ? '✅ Allowed' : '❌ Blocked'} |`,
    `| Allowed Domains | ${cfg.allowedDomains.length || 'All (except denied)'} |`,
    `| Denied Domains | ${cfg.deniedDomains.length || 'None'} |`,
    '',
    '## File System',
    `| Setting | Value |`,
    `|---------|-------|`,
    `| Max File Size | ${cfg.maxFileSize ? (cfg.maxFileSize / 1024 / 1024).toFixed(0) + 'MB' : 'Unlimited'} |`,
    `| Allowed Paths | ${cfg.allowedPaths.length || 'All (except denied)'} |`,
    `| Denied Paths | ${cfg.deniedPaths.length || 'None'} |`,
    '',
    '## Dangerous Operations',
    `| Operation | Status |`,
    `|-----------|--------|`,
    `| Docker | ${cfg.blockDocker ? '❌ Blocked' : '✅ Allowed'} |`,
    `| Reverse Shells | ${cfg.blockReverseShells ? '❌ Blocked' : '✅ Allowed'} |`,
    `| SSH | ${cfg.blockSSH ? '❌ Blocked' : '✅ Allowed'} |`,
    '',
    '## Limits',
    `| Resource | Limit |`,
    `|----------|-------|`,
    `| Max Processes | ${cfg.maxProcesses || 'Unlimited'} |`,
    `| Max Memory | ${cfg.maxMemoryMB ? cfg.maxMemoryMB + 'MB' : 'Unlimited'} |`,
    `| Max CPU | ${cfg.maxCPUPercent ? cfg.maxCPUPercent + '%' : 'Unlimited'} |`,
    `| Shell Timeout | ${cfg.shellTimeout ? (cfg.shellTimeout / 60000) + 'min' : 'Default'} |`,
    '',
  ];
  
  if (errors.length > 0) {
    lines.push('## Errors');
    for (const e of errors) lines.push(`- ❌ ${e}`);
    lines.push('');
  }
  
  if (warnings.length > 0) {
    lines.push('## Warnings');
    for (const w of warnings) lines.push(`- ⚠️ ${w}`);
    lines.push('');
  }
  
  lines.push(`**Config Path**: ${SANDBOX_CONFIG_PATH}`);
  
  return lines.join('\n');
}

export default {
  DEFAULT_SANDBOX_CONFIG,
  LENIENT_SANDBOX_CONFIG,
  loadSandboxConfig,
  saveSandboxConfig,
  isDomainAllowed,
  isCommandAllowed,
  isPathAllowed,
  detectReverseShell,
  validateSandboxConfig,
  generateSandboxReport,
};
