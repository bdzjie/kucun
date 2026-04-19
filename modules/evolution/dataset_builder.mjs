/**
 * dataset_builder.mjs
 * 
 * Generate synthetic evaluation test cases from skill/prompt text.
 * Inspired by: hermes-agent-self-evolution/evolution/core/dataset_builder.py
 * 
 * Uses pattern matching + LLM prompts to generate diverse test cases
 * covering easy/medium/hard scenarios.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { EvalDataset, EvalExample } from './eval_dataset.mjs';

const DATASET_DIR = join(homedir(), '.openclaw', 'memory', 'evolution', 'datasets');

/**
 * Test case templates by category
 * These patterns generate realistic task inputs for different skill types
 */
const TEMPLATES = {
  // Coding / Developer skills
  code_review: [
    { difficulty: 'easy', task: 'Review this simple function for bugs', category: 'code_quality' },
    { difficulty: 'medium', task: 'Analyze this module for security vulnerabilities', category: 'security' },
    { difficulty: 'hard', task: 'Identify performance bottlenecks in this nested loop', category: 'performance' },
  ],
  refactor: [
    { difficulty: 'easy', task: 'Rename this variable to be more descriptive', category: 'naming' },
    { difficulty: 'medium', task: 'Extract this duplicated code into a reusable function', category: 'dry' },
    { difficulty: 'hard', task: 'Redesign this God class into smaller, cohesive units', category: 'architecture' },
  ],
  
  // Documentation skills
  documentation: [
    { difficulty: 'easy', task: 'Add docstrings to these functions', category: 'docstrings' },
    { difficulty: 'medium', task: 'Write a README for this project from scratch', category: 'readme' },
    { difficulty: 'hard', task: 'Create comprehensive API documentation with examples', category: 'api_docs' },
  ],
  
  // General purpose skills
  general: [
    { difficulty: 'easy', task: 'Explain what this code does in simple terms', category: 'explanation' },
    { difficulty: 'medium', task: 'Compare these two approaches and recommend one', category: 'comparison' },
    { difficulty: 'hard', task: 'Design a solution for this complex multi-system problem', category: 'design' },
  ],
  
  // Debugging skills
  debugging: [
    { difficulty: 'easy', task: 'Find the typo in this code', category: 'typo' },
    { difficulty: 'medium', task: 'Why is this function returning the wrong value?', category: 'logic' },
    { difficulty: 'hard', task: 'Debug this intermittent race condition', category: 'concurrency' },
  ],
  
  // Testing skills
  testing: [
    { difficulty: 'easy', task: 'Write a basic unit test for this function', category: 'basic' },
    { difficulty: 'medium', task: 'Write tests covering edge cases and error conditions', category: 'edge_cases' },
    { difficulty: 'hard', task: 'Design a comprehensive test strategy for this system', category: 'strategy' },
  ],
};

/**
 * Detect skill type from content
 */
function detectSkillType(skillText) {
  const lower = skillText.toLowerCase();
  
  if (lower.includes('review') || lower.includes('pull request') || lower.includes('commit')) {
    return 'code_review';
  }
  if (lower.includes('refactor') || lower.includes('restructure')) {
    return 'refactor';
  }
  if (lower.includes('document') || lower.includes('readme') || lower.includes('comment')) {
    return 'documentation';
  }
  if (lower.includes('debug') || lower.includes('fix') || lower.includes('error')) {
    return 'debugging';
  }
  if (lower.includes('test') || lower.includes('spec') || lower.includes('assert')) {
    return 'testing';
  }
  
  return 'general';
}

/**
 * Generate test cases from templates
 * Non-LLM version that uses pattern matching and templates
 */
export class SyntheticDatasetBuilder {
  constructor(options = {}) {
    this.numCases = options.numCases || 20;
    this.trainRatio = options.trainRatio || 0.5;
    this.valRatio = options.valRatio || 0.25;
    this.holdoutRatio = options.holdoutRatio || 0.25;
  }
  
  /**
   * Generate test cases from skill text
   * @param {string} skillText - Full skill text (SKILL.md body)
   * @param {string} [skillName] - Skill name for context
   * @returns {EvalDataset}
   */
  generate(skillText, skillName = 'unknown') {
    const skillType = detectSkillType(skillText);
    const templates = TEMPLATES[skillType] || TEMPLATES.general;
    
    const examples = [];
    
    // Generate diverse examples using templates + skill context
    for (let i = 0; i < this.numCases; i++) {
      const template = templates[i % templates.length];
      
      // Vary the difficulty distribution
      let difficulty;
      const rand = Math.random();
      if (rand < 0.3) difficulty = 'easy';
      else if (rand < 0.7) difficulty = 'medium';
      else difficulty = 'hard';
      
      // Generate task input based on template
      const taskInput = this.generateTaskInput(skillText, template, skillName, i);
      
      // Generate expected behavior rubric
      const expectedBehavior = this.generateExpectedBehavior(skillText, template, skillName);
      
      examples.push(new EvalExample({
        taskInput,
        expectedBehavior,
        difficulty,
        category: template.category,
        source: 'synthetic',
      }));
    }
    
    // Shuffle and split
    const shuffled = this.shuffle(examples);
    const n = shuffled.length;
    const nTrain = Math.max(1, Math.floor(n * this.trainRatio));
    const nVal = Math.max(1, Math.floor(n * this.valRatio));
    
    return new EvalDataset({
      train: shuffled.slice(0, nTrain),
      val: shuffled.slice(nTrain, nTrain + nVal),
      holdout: shuffled.slice(nTrain + nVal),
    });
  }
  
