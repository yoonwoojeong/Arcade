# Claude Arcade

Play a quick browser game while Claude works, and get nudged the moment Claude finishes or needs you.

<!-- demo GIF: docs/media/demo.gif (to be recorded) -->

Claude Arcade is an open-source [Claude Code](https://claude.com/claude-code) plugin. It runs a tiny
arcade on `localhost` with Snake, 2048 and Minesweeper. When Claude needs you or is done, the game
pauses and a banner tells you which project is waiting.

## Requirements

- Claude Code
- Node.js 20 or newer (Claude Arcade has no other dependencies and never runs `npm install`)
- A current browser: the latest two versions of Chrome, Edge, Firefox or Safari

## Install

In Claude Code:

```
/plugin marketplace add yoonwoojeong/Arcade
/plugin install arcade@claude-arcade
```

## Usage

| Command               | What it does                                                      |
| --------------------- | ----------------------------------------------------------------- |
| `/arcade:play [game]` | Starts the local server and opens the arcade. `game` is optional. |
| `/arcade:stop`        | Stops the server.                                                 |
| `/arcade:games`       | Lists the available games.                                        |

Game ids: `2048`, `minesweeper`, `snake`. For example, `/arcade:play snake`.

**Open it once per session and leave the tab open.** A slash command typed while Claude is mid-turn is
queued until the turn ends, so you cannot open the arcade from the terminal while you wait. Open the tab
first, then send Claude your task. The tab follows every Claude Code session on your machine.

## Modes

| Mode              | Opens automatically?                                                                                 | When Claude finishes or needs you      |
| ----------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `alert` (default) | No, only via `/arcade:play`                                                                          | Pauses the game and shows a banner     |
| `auto`            | Also after Claude has worked for the auto-open delay (once per session, only if no tab is connected) | Same as `alert`                        |
| `quiet`           | No, only via `/arcade:play`                                                                          | Status badge only, no pause, no banner |

The banner reads `Claude needs you in <project>` or `Claude finished in <project>`, with **Resume game**
and **Dismiss** buttons. A status badge is always visible: `Claude is working…`, `Claude is idle`, or
`Offline — reconnecting…` if the page lost the server (games keep working).

## Settings

| Setting         | Default | Notes                                                  |
| --------------- | ------- | ------------------------------------------------------ |
| `mode`          | `alert` | `alert`, `auto` or `quiet`                             |
| `port`          | `4417`  | Preferred port. If busy, the next 9 ports are tried.   |
| `autoOpenDelay` | `20`    | Seconds before `auto` mode opens the arcade (5 to 600) |

Change `mode`, `port` and `autoOpenDelay` with `/plugin` (plugin options), or change the mode and delay
in the page's Settings panel. The Settings panel also has sound, browser notifications, theme, reduced
motion, high contrast, a colourblind palette and a "show project name" switch.

- The Settings panel applies immediately and wins over `/plugin` options.
- Changes made with `/plugin` reach the arcade after Claude's next hook event (your next prompt, or its
  next tool call), because the hooks save them to `plugin-options.json`. (Hooks receiving `/plugin`
  options was verified with Claude Code 2.1.309.) An open page picks up a new mode or delay on the next
  status change, or when you switch back to its tab. A new `port` applies the next time the server
  starts (`/arcade:stop`, then `/arcade:play`).
- Sound is off by default, and browser notifications are requested only when you turn them on.

## Accessibility

Claude Arcade aims for WCAG 2.2 AA in the shell: full keyboard operation, visible focus, labelled
controls, live-region announcements, `prefers-reduced-motion` and `prefers-color-scheme` support (both
overridable), a high-contrast theme, a colourblind-safe palette, no information by colour alone, and
nothing that flashes more than 3 times per second. The test suite runs an axe-core scan of the shell.
In a game, `Esc` pauses and moves focus to Resume game / Back to menu, and `P` toggles pause.

Each game declares how well it works with a screen reader, and the menu shows it:

| Game        | Screen reader | Notes                                                                                                                              |
| ----------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 2048        | Full          | Announces moves, merges and score                                                                                                  |
| Minesweeper | Full          | Arrow keys move a focused cursor (cell label "Row r, column c: ..."), Enter reveals, Shift or X flags. On touch, long-press flags. |
| Snake       | None          | Declared honestly: it is a canvas game. It announces only the final score.                                                         |

