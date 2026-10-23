# Claude Arcade v0.1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship v0.1 of Claude Arcade: a Claude Code plugin whose `/arcade:play` skill opens a localhost browser arcade (Snake, 2048, Minesweeper) that pauses and alerts the user when Claude finishes or needs them.

**Architecture:** Hooks run `node hooks/status.js <state>`, which atomically updates `status.json` in the plugin data dir. A zero-dependency Node HTTP server (started detached by `server/cli.js`) watches that file and pushes it to a vanilla-JS web shell over SSE. Games are folders under `games/` that default-export `createGame(ctx)` against a small SDK.

**Tech Stack:** Node.js ≥ 20 built-ins only at runtime (ESM, `"type": "module"`), vanilla ES2020 in the browser, `node:test` for unit/contract tests, Playwright + `@axe-core/playwright` for E2E, ESLint 9 (flat config) + Prettier 3, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-23-claude-arcade-design.md`. Read it before starting any task. Section references below (§n) point into it.

## Global Constraints

- Runtime: Node.js ≥ 20. **Zero runtime npm dependencies.** Code under `hooks/`, `server/`, `web/`, `games/` and `templates/` imports only Node built-ins or relative files.
- `package.json` has `devDependencies` only, pinned to exact versions (use the latest published version at implementation time: `npm view <pkg> version`). `package-lock.json` is in `.gitignore` and never committed.
- All modules are ESM (`package.json` `"type": "module"`). No build step, no transpiling.
- Every hook and script is invoked as `node <file>`. No bash or PowerShell logic. Paths use `path.join`/`path.resolve`; no symlinks; `${CLAUDE_PLUGIN_ROOT}` is always quoted.
- Server binds `127.0.0.1` only. Nothing makes network requests beyond `127.0.0.1`. No telemetry.
- Defaults: `mode` `alert` (options `alert`/`auto`/`quiet`), `port` `4417` (1024–65535, fallback `port+1…port+9`), `autoOpenDelay` `20` s (5–600), idle shutdown `30` min, SSE heartbeat `15` s, watch debounce `50` ms, polling fallback `1` s, health wait ≤ `3` s, session prune `24` h, game folder budget `200 KB`.
- `hooks/status.js` always exits 0, prints nothing to stdout, and never throws.
- Data dir resolution (single function `dataDir()` in `server/paths.js`): `--data-dir` CLI flag → `ARCADE_DATA_DIR` env (tests) → `CLAUDE_PLUGIN_DATA` env → `path.join(os.homedir(), '.claude', 'arcade')`. Values that are empty or contain a literal `${` (unexpanded placeholder) are ignored.
- Copy (exact strings): banner `Claude needs you in <project>` / `Claude finished in <project>`; without project `Claude needs you` / `Claude finished`; crash `This game crashed — back to menu`; offline badge `Offline — reconnecting…`; working badge `Claude is working…`; idle badge `Claude is idle`.
- Supported browsers: latest two versions of Chrome, Edge, Firefox, Safari. Shell targets WCAG 2.2 AA.
- Commits are signed off (`git commit -s`) per the DCO.

**Interpretations of the spec that this plan locks in** (call these out in review if you disagree):
1. *Plugin options reaching the server.* Whether `CLAUDE_PLUGIN_DATA` and `CLAUDE_PLUGIN_OPTION_*` are visible to a Bash command a skill runs is not documented. So the skills pass them explicitly as CLI flags (`--data-dir`, `--mode`, `--port`, `--auto-open-delay`), using `${CLAUDE_PLUGIN_DATA}` and `${user_config.*}` substitution. `cli.js` forwards them as env vars to the server it spawns. Task 11 verifies this against a real Claude Code. If substitution of `${CLAUDE_PLUGIN_DATA}` is unavailable in skill content, the data-dir fallback above keeps hooks and CLI aligned only if hooks also ignore `CLAUDE_PLUGIN_DATA`; Task 11 says what to change in that case.
2. *"Input only via `ctx.input`"* applies to keyboard and touch gestures. Pointer clicks on elements the game itself created inside `ctx.root` are allowed, provided `destroy()` removes them (the contract test checks listener balance).
3. A `server/main.js` entry (process bootstrap) and pure web helpers (`web/status-summary.js`, `web/modes.js`, `web/input.js`, `web/prefs.js`, `web/game-host.js`) are added beyond the spec's file list, so logic is unit-testable in Node.

## Review Focus

1. **Concurrent hook writes.** Two Claude sessions fire hooks at the same instant. `status.json` must always parse. At worst one update is lost and is corrected by the next event. Pinned in Task 3 (`concurrent writers never corrupt status.json`).
2. **Windows and odd paths.** `cwd` like `C:\Users\Jane Doe\my repo` or a path with non-ASCII characters must yield project `my repo` and the unicode name, on any host OS. Pinned in Task 3 (`projectName handles win32 and unicode paths`).
3. **Port held by a foreign process / PID reuse.** `server.lock` points to a live PID or port that isn't Claude Arcade. The CLI must not reuse it, and must start fresh. Pinned in Task 6 (`findRunning rejects a healthy port that is not claude-arcade`).
4. **Plugin updated while the server runs.** `CLAUDE_PLUGIN_ROOT` changes on update. A server from the old root must be replaced, not reused, so users don't keep stale code. Pinned in Task 9 (`ensureServer restarts a server from a different rootDir`).
5. **Untrusted URL hash.** `#../../etc` or an unknown id must show the menu and never `import()` anything outside registered games. Pinned in Task 13 (`resolveGameId only returns registered ids`) and Task 19 (E2E).

---

## File Structure

| Path | Responsibility |
|---|---|
| `package.json`, `.gitignore`, `eslint.config.js`, `.prettierrc.json`, `.prettierignore`, `.editorconfig` | Dev tooling only |
| `scripts/run-tests.js` | Cross-platform test discovery for `node --test` |
| `scripts/check-release.js`, `scripts/check-dco.js` | CI helpers |
| `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` | Plugin + marketplace manifests |
| `server/paths.js` | `pluginRoot`, `dataDir()`, `parseGlobalFlags()` |
| `server/settings.js` | Defaults, validation, precedence, `settings.json` IO |
| `server/status-store.js` | `status.json` model: read, pure update, atomic write |
| `hooks/status.js`, `hooks/hooks.json` | Hook entry |
| `schemas/game.schema.json`, `server/registry.js` | Game manifest schema + discovery/validation |
| `server/lifecycle.js` | `server.lock`, liveness, idle timer |
| `server/http-util.js` | Host/Origin checks, safe path resolution, MIME, security headers |
| `server/server.js` | `createArcadeServer()`: routes, SSE, watch, idle |
| `server/main.js` | Detached server process entry |
| `server/open-browser.js` | Per-OS browser launch |
| `server/cli.js` | `open`, `start`, `stop`, `status`, `games`, `auto-open` |
| `skills/{play,stop,games}/SKILL.md` | User entry points |
| `web/index.html`, `web/styles.css`, `web/shell.js` | Shell UI |
| `web/status-summary.js`, `web/modes.js`, `web/input.js`, `web/prefs.js`, `web/sdk.js`, `web/game-host.js` | Pure/near-pure shell modules |
| `games/{2048,minesweeper,snake}/{game.json,index.js,logic.js,README.md}` | MVP games |
| `templates/game/` | Contributor starter |
| `test/unit/*.test.js`, `test/contract/games.test.js`, `test/helpers/*.js`, `test/e2e/*.spec.js`, `playwright.config.js` | Tests |
| `.github/…`, `README.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, `CHANGELOG.md`, `docs/architecture.md`, `docs/game-authoring.md` | Community + docs |

---

### Task 1: Project scaffolding, manifests, test runner

**Files:**
- Create: `package.json`, `.gitignore`, `.editorconfig`, `eslint.config.js`, `.prettierrc.json`, `.prettierignore`, `scripts/run-tests.js`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `server/paths.js`
- Test: `test/unit/manifest.test.js`, `test/unit/paths.test.js`

**Interfaces:**
- Produces:
  - `server/paths.js`: `export const pluginRoot: string` (absolute, the repo root, derived from `import.meta.url`); `export function parseGlobalFlags(argv: string[]): { flags: { dataDir?: string, mode?: string, port?: string, autoOpenDelay?: string }, rest: string[] }` (recognizes `--data-dir`, `--mode`, `--port`, `--auto-open-delay` with a following value; drops values that are empty or contain `${`); `export function dataDir(opts?: { flag?: string, env?: NodeJS.ProcessEnv }): string` (precedence in Global Constraints).
  - npm scripts: `test` → `node scripts/run-tests.js` (runs `test/unit/**/*.test.js` and `test/contract/**/*.test.js` via `node --test <files…>`); `test:e2e` → `playwright test`; `lint` → `eslint .`; `format` / `format:check` → `prettier --write .` / `prettier --check .`.

- [ ] **Step 1: Write failing tests**

```js
// test/unit/manifest.test.js
test('plugin.json declares arcade with userConfig defaults', () => {
  const p = readJson('.claude-plugin/plugin.json');
  assert.equal(p.name, 'arcade');
  assert.equal(p.displayName, 'Claude Arcade');
  assert.equal(p.license, 'Apache-2.0');
  assert.match(p.version, /^\d+\.\d+\.\d+$/);
  assert.deepEqual(p.userConfig.mode.options, ['alert', 'auto', 'quiet']);
  assert.equal(p.userConfig.mode.default, 'alert');
  assert.equal(p.userConfig.port.default, 4417);
  assert.equal(p.userConfig.autoOpenDelay.default, 20);
});
test('marketplace.json lists arcade with source "./"', () => {
  const m = readJson('.claude-plugin/marketplace.json');
  assert.equal(m.plugins.length, 1);
  assert.equal(m.plugins[0].name, 'arcade');
  assert.equal(m.plugins[0].source, './');
});
test('package.json has no runtime dependencies and no lockfile is tracked', () => {
  const pkg = readJson('package.json');
  assert.equal(pkg.type, 'module');
  assert.equal(pkg.dependencies, undefined);
  assert.ok(Object.values(pkg.devDependencies).every(v => /^\d+\.\d+\.\d+$/.test(v)));
  const tracked = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\n');
  assert.ok(!tracked.includes('package-lock.json'));
});
```

```js
// test/unit/paths.test.js
test('dataDir precedence: flag > ARCADE_DATA_DIR > CLAUDE_PLUGIN_DATA > home', () => {
  assert.equal(dataDir({ flag: '/f', env: { ARCADE_DATA_DIR: '/a', CLAUDE_PLUGIN_DATA: '/c' } }), path.resolve('/f'));
  assert.equal(dataDir({ env: { ARCADE_DATA_DIR: '/a', CLAUDE_PLUGIN_DATA: '/c' } }), path.resolve('/a'));
  assert.equal(dataDir({ env: { CLAUDE_PLUGIN_DATA: '/c' } }), path.resolve('/c'));
  assert.equal(dataDir({ env: {} }), path.join(os.homedir(), '.claude', 'arcade'));
});
test('unexpanded placeholders and empty values are ignored', () => {
  assert.equal(dataDir({ flag: '${CLAUDE_PLUGIN_DATA}', env: { CLAUDE_PLUGIN_DATA: '' } }), path.join(os.homedir(), '.claude', 'arcade'));
  const { flags, rest } = parseGlobalFlags(['open', '--mode', '${user_config.mode}', '--port', '5000', 'snake']);
  assert.deepEqual(flags, { port: '5000' });
  assert.deepEqual(rest, ['open', 'snake']);
});
test('pluginRoot contains .claude-plugin/plugin.json', () => {
  assert.ok(fs.existsSync(path.join(pluginRoot, '.claude-plugin', 'plugin.json')));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/unit/manifest.test.js test/unit/paths.test.js`
Expected: FAIL (files missing).

- [ ] **Step 3: Create tooling and manifests**

- `package.json`: `name: "claude-arcade"`, `private: true`, `type: "module"`, `engines.node: ">=20"`, `license: "Apache-2.0"`, scripts as above, devDependencies `eslint`, `@eslint/js`, `globals`, `prettier`, `@playwright/test`, `@axe-core/playwright` (exact versions).
- `.gitignore`: `node_modules/`, `package-lock.json`, `test-results/`, `playwright-report/`, `.arcade-test-data/`.
- `eslint.config.js`: `@eslint/js` recommended; Node globals for `hooks/`, `server/`, `scripts/`, `test/`; browser globals for `web/`, `games/`, `templates/`.
- `.prettierrc.json`: `{ "singleQuote": true, "printWidth": 100 }`.
- `.claude-plugin/plugin.json`: fields from §4.1. `userConfig.mode` is `{ type: "string", title: "Arcade mode", description: "alert: pause + banner when Claude needs you; auto: also open the arcade automatically; quiet: status badge only", options: ["alert","auto","quiet"], default: "alert" }`. `port` is `{ type: "number", min: 1024, max: 65535, default: 4417 }`. `autoOpenDelay` is `{ type: "number", min: 5, max: 600, default: 20 }`. `version: "0.1.0"`.
- `.claude-plugin/marketplace.json`: `name: "claude-arcade"`, `owner.name` = repo owner, one plugin `{ name: "arcade", source: "./", description }`.
- `scripts/run-tests.js`: recursively collect `*.test.js` under `test/unit` and `test/contract`, sort, `spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' })`, exit with its status.
- `server/paths.js` per Interfaces.

- [ ] **Step 4: Install dev deps and verify**

Run: `npm install && npm test && npm run lint && npm run format:check`
Expected: all tests PASS; lint and format clean.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -s -m "chore: scaffold plugin manifests, tooling and test runner"
```

---

### Task 2: Settings resolution

**Files:**
- Create: `server/settings.js`
- Test: `test/unit/settings.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces (`server/settings.js`):
  - `export const DEFAULTS = Object.freeze({ mode: 'alert', port: 4417, autoOpenDelay: 20 })`
  - `export function validateSetting(key: 'mode'|'port'|'autoOpenDelay', value: unknown): { ok: true, value: string|number } | { ok: false, error: string }`. Numbers may arrive as numeric strings (from env/flags) and are coerced. Must be integers in range.
  - `export function resolveSettings({ dataDir: string, env: NodeJS.ProcessEnv }): { mode, port, autoOpenDelay }`. Per key, first valid of: `settings.json` in dataDir → `CLAUDE_PLUGIN_OPTION_MODE` / `_PORT` / `_AUTOOPENDELAY` → `DEFAULTS`. Invalid values are skipped, not thrown.
  - `export function writeSettings(dataDir: string, patch: object): { ok: true, settings } | { ok: false, errors: string[] }`. Accepts only `mode` and `autoOpenDelay` (any other key, including `port`, is an error). Merges into existing `settings.json`, writes atomically (temp + rename), creates dir.

- [ ] **Step 1: Write failing tests**

```js
test('defaults when nothing is set', () => {
  assert.deepEqual(resolveSettings({ dataDir: tmp(), env: {} }), { mode: 'alert', port: 4417, autoOpenDelay: 20 });
});
test('env overrides defaults; settings.json overrides env', () => {
  const dir = tmp();
  const env = { CLAUDE_PLUGIN_OPTION_MODE: 'quiet', CLAUDE_PLUGIN_OPTION_PORT: '5000', CLAUDE_PLUGIN_OPTION_AUTOOPENDELAY: '30' };
  assert.deepEqual(resolveSettings({ dataDir: dir, env }), { mode: 'quiet', port: 5000, autoOpenDelay: 30 });
  writeSettings(dir, { mode: 'auto' });
  assert.equal(resolveSettings({ dataDir: dir, env }).mode, 'auto');
});
test('invalid values fall through to the next layer', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ mode: 'loud', autoOpenDelay: 1 }));
  const s = resolveSettings({ dataDir: dir, env: { CLAUDE_PLUGIN_OPTION_PORT: '80' } });
  assert.deepEqual(s, { mode: 'alert', port: 4417, autoOpenDelay: 20 });
});
test('corrupt settings.json is ignored', () => { /* write "{not json" → defaults */ });
test('writeSettings rejects port and unknown keys, validates ranges', () => {
  assert.equal(writeSettings(tmp(), { port: 5000 }).ok, false);
  assert.equal(writeSettings(tmp(), { autoOpenDelay: 601 }).ok, false);
  assert.equal(writeSettings(tmp(), { autoOpenDelay: 600 }).ok, true);
});
test('validateSetting coerces numeric strings and rejects non-integers', () => {
  assert.deepEqual(validateSetting('port', '4417'), { ok: true, value: 4417 });
  assert.equal(validateSetting('autoOpenDelay', 5.5).ok, false);
});
```

(`tmp()` is a helper in `test/helpers/tmp.js`: `export function tmp(): string` returns a fresh `fs.mkdtempSync(os.tmpdir()/arcade-)` directory. Create it in this task.)

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/unit/settings.test.js`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement `server/settings.js`** per Interfaces.

- [ ] **Step 4: Run to verify pass**

Run: `node --test test/unit/settings.test.js`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/settings.js test/unit/settings.test.js test/helpers/tmp.js && git commit -s -m "feat(server): settings resolution with precedence and validation"
```

---

### Task 3: Status store

**Files:**
- Create: `server/status-store.js`
- Test: `test/unit/status-store.test.js`

**Interfaces:**
- Produces (`server/status-store.js`):
  - Types: `State = 'working'|'needs-you'|'done'`; `Session = { state: State, project: string, since: string /*ISO*/, updatedAt: string, autoOpened?: true }`; `Status = { version: 1, updatedAt: string|null, sessions: Record<string, Session> }`.
  - `export const STATUS_FILE = 'status.json'`
  - `export function emptyStatus(): Status`
  - `export function projectName(cwd: string|undefined): string`. If `cwd` contains `\`, use `path.win32.basename`, else `path.posix.basename`. Returns `''` for falsy input.
  - `export function applyEvent(status: Status, ev: { state: State|'end', sessionId: string, cwd?: string, now: Date }): Status`. Pure (returns a new object). `end` deletes the session. `since` changes only when the state changes; `updatedAt` always changes. `autoOpened` is preserved. Prunes sessions whose `updatedAt` is older than 24 h relative to `now`.
  - `export function markAutoOpened(status: Status, sessionId: string): Status` (pure)
  - `export function readStatus(dir: string): Status`. Returns `emptyStatus()` on missing, unparsable, or `version !== 1` content.
  - `export function writeStatusAtomic(dir: string, status: Status): void`. `mkdirSync(dir, {recursive:true})`; write to `status.json.<pid>.<random>.tmp` in the same dir; `renameSync`. On Windows `EPERM`/`EBUSY` from rename, retry up to 5 times, 10 ms apart, then throw.
  - `export function updateStatus(dir: string, fn: (s: Status) => Status): Status`. Read, apply, write, return.

- [ ] **Step 1: Write failing tests**

```js
const t0 = new Date('2026-10-23T09:00:00Z');
test('applyEvent sets state, project, since', () => {
  const s = applyEvent(emptyStatus(), { state: 'working', sessionId: 'a', cwd: '/x/my-repo', now: t0 });
  assert.deepEqual(s.sessions.a, { state: 'working', project: 'my-repo', since: t0.toISOString(), updatedAt: t0.toISOString() });
});
test('since is kept when state repeats, changes when state changes', () => { /* working@t0, working@t1 → since t0; done@t2 → since t2 */ });
test('end removes the session', () => {});
test('sessions idle for more than 24h are pruned on any event', () => {
  /* session b updated at t0; event for a at t0+24h+1s → b gone; at t0+24h exactly → b kept */
});
test('autoOpened survives later events', () => {});
test('projectName handles win32 and unicode paths', () => {
  assert.equal(projectName('C:\\Users\\Jane Doe\\my repo'), 'my repo');
  assert.equal(projectName('/home/한글/프로젝트'), '프로젝트');
  assert.equal(projectName(undefined), '');
});
test('readStatus tolerates missing, corrupt and wrong-version files', () => {});
test('writeStatusAtomic creates the directory and leaves no tmp files', () => {});
test('concurrent writers never corrupt status.json', async () => {
  // spawn 20 child processes (node -e) that each call updateStatus(dir, …) for a distinct sessionId 25 times;
  // after all exit: JSON.parse(readFileSync(status.json)) succeeds, version === 1, and no *.tmp files remain.
});
```

- [ ] **Step 2: Run to verify failure**: `node --test test/unit/status-store.test.js` → FAIL.
- [ ] **Step 3: Implement `server/status-store.js`** per Interfaces.
- [ ] **Step 4: Run to verify pass**: same command → PASS (run 3 times to check the concurrency test is stable).
- [ ] **Step 5: Commit**: `git commit -s -m "feat(server): status.json store with atomic writes and pruning"`

---

### Task 4: Status hook

**Files:**
- Create: `hooks/status.js`, `hooks/hooks.json`
- Test: `test/unit/hook.test.js`

**Interfaces:**
- Consumes: `applyEvent`, `updateStatus`, `readStatus` (Task 3); `resolveSettings` (Task 2); `dataDir` (Task 1).
- Produces (`hooks/status.js`):
  - `export function run({ state: string, stdinText: string, env: NodeJS.ProcessEnv, now: Date, spawnAutoOpen: (sessionId: string, delaySec: number) => void }): void`. Never throws. Unknown `state` → logs and returns. Parses `stdinText` as JSON; on failure uses `{}`. `sessionId = input.session_id || 'unknown'`. Calls `updateStatus`. If `state === 'working'` and the resolved `mode === 'auto'`, calls `spawnAutoOpen(sessionId, autoOpenDelay)`. Errors are appended as one line `<ISO time> status.js <message>` to `<dataDir>/arcade.log`; failures to log are swallowed.
  - When executed directly (`import.meta.url` matches `process.argv[1]`): read stdin with `fs.readFileSync(0, 'utf8')` inside try/catch (`''` on error), call `run` with a real `spawnAutoOpen` that runs `spawn(process.execPath, [<pluginRoot>/server/cli.js, 'auto-open', sessionId, String(delay), '--data-dir', <dataDir>], { detached: true, stdio: 'ignore', windowsHide: true }).unref()`, then `process.exit(0)`.
- `hooks/hooks.json`: `{"hooks": {…}}` with events `UserPromptSubmit` → `working`, `PermissionRequest` → `needs-you`, `Notification` → `needs-you`, `Stop` → `done`, `SessionEnd` → `end`. Each is one `{ "matcher": "", "hooks": [{ "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/status.js\" <state>", "timeout": 10 }] }`.

- [ ] **Step 1: Write failing tests**

```js
test('working writes the session and does not spawn in alert mode', () => {
  const dir = tmp(); const calls = [];
  run({ state: 'working', stdinText: JSON.stringify({ session_id: 's1', cwd: '/p/demo' }),
        env: { ARCADE_DATA_DIR: dir }, now: new Date(), spawnAutoOpen: (...a) => calls.push(a) });
  assert.equal(readStatus(dir).sessions.s1.state, 'working');
  assert.equal(calls.length, 0);
});
test('auto mode spawns the auto-open timer with the configured delay', () => {
  /* env CLAUDE_PLUGIN_OPTION_MODE=auto, _AUTOOPENDELAY=45 → calls == [['s1', 45]] */
});
test('malformed stdin falls back to session "unknown"', () => {});
test('unknown state and unwritable data dir never throw and log to arcade.log', () => {
  /* data dir = a path whose parent is a regular file → run() returns; no exception */
});
test('run() completes in under 100 ms', () => { /* measure with performance.now() */ });
test('as a process: exits 0 with empty stdout even on garbage input', () => {
  const r = spawnSync(process.execPath, ['hooks/status.js', 'done'], { input: 'not json', env: { ...process.env, ARCADE_DATA_DIR: tmp() }, encoding: 'utf8' });
  assert.equal(r.status, 0); assert.equal(r.stdout, '');
});
test('hooks.json maps every event to status.js with the right state', () => { /* parse and assert table */ });
```

- [ ] **Step 2: Verify failure**: `node --test test/unit/hook.test.js` → FAIL.
- [ ] **Step 3: Implement `hooks/status.js` and `hooks/hooks.json`.**
- [ ] **Step 4: Verify pass**: same command → PASS.
- [ ] **Step 5: Commit**: `git commit -s -m "feat(hooks): status hook writes session state"`

---

### Task 5: Game manifest schema and registry

**Files:**
- Create: `schemas/game.schema.json`, `server/registry.js`
- Test: `test/unit/registry.test.js`

**Interfaces:**
- Produces (`server/registry.js`):
  - `export const MANIFEST_FIELDS = ['id','title','version','sdk','author','description','controls','accessibility','sessionLength']`. All are required.
  - `export function validateManifest(m: unknown, folderName: string): string[]` returns errors (empty means valid). Rules come from §5.1: `id` matches `^[a-z0-9][a-z0-9-]{1,30}$` and equals `folderName`; `title` is 1–40 chars; `version` is semver `x.y.z`; `sdk === 1`; `author` and `description` are non-empty strings (`description` ≤ 140 chars); `controls.keyboard` is a non-empty string array; `controls.touch` is an optional string; `accessibility.screenReader` is in `full|partial|none`; `accessibility.reducedMotion` and `colorIndependent` are booleans; `sessionLength` is in `short|medium|untimed`; unknown top-level keys are errors.
  - `export function loadRegistry(gamesDir: string): { games: Manifest[], warnings: string[] }`. For each subdirectory with `game.json` and `index.js`: parse and validate. Invalid or unparsable entries are skipped with a warning `"<folder>: <error>"`. Results are sorted by `title`.
- `schemas/game.schema.json`: JSON Schema draft 2020-12 expressing the same rules, with `additionalProperties: false`. It is for editors and docs. No runtime validator dependency.

- [ ] **Step 1: Write failing tests**

```js
const valid = { id: 'snake', title: 'Snake', version: '1.0.0', sdk: 1, author: 'a', description: 'd',
  controls: { keyboard: ['Arrows: move'] }, accessibility: { screenReader: 'none', reducedMotion: true, colorIndependent: true }, sessionLength: 'short' };
test('valid manifest has no errors', () => assert.deepEqual(validateManifest(valid, 'snake'), []));
test('id must match folder and pattern', () => {
  assert.ok(validateManifest(valid, 'other').length);
  assert.ok(validateManifest({ ...valid, id: '../x' }, '../x').length);
});
test('enums, sdk and unknown keys are enforced', () => { /* screenReader:'yes', sdk:2, extra:1 → errors */ });
test('schema file requires exactly MANIFEST_FIELDS', () => {
  assert.deepEqual([...readJson('schemas/game.schema.json').required].sort(), [...MANIFEST_FIELDS].sort());
});
test('loadRegistry skips invalid games with a warning and sorts by title', () => { /* temp games dir with 2 valid + 1 bad */ });
```

- [ ] **Step 2: Verify failure** → FAIL. **Step 3: Implement.** **Step 4: Verify pass** → PASS.
- [ ] **Step 5: Commit**: `git commit -s -m "feat(server): game manifest schema and registry"`

---

### Task 6: Server lifecycle (lock, liveness, idle)

**Files:**
- Create: `server/lifecycle.js`
- Test: `test/unit/lifecycle.test.js`

**Interfaces:**
- Produces (`server/lifecycle.js`):
  - `Lock = { port: number, pid: number, startedAt: string, token: string, rootDir: string }`
  - `export const LOCK_FILE = 'server.lock'`
  - `export function readLock(dir): Lock|null` (null on missing or corrupt); `export function writeLock(dir, lock): void` (atomic); `export function removeLock(dir, { pid }?): void` (if `pid` is given, removes only when the lock's pid matches).
  - `export function isAlive(pid: number): boolean`. `process.kill(pid, 0)`; `EPERM` counts as alive.
  - `export async function findRunning(dir: string, { fetchHealth = defaultFetchHealth }?): Promise<{ lock: Lock, health: Health } | null>`. Returns a match only if the lock exists, the PID is alive, and `fetchHealth(port)` resolves to `{ name: 'claude-arcade', pid: lock.pid }`. Otherwise removes the stale lock and returns null.
  - `Health = { ok: true, name: 'claude-arcade', version: string, pid: number, rootDir: string, clients: number }`
  - `export async function defaultFetchHealth(port: number): Promise<Health|null>`. `http.get` to `http://127.0.0.1:<port>/health` with a 1000 ms timeout; null on any error.
  - `export function createIdleTimer({ timeoutMs: number, onIdle: () => void }): { activity(): void, setClients(n: number): void, stop(): void }`. Fires `onIdle` once, after `timeoutMs` with `clients === 0` and no `activity()`. Any client connection cancels the timer; when clients return to 0 the countdown restarts.

- [ ] **Step 1: Write failing tests**

```js
test('findRunning returns the lock when pid alive and health matches', async () => {
  writeLock(dir, { port: 1, pid: process.pid, startedAt: 'x', token: 't', rootDir: '/r' });
  const r = await findRunning(dir, { fetchHealth: async () => ({ ok: true, name: 'claude-arcade', pid: process.pid, rootDir: '/r', clients: 0, version: '0.1.0' }) });
  assert.equal(r.lock.port, 1);
});
test('findRunning removes a lock whose pid is dead', async () => { /* pid 2**22+12345 → null and lock removed */ });
test('findRunning rejects a healthy port that is not claude-arcade', async () => {
  /* fetchHealth returns { name: 'something-else' } → null, lock removed */
  /* fetchHealth returns claude-arcade with a different pid (PID reuse) → null, lock removed */
});
test('removeLock with pid only removes its own lock', () => {});
test('idle timer fires after timeout with no clients and is reset by activity', async () => {
  // use node:test mock.timers: enable(['setTimeout']); timeoutMs 1000; tick 999 → not fired; activity(); tick 999 → not fired; tick 1 → fired once
});
test('idle timer does not fire while clients > 0', async () => {});
```

- [ ] **Step 2: Verify failure** → FAIL. **Step 3: Implement.** **Step 4: Verify pass** → PASS.
- [ ] **Step 5: Commit**: `git commit -s -m "feat(server): lockfile, liveness and idle timer"`

---

### Task 7: HTTP server: static files, security, JSON API

**Files:**
- Create: `server/http-util.js`, `server/server.js`
- Test: `test/unit/http-util.test.js`, `test/unit/server.test.js`

**Interfaces:**
- Consumes: `resolveSettings`, `writeSettings` (Task 2); `loadRegistry` (Task 5).
- Produces:
  - `server/http-util.js`:
    - `export function isAllowedHost(hostHeader: string|undefined, port: number): boolean` (exactly `127.0.0.1:<port>` or `localhost:<port>`)
    - `export function isAllowedOrigin(origin: string|undefined, port: number): boolean` (exactly `http://127.0.0.1:<port>` or `http://localhost:<port>`)
    - `export function safeResolve(baseDir: string, urlPath: string): string|null`. Decodes the path; returns null on decode error, NUL bytes, or a result outside `baseDir`.
    - `export function contentType(file: string): string`, covering `.html .js .css .json .svg .png .webp .ogg .mp3 .woff2`, default `application/octet-stream`. Text types get `; charset=utf-8`.
    - `export const SECURITY_HEADERS`: the CSP, `nosniff` and `no-referrer` values from §4.4, plus `Cache-Control: no-store`.
  - `server/server.js`:
    - `export class PortRangeBusyError extends Error { constructor(from: number, to: number) }` with `.from`, `.to`.
    - `export async function createArcadeServer({ rootDir: string, dataDir: string, port: number, token: string, env?: NodeJS.ProcessEnv, idleTimeoutMs?: number /*default 1_800_000*/, onShutdown?: () => void }): Promise<{ port: number, close(): Promise<void>, clientCount(): number }>`. Tries `port…port+9` on `127.0.0.1`. If all are busy, rejects with `PortRangeBusyError(port, port+9)`.
    - Routes (all require `isAllowedHost`, else 403):
      - `GET /` → `web/index.html`; `GET /web/*` → `web/`; `GET /games/*` → `games/`. Not found → 404; `safeResolve` null → 400. Directories → 404.
      - `GET /api/games` → `loadRegistry(<rootDir>/games).games`. Each registry warning is appended to `arcade.log` once per server process.
      - `GET /api/settings` → `resolveSettings({ dataDir, env })`.
      - `POST /api/settings` requires `isAllowedOrigin`, `Content-Type: application/json`, body ≤ 4 KB. Calls `writeSettings`, responds 200 with resolved settings or 400 with `{ errors }`.
      - `POST /api/shutdown` requires header `X-Arcade-Token === token`, and `Origin` absent or allowed. Responds 200, then closes and calls `onShutdown`.
      - `GET /health` → `Health` (Task 6) using `pluginRoot`'s `plugin.json` version.
      - Any other method/path → 404/405.
    - Every response carries `SECURITY_HEADERS`.
    - (SSE, watch and idle come in Task 8; leave `clientCount()` returning 0 for now.)

- [ ] **Step 1: Write failing tests**

```js
// http-util.test.js
test('host and origin checks are exact', () => {
  assert.ok(isAllowedHost('127.0.0.1:4417', 4417)); assert.ok(isAllowedHost('localhost:4417', 4417));
  assert.ok(!isAllowedHost('evil.com:4417', 4417)); assert.ok(!isAllowedHost('127.0.0.1:4418', 4417)); assert.ok(!isAllowedHost(undefined, 4417));
  assert.ok(!isAllowedOrigin('http://127.0.0.1.evil.com:4417', 4417));
});
test('safeResolve blocks traversal, encoded traversal and NUL', () => {
  assert.equal(safeResolve('/base', '/../etc/passwd'), null);
  assert.equal(safeResolve('/base', '/%2e%2e/%2e%2e/etc/passwd'), null);
  assert.equal(safeResolve('/base', '/a%00b'), null);
  assert.equal(safeResolve('/base', '/%E0%A4%A'), null);
  assert.equal(safeResolve('/base', '/ok/file.js'), path.resolve('/base/ok/file.js'));
});
// server.test.js  — start against a temp rootDir fixture (web/index.html, games/demo/{game.json,index.js}); helper req(method, path, headers, body)
test('serves index and game files with security headers', async () => { /* 200, CSP header equals spec string */ });
test('rejects foreign Host with 403', async () => {});
test('POST /api/settings needs matching Origin and JSON, validates', async () => {
  /* no Origin → 403; text/plain → 415; {mode:'auto'} with Origin → 200 and GET returns auto; {port:1} → 400 */
});
test('POST /api/shutdown needs the token', async () => { /* wrong → 403; right → 200 and onShutdown called */ });
test('falls back to the next port and reports the range when all are busy', async () => {
  /* occupy p with a dummy server → created.port === p+1; occupy p..p+9 → PortRangeBusyError with from p, to p+9 */
});
test('/health reports name, pid, rootDir', async () => {});
```

- [ ] **Step 2: Verify failure** → FAIL. **Step 3: Implement.** **Step 4: Verify pass** → PASS.
- [ ] **Step 5: Commit**: `git commit -s -m "feat(server): static serving, localhost security and JSON API"`

---

### Task 8: SSE, status watch, idle shutdown

**Files:**
- Modify: `server/server.js`
- Test: `test/unit/server-events.test.js`

**Interfaces:**
- Consumes: `readStatus`, `STATUS_FILE` (Task 3); `createIdleTimer` (Task 6).
- Produces: `GET /events` (`text/event-stream`). Sends `event: status\ndata: <Status JSON>\n\n` on connect and after every change. Sends `: ping\n\n` every 15 s. `clientCount()` now returns the number of open SSE connections, as does `/health.clients`. Change detection: `fs.watch(dataDir)` filtered to `STATUS_FILE` **and** a 1000 ms `setInterval` that compares the file's `mtimeMs`+`size`. Both feed a 50 ms debounce that broadcasts only if the serialized status differs from the last broadcast. If `fs.watch` throws (unsupported filesystem), polling alone is used. The idle timer gets `activity()` on each broadcast and `setClients()` on connect/disconnect. When it fires, the server closes, calls `onShutdown`, and stops all timers and watchers.

- [ ] **Step 1: Write failing tests**

```js
test('SSE sends current status on connect', async () => { /* open /events, read first event, equals readStatus(dataDir) */ });
test('SSE pushes a change within 1.5s of writeStatusAtomic', async () => {});
test('identical rewrites do not produce duplicate events', async () => {});
test('clientCount and /health.clients track open connections', async () => {});
test('idle shutdown fires after idleTimeoutMs with no clients', async () => { /* idleTimeoutMs: 200 → onShutdown called within 1s; port no longer accepts connections */ });
test('an open SSE client prevents idle shutdown', async () => {});
test('close() leaves no timers or watchers (process can exit)', async () => { /* run in a child process: create, close, then assert the child exits within 2s without process.exit */ });
```

- [ ] **Step 2: Verify failure** → FAIL. **Step 3: Implement.** **Step 4: Verify pass** → PASS.
- [ ] **Step 5: Commit**: `git commit -s -m "feat(server): SSE status stream, file watching and idle shutdown"`

---

### Task 9: Server entry, browser opener, CLI (open/start/stop/status/games)

**Files:**
- Create: `server/main.js`, `server/open-browser.js`, `server/cli.js`
- Test: `test/unit/open-browser.test.js`, `test/unit/cli.test.js`

**Interfaces:**
- Consumes: Tasks 1–8.
- Produces:
  - `server/main.js` (process entry; argv `--data-dir <dir>`): resolves settings from env; generates `token = crypto.randomBytes(16).toString('hex')`; `createArcadeServer({ rootDir: pluginRoot, … })`; `writeLock({ port, pid: process.pid, startedAt, token, rootDir: pluginRoot })`. On shutdown or SIGINT/SIGTERM: `removeLock(dir, { pid: process.pid })`, exit 0. On `PortRangeBusyError`: logs `PORT_RANGE_BUSY <from> <to>` to `arcade.log` and exits with code **3**. Logs a line per lifecycle event to `arcade.log`.
  - `server/open-browser.js`:
    - `export function browserCommands(url: string, { platform: string, isWsl: boolean, hasDisplay: boolean }): Array<[string, string[]]>`. darwin → `[['open',[url]]]`. win32 → `[['cmd',['/c','start','""',url]]]`. WSL → `[['wslview',[url]],['cmd.exe',['/c','start','""',url]]]`. Linux with display → `[['xdg-open',[url]]]`. Linux without display (`DISPLAY` and `WAYLAND_DISPLAY` unset, not WSL) → `[]`.
    - `export function detectEnv(): { platform, isWsl, hasDisplay }` (WSL = linux and `/proc/version` matches `/microsoft/i`)
    - `export async function openBrowser(url: string, env = detectEnv(), spawnFn = spawn): Promise<boolean>`. Tries candidates in order with `{ detached: true, stdio: 'ignore', windowsHide: true }`, `unref()`. Resolves true on the first candidate that emits `spawn` and does not emit `error` within 250 ms; false if none.
  - `server/cli.js`:
    - `export async function main(argv: string[], io = { env: process.env, out: (s) => void, err: (s) => void }, deps = { openBrowser, spawnServer, findRunning, fetch }): Promise<number /*exit code*/>`. Executed directly → `process.exit(await main(process.argv.slice(2)))`.
    - `export function checkNode(version: string): string|null` returns the message `Claude Arcade needs Node.js 20 or newer (found <v>). Install it from https://nodejs.org — nothing else is required.` when major < 20, else null. `main` calls it first and returns exit code 1 with that message.
    - Global flags via `parseGlobalFlags` (Task 1). `--mode/--port/--auto-open-delay` are copied into the env passed to the spawned server as `CLAUDE_PLUGIN_OPTION_MODE/_PORT/_AUTOOPENDELAY`; `--data-dir` → `CLAUDE_PLUGIN_DATA`.
    - `export async function ensureServer({ dir, env, deps }): Promise<Lock>`. If `findRunning(dir)` matches and `health.rootDir === pluginRoot`, reuse it. If it matches with a different `rootDir`, stop it (shutdown POST with its token) and start fresh. Starting: `spawn(process.execPath, [<pluginRoot>/server/main.js, '--data-dir', dir], { detached: true, windowsHide: true, stdio: ['ignore', logFd, logFd], env })`, `unref()`. Poll `findRunning` every 100 ms for up to 3000 ms. If the child exits with code 3, throw `PortRangeBusyError`. On timeout, throw `Error('Claude Arcade server did not start within 3s — see <dir>/arcade.log')`.
    - Commands and exact output:
      - `open [gameId]`: ensureServer; url = `http://127.0.0.1:<port>/` plus `#<gameId>` if the game is in the registry. An unknown id prints `Unknown game "<id>". Available: <ids comma-separated>` and opens the menu. If `openBrowser` succeeds, prints `Claude Arcade is running at <url>`. If not, prints `Claude Arcade is running at <url>` and `Couldn't open a browser automatically — open the URL above.` Port range busy prints `Ports <from>–<to> are all in use. Change the "port" option for the arcade plugin in /plugin.` and returns 1.
      - `start`: ensureServer, prints the URL, no browser.
      - `stop`: prints `Claude Arcade is not running.` (exit 0) or shuts down (POST with token; on failure `process.kill(pid)`), removes the lock, prints `Claude Arcade stopped.`
      - `status`: `Claude Arcade is running at <url> (mode: <mode>, <n> tab(s) open).` or `Claude Arcade is not running.`
      - `games`: one line per game `<id> — <title> (screen reader: <level>)`.
      - Unknown command prints usage and returns 2.
    - (`auto-open` comes in Task 10.)

- [ ] **Step 1: Write failing tests**

```js
// open-browser.test.js
test('command table per platform', () => {
  assert.deepEqual(browserCommands('u', { platform: 'darwin', isWsl: false, hasDisplay: true }), [['open', ['u']]]);
  assert.deepEqual(browserCommands('u', { platform: 'win32', isWsl: false, hasDisplay: true }), [['cmd', ['/c', 'start', '""', 'u']]]);
  assert.deepEqual(browserCommands('u', { platform: 'linux', isWsl: true, hasDisplay: false })[0], ['wslview', ['u']]);
  assert.deepEqual(browserCommands('u', { platform: 'linux', isWsl: false, hasDisplay: false }), []);
});
test('openBrowser falls through to the next candidate on error and returns false when none work', async () => { /* fake spawnFn emitting 'error' */ });

// cli.test.js  (real server in temp data dir; fake openBrowser)
test('checkNode rejects Node 18 with the install message', () => { assert.match(checkNode('18.19.0'), /Node\.js 20 or newer.*nodejs\.org/); assert.equal(checkNode('20.0.0'), null); });
test('open starts the server, prints the URL, and a second open reuses it', async () => { /* same pid in lock both times */ });
test('open with unknown game lists available games and still opens the menu', async () => {});
test('open prints the manual-URL hint when no browser can be opened', async () => {});
test('stop stops a running server; stop when not running exits 0 with message', async () => {});
test('ensureServer restarts a server from a different rootDir', async () => {
  /* fake findRunning returning health.rootDir '/old' → shutdown called with old token, new spawn happens */
});
test('port range busy prints the exact guidance and exits 1', async () => {});
test('--port flag reaches the spawned server', async () => { /* --port <free port> → lock.port === that port */ });
```

- [ ] **Step 2: Verify failure** → FAIL. **Step 3: Implement.** **Step 4: Verify pass** → PASS.
- [ ] **Step 5: Manual check (on your machine)**: `node server/cli.js open --data-dir ./.arcade-test-data` opens a browser to a page (index.html placeholder from the fixture is fine until Task 14); `node server/cli.js stop --data-dir ./.arcade-test-data` prints `Claude Arcade stopped.`
- [ ] **Step 6: Commit**: `git commit -s -m "feat(cli): server entry, browser opener and arcade CLI"`

---

### Task 10: `auto` mode timer

**Files:**
- Modify: `server/cli.js`
- Test: `test/unit/auto-open.test.js`

**Interfaces:**
- Consumes: `readStatus`, `updateStatus`, `markAutoOpened` (Task 3); `ensureServer`, `openBrowser` (Task 9).
- Produces: command `auto-open <sessionId> <delaySec>`, implemented as `export async function autoOpen({ sessionId, delaySec, dir, env, deps: { sleep, ensureServer, openBrowser, fetchHealth } }): Promise<'opened'|'skipped:not-working'|'skipped:already-opened'|'skipped:tab-open'|'skipped:mode'>`. It sleeps `delaySec`, then checks in order:
  1. resolved `mode === 'auto'` (re-read, since the user may have changed it);
  2. the session's state is still `working`;
  3. `autoOpened` is not set;
  4. if a server is running, its `health.clients === 0`.
  
  If all pass: `updateStatus(dir, s => markAutoOpened(s, sessionId))` **before** opening, then ensureServer and openBrowser. It never prints and always exits 0.

- [ ] **Step 1: Write failing tests**

```js
test('opens once when still working, no tab, auto mode', async () => { /* result 'opened', status autoOpened true, openBrowser called once */ });
test('second call for the same session is skipped', async () => { /* 'skipped:already-opened' */ });
test('skips when the session finished during the delay', async () => {});
test('skips when a tab is connected', async () => { /* fetchHealth → clients: 1 */ });
test('skips when mode changed away from auto during the delay', async () => {});
```

- [ ] **Step 2: Verify failure** → FAIL. **Step 3: Implement.** **Step 4: Verify pass** → PASS.
- [ ] **Step 5: Commit**: `git commit -s -m "feat(cli): auto-open timer for auto mode"`

---

### Task 11: Skills + real Claude Code verification

**Files:**
- Create: `skills/play/SKILL.md`, `skills/stop/SKILL.md`, `skills/games/SKILL.md`
- Test: `test/unit/skills.test.js`

**Interfaces:**
- Consumes: `server/cli.js` commands (Task 9).
- Produces: `/arcade:play [game-id]`, `/arcade:stop`, `/arcade:games`.

Each `SKILL.md` frontmatter: `description` (one sentence, user-facing), `disable-model-invocation: true`, `allowed-tools: Bash(node:*)`, and for play `argument-hint: "[game-id]"`. Body: run exactly one command, and relay its output to the user verbatim with no commentary. If the command fails because `node` is missing (`command not found`, `not recognized`), tell the user: "Claude Arcade needs Node.js 20 or newer. Install it from https://nodejs.org — nothing else is required." Commands:

```
node "${CLAUDE_PLUGIN_ROOT}/server/cli.js" open --data-dir "${CLAUDE_PLUGIN_DATA}" --mode "${user_config.mode}" --port "${user_config.port}" --auto-open-delay "${user_config.autoOpenDelay}" $ARGUMENTS
node "${CLAUDE_PLUGIN_ROOT}/server/cli.js" stop --data-dir "${CLAUDE_PLUGIN_DATA}"
node "${CLAUDE_PLUGIN_ROOT}/server/cli.js" games --data-dir "${CLAUDE_PLUGIN_DATA}"
```

- [ ] **Step 1: Write failing test** `skills.test.js`: each SKILL.md exists, its frontmatter has `disable-model-invocation: true`, and its body contains `server/cli.js" <command>` and `--data-dir`.
- [ ] **Step 2: Verify failure** → FAIL. **Step 3: Write the three skills.** **Step 4: Verify pass** → PASS.
- [ ] **Step 5: Real Claude Code verification (manual; record results in the PR description)**
  1. `claude plugin validate --strict .` → exits 0. Fix any warnings.
  2. `claude --plugin-dir .`, then run `/arcade:play`. Check that the browser opens. Then `cat` the data dir that the lock was written to. **Decision rule:** if it is under `~/.claude/plugins/data/…`, substitution works and nothing changes. If the lock landed in `~/.claude/arcade`, `${CLAUDE_PLUGIN_DATA}` was not substituted in the skill. In that case, change `dataDir()` in `server/paths.js` to skip `CLAUDE_PLUGIN_DATA` (so hooks also use `~/.claude/arcade`), update its test and §4.3 of the spec, and re-run `npm test`.
  3. Submit a prompt. Confirm `status.json` shows `working`, then `done` after Claude stops.
  4. Set mode `quiet` via `/plugin` config, re-run `/arcade:play`, and confirm `GET /api/settings` reports `quiet` (proves `${user_config.*}` substitution). If it does not substitute, drop those three flags from play/SKILL.md (the hook path still receives `CLAUDE_PLUGIN_OPTION_*`) and note in the README that mode changes made via `/plugin` apply after restarting the arcade.
  5. Confirm no `npm install` ran in the installed plugin directory (no `node_modules` created by Claude Code).
- [ ] **Step 6: Commit**: `git commit -s -m "feat(skills): play, stop and games skills"`

---

### Task 12: Shell pure modules: status summary, modes, input

**Files:**
- Create: `web/status-summary.js`, `web/modes.js`, `web/input.js`
- Test: `test/unit/web-status.test.js`, `test/unit/web-input.test.js`

**Interfaces:**
- Produces:
  - `web/status-summary.js`: `export function summarize(status: Status|null, { showProject: boolean, now: Date }): { state: 'offline'|'idle'|'working'|'needs-you'|'done', badge: string, banner: string|null, key: string|null }`.
    - `null` status → `offline`, badge `Offline — reconnecting…`.
    - Sessions with `updatedAt` older than 24 h are ignored.
    - Priority is `needs-you` > `done` > `working` > `idle`.
    - Badge text: idle `Claude is idle`; working `Claude is working…`; one needs-you → `<project> needs you` (no project: `Claude needs you`); n>1 → `<n> sessions need you`; one done → `Claude finished in <project>` (no project: `Claude finished`); n>1 → `<n> sessions finished`.
    - Banner text (only for needs-you/done): one session → the exact copy in Global Constraints; n>1 → the badge text.
    - `key` = sorted `sessionId@since` of the sessions in the winning state (so a dismissed banner stays dismissed until something changes).
  - `web/modes.js`: `export function reactionFor(mode: 'alert'|'auto'|'quiet', state): { pause: boolean, banner: boolean, chime: boolean, notify: boolean }`. alert/auto with `needs-you` or `done` → all true (chime/notify are still gated later by user prefs). Everything else → all false.
  - `web/input.js`:
    - `export const ACTIONS = ['up','down','left','right','primary','secondary','pause']`
    - `export const DEFAULT_KEYMAP = { ArrowUp:'up', KeyW:'up', ArrowDown:'down', KeyS:'down', ArrowLeft:'left', KeyA:'left', ArrowRight:'right', KeyD:'right', Enter:'primary', Space:'primary', ShiftLeft:'secondary', ShiftRight:'secondary', KeyX:'secondary', KeyP:'pause' }` (keyed by `KeyboardEvent.code`)
    - `export function actionForKey(code: string, keymap = DEFAULT_KEYMAP): string|null`
    - `export function swipeAction(dx: number, dy: number, threshold = 30): string|null`. The dominant axis wins; below threshold → `'primary'` (tap).
    - `export function createInput(target: EventTarget, { keymap }?): { on(action, fn), off(action, fn), emit(action), setEnabled(bool), destroy() }`. Listens for `keydown` (calls `preventDefault` for mapped keys, ignores `repeat` for `primary`/`secondary`/`pause`), `touchstart`/`touchend`. Handlers receive `{ action }`. Disabled while paused.

- [ ] **Step 1: Write failing tests**

```js
const now = new Date('2026-10-23T10:00:00Z');
const st = (sessions) => ({ version: 1, updatedAt: now.toISOString(), sessions });
const s = (state, project, mins = 1) => ({ state, project, since: new Date(now - mins * 60e3).toISOString(), updatedAt: new Date(now - mins * 60e3).toISOString() });
test('needs-you beats done beats working', () => {
  const r = summarize(st({ a: s('working', 'x'), b: s('done', 'y'), c: s('needs-you', 'z') }), { showProject: true, now });
  assert.equal(r.state, 'needs-you'); assert.equal(r.badge, 'z needs you'); assert.equal(r.banner, 'Claude needs you in z');
});
test('multiple and project-hidden phrasing', () => {
  assert.equal(summarize(st({ a: s('done', 'x'), b: s('done', 'y') }), { showProject: true, now }).badge, '2 sessions finished');
  assert.equal(summarize(st({ a: s('done', 'x') }), { showProject: false, now }).banner, 'Claude finished');
});
test('stale sessions (>24h) are ignored; null is offline', () => {
  assert.equal(summarize(st({ a: s('needs-you', 'x', 24 * 60 + 1) }), { showProject: true, now }).state, 'idle');
  assert.equal(summarize(null, { showProject: true, now }).badge, 'Offline — reconnecting…');
});
test('reactionFor per mode', () => {
  assert.deepEqual(reactionFor('quiet', 'needs-you'), { pause: false, banner: false, chime: false, notify: false });
  assert.equal(reactionFor('auto', 'done').pause, true);
  assert.equal(reactionFor('alert', 'working').pause, false);
});
// web-input.test.js
test('actionForKey and swipeAction', () => {
  assert.equal(actionForKey('KeyW'), 'up'); assert.equal(actionForKey('KeyQ'), null);
  assert.equal(swipeAction(50, 10), 'right'); assert.equal(swipeAction(-5, -40), 'up'); assert.equal(swipeAction(3, 4), 'primary');
});
test('createInput dispatches, respects setEnabled and destroy removes listeners', () => { /* use a Node EventTarget; dispatch Event with code */ });
```

- [ ] **Step 2: Verify failure** → FAIL. **Step 3: Implement.** **Step 4: Verify pass** → PASS.
- [ ] **Step 5: Commit**: `git commit -s -m "feat(web): status summary, mode reactions and input normalization"`

---

### Task 13: SDK context, prefs, game host

**Files:**
- Create: `web/sdk.js`, `web/prefs.js`, `web/game-host.js`
- Test: `test/unit/web-sdk.test.js`, `test/unit/web-game-host.test.js`

**Interfaces:**
- Consumes: `createInput` (Task 12).
- Produces:
  - `web/prefs.js`: `PREF_DEFAULTS = { sound: false, notifications: false, theme: 'system', reducedMotion: null /*null = follow OS*/, highContrast: false, colorblindPalette: false, showProject: true }`. `export function createPrefs({ storage, matchMedia }): { get(): Prefs /*with reducedMotion resolved to boolean*/, set(patch), onChange(fn) → unsubscribe }`. Persists under `localStorage` key `arcade:prefs`. Corrupt JSON → defaults.
  - `web/sdk.js`: `export function createContext({ gameId, root, input, prefs, announce, playSound, onScore, storage }): Ctx`.
    - `ctx.storage.get/set` uses key `arcade:<gameId>:<key>` with JSON; a parse error returns `undefined`; quota errors are swallowed.
    - `ctx.prefs` is a read-only snapshot object `{ reducedMotion, highContrast, sound, colorblindPalette }`, plus `onChange(fn)`.
    - `ctx.sound.play(name)` is a no-op when `prefs.sound` is false.
    - `ctx.reportScore(n)` ignores non-finite numbers.
    - `ctx.announce(text, { assertive })`.
    - `ctx.sdkVersion === 1`.
    - `ctx.input` exposes only `on`/`off`.
  - `web/game-host.js`:
    - `export function resolveGameId(hash: string, registryIds: string[]): string|null` returns the id only if `hash.replace(/^#/, '')` is exactly in `registryIds`.
    - `export function createGameHost({ onCrash: (gameId, err) => void }): { mount(gameId, createGame, ctx): void, pause(): void, resume(): void, unmount(): void, readonly state: 'empty'|'running'|'paused' }`. Every call into the game goes through a `safe(fn)` wrapper. Any throw (including from `createGame` or an invalid return shape missing one of `start/pause/resume/destroy`) → try `destroy`, set state `empty`, and call `onCrash`. `pause()`/`resume()` are idempotent. `mount` while running unmounts the previous game first.

- [ ] **Step 1: Write failing tests**

```js
test('resolveGameId only returns registered ids', () => {
  assert.equal(resolveGameId('#snake', ['snake', '2048']), 'snake');
  assert.equal(resolveGameId('#../../etc', ['snake']), null);
  assert.equal(resolveGameId('#Snake', ['snake']), null);
  assert.equal(resolveGameId('', ['snake']), null);
});
test('host runs lifecycle in order and pause/resume are idempotent', () => { /* recorder game; pause twice → one pause call */ });
test('a throwing game is destroyed and reported, host returns to empty', () => {
  /* createGame returns { start(){ throw new Error('x') }, … } → onCrash('g', err), state 'empty', destroy called */
});
test('invalid game shape is reported as a crash', () => {});
test('ctx.storage is namespaced and tolerant', () => {
  /* Map-backed storage; set('best', 5) → key 'arcade:snake:best' === '5'; corrupt value → undefined; setItem throwing → no throw */
});
test('sound.play is a no-op when sound is off; reportScore ignores NaN', () => {});
test('prefs persist, resolve reducedMotion from matchMedia when null, and notify subscribers', () => {});
```

- [ ] **Step 2: Verify failure** → FAIL. **Step 3: Implement.** **Step 4: Verify pass** → PASS.
- [ ] **Step 5: Commit**: `git commit -s -m "feat(web): game SDK context, prefs and crash-isolating game host"`

---

### Task 14: Shell UI (menu, badge, banner, settings panel) + E2E harness

**Files:**
- Create: `web/index.html`, `web/styles.css`, `web/shell.js`, `playwright.config.js`, `test/e2e/fixtures.js`, `test/e2e/shell.spec.js`
- Test: `test/e2e/shell.spec.js`

**Interfaces:**
- Consumes: Tasks 12–13; `/api/games`, `/api/settings`, `/events` (Tasks 7–8).
- Produces DOM hooks that E2E and later tasks rely on:
  - `#status-badge` (role `status`, `aria-live="polite"`), with `data-state` set to the summary state.
  - `#banner` (role `alert`) with buttons `Resume game` and `Dismiss`, hidden by `hidden` attribute.
  - `#menu` containing one `<button class="game-card" data-game-id="<id>">` per game. Each card shows the title, description, controls, session length, and `Screen reader: <level>`.
  - `#stage` (game root container). `document.body.dataset.game = <id or ''>` and `document.body.dataset.gameState = 'empty'|'running'|'paused'`.
  - `#settings` (a `<dialog>` opened by a `Settings` button) containing labelled controls for mode, auto-open delay, sound, browser notifications, theme, reduced motion, high contrast, colorblind palette, and show project name.
  - `#sr-announcer` (visually hidden, `aria-live="polite"`) and `#sr-announcer-assertive` (`aria-live="assertive"`).
- Behavior:
  - On load: fetch games, render menu, then `resolveGameId(location.hash, ids)` → mount if found; otherwise show the menu.
  - Selecting a card sets the hash and mounts via `import('/games/<id>/index.js')`.
  - `Esc` → pause, unmount, show menu, focus the card of the game just left.
  - `EventSource('/events')`: each `status` event runs `summarize` → update the badge. If `reactionFor(mode, state)` says so and the banner `key` differs from the last dismissed key: pause the game, show the banner, announce it assertively, play a short chime synthesized with the Web Audio API (no asset file) if `prefs.sound`, and show `new Notification(banner)` if `prefs.notifications` and permission is granted.
  - `onerror` → badge offline; the browser's EventSource auto-reconnects.
  - Banner `Resume game` → resume + hide. `Dismiss` → hide and remember `key`. A new `working` state hides the banner.
  - The settings dialog writes mode/delay via `POST /api/settings` and the rest via prefs. Notification permission is requested only when that toggle is switched on.
  - Themes: CSS custom properties on `:root` for light/dark (`prefers-color-scheme`, overridable via `data-theme`), a `.high-contrast` class, and a `.reduced-motion` class that disables transitions and animations. Focus is visible (`:focus-visible` outline ≥ 2px). The banner and badge use an icon/text in addition to colour.
- E2E harness: `test/e2e/fixtures.js` exports a Playwright `test` fixture that starts `createArcadeServer` on a free port with a temp data dir and the real `pluginRoot`, and provides `{ baseURL, dataDir, setStatus(sessions) }` (`setStatus` calls `writeStatusAtomic`). `playwright.config.js`: Chromium only, `testDir: 'test/e2e'`.

- [ ] **Step 1: Write failing E2E tests.** `games/` is still empty at this point, so the menu test asserts the empty-state text `No games installed.`. Task 19 replaces it with the real game list.

```js
test('badge reflects status and goes offline when the server stops', async ({ page, baseURL, setStatus }) => {
  await page.goto(baseURL);
  await expect(page.locator('#status-badge')).toHaveText('Claude is idle');
  await setStatus({ s1: { state: 'working', project: 'demo' } });
  await expect(page.locator('#status-badge')).toHaveText('Claude is working…');
});
test('needs-you shows the banner in alert mode and not in quiet mode', async ({ page, baseURL, setStatus }) => { /* POST /api/settings quiet → no banner, badge still updates */ });
test('dismissed banner stays hidden until state changes', async () => {});
test('settings dialog is keyboard operable and saves mode', async () => {});
```

- [ ] **Step 2: Verify failure**: `npx playwright install chromium && npm run test:e2e` → FAIL.
- [ ] **Step 3: Implement `index.html`, `styles.css`, `shell.js`.**
- [ ] **Step 4: Verify pass**: `npm run test:e2e` → PASS; `npm test` still PASS.
- [ ] **Step 5: Commit**: `git commit -s -m "feat(web): arcade shell UI with status badge, banner and settings"`

---

### Task 15: Contract test harness + game template

**Files:**
- Create: `test/helpers/fake-env.js`, `test/contract/games.test.js`, `templates/game/{game.json,index.js,logic.js,README.md}`, `templates/game/logic.test.js.example`
- Test: `test/contract/games.test.js`

**Interfaces:**
- Consumes: `validateManifest` (Task 5); `createContext` (Task 13).
- Produces:
  - `test/helpers/fake-env.js`: `export function installFakeEnv(): { document, activeTimers(): number, activeListeners(): number, restore(): void }`. It installs `globalThis.document` (a recursive stub DOM: `createElement` returns elements supporting `append/appendChild/remove/replaceChildren/setAttribute/removeAttribute/classList/style/dataset/textContent/children/querySelector(All)` returning stubs, `getContext('2d')` returning a Proxy whose methods are no-ops, and `addEventListener/removeEventListener` that are counted). It wraps `setTimeout/setInterval/clearTimeout/clearInterval/requestAnimationFrame/cancelAnimationFrame` to count live handles. `restore()` puts the originals back.
  - `test/contract/games.test.js`: for each folder in `games/` **and** `templates/game`, run:
    1. `game.json` passes `validateManifest(m, folderName)`. For `templates/game` only, `folderName` is `m.id` (`counter`), because the template folder is deliberately named `game`;
    2. `index.js` default export is a function;
    3. with fake env + `createContext` (in-memory storage, no-op announce/sound): `start → pause → resume → destroy`. After `destroy`, `activeTimers() === 0`, `activeListeners() === 0`, and the number of `ctx.input` handlers registered equals the number removed;
    4. no source file in the folder matches `/https?:\/\/(?!www\.w3\.org\/)|\bfetch\s*\(|XMLHttpRequest|WebSocket|\bimport\s*\(/`;
    5. total folder size ≤ 204800 bytes;
    6. `README.md` exists.
  - `templates/game/`: a minimal "Counter" game (`id: "counter"`, primary = +1, announces the count, reports the score) that passes the contract, with comments marking what to replace. Its `logic.test.js.example` shows a `node:test` test of `logic.js`; contributors rename it into `test/unit/<id>.test.js`.

- [ ] **Step 1: Write the contract test first.** Run: `node --test test/contract/games.test.js`. Expected: FAIL (template missing).
- [ ] **Step 2: Add a deliberately leaky copy of the template under the temp dir in a self-test** (`fake-env self-test: a game that leaves an interval running fails the timer check`) so the harness is proven to catch leaks.
- [ ] **Step 3: Implement `fake-env.js` and `templates/game/`.**
- [ ] **Step 4: Verify pass**: `npm test` → PASS.
- [ ] **Step 5: Commit**: `git commit -s -m "test: game contract harness and contributor template"`

---

### Task 16: 2048

**Files:**
- Create: `games/2048/{game.json,index.js,logic.js,README.md}`
- Test: `test/unit/game-2048.test.js` (the contract test picks the folder up automatically)

**Interfaces:**
- Consumes: SDK `ctx` (Task 13).
- Produces (`games/2048/logic.js`), with `Board = number[][]` (0 = empty) and `Dir = 'up'|'down'|'left'|'right'`:
  - `export function emptyBoard(size = 4): Board`
  - `export function spawnTile(board, rng: () => number): Board` (a new board; places 2 with probability 0.9 and 4 otherwise into a random empty cell; unchanged if full)
  - `export function newGame(rng, size = 4): Board` (two spawned tiles)
  - `export function move(board, dir: Dir): { board: Board, moved: boolean, gained: number, merged: number[] }` (each tile merges at most once per move; `merged` lists the resulting values)
  - `export function hasMoves(board): boolean`
  - `export function maxTile(board): number`
- `game.json`: `id "2048"`, `title "2048"`, `screenReader "full"`, `sessionLength "untimed"`, `reducedMotion true`, `colorIndependent true`.
- `index.js`: DOM grid (`role="grid"`, cells `role="gridcell"` with `aria-label` = value or `empty`). Arrow actions move. After each move, `announce`: `Merged 8 and 4. Score 120.` or `No move.`. A win (2048 tile) and a loss (`!hasMoves`) are announced assertively, with a `New game` button. Best score goes in `ctx.storage` key `best`; calls `reportScore`. Tile values are shown as text (colour is decoration only). No animation when `prefs.reducedMotion`.

- [ ] **Step 1: Write failing tests**

```js
test('left merges pairs once', () => {
  assert.deepEqual(move([[2,2,2,2],[0,0,0,0],[0,0,0,0],[0,0,0,0]], 'left').board[0], [4,4,0,0]);
  assert.deepEqual(move([[2,2,4,0],[0,0,0,0],[0,0,0,0],[0,0,0,0]], 'left').board[0], [4,4,0,0]);
});
test('right and gained score', () => {
  const r = move([[2,2,2,0],[0,0,0,0],[0,0,0,0],[0,0,0,0]], 'right');
  assert.deepEqual(r.board[0], [0,0,2,4]); assert.equal(r.gained, 4); assert.deepEqual(r.merged, [4]);
});
test('up and down operate on columns', () => {});
test('no-op move reports moved=false and returns an equal board', () => {});
test('spawnTile uses rng for value and position and never overwrites', () => { /* rng sequence [0, 0.95] → first empty cell gets 4 */ });
test('hasMoves false only when full with no adjacent equals', () => {});
```

- [ ] **Step 2: Verify failure** → FAIL. **Step 3: Implement `logic.js`, then `index.js`, `game.json`, `README.md`.**
- [ ] **Step 4: Verify pass**: `npm test` → PASS, including the contract test for `games/2048`.
- [ ] **Step 5: Commit**: `git commit -s -m "feat(games): add 2048"`

---

### Task 17: Minesweeper

**Files:**
- Create: `games/minesweeper/{game.json,index.js,logic.js,README.md}`
- Test: `test/unit/game-minesweeper.test.js`

**Interfaces:**
- Produces (`games/minesweeper/logic.js`), with `Cell = { mine: boolean, revealed: boolean, flagged: boolean, adjacent: number }` and `Field = { rows, cols, mines, cells: Cell[][], started: boolean, over: 'won'|'lost'|null }`:
  - `export function createField({ rows = 9, cols = 9, mines = 10 } = {}): Field` (no mines placed yet)
  - `export function reveal(field, r, c, rng): { revealed: Array<[number, number]>, exploded: boolean }`. Mutates `field`. On the first reveal it places `mines` mines uniformly at random, excluding `(r,c)` **and its neighbours**, then computes `adjacent`. Revealing a 0 flood-fills (iteratively, not recursively) through zeros and their borders. Flagged or revealed cells are no-ops. Revealing a mine sets `over = 'lost'`. Revealing the last safe cell sets `over = 'won'`.
  - `export function toggleFlag(field, r, c): boolean` (new flagged state; no-op on revealed cells or when over)
  - `export function describeCell(field, r, c): string`: `hidden`, `flagged`, `mine`, `empty`, or `<n> adjacent mine(s)` (`1 adjacent mine`, `2 adjacent mines`)
- `game.json`: `id "minesweeper"`, `screenReader "full"`, `sessionLength "medium"`.
- `index.js`: a grid of buttons with a keyboard cursor (roving `tabindex`). Arrows move the cursor, `primary` reveals, `secondary` flags. A pointer click reveals and a right-click/long-press flags (element listeners on the game's own buttons, removed in `destroy`). Each cursor move announces `Row <r>, column <c>: <describeCell>`. It also announces the remaining mine count after a flag, and win/loss assertively. A timer shows elapsed seconds, paused by `pause()`. The best time goes in `storage` key `best`.

- [ ] **Step 1: Write failing tests**

```js
test('first reveal is always safe including neighbours (1000 seeds)', () => {
  for (let seed = 0; seed < 1000; seed++) {
    const f = createField(); const r = reveal(f, 4, 4, mulberry32(seed));
    assert.equal(r.exploded, false);
    for (const [dr, dc] of NEIGHBOURS_AND_SELF) assert.equal(f.cells[4 + dr][4 + dc].mine, false);
    assert.equal(f.cells.flat().filter(c => c.mine).length, 10);
  }
});
test('flood fill reveals the zero region and its border only', () => { /* hand-built field with known mines */ });
test('flags block reveal; toggleFlag no-op on revealed', () => {});
test('revealing a mine loses; revealing all safe cells wins', () => {});
test('describeCell phrasing', () => { /* 1 adjacent mine / 2 adjacent mines / empty / flagged / hidden */ });
test('flood fill on a 50x50 empty-ish field does not overflow the stack', () => {});
```

(`mulberry32` is a seeded RNG helper in `test/helpers/rng.js`: `export function mulberry32(seed: number): () => number`.)

- [ ] **Step 2: Verify failure** → FAIL. **Step 3: Implement.** **Step 4: Verify pass**: `npm test` → PASS.
- [ ] **Step 5: Commit**: `git commit -s -m "feat(games): add Minesweeper"`

---

### Task 18: Snake

**Files:**
- Create: `games/snake/{game.json,index.js,logic.js,README.md}`
- Test: `test/unit/game-snake.test.js`

**Interfaces:**
- Produces (`games/snake/logic.js`), with `Point = { x, y }` and `SnakeState = { cols, rows, body: Point[] /*head first*/, dir: Dir, pendingDir: Dir, food: Point, alive: boolean, score: number }`:
  - `export function createSnake({ cols = 20, rows = 20, rng }): SnakeState` (length 3 at the centre, heading right; food is never on the body)
  - `export function turn(state, dir): SnakeState` (sets `pendingDir`; ignores a direct reversal of `dir`)
  - `export function step(state, rng): SnakeState` (applies `pendingDir` and moves one cell. Wall → `alive=false` (no wrap). Self-collision → `alive=false`; moving into the cell the tail is vacating this step is allowed. Food → grow by 1, `score+1`, new food on a free cell. A full board → `alive=false` with a win.)
  - `export const TICK_MS = 120`, `export const TICK_MS_REDUCED_MOTION = 200`
- `game.json`: `id "snake"`, `screenReader "none"`, `reducedMotion true`, `sessionLength "short"`, `colorIndependent true` (head, body and food differ in shape, not just colour).
- `index.js`: a canvas sized to `ctx.root`. The loop is `setTimeout` at `TICK_MS` (or the reduced-motion tick). `pause()` clears the timer and `resume()` restarts it. Arrow actions turn; `primary` restarts after death. It announces the final score assertively. Best score goes in `storage` key `best`.

- [ ] **Step 1: Write failing tests**: movement one cell per step; reversal ignored; wall death; self-collision death; tail-chasing allowed; eating grows and moves food off the body (seeded rng); two turns within one tick are not able to reverse (`turn(up)`, `turn(left)` while heading right → the second is evaluated against `dir`, not `pendingDir`, so heading left is still a reversal and is ignored).
- [ ] **Step 2: Verify failure** → FAIL. **Step 3: Implement.** **Step 4: Verify pass**: `npm test` → PASS.
- [ ] **Step 5: Commit**: `git commit -s -m "feat(games): add Snake"`

---

### Task 19: Full E2E and accessibility scan

**Files:**
- Create: `test/e2e/games.spec.js`, `test/e2e/a11y.spec.js`
- Modify: `test/e2e/shell.spec.js` (the menu now has 3 games)

**Interfaces:**
- Consumes: the DOM hooks from Task 14 and the three games.

- [ ] **Step 1: Write the tests**

```js
for (const id of ['2048', 'minesweeper', 'snake']) {
  test(`${id}: launches from the menu, pauses on needs-you, resumes`, async ({ page, baseURL, setStatus }) => {
    await page.goto(baseURL);
    await page.locator(`[data-game-id="${id}"]`).click();
    await expect(page.locator('body')).toHaveAttribute('data-game-state', 'running');
    await setStatus({ s1: { state: 'needs-you', project: 'demo' } });
    await expect(page.locator('#banner')).toContainText('Claude needs you in demo');
    await expect(page.locator('body')).toHaveAttribute('data-game-state', 'paused');
    await page.getByRole('button', { name: 'Resume game' }).click();
    await expect(page.locator('body')).toHaveAttribute('data-game-state', 'running');
  });
}
test('Esc returns to the menu and focuses the last game card', async () => {});
test('unknown or malicious hash shows the menu and loads no module', async ({ page, baseURL }) => {
  const requests = []; page.on('request', r => requests.push(r.url()));
  await page.goto(`${baseURL}/#../../server/cli`);
  await expect(page.locator('#menu')).toBeVisible();
  assert.ok(!requests.some(u => u.includes('/server/')));
});
test('a crashing game shows the crash message and the menu still works', async () => {
  // route /games/2048/index.js to a module whose start() throws → text "This game crashed — back to menu"
});
test('2048 and Minesweeper are fully keyboard playable', async () => { /* arrows + Enter change announced text in #sr-announcer */ });
// a11y.spec.js
test('menu, settings dialog and banner have no serious/critical axe violations', async ({ page }) => {
  // AxeBuilder({ page }).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze(); filter impact serious|critical → []
  // run on: menu; settings open; banner shown; high-contrast on
});
```

- [ ] **Step 2: Run**: `npm run test:e2e`. Fix the shell or games until PASS. Do not loosen assertions or skip tests.
- [ ] **Step 3: Commit**: `git commit -s -m "test(e2e): game flows, crash isolation and axe accessibility scan"`

---

### Task 20: CI, release and DCO workflows

**Files:**
- Create: `.github/workflows/ci.yml`, `.github/workflows/release.yml`, `.github/workflows/dco.yml`, `scripts/check-release.js`, `scripts/check-dco.js`, `.github/dependabot.yml`
- Test: `test/unit/scripts.test.js`

**Interfaces:**
- Produces:
  - `scripts/check-release.js`: `export function checkRelease({ pluginJson, changelog, tag }): string[]` returns errors. `tag` must equal `v<version>`, and the first `## [x.y.z]` heading in `CHANGELOG.md` must equal the version. CLI usage: `node scripts/check-release.js <tag>`, exit 1 on errors.
  - `scripts/check-dco.js`: `export function missingSignoff(commits: Array<{ sha, message, authorEmail }>): string[]` returns the SHAs lacking `Signed-off-by: <name> <authorEmail>`. CLI reads `git log --format=%H%x00%ae%x00%B%x1e <base>..<head>`.
  - `ci.yml` (on push to main and pull_request) has these jobs:
    - `lint`: ubuntu, Node 22. `npm install`, `npm run lint`, `npm run format:check`.
    - `test`: matrix `os: [ubuntu-latest, macos-latest, windows-latest]` × `node: [20, 22, 24]`, `fail-fast: false`. `npm install`, `npm test`.
    - `e2e`: ubuntu, Node 22. `npm install`, `npx playwright install --with-deps chromium`, `npm run test:e2e`. Uploads `playwright-report` on failure.
    - `validate`: ubuntu, Node 22. `npm install -g @anthropic-ai/claude-code`, `claude plugin validate --strict .`.
    
    Workflow `permissions: contents: read`; actions are pinned to major versions (`actions/checkout@v4`, `actions/setup-node@v4`, `actions/upload-artifact@v4`).
  - `release.yml` (on push of tags `v*`): run `node scripts/check-release.js ${{ github.ref_name }}`, then create a GitHub Release with the CHANGELOG section as notes (`gh release create` using `GITHUB_TOKEN`; `permissions: contents: write`).
  - `dco.yml` (pull_request): `node scripts/check-dco.js origin/${{ github.base_ref }} HEAD` with `fetch-depth: 0`.
  - `dependabot.yml`: npm (weekly, dev deps) and github-actions (weekly).

- [ ] **Step 1: Write failing tests** for `checkRelease` (matching tag/version/changelog → []; mismatched tag → error; changelog top entry `Unreleased` followed by `0.1.0` → uses the first versioned heading) and `missingSignoff` (missing, present, wrong email).
- [ ] **Step 2: Verify failure** → FAIL. **Step 3: Implement scripts and workflows.** **Step 4: Verify pass**: `npm test` → PASS. Push the branch and confirm all four `ci.yml` jobs start and pass (GitHub validates workflow syntax on push).
- [ ] **Step 5: Commit**: `git commit -s -m "ci: test matrix, e2e, plugin validation, release and DCO checks"`

---

### Task 21: Community and documentation

**Files:**
- Create: `README.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, `CHANGELOG.md`, `docs/architecture.md`, `docs/game-authoring.md`, `.github/ISSUE_TEMPLATE/{bug.yml,feature.yml,game-proposal.yml,config.yml}`, `.github/pull_request_template.md`, `.github/CODEOWNERS`, `.github/labels.md`
- Test: `test/unit/docs.test.js`

**Interfaces:**
- Content requirements (from spec §11–§12):
  - `README.md`: one-line pitch; demo GIF placeholder path `docs/media/demo.gif` (record it in Task 22); requirements (Claude Code, Node ≥ 20); the two install commands with marketplace name `claude-arcade` (`/plugin marketplace add <owner>/arcade`, `/plugin install arcade@claude-arcade`); usage (`/arcade:play [game]`, `/arcade:stop`, `/arcade:games`), including the "open once per session, leave the tab open" note; a modes table; settings; accessibility statement with per-game screen-reader levels; privacy statement; troubleshooting (Node missing, ports busy, no browser/SSH, where `arcade.log` lives); a contributing pointer; license.
  - `CONTRIBUTING.md`: setup (`git clone`, `npm install`, `npx playwright install chromium`, `claude --plugin-dir .`); `npm test`, `npm run test:e2e`, `npm run lint`; DCO sign-off explained; "add a game in 5 steps" linking to `docs/game-authoring.md`; content policy (no network, tracking, violent/adult content; original or compatibly licensed assets with attribution in the game README); PR expectations; where to ask questions.
  - `CODE_OF_CONDUCT.md`: Contributor Covenant 2.1 verbatim, with the enforcement contact set to the maintainer email or GitHub private reporting.
  - `SECURITY.md`: supported versions; report via GitHub Security Advisories; the localhost threat model (Host/Origin checks, path confinement, CSP, shutdown token, no network).
  - `CHANGELOG.md`: Keep a Changelog format, with `## [Unreleased]` and `## [0.1.0] - <release date>` listing the features.
  - `docs/game-authoring.md`: the copy-template workflow, the `game.json` field reference (mirrors §5.1), the full `ctx` API table, the rules list, an accessibility checklist, testing your logic, and size and asset rules.
  - `docs/architecture.md`: the condensed spec diagram (hook → status.json → server → SSE → shell), plus module responsibilities from this plan's File Structure.
  - Issue forms: bug (OS, Node version, Claude Code version, mode, `arcade.log` excerpt), feature, and game proposal (concept, controls, screen-reader plan, session length). `config.yml` has blank issues disabled.
  - The PR template has an accessibility checklist (keyboard-only playable, announcements, no colour-only info, reduced motion honoured, no flashing > 3/s) and a DCO reminder.
  - `CODEOWNERS`: `* @<owner>`, plus `/server/ /hooks/ /web/ /schemas/ /.github/ @<owner>`. A comment explains that game authors add a line for their folder.
  - `.github/labels.md`: the labels to create (`good first issue`, `new-game`, `a11y`, `bug`, `enhancement`).
- [ ] **Step 1: Write failing test** `docs.test.js`: required files exist; the README contains both install commands and `Node.js 20`; `CHANGELOG.md` contains `## [0.1.0]`; every `ctx` member named in `web/sdk.js` (read the exported key list from `Object.keys(createContext(stubArgs))`) appears in `docs/game-authoring.md`.
- [ ] **Step 2: Verify failure** → FAIL. **Step 3: Write the docs.** **Step 4: Verify pass**: `npm test` → PASS; `npm run format:check` → clean.
- [ ] **Step 5: Commit**: `git commit -s -m "docs: README, contributing guide, code of conduct, security policy and templates"`

---

### Task 22: Release readiness verification

**Files:**
- Create: `docs/media/demo.gif`
- Modify: `CHANGELOG.md` (release date), `.claude-plugin/plugin.json` (confirm `0.1.0`)

- [ ] **Step 1: Full local checks**: `npm run lint && npm run format:check && npm test && npm run test:e2e && claude plugin validate --strict .` → all pass.
- [ ] **Step 2: Real install from the marketplace path**: in a scratch directory run `claude`, then `/plugin marketplace add <path-to-repo>` and `/plugin install arcade@claude-arcade`. Run `/arcade:play`, play each game, submit a prompt, and confirm the pause plus banner on Stop. Confirm `/arcade:games` and `/arcade:stop` work. Confirm no `node_modules` appeared in the installed plugin directory.
- [ ] **Step 3: Windows check**: on a Windows machine (or the CI windows job logs), confirm `npm test` passes. If a Windows machine with Claude Code is available, repeat Step 2 in PowerShell without Git Bash.
- [ ] **Step 4: Record `docs/media/demo.gif`** (≤ 2 MB): play 2048, Claude finishes, banner, resume.
- [ ] **Step 5: CI green** on the PR across the whole matrix.
- [ ] **Step 6: Commit**: `git commit -s -m "chore: release readiness for v0.1.0"`
