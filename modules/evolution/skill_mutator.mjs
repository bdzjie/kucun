/**
 * skill_mutator.mjs
 * 
 * Skill mutation system — generates variants of skill text.
 * Inspired by: hermes-agent-self-evolution evolution + Evolver GEP mutation
 * 
 * Mutations are genetic operations on skill text:
 * - prompt_tweak: Adjust wording in description/instructions
 * - expand: Add more detailed instructions
 * - condense: Remove redundant parts
 * - restructure: Reorganize sections
 * - specialize: Make more specific to a use case
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

/**
 * @typedef {Object} Mutation
 * @property {string} id
 * @property {string} type - prompt_tweak|expand|condense|restructure|specialize|clarify_example
 * @property {string} description
 * @property {string} mutatedText
 * @property {number} score - Fitness score if evaluated
 */

const MUTATION_DIR = join(homedir(), '.openclaw', 'memory', 'evolution', 'mutations');

/**
 * Parse skill frontmatter and body
 */
export function parseSkill(text) {
  if (!text.trim().startsWith('---')) {
    return { frontmatter: '', body: text, raw: text };
  }
  
  const endIdx = text.indexOf('---', 3);
  if (endIdx < 0) {
    return { frontmatter: '', body: text, raw: text };
  }
  
  return {
    frontmatter: text.slice(3, endIdx),
    body: text.slice(endIdx + 3).trim(),
    raw: text,
  };
}

/**
 * Reassemble skill from frontmatter and body
 */
export function reassembleSkill(frontmatter, body) {
  if (!frontmatter) return body;
  return `---\n${frontmatter}\n---\n\n${body}`;
}

/**
 * Extract frontmatter field
 */
function getFrontmatterField(frontmatter, field) {
  const regex = new RegExp(`${field}:\\s*(.+?)(?:\\n|$)`, 'i');
  const match = frontmatter.match(regex);
  return match ? match[1].trim() : null;
}

/**
 * Set or update frontmatter field
 */
function setFrontmatterField(frontmatter, field, value) {
  const regex = new RegExp(`^(${field}:\\s*).+`, 'im');
  if (regex.test(frontmatter)) {
    return frontmatter.replace(regex, `$1${value}`);
  }
  // Add new field
  return frontmatter + `\n${field}: ${value}`;
}

/**
 * Mutation types and their operations
 */
const MUTATION_TYPES = {
  prompt_tweak: {
    weight: 3,
    description: 'Adjust prompt wording for clarity',
    apply: (body, context) => tweakPrompt(body, context),
  },
  expand: {
    weight: 2,
    description: 'Add more detailed instructions',
    apply: (body, context) => expandInstructions(body, context),
  },
  condense: {
    weight: 1,
    description: 'Remove redundant parts',
    apply: (body, context) => condenseBody(body, context),
  },
  restructure: {
    weight: 1,
    description: 'Reorganize sections',
    apply: (body, context) => restructureBody(body, context),
  },
  specialize: {
    weight: 1,
    description: 'Focus on specific use case',
    apply: (body, context) => specializeBody(body, context),
  },
  clarify_example: {
    weight: 2,
    description: 'Add or improve examples',
    apply: (body, context) => clarifyWithExample(body, context),
  },
  add_constraint: {
    weight: 1,
    description: 'Add usage constraints',
    apply: (body, context) => addConstraint(body, context),
  },
};

/**
 * Get weighted random mutation type
 */
function getRandomMutationType() {
  const types = Object.entries(MUTATION_TYPES);
  const totalWeight = types.reduce((sum, [, def]) => sum + def.weight, 0);
  
  let rand = Math.random() * totalWeight;
  for (const [type, def] of types) {
    rand -= def.weight;
    if (rand <= 0) return type;
  }
  return 'prompt_tweak';
}

/**
 * Tweak prompt wording
 */
