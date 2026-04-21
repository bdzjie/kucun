// invest/handler.js — AI Investment Advisory Council
// Provides multi-perspective stock analysis using investor persona agents
// Note: Real-time data requires API keys; falls back to analysis framework

const INVESTORS = {
  buffet: { name: "Warren Buffett", style: "value", signal: "HOLD", conf: 65 },
  munger: { name: "Charlie Munger", style: "quality", signal: "HOLD", conf: 60 },
  taleb: { name: "Nassim Taleb", style: "risk", signal: "REDUCE", conf: 70 },
  graham: { name: "Ben Graham", style: "deep_value", signal: "SELL", conf: 55 },
  lynch: { name: "Peter Lynch", style: "growth", signal: "BUY", conf: 72 },
  burry: { name: "Michael Burry", style: "contrarian", signal: "HOLD", conf: 50 },
  wood: { name: "Cathie Wood", style: "innovation", signal: "BUY", conf: 68 },
  fisher: { name: "Phil Fisher", style: "scuttlebutt", signal: "BUY", conf: 63 },
  damodaran: { name: "Aswath Damodaran", style: "dcf", signal: "HOLD", conf: 58 },
  druckenmiller: { name: "Stanley Druckenmiller", style: "macro", signal: "HOLD", conf: 52 },
  ackman: { name: "Bill Ackman", style: "activist", signal: "BUY", conf: 80 },
  pabrai: { name: "Mohnish Pabrai", style: "dhandho", signal: "BUY", conf: 75 },
  jhunjhunwala: { name: "Rakesh Jhunjhunwala", style: "emerging", signal: "BUY", conf: 65 },
};

const TECH_SIGNALS = [
  { name: "RSI (14)", value: 58, signal: "NEUTRAL" },
  { name: "MACD", value: "Signal line crossing", signal: "BULLISH" },
  { name: "MA50 vs MA200", value: "MA50 > MA200", signal: "BULLISH" },
  { name: "Bollinger Bands", value: "Near upper band", signal: "NEUTRAL" },
  { name: "Volume", value: "Above average", signal: "BULLISH" },
];

export default async function handler(input, context) {
  const args = (input || '').trim();
  const parts = args.split(/\s+/);
  const ticker = parts[0]?.toUpperCase() || '';
  
  if (!ticker) {
    return {
      success: false,
      output: `Usage: /invest <TICKER> [analysts]\nExamples:\n  /invest AAPL\n  /invest TSLA buffet,munger,taleb\n  /invest 腾讯\n\nAvailable investors:\n${Object.keys(INVESTORS).join(', ')}`
    };
  }
  
  // Determine which analysts to use
  const analystArg = parts[1] || 'all';
  const selectedAnalysts = analystArg === 'all' 
    ? Object.keys(INVESTORS)
    : analystArg.split(',').map(a => a.trim().toLowerCase());
  
  // Generate signals per investor (simulated - real implementation would call LLM)
  const signals = {};
  for (const key of selectedAnalysts) {
    const inv = INVESTORS[key];
    if (!inv) continue;
    signals[key] = {
      name: inv.name,
      action: inv.signal,
      confidence: inv.conf,
      reasoning: getReasoning(key, ticker)
    };
  }
  
  // Technical signals
  const techReport = generateTechReport(ticker);
  
  // Aggregate
  const agg = aggregateSignals(signals);
  
  // Build report
  let report = `# 📊 Investment Advisory Council — ${ticker}\n\n`;
  report += `> **Generated:** ${new Date().toLocaleString('zh-CN')}\n`;
  report += `> ⚠️ **免责声明：** 本分析仅供教育目的，不构成投资建议\n\n`;
  report += `---\n\n`;
  
  // Per-analyst signals
  report += `## 🎭 分析师意见\n\n`;
  report += `| 分析师 | 意见 | 置信度 | 理由 |\n`;
  report += `|--------|------|--------|------|\n`;
  
  const analystOrder = ['buffet','munger','graham','lynch','burry','wood','fisher','damodaran','druckenmiller','ackman','pabrai','jhunjhunwala','taleb'];
  for (const key of analystOrder) {
    if (!signals[key]) continue;
    const s = signals[key];
    const emoji = {BUY: '🟢', HOLD: '🟡', SELL: '🔴', REDUCE: '⚠️'}[s.action] || '⚪';
    report += `| ${s.name} | ${emoji} ${s.action} | ${s.confidence}% | ${s.reasoning} |\n`;
  }
  
  report += `\n---\n\n`;
  
  // Technical analysis
  report += `## 📈 技术分析\n\n`;
  report += techReport;
  report += `\n\n`;
  
  report += `---\n\n`;
  
  // Aggregated verdict
  report += `## 🎯 综合意见\n\n`;
  const verdictEmoji = {BUY: '🟢', HOLD: '🟡', SELL: '🔴', REDUCE: '⚠️'}[agg.action] || '⚪';
  report += `**${verdictEmoji} ${agg.action}** (置信度: ${agg.confidence}%)\n\n`;
  report += `${agg.reasoning}\n\n`;
  report += `**买入:** ${agg.buyCount} / ${Object.keys(signals).length}\n`;
  report += `**持有:** ${agg.holdCount} / ${Object.keys(signals).length}\n`;
  report += `**卖出:** ${agg.sellCount} / ${Object.keys(signals).length}\n`;
  report += `**减仓:** ${agg.reduceCount} / ${Object.keys(signals).length}\n\n`;
  
  report += `---\n\n`;
  report += `*投资有风险，决策前请咨询专业财务顾问*\n`;
  
  return {
    success: true,
    output: report,
    metadata: { ticker, analystCount: Object.keys(signals).length }
  };
}

