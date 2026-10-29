/* ============================================================
   ai.js — командующий противника
   ============================================================ */
'use strict';

const GameAI = (() => {
  let A = null;
  let think = 0;
  let waveT = 60;
  let attackUnits = [];
  let defendTarget = null;
  let defendT = 0;
  let lane = 'center';
  let openingDone = false;
  let trainT = 0;

  function init(api) {
    A = api;
    think = 0;
    waveT = 70;
    attackUnits = [];
    defendTarget = null;
    defendT = 0;
    openingDone = false;
    trainT = 0;
    queue = [];
    laneChoice = 0;
  }

  let queue = [];
  let laneChoice = 0;

  function diff() { return Game.difficulty; }

  function update(dt, api) {
    A = api;
    if (Game.gameOver) return;
    trainT -= dt;
    if (trainT <= 0) {
      trainT = 1.0;
      handleProduction();
    }
    think -= dt;
    if (think <= 0) {
      think = 1.1;
      strategic();
    }
    manageUnits();
  }

  // ---------------------------------------------------------
  //  ОБОРОНА ОБЪЕКТОВ
  // ---------------------------------------------------------
  function onPointLost(pt) {
    if (pt.owner === 'enemy') return;
    defendTarget = pt;
    defendT = 45 + Math.random() * 20;
    // отзываем ближайшие свободные
    for (const u of attackUnits) {
      if (Math.random() < 0.5) {
        u.moveTo(pt.x + Util.rnd(-8, 8), pt.z + Util.rnd(-8, 8), true);
      }
    }
  }

  function onUnitKilled(u) {
    const i = attackUnits.indexOf(u);
    if (i >= 0) attackUnits.splice(i, 1);
  }

  // ---------------------------------------------------------
  //  ПРОИЗВОДСТВО
  // ---------------------------------------------------------
  function unitCount(type) {
    let n = 0;
    for (const u of Game.units) if (u.faction === 'enemy' && !u.dead) n += u.type === type ? 1 : 0;
    return n;
  }
  function totalArmy() {
    let n = 0;
    for (const u of Game.units) if (u.faction === 'enemy' && !u.dead) n++;
    return n;
  }
  function countOf(armorType) {
    let n = 0;
    for (const u of Game.units) if (u.faction === 'enemy' && !u.dead && u.armor === armorType) n++;
    return n;
  }

  function handleProduction() {
    if (queue.length === 0 || Math.random() < 0.35) queue = refillPlan();

    // сначала — планы застройки (чтобы лимит рос)
    buildPlan();

    // производство: каждое здание берёт первый подходящий элемент плана
    const cap = armyLimit();
    for (const b of Game.buildings) {
      if (b.faction !== 'enemy' || b.dead) continue;
      if (!b.def.builds) continue;
      let guard = 0;
      while (b.queue.length < 2 && queue.length && guard++ < 12) {
        // ищем первый тип, который может строить это здание
        let idx = -1;
        for (let i = 0; i < queue.length && idx < 0; i++) if (b.def.builds.indexOf(queue[i]) >= 0) idx = i;
        if (idx < 0) break;
        const type = queue[idx];
        const def = UNIT_DEFS[type];
        if (liveArmy() + queuedArmy() + def.pop > cap) {
          // снимаем из плана, чтобы не зациклиться
          queue.splice(idx, 1);
          continue;
        }
        if (Game.enemyResource < def.cost) break;
        Game.enemyResource -= def.cost;
        b.queue.push({ type, t: def.time, total: def.time });
        queue.splice(idx, 1);
      }
    }
  }

  function buildCount(type) {
    return Game.buildings.filter(b => b.faction === 'enemy' && b.type === type && !b.dead).length;
  }

  function buildPlan() {
    const d = diff();
    let want = null;
    if (buildCount('factory') < 1) want = 'factory';
    else if (buildCount('barracks') < 2) want = 'barracks';
    else if (buildCount('depot') < 1 && (Game.time > 45 || d === 'hard')) want = 'depot';
    else if (buildCount('factory') < 2 && Game.time > 120) want = 'factory';
    else if (buildCount('depot') < 2 && Game.time > 160) want = 'depot';
    else if (enemyPopCap() < armyLimit() + 4 && buildCount('barracks') < 3) want = 'barracks';
    if (!want) return;
    const def = BUILDING_DEFS[want];
    if (Game.enemyResource < def.cost + 100) return;
    const spot = findBuildSpot(want);
    if (spot) {
      Game.enemyResource -= def.cost;
      Game.spawnBuilding(want, 'enemy', spot.x, spot.z);
    }
  }

  function queuedArmy() {
    let n = 0;
    for (const b of Game.buildings) if (b.faction === 'enemy' && !b.dead) for (const q of b.queue) n += UNIT_DEFS[q.type].pop;
    return n;
  }

  function liveArmy() {
    let n = 0;
    for (const u of Game.units) if (u.faction === 'enemy' && !u.dead) n += u.def.pop || 1;
    return n;
  }

  function enemyPopCap() {
    let c = 0;
    for (const b of Game.buildings) if (b.faction === 'enemy' && !b.dead) c += b.cap || 0;
    return c;
  }

  function armyLimit() {
    const d = diff();
    const base = d === 'hard' ? 30 : d === 'easy' ? 16 : 22;
    // со временем противник наращивает группировку
    const grow = Math.floor(Game.time / 10) * (d === 'hard' ? 1.0 : d === 'easy' ? 0.45 : 0.7);
    return Math.max(10, Math.min(base + grow, enemyPopCap() - 4));
  }

  function refillPlan() {
    const plan = [];
    const army = totalArmy();
    const tanks = unitCount('tank');
    const ifv = unitCount('ifv');
    const inf = unitCount('infantry');
    const art = unitCount('artillery') + unitCount('mlrs');
    const aa = unitCount('aa');
    const d = diff();

    if (inf < 3) plan.push('infantry', 'infantry');
    if (ifv < 2) plan.push('ifv');
    if (tanks < 2) plan.push('tank');
    if (aa < 1) plan.push('aa');

    // общая композиция
    plan.push('tank', 'tank');
    plan.push(ifv < tanks * 0.7 ? 'ifv' : 'tank');
    plan.push(inf < tanks * 0.8 ? 'infantry' : (ifv > tanks * 1.5 ? 'tank' : 'ifv'));
    if (art < 2 && Game.time > 90) plan.push('artillery');
    if (inf < 4) plan.push('infantry');
    if (tanks + ifv < 4) plan.push('tank');
    if (d === 'hard' && Game.time > 120 && art < 3 && Math.random() < 0.6) plan.push('mlrs');
    if (aa < 2 && Game.time > 100) plan.push('aa');
    if (inf + ifv < 6) plan.push('infantry');
    plan.push('tank');
    return plan;
  }

  function findBuildSpot(type) {
    const def = BUILDING_DEFS[type];
    const base = Game.enemyHQ || Game.buildings.find(b => b.faction === 'enemy' && b.type === 'hq');
    if (!base) return null;
    for (let i = 0; i < 40; i++) {
      const a = (i / 10) * Math.PI * 2 + Math.random();
      const r = 16 + Math.random() * 26;
      const x = base.x + Math.cos(a) * r;
      const z = base.z + Math.sin(a) * r;
      if (!World.isNavigable(x, z)) continue;
      let ok = true;
      for (const b of Game.buildings) if (Util.dist(x, z, b.x, b.z) < b.radius + def.radius + 1) { ok = false; break; }
      if (!ok) continue;
      for (const pt of Game.points) if (Util.dist(x, z, pt.x, pt.z) < pt.r + 4) { ok = false; break; }
      if (!ok) continue;
      if (Math.abs(x - World.BASE_ENEMY.x) > 58 || Math.abs(z - World.BASE_ENEMY.z) > 50) continue;
      return { x, z };
    }
    return null;
  }

  // ---------------------------------------------------------
  //  СТРАТЕГИЯ
  // ---------------------------------------------------------
  function strategic() {
    const d = diff();
    // армия
    const free = Game.units.filter(u => u.faction === 'enemy' && !u.dead && !attackUnits.includes(u));
    // сколько бойцов держим в ударной группе — растёт со временем
    const idleCap = Math.min(
      Math.floor((d === 'hard' ? 12 : d === 'easy' ? 6 : 9) + Game.time / 22),
      26
    );

    // оборона точки под угрозой
    let threat = null, threatN = 0;
    for (const pt of Game.points) {
      if (pt.owner !== 'enemy') continue;
      let n = 0;
      for (const u of Game.units) {
        if (u.faction === 'ally' && !u.dead && Util.dist(u.x, u.z, pt.x, pt.z) < pt.r + 14) n++;
      }
      if (n >= 2 && n > threatN) { threatN = n; threat = pt; }
    }
    if (threat && Math.random() < 0.85) {
      let sent = 0;
      for (const u of free) {
        if (sent >= 4) break;
        if (u.type === 'artillery' || u.type === 'mlrs') continue;
        if (Util.dist(u.x, u.z, threat.x, threat.z) > 120) continue;
        u.moveTo(threat.x + Util.rnd(-10, 10), threat.z + Util.rnd(-12, -2), true);
        sent++;
      }
      defendTarget = threat;
      defendT = 22;
    }

    // чистка ударной группы
    attackUnits = attackUnits.filter(u => u && !u.dead && Game.units.indexOf(u) >= 0);

    const armyReady = attackUnits.length;
    if (armyReady < idleCap && free.length > 0 && Game.time > 35) {
      const need = Math.min(free.length, Math.ceil((idleCap - armyReady) * 0.85));
      for (let i = 0; i < need; i++) attackUnits.push(free[i]);
    }

    // волны
    waveT -= 1.1;
    if (waveT <= 0) {
      waveT = (d === 'hard' ? 30 : d === 'easy' ? 55 : 42) + Math.random() * 14;
      launchWave();
    }

    // поддержка обороны
    defendT -= 1.1;
    if (defendT <= 0) defendTarget = null;
  }

  function chooseLane() {
    // выбираем направление атаки
    const opts = ['center', 'west', 'east'];
    const roll = Math.random();
    if (roll < 0.45) return 'center';
    if (roll < 0.72) return 'west';
    return 'east';
  }

  function launchWave() {
    const d = diff();
    const alive = attackUnits.filter(u => u && !u.dead);
    const minWave = d === 'hard' ? 4 : d === 'easy' ? 6 : 5;
    if (alive.length < minWave) return;

    lane = chooseLane();
    let target;
    // цель: слабейшая точка или база
    const allyPoints = Game.points.filter(p => p.owner !== 'enemy');
    const nonArt = alive.filter(u => u.type !== 'artillery' && u.type !== 'mlrs');
    if (!nonArt.length) return;

    if (allyPoints.length && Math.random() < 0.7) {
      // ближайшая к нашим силы
      const ax = alive.reduce((s, u) => s + u.x, 0) / alive.length;
      const az = alive.reduce((s, u) => s + u.z, 0) / alive.length;
      allyPoints.sort((a, b) => Util.dist(a.x, a.z, ax, az) - Util.dist(b.x, b.z, ax, az));
      target = allyPoints[0];
    } else {
      const hq = Game.allyHQ;
      target = hq ? { x: hq.x, z: hq.z + 4, r: 20 } : { x: 0, z: 90 };
    }

    Game.waveN++;
    // отдаём приказ атаковать
    const units = alive.slice();
    // артиллерия идёт следом
    const front = units.filter(u => u.type !== 'artillery' && u.type !== 'mlrs');
    const support = units.filter(u => u.type === 'artillery' || u.type === 'mlrs');

    const laneOff = lane === 'west' ? -22 : lane === 'east' ? 22 : 0;
    let tx = target.x + laneOff, tz = target.z;
    if (lane === 'west' && target.x < -40) { tx = target.x; }
    if (lane === 'east' && target.x > 40) { tx = target.x; }

    const form = Game.formationPoints(front, tx, tz);
    for (let i = 0; i < front.length; i++) {
      front[i].moveTo(form[i].x, form[i].z, true);
      front[i].order.wave = Game.waveN;
    }
    // поддержка занимает позицию позади
    for (let i = 0; i < support.length; i++) {
      const s = support[i];
      const backX = tx + (Game.enemyHQ ? (Game.enemyHQ.x - tx) : 0) * 0.35;
      const backZ = tz + (Game.enemyHQ ? (Game.enemyHQ.z - tz) : 60) * 0.35;
      s.moveTo(backX + (i - support.length / 2) * 8, backZ, false);
    }
    attackUnits = [];
    if (target && target.owner !== undefined) {
      // лог для напряжения
      if (front.length >= 4 && World.fogVisibleAt(tx, tz)) {
        UI.log('Зафиксировано движение сил противника!', 'warn');
        Sfx.ui('alarm');
      }
    }
  }

  // ---------------------------------------------------------
  //  УПРАВЛЕНИЕ ОТДЕЛЬНЫМИ ЮНИТАМИ
  // ---------------------------------------------------------
  function manageUnits() {
    const enemyUnits = Game.units.filter(u => u.faction === 'enemy' && !u.dead);
    for (const u of enemyUnits) {
      // после завершения пути — переоценка
      if (u.order.kind === 'attackmove' && !u.path && !u.target) {
        const near = nearestAlly(u, 34);
        if (near) { u.attack(near); continue; }
      }
      if (u.order.kind === 'attack' && (!u.order.target || u.order.target.dead)) {
        u.setOrder({ kind: 'idle' });
      }
      // застрявшие
      if (u.path && Math.abs(u.x - u.lastX) + Math.abs(u.z - u.lastZ) < 0.002) {
        u.stuckT += 0.1;
      } else {
        u.stuckT = 0;
      }
      u.lastX = u.x; u.lastZ = u.z;
    }
    // артиллерия: авто-обстрел
    for (const u of enemyUnits) {
      if (u.type !== 'artillery' && u.type !== 'mlrs') continue;
      if (u.cooldowns[0] > 1) continue;
      const tgt = nearestAlly(u, u.def.weapons[0].range, true);
      if (tgt) {
        u.attackGround(tgt.x + Util.rnd(-4, 4), tgt.z + Util.rnd(-4, 4));
      }
    }
    // дроны: летят к цели
    for (const u of enemyUnits) {
      if (u.type !== 'drone') continue;
      const near = nearestAlly(u, 90);
      if (near && u.order.kind !== 'attack') u.attack(near);
    }
  }

  function nearestAlly(u, range, preferUnits) {
    let best = null, bd = range;
    for (const o of Game.units) {
      if (o.faction !== 'enemy' && !o.dead) continue;
      if (o.faction !== 'enemy') continue;
      break;
    }
    for (const o of Game.units) {
      if (o.faction !== 'ally' || o.dead) continue;
      if (o.armor === 'air' && u.type !== 'drone') continue;
      const d = Util.dist(u.x, u.z, o.x, o.z);
      if (d < bd) { bd = d; best = o; }
    }
    if (best) return best;
    if (!preferUnits) {
      for (const b of Game.buildings) {
        if (b.faction !== 'ally' || b.dead) continue;
        const d = Util.dist(u.x, u.z, b.x, b.z) - b.radius;
        if (d < bd) { bd = d; best = b; }
      }
    }
    return best;
  }

  return { init, update, onPointLost, onUnitKilled };
})();