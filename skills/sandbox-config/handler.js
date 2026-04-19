#!/usr/bin/env node
/**
 * sandbox-config handler
 * 
 * Manage OpenClaw security sandbox configuration.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function loadModule(path) {
  return import(path).then(m => m.default || m);
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log('Usage: /sandbox-config [--status|--report|--enable|--disable|--set|--add-domain|--remove-domain|--block-docker|--allow-docker|--validate]');
    process.exit(0);
  }
  
  // Parse flags
  const flags = {};
  const positional = [];
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      
      if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
        flags[key] = args[++i];
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(arg);
    }
  }
  
  const cmd = positional[0];
  const value = positional[1];
  
  // Import sandbox module
  let sandbox;
  try {
    sandbox = await loadModule('file://' + join(process.cwd(), 'modules', 'security_sandbox.mjs').replace(/\\/g, '/'));
  } catch (e) {
    console.log('Error: modules/security_sandbox.mjs not found');
    process.exit(1);
  }
  
  const configPath = join(homedir(), '.openclaw', 'config', 'sandbox.json');
  
  try {
    if (cmd === 'status' || flags.status) {
      const config = sandbox.loadSandboxConfig();
      
      console.log('\n=== Sandbox Status ===\n');
      console.log(`Enabled: ${config.enabled ? '🟢 ENABLED' : '🔴 DISABLED'}`);
      console.log(`Config: ${configPath}`);
      console.log('');
      console.log('Key Settings:');
      console.log(`  blockDocker: ${config.blockDocker}`);
      console.log(`  blockReverseShells: ${config.blockReverseShells}`);
      console.log(`  allowExternalNetwork: ${config.allowExternalNetwork}`);
      console.log(`  allowLocalBinding: ${config.allowLocalBinding}`);
      console.log(`  allowUnixSockets: ${config.allowUnixSockets}`);
      console.log(`  allowedDomains: ${config.allowedDomains?.join(', ') || 'all'}`);
      console.log(`  deniedDomains: ${config.deniedDomains?.length || 0} blocked`);
      console.log(`  deniedPaths: ${config.deniedPaths?.length || 0} protected`);
      
    } else if (cmd === 'report' || flags.report) {
      const config = sandbox.loadSandboxConfig();
      console.log('\n' + sandbox.generateSandboxReport(config));
      
    } else if (cmd === 'enable' || flags.enable) {
      let config = sandbox.loadSandboxConfig();
      config.enabled = true;
      sandbox.saveSandboxConfig(config);
      console.log('\n✅ Sandbox ENABLED\n');
      console.log('Run --report to see full security status.');
      
    } else if (cmd === 'disable' || flags.disable) {
      let config = sandbox.loadSandboxConfig();
      config.enabled = false;
      sandbox.saveSandboxConfig(config);
      console.log('\n⚠️  Sandbox DISABLED — NOT RECOMMENDED\n');
      console.log('All security restrictions are now bypassed.');
      
    } else if (cmd === 'set' || flags.set) {
      const key = value || flags.set;
      const val = positional[2] || flags.value;
      
      if (!key || val === undefined) {
        console.log('Usage: --set <key> <value>');
        console.log('Example: --set maxFileSize 104857600');
        process.exit(1);
      }
      
      let config = sandbox.loadSandboxConfig();
      
      // Parse value
      let parsedVal = val;
      if (val === 'true') parsedVal = true;
      else if (val === 'false') parsedVal = false;
      else if (/^\d+$/.test(val)) parsedVal = parseInt(val);
      
      // Handle nested keys (e.g., network.allowLocalBinding)
      const keys = key.split('.');
      let obj = config;
      for (let i = 0; i < keys.length - 1; i++) {
        if (obj[keys[i]] === undefined) obj[keys[i]] = {};
        obj = obj[keys[i]];
      }
      obj[keys[keys.length - 1]] = parsedVal;
      
      sandbox.saveSandboxConfig(config);
      console.log(`\n✅ Set ${key} = ${JSON.stringify(parsedVal)}\n`);
      
    } else if (cmd === 'add-domain' || flags.addDomain) {
      const domain = value || flags.addDomain;
      
      if (!domain) {
        console.log('Usage: --add-domain <domain>');
        console.log('Example: --add-domain *.github.com');
        process.exit(1);
      }
      
      let config = sandbox.loadSandboxConfig();
      if (!config.allowedDomains) config.allowedDomains = [];
      if (!config.allowedDomains.includes(domain)) {
        config.allowedDomains.push(domain);
        sandbox.saveSandboxConfig(config);
        console.log(`\n✅ Added to allowed domains: ${domain}\n`);
      } else {
        console.log(`\nℹ️  Domain already allowed: ${domain}\n`);
      }
      
    } else if (cmd === 'remove-domain' || flags.removeDomain) {
      const domain = value || flags.removeDomain;
      
      if (!domain) {
        console.log('Usage: --remove-domain <domain>');
        process.exit(1);
      }
      
      let config = sandbox.loadSandboxConfig();
      if (config.allowedDomains) {
        config.allowedDomains = config.allowedDomains.filter(d => d !== domain);
        sandbox.saveSandboxConfig(config);
        console.log(`\n✅ Removed from allowed domains: ${domain}\n`);
      }
      
    } else if (cmd === 'block-docker' || flags.blockDocker) {
      let config = sandbox.loadSandboxConfig();
      config.blockDocker = true;
      sandbox.saveSandboxConfig(config);
      console.log('\n✅ Docker operations BLOCKED\n');
      
    } else if (cmd === 'allow-docker' || flags.allowDocker) {
      let config = sandbox.loadSandboxConfig();
      config.blockDocker = false;
      sandbox.saveSandboxConfig(config);
      console.log('\n⚠️  Docker operations ALLOWED\n');
      
    } else if (cmd === 'block-reverse-shells' || flags.blockReverseShells) {
      let config = sandbox.loadSandboxConfig();
      config.blockReverseShells = true;
      sandbox.saveSandboxConfig(config);
      console.log('\n✅ Reverse shell patterns BLOCKED\n');
      
    } else if (cmd === 'validate' || flags.validate) {
      const config = sandbox.loadSandboxConfig();
      const result = sandbox.validateSandboxConfig(config);
      
      console.log('\n=== Sandbox Config Validation ===\n');
      console.log(`Valid: ${result.valid ? '✅ Yes' : '❌ No'}`);
      
      if (result.errors.length > 0) {
        console.log('\n❌ Errors:');
        for (const e of result.errors) console.log(`  - ${e}`);
      }
      
      if (result.warnings.length > 0) {
        console.log('\n⚠️  Warnings:');
        for (const w of result.warnings) console.log(`  - ${w}`);
      }
      
      if (result.valid && result.errors.length === 0) {
        console.log('\n✅ Configuration is valid and consistent.\n');
      }
      
    } else if (cmd === 'test-domain' || flags.testDomain) {
      const domain = value || flags.testDomain;
      const config = sandbox.loadSandboxConfig();
      const result = sandbox.isDomainAllowed(domain, config);
      console.log(`\nDomain "${domain}": ${result.allowed ? '✅ Allowed' : '❌ Blocked'}\n`);
      
    } else if (cmd === 'test-command' || flags.testCommand) {
      const command = positional.slice(1).join(' ') || flags.testCommand;
      if (!command) {
        console.log('Usage: --test-command "some command"');
        process.exit(1);
      }
      const config = sandbox.loadSandboxConfig();
      const result = sandbox.isCommandAllowed(command, config);
      console.log(`\nCommand: ${command}`);
      console.log(`Result: ${result.allowed ? '✅ Allowed' : '❌ Blocked'}`);
      console.log(`Reason: ${result.reason}`);
      if (result.pattern) console.log(`Pattern: ${result.pattern}`);
      console.log('');
      
    } else if (cmd === 'detect-reverse-shell' || flags.detectReverseShell) {
      const command = positional.slice(1).join(' ') || flags.detectReverseShell;
      if (!command) {
        console.log('Usage: --detect-reverse-shell "command to test"');
        process.exit(1);
      }
      const result = sandbox.detectReverseShell(command);
      console.log(`\nCommand: ${command}`);
      console.log(`Reverse Shell Detected: ${result.detected ? '❌ YES' : '✅ No'}`);
      if (result.pattern) console.log(`Pattern: ${result.pattern}`);
      console.log('');
      
    } else if (cmd === 'reset' || flags.reset) {
      sandbox.saveSandboxConfig(sandbox.DEFAULT_SANDBOX_CONFIG);
      console.log('\n✅ Sandbox config reset to DEFAULT (strict)\n');
      
    } else if (cmd === 'lenient' || flags.lenient) {
      sandbox.saveSandboxConfig(sandbox.LENIENT_SANDBOX_CONFIG);
      console.log('\n⚠️  Sandbox config set to LENIENT — most restrictions disabled\n');
      
    } else {
      console.log(`Unknown command: ${cmd}`);
      console.log('Use: --status, --report, --enable, --disable, --set, --add-domain, --block-docker, --validate');
    }
    
  } catch (e) {
    console.error('Error:', e.message);
    process.exit(1);
  }
}

main();
