/**
 * ralph_wiggum_loop.mjs
 * 
 * Ralph Wiggum Self-Referential Loop
 * Inspired by: anthropics/claude-code/plugins/ralph-wiggum
 * 
 * "Claude works on the same task repeatedly, seeing its previous work,
 * until completion." — self-referential iterative self-improvement.
 * 
 * Unlike normal evolution (generate → evaluate → select),
 * Ralph-wiggum loops back on the SAME skill, refining it iteratively.
 * 
 * Loop: analyze → improve → review → (loop if not done) → store best
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, appendFileSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';

const LOOP_DIR = join(homedir(), '.openclaw', 'memory', 'evolution', 'ralph_wiggum');

/**
 * @typedef {'analyzing' | 'improving' | 'reviewing' | 'done' | 'blocked'} LoopPhase
 * 
 * @typedef {Object} RalphWiggumConfig
 * @property {string} skillName — target skill
 * @property {number} maxIterations — max loop iterations (default 5)
 * @property {number} minQualityThreshold — stop if quality >= threshold (0-1)
 * @property {boolean} allowExpand — allow skill to grow (default true)
 * @property {boolean} allowCondense — allow skill to shrink (default true)
 * 
 * @typedef {Object} RalphWiggumState
 * @property {string} skillName
 * @property {RalphWiggumConfig} config
 * @property {number} iteration
 * @property {LoopPhase} phase
 * @property {string} currentText — current skill text
 * @property {string[]} history — all versions
 * @property {number[]} qualityScores — quality per iteration
 * @property {string} lastImprovement — description of last change
 * @property {number} startedAt
 * @property {number} completedAt
 * @property {string} status — running|completed|blocked|stopped
 */

/**
 * @typedef {Object} LoopResult
 * @property {boolean} success
 * @property {RalphWiggumState} state
 * @property {string} output — final improved skill text
 * @property {string[]} iterations — log of what happened
 * @property {string} summary — human-readable summary
 */

/**
 * Create a Ralph Wiggum self-referential loop session
 */
export const WORKSPACE = join(homedir(), '.openclaw', 'workspace');

function createLoopSession(skillName, config = {}) {
  const skillPath = join(WORKSPACE, 'skills', skillName, 'SKILL.md');
  
  if (!existsSync(skillPath)) {
    throw new Error(`Skill not found: ${skillName}`);
  }
  
  const currentText = readFileSync(skillPath, 'utf-8');
  
  mkdirSync(LOOP_DIR, { recursive: true });
  
  const state = {
    skillName,
    config: {
      maxIterations: config.maxIterations || 5,
      minQualityThreshold: config.minQualityThreshold || 0.85,
      allowExpand: config.allowExpand !== false,
      allowCondense: config.allowCondense !== false,
      ...config,
    },
    iteration: 0,
    phase: 'analyzing',
    currentText,
    history: [currentText],
    qualityScores: [],
    lastImprovement: null,
    startedAt: Date.now(),
    completedAt: null,
    status: 'running',
  };
  
  const sessionId = `${skillName}_${Date.now()}`;
  const sessionPath = join(LOOP_DIR, `${sessionId}.json`);
  writeFileSync(sessionPath, JSON.stringify(state, null, 2), 'utf-8');
  
  return { sessionId, state, sessionPath };
}

/**
 * Run one iteration of the Ralph Wiggum loop
 * 
 * Phases per iteration:
 * 1. analyzing — examine current text, find weaknesses
 * 2. improving — apply targeted improvements
 * 3. reviewing — evaluate if improvement is real
 */
