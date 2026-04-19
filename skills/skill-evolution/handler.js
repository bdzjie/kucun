/**
 * skill-evolution skill handler
 * 
 * Run GEPA-style skill optimization.
 */

import { existsSync, readdirSync, readFileSync, readdir } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { execSync } from 'child_process';

const WORKSPACE = 'C:\\Users\\Administrator\\.openclaw\\workspace';
const OUTPUT_DIR = join(homedir(), '.openclaw', 'memory', 'evolution', 'output');
const SKILLS_DIR = join(WORKSPACE, 'skills');

function listSkills() {
  try {
    if (!existsSync(SKILLS_DIR)) return [];
    return readdirSync(SKILLS_DIR)
      .filter(f => existsSync(join(SKILLS_DIR, f, 'SKILL.md')));
  } catch (e) {
    return [];
  }
}

function loadSkill(skillName) {
  const path = join(SKILLS_DIR, skillName, 'SKILL.md');
  if (!existsSync(path)) return null;
  try {
    return readFileSync(path, 'utf-8');
  } catch (e) {
    return null;
  }
}

function getEvolutionHistory(skillName) {
  const dir = join(OUTPUT_DIR, skillName);
  if (!existsSync(dir)) return [];
  
  try {
    const timestamps = readdirSync(dir).sort().reverse();
    return timestamps.slice(0, 5).map(ts => ({
      timestamp: ts,
      path: join(dir, ts),
    }));
  } catch (e) {
    return [];
  }
}

function loadMetrics(skillName, timestamp) {
  const path = join(OUTPUT_DIR, skillName, timestamp, 'metrics.json');
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch (e) {
    return null;
  }
}

function loadEvolvedSkill(skillName, timestamp) {
  const path = join(OUTPUT_DIR, skillName, timestamp, 'evolved_skill.md');
  if (!existsSync(path)) return null;
  try {
    return readFileSync(path, 'utf-8');
  } catch (e) {
    return null;
  }
}

function formatTimestamp(ts) {
  return ts.replace('T', ' ').replace(/-/g, ':').slice(0, 19);
}

