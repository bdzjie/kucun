// handler.js — studio skill: OpenClaw system dashboard
// Queries gateway RPC API for health, cost, sessions, cron, skills, tasks

const GATEWAY_URL = 'ws://127.0.0.1:18789';
const TOKEN = 'chen00jie';

export default async function handler(input, context) {
  const { execSync } = await import('child_process');
  
  const cmd = (input || '').trim().toLowerCase();
  
  try {
    switch (cmd) {
      case 'health':
      case '':
        return await getHealth();
      case 'cost':
        return await getCost();
      case 'sessions':
        return await getSessions();
      case 'cron':
        return await getCron();
      case 'skills':
        return await getSkills();
      case 'tasks':
        return await getTasks();
      case 'all':
        return await getAll();
      default:
        return { success: true, output: `Unknown command: ${cmd}\nUsage: /studio [health|cost|sessions|cron|skills|tasks|all]` };
    }
  } catch (e) {
    return { success: false, output: `Studio error: ${e.message}` };
  }
}

async function rpcCall(method, params = '{}') {
  const { execSync } = await import('child_process');
  const cmd = `openclaw gateway call ${method} --token ${TOKEN} --url ${GATEWAY_URL} --params '${params}' --json 2>&1`;
  const output = execSync(cmd, { encoding: 'utf-8', timeout: 10000 });
  
  // Extract JSON from output
  const jsonMatch = output.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(`Failed to parse RPC response for ${method}`);
  }
  return JSON.parse(jsonMatch[0]);
}

async function getHealth() {
  const data = await rpcCall('health');
  
  const gatewayOk = data.ok ? '✅ ok' : '❌ error';
  const channels = data.channels || {};
  const channelCount = Object.keys(channels).length;
  const configuredChannels = Object.values(channels).filter(c => c.configured).length;
  
  let report = `# Gateway Health\n\n`;
  report += `| Metric | Status |\n`;
  report += `|--------|--------|\n`;
  report += `| Gateway | ${gatewayOk} |\n`;
  report += `| Channels | ${configuredChannels}/${channelCount} configured |\n`;
  report += `| Heartbeat | ${data.heartbeatSeconds}s |\n`;
  report += `| Default Agent | ${data.defaultAgentId} |\n`;
  report += `| Sessions | ${data.sessions?.count || 0} |\n`;
  
  return { success: true, output: report };
}

async function getCost() {
  const data = await rpcCall('usage.cost');
  
  const days = data.daily || [];
  const total = data.totals || {};
  
  let report = `# Cost Report\n\n`;
  report += `**Total (4 days):** $${total.totalCost?.toFixed(2) || 0}\n`;
  report += `**Total tokens:** ${(total.totalTokens / 1e6).toFixed(1)}M\n\n`;
  
  report += `| Date | Cost | Tokens | Status |\n`;
  report += `|------|------|--------|--------|\n`;
  
  for (const day of [...days].reverse()) {
    const cost = day.totalCost?.toFixed(2) || '0.00';
    const tokens = (day.totalTokens / 1e6).toFixed(1);
    let flag = '';
    if (parseFloat(cost) > 200) flag = ' 🚨';
    else if (parseFloat(cost) > 50) flag = ' ⚠️';
    report += `| ${day.date} | $${cost} | ${tokens}M |${flag} |\n`;
  }
  
  return { success: true, output: report };
}

async function getSessions() {
  const data = await rpcCall('sessions.list');
  
  let report = `# Sessions\n\n`;
  
  const sessions = data.sessions || [];
  if (sessions.length === 0) {
    report += `No active sessions\n`;
    return { success: true, output: report };
  }
  
  for (const s of sessions) {
    const age = Math.floor((Date.now() - s.updatedAt) / 1000 / 60);
    const tokens = s.inputTokens || 0;
    const pct = s.percentUsed || 0;
    report += `## ${s.sessionId?.substring(0, 8)}...\n`;
    report += `- Model: ${s.model}\n`;
    report += `- Context: ${pct}% used\n`;
    report += `- Age: ${age}m ago\n`;
    report += `- Input tokens: ${tokens.toLocaleString()}\n\n`;
  }
  
  return { success: true, output: report };
}

