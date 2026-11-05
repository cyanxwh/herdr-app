# epsychic Herdr layout

Personal copy of Herdr 0.1.12's `main` layout.

- Layout: `~/.config/herdr-app/layouts/epsychic.json`
- Tab bar: `mods/epsychic-tabs` (cloned from `tabs`)
- Plus menu: `mods/epsychic-new-menu` (cloned from `new-menu`)
- Model submenu: `mods/epsychic-new-menu/agent-panel.js`
- Argument helpers: `mods/epsychic-new-menu/options.js`
- Legacy standalone dialog: `mods/epsychic-agent-launch` (not used by the + menu)

Use the top-right +, then click an agent name to launch immediately with
the CLI settings/template flags. Number shortcuts also launch immediately.
For Codex, Claude Code, or Antigravity, hover or click the right-hand arrow to open a
side submenu. Search/pick a model, select effort, then click 启动终端.
The submenu stays open while selecting. It has a gap from the parent menu;
near the right window edge it opens to the left. The direct-launch entry always uses CLI/template defaults.
Opening the submenu selects concrete CLI default model and effort values.
There is no Default row or effort chip. Closing and reopening the + menu
uses the latest cached CLI defaults rather than restoring a prior custom selection.
Other agent types retain their original launcher.

Codex reads the target machine's `${CODEX_HOME:-$HOME/.codex}/models_cache.json`
through `sh`. Only listed models are shown; each model supplies its effort
choices. The launcher template model and effort take priority over the root
values in the target machine's config.toml. When effort is not configured,
the selected model's catalog default is selected.
The cache is maintained by Codex; this mod does not refresh it online.
Claude reads the target CLI's SDK initialization catalog without sending a user
prompt. Alias entries are resolved to concrete version IDs and duplicate rows
are removed. The previous Opus 5, Sonnet 5 and Fable 5 releases are also pinned
as independent choices. Model names include versions; configured aliases resolve
to their version row for initial selection. Effort choices come from the model
metadata. Actual model access remains subject to the CLI/account.
Antigravity uses the target machine's `agy models` catalog. Effort variants are
grouped into one model row. The read-only `agy -p /model --output-format json`
command resolves the concrete default selection (no model inference request).
Launch parameters are `--model <base slug> --effort <tier>`; only tiers found
in that model's catalog variants are offered. Discovery errors disable the
configured launch; direct agent-name launch remains available.
There is no custom model ID input in the submenu.

Codex arguments: `--model <id> -c model_reasoning_effort="<level>"`.
Claude arguments: `--model <id> --effort <level>`.
Arguments are passed as an array. Existing unrelated template flags remain.
The captured space ID routes the new tab to its original local/remote space.

Check changes:

    herdr-app check ~/.config/herdr-app/mods/epsychic-new-menu
    herdr-app check ~/.config/herdr-app/mods/epsychic-tabs
    herdr-app status

Switch back to shipped Herdr: `herdr-app do layout.switch --name main`.
No shipped files are modified. Personal clones do not receive upstream code updates.

Model discovery cache is persisted in Herdr shared state under
`epsychic.model-cache.v1`. Entries are isolated by machine, launcher arguments
and working directory, with at most 32 contexts retained. Cached models and
defaults render synchronously and can be launched immediately. A successful
result is reused for 30 seconds; after that, reopening the menu refreshes in
the background. Refresh preserves a model/effort selection the user has changed.
If refresh fails, the last successful snapshot remains usable. Only model
metadata and effort defaults are cached, not full settings files or environment
variables. The first open of a context still waits for CLI discovery.
