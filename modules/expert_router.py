"""
expert_router.py — Expert Router (MoE-Inspired Task Routing)
============================================================

基于 OpenMythos 的 MoE 设计灵感:
  - 多个"专家"(Skill chains) 竞争处理任务
  - 路由器根据任务特征选择最佳专家组合
  - 反馈循环持续优化路由质量

三种推理深度:
  - fast:     1 tool call, no iteration
  - normal:   up to 3 tool calls, basic loop
  - deep:     up to 8 tool calls, full loop (类似 OpenMythos max_loop_iters)
"""

import re
import json
import time
from pathlib import Path
from typing import Literal

# ============================================================================
# Task / Query Types
# ============================================================================

ReasoningDepth = Literal["fast", "normal", "deep"]

class TaskType:
    CODE = "code"           # 代码编写/修改/审查
    ANALYSIS = "analysis"   # 深度分析/研究
    MEMORY = "memory"       # 记忆存取/管理
    WEB = "web"            # 网页搜索/抓取
    FILE = "file"          # 文件操作/整理
    SYSTEM = "system"      # 系统配置/管理
    GENERAL = "general"    # 通用对话

# ============================================================================
# Expert Definitions (每个 Skill chain 是一个"专家")
# ============================================================================

EXPERTS: dict[str, dict] = {
    # --- 代码专家 ---
    "code_expert": {
        "skills": ["tdd", "code-review", "debugging", "exec-inline"],
        "keywords": [
            r"写代码", r"写个", r"代码", r"function", r"def\s+\w+\(", r"class\s+\w+",
            r"implement", r"代码审查", r"refactor", r"bug", r"fix",
            r"typescript", r"python", r"javascript", r"写个.*函数",
        ],
        "preferred_depth": "normal",
        "weight": 1.0,
    },
    # --- 分析专家 ---
    "analysis_expert": {
        "skills": ["conversation-analyst", "invest", "web-scraping", "session-search"],
        "keywords": [
            r"分析", r"研究", r"对比", r"评估", r"趋势", r"报告",
            r"compare", r"analyze", r"evaluate", r"assess",
            r"架构", r"架构分析", r"源码", r"代码结构",
        ],
        "preferred_depth": "deep",
        "weight": 1.2,  # 分析任务权重略高
    },
    # --- 记忆专家 ---
    "memory_expert": {
        "skills": ["memory-assistant", "fluid-memory", "ontology", "verify-memory", "cone-memory"],
        "keywords": [
            r"记得", r"记忆", r"之前", r"过去", r"记录",
            r"remember", r"memory", r"recall", r"past",
            r"沉淀", r"总结", r"学到",
            r"do you remember", r"what do you remember", r"query memory",
            r"search memory", r"cone graph", r"m.flow",
        ],
        "preferred_depth": "normal",
        "weight": 1.0,
    },
    # --- 网页专家 ---
    "web_expert": {
        "skills": ["web-scraping", "agent-browser"],
        "keywords": [
            r"搜索", r"网页", r"网站", r"http", r"抓取", r"获取",
            r"search", r"scrape", r"fetch", r"web", r"url",
        ],
        "preferred_depth": "normal",
        "weight": 1.0,
    },
    # --- 文件专家 ---
    "file_expert": {
        "skills": ["windows-gui", "git-workflow", "exec-inline"],
        "keywords": [
            r"文件", r"目录", r"文件夹", r"移动", r"复制", r"删除",
            r"file", r"folder", r"directory", r"path", r"read.*file",
        ],
        "preferred_depth": "fast",
        "weight": 0.8,
    },
    # --- 系统专家 ---
    "system_expert": {
        "skills": ["gateway-rpc", "studio", "sandbox-config", "skill-creator"],
        "keywords": [
            r"配置", r"设置", r"安装", r"启动", r"停止", r"重启",
            r"config", r"setup", r"install", r"start", r"stop",
            r"openclaw", r"gateway", r"skill",
        ],
        "preferred_depth": "fast",
        "weight": 0.9,
    },
}

