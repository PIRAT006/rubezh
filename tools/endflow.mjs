// tools/endflow.mjs — проверка экрана итогов, рестарта и меню
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
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url: URL_BASE });
  await sleep(2200);
  const ev = async (expr) => {
    const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) return { __error: r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || '') };
    return r.result.value;
  };

  await ev(`App.startGame('easy'); 1`);
  await sleep(600);

  // расстреливаем штаб врага
  out.kill = await ev(`(() => {
    const G = window.__GAME__;
    const hq = G.buildings.find(b => b.type === 'hq' && b.faction === 'enemy');
    const units = G.units.filter(u => u.faction === 'enemy' && !u.dead);
    units.forEach(u => u.die());
    G.buildings.filter(b => b.faction === 'enemy').forEach(b => b.die());
    for (let i = 0; i < 200; i++) G.step(1/30);
    return { over: G.gameOver, victory: G.victory, allyLeft: G.units.filter(u=>u.faction==='ally').length };
  })()`);
  await sleep(2200);
  out.overlay = await ev(`(() => {
    const ov = document.getElementById('overlay');
    return { visible: !ov.classList.contains('hidden'),
      title: document.querySelector('.ov-title') ? document.querySelector('.ov-title').textContent : null,
      stats: document.querySelectorAll('.ov-stat').length,
      buttons: Array.from(document.querySelectorAll('.ov-btn')).map(b=>b.textContent) };
  })()`);
  fs.writeFileSync(path.join(ROOT, '_end.png'), Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));

  // нажимаем «Новая операция»
  const btns = await ev(`(() => Array.from(document.querySelectorAll('.ov-btn')).map(b => { const r = b.getBoundingClientRect(); return { t: b.textContent, x: Math.round(r.x+r.width/2), y: Math.round(r.y+r.height/2) }; }))()`);
  out.buttons = btns;
  const again = btns.find(b => b.t.includes('Новая'));
  if (again) {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: again.x, y: again.y, button: 'none' });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: again.x, y: again.y, button: 'left', clickCount: 1, buttons: 1 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: again.x, y: again.y, button: 'left', clickCount: 1, buttons: 0 });
    await sleep(1200);
  }
  out.afterRestart = await ev(`(() => { const G = window.__GAME__;
    return { over: G.gameOver, t: +G.time.toFixed(1), units: G.units.length, bld: G.buildings.length,
      overlayHidden: document.getElementById('overlay').classList.contains('hidden'),
      res: Math.round(G.resource) }; })()`);

  // пауза через меню-кнопку
  await ev(`(() => { App.togglePause(); return 1; })()`);
  await sleep(400);
  out.pause = await ev(`(() => ({ paused: window.__GAME__.paused, ov: document.querySelector('.ov-title') ? document.querySelector('.ov-title').textContent : null }))()`);
  await ev(`(() => { UI.closeOverlay(); return 1; })()`);
  await sleep(300);
  out.unpause = await ev(`(() => ({ paused: window.__GAME__.paused }))()`);

  // справка
  await ev(`UI.showHelp(); 1`);
  await sleep(300);
  out.help = await ev(`(() => ({ title: document.querySelector('.ov-title').textContent, items: document.querySelectorAll('.ov-help li').length }))()`);
  await ev(`(() => { document.getElementById('ov-close').click(); return 1; })()`);

  out.errors = errs.slice(0, 8);
} catch (e) {
  out.fail = String(e);
} finally {
  console.log(JSON.stringify(out, null, 1));
  try { proc.kill(); } catch { }
  await sleep(300);
  process.exit(0);
}