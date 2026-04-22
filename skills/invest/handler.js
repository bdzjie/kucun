// invest/handler.js — AI Investment Advisory Council v4
// Multi-perspective stock analysis with quant + LLM synthesis
// Inspired by:
//   - github.com/virattt/ai-hedge-fund (LangGraph multi-agent, risk manager)
//   - github.com/ivebotunac/PrimoAgent (news_intelligence_agent, sentiment analysis)
//   - FinceptTerminal (macro expert + geopolitics expert integration)

import { writeFileSync } from 'fs';
import { execSync } from 'child_process';

// ─── CONFIG ─────────────────────────────────────────────────────────────────────

const INVESTORS = {
  buffet:       { name: "Warren Buffett",        weight: 1.0,  style: "value" },
  munger:      { name: "Charlie Munger",         weight: 0.9,  style: "quality" },
  taleb:       { name: "Nassim Taleb",           weight: 1.2,  style: "risk" },
  graham:      { name: "Ben Graham",             weight: 0.9,  style: "deep_value" },
  lynch:       { name: "Peter Lynch",            weight: 1.0,  style: "growth" },
  burry:       { name: "Michael Burry",          weight: 0.8,  style: "contrarian" },
  wood:        { name: "Cathie Wood",             weight: 1.1,  style: "innovation" },
  fisher:      { name: "Phil Fisher",            weight: 0.85, style: "scuttlebutt" },
  damodaran:   { name: "Aswath Damodaran",        weight: 1.0,  style: "dcf" },
  druckenmiller:{ name: "Stanley Druckenmiller",  weight: 0.9,  style: "macro_momentum" },
  ackman:      { name: "Bill Ackman",             weight: 1.3,  style: "activist" },
  pabrai:      { name: "Mohnish Pabrai",          weight: 1.0,  style: "dhandho" },
  jhunjhunwala:{ name: "Rakesh Jhunjhunwala",     weight: 0.9,  style: "emerging" },
};

// ─── PYTHON BRIDGE — Macro + Geopolitics Experts ────────────────────────────
// Calls Python modules: macro_expert.py + geopolitics_expert.py
// Returns JSON for integration into the invest report

const WORKSPACE = 'C:/Users/Administrator/.openclaw/workspace';
const PY = 'python'; // 'python' or 'python3'

/**
 * Call macro_expert.py — returns macroeconomic context + policy stance
 */
async function fetchMacroContext() {
  try {
    const scriptPath = `${WORKSPACE}/modules/invest/macro_expert.py`;
    const output = execSync(`${PY} "${scriptPath}"`, {
      encoding: 'utf-8',
      timeout: 30000,
      maxBuffer: 1024 * 1024,
    });
    // Python prints to stdout, capture last JSON block
    const lines = output.trim().split('\n');
    const jsonStart = output.lastIndexOf('{');
    if (jsonStart < 0) return null;
    const raw = output.slice(jsonStart);
    return JSON.parse(raw);
  } catch (e) {
    // Macro expert may fail silently (network issues), return null
    return null;
  }
}

/**
 * Call geopolitics_expert.py via invest_bridge.py
 * Analyzes: sanctions / tariffs / supply chain / regional conflict risks
 */
async function fetchGeopoliticsRisk(ticker, sector = '综合') {
  try {
    const scriptPath = `${WORKSPACE}/modules/invest/geopolitics_expert.py`;
    const cmd = `${PY} "${scriptPath}" "${ticker}" "${sector}"`;
    const output = execSync(cmd, {
      encoding: 'utf-8',
      timeout: 15000,
      maxBuffer: 512 * 1024,
    });
    const jsonStart = output.lastIndexOf('{');
    if (jsonStart < 0) return null;
    return JSON.parse(output.slice(jsonStart));
  } catch (e) {
    return null;
  }
}

/**
 * Adjust Kelly fraction based on macro policy stance.
 * Restrictive policy → reduce position; Expansive → hold/increase.
 */
function adjustPositionByMacro(verdict, macroCtx) {
  if (!macroCtx || !macroCtx.policy_stance) return verdict;

  const stance = macroCtx.policy_stance;
  const adjustment = {
    RESTRICTIVE: -0.20,  // High rates: reduce 20%
    NEUTRAL:      0.00,  // No change
    EXPANSIVE:    0.10,  // Low rates: add 10%
    UNKNOWN:       0.00,
  }[stance] || 0;

  const adjKelly = Math.max(0.02, verdict.kellyFraction / 100 + adjustment);
  const adjAction = adjKelly > 0.20 ? 'BUY' : adjKelly > 0.08 ? 'HOLD' : 'REDUCE';

  return {
    ...verdict,
    kellyFraction: Math.round(adjKelly * 1000) / 10,
    adjustedKelly: Math.round(adjKelly * 1000) / 10,
    macroAdjustment: `${adjustment >= 0 ? '+' : ''}${(adjustment * 100).toFixed(0)}%`,
    adjustedAction: adjAction,
    policyStance: stance,
    recessionProb: macroCtx.recession_prob || 0,
    growthOutlook: macroCtx.growth_outlook || 'unknown',
  };
}

/**
 * Format macro section for the report
 */
function formatMacroReport(macroCtx) {
  if (!macroCtx) return '';

  const stanceEmoji = {
    RESTRICTIVE: '🔴',
    NEUTRAL: '🟡',
    EXPANSIVE: '🟢',
    UNKNOWN: '⚪',
  }[macroCtx.policy_stance] || '⚪';

  const lines = [
    `\n| 指标 | 数值 |`,
    `|--------|------|`,
    `| 政策立场 | ${stanceEmoji} ${macroCtx.policy_stance || 'UNKNOWN'} |`,
    `| 置信度 | ${((macroCtx.policy_confidence || 0) * 100).toFixed(0)}% |`,
    `| 增长展望 | ${macroCtx.growth_outlook || 'N/A'} |`,
    `| 通胀风险 | ${macroCtx.inflation_risk || 'N/A'} |`,
    `| 衰退概率 | ${((macroCtx.recession_prob || 0) * 100).toFixed(0)}% |`,
    `| 曲线形态 | ${macroCtx.yield_curve_shape || 'N/A'} |`,
  ];

  if (macroCtx.key_risks && macroCtx.key_risks.length > 0) {
    lines.push(`| 关键风险 | ${macroCtx.key_risks.slice(0, 2).join(' | ')} |`);
  }

  return '\n' + lines.join('\n') + '\n';
}

/**
 * Format geopolitics section for the report
 */
function formatGeopoliticsReport(geoResult) {
  if (!geoResult || !geoResult.geopolitics) return '';

  const geo = geoResult.geopolitics;
  const levelEmoji = { low: '🟢', medium: '🟡', high: '🟠', critical: '🔴' };
  const emoji = levelEmoji[geo.risk_level] || '⚪';

  const lines = [
    `\n| 地缘风险 | ${emoji} **${geo.risk_level.toUpperCase()}** (评分 ${(geo.risk_score * 100).toFixed(0)}%) |`,
    `| 仓位调整 | ${geo.position_adjustment >= 0 ? '+' : ''}${(geo.position_adjustment * 100).toFixed(0)}% |`,
    `| 行业 | ${geo.sector} |`,
  ];

  if (geo.warnings && geo.warnings.length > 0) {
    lines.push(`| 警告 | ${geo.warnings[0]} |`);
  }

  // Top risks
  if (geo.risks && geo.risks.length > 0) {
    const topRisks = geo.risks.slice(0, 3);
    lines.push('');
    lines.push('**主要风险:**');
    for (const r of topRisks) {
      const rEmoji = r.risk_score > 0.6 ? '🔴' : r.risk_score > 0.3 ? '🟠' : '🟡';
      lines.push(`- ${rEmoji} ${r.description || r.type} (${(r.risk_score * 100).toFixed(0)}%)`);
    }
  }

  return '\n' + lines.join('\n') + '\n';
}


// ─── NEWS SENTIMENT AGENT ───────────────────────────────────────────────────────
// Inspired by PrimoAgent news_intelligence_agent.py
// Fetches news from Eastmoney, computes sentiment score + 7 NLP features

