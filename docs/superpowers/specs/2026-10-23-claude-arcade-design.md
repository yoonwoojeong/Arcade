# Claude Arcade — Design Spec

- **Date:** 2026-10-23
- **Status:** Approved
- **License:** Apache-2.0

## 1. Purpose

Claude Arcade is an open-source Claude Code plugin that lets developers play
lightweight mini-games in a browser tab while Claude Code works, and pulls them
back the moment Claude finishes or needs input.

It is a community project for public distribution. Priorities, in order:

1. Easy installation (one marketplace add + one install; no `npm install` for users)
2. Cross-platform (macOS, Linux, Windows incl. native PowerShell, WSL)
3. Contributors can add a game independently by touching one folder
4. Accessibility as a release requirement
5. A simple, usable first release over breadth

### Success criteria for v0.1

- A user installs with two commands and has a game running within seconds of `/arcade:play`.
- When Claude finishes or needs permission, the game pauses and the user is told — in `alert` mode — without having to watch the terminal.
- A contributor can copy `templates/game/`, implement it, run `npm test`, and open a PR without touching any file outside their game folder.
- CI is green on Ubuntu, macOS and Windows.

### Non-goals

Multiplayer, accounts, online leaderboards, any network calls, telemetry,
monetization, in-terminal play (deferred to roadmap).

## 2. Key decisions

| Decision | Choice | Why |
|---|---|---|
| Play surface | Browser tab served from localhost | Claude Code's TUI is busy during a turn; browser is uniform across OSes, best for accessibility, easiest for contributors |
| Runtime | Node.js ≥ 20, zero runtime npm dependencies | Most common runtime among Claude Code users; same language as games; no install step. Node is not guaranteed by Claude Code's native installer, so its absence is detected with a clear message |
| Game model | Folder per game with a small JS contract (`createGame(ctx)`) | Lowest contributor barrier, consistent UX/accessibility via shared SDK; no build step |
| Entry point | Skills (`/arcade:play`, `/arcade:stop`, `/arcade:games`) | Current plugin convention (`commands/` is legacy) |
| Claude → page signal | Hooks write a status file; server watches it and pushes via SSE | Hooks never need to discover a port and work whether or not the server is running |
| Behavior on Claude activity | User-selectable `mode`: `alert` (default), `auto`, `quiet` | Different users want different levels of intrusion |

## 3. Repository layout

One repository is both the marketplace and the plugin.

```
arcade/
├─ .claude-plugin/
│  ├─ plugin.json            # name "arcade", version, userConfig
│  └─ marketplace.json       # one plugin entry, source "./"
├─ skills/
│  ├─ play/SKILL.md          # /arcade:play [game-id]
│  ├─ stop/SKILL.md          # /arcade:stop
│  └─ games/SKILL.md         # /arcade:games
├─ hooks/
│  ├─ hooks.json
│  └─ status.js
├─ server/
│  ├─ cli.js                 # start | stop | status | open [game-id]
│  ├─ server.js              # HTTP: static, /events (SSE), /api/games, /api/settings
│  ├─ lifecycle.js           # server.lock, single instance, idle shutdown
│  ├─ status-store.js        # read/write status.json (shared with hooks)
│  ├─ settings.js            # effective-settings resolution
│  ├─ open-browser.js        # per-OS browser launch
│  └─ registry.js            # discover and validate games/
├─ web/
│  ├─ index.html
│  ├─ shell.js               # menu, game host, status badge, banner, settings panel
│  ├─ sdk.js                 # builds ctx for a game
│  └─ styles.css
├─ games/
│  ├─ snake/
│  ├─ 2048/
│  └─ minesweeper/
├─ templates/game/           # copy-me starter for contributors
├─ schemas/game.schema.json
├─ test/
├─ docs/
│  ├─ architecture.md
│  └─ game-authoring.md
├─ .github/                  # workflows, issue forms, PR template, CODEOWNERS
├─ package.json              # devDependencies only (eslint, prettier, playwright, axe-core)
├─ README.md  CONTRIBUTING.md  CODE_OF_CONDUCT.md  SECURITY.md  CHANGELOG.md  LICENSE
```

