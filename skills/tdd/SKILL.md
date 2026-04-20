---
name: tdd
description: >
  Drives development with tests. Use when implementing any logic, fixing any bug, or
  changing any behavior. Write a failing test before writing the code that makes it pass.
  Tests are proof — "seems right" is never done.
triggers:
  - "/test"
  - "write tests first"
  - "test-driven"
  - "fixing a bug"
  - "implementing logic"
  - "Prove-It pattern"
---

# tdd — Test-Driven Development

## Overview

Write a failing test before writing the code that makes it pass. For bug fixes, reproduce the bug with a test before attempting a fix. Tests are proof — "seems right" is not done. A codebase with good tests is an AI agent's superpower; a codebase without tests is a liability.

## When to Use

- Implementing any new logic or behavior
- Fixing any bug (use the Prove-It Pattern)
- Modifying existing functionality
- Adding edge case handling
- Any change that could break existing behavior

**When NOT to use:** Pure configuration changes, documentation updates, or static content changes that have no behavioral impact.

## Process

### RED GREEN REFACTOR

```
Write the test  →  Write minimal code  →  Clean up
  that fails       to make it pass       implementation
      │                 │                    │
      ▼                 ▼                    ▼
  Test FAILS      Test PASSES          Tests still PASS
```

**Write the test first. It must fail. A test that passes immediately proves nothing.**

### The Test Pyramid

Invest testing effort according to the pyramid — most tests should be small and fast:

```
        ╱╲
       ╱  ╲ E2E Tests (~5%)
      ╱────╲  Full user flows, real browser
     ╱      ╲
    ╱──────────╲ Integration Tests (~15%)
   ╱            ╲  Component interactions, API boundaries
  ╱              ╲
 ╱                ╲ Unit Tests (~80%)
╱──────────────────╲  Pure logic, isolated, milliseconds each
```

### Test Sizes

| Size | Constraints | Speed | Example |
|------|------------|-------|---------|
| Small | Single process, no I/O, no network, no database | Milliseconds | Pure function tests |
| Medium | Multi-process OK, localhost only, no external services | Seconds | API tests with test DB |
| Large | Multi-machine OK, external services allowed | Minutes | E2E tests, performance benchmarks |

### The Prove-It Pattern (for Bug Fixes)

```
Bug report arrives
      │
      ▼
Write a test that demonstrates the bug
      │
      ▼
Test FAILS (confirming the bug exists)
      │
      ▼
Implement the fix
      │
      ▼
Test PASSES (proving the fix works)
      │
      ▼
Run full test suite (no regressions)
```

## Common Rationalizations

| Rationalization | Reality |
|-----------------|---------|
| "I'll write tests after the code works" | You won't. And tests written after the fact test implementation, not behavior. |
| "This is too simple to test" | Simple code gets complicated. The test documents the expected behavior. |
| "Tests slow me down" | Tests slow you down now. They speed you up every time you change the code later. |
| "I tested it manually" | Manual testing doesn't persist. Tomorrow's change might break it with no way to know. |
| "The code is self-explanatory" | Tests ARE the specification. They document what the code should do, not what it does. |
| "It's just a prototype" | Prototypes become production code. Tests from day one prevent "test debt" crisis. |

## Red Flags

- Writing code without any corresponding tests
- Tests that pass on the first run (they may not be testing what you think)
- "All tests pass" but no tests were actually run
- Bug fixes without reproduction tests
- Tests that test framework behavior instead of application behavior
- Test names that don't describe the expected behavior
- Skipping tests to make the suite pass

## Key Principles

### DAMP over DRY

Tests should read like specifications. Self-contained and descriptive > shared helpers that obscure what each test verifies.

### The Beyonce Rule

"If you liked it, you should have put a test on it." Infrastructure changes, refactoring, and migrations are not responsible for catching your bugs — your tests are.

### State-Based over Interaction-Based

Assert on the outcome of an operation, not on which methods were called internally:

```javascript
// Good: Tests what the function does (state-based)
it('returns tasks sorted by creation date, newest first', async () => {
  const tasks = await listTasks({ sortBy: 'createdAt', sortOrder: 'desc' });
  expect(tasks[0].createdAt.getTime()).toBeGreaterThan(tasks[1].createdAt.getTime());
});

// Bad: Tests how the function works internally (interaction-based)
it('calls db.query with ORDER BY created_at DESC', async () => {
  await listTasks({ sortBy: 'createdAt', sortOrder: 'desc' });
  expect(db.query).toHaveBeenCalledWith(expect.stringContaining('ORDER BY created_at DESC'));
});
```

### Test Doubles Preference

Use the simplest test double that gets the job done:

1. Real implementation → Highest confidence
2. Fake → In-memory version (e.g., fake DB)
3. Stub → Returns canned data, no behavior
4. Mock (interaction) → Use sparingly

## Verification

After completing any implementation:

- [ ] Every new behavior has a corresponding test
- [ ] All tests pass: `npm test`
- [ ] Bug fixes include a reproduction test that failed before the fix
- [ ] Test names describe the behavior being verified
- [ ] No tests were skipped or disabled
- [ ] Coverage hasn't decreased (if tracked)
