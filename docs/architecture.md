# Architecture

Claude Arcade has three small parts: hooks that note what Claude is doing, a localhost server that
relays it, and a browser shell that hosts the games. They only communicate through one JSON file and
HTTP on `127.0.0.1`.

```
Claude Code ──hook event──▶ hooks/status.js ──atomic write──▶ ${CLAUDE_PLUGIN_DATA}/status.json
                                                                        │ fs.watch (+1 s polling fallback, 50 ms debounce)
                                                                        ▼
browser tab (web/shell.js) ◀──SSE /events (15 s heartbeat)── server/server.js (127.0.0.1:4417+)
        │  mounts one game at a time via web/sdk.js ctx
        ▼
   games/<id>/index.js

/arcade:play ─▶ server/cli.js open ─▶ reuse or start server (server.lock) ─▶ open browser
```

## Flow

1. **Hooks.** `hooks/hooks.json` runs `node hooks/status.js <state>` on `UserPromptSubmit` (`working`),
   `PermissionRequest` and `Notification` (`needs-you`), `Stop` (`done`) and `SessionEnd` (`end`). The
   hook reads `session_id` and `cwd` from stdin, updates `status.json` atomically (temp file and
   rename), always exits 0, and prints nothing. Errors go to `arcade.log`. It stores the project folder
   name only, never prompts or tool inputs. Sessions idle for 24 hours are pruned.
2. **Server.** A Node built-ins-only HTTP server binds `127.0.0.1` (port `4417`, then the next 9) and
   writes its port, PID, start time and shutdown token to `server.lock`. It serves the shell and games,
   a JSON API, and a Server-Sent Events stream that sends the full status on connect and on every change.
   It shuts itself down after 30 minutes with no clients and no changes.
3. **Shell.** The page subscribes to `/events`, shows the status badge, reacts to the mode (pause the
   game and show a banner on `needs-you` or `done`), and hosts games.
4. **Games** receive a `ctx` from `web/sdk.js` and never touch the shell directly.

## Status shape

```json
{
  "version": 1,
  "updatedAt": "2026-10-23T09:00:00.000Z",
  "sessions": {
    "<session_id>": {
      "state": "working",
      "project": "my-repo",
      "since": "2026-10-23T08:59:40.000Z"
    }
  }
}
```

## Settings precedence

For each setting, the first match wins:

1. `settings.json` in the data directory (written by the page's Settings panel)
2. `CLAUDE_PLUGIN_OPTION_<KEY>` environment variable
3. `plugin-options.json` in the data directory (the `/plugin` options, persisted by every hook run, so
   a `/plugin` change reaches the server after your next prompt)
4. Built-in default

Per-browser preferences (sound, notifications, theme, motion, contrast, palette) live in `localStorage`.

## Auto-open (`auto` mode)

On `working`, the hook spawns a detached `node server/cli.js auto-open <session> <delay>`. After the
delay it opens the browser only if the session is still working, no page is connected, and that session
was not already auto-opened.

## Security

Loopback-only binding, Host and Origin checks, path confinement to `web/` and `games/`, a strict
Content-Security-Policy and a shutdown token. See [SECURITY.md](../SECURITY.md).

## Modules

| Path                                  | Responsibility                                                                 |
| ------------------------------------- | ------------------------------------------------------------------------------ |
| `.claude-plugin/plugin.json`          | Plugin name, version and the `mode`, `port`, `autoOpenDelay` options           |
| `.claude-plugin/marketplace.json`     | The `claude-arcade` marketplace with one plugin, `arcade`                      |
| `skills/{play,stop,games}`            | The three slash commands; each runs one `server/cli.js` command                |
| `hooks/hooks.json`                    | Maps Claude Code events to `status.js` states                                  |
| `hooks/status.js`                     | Writes session state; never fails Claude's turn                                |
| `server/cli.js`                       | `start`, `stop`, `status`, `games`, `open [game-id]`, plus the auto-open timer |
| `server/main.js`                      | Process bootstrap for the detached server                                      |
| `server/server.js`                    | HTTP routes, SSE, security checks, status watching                             |
| `server/http-util.js`                 | Host and Origin checks, security headers, helpers                              |
| `server/lifecycle.js`                 | `server.lock`, single instance, liveness, idle shutdown                        |
| `server/status-store.js`              | Read and write `status.json`, pruning (shared with the hook)                   |
| `server/settings.js`                  | Effective-settings resolution and validation                                   |
| `server/paths.js`                     | Resolves the data directory                                                    |
| `server/registry.js`                  | Discovers and validates `games/*/game.json`                                    |
| `server/open-browser.js`              | Per-OS browser launch                                                          |
| `server/auto-open.js`                 | The delayed auto-open decision                                                 |
| `web/index.html`, `styles.css`        | The page (no inline script or style) and theme tokens                          |
| `web/shell.js`                        | Wires menu, host, badge, banner and settings together                          |
| `web/menu.js`                         | Game cards from `/api/games`                                                   |
| `web/game-host.js`                    | Mounts one game, wraps lifecycle calls, isolates crashes                       |
| `web/sdk.js`                          | Builds the `ctx` handed to a game                                              |
| `web/input.js`                        | Normalises keyboard and touch into actions                                     |
| `web/prefs.js`                        | Per-browser preferences                                                        |
| `web/modes.js`, `status-summary.js`   | Pure logic for mode reactions and the most urgent status                       |
| `web/banner.js`, `announcer.js`       | Banner and `aria-live` announcements                                           |
| `web/settings-panel.js`               | The Settings panel                                                             |
| `web/sound.js`, `scores.js`, `api.js` | Sound playback, high scores, and server calls                                  |
| `games/<id>/`                         | Self-contained games (`game.json`, `index.js`, `logic.js`, README)             |
| `templates/game/`                     | The copy-me starter                                                            |
| `schemas/game.schema.json`            | Manifest schema                                                                |
| `test/{unit,contract,e2e}`            | `node:test` unit and contract tests; Playwright end-to-end tests               |
| `scripts/`                            | DCO check, release check, test runner                                          |

Pure logic is kept out of DOM code (`web/modes.js`, `games/*/logic.js`, ...) so it can be unit-tested
in Node.

## Design decisions

- **No dependencies, no build step.** Plain ES modules, so installing the plugin never runs
  `npm install`, and no lockfile is committed.
- **Everything is `node <file>`.** No shell scripts, so Windows works the same as macOS and Linux.
- **A file, not a socket, between hooks and server.** Hooks must be fast and independent of the server;
  the server may not even be running.
- **Games are same-page modules in v0.1.** Sandboxed iframe games are on the roadmap.
