# Hermes Agent Self-Evolution 分析

**仓库**: github.com/NousResearch/hermes-agent-self-evolution
**Stars**: 1920 | **Fork**: 184 | **License**: MIT
**分析日期**: 2026-04-19
**语言**: Python + DSPy

---

## 核心定位

> **"Evolutionary self-improvement for Hermes Agent — optimize skills, prompts, and code using DSPy + GEPA"**

使用 **GEPA（Genetic-Pareto Prompt Evolution）** 自动化优化 Agent 的 Skills/Tools/Prompts，通过**执行轨迹分析**理解失败原因，生成针对性改进。

**关键数字**: ~$2-10 per optimization run，No GPU training

---

## 核心架构

```
Skill → SyntheticDatasetBuilder → EvalDataset (train/val/holdout)
                                           ↓
                                    GEPA Optimizer
                                    (DSPy-based)
                                           ↓
                              Candidate Variants → Fitness Eval
                                           ↓
                              Constraint Gates → Best Variant → PR
```

---

## 核心模块

### 1. EvolutionConfig

```python
@dataclass
class EvolutionConfig:
    iterations: int = 10
    population_size: int = 5
    optimizer_model: str = "openai/gpt-4.1"
    eval_model: str = "openai/gpt-4.1-mini"
    judge_model: str = "openai/gpt-4.1"
    
    max_skill_size: int = 15_000       # 15KB
    max_tool_desc_size: int = 500     # chars
    max_prompt_growth: float = 0.2     # 20% max growth
    
    eval_dataset_size: int = 20        # Total examples
    train_ratio: float = 0.5
    val_ratio: float = 0.25
    holdout_ratio: float = 0.25
    
    run_pytest: bool = True            # Must pass 100%
    output_dir: Path = "./output"
    create_pr: bool = True
```

### 2. EvalDataset — 三分割数据集

```python
@dataclass
class EvalDataset:
    train: list[EvalExample]    # 50%
    val: list[EvalExample]      # 25%
    holdout: list[EvalExample]  # 25%

@dataclass
class EvalExample:
    task_input: str            # 用户输入
    expected_behavior: str      # 评判标准（rubric）
    difficulty: str             # easy/medium/hard
    category: str               # 测试类别
    source: str                 # synthetic/sessiondb/golden
```

### 3. SyntheticDatasetBuilder — LLM生成测试用例

```python
class SyntheticDatasetBuilder:
    class GenerateTestCases(dspy.Signature):
        artifact_text: str = dspy.InputField()
        artifact_type: str = dspy.InputField()  # 'skill'/'tool_description'/'prompt_section'
        num_cases: int = dspy.InputField()
        test_cases: str = dspy.OutputField()    # JSON array
```

**生成策略**:
- 输入: 完整 skill 文本
- 输出: 多样化的 (task_input, expected_behavior) 对
- 覆盖: easy/medium/hard 不同难度

### 4. ConstraintValidator — 硬约束门控

```python
@dataclass
class ConstraintResult:
    passed: bool
    constraint_name: str
    message: str
    details: Optional[str] = None

class ConstraintValidator:
    def validate_all(artifact_text, artifact_type, baseline_text=None):
        results = []
        results.append(self._check_size())        # max_skill_size
        results.append(self._check_growth())      # max_prompt_growth (if baseline)
        results.append(self._check_non_empty())
        results.append(self._check_skill_structure())  # YAML frontmatter + name + description
        return results

    def run_test_suite(hermes_repo):  # pytest must pass 100%
```

**4大约束**:
| 约束 | 条件 |
|------|------|
| size_limit | skill ≤ 15KB, tool_desc ≤ 500 chars |
| growth_limit | 相比 baseline 增长 ≤ 20% |
| non_empty | 内容非空 |
| skill_structure | YAML frontmatter + name + description |

### 5. Fitness Metric — LLM-as-Judge

```python
def skill_fitness_metric(example, prediction) -> float:
    """LLM judges whether prediction meets expected_behavior rubric."""
    # Returns 0.0-1.0 score
```

