/**
 * code-review skill handler
 * Five-axis code review framework
 */

const args = process.argv.slice(2);
const command = args[0];

function showHelp() {
  return {
    handled: true,
    skill: 'code-review',
    response: `code-review — Code Review and Quality

Usage:
  /review [change-description]
  /review --checklist

Five-Axis Framework:
  1. Correctness — Does it do what it's supposed to?
  2. Design — Is this the right solution?
  3. Readability — Can others understand it?
  4. Security — Any vulnerabilities?
  5. Performance — Any performance concerns?

Severity Labels:
  / Nit/Optional — Minor, author's discretion
  / FYI — Informational, no action needed
  / Recommended — Should address before merge
  / Blocking — Must fix before merge

Change Sizing: ~100 lines per review

Principles:
  - Review the code, not the coder
  - Be specific, explain why
  - Keep feedback proportional
  - Don't block on non-blocking issues

Examples:
  /review Add user authentication to API
  /review --checklist
`,
  };
}

async function main() {
  if (!command || command === '--help' || command === '-h') {
    console.log(JSON.stringify(showHelp()));
    return;
  }

  const isChecklist = command === '--checklist';

  const reviewGuide = `# Code Review

## ${isChecklist ? 'Review Checklist' : 'Framework: ' + command}

### Five-Axis Review

**1. Correctness**
- [ ] Does the code do what it's supposed to do?
- [ ] Are edge cases handled?
- [ ] Are errors handled properly?
- [ ] Are inputs validated?
- [ ] Tests sufficient to prove correctness?

**2. Design**
- [ ] Is the code in the right place?
- [ ] Abstraction level appropriate?
- [ ] Follows existing patterns?
- [ ] Easy to extend/modify?
- [ ] Dependencies minimized?

**3. Readability**
- [ ] Names descriptive and consistent?
- [ ] Logic easy to follow?
- [ ] Complex algorithms explained?
- [ ] Appropriate documentation?
- [ ] Comments explain *why*, not *what*?

**4. Security**
- [ ] User input validated/sanitized?
- [ ] Secrets not logged or in code?
- [ ] Auth/authz checks in place?
- [ ] Data encrypted where needed?
- [ ] No injection vulnerabilities?

**5. Performance**
- [ ] No N+1 queries?
- [ ] Large data handled efficiently?
- [ ] Expensive ops cached?
- [ ] Lazy loading used?
- [ ] Will scale to production volumes?

---

### Severity Labels

| Label | Meaning | Action |
|-------|---------|--------|
| Nit/Optional | Minor style | Author discretion |
| FYI | Informational | No response needed |
| Recommended | Should address | Please address |
| Blocking | Must fix | Requires sign-off |

---

### Before Approving

- [ ] Read PR description, understand purpose
- [ ] Change solves stated problem
- [ ] Tests present and adequate
- [ ] No blocking issues remain
- [ ] Follows project conventions
- [ ] No secrets exposed
- [ ] Performance/security considered
`;

  console.log(JSON.stringify({
    handled: true,
    skill: 'code-review',
    framework: 'Five-Axis Review',
    axes: ['Correctness', 'Design', 'Readability', 'Security', 'Performance'],
    severityLabels: ['Nit/Optional', 'FYI', 'Recommended', 'Blocking'],
    changeSizing: '~100 lines per review',
    reviewGuide
  }));
}

main();
