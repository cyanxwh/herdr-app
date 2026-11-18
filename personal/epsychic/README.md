# epsychic

Personal Herdr layout: a model/effort submenu for starting coding agents and a
Linear Issues panel for reading current-cycle tasks and starting an agent on one.
Based on Herdr App 0.1.16. Existing official mods are referenced directly.

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

Keep personal changes on `epsychic`. Set `target_release` to the official release
tag you want to integrate:

```sh
git fetch upstream --tags
target_release=v0.1.16
git diff v0.1.16 "$target_release" -- defaults/layouts/main.json defaults/mods/tabs defaults/mods/new-menu
```

Once you have reviewed the changes, merge the release into the personal branch:

```sh
git switch epsychic
git merge "$target_release"
```

Copy applicable upstream fixes into the personal files, check each installed mod,
then verify the + submenu and Issues in the live window before committing and
deploying. The release baseline is `v0.1.16`
(`034f8b85f7e6bb71f8ff55cb4a80c548b2578c0f`); update this baseline after fully
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
