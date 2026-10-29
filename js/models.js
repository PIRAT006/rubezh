/* ============================================================
   models.js — низкополигональные модели техники, пехоты и зданий
   ============================================================ */
'use strict';

const Models = (() => {

  const matCache = new Map();
  function mat(color, rough = 0.75, metal = 0.15, emissive = 0x000000, emiInt = 0) {
    const key = `${color}_${rough}_${metal}_${emissive}_${emiInt}`;
    if (matCache.has(key)) return matCache.get(key);
    const m = new THREE.MeshStandardMaterial({
      color, roughness: rough, metalness: metal, flatShading: false
    });
    if (emissive) { m.emissive = new THREE.Color(emissive); m.emissiveIntensity = emiInt; }
    matCache.set(key, m);
    return m;
  }

  const geoCache = new Map();
  function geo(key, make) {
    if (!geoCache.has(key)) geoCache.set(key, make());
    return geoCache.get(key);
  }

  function box(w, h, d, material, x = 0, y = 0, z = 0, parent = null, cast = true) {
    const g = geo(`b${w}_${h}_${d}`, () => new THREE.BoxGeometry(w, h, d));
    const m = new THREE.Mesh(g, material);
    m.position.set(x, y, z);
    m.castShadow = cast; m.receiveShadow = true;
    if (parent) parent.add(m);
    return m;
  }
  function cyl(rt, rb, h, seg, material, x = 0, y = 0, z = 0, parent = null) {
    const g = geo(`c${rt}_${rb}_${h}_${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg));
    const m = new THREE.Mesh(g, material);
    m.position.set(x, y, z);
    m.castShadow = true; m.receiveShadow = true;
    if (parent) parent.add(m);
    return m;
  }
  function cone(r, h, seg, material, x = 0, y = 0, z = 0, parent = null) {
    const g = geo(`k${r}_${h}_${seg}`, () => new THREE.ConeGeometry(r, h, seg));
    const m = new THREE.Mesh(g, material);
    m.position.set(x, y, z);
    m.castShadow = true;
    if (parent) parent.add(m);
    return m;
  }
  function sphere(r, material, x = 0, y = 0, z = 0, parent = null, seg = 8) {
    const g = geo(`s${r}_${seg}`, () => new THREE.SphereGeometry(r, seg, Math.max(4, seg / 2)));
    const m = new THREE.Mesh(g, material);
    m.position.set(x, y, z);
    m.castShadow = true;
    if (parent) parent.add(m);
    return m;
  }

  // ---- палитры фракций ----
  const PALETTE = {
    ally: {
      hull: 0x4d5a40, hull2: 0x3d4834, dark: 0x24261f, metal: 0x6a6f62,
      accent: 0x7de6b4, track: 0x1c1d1a, glass: 0x1a2622, canvas: 0x5c6349
    },
    enemy: {
      hull: 0x77705f, hull2: 0x5f5a4c, dark: 0x2a2823, metal: 0x8a8478,
      accent: 0xff5f45, track: 0x22211e, glass: 0x101010, canvas: 0x6d6653
    }
  };

  function tracks(parent, len, wid, gap, y, side, material) {
    for (const s of [-1, 1]) {
      const t = box(wid, 0.75, len, material, s * (gap / 2), y, 0, parent);
      t.castShadow = true;
      // катки
      for (let i = -2; i <= 2; i++) {
        const wheel = cyl(0.42, 0.42, wid + 0.1, 8, mat(0x2b2b26, 0.9, 0.2),
          s * (gap / 2), y - 0.15, i * (len / 5.6), parent);
        wheel.rotation.z = Math.PI / 2;
      }
    }
  }

  // ============== ПЕХОТА ==============
  function buildInfantry(faction) {
    const P = PALETTE[faction];
    const root = new THREE.Group();
    const squad = new THREE.Group();
    root.add(squad);
    const uniform = mat(faction === 'ally' ? 0x5a6142 : 0x6b6250, 0.9, 0.05);
    const vest = mat(faction === 'ally' ? 0x3f4530 : 0x50503f, 0.85, 0.1);
    const skin = mat(0xb08a6a, 0.9, 0);
    const gunMat = mat(0x2a2a26, 0.55, 0.5);
    const helmet = mat(faction === 'ally' ? 0x4a5138 : 0x5c5647, 0.85, 0.1);

    const offsets = [[-0.9, -0.6], [0.8, -0.8], [0.4, 0.9], [-0.7, 0.8]];
    const soldiers = [];
    for (let i = 0; i < 4; i++) {
      const s = new THREE.Group();
      s.position.set(offsets[i][0], 0, offsets[i][1]);
      // ноги
      box(0.22, 0.62, 0.24, uniform, -0.13, 0.31, 0, s);
      box(0.22, 0.62, 0.24, uniform, 0.13, 0.31, 0, s);
      // корпус
      box(0.5, 0.62, 0.34, uniform, 0, 0.9, 0, s);
      box(0.54, 0.42, 0.4, vest, 0, 0.95, 0, s);
      // голова + каска
      sphere(0.16, skin, 0, 1.32, 0, s, 6);
      const h = sphere(0.2, helmet, 0, 1.38, 0, s, 6);
      h.scale.y = 0.7;
      // руки + автомат
      box(0.12, 0.4, 0.12, uniform, -0.3, 0.9, 0.1, s);
      box(0.12, 0.4, 0.12, uniform, 0.3, 0.9, 0.1, s);
      const rifle = box(0.07, 0.1, 0.72, gunMat, 0.16, 1.0, 0.36, s);
      rifle.rotation.x = -0.12;
      s.rotation.y = Util.rnd(-0.25, 0.25);
      squad.add(s);
      soldiers.push(s);
    }
    root.userData.soldiers = soldiers;
    root.userData.kind = 'infantry';
    return root;
  }

  // ============== БМП / БТР ==============
  function buildIFV(faction) {
    const P = PALETTE[faction];
    const root = new THREE.Group();
    const body = new THREE.Group();
    root.add(body);
    const hullM = mat(P.hull, 0.8, 0.25), hull2 = mat(P.hull2, 0.85, 0.2);
    const dark = mat(P.dark, 0.9, 0.1), accent = mat(P.accent, 0.5, 0.2, P.accent, 0.25);

    box(2.5, 0.72, 5.0, dark, 0, 0.5, 0, body);        // днище
    box(2.6, 0.9, 4.3, hullM, 0, 1.1, -0.1, body);     // корпус
    // нос
    const nose = box(2.4, 0.72, 1.3, hull2, 0, 0.98, 2.42, body);
    nose.rotation.x = -0.44;
    // корма
    box(2.3, 1.15, 0.9, hull2, 0, 1.2, -2.42, body);
    // акцентная полоса фракции
    box(2.62, 0.1, 1.5, accent, 0, 1.53, -0.6, body, false);
    // башня
    const turret = new THREE.Group();
    turret.position.set(0, 1.62, 0.35);
    body.add(turret);
    box(1.5, 0.62, 1.7, hullM, 0, 0.28, 0, turret);
    const gun = cyl(0.1, 0.11, 2.5, 6, mat(0x33342c, 0.6, 0.5), 0, 0.32, 1.9, turret);
    gun.rotation.x = Math.PI / 2;
    box(0.32, 0.3, 0.7, dark, 0, 0.34, 0.9, turret);   // маска
    // ПТУР
    for (const s of [-1, 1]) {
      const tube = cyl(0.1, 0.1, 0.9, 6, mat(0x3a3b33, 0.7, 0.3), s * 0.55, 0.52, 0.55, turret);
      tube.rotation.x = Math.PI / 2;
    }
    // антенна
    const ant = cyl(0.02, 0.02, 1.5, 3, dark, -0.6, 1.2, -0.4, turret);
    ant.rotation.z = 0.16;
    // фары
    for (const s of [-1, 1]) sphere(0.13, mat(0xffe3a8, 0.3, 0.1, 0xffd27a, 0.6), s * 0.85, 1.15, 2.9, body, 6);

    tracks(body, 5.0, 0.48, 2.55, 0.48, 0, mat(P.track, 0.95, 0.15));

    root.userData.turret = turret;
    root.userData.gunLen = 2.9;
    root.userData.kind = 'vehicle';
    return root;
  }

  // ============== ОБТ ==============
  function buildTank(faction) {
    const P = PALETTE[faction];
    const root = new THREE.Group();
    const body = new THREE.Group();
    root.add(body);
    const hullM = mat(P.hull, 0.78, 0.3), hull2 = mat(P.hull2, 0.82, 0.25);
    const dark = mat(P.dark, 0.9, 0.15), accent = mat(P.accent, 0.5, 0.2, P.accent, 0.3);

    box(2.9, 0.62, 5.6, dark, 0, 0.46, 0, body);
    box(3.0, 0.86, 5.0, hullM, 0, 1.05, 0, body);
    const glacis = box(2.95, 0.62, 1.6, hull2, 0, 1.16, 2.55, body);
    glacis.rotation.x = -0.55;
    box(2.9, 0.24, 1.0, hull2, 0, 1.56, 1.9, body);
    box(3.01, 0.1, 1.9, accent, 0, 1.5, -1.3, body, false);
    // ящики на корме
    box(1.0, 0.5, 0.9, mat(0x3a3d33, 0.9, 0.1), -0.85, 1.72, -1.7, body);
    box(1.0, 0.5, 0.9, mat(0x3a3d33, 0.9, 0.1), 0.85, 1.72, -1.7, body);
    // башня
    const turret = new THREE.Group();
    turret.position.set(0, 1.72, 0.1);
    body.add(turret);
    box(2.3, 0.72, 2.8, hullM, 0, 0.34, 0, turret);
    const mantlet = box(1.0, 0.6, 0.6, hull2, 0, 0.38, 1.45, turret);
    const barrel = cyl(0.115, 0.135, 3.6, 8, mat(0x2f322b, 0.55, 0.55), 0, 0.38, 3.4, turret);
    barrel.rotation.x = Math.PI / 2;
    // дульный тормоз
    cyl(0.18, 0.18, 0.42, 8, mat(0x2a2d26, 0.6, 0.5), 0, 0.38, 5.15, turret).rotation.x = Math.PI / 2;
    // КОЭП / командирская башенка
    cyl(0.42, 0.45, 0.36, 8, hull2, 0.6, 0.82, -0.5, turret);
    const mg = cyl(0.05, 0.05, 1.1, 4, dark, 0.6, 0.95, 0.2, turret);
    mg.rotation.x = Math.PI / 2;
    // антенны
    for (const s of [-1, 1]) {
      const a = cyl(0.018, 0.018, 1.7, 3, dark, s * 0.95, 1.1, -0.9, turret);
      a.rotation.z = s * 0.12;
    }
    // дымы
    for (let i = 0; i < 3; i++) {
      for (const s of [-1, 1]) {
        const t = cyl(0.11, 0.11, 0.42, 6, mat(0x3b3d35, 0.8, 0.2), s * 1.1, 0.5, 1.0 - i * 0.38, turret);
        t.rotation.x = Math.PI / 2 - 0.4;
      }
    }
    tracks(body, 5.7, 0.55, 2.95, 0.46, 0, mat(P.track, 0.95, 0.2));

    root.userData.turret = turret;
    root.userData.gunLen = 5.4;
    root.userData.kind = 'vehicle';
    return root;
  }

  // ============== САУ ==============
  function buildArtillery(faction) {
    const P = PALETTE[faction];
    const root = new THREE.Group();
    const body = new THREE.Group();
    root.add(body);
    const hullM = mat(P.hull, 0.8, 0.25), hull2 = mat(P.hull2, 0.85, 0.2);
    const dark = mat(P.dark, 0.9, 0.1), accent = mat(P.accent, 0.5, 0.2, P.accent, 0.3);

    box(3.0, 0.68, 6.4, dark, 0, 0.52, 0, body);
    box(3.1, 0.9, 5.6, hullM, 0, 1.1, 0, body);
    const glacis = box(3.0, 0.6, 1.4, hull2, 0, 1.2, 3.0, body);
    glacis.rotation.x = -0.5;
    box(3.12, 0.1, 2.4, accent, 0, 1.57, -0.8, body, false);
    // рубка
    box(2.4, 1.0, 2.0, hull2, 0, 1.95, -0.9, body);
    // башня с орудием
    const turret = new THREE.Group();
    turret.position.set(0, 1.95, 1.0);
    body.add(turret);
    box(1.9, 0.9, 2.0, hullM, 0, 0.35, 0, turret);
    const barrel = cyl(0.14, 0.17, 5.2, 8, mat(0x2f322b, 0.55, 0.55), 0, 0.5, 3.2, turret);
    barrel.rotation.x = Math.PI / 2;
    barrel.rotation.z = 0;
    barrel.position.y = 0.5 + 0.0;
    barrel.rotation.order = 'YXZ';
    barrel.rotation.x = Math.PI / 2 - 0.18;
    cyl(0.22, 0.22, 0.5, 8, mat(0x2a2d26, 0.6, 0.5), 0, 0.92, 5.6, turret).rotation.x = Math.PI / 2 - 0.18;
    // стабилизаторы-упоры
    for (const s of [-1, 1]) {
      const leg = box(0.28, 0.28, 1.6, dark, s * 1.6, 0.4, -2.4, body);
      leg.rotation.x = 0.35;
    }
    tracks(body, 6.5, 0.62, 3.15, 0.48, 0, mat(P.track, 0.95, 0.2));

    root.userData.turret = turret;
    root.userData.gunLen = 5.4;
    root.userData.kind = 'vehicle';
    return root;
  }

  // ============== ПВО ==============
  function buildAA(faction) {
    const P = PALETTE[faction];
    const root = new THREE.Group();
    const body = new THREE.Group();
    root.add(body);
    const hullM = mat(P.hull, 0.8, 0.25), hull2 = mat(P.hull2, 0.85, 0.2);
    const dark = mat(P.dark, 0.9, 0.1), accent = mat(P.accent, 0.5, 0.2, P.accent, 0.3);

    box(2.8, 0.7, 5.8, dark, 0, 0.5, 0, body);
    box(2.9, 0.8, 5.0, hullM, 0, 1.05, 0, body);
    box(2.3, 0.9, 1.6, hull2, 0, 1.5, 2.0, body);   // кабина
    box(2.2, 0.32, 0.1, mat(P.glass, 0.2, 0.6), 0, 1.72, 2.78, body, false);
    box(2.92, 0.1, 1.6, accent, 0, 1.47, -1.0, body, false);
    // пусковая
    const turret = new THREE.Group();
    turret.position.set(0, 1.5, -1.0);
    turret.rotation.x = -0.32;
    body.add(turret);
    box(2.0, 0.4, 2.0, hull2, 0, 0.1, 0, turret);
    for (let i = 0; i < 2; i++) {
      for (let j = 0; j < 2; j++) {
        const tube = cyl(0.19, 0.19, 1.9, 6, mat(0x4b4d42, 0.7, 0.3),
          -0.55 + i * 1.1, 0.34, 0.2 + j * 0.5, turret);
        tube.rotation.x = Math.PI / 2;
      }
    }
    // радар
    const radar = new THREE.Group();
    radar.position.set(0, 1.5, 0.9);
    body.add(radar);
    cyl(0.09, 0.09, 1.5, 5, dark, 0, 0.75, 0, radar);
    const dish = box(1.5, 0.9, 0.08, mat(0x8d9187, 0.5, 0.5), 0, 1.6, 0.12, radar);
    dish.rotation.x = -0.2;
    tracks(body, 5.9, 0.55, 2.9, 0.46, 0, mat(P.track, 0.95, 0.2));

    root.userData.turret = turret;
    root.userData.radar = radar;
    root.userData.kind = 'vehicle';
    return root;
  }

  // ============== РСЗО ==============
  function buildMLRS(faction) {
    const P = PALETTE[faction];
    const root = new THREE.Group();
    const body = new THREE.Group();
    root.add(body);
    const hullM = mat(P.hull, 0.8, 0.25), hull2 = mat(P.hull2, 0.85, 0.2);
    const dark = mat(P.dark, 0.9, 0.1), accent = mat(P.accent, 0.5, 0.2, P.accent, 0.3);

    box(2.9, 0.55, 6.8, dark, 0, 0.62, 0, body);
    box(2.95, 0.8, 2.2, hullM, 0, 1.2, 2.2, body);       // кабина
    box(2.4, 0.4, 0.1, mat(P.glass, 0.2, 0.6), 0, 1.42, 3.28, body, false);
    box(2.95, 0.9, 4.2, hull2, 0, 1.15, -0.9, body);     // рама
    box(2.97, 0.1, 1.4, accent, 0, 1.58, 1.1, body, false);
    const turret = new THREE.Group();
    turret.position.set(0, 1.75, -1.0);
    body.add(turret);
    // пакет направляющих
    const pod = new THREE.Group();
    pod.rotation.x = -0.28;
    turret.add(pod);
    box(2.4, 0.16, 2.4, hullM, 0, 0.1, 0, pod);
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 4; c++) {
        const tube = cyl(0.12, 0.12, 2.2, 5, mat(0x3d3f36, 0.8, 0.2),
          -0.9 + c * 0.6, 0.12 + r * 0.24, 0, pod);
        tube.rotation.x = Math.PI / 2;
      }
    }
    // опоры
    for (const s of [-1, 1]) {
      const leg = box(0.22, 0.22, 1.5, dark, s * 1.55, 0.55, -2.6, body);
      leg.rotation.x = 0.3;
    }
    tracks(body, 7.0, 0.6, 3.0, 0.5, 0, mat(P.track, 0.95, 0.2));

    root.userData.turret = turret;
    root.userData.kind = 'vehicle';
    return root;
  }

  // ============== РАЗВЕДКА ==============
  function buildRecon(faction) {
    const P = PALETTE[faction];
    const root = new THREE.Group();
    const body = new THREE.Group();
    root.add(body);
    const hullM = mat(P.hull, 0.75, 0.3), hull2 = mat(P.hull2, 0.8, 0.25);
    const dark = mat(P.dark, 0.9, 0.1), accent = mat(P.accent, 0.5, 0.2, P.accent, 0.35);

    box(2.2, 0.5, 4.2, hullM, 0, 0.72, 0, body);
    box(1.9, 0.52, 1.4, hull2, 0, 1.2, 0.3, body);
    const glass = box(1.6, 0.3, 0.1, mat(P.glass, 0.15, 0.7), 0, 1.3, 1.02, body, false);
    box(2.22, 0.08, 1.0, accent, 0, 0.99, -0.9, body, false);
    // дуга каркаса
    const bar = box(0.09, 0.55, 0.09, dark, -0.85, 1.6, 0.3, body);
    const bar2 = box(0.09, 0.55, 0.09, dark, 0.85, 1.6, 0.3, body);
    box(1.8, 0.09, 0.09, dark, 0, 1.86, 0.3, body);
    // пулемёт
    cyl(0.05, 0.05, 0.9, 4, dark, 0, 1.55, 1.0, body).rotation.x = Math.PI / 2;
    // колёса
    for (const s of [-1, 1]) {
      for (const p of [1.4, -1.4]) {
        const w = cyl(0.5, 0.5, 0.42, 10, mat(0x22221e, 0.95, 0.1), s * 1.15, 0.5, p, body);
        w.rotation.z = Math.PI / 2;
      }
    }
    // антенна
    const a = cyl(0.02, 0.02, 2.2, 3, dark, 0.8, 1.4, -1.4, body);
    a.rotation.z = -0.12;
    root.userData.kind = 'vehicle';
    root.userData.turret = null;
    return root;
  }

  // ============== ДРОН ==============
  function buildDrone(faction) {
    const P = PALETTE[faction];
    const root = new THREE.Group();
    const body = new THREE.Group();
    root.add(body);
    const dark = mat(0x22241f, 0.6, 0.5);
    const accent = mat(P.accent, 0.4, 0.3, P.accent, 0.9);
    box(0.7, 0.22, 0.7, dark, 0, 0, 0, body);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const arm = box(0.09, 0.09, 0.75, dark, sx * 0.42, 0, sz * 0.42, body);
      arm.rotation.y = Math.atan2(sx, sz) * -1;
      const rotor = cyl(0.34, 0.34, 0.03, 8, mat(0x4a4d44, 0.5, 0.4, 0, 0), sx * 0.62, 0.12, sz * 0.62, body);
      rotor.userData.rotor = true;
    }
    sphere(0.13, accent, 0, -0.14, 0.22, body, 6);
    root.userData.kind = 'drone';
    root.userData.turret = null;
    return root;
  }

  // ============== ЗДАНИЯ ==============
  function buildHQ(faction) {
    const P = PALETTE[faction];
    const root = new THREE.Group();
    const wall = mat(faction === 'ally' ? 0x59563f : 0x6a6355, 0.92, 0.05);
    const roof = mat(0x3a3a30, 0.95, 0.05);
    const dark = mat(0x26261f, 0.9, 0.1);
    const accent = mat(P.accent, 0.4, 0.3, P.accent, 0.55);

    box(20, 5.6, 13, wall, 0, 2.8, 0, root);
    box(21, 0.5, 14, roof, 0, 5.8, 0, root);
    box(6, 3.4, 3, wall, 0, 1.7, 7.4, root);
    box(6.4, 0.4, 3.4, roof, 0, 3.5, 7.4, root);
    // окна
    for (let i = -3; i <= 3; i++) {
      box(1.3, 1.1, 0.15, mat(0x2b3a3a, 0.25, 0.5), i * 2.4, 3.4, 6.55, root, false);
    }
    // антенны и мачта
    const mast = cyl(0.14, 0.18, 9, 6, mat(0x55584c, 0.7, 0.4), -7.5, 10.0, -3.5, root);
    box(4.0, 0.16, 0.16, accent, -7.5, 13.2, -3.5, root, false);
    box(0.16, 0.16, 3.0, accent, -7.5, 12.2, -3.5, root, false);
    for (let i = 0; i < 3; i++) {
      const a = cyl(0.04, 0.04, 5.5, 3, dark, 8.2 - i * 0.7, 8.6, -5.2, root);
      a.rotation.z = (i - 1) * 0.1;
    }
    // мешки с песком / баррикады
    for (let i = -4; i <= 4; i++) {
      box(1.5, 0.8, 1.0, mat(0x6b6449, 0.95, 0), i * 2.0, 0.4, 10.6, root);
      box(1.5, 0.8, 1.0, mat(0x6b6449, 0.95, 0), i * 2.0, 0.4, -8.2, root);
    }
    root.userData.kind = 'building';
    root.userData.radius = 12;
    return root;
  }

  function buildBarracks(faction) {
    const P = PALETTE[faction];
    const root = new THREE.Group();
    const wall = mat(faction === 'ally' ? 0x5b5844 : 0x6b6355, 0.92, 0.05);
    const roof = mat(0x4a4638, 0.95, 0.05);
    const accent = mat(P.accent, 0.4, 0.3, P.accent, 0.5);
    box(12, 3.4, 8, wall, 0, 1.7, 0, root);
    const r = box(12.6, 0.35, 8.6, roof, 0, 3.5, 0, root);
    box(1.4, 2.2, 0.2, mat(0x22261f, 0.9, 0.1), 0, 1.1, 4.05, root, false);
    for (let i = -1; i <= 1; i++) box(1.1, 0.8, 0.15, mat(0x2b3a3a, 0.25, 0.5), i * 3.2, 2.3, 4.05, root, false);
    box(12.1, 0.12, 8.1, accent, 0, 3.24, 0, root, false);
    for (let i = 0; i < 3; i++) cyl(0.03, 0.03, 3.2, 3, mat(0x26261f, 0.9, 0.1), -5 + i * 5, 5.0, -3, root);
    root.userData.kind = 'building';
    root.userData.radius = 8;
    return root;
  }

  function buildFactory(faction) {
    const P = PALETTE[faction];
    const root = new THREE.Group();
    const wall = mat(faction === 'ally' ? 0x53523f : 0x67614f, 0.9, 0.1);
    const roof = mat(0x3d3d33, 0.9, 0.1);
    const accent = mat(P.accent, 0.4, 0.3, P.accent, 0.5);
    box(14, 5.0, 10, wall, 0, 2.5, 0, root);
    // пилообразная крыша
    for (let i = 0; i < 4; i++) {
      const s = box(3.4, 0.4, 10.4, roof, -5.2 + i * 3.5, 5.4, 0, root);
      s.rotation.z = 0.35;
    }
    box(5, 4.2, 4, wall, -6, 2.1, 6.4, root);
    box(0.2, 3.0, 0.2, accent, 6.4, 6.4, 4.6, root, false);
    // ворота
    box(5, 3.2, 0.25, mat(0x22261f, 0.9, 0.1), 0, 1.6, 5.05, root, false);
    box(14.1, 0.14, 10.1, accent, 0, 4.85, 0, root, false);
    // труба
    const ch = cyl(0.5, 0.65, 8, 6, mat(0x4a463c, 0.9, 0.2), 5.4, 8.2, -3.2, root);
    root.userData.kind = 'building';
    root.userData.radius = 9;
    return root;
  }

  function buildDepot(faction) {
    const P = PALETTE[faction];
    const root = new THREE.Group();
    const wall = mat(faction === 'ally' ? 0x5e5a46 : 0x6d6455, 0.92, 0.05);
    const accent = mat(P.accent, 0.4, 0.3, P.accent, 0.5);
    box(9, 2.6, 7, wall, 0, 1.3, 0, root);
    box(9.6, 0.3, 7.6, mat(0x42422f, 0.9, 0.1), 0, 2.7, 0, root);
    box(9.1, 0.1, 7.1, accent, 0, 2.5, 0, root, false);
    // контейнеры
    for (let i = 0; i < 3; i++) {
      const c = box(2.4, 1.2, 2.4, mat(0x5a5c46, 0.9, 0.2), -5.5 + i * 3.2, 0.6, 5.5, root);
      c.rotation.y = Util.rnd(-0.2, 0.2);
    }
    for (let i = 0; i < 4; i++) {
      cyl(0.35, 0.35, 0.9, 8, mat(0x3f4436, 0.8, 0.2), 5.6, 0.45, -2 + i * 1.2, root);
    }
    root.userData.kind = 'building';
    root.userData.radius = 7;
    return root;
  }

  // ============== ФЛАГ КОНТРОЛЬНОЙ ТОЧКИ ==============
  function buildFlag() {
    const root = new THREE.Group();
    const poleMat = mat(0x4a4d45, 0.5, 0.6);
    const pole = cyl(0.09, 0.09, 7.5, 6, poleMat, 0, 3.75, 0, root);
    // полотнище
    const clothMat = new THREE.MeshStandardMaterial({
      color: 0x8d9187, roughness: 0.85, metalness: 0.05, side: THREE.DoubleSide
    });
    const clothGeo = new THREE.PlaneGeometry(2.6, 1.5, 6, 2);
    const cloth = new THREE.Mesh(clothGeo, clothMat);
    cloth.position.set(1.35, 6.4, 0);
    cloth.castShadow = true;
    root.add(cloth);
    // бетонная платформа
    const pad = cyl(2.6, 2.9, 0.5, 8, mat(0x6a6a60, 0.95, 0), 0, 0.25, 0, root);
    // ящики
    box(1.6, 0.7, 1.0, mat(0x54573f, 0.9, 0.1), -1.8, 0.85, 0.6, root);
    box(1.2, 1.0, 1.2, mat(0x4c4f3a, 0.9, 0.1), 1.9, 1.0, -0.8 + 0, root);
    root.userData.cloth = cloth;
    root.userData.baseClothColor = 0x8d9187;
    return root;
  }

  // ============== ФАБРИКА ==============
  const builders = {
    infantry: buildInfantry,
    ifv: buildIFV,
    tank: buildTank,
    artillery: buildArtillery,
    aa: buildAA,
    mlrs: buildMLRS,
    recon: buildRecon,
    drone: buildDrone,
    hq: buildHQ,
    barracks: buildBarracks,
    factory: buildFactory,
    depot: buildDepot,
    flag: buildFlag
  };

  function build(type, faction) {
    const fn = builders[type];
    if (!fn) throw new Error('unknown model ' + type);
    const g = fn(faction);
    g.userData.type = type;
    g.userData.faction = faction;
    return g;
  }

  // ---- слияние геометрий (деревья, крупные объекты) ----
  function mergeGeos(list) {
    const geos = list.map(g => (g.index ? g.toNonIndexed() : g));
    let total = 0;
    for (const g of geos) total += g.attributes.position.count;
    const pos = new Float32Array(total * 3);
    const nrm = new Float32Array(total * 3);
    let off = 0;
    for (const g of geos) {
      pos.set(g.attributes.position.array, off * 3);
      if (g.attributes.normal) nrm.set(g.attributes.normal.array, off * 3);
      off += g.attributes.position.count;
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    out.computeBoundingSphere();
    return out;
  }

  return { build, mat, PALETTE, mergeGeos };
})();