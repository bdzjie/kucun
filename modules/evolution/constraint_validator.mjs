/**
 * constraint_validator.mjs
 * 
 * Constraint validation for evolved artifacts.
 * Inspired by: hermes-agent-self-evolution/evolution/core/constraints.py
 *              + Evolver/src/gep/mutation.js
 * 
 * Every candidate variant must pass ALL constraints before deployment.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

/**
 * @typedef {Object} ConstraintResult
 * @property {boolean} passed
 * @property {string} constraintName
 * @property {string} message
 * @property {string|null} details
 */

/**
 * @typedef {Object} EvolutionConstraints
 * @property {number} maxSkillSize - Default 15,000 chars
 * @property {number} maxToolDescSize - Default 500 chars
 * @property {number} maxParamDescSize - Default 200 chars
 * @property {number} maxPromptGrowth - Default 0.20 (20%)
 * @property {string[]} forbiddenPaths - Paths that cannot be modified
 * @property {string[]} forbiddenPatterns - Forbidden content patterns
 */

const DEFAULT_CONSTRAINTS = {
  maxSkillSize: 15_000,
  maxToolDescSize: 500,
  maxParamDescSize: 200,
  maxPromptGrowth: 0.20,
  forbiddenPaths: ['.git', 'node_modules', 'dist', 'package-lock.json'],
  forbiddenPatterns: [
    'eval\\s*\\(',
    'exec\\s*\\(',
    '__import__',
    'child_process',
    'subprocess',
    'process\.exit',
  ],
};

/**
 * Check skill structure: YAML frontmatter + name + description
 */
function checkSkillStructure(text) {
  const hasFrontmatter = text.trim().startsWith('---');
  
  // Extract frontmatter section
  let frontmatter = '';
  if (hasFrontmatter) {
    const endIdx = text.indexOf('---', 3);
    if (endIdx > 0) {
      frontmatter = text.slice(3, endIdx);
    }
  }
  
  const hasName = /name:\s*\S+/.test(frontmatter);
  const hasDescription = /description:\s*.+/.test(frontmatter);
  
  const missing = [];
  if (!hasFrontmatter) missing.push('YAML frontmatter (---)');
  if (!hasName) missing.push('name field');
  if (!hasDescription) missing.push('description field');
  
  return {
    passed: missing.length === 0,
    constraintName: 'skill_structure',
    message: missing.length === 0 
      ? 'Skill has valid frontmatter (name + description)'
      : `Skill missing: ${missing.join(', ')}`,
    details: missing.length > 0 ? missing.join(', ') : null,
  };
}

/**
 * Check size limit
 */
function checkSize(text, artifactType, limits = DEFAULT_CONSTRAINTS) {
  const size = text.length;
  let limit;
  
  switch (artifactType) {
    case 'skill':
      limit = limits.maxSkillSize;
      break;
    case 'tool_description':
      limit = limits.maxToolDescSize;
      break;
    case 'param_description':
      limit = limits.maxParamDescSize;
      break;
    default:
      limit = limits.maxSkillSize;
  }
  
  if (size <= limit) {
    return {
      passed: true,
      constraintName: 'size_limit',
      message: `Size OK: ${size}/${limit} chars`,
      details: null,
    };
  }
  
  return {
    passed: false,
    constraintName: 'size_limit',
    message: `Size exceeded: ${size}/${limit} chars (+${size - limit})`,
    details: `Over by ${size - limit} characters`,
  };
}

/**
 * Check growth limit (if baseline provided)
 */
function checkGrowth(text, baseline, limits = DEFAULT_CONSTRAINTS) {
  if (!baseline) {
    return { passed: true, constraintName: 'growth_limit', message: 'No baseline provided', details: null };
  }
  
  const growth = (text.length - baseline.length) / Math.max(1, baseline.length);
  const maxGrowth = limits.maxPromptGrowth;
  
  if (growth <= maxGrowth) {
    return {
      passed: true,
      constraintName: 'growth_limit',
      message: `Growth OK: ${(growth * 100).toFixed(1)}% (max ${(maxGrowth * 100).toFixed(1)}%)`,
      details: null,
    };
  }
  
  return {
    passed: false,
    constraintName: 'growth_limit',
    message: `Growth exceeded: ${(growth * 100).toFixed(1)}% (max ${(maxGrowth * 100).toFixed(1)}%)`,
    details: `Exceeded by ${((growth - maxGrowth) * 100).toFixed(1)}%`,
  };
}

/**
 * Check non-empty
 */
function checkNonEmpty(text) {
  const passed = text.trim().length > 0;
  return {
    passed,
    constraintName: 'non_empty',
    message: passed ? 'Artifact is non-empty' : 'Artifact is empty',
    details: null,
  };
}

/**
 * Check forbidden patterns (code injection, dangerous operations)
 */
