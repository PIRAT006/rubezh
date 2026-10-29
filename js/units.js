/* ============================================================
   units.js — юниты, постройки, оружие и их поведение
   ============================================================ */
'use strict';

// ---------------- типы оружия ----------------
// armor: 'infantry' | 'light' | 'heavy' | 'air' | 'building'
const DAMAGE_MULT = {
  bullet: { infantry: 1.0, light: 0.30, heavy: 0.10, air: 0.45, building: 0.12 },
  shell: { infantry: 0.95, light: 0.95, heavy: 0.55, air: 0.0, building: 1.15 },
  atgm: { infantry: 0.45, light: 1.05, heavy: 1.10, air: 0.0, building: 0.75 },
  artillery: { infantry: 1.15, light: 1.0, heavy: 0.42, air: 0.0, building: 1.35 },
  bomb: { infantry: 1.2, light: 1.0, heavy: 0.5, air: 0.0, building: 1.05 },
  flak: { infantry: 0.25, light: 0.05, heavy: 0.0, air: 1.0, building: 0.0 }
};

const UNIT_DEFS = {
  infantry: {
    name: 'Мотострелки', tag: 'Пехота', cost: 55, time: 6, pop: 2,
    hp: 135, armor: 'infantry', speed: 6.2, vision: 36, radius: 2.0, turn: 5.5,
    icon: 'inf', desc: 'Отделение с автоматами и ПТУР/РПГ. Захватывает пункты.',
    capture: 1.0,
    weapons: [
      { id: 'rifle', name: 'АК-12', type: 'bullet', dmg: 8, cd: 0.32, range: 25, burst: 4, spread: 0.45, sound: 'rifle', tracer: [1, 0.86, 0.5] },
      { id: 'atgm', name: 'РПГ-30', type: 'atgm', dmg: 68, cd: 6.0, range: 42, speed: 48, sound: 'launch', missile: true, onlyArmor: true }
    ],
    count: 4
  },
  ifv: {
    name: 'БМП «Рысь»', tag: 'Бронетехника', cost: 105, time: 8, pop: 3,
    hp: 340, armor: 'light', speed: 9.6, vision: 38, radius: 2.6, turn: 2.8,
    icon: 'ifv', desc: 'Быстрая машина: 30мм автопушка и управляемый ПТУР.',
    weapons: [
      { id: 'auto', name: '30мм 2А42', type: 'shell', dmg: 26, cd: 0.35, range: 34, burst: 3, spread: 0.32, sound: 'heavyGun', tracer: [1, 0.82, 0.45], splash: 1.3, light: true },
      { id: 'atgm', name: 'ПТУР «Корнет»', type: 'atgm', dmg: 85, cd: 7.5, range: 46, speed: 52, sound: 'launch', missile: true }
    ],
    turret: true
  },
  tank: {
    name: 'ОБТ «Гранит»', tag: 'Бронетехника', cost: 185, time: 12, pop: 5,
    hp: 480, armor: 'heavy', speed: 7.5, vision: 36, radius: 3.0, turn: 2.2,
    icon: 'tank', desc: 'Основная ударная сила. 125мм гладкоствольное орудие и спаренный пулемёт.',
    weapons: [
      { id: 'cannon', name: '125мм 2А46', type: 'shell', dmg: 165, cd: 3.0, range: 38, speed: 95, sound: 'cannon', splash: 2.6, tracer: [1, 0.75, 0.4] },
      { id: 'coax', name: '7.62мм ПКТ', type: 'bullet', dmg: 11, cd: 0.11, range: 28, burst: 1, spread: 0.28, sound: 'coaxialMG', tracer: [1, 0.9, 0.5] }
    ],
    turret: true
  },
  artillery: {
    name: 'САУ «Молот»', tag: 'Артиллерия', cost: 210, time: 15, pop: 4,
    hp: 250, armor: 'light', speed: 5.8, vision: 32, radius: 3.0, turn: 1.6,
    icon: 'art', desc: 'Дальняя поддержка: навесной 152мм огонь по площади.',
    weapons: [
      { id: 'howitzer', name: '152мм 2А64', type: 'artillery', dmg: 125, cd: 8.0, range: 135, minRange: 24, speed: 75, splash: 7.5, arc: true, sound: 'cannon' }
    ],
    turret: true, siege: true
  },
  aa: {
    name: 'ЗРК «Щит»', tag: 'ПВО', cost: 155, time: 10, pop: 3,
    hp: 290, armor: 'light', speed: 8.2, vision: 48, radius: 2.8, turn: 2.6,
    icon: 'aa', desc: 'ПВО и огневая поддержка: ракеты по воздуху и спаренная 23мм автопушка.',
    weapons: [
      { id: 'flak', name: 'ЗУР «Стрела»', type: 'flak', dmg: 95, cd: 2.4, range: 60, speed: 115, sound: 'launch', missile: true, airOnly: true },
      { id: 'autocannon', name: '23мм ЗУ-23', type: 'bullet', dmg: 14, cd: 0.15, range: 34, burst: 2, spread: 0.35, sound: 'heavyGun', tracer: [0.8, 1, 0.6] }
    ],
    turret: true
  },
  mlrs: {
    name: 'РСЗО «Шквал»', tag: 'Артиллерия', cost: 265, time: 18, pop: 6,
    hp: 260, armor: 'light', speed: 6.2, vision: 32, radius: 3.0, turn: 1.6,
    icon: 'mlrs', desc: 'Залп 220мм реактивными снарядами. Чудовищный урон по площади.',
    weapons: [
      { id: 'rockets', name: '220мм РСЗО', type: 'artillery', dmg: 48, cd: 25, range: 175, minRange: 45, speed: 100, splash: 6.5, arc: true, salvo: 8, salvoDelay: 0.16, sound: 'launch' }
    ],
    turret: true, siege: true
  },
  recon: {
    name: 'Разведка', tag: 'Разведка', cost: 70, time: 5, pop: 1,
    hp: 175, armor: 'light', speed: 14.0, vision: 56, radius: 2.0, turn: 4.2,
    icon: 'rec', desc: 'Шустрый броневик-дозор: огромный обзор, пулемёт и быстрый захват.',
    capture: 0.75,
    weapons: [
      { id: 'mg', name: '12.7мм Корд', type: 'bullet', dmg: 12, cd: 0.15, range: 26, burst: 3, spread: 0.38, sound: 'coaxialMG', tracer: [1, 0.88, 0.5] }
    ]
  },
  drone: {
    name: 'Дрон-камикадзе', tag: 'Авиация', cost: 95, time: 7, pop: 1,
    hp: 85, armor: 'air', speed: 17, vision: 50, radius: 1.4, turn: 5.2, fly: 15,
    icon: 'drone', desc: 'Барражирующий боеприпас. Пикирует на цель и детонирует.',
    weapons: [
      { id: 'bomb', name: 'Кумулятивный заряд', type: 'bomb', dmg: 85, cd: 6.5, range: 3, speed: 45, splash: 5.5, arc: true, sound: 'launch' }
    ]
  }
};

