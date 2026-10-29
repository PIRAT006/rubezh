/* ============================================================
   game.js — ядро: состояние мира, экономика, бой, контрольные
   точки, снаряды, туман войны, условия победы
   ============================================================ */
'use strict';

const Game = (() => {
  const scene = new THREE.Scene();

  // ------------- ostovki уничтоженной техники -------------
  const wrecks = new Set();

  const G = {
    scene,
    wrecks,
    units: [],
    buildings: [],
    points: [],
    projectiles: [],
    pending: [],
    effectsQueue: [],
    time: 0,
    running: false,
    paused: false,
    speed: 1,
    faction: 'ally',
    resource: 350,
    income: 0,
    popUsed: 0,
    popCap: 0,
    enemyResource: 300,
    difficulty: 'normal',
    stats: { kills: 0, losses: 0, captured: 0, incomeTotal: 0, built: 0 },
    selection: [],
    hovered: null,
    gameOver: false,
    victory: false,
    enabled: false
  };

  // пространственный хеш
  const HASH_CELL = 12;
  const grid = new Map();
  const hkey = (i, j) => i * 1000 + j;
  let scratchArr = [];
  let scratchUse = 0;
  const scratchPool = [];
  function hashClear() { grid.clear(); scratchUse = 0; }
  function hashGet(x, z, r) {
    // переиспользуемый буфер, чтобы не мусорить в GC каждый кадр
    if (scratchUse >= scratchPool.length) scratchPool.push([]);
    const out = scratchPool[scratchUse++];
    out.length = 0;
    const i0 = Math.floor((x - r) / HASH_CELL), i1 = Math.floor((x + r) / HASH_CELL);
    const j0 = Math.floor((z - r) / HASH_CELL), j1 = Math.floor((z + r) / HASH_CELL);
    const r2 = (r + HASH_CELL) * (r + HASH_CELL);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const b = grid.get(hkey(i, j));
        if (!b) continue;
        for (let k = 0; k < b.length; k++) {
          const o = b[k];
          if (Util.dist2(o._x, o._z, x, z) <= r2) out.push(o);
        }
      }
    }
    return out;
  }
  function hashInsert(u) {
    u._x = u.x; u._z = u.z;
    const i = Math.floor(u.x / HASH_CELL), j = Math.floor(u.z / HASH_CELL);
    const k = hkey(i, j);
    let b = grid.get(k);
    if (!b) { b = []; grid.set(k, b); }
    b.push(u);
  }

  // ---------------------------------------------------------
  //  ИНИЦИАЛИЗАЦИЯ ОПЕРАЦИИ
  // ---------------------------------------------------------
  const DIFF = {
    easy: { income: 0.7, speed: 0.8, aggr: 0.65, startRes: 400 },
    normal: { income: 1.0, speed: 1.0, aggr: 1.0, startRes: 350 },
    hard: { income: 1.4, speed: 1.25, aggr: 1.35, startRes: 280 }
  };

  function reset(diff) {
    // очистка прошлой партии
    for (const u of G.units.slice()) {
      scene.remove(u.mesh);
      if (u.ring) scene.remove(u.ring);
    }
    for (const b of G.buildings.slice()) {
      scene.remove(b.mesh);
      if (b.ring) scene.remove(b.ring);
    }
    G.units.length = 0;
    G.buildings.length = 0;
    G.points.length = 0;
    G.projectiles.length = 0;
    G.pending.length = 0;
    G.selection.length = 0;
    G.time = 0;
    G.resource = (DIFF[G.difficulty] || DIFF.normal).startRes;
    G.enemyResource = 320;
    G.gameOver = false;
    G.victory = false;
    G.stats = { kills: 0, losses: 0, captured: 0, incomeTotal: 0, built: 0 };
    G.difficulty = diff || 'normal';
    if (typeof World !== 'undefined' && World.resetFog) World.resetFog();

    // базы
    const allyHQ = spawnBuilding('hq', 'ally', World.BASE_ALLY.x, World.BASE_ALLY.z + 6);
    const enemyHQ = spawnBuilding('hq', 'enemy', World.BASE_ENEMY.x, World.BASE_ENEMY.z - 6);

    // стартовые постройки
    spawnBuilding('barracks', 'ally', -18, World.BASE_ALLY.z - 2);
    spawnBuilding('factory', 'ally', 18, World.BASE_ALLY.z - 2);
    spawnBuilding('barracks', 'enemy', World.BASE_ENEMY.x - 18, World.BASE_ENEMY.z + 4);
    spawnBuilding('barracks', 'enemy', World.BASE_ENEMY.x + 18, World.BASE_ENEMY.z + 4);

    // стартовые юниты
    const ay = World.BASE_ALLY.z;
    spawnUnit('infantry', 'ally', -8, ay - 8);
    spawnUnit('infantry', 'ally', 0, ay - 10);
    spawnUnit('infantry', 'ally', 8, ay - 8);
    spawnUnit('ifv', 'ally', -12, ay - 14);
    spawnUnit('ifv', 'ally', 12, ay - 14);
    spawnUnit('recon', 'ally', -24, ay - 14);
    spawnUnit('aa', 'ally', 0, ay - 18);

    const ey = World.BASE_ENEMY.z;
    spawnUnit('infantry', 'enemy', -8, ey + 10);
    spawnUnit('infantry', 'enemy', 8, ey + 10);
    spawnUnit('ifv', 'enemy', -12, ey + 16);
    spawnUnit('ifv', 'enemy', 12, ey + 16);
    spawnUnit('recon', 'enemy', 0, ey + 6);

    // контрольные точки
    for (const cp of World.CONTROL_POINTS) {
      const pt = {
        id: cp.id, name: cp.name, x: cp.x, z: cp.z, r: cp.r,
        owner: null, progress: 0, contested: false,
        mesh: Models.build('flag', 'ally'),
        incomeAlly: 3, incomeEnemy: 3,
        captureSound: 0
      };
      const y = World.height(cp.x, cp.z);
      pt.mesh.position.set(cp.x, y, cp.z);
      scene.add(pt.mesh);
      pt.y = y;
      // начальная принадлежность: южные — нейтральные, северные — враг
      if (cp.z < -30) pt.owner = 'enemy';
      if (cp.id === 'p2') pt.progress = 0;
      G.points.push(pt);
    }
    // отметка места штабов
    G.allyHQ = allyHQ;
    G.enemyHQ = enemyHQ;
    // посещаемость для ИИ
    G.aiThink = 0;
    G.waveN = 0;
  }

  // ---------------------------------------------------------
  //  СПАВН
  // ---------------------------------------------------------
  function spawnUnit(type, faction, x, z) {
    const p = World.nearestPassable(x, z, 25);
    if (!p) { console.warn('no passable spot for', type, x, z); return null; }
    const u = new Unit(type, faction, p.x, p.z);
    u.vision = u.def.vision;
    G.units.push(u);
    return u;
  }

  function spawnBuilding(type, faction, x, z) {
    const b = new Building(type, faction, x, z);
    G.buildings.push(b);
    return b;
  }

  function removeUnit(u) {
    const i = G.units.indexOf(u);
    if (i >= 0) G.units.splice(i, 1);
    const si = G.selection.indexOf(u);
    if (si >= 0) G.selection.splice(si, 1);
  }
  function removeBuilding(b) {
    const i = G.buildings.indexOf(b);
    if (i >= 0) G.buildings.splice(i, 1);
    if (G.selectionBuilding === b) G.selectionBuilding = null;
  }

  // ---------------------------------------------------------
  //  ПРОИЗВОДСТВО
  // ---------------------------------------------------------
  function popOf(type) { return (UNIT_DEFS[type] && UNIT_DEFS[type].pop) || 1; }

  function canAfford(cost) { return G.resource >= cost; }

  function queueUnit(building, type) {
    const def = UNIT_DEFS[type];
    if (!def) return { ok: false, msg: 'Нет такого юнита' };
    if (!building.def.builds || building.def.builds.indexOf(type) < 0) return { ok: false, msg: 'Здесь не производится' };
    if (building.queue.length >= 5) return { ok: false, msg: 'Очередь заполнена' };
    if (G.resource < def.cost) return { ok: false, msg: 'Недостаточно снабжения' };
    if (G.popUsed + queuePop(building.faction) + def.pop > G.popCap) return { ok: false, msg: 'Нет лимита личного состава' };
    G.resource -= def.cost;
    building.queue.push({ type, t: def.time, total: def.time });
    Sfx.ui('build');
    return { ok: true };
  }

  function queuePop(faction) {
    let n = 0;
    for (const b of G.buildings) {
      if (b.dead || b.faction !== faction) continue;
      for (const q of b.queue) n += popOf(q.type);
    }
    return n;
  }

  // суммарный лимит ещё не произведённых юнитов (для интерфейса)
  function queuePopAll() {
    let n = 0;
    for (const b of G.buildings) {
      if (b.dead || b.faction !== 'ally') continue;
      for (const q of b.queue) n += popOf(q.type);
    }
    return n;
  }

  function cancelQueue(building, index) {
    if (index >= building.queue.length) return;
    const item = building.queue[index];
    building.queue.splice(index, 1);
    G.resource += UNIT_DEFS[item.type].cost;
  }

  function canBuild(buildingDef, faction) {
    if (G.resource < buildingDef.cost) return { ok: false, msg: 'Недостаточно снабжения' };
    if (faction === 'ally' && G.popCap + (buildingDef.cap || 0) > 60) return { ok: false, msg: 'Достигнут предел развёртывания' };
    return { ok: true };
  }

  function placeBuilding(type, faction, x, z) {
    const def = BUILDING_DEFS[type];
    if (!def) return { ok: false, msg: 'Неизвестная постройка' };
    const chk = canBuild(def, faction);
    if (!chk.ok) return chk;
    const p = World.nearestPassable(x, z, 6);
    if (!p) return { ok: false, msg: 'Здесь нельзя строить' };
    // проверка перекрытия
    for (const b of G.buildings) {
      if (Util.dist(p.x, p.z, b.x, b.z) < b.radius + def.radius - 1) return { ok: false, msg: 'Слишком близко к постройке' };
    }
    for (const pt of G.points) {
      if (Util.dist(p.x, p.z, pt.x, pt.z) < pt.r) return { ok: false, msg: 'Запретная зона опорного пункта' };
    }
    for (const u of G.units) {
      if (Util.dist(p.x, p.z, u.x, u.z) < u.radius + 2) return { ok: false, msg: 'Мешают подразделения' };
    }
    // слишком близко к врагу
    for (const u of G.units) {
      if (u.faction !== faction && !u.dead && Util.dist(p.x, p.z, u.x, u.z) < 30) return { ok: false, msg: 'Слишком близко к противнику' };
    }
    G.resource -= def.cost;
    const b = spawnBuilding(type, faction, p.x, p.z);
    Effects.orderMarker(p.x, World.height(p.x, p.z), p.z, [0.89, 0.75, 0.5], def.radius * 2);
    Effects.dust(p.x, World.height(p.x, p.z), p.z, 10);
    Sfx.ui('build');
    G.stats.built++;
    return { ok: true, building: b };
  }

  function productionPoint(building) {
    // точка спавна перед постройкой
    const ang = building.angle;
    for (let a = 0; a < 8; a++) {
      const aa = ang + a * 0.8;
      const r = building.radius + 4;
      const x = building.x + Math.sin(aa) * r;
      const z = building.z + Math.cos(aa) * r;
      if (World.isNavigable(x, z)) return { x, z };
    }
    return World.nearestPassable(building.x + Math.sin(ang) * (building.radius + 5), building.z + Math.cos(ang) * (building.radius + 5), 10);
  }

  // ---------------------------------------------------------
  //  БОЙ
  // ---------------------------------------------------------
  function queryNear(x, z, r) { return hashGet(x, z, r); }

  function findTargetFor(unit, range) {
    const cands = hashGet(unit.x, unit.z, range + 6);
    let best = null, bestScore = Infinity;
    for (let i = 0; i < cands.length; i++) {
      const o = cands[i];
      if (o.faction === unit.faction || o.dead) continue;
      const d = Util.dist(unit.x, unit.z, o.x, o.z) - (o.radius || 1);
      if (d > range) continue;
      // проверка, может ли оружие нанести урон
      if (!canHurt(unit, o)) continue;
      if (o.faction !== 'ally' && !World.fogVisibleAt(o.x, o.z)) continue;
      if (!unit.canSee(o)) continue;
      let score = d;
      // приоритет ПВО по воздуху
      if (o.armor === 'air' && unit.def.weapons.some(w => w.airOnly)) score -= 30;
      if (o.armor === 'air' && !unit.def.weapons.some(w => w.airOnly)) score += 60;
      if (!unit.def.weapons.some(w => w.airOnly) && o.armor === 'air') score += 40;
      if (score < bestScore) { bestScore = score; best = o; }
    }
    // постройки
    for (let i = 0; i < G.buildings.length; i++) {
      const b = G.buildings[i];
      if (b.faction === unit.faction || b.dead) continue;
      const d = Util.dist(unit.x, unit.z, b.x, b.z) - b.radius;
      if (d > range) continue;
      if (!canHurt(unit, b)) continue;
      if (b.faction !== 'ally' && !World.fogExploredAt(b.x, b.z)) continue;
      const score = d + 25;
      if (score < bestScore) { bestScore = score; best = b; }
    }
    return best;
  }

  function canHurt(unit, target) {
    const weapons = unit.def ? unit.def.weapons : [];
    for (const w of weapons) {
      if (w.airOnly && target.armor !== 'air') continue;
      if (target.armor === 'air' && !w.airOnly && w.type !== 'bomb') continue;
      if (damageMult(w.type, target.armor) > 0.05) return true;
    }
    return false;
  }

  function applyDamage(target, amount, type, source) {
    if (!target || target.dead) return;
    const wasAlive = !target.dead;
    target.takeDamage(amount, type);
    const killed = wasAlive && target.dead;

    if (source && source.faction === 'ally' && target.faction === 'enemy') {
      Effects.hitmarker(killed);
      if (source.gainXP) source.gainXP(amount, killed);
      if (killed) {
        G.stats.kills++;
        const bounty = Math.round(((target.def && target.def.cost) || 70) * 0.4);
        G.resource = Math.min(2500, G.resource + bounty);
        if (typeof UI !== 'undefined' && UI.showKillBanner) {
          UI.showKillBanner(target.def ? target.def.name : 'Вражеский объект', bounty);
        }
        Sfx.radioChatter('kill');
      }
    }

    if (source && source.faction === 'enemy' && target.faction === 'ally') {
      // привлекаем внимание гарнизона
      if (target.target == null && source.dead === false && Math.random() < 0.4) {
        target.target = source;
      }
      if (Math.random() < 0.25) Sfx.radioChatter('underFire');
    }
  }

  function scheduleHit(owner, target, dmg, type, delay, splash) {
    G.pending.push({ owner, target, dmg, type, delay, splash });
  }

  // ---------------------------------------------------------
  //  СНАРЯДЫ
  // ---------------------------------------------------------
  const projectileGeo = new THREE.SphereGeometry(0.22, 6, 4);
  const projMatShell = new THREE.MeshBasicMaterial({ color: 0xffd08a });
  const projMatRocket = new THREE.MeshBasicMaterial({ color: 0xffa060 });

  function spawnProjectile(p) {
    const mesh = new THREE.Mesh(projectileGeo, p.arc ? projMatRocket : projMatShell);
    mesh.position.set(p.x, p.y, p.z);
    mesh.scale.setScalar(p.arc ? 1.8 : 1.2);
    scene.add(mesh);
    p.mesh = mesh;
    p.t = 0;
    p.sx = p.x; p.sy = p.y; p.sz = p.z;
    p.dist = Math.hypot(p.tx - p.x, p.tz - p.z);
    p.dur = Math.max(0.18, p.dist / (p.speed || 80));
    if (p.arc) p.dur *= 1.25;
    // траектория с дугой
    p.arcH = p.arc ? Math.max(6, p.dist * 0.32) : 0;
    G.projectiles.push(p);
    return p;
  }

  function updateProjectiles(dt) {
    const list = G.projectiles;
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i];
      p.t += dt;
      const k = Math.min(1, p.t / p.dur);
      // если цель жива — обновляем точку
      if (p.target && !p.target.dead && p.target !== null) {
        p.tx = p.target.x; p.tz = p.target.z;
        p.ty = p.target.centerY ? p.target.centerY() : p.target.y + 1.5;
      }
      const x = Util.lerp(p.sx, p.tx, k);
      const z = Util.lerp(p.sz, p.tz, k);
      const y = Util.lerp(p.sy, p.ty, k) + p.arcH * Math.sin(Math.PI * k);
      p.mesh.position.set(x, y, z);
      if (p.arc && Math.random() < 0.8) {
        Effects.smokePlume(x, y, z, [0.35, 0.33, 0.3], 0.45, 0.9);
      }
      if (k >= 1) {
        scene.remove(p.mesh);
        list.splice(i, 1);
        impact(p);
      }
    }
  }

  function impact(p) {
    const y = World.height(p.tx, p.tz);
    if (World.isWater(p.tx, p.tz)) {
      for (let i = 0; i < 10; i++) Effects.bulletImpact(p.tx, World.WATER_Y + 0.1, p.tz, 'water');
      Sfx.explosion(p.tx, p.tz, 0.8);
      return;
    }
    if (p.splash > 0) {
      Effects.explosion(p.tx, y + 0.4, p.tz, Util.clamp(p.splash * 0.32, 0.8, 2.4));
      Sfx.explosion(p.tx, p.tz, p.splash > 5 ? 1.8 : 1.2);
      // урон по площади
      const r = p.splash;
      const cands = hashGet(p.tx, p.tz, r + 4);
      for (const o of cands) {
        if (o.faction === p.faction || o.dead) continue;
        const d = Util.dist(p.tx, p.tz, o.x, o.z) - (o.radius || 1) * 0.5;
        if (d > r) continue;
        const fall = 1 - Util.clamp(d / r, 0, 1);
        const dmg = p.dmg * (0.35 + 0.65 * fall);
        applyDamage(o, dmg, p.type, p.owner);
      }
      // постройки
      for (const b of G.buildings) {
        if (b.faction === p.faction || b.dead) continue;
        const d = Util.dist(p.tx, p.tz, b.x, b.z) - b.radius * 0.7;
        if (d > r) continue;
        const fall = 1 - Util.clamp(d / r, 0, 1);
        applyDamage(b, p.dmg * (0.35 + 0.65 * fall), p.type, p.owner);
      }
    } else {
      Effects.explosion(p.tx, p.ty, p.tz, 0.9);
      Sfx.explosion(p.tx, p.tz, 0.8);
      if (p.target && !p.target.dead) {
        applyDamage(p.target, p.dmg, p.type, p.owner);
      } else {
        // земля
        Effects.bulletImpact(p.tx, y + 0.1, p.tz, 'dirt');
      }
    }
  }

  // ---------------------------------------------------------
  //  КОНТРОЛЬНЫЕ ТОЧКИ
  // ---------------------------------------------------------
  function updatePoints(dt) {
    for (const pt of G.points) {
      let ally = 0, enemy = 0;
      const cands = hashGet(pt.x, pt.z, pt.r + 4);
      for (const u of cands) {
        if (u.dead || !u.def || u.def.model === null) continue;
        if (u.armor === 'air') continue;
        if (Util.dist(u.x, u.z, pt.x, pt.z) > pt.r) continue;
        const cap = u.def.capture || 0;
        if (u.faction === 'ally') ally += cap; else enemy += cap;
      }
      pt.contested = ally > 0 && enemy > 0;
      pt.allyIn = ally;
      pt.enemyIn = enemy;

      let changed = false;
      // прогресс: -1 — враг, 0 — нейтрально, +1 — наш
      const RATE = 0.055;
      if (ally > 0 && enemy === 0) {
        pt.progress = Math.min(1, pt.progress + ally * dt * RATE);
      } else if (enemy > 0 && ally === 0) {
        pt.progress = Math.max(-1, pt.progress - enemy * dt * RATE);
      } else if (ally === 0 && enemy === 0 && pt.owner === null) {
        // нейтральный пункт медленно успокаивается к нулю
        pt.progress *= Math.max(0, 1 - dt * 0.35);
      }

      if (pt.progress >= 1 && pt.owner !== 'ally') {
        pt.owner = 'ally'; pt.progress = 1; changed = true;
      } else if (pt.progress <= -1 && pt.owner !== 'enemy') {
        pt.owner = 'enemy'; pt.progress = -1; changed = true;
      } else if (pt.owner === 'ally') {
        pt.progress = Math.max(0, pt.progress);
      } else if (pt.owner === 'enemy') {
        pt.progress = Math.min(0, pt.progress);
      }

      // отображение: доля заполнения от 0 до 1 в сторону владельца
      if (pt.owner === 'ally') pt.progress = Math.max(0, pt.progress);
      if (pt.owner === 'enemy') pt.progress = Math.min(0, pt.progress);

      if (changed) {
        const good = pt.owner === 'ally';
        if (good) { G.stats.captured++; UI.log(`Захвачен опорный пункт «${pt.name}»`, 'good'); }
        else UI.log(`Потерян опорный пункт «${pt.name}»`, 'warn');
        Sfx.capture(pt.x, pt.z, good);
        Effects.orderMarker(pt.x, pt.y, pt.z, good ? [0.47, 0.9, 0.69] : [1, 0.37, 0.27], pt.r * 1.6);
        UI.refreshPoints();
        if (typeof GameAI !== 'undefined' && GameAI.onPointLost) GameAI.onPointLost(pt);
      }
      // флаг
      if (pt.mesh && pt.mesh.userData.cloth) {
        const cloth = pt.mesh.userData.cloth;
        const c = pt.owner === 'ally' ? 0x4aa87a : pt.owner === 'enemy' ? 0xb0402e : 0x8d9187;
        cloth.material.color.lerp(new THREE.Color(c), Math.min(1, dt * 2.5));
        // развевание
        const t = G.time * 2 + pt.x;
        const pos = cloth.geometry.attributes.position;
        for (let i = 0; i < pos.count; i++) {
          const px = pos.getX(i);
          pos.setZ(i, Math.sin(t + px * 2.2) * 0.12 * (px + 1.3) * 0.4);
        }
        pos.needsUpdate = true;
      }
    }
  }

  // ---------------------------------------------------------
  //  ЭКОНОМИКА
  // ---------------------------------------------------------
  function updateEconomy(dt) {
    let income = 0, cap = 0, pop = 0;
    for (const b of G.buildings) {
      if (b.dead) continue;
      if (b.faction === 'ally') { income += b.income; cap += b.cap; }
    }
    for (const pt of G.points) {
      if (pt.owner === 'ally') income += pt.incomeAlly;
      else if (pt.owner === 'enemy') income += 0;
    }
    // HQ даёт фиксированно
    income += 2;
    G.income = income;
    G.popCap = cap;
    G.resource = Math.min(G.resource + income * dt, 2500);
    G.stats.incomeTotal += income * dt;

    let used = 0;
    for (const u of G.units) if (u.faction === 'ally' && !u.dead) used += u.def.pop || 1;
    used += queuePop('ally');
    G.popUsed = used;

    // ИИ
    const d = DIFF[G.difficulty];
    let eIncome = 2;
    for (const pt of G.points) if (pt.owner === 'enemy') eIncome += pt.incomeEnemy;
    for (const b of G.buildings) if (b.faction === 'enemy' && !b.dead) eIncome += b.income || 0;
    G.enemyIncome = eIncome;
    G.enemyResource = Math.min(G.enemyResource + eIncome * d.income * dt, 3000);
  }

  // ---------------------------------------------------------
  //  ВЫДЕЛЕНИЕ
  // ---------------------------------------------------------
  function setSelection(list) {
    for (const u of G.selection) { u.selected = false; }
    G.selection = list.slice(0, 40);
    for (const u of G.selection) u.selected = true;
    G.selectionBuilding = null;
    G.inspected = null;
  }

  function selectBuilding(b) {
    for (const u of G.selection) u.selected = false;
    G.selection = [];
    G.selectionBuilding = b;
  }

  // ---------------------------------------------------------
  //  ПРИКАЗЫ
  // ---------------------------------------------------------
  function issueMove(x, z, attackMove) {
    if (!G.selection.length) return;
    const units = G.selection.filter(u => !u.dead);
    if (!units.length) return;
    // формирование строя
    const formation = formationPoints(units, x, z);
    for (let i = 0; i < units.length; i++) {
      units[i].moveTo(formation[i].x, formation[i].z, attackMove);
    }
    Effects.orderMarker(x, World.height(x, z), z, attackMove ? [1, 0.5, 0.3] : [0.47, 0.9, 0.69], 3);
    Sfx.moveOrder(x, z);
  }

  function formationPoints(units, cx, cz) {
    // строим сетку вокруг центра, повёрнутую к точке подхода
    const n = units.length;
    const pts = [];
    if (n === 1) return [{ x: cx, z: cz }];
    // среднее направление
    let ax = 0, az = 0;
    for (const u of units) { ax += u.x / n; az += u.z / n; }
    const dirX = cx - ax, dirZ = cz - az;
    const len = Math.hypot(dirX, dirZ) || 1;
    const fx = dirX / len, fz = dirZ / len;
    const rx = -fz, rz = fx;
    const cols = Math.ceil(Math.sqrt(n));
    const spacing = 4.6;
    for (let i = 0; i < n; i++) {
      const c = i % cols, r = Math.floor(i / cols);
      const rows = Math.ceil(n / cols);
      const ox = (c - (cols - 1) / 2) * spacing;
      const oz = (r - (rows - 1) / 2) * spacing;
      let px = cx + rx * ox - fx * oz;
      let pz = cz + rz * ox - fz * oz;
      const p = World.nearestPassable(px, pz, 8);
      pts.push(p || { x: cx, z: cz });
    }
    return pts;
  }

  function issueAttack(target) {
    if (!G.selection.length) return;
    for (const u of G.selection) if (!u.dead) u.attack(target);
    Effects.orderMarker(target.x, World.height(target.x, target.z) || 0, target.z, [1, 0.4, 0.28], (target.radius || 2) * 2);
    Sfx.attackOrder(target.x, target.z);
  }

  function issueAttackGround(x, z) {
    if (!G.selection.length) return;
    for (const u of G.selection) if (!u.dead) u.attackGround(x, z);
    Effects.orderMarker(x, World.height(x, z), z, [1, 0.45, 0.3], 4);
    Sfx.attackOrder(x, z);
  }

  function stopAll() {
    for (const u of G.selection) if (!u.dead) u.stop();
    Sfx.ui('select');
  }

  function holdAll() {
    for (const u of G.selection) if (!u.dead) u.hold();
    Sfx.ui('select');
  }

  function toggleStance() {
    // переключение рассредоточенности: собираем к центру
    const units = G.selection.filter(u => !u.dead);
    if (!units.length) return;
    const cx = units.reduce((s, u) => s + u.x, 0) / units.length;
    const cz = units.reduce((s, u) => s + u.z, 0) / units.length;
    issueMove(cx, cz, false);
  }

  // ---------------------------------------------------------
  //  ГЛАВНЫЙ ЦИКЛ
  // ---------------------------------------------------------
  const dtStep = 1 / 30;
  let acc = 0;

  function update(dtReal) {
    if (!G.enabled) return;
    if (G.paused) { Effects.update(dtReal * 0); return; }
    if (G.gameOver) { Effects.update(dtReal); return; }

    acc += dtReal * G.speed;
    let steps = 0;
    while (acc >= dtStep && steps < 6) {
      step(dtStep);
      acc -= dtStep;
      steps++;
    }
    if (steps >= 6) acc = 0;
  }

  function step(dt) {
    G.time += dt;
    Sfx.budgetReset(dt);

    // хеш
    hashClear();
    for (const u of G.units) if (!u.dead) hashInsert(u);

    // туман
    World.updateFog(G.units, G.buildings);

    // юниты
    for (let i = 0; i < G.units.length; i++) {
      const u = G.units[i];
      if (!u.dead) u.update(dt, API);
    }
    // остовы
    for (const t of wrecks) t(dt);
    // постройки
    for (let i = 0; i < G.buildings.length; i++) {
      const b = G.buildings[i];
      if (!b.dead) b.update(dt, API);
    }
    // отложенный урон (ракеты)
    for (let i = G.pending.length - 1; i >= 0; i--) {
      const p = G.pending[i];
      p.delay -= dt;
      if (p.delay <= 0) {
        G.pending.splice(i, 1);
        if (p.target && !p.target.dead) {
          Effects.explosion(p.target.x, p.target.centerY ? p.target.centerY() : p.target.y + 1, p.target.z, 0.8);
          applyDamage(p.target, p.dmg, p.type, p.owner);
        }
      }
    }
    // снаряды
    updateProjectiles(dt);
    // авиаудары
    updateAirstrikes(dt);
    // точки
    updatePoints(dt);
    // перезарядка способностей
    for (const k in abilities) {
      if (abilities[k].timer > 0) abilities[k].timer = Math.max(0, abilities[k].timer - dt);
    }
    // экономика
    updateEconomy(dt);
    // ИИ
    GameAI.update(dt, API);
    // проверка победы
    checkWin();
    // отложенные события (взрывы зданий)
    flushTimers(dt);
  }

  // ---------------------------------------------------------
  //  ПОДДЕРЖКА СТАВКИ (КОМАНДИРСКИЕ СПОСОБНОСТИ)
  // ---------------------------------------------------------
  const abilities = {
    airstrike: { id: 'airstrike', name: 'Авиаудар', key: 'Z', cost: 75, cd: 30, timer: 0, desc: 'Штурмовик наносит бомбовый удар по линии' },
    barrage: { id: 'barrage', name: 'Артобстрел', key: 'X', cost: 85, cd: 38, timer: 0, desc: 'Тяжёлый 152мм артналёт по сектору' },
    smoke: { id: 'smoke', name: 'Дымзавеса', key: 'C', cost: 30, cd: 20, timer: 0, desc: 'Плотная завеса фосфорного дыма' }
  };

  const activeAirstrikes = [];

  function makeJetMesh() {
    const g = new THREE.Group();
    const mat = Models.mat(0x3e4739, 0.65, 0.35);
    const glass = Models.mat(0x60a0c0, 0.2, 0.9);
    const body = new THREE.Mesh(new THREE.ConeGeometry(1.0, 9.5, 6), mat);
    body.rotation.x = Math.PI / 2;
    g.add(body);
    const can = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.5, 2.4), glass);
    can.position.set(0, 0.45, 0.8);
    g.add(can);
    const wing = new THREE.Mesh(new THREE.BoxGeometry(9.0, 0.12, 2.8), mat);
    wing.position.set(0, 0, -0.6);
    g.add(wing);
    for (const s of [-1, 1]) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.8, 1.5), mat);
      fin.position.set(s * 1.3, 0.9, -2.6);
      fin.rotation.z = s * -0.25;
      g.add(fin);
    }
    return g;
  }

  function triggerAbility(id, x, z) {
    const ab = abilities[id];
    if (!ab) return { ok: false, msg: 'Неизвестная способность' };
    if (ab.timer > 0) return { ok: false, msg: `${ab.name} на перезарядке (${Math.ceil(ab.timer)}с)` };
    if (G.resource < ab.cost) return { ok: false, msg: `Недостаточно снабжения (нужно ${ab.cost})` };

    G.resource -= ab.cost;
    ab.timer = ab.cd;

    if (id === 'airstrike') {
      const ang = (Math.random() - 0.5) * 1.2;
      const dist = 320;
      const sx = x - Math.sin(ang) * dist;
      const sz = z - Math.cos(ang) * dist;
      const ex = x + Math.sin(ang) * dist;
      const ez = z + Math.cos(ang) * dist;
      const jet = makeJetMesh();
      jet.position.set(sx, 44, sz);
      jet.rotation.y = Math.atan2(ex - sx, ez - sz);
      scene.add(jet);

      activeAirstrikes.push({
        mesh: jet, sx, sz, ex, ez, y: 44,
        t: 0, dur: 2.8,
        bombs: [0.36, 0.46, 0.56, 0.66],
        dropped: [false, false, false, false],
        targetX: x, targetZ: z
      });

      Sfx.jetFlyby(x, z);
      Sfx.radioChatter('airstrike');
      UI.toast('Штурмовая авиация наносит удар по сектору!', 'info');
      Effects.orderMarker(x, World.height(x, z), z, [1, 0.3, 0.2], 8);
    } else if (id === 'barrage') {
      for (let i = 0; i < 6; i++) {
        after(i * 0.48 + Math.random() * 0.2, () => {
          const ox = (Math.random() - 0.5) * 28;
          const oz = (Math.random() - 0.5) * 28;
          const bx = x + ox, bz = z + oz;
          const by = World.height(bx, bz);
          spawnProjectile({
            x: bx - 22, y: by + 65, z: bz - 22,
            tx: bx, ty: by, tz: bz,
            speed: 100, arc: true, splash: 8.5, dmg: 185,
            type: 'artillery', faction: 'ally'
          });
        });
      }
      Sfx.cannon(x, z);
      UI.toast('Тяжёлая батарея ведёт беглый огонь по сектору!', 'info');
      Effects.orderMarker(x, World.height(x, z), z, [1, 0.5, 0.2], 7);
    } else if (id === 'smoke') {
      Effects.smokeScreen(x, z, 26, 22);
      UI.toast('Поставлена плотная дымовая завеса', 'good');
    }

    if (typeof UI !== 'undefined' && UI.refreshAbilities) UI.refreshAbilities();
    return { ok: true };
  }

  function updateAirstrikes(dt) {
    for (let i = activeAirstrikes.length - 1; i >= 0; i--) {
      const a = activeAirstrikes[i];
      a.t += dt;
      const k = Math.min(1, a.t / a.dur);
      const curX = Util.lerp(a.sx, a.ex, k);
      const curZ = Util.lerp(a.sz, a.ez, k);
      a.mesh.position.set(curX, a.y, curZ);

      if (Math.random() < 0.6) {
        Effects.smokePlume(curX, a.y, curZ, [0.95, 0.95, 0.95], 0.6, 1.2);
      }

      for (let b = 0; b < a.bombs.length; b++) {
        if (!a.dropped[b] && k >= a.bombs[b]) {
          a.dropped[b] = true;
          const bx = curX + (Math.random() - 0.5) * 6;
          const bz = curZ + (Math.random() - 0.5) * 6;
          const by = World.height(bx, bz);
          spawnProjectile({
            x: curX, y: a.y - 1.5, z: curZ,
            tx: bx, ty: by, tz: bz,
            speed: 70, arc: false, splash: 9.5, dmg: 210,
            type: 'artillery', faction: 'ally'
          });
        }
      }

      if (k >= 1) {
        scene.remove(a.mesh);
        activeAirstrikes.splice(i, 1);
      }
    }
  }

  const timers = [];
  function after(sec, fn) { timers.push({ t: sec, fn }); }
  function flushTimers(dt) {
    for (let i = timers.length - 1; i >= 0; i--) {
      timers[i].t -= dt;
      if (timers[i].t <= 0) { const f = timers[i].fn; timers.splice(i, 1); f(); }
    }
  }

  function checkWin() {
    if (G.gameOver) return;
    const eHQ = G.buildings.find(b => b.type === 'hq' && b.faction === 'enemy' && !b.dead);
    const aHQ = G.buildings.find(b => b.type === 'hq' && b.faction === 'ally' && !b.dead);
    const enemyLeft = G.units.some(u => u.faction === 'enemy' && !u.dead) ||
      G.buildings.some(b => b.faction === 'enemy' && !b.dead);
    const allyLeft = G.units.some(u => u.faction === 'ally' && !u.dead) ||
      G.buildings.some(b => b.faction === 'ally' && !b.dead);
    if (!eHQ || !enemyLeft) { endGame(true); return; }
    if (!aHQ || !allyLeft) { endGame(false); return; }
  }

  function endGame(win) {
    if (G.gameOver) return;
    G.gameOver = true;
    G.victory = win;
    setTimeout(() => UI.showEnd(win), 1600);
  }

  function onAllyLost(u) {
    G.stats.losses++;
    if (Math.random() < 0.5) UI.log(`Потеряно подразделение: ${u.def.name}`, 'warn');
    UI.refreshSelection();
  }
  function onEnemyLost(u) {
    G.stats.kills++;
    UI.refreshSelection();
  }
  function onBuildingLost(b) {
    if (b.faction === 'ally') {
      UI.log(`Постройка разрушена: ${b.def.name}`, 'warn');
      Sfx.ui('alarm');
    } else {
      UI.log(`Уничтожен объект противника: ${b.def.name}`, 'good');
    }
    UI.refreshSelection();
  }
  function onProduced(b, type) {
    if (b.faction === 'ally') {
      UI.log(`Готово к бою: ${UNIT_DEFS[type].name}`, 'good');
    }
  }

  // ---------------------------------------------------------
  //  ХЕЛПЕРЫ ДЛЯ КАМЕРЫ
  // ---------------------------------------------------------
  function cameraTargetX() { return window.App ? App.cameraFocusX() : 0; }

  const API = {
    findTargetFor, applyDamage, scheduleHit, spawnProjectile, queryNear,
    spawnUnit, productionPoint, onProduced, onAllyLost, onEnemyLost, onBuildingLost,
    removeUnit, removeBuilding
  };

  // публичный объект (для удобства)
  Object.assign(G, {
    reset, spawnUnit, spawnBuilding, removeUnit, removeBuilding,
    queryNear, findTargetFor, applyDamage, scheduleHit, spawnProjectile,
    setSelection, selectBuilding, issueMove, issueAttack, issueAttackGround,
    stopAll, holdAll, toggleStance, update, step,
    queueUnit, cancelQueue, placeBuilding, canBuild, productionPoint, after,
    queuePopAll, queuePop,
    cameraTargetX, onAllyLost, onEnemyLost, onBuildingLost, onProduced,
    updatePoints, updateEconomy, endGame, formationPoints,
    abilities, triggerAbility
  });

  return G;
})();