const SENTIMENT_KEYWORDS = {
  positive: [
    '增长','盈利','超预期','买入','增持','突破','新高','领涨','业绩','利润',
    '分红','回购','订单','签约','合作','扩张','产能','投放','获批','上调',
    '强劲','复苏','回暖','景气','朝阳','朝阳行业','赛道','龙头','护城河',
    '高壁垒','技术领先','市场份额提升','竞争优势',
  ],
  negative: [
    '下降','亏损','不及预期','卖出','减持','破发','新低','领跌','风险',
    '债务','诉讼','调查','处罚','警示函','下架','减产','停产','裁员',
    '违约','暴雷','造假','虚增','减值','商誉','质押','冻结','查封',
    '竞争加剧','红海','价格战','政策收紧','监管','规范',
  ],
  urgency: [
    '紧急','突发','今日','本周','即将','逼近','临界','窗口','倒计时',
    '立即','马上','尽快','速','急',
  ],
  risk: [
    '风险','黑天鹅','灰犀牛','尾部','波动','不确定性','地缘','制裁',
    '加息','缩表','贬值','破位','止损','警戒','预警',
  ],
  financial: [
    '营收','净利润','毛利率','ROE','负债率','现金流','EPS','BPS',
    '收入','利润','股息','派息','现金流','资产负债','账款','存货',
  ],
};

// Domain classification keywords
const DOMAIN_KEYWORDS = {
  '科技': ['AI','人工智能','芯片','半导体','软件','互联网','云计算','数据','算法','大模型','LLM','GPU','算力'],
  '消费': ['白酒','食品','饮料','零售','家电','汽车','新能源车','消费电子','纺织','服装','家电'],
  '医药': ['医药','生物','疫苗','中药','医疗器械','医院','研发','临床','创新药','CRO','CXO'],
  '金融': ['银行','保险','证券','基金','信托','租赁','支付','理财','信贷'],
  '工业': ['制造','工业','设备','机械','化工','材料','能源','电力','光伏','风电'],
  '地产': ['地产','房地产','建筑','物业','装修','家居','建材'],
};

/**
 * Classify domain from headline/content
 */
function classifyDomain(text) {
  for (const [domain, keywords] of Object.entries(DOMAIN_KEYWORDS)) {
    for (const kw of keywords) {
      if (text.includes(kw)) return domain;
    }
  }
  return '综合';
}

/**
 * Compute a sentiment score (-1 to +1) based on keyword matching
 */
function computeSentimentScore(newsItems) {
  if (!newsItems || newsItems.length === 0) return { score: 0, features: null };

  let totalPositivity = 0, totalNegativity = 0, totalUrgency = 0, totalVolatility = 0, totalSpecificity = 0;
  let count = 0;

  for (const item of newsItems) {
    const text = (item.title || '') + (item.content || '');
    const lower = text.toLowerCase();

    let posCount = 0, negCount = 0, urgencyCount = 0, riskCount = 0, specificityCount = 0;
    for (const kw of SENTIMENT_KEYWORDS.positive) { if (text.includes(kw)) posCount++; }
    for (const kw of SENTIMENT_KEYWORDS.negative) { if (text.includes(kw)) negCount++; }
    for (const kw of SENTIMENT_KEYWORDS.urgency) { if (text.includes(kw)) urgencyCount++; }
    for (const kw of SENTIMENT_KEYWORDS.risk) { if (text.includes(kw)) riskCount++; }
    for (const kw of SENTIMENT_KEYWORDS.financial) { if (text.includes(kw)) specificityCount++; }

    const total = posCount + negCount + 1;
    totalPositivity += posCount / total;
    totalNegativity += negCount / total;
    totalUrgency += Math.min(urgencyCount / 3, 1);
    totalVolatility += Math.min(riskCount / 2, 1);
    totalSpecificity += Math.min(specificityCount / 5, 1);
    count++;
  }

  const avgPos = count > 0 ? totalPositivity / count : 0;
  const avgNeg = count > 0 ? totalNegativity / count : 0;
  const avgUrgency = count > 0 ? totalUrgency / count : 0;
  const avgVolatility = count > 0 ? totalVolatility / count : 0;
  const avgSpecificity = count > 0 ? totalSpecificity / count : 0;

  // Composite score
  const score = avgPos - avgNeg + (avgUrgency * 0.1) - (avgVolatility * 0.15);
  const clampedScore = Math.max(-1, Math.min(1, score));

  // Relevance: more recent news = higher relevance
  const relevance = Math.min(1, 0.5 + (count / 10) * 0.5);

  return {
    score: Math.round(clampedScore * 100) / 100,
    features: {
      positivity: Math.round(avgPos * 100) / 100,
      negativity: Math.round(avgNeg * 100) / 100,
      relevance: Math.round(relevance * 100) / 100,
      urgency: Math.round(avgUrgency * 100) / 100,
      volatility: Math.round(avgVolatility * 100) / 100,
      specificity: Math.round(avgSpecificity * 100) / 100,
      domain: classifyDomain(newsItems[0]?.title || ''),
    },
    newsCount: count,
  };
}

/**
 * Fetch recent news from Eastmoney
 */
async function fetchNews(ticker) {
  try {
    // Determine secid for Eastmoney news API
    let secid = '';
    if (/^\d{6}$/.test(ticker)) {
      secid = ticker.startsWith('6') ? `1.${ticker}` : `0.${ticker}`;
    } else if (ticker.startsWith('hk')) {
      const code = ticker.replace('hk', '');
      secid = `116.${code}`;
    } else if (ticker.startsWith('us')) {
      const code = ticker.replace('us', '');
      secid = `105.${code}`;
    } else {
      // Try as US stock
      secid = `105.${ticker}`;
    }

    // Eastmoney news API - recent company news
    const url = `https://np-anotice-stock.eastmoney.com/api/security/ann?cb=&sr=-1&page_size=10&page_index=1&ann_type=S,C&f_node=0&s_node=0&secid=${secid}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://quote.eastmoney.com' } });
    const json = await res.json();

    if (!json.data || !json.data.list) return [];

    return json.data.list.slice(0, 10).map(item => ({
      title: item.title || '',
      content: item.notice_content || '',
      time: item.notice_date || '',
      type: item.art_type || '',
    }));
  } catch (e) {
    return [];
  }
}

// ─── RISK MANAGER ───────────────────────────────────────────────────────────────
// Inspired by ai-hedge-fund risk_manager.py
// Annualized volatility, correlation adjustment, position limits

/**
 * Calculate annualized volatility from price returns
 */
function calcAnnualizedVolatility(closes, period = 20) {
  if (!closes || closes.length < period + 1) return null;
  const returns = [];
  for (let i = 1; i < closes.length; i++) {
    returns.push((closes[i] - closes[i - 1]) / closes[i - 1]);
  }
  const slice = returns.slice(-period);
  const mean = slice.reduce((a, b) => a + b, 0) / slice.length;
  const variance = slice.reduce((s, r) => s + (r - mean) ** 2, 0) / slice.length;
  return Math.sqrt(variance) * Math.sqrt(252); // Annualized
}

/**
 * Determine position size limit based on volatility
 * Low volatility (<15%) → max 25% allocation
 * Medium volatility (15-30%) → max 15%
 * High volatility (>30%) → max 10%
 * Very high volatility (>50%) → max 5%
 */
function getVolatilityPositionLimit(annualizedVol) {
  if (annualizedVol === null) return 0.20;
  if (annualizedVol < 0.15) return 0.25;
  if (annualizedVol < 0.30) return 0.15;
  if (annualizedVol < 0.50) return 0.10;
  return 0.05;
}

/**
 * Correlation penalty: stocks with rho >= 0.8 get 0.7x multiplier
 * In a real system this would use a correlation matrix
 * Here we estimate from sector/domain overlap
 */
function applyCorrelationPenalty(baseWeight, stockDomain, existingHoldings) {
  if (!existingHoldings || existingHoldings.length === 0) return baseWeight;

  // Simplified: check domain overlap as proxy for correlation
  for (const holding of existingHoldings) {
    if (holding.domain === stockDomain && holding.correlation > 0.7) {
      return baseWeight * 0.7;
    }
  }
  return baseWeight;
}

/**
 * Compute Kelly Criterion position size
 * Kelly % = W - (1-W)/R where W = win rate, R = win/loss ratio
 * Simplified: use signal confidence as win rate proxy
 */
function kellyFraction(winRate, avgWinLossRatio) {
  if (winRate <= 0 || avgWinLossRatio <= 0) return 0;
  const kelly = winRate - (1 - winRate) / avgWinLossRatio;
  return Math.max(0, Math.min(kelly * 0.5, 0.25)); // Half-Kelly for safety, cap at 25%
}

/**
 * Full risk analysis for a position
 */
async function analyzeRisk(ticker, closes, existingHoldings = []) {
  const vol = calcAnnualizedVolatility(closes);
  const volLimit = getVolatilityPositionLimit(vol);
  const volPercent = vol !== null ? Math.round(vol * 10000) / 100 : null;

  // News-based risk signals
  const newsItems = await fetchNews(ticker);
  const sentiment = computeSentimentScore(newsItems);

  // Aggregate risk score
  let riskScore = 0.5; // Neutral
  if (vol !== null) {
    if (vol > 0.5) riskScore += 0.3;
    else if (vol > 0.3) riskScore += 0.15;
    else if (vol < 0.15) riskScore -= 0.15;
  }
  if (sentiment.score < -0.3) riskScore += 0.2;
  if (sentiment.features?.urgency > 0.7) riskScore += 0.1;

  return {
    annualizedVolatility: volPercent,
    volatilityLimit: volLimit,
    riskScore: Math.round(riskScore * 100) / 100,
    sentimentScore: sentiment.score,
    sentimentFeatures: sentiment.features,
    newsCount: sentiment.newsCount,
    kellySize: kellyFraction(0.55, 1.5), // Placeholder win rate/ratio
    warnings: [
      volPercent !== null && volPercent > 50 ? '⚠️ 高波动警告' : null,
      sentiment.score < -0.5 ? '⚠️ 负面情绪警告' : null,
      sentiment.features?.urgency > 0.7 ? '⚠️ 高 urgency 信号' : null,
    ].filter(Boolean),
  };
}

// ─── DATA FETCHING ─────────────────────────────────────────────────────────────

/**
 * Normalize stock code to Eastmoney format
 * Returns { market, code, displayCode }
 */
function normalizeTicker(ticker) {
  ticker = ticker.toUpperCase().trim();

  if (/^\d{6}$/.test(ticker)) {
    // A-share: 6-digit
    const prefix = ticker.startsWith('6') ? 'sh' : 'sz';
    return { market: 'cn', code: ticker, displayCode: `${prefix}${ticker}` };
  }
  if (ticker.startsWith('HK')) {
    const code = ticker.slice(2).padStart(5, '0');
    return { market: 'hk', code, displayCode: `hk${code}` };
  }
  if (ticker.startsWith('US')) {
    const code = ticker.slice(2);
    return { market: 'us', code, displayCode: `us${code}` };
  }
  // Chinese company name → HK code
  const NAME_MAP = {
    '腾讯': '00700', '阿里巴巴': '09988', '美团': '03690',
    '京东': '09618', '百度': '09888', '小米': '01810',
    '比亚迪': '002594', '宁德时代': '300750', '茅台': '600519',
    '平安': '02318', '招商银行': '03968', '中国平安': '02318',
  };
  if (NAME_MAP[ticker]) {
    const code = NAME_MAP[ticker];
    return { market: 'hk', code, displayCode: `hk${code}` };
  }

  // Default to US
  return { market: 'us', code: ticker, displayCode: `us${ticker}` };
}

/**
 * Fetch stock quote from Eastmoney
 */
async function fetchQuote(ticker) {
  const { market, code, displayCode } = normalizeTicker(ticker);

  // secid format: cn=1/0, hk=116, us=105
  const marketMap = { cn: null, hk: '116.', us: '105.' };
  const prefix = market === 'cn'
    ? (code.startsWith('6') ? '1.' : '0.')
    : (marketMap[market] || '105.');

  const secid = `${prefix}${code}`;
  const url = `https://push2.eastmoney.com/api/qt/stock/get?secid=${secid}&fields=f43,f44,f45,f46,f47,f48,f57,f58,f60,f116,f117,f162,f163,f168,f169,f170,f171,f50,f57&ut=fa5fd1943c7b386f172d6893dbfba10b`;

  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const json = await res.json();
    if (!json.data) return null;

    const d = json.data;
    return {
      ticker,
      displayCode,
      price: d.f43 / 100 || d.f58,
      change: d.f169 / 100,
      changePercent: (d.f170 || d.f169) / 100,
      open: d.f46 / 100,
      high: d.f44 / 100,
      low: d.f45 / 100,
      volume: d.f47,
      amount: d.f48,
      marketCap: d.f116,
      pe: d.f162 / 100 || 'N/A',
      pb: d.f168 / 100 || 'N/A',
      dividendYield: d.f173 / 100 || 'N/A',
      week52High: d.h39 / 100 || 'N/A',
      week52Low: d.h40 / 100 || 'N/A',
      highLimit: d.f171 / 100,
      lowLimit: d.f50 / 100,
    };
  } catch (e) {
    return null;
  }
}

