// tools/balance.mjs — прогон нескольких партий на разных сложностях без участия игрока
import fs from 'node:fs';
import path from 'node:path';
import { launch, CDP, newTarget, sleep, ROOT } from './harness.mjs';

const URL_BASE = 'file:///' + ROOT.replace(/\\/g, '/').replace(/ /g, '%20') + '/index.html';
const proc = await launch();
const out = [];
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
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url: URL_BASE });
  await sleep(2200);

  const ev = async (expr) => {
    const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) return { __error: r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || '') };
    return r.result.value;
  };

  // имитация «пассивного игрока»: строит очередь, но не воюет
  const scenario = await ev(`(() => {
    window.__run = function(diff, minutes, playstyle) {
      App.startGame(diff);
      const G = window.__GAME__;
      let t = 0; const dt = 1/30;
      const log = [];
      let buildT = 5;
      while (t < minutes * 60 && !G.gameOver) {
        // производство
        if (Math.random() < 0.04) {
          const fac = G.buildings.find(b => b.faction==='ally' && b.type==='factory');
          const bar = G.buildings.find(b => b.faction==='ally' && b.type==='barracks');
          if (bar && Math.random() < 0.5) G.queueUnit(bar, Math.random() < 0.75 ? 'infantry' : 'recon');
          if (fac) G.queueUnit(fac, ['tank','ifv','artillery','aa'][(Math.random()*4)|0]);
        }
        // строительство
        buildT -= dt;
        if (buildT <= 0) {
          buildT = 25;
          const spots = [[-34, 84], [34, 84], [-44, 72], [44, 72], [0, 62]];
          for (const [sx, sz] of spots) {
            const type = ['barracks','factory','depot'][(Math.random()*3)|0];
            const r = G.placeBuilding(type, 'ally', sx, sz);
            if (r.ok) break;
          }
        }
        G.step(dt);
        t += dt;
      }
      const ally = G.units.filter(u=>u.faction==='ally');
      return {
        diff, minutes,
        time: +G.time.toFixed(0),
        gameOver: G.gameOver, victory: G.victory,
        allyUnits: ally.length, enemyUnits: G.units.filter(u=>u.faction==='enemy').length,
        allyBld: G.buildings.filter(b=>b.faction==='ally').length,
        enemyBld: G.buildings.filter(b=>b.faction==='enemy').length,
        kills: G.stats.kills, losses: G.stats.losses, built: G.stats.built,
        ptsAlly: G.points.filter(p=>p.owner==='ally').length,
        ptsEnemy: G.points.filter(p=>p.owner==='enemy').length,
        res: Math.round(G.resource), income: G.income, pop: G.popUsed+'/'+G.popCap,
        enemyRes: Math.round(G.enemyResource)
      };
    };
    return 'ready';
  })()`);
  out.push({ setup: scenario });

  for (const diff of ['easy', 'normal', 'hard']) {
    out.push(await ev(`window.__run('${diff}', 6)`));
  }
  out.push({ errors: errs.slice(0, 8) });
} catch (e) {
  out.push({ fail: String(e) });
} finally {
  console.log(JSON.stringify(out, null, 1));
  try { proc.kill(); } catch { }
  await sleep(300);
  process.exit(0);
}