**评分流程**:
```
example.task_input → Skill → prediction
                                 ↓
              LLM judge: Does prediction satisfy expected_behavior?
                                 ↓
                           0.0 ~ 1.0 score
```

### 6. GEPA Optimizer — DSPy编译

```python
optimizer = dspy.GEPA(
    metric=skill_fitness_metric,
    max_steps=iterations,  # 10
)
optimized_module = optimizer.compile(
    baseline_module,
    trainset=trainset,
    valset=valset,
)
```

**GEPA = Genetic + Pareto**:
- Genetic: 交叉变异生成候选
- Pareto: 多目标优化（quality vs. size）

---

## 进化流程（完整10步）

```
1. Find & load skill
2. Build eval dataset (synthetic/sessiondb/golden)
3. Validate baseline constraints
4. Set up DSPy + GEPA optimizer
5. Run GEPA optimization (iterations 次)
6. Extract evolved skill text
7. Validate evolved skill constraints
8. Evaluate on holdout set
9. Report results (baseline vs evolved scores)
10. Save output (evolved_skill.md + metrics.json)
```

---

## 关键约束（Guardrails）

所有进化变体必须通过：

| Gate | 要求 |
|------|------|
| test_suite | pytest tests/ -q 必须 100% 通过 |
| size_limit | skill ≤ 15KB |
| growth_limit | 相比 baseline ≤ 20% |
| skill_structure | YAML frontmatter 完整 |
| semantic_preservation | 不能偏离原始目的 |
| PR review | 所有变更必须 PR，不能直接 commit |

---

## 对比：Evolver vs Hermes Agent Self-Evolution

| 维度 | Evolver (EvoMap) | Hermes Self-Evolution |
|------|-----------------|----------------------|
| **核心** | Gene/Capsule 选择协议 | DSPy + GEPA Prompt 进化 |
| **触发** | Signal → Gene 选择 | 手动运行 / 定时 |
| **验证** | Gene validation 命令 | ConstraintValidator + pytest |
| **优化** | Genetic Algorithm | GEPA (Pareto 多目标) |
| **数据集** | 无 | SyntheticDatasetBuilder |
| **审计** | EvolutionEvent | metrics.json + output dir |
| **共享** | EvoMap A2A 网络 | PR against hermes-agent |
| **语言** | Node.js | Python + DSPy |

---

## 可落地到 OpenClaw 的思想

### 高优先级（低成本高价值）

| 启发 | OpenClaw 实现 | 文件 |
|------|-------------|------|
| **ConstraintValidator** | 增强现有约束检查，增加 growth_limit + skill_structure 验证 | `modules/evolution/constraint_validator.mjs` |
| **EvalDataset 三分割** | skill 创建时自动生成 train/val/holdout 测试用例 | `modules/evolution/eval_dataset.mjs` |
| **Fitness Metric** | LLM-as-Judge 评估 skill 输出质量 | `modules/evolution/fitness_evaluator.mjs` |
| **SyntheticDatasetBuilder** | 从 skill 文本自动生成测试用例 | `modules/evolution/dataset_builder.mjs` |

### 中优先级

| 启发 | OpenClaw 实现 | 文件 |
|------|-------------|------|
| **Skill Evolution Loop** | GEPA-style 优化循环，迭代改进 skill | `modules/evolution/skill_optimizer.mjs` |
| **Evolution Report** | 生成 markdown 报告对比 baseline vs evolved | `skills/skill-evolution/` |
| **pytest Gate** | skill 变更必须通过 tests/ | `hooks/skill-test-hook/` |

---

## 第三波：Skill Evolution System

```
modules/evolution/
├── constraint_validator.mjs   # 约束验证（size/growth/structure）
├── eval_dataset.mjs           # EvalDataset 三分割
├── dataset_builder.mjs        # SyntheticDatasetBuilder
├── fitness_evaluator.mjs      # LLM-as-Judge 评分
├── skill_mutator.mjs          # Skill 变异器
└── skill_optimizer.mjs        # GEPA-style 优化循环
```

**目标**: 让 OpenClaw 的 skill 不仅能被创建，还能**自动进化得更好**。

*分析完成: 2026-04-19*
