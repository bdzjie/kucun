# HEARTBEAT.md — 主动执行 SOP

## 轮换检查清单

每次 Heartbeat 从中选取 2-3 项执行，不要全部检查（节省 token）。

```json
{
  "lastChecks": {
    "email": null,
    "calendar": null,
    "weather": null,
    "memory_maintenance": null,
    "git_status": null,
    "skills_health": null,
    "proactive_memory": null
  },
  "checkIntervalHours": {
    "email": 4,
    "calendar": 6,
    "weather": 8,
    "memory_maintenance": 48,
    "git_status": 12,
    "skills_health": 72,
    "proactive_memory": 2
  }
}
```

## 检查项详细说明

### 1. email（每 4 小时）

检查是否需要配置邮件客户端。如果有未读紧急邮件，主动提醒。

**触发**：上次检查 > 4 小时前
**主动行为**：有紧急邮件时通知用户，否则 HEARTBEAT_OK

### 2. calendar（每 6 小时）

检查 24-48h 内是否有重要事件。

**触发**：上次检查 > 6 小时前
**主动行为**：有即将到来的事件时提醒

### 3. weather（每 8 小时）

检查天气（使用 `weather` skill）。地点默认为**玉环市**（浙江台州）。

**触发**：上次检查 > 8 小时前，且用户可能外出
**主动行为**：恶劣天气时提醒

### 4. memory_maintenance（每 48 小时）

内存维护：
1. 读取最近的 `memory/YYYY-MM-DD.md` 文件
2. 识别值得长期保留的事件/教训
3. 更新 MEMORY.md
4. 删除 MEMORY.md 中已过时信息

**触发**：上次检查 > 48 小时前
**主动行为**：更新了重要记忆时汇报

**Ontology 集成**：
- `memory/ontology/graph.jsonl` 存储项目/任务状态
- `modules/ontology_task_update.py` 更新任务状态
- `modules/ontology.py` 查询知识图谱
- 任务完成后自动更新：`python modules/ontology_task_update.py done <task_id>`

### 5. git_status（每 12 小时）

检查 workspace git 状态，看是否有未提交的变更。

**触发**：上次检查 > 12 小时前
**主动行为**：有未 push 的 commit 或有未合并的分支时提醒

### 6. skills_health（每 72 小时）

审计 skills 安全性和健康度（使用 `audit_skills.py`）：
1. 运行 `python modules/audit_skills.py --json` 获取质量评分
2. 检查平均分是否低于 70
3. 检查缺失 triggers 的 skills
4. 严重问题时提醒用户

**触发**：上次检查 > 72 小时前
**主动行为**：
- 平均分 < 70 或缺失 triggers > 10 → 提醒并给出修复命令
- 运行 `python scripts/heartbeat_skills_health.py` 获取结构化报告

**自动修复**：
```bash
# 修复 frontmatter（添加缺失的 description: >）
python modules/fix_frontmatter.py --fix

# 批量添加 triggers
python modules/add_triggers.py
```

### 7. proactive_memory（每 2 小时）

从 `proactive_memory.mjs` 获取主动推送建议，并在适当时机呈现给用户。

**触发**：上次检查 > 2 小时前

**数据来源（综合分析）**：

| 来源 | 内容 | 阈值 |
|------|------|------|
| memory_rag | 相关历史记忆 | relevance > 0.4 |
| reflexion_buffer | 相关话题的过往失败/部分成功记录 | keyword overlap > 0 |
| self_evaluator | 最近评测维度趋势（最弱维度、整体评分） | 有数据时 |
| failure_recorder | 未确认的高严重度失败记录 | severity=high |
| reflection_journal | 每日自动生成的反思日志 | 每日一次 |

**surfacingCooldown**: 同一记忆/反射 60 秒内不重复推送

**主动行为**：检测到矛盾记忆、新主题相关记忆、过往失败教训、评测趋势时主动呈现

**输出字段更新**：返回 `reflexionCount`、`evalInsightCount`、`journalCount` 反映各类数据量

## 主动执行（无需询问）

Heartbeat 期间可以自动执行以下操作，无需单独询问用户：

1. **读取和组织记忆文件**
2. **检查 git status** — `git status` 在 workspace 目录
3. **更新文档** — 修正常见错误、改善结构
4. **提交和推送自己的变更** — 如果工作树干净且有变更
5. **更新 MEMORY.md** — 提炼每日笔记中的重要内容

## 沉默规则

以下情况回复 HEARTBEAT_OK，不做任何检查：

- 深夜（23:00-08:00），除非有紧急事项
- 用户明显处于忙碌状态
- 距上次检查 < 30 分钟
- 距上次主动推送 < 15 分钟

## 安全红线

Heartbeat 中**永远不要**执行：
- 外部邮件发送
- 公开社交媒体发帖
- 任何破坏性操作（`rm -rf` 等）
- 未经确认的外部下载

---

*最后更新: 2026-04-22 | 天气地点改为玉环市*