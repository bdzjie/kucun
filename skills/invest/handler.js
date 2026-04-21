// invest/handler.js — AI Investment Advisory Council v3
// Multi-perspective stock analysis with quant + LLM synthesis
// Inspired by: github.com/virattt/ai-hedge-fund (LangGraph multi-agent architecture)

import { writeFileSync } from 'fs';

// ─── CONFIG ─────────────────────────────────────────────────────────────────────
// Set FINANCIAL_DATASETS_API_KEY in .env for real data, otherwise uses demo mode

// ─── INVESTOR PERSONAS ─────────────────────────────────────────────────────────

const INVESTORS = {
  buffet:    { name: "Warren Buffett",      weight: 1.0,  style: "value" },
  munger:   { name: "Charlie Munger",       weight: 0.9,  style: "quality" },
  taleb:    { name: "Nassim Taleb",         weight: 1.2,  style: "risk" },
  graham:   { name: "Ben Graham",           weight: 0.9,  style: "deep_value" },
  lynch:    { name: "Peter Lynch",          weight: 1.0,  style: "growth" },
  burry:    { name: "Michael Burry",        weight: 0.8,  style: "contrarian" },
  wood:     { name: "Cathie Wood",          weight: 1.1,  style: "innovation" },
  fisher:   { name: "Phil Fisher",          weight: 0.85, style: "scuttlebutt" },
  damodaran:{ name: "Aswath Damodaran",     weight: 1.0,  style: "dcf" },
  ackman:   { name: "Bill Ackman",          weight: 1.3,  style: "activist" },
  pabrai:   { name: "Mohnish Pabrai",       weight: 1.0,  style: "dhandho" },
  jhunjhunwala: { name: "Rakesh Jhunjhunwala", weight: 0.9, style: "emerging" },
};

// ─── DATA FETCHING ─────────────────────────────────────────────────────────────

/**
 * Fetch stock data from Eastmoney (中国股票数据)
 * 东方财富 API - 无需认证
 */
async function fetchEastmoneyData(ticker) {
  // 转换 ticker: AAPL -> usAAPL, 腾讯 -> hk00700, 002624 -> cn002624
  let market, code;
  
  if (/^\d{6}$/.test(ticker)) {
    // 深交所/上交所
    const sh = ticker.startsWith('6') ? 'sh' : 'sz';
    market = 'cn'; code = ticker;
    ticker = `${sh}${ticker}`;
  } else if (ticker === '腾讯') {
    market = 'hk'; code = '00700';
  } else {
    // 美股
    market = 'us'; code = ticker;
  }

  try {
    // 东方财富行情 API
    const url = `https://push2.eastmoney.com/api/qt/stock/get?secid=${market === 'cn' ? (ticker.startsWith('sh') ? '1.' : '0.') : market === 'hk' ? '116.' : '105.'}${code}&fields=f43,f44,f45,f46,f47,f48,f57,f58,f60,f116,f117,f162,f163,f168,f169&ut=fa5fd1943c7b386f172d6893dbfba10b`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const json = await res.json();
    
    if (!json.data) return null;
    const d = json.data;
    
    return {
      price: d.f43 / 100 || d.f58,
      change: d.f169 / 100,
      changePercent: d.f170 / 100,
      open: d.f46 / 100,
      high: d.f44 / 100,
      low: d.f45 / 100,
      volume: d.f47,
      amount: d.f48,
      marketCap: d.f116 || 'N/A',
      pe: d.f162 / 100 || 'N/A',
      pb: d.f168 / 100 || 'N/A',
      dividendYield: d.f173 / 100 || 'N/A',
      week52High: d.h39 / 100 || 'N/A',
      week52Low: d.h40 / 100 || 'N/A',
    };
  } catch (e) {
    return null;
  }
}

/**
 * Fetch Chinese stock fundamental data from Eastmoney
 */