function checkForbiddenPatterns(text, limits = DEFAULT_CONSTRAINTS) {
  const found = [];
  
  for (const pattern of limits.forbiddenPatterns) {
    try {
      const regex = new RegExp(pattern);
      if (regex.test(text)) {
        found.push(pattern);
      }
    } catch (e) {
      // Skip invalid regex
    }
  }
  
  if (found.length === 0) {
    return {
      passed: true,
      constraintName: 'forbidden_patterns',
      message: 'No forbidden patterns detected',
      details: null,
    };
  }
  
  return {
    passed: false,
    constraintName: 'forbidden_patterns',
    message: `Forbidden patterns detected: ${found.join(', ')}`,
    details: found.join('; '),
  };
}

/**
 * Check forbidden paths (cannot modify critical directories)
 */
function checkForbiddenPaths(files, limits = DEFAULT_CONSTRAINTS) {
  const found = [];
  
  for (const file of files) {
    for (const forbidden of limits.forbiddenPaths) {
      if (file.includes(forbidden)) {
        found.push(file);
      }
    }
  }
  
  if (found.length === 0) {
    return {
      passed: true,
      constraintName: 'forbidden_paths',
      message: 'No forbidden paths affected',
      details: null,
    };
  }
  
  return {
    passed: false,
    constraintName: 'forbidden_paths',
    message: `Forbidden paths affected: ${found.join(', ')}`,
    details: found.join('; '),
  };
}

/**
 * Main ConstraintValidator class
 */
export class ConstraintValidator {
  /**
   * @param {Partial<EvolutionConstraints>} customConstraints
   */
  constructor(customConstraints = {}) {
    this.constraints = { ...DEFAULT_CONSTRAINTS, ...customConstraints };
  }
  
  /**
   * Validate all constraints for an artifact
   * @param {string} text - Artifact text
   * @param {string} artifactType - 'skill' | 'tool_description' | 'param_description'
   * @param {string|null} baselineText - Baseline for growth comparison
   * @param {string[]} [files] - Files affected (for forbidden paths check)
   * @returns {ConstraintResult[]}
   */
  validateAll(text, artifactType, baselineText = null, files = []) {
    const results = [];
    
    results.push(checkSize(text, artifactType, this.constraints));
    results.push(checkNonEmpty(text));
    
    if (baselineText) {
      results.push(checkGrowth(text, baselineText, this.constraints));
    }
    
    if (artifactType === 'skill') {
      results.push(checkSkillStructure(text));
    }
    
    results.push(checkForbiddenPatterns(text, this.constraints));
    
    if (files.length > 0) {
      results.push(checkForbiddenPaths(files, this.constraints));
    }
    
    return results;
  }
  
  /**
   * Validate and return summary
   * @returns {{allPassed: boolean, results: ConstraintResult[]}}
   */
  validate(text, artifactType, baselineText = null, files = []) {
    const results = this.validateAll(text, artifactType, baselineText, files);
    const allPassed = results.every(r => r.passed);
    
    return { allPassed, results };
  }
  
  /**
   * Get constraint config
   */
  getConfig() {
    return { ...this.constraints };
  }
}

/**
 * Global constraint validator instance
 */
let _globalValidator = null;

export function getGlobalConstraintValidator() {
  if (!_globalValidator) {
    _globalValidator = new ConstraintValidator();
  }
  return _globalValidator;
}

/**
 * Quick validate function
 * @returns {{allPassed: boolean, results: ConstraintResult[]}}
 */
export function validateConstraints(text, artifactType, baselineText = null, files = []) {
  const validator = getGlobalConstraintValidator();
  return validator.validate(text, artifactType, baselineText, files);
}

/**
 * Format constraint results as string
 */
export function formatConstraintResults(results) {
  const lines = [];
  
  for (const r of results) {
    const icon = r.passed ? '✓' : '✗';
    const color = r.passed ? 'green' : 'red';
    lines.push(`  [${color}]${icon}[/${color}] ${r.constraintName}: ${r.message}`);
  }
  
  return lines.join('\n');
}

/**
 * Parse constraint config from skill frontmatter
 * SKILL.md can declare custom constraints:
 * 
 * ```
 * constraints:
 *   max_size: 20000
 *   max_growth: 0.30
 *   forbidden_paths:
 *     - .git
 *     - dist
 * ```
 */
export function parseConstraintConfig(frontmatterText) {
  const config = {};
  
  const maxSizeMatch = frontmatterText.match(/max_size:\s*(\d+)/);
  if (maxSizeMatch) config.maxSkillSize = parseInt(maxSizeMatch[1]);
  
  const maxGrowthMatch = frontmatterText.match(/max_growth:\s*([\d.]+)/);
  if (maxGrowthMatch) config.maxPromptGrowth = parseFloat(maxGrowthMatch[1]);
  
  const forbiddenMatch = frontmatterText.match(/forbidden_paths:\s*\n((?:\s*-\s*.+\n)*)/);
  if (forbiddenMatch) {
    const paths = forbiddenMatch[1]
      .split('\n')
      .map(l => l.match(/-\s*(.+)/)?.[1])
      .filter(Boolean);
    config.forbiddenPaths = paths;
  }
  
  return Object.keys(config).length > 0 ? config : null;
}

export default {
  ConstraintValidator,
  getGlobalConstraintValidator,
  validateConstraints,
  formatConstraintResults,
  parseConstraintConfig,
};