const BUILDING_DEFS = {
  hq: {
    name: 'Штаб', cost: 0, time: 0, hp: 3200, armor: 'building', vision: 40,
    radius: 13, icon: 'hq', tag: 'Штаб', desc: 'Командный пункт. Его потеря — конец операции.',
    income: 2, cap: 20
  },
  barracks: {
    name: 'Казарма', cost: 190, time: 14, hp: 900, armor: 'building', vision: 26,
    radius: 7, icon: 'barracks', tag: 'Казарма', desc: 'Производит пехоту и разведку.',
    income: 1, cap: 8, builds: ['infantry', 'recon']
  },
  factory: {
    name: 'Мастерская', cost: 320, time: 20, hp: 1250, armor: 'building', vision: 26,
    radius: 8, icon: 'factory', tag: 'Мастерская', desc: 'Производит бронетехнику и артиллерию.',
    income: 1, cap: 8, builds: ['ifv', 'tank', 'artillery', 'mlrs', 'aa']
  },
  depot: {
    name: 'Склад ГСМ', cost: 240, time: 16, hp: 780, armor: 'building', vision: 24,
    radius: 6, icon: 'depot', tag: 'Склад', desc: 'Ускоряет снабжение: +4 единицы в секунду.',
    income: 4, cap: 4
  }
};

// ---------------- утилиты ----------------
function damageMult(type, armorClass) {
  const row = DAMAGE_MULT[type];
  if (!row) return 1;
  return row[armorClass] !== undefined ? row[armorClass] : 1;
}

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _n = new THREE.Vector3();

// ============================================================
//  КЛАСС ЮНИТА
// ============================================================
class Unit {
  constructor(type, faction, x, z) {
    const def = UNIT_DEFS[type];
    this.id = ++Unit._id;
    this.type = type;
    this.def = def;
    this.faction = faction;
    this.x = x;
    this.z = z;
    this.y = World.height(x, z);
    this.angle = faction === 'ally' ? 0 : Math.PI;
    this.turretAngle = this.angle;
    this.hp = def.hp;
    this.maxHp = def.hp;
    this.dead = false;
    this.speed = def.speed;
    this.vision = def.vision;
    this.radius = def.radius;
    this.armor = def.armor;
    this.path = null;
    this._x = this.x; // хеш-координаты
    this.pathIdx = 0;
    this.order = { kind: 'idle' };
    this.target = null;
    this.targetLockT = 0;
    this.repathT = 0;
    this.cooldowns = def.weapons.map(() => Util.rnd(0, 0.4));
    this.salvoLeft = 0;
    this.salvoT = 0;
    this.salvoWeapon = -1;
    this.selected = false;
    this.muzzleFlashT = 0;
    this.bobT = Math.random() * 10;
    this.smokeT = Util.rnd(0.5, 2);
    this.hitFlash = 0;
    this.trackT = 0;
    this.stuckT = 0;
    this.lastX = x; this.lastZ = z;
    this.vx = 0; this.vz = 0;
    this.moveDist = 0;
    this.holding = false;
    this.veteran = 0;
    this.xp = 0;

    // --- модель ---
    this.mesh = Models.build(type, faction);
    this.mesh.userData.unitId = this.id;
    this.mesh.position.set(x, this.y, z);
    this.mesh.rotation.set(0, this.angle, 0);
    this.mesh.scale.setScalar(1);
    this.turret = this.mesh.userData.turret || null;
    this.soldiers = this.mesh.userData.soldiers || null;
    this.rotors = [];
    this.mesh.traverse(o => { if (o.userData && o.userData.rotor) this.rotors.push(o); });
    if (this.turret) this.turret.rotation.y = 0;
    Game.scene.add(this.mesh);

    // маркер выделения
    if (faction === 'ally') {
      this.ring = new THREE.Mesh(
        Unit.ringGeo,
        new THREE.MeshBasicMaterial({
          map: Unit.ringTex, transparent: true, opacity: 0, depthWrite: false,
          color: 0x7de6b4, blending: THREE.AdditiveBlending
        })
      );
      this.ring.rotation.x = -Math.PI / 2;
      this.ring.renderOrder = 12;
      this.ring.visible = false;
      Game.scene.add(this.ring);
    }
  }

