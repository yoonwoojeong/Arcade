// The game entry point. The shell calls this once with the SDK context `ctx`
// and then drives the returned object: start -> pause/resume -> destroy.
// Browser code only: no Node imports, no network (the contract test enforces this).
import { createCounter, increment } from './logic.js';

export default function createGame(ctx) {
  let state = createCounter();
  let paused = true;

  // ctx.root is the container you own. Build your UI inside it.
  const label = document.createElement('p');
  const button = document.createElement('button');
  button.textContent = 'Add one';

  function render() {
    label.textContent = `Count: ${state.count}`;
  }

  function add() {
    if (paused) return; // the shell controls pausing; ignore input while paused
    state = increment(state);
    render();
    ctx.announce(`Count ${state.count}`); // screen reader support
    ctx.reportScore(state.count); // the shell tracks the high score
  }

  // Keyboard and touch go through ctx.input ONLY (enables remapping + swipe/tap).
  // Keep the same function reference so destroy() can remove it.
  const onPrimary = () => add();
  // Clicking your own elements is allowed, but you must remove it in destroy().
  const onClick = () => add();

  return {
    start() {
      ctx.root.append(label, button);
      ctx.input.on('primary', onPrimary);
      button.addEventListener('click', onClick);
      paused = false;
      render();
      // REPLACE: start your loop here (setInterval / requestAnimationFrame).
    },
    pause() {
      paused = true;
      // REPLACE: stop your loop and timers here. resume() restarts them.
    },
    resume() {
      paused = false;
    },
    destroy() {
      // Release EVERYTHING: timers, animation frames, listeners, DOM.
      paused = true;
      ctx.input.off('primary', onPrimary);
      button.removeEventListener('click', onClick);
      label.remove();
      button.remove();
    },
  };
}
