import { spaces, panes, run } from 'herdr';
import { query, DETAIL, inScope, taskPrompt } from './api.js';

export function destination() {
  const space = spaces().find(s => s.active);
  const list = panes().filter(p => p.space === space?.id);
  return { space: space?.id, machine: space?.machine ?? '', folder: list.find(p => p.focused)?.cwd || list[0]?.cwd || space?.folder };
}

export async function startIssue({ key, issue, target, agent, current = () => true }) {
  if (!target?.space || !target.folder || !agent?.run?.length) throw new Error('Open a project space and choose an installed agent to start this task.');
  const space = spaces().find(s => s.id === target.space && (s.machine ?? '') === target.machine);
  if (!space) throw new Error('The target space has closed. Choose another space.');
  const existing = space.tabs.find(t => t.name === issue.identifier);
  if (existing) { run('tab.select', { id: existing.id }); return true; }
  const data = await query(key, DETAIL, { id: issue.id });
  if (!current()) return false;
  if (!data.issue || !inScope(data.issue, data.viewer?.id)) {
    const error = new Error('This issue is no longer assigned to you in a current cycle.');
    error.outOfScope = true;
    throw error;
  }
  if (!spaces().some(s => s.id === target.space && (s.machine ?? '') === target.machine)) throw new Error('The target space has closed. Choose another space.');
  run('tab.new', { name: issue.identifier, space: target.space, folder: target.folder, argv: agent.run, task: taskPrompt(data.issue) });
  return true;
}
