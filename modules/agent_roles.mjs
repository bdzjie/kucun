/**
 * agent_roles.mjs
 * 
 * Multi-Agent Role System inspired by MetaGPT and CrewAI.
 * Agents have specialized roles with defined goals, tools, and behaviors.
 * 
 * MetaGPT: "Software Company" mode with PM/Architect/Engineer/Reviewer
 * CrewAI: Role-playing autonomous agents with collaborative intelligence
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';

/**
 * @typedef {'pm' | 'architect' | 'engineer' | 'reviewer' | 'researcher' | 'planner' | 'executor' | 'custom'} AgentRole
 */

/**
 * @typedef {Object} RoleConfig
 * @property {string} name
 * @property {string} role — role name (e.g., "Project Manager")
 * @property {string} goal — what this role tries to achieve
 * @property {string} backstory — personality and context
 * @property {string[]} tools — available tools for this role
 * @property {string[]} collaborators — roles this agent works with
 * @property {string} systemPrompt — custom system prompt
 * @property {number} maxIterations — max iterations before handoff
 */

/**
 * @typedef {Object} RoleAgent
 * @property {string} id
 * @property {AgentRole} role
 * @property {RoleConfig} config
 * @property {string} currentTask
 * @property {string[]} completedTasks
 * @property {number} iterations
 * @property {string[]} artifacts — produced artifacts
 * @property {number} createdAt
 */

const ROLES_DIR = join(homedir(), '.openclaw', 'memory', 'agent_roles');
const ROLES_REGISTRY = join(ROLES_DIR, 'registry.jsonl');

/**
 * Predefined role configurations (MetaGPT-inspired)
 */
const DEFAULT_ROLES = {
  pm: {
    name: 'PM',
    role: 'Product Manager',
    goal: 'Define product requirements, prioritize features, translate user needs into specifications',
    backstory: 'You are an experienced Product Manager who bridges user needs and technical feasibility. You write clear PRDs and acceptance criteria.',
    tools: ['Read', 'Write', 'Glob', 'Grep'],
    collaborators: ['architect', 'engineer', 'reviewer'],
    maxIterations: 10,
  },
  architect: {
    name: 'Architect',
    role: 'Software Architect',
    goal: 'Design scalable, maintainable system architectures and make key technical decisions',
    backstory: 'You are a senior architect with deep knowledge of system design patterns, trade-offs, and long-term maintainability.',
    tools: ['Read', 'Write', 'Glob', 'Grep', 'Bash'],
    collaborators: ['pm', 'engineer'],
    maxIterations: 8,
  },
  engineer: {
    name: 'Engineer',
    role: 'Software Engineer',
    goal: 'Implement high-quality code following best practices and specifications',
    backstory: 'You are a skilled developer who writes clean, tested, maintainable code. You follow specs exactly and seek clarification when ambiguous.',
    tools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'],
    collaborators: ['architect', 'reviewer'],
    maxIterations: 15,
  },
  reviewer: {
    name: 'Reviewer',
    role: 'Code Reviewer',
    goal: 'Ensure code quality, catch bugs, enforce standards, and provide constructive feedback',
    backstory: 'You are a meticulous reviewer with an eye for detail. You balance quality with pragmatism and help engineers improve.',
    tools: ['Read', 'Grep', 'Glob'],
    collaborators: ['engineer', 'pm'],
    maxIterations: 5,
  },
  researcher: {
    name: 'Researcher',
    role: 'Research Analyst',
    goal: 'Gather information, analyze options, and provide data-driven insights',
    backstory: 'You are a thorough researcher who digs deep into topics, considers multiple sources, and presents balanced findings.',
    tools: ['Read', 'Grep', 'WebFetch', 'Bash'],
    collaborators: ['pm', 'planner'],
    maxIterations: 10,
  },
  planner: {
    name: 'Planner',
    role: 'Strategic Planner',
    goal: 'Break down complex tasks into actionable steps and coordinate execution',
    backstory: 'You are a strategic thinker who excels at decomposition, dependency analysis, and timeline planning.',
    tools: ['Read', 'Write', 'Glob'],
    collaborators: ['pm', 'executor'],
    maxIterations: 5,
  },
  executor: {
    name: 'Executor',
    role: 'Task Executor',
    goal: 'Execute tasks efficiently, handle exceptions, and deliver results',
    backstory: 'You are a reliable executor who takes ownership and gets things done. You ask for help when blocked but otherwise drive to completion.',
    tools: ['Read', 'Write', 'Edit', 'Bash'],
    collaborators: ['planner', 'reviewer'],
    maxIterations: 20,
  },
};