Found a barrier? Please [open an issue](https://github.com/yoonwoojeong/Arcade/issues/new/choose).
Accessibility bugs are welcome and prioritised.

## Privacy

- No telemetry, no analytics, no accounts. Nothing leaves your machine.
- The server listens on `127.0.0.1` only, and nothing in the project makes network requests beyond it.
- The page sees only session state (`working`, `needs-you`, `done`), timestamps and the project folder
  name, which you can hide in Settings. Prompts and tool inputs are never stored.
- Data lives in the plugin data directory, `${CLAUDE_PLUGIN_DATA}` (Claude Code's per-plugin data
  folder, e.g. under `~/.claude/plugins/data/`; outside Claude Code the fallback is `~/.claude/arcade`): `status.json`, `settings.json`, `plugin-options.json`,
  `server.lock` and `arcade.log`. Game scores and preferences live in your browser's `localStorage`.

See [SECURITY.md](SECURITY.md) for the localhost threat model.

## Remote use

Claude Code often runs on a machine without a browser (a server over SSH, a dev container, a cloud
session) while you sit at a computer that has one. The arcade's server listens on `127.0.0.1` only,
on purpose, so you reach it by forwarding its port to your own machine.

When `/arcade:play` cannot open a browser it says how:

- **SSH.** It prints a command such as `ssh -L 4417:127.0.0.1:4417 you@your-server`. Run it on your
  own machine, then open `http://localhost:4417/`. The host in the command comes from the SSH
  session's own address, which is not always the name you type, so adjust it to how you normally
  connect.
- **Dev containers, remote editors, cloud sessions.** It tells you which port to forward. Use your
  environment's port forwarding. If it offers none, the arcade cannot be reached from outside.

Keep two things in mind:

- **Use the same port number on both sides.** The server only accepts `localhost:<its port>` and
  `127.0.0.1:<its port>` as the host, so a forward to a different local port gets `403 Forbidden`. The
  port is `4417` unless that was busy (see Troubleshooting).
- **The status flow is unchanged.** The hooks run next to the server, so the pause and banner work the
  same remotely. If the forward drops, the badge shows `Offline — reconnecting…` and the page
  reconnects when it is back.

Listening on all network interfaces is not supported: it would expose the arcade's unauthenticated
settings and shutdown API to everyone who can reach the machine.

## Troubleshooting

- **"Claude Arcade needs Node.js 20 or newer."** Install Node from <https://nodejs.org>, then restart
  Claude Code. Check with `node --version`.
- **Ports busy.** Claude Arcade tries your preferred port (default `4417`) and the next 9. If all are
  taken, the command prints `Ports 4417–4426 are all in use. Change the "port" option for the arcade
plugin in /plugin.` (with your range). Change the `port` option with `/plugin` and try again.
- **No browser opens (SSH, containers, headless).** The command prints the URL and how to forward the
  port to your own machine. See [Remote use](#remote-use).
- **The game did not pause when Claude finished.** Make sure the tab is open and the badge is not
  showing `Offline — reconnecting…`. In `quiet` mode only the badge changes.
- **Changed a `/plugin` option and nothing happened.** It takes effect after your next prompt (a new
  `port` after `/arcade:stop` and `/arcade:play`). A mode or delay chosen in the Settings panel wins
  over `/plugin`, so change it there instead; that also applies immediately.
- **Still stuck?** Look at `arcade.log` in the data directory (see Privacy above, `${CLAUDE_PLUGIN_DATA}/arcade.log`, e.g. under `~/.claude/plugins/data/`). It holds server and hook errors. Hook errors never
  affect Claude. Include an excerpt when you file a bug.

## Contributing

New games are the easiest way to contribute: copy the template, edit one JSON file, write a game. Start
with [CONTRIBUTING.md](CONTRIBUTING.md) and [docs/game-authoring.md](docs/game-authoring.md). Everyone is
welcome, including first-timers. Please read the [Code of Conduct](CODE_OF_CONDUCT.md). See
[docs/architecture.md](docs/architecture.md) for how the pieces fit together.

## License

[Apache-2.0](LICENSE). Contributions are accepted under the same license with a DCO sign-off.
