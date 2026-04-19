/**
 * skill_optimizer.mjs
 * 
 * GEPA-style skill optimization loop.
 * Inspired by: hermes-agent-self-evolution/evolution/skills/evolve_skill.py
 *              + Evolver/src/gep/evolve.js
 * 
 * Flow:
 * 1. Load baseline skill
 * 2. Generate evaluation dataset
 * 3. Generate mutations (genetic population)
 * 4. Evaluate fitness (LLM-as-judge)
 * 5. Select best variants
 * 6. Repeat for N iterations
 * 7. Output best evolved skill
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

import { ConstraintValidator, validateConstraints, formatConstraintResults } from './constraint_validator.mjs';
import { SyntheticDatasetBuilder, loadSkillDataset } from './dataset_builder.mjs';
import { evaluateSkill, compareSkills, formatComparison } from './fitness_evaluator.mjs';
import { SkillMutator, parseSkill, reassembleSkill } from './skill_mutator.mjs';
import { EvalDataset } from './eval_dataset.mjs';

const OUTPUT_DIR = join(homedir(), '.openclaw', 'memory', 'evolution', 'output');

/**
 * @typedef {Object} OptimizationConfig
 * @property {number} iterations - Number of optimization iterations
 * @property {number} populationSize - Number of variants per generation
 * @property {number} eliteCount - Number of top variants to keep
 * @property {number} mutationRate - Probability of mutation
 * @property {boolean} runConstraints - Whether to run constraint validation
 * @property {boolean} saveHistory - Whether to save evolution history
 */

/**
 * @typedef {Object} OptimizationResult
 * @property {string} baselineSkill
 * @property {string} evolvedSkill
 * @property {Object} baselineScore
 * @property {Object} evolvedScore
 * @property {number} improvement
 * @property {string} verdict
 * @property {Object[]} generations - Per-generation data
 * @property {Object} config
 */

const DEFAULT_CONFIG = {
  iterations: 5,
  populationSize: 5,
  eliteCount: 1,
  mutationRate: 0.8,
  runConstraints: true,
  saveHistory: true,
};

/**
 * SkillOptimizer — GEPA-style optimization
 */
export class SkillOptimizer {
  constructor(config = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.constraintValidator = new ConstraintValidator();
    this.mutator = new SkillMutator();
    this.datasetBuilder = new SyntheticDatasetBuilder({
      numCases: this.config.evalDatasetSize || 20,
    });
  }
  
  /**
   * Run optimization
   * @param {string} skillText - Baseline skill text
   * @param {string} skillName - Skill name
   * @param {Object} context - Additional context
   * @returns {OptimizationResult}
   */
  async optimize(skillText, skillName, context = {}) {
    const { iterations, populationSize, eliteCount, runConstraints } = this.config;
    
    const generations = [];
    let currentPopulation = [{ text: skillText, score: null, isBaseline: true }];
    
    // Step 1: Generate or load evaluation dataset
    let dataset = loadSkillDataset(skillName);
    if (!dataset) {
      console.log(`Generating evaluation dataset for "${skillName}"...`);
      dataset = this.datasetBuilder.generate(skillText, skillName);
    }
    
    // Evaluate baseline
    console.log(`Evaluating baseline skill...`);
    const baselineResult = await evaluateSkill(
      { execute: (input) => `[${skillName}] ${input}` },
      dataset,
      { skillName }
    );
    
    currentPopulation[0].score = baselineResult.avgScore;
    console.log(`Baseline score: ${baselineResult.avgScore.toFixed(3)}`);
    
    // Step 2: Run optimization iterations
    for (let gen = 0; gen < iterations; gen++) {
      console.log(`\n=== Generation ${gen + 1}/${iterations} ===`);
      
      const newPopulation = [];
      
      // Keep elite variants from previous generation
      const sorted = [...currentPopulation].sort((a, b) => (b.score || 0) - (a.score || 0));
      const elites = sorted.slice(0, eliteCount);
      newPopulation.push(...elites);
      console.log(`Keeping ${elites.length} elite variant(s)`);
      
      // Generate new variants
      while (newPopulation.length < populationSize) {
        // Select parent (tournament selection)
        const parent = this.selectParent(currentPopulation);
        
        // Maybe mutate
        if (Math.random() < this.config.mutationRate) {
          const mutation = this.mutator.mutate(parent.text, { skillName, ...context });
          
          // Validate constraints
          if (runConstraints) {
            const validation = validateConstraints(mutation.mutatedText, 'skill', parent.text);
            if (!validation.allPassed) {
              console.log(`  [Constraint REJECTED] ${mutation.type}`);
              continue; // Skip invalid mutations
            }
            console.log(`  [${mutation.type}] passed constraints`);
          }
          
          newPopulation.push({
            text: mutation.mutatedText,
            parentId: parent.id || 'baseline',
            mutationType: mutation.type,
            score: null, // Will be evaluated
          });
        } else {
          // Copy without mutation
          newPopulation.push({
            text: parent.text,
            parentId: parent.id || 'baseline',
            mutationType: 'copy',
            score: parent.score,
          });
        }
      }
      
      // Evaluate new population
      console.log(`Evaluating ${newPopulation.length} variants...`);
      for (const variant of newPopulation) {
        if (variant.score !== null) continue; // Already scored (elite)
        
        try {
          const result = await evaluateSkill(
            { execute: (input) => `[${skillName}] ${input}` },
            dataset,
            { skillName }
          );
          variant.score = result.avgScore;
          console.log(`  ${variant.mutationType}: ${variant.score.toFixed(3)}`);
        } catch (e) {
          variant.score = 0;
          console.log(`  ${variant.mutationType}: ERROR ${e.message}`);
        }
      }
      
      // Sort and记录generation
      newPopulation.sort((a, b) => (b.score || 0) - (a.score || 0));
      generations.push({
        generation: gen + 1,
        population: newPopulation.map(v => ({
          type: v.mutationType,
          parent: v.parentId,
          score: v.score,
        })),
        bestScore: newPopulation[0].score,
      });
      
      console.log(`Best in gen ${gen + 1}: ${newPopulation[0].score.toFixed(3)}`);
      
      currentPopulation = newPopulation;
    }
    
    // Get best evolved skill
    const bestVariant = currentPopulation[0];
    const evolvedSkill = bestVariant.text;
    
    // Final comparison
    const improvement = (bestVariant.score || 0) - baselineResult.avgScore;
    const verdict = improvement > 0.05 ? 'improved' : improvement < -0.05 ? 'degraded' : 'unchanged';
    
    // Save output
    if (this.config.saveHistory) {
      this.saveOutput(skillName, {
        baselineSkill: skillText,
        evolvedSkill,
        baselineScore: baselineResult.avgScore,
        evolvedScore: bestVariant.score,
        improvement,
        verdict,
        generations,
        config: this.config,
        dataset: dataset.getStats(),
      });
    }
    
    return {
      baselineSkill: skillText,
      evolvedSkill,
      baselineScore: baselineResult.avgScore,
      evolvedScore: bestVariant.score,
      improvement,
      verdict,
      generations,
      config: this.config,
      datasetStats: dataset.getStats(),
    };
  }
  
