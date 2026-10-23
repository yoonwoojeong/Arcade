import os from 'node:os';

// The hint is meant to be pasted into a shell, so anything that is not a plain user or host name
// (or an IP literal) is replaced with a placeholder instead of being echoed.
const SAFE_USER = /^[A-Za-z0-9._-]+$/;
const SAFE_HOST = /^[A-Za-z0-9.:-]+$/;

function currentUser() {
  try {
    return os.userInfo().username;
  } catch {
    return '';
  }
}

// SSH_CONNECTION is "<client ip> <client port> <server ip> <server port>".
function sshServerHost(env) {
  const host = String(env.SSH_CONNECTION ?? '').split(/\s+/)[2];
  return host && SAFE_HOST.test(host) ? host : '<host>';
}

// A line to print after "couldn't open a browser", telling the user how to reach the arcade from a
// machine that has one. Returns null when the failure is not about being remote or headless (for
// example a desktop whose browser launcher is missing), so those users see no extra noise.
// The server only ever listens on 127.0.0.1 and rejects any other Host header, so the local port
// of the forward has to equal the server's port.
export function remoteHint({ url, env, detected, user = currentUser() }) {
  const { port, hash } = new URL(url);
  const local = `http://localhost:${port}/${hash}`;
  if (detected.isRemote) {
    const target = `${SAFE_USER.test(user) ? user : '<user>'}@${sshServerHost(env)}`;
    return (
      `On your own machine run: ssh -L ${port}:127.0.0.1:${port} ${target} ` +
      `(adjust to how you normally connect), then open ${local}`
    );
  }
  if (detected.platform === 'linux' && !detected.isWsl && !detected.hasDisplay) {
    return (
      `This session has no browser. Forward port ${port} from this machine to your own ` +
      `(for example with your editor’s port forwarding), then open ${local}`
    );
  }
  return null;
}
