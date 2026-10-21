import { spawn } from 'node:child_process';

// Separate process groups let shutdown also stop npm's Vite/tsx children.
const children = ['@resume/web', '@resume/api'].map((workspace) =>
  spawn('npm', ['run', 'dev', '--workspace', workspace], {
    stdio: 'inherit',
    detached: true,
  }),
);
children.push(spawn(process.execPath, ['scripts/resume-pdf.mjs', '--watch'], { stdio: 'inherit', detached: true }));
let stopping = false;
let killTimer;
let groupCheck;
let finishShutdown;
const shutdown = new Promise((resolve) => { finishShutdown = resolve; });

function groupExists(pid) {
  if (!pid) return false;
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    throw error;
  }
}

function finish() {
  clearInterval(groupCheck);
  clearTimeout(killTimer);
  finishShutdown();
}

function signalChildren(signal) {
  for (const child of children) {
    if (!child.pid) continue;
    try {
      process.kill(-child.pid, signal);
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  }
}

function stop(code, signal = 'SIGTERM') {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  signalChildren(signal);
  groupCheck = setInterval(() => {
    if (!children.some((child) => groupExists(child.pid))) finish();
  }, 50);
  killTimer = setTimeout(() => {
    signalChildren('SIGKILL');
    finish();
  }, 5000);
}

process.once('SIGINT', () => stop(130, 'SIGINT'));
process.once('SIGTERM', () => stop(143));

await Promise.all(children.map((child) => new Promise((resolve) => {
  child.once('error', (error) => {
    console.error('Unable to start development service:', error.message);
    stop(1);
    resolve();
  });
  child.once('exit', (code) => {
    stop(code ?? 1);
    resolve();
  });
})));
// npm may exit before Vite/tsx does. Keep the group cleanup alive until
// descendants exit, or the forced shutdown deadline is reached.
await shutdown;
