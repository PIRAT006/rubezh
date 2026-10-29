// tools/run-test.mjs — сценарий автотеста игры
import fs from 'node:fs';
import path from 'node:path';
import { launch, CDP, newTarget, sleep, ROOT } from './harness.mjs';

const URL_BASE = 'file:///' + ROOT.replace(/\\/g, '/').replace(/ /g, '%20') + '/index.html';

const cfg = {
  secs: Number(process.env.SECS || 40),
  speed: Number(process.env.SPEED || 3),
  diff: process.env.DIFF || 'normal',
  shot: process.env.SHOT || '_shot_game.png',
  auto: process.env.AUTO || '1',
  w: 1280, h: 760
};

const proc = await launch();
let cdp;
const logs = [];
try {
  const target = await newTarget('about:blank');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  cdp = new CDP(ws);

  cdp.on('Runtime.consoleAPICalled', p => {
    const text = p.args.map(a => a.value !== undefined ? a.value : (a.description || a.type)).join(' ');
    logs.push({ t: p.type, text });
    if (['error', 'warning'].includes(p.type) || text.startsWith('[T]')) console.log(`[${p.type}] ${text}`);
  });
  cdp.on('Runtime.exceptionThrown', p => {
    const d = p.exceptionDetails;
    console.log('[EXCEPTION]', d.text, d.exception && d.exception.description);
    logs.push({ t: 'exception', text: d.text + ' ' + (d.exception && d.exception.description) });
  });
  cdp.on('Log.entryAdded', p => {
    if (p.entry.level === 'error') console.log('[LOG-ERR]', p.entry.text, p.entry.url || '');
  });

  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: cfg.w, height: cfg.h, deviceScaleFactor: 1, mobile: false
  });

  const url = `${URL_BASE}?test=1&secs=${cfg.secs}&speed=${cfg.speed}&diff=${cfg.diff}&auto=${cfg.auto}`;
  console.log('navigate', url);
  await cdp.send('Page.navigate', { url });
  await sleep(1500);

  // ждём завершения теста
  const t0 = Date.now();
  let done = false;
  while (Date.now() - t0 < (cfg.secs + 40) * 1000) {
    await sleep(1000);
    const r = await cdp.send('Runtime.evaluate', {
      expression: 'document.title', returnByValue: true
    });
    if (r.result.value === 'TEST-DONE') { done = true; break; }
  }
  console.log('test finished:', done);

  // Дополнительная диагностика состояния
  const diag = await cdp.send('Runtime.evaluate', {
    expression: `JSON.stringify((() => {
      const G = window.__GAME__, A = window.__APP__, W = window.__WORLD__;
      const s = {
        fps: A.fps,
        time: G.time,
        units: G.units.length,
        ally: G.units.filter(u=>u.faction==='ally').length,
        enemy: G.units.filter(u=>u.faction==='enemy').length,
        buildings: G.buildings.length,
        projectiles: G.projectiles.length,
        res: Math.round(G.resource),
        income: G.income,
        pop: G.popUsed + '/' + G.popCap,
        points: G.points.map(p=>p.id+':'+(p.owner||'-')+':'+Math.round(p.progress*100)),
        selection: G.selection.length,
        kills: G.stats.kills, losses: G.stats.losses,
        sceneObjects: A.scene.children.length,
        renderCalls: A.renderer.info.render.calls,
        triangles: A.renderer.info.render.triangles,
        textures: A.renderer.info.memory.textures,
        geometries: A.renderer.info.memory.geometries,
        programs: A.renderer.info.programs ? A.renderer.info.programs.length : -1,
        camTarget: [A.camera.position.x|0, A.camera.position.y|0, A.camera.position.z|0]
      };
      // проверка, что союзные юниты двигались
      s.allyPos = G.units.filter(u=>u.faction==='ally').slice(0,6).map(u=>[u.type, Math.round(u.x), Math.round(u.z), Math.round(u.hp)]);
      s.enemyPos = G.units.filter(u=>u.faction==='enemy').slice(0,6).map(u=>[u.type, Math.round(u.x), Math.round(u.z), Math.round(u.hp)]);
      return s;
    })())`, returnByValue: true
  });
  console.log('DIAG', diag.result.value);

  // сделаем скриншот
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(ROOT, cfg.shot), Buffer.from(shot.data, 'base64'));
  console.log('screenshot saved', cfg.shot);

  // анализ пикселей делаем отдельно питоном
  const errors = logs.filter(l => l.t === 'error' || l.t === 'exception');
  console.log('ERRORS:', errors.length ? JSON.stringify(errors.slice(0, 8), null, 1) : 'none');
} catch (e) {
  console.error('HARNESS FAIL', e);
} finally {
  try { proc.kill(); } catch { }
  await sleep(400);
  process.exit(0);
}