  get alive() { return !this.dead; }
  get isAir() { return this.armor === 'air'; }
  get pos() { return { x: this.x, y: this.y, z: this.z }; }

  centerY() {
    if (this.isAir) return this.y + (this.def.fly || 15);
    return this.y + (this.def.model === 'infantry' ? 1.0 : 1.4);
  }

  // ---------------- приказы ----------------
  setOrder(order) {
    this.order = order;
    this.path = null;
    this.pathIdx = 0;
    this.repathT = 0;
    if (order.kind === 'idle' || order.kind === 'hold') this.target = null;
  }

  moveTo(x, z, attackMove) {
    const p = World.nearestPassable(x, z, 20);
    if (!p) return false;
    this.setOrder({ kind: attackMove ? 'attackmove' : 'move', x: p.x, z: p.z });
    this._computePath(p.x, p.z);
    return true;
  }

  attack(target) {
    if (!target || target.dead) return;
    this.setOrder({ kind: 'attack', target });
  }

  attackGround(x, z) {
    this.setOrder({ kind: 'ground', x, z });
    this._computePath(x, z);
  }

  hold() {
    this.setOrder({ kind: 'hold' });
    this.path = null;
  }

  gainXP(dmg, killed) {
    if (this.dead || this.faction !== 'ally') return;
    this.xp += Math.round(dmg * 0.4) + (killed ? 80 : 0);
    if (this.xp >= 250 && this.veteran < 2) {
      this.veteran = 2;
      this.hp = Math.min(this.maxHp * 1.3, this.hp + 70);
      this.maxHp = Math.round(this.maxHp * 1.3);
      this.speed = this.def.speed * 1.2;
      if (typeof UI !== 'undefined' && UI.toast) {
        UI.toast(`★★ [АС] ${this.def.name} получил высший ранг! (+30% перезарядка, +20% скорость)`, 'good');
      }
      Effects.shockwave(this.x, this.y, this.z, 5.5, 0.45, 0xffe277);
      Sfx.ui('ok');
    } else if (this.xp >= 100 && this.veteran < 1) {
      this.veteran = 1;
      this.hp = Math.min(this.maxHp * 1.15, this.hp + 40);
      this.maxHp = Math.round(this.maxHp * 1.15);
      this.speed = this.def.speed * 1.1;
      if (typeof UI !== 'undefined' && UI.toast) {
        UI.toast(`★ [ВЕТЕРАН] ${this.def.name} повышен в звании! (+15% перезарядка)`, 'good');
      }
      Effects.shockwave(this.x, this.y, this.z, 4.2, 0.35, 0x7de6b4);
      Sfx.ui('ok');
    }
  }

  fireDirect(wi, aimPoint, target, g) {
    if (this.dead) return false;
    const w = this.def.weapons[wi];
    if (!w) return false;
    if (this.cooldowns[wi] > 0) return false;

    const cdMult = this.veteran >= 2 ? 0.7 : this.veteran >= 1 ? 0.85 : 1.0;
    this.cooldowns[wi] = w.cd * cdMult;

    if (w.salvo) {
      this.salvoLeft = w.salvo;
      this.salvoWeapon = wi;
      this.salvoT = 0;
      this._salvoAim = aimPoint;
    } else {
      this._fireWeapon(wi, target || null, aimPoint, g);
    }
    return true;
  }

  stop() {
    this.setOrder({ kind: 'idle' });
  }

  _computePath(tx, tz) {
    const p = Pathfinder.find(this.x, this.z, tx, tz, 7000);
    if (p && p.length) {
      this.path = p;
      this.pathIdx = 0;
      return true;
    }
    this.path = null;
    return false;
  }

