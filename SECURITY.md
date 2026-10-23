# Security policy

## Supported versions

Claude Arcade is young, so only the latest release receives security fixes.

| Version | Supported |
| ------- | --------- |
| 0.1.x   | Yes       |

## Reporting a vulnerability

Please do not open a public issue for a security problem. Report it privately through
[GitHub Security Advisories](https://github.com/yoonwoojeong/Arcade/security/advisories/new)
("Report a vulnerability" on the repository's Security tab).

Include what you found, steps to reproduce, and the affected version if you know it. We aim to
acknowledge a report within a few days, and will keep you updated until it is fixed. We credit
reporters in the release notes unless you prefer otherwise.

## Threat model

Claude Arcade runs a small HTTP server on your own machine so a browser tab can show games and Claude's
status. The main risks are other websites or processes trying to talk to that server, and a game
trying to reach beyond its sandbox. These are the defences:

- **Loopback only.** The server binds `127.0.0.1`. It is not reachable from the network.
- **Host check.** Requests whose `Host` header is not `127.0.0.1:<port>` or `localhost:<port>` are
  rejected with 403. This blocks DNS-rebinding attacks.
- **Origin check.** `POST` requests whose `Origin` does not match the server's own origin are rejected,
  so another website cannot change your settings.
- **Path confinement.** Static files are resolved and served only from `web/` and `games/`. Anything
  that resolves outside those folders (such as `..` traversal) is rejected.
- **Content-Security-Policy.** `default-src 'self'; img-src 'self' data:; media-src 'self' data:`, plus
  `X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer`. Pages load no external
  resources.
- **Shutdown token.** `POST /api/shutdown` needs a random token stored in `server.lock` in the plugin
  data directory, in addition to the Origin check.
- **No network access.** Nothing in the project makes requests beyond `127.0.0.1`, and there is no
  telemetry. Contributed games are checked by a contract test that rejects network APIs and remote
  imports.
- **Minimal data.** The page sees only session state, timestamps and the project folder name. Prompts
  and tool inputs are never stored.

Games are first-party code reviewed in pull requests. They run in the same page as the shell, and the
contract test is a best-effort lint, not a sandbox. Sandboxed games are on the roadmap. Reviewers treat
every game contribution as untrusted code.

Out of scope: attacks that already require code execution as your user, since such an attacker can read
the data directory directly.
