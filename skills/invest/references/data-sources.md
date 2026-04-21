# Invest Skill — Data Sources & Configuration

## Data Sources

### Free APIs
| Source | Data | URL |
|--------|------|-----|
| Yahoo Finance | Price, fundamentals (blocked in China) | `query1.finance.yahoo.com` |
| Sina Finance | 中国股票数据 | `money.finance.sina.com.cn` |
| Eastmoney | 实时行情/财务数据 | `push2.eastmoney.com` |
| Tencent Finance | 实时行情 | `qt.gtimg.cn` |

### Requires API Key
| Source | Data | Cost |
|--------|------|------|
| Financial Datasets API | Comprehensive financial data | $19/mo |
| Alpha Vantage | Stocks/Forex/Crypto | Free tier available |
| Yahoo Finance Premium | Real-time data | ~$30/mo |

## Environment Variables

```bash
# Optional - enables real data fetching
FINANCIAL_DATASETS_API_KEY=your_key
OPENAI_API_KEY=your_key  # For LLM-based signal synthesis
```

## Deployment

This skill runs standalone via `/invest <TICKER>` command.
It does NOT require the full ai-hedge-fund backend to be running.

For full multi-agent collaboration (19 agents), run:
```bash
cd E:\ai-hedge-fund-main
poetry run python src/main.py --ticker AAPL,MSFT
```
