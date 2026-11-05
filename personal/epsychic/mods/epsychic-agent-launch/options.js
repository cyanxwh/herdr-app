// Pure helpers shared by the native dialog and its validation script.
export function agentKind(agent) {
  return /codex/i.test(agent.key) ? 'codex' : /claude/i.test(agent.key) ? 'claude' : null;
}
export function modelOptions(cache) {
  return (cache.models ?? []).filter(m => m.visibility === 'list').map(m => ({
    id: m.slug, name: m.display_name || m.slug,
    efforts: (m.supported_reasoning_levels ?? []).map(e => e.effort),
  }));
}
export function launchArgs(agent, model, effort) {
  const kind = agentKind(agent);
  const args = [...agent.run];
  // Explicit selections take precedence over template flags; defaults keep the template.
  const remove = (names) => {
    for (let i = 1; i < args.length; i++) {
      if (names.includes(args[i])) { args.splice(i, 2); i--; }
      else if (names.some(n => args[i].startsWith(n + '='))) { args.splice(i, 1); i--; }
    }
  };
  if (model) { remove(['--model', '-m']); args.push('--model', model); }
  if (effort && kind === 'codex') {
    for (let i = 1; i < args.length; i++) {
      if (['-c', '--config'].includes(args[i]) && /^model_reasoning_effort\s*=/.test(args[i + 1] ?? '')) { args.splice(i, 2); i--; }
      else if (/^(--config=|-c=?)model_reasoning_effort\s*=/.test(args[i])) { args.splice(i, 1); i--; }
    }
    args.push('-c', `model_reasoning_effort="${effort}"`);
  } else if (effort && kind === 'claude') { remove(['--effort']); args.push('--effort', effort); }
  return args;
}