  // ---------------- обновление ----------------
  update(dt, g) {
    if (this.dead) return;
    const def = this.def;

    this.bobT += dt;
    this.hitFlash = Math.max(0, this.hitFlash - dt * 4);

    if (this.order.kind === 'hold') this.holding = true; else this.holding = false;

    // --- проверка цели ---
    if (this.target) {
      const t = this.target;
      if (t.dead) this.target = null;
      else {
        const td = Util.dist(this.x, this.z, t.x, t.z);
        const maxR = this.maxRange();
        if (this.order.kind !== 'attack' && td > maxR * 1.25 + 6) this.target = null;
        if (!this.canSee(t) && this.order.kind !== 'attack') this.target = null;
      }
    }

    // --- поиск цели ---
    // Приоритет: ближайшая угроза в радиусе огня, иначе — цель приказа.
    if (this.order.kind === 'attack') {
      const ordered = this.order.target;
      const threat = g.findTargetFor(this, this.maxRange());
      if (threat && (!threat.isBuilding || !ordered || ordered.isBuilding)) {
        this.target = threat;
      } else if (ordered && !ordered.dead) {
        const d = Util.dist(this.x, this.z, ordered.x, ordered.z);
        this.target = d <= this.maxRange() ? ordered : null;
      } else {
        this.target = null;
      }
    } else if (!this.target && !this.holding) {
      const autoRange = (this.order.kind === 'move') ? 0 : this.maxRange();
      if (autoRange > 0) {
        const t = g.findTargetFor(this, autoRange);
        if (t) this.target = t;
      }
    }

    // --- логика приказа ---
    let moving = false;
    switch (this.order.kind) {
      case 'move':
        moving = this._followPath(dt);
        break;
      case 'attackmove':
        moving = this._followPath(dt);
        if (this.target) moving = false;
        break;
      case 'ground': {
        // артиллерия подходит на дистанцию залпа и работает с места
        const gx = this.order.x, gz = this.order.z;
        const gd = Util.dist(this.x, this.z, gx, gz);
        let artRange = 0;
        for (const w of this.def.weapons) if (w.type === 'artillery') artRange = Math.max(artRange, w.range);
        if (artRange > 0 && gd <= artRange * 0.88) {
          this.path = null;
          moving = false;
        } else {
          moving = this._followPath(dt);
        }
        break;
      }
      case 'attack': {
        const t = this.order.target;
        if (!t || t.dead) { this.setOrder({ kind: 'idle' }); break; }
        const d = Util.dist(this.x, this.z, t.x, t.z);
        // дистанция подхода: 72% дальности, чтобы не упираться в предел
        const rng = Math.max(6, this.bestRangeFor(t) * 0.72);
        if (d > rng) {
          this.repathT -= dt;
          if (this.repathT <= 0 || !this.path) {
            this.repathT = 1.4 + Math.random() * 0.8;
            const approach = Pathfinder.findApproach(this.x, this.z, t.x, t.z, rng * 0.92);
            if (approach && approach.length) { this.path = approach; this.pathIdx = 0; }
            else this._computePath(t.x, t.z);
          }
          moving = this._followPath(dt);
        } else {
          this.path = null;
          moving = false;
        }
        break;
      }
      case 'hold':
      case 'idle':
      default:
        break;
    }

    // --- стрельба ---
    this._updateWeapons(dt, g, moving);

    // --- визуал ---
    this._updateVisual(dt, moving);

    // --- дым при повреждениях ---
    if (this.hp < this.maxHp * 0.42) {
      this.smokeT -= dt;
      if (this.smokeT <= 0) {
        this.smokeT = Util.rnd(0.12, 0.4);
        Effects.smokePlume(
          this.x + Util.rnd(-0.8, 0.8), this.y + 1.8, this.z + Util.rnd(-0.8, 0.8),
          [0.12, 0.11, 0.1], 0.8, 1.6
        );
        if (this.hp < this.maxHp * 0.2 && Math.random() < 0.4) {
          Effects.smokePlume(this.x, this.y + 1.2, this.z, [1, 0.5, 0.2], 0.4, 0.5);
        }
      }
    }
  }

  maxRange() {
    let r = 0;
    for (let i = 0; i < this.def.weapons.length; i++) {
      const w = this.def.weapons[i];
      if (w.range > r) r = w.range;
    }
    return r;
  }

  bestRangeFor(t) {
    // выбираем оружие по типу цели
    let best = 0;
    for (const w of this.def.weapons) {
      if (w.airOnly && t.armor !== 'air') continue;
      if (w.type === 'flak' && t.armor !== 'air') continue;
      const mult = damageMult(w.type, t.armor);
      if (mult <= 0.02) continue;
      if (w.range > best) best = w.range;
    }
    return best || this.maxRange();
  }

  canSee(t) {
    if (t.isAir) return true;
    return World.lineOfSight(this.x, this.centerY(), this.z, t.x, t.centerY ? t.centerY() : t.y + 1.5, t.z);
  }

  // ---------------- движение ----------------
  _followPath(dt) {
    if (!this.path || this.pathIdx >= this.path.length) return false;
    const wp = this.path[this.pathIdx];
    const d = Util.dist(this.x, this.z, wp.x, wp.z);
    if (d < 1.4) {
      this.pathIdx++;
      if (this.pathIdx >= this.path.length) {
        this.path = null;
        if (this.order.kind === 'move') this.setOrder({ kind: 'idle' });
        return false;
      }
      return true;
    }

    const desired = Math.atan2(wp.x - this.x, wp.z - this.z);
    // плавный поворот
    const turnRate = this.def.turn * dt;
    this.angle = Util.angleLerp(this.angle, desired, Math.min(1, turnRate));

    const align = Math.cos(Util.angleLerp(this.angle, desired, 1) - this.angle);
    const alignFactor = Util.clamp(align, 0.15, 1);

    let spd = this.speed;
    // уклон
    if (!this.isAir) {
      const sl = World.slopeAt(this.x, this.z);
      spd *= Util.clamp(1 - sl * 0.45, 0.35, 1);
      // брод и вода
      if (World.isWater(this.x, this.z)) spd *= 0.55;
      if (World.onBridge(this.x, this.z, 1)) spd *= 0.9;
    }
    // замедление в строю
    spd *= alignFactor;

    this._move(dt, Math.sin(this.angle) * spd, Math.cos(this.angle) * spd);
    return true;
  }

