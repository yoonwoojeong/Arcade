# Authoring a game

A game is a folder in `games/` with a manifest and a small ES module. This guide takes you from an empty
folder to a pull request. If something is unclear, please open an issue: improving this guide is a great
first contribution too.

## The copy-template workflow

```
cp -r templates/game games/<id>
```

`<id>` is lowercase letters, digits and dashes, 2 to 31 characters, starting with a letter or digit
(`^[a-z0-9][a-z0-9-]{1,30}$`). Then:

1. Edit `games/<id>/game.json`: set `id` (must equal the folder name) and `title`; the template id is
   `counter`.
2. Write the game in `games/<id>/index.js`.
3. Put the rules in `games/<id>/logic.js`, with no DOM, so Node can test them.
4. Replace the template README with a description of your game (controls, scoring, accessibility,
   asset credits).
5. Run `npm test`. The contract test finds your game automatically.

A game folder contains `game.json`, `index.js`, `README.md`, and optionally `logic.js` and `assets/`.

## `game.json` reference

The manifest is validated against [`schemas/game.schema.json`](../schemas/game.schema.json). Unknown
fields are rejected.

| Field                            | Type     | Required | Rules                                                           |
| -------------------------------- | -------- | -------- | --------------------------------------------------------------- |
| `id`                             | string   | yes      | Equals the folder name; `^[a-z0-9][a-z0-9-]{1,30}$`             |
| `title`                          | string   | yes      | 1 to 40 characters                                              |
| `version`                        | string   | yes      | Semantic version, `x.y.z`                                       |
| `sdk`                            | number   | yes      | Must be `1`                                                     |
| `author`                         | string   | yes      | Your GitHub handle                                              |
| `description`                    | string   | yes      | 1 to 140 characters, shown on the menu card                     |
| `controls.keyboard`              | string[] | yes      | At least one entry, e.g. `"Arrows/WASD: move"`                  |
| `controls.touch`                 | string   | no       | e.g. `"swipe"` or `"tap"`                                       |
| `accessibility.screenReader`     | enum     | yes      | `full`, `partial` or `none`; the menu displays it, so be honest |
| `accessibility.reducedMotion`    | boolean  | yes      | `true` if the game honours the reduced-motion preference        |
| `accessibility.colorIndependent` | boolean  | yes      | `true` if no information depends on colour alone                |
| `sessionLength`                  | enum     | yes      | `short` (under 2 minutes), `medium` or `untimed`                |

Example:

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

A game with an invalid manifest is left out of the arcade (a warning goes to `arcade.log`) and fails CI.

## The game module

`index.js` default-exports a factory. The shell calls it once with the SDK context, then drives the
returned object:

```js
export default function createGame(ctx) {
  return {
    start() {}, // build your UI in ctx.root, register input, start your loop
    pause() {}, // stop the loop and timers; the shell calls this when Claude needs the user
    resume() {}, // restart the loop
    destroy() {}, // release everything
  };
}
```

`Esc` leaves the game: the shell calls `pause()`, then `destroy()`, and returns to the menu with
focus on the game's card, so unsaved game state is lost (use `ctx.storage` for anything worth keeping).
If any lifecycle call throws, the shell destroys the
game, shows "This game crashed — back to menu", and the arcade carries on.

## The `ctx` API (SDK v1)

