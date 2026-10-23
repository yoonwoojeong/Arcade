// Alert banner ("Claude needs you in <project>") plus the optional browser notification.

export function createBanner({ el, onResume, onDismiss }) {
  const text = el.querySelector('#banner-text');
  const resumeButton = el.querySelector('#banner-resume');
  const dismissButton = el.querySelector('#banner-dismiss');

  resumeButton.addEventListener('click', () => onResume());
  dismissButton.addEventListener('click', () => onDismiss());

  return {
    show(summary) {
      el.dataset.state = summary.state;
      text.textContent = summary.banner;
      el.hidden = false;
    },
    hide() {
      el.hidden = true;
    },
    get visible() {
      return !el.hidden;
    },
    // "Resume game" only makes sense while a game is paused.
    setCanResume(can) {
      resumeButton.hidden = !can;
    },
    focus() {
      (resumeButton.hidden ? dismissButton : resumeButton).focus();
    },
    contains(node) {
      return el.contains(node);
    },
  };
}

export function notify(text) {
  try {
    const N = window.Notification;
    if (N && N.permission === 'granted') new N(text);
  } catch {
    // notifications are best effort
  }
}
