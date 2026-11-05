import { View, div, svg } from 'gpui-kit';
import { h_flex, v_flex, Input, InputState, Popover } from 'gpui-base';
import { theme, knownAgents, shared, setShared, nextCommand, layout, props, openOverlay } from 'herdr';
import { CACHE, DETAIL_CACHE, AGENT, query, IDENTITY, loadSnapshot, currentIssues, sortIssues, issueHierarchy } from './api.js';
import { readKey, saveKey, deleteKey } from './auth.js';
import { destination, startIssue } from './task.js';
import IssueDetails from './detail.js';

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) { const result = find(child, id); if (result) return result; }
  return null;
}

export default class Issues extends View {
  init(_props, cx) {
    const p = props() ?? _props ?? {};
    if (p.detail && p.issue) { this.detail = cx.new(IssueDetails, p); return; }
    this.key = null; this.snapshot = null; this.loading = true;
    this.error = ''; this.query = ''; this.agents = []; this.launching = new Set(); this.collapsed = new Set();
    this.generation = 0; this.agentGeneration = 0; this.agentMachine = null;
    this.search = InputState.new({ placeholder: 'Search issues…' });
    this.search.on('change', (_e, cx) => { this.query = this.search.value().trim().toLowerCase(); cx.notify(); });
    this.search.on('focus', (_e, cx) => { this.searchFocused = true; cx.notify(); });
    this.search.on('blur', (_e, cx) => { this.searchFocused = false; cx.notify(); });
    this.secret = InputState.new({ placeholder: 'Linear API key' }); this.secret.set_masked(true);
    this.secret.on('submit', (_e, cx) => this.connect(cx));
    this.ensureAgents(cx);
    cx.spawn(async cx => {
      try {
        this.key = await readKey();
        if (this.key) {
          const identity = await query(this.key, IDENTITY), saved = shared(CACHE);
          this.snapshot = saved?.viewer?.id === identity.viewer?.id && saved?.organization?.id === identity.organization?.id ? saved : null;
          this.refresh(cx, identity);
        }
      } catch (e) { this.error = e.message; if (e.auth) { this.key = null; setShared(DETAIL_CACHE, null); } }
      finally { this.loading = false; cx.notify(); }
    });
    // Hidden stack copies stay alive, so skip background requests while another panel is shown.
    cx.timer.every(60_000, cx => {
      const root = layout();
      if (this.key && !this.settingsOpen && !find(root, 'panel')?.hidden && find(root, 'panel-body')?.active === 'issues') this.refresh(cx);
    });
    cx.spawn(async cx => {
      for (;;) {
        const command = await nextCommand();
        if (command === 'refresh') this.refresh(cx);
        if (command === 'settings') { this.settingsOpen = !this.settingsOpen; cx.notify(); }
        if (command === 'details') { const issue = sortIssues(currentIssues(this.snapshot))[0]; if (issue) this.openDetails(issue); }
      }
    });
  }
  ensureAgents(cx) {
    const on = destination().machine;
    if (this.agentMachine === on) return;
    this.agentMachine = on; this.agents = shared('new-menu.agents')?.[on]?.filter(a => a.installed) ?? [];
    this.agentError = ''; this.agentsLoading = true;
    const generation = ++this.agentGeneration;
    cx.spawn(async cx => {
      try {
        const agents = await knownAgents({ on: on || null });
        if (generation !== this.agentGeneration) return;
        this.agents = agents.filter(a => a.installed);
        setShared('new-menu.agents', { ...shared('new-menu.agents'), [on]: agents });
      } catch { if (generation === this.agentGeneration) this.agentError = 'Cannot load agents on this machine.'; }
      finally { if (generation === this.agentGeneration) this.agentsLoading = false; cx.notify(); }
    });
  }
  selectedAgent() {
    const selected = shared(AGENT)?.[this.agentMachine];
    return this.agents.find(a => a.key === selected) || this.agents.find(a => a.key === 'codex') || this.agents[0];
  }
  toolbarIcon(id, child, active = false) {
    const t = theme();
    return h_flex().id(id).size(28).flex_none().items_center().justify_center().rounded(6)
      .cursor_pointer().bg(active ? t.selected : t.background).text_color(t.muted)
      .hover(s => s.bg(t.hover).text_color(t.foreground)).child(child);
  }
  toggleSearch(cx) {
    this.searchOpen = !this.searchOpen;
    if (this.searchOpen) this.search.focus();
    else { this.search.set_value(''); this.query = ''; }
    cx.notify();
  }
  moreMenu(agent, t) {
    return Popover.new('issue-more-menu').open(!!this.moreOpen).anchor('top_right')
      .on_open_change((open, cx) => { this.moreOpen = open; cx.notify(); })
      .trigger(this.toolbarIcon('issue-more', '···', this.moreOpen))
      .content(v_flex().w(230).max_h(420).p(5).gap(2).overflow_y_scrollbar().rounded(8)
        .bg(t.popover).border_1().border_color(t.border).shadow_md()
        .child(div().px(9).py(6).text_size(11).text_color(t.dim).child('Filters'))
        .child(h_flex().px(9).py(5).gap(12).items_center().text_size(12)
          .child(div().flex_1().text_color(t.dim).child('Cycle')).child(div().text_color(t.foreground).child('Current cycle')))
        .child(h_flex().px(9).py(5).gap(12).items_center().text_size(12)
          .child(div().flex_1().text_color(t.dim).child('Assignee')).child(div().text_color(t.foreground).child('Me')))
        .child(div().h(1).mx(4).my(5).bg(t.border))
        .child(div().px(9).py(6).text_size(11).text_color(t.dim).child('Default agent'))
        .children(this.agents.map(a => this.button(`issue-agent-${a.key}`, h_flex().w_full().gap(8).items_center()
          .child(div().flex_1().child(a.name)).child(div().text_color(t.muted).child(a.key === agent?.key ? '✓' : '')), () => {
          setShared(AGENT, { ...shared(AGENT), [this.agentMachine]: a.key }); this.moreOpen = false;
        }, !this.agentsLoading, a.key === agent?.key)))
        .when(!this.agents.length, el => el.child(div().p(8).text_size(12).text_color(t.dim).child(this.agentsLoading ? 'Loading agents…' : 'No installed agents')))
        .child(div().h(1).mx(4).my(5).bg(t.border))
        .child(this.button('linear-refresh', this.refreshing ? 'Refreshing…' : 'Refresh', cx => {
          this.moreOpen = false; this.refresh(cx);
        }, !!this.key && !this.refreshing))
        .child(this.button('linear-connection', 'Linear connection…', () => { this.settingsOpen = !this.settingsOpen; this.moreOpen = false; })));
  }
  refresh(cx, identity) {
    if (!this.key || this.refreshing || this.connecting || this.disconnecting) return;
    this.refreshing = true;
    const generation = this.generation, key = this.key;
    cx.spawn(async cx => {
      try {
        const snapshot = await loadSnapshot(key, identity);
        if (generation !== this.generation) return;
        this.snapshot = snapshot; setShared(CACHE, snapshot); this.error = '';
      } catch (e) {
        if (generation !== this.generation) return;
        this.error = e.message;
        if (e.auth) { this.key = null; this.snapshot = null; setShared(CACHE, null); setShared(DETAIL_CACHE, null); }
      } finally { if (generation === this.generation) this.refreshing = false; cx.notify(); }
    });
  }
  connect(cx) {
    const key = this.secret.value().trim();
    if (!key || this.connecting || this.disconnecting) return;
    this.connecting = true; this.error = '';
    const generation = ++this.generation;
    cx.spawn(async cx => {
      try {
        const snapshot = await loadSnapshot(key);
        await saveKey(key);
        if (generation !== this.generation) return;
        this.key = key; this.snapshot = snapshot; setShared(CACHE, snapshot); setShared(DETAIL_CACHE, null);
        this.secret.set_value(''); this.settingsOpen = false;
      } catch (e) { this.error = e.message; }
      finally { this.connecting = false; this.refreshing = false; cx.notify(); }
    });
  }
  disconnect(cx) {
    if (this.disconnecting || this.connecting) return;
    this.disconnecting = true;
    cx.spawn(async cx => {
      try {
        await deleteKey(); ++this.generation;
        this.key = null; this.snapshot = null; setShared(CACHE, null); setShared(DETAIL_CACHE, null);
        this.error = ''; this.settingsOpen = false; this.refreshing = false;
        this.secret.set_value('');
      } catch (e) { this.error = e.message; }
      finally { this.disconnecting = false; cx.notify(); }
    });
  }
  launch(issue, cx) {
    const target = destination(), agent = this.selectedAgent();
    if (this.launching.has(issue.id) || !agent || !this.key || !target.space || !target.folder || this.connecting || this.disconnecting) return;
    this.launching.add(issue.id); this.error = '';
    const key = this.key, generation = this.generation;
    cx.spawn(async cx => {
      try {
        await startIssue({ key, issue, target, agent, current: () => generation === this.generation });
      } catch (e) {
        if (generation !== this.generation) return;
        if (e.outOfScope) {
          if (this.snapshot) {
            this.snapshot = { ...this.snapshot, issues: this.snapshot.issues.filter(i => i.id !== issue.id) };
            setShared(CACHE, this.snapshot);
          }
        }
        this.error = e.message;
      }
      finally { this.launching.delete(issue.id); cx.notify(); }
    });
  }
  openDetails(issue) {
    openOverlay({ mod: 'epsychic-issues', kind: 'dialog', width: 860, height: 660,
      props: { detail: true, issue, target: destination(), agent: this.selectedAgent(),
        account: { userId: this.snapshot?.viewer?.id, workspaceId: this.snapshot?.organization?.id } } });
  }
  button(id, label, action, enabled = true, selected = false) {
    const t = theme();
    return div().id(id).h(28).px(9).flex_none().flex().items_center().justify_center().rounded(6)
      .text_size(12).text_color(enabled ? t.foreground : t.dim).bg(selected ? t.selected : t.background)
      .when(enabled, el => el.cursor_pointer().hover(s => s.bg(t.hover)))
      .on_click((_e, cx) => { cx.stop_propagation(); if (enabled) { action(cx); cx.notify(); } }).child(label);
  }
  connection(t) {
    return v_flex().p(14).gap(12)
      .child(div().font_semibold().child(this.key ? 'Linear connection' : 'Connect Linear'))
      .child(div().text_size(12).text_color(t.muted).child('Use a personal API key with read access. Your key is stored in macOS Keychain.'))
      .child(this.button('linear-settings', 'Open Linear settings', cx => cx.open_url('https://linear.app/settings/api')))
      .child(Input.new(this.secret).h(34).px(9).rounded(6).border_1().border_color(t.input).bg(t.background).text_color(t.foreground))
      .child(h_flex().gap(6).justify_end()
        .when(Boolean(this.key), el => el.child(this.button('linear-disconnect', this.disconnecting ? 'Disconnecting…' : 'Disconnect', cx => this.disconnect(cx), !this.connecting && !this.disconnecting)))
        .child(this.button('linear-connect', this.connecting ? 'Connecting…' : this.key ? 'Update connection' : 'Connect', cx => this.connect(cx), !this.connecting && !this.disconnecting, true)))
      .when(Boolean(this.key), el => el.child(this.button('linear-settings-back', 'Back to issues', cx => { this.settingsOpen = false; }, !this.connecting && !this.disconnecting)));
  }
  row(issue, agent, target, t, depth = 0, hasChildren = false, context = false) {
    const busy = this.launching.has(issue.id);
    return v_flex().id(`issue-${issue.id}`).flex_none().min_w(0).px(10).py(7).ml(Math.min(depth, 8) * 16).gap(3).rounded(7).hover(s => s.bg(t.hover))
      .cursor_pointer().on_click(() => this.openDetails(issue))
      .child(h_flex().h(18).flex_none().min_w(0).gap(6).items_center()
        .when(hasChildren, el => el.child(div().id(`issue-toggle-${issue.id}`).size(18).rounded(4).flex_none().flex().items_center().justify_center().hover(s => s.bg(t.selected))
          .on_click((_e, cx) => { cx.stop_propagation(); if (this.collapsed.has(issue.id)) this.collapsed.delete(issue.id); else this.collapsed.add(issue.id); cx.notify(); })
          .child(svg(`mods/files/chevron-${!this.query && this.collapsed.has(issue.id) ? 'right' : 'down'}.svg`).size(12).text_color(t.muted))))
        .child(div().size(7).rounded(4).flex_none().bg(/^#[0-9a-f]{6}$/i.test(issue.state?.color ?? '') ? issue.state.color : t.muted))
        .child(div().id(`open-${issue.id}`).flex_1().min_w(0).truncate().tooltip(issue.title).text_size(12.8).text_color(t.foreground).child(issue.title)))
      .child(h_flex().h(28).flex_none().min_w(0).items_center().gap(6).text_size(11).text_color(t.dim)
        .child(div().flex_none().child(issue.identifier))
        .when(!context, el => el.child(div().min_w(0).truncate().child(issue.state?.name ?? '')))
        .child(div().flex_1().min_w(0).truncate().child(context ? 'Parent issue' : issue.cycle?.name || `Cycle ${issue.cycle?.number}`))
        .when(!context, el => el.child(this.button(`launch-${issue.id}`,
          svg(busy ? 'mods/workspace-chrome/spinner.svg' : 'mods/epsychic-issues/start.svg').size(14).when(busy, el => el.spin(900)),
          cx => this.launch(issue, cx), !!agent && !!target.space && !!target.folder && !busy && !this.agentsLoading, true)
          .w(28).px(0).tooltip(busy ? 'Starting…' : 'Start task').accessibility_label('Start task'))));
  }
  render(cx) {
    if (this.detail) return div().size_full().min_h(0).child(this.detail);
    this.ensureAgents(cx);
    const t = theme(), target = destination(), agent = this.selectedAgent();
    const all = sortIssues(currentIssues(this.snapshot));
    const issues = issueHierarchy(all, this.snapshot?.parents ?? [], this.query, this.collapsed);
    return v_flex().id('linear-issues').size_full().min_h(0).rounded(10).overflow_hidden()
      .bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13)
      .child(h_flex().h(42).px(10).gap(4).items_center().flex_none().border_b(1).border_color(t.border)
        .child(svg('mods/epsychic-issues/issue.svg').size(14).text_color(t.muted))
        .child(div().font_semibold().child('Issues'))
        .child(div().flex_1().text_size(11).text_color(t.dim).child(this.key && this.snapshot ? String(all.length) : ''))
        .when(Boolean(this.key) && !this.settingsOpen, el => el
          .child(this.toolbarIcon('issue-search-toggle', svg('mods/workspace-chrome/search.svg').size(14), this.searchOpen)
            .on_click((_e, cx) => this.toggleSearch(cx))))
        .child(this.moreMenu(agent, t)))
      .when(this.loading, el => el.child(div().p(14).text_color(t.dim).child('Connecting to Linear…')))
      .when(!this.loading && (!this.key || this.settingsOpen), el => el.child(this.connection(t)))
      .when(Boolean(this.key) && !this.settingsOpen, el => el
        .when(!!this.searchOpen, el => el.child(v_flex().flex_none().p(8).border_b(1).border_color(t.border)
          .child(h_flex().id('issue-search').h(34).px(9).gap(7).items_center().rounded(6)
            .on_key_down((e, cx) => { if (e.key === 'escape') { cx.stop_propagation(); this.toggleSearch(cx); } })
            .border_1().border_color(this.searchFocused ? t.accent : t.input).bg(t.surface).cursor_text()
            .on_click(() => this.search.focus())
            .child(svg('mods/workspace-chrome/search.svg').size(14).flex_none().text_color(t.muted))
            .child(Input.new(this.search).flex_1().min_w(0).h_full().text_color(t.foreground).text_size(12)))))
        .when(Boolean(this.agentError), el => el.child(div().px(10).py(8).text_size(11).text_color(t.dim).child(this.agentError)))
        .when(!target.folder, el => el.child(div().px(10).py(8).text_size(11).text_color(t.dim).child('Open a project space to start tasks.')))
        .child(v_flex().id('issue-list').flex_1().min_h(0).overflow_y_scrollbar().p(5).gap(2)
          .children(issues.map(({ issue, depth, hasChildren, context }) => this.row(issue, agent, target, t, depth, hasChildren, context)))
          .when(!issues.length, el => el.child(div().p(10).text_size(12).text_color(t.dim).child(this.refreshing && !this.snapshot ? 'Loading issues…' : this.query ? 'No matching issues.' : 'No issues assigned to you in a current cycle.')))))
      .when(Boolean(this.error), el => el.child(div().flex_none().p(12).border_t(1).border_color(t.border).text_size(12).text_color(t.blocked).child(this.error)));
  }
}
