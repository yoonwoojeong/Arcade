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
- Changes made with `/plugin` reach the arcade server after the next prompt you send, because the hooks
  pass them along. (Verified with Claude Code 2.1.309.)
- Sound is off by default, and browser notifications are requested only when you turn them on.

## Accessibility

Claude Arcade aims for WCAG 2.2 AA in the shell: full keyboard operation, visible focus, labelled
controls, live-region announcements, `prefers-reduced-motion` and `prefers-color-scheme` support (both
overridable), a high-contrast theme, a colourblind-safe palette, no information by colour alone, and
nothing that flashes more than 3 times per second. The test suite runs an axe-core scan of the shell.

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

## Troubleshooting

- **"Claude Arcade needs Node.js 20 or newer."** Install Node from <https://nodejs.org>, then restart
  Claude Code. Check with `node --version`.
- **Ports busy.** Claude Arcade tries your preferred port (default `4417`) and the next 9. If all are
  taken, the command prints `Ports 4417–4426 are all in use. Change the "port" option for the arcade
plugin in /plugin.` (with your range). Change the `port` option with `/plugin` and try again.
- **No browser opens (SSH, containers, headless).** The command prints the URL, for example
  `http://127.0.0.1:4417`. Open it in a browser on the same machine, or forward the port over SSH.
- **The game did not pause when Claude finished.** Make sure the tab is open and the badge is not
  showing `Offline — reconnecting…`. In `quiet` mode only the badge changes.
- **Changed a `/plugin` option and nothing happened.** It takes effect after your next prompt. Use the
  Settings panel for an immediate change.
- **Still stuck?** Look at `arcade.log` in the data directory (see Privacy above, `${CLAUDE_PLUGIN_DATA}/arcade.log`, e.g. under `~/.claude/plugins/data/`). It holds server and hook errors. Hook errors never
  affect Claude. Include an excerpt when you file a bug.

## Contributing

New games are the easiest way to contribute: copy the template, edit one JSON file, write a game. Start
with [CONTRIBUTING.md](CONTRIBUTING.md) and [docs/game-authoring.md](docs/game-authoring.md). Everyone is
welcome, including first-timers. Please read the [Code of Conduct](CODE_OF_CONDUCT.md). See
[docs/architecture.md](docs/architecture.md) for how the pieces fit together.

## License

[Apache-2.0](LICENSE). Contributions are accepted under the same license with a DCO sign-off.
