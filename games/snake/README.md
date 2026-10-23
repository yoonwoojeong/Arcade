# Snake

Steer the snake around a 20x20 board, eat food to grow, and avoid the walls and your own body.
This is the reference game for canvas drawing and a real-time loop.

## Controls

- Arrow keys or WASD (or swipe): steer. Reversing straight into yourself is ignored, and two quick turns within one tick cannot add up to a reversal.
- Enter/Space (or tap): play again after game over.

## Scoring

Each food scores 1. The final score is sent with `reportScore` when the game ends, and the best score is saved in `ctx.storage` under `best` and shown on the canvas HUD. Filling the whole board is a win.

## Accessibility

- Declared `screenReader: "none"`: the canvas is not playable with a screen reader. It only announces the final score (`Game over. Score 7. Press Enter to play again.`) assertively.
- Head, body and food differ in shape, not just colour: the head is a square with eyes, the body is rounded squares, and the food is a circle.
- Colours are read from the shell theme tokens, and re-read when preferences change, so high contrast works.
- With reduced motion enabled the snake moves more slowly (200 ms per step instead of 120 ms).

## Files

- `logic.js`: pure rules (`createSnake`, `turn`, `step`), unit-tested in `test/unit/game-snake.test.js`.
- `index.js`: canvas drawing, the `setTimeout` loop (cleared on pause and destroy), input and announcements.