# ============================================================================
# Depth Configuration (对应 OpenMythos 的 max_loop_iters)
# ============================================================================

DEPTH_CONFIG: dict[ReasoningDepth, dict] = {
    "fast": {
        "max_tool_calls": 1,      # 最多 1 次工具调用（无循环）
        "max_iterations": 1,
        "compact_threshold": 0.90,  # 90% token 预算时压缩
        "description": "快速响应，单步执行",
    },
    "normal": {
        "max_tool_calls": 3,      # 最多 3 次工具调用（基本循环）
        "max_iterations": 3,
        "compact_threshold": 0.75,  # 75% 时压缩
        "description": "标准模式，支持简单工具链",
    },
    "deep": {
        "max_tool_calls": 8,      # 最多 8 次（深度推理循环）
        "max_iterations": 8,
        "compact_threshold": 0.60,  # 60% 时压缩，保留更多空间
        "description": "深度推理，多步工具链，类似 OpenMythos loop",
    },
}

# ============================================================================
# Routing Result
# ============================================================================

class RouteResult:
    def __init__(
        self,
        task_type: str,
        expert: str,
        skills: list[str],
        depth: ReasoningDepth,
        confidence: float,
        matched_keywords: list[str],
    ):
        self.task_type = task_type
        self.expert = expert
        self.skills = skills
        self.depth = depth
        self.confidence = confidence
        self.matched_keywords = matched_keywords

    def __repr__(self):
        return (
            f"RouteResult(type={self.task_type}, expert={self.expert}, "
            f"depth={self.depth}, conf={self.confidence:.2f})"
        )

    def to_dict(self):
        return {
            "task_type": self.task_type,
            "expert": self.expert,
            "skills": self.skills,
            "depth": self.depth,
            "confidence": round(self.confidence, 3),
            "matched_keywords": self.matched_keywords,
        }

# ============================================================================
# Expert Router
# ============================================================================