| Member                                                   | Description                                                                                                                                                                                                                 |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ctx.root`                                               | The container element your game owns. Build all of your DOM inside it.                                                                                                                                                      |
| `ctx.input.on(action, fn)` / `ctx.input.off(action, fn)` | Normalised actions: `up`, `down`, `left`, `right`, `primary`, `secondary`, `pause`. Keyboard defaults: arrows/WASD, Enter/Space, Shift/X, P. Touch: swipe and tap. Pass the same function to `off` that you passed to `on`. |
| `ctx.storage.get(key)` / `ctx.storage.set(key, value)`   | JSON-serialisable values, namespaced `arcade:<id>:` in `localStorage`. `get` returns `undefined` when missing; failures are swallowed.                                                                                      |
| `ctx.prefs`                                              | A live snapshot: `{ reducedMotion, highContrast, sound, colorblindPalette }`, plus `ctx.prefs.onChange(fn)`, which returns an unsubscribe function. Released for you on destroy.                                            |
| `ctx.announce(text, { assertive })`                      | Writes to the shell's `aria-live` region. Polite by default; pass `{ assertive: true }` for urgent news such as game over.                                                                                                  |
| `ctx.sound.play(name)`                                   | Plays `assets/<name>.ogg` or `.mp3` from your folder. A no-op when the user has sound off (the default).                                                                                                                    |
| `ctx.reportScore(n)`                                     | Tells the shell your score so it can track and show a high score. Non-finite numbers are ignored.                                                                                                                           |
| `ctx.sdkVersion`                                         | `1`                                                                                                                                                                                                                         |

The authoritative implementation is [`web/sdk.js`](../web/sdk.js). Backward-compatible additions keep
`sdk: 1`; a breaking change would introduce `sdk: 2`.

### Styling

Games have no stylesheet of their own. Style your elements through the DOM (`element.style`, the
CSSOM) using the shell's CSS custom properties, so themes, high contrast and the colourblind palette
work for free: `--bg`, `--surface`, `--surface-2`, `--fg`, `--muted`, `--border`, `--accent`,
`--accent-fg`, `--focus`, `--working`, `--needs-you`, `--done`. See [`web/styles.css`](../web/styles.css)
for the full list. Canvas games can read the values with `getComputedStyle` and should re-read them when
`ctx.prefs.onChange` fires.

## Rules

The contract test enforces most of these. It is a best-effort lint, not a sandbox, and reviewers check
the rest.

- **No network.** No `http(s)://` URLs, `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`,
  `sendBeacon`, workers, or dynamic `import()`.
- **No code generation or foreign resources.** No `eval`, `new Function`, and no creating `<script>` or
  `<link>` elements (the contract test rejects these). Do not create `<style>` elements either: the
  Content-Security-Policy blocks them, so style through the CSSOM.
- **Relative imports only**, and only inside your own game folder.
- **Input only through `ctx.input`**, so remapping and touch work for every game. Clicking elements your
  game created inside `ctx.root` is allowed, as long as `destroy()` removes those listeners.
- **The shell controls pausing.** `pause()` must stop your loop and timers.
- **`destroy()` releases everything:** timers, animation frames, listeners, and every `ctx.input.on`
  needs a matching `ctx.input.off`.
- **At most 200 KB** for the whole folder.
- **A `README.md`** in the folder.
- Keep game rules in a DOM-free `logic.js` where practical.

## Accessibility checklist

- [ ] Fully playable with the keyboard alone, with a visible focus indicator
- [ ] Declared `screenReader` level is honest (`full`, `partial` or `none`)
- [ ] Important state changes use `ctx.announce` (use `assertive` sparingly)
- [ ] No information is conveyed by colour alone (use shape, text or pattern as well)
- [ ] `ctx.prefs.reducedMotion` is honoured (Snake slows down rather than dropping animation)
- [ ] `highContrast` and `colorblindPalette` work, usually by using the shell's colour variables
- [ ] Nothing flashes more than 3 times per second
- [ ] Touch: gestures map to the same actions (swipe and tap come from `ctx.input`)
- [ ] Controls are listed in `game.json` and your README

## Testing your logic

Because `logic.js` has no DOM, you can test it in Node. `templates/game/logic.test.js.example` shows
the shape. Copy it to `test/unit/<id>.test.js` and fix the import path:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCounter, increment } from '../../games/<id>/logic.js';

test('increment adds one', () => {
  assert.equal(increment(createCounter()).count, 1);
});
```

Run `npm test` for unit and contract tests, `npm run test:e2e` to see your game in a real browser, and
`npm run lint` and `npm run format:check` before you push. To play it, run `claude --plugin-dir .` and
`/arcade:play <id>`.

## Size and asset rules

- The whole game folder must be at most 200 KB, assets included. Prefer small `.ogg` files, and
  generate graphics in code or inline SVG where you can.
- Put sounds in `assets/` and refer to them by name: `ctx.sound.play('pop')` plays `assets/pop.ogg` or
  `assets/pop.mp3`.
- Assets must be original or under a license compatible with Apache-2.0. Credit the author, source and
  license in your game's README.
- Content must be suitable for work: no violence or adult themes, no tracking.

## Submitting

Commit with `git commit -s` (see [CONTRIBUTING.md](../CONTRIBUTING.md)), open a pull request, and fill in
the template. Maintainers will help you with anything CI flags.
