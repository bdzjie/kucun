---
name: invest
description: >
  Investment Advisory Council — get multi-perspective analysis on any stock.
  Each investor persona (Buffett/Munger/Taleb/etc.) gives an opinion on fundamentals,
  valuation, technicals, and sentiment. Use when asked about a stock buy/sell/hold recommendation.
  NOT financial advice — for educational purposes only.
triggers:
  - invest
  - analyze stock
  - 股票分析
  - 估值分析
  - K线
  - 买卖建议
  - 投资建议
command-dispatch: tool
---

# Invest — AI Investment Advisory Council

## Usage

```
/invest AAPL
/invest TSLA --analysts buffet,munger,taleb
/invest 腾讯 --Perspectives fundamentals,technicals,sentiment
```

## 分析师列表

| Key | 分析师 | 风格 |
|-----|--------|------|
| warren_buffett | Warren Buffett | 价值投资 + 护城河 + 内在价值 |
| charlie_munger | Charlie Munger | 优质企业 + 理性决策 |
| nassim_taleb | Nassim Taleb | 反脆弱 + 黑天鹅风险 + 尾部风险 |
| ben_graham | Ben Graham | 安全边际 + 格雷厄姆数 |
| peter_lynch | Peter Lynch | 成长股 + PEG + 十倍股 |
| michael_burry | Michael Burry | 逆向价值 + 做空机会 |
| bill_ackman | Bill Ackman | 积极主义投资 + 催化剂 |
| cathie_wood | Cathie Wood | 颠覆性创新 + 成长 |
| phil_fisher | Phil Fisher | scuttlebutt 研究 + 管理质量 |
| aswath_damodaran | Aswath Damodaran | 内在估值 + 叙事分析 |
| stanley_druckenmiller | Stanley Druckenmiller | 宏观 + 动量 |
| mohnish_pabrai | Mohnish Pabrai | Dhandho 低风险 |
| rakesh_jhunjhunwala | Rakesh Jhunjhunwala | 新兴市场 + 宏观 |
| technical_analyst | 技术分析师 | K线/RSI/MACD/布林带 |
| fundamentals_analyst | 基本面分析师 | 财务报表 + 比率 |
| sentiment_analyst | 情绪分析师 | 市场情绪 + 行为金融 |
| valuation_analyst | 估值分析师 | DCF/Graham/PEG |

## 输出格式

每个分析师返回：
- **signal**: BUY / HOLD / SELL / REDUCE
- **confidence**: 0-100%
- **reasoning**: 简短理由（<100字）

最终综合建议由决策Agent根据各分析师信号加权汇总。

## 数据来源

- 实时价格：`web_fetch` 抓取 Yahoo Finance
- 财务数据：`financial_datasets_api` (如果有key)
- K线图：`agent-browser` (如已安装)

## 免责声明

本工具仅供教育和研究目的，不构成任何投资建议或盈利保证。
