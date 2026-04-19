#!/usr/bin/env node
/**
 * handler.js — Agent Teams skill
 * 
 * Multi-Agent Role System inspired by MetaGPT and CrewAI.
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Active roster in memory
let activeRoster = null;

async function loadModule(path) {
  return import(path).then(m => m);
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log('Usage: /agent-teams [--create <name>|--add <role>|--assign <task>|--handoff <role>|--status|--list-roles|--pipelines|--run <pipeline>]');
    process.exit(0);
  }
  
  // Parse — first non-flag is the command
  const positional = [];
  const flags = {};
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      
      // Check if next arg is a value (not a flag)
      if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
        flags[key] = args[++i];
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(arg);
    }
  }
  
  // Command is first positional
  const cmd = positional[0];
  const value = positional[1];
  
  // Import modules
  let AgentRoles, SkillPipeline;
  
  try {
    const rolesModule = await loadModule('file://' + join(process.cwd(), 'modules', 'agent_roles.mjs').replace(/\\/g, '/'));
    AgentRoles = rolesModule;
    
    const pipelineModule = await loadModule('file://' + join(process.cwd(), 'modules', 'skill_pipeline.mjs').replace(/\\/g, '/'));
    SkillPipeline = pipelineModule;
  } catch (e) {
    console.log('\n=== Agent Teams ===\n');
    console.log('Status: Modules not in current directory.');
    console.log('Expected: modules/agent_roles.mjs, modules/skill_pipeline.mjs');
    process.exit(1);
  }
  
  try {
    if (cmd === 'list-roles' || flags.listRoles) {
      const roles = AgentRoles.listRoles();
      
      console.log('\n=== Available Roles ===\n');
      console.log('| ID | Name | Role |');
      console.log('|----|------|------|');
      for (const r of roles) {
        console.log(`| ${r.id} | ${r.name} | ${r.role} |`);
      }
      console.log('');
      
    } else if (cmd === 'create' || flags.create) {
      const teamName = value || flags.create || 'default-team';
      
      activeRoster = new AgentRoles.AgentRoster(teamName);
      
      console.log('\n=== Team Created ===\n');
      console.log(`Team: ${teamName}`);
      console.log('Add agents: --add <role>');
      console.log('Status: --status');
      
    } else if (cmd === 'add' || flags.add) {
      if (!activeRoster) {
        activeRoster = new AgentRoles.AgentRoster('auto-team');
      }
      
      const roleType = value || flags.add;
      const agentName = flags.name;
      
      if (!roleType) {
        console.log('Usage: --add <role> [--name <name>]');
        console.log('Roles:', Object.keys(AgentRoles.DEFAULT_ROLES).join(', '));
        process.exit(1);
      }
      
      const agent = activeRoster.addAgent(roleType, { name: agentName });
      
      console.log('\n=== Agent Added ===\n');
      console.log(`Role: ${agent.role} (${agent.config.role})`);
      console.log(`Name: ${agent.config.name}`);
      console.log(`ID: ${agent.id}`);
      console.log(`Goal: ${agent.config.goal}`);
      console.log(`Tools: ${agent.config.tools.join(', ')}`);
      console.log(`Collaborators: ${agent.config.collaborators.map(r => r.toUpperCase()).join(', ')}`);
      
    } else if (cmd === 'assign' || flags.assign) {
      if (!activeRoster) {
        console.log('No active team. Create: --create <name>');
        process.exit(1);
      }
      
      const task = value || flags.assign;
      
      if (!task) {
        console.log('Usage: --assign <task description>');
        process.exit(1);
      }
      
      const agents = Array.from(activeRoster.agents.values());
      if (agents.length === 0) {
        console.log('No agents. Add: --add <role>');
        process.exit(1);
      }
      
      const agent = agents[0];
      const taskRecord = activeRoster.assignTask(agent.id, task);
      
      console.log('\n=== Task Assigned ===\n');
      console.log(`Agent: ${agent.config.name} (${agent.role})`);
      console.log(`Task: ${task}`);
      console.log(`Task ID: ${taskRecord.id}`);
      
    } else if (cmd === 'handoff' || flags.handoff) {
      if (!activeRoster) {
        console.log('No active team.');
        process.exit(1);
      }
      
      const toRole = value || flags.handoff;
      const message = flags.message;
      
      const agents = Array.from(activeRoster.agents.values());
      if (agents.length === 0) {
        console.log('No agents in team.');
        process.exit(1);
      }
      
      const fromAgent = agents[0];
      const handoff = activeRoster.handoff(fromAgent.id, toRole, message);
      
      if (!handoff) {
        console.log(`Handoff failed. Role not found: ${toRole}`);
        process.exit(1);
      }
      
      console.log('\n=== Handoff ===\n');
      console.log(`From: ${fromAgent.config.name} (${fromAgent.role})`);
      console.log(`To: ${toRole.toUpperCase()}`);
      if (message) console.log(`Message: ${message}`);
      
    } else if (cmd === 'complete' || flags.complete) {
      if (!activeRoster) {
        console.log('No active team.');
        process.exit(1);
      }
      
      const agents = Array.from(activeRoster.agents.values());
      const artifact = flags.artifact || null;
      
      for (const agent of agents) {
        if (agent.currentTask) {
          activeRoster.completeTask(agent.id, artifact);
        }
      }
      
      console.log('\n=== Task Completed ===\n');
      
    } else if (cmd === 'status' || flags.status) {
      if (!activeRoster) {
        console.log('\n=== No Active Team ===\n');
        console.log('Create: --create <name>');
        process.exit(0);
      }
      
      console.log('\n' + activeRoster.generateSummary());
      
    } else if (cmd === 'pipelines' || flags.pipelines) {
      const templates = SkillPipeline.loadTemplates();
      
      console.log('\n=== Pipeline Templates ===\n');
      for (const [id, template] of Object.entries(templates)) {
        console.log(`### ${id}`);
        console.log(`**Name**: ${template.name}`);
        console.log(`**Type**: ${template.type}`);
        console.log(`**Steps**: ${template.steps.map(s => s.skill).join(' → ')}`);
        console.log('');
      }
      
    } else if (cmd === 'run' || flags.run) {
      const pipelineName = value || flags.run;
      
      if (!pipelineName) {
        console.log('Usage: --run <pipeline> [--input <input>]');
        console.log('Pipelines:', Object.keys(SkillPipeline.loadTemplates()).join(', '));
        process.exit(1);
      }
      
      const templates = SkillPipeline.loadTemplates();
      const template = templates[pipelineName];
      
      if (!template) {
        console.log(`Pipeline not found: ${pipelineName}`);
        console.log('Available:', Object.keys(templates).join(', '));
        process.exit(1);
      }
      
      console.log(`\n=== Running Pipeline: ${pipelineName} ===\n`);
      
      const pipeline = SkillPipeline.createPipeline(template);
      const input = flags.input || 'default input';
      
      console.log(`Input: ${input}`);
      console.log('(Pipeline execution simulated — skills run in OpenClaw runtime)');
      console.log('');
      
      const result = await pipeline.execute(input);
      
      console.log('Results:');
      for (const step of result.steps || []) {
        console.log(`  - ${step.skill}: ${step.output}`);
      }
      
      console.log('');
      console.log(`Final: ${result.finalOutput}`);
      
    } else {
      console.log(`Unknown: ${cmd}`);
      console.log('Use: --create, --add, --assign, --handoff, --status, --list-roles, --pipelines, --run');
    }
    
  } catch (e) {
    console.error('Error:', e.message);
    process.exit(1);
  }
}

main();
