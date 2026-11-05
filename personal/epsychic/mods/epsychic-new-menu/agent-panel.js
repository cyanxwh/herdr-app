import { View, div } from 'gpui-kit';
import { h_flex, v_flex, InputState, Input } from 'gpui-base';
import { theme, exec, run, closeOverlay, spaces, shared, setShared } from 'herdr';
import { agentKind, modelOptions, launchArgs, configuredModel, templateModel, effortOptions, configuredValue, templateEffort, antigravityModels, antigravitySelection, claudeCatalog, claudeModelOptions, claudeModelName, shQuote } from './options.js';

const CACHE = 'epsychic.model-cache.v1';
const REFRESH_AFTER_MS = 30_000;

export default class AgentPanel extends View {
  init(_props, cx) {
    const active = spaces().find(s => s.active);
    this.p = { space: active?.id, spaceName: active?.name, machine: active?.machine, ...(_props ?? {}) };
    this.agent = this.p.agent ?? { key: 'codex', name: 'Codex', run: ['codex'] };
    this.kind = agentKind(this.agent);
    this.model = '';
    this.effort = '';
    this.models = [];
    this.efforts = [];
    this.loading = true;
    this.query = '';
    this.search = InputState.new({ value: '', placeholder: `Search ${this.agent.name} models…` });
    this.search.on('change', (_e, cx) => { this.query = this.search.value().trim().toLowerCase(); cx.notify(); });
    this.search.on('submit', () => this.start());
    this.handle = cx.focus_handle();
    this.search.focus();
    this.dirty = false;
    this.cacheKey = JSON.stringify([this.p.machine ?? '', this.agent.run, (this.p.folder ?? '').replace(/\\/g, '/')]);
    const saved = shared(CACHE)?.[this.cacheKey];
    const cached = saved?.data;
    const usable = Array.isArray(cached?.models) && cached.models.length > 0 && cached.models.some(m => m.id === cached.defaultModel);
    if (usable) this.applySnapshot(cached);
    const age = Date.now() - (saved?.savedAt ?? 0);
    if (usable && age >= 0 && age < REFRESH_AFTER_MS) return;
    this.refreshing = true;
    cx.spawn(async cx => {
      try {
        const data = await this.fetchSnapshot();
        this.applySnapshot(data);
        const entries = Object.entries({ ...shared(CACHE), [this.cacheKey]: { savedAt: Date.now(), data } })
          .sort((a, b) => b[1].savedAt - a[1].savedAt).slice(0, 32);
        setShared(CACHE, Object.fromEntries(entries));
      } catch {
        this.failed = !usable;
        this.warning = usable ? 'Could not refresh models. Showing saved options.'
          : this.kind === 'codex' ? 'No models found. Run Codex on this machine, then reopen this menu.'
          : this.kind === 'antigravity' ? 'Could not load Antigravity models or defaults. Check agy sign-in on this machine.'
          : 'Could not load Claude models or effort options from the CLI.';
      } finally {
        this.loading = false;
        this.refreshing = false;
        cx.notify();
      }
    });
  }
  async fetchSnapshot() {
    const data = { models: [], efforts: [] };
    if (this.kind === 'codex') {
      const results = await Promise.allSettled([
        exec('sh', ['-c', 'cat "${CODEX_HOME:-$HOME/.codex}/models_cache.json"'], { on: this.p.machine }),
        exec('sh', ['-c', 'cat "${CODEX_HOME:-$HOME/.codex}/config.toml"'], { on: this.p.machine })
      ]);
      const cache = results[0];
      if (cache.status !== 'fulfilled' || cache.value.code !== 0) throw new Error('No model cache');
      data.models = modelOptions(JSON.parse(cache.value.stdout));
      if (!data.models.length) throw new Error('Empty model cache');
      const config = results[1];
      const text = config.status === 'fulfilled' && config.value.code === 0 ? config.value.stdout : '';
      data.defaultModel = templateModel(this.agent.run) || configuredModel(text) || data.models[0].id;
      data.defaultEffort = templateEffort(this.agent.run, this.kind) || configuredValue(text, 'model_reasoning_effort');
    } else if (this.kind === 'antigravity') {
      const [catalog, selection] = await Promise.all([
        exec(this.agent.run[0], ['models'], { on: this.p.machine }),
        exec(this.agent.run[0], [...this.agent.run.slice(1), '-p', '/model', '--output-format', 'json'], { on: this.p.machine, cwd: this.p.folder })
      ]);
      if (catalog.code !== 0 || selection.code !== 0) throw new Error('Antigravity model discovery failed');
      data.models = antigravityModels(catalog.stdout);
      const info = JSON.parse(selection.stdout);
      if (!data.models.length || info.status !== 'SUCCESS' || !info.command?.data?.id)
        throw new Error('Invalid Antigravity model response');
      const selected = antigravitySelection(data.models, info.command.data);
      data.defaultModel = selected.model;
      data.defaultEffort = selected.effort;
    } else if (this.kind === 'claude') {
      const requests = [
        exec('sh', ['-c', 'cat "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/settings.json"'], { on: this.p.machine }),
        exec('sh', ['-c', 'printf "%s\n%s\n%s" "$ANTHROPIC_MODEL" "$ANTHROPIC_DEFAULT_MODEL" "$CLAUDE_CODE_EFFORT_LEVEL"'], { on: this.p.machine })
      ];
      if (this.p.folder) {
        const folder = this.p.folder.replace(/\\/g, '/');
        for (const file of ['settings.json', 'settings.local.json'])
          requests.push(exec('sh', ['-c', 'cat ' + shQuote(folder + '/.claude/' + file)], { on: this.p.machine }));
      }
      const catalogIndex = requests.length;
      const initialize = JSON.stringify({ type: 'control_request', request_id: 'herdr-models', request: { subtype: 'initialize' } });
      const folder = (this.p.folder ?? '.').replace(/\\/g, '/');
      const launcher = [...this.agent.run, '--print', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--no-session-persistence'].map(shQuote).join(' ');
      const command = 'cd ' + shQuote(folder) + " && printf '%s\\n' " + shQuote(initialize) + ' | ' + launcher;
      requests.push(exec('sh', ['-c', command], { on: this.p.machine }));
      const results = await Promise.allSettled(requests);
      const readSettings = index => {
        const result = results[index];
        try { return result?.status === 'fulfilled' && result.value.code === 0 ? JSON.parse(result.value.stdout) : {}; }
        catch { return {}; }
      };
      const user = readSettings(0), project = this.p.folder ? readSettings(2) : {}, local = this.p.folder ? readSettings(3) : {};
      const mergedSettings = { ...user, ...project, ...local };
      data.claudeSettings = { effortLevel: mergedSettings.effortLevel, modelSettings: mergedSettings.modelSettings };
      const envResult = results[1];
      const env = envResult.status === 'fulfilled' && envResult.value.code === 0 ? envResult.value.stdout.split('\n') : [];
      const configured = mergedSettings;
      const catalog = results[catalogIndex];
      if (catalog.status !== 'fulfilled' || catalog.value.code !== 0) throw new Error('Could not read Claude model catalog');
      const entries = claudeCatalog(catalog.value.stdout);
      data.models = claudeModelOptions(entries);
      const configuredModel = templateModel(this.agent.run) || env[0] || configured.env?.ANTHROPIC_MODEL || configured.model || env[1] || configured.env?.ANTHROPIC_DEFAULT_MODEL || 'default';
      data.defaultModel = entries.find(m => m.value === configuredModel)?.resolvedModel || configuredModel;

      data.defaultEffort = env[2] || configured.env?.CLAUDE_CODE_EFFORT_LEVEL || templateEffort(this.agent.run, this.kind);
      data.legacyEffort = project.effortLevel || local.effortLevel;

    }
    if (data.defaultModel && !data.models.some(m => m.id === data.defaultModel))
      data.models.unshift({ id: data.defaultModel, name: this.kind === 'claude' ? claudeModelName(data.defaultModel) : data.defaultModel, efforts: data.efforts });
    return data;
  }
  applySnapshot(data) {
    const previous = { model: this.model, effort: this.effort };
    Object.assign(this, data);
    this.loading = false;
    this.failed = false;
    this.warning = '';
    if (this.dirty) {
      this.model = previous.model;
      this.effort = previous.effort;
      this.error = this.validSelection() ? '' : 'This selection is no longer available. Choose another model or effort.';
    } else {
      this.model = this.defaultModel || this.models[0]?.id || '';
      this.effort = this.preferredEffort();
      this.validateEffort();
    }
  }
  validSelection() {
    return this.models.some(m => m.id === this.model) && (!this.levels().length || this.levels().includes(this.effort));
  }

  levels() {
    return effortOptions(this.models, this.model, this.defaultModel);
  }
  preferredEffort() {
    if (this.kind === 'codex' || this.kind === 'antigravity')
      return this.defaultEffort || this.models.find(m => m.id === this.model)?.defaultEffort || 'medium';
    const modern = /^(opus|sonnet|haiku)$/.test(this.model) || /(?:opus|sonnet|haiku)-5-5/.test(this.model);
    const option = this.models.find(m => m.id === this.model);
    const modelSettings = this.claudeSettings?.modelSettings?.[this.model] || option?.aliases?.map(alias => this.claudeSettings?.modelSettings?.[alias]).find(Boolean);
    return this.defaultEffort || modelSettings?.effortLevel || this.legacyEffort || (!modern && this.claudeSettings?.effortLevel) || (modern ? 'medium' : 'high');
  }
  validateEffort() {
    const levels = this.levels();
    if (!levels.includes(this.effort)) {
      const preferred = this.preferredEffort();
      this.effort = levels.includes(preferred) ? preferred : levels[0] || '';
    }
  }
  start() {
    if (this.started || this.loading || this.failed || !this.validSelection()) return;
    if (this.p.space && !spaces().some(s => s.id === this.p.space)) { this.error = 'This space has closed. Reopen the new-agent menu.'; return; }
    this.started = true;
    const argv = launchArgs(this.agent, this.model, this.effort);
    // Use the captured space, even if focus changed while this submenu was open.
    if (this.p.space) run('tab.new', { name: this.agent.name, space: this.p.space, argv });
    else run('space.new', { name: this.agent.name, tab: this.agent.name, machine: this.p.machine ?? '', argv });
    closeOverlay(this.p.overlay);
  }
  button(id, text, selected, action, enabled = true) {
    const t = theme();
    return div().id(id).px(10).py(6).rounded(7)
      .bg(selected ? t.selected : t.popover).text_color(enabled ? t.foreground : t.dim).text_size(12)
      .when(enabled, el => el.hover(s => s.bg(t.hover)))
      .on_click((_e, cx) => { if (enabled) { action(); cx.notify(); } }).child(text);
  }
  render() {
    const t = theme();
    const label = text => div().text_size(11.5).text_color(t.muted).child(text);
    const choices = this.models
      .filter(m => !this.query || `${m.name} ${m.id}`.toLowerCase().includes(this.query));
    return v_flex().id('agent-panel').track_focus(this.handle).w(410).h(510).min_h(0)
      .bg(t.popover).border_1().border_color(t.border).rounded(8).shadow_md().text_color(t.foreground)
      .on_mouse_down('left', (_e, cx) => cx.stop_propagation())
      .on_key_down((e, cx) => {
        if (e.key === 'enter') { this.start(); cx.notify(); }
      })
      .child(div().p(8).child(Input.new(this.search).w_full().h(31).px(9).rounded(7).bg(t.popover)
        .text_size(12.8).text_color(t.foreground)))
      .child(div().h(1).bg(t.border).flex_none())
      .child(v_flex().id('models').flex_1().min_h(0).p(6).gap(2).overflow_y_scrollbar()
        .children(choices.map((m, i) => h_flex().id(`model-${i}`).h(32).px(10).gap(6).flex_none().rounded(6).items_center()
          .bg(this.model === m.id ? t.selected : t.popover).hover(s => s.bg(t.hover))
          .on_click((_e, cx) => { this.dirty = true; this.model = m.id; this.error = ''; this.validateEffort(); cx.notify(); })
          .child(div().flex_1().truncate().text_size(12.5).child(m.name))
          .child(div().text_color(t.muted).child(this.model === m.id ? '✓' : ''))))
        .when(this.loading, el => el.child(label('Loading options…')))
        .when(!this.loading && !choices.length, el => el.child(label('No matching models.'))))
      .child(div().h(1).bg(t.border).flex_none())
      .child(v_flex().p(12).gap(10).flex_none()
        .child(label('Effort'))
        .child(h_flex().gap(4).flex_wrap()
          .children(this.levels().map(level => this.button(`effort-${level}`, level, level === this.effort, () => { this.dirty = true; this.effort = level; this.error = ''; }))))
        .when(Boolean(this.warning), el => el.child(label(this.warning)))
        .when(Boolean(this.error), el => el.child(label(this.error)))
        .child(h_flex().justify_end().items_center()
          .child(this.button('start', 'Launch', true, () => this.start(), !this.loading && !this.started && !this.failed && this.validSelection()))));
  }
}