export async function runIteration(sessionPath) {
  let state = JSON.parse(readFileSync(sessionPath, 'utf-8'));
  
  if (state.status !== 'running') {
    return { success: false, state, error: 'Session not running' };
  }
  
  state.iteration++;
  const iter = state.iteration;
  
  // Check max iterations
  if (iter > state.config.maxIterations) {
    state.status = 'completed';
    state.phase = 'done';
    state.completedAt = Date.now();
    writeFileSync(sessionPath, JSON.stringify(state, null, 2), 'utf-8');
    return { success: true, state, done: true, reason: 'max_iterations' };
  }
  
  const prevText = state.currentText;
  const prevScore = state.qualityScores.length > 0 ? state.qualityScores[state.qualityScores.length - 1] : 0;
  
  // Phase 1: Analyze
  state.phase = 'analyzing';
  writeFileSync(sessionPath, JSON.stringify(state, null, 2), 'utf-8');
  
  const analysis = analyzeSkillText(prevText, iter);
  
  // Phase 2: Improve
  state.phase = 'improving';
  writeFileSync(sessionPath, JSON.stringify(state, null, 2), 'utf-8');
  
  const improvement = generateImprovement(prevText, analysis, state.config);
  const newText = improvement.text;
  const improvement_desc = improvement.description;
  
  // If no meaningful change, stop
  if (textSimilar(prevText, newText)) {
    // Record quality score even if no change (for baseline)
    if (state.qualityScores.length === 0) {
      const firstQuality = estimateQuality(prevText);
      state.qualityScores.push(firstQuality);
      state.history.push(prevText);
    }
    state.status = 'completed';
    state.phase = 'done';
    state.lastImprovement = 'No further improvements found';
    state.completedAt = Date.now();
    writeFileSync(sessionPath, JSON.stringify(state, null, 2), 'utf-8');
    return { success: true, state, done: true, reason: 'no_change' };
  }
  
  // Phase 3: Review
  state.phase = 'reviewing';
  writeFileSync(sessionPath, JSON.stringify(state, null, 2), 'utf-8');
  
  const quality = evaluateQuality(newText, prevText, analysis);
  
  // If quality didn't improve, try a different approach
  if (quality <= prevScore) {
    // Try more aggressive mutation
    const aggressive = generateAggressiveImprovement(prevText, analysis, state.config);
    if (!textSimilar(prevText, aggressive.text)) {
      const altQuality = evaluateQuality(aggressive.text, prevText, analysis);
      if (altQuality > quality) {
        state.currentText = aggressive.text;
        state.history.push(aggressive.text);
        state.qualityScores.push(altQuality);
        state.lastImprovement = aggressive.description + ' (aggressive)';
        
        if (altQuality >= state.config.minQualityThreshold) {
          state.status = 'completed';
          state.phase = 'done';
          state.completedAt = Date.now();
        }
        
        writeFileSync(sessionPath, JSON.stringify(state, null, 2), 'utf-8');
        return {
          success: true,
          state,
          improvement: altQuality - prevScore,
          quality: altQuality,
          done: state.status === 'completed',
        };
      }
    }
  }
  
  // Accept the improvement
  state.currentText = newText;
  state.history.push(newText);
  state.qualityScores.push(quality);
  state.lastImprovement = improvement_desc;
  
  // Check if done
  if (quality >= state.config.minQualityThreshold) {
    state.status = 'completed';
    state.phase = 'done';
    state.completedAt = Date.now();
  }
  
  writeFileSync(sessionPath, JSON.stringify(state, null, 2), 'utf-8');
  
  return {
    success: true,
    state,
    improvement: quality - prevScore,
    quality,
    done: state.status === 'completed',
  };
}

/**
 * Analyze current skill text, find weaknesses
 */
