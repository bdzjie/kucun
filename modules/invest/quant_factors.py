"""
quant_factors.py — Quantitative Factor Library
=============================================

参考 FinceptTerminal 的 QuantLib Suite (18 modules)：
  - 风险因子: VaR, CVaR, Sharpe, Sortino
  - 技术因子: RSI, MACD, Bollinger, ATR
  - 波动率因子: 隐含波动率, 历史波动率
  - 固收因子: Duration, Convexity, YTM

使用方式:
    factors = QuantitativeFactors(price_history)
    report = factors.full_report()
    var = factors.value_at_risk(confidence=0.95)
    sharpe = factors.sharpe_ratio(rf=0.02)
"""

import math
import statistics
from dataclasses import dataclass
from typing import Optional


# ============================================================================
# Data Types
# ============================================================================

@dataclass
class FactorResult:
    name: str
    value: float
    unit: str
    signal: str       # "bullish" / "bearish" / "neutral"
    confidence: float  # 0-1
    description: str


@dataclass
class VaRResult:
    var: float
    cvar: float        # Conditional VaR / Expected Shortfall
    confidence: float
    horizon_days: int


@dataclass
class RiskReport:
    sharpe: float
    sortino: float
    max_drawdown: float
    calmar: float
    var: VaRResult
    volatility_annual: float
    volatility_regime: str  # "low" / "medium" / "high" / "extreme"
    beta: Optional[float]
    factors: list[FactorResult]


# ============================================================================
# Quantitative Factors Engine
# ============================================================================

