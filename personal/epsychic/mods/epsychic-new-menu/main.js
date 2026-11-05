import AgentPanel from "./agent-panel.js";
import { View, div, svg, image } from "gpui-kit";
import { h_flex, v_flex, Popup } from "gpui-base";
import { theme, spaces, panes, knownAgents, run, openOverlay, closeOverlay, props, window, keys, shared, setShared, nextCommand } from "herdr";

// The last agents each machine reported, shown at once while knownAgents() checks again.
const KNOWN = "new-menu.agents";

function shortcut(name) {
  const k = keys().find(b => b.section === "global" && b.action === name);
  if (!k?.keys.trim()) return "";
  const mac = window()?.platform === "macos";
  const names = mac ? { ctrl: "⌃", alt: "⌥", shift: "⇧", cmd: "⌘", fn: "fn" } : { ctrl: "Ctrl", alt: "Alt", shift: "Shift", cmd: "Super", fn: "Fn" };
  const alias = { secondary: mac ? "cmd" : "ctrl", super: "cmd", win: "cmd" };
  return k.keys.trim().split(/\s+/).map(stroke => {
    const parts = stroke.split("-");
    let key = parts.pop();
    if (key === "") { key = "-"; parts.pop(); }
    const held = new Set(parts.map(m => alias[m.toLowerCase()] ?? m.toLowerCase()));
    if (/^[A-Z]$/.test(key)) held.add("shift");
    const label = key.length === 1 ? key.toUpperCase() : key[0].toUpperCase() + key.slice(1).toLowerCase();
    return [...Object.keys(names).filter(m => held.has(m)).map(m => names[m]), label].join(mac ? "" : "+");
  }).join(" ");
}

export default class NewMenu extends View {
  init(_props, cx) {
    this.panels = {};
    this.openAgent = null;
    this.submenuSide = 'right';
    this.space = spaces().find(s => s.active);
    const machine = this.space?.machine;
    const where = machine ?? "";
    this.agents = shared(KNOWN)?.[where] ?? [];
    this.handle = cx.focus_handle();
    this.handle.focus();
    cx.spawn(async cx => {
      for (;;) {
        const command = await nextCommand();
        const agent = this.agents.find(a => a.key === command && a.installed);
        if (agent && /codex|claude|antigravity/i.test(agent.key)) { this.configure(agent, cx); cx.notify(); }
      }
    });
    cx.spawn(async cx => {
      try {
        this.agents = await knownAgents({ on: machine });
        setShared(KNOWN, { ...shared(KNOWN), [where]: this.agents });
      }
      catch { this.failed = true; }
      cx.notify();
    });
  }
  launch(agent) {
    run("tab.new", { name: agent.name, space: this.space?.id, argv: agent.run });
  }
  configure(agent, cx) {
    if (!this.panels[agent.key]) {
      const space = this.space;
      this.panels[agent.key] = cx.new(AgentPanel, {
        agent, space: space?.id, spaceName: space?.name, machine: space?.machine, folder: panes().find(p => p.focused)?.cwd, overlay: props().overlay
      });
    }
    this.openAgent = agent.key;
  }
  agentRow(agent, index) {
    const t = theme();
    const row = this.row(agent.key,
      agent.tint ? svg(agent.icon).size(14).text_color(t.foreground) : image(agent.icon).size(14),
      agent.name, () => this.launch(agent),
      agent.installed ? (index < 9 ? String(index + 1) : "") : "not installed", agent.installed);
    if (!agent.installed || !/codex|claude|antigravity/i.test(agent.key)) return row;
    const arrow = div().id(`configure-${agent.key}`).h(27).w(28).flex_none().flex().items_center().justify_center()
      .rounded(7).text_color(t.dim)
      .hover(s => s.bg(t.selected).text_color(t.foreground))
      .on_mouse_move((e, cx) => {
        const right = (e.bounds?.x ?? e.position.x) + (e.bounds?.width ?? 28);
        const side = right + 428 > globalThis.window.viewport_size().width ? 'left' : 'right';
        if (side !== this.submenuSide) { this.submenuSide = side; cx.notify(); }
      })
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_hover((hovered, cx) => { if (hovered && this.openAgent !== agent.key) { this.configure(agent, cx); cx.notify(); } })
      .on_click((_e, cx) => { cx.stop_propagation(); this.configure(agent, cx); cx.notify(); }).child(svg("mods/workspace-chrome/chevron-right.svg").size(12));
    const popup = Popup.new(`submenu-${agent.key}`, div().w(1).h(31))
      .anchor(this.submenuSide === 'left' ? "top_right" : "top_left")
      .when(this.openAgent === agent.key, el => el.content(div().when(this.submenuSide === 'left', el => el.pr(12)).when(this.submenuSide !== 'left', el => el.pl(12)).child(this.panels[agent.key])));
    return h_flex().h(31).gap(2).flex_none().items_center()
      .when(this.submenuSide === 'left', el => el.child(popup))
      .child(row.flex_1().min_w(0)).child(arrow)
      .when(this.submenuSide !== 'left', el => el.child(popup));
  }

