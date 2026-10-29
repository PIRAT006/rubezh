// tools/menushot.mjs — скриншоты меню и ключевых экранов
import fs from 'node:fs';
import path from 'node:path';
import { launch, CDP, newTarget, sleep, ROOT } from './harness.mjs';

const URL_BASE = 'file:///' + ROOT.replace(/\\/g, '/').replace(/ /g, '%20') + '/index.html';
const proc = await launch();
try {
  const t = await newTarget('about:blank');
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  const cdp = new CDP(ws);
  const errs = [];
  cdp.on('Runtime.exceptionThrown', p => errs.push(p.exceptionDetails.text));
  cdp.on('Runtime.consoleAPICalled', p => { if (p.type === 'error') errs.push(p.args.map(a => a.value ?? a.description).join(' ')); });
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url: URL_BASE });
  await sleep(3000);

  fs.writeFileSync(path.join(ROOT, '_menu.png'), Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));

  await cdp.send('Runtime.evaluate', { expression: `App.startGame('normal'); 1`, returnByValue: true });
  await sleep(1500);
  // показываем бой: ставим камеру на колонну и делаем несколько кадров
  await cdp.send('Runtime.evaluate', {
    expression: `(() => {
      const G = window.__GAME__;
      const a = G.units.filter(u=>u.faction==='ally');
      const e = G.units.filter(u=>u.faction==='enemy');
      a.forEach((u,i)=>{ u.x = -16 + (i%4)*6; u.z = 24 + Math.floor(i/4)*7; });
      e.forEach((u,i)=>{ u.x = -14 + (i%4)*6; u.z = -14 - Math.floor(i/4)*7; });
      Game.setSelection(a); UI.refreshSelection();
      Cam.focus(0, 6, true); Cam.setZoom(0.95); Cam.apply(0.016);
      for (let i=0;i<420;i++) G.step(1/30);
      Effects.update(0.5);
      window.__APP__.renderer.render(window.__APP__.scene, window.__APP__.camera);
      return 1;
    })()`, returnByValue: true
  });
  await sleep(900);
  fs.writeFileSync(path.join(ROOT, '_battle_scene.png'), Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));

  // обзор карты с миникартой
  await cdp.send('Runtime.evaluate', {
    expression: `Cam.focus(0, 30, true); Cam.setZoom(1.9); Cam.apply(0.016); window.__APP__.renderer.render(window.__APP__.scene, window.__APP__.camera); 1`,
    returnByValue: true
  });
  await sleep(700);
  fs.writeFileSync(path.join(ROOT, '_map_view.png'), Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));

  console.log('errors:', errs.length ? errs.slice(0, 5) : 'none');
} catch (e) {
  console.error(e);
} finally {
  try { proc.kill(); } catch { }
  await sleep(300);
  process.exit(0);
}