---
name: invest
description: >
  AI Investment Advisory Council — multi-perspective stock analysis.
  Each investor persona (Buffett/Munger/Taleb/etc.) gives a BUY/HOLD/SELL/REDUCE
  signal with confidence and reasoning. Aggregated verdict from Portfolio Manager.
  Enhanced with FinceptTerminal-inspired macro analysis (FRED/IMF/World Bank) and
  quantitative factor library (VaR, Sharpe, RSI, MACD, Bollinger Bands).
  Use when asked about stock buy/sell/hold recommendation, investment analysis,
  or financial advisory. NOT financial advice — educational purposes only.
triggers:
  - invest
  - macro
  - quant
  - geopolitics
  - 地缘政治
  - 宏观分析
  - 量化因子
  - FRED
  - VaR
  - stock analysis
  - 股票分析
  - 估值分析
  - K线
  - 买卖建议
  - 投资建议
  - 投资顾问
command-dispatch: tool
---

# Invest — AI Investment Advisory Council v4

Multi-agent investment analysis inspired by:
- [virattt/ai-hedge-fund](https://github.com/virattt/ai-hedge-fund) — LangGraph multi-agent, risk manager, Kelly Criterion
- [ivebotunac/PrimoAgent](https://github.com/ivebotunac/PrimoAgent) — News Intelligence Agent, sentiment analysis

## Architecture

```
Ticker Input
    │
    ├─► [News Sentiment Agent]        ← PrimoAgent inspiration
    │     Eastmoney news API + 7-dim NLP → sentiment score (-1 to +1)
    │
    ├─► [Investor Agents] (13 personas, parallel)
    │     Buffett / Munger / Taleb / Graham / Lynch /
    │     Burry / Wood / Fisher / Damodaran / Druckenmiller /
    │     Ackman / Pabrai / Jhunjhunwala
    │
    ├─► [Technical Analyst] (RSI/MACD/Bollinger/MA)
    │
    ├─► [Risk Manager]                ← ai-hedge-fund inspiration
    │     Annualized volatility + correlation adjustment + position limits
    │
    ├─► [MacroExpert]  ← FinceptTerminal
    │     FRED + IMF + WorldBank → PolicyStance + YieldCurve + RecessionProb
    │     RESTRICTIVE → Kelly -20% | EXPANSIVE → Kelly +10%
    │
    ├─► [GeopoliticsExpert]  ← FinceptTerminal
    │     Sanctions / Tariffs / Supply Chain / Taiwan Strait
    │     Risk score + position adjustment + warnings
    │
    └─► [Portfolio Aggregator]        ← Kelly Criterion + risk-adjusted scoring
          aggregates signals → BUY/HOLD/SELL/REDUCE + position size
```

## Usage

```
/invest 002624                  # 完整分析（完美世界，13位分析师）
/invest AAPL                    # 美股，苹果
/invest 腾讯                    # 港股，腾讯
/invest 600519 buffet,munger,taleb  # 只用指定分析师
```

## Stock Code Formats

| Format | Example | Market |
|--------|---------|--------|
| 6位数字 | 002624, 600519 | A股（自动判断sh/sz） |
| hkXXXXX | hk00700 | 港股 |
| usXXXXX | usAAPL | 美股 |
| 中文名 | 腾讯, 美团, 茅台 | 港股（自动转换） |

## Investor Personas

| Key | Name | Style | Weight |
|-----|------|-------|--------|
| buffet | Warren Buffett | 价值/护城河 | 1.0 |
| munger | Charlie Munger | 优质/理性 | 0.9 |
| taleb | Nassim Taleb | 尾部风险 | 1.2 |
| graham | Ben Graham | 安全边际 | 0.9 |
| lynch | Peter Lynch | 成长/PEG | 1.0 |
| burry | Michael Burry | 逆向深度价值 | 0.8 |
| wood | Cathie Wood | 颠覆性创新 | 1.1 |
| fisher | Phil Fisher | scuttlebutt | 0.85 |
| damodaran | Aswath Damodaran | DCF内在价值 | 1.0 |
| druckenmiller | Stanley Druckenmiller | 宏观动量 | 0.9 |
| ackman | Bill Ackman | 积极主义催化剂 | 1.3 |
| pabrai | Mohnish Pabrai | Dhandho低风险 | 1.0 |
| jhunjhunwala | Rakesh Jhunjhunwala | 新兴市场 | 0.9 |

## New Features in v4

### News Sentiment Agent
- Fetches recent news from **Eastmoney News API** (no auth required)
- Computes **sentiment score (-1 to +1)** based on keyword matching
- 7 NLP features:
  | Feature | Description |
  |---------|-------------|
  | positivity | Positive keyword density |
  | negativity | Negative keyword density |
  | relevance | Recency-weighted relevance |
  | urgency | Urgency keyword density |
  | volatility | Risk-related keywords |
  | specificity | Financial term density |
  | domain | Classified sector (科技/消费/医药/金融/工业/地产) |
- News feeds into investor scoring (enhances Buffett/Graham/Munger style signals)

### Risk Manager
Inspired by `ai-hedge-fund risk_manager.py`:
- **Annualized Volatility**: Calculated from 20-day returns, sqrt(252) annualization
- **Position Limits by Volatility**:
  | Volatility | Max Allocation |
  |------------|----------------|
  | < 15% (low) | 25% |
  | 15–30% (medium) | 15% |
  | 30–50% (high) | 10% |
  | > 50% (very high) | 5% |
- **Correlation Penalty**: Holdings with rho ≥ 0.8 get 0.7x multiplier (domain overlap proxy)
- **Risk Score**: Aggregates volatility + sentiment + urgency signals

### Portfolio Aggregator (Enhanced)
- **Kelly Criterion**: Half-Kelly position sizing (win rate from vote distribution)
- **Risk-Adjusted Scoring**: Final score multiplied by vol-based damping factor
- **Confidence Calibration**: Properly bounded 0–90%
- **Position Recommendation**: Kelly-based sizing advice per verdict

## Data Sources

| Source | Coverage | Auth |
|--------|----------|------|
| Eastmoney (东方财富) | A股/港股/美股 | Free |
| Eastmoney News API | 实时新闻 | Free |
| Financial Indicators API | 财务指标 | API Key |

## Financial Metrics

Fundamentals retrieved (when available):
- Revenue / Net Profit (营收/净利润)
- Gross Margin / Operating Margin (毛利率/营业利润率)
- ROE / ROA (净资产收益率/资产收益率)
- Debt Ratio / Current Ratio / Quick Ratio (负债率/流动比率/速动比率)
- Operating CF / Free CF (经营现金流/自由现金流)

## Output Fields

Per investor:
- **action**: BUY / HOLD / SELL / REDUCE
- **confidence**: 0–100%
- **reasoning**: <100 chars (includes sentiment tag if significant)

Risk Manager:
- **annualizedVolatility**: percentage
- **riskScore**: 0–100
- **volatilityLimit**: max position %
- **kellySize**: Kelly-based position %
- **warnings**: array of risk alerts

Portfolio Manager:
- **action**: Aggregated decision
- **confidence**: Risk-adjusted weighted average
- **rawScore** / **riskAdjustedScore**: dual scoring
- **kellyFraction**: Kelly position size %
- **positionRecommendation**: human-readable sizing advice

## Signal Aggregation

```
investor_score = style_score + sentiment_adjustment
weighted_signal = Σ(action_weight × investor_weight × confidence/100)
action_weight: BUY=1, HOLD=0, SELL=-0.5, REDUCE=-0.8
risk_adjusted_score = raw_score × volatility_multiplier
final_verdict: threshold-based with Kelly position recommendation
```

## Technical Indicators

- **RSI(14)**: Overbought>70 / Oversold<30
- **MACD**: EMA(12) - EMA(26), signal line crossover
- **Bollinger Bands**: 20-period ±2σ
- **MA50/MA200**: Golden Cross / Death Cross

## FinceptTerminal-Inspired Enhancements (2026-04-22)

### modules/invest/data_connectors.py — 100+ Data Sources

Unified DataConnectorManager with 4 connectors (inspired by FinceptTerminal):

| Connector | Source | Key Indicators |
|-----------|--------|---------------|
| FredConnector | 美联储 FRED API | DFF(联邦基金利率), DGS10(10y国债), UNRATE, CPIAUCSL |
| IMFConnector | IMF WEO | NGDP_RPCH(实际GDP增长), 通胀预测 |
| WorldBankConnector | World Bank API | NY.GDP.MKTP.CD(GDP), 人口, 发展指标 |
| AkShareConnector | A股实时行情 | 股票/指数实时报价 (无需登录) |

```python
from modules.invest.data_connectors import DataConnectorManager

mgr = DataConnectorManager()
# 添加 FRED (需要 API key)
mgr.add_connector(FredConnector(api_key="your-key"), "fred")

# 查询 10 年期国债收益率
resp = await mgr.get("fred", "DGS10")
print(resp.data)
```

### modules/invest/macro_expert.py — Economic Expert Agent

Inspired by FinceptTerminal Economic Agent:
- **PolicyStance**: Taylor Rule-based monetary policy judgment
- **Yield Curve**: Normal / Flat / Inverted / Hiroshima classification
- **Recession Probability**: Based on curve shape + leading indicators
- **Parallel Data Fetch**: FRED + IMF + WorldBank simultaneously

```python
from modules.invest.macro_expert import MacroExpert

expert = MacroExpert(api_key_fred="your-key")
verdict = await expert.analyze()
print(expert.format_report(verdict))
```

### modules/invest/quant_factors.py — Quantitative Factor Library

Inspired by FinceptTerminal QuantLib Suite:
- **Risk Metrics**: Sharpe, Sortino, Calmar, Max Drawdown
- **VaR/CVaR**: Value at Risk + Expected Shortfall (95%/99%)
- **Volatility Regime**: low / medium / high / extreme
- **Technical Factors**: RSI, MACD, Bollinger Bands, ATR

```python
from modules.invest.quant_factors import QuantitativeFactors

qf = QuantitativeFactors([180.0, 182.5, 181.2, ...])
report = qf.full_report(rf=0.02)
print(qf.format_report(report))
# Output: sharpe=0.89, var=3.58%, rsi=33.3, macd=-4.4%...
```

## Risk Warnings

Auto-triggered when:
- Taleb/Graham/Burry发出SELL/REDUCE → ⚠️尾部风险警告
- Volatility > 50% → ⚠️高波动警告
- Sentiment score < -0.5 → ⚠️负面情绪警告
- Urgency > 70% → ⚠️高紧迫性信号