  _move(dt, vx, vz) {
    // сепарация
    const near = Game.queryNear(this.x, this.z, this.radius + 3.2);
    let sx = 0, sz = 0;
    for (let i = 0; i < near.length; i++) {
      const o = near[i];
      if (o === this || o.dead) continue;
      if (o.isAir !== this.isAir) continue;
      const dx = this.x - o.x, dz = this.z - o.z;
      const dd = Math.hypot(dx, dz);
      const minD = this.radius + o.radius * 0.85;
      if (dd < minD && dd > 0.001) {
        const push = (minD - dd) / minD;
        sx += (dx / dd) * push * 14;
        sz += (dz / dd) * push * 14;
      }
    }

    let nx = this.x + (vx + sx) * dt;
    let nz = this.z + (vz + sz) * dt;

    // проверка проходимости
    if (!this.isAir) {
      if (!World.isNavigable(nx, nz)) {
        // пробуем сдвиг в сторону
        if (World.isNavigable(nx, this.z)) nz = this.z;
        else if (World.isNavigable(this.x, nz)) nx = this.x;
        else { nx = this.x; nz = this.z; this.stuckT += dt; }
      }
    }
    const limit = World.HALF - 5;
    nx = Util.clamp(nx, -limit, limit);
    nz = Util.clamp(nz, -limit, limit);

    this.moveDist += Util.dist(this.x, this.z, nx, nz);
    this.x = nx; this.z = nz;
    this.y = World.height(this.x, this.z);
  }

