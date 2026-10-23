# Minesweeper

Clear a 9x9 minefield with 10 mines. A number shows how many of the eight
neighbouring cells hold a mine. Reveal every safe cell to win; reveal a mine and you lose.
The first reveal is always safe, and so are its neighbours.

## Controls

- Arrow keys: move the cursor (the focused cell).
- Enter/Space: reveal the cursor cell. After the game ends, start a new game.
- Shift or X: flag or unflag the cursor cell.
- Mouse: click reveals, right-click flags. Touch or pen: tap reveals, long-press (0.5 s) flags.
- The `New game` button works any time.

## Scoring

The score is your clear time in seconds, and lower is better. It is saved in `ctx.storage`
under `best`. The game deliberately does not call `reportScore`: the shell treats scores
as higher-is-better, which would invert a time. The timer starts on the first reveal and
stops when the game ends or is paused; elapsed time is computed from `Date.now()`, so a slow interval cannot drift it.

## Accessibility

- The board is a `role="grid"` of `role="row"` elements (`display:contents`) holding button gridcells with `aria-colindex`. Only the cursor cell is in the tab order (roving `tabindex`).
- Every cell's `aria-label` is `Row 3, column 5: hidden` (also `flagged`, `empty`, `mine`, `3 adjacent mines`) and shows a text glyph, so colour is never the only signal.
- An arrow key moves focus, and the screen reader reads that label (no extra announcement, to avoid double speech); at the board edge the game announces the current cell instead. Revealing announces the cell (and `Opened 12 cells.` after a flood). Flagging announces `Flagged. 9 mines remaining.`
- Winning and losing are announced assertively. After the game ends, every action says `Game over. Press Enter for a new game.`
- Cells update in place, so a screen reader keeps its position between moves.

## Implementation notes

- Rules and helpers live in `logic.js`, unit-tested in `test/unit/game-minesweeper.test.js`. Flood fill is iterative.
- Pointer handling is delegated from the grid element and removed in `destroy()`. A touch tap also arrives as a `primary` input, so input within 50 ms of a pointer event is ignored (`isPointerEcho`). A click with `detail` 0 is ignored only if `ctx.input` handled a key on the same cell within 400 ms (`isInputEcho`); otherwise it is a screen reader's synthetic activation and is honoured. A `focusin` handler keeps the cursor on the focused cell, and `ctx.input` ignores Enter/Space while the `New game` button has focus.
- Styling uses inline CSSOM styles and shell CSS variables, because the CSP forbids extra stylesheets.
