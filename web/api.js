// Thin wrappers over the arcade server's JSON API (same origin).

export async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

// POST /api/settings → { ok: true, settings } | { ok: false, errors }
export async function postSettings(patch) {
  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const body = await res.json();
    if (!res.ok) return { ok: false, errors: body.errors ?? ['Could not save settings.'] };
    return { ok: true, settings: body };
  } catch {
    return { ok: false, errors: ['Could not save settings. Is the arcade server running?'] };
  }
}
