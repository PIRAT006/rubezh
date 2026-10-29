/* ============================================================
   test.js — автономный прогон для отладки (только при ?test=1)
   Не используется в обычной игре.
   ============================================================ */
/* global App, Game, World, Cam, UI */
(function () {
  const params = new URLSearchParams(location.search);
  if (!params.has('test')) return;
  const secs = parseFloat(params.get('secs') || '20');
  const diff = params.get('diff') || 'normal';
  const auto = params.get('auto') !== '0';

  const report = [];
  const origError = console.error;
  console.error = function (...args) {
    report.push('ERR ' + args.map(a => (a && a.stack) ? a.stack : String(a)).join(' '));
    origError.apply(console, args);
  };
  window.addEventListener('error', e => report.push('WINERR ' + e.message + ' @' + e.filename + ':' + e.lineno));

  function step(n, fn) { setTimeout(fn, n); }

  step(600, () => {
    try {
      App.startGame(diff);
    } catch (e) {
      report.push('START_FAIL ' + e.stack);
    }
    // ускоренный прогон
    Game.speed = parseFloat(params.get('speed') || '3');
    if (auto) runAuto();
  });

  function runAuto() {
    // выдаём стартовым юнитам приказ об атаке на север
    setTimeout(() => {
      try {
        const mode = params.get('mode') || 'advance';
        if (mode === 'advance') {
          const ally = Game.units.filter(u => u.faction === 'ally');
          Game.setSelection(ally);
          Game.issueMove(0, 20, true);
          UI.refreshSelection();
        } else if (mode === 'combat') {
          // ставим стороны в контакт у моста
          const a = Game.units.filter(u => u.faction === 'ally');
          const e = Game.units.filter(u => u.faction === 'enemy');
          a.forEach((u, i) => { u.x = -14 + (i % 4) * 5; u.z = 16 + Math.floor(i / 4) * 6; });
          e.forEach((u, i) => { u.x = -12 + (i % 4) * 5; u.z = -24 - Math.floor(i / 4) * 6; });
          Cam.focus(0, 0, true);
          Cam.setZoom(1.25);
          Game.setSelection(a);
          UI.refreshSelection();
        } else if (mode === 'fps') {
          const a = Game.units.filter(u => u.faction === 'ally' && (u.type === 'tank' || u.type === 'ifv'));
          const unit = a[0] || Game.units.find(u => u.faction === 'ally');
          if (unit) {
            FPSControl.enter(unit);
          }
        } else if (mode === 'economy') {
          // производство и постройки
          const bar = Game.buildings.find(b => b.faction === 'ally' && b.type === 'barracks');
          const fac = Game.buildings.find(b => b.faction === 'ally' && b.type === 'factory');
          Game.resource = 2000;
          Game.queueUnit(bar, 'infantry');
          Game.queueUnit(bar, 'recon');
          Game.queueUnit(fac, 'tank');
          Game.queueUnit(fac, 'ifv');
          const pt = Game.placeBuilding('depot', 'ally', 30, 84);
          Game.resource = 2000;
          const pt2 = Game.placeBuilding('barracks', 'ally', -32, 80);
          window.__PLACE__ = [pt.ok, pt2.ok];
        }
      } catch (e) { report.push('ORDER_FAIL ' + e.stack); }
    }, 400);
  }

  const t0 = performance.now();
  const timer = setInterval(() => {
    const el = (performance.now() - t0) / 1000;
    const sum = {
      t: +Game.time.toFixed(1),
      fps: +App.fps.toFixed(1),
      res: Math.round(Game.resource),
      inc: Game.income,
      pop: Game.popUsed + '/' + Game.popCap,
      units: Game.units.length,
      ally: Game.units.filter(u => u.faction === 'ally').length,
      enemy: Game.units.filter(u => u.faction === 'enemy').length,
      bld: Game.buildings.length,
      proj: Game.projectiles.length,
      pts: Game.points.map(p => p.id + ':' + (p.owner || '-') + ':' + Math.round(p.progress * 100)).join(','),
      kills: Game.stats.kills,
      losses: Game.stats.losses,
      proj_dbg: Game.projectiles.length
    };
    console.log('[TEST] ' + JSON.stringify(sum));
    if (el > secs || Game.gameOver) {
      clearInterval(timer);
      console.log('[TEST-END] elapsed=' + el.toFixed(1) + ' gameOver=' + Game.gameOver + ' victory=' + Game.victory);
      if (report.length) console.log('[TEST-ERRORS]\n' + report.join('\n'));
      else console.log('[TEST-ERRORS] none');
      document.title = 'TEST-DONE';
    }
  }, 1500);
})();