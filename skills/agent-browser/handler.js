/**
 * agent-browser skill handler
 * Browser automation via agent-browser CLI (Vercel Labs, Rust)
 */

const { execSync, spawn } = require('child_process');
const path = require('path');

const args = process.argv.slice(2);
const command = args[0];

const BROWSER = 'agent-browser';

function exec(command, options = {}) {
  try {
    const result = execSync(`${BROWSER} ${command}`, {
      encoding: 'utf8',
      timeout: 30000,
      maxBuffer: 10 * 1024 * 1024,
      ...options,
    });
    return { success: true, output: result.trim() };
  } catch (e) {
    return { success: false, error: e.stderr?.trim() || e.message, code: e.status };
  }
}

function showHelp() {
  return {
    handled: true,
    skill: 'agent-browser',
    response: `agent-browser — Browser Automation CLI

Usage:
  /browser open <url>          Open URL
  /browser snapshot             Get accessibility tree with refs
  /browser click @e<n>         Click element by ref
  /browser fill @e<n> <text>   Fill element by ref
  /browser screenshot [path]    Take screenshot
  /browser get text @e<n>      Get text content
  /browser close                Close browser
  /browser chat <instruction>   AI chat mode

Semantic Locators:
  /browser find role button click --name "Submit"
  /browser find text "Sign In" click
  /browser find label "Email" fill "test@example.com"

Batch Mode:
  /browser batch "open url" "snapshot" "screenshot"

Network Control:
  /browser network route <url> --body <json>
  /browser network route <url> --abort

Requirements:
  - agent-browser installed: npm install -g agent-browser
  - Chrome downloaded: agent-browser install
`,
  };
}

