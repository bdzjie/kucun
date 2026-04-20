// handler.js — what-am-i-working-on skill
// Queries ontology graph and formats status report

export default async function handler(input, context) {
  const { execSync } = await import('child_process');
  
  // Query ontology status
  let status;
  try {
    const output = execSync('python modules/ontology.py status', {
      cwd: 'C:/Users/Administrator/.openclaw/workspace',
      encoding: 'utf-8',
      timeout: 5000,
    });
    status = parseStatus(output);
  } catch (e) {
    return {
      success: false,
      output: `Failed to query ontology: ${e.message}`,
    };
  }
  
  // Format response
  let report = `# Working On — Status Report\n\n`;
  
  report += `## Active Projects (${status.summary.active_projects})\n`;
  for (const [name, st] of Object.entries(status.projects)) {
    if (st === 'active') {
      report += `- [active] ${name}\n`;
    }
  }
  
  report += `\n## Task Summary\n`;
  report += `- **${status.summary.total_tasks}** total tasks\n`;
  report += `- **${status.summary.in_progress_tasks}** in progress\n`;
  report += `- **${status.summary.completed_tasks}** completed\n`;
  
  report += `\n## In-Progress Tasks\n`;
  let hasInProgress = false;
  for (const [title, st] of Object.entries(status.tasks)) {
    if (st === 'in_progress') {
      report += `- [in progress] ${title}\n`;
      hasInProgress = true;
    }
  }
  if (!hasInProgress) {
    report += `- None\n`;
  }
  
  report += `\n## Recently Completed\n`;
  let completedCount = 0;
  for (const [title, st] of Object.entries(status.tasks)) {
    if (st === 'completed' && completedCount < 5) {
      report += `- [done] ${title}\n`;
      completedCount++;
    }
  }
  if (completedCount === 0) {
    report += `- None\n`;
  }
  
  return {
    success: true,
    output: report,
  };
}

function parseStatus(output) {
  // Simple parser for ontology status output
  const lines = output.split('\n').filter(l => l.trim());
  const status = {
    projects: {},
    tasks: {},
    summary: { total_projects: 0, active_projects: 0, total_tasks: 0, in_progress_tasks: 0, completed_tasks: 0 }
  };
  
  let section = null;
  for (const line of lines) {
    const m = line.match(/^\s*\[(\w+)\]\s*(.+)/);
    if (m) {
      const [, st, name] = m;
      if (section === 'projects') {
        status.projects[name] = st;
        if (st === 'active') status.summary.active_projects++;
      } else if (section === 'tasks') {
        status.tasks[name] = st;
        status.summary.total_tasks++;
        if (st === 'in_progress') status.summary.in_progress_tasks++;
        if (st === 'completed') status.summary.completed_tasks++;
      }
    } else if (line.includes('Active Projects:')) {
      section = 'projects';
    } else if (line.includes('Tasks:')) {
      section = 'tasks';
    }
  }
  
  return status;
}
