---
name: skill-evolution
description: "Evolve OpenClaw skills using GEPA or Ralph Wiggum self-referential iteration."
triggers:
  - /skill-evolution
  - evolve skill
  - skill self-improvement
---

# Skill Evolution

进化 OpenClaw skills 使其更好。

支持两种进化模式:
- **GEPA** (Genetic Expression Programming) — 生成多个变体，选择最佳
- **Ralph Wiggum** — 自引用循环，在同一 skill 上反复迭代改进

## Usage

```
/skill-evolution --evolve [skill-name] [--iterations N] [--population N]
/skill-evolution --ralph [skill-name]
/skill-evolution --status [skill-name]
/skill-evolution --list
/skill-evolution --report [skill-name]
```

## Commands

- `--evolve [name]` — Run GEPA evolution (generates variants, selects best)
- `--ralph [name]` — Run Ralph Wiggum self-referential loop
- `--status [name]` — Show evolution status and latest scores
- `--list` — List all skills with evolution history
- `--report [name]` — Show detailed evolution report
- `--dataset [name]` — Generate/regenerate evaluation dataset
- `--dry-run [name]` — Show what would happen without running

## Examples

```
/skill-evolution --list
/skill-evolution --evolve session-search --iterations 5
/skill-evolution --ralph session-search
/skill-evolution --status session-search
/skill-evolution --report session-search
/skill-evolution --dataset conversation-analyst
```

## Ralph Wiggum Mode

Inspired by `anthropics/claude-code/plugins/ralph-wiggum`:

> "Claude works on the same task repeatedly, seeing its previous work, until completion."

Unlike GEPA (generates N variants → picks best), Ralph Wiggum:
1. **Analyzes** current skill text, finds weaknesses
2. **Improves** with targeted changes (expand/condense/restructure)
3. **Reviews** quality improvement
4. **Loops** back on SAME skill until done or max iterations
5. **Stores** best version from history

```
Ralph Wiggum iterations: 3
Quality Before: 0.650
Quality After:  0.820
Improvement:    +0.170
```

## Options

- `--iterations N` — Number of optimization iterations (default: 3)
- `--population N` — Number of variants per generation (default: 5)

## Architecture

```
modules/evolution/
├── constraint_validator.mjs  # Size/growth/structure constraints
├── eval_dataset.mjs          # Train/val/holdout splits
├── dataset_builder.mjs       # Synthetic test case generation
├── fitness_evaluator.mjs     # LLM-as-Judge scoring
├── skill_mutator.mjs         # Genetic mutation operations
├── skill_optimizer.mjs       # GEPA optimization loop
└── ralph_wiggum_loop.mjs     # Self-referential iterative improvement
```

## Output

Evolution outputs stored at:
`~/.openclaw/memory/evolution/output/[skill-name]/[timestamp]/`

Files:
- `evolved_skill.md` — Best evolved variant
- `baseline_skill.md` — Original skill
- `metrics.json` — Scores, generations, dataset stats

Ralph Wiggum sessions stored at:
`~/.openclaw/memory/evolution/ralph_wiggum/`
