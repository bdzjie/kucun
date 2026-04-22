"""
invest_bridge.py — Python Bridge for Invest Handler
=================================================

统一调用：
1. AkShare 实时行情（备用）
2. Macro Expert（宏观分析）
3. Geopolitics Expert（地缘政治）
4. Quant Factors（量化因子）

输出 JSON 给 handler.js 调用。
"""

import asyncio
import json
import sys
import time
from enum import Enum

# ============================================================================
# Geopolitics Expert
# ============================================================================

class GeoRiskLevel(Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class SanctionImpact(Enum):
    NONE = "none"
    MINOR = "minor"
    MODERATE = "moderate"
    SEVERE = "severe"


class GeopoliticsExpert:
    """
    地缘政治风险分析。
    评估：制裁/关税/供应链/地区冲突 对股票的影响。

    Usage:
        expert = GeopoliticsExpert()
        risk = expert.analyze_risk("贵州茅台", sector="白酒", hk_listed=False)
        print(expert.format_report(risk))
    """

    # 地缘风险关键词
    GEO_KEYWORDS = {
        "china_us_trade": ["关税", "中美", "贸易战", "制裁", "实体清单", "出口管制", "301调查", "脱钩"],
        "taiwan_strait": ["台海", "台湾", "解放军", "军演", "武力"],
        "semiconductor": ["芯片", "半导体", "光刻机", "EUV", "先进制程", "设备禁运"],
        "energy": ["石油", "OPEC", "天然气", "能源危机", "原油", "LNG"],
        "supply_chain": ["供应链", "产能转移", "越南", "印度", "墨西哥", "去中国化"],
        "currency": ["人民币贬值", "汇率", "美元升值", "外汇", "资本外流"],
    }

    # 行业-地缘敏感度映射
    SECTOR_SENSITIVITY = {
        "科技": {"china_us_trade": 0.9, "taiwan_strait": 0.8, "semiconductor": 0.9, "supply_chain": 0.7},
        "半导体": {"china_us_trade": 0.95, "taiwan_strait": 0.95, "semiconductor": 0.95, "supply_chain": 0.8},
        "新能源": {"energy": 0.7, "supply_chain": 0.6, "china_us_trade": 0.5},
        "消费": {"supply_chain": 0.4, "china_us_trade": 0.3},
        "医药": {"china_us_trade": 0.4, "supply_chain": 0.5},
        "金融": {"currency": 0.7, "china_us_trade": 0.5},
        "白酒": {"china_us_trade": 0.2, "taiwan_strait": 0.3},
        "工业": {"energy": 0.6, "supply_chain": 0.5, "china_us_trade": 0.5},
        "地产": {"currency": 0.4},
        "综合": {"china_us_trade": 0.3, "taiwan_strait": 0.3},
    }

    # 当前地缘事件（简化判断）
    CURRENT_EVENTS = {
        "china_us_trade": {
            "level": "medium",
            "description": "中美贸易摩擦持续，部分领域关税调整",
            "last_update": "2025-Q4",
        },
        "taiwan_strait": {
            "level": "medium",
            "description": "台海局势稳定但存在不确定性",
            "last_update": "2025-Q4",
        },
        "semiconductor": {
            "level": "high",
            "description": "美国对华半导体设备出口限制升级",
            "last_update": "2025-Q4",
        },
        "supply_chain": {
            "level": "medium",
            "description": "供应链多元化趋势加速（越南/印度）",
            "last_update": "2025-Q4",
        },
        "currency": {
            "level": "low",
            "description": "人民币汇率双向波动，无大幅贬值预期",
            "last_update": "2025-Q4",
        },
    }

    def __init__(self):
        self.name = "geopolitics_expert"

    def analyze_risk(self, stock_name: str = "", sector: str = "综合",
                    hk_listed: bool = False, us_listed: bool = False,
                    export_ratio: float = 0.0) -> dict:
        """
        分析地缘政治风险。

        Args:
            stock_name: 股票名称
            sector: 行业（白酒/科技/半导体/消费等）
            hk_listed: 是否港股
            us_listed: 是否美股
            export_ratio: 出口收入占比（0-1）
        """
        sector_key = sector if sector in self.SECTOR_SENSITIVITY else "综合"
        sensitivities = self.SECTOR_SENSITIVITY.get(sector_key, self.SECTOR_SENSITIVITY["综合"])

        risks = []

        # 逐项评估
        for event_type, sensitivity in sensitivities.items():
            if sensitivity < 0.3:
                continue

            event = self.CURRENT_EVENTS.get(event_type, {})
            event_level = event.get("level", "low")

            # 风险分值 = 敏感度 × 事件等级
            level_map = {"low": 0.25, "medium": 0.5, "high": 0.75, "critical": 1.0}
            risk_score = sensitivity * level_map.get(event_level, 0.25)

            risks.append({
                "type": event_type,
                "sensitivity": sensitivity,
                "event_level": event_level,
                "risk_score": min(risk_score, 1.0),
                "description": event.get("description", ""),
            })

        # 港股额外风险（中国资产折价）
        if hk_listed:
            hk_risk = {
                "type": "hk_discount",
                "sensitivity": 0.7,
                "event_level": "medium",
                "risk_score": 0.4,
                "description": "港股中国资产折价（流动性折价+地缘风险折价）",
            }
            risks.append(hk_risk)

        # 美股中概股额外风险
        if us_listed:
            us_risk = {
                "type": "us_china_adrs",
                "sensitivity": 0.8,
                "event_level": "medium",
                "risk_score": 0.5,
                "description": "中概股退市风险+PCAOB审计争议",
            }
            risks.append(us_risk)

        # 出口导向型（高出口比例）
        if export_ratio > 0.3:
            export_risk = {
                "type": "export_dependency",
                "sensitivity": export_ratio,
                "event_level": "medium",
                "risk_score": export_ratio * 0.5,
                "description": f"高出口依赖度（{export_ratio*100:.0f}%），易受关税影响",
            }
            risks.append(export_risk)

        # 综合风险评分
        total_risk = sum(r["risk_score"] for r in risks)
        avg_risk = total_risk / len(risks) if risks else 0

        # 风险等级
        if avg_risk >= 0.7:
            risk_level = GeoRiskLevel.CRITICAL
        elif avg_risk >= 0.5:
            risk_level = GeoRiskLevel.HIGH
        elif avg_risk >= 0.3:
            risk_level = GeoRiskLevel.MEDIUM
        else:
            risk_level = GeoRiskLevel.LOW

        # 建议仓位调整
        position_adjustment = -avg_risk * 0.3  # 最大减仓 30%

        return {
            "stock_name": stock_name,
            "sector": sector,
            "risk_level": risk_level.value,
            "risk_score": round(avg_risk, 3),
            "position_adjustment": round(position_adjustment, 3),
            "risks": sorted(risks, key=lambda x: x["risk_score"], reverse=True)[:5],
            "warnings": self._generate_warnings(risk_level, risks),
        }

    def _generate_warnings(self, level: GeoRiskLevel, risks: list) -> list:
        warnings = []
        if level == GeoRiskLevel.CRITICAL:
            warnings.append("🚨 地缘政治风险极高，建议回避或极轻仓")
        elif level == GeoRiskLevel.HIGH:
            warnings.append("⚠️ 地缘政治风险偏高，控制仓位")
        elif level == GeoRiskLevel.MEDIUM:
            warnings.append("注意地缘风险，持续跟踪")

        for r in risks:
            if r["type"] == "semiconductor" and r["risk_score"] > 0.6:
                warnings.append("半导体设备出口管制升级，关注供应链")
            if r["type"] == "taiwan_strait" and r["risk_score"] > 0.5:
                warnings.append("台海局势存在不确定性，谨慎持仓")
            if r["type"] == "us_china_adrs" and r["risk_score"] > 0.4:
                warnings.append("中概股退市风险未完全消除")
        return warnings

    def format_report(self, risk: dict) -> str:
        """格式化报告"""
        level_emoji = {
            "low": "🟢", "medium": "🟡", "high": "🟠", "critical": "🔴"
        }
        emoji = level_emoji.get(risk["risk_level"], "⚪")

        lines = [
            f"{emoji} **地缘政治风险**: {risk['risk_level'].upper()} (评分 {risk['risk_score']:.0%})",
            f"   仓位调整建议: {risk['position_adjustment']:+.0%}",
        ]
        if risk["warnings"]:
            lines.append("   " + " | ".join(risk["warnings"][:2]))
        return "\n".join(lines)


# ============================================================================
# Main CLI — called by handler.js
# ============================================================================

async def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: python invest_bridge.py <ticker> [sector] [export_ratio]"}))
        sys.exit(1)

    ticker = sys.argv[1].upper()
    sector = sys.argv[2] if len(sys.argv) > 2 else "综合"
    export_ratio = float(sys.argv[3]) if len(sys.argv) > 3 else 0.0

    # 判断是否港股/美股
    hk_listed = ticker.startswith("HK") or ticker.startswith("hk")
    us_listed = ticker.startswith("US") or ticker.startswith("us")

    # 地缘政治分析
    geo = GeopoliticsExpert()
    geo_risk = geo.analyze_risk(
        stock_name=ticker,
        sector=sector,
        hk_listed=hk_listed,
        us_listed=us_listed,
        export_ratio=export_ratio,
    )

    result = {
        "ticker": ticker,
        "geopolitics": geo_risk,
        "geopolitics_report": geo.format_report(geo_risk),
    }

    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    asyncio.run(main())
