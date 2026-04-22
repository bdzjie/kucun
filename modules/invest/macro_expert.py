"""
macro_expert.py — Economic Expert Agent
=======================================

参考 FinceptTerminal 的 Economic Agent 设计：
  - 宏观因子分析（利率/通胀/增长）
  - 货币政策立场判断
  - 利率曲线分析
  - 地缘经济风险评估

参考 IMF/World Bank 数据 connector：
  - FRED: 联邦基金利率, 国债收益率, 失业率, CPI
  - IMF: 全球增长预测, 通胀
  - World Bank: GDP, 人口, 发展指标
"""

import asyncio
import json
from dataclasses import dataclass
from datetime import datetime
from enum import Enum
from typing import Optional

from modules.invest.data_connectors import DataConnectorManager, FredConnector, IMFConnector, WorldBankConnector


# ============================================================================
# Policy Stance — 货币政策立场
# ============================================================================

class PolicyStance(Enum):
    EXPANSIVE = "expansive"    # 宽松 (降息/QE)
    NEUTRAL = "neutral"         # 中性
    RESTRICTIVE = "restrictive"  # 紧缩 (加息/QT)
    UNKNOWN = "unknown"


# ============================================================================
# Yield Curve Shape
# ============================================================================

class YieldCurveShape(Enum):
    NORMAL = "normal"         # 向上倾斜 (2y < 10y)
    FLAT = "flat"             # 平坦
    INVERTED = "inverted"     # 倒挂 (2y > 10y)
    HIROSHIMA = "hiroshima"   # 极度倒挂 (>100bp)


@dataclass
class MacroSignal:
    indicator: str
    value: float
    unit: str
    direction: str  # "up" / "down" / "stable"
    signal: str     # "bullish" / "bearish" / "neutral"
    description: str


@dataclass
class MacroVerdict:
    policy_stance: PolicyStance
    policy_confidence: float
    growth_outlook: str         # "strong" / "moderate" / "weak"
    inflation_risk: str          # "high" / "medium" / "low"
    recession_probability: float
    yield_curve_shape: YieldCurveShape
    key_risks: list[str]
    summary: str
    signals: list[MacroSignal]


