# Contributing to Claude Arcade

Thank you for helping! Claude Arcade is a small, friendly project, and first-time contributors are very
welcome. You do not need to know the whole codebase: the easiest contribution is a new game, and it only
touches its own folder. Please read our [Code of Conduct](CODE_OF_CONDUCT.md) first.

## Setup

You need Node.js 20 or newer and Git.

```
git clone https://github.com/yoonwoojeong/Arcade.git
cd Arcade
npm install
npx playwright install chromium
```

Try the plugin from your checkout:

```
claude --plugin-dir .
```

Then run `/arcade:play` inside Claude Code. The plugin itself has no runtime dependencies, so
`npm install` only fetches development tools (ESLint, Prettier, Playwright, axe-core).

## Running the checks

| Command                | What it runs                                                                      |
| ---------------------- | --------------------------------------------------------------------------------- |
| `npm test`             | Unit tests and the game contract test (fast, no browser)                          |
| `npm run test:e2e`     | Playwright end-to-end tests in Chromium, including an axe-core accessibility scan |
| `npm run lint`         | ESLint                                                                            |
| `npm run format:check` | Prettier check (`npm run format` fixes formatting for you)                        |

Please run `npm test`, `npm run lint` and `npm run format:check` before opening a pull request. CI runs
them on Linux, macOS and Windows.

## Sign your commits (DCO)

We use the [Developer Certificate of Origin](https://developercertificate.org/) instead of a CLA. It is a
simple statement that you wrote the change or have the right to submit it under the project's license
(Apache-2.0). You agree to it by adding a `Signed-off-by` line to every commit:

```
git commit -s -m "feat(games): add Tic-Tac-Toe"
```

Forgot? Fix the last commit with `git commit --amend -s --no-edit`, or several with
`git rebase --signoff main`. A GitHub workflow checks this on every pull request.

## Add a game in 5 steps

1. **Copy the template:** `cp -r templates/game games/<id>` (lowercase letters, digits and dashes).
2. **Edit `games/<id>/game.json`:** set `id` (it must equal the folder name), `title`, your GitHub handle
   as `author`, the description, controls and accessibility declaration.
3. **Write the game** in `games/<id>/index.js`, with the rules in a DOM-free `logic.js`.
4. **Test it:** move `logic.test.js.example` to `test/unit/<id>.test.js` and fix its import, then run
   `npm test`. The contract test discovers your game automatically and checks it.
5. **Open a pull request.** Fill in the template, including the accessibility checklist.

The full guide, with the `ctx` API reference, is [docs/game-authoring.md](docs/game-authoring.md). Not
sure your idea fits? Open a [game proposal](https://github.com/yoonwoojeong/Arcade/issues/new/choose)
first. Add a line to `.github/CODEOWNERS` for your folder if you want to review future changes to it.

## Content policy

- **No network.** Games run fully offline: no `fetch`, WebSockets, remote scripts or remote URLs.
- **No tracking.** No analytics, fingerprinting or data collection of any kind.
- **No violent or adult content.** Keep it suitable for a break at work.
- **Original or compatibly licensed assets.** Sound, images and fonts must be yours or under a
  license compatible with Apache-2.0, and you must credit the source and license in the game's
  `README.md`.
- **Accessible.** Declare your screen-reader level honestly. "none" is fine for a game that cannot work
  with one, but keyboard play, reduced motion and non-colour cues are expected.

## Pull request expectations

- Keep pull requests focused: one change, with tests where it makes sense.
- Be kind in review. We aim to give a first response within a few days, and we are happy to help you get
  a pull request over the line.
- CI must pass: lint, formatting, tests, DCO, and plugin validation.
- Changes to `server/`, `hooks/`, `web/`, `schemas/` and `.github/` need a maintainer's review (see
  `CODEOWNERS`). Describe user-visible changes in `CHANGELOG.md` under `[Unreleased]`.
- Markdown and code are formatted with Prettier. Commit style is loose, but a prefix such as `feat:`,
  `fix:`, `docs:` or `test:` is appreciated.

## Where to ask questions

- Use [GitHub Discussions](https://github.com/yoonwoojeong/Arcade/discussions) for questions and ideas.
- Use [issues](https://github.com/yoonwoojeong/Arcade/issues/new/choose) for bugs, features and game
  proposals. Look for the `good first issue` label if you want somewhere to start.
- Security problems go through the private process in [SECURITY.md](SECURITY.md).
- Conduct concerns are covered in the [Code of Conduct](CODE_OF_CONDUCT.md).

## Releasing (maintainers)

Bump `version` in `.claude-plugin/plugin.json` (users receive updates only when it changes), add a
matching `## [x.y.z] - date` entry to `CHANGELOG.md`, verify with `node scripts/check-release.js vX.Y.Z`,
then tag `vX.Y.Z`.