function tweakPrompt(body, context) {
  const tweaks = [
    [/Use (\w+) instead of/i, 'Prefer $1 over'],
    [/Make sure to/gi, 'Always'],
    [/Try to/gi, 'Do your best to'],
    [/Don't/gi, 'Never'],
    [/You can/gi, 'You should'],
    [/\bI think\b/gi, 'In my experience'],
    [/very\s+/gi, ''],
    [/\bactually\b/gi, ''],
  ];
  
  let result = body;
  for (const [from, to] of tweaks) {
    if (from.test(result)) {
      result = result.replace(from, to);
      break;
    }
  }
  
  return result;
}

/**
 * Expand instructions with more detail
 */
function expandInstructions(body, context) {
  // Add elaboration markers
  const expansions = [
    [/When (\w+),? (do|consider)/gi, 'When $1, $2 — especially consider edge cases where $1 might fail'],
    [/Make sure to (\w+)/gi, 'Make sure to $1. Critical: $1 must be verified before proceeding'],
    [/(Use|Run|Execute) `([^`]+)`/gi, '$1 `$2` and interpret the output carefully. Common issues: check exit code first'],
  ];
  
  let result = body;
  for (const [from, to] of expansions) {
    if (from.test(result)) {
      result = result.replace(from, to);
      return result;
    }
  }
  
  // Default: add detail section
  const detail = `\n\n**Detail**: Ensure all steps are completed in order. Verify each step's output before proceeding to the next.`;
  return body + detail;
}

/**
 * Condense body by removing redundancy
 */
function condenseBody(body, context) {
  // Remove redundant phrases
  const redundancies = [
    /In order to /g,
    /Basically /g,
    /\bVery\b /g,
    /\bQuite\b /g,
    /\bThat said\b,? /g,
    /, and so on\.\.\./g,
    /\betc\.?\b/gi,
  ];
  
  let result = body;
  for (const pattern of redundancies) {
    result = result.replace(pattern, '');
  }
  
  // Collapse multiple newlines
  result = result.replace(/\n{3,}/g, '\n\n');
  
  return result.trim();
}

/**
 * Restructure body sections
 */
function restructureBody(body, context) {
  // Split into paragraphs
  const paras = body.split(/\n\n+/);
  if (paras.length < 3) return body;
  
  // Shuffle middle sections (keep first and last)
  const first = paras[0];
  const middle = paras.slice(1, -1);
  const last = paras[paras.length - 1];
  
  // Shuffle middle
  for (let i = middle.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [middle[i], middle[j]] = [middle[j], middle[i]];
  }
  
  return [first, ...middle, last].join('\n\n');
}

/**
 * Specialize body to a specific use case
 */
function specializeBody(body, context) {
  const skillName = context?.skillName || 'this skill';
  
  // Add specialization note
  const note = `\n\n**Specialization**: This ${skillName} is optimized for ${context?.useCase || 'general use'}. For edge cases or unusual scenarios, use your best judgment.`;
  
  return body + note;
}

/**
 * Add example to clarify
 */
function clarifyWithExample(body, context) {
  const skillName = context?.skillName || 'this skill';
  
  const examples = [
    `\n\n**Example**:\nGiven input "foo bar", the output should be "foo bar (2 words)".`,
    `\n\n**Example**:\nInput: \`file.js:42\`\nOutput: Error at line 42: unexpected token`,
    `\n\n**Example**:\nWhen asked "list files": respond with a numbered list, one item per line.`,
  ];
  
  const example = examples[Math.floor(Math.random() * examples.length)];
  return body + example;
}

/**
 * Add constraint
 */
function addConstraint(body, context) {
  const constraints = [
    '\n\n**Constraint**: Never modify files outside the workspace directory.',
    '\n\n**Constraint**: Always confirm with the user before taking destructive actions.',
    '\n\n**Constraint**: If unsure, ask for clarification rather than guessing.',
    '\n\n**Constraint**: Keep responses concise — prefer bullet points over paragraphs.',
  ];
  
  const constraint = constraints[Math.floor(Math.random() * constraints.length)];
  return body + constraint;
}

/**
 * Main SkillMutator class
 */
export class SkillMutator {
  constructor(options = {}) {
    this.mutationTypes = options.mutationTypes || MUTATION_TYPES;
    this.maxRetries = options.maxRetries || 3;
  }
  
  /**
   * Generate a mutated variant of skill text
   * @param {string} skillText - Full skill text
   * @param {Object} context - Context for mutation
   * @param {string} [mutationType] - Force specific mutation type
   * @returns {Mutation}
   */
  mutate(skillText, context = {}, mutationType = null) {
    const type = mutationType || getRandomMutationType();
    const mutator = this.mutationTypes[type];
    
    if (!mutator) {
      throw new Error(`Unknown mutation type: ${type}`);
    }
    
    const { frontmatter, body } = parseSkill(skillText);
    
    let mutatedBody;
    let attempts = 0;
    
    do {
      mutatedBody = mutator.apply(body, context);
      attempts++;
    } while (mutatedBody === body && attempts < this.maxRetries);
    
    const mutatedText = reassembleSkill(frontmatter, mutatedBody);
    
    return {
      id: `mut_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type,
      description: mutator.description,
      mutatedText,
      originalText: skillText,
      score: null, // Set after fitness evaluation
    };
  }
  
  /**
   * Generate multiple variants
   * @param {string} skillText
   * @param {Object} context
   * @param {number} numVariants
   * @returns {Mutation[]}
   */
  generateVariants(skillText, context = {}, numVariants = 5) {
    const variants = [];
    const usedTypes = new Set();
    
    // Try to get diverse mutation types
    while (variants.length < numVariants) {
      let type;
      if (usedTypes.size < Object.keys(this.mutationTypes).length) {
        do {
          type = getRandomMutationType();
        } while (usedTypes.has(type));
        usedTypes.add(type);
      } else {
        type = null; // Random after we've used all types
      }
      
      try {
        const variant = this.mutate(skillText, context, type);
        variants.push(variant);
      } catch (e) {
        // Skip failed mutations
      }
    }
    
    return variants;
  }
  
  /**
   * Save mutation to disk
   */
  saveMutation(mutation, skillName) {
    const dir = join(MUTATION_DIR, skillName);
    mkdirSync(dir, { recursive: true });
    
    const filePath = join(dir, `${mutation.id}.json`);
    writeFileSync(filePath, JSON.stringify(mutation, null, 2));
    
    return filePath;
  }
  
  /**
   * Load mutation history
   */
  loadHistory(skillName) {
    const dir = join(MUTATION_DIR, skillName);
    if (!existsSync(dir)) return [];
    
    const files = require('fs').readdirSync(dir).filter(f => f.endsWith('.json'));
    const mutations = [];
    
    for (const file of files) {
      try {
        const content = readFileSync(join(dir, file), 'utf-8');
        mutations.push(JSON.parse(content));
      } catch (e) {
        // Skip invalid files
      }
    }
    
    return mutations.sort((a, b) => (b.id > a.id ? 1 : -1));
  }
}

/**
 * Global mutator instance
 */
let _globalMutator = null;

export function getGlobalSkillMutator() {
  if (!_globalMutator) {
    _globalMutator = new SkillMutator();
  }
  return _globalMutator;
}

export default {
  SkillMutator,
  getGlobalSkillMutator,
  parseSkill,
  reassembleSkill,
};
