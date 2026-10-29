// tools/play.mjs — длинный «игровой» прогон: экономика, ИИ, волны, победа/поражение
import fs from 'node:fs';
import path from 'node:path';
import { launch, CDP, newTarget, sleep, ROOT } from './harness.mjs';

const URL_BASE = 'file:///' + ROOT.replace(/\\/g, '/').replace(/ /g, '%20') + '/index.html';
const proc = await launch();
const out = { marks: [] };
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

  await ev(`App.startGame('normal'); 1`);
  await sleep(500);

  // сценарий: разработка экономики + наступления (без вмешательства мыши)
  out.marks.push(await ev(`(() => {
    const G = window.__GAME__;
    window.__sim = (secs) => {
      const steps = Math.round(secs * 30);
      const t0 = performance.now();
      for (let i = 0; i < steps; i++) { G.step(1 / 30); }
      return +(performance.now() - t0).toFixed(0);
    };
    return { ok: true };
  })()`));

  // 1) старт и экономика
  out.marks.push(await ev(`(() => {
    const G = window.__GAME__;
    G.resource = 900;
    const bar = G.buildings.find(b => b.faction === 'ally' && b.type === 'barracks');
    const fac = G.buildings.find(b => b.faction === 'ally' && b.type === 'factory');
    const q = [G.queueUnit(bar,'infantry'), G.queueUnit(bar,'recon'), G.queueUnit(fac,'tank'), G.queueUnit(fac,'ifv')].map(r=>r.ok);
    return { t: +G.time.toFixed(1), queued: q, res: Math.round(G.resource) };
  })()`));

  // 2) симулируем 90 секунд игры
  out.ms90 = await ev(`window.__sim(90)`);
  out.marks.push(await ev(`(() => {
    const G = window.__GAME__;
    return { t: +G.time.toFixed(1), res: Math.round(G.resource), income: G.income, pop: G.popUsed+'/'+G.popCap,
      units: G.units.length, ally: G.units.filter(u=>u.faction==='ally').length,
      enemy: G.units.filter(u=>u.faction==='enemy').length,
      bld: G.buildings.map(b=>b.faction[0]+':'+b.type).join(','),
      enemyRes: Math.round(G.enemyResource), enemyInc: G.enemyIncome,
      pts: G.points.map(p=>p.id+':'+(p.owner||'-')).join(' '),
      kills: G.stats.kills, losses: G.stats.losses, built: G.stats.built,
      aiQueue: G.buildings.filter(b=>b.faction==='enemy').map(b=>b.queue.map(q=>q.type).join('+')).join('|')
    };
  })()`));

  // 3) выдаём союзным приказ уничтожить штаб врага (ускоренно проверяем победу)
  out.marks.push(await ev(`(() => {
    const G = window.__GAME__;
    const allies = G.units.filter(u => u.faction === 'ally');
    Game.setSelection(allies);
    Game.issueAttack(G.enemyHQ);
    return { ordered: allies.length, target: !!G.enemyHQ };
  })()`));

  out.ms180 = await ev(`window.__sim(180)`);
  out.marks.push(await ev(`(() => {
    const G = window.__GAME__;
    return { t: +G.time.toFixed(1), gameOver: G.gameOver, victory: G.victory,
      ally: G.units.filter(u=>u.faction==='ally').length, enemy: G.units.filter(u=>u.faction==='enemy').length,
      allyPos: G.units.filter(u=>u.faction==='ally').slice(0,5).map(u=>[u.type, Math.round(u.x), Math.round(u.z), Math.round(u.hp)]),
      hqEnemy: G.buildings.some(b=>b.type==='hq'&&b.faction==='enemy'&&!b.dead),
      hqAlly: G.buildings.some(b=>b.type==='hq'&&b.faction==='ally'&&!b.dead),
      kills: G.stats.kills, losses: G.stats.losses,
      pts: G.points.map(p=>p.id+':'+(p.owner||'-')).join(' ')
    };
  })()`));

  // 4) смотрим на поле боя и снимаем кадр
  await ev(`(() => {
    const G = window.__GAME__;
    const busy = G.units.filter(u=>u.faction==='ally');
    if (busy.length) { const u = busy[0]; Cam.focus(u.x, u.z, true); }
    Cam.setZoom(0.85); Cam.apply(0.016);
    window.__APP__.renderer.render(window.__APP__.scene, window.__APP__.camera);
    return 1;
  })()`);
  await sleep(500);
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(ROOT, '_play.png'), Buffer.from(shot.data, 'base64'));

  out.errors = errs.slice(0, 8);
} catch (e) {
  out.fail = String(e);
} finally {
  console.log(JSON.stringify(out, null, 1));
  try { proc.kill(); } catch { }
  await sleep(300);
  process.exit(0);
}