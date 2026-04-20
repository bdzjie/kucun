/**
 * debugging skill handler
 * Systematic root-cause debugging with stop-the-line rule
 */

const args = process.argv.slice(2);
const command = args[0];

function showHelp() {
  return {
    handled: true,
    skill: 'debugging',
    response: `debugging — Debugging and Error Recovery

Usage:
  /debug [error-description]
  /debug --triage [error-type]

Stop-the-Line Rule:
  1. STOP — Don't add features
  2. PRESERVE — Save error output/logs
  3. DIAGNOSE — Follow triage checklist
  4. FIX — Root cause, not symptom
  5. GUARD — Add regression test
  6. RESUME — After verification

Triage Checklist:
  Step 1: Reproduce — Make it fail reliably
  Step 2: Localize — Narrow down WHERE
  Step 3: Reduce — Minimal failing case
  Step 4: Fix — Root cause, not symptom
  Step 5: Guard — Regression test
  Step 6: Verify — End-to-end

Examples:
  /debug TypeError: Cannot read property 'x' of undefined
  /debug --triage test Test is failing after code change
`,
  };
}

async function main() {
  if (!command || command === '--help' || command === '-h') {
    console.log(JSON.stringify(showHelp()));
    return;
  }

  const isTriage = command === '--triage';
  const target = isTriage ? args[1] : command;

  const triageGuide = `# Stop-the-Line Debugging

## ERROR: ${target || 'Unknown Error'}

\`\`\`
1. STOP — Don't add features or make unrelated changes
2. PRESERVE — Save error output, logs, repro steps
\`\`\`

### Triage Checklist

**Step 1: Reproduce**
\`\`\`
Can you reproduce the failure?
├── YES → Proceed to Step 2
└── NO
    ├── Gather more context (logs, environment)
    ├── Try minimal environment
    └── Document if truly non-reproducible
\`\`\`

**Step 2: Localize**
\`\`\`
Which layer is failing?
├── UI/Frontend → Console, DOM, network tab
├── API/Backend → Server logs, request/response
├── Database → Queries, schema, data integrity
├── Build tooling → Config, dependencies, env
└── Test itself → Check test correctness
\`\`\`

**Step 3: Reduce**
- Remove unrelated code until only bug remains
- Simplify input to smallest triggering case

**Step 4: Fix Root Cause**
\`\`\`
Symptom fix (BAD):   Fix where problem appears
Root cause fix:      Fix why problem occurs
\`\`\`

**Step 5: Guard Against Recurrence**
\`\`\`javascript
// Write a test that catches this specific failure
it('regression: ${target}', () => {
  // Test that would fail without the fix
});
\`\`\`

**Step 6: Verify**
\`\`\`bash
# Run specific test
npm test -- --grep "regression"

# Run full suite
npm test

# Build
npm run build
\`\`\`

---

### Error Patterns

**Test Failure:**
→ Did you change code the test covers?
→ YES → Is test wrong or code wrong?
→ NO → Side effect from unrelated change?

**Build Failure:**
→ Type error / Import error / Config error / Dependency error / Environment error

**Runtime Error:**
→ TypeError → null/undefined somewhere
→ Network/CORS → Check URLs, headers
→ Render error → Check error boundary
`,
  };

  console.log(JSON.stringify({
    handled: true,
    skill: 'debugging',
    error: target || 'No error specified',
    workflow: triageGuide,
    stopTheLine: true,
    steps: ['STOP', 'PRESERVE', 'DIAGNOSE', 'FIX', 'GUARD', 'VERIFY']
  }));
}

main();
