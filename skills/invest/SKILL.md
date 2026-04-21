---
name: invest
description: >
  AI Investment Advisory Council — multi-perspective stock analysis.
  Each investor persona (Buffett/Munger/Taleb/etc.) gives a BUY/HOLD/SELL/REDUCE
  signal with confidence and reasoning. Aggregated verdict from Portfolio Manager.
  Use when asked about stock buy/sell/hold recommendation, investment analysis,
  or financial advisory. NOT financial advice — educational purposes only.
triggers:
  - invest
  - stock analysis
  - 股票分析
  - 估值分析
  - K线
  - 买卖建议
  - 投资建议
  - 投资顾问
command-dispatch: tool
---

# Invest — AI Investment Advisory Council v3

Multi-agent investment analysis inspired by [virattt/ai-hedge-fund](https://github.com/virattt/ai-hedge-fund).

## Architecture

```
Ticker Input
    │
    ├─► [Investor Agents] (13 personas, parallel)
    │     Buffett / Munger / Taleb / Graham / Lynch /
    │     Burry / Wood / Fisher / Damodaran /
    │     Druckenmiller / Ackman / Pabrai / Jhunjhunwala
    │
    ├─► [Technical Analyst] (RSI/MACD/Bollinger/MA)
    │
    └─► [Portfolio Manager] — aggregates signals → BUY/HOLD/SELL/REDUCE
```

## Usage

```
/invest 002624      # 完整分析（完美世界，13位分析师）
/invest AAPL buffet,munger,taleb   # 只用指定分析师
/invest 腾讯         # 中文股票（腾讯=hk00700）
/invest 600519       # 贵州茅台（上交所）
```

## Data Sources

| Source | Coverage | Auth |
|--------|----------|------|
| Eastmoney (东方财富) | A股/港股/美股 | Free |
| Financial Datasets API | 财务指标 | API Key |
| Yahoo Finance | 美股 | Blocked in China |

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

## Output Fields

Per investor:
- **action**: BUY / HOLD / SELL / REDUCE
- **confidence**: 0–100%
- **reasoning**: <100 chars

Portfolio Manager:
- **action**: Aggregated decision
- **confidence**: Weighted average
- **vote distribution**: BUY/HOLD/SELL/REDUCE counts

## Signal Aggregation Logic

```
weighted_score = Σ(action_weight × investor_weight × confidence/100)
action_weight: BUY=1, HOLD=0, SELL=-0.5, REDUCE=-0.8
final_action: threshold-based on weighted_score
```

## Technical Indicators

- **RSI(14)**: Overbought>70 / Oversold<30
- **MACD**: EMA(12) - EMA(26), signal line crossover
- **Bollinger Bands**: 20-period ±2σ
- **Volatility**: Annualized 20-day returns std
- **MA50/MA200**: Golden Cross / Death Cross

## Risk Warnings

Auto-triggered when:
- Taleb/Graham/Burry发出SELL/REDUCE → ⚠️尾部风险警告
- Volatility > 50% → ⚠️高波动警告
- RSI > 70 或 < 30 → ⚠️超买/超卖警告
