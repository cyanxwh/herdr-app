# epsychic

Personal Herdr layout: a model/effort submenu for starting coding agents and a
Linear Issues panel for reading current-cycle tasks and starting an agent on one.
Based on Herdr App 0.1.12. Existing official mods are referenced directly.

## Install

Use the official Herdr App; building this fork is not required. From this folder:

```sh
python3 install.py                       # preview the files to install
python3 install.py --apply --activate    # back up changes, install, check, switch
```

Requires Python 3 and `herdr-app` on PATH. `--home` overrides `HERDR_APP_HOME`
or the default `~/.config/herdr-app`. Activation requires a running window for
that home. The installer updates only this layout and its four mod folders;
it never installs credentials, caches, global settings, keys, or saved UI state.
Changed existing files are backed up under `~/.local/state/herdr-app-backups/`.
The installed mods reload live. Select another layout to stop using this one.

Linear requires a personal API key entered in the Issues panel. It is stored in
macOS Keychain under service `dev.epsychic.herdr.linear`, account `linear`.
The panel reads Linear, and starting a task launches the selected CLI agent on
the selected space's machine. Agent access to Linear is configured separately.
See `mods/epsychic-issues/README.md` and `mods/epsychic-agent-launch/README.md`
for behavior and limitations. The latter includes the legacy standalone dialog;
the active + menu uses `epsychic-new-menu/agent-panel.js`.

## Update from upstream

Keep `master` as an unmodified upstream mirror and personal changes on `epsychic`:

```sh
git fetch upstream
git switch master
git merge --ff-only upstream/master
git push origin master
git switch epsychic
git rebase master
```

Rebasing updates the official app sources. It does **not** automatically merge
changes from official mods into these renamed copies. Review those separately:

```sh
git diff v0.1.12 upstream/master -- defaults/layouts/main.json defaults/mods/tabs defaults/mods/new-menu
```

Copy applicable upstream fixes into the personal files, check each installed mod,
then verify the + submenu and Issues in the live window before committing and
deploying. The release baseline is `v0.1.12`
(`4aa3460749947e7771aa39a8a2cec58d46649926`); update this baseline after fully
integrating a later release. Unmodified official mods update with the app.

| Official source | Personal copy | Customization |
| --- | --- | --- |
| `defaults/layouts/main.json` | `layouts/epsychic.json` | Issues panel, personal Tabs reference and preview |
| `defaults/mods/tabs/` | `mods/epsychic-tabs/` | Issues button and personal + menu |
| `defaults/mods/new-menu/` | `mods/epsychic-new-menu/` | Model/effort agent submenu |
| None | `mods/epsychic-issues/` | Linear list, details and task startup |
| None | `mods/epsychic-agent-launch/` | Legacy standalone agent configuration dialog |

The rename from the former company-prefixed layout was migrated locally,
including shared preferences, panel state and the Keychain credential. Those
private runtime files are intentionally absent from this repository.
