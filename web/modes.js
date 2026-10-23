const OFF = { pause: false, banner: false, chime: false, notify: false };

export function reactionFor(mode, state) {
  if ((mode === 'alert' || mode === 'auto') && (state === 'needs-you' || state === 'done')) {
    return { pause: true, banner: true, chime: true, notify: true };
  }
  return { ...OFF };
}