/**
 * Fetch comprehensive fundamentals from Eastmoney
 * Revenue, net profit, gross margin, ROE, debt ratio, etc.
 */
async function fetchFundamentals(ticker) {
  const { market, code } = normalizeTicker(ticker);

  try {
    // Eastmoney financial report API
    const url = `https://emappdata.eastmoney.com/stockScoreDetails/getAllHisStockDetailList?appId=appId01&globalId=786e4c21-70dc-435a-93bb-38&deviceId=abcdefgh&pageNo=1&pageSize=1&stockCode=${code}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) return {};

    // Alternative: use the quote API's fundamental fields
    const { market: m2, code: c2, displayCode } = normalizeTicker(ticker);
    const marketMap = { cn: null, hk: '116.', us: '105.' };
    const prefix = m2 === 'cn' ? (c2.startsWith('6') ? '1.' : '0.') : (marketMap[m2] || '105.');
    const secid = `${prefix}${c2}`;

    // Fetch detailed financial indicators
    const finUrl = `https://push2.eastmoney.com/api/qt/sat/get?secid=${secid}&fields=f173,f174,f175,f176,f177,f178,f179,f180,f181,f182,f183,f184,f185,f186,f187,f188,f189,f190&ut=fa5fd1943c7b386f172d6893dbfba10b`;
    const finRes = await fetch(finUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const finJson = await finRes.json();

    if (!finJson.data) return {};

    const fd = finJson.data;
    return {
      // Revenue & Profit (simplified from available fields)
      revenue: fd.f173 ? `${(fd.f173 / 1e8).toFixed(2)}亿` : 'N/A',
      netProfit: fd.f174 ? `${(fd.f174 / 1e8).toFixed(2)}亿` : 'N/A',
      grossMargin: fd.f175 / 100 || 'N/A',
      operatingMargin: fd.f176 / 100 || 'N/A',
      // Returns
      roe: fd.f162 / 100 || 'N/A',  // Reuse PE field slot for ROE when available
      roa: fd.f177 / 100 || 'N/A',
      // Leverage
      debtRatio: fd.f178 / 100 || 'N/A',
      currentRatio: fd.f179 / 100 || 'N/A',
      quickRatio: fd.f180 / 100 || 'N/A',
      // Cash
      operatingCF: fd.f181 ? `${(fd.f181 / 1e8).toFixed(2)}亿` : 'N/A',
      freeCF: fd.f182 ? `${(fd.f182 / 1e8).toFixed(2)}亿` : 'N/A',
    };
  } catch (e) {
    return {};
  }
}

/**
 * Fetch 60-day price history for technical analysis
 */
async function fetchPriceHistory(ticker, days = 60) {
  const { market, code } = normalizeTicker(ticker);

  // Eastmoney K-line API (daily)
  const marketMap = { cn: null, hk: '116.', us: '105.' };
  const prefix = market === 'cn'
    ? (code.startsWith('6') ? '1.' : '0.')
    : (marketMap[market] || '105.');
  const secid = `${prefix}${code}`;

  // Use Eastmoney's stock price history API
  const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61&klt=101&fqt=0&lmt=${days}&end=20500101&ut=fa5fd1943c7b386f172d6893dbfba10b`;

  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const json = await res.json();
    if (!json.data || !json.data.klines) return [];

    return json.data.klines.map(line => {
      const parts = line.split(',');
      return {
        date: parts[0],
        open: parseFloat(parts[1]),
        close: parseFloat(parts[2]),
        high: parseFloat(parts[3]),
        low: parseFloat(parts[4]),
        volume: parseInt(parts[5]),
      };
    });
  } catch (e) {
    return [];
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
  return Math.round(Math.sqrt(variance) * annualizationFactor * 10000) / 100;
}

function analyzeTechnicals(prices) {
  if (!prices || prices.length < 5) {
    return { signals: [], recommendations: [], volatility: null, rsi: null };
  }
  const closes = prices.map(p => typeof p === 'number' ? p : p.close);
  const rsi = calcRSI(closes);
  const macd = calcMACD(closes);
  const bb = calcBollinger(closes);
  const vol = calcVolatility(closes);

  const signals = [];
  const recommendations = [];

  if (rsi !== null) {
    const sig = rsi > 70 ? 'OVERBOUGHT' : rsi < 30 ? 'OVERSOLD' : 'NEUTRAL';
    const emoji = rsi > 70 ? '🔴' : rsi < 30 ? '🟢' : '🟡';
    signals.push({ indicator: 'RSI(14)', value: rsi.toFixed(1), signal: sig, emoji });
    if (rsi > 70) recommendations.push('RSI超买');
    else if (rsi < 30) recommendations.push('RSI超卖');
  }

  if (macd) {
    const sig = macd.bullish ? 'BULLISH' : 'BEARISH';
    const emoji = macd.bullish ? '🟢' : '🔴';
    signals.push({ indicator: 'MACD', value: macd.value.toFixed(3), signal: sig, emoji });
    if (macd.bullish) recommendations.push('MACD金叉');
    else recommendations.push('MACD死叉');
  }

  if (bb) {
    const sig = bb.position === 'ABOVE' ? 'ABOVE_UPPER' : bb.position === 'BELOW' ? 'BELOW_LOWER' : 'WITHIN_BANDS';
    const emoji = bb.position === 'ABOVE' ? '🔴' : bb.position === 'BELOW' ? '🟢' : '🟡';
    signals.push({ indicator: 'Bollinger(20,2)', value: `${bb.lower}–${bb.upper}`, signal: sig, emoji });
    if (bb.position === 'BELOW') recommendations.push('触及布林下轨（超卖）');
    else if (bb.position === 'ABOVE') recommendations.push('触及布林上轨（超买）');
  }

  if (vol !== null) {
    const sig = vol > 50 ? 'HIGH_VOL' : vol > 25 ? 'MEDIUM_VOL' : 'LOW_VOL';
    const emoji = vol > 50 ? '⚠️' : vol > 25 ? '🟡' : '🟢';
    signals.push({ indicator: '波动率(年化)', value: `${vol}%`, signal: sig, emoji });
  }

  if (closes.length >= 50) {
    const ma50 = closes.slice(-50).reduce((a, b) => a + b, 0) / 50;
    const ma200 = closes.length >= 200 ? closes.slice(-200).reduce((a, b) => a + b, 0) / 200 : null;
    if (ma200) {
      const bullish = ma50 > ma200;
      const emoji = bullish ? '🟢' : '🔴';
      signals.push({ indicator: 'MA50/MA200', value: bullish ? 'Golden Cross' : 'Death Cross', signal: bullish ? 'BULLISH' : 'BEARISH', emoji });
      if (bullish) recommendations.push('均线多头排列');
      else recommendations.push('均线空头排列');
    }
  }

  return { signals, recommendations, volatility: vol, rsi };
}

// ─── INVESTOR SIGNAL ENGINE ─────────────────────────────────────────────────────

function generateInvestorSignal(investorKey, investor, stockData, techData, sentiment) {
  const { name, weight, style } = investor;
  const score = computeScore(style, stockData, techData, sentiment);
  const signal = scoreToSignal(score, style);
  const reasoning = getReasoning(investorKey, score, stockData, techData, sentiment);

  return {
    name,
    action: signal,
    confidence: Math.round(Math.min(95, 50 + score * 20)),
    reasoning,
    score,
    weight,
  };
}

function computeScore(style, data, tech, sentiment) {
  switch (style) {
    case 'value':        return computeValueScore(data, tech, sentiment);
    case 'quality':      return computeQualityScore(data, tech, sentiment);
    case 'risk':         return computeRiskScore(data, tech, sentiment);
    case 'deep_value':   return computeDeepValueScore(data, tech, sentiment);
    case 'growth':       return computeGrowthScore(data, tech, sentiment);
    case 'contrarian':   return computeContrarianScore(data, tech, sentiment);
    case 'innovation':   return computeInnovationScore(data, tech, sentiment);
    case 'scuttlebutt':  return computeScuttlebuttScore(data, tech, sentiment);
    case 'dcf':          return computeDCFScore(data, tech, sentiment);
    case 'macro_momentum': return computeMacroMomentumScore(data, tech, sentiment);
    case 'activist':     return computeActivistScore(data, tech, sentiment);
    case 'dhandho':      return computeDhandhoScore(data, tech, sentiment);
    case 'emerging':     return computeEmergingScore(data, tech, sentiment);
    default:             return 0.5;
  }
}

function scoreToSignal(score, style) {
  const thresholds = {
    risk:          { buy: 0.8, sell: 0.3 },
    deep_value:    { buy: 0.3, sell: 0.7 },
    contrarian:   { buy: 0.2, sell: 0.8 },
    activist:     { buy: 0.7, sell: 0.3 },
    dhandho:      { buy: 0.4, sell: 0.6 },
    default:      { buy: 0.65, sell: 0.35 },
  };
  const t = thresholds[style] || thresholds.default;

  if (['risk', 'contrarian', 'deep_value'].includes(style)) {
    if (score <= t.buy) return 'BUY';
    if (score >= t.sell) return 'SELL';
  } else {
    if (score >= t.buy) return 'BUY';
    if (score <= t.sell) return 'SELL';
  }
  return 'HOLD';
}

// ─── Individual Score Functions ─────────────────────────────────────────────────

function computeValueScore(data, tech, sentiment) {
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
    if (tech.volatility < 20) score += 0.15;
    else if (tech.volatility > 50) score -= 0.15;
  }
  if (sentiment?.score > 0.3) score += 0.1;
  if (sentiment?.score < -0.3) score -= 0.1;
  return Math.max(0, Math.min(1, score));
}

function computeQualityScore(data, tech, sentiment) {
  let score = 0.5;
  if (tech && tech.volatility) {
    if (tech.volatility < 25) score += 0.2;
    else if (tech.volatility > 40) score -= 0.2;
  }
  if (data && Math.abs(data.changePercent) < 3) score += 0.15;
  if (sentiment?.features?.positivity > 0.5) score += 0.1;
  if (sentiment?.features?.negativity > 0.5) score -= 0.15;
  return Math.max(0, Math.min(1, score));
}

function computeRiskScore(data, tech, sentiment) {
  let score = 0.5;
  if (tech && tech.volatility) {
    if (tech.volatility > 50) score += 0.3;
    else if (tech.volatility < 20) score -= 0.2;
  }
  if (data && Math.abs(data.changePercent) > 5) score += 0.2;
  if (sentiment?.score < -0.3) score += 0.15;
  if (sentiment?.features?.volatility > 0.6) score += 0.15;
  return Math.max(0, Math.min(1, score));
}

function computeDeepValueScore(data, tech, sentiment) {
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
  if (sentiment?.score > 0.3) score += 0.1;
  return Math.max(0, Math.min(1, score));
}

function computeGrowthScore(data, tech, sentiment) {
  let score = 0.5;
  if (tech && tech.volatility && tech.volatility > 30) score += 0.15;
  if (data && data.changePercent > 0) score += 0.1;
  if (sentiment?.features?.domain === '科技' || sentiment?.features?.domain === '消费') score += 0.1;
  return Math.max(0, Math.min(1, score));
}

function computeContrarianScore(data, tech, sentiment) {
  let score = 0.5;
  if (tech && tech.rsi !== null) {
    if (tech.rsi < 40) score += 0.25;
    else if (tech.rsi > 60) score -= 0.15;
  }
  if (data && data.changePercent < -3) score += 0.2;
  if (sentiment?.score < -0.2) score += 0.15;
  return Math.max(0, Math.min(1, score));
}

function computeInnovationScore(data, tech, sentiment) {
  let score = 0.5;
  if (tech && tech.volatility > 35) score += 0.2;
  if (data && data.changePercent > 2) score += 0.1;
  if (sentiment?.features?.domain === '科技') score += 0.15;
  return Math.max(0, Math.min(1, score));
}

function computeScuttlebuttScore(data, tech, sentiment) {
  let score = computeQualityScore(data, tech, sentiment);
  if (sentiment?.score > 0.2) score += 0.1;
  return Math.max(0, Math.min(1, score + 0.05));
}

function computeDCFScore(data, tech, sentiment) {
  let score = 0.5;
  if (data && data.pe !== 'N/A') {
    const pe = parseFloat(data.pe);
    if (pe < 20) score += 0.2;
    else score -= 0.1;
  }
  if (sentiment?.features?.financial) score += sentiment.features.financial * 0.1;
  return Math.max(0, Math.min(1, score));
}

function computeMacroMomentumScore(data, tech, sentiment) {
  // Druckenmiller: macro + momentum
  let score = 0.5;
  if (data && data.changePercent > 2) score += 0.2;
  else if (data && data.changePercent < -2) score -= 0.15;
  if (tech && tech.volatility > 30) score += 0.15;
  if (sentiment?.score > 0.2) score += 0.1;
  if (sentiment?.features?.urgency > 0.5) score += 0.1;
  return Math.max(0, Math.min(1, score));
}

function computeActivistScore(data, tech, sentiment) {
  let score = 0.5;
  if (data && data.changePercent > 5) score += 0.2;
  else if (data && data.changePercent < -5) score += 0.15;
  if (sentiment?.features?.positivity > 0.6) score += 0.15;
  return Math.max(0, Math.min(1, score));
}

function computeDhandhoScore(data, tech, sentiment) {
  let score = 0.5;
  if (tech && tech.volatility && tech.volatility < 25) score += 0.2;
  if (data && data.pe !== 'N/A' && parseFloat(data.pe) < 20) score += 0.15;
  if (data && data.pb !== 'N/A' && parseFloat(data.pb) < 2) score += 0.15;
  if (sentiment?.score < -0.2) score -= 0.1;
  return Math.max(0, Math.min(1, score));
}

function computeEmergingScore(data, tech, sentiment) {
  let score = computeGrowthScore(data, tech, sentiment);
  if (sentiment?.features?.domain === '消费' || sentiment?.features?.domain === '医药') score += 0.1;
  return Math.max(0, Math.min(1, score + 0.05));
}

function getReasoning(investorKey, score, data, tech, sentiment) {
  const r = {
    buffet:    score > 0.6 ? 'ROE稳定+护城河宽+低估值' : score < 0.4 ? '估值偏高+竞争侵蚀' : '护城河稳定但价格合理',
    munger:    score > 0.6 ? '管理层理性+质地优良' : '理性存疑+质地一般',
    taleb:     score > 0.6 ? '尾部风险极高+波动率危险' : score < 0.4 ? '抗脆弱性较好' : '风险可控',
    graham:    score > 0.6 ? '远低于格雷厄姆数+安全边际足' : '股价高于内在价值',
    lynch:     score > 0.6 ? 'PEG<1+成长性合理+十倍股潜力' : '成长性不足或价格偏高',
    burry:     score < 0.4 ? '被市场抛弃+深度价值+逆向机会' : '未到逆向买入时机',
    wood:      score > 0.6 ? '颠覆性创新赛道+长期成长' : '创新潜力不足',
    fisher:    score > 0.6 ? 'R&D投入+管理层优秀+长期逻辑' : 'scuttlebutt信号弱',
    damodaran: score > 0.6 ? '内在价值高于市价+DCF买入' : '估值合理或偏高',
    druckenmiller: score > 0.6 ? '宏观动量+趋势确认' : '宏观不利+趋势走弱',
    ackman:    score > 0.6 ? '催化剂明确+集中持仓机会' : '缺乏明显催化剂',
    pabrai:    score > 0.6 ? 'Dhandho机会+安全边际高' : '风险收益比不够理想',
    jhunjhunwala: score > 0.6 ? '新兴市场增长+本土机会' : '宏观环境不利',
  };
  const base = r[investorKey] || `综合评分${(score * 100).toFixed(0)}分`;
  if (sentiment?.score) {
    const sentTag = sentiment.score > 0.3 ? '📰情绪正面' : sentiment.score < -0.3 ? '📰情绪负面' : '';
    if (sentTag) return `${base}（${sentTag}）`;
  }
  return base;
}

// ─── PORTFOLIO AGGREGATOR (Enhanced with Kelly Criterion) ───────────────────────
// Inspired by ai-hedge-fund portfolio_management

function aggregateSignals(signals, riskData) {
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

  const rawScore = totalWeight > 0 ? weightedScore / totalWeight : 0;

  // Risk-adjusted score using volatility
  const volMultiplier = riskData?.annualizedVolatility
    ? Math.max(0.5, 1 - (riskData.annualizedVolatility / 200))
    : 1.0;
  const riskAdjustedScore = rawScore * volMultiplier;

  const buyRatio = counts.BUY / signals.length;
  const sellRatio = (counts.SELL + counts.REDUCE) / signals.length;

  // Kelly-based position sizing recommendation
  const kellyWinRate = buyRatio / (buyRatio + sellRatio || 1);
  const kellyRatio = kellyFraction(kellyWinRate, 1.5);

  let action, reasoning;
  if (riskAdjustedScore > 0.25 && buyRatio > 0.4) {
    action = 'BUY';
    reasoning = '多数价值/成长型分析师看涨，风险管理师确认风险可控';
  } else if (riskAdjustedScore > 0 && buyRatio > sellRatio) {
    action = 'HOLD';
    reasoning = '信号分歧但略偏正面，等待更好买点';
  } else if (riskAdjustedScore < -0.25 || sellRatio > 0.4) {
    action = 'SELL';
    reasoning = '风险型分析师发出警告，尾部风险上升';
  } else {
    action = 'HOLD';
    reasoning = '多空信号均衡，等待趋势明朗';
  }

  return {
    action,
    confidence: Math.round(Math.min(90, 50 + Math.abs(riskAdjustedScore) * 40)),
    reasoning,
    counts,
    rawScore: Math.round(rawScore * 100) / 100,
    riskAdjustedScore: Math.round(riskAdjustedScore * 100) / 100,
    volAdjusted: volMultiplier < 1,
    kellyFraction: Math.round(kellyRatio * 1000) / 10,
    positionRecommendation: action === 'BUY'
      ? `建议仓位: ${Math.round(kellyRatio * 100)}%（Kelly准则）`
      : action === 'SELL' ? '建议平仓或减仓' : '观望，等待明确信号',
  };
}

// ─── PERFORMANCE METRICS (Backtest-style) ──────────────────────────────────────
// Inspired by ai-hedge-fund backtesting/metrics.py

function computePerformanceMetrics(dailyReturns, riskFreeRate = 0.03) {
  if (!dailyReturns || dailyReturns.length < 30) {
    return { sharpe: null, sortino: null, maxDrawdown: null, winRate: null, volatility: null, var95: null, sharpeGrade: 'N/A', sortinoGrade: 'N/A' };
  }

  const returns = dailyReturns.filter(r => !isNaN(r) && isFinite(r));
  if (returns.length < 30) return { sharpe: null, sortino: null, maxDrawdown: null, winRate: null, volatility: null, var95: null, sharpeGrade: 'N/A', sortinoGrade: 'N/A' };

  const n = returns.length;
  const mean = returns.reduce((a, b) => a + b, 0) / n;
  const std = Math.sqrt(returns.reduce((s, r) => s + (r - mean) ** 2, 0) / n);

  // Annualized metrics (252 trading days)
  const annReturn = mean * 252;
  const annVol = std * Math.sqrt(252);

  // Sharpe Ratio
  const sharpe = annVol > 0 ? (annReturn - riskFreeRate) / annVol : 0;

  // Sortino Ratio (downside deviation only)
  const downsideReturns = returns.filter(r => r < 0);
  const downsideStd = downsideReturns.length > 0
    ? Math.sqrt(downsideReturns.reduce((s, r) => s + r ** 2, 0) / downsideReturns.length)
    : 0;
  const annDownside = downsideStd * Math.sqrt(252);
  const sortino = annDownside > 0 ? (annReturn - riskFreeRate) / annDownside : 0;

  // Max Drawdown
  let peak = returns[0];
  let maxDD = 0;
  let runningMax = peak;
  for (const r of returns) {
    if (r > runningMax) runningMax = r;
    const drawdown = (runningMax - r) / runningMax;
    if (drawdown > maxDD) maxDD = drawdown;
  }

  // Win Rate
  const wins = returns.filter(r => r > 0).length;
  const winRate = wins / returns.length;

  // VaR (95%)
  const sorted = [...returns].sort((a, b) => a - b);
  const varIdx = Math.floor(0.05 * sorted.length);
  const var95 = sorted[varIdx] || sorted[0];

  // Grades
  const sharpeGrade = sharpe >= 1.5 ? '⭐⭐⭐ Excellent' : sharpe >= 1.0 ? '⭐⭐ Good' : sharpe >= 0.5 ? '⭐ Fair' : '⚠️ Poor';
  const sortinoGrade = sortino >= 2.0 ? '⭐⭐⭐ Excellent' : sortino >= 1.2 ? '⭐⭐ Good' : sortino >= 0.5 ? '⭐ Fair' : '⚠️ Poor';

  return {
    sharpe: Math.round(sharpe * 100) / 100,
    sortino: Math.round(sortino * 100) / 100,
    maxDrawdown: Math.round(maxDD * 10000) / 100, // percentage
    winRate: Math.round(winRate * 10000) / 100,
    volatility: Math.round(annVol * 10000) / 100,
    var95: Math.round(var95 * 10000) / 100,
    sharpeGrade,
    sortinoGrade,
    meanReturn: Math.round(mean * 10000) / 100,
    annReturn: Math.round(annReturn * 10000) / 100,
    tradingDays: n,
  };
}

// ─── CANDLESTICK PATTERN RECOGNITION ──────────────────────────────────────────
// Detects major candlestick reversal patterns

function detectCandlestickPatterns(klines) {
  if (!klines || klines.length < 3) return [];

  const patterns = [];
  const n = klines.length;

  for (let i = 2; i < n; i++) {
    const curr = klines[i];
    const prev = klines[i - 1];
    const prev2 = klines[i - 2];

    const open = curr.o, close = curr.c, high = curr.h, low = curr.l;
    const body = Math.abs(close - open);
    const upperShadow = high - Math.max(open, close);
    const lowerShadow = Math.min(open, close) - low;
    const bodyPct = body / (high - low || 1);

    // Doji: open ≈ close (within 0.1%)
    if (body < 0.001 * open) {
      patterns.push({ date: curr.d, pattern: 'Doji', signal: 'NEUTRAL', confidence: 65 });
    }

    // Hammer: lower shadow > 2x body, upper shadow < 0.5x body
    if (lowerShadow > 2 * body && upperShadow < 0.5 * body && close > open) {
      patterns.push({ date: curr.d, pattern: 'Hammer', signal: 'BULLISH', confidence: 75 });
    }

    // Hanging Man: same as hammer but after uptrend
    if (lowerShadow > 2 * body && upperShadow < 0.5 * body && close < open && prev.c > prev.o) {
      patterns.push({ date: curr.d, pattern: 'Hanging Man', signal: 'BEARISH', confidence: 70 });
    }

    // Bullish Engulfing: down day followed by up day with body engulfing previous
    if (i >= 2 && prev.c < prev.o && close > open) {
      const prevBodyTop = Math.max(prev.o, prev.c);
      const prevBodyBot = Math.min(prev.o, prev.c);
      const currBodyTop = Math.max(open, close);
      const currBodyBot = Math.min(open, close);
      if (currBodyTop > prevBodyTop && currBodyBot < prevBodyBot) {
        patterns.push({ date: curr.d, pattern: 'Bullish Engulfing', signal: 'BULLISH', confidence: 80 });
      }
    }

    // Bearish Engulfing: up day followed by down day with body engulfing previous
    if (i >= 2 && prev.c > prev.o && close < open) {
      const prevBodyTop = Math.max(prev.o, prev.c);
      const prevBodyBot = Math.min(prev.o, prev.c);
      const currBodyTop = Math.max(open, close);
      const currBodyBot = Math.min(open, close);
      if (currBodyBot < prevBodyBot && currBodyTop > prevBodyTop) {
        patterns.push({ date: curr.d, pattern: 'Bearish Engulfing', signal: 'BEARISH', confidence: 80 });
      }
    }

    // Morning Star: down + doji + up (3-day reversal)
    if (i >= 2) {
      const prev2Body = Math.abs(prev2.c - prev2.o);
      const prevBody2 = Math.abs(prev.c - prev.o);
      const isDoji = prevBody2 < 0.001 * prev.o;
      if (prev2.c < prev2.o && isDoji && close > open && close > (prev2.o + prev2.c) / 2) {
        patterns.push({ date: curr.d, pattern: 'Morning Star', signal: 'BULLISH', confidence: 85 });
      }
      if (prev2.c > prev2.o && isDoji && close < open && close < (prev2.o + prev2.c) / 2) {
        patterns.push({ date: curr.d, pattern: 'Evening Star', signal: 'BEARISH', confidence: 85 });
      }
    }

    // Three White Soldiers: 3 consecutive up days with progressive closes
    if (i >= 2 &&
        prev2.c > prev2.o && prev.c > prev.o && close > open &&
        prev2.c > prev2.o + prev2Body * 0.5 &&
        prev.c > prev.o + prevBody2 * 0.5 &&
        close > open + body * 0.5) {
      patterns.push({ date: curr.d, pattern: 'Three White Soldiers', signal: 'BULLISH', confidence: 90 });
    }
  }

  // Return most significant recent patterns
  return patterns.slice(-5);
}

// ─── SECTOR/INDUSTRY CLASSIFICATION ───────────────────────────────────────────
// Fetch from Eastmoney stock profile API

async function fetchStockProfile(ticker) {
  try {
    const { market, code } = normalizeTicker(ticker);
    const secid = `${market}.${code}`;
    const url = `https://push2.eastmoney.com/api/qt/stock/get?secid=${secid}&fields=f57,f58,f162,f167,f168,f169,f170,f171,f127,f128,f135,f136`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) return {};
    const json = await res.json();
    const d = json.data || {};
    return {
      name: d.f58 || ticker,
      sector: d.f127 || 'N/A',
      industry: d.f128 || 'N/A',
      market: d.f135 || 'N/A',
      listedDate: d.f136 || 'N/A',
      totalShares: d.f167 ? (d.f167 / 1e8).toFixed(2) + '亿' : 'N/A',
      floatShares: d.f168 ? (d.f168 / 1e8).toFixed(2) + '亿' : 'N/A',
    };
  } catch (e) {
    return {};
  }
}