/**
 * Generate system prompt for a role
 */
function generateRolePrompt(config) {
  return `You are playing the role of ${config.role}.

## Your Goal
${config.goal}

## Backstory
${config.backstory}

## Collaboration
You work with: ${config.collaborators.map(r => r.toUpperCase()).join(', ')}

## Guidelines
- Stay in character as ${config.role}
- Focus on your specialized responsibilities
- Collaborate effectively with team members
- Escalate blockers to the appropriate teammate
- Document your decisions and reasoning

## Available Tools
${config.tools.join(', ')}

Respond with your role clearly stated at the start.`;
}

/**
 * Create a new role agent
 */
export function createRoleAgent(roleType, options = {}) {
  const roleConfig = DEFAULT_ROLES[roleType] || DEFAULT_ROLES.custom;
  
  const config = {
    ...roleConfig,
    ...options,
    name: options.name || roleConfig.name,
  };
  
  const agent = {
    id: `agent_${roleType}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    role: roleType,
    config,
    currentTask: null,
    completedTasks: [],
    iterations: 0,
    artifacts: [],
    createdAt: Date.now(),
    systemPrompt: generateRolePrompt(config),
  };
  
  return agent;
}

/**
 * Create custom role
 */
export function createCustomRole(name, role, goal, backstory, tools = [], collaborators = []) {
  return {
    name,
    role,
    goal,
    backstory,
    tools: tools.length > 0 ? tools : ['Read', 'Write'],
    collaborators,
    maxIterations: 10,
    isCustom: true,
  };
}

/**
 * AgentRoster — manages a team of role-based agents
 */
export class AgentRoster {
  constructor(teamId = null) {
    this.teamId = teamId || `team_${Date.now()}`;
    this.agents = new Map();
    this.tasks = [];
    this.handoffs = [];
    this.createdAt = Date.now();
  }
  
  /**
   * Add an agent to the roster
   */
  addAgent(roleType, options = {}) {
    const agent = createRoleAgent(roleType, options);
    this.agents.set(agent.id, agent);
    return agent;
  }
  
  /**
   * Get agent by ID
   */
  getAgent(agentId) {
    return this.agents.get(agentId);
  }
  
  /**
   * Get agent by role type
   */
  getAgentByRole(roleType) {
    for (const agent of this.agents.values()) {
      if (agent.role === roleType) return agent;
    }
    return null;
  }
  
  /**
   * Assign a task to an agent
   */
  assignTask(agentId, task) {
    const agent = this.agents.get(agentId);
    if (!agent) return null;
    
    agent.currentTask = {
      id: `task_${Date.now()}`,
      description: task,
      status: 'in_progress',
      assignedAt: Date.now(),
    };
    
    this.tasks.push({
      id: agent.currentTask.id,
      agentId,
      description: task,
      status: 'in_progress',
    });
    
    return agent.currentTask;
  }
  
  /**
   * Complete current task
   */
  completeTask(agentId, artifact = null) {
    const agent = this.agents.get(agentId);
    if (!agent || !agent.currentTask) return null;
    
    const task = agent.currentTask;
    task.status = 'completed';
    task.completedAt = Date.now();
    
    if (artifact) {
      agent.artifacts.push(artifact);
    }
    
    agent.completedTasks.push(task);
    agent.currentTask = null;
    agent.iterations++;
    
    return task;
  }
  
  /**
   * Hand off to another agent
   */
  handoff(fromAgentId, toRole, message = null) {
    const fromAgent = this.agents.get(fromAgentId);
    const toAgent = this.getAgentByRole(toRole);
    
    if (!fromAgent || !toAgent) return null;
    
    const handoffRecord = {
      id: `handoff_${Date.now()}`,
      from: fromAgent.role,
      fromId: fromAgent.id,
      to: toAgent.role,
      toId: toAgent.id,
      message,
      timestamp: Date.now(),
    };
    
    this.handoffs.push(handoffRecord);
    
    // Transfer context
    if (fromAgent.currentTask) {
      toAgent.currentTask = {
        ...fromAgent.currentTask,
        previousAgent: fromAgent.role,
        handoffMessage: message,
      };
    }
    
    return handoffRecord;
  }
  
  /**
   * Get team status
   */
  getStatus() {
    const agentList = [];
    for (const agent of this.agents.values()) {
      agentList.push({
        id: agent.id,
        role: agent.role,
        name: agent.config.name,
        currentTask: agent.currentTask?.description || null,
        completedTasks: agent.completedTasks.length,
        iterations: agent.iterations,
      });
    }
    
    return {
      teamId: this.teamId,
      agentCount: this.agents.size,
      agents: agentList,
      totalTasks: this.tasks.length,
      completedTasks: this.tasks.filter(t => t.status === 'completed').length,
      totalHandoffs: this.handoffs.length,
      createdAt: new Date(this.createdAt).toISOString(),
    };
  }
  
  /**
   * Generate team summary
   */
  generateSummary() {
    const status = this.getStatus();
    
    const lines = [
      `# Team: ${status.teamId}`,
      '',
      `**Agents**: ${status.agentCount} | **Tasks**: ${status.completedTasks}/${status.totalTasks} | **Handoffs**: ${status.totalHandoffs}`,
      '',
      '## Team Members',
      '',
    ];
    
    for (const agent of status.agents) {
      lines.push(`### ${agent.name} (${agent.role.toUpperCase()})`);
      lines.push(`- Current: ${agent.currentTask || '(idle)'}`);
      lines.push(`- Completed: ${agent.completedTasks} tasks`);
      lines.push(`- Iterations: ${agent.iterations}`);
      lines.push('');
    }
    
    if (this.handoffs.length > 0) {
      lines.push('## Recent Handoffs');
      for (const h of this.handoffs.slice(-5)) {
        lines.push(`- ${h.from} → ${h.to}: ${h.message || '(task transfer)'}`);
      }
    }
    
    return lines.join('\n');
  }
  
  /**
   * Save roster to file
   */
  save() {
    mkdirSync(ROLES_DIR, { recursive: true });
    
    const data = {
      teamId: this.teamId,
      agents: Array.from(this.agents.values()),
      tasks: this.tasks,
      handoffs: this.handoffs,
      createdAt: this.createdAt,
    };
    
    appendFileSync(ROLES_REGISTRY, JSON.stringify(data) + '\n');
    return ROLES_REGISTRY;
  }
}

/**
 * Parse role from text (e.g., "pm", "architect", "engineer")
 */
export function parseRole(text) {
  const lower = text.toLowerCase().trim();
  
  if (DEFAULT_ROLES[lower]) return lower;
  
  // Fuzzy match
  const aliases = {
    'product manager': 'pm',
    'manager': 'pm',
    'dev': 'engineer',
    'developer': 'engineer',
    'coder': 'engineer',
    'code reviewer': 'reviewer',
    'research': 'researcher',
    'plan': 'planner',
    'execute': 'executor',
  };
  
  return aliases[lower] || 'custom';
}

/**
 * Check if role exists
 */
export function roleExists(roleType) {
  return roleType in DEFAULT_ROLES;
}

/**
 * List available roles
 */
export function listRoles() {
  return Object.entries(DEFAULT_ROLES).map(([key, config]) => ({
    id: key,
    name: config.name,
    role: config.role,
    goal: config.goal,
  }));
}

export default {
  DEFAULT_ROLES,
  createRoleAgent,
  createCustomRole,
  AgentRoster,
  parseRole,
  roleExists,
  listRoles,
  generateRolePrompt,
};
