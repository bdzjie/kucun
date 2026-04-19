# Dive Into LLMs — 动手学大模型 学习笔记

**来源**: https://github.com/Lordog/dive-into-llms
**机构**: 上海交通大学 (NLP 课程 NIS8021 / AI安全课程 NIS3353)
**教师**: 张倬胜、袁童鑫 等
**版本**: v0.1.0

---

## 教程目录 (11 章)

| 章节 | 主题 | 关键工具/框架 |
|------|------|--------------|
| Ch1 | 预训练微调与部署 | HuggingFace, PEFT, LoRA |
| Ch2 | 提示学习与思维链 | CoT, Few-shot, API调用 |
| Ch3 | 知识编辑 | KET, SERAC, MEND, ROME |
| Ch4 | 数学推理 | R1蒸馏, SFT |
| Ch5 | **模型水印** | **X-SIR** (KGW/SIR/X-SIR) |
| Ch6 | **越狱攻击** | **EasyJailbreak** (11种方法) |
| Ch7 | LLM隐写 | 文本隐写术 |
| Ch8 | 多模态模型 | GPT-4V, LLaVA |
| Ch9 | **GUI Agent** | 浏览器自动化, 点外卖/购物/比价 |
| Ch10 | Agent安全 | 开放世界风险 |
| Ch11 | RLHF对齐 | PPO, Reward Model |

---

## 重要框架

### 1. X-SIR — 模型水印框架
**GitHub**: https://github.com/zwhe99/X-SIR

水印嵌入 → 检测 → 评估流程：

```
gen.py --base_model --watermark_method kgw --input_file --output_file
    ↓
detect.py --detect_file --output_file
    ↓
eval_detection.py --hm_zscore --wm_zscore --roc_curve
    → AUC: 1.000 (完美检测)
```

**三种水印算法**:
- KGW: 绿德算法 (基于词汇分布)
- SIR: 简单水印
- X-SIR: 增强版水印

**核心思想**: 在生成文本时操纵词汇分布，使人类无法察觉但统计可检测。

**可用于**: 检测AI生成内容、溯源

### 2. EasyJailbreak — 越狱攻击框架
**GitHub**: https://github.com/EasyJailbreak/EasyJailbreak

4个模块循环迭代：
- **Selector**: 选择越狱提示
- **Mutator**: 变换越狱提示 (Translate/GPTfuzzer等)
- **Constraint**: 过滤不合适的提示
- **Evaluator**: 评估攻击结果

11种已集成越狱方法 (PAIR, Gptfuzzer, TAP 等)

**用于**: 红队测试、RLHF安全对齐研究

---

## 对 OpenClaw 的启发

### 1. 水印技术 → 记忆系统
**启发**: 在记忆存储时嵌入"隐形水印"用于溯源

**可实现**: 
- 每次 `appendMemoryEntry()` 时，在内容中嵌入不可见token标记来源
- 检测时计算 `z-score` 识别是否来自特定会话
- 结合 WAL 审计：双重溯源

**实现难度**: 中 (需要了解 X-SIR KGW 算法细节)

### 2. GUI Agent → OpenClaw 自动化
**启发**: 让 AI Agent 操作 GUI (点外卖/购物/发消息)

**当前 OpenClaw 能力**:
- 已有 `openclaw devices` CLI
- 已有 hook 系统触发 action
- 缺少: GUI 层自动化

**可实现方向**:
- Windows GUI automation via Python (pywinauto/uiautomation)
- Web automation via Playwright/Puppeteer
- 与 Windows Task Scheduler 集成实现定时 GUI 任务

**实现难度**: 高 (需要 Windows GUI 自动化库)

### 3. EasyJailbreak → Prompt 攻击检测
**启发**: 检测恶意 prompt 注入

**已落地**: ✅ `hooks/memory-hook/handler.js` - `detectPromptInjection()`
- 26种攻击模式，6大类别
- Severity评分 + 安全事件存储
- 集成在 `message:preprocessed` 中

**详见**: `hooks/memory-hook/handler.js`

### 4. 知识编辑 → 记忆更新
**启发**: ROME/MEND 等知识编辑技术

**可用于**:
- 修正 OpenClaw 的 L0/L1 记忆中的错误信息
- `superseded_by` 机制类似 MEND 的权重修改
- Entity Registry 类似知识图谱的定点编辑

---

## 核心代码仓库

| 仓库 | 用途 |
|------|------|
| https://github.com/zwhe99/X-SIR | 水印嵌入/检测/评估 |
| https://github.com/EasyJailbreak/EasyJailbreak | 越狱攻击框架 |

---

*学习日期: 2026-04-19*