// ─── PRICE TARGET CALCULATION ─────────────────────────────────────────────────
// Graham Number, DCF estimate, PEG-based target

function calculatePriceTargets(stockData, fundamentals) {
  const price = stockData?.price;
  const pe = stockData?.pe !== 'N/A' ? parseFloat(stockData.pe) : null;
  const pb = stockData?.pb !== 'N/A' ? parseFloat(stockData.pb) : null;
  const eps = fundamentals?.eps;
  const bps = fundamentals?.bps;
  const revenueGrowth = fundamentals?.revenueGrowth;

  const targets = {};

  // Graham Number: sqrt(22.5 * EPS * BVPS)
  if (eps && bps && eps > 0 && bps > 0) {
    const grahamNum = Math.sqrt(22.5 * eps * bps);
    targets.graham = {
      price: Math.round(grahamNum * 100) / 100,
      upside: price > 0 ? Math.round((grahamNum / price - 1) * 10000) / 100 : null,
    };
  }

  // PEG-based: fair PE = earnings growth rate → target = current EPS * growth rate
  if (pe && revenueGrowth && revenueGrowth > 0) {
    const pegFairPE = revenueGrowth * 100; // assume growth rate as PE
    const epsVal = fundamentals?.netProfit && fundamentals?.sharesOutstanding
      ? fundamentals.netProfit / fundamentals.sharesOutstanding
      : eps;
    if (epsVal) {
      const pegTarget = epsVal * pegFairPE;
      targets.peg = {
        price: Math.round(pegTarget * 100) / 100,
        fairPE: Math.round(pegFairPE * 100) / 100,
        upside: price > 0 ? Math.round((pegTarget / price - 1) * 10000) / 100 : null,
      };
    }
  }

  // Simple DCF: assume 10% discount rate, 5-year CAGR projection
  if (fundamentals?.operatingCF) {
    const ccf = fundamentals.operatingCF;
    const growthRate = fundamentals.revenueGrowth || 0.1;
    const dcf5yr = ccf * Math.pow(1 + growthRate, 5) / 0.10; // simplified
    const perShare = dcf5yr / (stockData?.sharesOutstanding || 1);
    targets.dcf = {
      price: Math.round(perShare * 100) / 100,
      upside: price > 0 ? Math.round((perShare / price - 1) * 10000) / 100 : null,
      note: '基于现金流折现(10%折现率, 5年CAGR)'
    };
  }

  // Relative PE target (vs sector average)
  if (pe && fundamentals?.sectorPE) {
    const sectorAvgPE = fundamentals.sectorPE;
    const epsVal = eps || (fundamentals?.netProfit && fundamentals?.sharesOutstanding
      ? fundamentals.netProfit / fundamentals.sharesOutstanding : null);
    if (epsVal) {
      const relTarget = epsVal * sectorAvgPE;
      targets.relativePE = {
        price: Math.round(relTarget * 100) / 100,
        sectorAvgPE,
        upside: price > 0 ? Math.round((relTarget / price - 1) * 10000) / 100 : null,
      };
    }
  }

  return targets;
}

