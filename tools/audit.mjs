// tools/audit.mjs — визуальный и DOM-аудит: проверка рендера объектов и HUD
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
  cdp.on('Runtime.exceptionThrown', p => errs.push(p.exceptionDetails.text + ' ' + (p.exceptionDetails.exception?.description || '')));
  cdp.on('Runtime.consoleAPICalled', p => {
    if (p.type === 'error') errs.push(p.args.map(a => a.value ?? a.description).join(' '));
  });
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 860, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url: URL_BASE });
  await sleep(2500);

  const ev = async (expr) => {
    const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) return { error: r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || '') };
    return r.result.value;
  };

  // 1. меню
  out.menu = await ev(`(() => {
    const m = document.getElementById('menu');
    const st = getComputedStyle(m);
    const r = m.getBoundingClientRect();
    const title = document.querySelector('.menu-title');
    const tr = title.getBoundingClientRect();
    return { display: st.display, opacity: st.opacity, w: r.width, h: r.height,
      titleRect: [tr.x|0, tr.y|0, tr.width|0, tr.height|0],
      titleFont: getComputedStyle(title).fontFamily,
      renderer: window.App.renderer.info.render,
      tris: window.App.renderer.info.render.triangles };
  })()`);

  // 2. старт
  out.start = await ev(`(() => {
    App.startGame('normal');
    const G = window.__GAME__;
    return { units: G.units.length, bld: G.buildings.length, pts: G.points.length,
      hudVisible: !document.getElementById('hud').classList.contains('hidden') };
  })()`);
  await sleep(1200);

  // 3. HUD-геометрия
  out.hud = await ev(`(() => {
    const ids = ['topbar','minimap-wrap','points','selbar','log','btn-pause','res'];
    const o = {};
    for (const id of ids) {
      const e = document.getElementById(id);
      if (!e) { o[id] = 'MISSING'; continue; }
      const r = e.getBoundingClientRect();
      o[id] = [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)];
    }
    const pt = document.querySelectorAll('#points .pt').length;
    o.pointRows = pt;
    o.minimapDrawn = (() => {
      const c = document.getElementById('minimap');
      const ctx = c.getContext('2d');
      const d = ctx.getImageData(0,0,256,256).data;
      let nonBlack = 0;
      for (let i=0;i<d.length;i+=4) if (d[i]+d[i+1]+d[i+2] > 30) nonBlack++;
      return (nonBlack/(256*256)*100).toFixed(1) + '%';
    })();
    return o;
  })()`);

  // 4. видимость юнита: смотрим на танк вблизи
  out.unitVisibility = await ev(`(() => {
    const G = window.__GAME__, A = window.__APP__;
    const u = G.units.find(x => x.type === 'tank') || G.units.find(x => x.type === 'ifv');
    if (!u) return 'no vehicle';
    Cam.focus(u.x, u.z, true); Cam.setZoom(0.6); Cam.apply(0.016);
    A.renderer.render(A.scene, A.camera);
    const p = Cam.project(u.x, u.centerY(), u.z);
    return { type: u.type, screen: [Math.round(p.x), Math.round(p.y)], visible: p.visible,
      zoom: +Cam.getZoom().toFixed(2), camPos: [A.camera.position.x|0, A.camera.position.y|0, A.camera.position.z|0] };
  })()`);
  await sleep(500);
  let shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(ROOT, '_audit_unit.png'), Buffer.from(shot.data, 'base64'));

  // 5. обзор карты сверху
  await ev(`Cam.setZoom(2.6); Cam.focus(0,0,true); Cam.apply(0.016); 1`);
  await sleep(600);
  shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(ROOT, '_audit_overview.png'), Buffer.from(shot.data, 'base64'));

  // 6. панель постройки
  out.buildingPanel = await ev(`(() => {
    const G = window.__GAME__;
    const b = G.buildings.find(x => x.faction === 'ally' && x.type === 'barracks');
    Game.selectBuilding(b); UI.refreshSelection();
    Cam.focus(b.x, b.z, true); Cam.setZoom(0.8); Cam.apply(0.016);
    return { sel: Game.selectionBuilding ? Game.selectionBuilding.type : null };
  })()`);
  await sleep(900);
  out.panelHtml = await ev(`(() => {
    return { title: document.getElementById('sel-title').textContent,
      cards: document.querySelectorAll('#sel-cards .u-card').length,
      prod: document.querySelectorAll('#sel-cards .p-card').length,
      actions: document.querySelectorAll('#actions .act').length };
  })()`);
  shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(ROOT, '_audit_panel.png'), Buffer.from(shot.data, 'base64'));

  // 7. выбор юнитов + приказ
  out.selection = await ev(`(() => {
    const G = window.__GAME__;
    const allies = G.units.filter(u => u.faction === 'ally');
    Game.setSelection(allies); UI.refreshSelection();
    Cam.focus(allies[0].x, allies[0].z, true); Cam.setZoom(0.7); Cam.apply(0.016);
    Game.issueMove(0, 30, true);
    return { sel: G.selection.length, cards: document.querySelectorAll('#sel-cards .u-card').length,
      actions: document.querySelectorAll('#actions .act').length,
      orders: allies.map(u => u.order.kind) };
  })()`);
  await sleep(900);
  shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(ROOT, '_audit_selected.png'), Buffer.from(shot.data, 'base64'));

  // 8. производительность: 300 шагов симуляции с большим числом юнитов
  out.perf = await ev(`(() => {
    const G = window.__GAME__;
    for (let i=0;i<24;i++) G.spawnUnit(['infantry','tank','ifv','artillery'][i%4], 'ally', -20 + (i%6)*7, 70 - Math.floor(i/6)*8);
    for (let i=0;i<24;i++) G.spawnUnit(['infantry','tank','ifv','aa'][i%4], 'enemy', -20 + (i%6)*7, 0 - Math.floor(i/6)*8);
    const t0 = performance.now();
    for (let i=0;i<200;i++) G.step(1/30);
    const dt = (performance.now()-t0)/200;
    return { units: G.units.length, stepMs: +dt.toFixed(3), estFpsIf60: dt < 8 };
  })()`);

  // 9. ошибки
  out.errors = errs.slice(0, 10);
  await sleep(300);
} catch (e) {
  out.fail = String(e);
} finally {
  console.log(JSON.stringify(out, null, 1));
  try { proc.kill(); } catch { }
  await sleep(300);
  process.exit(0);
}