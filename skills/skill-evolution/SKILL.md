# Skill Evolution

进化 OpenClaw skills 使其更好。

使用 GEPA-style 优化循环 + LLM-as-Judge 评估，自动改进 skills。

## Usage

```
/skill-evolution --evolve [skill-name] [--iterations N] [--population N]
/skill-evolution --status [skill-name]
/skill-evolution --list
/skill-evolution --report [skill-name]
```

## Commands

- `--evolve [name]` — Run evolution optimization on a skill
- `--status [name]` — Show evolution status and latest scores
- `--list` — List all skills with evolution history
- `--report [name]` — Show detailed evolution report
- `--dataset [name]` — Generate/regenerate evaluation dataset
- `--dry-run [name]` — Show what would happen without running

## Examples

```
/skill-evolution --list
/skill-evolution --evolve session-search --iterations 5
/skill-evolution --status session-search
/skill-evolution --report session-search
/skill-evolution --dataset conversation-analyst
/skill-evolution --dry-run windows-gui
```

## Options

- `--iterations N` — Number of optimization iterations (default: 3)
- `--population N` — Number of variants per generation (default: 5)

## How It Works

1. **Generate eval dataset** — Creates train/val/holdout test cases from skill text
2. **Run GEPA loop** — Generates variants, evaluates fitness, selects best
3. **Constraint validation** — Each variant must pass size/growth/structure checks
4. **Output report** — Shows baseline vs evolved comparison

## Architecture

```
modules/evolution/
├── constraint_validator.mjs  # Size/growth/structure constraints
├── eval_dataset.mjs          # Train/val/holdout splits
├── dataset_builder.mjs       # Synthetic test case generation
├── fitness_evaluator.mjs     # LLM-as-Judge scoring
├── skill_mutator.mjs         # Genetic mutation operations
└── skill_optimizer.mjs       # GEPA optimization loop
```

## Output

Evolution outputs are stored at:
`~/.openclaw/memory/evolution/output/[skill-name]/[timestamp]/`

Files:
- `evolved_skill.md` — Best evolved variant
- `baseline_skill.md` — Original skill
- `metrics.json` — Scores, generations, dataset stats
