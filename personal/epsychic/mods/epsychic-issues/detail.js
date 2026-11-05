import { View, div, svg } from 'gpui-kit';
import { h_flex, v_flex, TextView } from 'gpui-base';
import { theme, closeOverlay, openOverlay, spaces, shared, setShared } from 'herdr';
import { query, INSPECT, CHILDREN, inScope, cycleLabel, CACHE, DETAIL_CACHE, sortIssues } from './api.js';
import { readKey } from './auth.js';
import { startIssue } from './task.js';

const FRESH_MS = 60_000;
const CACHE_LIMIT = 32;

export default class IssueDetails extends View {
  init(p, cx) {
    this.p = p; this.issue = p.issue; this.comments = []; this.loading = false;
    this.handle = cx.focus_handle(); this.handle.focus();
    this.cacheKey = p.account?.userId && p.account?.workspaceId
      ? JSON.stringify([p.account.workspaceId, p.account.userId, p.issue.id]) : null;
    const saved = this.cacheKey && shared(DETAIL_CACHE)?.[this.cacheKey];
    if (saved?.issue?.id === p.issue.id && saved.userId === p.account?.userId && Array.isArray(saved.comments)) {
      this.issue = saved.issue; this.userId = saved.userId; this.comments = saved.comments;
      this.before = saved.before; this.hasEarlier = saved.hasEarlier; this.savedAt = saved.savedAt; this.loaded = true;
      const age = Date.now() - saved.savedAt;
      const changed = !saved.issue.children || (!!p.issue.updatedAt && p.issue.updatedAt !== saved.issue.updatedAt);
      if (age >= 0 && age < FRESH_MS && !changed) {
        // Restore content synchronously; Keychain access never delays the body.
        cx.spawn(async cx => {
          try {
            this.key = await readKey();
            if (!this.key) throw new Error('Reconnect Linear from the Issues panel.');
          } catch (e) { this.error = e.message; }
          finally { cx.notify(); }
        });
        return;
      }
    }
    this.load(cx);
  }
  saveCache() {
    if (!this.cacheKey) return;
    const { comments: page, ...issue } = this.issue;
    const entry = { issue, userId: this.userId, comments: this.comments,
      before: this.before, hasEarlier: this.hasEarlier, savedAt: this.savedAt };
    const entries = Object.entries({ ...shared(DETAIL_CACHE), [this.cacheKey]: entry })
      .sort((a, b) => b[1].savedAt - a[1].savedAt).slice(0, CACHE_LIMIT);
    setShared(DETAIL_CACHE, Object.fromEntries(entries));
  }
  load(cx, earlier = false) {
    if (this.loading || this.childLoading || this.starting) return;
    this.loading = true; this.error = '';
    cx.spawn(async cx => {
      try {
        this.key ??= await readKey();
        if (!this.key) throw new Error('Reconnect Linear from the Issues panel.');
        const data = await query(this.key, INSPECT, { id: this.p.issue.id, before: earlier ? this.before : null });
        if (!data.issue) throw new Error('This issue is no longer available.');
        if (this.p.account?.userId && data.viewer?.id !== this.p.account.userId) throw new Error('Your Linear account changed. Reconnect from the Issues panel.');
        const children = earlier ? this.issue.children : null;
        this.issue = children ? { ...data.issue, children } : data.issue;
        this.userId = data.viewer?.id; this.loaded = true;
        this.comments = [...new Map([...(earlier ? this.comments : []), ...data.issue.comments.nodes].map(c => [c.id, c])).values()]
          .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
        this.before = data.issue.comments.pageInfo.startCursor;
        this.hasEarlier = data.issue.comments.pageInfo.hasPreviousPage;
        if (!earlier) this.savedAt = Date.now();
        this.saveCache();
      } catch (e) { this.error = e.message; }
      finally { this.loading = false; cx.notify(); }
    });
  }
  openRelated(issue, back = false) {
    const history = this.p.history ?? [];
    closeOverlay(this.p.overlay);
    openOverlay({ mod: 'epsychic-issues', kind: 'dialog', width: 860, height: 660,
      props: { ...this.p, overlay: undefined, issue, history: back ? history.slice(0, -1) : [...history, this.issue] } });
  }
  moreChildren(cx) {
    const page = this.issue.children;
    if (this.childLoading || this.loading || !this.key || !page?.pageInfo.hasNextPage) return;
    this.childLoading = true; this.error = '';
    cx.spawn(async cx => {
      try {
        const data = await query(this.key, CHILDREN, { id: this.issue.id, after: page.pageInfo.endCursor });
        if (!data.issue?.children) throw new Error('Could not load sub-issues.');
        const next = data.issue.children;
        if (next.pageInfo.hasNextPage && (!next.pageInfo.endCursor || next.pageInfo.endCursor === page.pageInfo.endCursor)) throw new Error('Could not finish loading sub-issues.');
        this.issue = { ...this.issue, children: { ...next, nodes: [...new Map([...page.nodes, ...next.nodes].map(i => [i.id, i])).values()] } };
        this.saveCache();
      } catch (e) { this.error = e.message; }
      finally { this.childLoading = false; cx.notify(); }
    });
  }
  start(cx) {
    if (!this.canStart()) return;
    this.starting = true; this.error = '';
    cx.spawn(async cx => {
      try {
        const started = await startIssue({ key: this.key, issue: this.issue, target: this.p.target, agent: this.p.agent });
        if (started) closeOverlay(this.p.overlay);
      } catch (e) {
        this.error = e.message;
        if (e.outOfScope) {
          this.userId = null;
          const saved = shared(CACHE);
          if (saved?.viewer?.id === this.issue.assignee?.id) setShared(CACHE, { ...saved, issues: saved.issues.filter(i => i.id !== this.issue.id) });
        }
      } finally { this.starting = false; cx.notify(); }
    });
  }
  canStart() {
    const target = this.p.target;
    return this.loaded && !!this.key && !this.starting && !!this.p.agent?.run?.length &&
      !!target?.folder && spaces().some(s => s.id === target.space && (s.machine ?? '') === target.machine) && inScope(this.issue, this.userId);
  }
  button(id, label, action, enabled = true, primary = false) {
    const t = theme();
    return h_flex().id(id).h(32).px(12).items_center().justify_center().rounded(7).border_1()
      .border_color(primary ? t.solid : t.input).bg(primary ? t.solid : t.raised)
      .text_size(12.5).text_color(enabled ? primary ? t.solid_foreground : t.foreground : t.dim)
      .when(enabled, el => el.cursor_pointer().hover(s => s.opacity(0.88)))
      .on_click((_e, cx) => { cx.stop_propagation(); if (enabled) { action(cx); cx.notify(); } }).child(label);
  }
  metadata(label, value, t) {
    return h_flex().gap(9).items_start().min_w(0)
      .child(div().w(65).flex_none().text_color(t.dim).child(label))
      .child(div().flex_1().min_w(0).text_color(t.foreground).child(value || 'None'));
  }
  render() {
    const t = theme(), issue = this.issue;
    const markdown = (id, body) => TextView.markdown(id, body).selectable(true).scrollable(false).w_full().text_size(13).text_color(t.foreground);
    return v_flex().id('issue-details').track_focus(this.handle).size_full().min_h(0).bg(t.popover).text_color(t.foreground).text_size(12.5)
      .on_key_down((e, cx) => { if (e.key === 'escape') { cx.stop_propagation(); closeOverlay(this.p.overlay); } })
      .child(h_flex().h(48).px(22).gap(9).items_center().flex_none().border_b(1).border_color(t.border)
        .when(!!this.p.history?.length, el => el.child(this.button('issue-detail-back', '←', () => this.openRelated(this.p.history[this.p.history.length - 1], true))))
        .child(svg('mods/epsychic-issues/issue.svg').size(15).text_color(t.muted))
        .child(div().flex_1().text_color(t.muted).child(issue.identifier))
        .child(div().id('issue-detail-refresh').size(28).rounded(7).flex().items_center().justify_center().text_color(t.muted)
          .when(!this.loading && !this.starting, el => el.cursor_pointer().hover(s => s.bg(t.hover)))
          .on_click((_e, cx) => this.load(cx))
          .child(svg(this.loading ? 'mods/workspace-chrome/spinner.svg' : 'mods/epsychic-issues/refresh.svg').size(14).when(this.loading, el => el.spin(900))))
        .child(div().id('issue-detail-close').size(28).rounded(7).flex().items_center().justify_center().cursor_pointer()
          .hover(s => s.bg(t.hover)).on_click(() => closeOverlay(this.p.overlay)).child(svg('mods/pane/close.svg').size(13).text_color(t.muted))))
      .child(v_flex().id('issue-detail-scroll').flex_1().min_h(0).overflow_y_scrollbar()
        .child(v_flex().px(28).py(22).gap(20)
          .child(div().text_size(21).font_semibold().child(issue.title))
          .when(!!issue.parent, el => el.child(div().id('issue-parent').cursor_pointer().text_size(12).text_color(t.muted)
            .on_click(() => this.openRelated(issue.parent)).child(`Parent issue · ${issue.parent.identifier} ${issue.parent.title}`)))
          .child(h_flex().gap(28).items_start()
            .child(v_flex().flex_1().min_w(0).gap(9)
              .child(this.metadata('Status', issue.state?.name, t))
              .child(this.metadata('Assignee', issue.assignee?.displayName || issue.assignee?.name, t))
              .child(this.metadata('Priority', ['No priority', 'Urgent', 'High', 'Medium', 'Low'][issue.priority ?? 0], t)))
            .child(v_flex().flex_1().min_w(0).gap(9)
              .child(this.metadata('Team', issue.team?.name, t))
              .child(this.metadata('Project', issue.project?.name, t))
              .child(this.metadata('Cycle', issue.cycle ? cycleLabel(issue) : null, t))))
          .when(!!issue.labels?.nodes?.length, el => el.child(h_flex().gap(6).flex_wrap().children(issue.labels.nodes.map(label => div().px(8).py(3).rounded(6).border_1().border_color(t.border).text_size(11.5).text_color(t.muted).child(label.name)))))
          .child(div().h(1).flex_none().bg(t.border))
          .when(this.loading && !this.loaded, el => el.child(h_flex().gap(8).items_center().text_color(t.dim)
            .child(svg('mods/workspace-chrome/spinner.svg').size(13).spin(900)).child('Loading details…')))
          .when(!!this.loaded, el => el
            .child(markdown(`issue-description-${issue.id}`, issue.description || '_No description provided._'))
            .child(v_flex().gap(8).pt(10)
              .child(div().font_semibold().child('Sub-issues'))
              .children(sortIssues(issue.children?.nodes ?? []).map(child => h_flex().id(`sub-issue-${child.id}`).gap(10).px(8).py(9).items_start().rounded(6).cursor_pointer().hover(s => s.bg(t.hover))
                .on_click(() => this.openRelated(child))
                .child(svg('mods/workspace-chrome/chevron-right.svg').size(12).flex_none().text_color(t.dim))
                .child(div().text_color(t.dim).child(child.identifier))
                .child(div().flex_1().min_w(0).child(child.title))
                .child(div().max_w(110).truncate().text_size(11.5).text_color(t.muted).child(child.state?.name ?? ''))))
              .when(!issue.children?.nodes?.length, el => el.child(div().text_color(t.dim).child(this.loading && !issue.children ? 'Loading sub-issues…' : 'No sub-issues.')))
              .when(!!issue.children?.pageInfo.hasNextPage, el => el.child(this.button('issue-children-more', this.childLoading ? 'Loading…' : 'Load more', cx => this.moreChildren(cx), !this.childLoading && !this.loading && !!this.key))))
            .child(v_flex().gap(14).pt(10)
              .child(h_flex().items_center().gap(10).child(div().flex_1().font_semibold().child('Comments'))
                .when(!!this.hasEarlier, el => el.child(this.button('issue-comments-earlier', this.loading ? 'Loading…' : 'Load earlier', cx => this.load(cx, true), !this.loading))))
              .children(this.comments.map(comment => v_flex().gap(8).py(12).border_t(1).border_color(t.border)
                .child(h_flex().gap(10).items_center().text_size(11.5)
                  .child(div().flex_1().text_color(t.muted).child(comment.user?.displayName || comment.user?.name || 'Linear'))
                  .child(div().text_color(t.dim).child(new Date(comment.createdAt).toLocaleString())))
                .child(markdown(`issue-comment-${comment.id}`, comment.body))))
              .when(!this.comments.length, el => el.child(div().text_color(t.dim).child('No comments yet.')))))))
      .when(!!this.error, el => el.child(h_flex().px(22).py(10).gap(12).items_center().flex_none().text_color(t.blocked)
        .child(div().flex_1().child(this.error)).child(this.button('issue-details-retry', 'Retry', cx => this.load(cx), !this.loading && !this.starting))))
      .child(h_flex().h(60).px(22).gap(8).items_center().flex_none().border_t(1).border_color(t.border)
        .child(div().flex_1().text_color(t.muted).child(this.p.agent?.name ?? 'No agent selected'))
        .when(!!this.loaded && !inScope(issue, this.userId), el => el.child(div().text_size(11.5).text_color(t.dim).child('Outside your current cycle')))
        .child(this.button('issue-detail-start',
          svg(this.starting ? 'mods/workspace-chrome/spinner.svg' : 'mods/epsychic-issues/start.svg').size(15).when(!!this.starting, el => el.spin(900)),
          cx => this.start(cx), this.canStart(), true)
          .w(32).px(0).tooltip(this.starting ? 'Starting…' : 'Start task').accessibility_label('Start task')));
  }
}