// ─── MAIN HANDLER ───────────────────────────────────────────────────────────────

export default async function handler(input, context) {
  const args = (input || '').trim();
  if (!args) {
    return {
      success: false,
      output: `Usage: /invest <TICKER> [analysts]\n\nExamples:\n  /invest 002624          (完整分析，完美世界)\n  /invest AAPL            (美股，苹果)\n  /invest 腾讯            (港股，腾讯)\n  /invest 600519 buffet,munger,taleb  (只用指定分析师)\n\n支持格式:\n  6位数字 → A股（上交所sh/深交所sz）\n  hkXXXXX → 港股\n  usXXXXX → 美股\n  中文名  → 港股（腾讯/美团等）\n\n新增 v4 功能:\n  • 新闻情绪分析（东方财富API）\n  • 风险管理（年化波动率+相关性调整）\n  • Kelly仓位建议\n  • 财务指标（营收/净利润/ROE/负债率）\n  • 7维NLP情绪特征\n\n⚠️ 本分析仅供教育目的，不构成投资建议。`,
    };
  }

  const parts = args.split(/\s+/);
  const ticker = parts[0].toUpperCase();
  const selectedInvestors = parts[1]
    ? parts[1].split(',').map(a => a.trim().toLowerCase())
    : Object.keys(INVESTORS);

  // ── 1. Fetch real data ────────────────────────────────────────────────────
  const [stockData, fundamentals, priceHistory] = await Promise.all([
    fetchQuote(ticker),
    fetchFundamentals(ticker),
    fetchPriceHistory(ticker),
  ]);

  if (!stockData) {
    return {
      success: false,
      output: `无法获取 ${ticker} 的数据。请检查股票代码是否正确。\n美股格式: AAPL, TSLA\n沪深: 6位数字如 002624, 600519\n港股: hk00700 或 中文名如 腾讯`,
    };
  }

  // ── 2. Technical analysis ─────────────────────────────────────────────────
  const techData = analyzeTechnicals(priceHistory.length > 0 ? priceHistory : null);

  // ── 3. News sentiment analysis ──────────────────────────────────────────
  const newsItems = await fetchNews(ticker);
  const sentimentData = computeSentimentScore(newsItems);

  // ── 4. Risk analysis ─────────────────────────────────────────────────────
  const closes = priceHistory.map(p => p.close);
  const riskData = await analyzeRisk(ticker, closes.length > 0 ? closes : [stockData.price]);

  // ── 4b. Macro + Geopolitics (Python experts) ─────────────────────────────
  // Fetch macro context and geopolitical risk in parallel
  const [macroCtx, geoResult] = await Promise.all([
    fetchMacroContext(),
    fetchGeopoliticsRisk(ticker, profile?.sector || '综合'),
  ]);

  // ── 5. Generate investor signals ─────────────────────────────────────────
  const signals = [];
  for (const key of selectedInvestors) {
    const investor = INVESTORS[key];
    if (!investor) continue;
    const signal = generateInvestorSignal(key, investor, stockData, techData, sentimentData);
    signals.push(signal);
  }

  // ── 6. Portfolio aggregation ──────────────────────────────────────────────
  let verdict = aggregateSignals(signals, riskData);

  // ── 6b. Macro-adjusted verdict ───────────────────────────────────────────
  verdict = adjustPositionByMacro(verdict, macroCtx);

  // ── 8. Performance metrics ───────────────────────────────────────────────
  const dailyReturns = [];
  for (let i = 1; i < priceHistory.length; i++) {
    dailyReturns.push((priceHistory[i].c - priceHistory[i-1].c) / priceHistory[i-1].c);
  }
  const perfMetrics = computePerformanceMetrics(dailyReturns);

  // ── 9. Candlestick patterns ───────────────────────────────────────────────
  const klines = priceHistory.map(p => ({ d: p.d, o: p.o, c: p.c, h: p.h, l: p.l }));
  const candlePatterns = detectCandlestickPatterns(klines);

  // ── 10. Sector profile ──────────────────────────────────────────────────
  const profile = await fetchStockProfile(ticker);

  // ── 11. Price targets ───────────────────────────────────────────────────
  const priceTargets = calculatePriceTargets(stockData, fundamentals);

  // ── 12. Build report ───────────────────────────────────────────────────────
  const verdictEmoji = { BUY: '🟢', HOLD: '🟡', SELL: '🔴', REDUCE: '⚠️' }[verdict.action] || '⚪';
  const now = new Date().toLocaleString('zh-CN');

  let report = `# 📊 AI 投资顾问团 v4 — ${ticker}\n\n`;
  report += `> **生成时间:** ${now}\n`;
  report += `> **代码:** ${stockData.displayCode}\n`;
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
  report += `| 52W范围 | ${stockData.week52Low || 'N/A'} – ${stockData.week52High || 'N/A'} |\n\n`;

  // Fundamentals
  if (Object.keys(fundamentals).length > 0) {
    report += `## 📋 财务指标\n\n`;
    report += `| 指标 | 数值 |\n|--------|------|\n`;
    if (fundamentals.revenue) report += `| 营收 | ${fundamentals.revenue} |\n`;
    if (fundamentals.netProfit) report += `| 净利润 | ${fundamentals.netProfit} |\n`;
    if (fundamentals.grossMargin !== 'N/A') report += `| 毛利率 | ${typeof fundamentals.grossMargin === 'number' ? (fundamentals.grossMargin * 100).toFixed(1) + '%' : fundamentals.grossMargin} |\n`;
    if (fundamentals.roe !== 'N/A') report += `| ROE | ${typeof fundamentals.roe === 'number' ? (fundamentals.roe * 100).toFixed(1) + '%' : fundamentals.roe} |\n`;
    if (fundamentals.debtRatio !== 'N/A') report += `| 负债率 | ${typeof fundamentals.debtRatio === 'number' ? (fundamentals.debtRatio * 100).toFixed(1) + '%' : fundamentals.debtRatio} |\n`;
    if (fundamentals.operatingCF && fundamentals.operatingCF !== 'N/A') report += `| 经营现金流 | ${fundamentals.operatingCF} |\n`;
    report += `\n`;
  }

  // News sentiment
  report += `---\n\n## 📰 新闻情绪分析\n\n`;
  if (sentimentData.newsCount > 0) {
    report += `| 特征 | 数值 |\n|--------|------|\n`;
    report += `| 综合情绪 | ${sentimentData.score >= 0 ? '🟢正面' : '🔴负面'} (${sentimentData.score > 0 ? '+' : ''}${sentimentData.score}) |\n`;
    if (sentimentData.features) {
      report += `| 正向性 | ${(sentimentData.features.positivity * 100).toFixed(0)}% |\n`;
      report += `| 负向性 | ${(sentimentData.features.negativity * 100).toFixed(0)}% |\n`;
      report += `| 紧迫性 | ${(sentimentData.features.urgency * 100).toFixed(0)}% |\n`;
      report += `| 波动性 | ${(sentimentData.features.volatility * 100).toFixed(0)}% |\n`;
      report += `| 具体性 | ${(sentimentData.features.specificity * 100).toFixed(0)}% |\n`;
      report += `| 领域 | ${sentimentData.features.domain} |\n`;
    }
    report += `| 新闻条数 | ${sentimentData.newsCount}条 |\n\n`;
  } else {
    report += `暂无新闻数据\n\n`;
  }

  // Risk manager
  report += `---\n\n## ⚖️ 风险管理\n\n`;
  report += `| 指标 | 数值 |\n|--------|------|\n`;
  report += `| 年化波动率 | ${riskData.annualizedVolatility !== null ? riskData.annualizedVolatility + '%' : 'N/A'} |\n`;
  report += `| 风险评分 | ${(riskData.riskScore * 100).toFixed(0)}/100 |\n`;
  report += `| 最大仓位 | ${(riskData.volatilityLimit * 100).toFixed(0)}%（波动率限制）|\n`;
  report += `| Kelly仓位 | ${(riskData.kellySize * 100).toFixed(1)}% |\n`;
  if (riskData.warnings.length > 0) {
    report += `| 风险警告 | ${riskData.warnings.join(' | ')} |\n`;
  }
  report += `\n`;

  // ── Macro + Geopolitics (if available) ──────────────────────────────────
  if (macroCtx) {
    report += `---

## 🌍 宏观分析 (FinceptTerminal)\n\n`;
    report += `| 指标 | 数值 |\n|--------|------|\n`;
    report += `| 政策立场 | ${
      macroCtx.policy_stance === 'RESTRICTIVE' ? '🔴 紧缩' :
      macroCtx.policy_stance === 'EXPANSIVE' ? '🟢 宽松' :
      macroCtx.policy_stance === 'NEUTRAL' ? '🟡 中性' : '⚪ 未知'
    } |\n`;
    report += `| 增长展望 | ${macroCtx.growth_outlook || 'N/A'} |\n`;
    report += `| 通胀风险 | ${macroCtx.inflation_risk || 'N/A'} |\n`;
    report += `| 衰退概率 | ${((macroCtx.recession_prob || 0) * 100).toFixed(0)}% |\n`;
    report += `| 曲线形态 | ${macroCtx.yield_curve_shape || 'N/A'} |\n`;
    if (macroCtx.key_risks && macroCtx.key_risks.length > 0) {
      report += `| 关键风险 | ${macroCtx.key_risks[0]} |\n`;
    }
    if (verdict.policyStance) {
      report += `\n**宏观仓位调整:** ${verdict.macroAdjustment} → Kelly仓位调整为 ${verdict.kellyFraction}%\n`;
    }
    report += `\n`;
  }

  if (geoResult && geoResult.geopolitics) {
    const geo = geoResult.geopolitics;
    report += `---

## 🗺️ 地缘政治风险 (FinceptTerminal)\n\n`;
    report += `| 地缘风险 | ${
      geo.risk_level === 'critical' ? '🔴 CRITICAL' :
      geo.risk_level === 'high' ? '🟠 HIGH' :
      geo.risk_level === 'medium' ? '🟡 MEDIUM' : '🟢 LOW'
    } (评分 ${(geo.risk_score * 100).toFixed(0)}%) |\n`;
    report += `| 仓位调整 | ${geo.position_adjustment >= 0 ? '+' : ''}${(geo.position_adjustment * 100).toFixed(0)}% |\n`;
    report += `| 行业 | ${geo.sector} |\n`;
    if (geo.warnings && geo.warnings.length > 0) {
      report += `| 警告 | ${geo.warnings[0]} |\n`;
    }
    if (geo.risks && geo.risks.length > 0) {
      report += `\n**主要风险:**\n`;
      for (const r of geo.risks.slice(0, 3)) {
        const emoji = r.risk_score > 0.6 ? '🔴' : r.risk_score > 0.3 ? '🟠' : '🟡';
        report += `- ${emoji} ${r.description || r.type}\n`;
      }
    }
    report += `\n`;
  }

  // Performance metrics (backtest-style)
  if (perfMetrics.sharpe !== null) {
    report += `---\n\n## 📊 绩效指标（回测风格）\n\n`;
    report += `| 指标 | 数值 | 评级 |\n|--------|------|------|\n`;
    report += `| 夏普比率 | ${perfMetrics.sharpe} | ${perfMetrics.sharpeGrade} |\n`;
    report += `| 索提诺比率 | ${perfMetrics.sortino} | ${perfMetrics.sortinoGrade} |\n`;
    report += `| 最大回撤 | ${perfMetrics.maxDrawdown}% | \n`;
    report += `| 胜率 | ${perfMetrics.winRate}% | \n`;
    report += `| 年化波动率 | ${perfMetrics.volatility}% | \n`;
    report += `| VaR(95%) | ${perfMetrics.var95}% (日度) | \n`;
    report += `| 年化收益率 | ${perfMetrics.annReturn}% | \n`;
    report += `| 数据天数 | ${perfMetrics.tradingDays}天 | \n\n`;
  }

  // Candlestick patterns
  if (candlePatterns.length > 0) {
    report += `---\n\n## 🕯️ K线形态\n\n`;
    report += `| 日期 | 形态 | 信号 | 置信度 |\n|------|------|------|----------|\n`;
    for (const p of candlePatterns) {
      const sig = p.signal === 'BULLISH' ? '🟢  看涨' : p.signal === 'BEARISH' ? '🔴 看跌' : '🟡 中性';
      report += `| ${p.date || '最近'} | ${p.pattern} | ${sig} | ${p.confidence}% |\n`;
    }
    report += `\n`;
  }

  // Sector profile
  if (profile.sector && profile.sector !== 'N/A') {
    report += `---\n\n## 🏢 公司概况\n\n`;
    report += `| 项目 | 内容 |\n|--------|------|\n`;
    report += `| 公司名 | ${profile.name} |\n`;
    report += `| 所属行业 | ${profile.sector} |\n`;
    report += `| 细分行业 | ${profile.industry !== 'N/A' ? profile.industry : 'N/A'} |\n`;
    report += `| 上市板 | ${profile.market} |\n`;
    report += `| 上市时间 | ${profile.listedDate !== 'N/A' ? profile.listedDate : 'N/A'} |\n`;
    report += `| 总股本 | ${profile.totalShares} |\n`;
    report += `| 流通股本 | ${profile.floatShares} |\n\n`;
  }

  // Price targets
  const targetKeys = Object.keys(priceTargets);
  if (targetKeys.length > 0) {
    report += `---\n\n## 🎯 估值目标\n\n`;
    report += `| 方法 | 目标价 | 上涨空间 | 说明 |\n|------|--------|----------|------|\n`;
    if (priceTargets.graham) {
      const up = priceTargets.graham.upside;
      report += `| Graham数 | ¥${priceTargets.graham.price} | ${up > 0 ? '+' : ''}${up}% | sqrt(22.5×EPS×BVPS) |\n`;
    }
    if (priceTargets.peg) {
      const up = priceTargets.peg.upside;
      report += `| PEG估值 | ¥${priceTargets.peg.price} | ${up > 0 ? '+' : ''}${up}% | 合理PE=${priceTargets.peg.fairPE} |\n`;
    }
    if (priceTargets.dcf) {
      const up = priceTargets.dcf.upside;
      report += `| DCF折现 | ¥${priceTargets.dcf.price} | ${up > 0 ? '+' : ''}${up}% | ${priceTargets.dcf.note} |\n`;
    }
    if (priceTargets.relativePE) {
      const up = priceTargets.relativePE.upside;
      report += `| 相对PE | ¥${priceTargets.relativePE.price} | ${up > 0 ? '+' : ''}${up}% | 行业均值PE=${priceTargets.relativePE.sectorAvgPE} |\n`;
    }
    report += `\n`;
  }

  // Technical signals
  report += `---\n\n## 📉 技术分析\n\n`;
  if (techData.signals.length > 0) {
    report += `| 指标 | 数值 | 信号 |\n|--------|------|------|\n`;
    for (const s of techData.signals) {
      report += `| ${s.indicator} | ${s.value} | ${s.emoji} ${s.signal} |\n`;
    }
    report += `\n**技术建议:** ${techData.recommendations.length > 0 ? techData.recommendations.join('；') + '。' : '指标平稳'}`;
    if (techData.volatility > 50) report += ` ⚠️波动率较高(${techData.volatility}%)，注意风险。`;
    report += `\n\n`;
  } else {
    report += `数据不足，无法进行技术分析\n\n`;
  }

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
  const finalAction = verdict.adjustedAction || verdict.action;
  const finalKelly = verdict.adjustedKelly || verdict.kellyFraction;
  const finalEmoji = { BUY: '🟢', HOLD: '🟡', SELL: '🔴', REDUCE: '⚠️' }[finalAction] || '⚪';

  report += `---

## 🎯 综合决策

`;
  report += `**${finalEmoji} ${finalAction}** (置信度: ${verdict.confidence}%)

`;
  report += `**原始评分:** ${verdict.rawScore > 0 ? '+' : ''}${(verdict.rawScore * 100).toFixed(0)}/100
`;
  report += `**风险调整:** ${verdict.volAdjusted ? '(已按波动率调整)' : '(无需调整)'}
`;
  if (verdict.policyStance) {
    report += `**宏观调整:** ${verdict.macroAdjustment} → Kelly仓位 ${finalKelly}%
`;
  } else {
    report += `**Kelly仓位:** ${verdict.kellyFraction}%
`;
  }
  report += `
`;
  report += `**核心理由:** ${verdict.reasoning}

`;
  const recText = finalKelly > 20 ? '建议买入' : finalKelly > 8 ? '观望' : '建议减仓';
  report += `**${recText}** (Kelly ${finalKelly}%)

`;
  report += `**投票分布:**
`;
  report += `- 🟢 买入(BUY): ${verdict.counts.BUY}/${signals.length}
`;
  report += `- 🟡 持有(HOLD): ${verdict.counts.HOLD}/${signals.length}
`;
  report += `- 🔴 卖出(SELL): ${verdict.counts.SELL}/${signals.length}
`;
  report += `- ⚠️ 减仓(REDUCE): ${verdict.counts.REDUCE}/${signals.length}

`;

  // Risk warnings
  const riskSignals = signals.filter(s =>
    ['taleb','graham','burry'].some(k => INVESTORS[k]?.name === s.name) &&
    (s.action === 'SELL' || s.action === 'REDUCE')
  );
  if (riskSignals.length > 0 || riskData.warnings.length > 0 || (geoResult && geoResult.geopolitics)) {
    report += `⚠️ **风险警告:**
`;
    if (riskSignals.length > 0) report += `- Taleb/Graham/Burry 等风险导向型分析师发出减仓/卖出信号
`;
    for (const w of riskData.warnings) report += `- ${w}
`;
    if (geoResult && geoResult.geopolitics && geoResult.geopolitics.warnings) {
      for (const w of geoResult.geopolitics.warnings.slice(0, 2)) report += `- 🗺️ ${w}
`;
    }
    report += `
`;
  }

  report += `---
`;

  return {
    success: true,
    output: report,
    metadata: {
      ticker,
      generatedAt: new Date().toISOString(),
      signalCount: signals.length,
      verdict: verdict.action,
      volatility: riskData.annualizedVolatility,
      sentimentScore: sentimentData.score,
      newsCount: sentimentData.newsCount,
      kellyFraction: verdict.kellyFraction,
    },
  };
}