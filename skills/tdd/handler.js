/**
 * tdd skill handler
 * Test-Driven Development — Red/Green/Refactor workflow
 */

const args = process.argv.slice(2);
const command = args[0];

function showHelp() {
  return {
    handled: true,
    skill: 'tdd',
    response: `tdd — Test-Driven Development

Usage:
  /tdd [task-description]
  /tdd --prove-it [bug-description]

RED GREEN REFACTOR:
  1. RED — Write a test that FAILS
  2. GREEN — Write minimal code to make it pass
  3. REFACTOR — Clean up without changing behavior

Test Pyramid:
  Unit Tests (~80%) — Pure logic, milliseconds
  Integration Tests (~15%) — Component interactions
  E2E Tests (~5%) — Full user flows

Principles:
  - DAMP over DRY: Tests should read like specifications
  - State-based over interaction-based assertions
  - Beyonce Rule: "If you liked it, put a test on it"
  - Prove-It Pattern: For bug fixes, write failing test first

Examples:
  /tdd Create a task with title and default status
  /tdd --prove-it Completing a task doesn't update timestamp
`,
  };
}

async function main() {
  if (!command || command === '--help' || command === '-h') {
    console.log(JSON.stringify(showHelp()));
    return;
  }

  const isProveIt = command === '--prove-it';
  const target = isProveIt ? args[1] : command;

  const workflowGuide = isProveIt ? `# Prove-It Pattern (Bug Fix)

## Step 1: Write Reproduction Test (RED)
\`\`\`javascript
// Bug: "${target}"

it('${target}', async () => {
  // Set up the scenario
  const task = await taskService.createTask({ title: 'Test' });
  const completed = await taskService.completeTask(task.id);

  // This should FAIL — confirming the bug exists
  expect(completed.completedAt).toBeInstanceOf(Date);
});
\`\`\`

## Step 2: Implement Fix (GREEN)
\`\`\`javascript
// Fix the underlying issue
export async function completeTask(id) {
  return db.tasks.update(id, {
    status: 'completed',
    completedAt: new Date(), // This was missing
  });
}
\`\`\`

## Step 3: Verify (REFACTOR)
- Test now PASSES
- Run full suite: no regressions
- Add regression guard for future` : `# TDD Workflow (New Feature)

## Step 1: RED — Write the Test First
\`\`\`javascript
describe('${target}', () => {
  it('should ${target}', async () => {
    // Write what you expect to happen
    // This test should FAIL until implementation is complete
    const result = await implementFeature('${target}');
    expect(result).toBeDefined();
  });
});
\`\`\`

## Step 2: GREEN — Write Minimal Code
\`\`\`javascript
// Write the minimum to make the test pass
// Don't over-engineer — just make it work
async function implementFeature() {
  return { /* minimal implementation */ };
}
\`\`\`

## Step 3: REFACTOR — Clean Up
- Remove duplication
- Improve naming
- Run tests after every change`;

  console.log(JSON.stringify({
    handled: true,
    skill: 'tdd',
    mode: isProveIt ? 'prove-it' : 'tdd',
    target: target || 'unnamed task',
    workflow: workflowGuide,
    testPyramid: 'Unit (~80%) > Integration (~15%) > E2E (~5%)',
    principles: ['DAMP over DRY', 'State-based assertions', 'Beyonce Rule', 'Prove-It for bugs']
  }));
}

main();
