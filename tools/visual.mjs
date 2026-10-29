// tools/visual.mjs — проверка, что 3D-объекты реально рисуются (по пикселям)
import fs from 'node:fs';
import path from 'node:path';
import { launch, CDP, newTarget, sleep, ROOT } from './harness.mjs';

const URL_BASE = 'file:///' + ROOT.replace(/\\/g, '/').replace(/ /g, '%20') + '/index.html';
const proc = await launch();
const res = {};
try {
  const t = await newTarget('about:blank');
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  const cdp = new CDP(ws);
  const errs = [];
  cdp.on('Runtime.exceptionThrown', p => errs.push(p.exceptionDetails.text + ' ' + (p.exceptionDetails.exception?.description || '')));
  cdp.on('Runtime.consoleAPICalled', p => { if (p.type === 'error') errs.push(p.args.map(a => a.value ?? a.description).join(' ')); });
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url: URL_BASE });
  await sleep(2200);

  const ev = async (expr) => {
    const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) return { __error: r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || '') };
    return r.result.value;
  };

  await ev(`App.startGame('normal'); 1`);
  await sleep(800);

  // Расставляем «сцену»: танк и пехота в центре кадра, камера на них
  res.setup = await ev(`(() => {
    const G = window.__GAME__;
    const tank = G.units.find(u => u.type === 'tank') || G.spawnUnit('tank','ally',0,60);
    const inf  = G.units.find(u => u.type === 'infantry');
    const ifv  = G.units.find(u => u.type === 'ifv');
    tank.x = -6; tank.z = 40; tank.hp = tank.maxHp;
    ifv.x = 0; ifv.z = 40;
    inf.x = 7; inf.z = 40;
    Cam.focus(0, 40, true); Cam.setZoom(0.62); Cam.apply(0.016);
    window.__APP__.renderer.render(window.__APP__.scene, window.__APP__.camera);
    const p1 = Cam.project(tank.x, tank.y + 1.5, tank.z);
    const p2 = Cam.project(inf.x, inf.y + 1.0, inf.z);
    const ground = Cam.project(0, World.height(0, 46), 46);
    return { tank: [Math.round(p1.x), Math.round(p1.y)], inf: [Math.round(p2.x), Math.round(p2.y)],
             groundEmpty: [Math.round(ground.x), Math.round(ground.y)],
             camY: +window.__APP__.camera.position.y.toFixed(1) };
  })()`);

  // скриншот 1: юниты
  let shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(ROOT, '_vis_units.png'), Buffer.from(shot.data, 'base64'));

  // скриншот 2: без юнитов (для сравнения) — прячем
  await ev(`(() => {
    const G = window.__GAME__;
    G.units.forEach(u => { if (u.mesh) u.mesh.visible = false; if (u.ring) u.ring.visible = false; });
    window.__APP__.renderer.render(window.__APP__.scene, window.__APP__.camera);
    return 1;
  })()`);
  await sleep(200);
  shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(ROOT, '_vis_empty.png'), Buffer.from(shot.data, 'base64'));

  // вернуть
  await ev(`(() => { const G = window.__GAME__; G.units.forEach(u => { if (u.mesh) u.mesh.visible = true; }); return 1; })()`);
  await sleep(150);

  // скриншот 3: HUD
  res.hudShot = true;
  shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(ROOT, '_vis_hud.png'), Buffer.from(shot.data, 'base64'));

  res.errors = errs.slice(0, 6);
} catch (e) {
  res.fail = String(e);
} finally {
  console.log(JSON.stringify(res, null, 1));
  try { proc.kill(); } catch { }
  await sleep(300);
  process.exit(0);
}