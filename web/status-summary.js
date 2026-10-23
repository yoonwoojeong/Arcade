const STALE_MS = 24 * 60 * 60 * 1000;

function phrase(state, list, showProject) {
  const n = list.length;
  const project = showProject && n === 1 ? list[0][1].project : '';
  if (state === 'needs-you') {
    return {
      badge:
        n > 1 ? `${n} sessions need you` : project ? `${project} needs you` : 'Claude needs you',
      banner: n === 1 ? (project ? `Claude needs you in ${project}` : 'Claude needs you') : null,
    };
  }
  return {
    badge:
      n > 1
        ? `${n} sessions finished`
        : project
          ? `Claude finished in ${project}`
          : 'Claude finished',
    banner: n === 1 ? (project ? `Claude finished in ${project}` : 'Claude finished') : null,
  };
}

export function summarize(status, { showProject, now }) {
  if (!status || !status.sessions) {
    return { state: 'offline', badge: 'Offline — reconnecting…', banner: null, key: null };
  }
  const groups = { 'needs-you': [], done: [], working: [] };
  for (const [id, s] of Object.entries(status.sessions)) {
    const age = now.getTime() - Date.parse(s.updatedAt);
    if (age > STALE_MS) continue;
    if (groups[s.state]) groups[s.state].push([id, s]);
  }
  for (const state of ['needs-you', 'done']) {
    const list = groups[state];
    if (list.length === 0) continue;
    const { badge, banner } = phrase(state, list, showProject);
    const key = list
      .map(([id, s]) => `${id}@${s.since}`)
      .sort()
      .join(',');
    return { state, badge, banner: banner ?? badge, key };
  }
  if (groups.working.length > 0) {
    return { state: 'working', badge: 'Claude is working…', banner: null, key: null };
  }
  return { state: 'idle', badge: 'Claude is idle', banner: null, key: null };
}