  row(id, icon, name, action, hint = "", enabled = true) {
    const t = theme();
    return h_flex().id(id).h(31).px(9).gap(10).rounded(7).items_center().flex_none()
      .text_color(enabled ? t.foreground : t.dim).when(enabled, el => el.hover(s => s.bg(t.selected)))
      .on_click(() => { if (enabled) { closeOverlay(props().overlay); action(); } })
      .child(icon).child(div().flex_1().child(name)).child(div().text_size(11).text_color(t.dim).child(hint));
  }
  render() {
    const t = theme();
    const space = this.space;
    const installed = this.agents.filter(a => a.installed);
    const choices = [...installed, ...this.agents.filter(a => !a.installed).slice(0, 2)];
    return v_flex().min_h(0).w_full().h(Math.min(491, 167 + Math.max(1, choices.length) * 31)).bg(t.popover).p(5).text_size(12.8)
      .id("new-menu").track_focus(this.handle)
      .on_key_down((e, cx) => {
        if (this.openAgent) return;
        if (e.modifiers.control || e.modifiers.platform || e.modifiers.alt) return;
        const agent = /^[1-9]$/.test(e.key) ? installed[Number(e.key) - 1] : null;
        if (!agent) return;
        closeOverlay(props().overlay);
        this.launch(agent);
      })
      .child(this.row("terminal", svg("icons/shell.svg").size(14), "Terminal", () => run("tab.new", { space: space?.id }), shortcut("tab.new")))
      .child(div().px(9).pt(8).pb(4).text_size(11).text_color(t.dim).child("Start an agent"))
      .child(v_flex().flex_1().min_h(0).overflow_y_scrollbar()
        .children(choices.map((a, i) => this.agentRow(a, i)))
        .when(this.agents.length === 0, el => el.child(div().px(9).py(6).text_color(t.dim).child(this.failed ? "Could not load agents" : "Checking installed agents…"))))
      .child(div().h(1).mx(4).my(5).bg(t.border))
      .child(this.row("space", div().w(14).child("+"), "New space", () => run("space.new"), shortcut("space.new")))
      .child(this.row("worktree", svg("mods/workspace-chrome/branch.svg").size(14), "New worktree…", () => openOverlay({ mod: "worktree", kind: "dialog", width: 460, height: 280, props: { space: space?.id, folder: panes().find(p => p.focused)?.cwd, action: "new" } }), "", Boolean(space)))
      .child(this.row("worktree-open", svg("mods/workspace-chrome/branch.svg").size(14), "Open worktree\u2026", () => openOverlay({ mod: "worktree", kind: "dialog", width: 560, height: 480, props: { space: space?.id, folder: panes().find(p => p.focused)?.cwd, action: "open" } }), "", Boolean(space)));
  }
}
