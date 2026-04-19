/**
 * windows-gui-workflow skill handler
 * Runs multi-step PyAutoGUI workflows
 */

const PYTHON = 'C:/Users/Administrator/AppData/Local/Programs/Python/Python312/python.exe';
const WORKFLOW_MODULE = 'C:/Users/Administrator/.openclaw/workspace/modules/windows_gui_workflow.py';

const PREDEFINED_WORKFLOWS = {
  'open-calculator': {
    name: 'Open Calculator',
    steps: [
      { action: 'press', args: ['win', 'r'], delay: 0.5 },
      { action: 'type', args: ['calc'], delay: 0.3 },
      { action: 'press', args: ['enter'], delay: 1.5 },
    ]
  },
  'open-explorer': {
    name: 'Open File Explorer',
    steps: [
      { action: 'press', args: ['win', 'r'], delay: 0.5 },
      { action: 'type', args: ['explorer'], delay: 0.3 },
      { action: 'press', args: ['enter'], delay: 1.5 },
    ]
  },
  'show-desktop': {
    name: 'Show Desktop',
    steps: [
      { action: 'press', args: ['win', 'd'], delay: 0.3 },
    ]
  },
  'screenshot': {
    name: 'Take Screenshot',
    steps: [
      { action: 'screenshot', delay: 0 },
    ]
  },
  'open-notepad': {
    name: 'Open Notepad',
    steps: [
      { action: 'press', args: ['win', 'r'], delay: 0.5 },
      { action: 'type', args: ['notepad'], delay: 0.3 },
      { action: 'press', args: ['enter'], delay: 1.0 },
    ]
  },
  'open-task-manager': {
    name: 'Open Task Manager',
    steps: [
      { action: 'press', args: ['ctrl', 'shift', 'escape'], delay: 0.3 },
    ]
  },
};

export default async function windowsGuiWorkflowHandler(event) {
  let input = '';
  if (event.type === 'message' && event.context?.content) {
    input = event.context.content;
  } else if (event.message?.content) {
    input = event.message.content;
  }

  // Parse: /gui-workflow <workflow> or /gui-workflow run <path>
  const match = input.match(/^\/gui-workflow\s+(\S+)(?:\s+(.+))?$/i);
  if (!match) {
    const names = Object.keys(PREDEFINED_WORKFLOWS).join(', ');
    return {
      handled: true,
      skill: 'windows-gui-workflow',
      response: `Usage: /gui-workflow <workflow-name>\n\nAvailable workflows:\n${names}\n\nOr: /gui-workflow run <json_path>\n\nExamples:\n/gui-workflow open-calculator\n/gui-workflow screenshot\n/gui-workflow run C:/Users/Admin/Desktop/my_workflow.json`,
    };
  }

  const [, workflowName, pathArg] = match;

  if (workflowName.toLowerCase() === 'run' && pathArg) {
    // Run custom workflow from JSON file
    return runWorkflowFile(pathArg.trim());
  }

  const wf = PREDEFINED_WORKFLOWS[workflowName.toLowerCase()];
  if (!wf) {
    const names = Object.keys(PREDEFINED_WORKFLOWS).join(', ');
    return {
      handled: true,
      skill: 'windows-gui-workflow',
      response: `Unknown workflow: ${workflowName}\n\nAvailable: ${names}`,
    };
  }

  return runWorkflow(wf);
}

async function runWorkflow(wf) {
  try {
    const { execFileSync } = await import('node:child_process');

    // Write workflow to temp file
    const fs = await import('node:fs');
    const path = await import('node:path');
    const os = await import('node:os');

    const tmpDir = os.tmpdir();
    const tmpFile = path.join(tmpDir, `gui_workflow_${Date.now()}.json`);

    fs.writeFileSync(tmpFile, JSON.stringify(wf), 'utf8');

    const result = execFileSync(PYTHON, [WORKFLOW_MODULE, tmpFile], {
      encoding: 'utf8',
      timeout: 30000,
      maxBuffer: 1024 * 1024,
    });

    // Clean up
    try { fs.unlinkSync(tmpFile); } catch {}

    return {
      handled: true,
      skill: 'windows-gui-workflow',
      response: `Workflow completed: ${wf.name}\n\n${result.trim()}`,
      workflow: wf.name,
      steps: wf.steps.length,
    };
  } catch (e) {
    return {
      handled: true,
      skill: 'windows-gui-workflow',
      response: `Workflow failed: ${e.message}`,
    };
  }
}

async function runWorkflowFile(filePath) {
  try {
    const { execFileSync } = await import('node:child_process');
    const { existsSync } = await import('node:fs');

    if (!existsSync(filePath)) {
      return {
        handled: true,
        skill: 'windows-gui-workflow',
        response: `Workflow file not found: ${filePath}`,
      };
    }

    const result = execFileSync(PYTHON, [WORKFLOW_MODULE, filePath], {
      encoding: 'utf8',
      timeout: 30000,
      maxBuffer: 1024 * 1024,
    });

    return {
      handled: true,
      skill: 'windows-gui-workflow',
      response: `Workflow completed\n\n${result.trim()}`,
    };
  } catch (e) {
    return {
      handled: true,
      skill: 'windows-gui-workflow',
      response: `Workflow failed: ${e.message}`,
    };
  }
}