export default async function handler(args) {
  const parts = args.trim().split(/\s+/);
  const flags = parts.filter(p => p.startsWith('--'));
  const positional = parts.filter(p => !p.startsWith('--'));
  
  // List command
  if (flags.includes('--list') || positional[0] === 'list') {
    const skills = listSkills();
    const lines = [
      '=== Skill Evolution ===',
      '',
      `Total skills: ${skills.length}`,
      '',
    ];
    
    for (const skill of skills.sort()) {
      const history = getEvolutionHistory(skill);
      if (history.length > 0) {
        const latest = history[0];
        const metrics = loadMetrics(skill, latest.timestamp);
        const status = metrics 
          ? `${metrics.verdict} (${(metrics.evolvedScore || 0).toFixed(3)})`
          : 'no data';
        lines.push(`  ${skill}: ${status}`);
        lines.push(`    Last run: ${latest.timestamp}`);
      } else {
        lines.push(`  ${skill}: no evolution history`);
      }
    }
    
    return { output: lines.join('\n') };
  }
  
  // Status command
  if (flags.includes('--status') || positional[0] === 'status') {
    const skillName = flags.includes('--status') ? (positional[0] || null) : (positional[1] || null);
    
    if (!skillName) {
      return { output: 'Usage: /skill-evolution --status [skill-name]' };
    }
    
    const skill = loadSkill(skillName);
    if (!skill) {
      return { output: `Skill not found: ${skillName}` };
    }
    
    const history = getEvolutionHistory(skillName);
    
    if (history.length === 0) {
      return {
        output: `Skill: ${skillName}\n\nNo evolution history.\n\nRun: /skill-evolution --evolve ${skillName}`
      };
    }
    
    const latest = history[0];
    const metrics = loadMetrics(skillName, latest.timestamp);
    
    const lines = [
      `=== Evolution Status: ${skillName} ===`,
      '',
      `Last run: ${latest.timestamp}`,
      `Verdict: ${metrics?.verdict || 'unknown'}`,
      '',
      '## Latest Results',
      `Baseline score: ${(metrics?.baselineScore || 0).toFixed(3)}`,
      `Evolved score:  ${(metrics?.evolvedScore || 0).toFixed(3)}`,
      `Improvement:   ${metrics?.improvement >= 0 ? '+' : ''}${(metrics?.improvement || 0).toFixed(3)}`,
    ];
    
    if (metrics?.generations) {
      lines.push('', '## Generations');
      for (const gen of metrics.generations) {
        lines.push(`  Gen ${gen.generation}: best=${gen.bestScore.toFixed(3)}`);
      }
    }
    
    return { output: lines.join('\n') };
  }
  
  // Report command
  if (flags.includes('--report') || positional[0] === 'report') {
    const skillName = flags.includes('--report') ? (positional[0] || null) : (positional[1] || null);
    
    if (!skillName) {
      return { output: 'Usage: /skill-evolution --report [skill-name]' };
    }
    
    const skill = loadSkill(skillName);
    if (!skill) {
      return { output: `Skill not found: ${skillName}` };
    }
    
    const history = getEvolutionHistory(skillName);
    
    if (history.length === 0) {
      return { output: `No evolution report for: ${skillName}` };
    }
    
    const latest = history[0];
    const metrics = loadMetrics(skillName, latest.timestamp);
    const evolved = loadEvolvedSkill(skillName, latest.timestamp);
    
    const lines = [
      `# Evolution Report: ${skillName}`,
      '',
      `**Date**: ${latest.timestamp}`,
      `**Verdict**: ${metrics?.verdict || 'unknown'}`,
      '',
      '## Comparison',
      `| Metric | Baseline | Evolved |`,
      `|--------|----------|---------|`,
      `| Score | ${(metrics?.baselineScore || 0).toFixed(3)} | ${(metrics?.evolvedScore || 0).toFixed(3)} |`,
      '',
      `**Improvement**: ${metrics?.improvement >= 0 ? '+' : ''}${(metrics?.improvement || 0).toFixed(3)}`,
    ];
    
    if (metrics?.datasetStats) {
      lines.push('', '## Dataset');
      lines.push(`Train/Val/Holdout: ${metrics.datasetStats.train}/${metrics.datasetStats.val}/${metrics.datasetStats.holdout}`);
    }
    
    if (evolved) {
      lines.push('', '## Evolved Skill Preview');
      lines.push('```markdown');
      lines.push(evolved.slice(0, 500) + (evolved.length > 500 ? '...' : ''));
      lines.push('```');
    }
    
    return { output: lines.join('\n') };
  }
  
  // Evolve command
  if (flags.includes('--evolve') || positional[0] === 'evolve') {
    const skillName = flags.includes('--evolve') ? (positional[0] || null) : (positional[1] || null);
    
    if (!skillName) {
      return { output: 'Usage: /skill-evolution --evolve [skill-name]' };
    }
    
    const skill = loadSkill(skillName);
    if (!skill) {
      return { output: `Skill not found: ${skillName}` };
    }
    
    // Parse options
    let iterations = 3;
    let population = 5;
    
    for (let i = 0; i < parts.length; i++) {
      if (parts[i] === '--iterations' && parts[i + 1]) {
        iterations = parseInt(parts[i + 1]);
      }
      if (parts[i] === '--population' && parts[i + 1]) {
        population = parseInt(parts[i + 1]);
      }
    }
    
    // Dry run check
    if (flags.includes('--dry-run')) {
      return {
        output: `Dry run for: ${skillName}\n\n` +
                `Iterations: ${iterations}\n` +
                `Population: ${population}\n\n` +
                `Skill size: ${skill.length} chars\n\n` +
                `Would generate evaluation dataset, run ${iterations} GEPA iterations, ` +
                `validate constraints, and select best variant.`
      };
    }
    
    // Run evolution via node
    try {
      const script = `
        import { SkillOptimizer } from './modules/evolution/skill_optimizer.mjs';
        import { readFileSync } from 'fs';
        
        const skillText = readFileSync('${SKILLS_DIR.replace(/\\/g, '\\\\')}\\\\${skillName}\\\\SKILL.md', 'utf-8');
        const optimizer = new SkillOptimizer({ iterations: ${iterations}, populationSize: ${population} });
        const result = await optimizer.optimize(skillText, '${skillName}');
        console.log(JSON.stringify(result));
      `;
      
      const output = execSync(`node --input-type=module -e "${script.replace(/"/g, '\\"')}"`, {
        cwd: WORKSPACE,
        encoding: 'utf-8',
        timeout: 120000,
      });
      
      let result;
      try {
        result = JSON.parse(output);
      } catch (e) {
        return { output: `Evolution ran but output parse failed. Check logs.` };
      }
      
      const lines = [
        `=== Evolution Complete: ${skillName} ===`,
        '',
        `Verdict: ${result.verdict}`,
        `Baseline: ${(result.baselineScore || 0).toFixed(3)}`,
        `Evolved:  ${(result.evolvedScore || 0).toFixed(3)}`,
        `Improvement: ${result.improvement >= 0 ? '+' : ''}${(result.improvement || 0).toFixed(3)}`,
        '',
        `Output saved to: ~/.openclaw/memory/evolution/output/${skillName}/`,
      ];
      
      return { output: lines.join('\n') };
    } catch (e) {
      return { 
        output: `Evolution error: ${e.message}\n\n` +
                `Note: Full evolution requires running via /exec-inline or external process.\n` +
                `Try: /skill-evolution --dry-run ${skillName}`
      };
    }
  }
  
  // Default help
  return {
    output: `Skill Evolution — GEPA-style skill optimization

Usage:
  /skill-evolution --list                     List all skills with evolution status
  /skill-evolution --status [name]            Show evolution status
  /skill-evolution --report [name]            Show detailed report
  /skill-evolution --evolve [name]            Run evolution
  /skill-evolution --evolve [name] --dry-run  Show what would happen
  /skill-evolution --dataset [name]           Generate evaluation dataset

Options:
  --iterations N    Number of optimization iterations (default: 3)
  --population N     Variants per generation (default: 5)

Evolution System:
  modules/evolution/
  ├── skill_optimizer.mjs     # GEPA optimization loop
  ├── constraint_validator.mjs # Constraint validation
  ├── fitness_evaluator.mjs    # LLM-as-Judge scoring
  ├── dataset_builder.mjs      # Synthetic test generation
  └── skill_mutator.mjs        # Genetic mutations

Output:
  ~/.openclaw/memory/evolution/output/[skill-name]/[timestamp]/
`
  };
}