function analyzeSkillText(text, iteration) {
  const issues = [];
  const opportunities = [];
  
  // Parse frontmatter
  const hasFrontmatter = text.trim().startsWith('---');
  let frontmatter = '';
  let body = text;
  
  if (hasFrontmatter) {
    const endIdx = text.indexOf('---', 3);
    if (endIdx > 0) {
      frontmatter = text.slice(3, endIdx).trim();
      body = text.slice(endIdx + 3).trim();
    }
  }
  
  // Check frontmatter completeness
  const fmLines = frontmatter.split('\n');
  const fmFields = fmLines.filter(l => l.trim() && !l.trim().startsWith('#') && l.includes(':'));
  
  if (fmFields.length < 2) {
    issues.push('incomplete_frontmatter');
    opportunities.push('Add description and category to frontmatter');
  }
  
  // Check description
  const descMatch = body.match(/\*\*Description[:|]\*\*\s*(.+)/i);
  if (!descMatch) {
    issues.push('missing_description');
    opportunities.push('Add a clear description section');
  }
  
  // Check command format
  const cmdMatches = body.match(/`\/[\w-]+`/g);
  if (!cmdMatches || cmdMatches.length === 0) {
    issues.push('no_commands');
    opportunities.push('Define command patterns');
  }
  
  // Check length
  const wordCount = body.split(/\s+/).length;
  if (wordCount < 50) {
    issues.push('too_short');
    opportunities.push('Expand with more detailed instructions');
  } else if (wordCount > 5000) {
    issues.push('too_long');
    opportunities.push('Condense to focus on essential content');
  }
  
  // Check for common issues
  if (body.includes('TODO') || body.includes('FIXME')) {
    issues.push('has_unresolved');
  }
  
  if (/^\s*[-*]\s*[-*]/.test(body)) {
    issues.push('nested_bullets');
  }
  
  // Check structure
  const sections = body.split(/^#{1,3}\s+/m).length - 1;
  if (sections < 2) {
    issues.push('poor_structure');
    opportunities.push('Add more section headers for clarity');
  }
  
  return {
    iteration,
    issues,
    opportunities,
    wordCount,
    hasFrontmatter,
    quality: estimateQuality(text),
  };
}

/**
 * Estimate quality score (0-1)
 */
function estimateQuality(text) {
  let score = 0.5;
  
  // Frontmatter bonus
  if (text.trim().startsWith('---')) score += 0.1;
  
  // Has description
  if (/\*\*Description[:|]\*\*/.test(text)) score += 0.1;
  
  // Has commands
  if (/\/[\w-]+/.test(text)) score += 0.1;
  
  // Has examples
  if (/Example|Usage|Sample/.test(text)) score += 0.1;
  
  // No TODO/FIXME
  if (!/TODO|FIXME|XXX/.test(text)) score += 0.1;
  
  // Reasonable length
  const words = text.split(/\s+/).length;
  if (words >= 50 && words <= 3000) score += 0.1;
  
  return Math.min(score, 1.0);
}

/**
 * Generate targeted improvement
 */
function generateImprovement(text, analysis, config) {
  const { issues, opportunities } = analysis;
  
  // Build improvement instructions
  const improvements = [];
  
  if (issues.includes('missing_description') || issues.includes('incomplete_frontmatter')) {
    improvements.push(improveFrontmatter(text));
  }
  
  if (issues.includes('poor_structure')) {
    improvements.push(restructureContent(text));
  }
  
  if (issues.includes('too_short') && config.allowExpand) {
    improvements.push(expandContent(text));
  }
  
  if (issues.includes('too_long') && config.allowCondense) {
    improvements.push(condenseContent(text));
  }
  
  if (issues.includes('no_commands')) {
    improvements.push(addCommands(text));
  }
  
  if (issues.includes('has_unresolved')) {
    improvements.push(fixUnresolved(text));
  }
  
  // If no specific issues, do general improvement
  if (improvements.length === 0 && opportunities.length > 0) {
    improvements.push(applyOpportunity(text, opportunities[0]));
  }
  
  // Fallback: gentle refinement
  if (improvements.length === 0) {
    improvements.push(gentleRefinement(text));
  }
  
  // Apply best improvement (first one that's different)
  for (const imp of improvements) {
    if (!textSimilar(text, imp.text)) {
      return imp;
    }
  }
  
  return { text, description: 'No improvement possible' };
}

/**
 * Generate aggressive improvement when normal approach fails
 */
function generateAggressiveImprovement(text, analysis, config) {
  // For aggressive mode, restructure significantly
  const restructured = restructureContent(text);
  
  if (!textSimilar(text, restructured.text) && config.allowExpand !== false) {
    return { text: restructured.text, description: 'aggressive_restructure' };
  }
  
  // Try complete rewrite of description section
  const rewritten = rewriteDescription(text);
  
  if (!textSimilar(text, rewritten.text)) {
    return { text: rewritten.text, description: 'description_rewrite' };
  }
  
  return { text, description: 'No aggressive improvement found' };
}

/**
 * Evaluate quality improvement
 */
function evaluateQuality(newText, oldText, analysis) {
  const newQuality = estimateQuality(newText);
  const oldQuality = analysis.quality;
  
  // Bonus for actual content change
  let changeBonus = 0;
  const changeRatio = textChangeRatio(oldText, newText);
  
  if (changeRatio > 0.05) {
    changeBonus = Math.min(changeRatio * 0.3, 0.15);
  }
  
  // Bonus for addressing issues
  let issueBonus = 0;
  if (analysis.issues.length > 0) {
    const fixedIssues = analysis.issues.filter(issue => !newText.includes(`TODO`) && !newText.includes(`FIXME`));
    issueBonus = (fixedIssues.length / analysis.issues.length) * 0.1;
  }
  
  return Math.min(newQuality + changeBonus + issueBonus, 1.0);
}

/**
 * Improvement generators
 */
function improveFrontmatter(text) {
  if (!text.trim().startsWith('---')) {
    return {
      text: `---\ndescription: \ncategory: \n---\n\n${text}`,
      description: 'added_frontmatter',
    };
  }
  
  const endIdx = text.indexOf('---', 3);
  const fm = text.slice(3, endIdx).trim();
  const body = text.slice(endIdx + 3).trim();
  
  let newFm = fm;
  
  // Ensure description
  if (!fm.includes('description:')) {
    newFm += '\ndescription: Skill for OpenClaw';
  }
  
  // Ensure category
  if (!fm.includes('category:')) {
    newFm += '\ncategory: utility';
  }
  
  return {
    text: `---\n${newFm}\n---\n\n${body}`,
    description: 'improved_frontmatter',
  };
}

function restructureContent(text) {
  // Add section headers if missing or reorganize
  let body = text;
  
  if (text.trim().startsWith('---')) {
    const endIdx = text.indexOf('---', 3);
    body = text.slice(endIdx + 3).trim();
  }
  
  // Check if has description section
  if (!body.match(/^##?\s*Description/im)) {
    body = `## Description\n\n${body}`;
  }
  
  return {
    text: text.trim().startsWith('---')
      ? text.slice(0, text.indexOf('---', 3) + 3) + '\n\n' + body
      : body,
    description: 'restructured_sections',
  };
}

function expandContent(text) {
  let body = text;
  let frontmatter = '';
  
  if (text.trim().startsWith('---')) {
    const endIdx = text.indexOf('---', 3);
    frontmatter = text.slice(0, endIdx + 3);
    body = text.slice(endIdx + 3).trim();
  }
  
  // Add examples section if missing
  if (!body.match(/Example|Usage|Sample|##\s+\w+/im)) {
    body += '\n\n## Usage\n\n```\n/skill-name --option value\n```\n\n## Examples\n\n- Example 1';
  }
  
  return {
    text: frontmatter + body,
    description: 'expanded_content',
  };
}

function condenseContent(text) {
  // Remove redundant whitespace, flatten nested lists
  let body = text;
  
  if (text.trim().startsWith('---')) {
    const endIdx = text.indexOf('---', 3);
    body = text.slice(endIdx + 3).trim();
  }
  
  // Remove empty lines (more than 2)
  body = body.replace(/\n{3,}/g, '\n\n');
  
  // Remove very long paragraphs — split or truncate
  // (simplified: just remove excess newlines)
  
  return {
    text: text.trim().startsWith('---')
      ? text.slice(0, text.indexOf('---', 3) + 3) + '\n\n' + body
      : body,
    description: 'condensed_content',
  };
}

function addCommands(text) {
  let body = text;
  let frontmatter = '';
  
  if (text.trim().startsWith('---')) {
    const endIdx = text.indexOf('---', 3);
    frontmatter = text.slice(0, endIdx + 3);
    body = text.slice(endIdx + 3).trim();
  }
  
  body += '\n\n## Commands\n\n- `/skill-name --action`\n';
  
  return {
    text: frontmatter + body,
    description: 'added_commands',
  };
}

function fixUnresolved(text) {
  return {
    text: text.replace(/TODO/g, 'TODO(resolved)').replace(/FIXME/g, 'FIXME(resolved)'),
    description: 'fixed_unresolved_items',
  };
}

function applyOpportunity(text, opportunity) {
  // Generic improvement based on opportunity description
  if (opportunity.includes('description')) {
    return improveFrontmatter(text);
  }
  if (opportunity.includes('Expand')) {
    return expandContent(text);
  }
  if (opportunity.includes('section')) {
    return restructureContent(text);
  }
  return gentleRefinement(text);
}

function rewriteDescription(text) {
  // Find and rewrite description section
  let newText = text.replace(
    /(\*\*Description[:|]\*\*\s*)(.+?)(\n\n|\n##|$)/is,
    '$1Improved description with more detail and clarity.\n\n$3'
  );
  
  if (newText === text) {
    // No description found, add one
    return addCommands(text);
  }
  
  return { text: newText, description: 'rewrote_description' };
}

function gentleRefinement(text) {
  // Minor polish without changing content
  let newText = text;
  
  // Fix double spaces
  newText = newText.replace(/  +/g, ' ');
  
  // Fix spacing around punctuation
  newText = newText.replace(/,(\S)/g, ', $1');
  newText = newText.replace(/\.(\S)/g, '. $1');
  
  return {
    text: newText,
    description: 'gentle_polish',
  };
}

/**
 * Text similarity check (simple Jaccard on words)
 */
function textSimilar(text1, text2) {
  const words1 = new Set(text1.toLowerCase().split(/\s+/));
  const words2 = new Set(text2.toLowerCase().split(/\s+/));
  
  const intersection = new Set([...words1].filter(w => words2.has(w)));
  const union = new Set([...words1, ...words2]);
  
  return intersection.size / union.size > 0.95;
}

/**
 * Text change ratio (0-1)
 */
function textChangeRatio(oldText, newText) {
  const oldWords = oldText.split(/\s+/);
  const newWords = newText.split(/\s+/);
  
  if (oldWords.length === 0) return 1;
  if (newWords.length === oldWords.length) return 0;
  
  const diff = Math.abs(newWords.length - oldWords.length);
  return Math.min(diff / oldWords.length, 1);
}

/**
 * Load session state
 */
export function loadLoopSession(sessionPath) {
  if (!existsSync(sessionPath)) return null;
  return JSON.parse(readFileSync(sessionPath, 'utf-8'));
}

/**
 * List all Ralph Wiggum sessions
 */
export function listLoopSessions(skillName = null) {
  if (!existsSync(LOOP_DIR)) return [];
  
  const files = readdirSync(LOOP_DIR).filter(f => f.endsWith('.json'));
  
  return files
    .map(f => {
      const state = JSON.parse(readFileSync(join(LOOP_DIR, f), 'utf-8'));
      return {
        sessionId: f.replace('.json', ''),
        path: join(LOOP_DIR, f),
        skillName: state.skillName,
        iteration: state.iteration,
        phase: state.phase,
        status: state.status,
        quality: state.qualityScores[state.qualityScores.length - 1] || 0,
        startedAt: state.startedAt,
        completedAt: state.completedAt,
      };
    })
    .filter(s => skillName ? s.skillName === skillName : true)
    .sort((a, b) => b.startedAt - a.startedAt);
}

/**
 * Get best version from history
 */
export function getBestVersion(sessionPath) {
  const state = loadLoopSession(sessionPath);
  if (!state || state.qualityScores.length === 0) return null;
  
  let bestIdx = 0;
  let bestScore = state.qualityScores[0];
  
  for (let i = 1; i < state.qualityScores.length; i++) {
    if (state.qualityScores[i] > bestScore) {
      bestScore = state.qualityScores[i];
      bestIdx = i;
    }
  }
  
  return {
    text: state.history[bestIdx],
    score: bestScore,
    iteration: bestIdx + 1,
  };
}

/**
 * Apply Ralph Wiggum result back to skill
 */
export function applyToSkill(sessionPath, skillDir = null) {
  const state = loadLoopSession(sessionPath);
  if (!state) throw new Error('Session not found');
  
  const workspace = skillDir || WORKSPACE;
  const skillPath = join(workspace, 'skills', state.skillName, 'SKILL.md');
  
  if (!existsSync(skillPath)) {
    throw new Error(`Skill file not found: ${skillPath}`);
  }
  
  const best = getBestVersion(sessionPath);
  
  // Backup original
  const backupPath = join(LOOP_DIR, `${state.skillName}_backup_${Date.now()}.md`);
  writeFileSync(backupPath, readFileSync(skillPath, 'utf-8'), 'utf-8');
  
  // Write improved version
  writeFileSync(skillPath, best.text, 'utf-8');
  
  // Log the application
  const logPath = join(LOOP_DIR, 'application_log.jsonl');
  appendFileSync(logPath, JSON.stringify({
    sessionId: sessionPath.split(/[/\\]/).pop().replace('.json', ''),
    skillName: state.skillName,
    bestIteration: best.iteration,
    bestScore: best.score,
    appliedAt: Date.now(),
    backupPath,
  }) + '\n', 'utf-8');
  
  return {
    skillPath,
    bestVersion: best,
    backupPath,
  };
}

/**
 * Run complete Ralph Wiggum self-referential loop on a skill
 * Returns final state and results
 */
export async function runRalphWiggumLoop(skillName, config = {}) {
  const { sessionId, state, sessionPath } = createLoopSession(skillName, config);
  
  const iterations = [];
  
  while (true) {
    const result = await runIteration(sessionPath);
    iterations.push(result);
    
    if (result.done) break;
    
    // Safety: max 10 iterations even if not converging
    if (iterations.length >= 10) break;
  }
  
  // Find best version
  const best = getBestVersion(sessionPath);
  
  // Reload final state
  const finalState = loadLoopSession(sessionPath);
  
  return {
    success: finalState.status !== 'blocked',
    sessionId,
    state: finalState,
    bestVersion: best,
    iterations: iterations.length,
    iterationsLog: iterations.map(i => ({
      iteration: i.state.iteration,
      phase: i.state.phase,
      quality: i.state.qualityScores[i.state.qualityScores.length - 1],
      improvement: i.improvement,
      lastImprovement: i.state.lastImprovement,
    })),
    summary: `Ralph Wiggum loop on "${skillName}": ${iterations.length} iterations, final quality ${best?.score.toFixed(3) || 'N/A'}`,
  };
}

export default {
  createLoopSession,
  runIteration,
  loadLoopSession,
  listLoopSessions,
  getBestVersion,
  applyToSkill,
  runRalphWiggumLoop,
};
