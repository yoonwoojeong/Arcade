// Game menu: one card per registered game, built with textContent only.

function span(className, text) {
  const el = document.createElement('span');
  el.className = className;
  el.textContent = text;
  return el;
}

export function renderMenu(list, games, onSelect, bestFor = () => undefined) {
  list.replaceChildren();
  if (games.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'menu-empty';
    empty.textContent = 'No games installed.';
    list.before(empty);
    return;
  }
  for (const g of games) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'game-card';
    card.dataset.gameId = g.id;
    const controls = [...g.controls.keyboard];
    if (g.controls.touch) controls.push(`Touch: ${g.controls.touch}`);
    const details = span('game-details', '');
    details.append(
      span('game-desc', g.description),
      span('game-meta', `Controls: ${controls.join('; ')}`),
      span('game-meta', `Session length: ${g.sessionLength}`),
      span('game-meta', `Screen reader: ${g.accessibility.screenReader}`),
    );
    card.append(span('game-title', g.title), details);
    setCardScore(card, bestFor(g.id));
    card.addEventListener('click', () => onSelect(g.id));
    const li = document.createElement('li');
    li.append(card);
    list.append(li);
  }
}

export function setCardScore(card, best) {
  if (!card || best === undefined) return;
  let el = card.querySelector('.game-score');
  if (!el) {
    el = span('game-meta game-score', '');
    card.querySelector('.game-details').append(el);
  }
  el.textContent = `High score: ${best}`;
}

export function cardFor(list, id) {
  return [...list.querySelectorAll('.game-card')].find((c) => c.dataset.gameId === id);
}