class QuantitativeFactors:
    """
    量化因子计算引擎。
    输入: price_history — pd.Series 或 list of float (每日收盘价)
    """

    def __init__(self, prices: list[float]):
        if not prices or len(prices) < 2:
            raise ValueError("需要至少 2 个价格数据点")
        self.prices = [float(p) for p in prices]
        self.n = len(prices)

        # 预计算收益率
        self.returns = []
        for i in range(1, self.n):
            if self.prices[i-1] != 0:
                r = (self.prices[i] - self.prices[i-1]) / self.prices[i-1]
                self.returns.append(r)
            else:
                self.returns.append(0.0)

    # ─── 收益率统计 ────────────────────────────────────────────────────

    def mean_return(self) -> float:
        if not self.returns:
            return 0.0
        return sum(self.returns) / len(self.returns)

    def std_return(self) -> float:
        if len(self.returns) < 2:
            return 0.0
        return statistics.stdev(self.returns)

    def annual_return(self, periods_per_year: int = 252) -> float:
        """年化收益率"""
        mean = self.mean_return()
        return ((1 + mean) ** periods_per_year) - 1

    def annual_volatility(self, periods_per_year: int = 252) -> float:
        """年化波动率"""
        std = self.std_return()
        return std * math.sqrt(periods_per_year)

    # ─── 风险指标 ────────────────────────────────────────────────────

    def sharpe_ratio(self, rf: float = 0.02, periods_per_year: int = 252) -> float:
        """
        夏普比率 = (年化收益 - 无风险利率) / 年化波动率
        rf: 无风险利率（默认 2%）
        """
        ann_ret = self.annual_return(periods_per_year)
        ann_vol = self.annual_volatility(periods_per_year)
        if ann_vol == 0:
            return 0.0
        return (ann_ret - rf) / ann_vol

    def sortino_ratio(self, rf: float = 0.02, periods_per_year: int = 252,
                      target_return: float = 0) -> float:
        """
        索提诺比率 = (年化收益 - rf) / 下行波动率
        只考虑负收益的波动率
        """
        mean = self.mean_return()
        downside_returns = [r for r in self.returns if r < target_return]
        if not downside_returns:
            downside_std = 0.0
        else:
            downside_std = statistics.stdev(downside_returns) * math.sqrt(periods_per_year)

        ann_ret = self.annual_return(periods_per_year)
        if downside_std == 0:
            return 0.0
        return (ann_ret - rf) / downside_std

    def max_drawdown(self) -> float:
        """
        最大回撤 (Maximum Drawdown)
        从峰值到谷底的最大跌幅
        """
        peak = self.prices[0]
        max_dd = 0.0
        peak_price = self.prices[0]

        for price in self.prices:
            if price > peak_price:
                peak_price = price
            dd = (price - peak_price) / peak_price
            if dd < max_dd:
                max_dd = dd
        return max_dd

    def calmar_ratio(self, periods_per_year: int = 252) -> float:
        """
        Calmar 比率 = 年化收益 / |最大回撤|
        """
        ann_ret = self.annual_return(periods_per_year)
        mdd = abs(self.max_drawdown())
        if mdd == 0:
            return 0.0
        return ann_ret / mdd

    def value_at_risk(self, confidence: float = 0.95,
                      horizon_days: int = 1) -> VaRResult:
        """
        VaR — Value at Risk
        confidence: 置信水平 (默认 95%)
        horizon_days: 持有期 (默认 1 天)
        返回: 在 confidence 置信度下，最大损失
        """
        if not self.returns:
            return VaRResult(0, 0, confidence, horizon_days)

        # 1-day VaR → scaled by sqrt(horizon) for longer horizons
        sorted_returns = sorted(self.returns)
        idx = int((1 - confidence) * len(sorted_returns))
        var_1d = -sorted_returns[max(0, idx - 1)]

        # Scale by sqrt(horizon) (square-root rule)
        var_scaled = var_1d * math.sqrt(horizon_days)

        # CVaR (Expected Shortfall): average of all worse cases
        cutoff_idx = max(0, int((1 - confidence) * len(sorted_returns)) - 1)
        worse_returns = sorted_returns[:cutoff_idx + 1]
        cvar_1d = -statistics.mean(worse_returns) if worse_returns else var_1d
        cvar_scaled = cvar_1d * math.sqrt(horizon_days)

        return VaRResult(
            var=var_scaled,
            cvar=cvar_scaled,
            confidence=confidence,
            horizon_days=horizon_days,
        )

    # ─── 技术因子 ────────────────────────────────────────────────────

    def rsi(self, period: int = 14) -> float:
        """
        RSI (Relative Strength Index)
        超卖 < 30, 超买 > 70
        """
        if len(self.returns) < period:
            return 50.0

        gains = [max(0, r) for r in self.returns[-period:]]
        losses = [abs(min(0, r)) for r in self.returns[-period:]]

        avg_gain = sum(gains) / period
        avg_loss = sum(losses) / period

        if avg_loss == 0:
            return 100.0
        rs = avg_gain / avg_loss
        return 100 - (100 / (1 + rs))

    def macd(self, fast: int = 12, slow: int = 26,
             signal: int = 9) -> tuple[float, float, float]:
        """
        MACD = EMA(12) - EMA(26)
        Signal = EMA(9, MACD)
        返回: (macd, signal, histogram)
        """
        if len(self.prices) < slow:
            return 0.0, 0.0, 0.0

        def ema(data: list, n: int) -> float:
            k = 2 / (n + 1)
            ema_val = data[0]
            for price in data[1:]:
                ema_val = price * k + ema_val * (1 - k)
            return ema_val

        ema_fast = ema(self.prices[-fast:] if len(self.prices) >= fast else self.prices, fast)
        ema_slow = ema(self.prices[-slow:] if len(self.prices) >= slow else self.prices, slow)
        macd_line = ema_fast - ema_slow

        # Signal line
        macd_series = []
        for i in range(slow - 1, len(self.prices)):
            ef = ema(self.prices[max(0, i-fast+1):i+1], fast)
            es = ema(self.prices[max(0, i-slow+1):i+1], slow)
            macd_series.append(ef - es)

        if len(macd_series) >= signal:
            sig = ema(macd_series[-signal:], signal)
        else:
            sig = 0.0

        return macd_line, sig, macd_line - sig

    def bollinger_bands(self, period: int = 20,
                        num_std: float = 2.0) -> tuple[float, float, float]:
        """
        布林带 = MA(20) ± 2*σ
        返回: (lower, middle, upper)
        """
        if len(self.prices) < period:
            recent = self.prices
        else:
            recent = self.prices[-period:]

        middle = statistics.mean(recent)
        std = statistics.stdev(recent) if len(recent) > 1 else 0
        upper = middle + num_std * std
        lower = middle - num_std * std
        return lower, middle, upper

    def atr(self, period: int = 14) -> float:
        """
        ATR (Average True Range) — 衡量波动率
        """
        if len(self.prices) < period + 1:
            return 0.0

        true_ranges = []
        for i in range(1, min(period + 1, len(self.prices))):
            high = max(self.prices[i], self.prices[i-1])
            low = min(self.prices[i], self.prices[i-1])
            tr = high - low
            true_ranges.append(tr)

        return statistics.mean(true_ranges) if true_ranges else 0.0

    def volatility_regime(self, vol: float = None,
                          periods_per_year: int = 252) -> str:
        """波动率区间分类"""
        if vol is None:
            vol = self.annual_volatility(periods_per_year)
        vol_pct = vol * 100
        if vol_pct < 15:
            return "low"
        elif vol_pct < 30:
            return "medium"
        elif vol_pct < 50:
            return "high"
        else:
            return "extreme"

    # ─── 完整报告 ────────────────────────────────────────────────────

    def full_report(self, rf: float = 0.02,
                    var_confidence: float = 0.95) -> RiskReport:
        """生成完整量化因子报告"""
        vol = self.annual_volatility()
        var_res = self.value_at_risk(confidence=var_confidence)

        factors = []

        # RSI
        rsi_val = self.rsi()
        factors.append(FactorResult(
            name="RSI(14)",
            value=rsi_val,
            unit="",
            signal="oversold" if rsi_val < 30 else "overbought" if rsi_val > 70 else "neutral",
            confidence=abs(rsi_val - 50) / 50,
            description=f"{'超卖' if rsi_val < 30 else '超买' if rsi_val > 70 else '中性区间'}",
        ))

        # MACD
        macd, signal, hist = self.macd()
        factors.append(FactorResult(
            name="MACD",
            value=hist,
            unit="%",
            signal="bullish" if hist > 0 else "bearish",
            confidence=min(abs(hist) * 10, 1.0),
            description=f"MACD {'金叉' if hist > 0 else '死叉'}",
        ))

        # Bollinger Position
        lower, middle, upper = self.bollinger_bands()
        latest = self.prices[-1]
        if latest < lower:
            bb_signal = "oversold"
            bb_desc = "价格跌破下轨，超卖"
        elif latest > upper:
            bb_signal = "overbought"
            bb_desc = "价格突破上轨，超买"
        else:
            bb_signal = "neutral"
            bb_desc = f"价格在布林带内 ({latest/upper*100:.0f}%位置)"
        factors.append(FactorResult(
            name="Bollinger(20,2)",
            value=latest,
            unit="price",
            signal=bb_signal,
            confidence=0.5,
            description=bb_desc,
        ))

        return RiskReport(
            sharpe=self.sharpe_ratio(rf),
            sortino=self.sortino_ratio(rf),
            max_drawdown=self.max_drawdown(),
            calmar=self.calmar_ratio(),
            var=var_res,
            volatility_annual=vol,
            volatility_regime=self.volatility_regime(vol),
            beta=None,  # 需要市场数据
            factors=factors,
        )

    def format_report(self, report: RiskReport) -> str:
        """格式化量化因子报告"""
        vol = report.volatility_annual * 100
        mdd = report.max_drawdown * 100

        emoji_vol = {"low": "🟢", "medium": "🟡", "high": "🟠", "extreme": "🔴"}
        vol_emoji = emoji_vol.get(report.volatility_regime, "⚪")

        lines = [
            f"**量化因子报告** (样本数: {self.n})",
            "",
            f"| 指标 | 值 | 信号 |",
            f"|------|-----|------|",
            f"| 年化收益率 | {self.annual_return()*100:.1f}% | {'🟢' if self.annual_return() > 0 else '🔴'} |",
            f"| 年化波动率 | {vol:.1f}% | {vol_emoji} {report.volatility_regime} |",
            f"| 夏普比率 | {report.sharpe:.2f} | {'🟢' if report.sharpe > 1 else '🟡' if report.sharpe > 0 else '🔴'} |",
            f"| 索提诺比率 | {report.sortino:.2f} | — |",
            f"| Calmar 比率 | {report.calmar:.2f} | — |",
            f"| 最大回撤 | {mdd:.1f}% | — |",
            f"| VaR(95%,1d) | {report.var.var*100:.2f}% | — |",
            f"| CVaR | {report.var.cvar*100:.2f}% | — |",
            "",
            "### 技术因子",
        ]

        for f in report.factors:
            emoji = "🟢" if f.signal in ("bullish", "oversold") else "🔴" if f.signal in ("bearish", "overbought") else "🟡"
            lines.append(f"{emoji} **{f.name}**: {f.value:.4f}{f.unit} — {f.description}")

        return "\n".join(lines)


# ============================================================================
# CLI Test
# ============================================================================

if __name__ == "__main__":
    import json

    # 模拟 AAPL 过去 60 天价格
    import random
    random.seed(42)
    base = 180.0
    prices = [base]
    for _ in range(59):
        prices.append(prices[-1] * (1 + random.gauss(0.001, 0.02)))

    qf = QuantitativeFactors(prices)
    report = qf.full_report()
    print(qf.format_report(report))