`package.json` exists for development tooling only and lists only
`devDependencies`, pinned to exact versions. **No lockfile is committed**
(`package-lock.json` is in `.gitignore`): Claude Code runs a dependency install
for plugins that ship `package.json` together with a lockfile, and users must
never get an install step. The implementation plan includes a check that
installing the plugin via `claude --plugin-dir` triggers no install.

## 4. Components

### 4.1 Plugin manifest (`.claude-plugin/plugin.json`)

Fields: `name: "arcade"`, `displayName: "Claude Arcade"`, `version`,
`description`, `author`, `homepage`, `repository`, `license: "Apache-2.0"`,
`keywords`, and `userConfig`:

| Key | Type | Default | Notes |
|---|---|---|---|
| `mode` | string, options `alert` / `auto` / `quiet` | `alert` | See §5.3 |
| `port` | number, 1024–65535 | `4417` | Preferred port; falls back (§4.4) |
| `autoOpenDelay` | number, 5–600 (seconds) | `20` | Used only in `auto` mode |

Hooks read these via `CLAUDE_PLUGIN_OPTION_MODE`, `_PORT`, `_AUTOOPENDELAY`.

### 4.2 Skills

All three skills set `disable-model-invocation: true` so Claude never launches
or stops the arcade on its own, and `allowed-tools` restricted to the single
`node` command they run. Each skill instructs Claude to run one command and
relay its output verbatim:

| Skill | Command |
|---|---|
| `/arcade:play [game-id]` | `node "${CLAUDE_PLUGIN_ROOT}/server/cli.js" open [game-id]` |
| `/arcade:stop` | `node "${CLAUDE_PLUGIN_ROOT}/server/cli.js" stop` |
| `/arcade:games` | `node "${CLAUDE_PLUGIN_ROOT}/server/cli.js" games` |

If the command fails because `node` is not found or is older than 20, the skill
text tells Claude to print: what is missing, the link https://nodejs.org, and
that nothing else is required. `cli.js` itself checks `process.versions.node`
and exits with a clear message if too old.

`cli.js open`: start the server if not running (detached, `windowsHide: true`,
stdio to `arcade.log`), wait until healthy (≤ 3 s), open the browser to
`http://127.0.0.1:<port>/[#game-id]`, print the URL. If the browser can't be
opened, print the URL and say to open it manually.

**Usage note (documented in README):** a slash command typed while Claude is
mid-turn is queued, so the intended flow is to open Arcade once per session
and leave the tab open; it follows every subsequent turn. `auto` mode covers
the forgot-to-open case.

### 4.3 Hooks

`hooks/hooks.json` registers `node "${CLAUDE_PLUGIN_ROOT}/hooks/status.js" <state>`:

| Event | Argument | Effect |
|---|---|---|
| `UserPromptSubmit` | `working` | Session → `working`; in `auto` mode, may spawn the auto-open timer |
| `PermissionRequest` | `needs-you` | Session → `needs-you` |
| `Notification` (matcher `permission_prompt\|elicitation_dialog`) | `needs-you` | Session → `needs-you` |
| `PostToolUse` (`async: true`) | `resume` | Session → `working` only if it is currently `needs-you` (the prompt was answered); otherwise no change. Never creates a session or spawns the auto-open timer |
| `Stop` | `done` | Session → `done` |
| `SessionEnd` | `end` | Session removed |

`status.js` contract:

- Reads hook JSON from stdin; uses `session_id` and `cwd`. Malformed or missing stdin is tolerated (session id falls back to `"unknown"`).
- Updates `${CLAUDE_PLUGIN_DATA}/status.json` atomically (write temp file in the same dir, then `rename`). Creates the directory if missing.
- **Always exits 0, prints nothing to stdout**, completes in < 100 ms. Errors are appended to `${CLAUDE_PLUGIN_DATA}/arcade.log`. It must never affect Claude's turn.
- Sessions not updated for 24 h are pruned on each write.

`status.json` shape:

```json
{
  "version": 1,
  "updatedAt": "2026-10-23T09:00:00.000Z",
  "sessions": {
    "<session_id>": { "state": "working", "project": "my-repo", "since": "2026-10-23T08:59:40.000Z" }
  }
}
```

`project` is `path.basename(cwd)`. Prompt text and tool inputs are never stored.