  // ---------------- оружие ----------------
  _updateWeapons(dt, g, moving) {
    const weapons = this.def.weapons;
    for (let i = 0; i < weapons.length; i++) {
      if (this.cooldowns[i] > 0) this.cooldowns[i] -= dt;
    }
    // залп
    if (this.salvoLeft > 0) {
      this.salvoT -= dt;
      if (this.salvoT <= 0) {
        this.salvoT = weapons[this.salvoWeapon].salvoDelay || 0.15;
        this.salvoLeft--;
        const aim = this._salvoAim || { x: this.x, z: this.z - 40 };
        this._fireWeapon(this.salvoWeapon, null, aim, g);
      }
    }

    // огонь по указанной точке (атака по площади)
    if (this.order.kind === 'ground') {
      const gx = this.order.x, gz = this.order.z;
      const gd = Util.dist(this.x, this.z, gx, gz);
      for (let i = 0; i < weapons.length; i++) {
        const w = weapons[i];
        if (w.type !== 'artillery' && !w.salvo) continue;
        if (this.cooldowns[i] > 0) continue;
        if (gd > w.range) continue;
        if (w.minRange && gd < w.minRange) continue;
        if (this.turret) {
          const aimAngle = Math.atan2(gx - this.x, gz - this.z);
          const diff = Math.abs(((aimAngle - this.turretAngle + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
          if (diff > 0.15) { this.turretAngle = Util.angleLerp(this.turretAngle, aimAngle, Math.min(1, dt * 4)); continue; }
        }
        this.cooldowns[i] = w.cd;
        if (w.salvo) {
          this.salvoLeft = w.salvo;
          this.salvoWeapon = i;
          this.salvoT = 0;
          this._salvoAim = { x: gx, z: gz, y: World.height(gx, gz) + 0.4 };
        } else {
          this._fireWeapon(i, null, { x: gx, z: gz, y: World.height(gx, gz) + 0.4 }, g);
        }
        break;
      }
      return;
    }

    const t = this.target;
    if (!t || t.dead) return;

    const canAir = t.armor === 'air';
    for (let i = 0; i < weapons.length; i++) {
      const w = weapons[i];
      if (this.cooldowns[i] > 0) continue;
      if (w.airOnly && !canAir) continue;
      if (w.type === 'flak' && !canAir) continue;

      const d = Util.dist(this.x, this.z, t.x, t.z);
      if (d > w.range) continue;
      if (w.minRange && d < w.minRange) continue;

      const mult = damageMult(w.type, t.armor);
      if (mult < 0.05) continue;

      if (w.type !== 'artillery' && !w.airOnly) {
        if (!this.canSee(t)) continue;
      }
      if (w.type === 'atgm' && t.armor === 'infantry' && Math.random() < 0.7) continue;

      // наведение башни
      const aimAngle = Math.atan2(t.x - this.x, t.z - this.z);
      if (this.turret) {
        const diff = Math.abs(((aimAngle - this.turretAngle + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
        if (diff > 0.12) { this.turretAngle = Util.angleLerp(this.turretAngle, aimAngle, Math.min(1, dt * 3.2)); continue; }
      }

      if (w.salvo) {
        this.salvoLeft = w.salvo;
        this.salvoWeapon = i;
        this.salvoT = 0;
        this._salvoAim = { x: t.x, z: t.z };
        this.cooldowns[i] = w.cd;
        continue;
      }

      this.cooldowns[i] = w.cd;
      this._fireWeapon(i, t, null, g);
      break;
    }
  }

  _muzzleWorld(weaponIndex) {
    const w = this.def.weapons[weaponIndex];
    const ang = this.turret ? this.turretAngle : this.angle;
    let len = 2.5;
    if (this.turret) len = this.mesh.userData.gunLen || 3.2;
    const h = this.def.model === 'infantry' ? 1.15 : 1.9;
    return {
      x: this.x + Math.sin(ang) * len * 0.86,
      y: this.isAir ? this.y + (this.def.fly || 15) - 0.2 : this.y + h,
      z: this.z + Math.cos(ang) * len * 0.86
    };
  }

  _fireWeapon(wi, target, groundTarget, g) {
    const w = this.def.weapons[wi];
    const muz = this._muzzleWorld(wi);
    const factionColor = this.faction === 'ally' ? [1, 0.92, 0.6] : [1, 0.72, 0.5];

    // --- лёгкие орудия БМП: скорострельные мини-снаряды ---
    if (w.light) {
      const aim = target || groundTarget;
      if (!aim) return;
      for (let b = 0; b < (w.burst || 1); b++) {
        const s = w.spread || 0.3;
        g.spawnProjectile({
          x: muz.x, y: muz.y, z: muz.z,
          tx: aim.x + Util.rnd(-s, s), ty: (target ? target.centerY() : World.height(aim.x, aim.z) + 0.5),
          tz: aim.z + Util.rnd(-s, s),
          target: target || null,
          speed: 220, arc: false, splash: w.splash || 0,
          dmg: w.dmg, type: w.type, owner: this, faction: this.faction,
          small: true
        });
      }
      Effects.muzzle(muz.x, muz.y, muz.z, factionColor, 0.8);
      Sfx.heavyGun(this.x, this.z);
      return;
    }

    if (w.type === 'bullet') {
      // трассеры по цели
      const burst = w.burst || 1;
      const aim = target || groundTarget;
      if (!aim) return;
      for (let b = 0; b < burst; b++) {
        const spread = w.spread || 0.4;
        const tx = aim.x + Util.rnd(-spread, spread);
        const tz = aim.z + Util.rnd(-spread, spread);
        const ty = (target ? target.centerY() : World.height(tx, tz) + 1) + Util.rnd(-0.3, 0.3);
        const to = { x: tx, y: ty, z: tz };
        const from = { x: muz.x + Util.rnd(-0.4, 0.4), y: muz.y + Util.rnd(-0.15, 0.2), z: muz.z + Util.rnd(-0.4, 0.4) };
        Effects.tracer(from, to, factionColor, 0.05 + Math.random() * 0.03);
        if (Math.random() < 0.65) {
          const ground = target ? false : true;
          Effects.bulletImpact(to.x, ground ? World.height(to.x, to.z) : to.y, to.z,
            target ? (target.armor === 'light' || target.armor === 'heavy' ? 'metal' : 'dirt') : 'dirt');
        }
      }
      Effects.muzzle(muz.x, muz.y, muz.z, factionColor, 0.55);
      if (target) {
        const dmg = w.dmg * burst * Util.rnd(0.85, 1.15);
        g.applyDamage(target, dmg, w.type, this);
      }
      if (Sfx.canShoot()) {
        const dx = this.x - Game.cameraTargetX();
        Sfx.rifle(this.x, this.z);
      }
      return;
    }

    if (w.missile) {
      const aim = target || groundTarget;
      if (!aim) return;
      Effects.muzzle(muz.x, muz.y, muz.z, [1, 0.85, 0.55], 0.9);
      Sfx.launch(this.x, this.z);
      const ty = target ? (target.centerY ? target.centerY() : target.y + 3) : World.height(aim.x, aim.z) + 1;
      g.spawnProjectile({
        x: muz.x, y: muz.y, z: muz.z,
        tx: aim.x, ty, tz: aim.z,
        target: target || null,
        speed: w.speed || 50, arc: false, splash: w.splash || 0,
        dmg: w.dmg, type: w.type, owner: this, faction: this.faction,
        missile: true, homing: true
      });
      return;
    }

    // снаряды/артиллерия
    const aim = groundTarget || target;
    if (!aim) return;
    const spreadR = w.splash ? w.splash * 0.55 : 0.6;
    const tx = aim.x + Util.rnd(-spreadR, spreadR);
    const tz = aim.z + Util.rnd(-spreadR, spreadR);
    const ty = target ? target.centerY() : World.height(tx, tz) + 0.4;

    Effects.muzzle(muz.x, muz.y, muz.z, [1, 0.8, 0.45], w.arc ? 1.6 : 1.0);
    Effects.dust(this.x + Math.sin(this.angle) * 2, this.y, this.z + Math.cos(this.angle) * 2, 3);
    Sfx.cannon(this.x, this.z);

    if (w.type === 'artillery') {
      Sfx.cannon(this.x, this.z);
      Effects.smokePlume(muz.x, muz.y, muz.z, [0.55, 0.52, 0.46], 1.2, 2.2);
    }

    g.spawnProjectile({
      x: muz.x, y: muz.y, z: muz.z,
      tx, ty, tz,
      target: target || null,
      speed: w.speed || 80,
      arc: !!w.arc,
      splash: w.splash || 0,
      dmg: w.dmg,
      type: w.type,
      owner: this,
      faction: this.faction,
      trail: w.arc
    });
  }

  // ---------------- визуал ----------------
  _updateVisual(dt, moving) {
    const h = World.height(this.x, this.z);
    if (this.isAir) {
      this.y = h;
      this.mesh.position.set(this.x, h + (this.def.fly || 15) + Math.sin(this.bobT * 2) * 0.25, this.z);
      this.mesh.rotation.y = this.angle;
      for (const r of this.rotors) r.rotation.y += dt * 40;
    } else {
      this.mesh.position.set(this.x, h, this.z);
      // наклон по рельефу
      World.normalAt(this.x, this.z, _n);
      _v1.set(Math.sin(this.angle), 0, Math.cos(this.angle));
      const dot = _v1.dot(_n);
      _v1.addScaledVector(_n, -dot).normalize();
      _v2.crossVectors(_n, _v1).normalize();
      const m = this._basis || (this._basis = new THREE.Matrix4());
      m.makeBasis(_v2, _n, _v1);
      const q = this._q || (this._q = new THREE.Quaternion());
      q.setFromRotationMatrix(m);
      this.mesh.quaternion.slerp(q, Math.min(1, dt * 6));
    }

    if (this.turret) {
      const rel = this.turretAngle - this.angle;
      this.turret.rotation.y = Util.angleLerp(this.turret.rotation.y, rel, Math.min(1, dt * 7));
    }

    if (this.soldiers) {
      const spd = moving ? 1 : 0;
      for (let i = 0; i < this.soldiers.length; i++) {
        const s = this.soldiers[i];
        const ph = this.bobT * 9 + i * 1.7;
        s.position.y = spd ? Math.abs(Math.sin(ph)) * 0.09 : 0;
        s.rotation.z = spd ? Math.sin(ph) * 0.045 : 0;
      }
      // разворот отделения
      this.mesh.rotation.y = this.angle;
    }

    // гусеничная пыль
    if (moving && !this.isAir && this.def.model !== 'infantry') {
      this.trackT -= dt;
      if (this.trackT <= 0) {
        this.trackT = Util.rnd(0.08, 0.2);
        const side = Math.random() < 0.5 ? -1 : 1;
        Effects.dust(
          this.x + Math.cos(this.angle) * side * 1.2 - Math.sin(this.angle) * 2,
          this.y, this.z - Math.cos(this.angle) * 2 + Math.sin(this.angle) * side * 1.2, 1
        );
      }
    }

    // кольцо выделения
    if (this.ring) {
      const vis = this.selected || Game.hovered === this;
      this.ring.visible = vis;
      if (vis) {
        this.ring.position.set(this.x, h + 0.18, this.z);
        this.ring.scale.setScalar(this.radius * 1.6);
        this.ring.material.opacity = 0.55 + Math.sin(performance.now() * 0.004) * 0.15;
        this.ring.material.color.setHex(this.selected ? 0x7de6b4 : 0xe3be7f);
      }
    }

    // скрытие в тумане
    if (this.faction !== 'ally') {
      const vis = World.fogVisibleAt(this.x, this.z);
      this.mesh.visible = vis;
      if (this.ring) this.ring.visible = vis && this.ring.visible;
    }
  }

  takeDamage(amount, type) {
    if (this.dead) return;
    const mult = damageMult(type, this.armor);
    const dmg = amount * mult;
    this.hp -= dmg;
    this.hitFlash = 1;
    if (Math.random() < 0.5 && World.fogVisibleAt(this.x, this.z)) {
      Effects.bulletImpact(
        this.x + Util.rnd(-1, 1), this.centerY(), this.z + Util.rnd(-1, 1),
        type === 'bullet' && this.armor === 'infantry' ? 'dirt' : 'metal'
      );
    }
    if (this.hp <= 0) this.die();
  }

  die() {
    if (this.dead) return;
    this.dead = true;
    this.hp = 0;
    const y = this.y + (this.isAir ? (this.def.fly || 15) : 0);
    const s = this.armor === 'heavy' ? 2.2 : this.armor === 'air' ? 0.9 : this.def.model === 'infantry' ? 0.55 : 1.5;
    Effects.explosion(this.x, y + 0.8, this.z, s);
    if (this.def.model === 'infantry') {
      for (let i = 0; i < 3; i++) Effects.explosion(this.x + Util.rnd(-2, 2), this.y + 0.4, this.z + Util.rnd(-2, 2), 0.35, { decal: false });
    }
    if (this.armor !== 'air') {
      Effects.decals.add(this.x, World.height(this.x, this.z) + 0.04, this.z, 3.2, 0.55, 90);
    }
    Sfx.explosion(this.x, this.z, s);
    if (typeof FPSControl !== 'undefined' && FPSControl.active && FPSControl.unit === this) {
      FPSControl.onUnitDestroyed();
    }
    // остов — сгоревший корпус, постепенно исчезает
    this._spawnWreck();
    if (this.faction === 'ally') {
      Game.onAllyLost(this);
    } else {
      Game.onEnemyLost(this);
    }
    this.dispose();
  }

  _spawnWreck() {
    try {
      const wreckMat = Models.mat(0x2a2723, 0.98, 0.05);
      const g = new THREE.Group();
      if (this.def.model === 'infantry') {
        // тёмное пятно и мешки
        const m = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.05, 2.2), wreckMat);
        m.position.y = 0.05;
        g.add(m);
      } else if (this.isAir) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.18, 1.1), wreckMat);
        m.rotation.z = 0.4;
        g.add(m);
      } else {
        const hull = this.mesh ? this.mesh.clone() : null;
        if (hull) {
          hull.traverse(o => {
            if (o.isMesh) o.material = wreckMat;
          });
          hull.scale.multiplyScalar(0.96);
          g.add(hull);
        }
      }
      if (!this.isAir) {
        g.position.set(this.x, World.height(this.x, this.z) - 0.1, this.z);
      } else {
        g.position.set(this.x, World.height(this.x, this.z) + 0.3, this.z);
        g.rotation.set(0.3, this.angle, 0.5);
      }
      if (!this.isAir) g.rotation.y = this.angle;
      Game.scene.add(g);
      // дым и исчезновение
      let life = 22;
      const tick = (dt) => {
        life -= dt;
        if (Math.random() < dt * 6) {
          Effects.smokePlume(g.position.x + Util.rnd(-1, 1), g.position.y + 1.0, g.position.z + Util.rnd(-1, 1), [0.22, 0.21, 0.2], 0.9, 2.4);
        }
        if (life < 0) {
          Game.scene.remove(g);
          Game.wrecks.delete(tick);
        }
      };
      Game.wrecks.add(tick);
    } catch (e) {
      /* визуальная мелочь, не критично */
    }
  }

  dispose() {
    Game.scene.remove(this.mesh);
    if (this.ring) { Game.scene.remove(this.ring); this.ring.material.dispose(); }
    Game.removeUnit(this);
  }
}

Unit._id = 0;

// общие геометрия/текстура кольца
Unit.ringGeo = (() => {
  const g = new THREE.PlaneGeometry(1, 1);
  return g;
})();
Unit.ringTex = (() => {
  const S = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const c = cv.getContext('2d');
  c.strokeStyle = 'rgba(255,255,255,0.95)';
  c.lineWidth = 5;
  c.beginPath(); c.arc(S / 2, S / 2, S / 2 - 10, 0, 6.283); c.stroke();
  c.lineWidth = 2;
  c.globalAlpha = 0.45;
  c.beginPath(); c.arc(S / 2, S / 2, S / 2 - 26, 0, 6.283); c.stroke();
  c.globalAlpha = 1;
  // уголки
  c.lineWidth = 6;
  for (let i = 0; i < 4; i++) {
    const a0 = i * Math.PI / 2 + 0.25, a1 = a0 + 0.35;
    c.beginPath();
    c.arc(S / 2, S / 2, S / 2 - 10, a0, a1);
    c.stroke();
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();

// ============================================================
//  ПОСТРОЙКА
// ============================================================
class Building {
  constructor(type, faction, x, z) {
    const def = BUILDING_DEFS[type];
    this.id = ++Building._id;
    this.type = type;
    this.def = def;
    this.faction = faction;
    this.x = x; this.z = z;
    this.y = World.height(x, z);
    this.hp = def.hp;
    this.maxHp = def.hp;
    this.armor = 'building';
    this.vision = def.vision;
    this.radius = def.radius;
    this.dead = false;
    this.queue = [];
    this.buildT = 0;
    this.income = def.income || 0;
    this.cap = def.cap || 0;
    this.angle = faction === 'ally' ? 0 : Math.PI;
    this.isBuilding = true;
    this.smokeT = 0;

    this.mesh = Models.build(type, faction);
    this.mesh.position.set(x, this.y, z);
    this.mesh.rotation.set(0, this.angle, 0);
    this.mesh.scale.setScalar(1);
    this.mesh.userData.buildingId = this.id;
    Game.scene.add(this.mesh);

    // кольцо
    const ring = new THREE.Mesh(Unit.ringGeo, new THREE.MeshBasicMaterial({
      map: Unit.ringTex, transparent: true, opacity: 0, depthWrite: false,
      color: 0xe3be7f, blending: THREE.AdditiveBlending
    }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, this.y + 0.2, z);
    ring.scale.setScalar(def.radius * 2.4);
    ring.renderOrder = 12;
    ring.visible = false;
    this.ring = ring;
    Game.scene.add(ring);
  }

  centerY() { return this.y + 3; }
  canSee() { return true; }

  update(dt, g) {
    if (this.dead) return;
    // производство
    if (this.queue.length) {
      const item = this.queue[0];
      item.t -= dt;
      if (item.t <= 0) {
        const p = g.productionPoint(this);
        if (p) {
          const u = g.spawnUnit(item.type, this.faction, p.x, p.z);
          if (u) {
            u.angle = this.angle;
            g.onProduced(this, item.type);
          }
        }
        this.queue.shift();
      }
    }
    // дым при повреждении
    if (this.hp < this.maxHp * 0.5) {
      this.smokeT -= dt;
      if (this.smokeT <= 0) {
        this.smokeT = Util.rnd(0.15, 0.5);
        Effects.smokePlume(
          this.x + Util.rnd(-this.radius * 0.5, this.radius * 0.5),
          this.y + 4, this.z + Util.rnd(-this.radius * 0.5, this.radius * 0.5),
          [0.14, 0.13, 0.12], 1.4, 2.6
        );
        if (this.hp < this.maxHp * 0.25) {
          Effects.smokePlume(this.x + Util.rnd(-3, 3), this.y + 2, this.z + Util.rnd(-3, 3), [1, 0.45, 0.18], 0.8, 0.7);
        }
      }
    }
    if (this.ring) {
      const vis = this.selected === true;
      this.ring.visible = vis;
      if (vis) this.ring.material.opacity = 0.4 + Math.sin(performance.now() * 0.004) * 0.12;
    }
    if (this.faction !== 'ally') {
      this.mesh.visible = World.fogExploredAt(this.x, this.z);
    }
  }

  takeDamage(amount, type) {
    if (this.dead) return;
    this.hp -= amount * damageMult(type, 'building');
    if (this.hp <= 0) this.die();
  }

  die() {
    if (this.dead) return;
    this.dead = true;
    for (let i = 0; i < 5; i++) {
      setTimeout(() => {
        if (!Game.running) return;
        Effects.explosion(
          this.x + Util.rnd(-this.radius * 0.7, this.radius * 0.7),
          this.y + Util.rnd(1, 5),
          this.z + Util.rnd(-this.radius * 0.7, this.radius * 0.7),
          Util.rnd(1.4, 2.6)
        );
      }, i * 160);
    }
    Effects.explosion(this.x, this.y + 3, this.z, 3.2);
    Sfx.explosion(this.x, this.z, 2.4);
    Game.onBuildingLost(this);
    Game.scene.remove(this.mesh);
    Game.scene.remove(this.ring);
    Game.removeBuilding(this);
  }
}
Building._id = 0;