async function getCron() {
  const data = await rpcCall('cron.list');
  
  let report = `# Cron Jobs\n\n`;
  
  const jobs = data.jobs || [];
  if (jobs.length === 0) {
    report += `No cron jobs\n`;
    return { success: true, output: report };
  }
  
  for (const job of jobs) {
    const enabled = job.enabled ? '🟢' : '🔴';
    const next = job.state?.nextRunAtMs 
      ? new Date(job.state.nextRunAtMs).toLocaleString()
      : 'N/A';
    report += `## ${enabled} ${job.name}\n`;
    report += `- Schedule: ${job.schedule?.expr || job.schedule?.kind}\n`;
    report += `- Next run: ${next}\n`;
    report += `- Session: ${job.sessionTarget}\n\n`;
  }
  
  return { success: true, output: report };
}

async function getSkills() {
  const data = await rpcCall('skills.status');
  
  const skills = data.skills || [];
  const eligible = skills.filter(s => s.eligible && !s.disabled);
  const ineligible = skills.filter(s => !s.eligible && !s.disabled);
  
  let report = `# Skills Status\n\n`;
  report += `**Total:** ${skills.length} | **Eligible:** ${eligible.length} | **Ineligible:** ${ineligible.length}\n\n`;
  
  report += `## Eligible (${eligible.length})\n`;
  for (const s of eligible.slice(0, 20)) {
    report += `- ${s.skillKey}: ${s.description?.substring(0, 50)}...\n`;
  }
  if (eligible.length > 20) {
    report += `- ... and ${eligible.length - 20} more\n`;
  }
  
  if (ineligible.length > 0) {
    report += `\n## Ineligible (${ineligible.length}) — missing deps\n`;
    for (const s of ineligible.slice(0, 10)) {
      const missing = Object.entries(s.missing || {})
        .filter(([, v]) => v && v.length > 0)
        .map(([k, v]) => `${k}: ${v.join(', ')}`)
        .join('; ');
      report += `- ${s.skillKey}: ${missing || 'unknown'}\n`;
    }
  }
  
  return { success: true, output: report };
}

async function getTasks() {
  const data = await rpcCall('status');
  
  const tasks = data.tasks || {};
  
  let report = `# Tasks\n\n`;
  report += `| Status | Count |\n`;
  report += `|--------|-------|\n`;
  report += `| Total | ${tasks.total || 0} |\n`;
  report += `| Active | ${tasks.active || 0} |\n`;
  report += `| Succeeded | ${tasks.byStatus?.succeeded || 0} |\n`;
  report += `| Failed | ${tasks.byStatus?.failed || 0} |\n`;
  
  return { success: true, output: report };
}

async function getAll() {
  const [health, cost, sessions, cron, skills, tasks] = await Promise.all([
    getHealth().catch(e => ({ success: false, output: `Health error: ${e.message}` })),
    getCost().catch(e => ({ success: false, output: `Cost error: ${e.message}` })),
    getSessions().catch(e => ({ success: false, output: `Sessions error: ${e.message}` })),
    getCron().catch(e => ({ success: false, output: `Cron error: ${e.message}` })),
    getSkills().catch(e => ({ success: false, output: `Skills error: ${e.message}` })),
    getTasks().catch(e => ({ success: false, output: `Tasks error: ${e.message}` })),
  ]);
  
  let report = `# OpenClaw Studio — Full Report\n\n`;
  report += `> Generated: ${new Date().toLocaleString()}\n\n`;
  report += health.output + '\n\n';
  report += '---\n\n' + cost.output + '\n\n';
  report += '---\n\n' + sessions.output + '\n\n';
  report += '---\n\n' + cron.output + '\n\n';
  report += '---\n\n' + skills.output + '\n\n';
  report += '---\n\n' + tasks.output;
  
  return { success: true, output: report };
}