async function main() {
  if (!command || command === '--help' || command === '-h') {
    console.log(JSON.stringify(showHelp()));
    return;
  }

  // Check if agent-browser is available
  const versionCheck = exec('--version');
  if (!versionCheck.success) {
    console.log(JSON.stringify({
      handled: true,
      skill: 'agent-browser',
      error: 'agent-browser not found',
      install: 'npm install -g agent-browser && agent-browser install',
    }));
    return;
  }

  switch (command) {
    case 'open': {
      const url = args[1];
      if (!url) {
        console.log(JSON.stringify({ error: 'Usage: /browser open <url>' }));
        return;
      }
      const result = exec(`open ${url}`);
      console.log(JSON.stringify({
        command: 'open',
        url,
        ...result,
      }));
      break;
    }

    case 'snapshot': {
      const interactive = args.includes('-i');
      const cmd = interactive ? 'snapshot -i' : 'snapshot';
      const result = exec(cmd);
      console.log(JSON.stringify({
        command: 'snapshot',
        interactive,
        ...result,
      }));
      break;
    }

    case 'click': {
      const ref = args[1];
      if (!ref) {
        console.log(JSON.stringify({ error: 'Usage: /browser click @e<n>' }));
        return;
      }
      const result = exec(`click ${ref}`);
      console.log(JSON.stringify({ command: 'click', ref, ...result }));
      break;
    }

    case 'fill': {
      const ref = args[1];
      const text = args.slice(2).join(' ');
      if (!ref || !text) {
        console.log(JSON.stringify({ error: 'Usage: /browser fill @e<n> <text>' }));
        return;
      }
      const result = exec(`fill ${ref} "${text}"`);
      console.log(JSON.stringify({ command: 'fill', ref, text, ...result }));
      break;
    }

    case 'type': {
      const ref = args[1];
      const text = args.slice(2).join(' ');
      if (!ref || !text) {
        console.log(JSON.stringify({ error: 'Usage: /browser type @e<n> <text>' }));
        return;
      }
      const result = exec(`type ${ref} "${text}"`);
      console.log(JSON.stringify({ command: 'type', ref, text, ...result }));
      break;
    }

    case 'press': {
      const key = args[1];
      if (!key) {
        console.log(JSON.stringify({ error: 'Usage: /browser press <key>' }));
        return;
      }
      const result = exec(`press ${key}`);
      console.log(JSON.stringify({ command: 'press', key, ...result }));
      break;
    }

    case 'screenshot': {
      const savePath = args[1] || 'screenshot.png';
      const annotate = args.includes('--annotate');
      const cmd = annotate ? `screenshot ${savePath} --annotate` : `screenshot ${savePath}`;
      const result = exec(cmd);
      console.log(JSON.stringify({
        command: 'screenshot',
        path: savePath,
        annotated: annotate,
        ...result,
      }));
      break;
    }

    case 'get': {
      const prop = args[1];
      const ref = args[2];
      if (!prop) {
        console.log(JSON.stringify({ error: 'Usage: /browser get <text|html|value|title|url> [@e<n>]' }));
        return;
      }
      const target = ref || '';
      const result = exec(`get ${prop} ${target}`.trim());
      console.log(JSON.stringify({ command: 'get', property: prop, ref: ref || 'page', ...result }));
      break;
    }

    case 'find': {
      const locatorType = args[1];
      const value = args[2];
      const action = args[3];
      const actionTarget = args.slice(4).join(' ');
      if (!locatorType || !value || !action) {
        console.log(JSON.stringify({
          error: 'Usage: /browser find <role|text|label|placeholder> <value> <action> [--name <name>]',
        }));
        return;
      }
      const nameIdx = args.indexOf('--name');
      const name = nameIdx !== -1 ? args[nameIdx + 1] : null;
      const cmd = name
        ? `find ${locatorType} ${value} ${action} --name "${name}"`
        : `find ${locatorType} ${value} ${action}`;
      const result = exec(cmd);
      console.log(JSON.stringify({
        command: 'find',
        locatorType,
        value,
        action,
        name,
        ...result,
      }));
      break;
    }

    case 'wait': {
      const target = args[1];
      if (!target) {
        console.log(JSON.stringify({ error: 'Usage: /browser wait <@e<n>|--text <text>|--url <pattern>|<ms>' }));
        return;
      }
      const cmd = target.startsWith('--') ? `wait ${target}` : `wait ${target}`;
      const result = exec(cmd);
      console.log(JSON.stringify({ command: 'wait', target, ...result }));
      break;
    }

    case 'batch': {
      const commands = args.slice(1);
      if (commands.length === 0) {
        console.log(JSON.stringify({ error: 'Usage: /browser batch "cmd1" "cmd2" ...' }));
        return;
      }
      const batchCmd = `batch ${commands.join('" "')}`;
      const result = exec(batchCmd);
      console.log(JSON.stringify({ command: 'batch', commands, ...result }));
      break;
    }

    case 'chat': {
      const instruction = args.slice(1).join(' ');
      if (!instruction) {
        console.log(JSON.stringify({ error: 'Usage: /browser chat <instruction>' }));
        return;
      }
      const result = exec(`chat "${instruction}"`);
      console.log(JSON.stringify({ command: 'chat', instruction, ...result }));
      break;
    }

    case 'close': {
      const result = exec('close');
      console.log(JSON.stringify({ command: 'close', ...result }));
      break;
    }

    case 'close-all': {
      const result = exec('close --all');
      console.log(JSON.stringify({ command: 'close --all', ...result }));
      break;
    }

    case 'network': {
      const subcmd = args[1];
      const url = args[2];
      const option = args[3];
      const value = args.slice(4).join(' ');
      if (subcmd === 'route') {
        const cmd = option ? `network route ${url} ${option} ${value}` : `network requests`;
        const result = exec(cmd);
        console.log(JSON.stringify({ command: 'network route', url, option, value, ...result }));
      } else if (subcmd === 'requests') {
        const result = exec('network requests');
        console.log(JSON.stringify({ command: 'network requests', ...result }));
      } else {
        console.log(JSON.stringify({ error: 'Usage: /browser network route <url> [--abort|--body <json>]' }));
      }
      break;
    }

    case 'tab': {
      const subcmd = args[1];
      if (subcmd === 'new') {
        const url = args[2];
        const labelIdx = args.indexOf('--label');
        const label = labelIdx !== -1 ? args[labelIdx + 1] : null;
        const cmd = label ? `tab new --label ${label} ${url || ''}` : `tab new ${url || ''}`;
        const result = exec(cmd.trim());
        console.log(JSON.stringify({ command: 'tab new', url, label, ...result }));
      } else if (subcmd === 'close') {
        const target = args[2];
        const result = exec(target ? `tab close ${target}` : 'tab close');
        console.log(JSON.stringify({ command: 'tab close', target, ...result }));
      } else {
        const result = exec('tab');
        console.log(JSON.stringify({ command: 'tab', ...result }));
      }
      break;
    }

    case 'console': {
      const result = exec('console --json');
      console.log(JSON.stringify({ command: 'console', ...result }));
      break;
    }

    default: {
      // Try as direct command
      const result = exec(command);
      console.log(JSON.stringify({
        command,
        ...result,
      }));
    }
  }
}

main();
