// tools/harness.mjs — управление Edge/Chrome через CDP для автотестов
// Запуск: node tools/harness.mjs <сценарий>
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const ROOT = path.resolve(process.argv[2] || '.');
const PORT = 9333;
const USER_DIR = path.join(ROOT, '_edge_profile');

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function launch() {
  try { fs.rmSync(USER_DIR, { recursive: true, force: true }); } catch { }
  const args = [
    '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${USER_DIR}`,
    '--window-size=1280,760', '--hide-scrollbars', '--mute-audio',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--disable-gpu-sandbox', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding', '--disable-features=Translate',
    'about:blank'
  ];
  const proc = spawn(EDGE, args, { stdio: 'ignore', detached: false });
  for (let i = 0; i < 80; i++) {
    await sleep(150);
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (r.ok) return proc;
    } catch { }
  }
  throw new Error('browser did not start');
}

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.handlers = new Map();
    ws.onmessage = ev => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
      } else if (msg.method) {
        const hs = this.handlers.get(msg.method);
        if (hs) hs.forEach(h => h(msg.params));
      }
    };
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) { this.pending.delete(id); reject(new Error('timeout ' + method)); }
      }, 60000);
    });
  }
  on(method, fn) {
    if (!this.handlers.has(method)) this.handlers.set(method, []);
    this.handlers.get(method).push(fn);
  }
}

async function newTarget(url) {
  const r = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
  return r.json();
}

export { launch, CDP, newTarget, sleep, ROOT, PORT };