class ExpertRouter:
    """
    专家路由器 — 基于 OpenMythos MoE 灵感

    工作流程:
      1. 分析用户输入，分类任务类型
      2. 计算每个专家的匹配分数
      3. 选取得分最高的专家（可多专家组合）
      4. 确定推理深度
      5. 返回路由结果
    """

    def __init__(self, state_dir: Path | None = None):
        self.state_dir = state_dir or Path.home() / ".openclaw"
        self.routing_log: list[dict] = []

    def classify(self, user_message: str) -> RouteResult:
        """
        核心路由方法 — 分析消息，返回路由决策
        """
        msg_lower = user_message.lower()
        msg_raw = user_message

        scores: dict[str, float] = {}

        for expert_name, expert_def in EXPERTS.items():
            score = 0.0
            matched = []

            for kw_pattern in expert_def["keywords"]:
                if re.search(kw_pattern, msg_raw, re.IGNORECASE):
                    score += 1.0
                    matched.append(kw_pattern)

            # 应用专家权重
            scores[expert_name] = score * expert_def["weight"]

        # 找最高分专家
        if not scores or max(scores.values()) == 0:
            # 未匹配到任何专家，使用通用
            best_expert = "general"
            best_score = 0.0
            matched = []
        else:
            best_expert = max(scores, key=scores.get)
            best_score = scores[best_expert]
            matched = [
                kw for kw in EXPERTS[best_expert]["keywords"]
                if re.search(kw, msg_raw, re.IGNORECASE)
            ]

        # Expert → Depth mapping
        EXPERT_DEPTH_MAP = {
            "file_expert": "fast",
            "system_expert": "fast",
            "analysis_expert": "deep",
            "code_expert": "normal",
            "memory_expert": "normal",
            "web_expert": "normal",
            "general": "normal",
        }
        depth: ReasoningDepth = EXPERT_DEPTH_MAP.get(best_expert, "normal")

        # 置信度：匹配词数 / 总关键词数
        total_kw = len(EXPERTS[best_expert]["keywords"])
        confidence = min(len(matched) / max(total_kw, 1), 1.0)

        # 置信度也受分数影响
        if best_score > 3:
            confidence = min(confidence + 0.2, 1.0)

        result = RouteResult(
            task_type=best_expert.replace("_expert", ""),
            expert=best_expert,
            skills=EXPERTS[best_expert]["skills"],
            depth=depth,
            confidence=confidence,
            matched_keywords=matched[:5],  # 最多保留5个匹配词
        )

        # 记录路由历史
        self._log_route(msg_raw[:100], result)

        return result

    def get_depth_config(self, depth: ReasoningDepth) -> dict:
        """获取指定深度模式的配置"""
        return DEPTH_CONFIG[depth]

    def should_stop_loop(
        self,
        depth: ReasoningDepth,
        tool_call_count: int,
        iteration_count: int,
    ) -> bool:
        """判断是否应该停止循环（对应 OpenMythos 的 max_loop_iters）"""
        config = DEPTH_CONFIG[depth]
        if tool_call_count >= config["max_tool_calls"]:
            return True
        if iteration_count >= config["max_iterations"]:
            return True
        return False

    def _log_route(self, message_preview: str, result: RouteResult) -> None:
        """记录路由历史到内存（后续可持久化到文件）"""
        self.routing_log.append({
            "time": time.time(),
            "message": message_preview,
            "expert": result.expert,
            "depth": result.depth,
            "confidence": result.confidence,
        })
        # 只保留最近 100 条
        if len(self.routing_log) > 100:
            self.routing_log = self.routing_log[-100:]

    def get_stats(self) -> dict:
        """获取路由统计（用于调优）"""
        if not self.routing_log:
            return {"total": 0}

        expert_counts: dict[str, int] = {}
        depth_counts: dict[str, int] = {}

        for entry in self.routing_log:
            expert_counts[entry["expert"]] = expert_counts.get(entry["expert"], 0) + 1
            depth_counts[entry["depth"]] = depth_counts.get(entry["depth"], 0) + 1

        return {
            "total": len(self.routing_log),
            "expert_distribution": expert_counts,
            "depth_distribution": depth_counts,
            "top_expert": max(expert_counts, key=expert_counts.get) if expert_counts else None,
        }

    def suggest_depth_for_message(self, user_message: str) -> ReasoningDepth:
        """
        基于消息内容推荐深度级别（用户可覆盖）
        """
        result = self.classify(user_message)

        # 强制深度指示符
        msg_lower = user_message.lower()
        if any(kw in msg_lower for kw in ["深入", "详细", "完整", "分析", "研究", "comprehensive", "deep"]):
            return "deep"
        if any(kw in msg_lower for kw in ["快速", "简单", "一句话", "brief", "quick", "fast"]):
            return "fast"

        return result.depth


# ============================================================================
# CLI Interface
# ============================================================================

if __name__ == "__main__":
    import sys

    router = ExpertRouter()

    if len(sys.argv) > 1:
        message = " ".join(sys.argv[1:])

        # JSON mode for programmatic callers
        if message == "--json":
            import json
            print(json.dumps(router.get_depth_config()))
            sys.exit(0)

        # Strip --json flag if passed as separate arg
        if "--json" in sys.argv:
            argv_no_json = [a for a in sys.argv if a != "--json"]
            message = " ".join(argv_no_json[1:])

        result = router.classify(message)

        # If caller passed --json flag, output machine-readable JSON
        if "--json" in sys.argv:
            import json
            print(json.dumps(result.to_dict(), ensure_ascii=False))
            sys.exit(0)

        print(f"\n{'='*50}")
        print(f"\u8f93\u5165: {message}")
        print(f"\u5206\u7c7b: {result.task_type}")
        print(f"\u4e13\u5bb6: {result.expert}")
        print(f"\u6df1\u5ea6: {result.depth}")
        print(f"\u7f6e\u4fe1: {result.confidence:.2f}")
        print(f"Skills: {result.skills}")
        print(f"\u5339\u914d\u8bcd: {result.matched_keywords}")
        print(f"\n\u6df1\u5ea6\u914d\u7f6e: {DEPTH_CONFIG[result.depth]}")
        print(f"{'='*50}\n")

