# Investor Persona Reference

## Warren Buffett
**Philosophy**: "Buy wonderful businesses at fair prices, not fair businesses at wonderful prices."
**Key Metrics**: ROE > 15%, moat strength, intrinsic value vs market price, long-term holding
**Scoring**: Deterministic financial ratios → LLM synthesis → BUY/HOLD/SELL signal

## Charlie Munger
**Philosophy**: "Invert, always invert." Quality businesses, rational decisions, multi-disciplinary thinking.
**Key Metrics**: Moat strength, management quality, rational decision-making framework
**Scoring**: Similar to Buffett but emphasizes psychological factors

## Ben Graham
**Philosophy**: "Margin of safety" — only buy when price is significantly below intrinsic value.
**Key Metrics**: Graham Number = sqrt(22.5 × EPS × Book Value), P/E < 15, debt/equity < 50%
**Scoring**: Deep value, prefers mature industries, ignores growth

## Peter Lynch
**Philosophy**: "Buy what you know" — invest in understandable businesses with growth potential.
**Key Metrics**: PEG ratio < 1, earnings growth, debt levels, 10-bagger potential
**Scoring**: Growth at reasonable price, practical metrics

## Michael Burry
**Philosophy**: "Go against the grain" — deep value, often finds opportunities in ignored/hated sectors.
**Key Metrics**: Cash flow, liquidation value, short candidates, contrarian indicators
**Scoring**: Contrarian deep value, concentrated bets

## Nassim Taleb
**Philosophy**: "Antifragility" — companies that improve from stressors, barbell strategy.
**Key Metrics**: Antifragility score, tail risk, negativa (avoiding stupidity), convex payoffs
**Scoring**: No LLM — pure quantitative barbell strategy

## Cathie Wood
**Philosophy**: "Disruptive innovation" — high growth, ignores short-term valuation.
**Key Metrics**: Innovation potential, market opportunity size, technological edge
**Scoring**: Long-term growth, accepts high volatility

## Phil Fisher
**Philosophy**: "Scuttlebutt" — extensive qualitative research through customer/supplier interviews.
**Key Metrics**: R&D spend, management quality, patent portfolio, customer satisfaction
**Scoring**: Qualitative + some quantitative, very long-term holding

## Aswath Damodaran
**Philosophy**: "Intrinsic value through DCF" — narrative and numbers together.
**Key Metrics**: DCF valuation, sector-multiple normalization, narrative risk assessment
**Scoring**: Academic approach, explicit assumptions

## Stanley Druckenmiller
**Philosophy**: "Macro momentum" — big bets on currencies, commodities, interest rates.
**Key Metrics**: Macro trends, momentum indicators, asymmetric opportunities
**Scoring**: Top-down, accepts high volatility for high conviction

## Technical Analyst
**Philosophy**: "Price discounts everything" — read price action and indicators.
**Key Metrics**: RSI, MACD, Bollinger Bands, support/resistance, trend lines
**Scoring**: Pure technical, no fundamental analysis

## Fundamentals Analyst
**Philosophy**: "Financial statements tell the truth" — systematic ratio analysis.
**Key Metrics**: Income statement ratios, balance sheet health, cash flow quality
**Scoring**: Pure quantitative, comprehensive

## Sentiment Analyst
**Philosophy**: "Market is driven by human emotion" — fear, greed, behavioral biases.
**Key Metrics**: News sentiment scoring, insider trading, analyst ratings, crowd behavior
**Scoring**: Behavioral + news-based

## Valuation Analyst
**Philosophy**: "Fair value is calculable" — multiple models, explicit assumptions.
**Key Metrics**: DCF, Graham, PEG, relative valuation, scenario analysis
**Scoring**: Pure quant, no LLM — deterministic calculations

## Risk Manager
**Philosophy**: "Preserve capital first" — volatility-adjusted position sizing.
**Key Metrics**: Volatility, correlation, position limits, tail risk (VaR/CVaR)
**Scoring**: Hard constraints on all other agents' recommendations

---

## Signal Aggregation Logic

The Portfolio Manager receives all analyst signals in this format:
```json
{
  "warren_buffett": { "signal": "HOLD", "confidence": 72, "reasoning": "..." },
  "ben_graham": { "signal": "SELL", "confidence": 65, "reasoning": "..." },
  ...
}
```

It applies:
1. **Hard Constraints** from Risk Manager (`remaining_position_limit`)
2. **Deterministic Pruning** — max buy qty = min(limit/price, cash/price)
3. **LLM Synthesis** — receives only `action` per ticker, synthesizes final `BUY/HOLD/SELL/REDUCE`