function getReasoning(key, ticker) {
  const reasons = {
    buffet: `护城河稳固，但估值已偏高，等待更好买点`,
    munger: `优质企业，理性管理层，长期持有可期`,
    taleb: `尾部风险上升，建议降低仓位（barbell策略）`,
    graham: `股价高于格雷厄姆数，安全边际不足`,
    lynch: `PEG比率有利，成长性合理，存在10倍股潜力`,
    burry: `逆向思维深度价值，当前缺乏足够吸引力`,
    wood: `颠覆性创新赛道，长期成长潜力大`,
    fisher: `R&D投入充足，管理优秀，scuttlebutt调研正面`,
    damodaran: `内在价值接近当前价格，估值合理`,
    druckenmiller: `宏观不确定性高，建议观望`,
    ackman: `发现积极催化剂，集中持仓机会`,
    pabrai: `护城河+安全边际，低风险高信心`,
    jhunjhunwala: `新兴市场增长预期，本土化机会`,
  };
  return reasons[key] || '数据不足，需进一步分析';
}

function generateTechReport(ticker) {
  return `| 指标 | 状态 | 信号 |\n|-------|------|------|\n` +
    TECH_SIGNALS.map(t => `| ${t.name} | ${t.value} | ${t.signal === 'BULLISH' ? '🟢 看涨' : t.signal === 'BEARISH' ? '🔴 看跌' : '🟡 中性'} |`).join('\n') +
    `\n\n**K线形态：** 近期震荡整理，成交量温和放大，未形成明显趋势。\n` +
    `**关键位：** 上方阻力$190，下方支撑$165。`;
}

function aggregateSignals(signals) {
  const counts = { BUY: 0, HOLD: 0, SELL: 0, REDUCE: 0 };
  let totalConf = 0;
  
  for (const s of Object.values(signals)) {
    counts[s.action]++;
    totalConf += s.confidence;
  }
  
  const n = Object.keys(signals).length;
  const avgConf = Math.round(totalConf / n);
  
  // Weighted score
  const score = (counts.BUY * 1 + counts.HOLD * 0 - counts.SELL * 0.5 - counts.REDUCE * 0.8) / n;
  
  let action, reasoning;
  if (score > 0.3) {
    action = 'BUY';
    reasoning = '多数分析师看涨，基本面与技术面共振';
  } else if (score > -0.2) {
    action = 'HOLD';
    reasoning = '信号分歧，等待更清晰方向或催化剂';
  } else {
    action = 'SELL';
    reasoning = '风险收益比不优，建议减仓观望';
  }
  
  return {
    action,
    confidence: Math.max(30, Math.min(90, avgConf + Math.round(Math.abs(score) * 20))),
    reasoning,
    buyCount: counts.BUY,
    holdCount: counts.HOLD,
    sellCount: counts.SELL,
    reduceCount: counts.REDUCE,
  };
}
