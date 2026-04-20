---
name: spec-driven
description: >
  Write structured specifications before writing any code. Use when starting a new project,
  feature, or significant change and no specification exists yet. Use when requirements are
  ambiguous, incomplete, or only exist as a vague idea.
triggers:
  - "/spec"
  - "start a new project"
  - "build something from scratch"
  - "write a spec"
  - "requirements are unclear"
---

# spec-driven — Spec-Driven Development

## Overview

Write a structured specification before writing any code. The spec is the shared source of truth — it defines what we're building, why, and how we'll know it's done. Code without a spec is guessing.

The spec surfaces assumptions early, not after code is written. A 15-minute spec prevents hours of rework.

## When to Use

- Starting a new project or feature
- Requirements are ambiguous or incomplete
- The change touches multiple files or modules
- An architectural decision is needed
- The task would take more than 30 minutes to implement

**When NOT to use:** Single-line fixes, typo corrections, or changes where requirements are self-contained and unambiguous.

## Process

### Phase 1: Specify

**Surface assumptions immediately.** Before writing any spec content, list what you're assuming:

```
ASSUMPTIONS I'M MAKING:
1. This is a web application (not native mobile)
2. Authentication uses session-based cookies (not JWT)
3. The database is PostgreSQL (based on existing schema)
4. We're targeting modern browsers only (no IE11)
→ Correct me now or I'll proceed with these.
```

**Write a spec document covering these six core areas:**

1. **Objective** — What are we building and why? Who is the user? What does success look like?

2. **Commands** — Full executable commands with flags, not just tool names.
   ```
   Build: npm run build
   Test: npm test -- --coverage
   Lint: npm run lint --fix
   Dev: npm run dev
   ```

3. **Project Structure** — Where source code lives, where tests go, where docs belong.
   ```
   src/           → Application source code
   src/components → React components
   src/lib        → Shared utilities
   tests/         → Unit and integration tests
   e2e/           → End-to-end tests
   docs/          → Documentation
   ```

4. **Code Style** — One real code snippet showing your style beats three paragraphs describing it.

5. **Testing Strategy** — What framework, where tests live, coverage expectations, which test levels for which concerns.

6. **Boundaries** — Three-tier system:
   - **Always do:** Run tests before commits, follow naming conventions, validate inputs
   - **Ask first:** Database schema changes, adding dependencies, changing CI config
   - **Never do:** Commit secrets, edit vendor directories, remove failing tests without approval

### Phase 2: Plan

With the validated spec, generate a technical implementation plan:

1. Identify the major components and their dependencies
2. Determine the implementation order (what must be built first)
3. Note risks and mitigation strategies
4. Identify what can be built in parallel vs. what must be sequential
5. Define verification checkpoints between phases

### Phase 3: Tasks

Break the plan into discrete, implementable tasks:

- Each task completable in a single focused session
- Each task has explicit acceptance criteria
- Each task includes a verification step (test, build, manual check)
- Tasks are ordered by dependency, not by perceived importance
- No task should require changing more than ~5 files

### Phase 4: Implement

Execute tasks one at a time. Use the `tdd` skill for implementation with tests. Use the `debugging` skill if anything breaks.

## Common Rationalizations

| Rationalization | Reality |
|-----------------|---------|
| "This is simple, I don't need a spec" | Simple tasks don't need *long* specs, but they still need acceptance criteria. |
| "I'll write the spec after I code it" | That's documentation, not specification. The spec's value is in forcing clarity *before* code. |
| "The spec will slow us down" | A 15-minute spec prevents hours of rework. |
| "Requirements will change anyway" | That's why the spec is a living document. An outdated spec is still better than no spec. |
| "The user knows what they want" | Even clear requests have implicit assumptions. The spec surfaces those assumptions. |

## Red Flags

- Starting to write code without any written requirements
- Asking "should I just start building?" before clarifying what "done" means
- Implementing features not mentioned in any spec or task list
- Making architectural decisions without documenting them
- Skipping the spec because "it's obvious what to build"

## Verification

Before proceeding to implementation, confirm:

- [ ] The spec covers all six core areas (Objective, Commands, Structure, Code Style, Testing, Boundaries)
- [ ] Assumptions are listed and user has been asked to correct
- [ ] Success criteria are specific and testable
- [ ] The spec is saved to a file in the repository
- [ ] Human has reviewed and approved the spec
