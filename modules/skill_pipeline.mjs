/**
 * skill_pipeline.mjs
 * 
 * Skill Pipeline System — inspired by LangChain LCEL (LangChain Expression Language).
 * Chain multiple skills together with routing, branching, and parallel execution.
 * 
 * Concepts:
 * - Pipe: output of one skill feeds into input of next
 * - Branch: conditionally execute different skills based on output
 * - Parallel: execute multiple skills concurrently
 * - Router: direct flow based on conditions
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';

/**
 * @typedef {Object} PipelineStep
 * @property {string} skill — skill name
 * @property {string} [input] — input expression or $prev for previous output
 * @property {Object} [params] — additional parameters
 * @property {string} [description] — step description
 */

/**
 * @typedef {'pipe' | 'branch' | 'parallel' | 'router'} PipelineType
 */

/**
 * @typedef {Object} PipelineConfig
 * @property {string} name
 * @property {PipelineType} type
 * @property {PipelineStep[]} steps
 * @property {Object} [condition] — for branch/router
 * @property {string} [outputVar] — variable name to store result
 */

const PIPELINE_DIR = join(homedir(), '.openclaw', 'memory', 'skill_pipelines');
const PIPELINE_REGISTRY = join(PIPELINE_DIR, 'pipelines.jsonl');

/**
 * Execute a single skill step
 */
async function executeSkillStep(step, context = {}) {
  // Import skill dynamically
  const skillPath = findSkillPath(step.skill);
  
  if (!skillPath) {
    throw new Error(`Skill not found: ${step.skill}`);
  }
  
  // Build input
  let input = step.input;
  if (input === '$prev' && context.lastOutput !== undefined) {
    input = context.lastOutput;
  } else if (input?.startsWith('$')) {
    // Variable reference
    const varName = input.slice(1);
    input = context.variables?.[varName] ?? context[varName] ?? input;
  }
  
  // For now, skill execution is simulated
  // In real implementation, this would invoke the skill handler
  return {
    skill: step.skill,
    input,
    params: step.params || {},
    output: `Result from ${step.skill}`,
    success: true,
  };
}

/**
 * Find skill path
 */
function findSkillPath(skillName) {
  const possiblePaths = [
    join(process.cwd(), 'skills', skillName),
    join(process.cwd(), 'skills', skillName, 'handler.js'),
    join(homedir(), '.openclaw', 'workspace', 'skills', skillName),
  ];
  
  for (const path of possiblePaths) {
    if (existsSync(path)) return path;
  }
  
  return null;
}

/**
 * SkillPipeline — chains skills together
 */
export class SkillPipeline {
  constructor(config) {
    this.name = config.name || 'unnamed_pipeline';
    this.type = config.type || 'pipe';
    this.steps = config.steps || [];
    this.condition = config.condition || null;
    this.outputVar = config.outputVar || null;
    
    this.results = [];
    this.context = {
      variables: {},
      lastOutput: null,
    };
  }
  
  /**
   * Add a step to the pipeline
   */
  addStep(skill, input = '$prev', params = {}, description = null) {
    this.steps.push({
      skill,
      input,
      params,
      description,
    });
    return this;
  }
  
  /**
   * Execute pipeline
   */
  async execute(initialInput = null) {
    this.results = [];
    this.context.lastOutput = initialInput;
    
    if (this.type === 'pipe') {
      return this._executePipe();
    } else if (this.type === 'parallel') {
      return this._executeParallel();
    } else if (this.type === 'branch') {
      return this._executeBranch();
    } else if (this.type === 'router') {
      return this._executeRouter();
    }
    
    throw new Error(`Unknown pipeline type: ${this.type}`);
  }
  
  /**
   * Execute pipe (sequential)
   */
  async _executePipe() {
    const outputs = [];
    
    for (const step of this.steps) {
      const result = await executeSkillStep(step, this.context);
      this.results.push(result);
      
      this.context.lastOutput = result.output;
      outputs.push(result.output);
    }
    
    return {
      success: true,
      outputs,
      finalOutput: outputs[outputs.length - 1],
      steps: this.results,
    };
  }
  
  /**
   * Execute parallel
   */
  async _executeParallel() {
    const promises = this.steps.map(step => executeSkillStep(step, this.context));
    const results = await Promise.all(promises);
    
    this.results = results;
    
    return {
      success: true,
      outputs: results.map(r => r.output),
      finalOutput: results.map(r => r.output),
      steps: results,
    };
  }
  
  /**
   * Execute branch
   */
  async _executeBranch() {
    if (!this.condition) {
      throw new Error('Branch pipeline requires condition');
    }
    
    const shouldBranch = this._evaluateCondition(this.condition);
    const stepsToRun = shouldBranch ? this.steps[0] : this.steps[1];
    
    if (!stepsToRun) {
      return { success: true, output: null, skipped: true };
    }
    
    const outputs = [];
    for (const step of (Array.isArray(stepsToRun) ? stepsToRun : [stepsToRun])) {
      const result = await executeSkillStep(step, this.context);
      this.results.push(result);
      outputs.push(result.output);
    }
    
    return {
      success: true,
      outputs,
      finalOutput: outputs[outputs.length - 1],
      branch: shouldBranch ? 'true' : 'false',
      steps: this.results,
    };
  }
  
