/**
 * fitness_evaluator.mjs
 * 
 * LLM-as-Judge fitness evaluation for skill outputs.
 * Inspired by: hermes-agent-self-evolution/evolution/core/fitness.py
 * 
 * Given a task_input and expected_behavior rubric,
 * the LLM judges whether the prediction/output satisfies the criteria.
 */

import { existsSync, appendFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

/**
 * @typedef {Object} FitnessScore
 * @property {number} score - 0.0 to 1.0
 * @property {string} reasoning - Why this score
 * @property {string} model - Model used for evaluation
 */

/**
 * @typedef {Object} FitnessResult
 * @property {FitnessScore} baseline
 * @property {FitnessScore} evolved
 * @property {number} improvement
 * @property {string} verdict - 'improved'/'degraded'/'unchanged'
 */

const FITNESS_LOG = join(homedir(), '.openclaw', 'memory', 'evolution', 'fitness_log.jsonl');

/**
 * Parse expected behavior into criteria
 */
function parseCriteria(expectedBehavior) {
  const criteria = [];
  
  // Split on periods and semicolons
  const parts = expectedBehavior.split(/[.;]/).filter(p => p.trim().length > 10);
  
  for (const part of parts) {
    const trimmed = part.trim();
    
    // Detect criterion type
    let type = 'quality';
    if (trimmed.includes('should') || trimmed.includes('must')) {
      type = 'requirement';
    } else if (trimmed.includes('avoid') || trimmed.includes('not') || trimmed.includes('never')) {
      type = 'constraint';
    } else if (trimmed.includes('prefer') || trimmed.includes('recommend')) {
      type = 'preference';
    }
    
    criteria.push({ text: trimmed, type });
  }
  
  // Always add general quality criterion
  criteria.push({
    text: 'General quality: response is helpful, accurate, and well-structured',
    type: 'requirement',
  });
  
  return criteria;
}

/**
 * Judge a prediction against expected behavior
 * Uses structured LLM prompting (no actual API calls in this module)
 * 
 * @param {string} taskInput
 * @param {string} expectedBehavior
 * @param {string} prediction
 * @param {Object} options
 * @returns {FitnessScore}
 */
export async function judgeFitness(taskInput, expectedBehavior, prediction, options = {}) {
  const model = options.model || 'llm-judge';
  const criteria = parseCriteria(expectedBehavior);
  
  // Simulate LLM scoring (in real implementation, this would call an LLM API)
  let score = 0.5;
  let reasoning = '';
  
  // Check length appropriateness
  if (prediction.length < 10) {
    score = 0.1;
    reasoning = 'Response is too short';
  } else if (prediction.length > 5000) {
    score = 0.7; // Penalize very long responses slightly
    reasoning = 'Response is thorough';
  } else {
    score = 0.75;
    reasoning = 'Response length is appropriate';
  }
  
  // Check for criteria matches
  let criteriaMatched = 0;
  const criteriaChecks = [];
  
  for (const criterion of criteria) {
    const text = criterion.text.toLowerCase();
    
    // Simple heuristic checks
    let matched = false;
    let detail = '';
    
    if (criterion.type === 'requirement') {
      // Check for positive indicators
      if (text.includes('markdown') && prediction.includes('```')) matched = true;
      if (text.includes('file') && (prediction.includes('.') && prediction.includes('/'))) matched = true;
      if (text.includes('numbered') && (prediction.match(/\d+\./))) matched = true;
      if (text.includes('helpful') && prediction.length > 100) matched = true;
      if (text.includes('clear') && prediction.length > 50) matched = true;
      if (text.includes('describe') && prediction.length > 100) matched = true;
    } else if (criterion.type === 'constraint') {
      // Check constraint is not violated
      if (text.includes('avoid') && prediction.length < 200) matched = true;
      if (text.includes('not') && !prediction.includes('not')) matched = true;
    } else {
      // General quality check
      if (prediction.length > 50) {
        matched = true;
      }
    }
    
    if (matched) {
      criteriaMatched++;
      criteriaChecks.push({ criterion: criterion.text.slice(0, 50), matched: true });
    } else {
      criteriaChecks.push({ criterion: criterion.text.slice(0, 50), matched: false });
    }
  }
  
  // Calculate score
  score = criteriaMatched / Math.max(1, criteria.length);
  
  // Bonus for length appropriateness
  if (prediction.length > 50 && prediction.length < 2000) {
    score = Math.min(1.0, score + 0.1);
  }
  
  // Penalty for being empty or very short
  if (prediction.length < 20) {
    score = Math.max(0, score - 0.3);
  }
  
  reasoning = `${criteriaMatched}/${criteria.length} criteria met. ` +
    criteriaChecks.filter(c => c.matched).length + ' quality checks passed.';
  
  const result = {
    score: Math.round(score * 100) / 100,
    reasoning,
    model,
    timestamp: Date.now(),
    taskInput: taskInput.slice(0, 100),
  };
  
  // Log to file
  logFitness(taskInput, expectedBehavior, prediction, result);
  
  return result;
}

/**
 * Evaluate skill performance on a dataset
 * @param {Object} skillModule - Skill module with execute() or generate()
 * @param {EvalDataset} dataset
 * @param {Object} options
 * @returns {{avgScore: number, scores: FitnessScore[], datasetStats: Object}}
 */
export async function evaluateSkill(skillModule, dataset, options = {}) {
  const scores = [];
  
  for (const example of dataset.allExamples) {
    try {
      // Execute skill on task input
      const output = await executeSkill(skillModule, example.taskInput);
      
      // Judge fitness
      const fitnessScore = await judgeFitness(
        example.taskInput,
        example.expectedBehavior,
        output,
        options
      );
      
      scores.push({
        ...fitnessScore,
        taskInput: example.taskInput.slice(0, 50),
        difficulty: example.difficulty,
        category: example.category,
      });
    } catch (error) {
      scores.push({
        score: 0,
        reasoning: `Error: ${error.message}`,
        model: 'error',
        taskInput: example.taskInput.slice(0, 50),
        difficulty: example.difficulty,
        category: example.category,
      });
    }
  }
  
  // Calculate average
  const avgScore = scores.reduce((sum, s) => sum + s.score, 0) / Math.max(1, scores.length);
  
  // Stats by difficulty and category
  const byDifficulty = {};
  const byCategory = {};
  
  for (const s of scores) {
    byDifficulty[s.difficulty] = byDifficulty[s.difficulty] || [];
    byDifficulty[s.difficulty].push(s.score);
    
    byCategory[s.category] = byCategory[s.category] || [];
    byCategory[s.category].push(s.score);
  }
  
  const datasetStats = {
    byDifficulty: Object.fromEntries(
      Object.entries(byDifficulty).map(([k, v]) => [
        k,
        { avg: v.reduce((a, b) => a + b, 0) / v.length, count: v.length },
      ])
    ),
    byCategory: Object.fromEntries(
      Object.entries(byCategory).map(([k, v]) => [
        k,
        { avg: v.reduce((a, b) => a + b, 0) / v.length, count: v.length },
      ])
    ),
  };
  
  return { avgScore: Math.round(avgScore * 100) / 100, scores, datasetStats };
}

/**
 * Execute skill on input (placeholder - would integrate with actual skill system)
 */
async function executeSkill(skillModule, taskInput) {
  if (typeof skillModule.execute === 'function') {
    return await skillModule.execute(taskInput);
  }
  if (typeof skillModule.generate === 'function') {
    return await skillModule.generate(taskInput);
  }
  // Fallback: return task input as mock output
  return `[Mock output for: ${taskInput}]`;
}

/**
 * Compare baseline vs evolved skill
 * @param {Object} baselineSkill
 * @param {Object} evolvedSkill
 * @param {EvalDataset} dataset
 * @returns {FitnessResult}
 */
export async function compareSkills(baselineSkill, evolvedSkill, dataset) {
  const [baselineResult, evolvedResult] = await Promise.all([
    evaluateSkill(baselineSkill, dataset),
    evaluateSkill(evolvedSkill, dataset),
  ]);
  
  const improvement = evolvedResult.avgScore - baselineResult.avgScore;
  
  let verdict;
  if (improvement > 0.05) verdict = 'improved';
  else if (improvement < -0.05) verdict = 'degraded';
  else verdict = 'unchanged';
  
  return {
    baseline: { avgScore: baselineResult.avgScore, scores: baselineResult.scores },
    evolved: { avgScore: evolvedResult.avgScore, scores: evolvedResult.scores },
    improvement: Math.round(improvement * 100) / 100,
    verdict,
    datasetStats: evolvedResult.datasetStats,
  };
}

/**
 * Log fitness evaluation to file
 */
function logFitness(taskInput, expectedBehavior, prediction, result) {
  try {
    const logEntry = {
      type: 'fitness_eval',
      timestamp: Date.now(),
      taskInput,
      expectedBehavior,
      prediction: prediction.slice(0, 200),
      result,
    };
    appendFileSync(FITNESS_LOG, JSON.stringify(logEntry) + '\n');
  } catch (e) {
    // Ignore logging errors
  }
}

/**
 * Format fitness score as string
 */
export function formatFitnessScore(score) {
  const bar = '█'.repeat(Math.round(score.score * 10)) + '░'.repeat(10 - Math.round(score.score * 10));
  const color = score.score >= 0.7 ? 'green' : score.score >= 0.4 ? 'yellow' : 'red';
  return `[${color}]${bar}[/${color}] ${score.score.toFixed(2)} - ${score.reasoning}`;
}

/**
 * Format comparison result
 */
export function formatComparison(result) {
  const lines = [
    '## Fitness Comparison',
    '',
    `| Version | Avg Score |`,
    `|---------|-----------|`,
    `| Baseline | ${result.baseline.avgScore.toFixed(3)} |`,
    `| Evolved  | ${result.evolved.avgScore.toFixed(3)} |`,
    '',
    `**Improvement**: ${result.improvement >= 0 ? '+' : ''}${result.improvement.toFixed(3)}`,
    `**Verdict**: ${result.verdict}`,
  ];
  
  // By difficulty
  if (result.datasetStats?.byDifficulty) {
    lines.push('', '### By Difficulty');
    for (const [diff, stats] of Object.entries(result.datasetStats.byDifficulty)) {
      lines.push(`- ${diff}: ${stats.avg.toFixed(2)} (${stats.count})`);
    }
  }
  
  return lines.join('\n');
}

export default {
  judgeFitness,
  evaluateSkill,
  compareSkills,
  formatFitnessScore,
  formatComparison,
};
