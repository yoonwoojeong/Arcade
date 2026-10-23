# 2048

Slide numbered tiles on a 4x4 board. Tiles with the same number merge into one
with double the value. Reach 2048 to win, then keep going for a higher score.
The game ends when the board is full and no move is possible.

## Controls

- Arrow keys (or swipe): slide every tile in that direction.
- Enter/Space: start a new game once the game is over. The `New game` button also works any time.

## Scoring

Each merge adds the value of the new tile to your score. Your best score is saved
in `ctx.storage` under `best`, and every score change is sent with `reportScore`.

## Accessibility

- The board is a `role="grid"` with rows and `gridcell`s; each cell's `aria-label` is its value or `empty`.
- Colour is decoration only: every tile shows its value as text, and colours use the shell theme tokens, so high contrast works.
- After each move the game announces `Merged 8 and 4. Score 120.`, `Moved. Score 120.` or `No move.`.
  Winning (2048) and losing are announced assertively.
- With reduced motion enabled there is no animation.

## Files

- `logic.js`: pure rules (`move`, `spawnTile`, `hasMoves`, ...), unit-tested in `test/unit/game-2048.test.js`.
- `index.js`: DOM, input and announcements. Styling uses inline CSSOM styles and shell CSS variables, because the CSP forbids extra stylesheets.