  /**
   * Execute router
   */
  async _executeRouter() {
    if (!this.condition?.route) {
      throw new Error('Router pipeline requires route condition');
    }
    
    const routeKey = this._evaluateCondition(this.condition.route);
    const steps = this.steps[routeKey] || this.steps.default;
    
    if (!steps) {
      return { success: true, output: null, route: routeKey, skipped: true };
    }
    
    const outputs = [];
    for (const step of (Array.isArray(steps) ? steps : [steps])) {
      const result = await executeSkillStep(step, this.context);
      this.results.push(result);
      outputs.push(result.output);
    }
    
    return {
      success: true,
      outputs,
      finalOutput: outputs[outputs.length - 1],
      route: routeKey,
      steps: this.results,
    };
  }
  
  /**
   * Evaluate condition
   */
  _evaluateCondition(condition) {
    if (typeof condition === 'boolean') return condition;
    if (typeof condition === 'function') return condition(this.context);
    
    // String expression
    if (typeof condition === 'string') {
      try {
        // Simple expression evaluation
        const expr = condition.replace(/\$last/g, JSON.stringify(this.context.lastOutput));
        return new Function(`return ${expr}`)();
      } catch (e) {
        return false;
      }
    }
    
    return false;
  }
  
  /**
   * Set context variable
   */
  setVar(name, value) {
    this.context.variables[name] = value;
    return this;
  }
  
  /**
   * Get pipeline summary
   */
  getSummary() {
    return {
      name: this.name,
      type: this.type,
      steps: this.steps.map((s, i) => `${i + 1}. ${s.skill}${s.description ? ` (${s.description})` : ''}`),
      resultCount: this.results.length,
    };
  }
}

/**
 * PipelineBuilder — fluent API for building pipelines
 */
export class PipelineBuilder {
  constructor(name) {
    this.name = name;
    this.steps = [];
    this.type = 'pipe';
    this.condition = null;
  }
  
  pipe(skill, input, params, description) {
    this.type = 'pipe';
    this.steps.push({ skill, input: input || '$prev', params: params || {}, description });
    return this;
  }
  
  then(skill, input, params, description) {
    return this.pipe(skill, input, params, description);
  }
  
  parallel(...skills) {
    this.type = 'parallel';
    for (const skill of skills) {
      if (typeof skill === 'string') {
        this.steps.push({ skill, input: '$prev', params: {}, description: null });
      } else {
        this.steps.push(skill);
      }
    }
    return this;
  }
  
  branch(condition, trueSteps, falseSteps) {
    this.type = 'branch';
    this.condition = condition;
    this.steps = [trueSteps, falseSteps];
    return this;
  }
  
  router(routeCondition, routeMap) {
    this.type = 'router';
    this.condition = { route: routeCondition };
    this.steps = routeMap;
    return this;
  }
  
  build() {
    return new SkillPipeline({
      name: this.name,
      type: this.type,
      steps: this.steps,
      condition: this.condition,
    });
  }
}

/**
 * Create pipeline from config
 */
export function createPipeline(config) {
  return new SkillPipeline(config);
}

/**
 * Predefined pipeline templates
 */
export const PIPELINE_TEMPLATES = {
  research_and_write: {
    name: 'Research and Write',
    type: 'pipe',
    steps: [
      { skill: 'session-search', input: '$query', description: 'Find related context' },
      { skill: 'exec-inline', input: '$prev', description: 'Process findings' },
      { skill: 'verify-memory', input: '$prev', description: 'Verify and store' },
    ],
  },
  code_review: {
    name: 'Code Review Pipeline',
    type: 'pipe',
    steps: [
      { skill: 'session-replay', input: '$code', description: 'Analyze code history' },
      { skill: 'conversation-analyst', input: '$prev', description: 'Analyze review patterns' },
      { skill: 'verify-memory', input: '$prev', description: 'Store findings' },
    ],
  },
  daily_scrum: {
    name: 'Daily Scrum',
    type: 'parallel',
    steps: [
      { skill: 'session-search', input: 'yesterday tasks', description: 'Yesterday' },
      { skill: 'session-search', input: 'today tasks', description: 'Today' },
      { skill: 'session-search', input: 'blockers', description: 'Blockers' },
    ],
  },
};

/**
 * Save pipeline to registry
 */
export function savePipeline(pipeline) {
  mkdirSync(PIPELINE_DIR, { recursive: true });
  
  const data = {
    name: pipeline.name,
    type: pipeline.type,
    steps: pipeline.steps,
    condition: pipeline.condition,
    savedAt: Date.now(),
  };
  
  appendFileSync(PIPELINE_REGISTRY, JSON.stringify(data) + '\n');
  return PIPELINE_REGISTRY;
}

/**
 * Load pipeline templates
 */
export function loadTemplates() {
  return PIPELINE_TEMPLATES;
}

export default {
  SkillPipeline,
  PipelineBuilder,
  createPipeline,
  savePipeline,
  loadTemplates,
  PIPELINE_TEMPLATES,
};