**Auto-open timer (`auto` mode only):** on `working`, `status.js` spawns a
detached `node server/cli.js auto-open <session_id> <delay>` (`windowsHide:
true`, `detached`, `unref`) and exits immediately. That process sleeps
`autoOpenDelay` seconds, then opens the browser only if all hold: the session is
still `working`; no page is connected to the server; this session has not
already been auto-opened (recorded in `status.json` as `autoOpened: true`).
It starts the server if needed.

### 4.4 Server

- Node built-ins only (`http`, `fs`, `path`, `url`, `child_process`, `os`).
- Binds `127.0.0.1` only. Tries `port`, then `port+1` … `port+9`; the bound port, PID and start time are written to `${CLAUDE_PLUGIN_DATA}/server.lock`.
- **Single instance:** `cli.js` reads the lock; if the PID is alive (`process.kill(pid, 0)`) and `GET /health` answers, reuse it; otherwise remove the stale lock and start fresh.
- **Routes:**
  - `GET /` and `GET /web/*` — shell files.
  - `GET /games/<id>/*` — game files.
  - `GET /api/games` — validated registry (id, title, description, controls, accessibility, sessionLength).
  - `GET /events` — SSE stream; sends the full status on connect and on every change, plus a heartbeat every 15 s.
  - `GET /api/settings`, `POST /api/settings` — read/update `mode` and `autoOpenDelay` (JSON, validated).
  - `GET /health`.
- **Security:** reject requests whose `Host` is not `127.0.0.1:<port>` or `localhost:<port>` (DNS-rebinding defense); reject `POST` whose `Origin` doesn't match; resolve file paths and reject anything outside `web/` or `games/`; headers `Content-Security-Policy: default-src 'self'; img-src 'self' data:; media-src 'self' data:; frame-ancestors 'none'; base-uri 'none'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`.
- **Status watch:** `fs.watch` on the data dir, with a 1 s polling fallback; changes debounced 50 ms then broadcast.
- **Idle shutdown:** exits after 30 min with no SSE clients and no `status.json` change; removes the lock.
- `cli.js stop` sends `POST /api/shutdown` (same-origin check, token from `server.lock`), falling back to `process.kill(pid)`.

### 4.5 Settings resolution (`server/settings.js`)

Effective value for each key, first match wins:

