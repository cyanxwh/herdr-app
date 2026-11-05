// Pure helpers shared by the native dialog and its validation script.
export function agentKind(agent) {
  return /codex/i.test(agent.key) ? 'codex' : /claude/i.test(agent.key) ? 'claude' : /antigravity/i.test(agent.key) ? 'antigravity' : null;
}
export function modelOptions(cache) {
  return (cache.models ?? []).filter(m => m.visibility === 'list').map(m => ({
    id: m.slug, name: m.display_name || m.slug, defaultEffort: m.default_reasoning_level,
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
  } else if (effort && (kind === 'claude' || kind === 'antigravity')) { remove(['--effort']); args.push('--effort', effort); }
  return args;
}

// Read only a root-level model scalar; tables (including projects) don't set the default.
export function configuredModel(text) {
  for (const line of (text ?? '').split(/\r?\n/)) {
    if (/^\s*\[/.test(line)) break;
    const match = line.match(/^\s*model\s*=\s*(["'])(.*?)\1\s*(?:#.*)?$/);
    if (match) return match[2];
  }
  return '';
}
export function templateModel(args) {
  let model = '';
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '-m' || args[i] === '--model') model = args[++i] ?? '';
    else if (/^(--model=|-m=)/.test(args[i])) model = args[i].slice(args[i].indexOf('=') + 1);
    else if (args[i] === '-c' || args[i] === '--config') {
      const match = (args[++i] ?? '').match(/^model\s*=\s*(.*)$/);
      if (match) model = match[1].replace(/^(["'])(.*)\1$/, '$2');
    }
  }
  return model;
}
export function effortOptions(models, selected, defaultModel) {
  const model = models.find(m => m.id === (selected || defaultModel));
  if (model) return model.efforts;
  if (selected || !models.length) return [];
  // No configured default: offer only levels supported by every visible model.
  return models[0].efforts.filter(level => models.every(m => m.efforts.includes(level)));
}

export function configuredValue(text, key) {
  for (const line of (text ?? '').split(/\r?\n/)) {
    if (/^\s*\[/.test(line)) break;
    const match = line.match(/^\s*([\w_]+)\s*=\s*(["'])(.*?)\2\s*(?:#.*)?$/);
    if (match?.[1] === key) return match[3];
  }
  return '';
}
export function templateEffort(args, kind) {
  let effort = '';
  for (let i = 1; i < args.length; i++) {
    if ((kind === 'claude' || kind === 'antigravity') && args[i] === '--effort') effort = args[++i] ?? '';
    else if ((kind === 'claude' || kind === 'antigravity') && args[i].startsWith('--effort=')) effort = args[i].slice(9);
    else if (kind === 'codex') {
      let config = '';
      if (args[i] === '-c' || args[i] === '--config') config = args[++i] ?? '';
      else if (args[i].startsWith('--config=')) config = args[i].slice(9);
      const match = config.match(/^model_reasoning_effort\s*=\s*(.*)$/);
      if (match) effort = match[1].replace(/^(["'])(.*)\1$/, '$2');
    }
  }
  return effort;
}

export function antigravityModels(output) {
  const groups = new Map();
  const order = ['low', 'medium', 'high', 'xhigh', 'max'];
  for (const line of output.replace(/\x1b\[[0-9;]*m/g, '').split(/\r?\n/)) {
    const match = line.match(/^([^\s]+)\t(.+)$/);
    if (!match) continue;
    const [, variant, label] = match;
    const tier = label.match(/\s+\((low|medium|high|xhigh|max)\)$/i)?.[1].toLowerCase();
    const id = tier && variant.endsWith('-' + tier) ? variant.slice(0, -tier.length - 1) : variant;
    if (!groups.has(id)) groups.set(id, { id, name: tier ? label.replace(/\s+\([^)]*\)$/, '') : label, efforts: [], variants: {} });
    const model = groups.get(id);
    if (tier && !model.efforts.includes(tier)) model.efforts.push(tier);
    model.variants[tier || ''] = variant;
  }
  return [...groups.values()].map(model => ({ ...model,
    efforts: order.filter(tier => model.efforts.includes(tier)),
    defaultEffort: model.efforts.includes('medium') ? 'medium' : order.find(tier => model.efforts.includes(tier)) || ''
  }));
}
export function antigravitySelection(models, current) {
  const model = models.find(m => m.id === current.id || Object.values(m.variants).includes(current.id));
  if (!model) throw new Error('The current Antigravity model is absent from its catalog');
  return { model: model.id, effort: current.effort || Object.entries(model.variants).find(([, id]) => id === current.id)?.[0] || model.defaultEffort };
}

export function claudeModelName(id, fallback = id) {
  const match = id.match(/claude-(opus|sonnet|haiku|fable)-(\d+(?:-\d{1,2})?)(?:-|\[|$)/i);
  return match ? `${match[1][0].toUpperCase()}${match[1].slice(1)} ${match[2].replace('-', '.')}${id.endsWith('[1m]') ? ' (1M)' : ''}` : fallback;
}
export function claudeModelOptions(rows) {
  const options = new Map();
  for (const row of rows) {
    const id = row.resolvedModel || row.value;
    if (!id || id === 'default') continue;
    options.set(id, { id, name: claudeModelName(id, row.displayName), aliases: rows.filter(r => (r.resolvedModel || r.value) === id).map(r => r.value),
      efforts: row.supportedEffortLevels || [], defaultEffort: /(?:opus|sonnet|haiku)-5-5/.test(id) ? 'medium' : 'high' });
  }
  // The CLI advertises only current aliases unless an older version is selected.
  // Keep the prior major releases separately selectable using their pinned IDs.
  for (const family of ['opus', 'sonnet', 'fable']) {
    const id = `claude-${family}-5`;
    const current = [...options.values()].find(m => m.id.startsWith(`claude-${family}-`));
    if (current && !options.has(id)) options.set(id, { id, name: claudeModelName(id), aliases: [], efforts: [...current.efforts], defaultEffort: 'high' });
  }
  return [...options.values()];
}
export function claudeCatalog(output) {
  for (const line of output.split(/\r?\n/)) {
    let data;
    try { data = JSON.parse(line); } catch { continue; }
    const result = data.type === 'control_response' ? data.response?.response : null;
    if (Array.isArray(result?.models) && result.models.length) return result.models;
  }
  throw new Error('Claude CLI did not return a model catalog');
}

export function shQuote(value) {
  return "'" + String(value).replace(/'/g, "'\\''") + "'";
}
