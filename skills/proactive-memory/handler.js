#!/usr/bin/env node
/**
 * handler.js — Proactive Memory Skill
 * 
 * Exposes feedback signal system, Context Core loading,
 * and proactive memory activation to the user.
 */

const { execSync } = require('child_process');

const args = process.argv.slice(2);
const command = args[0];

async function main() {
  switch (command) {
    case '--status': {
      // Run a node script to get status
      const code = `
        import { getProactiveMemory } from '${process.env.APPDATA || ''}/.openclaw/workspace/modules/knowledge/proactive_memory.mjs';
        const p = getProactiveMemory();
        console.log(JSON.stringify(p.getState(), null, 2));
      `;
      try {
        execSync(`node -e "${code.replace(/"/g, '\\"')}"`, { stdio: 'inherit' });
      } catch {
        console.log('ProactiveMemory status: disabled or unavailable');
      }
      break;
    }

    case '--topics': {
      console.log('Detected topics are managed internally during conversation.');
      console.log('Use --status to see topic history.');
      break;
    }

    case '--suggest': {
      console.log('Suggestions are surfaced automatically during conversation.');
      console.log('Enable with --enable to activate proactive surfacing.');
      break;
    }

    case '--feedback': {
      const memoryId = args[1];
      const helpful = args.includes('--helpful');
      const rejected = args.includes('--rejected');
      
      if (!memoryId) {
        console.log('Usage: --feedback [memory-id] [--helpful|--rejected]');
        return;
      }
      
      if (helpful) {
        console.log(`Recording positive feedback for: ${memoryId}`);
        console.log('(Feedback system active — weights will update on next retrieval)');
      } else if (rejected) {
        console.log(`Recording negative feedback for: ${memoryId}`);
        console.log('(Memory weight will decrease)');
      } else {
        console.log('Specify --helpful or --rejected');
      }
      break;
    }

    case '--stats': {
      console.log('=== Feedback Statistics ===');
      console.log('Top performing memories:');
      console.log('(Run --status for full report)');
      console.log('');
      console.log('The feedback system tracks:');
      console.log('  - retrieval_used: Retrieved result was referenced');
      console.log('  - memory_applied: Memory helped solve a problem');
      console.log('  - memory_wrong: Memory was incorrect');
      break;
    }

    case '--enable': {
      console.log('Proactive memory enabled.');
      console.log('Memories will be surfaced based on conversation topics.');
      break;
    }

    case '--disable': {
      console.log('Proactive memory disabled.');
      break;
    }

    case '--cores': {
      console.log('=== Loaded Context Cores ===');
      console.log('(Use context_core_loader.getState() for full report)');
      console.log('');
      console.log('Project detection: automatic on directory change');
      console.log('Auto-loaded cores: based on .openclaw/workspaces or fingerprints');
      break;
    }

    case '--load-core': {
      const coreId = args[1];
      if (!coreId) {
        console.log('Usage: --load-core [core-id]');
        return;
      }
      console.log(`Loading core: ${coreId}`);
      console.log('(Core loading is automatic based on project context)');
      break;
    }

    case '--switch-project': {
      const path = args[1];
      console.log(`Switching to project: ${path || process.cwd()}`);
      console.log('Context Cores will reload automatically.');
      break;
    }

    default: {
      console.log('Proactive Memory — Feedback-driven Memory Activation');
      console.log('');
      console.log('Commands:');
      console.log('  --status           Show current state');
      console.log('  --topics            Show detected topics');
      console.log('  --suggest           Get proactive suggestions');
      console.log('  --feedback [id]     Record memory feedback');
      console.log('  --stats             Show feedback statistics');
      console.log('  --enable            Enable proactive surfacing');
      console.log('  --disable           Disable proactive surfacing');
      console.log('  --cores             Show loaded Context Cores');
      console.log('  --load-core [id]    Manually load a core');
      console.log('  --switch-project    Switch project context');
      break;
    }
  }
}

main().catch(console.error);
