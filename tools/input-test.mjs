// tools/input-test.mjs — проверка реального ввода мышью/клавиатурой через CDP
import fs from 'node:fs';
import path from 'node:path';
import { launch, CDP, newTarget, sleep, ROOT } from './harness.mjs';

const URL_BASE = 'file:///' + ROOT.replace(/\\/g, '/').replace(/ /g, '%20') + '/index.html';
const proc = await launch();
const out = {};
try {
  const t = await newTarget('about:blank');
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  const cdp = new CDP(ws);
  const errs = [];
  cdp.on('Runtime.exceptionThrown', p => errs.push('EXC ' + p.exceptionDetails.text + ' ' + (p.exceptionDetails.exception?.description || '')));
  cdp.on('Runtime.consoleAPICalled', p => { if (p.type === 'error') errs.push('ERR ' + p.args.map(a => a.value ?? a.description).join(' ')); });
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Input.enable').catch(() => { });
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url: URL_BASE });
  await sleep(2400);

  const ev = async (expr) => {
    const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) return { __error: r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || '') };
    return r.result.value;
  };
  const mouse = async (type, x, y, button = 'left', clickCount = 1) => {
    await cdp.send('Input.dispatchMouseEvent', {
      type, x, y, button, clickCount,
      buttons: type === 'mouseReleased' ? 0 : (button === 'right' ? 2 : 1)
    });
  };
  const key = async (type, code, keyName, text) => {
    await cdp.send('Input.dispatchKeyEvent', {
      type, code, key: keyName, windowsVirtualKeyCode: code.startsWith('Key') ? code.charCodeAt(3) : 0,
      text: text || undefined
    });
  };

  // 1) клик по кнопке "Начать операцию"
  const btn = await ev(`(() => { const r = document.getElementById('start-btn').getBoundingClientRect(); return [Math.round(r.x + r.width/2), Math.round(r.y + r.height/2)]; })()`);
  out.startBtn = btn;
  await mouse('mouseMoved', btn[0], btn[1], 'none', 0);
  await mouse('mousePressed', btn[0], btn[1]);
  await mouse('mouseReleased', btn[0], btn[1]);
  await sleep(1200);
  out.afterStart = await ev(`(() => ({ running: window.__GAME__.running, units: window.__GAME__.units.length,
     hud: !document.getElementById('hud').classList.contains('hidden'),
     menuHidden: document.getElementById('menu').classList.contains('gone') }))()`);

  // 2) клик по юниту в мире
  const unitPos = await ev(`(() => {
    const G = window.__GAME__;
    const u = G.units.find(x => x.faction === 'ally');
    Cam.focus(u.x, u.z, true); Cam.setZoom(0.7); Cam.apply(0.016);
    window.__APP__.renderer.render(window.__APP__.scene, window.__APP__.camera);
    const p = Cam.project(u.x, u.centerY(), u.z);
    window.__U__ = u;
    return [Math.round(p.x), Math.round(p.y)];
  })()`);
  out.unitScreen = unitPos;
  if (unitPos && !unitPos.__error) {
    await mouse('mouseMoved', unitPos[0], unitPos[1], 'none', 0);
    await mouse('mousePressed', unitPos[0], unitPos[1]);
    await mouse('mouseReleased', unitPos[0], unitPos[1]);
    await sleep(400);
    out.selected1 = await ev(`window.__GAME__.selection.length`);
  }

  // 3) рамка выделения — протяжка по большой области (центр экрана)
  await mouse('mousePressed', 380, 200);
  await mouse('mouseMoved', 500, 300, 'left');
  await mouse('mouseMoved', 1000, 640, 'left');
  await mouse('mouseReleased', 1000, 640);
  await sleep(400);
  out.boxSelected = await ev(`window.__GAME__.selection.length`);

  // 4) ПКМ — приказ идти
  const before = await ev(`(() => { const G = window.__GAME__; const u = G.selection[0]; return u ? [u.x, u.z, u.order.kind] : null; })()`);
  await mouse('mouseMoved', 900, 600, 'none', 0);
  await mouse('mousePressed', 900, 600, 'right');
  await mouse('mouseReleased', 900, 600, 'right');
  await sleep(600);
  const after = await ev(`(() => { const G = window.__GAME__; const u = G.selection[0]; return u ? [u.x, u.z, u.order.kind, !!u.path] : null; })()`);
  out.moveOrder = { before, after };

  // 5) клавиши: P — пауза, T — скорость
  await key('keyDown', 'KeyP', 'p');
  await key('keyUp', 'KeyP', 'p');
  await sleep(300);
  out.paused = await ev(`({ paused: window.__GAME__.paused, overlay: !document.getElementById('overlay').classList.contains('hidden') })`);
  await key('keyDown', 'KeyP', 'p');
  await key('keyUp', 'KeyP', 'p');
  await sleep(300);
  out.unpaused = await ev(`({ paused: window.__GAME__.paused })`);

  await key('keyDown', 'KeyT', 't');
  await key('keyUp', 'KeyT', 't');
  await sleep(200);
  out.speed = await ev(`({ speed: window.__GAME__.speed, label: document.getElementById('btn-speed').textContent })`);

  // 6) зум колесом
  const z0 = await ev(`Cam.getZoom()`);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 700, y: 400, deltaX: 0, deltaY: -240 });
  await sleep(500);
  const z1 = await ev(`Cam.getZoom()`);
  out.zoom = { from: z0, to: z1 };

  // 7) выбор постройки и постановка очереди кликом
  out.build = await ev(`(() => {
    const G = window.__GAME__;
    const b = G.buildings.find(x => x.faction === 'ally' && x.type === 'barracks');
    Game.selectBuilding(b); UI.refreshSelection();
    Cam.focus(b.x, b.z, true); Cam.setZoom(0.75); Cam.apply(0.016);
    return 'ok';
  })()`);
  await sleep(900);
  const bp = await ev(`(() => { const r = document.querySelector('#sel-cards .p-card'); if(!r) return null; const rr = r.getBoundingClientRect(); return [Math.round(rr.x+rr.width/2), Math.round(rr.y+rr.height/2)]; })()`);
  out.pcard = bp;
  if (Array.isArray(bp)) {
    await mouse('mouseMoved', bp[0], bp[1], 'none', 0);
    await mouse('mousePressed', bp[0], bp[1]);
    await mouse('mouseReleased', bp[0], bp[1]);
    await sleep(500);
    out.queue = await ev(`({ q: window.__GAME__.selectionBuilding.queue.length, res: Math.round(window.__GAME__.resource) })`);
  }

  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(ROOT, '_input.png'), Buffer.from(shot.data, 'base64'));
  out.errors = errs.slice(0, 8);
} catch (e) {
  out.fail = String(e);
} finally {
  console.log(JSON.stringify(out, null, 1));
  try { proc.kill(); } catch { }
  await sleep(300);
  process.exit(0);
}