  /**
   * Tournament selection
   */
  selectParent(population) {
    const tournamentSize = Math.min(3, population.length);
    const indices = [];
    
    while (indices.length < tournamentSize) {
      const idx = Math.floor(Math.random() * population.length);
      if (!indices.includes(idx)) indices.push(idx);
    }
    
    let best = null;
    for (const idx of indices) {
      const candidate = population[idx];
      if (!best || (candidate.score || 0) > (best.score || 0)) {
        best = candidate;
      }
    }
    
    return best;
  }
  
  /**
   * Save optimization output
   */
  saveOutput(skillName, result) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const dir = join(OUTPUT_DIR, skillName, timestamp);
    mkdirSync(dir, { recursive: true });
    
    writeFileSync(join(dir, 'evolved_skill.md'), result.evolvedSkill);
    writeFileSync(join(dir, 'baseline_skill.md'), result.baselineSkill);
    writeFileSync(join(dir, 'metrics.json'), JSON.stringify({
      skillName,
      timestamp,
      baselineScore: result.baselineScore,
      evolvedScore: result.evolvedScore,
      improvement: result.improvement,
      verdict: result.verdict,
      generations: result.generations,
      datasetStats: result.datasetStats,
    }, null, 2));
    
    console.log(`\nOutput saved to: ${dir}`);
  }
}

/**
 * Run quick evolution (single generation)
 */
export async function quickEvolve(skillText, skillName, options = {}) {
  const optimizer = new SkillOptimizer({ iterations: 1, populationSize: 3, ...options });
  return await optimizer.optimize(skillText, skillName, options.context);
}

/**
 * Format optimization result as markdown
 */
export function formatOptimizationResult(result) {
  const lines = [
    '# Skill Evolution Results',
    '',
    `**Skill**: ${result.evolvedSkill ? 'evolved' : 'baseline'}`,
    `**Verdict**: ${result.verdict}`,
    '',
    '## Scores',
    `| Version | Score |`,
    `|---------|-------|`,
    `| Baseline | ${(result.baselineScore || 0).toFixed(3)} |`,
    `| Evolved  | ${(result.evolvedScore || 0).toFixed(3)} |`,
    '',
    `**Improvement**: ${result.improvement >= 0 ? '+' : ''}${result.improvement.toFixed(3)}`,
  ];
  
  if (result.generations?.length > 0) {
    lines.push('', '## Generations');
    for (const gen of result.generations) {
      lines.push(`### Generation ${gen.generation}`);
      lines.push(`Best score: ${gen.bestScore.toFixed(3)}`);
      for (const variant of gen.population) {
        lines.push(`- ${variant.type}: ${variant.score?.toFixed(3) || 'N/A'}`);
      }
    }
  }
  
  if (result.datasetStats) {
    lines.push('', '## Dataset');
    lines.push(`Total examples: ${result.datasetStats.total}`);
    lines.push(`Train/Val/Holdout: ${result.datasetStats.train}/${result.datasetStats.val}/${result.datasetStats.holdout}`);
  }
  
  return lines.join('\n');
}

export default {
  SkillOptimizer,
  quickEvolve,
  formatOptimizationResult,
};
