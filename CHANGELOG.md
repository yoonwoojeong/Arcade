# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.1] - 2026-10-23

### Added

- When `/arcade:play` cannot open a browser, it now prints how to reach the arcade from your own
  machine: the exact `ssh -L` command in an SSH session, or a port-forwarding hint in a headless
  container or cloud session. Nothing extra is printed when a browser opened, or on a desktop where
  only the browser launcher failed.
- A "Remote use" section in the README.

## [0.1.0] - 2026-10-23

### Added

- Claude Code plugin `arcade` and the `claude-arcade` marketplace, installed with
  `/plugin marketplace add yoonwoojeong/Arcade` and `/plugin install arcade@claude-arcade`.
- Skills `/arcade:play [game-id]`, `/arcade:stop` and `/arcade:games`.
- Hooks that record `working`, `needs-you`, `done` and session end to `status.json` without ever
  affecting Claude's turn.
- A localhost-only server with SSE status updates, Host and Origin checks, path confinement, a
  Content-Security-Policy, a shutdown token, port fallback (`4417` plus the next 9), a single-instance
  lock and idle shutdown.
- Modes `alert` (default), `auto` and `quiet`, with the `autoOpenDelay` option (default 20 s).
- Browser shell: game menu, status badge, banner with Resume and Dismiss, high score tracking, and a
  Settings panel (mode, delay, sound, notifications, theme, reduced motion, high contrast, colourblind
  palette, show project name).
- Games: Snake, 2048 and Minesweeper, each with a declared screen-reader level.
- Game SDK v1 (`ctx`), the `game.json` schema, a copy-me template in `templates/game/`, and an
  auto-discovering contract test.
- Accessibility: WCAG 2.2 AA target for the shell, keyboard operation, live-region announcements,
  reduced motion, high contrast and a colourblind-safe palette.
- Continuous integration: lint, unit and contract tests on Ubuntu, macOS and Windows with Node 20, 22
  and 24, Playwright end-to-end tests with an axe-core scan, plugin validation, a DCO check and a
  release check.
- Community files: README, contributing guide, Code of Conduct, security policy, issue forms, pull
  request template, CODEOWNERS and label guide.
- Architecture and game-authoring documentation.

[Unreleased]: https://github.com/yoonwoojeong/Arcade/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/yoonwoojeong/Arcade/releases/tag/v0.1.0