class MacroExpert:
    """
    宏观分析 Agent。
    并行获取多源数据，输出货币政策立场 + 增长/通胀展望。

    使用:
        expert = MacroExpert()
        verdict = await expert.analyze()
        print(verdict.summary)
    """

    name = "macro_expert"
    color = "🟣"

    def __init__(self, api_key_fred: str = ""):
        self.dcm = DataConnectorManager()
        if api_key_fred:
            self.dcm.add_connector(FredConnector(api_key_fred), "fred")
        self.dcm.add_connector(IMFConnector(), "imf")
        self.dcm.add_connector(WorldBankConnector(), "worldbank")

    async def analyze(self) -> MacroVerdict:
        """
        并行获取所有宏观数据，执行分析。
        """
        # 并行请求所有指标
        fed_rate_t, treasy_t, unemp_t, cpi_t, curve_t = await asyncio.gather(
            self.dcm.get("fred", "DFF"),
            self.dcm.get("fred", "DGS10"),
            self.dcm.get("fred", "UNRATE"),
            self.dcm.get("fred", "CPIAUCSL"),
            self._get_yield_curve(),
            return_exceptions=True,
        )

        signals: list[MacroSignal] = []

        # 1. 联邦基金利率
        fed_rate = self._parse_latest_value(fed_rate_t)
        if fed_rate is not None:
            signals.append(MacroSignal(
                indicator="联邦基金利率",
                value=fed_rate,
                unit="%",
                direction=self._trend(fed_rate, 3.5),  # vs 3个月前
                signal=self._rate_signal(fed_rate),
                description=self._rate_desc(fed_rate),
            ))

        # 2. 10年期国债
        treasury_10y = self._parse_latest_value(treasy_t)
        if treasury_10y is not None:
            signals.append(MacroSignal(
                indicator="10年期国债收益率",
                value=treasury_10y,
                unit="%",
                direction=self._trend(treasury_10y, 2.5),
                signal=self._rate_signal(treasury_10y),
                description=self._rate_desc(treasury_10y),
            ))

        # 3. 失业率
        unemployment = self._parse_latest_value(unemp_t)
        if unemployment is not None:
            signals.append(MacroSignal(
                indicator="失业率",
                value=unemployment,
                unit="%",
                direction=self._trend(unemployment, 3.8),
                signal="bullish" if unemployment < 4 else "bearish",
                description=self._unemployment_desc(unemployment),
            ))

        # 4. CPI 同比变化
        cpi_data = self._parse_series(cpi_t)
        cpi_change = 0.0
        if len(cpi_data) >= 12:
            cpi_change = float(cpi_data[-1]["value"]) - float(cpi_data[-12]["value"]) if cpi_data[-1]["value"] != "." else 0

        # 5. 收益率曲线
        curve_shape = YieldCurveShape.NORMAL
        recession_prob = 0.0
        if isinstance(curve_t, dict):
            curve_shape = self._analyze_curve(curve_t)
            if curve_shape == YieldCurveShape.INVERTED:
                recession_prob = 0.60
            elif curve_shape == YieldCurveShape.HIROSHIMA:
                recession_prob = 0.75
            elif curve_shape == YieldCurveShape.FLAT:
                recession_prob = 0.30

        # 6. 货币政策立场
        policy_stance, policy_conf = self._judge_policy(
            fed_rate, unemployment, cpi_change, curve_shape
        )

        # 7. 通胀风险
        if cpi_change > 5:
            inflation_risk = "high"
        elif cpi_change > 2:
            inflation_risk = "medium"
        else:
            inflation_risk = "low"

        # 8. 增长展望
        if fed_rate is not None and unemployment is not None:
            if unemployment < 4 and fed_rate < 2:
                growth_outlook = "strong"
            elif unemployment < 5.5:
                growth_outlook = "moderate"
            else:
                growth_outlook = "weak"
        else:
            growth_outlook = "moderate"

        # 9. 关键风险
        key_risks = self._identify_risks(
            curve_shape, recession_prob, cpi_change, fed_rate
        )

        # 10. 总结
        summary = self._summarize(
            policy_stance, growth_outlook, inflation_risk,
            recession_prob, curve_shape, key_risks
        )

        return MacroVerdict(
            policy_stance=policy_stance,
            policy_confidence=policy_conf,
            growth_outlook=growth_outlook,
            inflation_risk=inflation_risk,
            recession_probability=recession_prob,
            yield_curve_shape=curve_shape,
            key_risks=key_risks,
            summary=summary,
            signals=signals,
        )

    # ─── 并行获取收益率曲线 ────────────────────────────────────────────

    async def _get_yield_curve(self) -> dict:
        """获取完整收益率曲线"""
        tasks = [
            self.dcm.get("fred", "DGS2"),
            self.dcm.get("fred", "DGS5"),
            self.dcm.get("fred", "DGS10"),
            self.dcm.get("fred", "DGS30"),
        ]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        curve = {}
        for r in results:
            if not isinstance(r, Exception) and isinstance(r.data, list):
                latest = r.data[-1]
                series_id = r.indicator
                curve[series_id] = latest.get("value", "N/A")
        return curve

    # ─── 解析 helpers ──────────────────────────────────────────────────

    def _parse_latest_value(self, response) -> Optional[float]:
        if hasattr(response, "data") and isinstance(response.data, list):
            data = response.data
            if data:
                # 倒序找最新非空值
                for item in reversed(data):
                    val = item.get("value", ".")
                    if val != ".":
                        return float(val)
        return None

    def _parse_series(self, response) -> list:
        if hasattr(response, "data") and isinstance(response.data, list):
            return response.data
        return []

    # ─── 分析逻辑 ──────────────────────────────────────────────────────

    def _trend(self, current: float, baseline: float) -> str:
        diff = current - baseline
        if diff > 0.25:
            return "up"
        elif diff < -0.25:
            return "down"
        return "stable"

    def _rate_signal(self, rate: float) -> str:
        if rate > 5.5:
            return "bearish"  # 高利率压制风险资产
        elif rate > 4:
            return "neutral"
        elif rate > 2:
            return "bullish"  # 低利率支持估值
        else:
            return "bullish"

    def _rate_desc(self, rate: float) -> str:
        if rate > 5.5:
            return "处于限制性区间，持续压制风险偏好"
        elif rate > 4:
            return "处于紧缩区间，流动性收紧"
        elif rate > 2:
            return "处于中性偏低区间，政策环境偏宽松"
        else:
            return "极度宽松区间，流动性充裕"

    def _unemployment_desc(self, rate: float) -> str:
        if rate < 3.5:
            return "极低失业率，工资-物价螺旋风险"
        elif rate < 4:
            return "充分就业状态，接近自然失业率"
        elif rate < 5.5:
            return "正常区间，劳动力市场稳健"
        else:
            return "失业率偏高，经济增长放缓"

    def _analyze_curve(self, curve: dict) -> YieldCurveShape:
        try:
            y2 = float(curve.get("DGS2", "0"))
            y10 = float(curve.get("DGS10", "0"))
            if y2 == 0 or y10 == 0:
                return YieldCurveShape.NORMAL
            spread = y10 - y2
            if spread > 0.5:
                return YieldCurveShape.NORMAL
            elif spread > 0:
                return YieldCurveShape.FLAT
            elif spread > -1:
                return YieldCurveShape.INVERTED
            else:
                return YieldCurveShape.HIROSHIMA
        except:
            return YieldCurveShape.NORMAL

    def _judge_policy(
        self, fed_rate: Optional[float], unemployment: Optional[float],
        cpi: float, curve: YieldCurveShape
    ) -> tuple[PolicyStance, float]:
        """
        判断美联储货币政策立场。
        参考：
          - Taylor Rule: real_rate ≈ 2 + π - 0.5*(π - 2) - 0.5*(u - natural_rate)
          - 简化：实际利率 = nominal - inflation
        """
        if fed_rate is None:
            return PolicyStance.UNKNOWN, 0.0

        # 简化泰勒规则
        neutral_real = 0.5  # 实际中性利率
        natural_unemp = 4.0  # 自然失业率
        inflation_target = 2.0

        implied_real = fed_rate - cpi
        output_gap = (unemployment or 4.0) - natural_unemp

        # 泰勒规则残差
        taylor_residual = implied_real - (neutral_real + 0.5 * (cpi - inflation_target) - 0.5 * output_gap)

        if fed_rate > 5.0 and taylor_residual > 0:
            stance = PolicyStance.RESTRICTIVE
            conf = min(0.9, 0.7 + abs(taylor_residual) * 0.1)
        elif fed_rate < 2.5 and taylor_residual < -0.5:
            stance = PolicyStance.EXPANSIVE
            conf = 0.75
        elif 3.5 <= fed_rate <= 5.0:
            stance = PolicyStance.NEUTRAL
            conf = 0.65
        else:
            stance = PolicyStance.NEUTRAL
            conf = 0.5

        return stance, conf

    def _identify_risks(
        self, curve: YieldCurveShape, recession_prob: float,
        cpi: float, fed_rate: Optional[float]
    ) -> list[str]:
        risks = []
        if curve == YieldCurveShape.INVERTED:
            risks.append("⚠️ 收益率曲线倒挂，经济衰退预警")
        if curve == YieldCurveShape.HIROSHIMA:
            risks.append("🚨 深度倒挂，衰退概率显著上升")
        if cpi > 5:
            risks.append(f"⚠️ 通胀率偏高 ({cpi:.1f}%)，警惕价格风险")
        if recession_prob > 0.5:
            risks.append(f"⚠️ 衰退概率较高 ({recession_prob*100:.0f}%)")
        if fed_rate is not None and fed_rate > 5:
            risks.append("高利率环境持续，估值承压")
        return risks

    def _summarize(
        self, policy: PolicyStance, growth: str, inflation: str,
        recession: float, curve: YieldCurveShape, risks: list[str]
    ) -> str:
        stance_str = {
            PolicyStance.EXPANSIVE: "宽松🟢",
            PolicyStance.NEUTRAL: "中性🟡",
            PolicyStance.RESTRICTIVE: "紧缩🔴",
            PolicyStance.UNKNOWN: "未知⚪",
        }[policy]

        parts = [
            f"**货币政策立场**: {stance_str}，增长展望 {growth}，通胀风险 {inflation}",
            f"**衰退概率**: {recession*100:.0f}%（收益率曲线: {curve.value}）",
        ]
        if risks:
            parts.append("**关键风险**: " + " | ".join(risks))
        return " | ".join(parts)

    # ─── 输出格式 ──────────────────────────────────────────────────────

    def format_report(self, verdict: MacroVerdict) -> str:
        """格式化宏观分析报告"""
        lines = [
            f"{self.color} **Macro Expert — 宏观分析报告**",
            f"",
            f"**货币政策**: {verdict.policy_stance.value.upper()} (置信度 {verdict.policy_confidence:.0%})",
            f"**增长展望**: {verdict.growth_outlook}",
            f"**通胀风险**: {verdict.inflation_risk}",
            f"**衰退概率**: {verdict.recession_probability:.0%}",
            f"**曲线形态**: {verdict.yield_curve_shape.value}",
            f"",
            f"### 核心指标",
        ]
        for s in verdict.signals:
            emoji = "📈" if s.direction == "up" else "📉" if s.direction == "down" else "➡️"
            lines.append(
                f"  {emoji} {s.indicator}: **{s.value:.2f}{s.unit}** "
                f"({s.signal.upper()}) — {s.description}"
            )

        if verdict.key_risks:
            lines.extend(["", "### 风险提示", *[f"  {r}" for r in verdict.key_risks]])

        lines.extend(["", "---", verdict.summary])
        return "\n".join(lines)


# ============================================================================
# CLI Test
# ============================================================================

if __name__ == "__main__":
    async def test():
        expert = MacroExpert()
        verdict = await expert.analyze()
        print(expert.format_report(verdict))
        print("\n[Data Connector Stats]")
        print(json.dumps(expert.dcm.stats(), indent=2))

    asyncio.run(test())
