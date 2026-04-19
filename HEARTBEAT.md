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

检查天气（使用 `weather` skill）。

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

### 5. git_status（每 12 小时）

检查 workspace git 状态，看是否有未提交的变更。

**触发**：上次检查 > 12 小时前
**主动行为**：有未 push 的 commit 或有未合并的分支时提醒

### 6. skills_health（每 72 小时）

审计 skills 安全性和健康度：
1. 检查新安装的 skills 是否有恶意模式
2. 检查 skills 是否需要更新
3. 检查 Evolution System 是否有待处理变体

**触发**：上次检查 > 72 小时前
**主动行为**：发现问题 skills 时提醒

### 7. proactive_memory（每 2 小时）

从 `proactive_memory.mjs` 获取主动推送建议，并在适当时机呈现给用户。

**触发**：上次检查 > 2 小时前
**主动行为**：检测到矛盾记忆或新主题相关记忆时主动呈现

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

*最后更新: 2026-04-20 | CAP 框架重构版*
