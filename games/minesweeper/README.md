# Minesweeper

Clear a 9x9 minefield with 10 mines. A number shows how many of the eight
neighbouring cells hold a mine. Reveal every safe cell to win; reveal a mine and you lose.
The first reveal is always safe, and so are its neighbours.

## Controls

- Arrow keys: move the cursor (the focused cell).
- Enter/Space: reveal the cursor cell. After the game ends, start a new game.
- Shift or X: flag or unflag the cursor cell.
- Mouse: click reveals, right-click flags. Touch: tap reveals, long-press (0.5 s) flags.
- The `New game` button works any time.

## Scoring

The score is your clear time in seconds, and lower is better. It is saved in `ctx.storage`
under `best`. The game deliberately does not call `reportScore`: the shell treats scores
as higher-is-better, which would invert a time. The timer starts on the first reveal and
stops when the game ends or is paused.

## Accessibility

- The board is a `role="grid"` of buttons with `aria-rowindex`/`aria-colindex`. Only the cursor cell is in the tab order (roving `tabindex`).
- Every cell has an `aria-label` (`hidden`, `flagged`, `empty`, `mine`, `3 adjacent mines`) and shows a text glyph, so colour is never the only signal.
- Each cursor move announces `Row 3, column 5: hidden`. Revealing announces the cell (and `Opened 12 cells.` after a flood). Flagging announces `Flagged. 9 mines remaining.`
- Winning and losing are announced assertively. After the game ends, every action says `Game over. Press Enter for a new game.`
- Cells update in place, so a screen reader keeps its position between moves.

## Implementation notes

- Rules and helpers live in `logic.js`, unit-tested in `test/unit/game-minesweeper.test.js`. Flood fill is iterative.
- Pointer handling is delegated from the grid element and removed in `destroy()`. A touch tap also arrives as a `primary` input, so input within 50 ms of a pointer event is ignored (`isPointerEcho`). Keyboard-generated clicks (`detail` 0) are ignored because `ctx.input` already handled the key.
- Styling uses inline CSSOM styles and shell CSS variables, because the CSP forbids extra stylesheets.
