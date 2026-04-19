/**
 * eval_dataset.mjs
 * 
 * Evaluation dataset with train/val/holdout splits.
 * Inspired by: hermes-agent-self-evolution/evolution/core/dataset_builder.py
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

/**
 * @typedef {Object} EvalExample
 * @property {string} taskInput - What the user asks
 * @property {string} expectedBehavior - Rubric — what a good response looks like
 * @property {string} difficulty - easy/medium/hard
 * @property {string} category - Category for stratified eval
 * @property {string} source - synthetic/sessiondb/golden
 */

/**
 * @typedef {Object} EvalDataset
 * @property {EvalExample[]} train
 * @property {EvalExample[]} val
 * @property {EvalExample[]} holdout
 */

const DATASET_DIR = join(homedir(), '.openclaw', 'memory', 'evolution', 'datasets');

/**
 * EvalExample class
 */
export class EvalExample {
  constructor({ taskInput, expectedBehavior, difficulty = 'medium', category = 'general', source = 'synthetic' }) {
    this.taskInput = taskInput;
    this.expectedBehavior = expectedBehavior;
    this.difficulty = difficulty;
    this.category = category;
    this.source = source;
  }
  
  toDict() {
    return {
      task_input: this.taskInput,
      expected_behavior: this.expectedBehavior,
      difficulty: this.difficulty,
      category: this.category,
      source: this.source,
    };
  }
  
  static fromDict(d) {
    return new EvalExample({
      taskInput: d.task_input || d.taskInput || '',
      expectedBehavior: d.expected_behavior || d.expectedBehavior || '',
      difficulty: d.difficulty || 'medium',
      category: d.category || 'general',
      source: d.source || 'synthetic',
    });
  }
}

/**
 * EvalDataset with train/val/holdout splits
 */
export class EvalDataset {
  constructor({ train = [], val = [], holdout = [] } = {}) {
    this.train = train.map(e => e instanceof EvalExample ? e : EvalExample.fromDict(e));
    this.val = val.map(e => e instanceof EvalExample ? e : EvalExample.fromDict(e));
    this.holdout = holdout.map(e => e instanceof EvalExample ? e : EvalExample.fromDict(e));
  }
  
  get allExamples() {
    return [...this.train, ...this.val, ...this.holdout];
  }
  
  get size() {
    return this.allExamples.length;
  }
  
  get trainSize() { return this.train.length; }
  get valSize() { return this.val.length; }
  get holdoutSize() { return this.holdout.length; }
  
  /**
   * Split ratios
   */
  split(ratio = [0.7, 0.15, 0.15]) {
    const [trainRatio, valRatio, holdoutRatio] = ratio;
    const all = this.allExamples;
    
    // Shuffle
    for (let i = all.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [all[i], all[j]] = [all[j], all[i]];
    }
    
    const n = all.length;
    const nTrain = Math.max(1, Math.floor(n * trainRatio));
    const nVal = Math.max(1, Math.floor(n * valRatio));
    
    return new EvalDataset({
      train: all.slice(0, nTrain),
      val: all.slice(nTrain, nTrain + nVal),
      holdout: all.slice(nTrain + nVal),
    });
  }
  
  /**
   * Save to directory as JSONL files
   */
  save(path) {
    const dir = path instanceof String ? path : path;
    mkdirSync(dir, { recursive: true });
    
    for (const [splitName, splitData] of [['train', this.train], ['val', this.val], ['holdout', this.holdout]]) {
      const filePath = join(dir, `${splitName}.jsonl`);
      const lines = splitData.map(e => JSON.stringify(e.toDict())).join('\n');
      writeFileSync(filePath, lines);
    }
  }
  
  /**
   * Load from directory
   */
  static load(path) {
    const dir = path instanceof String ? path : path;
    
    const ds = new EvalDataset();
    
    for (const splitName of ['train', 'val', 'holdout']) {
      const filePath = join(dir, `${splitName}.jsonl`);
      if (existsSync(filePath)) {
        const content = readFileSync(filePath, 'utf-8');
        const examples = content
          .split('\n')
          .filter(l => l.trim())
          .map(l => EvalExample.fromDict(JSON.parse(l)));
        setattr(ds, splitName, examples);
      }
    }
    
    return ds;
  }
  
  /**
   * Add an example
   */
  add(example, split = 'train') {
    const ex = example instanceof EvalExample ? example : EvalExample.fromDict(example);
    this[split].push(ex);
  }
  
  /**
   * Filter by difficulty
   */
  filterByDifficulty(difficulty) {
    return new EvalDataset({
      train: this.train.filter(e => e.difficulty === difficulty),
      val: this.val.filter(e => e.difficulty === difficulty),
      holdout: this.holdout.filter(e => e.difficulty === difficulty),
    });
  }
  
  /**
   * Filter by category
   */
  filterByCategory(category) {
    return new EvalDataset({
      train: this.train.filter(e => e.category === category),
      val: this.val.filter(e => e.category === category),
      holdout: this.holdout.filter(e => e.category === category),
    });
  }
  
  /**
   * Get statistics
   */
  getStats() {
    const byCategory = {};
    const byDifficulty = { easy: 0, medium: 0, hard: 0 };
    
    for (const ex of this.allExamples) {
      byCategory[ex.category] = (byCategory[ex.category] || 0) + 1;
      byDifficulty[ex.difficulty] = (byDifficulty[ex.difficulty] || 0) + 1;
    }
    
    return {
      total: this.size,
      train: this.trainSize,
      val: this.valSize,
      holdout: this.holdoutSize,
      byCategory,
      byDifficulty,
    };
  }
  
  /**
   * Format as markdown table
   */
  toMarkdown() {
    const stats = this.getStats();
    const lines = [
      `## EvalDataset: ${this.size} examples`,
      '',
      `| Split     | Count |`,
      `|-----------|-------|`,
      `| Train     | ${stats.train} |`,
      `| Val       | ${stats.val} |`,
      `| Holdout   | ${stats.holdout} |`,
      '',
      '### By Difficulty',
      `| Difficulty | Count |`,
      `|------------|-------|`,
      ...Object.entries(stats.byDifficulty).map(([k, v]) => `| ${k} | ${v} |`),
      '',
      '### By Category',
      `| Category | Count |`,
      `|----------|-------|`,
      ...Object.entries(stats.byCategory).map(([k, v]) => `| ${k} | ${v} |`),
    ];
    
    return lines.join('\n');
  }
}

// Make setattr work for dynamic property names
function setattr(obj, key, value) {
  obj[key] = value;
}

export default { EvalDataset, EvalExample };