  /**
   * Generate task input from template + skill context
   */
  generateTaskInput(skillText, template, skillName, index) {
    // Extract key phrases from skill text
    const keywords = this.extractKeywords(skillText);
    
    // Build task input
    let task = template.task;
    
    // Replace placeholders with skill-specific context
    if (keywords.length > 0) {
      const kw = keywords[index % keywords.length];
      if (!task.includes('this')) {
        task = task.replace('this', kw);
      }
    }
    
    // Add skill context
    if (skillName !== 'unknown') {
      task = `[${skillName}] ${task}`;
    }
    
    return task;
  }
  
  /**
   * Generate expected behavior rubric
   */
  generateExpectedBehavior(skillText, template, skillName) {
    const behaviors = {
      code_quality: 'Code should be clean, readable, and follow best practices. No obvious bugs or anti-patterns.',
      security: 'Code should be free from common vulnerabilities: injection, XSS, SQL injection, insecure dependencies.',
      performance: 'Code should be efficient. Nested loops should be avoided where possible. O(n) preferred over O(n²).',
      naming: 'Variable names should be descriptive and follow camelCase or snake_case conventions.',
      dry: 'Code should not repeat logic. Shared functionality should be extracted into reusable functions.',
      architecture: 'Classes should have single responsibility. Dependencies should be injected, not hardcoded.',
      docstrings: 'Functions should have clear docstrings explaining inputs, outputs, and side effects.',
      readme: 'README should have: project overview, installation, usage, and examples.',
      api_docs: 'Documentation should cover all endpoints/function with parameters, return types, and usage examples.',
      explanation: 'Explanation should be clear, concise, and appropriate for the difficulty level.',
      comparison: 'Should analyze both approaches, highlight pros/cons, and give a clear recommendation.',
      design: 'Solution should be scalable, maintainable, and handle edge cases properly.',
      typo: 'Should identify the exact line and character position of the typo.',
      logic: 'Should trace through the logic, identify the incorrect assumption, and suggest a fix.',
      concurrency: 'Should identify the race condition source and propose a thread-safe solution.',
      basic: 'Tests should cover happy path with valid inputs.',
      edge_cases: 'Tests should cover null/empty, boundary values, and error conditions.',
      strategy: 'Strategy should cover unit, integration, and end-to-end tests with appropriate coverage.',
    };
    
    const base = behaviors[template.category] || 'Should complete the task correctly and thoroughly.';
    
    // Add skill-specific requirements
    let additional = '';
    if (skillText.includes('markdown')) {
      additional += ' Output should be in proper Markdown format.';
    }
    if (skillText.includes('step') || skillText.includes(' numbered')) {
      additional += ' Present findings as numbered steps.';
    }
    if (skillText.includes('file')) {
      additional += ' Reference specific file paths and line numbers.';
    }
    
    return base + additional;
  }
  
  /**
   * Extract key phrases from skill text
   */
  extractKeywords(text) {
    // Extract code-related terms
    const patterns = [
      /(?:function|class|method|module)\s+(\w+)/g,
      /`(\w+)`/g,
      /var\s+(\w+)/g,
      /const\s+(\w+)/g,
      /let\s+(\w+)/g,
    ];
    
    const keywords = [];
    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const word = match[1];
        if (word.length > 3 && !keywords.includes(word)) {
          keywords.push(word);
        }
      }
    }
    
    return keywords.length > 0 ? keywords : ['example'];
  }
  
  /**
   * Fisher-Yates shuffle
   */
  shuffle(array) {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
}

/**
 * Generate test cases for a specific skill and save to dataset dir
 */
export async function generateSkillDataset(skillText, skillName, options = {}) {
  const builder = new SyntheticDatasetBuilder(options);
  const dataset = builder.generate(skillText, skillName);
  
  // Save
  const savePath = join(DATASET_DIR, skillName);
  mkdirSync(savePath, { recursive: true });
  dataset.save(savePath);
  
  return dataset;
}

/**
 * Load existing dataset for a skill
 */
export function loadSkillDataset(skillName) {
  const path = join(DATASET_DIR, skillName);
  if (existsSync(path)) {
    return EvalDataset.load(path);
  }
  return null;
}

export default {
  SyntheticDatasetBuilder,
  generateSkillDataset,
  loadSkillDataset,
  EvalDataset,
  EvalExample,
};