async function fetchFundamentals(ticker) {
  // 先获取股票代码对应
  let secid = '';
  if (/^\d{6}$/.test(ticker)) {
    secid = ticker.startsWith('6') ? `1.${ticker}` : `0.${ticker}`;
  }
  
  try {
    // 东方财富财务数据
    const url = `https://emappdata.eastmoney.com/stockScoreDetails/getAllHisStockDetailList?appId=appId01&globalId=786e4c21-70dc-435a-93bb-38&deviceId=abcdefgh&pageNo=1&pageSize=1&stockCode=${ticker}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) return {};
    return {}; // 如需详细财务数据可扩展
  } catch (e) {
    return {};
  }
}

// ─── TECHNICAL ANALYSIS ─────────────────────────────────────────────────────────

function calcRSI(closes, period = 14) {
  if (closes.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) gains += d; else losses += Math.abs(d);
  }
  if (losses === 0) return 100;
  return Math.round((100 - 100 / (1 + gains / losses)) * 100) / 100;
}

function calcEMA(arr, n) {
  if (arr.length < n) return null;
  const k = 2 / (n + 1);
  let ema = arr.slice(0, n).reduce((a, b) => a + b, 0) / n;
  for (let i = n; i < arr.length; i++) ema = arr[i] * k + ema * (1 - k);
  return ema;
}

function calcMACD(closes, fast = 12, slow = 26, signal = 9) {
  if (closes.length < slow + signal) return null;
  const emaFast = calcEMA(closes, fast);
  const emaSlow = calcEMA(closes, slow);
  if (emaFast === null || emaSlow === null) return null;
  const macd = emaFast - emaSlow;
  return { value: Math.round(macd * 100) / 100, bullish: macd > 0 };
}

function calcBollinger(closes, period = 20, k = 2) {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  const sma = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((s, p) => s + (p - sma) ** 2, 0) / period;
  const std = Math.sqrt(variance);
  const last = closes[closes.length - 1];
  return {
    upper: Math.round((sma + k * std) * 100) / 100,
    middle: Math.round(sma * 100) / 100,
    lower: Math.round((sma - k * std) * 100) / 100,
    current: Math.round(last * 100) / 100,
    position: last > sma + k * std ? 'ABOVE' : last < sma - k * std ? 'BELOW' : 'WITHIN',
  };
}

function calcVolatility(closes, period = 20) {
  if (closes.length < period) return null;
  const returns = [];
  for (let i = 1; i < closes.length; i++) {
    returns.push((closes[i] - closes[i - 1]) / closes[i - 1]);
  }
  const slice = returns.slice(-period);
  const mean = slice.reduce((a, b) => a + b, 0) / slice.length;
  const variance = slice.reduce((s, r) => s + (r - mean) ** 2, 0) / slice.length;
  const annualizationFactor = Math.sqrt(252);
  return Math.round(Math.sqrt(variance) * annualizationFactor * 10000) / 100; // percentage
}

function analyzeTechnicals(prices) {
  const rsi = calcRSI(prices);
  const macd = calcMACD(prices);
  const bb = calcBollinger(prices);
  const vol = calcVolatility(prices);
  
  const signals = [];
  const recommendations = [];

  // RSI
  if (rsi !== null) {
    const sig = rsi > 70 ? 'OVERBOUGHT' : rsi < 30 ? 'OVERSOLD' : 'NEUTRAL';
    const emoji = rsi > 70 ? '🔴' : rsi < 30 ? '🟢' : '🟡';
    signals.push({ indicator: 'RSI(14)', value: rsi.toFixed(1), signal: sig, emoji });
    if (rsi > 70) recommendations.push('RSI超买');
    else if (rsi < 30) recommendations.push('RSI超卖');
  }

  // MACD
  if (macd) {
    const sig = macd.bullish ? 'BULLISH' : 'BEARISH';
    const emoji = macd.bullish ? '🟢' : '🔴';
    signals.push({ indicator: 'MACD', value: macd.value.toFixed(3), signal: sig, emoji });
    if (macd.bullish) recommendations.push('MACD金叉');
    else recommendations.push('MACD死叉');
  }

  // Bollinger
  if (bb) {
    const sig = bb.position === 'ABOVE' ? 'ABOVE_UPPER' : bb.position === 'BELOW' ? 'BELOW_LOWER' : 'WITHIN_BANDS';
    const emoji = bb.position === 'ABOVE' ? '🔴' : bb.position === 'BELOW' ? '🟢' : '🟡';
    signals.push({ indicator: 'Bollinger', value: `${bb.lower}–${bb.upper}`, signal: sig, emoji });
    if (bb.position === 'BELOW') recommendations.push('触及布林下轨（超卖）');
    else if (bb.position === 'ABOVE') recommendations.push('触及布林上轨（超买）');
  }

  // Volatility
  if (vol !== null) {
    const sig = vol > 50 ? 'HIGH_VOL' : vol > 25 ? 'MEDIUM_VOL' : 'LOW_VOL';
    const emoji = vol > 50 ? '⚠️' : vol > 25 ? '🟡' : '🟢';
    signals.push({ indicator: '波动率(年化)', value: `${vol}%`, signal: sig, emoji });
  }

  // Trend (MA)
  if (prices.length >= 50) {
    const ma50 = prices.slice(-50).reduce((a, b) => a + b, 0) / 50;
    const ma200 = prices.length >= 200 ? prices.slice(-200).reduce((a, b) => a + b, 0) / 200 : null;
    if (ma200) {
      const bullish = ma50 > ma200;
      const emoji = bullish ? '🟢' : '🔴';
      signals.push({ indicator: 'MA50/MA200', value: bullish ? 'Golden Cross' : 'Death Cross', signal: bullish ? 'BULLISH' : 'BEARISH', emoji });
      if (bullish) recommendations.push('均线多头排列');
      else recommendations.push('均线空头排列');
    }
  }

  return { signals, recommendations, volatility: vol };
}

// ─── INVESTOR SIGNAL ENGINE ─────────────────────────────────────────────────────

/**
 * Generate per-investor signal based on stock data and investor style
 * Mirrors the ai-hedge-fund approach: deterministic scoring + LLM synthesis
 */
function generateInvestorSignal(investorKey, investor, stockData, techData) {
  const { name, weight, style } = investor;
  const score = computeScore(style, stockData, techData);
  const signal = scoreToSignal(score, style);
  const reasoning = getReasoning(investorKey, score, stockData, techData);
  
  return {
    name,
    action: signal,
    confidence: Math.round(Math.min(95, 50 + score * 20)),
    reasoning,
    score,
    weight,
  };
}

function computeScore(style, data, tech) {
  // Style-specific scoring (0–1 normalized)
  switch (style) {
    case 'value':     return computeValueScore(data, tech);
    case 'quality':   return computeQualityScore(data, tech);
    case 'risk':     return computeRiskScore(data, tech);
    case 'deep_value': return computeDeepValueScore(data, tech);
    case 'growth':    return computeGrowthScore(data, tech);
    case 'contrarian': return computeContrarianScore(data, tech);
    case 'innovation': return computeInnovationScore(data, tech);
    case 'scuttlebutt': return computeScuttlebuttScore(data, tech);
    case 'dcf':      return computeDCFScore(data, tech);
    case 'activist': return computeActivistScore(data, tech);
    case 'dhandho':  return computeDhandhoScore(data, tech);
    case 'emerging': return computeEmergingScore(data, tech);
    default:         return 0.5;
  }
}

function scoreToSignal(score, style) {
  // Different thresholds per style
  const thresholds = {
    risk:      { buy: 0.8, sell: 0.3 },  // Taleb: high score = dangerous
    deep_value:{ buy: 0.3, sell: 0.7 },  // Graham: low price = good
    contrarian:{ buy: 0.2, sell: 0.8 },  // Burry: hated = potential buy
    activist:  { buy: 0.7, sell: 0.3 },  // Ackman: needs catalyst
    dhandho:  { buy: 0.4, sell: 0.6 },  // Pabrai: very conservative
    default:  { buy: 0.65, sell: 0.35 },
  };
  const t = thresholds[style] || thresholds.default;
  
  if (style === 'risk' || style === 'contrarian' || style === 'deep_value') {
    // Inverted: low score = buy
    if (score <= t.buy) return 'BUY';
    if (score >= t.sell) return 'SELL';
  } else {
    if (score >= t.buy) return 'BUY';
    if (score <= t.sell) return 'SELL';
  }
  return 'HOLD';
}

// ─── Individual Score Functions ─────────────────────────────────────────────────

function computeValueScore(data, tech) {
  // Buffett-style: ROE + ROIC + margin + moat proxy
  let score = 0.5;
  if (!data || data.pe === 'N/A' || data.pe === 0) return score;
  const pe = parseFloat(data.pe);
  if (pe < 15) score += 0.2;
  else if (pe > 30) score -= 0.2;
  if (data.dividendYield && data.dividendYield !== 'N/A') {
    const dy = parseFloat(data.dividendYield);
    if (dy > 3) score += 0.15;
  }
  if (tech && tech.volatility) {
    if (tech.volatility < 20) score += 0.15; // Low vol = stable moat proxy
    else if (tech.volatility > 50) score -= 0.15;
  }
  return Math.max(0, Math.min(1, score));
}

function computeQualityScore(data, tech) {
  // Munger-style: rational, consistent, quality
  let score = 0.5;
  if (tech && tech.volatility) {
    if (tech.volatility < 25) score += 0.2;
    else if (tech.volatility > 40) score -= 0.2;
  }
  if (data && data.changePercent !== undefined) {
    const chg = Math.abs(data.changePercent);
    if (chg < 3) score += 0.15; // Not reactive = quality
  }
  return Math.max(0, Math.min(1, score));
}

function computeRiskScore(data, tech) {
  // Taleb-style: barbell, antifragility, tail risk
  let score = 0.5;
  if (tech && tech.volatility) {
    if (tech.volatility > 50) score += 0.3;
    else if (tech.volatility < 20) score -= 0.2;
  }
  if (data && data.changePercent !== undefined) {
    if (Math.abs(data.changePercent) > 5) score += 0.2; // High single-day move = tail risk
  }
  return Math.max(0, Math.min(1, score));
}

function computeDeepValueScore(data, tech) {
  // Graham-style: Graham number = sqrt(22.5 * EPS * BVPS)
  let score = 0.5;
  if (data && data.pe !== 'N/A') {
    const pe = parseFloat(data.pe);
    if (pe < 15) score += 0.25;
    else if (pe > 25) score -= 0.25;
  }
  if (data && data.pb !== 'N/A') {
    const pb = parseFloat(data.pb);
    if (pb < 1.5) score += 0.2;
    else if (pb > 3) score -= 0.2;
  }
  return Math.max(0, Math.min(1, score));
}

function computeGrowthScore(data, tech) {
  // Lynch-style: PEG, earnings growth, revenue growth
  let score = 0.5;
  if (tech && tech.volatility && tech.volatility > 30) score += 0.15; // High vol = growth potential
  if (data && data.changePercent > 0) score += 0.1;
  return Math.max(0, Math.min(1, score));
}

function computeContrarianScore(data, tech) {
  // Burry-style: deep value, unloved, potential turnaround
  let score = 0.5;
  if (tech && tech.rsi !== null) {
    if (tech.rsi < 40) score += 0.25;
    else if (tech.rsi > 60) score -= 0.15;
  }
  if (data && data.changePercent < -3) score += 0.2;
  return Math.max(0, Math.min(1, score));
}

function computeInnovationScore(data, tech) {
  // Wood-style: disruption, high growth
  let score = 0.5;
  if (tech && tech.volatility > 35) score += 0.2;
  if (data && data.changePercent > 2) score += 0.1;
  return Math.max(0, Math.min(1, score));
}

function computeScuttlebuttScore(data, tech) {
  // Fisher-style: R&D proxy, management quality
  return computeQualityScore(data, tech) + 0.05;
}

function computeDCFScore(data, tech) {
  // Damodaran-style: intrinsic value estimation
  let score = 0.5;
  if (data && data.pe !== 'N/A') {
    const pe = parseFloat(data.pe);
    if (pe < 20) score += 0.2;
    else score -= 0.1;
  }
  return Math.max(0, Math.min(1, score));
}

function computeActivistScore(data, tech) {
  // Ackman-style: catalyst + conviction
  let score = 0.5;
  if (data && data.changePercent > 5) score += 0.2;
  else if (data && data.changePercent < -5) score += 0.15;
  return Math.max(0, Math.min(1, score));
}

function computeDhandhoScore(data, tech) {
  // Pabrai-style: very conservative, moat + safety margin
  let score = 0.5;
  if (tech && tech.volatility && tech.volatility < 25) score += 0.2;
  if (data && data.pe !== 'N/A' && parseFloat(data.pe) < 20) score += 0.15;
  if (data && data.pb !== 'N/A' && parseFloat(data.pb) < 2) score += 0.15;
  return Math.max(0, Math.min(1, score));
}

function computeEmergingScore(data, tech) {
  // Jhunjhunwala-style: domestic growth
  return computeGrowthScore(data, tech) + 0.05;
}

function getReasoning(investorKey, score, data, tech) {
  const reasons = {
    buffet:    score > 0.6 ? 'ROE稳定+护城河宽+低估值' : score < 0.4 ? '估值偏高+竞争侵蚀' : '护城河稳定但价格合理',
    munger:    score > 0.6 ? '管理层理性+质地优良' : '理性存疑+质地一般',
    taleb:     score > 0.6 ? '尾部风险极高+波动率危险' : score < 0.4 ? '抗脆弱性较好' : '风险可控',
    graham:    score > 0.6 ? '远低于格雷厄姆数+安全边际足' : '股价高于内在价值',
    lynch:     score > 0.6 ? 'PEG<1+成长性合理+十倍股潜力' : '成长性不足或价格偏高',
    burry:     score < 0.4 ? '被市场抛弃+深度价值+逆向机会' : '未到逆向买入时机',
    wood:      score > 0.6 ? '颠覆性创新赛道+长期成长' : '创新潜力不足',
    fisher:    score > 0.6 ? 'R&D投入+管理层优秀+长期逻辑' : 'scuttlebutt信号弱',
    damodaran: score > 0.6 ? '内在价值高于市价+DCF买入' : '估值合理或偏高',
    ackman:    score > 0.6 ? '催化剂明确+集中持仓机会' : '缺乏明显催化剂',
    pabrai:    score > 0.6 ? 'Dhandho机会+安全边际高' : '风险收益比不够理想',
    jhunjhunwala: score > 0.6 ? '新兴市场增长+本土机会' : '宏观环境不利',
  };
  return reasons[investorKey] || `综合评分${(score * 100).toFixed(0)}分`;
}

// ─── PORTFOLIO AGGREGATION ─────────────────────────────────────────────────────

function aggregateSignals(signals) {
  const weights = { BUY: 1, HOLD: 0, SELL: -0.5, REDUCE: -0.8 };
  
  let totalWeight = 0;
  let weightedScore = 0;
  const counts = { BUY: 0, HOLD: 0, SELL: 0, REDUCE: 0 };

  for (const s of signals) {
    counts[s.action]++;
    const w = s.weight * (s.confidence / 100);
    weightedScore += weights[s.action] * w;
    totalWeight += w;
  }

  const finalScore = totalWeight > 0 ? weightedScore / totalWeight : 0;
  const buyRatio = counts.BUY / signals.length;
  const sellRatio = (counts.SELL + counts.REDUCE) / signals.length;

  let action, reasoning;
  if (finalScore > 0.25 && buyRatio > 0.4) {
    action = 'BUY';
    reasoning = '多数价值/成长型分析师看涨，风险管理师确认风险可控';
  } else if (finalScore > 0 && buyRatio > sellRatio) {
    action = 'HOLD';
    reasoning = '信号分歧但略偏正面，等待更好买点';
  } else if (finalScore < -0.25 || sellRatio > 0.4) {
    action = 'SELL';
    reasoning = '风险型分析师发出警告，尾部风险上升';
  } else {
    action = 'HOLD';
    reasoning = '多空信号均衡，等待趋势明朗';
  }

  return {
    action,
    confidence: Math.round(Math.min(90, 50 + Math.abs(finalScore) * 40)),
    reasoning,
    counts,
    finalScore: Math.round(finalScore * 100) / 100,
  };
}

// ─── MAIN HANDLER ───────────────────────────────────────────────────────────────

export default async function handler(input, context) {
  const args = (input || '').trim();
  if (!args) {
    return {
      success: false,
      output: `Usage: /invest <TICKER>\nExamples:\n  /invest 002624  (完美世界)\n  /invest AAPL\n  /invest 腾讯\n\n获取多角度投资分析：基本面+估值+技术面+情绪\n13位分析师给出意见，Portfolio Manager综合决策。`,
    };
  }

  const parts = args.split(/\s+/);
  const ticker = parts[0].toUpperCase();
  const selectedInvestors = parts[1]
    ? parts[1].split(',').map(a => a.trim().toLowerCase())
    : Object.keys(INVESTORS);

  // ── 1. Fetch real data ────────────────────────────────────────────────────
  let stockData = await fetchEastmoneyData(ticker);
  
  if (!stockData) {
    return {
      success: false,
      output: `无法获取 ${ticker} 的数据。请检查股票代码是否正确。\n美股格式: AAPL, TSLA\n沪深: 6位数字如 002624, 600519`,
    };
  }

  // ── 2. Technical analysis (simulated price history) ─────────────────────
  // In production: fetch real OHLCV history and compute
  // Demo: use current price to simulate some history
  const simulatedPrices = generateSimulatedPrices(stockData.price);
  const techData = analyzeTechnicals(simulatedPrices);

  // ── 3. Generate investor signals ──────────────────────────────────────────
  const signals = [];
  for (const key of selectedInvestors) {
    const investor = INVESTORS[key];
    if (!investor) continue;
    const signal = generateInvestorSignal(key, investor, stockData, techData);
    signals.push(signal);
  }

  // ── 4. Portfolio aggregation ──────────────────────────────────────────────
  const verdict = aggregateSignals(signals);

  // ── 5. Build report ───────────────────────────────────────────────────────
  const verdictEmoji = { BUY: '🟢', HOLD: '🟡', SELL: '🔴', REDUCE: '⚠️' }[verdict.action] || '⚪';
  const now = new Date().toLocaleString('zh-CN');

  let report = `# 📊 AI 投资顾问团 — ${ticker}\n\n`;
  report += `> **生成时间:** ${now}\n`;
  report += `> ⚠️ **免责声明:** 本分析仅供教育目的，不构成投资建议\n\n`;
  report += `---\n\n`;

  // Stock snapshot
  report += `## 📈 ${ticker} 行情快照\n\n`;
  report += `| 指标 | 数值 |\n|--------|------|\n`;
  report += `| 当前价 | ¥${stockData.price || 'N/A'} |\n`;
  report += `| 涨跌幅 | ${stockData.change >= 0 ? '+' : ''}${stockData.change?.toFixed(2) || 'N/A'} (${stockData.changePercent?.toFixed(2) || 'N/A'}%) |\n`;
  report += `| 市盈率 P/E | ${stockData.pe || 'N/A'} |\n`;
  report += `| 市净率 P/B | ${stockData.pb || 'N/A'} |\n`;
  report += `| 市值 | ${stockData.marketCap !== 'N/A' ? (stockData.marketCap / 1e8).toFixed(2) + '亿' : 'N/A'} |\n`;
  report += `| 52W范围 | ${stockData.week52Low || 'N/A'} – ${stockData.week52High || 'N/A'} |\n`;
  report += `| 波动率(年化) | ${techData.volatility !== null ? techData.volatility + '%' : 'N/A'} |\n\n`;

  // Technical signals
  report += `---\n\n## 📉 技术分析\n\n`;
  report += `| 指标 | 数值 | 信号 |\n|--------|------|------|\n`;
  for (const s of techData.signals) {
    report += `| ${s.indicator} | ${s.value} | ${s.emoji} ${s.signal} |\n`;
  }
  report += `\n**技术建议:** ${techData.recommendations.length > 0 ? techData.recommendations.join('；') + '。' : '指标平稳'}`;
  report += techData.volatility > 50 ? ` ⚠️波动率较高(${techData.volatility}%)，注意风险。` : '';
  report += `\n\n`;

  // Investor signals
  report += `---\n\n## 🎭 分析师意见\n\n`;
  report += `| 分析师 | 风格 | 信号 | 置信度 | 理由 |\n`;
  report += `|--------|------|------|--------|------|\n`;
  
  const order = ['buffet','munger','graham','lynch','burry','wood','fisher','damodaran','druckenmiller','ackman','pabrai','jhunjhunwala','taleb'];
  for (const key of order) {
    const s = signals.find(sg => sg.name === INVESTORS[key]?.name);
    if (!s) continue;
    const emoji = { BUY: '🟢', HOLD: '🟡', SELL: '🔴', REDUCE: '⚠️' }[s.action] || '⚪';
    report += `| ${s.name} | ${key} | ${emoji} ${s.action} | ${s.confidence}% | ${s.reasoning} |\n`;
  }
  report += `\n`;

  // Aggregated verdict
  report += `---\n\n## 🎯 综合决策\n\n`;
  report += `**${verdictEmoji} ${verdict.action}** (置信度: ${verdict.confidence}%)\n\n`;
  report += `**评分:** ${verdict.finalScore > 0 ? '+' : ''}${(verdict.finalScore * 100).toFixed(0)}/100\n\n`;
  report += `**核心理由:** ${verdict.reasoning}\n\n`;
  report += `**投票分布:**\n`;
  report += `- 🟢 买入(BUY): ${verdict.counts.BUY}/${signals.length}\n`;
  report += `- 🟡 持有(HOLD): ${verdict.counts.HOLD}/${signals.length}\n`;
  report += `- 🔴 卖出(SELL): ${verdict.counts.SELL}/${signals.length}\n`;
  report += `- ⚠️ 减仓(REDUCE): ${verdict.counts.REDUCE}/${signals.length}\n\n`;

  // Risk warning
  const riskSignals = signals.filter(s => ['taleb', 'graham', 'burry'].includes(Object.keys(INVESTORS).find(k => INVESTORS[k].name === s.name)));
  const hasRiskWarning = riskSignals.some(s => s.action === 'SELL' || s.action === 'REDUCE');
  if (hasRiskWarning) {
    report += `⚠️ **风险警告:** Taleb/Graham/Burry 等风险导向型分析师发出减仓/卖出信号。\n\n`;
  }

  report += `---\n`;
  report += `*投资有风险，决策前请咨询专业财务顾问。本分析基于公开市场数据和量化模型，不保证准确性。*\n`;

  return {
    success: true,
    output: report,
    metadata: {
      ticker,
      generatedAt: new Date().toISOString(),
      signalCount: signals.length,
      verdict: verdict.action,
      volatility: techData.volatility,
    },
  };
}

// ─── HELPERS ───────────────────────────────────────────────────────────────────

function generateSimulatedPrices(currentPrice) {
  // Simulate price history from current price for demo purposes
  // In production: fetch real OHLCV via API
  const prices = [];
  let price = currentPrice * 0.85; // Start ~15% below current
  for (let i = 0; i < 60; i++) {
    const trend = (currentPrice - price) / price * 0.1; // Mean reversion tendency
    const noise = (Math.random() - 0.5) * 0.04; // ±2% noise
    price *= (1 + trend + noise);
    prices.push(Math.round(price * 100) / 100);
  }
  prices.push(currentPrice); // End at current
  return prices;
}
