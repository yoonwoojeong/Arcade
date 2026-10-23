// Shell audio: a synthesized alert chime (no asset file) and game sound playback.

let audioCtx = null;

export function playChime() {
  try {
    const AC = window.AudioContext ?? window.webkitAudioContext;
    if (!AC) return;
    audioCtx ??= new AC();
    if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
    const t = audioCtx.currentTime;
    const gain = audioCtx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.2, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    gain.connect(audioCtx.destination);
    [880, 1320].forEach((freq, i) => {
      const osc = audioCtx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      osc.connect(gain);
      osc.start(t + i * 0.12);
      osc.stop(t + 0.6);
    });
  } catch {
    // audio is optional: blocked or unsupported contexts are ignored
  }
}

const SOUND_NAME = /^[a-z0-9][a-z0-9_-]*$/i;

// Plays games/<id>/assets/<name>.ogg, falling back to .mp3.
export function playGameSound(gameId, name) {
  if (typeof name !== 'string' || !SOUND_NAME.test(name)) return;
  try {
    const audio = new Audio();
    const exts = audio.canPlayType('audio/ogg') ? ['ogg', 'mp3'] : ['mp3'];
    const base = `/games/${gameId}/assets/${name}`;
    let i = 0;
    const next = () => {
      if (i >= exts.length) return;
      audio.src = `${base}.${exts[i++]}`;
      audio.play().catch(() => {});
    };
    audio.addEventListener('error', next);
    next();
  } catch {
    // ignore
  }
}
