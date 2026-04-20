---
name: code-review
description: >
  Conduct thorough code reviews using a five-axis framework. Use before merging any change.
  Reviews should improve code health, catch bugs, and share knowledge — not block progress.
triggers:
  - "/review"
  - "review this code"
  - "pull request"
  - "merge request"
  - "look at this change"
---

# code-review — Code Review and Quality

## Overview

Code review is a knowledge-sharing and quality-improvement activity, not a gatekeeping one. The goal is to catch bugs, improve code health, share knowledge, and ensure we leave the codebase better than we found it — not to block progress or assign blame.

Use the five-axis framework to structure your review. Keep comments constructive and focused on the code, not the coder.

## When to Use

- Before merging any change to main/default branch
- After completing a significant implementation task
- When asked to review a pull request or merge request
- During `spec-driven` implementation, after each task completion

**When NOT to use:** Single-file typo fixes, trivial formatting changes, or emergency hotfixes under time pressure (review after merge is acceptable for urgent changes).

## The Five-Axis Review Framework

Evaluate every change across these five axes:

### 1. Correctness

Does the code do what it's supposed to do?

- Are edge cases handled?
- Are errors handled properly?
- Does it handle empty/null/undefined inputs?
- Are there potential race conditions or concurrency issues?
- Are the tests sufficient to prove correctness?

### 2. Design

Is this the right solution to the problem?

- Is the code in the right place?
- Is the abstraction level appropriate?
- Does it follow existing patterns in the codebase?
- Will this be easy to extend or modify in the future?
- Are dependencies minimized?

### 3. Readability

Can other engineers understand this code?

- Are names descriptive and consistent?
- Is the logic easy to follow?
- Are complex algorithms explained?
- Is there appropriate documentation?
- Do comments explain *why*, not *what*?

### 4. Security

Are there any security vulnerabilities?

- Is user input validated and sanitized?
- Are secrets handled properly (not logged, not in code)?
- Are authentication/authorization checks in place?
- Is data encrypted where appropriate?
- Are there potential injection vulnerabilities?

### 5. Performance

Are there performance concerns?

- Are there unnecessary round trips (N+1 queries, redundant API calls)?
- Are large data structures handled efficiently?
- Are expensive operations cached where appropriate?
- Is lazy loading used for expensive resources?
- Will this scale to production data volumes?

## Change Sizing

**~100 lines per review** is the ideal target. Smaller changes are easier to review thoroughly and less likely to contain hidden bugs.

If a change is larger:
- Ask the author to split it into smaller PRs if possible
- Focus on architecture and correctness for the overall change
- Do deeper review on the most critical sections
- Note that full review of large PRs may require multiple passes

## Severity Labels

Use these labels to communicate the urgency of feedback:

| Label | Meaning | Action |
|-------|---------|--------|
| ** Nit/Optional** | Minor style/preference issue | Author's discretion |
| ** FYI** | Informational, no action required | No response needed |
| ** Optional** | Nice to have but not essential | Author's discretion |
| ** Recommended** | Should be addressed before merge | Please address or discuss |
| ** Blocking** | Must be fixed before merge | Requires sign-off |

**Keep feedback proportional to the issue.** Don't mark style nits as Blocking. Don't ignore real bugs.

## Review Speed Norms

- **Quick first pass:** 15-30 minutes for typical PR (under 200 lines)
- **Response time:** Aim to review within 4 hours of request
- **Don't block on non-blocking feedback:** Non-blocking/FYI comments don't require response before merge
- **Async by default:** Use PR comments, not synchronous meetings

## Process

### Step 1: Understand the Context

Before reviewing:
- Read the PR description or linked issue
- Understand what problem this solves
- Check if there's a spec or design document
- Note any constraints (deadlines, technical limits)

### Step 2: First Pass — Correctness and Design

Focus on:
- Does the code solve the problem?
- Is the approach sound?
- Are there obvious bugs?

If the approach is fundamentally wrong, stop and discuss before continuing.

### Step 3: Second Pass — Readability, Security, Performance

Focus on:
- Can I understand this code?
- Are there security concerns?
- Are there performance issues?

### Step 4: Write Feedback

- Be specific: point to line numbers, quote code
- Explain why: "This could cause N+1 queries because..."
- Offer alternatives: "Consider extracting this into..."
- Distinguish: use severity labels appropriately
- Be kind: critique the code, not the coder

### Step 5: Verify and Sign Off

After author addresses feedback:
- Confirm the change looks good
- If you marked Blocking issues, verify they're resolved
- Approve the PR or indicate what remains

## Common Rationalizations

| Rationalization | Reality |
|-----------------|---------|
| "It's just a small change, I don't need to review it" | Small changes cause big bugs. Review all changes. |
| "The tests pass, that means it's correct" | Tests can have gaps. Code review catches what tests miss. |
| "I'll review it later" | Later often means never. Review promptly or the debt accumulates. |
| "The author is more experienced, I shouldn't question it" | Fresh eyes catch things the author missed. Every review is valuable. |
| "It's not my area, I'll let someone else review it" | You have context the specialist reviewer lacks. Share it. |
| "I don't want to block them" | Blocking on real issues is doing your job. Non-blocking feedback doesn't block. |

## Red Flags

- PR with no description or unclear purpose
- PR that is significantly larger than the linked issue scope
- New dependencies with no explanation
- Disabling or skipping existing tests
- Adding `// TODO` without linked issue
- Changes that bypass existing architecture patterns
- Secrets or credentials in code
- Missing error handling on external calls
- Non-atomic commits for logically separate changes

## Verification

Before approving any PR:

- [ ] I've read the PR description and understand the purpose
- [ ] The change solves the stated problem
- [ ] Tests are present and adequate
- [ ] No blocking issues remain
- [ ] The code follows project conventions
- [ ] No secrets or credentials are exposed
- [ ] Performance implications have been considered
- [ ] Security implications have been considered
