# Linear issues panel

Personal native Herdr panel for the `epsychic` layout. Open it from **Issues** beside Files and Changes.

## Connect

Create a personal API key in Linear's Security & access / API settings with read access to the relevant teams. In the panel, click **Open Linear settings**, paste the key into the masked input, and click **Connect**. This is a separate connection from ChatGPT's Linear connector. The key is stored only in macOS Keychain under service `dev.epsychic.herdr.linear`, account `linear`; it is never put into shared mod state, remote machine commands, or agent tasks. **Disconnect** removes this credential and the issue cache. This implementation's credential store requires the Mac displaying Herdr; remote spaces may be Windows or Unix.

## List and launch

- Queries Linear GraphQL with `assignee.isMe = true` and `cycle.isActive = true`, across accessible teams, excluding archived issues. Completed/canceled issues remain visible if they satisfy these filters.
- Reads all pages; never presents a silently truncated list. Sorts active work first, then priority and issue identifier. Search matches identifier, title, and project.
- Groups tasks in an expandable tree using Linear's parent relationship, including nested sub-issues. Ancestors outside the current-cycle/self filter appear only as `Parent issue` context, without Start and without increasing the task count. Search retains the matching tasks' ancestor paths and expands them. Hierarchy uses indentation and native chevrons, with no vertical card borders.
- Saves a snapshot under `epsychic.linear.cache.v1`. Restores only after checking the connected user and workspace identity, displays the snapshot during refresh, and refreshes every 60 seconds while this sidebar is selected. Manual Refresh is also available. Cached issues expire at their cycle's end even if refresh fails.
- The compact title bar contains only Search and More. More contains the fixed current-cycle/self filters, default-agent choices, manual Refresh, and Linear connection settings. The username is omitted. Search opens a second row only on demand; clicking Search again or pressing Escape clears and closes it. The menu floats over the list and dismisses on outside press or Escape.
- Select an installed agent from More. The preference is remembered per machine. Codex is the initial choice when available, otherwise the first installed agent. All agents use their normal launch arguments and CLI defaults.
- Click an issue row to open a centered native dialog, styled like Herdr Settings. It shows live metadata, labels, a selectable Markdown description, and comments. Older comments load on demand. Esc or the close button returns to the list. The dialog's **Start** uses the agent and project space captured when the dialog opened and revalidates the issue before starting.
- The dialog's `Sub-issues` section shows all accessible unarchived direct children, with status and pagination. Click a child or the parent link to navigate in the centered dialog; Back returns to the previous issue. Related issues remain readable even when outside the list's filter; Start remains restricted to your current-cycle tasks. Loaded child pages are included in the detail cache.
- Details persist under `epsychic.linear.details.v1`, isolated by workspace, user, and issue (up to 32 entries). Reopening restores the description and loaded comment pages immediately. For 60 seconds, unchanged details skip network discovery; stale entries and issues with a newer `updatedAt` refresh in the background. Failed refreshes retain the last successful content. Loading older comments preserves their cursor without extending the freshness of the latest page. The header Refresh button forces an update. Disconnecting, reconnecting, or an authentication failure clears detail caches. Credentials are never cached.
- **Start** captures the current space and its focused terminal's directory, re-reads the issue, verifies that its assignee and cycle still match, and creates a tab named after the issue identifier. The first message is only `Work on Linear issue <identifier>.` followed by `Read the issue and relevant context from Linear before starting.` The agent reads its own Linear context and chooses its branch name. It needs Linear access in its own local/remote environment. An existing issue tab in that space is selected instead of creating a duplicate.
- Launch is unavailable without an installed agent and a project directory. Requests use the local Mac's Linear connection; tasks run on the selected space's machine. This panel makes no Linear mutations.

## Files / checks

`main.js`: native UI, refresh lifecycle, agent selection and task launch.
`api.js`: GraphQL queries, pagination, scope validation and task text.
`auth.js`: local Keychain storage.
`detail.js`: centered issue details dialog.
`task.js`: shared destination capture and task startup for list and dialog.

Run `herdr-app check ~/.config/herdr-app/mods/epsychic-issues` and check the live window with `herdr-app shot`. The mod commands `epsychic-issues.refresh`, `epsychic-issues.settings`, and `epsychic-issues.details` (open the first listed issue) are read-only UI helpers.

API references: https://linear.app/developers/graphql and https://linear.app/developers/filtering. Query shape verified against the official Linear SDK schema.
