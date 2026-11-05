import { View, div } from 'gpui-kit';
import { h_flex, v_flex, InputState, Input } from 'gpui-base';
import { theme, props, shared, setShared, exec, run, closeOverlay, spaces } from 'herdr';
import { agentKind, modelOptions, launchArgs } from './options.js';

const PREFS = 'epsychic.agent-launch';
export default class AgentLaunch extends View {
  init(_props, cx) {
    const active = spaces().find(s => s.active);
    this.p = { space: active?.id, spaceName: active?.name, machine: active?.machine, ...(props() ?? {}) };
    this.agent = this.p.agent ?? { key: 'codex', name: 'Codex', run: ['codex'] };
    this.kind = agentKind(this.agent);
    this.prefKey = `${this.p.machine ?? ''}/${this.agent.key}`;
    const pref = shared(PREFS)?.[this.prefKey] ?? {};
    this.model = pref.model ?? '';
    this.effort = pref.effort ?? '';
    this.models = [];
    this.efforts = [];
    this.loading = true;
    this.custom = InputState.new({ value: this.model });
    this.custom.on('change', (_e, cx) => {
      this.model = this.custom.value().trim(); this.validateEffort(); cx.notify();
    });
    this.handle = cx.focus_handle(); this.handle.focus();
    cx.spawn(async cx => {
      try {
        if (this.kind === 'codex') {
          const r = await exec('sh', ['-c', 'cat "${CODEX_HOME:-$HOME/.codex}/models_cache.json"'], { on: this.p.machine });
          if (r.code !== 0) throw new Error('No model cache');
          this.models = modelOptions(JSON.parse(r.stdout));
          if (!this.models.length) throw new Error('Empty model cache');
        } else if (this.kind === 'claude') {
          this.models = ['fable', 'opus', 'sonnet', 'haiku'].map(id => ({ id, name: id }));
          const r = await exec(this.agent.run[0], ['--help'], { on: this.p.machine });
          const levels = r.stdout.match(/--effort[\s\S]*?\((low[^)]*)\)/)?.[1];
          if (r.code !== 0 || !levels) throw new Error('Cannot read supported effort levels');
          this.efforts = levels.split(',').map(s => s.trim()).filter(s => /^[a-z]+$/.test(s));
        }
      } catch {
        this.warning = this.kind === 'codex'
          ? 'Model cache unavailable. Enter a model ID and set effort after launch.'
          : 'Could not load effort options from the CLI.';
      }
      this.loading = false; this.validateEffort(); cx.notify();
    });
  }
  levels() {
    return this.kind === 'codex' ? this.models.find(m => m.id === this.model)?.efforts ?? [] : this.efforts;
  }
  validateEffort() { if (!this.levels().includes(this.effort)) this.effort = ''; }
  start() {
    if (this.started || this.loading) return;
    if (this.p.space && !spaces().some(s => s.id === this.p.space)) { this.error = 'This space has closed. Reopen the new-agent menu.'; return; }
    this.started = true;
    setShared(PREFS, { ...shared(PREFS), [this.prefKey]: { model: this.model, effort: this.effort } });
    const argv = launchArgs(this.agent, this.model, this.effort);
    // Use the captured space, even if focus changed while this dialog was open.
    if (this.p.space) run('tab.new', { name: this.agent.name, space: this.p.space, argv });
    else run('space.new', { name: this.agent.name, tab: this.agent.name, machine: this.p.machine ?? '', argv });
    closeOverlay(this.p.overlay);
  }
  button(id, text, selected, action, enabled = true) {
    const t = theme();
    return div().id(id).px(10).py(6).rounded(6).border_1().border_color(selected ? t.accent : t.border)
      .bg(selected ? t.selected : t.raised).text_color(enabled ? t.foreground : t.dim).text_size(12)
      .when(enabled, el => el.hover(s => s.bg(t.hover)))
      .on_click((_e, cx) => { if (enabled) { action(); cx.notify(); } }).child(text);
  }
  render() {
    const t = theme();
    const label = text => div().text_size(12).text_color(t.muted).child(text);
    return v_flex().id('agent-launch').track_focus(this.handle).h(610).w_full().p(18).gap(12)
      .bg(t.popover).text_color(t.foreground)
      .on_key_down((e, cx) => {
        if (e.key === 'escape') closeOverlay(this.p.overlay);
        if (e.key === 'enter') { this.start(); cx.notify(); }
      })
      .child(div().text_size(16).font_semibold().child(`Start ${this.agent.name}`))
      .child(label(`Target: ${this.p.spaceName ?? 'New space'} · ${this.p.machine ?? 'This computer'}`))
      .child(label(this.loading ? 'Loading options…' : 'Model'))
      .child(v_flex().id('models').flex_1().min_h(0).gap(4).overflow_y_scrollbar()
        .child(this.button('model-default', 'Default (CLI settings)', !this.model, () => { this.model = ''; this.custom.set_value(''); this.validateEffort(); }))
        .children(this.models.map((m, i) => this.button(`model-${i}`, m.name, this.model === m.id, () => {
          this.model = m.id; this.custom.set_value(m.id); this.validateEffort();
        }))))
      .child(label('Custom model ID (leave blank for default)'))
      .child(Input.new(this.custom).h(34).px(10).rounded(6).border_1().border_color(t.input).bg(t.background).text_color(t.foreground).text_size(13))
      .child(label('Effort'))
      .child(h_flex().gap(5).flex_wrap()
        .child(this.button('effort-default', 'Default', !this.effort, () => { this.effort = ''; }))
        .children(this.levels().map(level => this.button(`effort-${level}`, level, level === this.effort, () => { this.effort = level; }))))
      .when(Boolean(this.warning), el => el.child(label(this.warning)))
      .when(this.kind === 'codex' && !this.levels().length, el => el.child(label('Select a listed model to choose its effort level.')))
      .when(Boolean(this.error), el => el.child(label(this.error)))
      .child(div().text_size(11).text_color(t.dim).child('Remembers your choice per machine and agent. Esc to cancel, Enter to launch.'))
      .child(h_flex().justify_end().gap(8)
        .child(this.button('cancel', 'Cancel', false, () => closeOverlay(this.p.overlay)))
        .child(this.button('start', 'Launch agent', true, () => this.start(), !this.loading && !this.started)));
  }
}
