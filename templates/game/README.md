# Counter (game template)

The starting point for a new Claude Arcade game. See the SDK contract in the
design spec, section 5.1.

## Make your game

1. Copy the template: `cp -r templates/game games/<id>`
2. Edit `games/<id>/game.json`: set `id` (must equal the folder name, lowercase
   letters, digits and dashes) and `title`, plus author, description and controls.
3. Implement your game in `index.js` and put the rules in `logic.js`
   (no DOM there, so they can be unit-tested).
4. Optional: rename `logic.test.js.example` to `test/unit/<id>.test.js` and fix its import.
5. Run `npm test`. The contract test checks your game automatically.

## Rules the contract test enforces

- `game.json` is valid and `index.js` default-exports `createGame(ctx)`.
- After `start`, `pause`, `resume`, `destroy`: no timers, animation frames or
  listeners left, and every `ctx.input.on` has a matching `ctx.input.off`.
- No network: no `http(s)://`, `fetch`, `XMLHttpRequest`, `WebSocket` or `import()`.
- The folder is at most 200 KB and contains this `README.md`.