1. `${CLAUDE_PLUGIN_DATA}/settings.json` (written by the page's settings panel)
2. `CLAUDE_PLUGIN_OPTION_<KEY>` environment variable (from `userConfig`)
3. `${CLAUDE_PLUGIN_DATA}/plugin-options.json` (the valid `CLAUDE_PLUGIN_OPTION_*` values, persisted by every hook run)
4. Built-in default

Layer 3 exists because `${user_config.*}` is not substituted in skill content and the
skill-started server does not receive `CLAUDE_PLUGIN_OPTION_*`; only hooks do, so hooks
persist them for the server.
Hooks and the server both use this module, so the page and the hook agree.
Per-browser preferences (sound, notifications, theme, motion, high contrast,
colorblind palette, key remapping) live in `localStorage` only.

### 4.6 Web shell (`web/`)

- Vanilla ES2020 modules, no build, no external resources.
- **Menu:** game cards from `/api/games`, each showing title, description, controls, session length, and screen-reader support level.
- **Status badge:** always visible; shows the most urgent state across sessions (`needs-you` > `done` > `working` > idle), e.g. "Claude is working…", "my-repo needs you", "2 sessions finished". Shows "offline" if SSE is disconnected; reconnects automatically.
- **Banner:** see §5.3.
- **Settings panel:** mode, auto-open delay, sound, browser notifications (requested only when the user enables them), theme, reduced motion, high contrast, colorblind palette, show project name.
- **Game host:** mounts one game at a time; wraps every lifecycle call in try/catch. On error: destroy, show "This game crashed — back to menu", log to console. `Esc` always pauses and returns focus to the shell.

## 5. Behavior

### 5.1 Game contract (SDK v1)

Each game is `games/<id>/` containing `game.json`, `index.js`, `README.md`,
and optionally `logic.js`, `assets/`.

`game.json` (validated against `schemas/game.schema.json`):

```json
{
  "id": "snake",
  "title": "Snake",
  "version": "1.0.0",
  "sdk": 1,
  "author": "github-handle",
  "description": "Eat, grow, don't bite yourself.",
  "controls": { "keyboard": ["Arrows/WASD: move", "Space: pause"], "touch": "swipe" },
  "accessibility": { "screenReader": "none", "reducedMotion": true, "colorIndependent": true },
  "sessionLength": "short"
}
```

- `id` must equal the folder name, `^[a-z0-9][a-z0-9-]{1,30}$`.
- `screenReader`: `full` | `partial` | `none`. `sessionLength`: `short` (< 2 min) | `medium` | `untimed`.

`index.js`:

```js
export default function createGame(ctx) {
  return { start() {}, pause() {}, resume() {}, destroy() {} };
}
```

`ctx` (SDK v1):

| Member | Description |
|---|---|
| `root` | Container element owned by the game |
| `input.on(action, fn)` / `input.off` | Normalized actions: `up`, `down`, `left`, `right`, `primary`, `secondary`, `pause`. Keyboard defaults: arrows/WASD, Enter/Space, Shift/X, P. Touch: swipe + tap |
| `storage.get(key)` / `storage.set(key, value)` | JSON values, namespaced `arcade:<id>:` in `localStorage` |
| `prefs` + `prefs.onChange(fn)` | `{ reducedMotion, highContrast, sound, colorblindPalette }` |
| `announce(text, { assertive })` | Writes to the shell's aria-live region |
| `sound.play(name)` | Plays `assets/<name>.(ogg|mp3)`; no-op when sound is off |
| `reportScore(n)` | Shell tracks and displays the high score |
| `sdkVersion` | `1` |

Rules (enforced by contract tests where possible):

- No network: no `http(s)://` URLs, `fetch`, `XMLHttpRequest`, `WebSocket`, or dynamic `import()` of remote code.
- Folder size ≤ 200 KB.
- Input only via `ctx.input` (enables remapping and touch for every game).
- Pausing is controlled by the shell; `pause()` must stop the game loop and timers.
- `destroy()` releases all timers, listeners and animation frames.
- Game rules belong in a DOM-free `logic.js` where practical, so they are unit-testable in Node.

**Versioning:** backward-compatible additions keep `sdk: 1`. A breaking change introduces `sdk: 2`; the shell supports both for at least one minor release, and contract tests run against each declared version.

### 5.2 MVP games

| Game | Pattern it demonstrates | Screen reader target |
|---|---|---|
| Snake | Canvas, real-time loop, `reducedMotion` slows speed, not animation removal | `none` (declared honestly) |
| 2048 | DOM grid, turn-based, announces merges and score | `full` |
| Minesweeper | DOM grid, keyboard cursor, flagging, first click is always safe, announces cell contents | `full` |

### 5.3 Modes

| Event | `alert` (default) | `auto` | `quiet` |
|---|---|---|---|
| Arcade opens | Only via `/arcade:play` | Also automatically after `autoOpenDelay` s of `working` (once per session, only if no tab is connected) | Only via `/arcade:play` |
| Claude `working` | Badge | Badge | Badge |
| `needs-you` / `done` | Pause game, show banner, optional chime + browser notification | Same as `alert` | Badge only |

Banner: "Claude needs you in **my-repo**" or "Claude finished in **my-repo**",
announced via assertive aria-live, focusable "Resume game" and "Dismiss"
buttons. The banner clears when that session goes back to `working`.

## 6. Accessibility

- Shell targets WCAG 2.2 AA: full keyboard operation, visible focus, logical order, labelled controls, `aria-live` for status.
- Honors `prefers-reduced-motion` and `prefers-color-scheme`; user can override both. High-contrast theme and colorblind-safe palette; no information by color alone.
- Sound off by default. No content flashes more than 3 times per second.
- Each game declares its screen-reader support level and the menu displays it.
- PR template includes an accessibility checklist; E2E runs axe-core on the shell and menu.

## 7. Cross-platform

- Every hook and script is invoked as `node <file>`; no bash or PowerShell logic, so hooks behave identically under Git Bash and PowerShell on Windows.
- `path.join` everywhere; no symlinks; quoted `${CLAUDE_PLUGIN_ROOT}` paths (spaces in Windows usernames).
- Browser open: macOS `open`, Windows `cmd /c start "" <url>`, Linux `xdg-open`, WSL `wslview` then `cmd.exe /c start`. On failure, print the URL.
- Supported browsers: latest two versions of Chrome, Edge, Firefox, Safari.

## 8. Error handling

| Situation | Behavior |
|---|---|
| Node missing / < 20 | Skill prints what's missing and the install link |
| Port range busy | `cli.js` reports the range tried and how to change `port` |
| Browser can't open (SSH, headless) | URL printed |
| Stale `server.lock` | Removed automatically |
| `status.js` error | Logged to `arcade.log`; exit 0; Claude unaffected |
| SSE disconnects | Badge "offline", games keep working, automatic reconnect |
| Game throws | Game destroyed, crash message, arcade continues |
| Invalid `game.json` in `games/` | Game omitted from registry, warning logged; CI fails the PR |

## 9. Privacy and security

- No telemetry, no network access beyond `127.0.0.1`.
- The page sees only state, timestamps and the project folder name; the folder name can be hidden in settings.
- Localhost threat model documented in `SECURITY.md`: Host/Origin checks, path confinement, CSP, shutdown token.

## 10. Testing

Runner: `node:test`. Dev-only dependencies: ESLint, Prettier, Playwright, `@axe-core/playwright`.

| Layer | Coverage |
|---|---|
| Unit — `status.js` / `status-store.js` | stdin parsing, malformed input, atomic write, missing data dir, pruning, exit 0 always, < 100 ms |
| Unit — server | static serving, traversal rejection, Host/Origin checks, SSE on change, port fallback, stale lock, idle shutdown, settings validation |
| Unit — `settings.js` | precedence order |
| Unit — game logic | each game's `logic.js` (2048 merges/spawn, Minesweeper flood fill and first-click safety, Snake movement/collision) |
| Contract — every game, auto-discovered | schema validity, id matches folder, default export is a function, lifecycle start→pause→resume→destroy against a minimal fake `ctx` and DOM stub leaves no pending timers/listeners, no network patterns in source, size budget |
| E2E (Playwright, Chromium, Ubuntu) | start server → open page → launch each game → write `needs-you` → game paused and banner shown; axe-core scan of shell and menu |
| Plugin | `claude plugin validate --strict` |

CI (GitHub Actions): unit + contract on {Ubuntu, macOS, Windows} × Node {20, 22, 24}; lint; E2E on Ubuntu; plugin validation. Release workflow on tag checks that `plugin.json` `version` matches the top `CHANGELOG.md` entry.

## 11. Distribution

- Install:
  ```
  /plugin marketplace add <owner>/arcade
  /plugin install arcade@<marketplace-name>
  ```
- `plugin.json` sets an explicit semver `version`, bumped every release (users don't receive updates otherwise).
- No runtime npm dependencies and no committed lockfile (see §3), so installing the plugin never runs `npm install`.
- Later: submit to the official plugin directory.

## 12. Open-source foundations (v0.1)

- `LICENSE` Apache-2.0; contributions under the same license with DCO sign-off (`git commit -s`), checked by a DCO workflow.
- `CODE_OF_CONDUCT.md` — Contributor Covenant 2.1.
- `CONTRIBUTING.md` — setup (`git clone`, `npm install`, `claude --plugin-dir .`), tests, conventions, content policy (no network, tracking, violent/adult content; original or compatibly licensed assets with attribution in the game README).
- `docs/game-authoring.md` + `templates/game/` — the primary contributor path.
- `docs/architecture.md` — this design, condensed.
- `SECURITY.md` — private reporting via GitHub Security Advisories.
- `.github/`: issue forms (bug, feature, game proposal), PR template with accessibility checklist, `CODEOWNERS` (maintainers own `server/`, `hooks/`, `web/`, `schemas/`; game authors listed for their folders), labels `good first issue` and `new-game`, Dependabot for dev dependencies.
- `README.md` — demo GIF, install, modes, accessibility, troubleshooting/FAQ.
- `CHANGELOG.md` — Keep a Changelog format.

## 13. Roadmap

| Release | Scope |
|---|---|
| **v0.1 (MVP)** | Everything in this spec: 3 games, 3 modes, SDK v1, full CI, community files |
| v0.2 | Community games; key-remapping UI; gamepad in `ctx.input`; local-only play stats |
| v0.3 | Optional iframe-sandboxed games for framework-heavy or less-trusted games |
| v0.4 | Terminal renderer for SSH/headless users |
| Later | Official directory submission; i18n of shell strings; data-driven themes |
