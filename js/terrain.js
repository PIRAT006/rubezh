/* ============================================================
   terrain.js — мир: рельеф, река, мосты, брод, дороги,
   растительность, навигационная сетка и туман войны (World)
   ============================================================ */
'use strict';

const World = (() => {
  const SIZE = 256;
  const HALF = SIZE / 2;
  const GRID = 256;              // клеток рельефа
  const STEP = SIZE / GRID;      // 1 юнит
  const CELL = 2;                // клетка навигации
  const N = SIZE / CELL;         // 128
  const WATER_Y = 0.05;

  // ---------------- река ----------------
  const riverCenter = x => 4 + 20 * Math.sin(x * 0.014) + 9 * Math.sin(x * 0.037 + 2.1);
  const riverHalf = x => 9.5 + 3 * Math.sin(x * 0.05 + 0.7);

  const BRIDGES = [
    { x: -70, w: 8, halfLen: 17 },
    { x: 58, w: 8, halfLen: 17 }
  ];
  const FORD = { x: -6, w: 9 };

  const BASE_ALLY = { x: 0, z: 96, r: 30 };
  const BASE_ENEMY = { x: 0, z: -100, r: 32 };

  const CONTROL_POINTS = [
    { id: 'p1', name: 'Лесной', x: -86, z: 44, r: 15 },
    { id: 'p2', name: 'Мельница', x: 80, z: 40, r: 15 },
    { id: 'p3', name: 'Каменный', x: -70, z: 18, r: 15 },
    { id: 'p4', name: 'Тихий', x: 58, z: -8, r: 15 },
    { id: 'p5', name: 'Высота 112', x: 4, z: -46, r: 16 }
  ];

  // ---------------- данные ----------------
  const hgrid = new Float32Array((GRID + 1) * (GRID + 1));
  const state = {
    nav: new Uint8Array(N * N),
    cost: new Float32Array(N * N),
    fogVisible: new Uint8Array(N * N),
    fogExplored: new Uint8Array(N * N)
  };

  let scene = null, group = null, waterMesh = null, groundMesh = null;
  let minimapBase = null, minimapWater = null;
  let ready = false;

  // =========================================================
  //  РЕЛЬЕФ
  // =========================================================
  function baseNoiseHeight(x, z) {
    // Крупные холмы: диапазон примерно 0.6..14, среднее ~5
    const n = Util.fbm(x * 0.0125 + 13.7, z * 0.0125 + 4.3, 4);   // 0..1, среднее .5
    let h = 0.8 + Math.pow(Util.clamp((n - 0.3) / 0.55, 0, 1), 0.9) * 11.5;
    // средние неровности
    h += (Util.fbm(x * 0.038 + 51.2, z * 0.038 + 17.9, 3) - 0.5) * 2.4;
    // мелкая фактура
    h += (Util.fbm(x * 0.09 + 7.3, z * 0.09 + 22.1, 2) - 0.5) * 0.55;

    // гряды по краям карты (естественные границы)
    const nEdge = Util.smooth(Util.clamp((-z - 88) / 30, 0, 1));
    const sEdge = Util.smooth(Util.clamp((z - 90) / 28, 0, 1));
    const wEdge = Util.smooth(Util.clamp((-x - 104) / 20, 0, 1));
    const eEdge = Util.smooth(Util.clamp((x - 104) / 20, 0, 1));
    h += (nEdge + sEdge) * 8 + (wEdge + eEdge) * 10;

    // высота 112 на северном берегу
    const dxp = (x - 4) / 38, dzp = (z + 46) / 32;
    h += 5.5 * Math.exp(-(dxp * dxp + dzp * dzp));
    return h;
  }

  function rawHeight(x, z) {
    let h = baseNoiseHeight(x, z);

    // --- долина реки (узкая) ---
    const rc = riverCenter(x), rw = riverHalf(x);
    const d = Math.abs(z - rc) / rw;          // в полуширинах русла
    if (d < 1.55) {
      const t = Util.clamp(d / 1.55, 0, 1);    // 0 — центр, 1 — край долины
      let bed = -2.6 + Math.pow(t, 1.15) * 6.4;
      // брод
      const fx = Math.abs(x - FORD.x) / FORD.w;
      if (fx < 1) bed += 2.4 * (1 - fx) * (1 - fx);
      const bank = baseNoiseHeight(x, z);
      h = Util.lerp(bed, Math.max(bank, bed), Util.smooth(t));
    }

    // --- площадки баз ---
    const da = Util.dist(x, z, BASE_ALLY.x, BASE_ALLY.z);
    if (da < BASE_ALLY.r + 8) {
      h = Util.lerp(h, 4.2, Util.smooth(Util.clamp(1 - da / (BASE_ALLY.r + 8), 0, 1)) * 0.92);
    }
    const de = Util.dist(x, z, BASE_ENEMY.x, BASE_ENEMY.z);
    if (de < BASE_ENEMY.r + 8) {
      h = Util.lerp(h, 5.4, Util.smooth(Util.clamp(1 - de / (BASE_ENEMY.r + 8), 0, 1)) * 0.92);
    }

    // --- площадки опорных пунктов ---
    for (const p of CONTROL_POINTS) {
      const dp = Util.dist(x, z, p.x, p.z);
      if (dp < p.r + 12) {
        const target = p.id === 'p5' ? 9.2 : Math.max(2.4, baseNoiseHeight(p.x, p.z));
        h = Util.lerp(h, target, Util.smooth(Util.clamp(1 - dp / (p.r + 12), 0, 1)) * 0.75);
      }
    }

    // --- насыпи у мостов ---
    for (const b of BRIDGES) {
      const bz = riverCenter(b.x);
      const dx = Math.abs(x - b.x) / (b.w * 1.7);
      const dz = Math.abs(z - bz) / (b.halfLen * 1.15);
      if (dx < 1 && dz < 1.9) {
        const k = Math.max(0, 1 - dx) * Math.max(0, 1 - dz / 1.9);
        h = Util.lerp(h, 1.55, Util.smooth(Math.min(1, k * 1.4)) * 0.95);
      }
    }
    return h;
  }

  function buildHeightGrid() {
    for (let j = 0; j <= GRID; j++) {
      const z = -HALF + j;
      for (let i = 0; i <= GRID; i++) {
        hgrid[j * (GRID + 1) + i] = rawHeight(-HALF + i, z);
      }
    }
  }

  function height(x, z) {
    let fx = (x + HALF), fz = (z + HALF);
    if (fx < 0) fx = 0; else if (fx > GRID - 0.001) fx = GRID - 0.001;
    if (fz < 0) fz = 0; else if (fz > GRID - 0.001) fz = GRID - 0.001;
    const i = fx | 0, j = fz | 0;
    const tx = fx - i, tz = fz - j;
    const s = GRID + 1;
    const h00 = hgrid[j * s + i], h10 = hgrid[j * s + i + 1];
    const h01 = hgrid[(j + 1) * s + i], h11 = hgrid[(j + 1) * s + i + 1];
    return Util.lerp(Util.lerp(h00, h10, tx), Util.lerp(h01, h11, tx), tz);
  }

  const _n = new THREE.Vector3();
  function normalAt(x, z, out) {
    const e = 1.4;
    const n = out || _n;
    n.set(height(x - e, z) - height(x + e, z), 2 * e, height(x, z - e) - height(x, z + e)).normalize();
    return n;
  }
  function slopeAt(x, z) {
    const e = 1.6;
    return Math.hypot(height(x + e, z) - height(x - e, z), height(x, z + e) - height(x, z - e)) / (2 * e);
  }
  function isWater(x, z) { return height(x, z) < WATER_Y - 0.05; }

  function onBridge(x, z, pad) {
    pad = pad || 0;
    for (const b of BRIDGES) {
      const bz = riverCenter(b.x);
      if (Math.abs(x - b.x) < b.w / 2 + pad && Math.abs(z - bz) < b.halfLen + pad) return true;
    }
    return false;
  }
  function onFord(x, z) {
    return Math.abs(x - FORD.x) < FORD.w / 2 && Math.abs(z - riverCenter(x)) < riverHalf(x) * 1.35;
  }

  // =========================================================
  //  ТЕКСТУРА ЗЕМЛИ
  // =========================================================
  function makeGroundTexture() {
    const TS = 1024;
    const cv = document.createElement('canvas');
    cv.width = cv.height = TS;
    const ctx = cv.getContext('2d');
    const img = ctx.createImageData(TS, TS);
    const data = img.data;
    const px2u = SIZE / TS;

    const cGrass = [92, 100, 72];
    const cGrassDry = [124, 116, 84];
    const cGrassDark = [68, 78, 56];
    const cDirt = [112, 98, 74];
    const cSand = [142, 128, 98];
    const cRock = [118, 116, 108];
    const cMud = [76, 66, 52];

    for (let py = 0; py < TS; py++) {
      const z = -HALF + (py + 0.5) * px2u;
      for (let px = 0; px < TS; px++) {
        const x = -HALF + (px + 0.5) * px2u;
        const h = height(x, z);
        const sl = slopeAt(x, z);
        const n1 = Util.fbm(x * 0.07, z * 0.07, 3);
        const n2 = Util.fbm(x * 0.33 + 17, z * 0.33 + 31, 2);
        const n3 = Util.fbm(x * 0.6 + 5, z * 0.6 + 9, 2);
        const gr = Util.hash2(px, py);

        let r = cGrass[0], g = cGrass[1], b = cGrass[2];

        // пятна сухой травы
        const dry = Util.clamp((n1 - 0.42) * 2.2, 0, 1);
        r = Util.lerp(r, cGrassDry[0], dry * 0.9);
        g = Util.lerp(g, cGrassDry[1], dry * 0.9);
        b = Util.lerp(b, cGrassDry[2], dry * 0.9);

        // тёмная растительность
        const dark = Util.clamp((0.48 - n2) * 2.4, 0, 1);
        r = Util.lerp(r, cGrassDark[0], dark * 0.6);
        g = Util.lerp(g, cGrassDark[1], dark * 0.6);
        b = Util.lerp(b, cGrassDark[2], dark * 0.6);

        // открытая земля
        const dirt = Util.clamp((n2 - 0.58) * 2.4, 0, 1);
        r = Util.lerp(r, cDirt[0], dirt * 0.75);
        g = Util.lerp(g, cDirt[1], dirt * 0.75);
        b = Util.lerp(b, cDirt[2], dirt * 0.75);

        // скалы
        const rock = Util.clamp((sl - 0.28) * 2.0, 0, 1);
        r = Util.lerp(r, cRock[0], rock * 0.88);
        g = Util.lerp(g, cRock[1], rock * 0.88);
        b = Util.lerp(b, cRock[2], rock * 0.88);

        // берег
        const wd = h - WATER_Y;
        if (wd < 2.0) {
          const k = Util.clamp(1 - wd / 2.0, 0, 1);
          r = Util.lerp(r, cSand[0], k * 0.78);
          g = Util.lerp(g, cSand[1], k * 0.78);
          b = Util.lerp(b, cSand[2], k * 0.78);
          if (wd < 0.6) {
            const m = Util.clamp(1 - wd / 0.6, 0, 1);
            r = Util.lerp(r, cMud[0], m * 0.9);
            g = Util.lerp(g, cMud[1], m * 0.9);
            b = Util.lerp(b, cMud[2], m * 0.9);
          }
        }

        const grain = (gr - 0.5) * 15 + (n3 - 0.5) * 14;
        const k4 = (py * TS + px) * 4;
        data[k4] = Util.clamp(r + grain, 0, 255);
        data[k4 + 1] = Util.clamp(g + grain, 0, 255);
        data[k4 + 2] = Util.clamp(b + grain, 0, 255);
        data[k4 + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);

    // ---------------- дороги ----------------
    const w2p = (x, z) => [(x + HALF) / SIZE * TS, (z + HALF) / SIZE * TS];
    const ROADS = [
      [[0, 100], [0, 60], [0, 20], [0, -10], [-2, -40], [-2, -70], [0, -100]],
      [[0, 96], [-30, 80], [-56, 62], [-70, 40], [-70, 18], [-70, -4], [-66, -34], [-44, -66], [-10, -90]],
      [[0, 96], [30, 78], [58, 58], [58, 36], [58, 8], [58, -12], [52, -40], [30, -74], [6, -96]],
      [[-86, 44], [-78, 34], [-70, 18]],
      [[80, 40], [70, 30], [58, 8]]
    ];
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const road of ROADS) {
      for (const pass of [0, 1]) {
        ctx.beginPath();
        const p0 = w2p(road[0][0], road[0][1]);
        ctx.moveTo(p0[0], p0[1]);
        for (let i = 1; i < road.length - 1; i++) {
          const a = w2p(road[i][0], road[i][1]);
          const b2 = w2p(road[i + 1][0], road[i + 1][1]);
          ctx.quadraticCurveTo(a[0], a[1], (a[0] + b2[0]) / 2, (a[1] + b2[1]) / 2);
        }
        const pl = w2p(road[road.length - 1][0], road[road.length - 1][1]);
        ctx.lineTo(pl[0], pl[1]);
        ctx.strokeStyle = pass === 0 ? 'rgba(66,56,42,0.40)' : 'rgba(104,92,70,0.5)';
        ctx.lineWidth = pass === 0 ? 24 : 11;
        ctx.stroke();
      }
    }

    // ---------------- площадки баз ----------------
    for (const base of [BASE_ALLY, BASE_ENEMY]) {
      const c = w2p(base.x, base.z);
      const rad = 30 / SIZE * TS;
      const g = ctx.createRadialGradient(c[0], c[1], rad * 0.15, c[0], c[1], rad);
      g.addColorStop(0, 'rgba(88,82,62,0.55)');
      g.addColorStop(0.7, 'rgba(88,82,62,0.28)');
      g.addColorStop(1, 'rgba(88,82,62,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(c[0], c[1], rad, 0, 6.283); ctx.fill();
    }

    // мелкая детализация поверх (камни, кочки)
    for (let i = 0; i < 2600; i++) {
      const x = Util.rnd(-HALF + 6, HALF - 6), z = Util.rnd(-HALF + 6, HALF - 6);
      if (height(x, z) < WATER_Y) continue;
      const p = w2p(x, z);
      const s = Util.rnd(0.6, 2.4);
      ctx.fillStyle = `rgba(${Util.rndInt(60, 130)},${Util.rndInt(56, 120)},${Util.rndInt(44, 96)},${Util.rnd(0.08, 0.3).toFixed(2)})`;
      ctx.beginPath(); ctx.arc(p[0], p[1], s, 0, 6.283); ctx.fill();
    }

    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;

    // миникарта без растительности
    const mc = document.createElement('canvas');
    mc.width = mc.height = 256;
    const mctx = mc.getContext('2d');
    mctx.drawImage(cv, 0, 0, 256, 256);
    minimapBase = mc;

    return tex;
  }

  // =========================================================
  //  МЕШИ
  // =========================================================
  function makeGroundMesh(tex) {
    const seg = GRID;
    const geo = new THREE.PlaneGeometry(SIZE, SIZE, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const count = pos.count;
    const colors = new Float32Array(count * 3);
    const vpr = seg + 1;
    const c = new THREE.Color();
    for (let j = 0; j < vpr; j++) {
      for (let i = 0; i < vpr; i++) {
        const idx = j * vpr + i;
        const x = -HALF + i;
        const z = -HALF + j;
        pos.setY(idx, height(x, z));
        const n = Util.fbm(x * 0.04, z * 0.04, 2);
        const slope = slopeAt(x, z);
        let shade = 0.9 + n * 0.2 - Util.clamp(slope * 0.16, 0, 0.18);
        c.setRGB(shade, shade, shade * 0.985);
        colors[idx * 3] = c.r; colors[idx * 3 + 1] = c.g; colors[idx * 3 + 2] = c.b;
      }
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    geo.computeBoundingSphere();

    const mat = new THREE.MeshStandardMaterial({
      map: tex, vertexColors: true, roughness: 0.95, metalness: 0.01
    });

    // Детализация: поверх крупной карты накладывается тайловая текстура крупы
    // (трава/песок/камешки), чтобы земля не выглядела размытой вблизи.
    const detail = makeDetailTexture();
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uDetail = { value: detail };
      sh.uniforms.uDetailScale = { value: 150.0 };
      sh.fragmentShader = 'uniform sampler2D uDetail;\nuniform float uDetailScale;\n' + sh.fragmentShader;
      sh.fragmentShader = sh.fragmentShader.replace(
        '#include <map_fragment>',
        `#include <map_fragment>
         vec3 det = texture2D( uDetail, vMapUv * uDetailScale ).rgb;
         float far = clamp( 1.0 - length( vViewPosition ) / 90.0, 0.0, 1.0 );
         diffuseColor.rgb *= mix( vec3(1.0), det * 1.85, 0.75 * far );`
      );
    };

    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.name = 'ground';
    groundMesh = mesh;
    return mesh;
  }

  function makeDetailTexture() {
    const S = 256;
    const cv = document.createElement('canvas');
    cv.width = cv.height = S;
    const ctx = cv.getContext('2d');
    const img = ctx.createImageData(S, S);
    const d = img.data;
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        // мелкая крупа + пятна травы, тайлится по краям
        const n1 = Util.fbm(x * 0.09, y * 0.09, 3);
        const n2 = Util.vnoise((x % 256) * 0.42, (y % 256) * 0.42);
        const n3 = Util.hash2(x, y);
        let v = 0.62 + n1 * 0.34 + (n2 - 0.5) * 0.3 + (n3 - 0.5) * 0.22;
        v = Util.clamp(v, 0.25, 1.0);
        const k = (y * S + x) * 4;
        // слегка зеленовато-жёлтая крупа
        d[k] = Util.clamp(v * 255 * 1.0, 0, 255);
        d[k + 1] = Util.clamp(v * 255 * 1.02, 0, 255);
        d[k + 2] = Util.clamp(v * 255 * 0.9, 0, 255);
        d[k + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  }

  function makeWater() {
    const geo = new THREE.PlaneGeometry(SIZE, SIZE, 1, 1);
    geo.rotateX(-Math.PI / 2);

    const S = 256;
    const cv = document.createElement('canvas');
    cv.width = cv.height = S;
    const ctx = cv.getContext('2d');
    const img = ctx.createImageData(S, S);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const e = 1.5;
        const h0 = Util.fbm(x * 0.05, y * 0.05, 3);
        const hx = Util.fbm((x + e) * 0.05, y * 0.05, 3) - h0;
        const hy = Util.fbm(x * 0.05, (y + e) * 0.05, 3) - h0;
        const k = (y * S + x) * 4;
        img.data[k] = Util.clamp(128 + hx * 900, 0, 255);
        img.data[k + 1] = Util.clamp(128 + hy * 900, 0, 255);
        img.data[k + 2] = 255;
        img.data[k + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    const ntex = new THREE.CanvasTexture(cv);
    ntex.wrapS = ntex.wrapT = THREE.RepeatWrapping;
    ntex.repeat.set(48, 48);

    const mat = new THREE.MeshStandardMaterial({
      color: 0x33565a, roughness: 0.12, metalness: 0.75,
      transparent: true, opacity: 0.9,
      normalMap: ntex, normalScale: new THREE.Vector2(0.5, 0.5)
    });
    mat.userData.shader = null;
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = { value: 0 };
      sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader;
      sh.vertexShader = sh.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         transformed.y += sin(position.x * 0.25 + uTime * 1.4) * 0.05
                        + sin(position.z * 0.33 - uTime * 1.0) * 0.04;`
      );
      mat.userData.shader = sh;
    };

    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = WATER_Y;
    mesh.renderOrder = 3;
    mesh.receiveShadow = false;
    waterMesh = mesh;
    return mesh;
  }

  // =========================================================
  //  МОСТЫ
  // =========================================================
  function makeBridge(b) {
    const g = new THREE.Group();
    const bz = riverCenter(b.x);
    const deckMat = Models.mat(0x6d6555, 0.9, 0.05);
    const stoneMat = Models.mat(0x7d7970, 0.95, 0.03);
    const metalMat = Models.mat(0x5a6058, 0.55, 0.6);
    const L = b.halfLen * 2;

    const deck = new THREE.Mesh(new THREE.BoxGeometry(b.w, 0.55, L), deckMat);
    deck.position.y = 1.4;
    deck.castShadow = deck.receiveShadow = true;
    g.add(deck);

    for (const s of [-1, 1]) {
      const side = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.8, L), stoneMat);
      side.position.set(s * (b.w / 2 - 0.15), 1.9, 0);
      side.castShadow = side.receiveShadow = true;
      g.add(side);
      for (let i = -4; i <= 4; i++) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.65, 0.14), metalMat);
        post.position.set(s * (b.w / 2 - 0.15), 2.5, i * (L / 9));
        g.add(post);
      }
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, L), metalMat);
      rail.position.set(s * (b.w / 2 - 0.15), 2.8, 0);
      g.add(rail);
    }

    // опоры
    for (let i = -1; i <= 1; i++) {
      for (const s of [-1, 1]) {
        const pier = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1.0, 5.5, 7), stoneMat);
        pier.position.set(s * (b.w / 2 - 1.6), -0.8, i * (L * 0.3));
        pier.castShadow = true;
        g.add(pier);
      }
    }
    // аппарели
    for (const s of [-1, 1]) {
      const ramp = new THREE.Mesh(new THREE.BoxGeometry(b.w + 2.5, 0.4, 8), deckMat);
      ramp.position.set(0, 0.85, s * (b.halfLen + 3));
      ramp.rotation.x = s * 0.085;
      ramp.receiveShadow = true;
      g.add(ramp);
    }
    g.position.set(b.x, 0, bz);
    return g;
  }

  // =========================================================
  //  РАСТИТЕЛЬНОСТЬ
  // =========================================================
  function treeGeos() {
    const pine = (() => {
      const parts = [];
      const trunk = new THREE.CylinderGeometry(0.16, 0.26, 2.4, 5);
      trunk.translate(0, 1.2, 0);
      parts.push(trunk);
      for (let i = 0; i < 3; i++) {
        const c = new THREE.ConeGeometry(1.65 - i * 0.42, 2.5, 6);
        c.translate(0, 2.5 + i * 1.5, 0);
        parts.push(c);
      }
      return Models.mergeGeos(parts);
    })();
    const leaf = (() => {
      const parts = [];
      const trunk = new THREE.CylinderGeometry(0.2, 0.3, 2.2, 5);
      trunk.translate(0, 1.1, 0);
      parts.push(trunk);
      const blobs = [[0, 3.3, 0, 1.85], [0.95, 2.7, 0.3, 1.2], [-0.8, 2.8, -0.5, 1.1], [0.15, 4.15, -0.25, 1.05]];
      for (const [x, y, z, r] of blobs) {
        const s = new THREE.IcosahedronGeometry(r, 0);
        s.translate(x, y, z);
        parts.push(s);
      }
      return Models.mergeGeos(parts);
    })();
    const bush = (() => {
      const s = new THREE.IcosahedronGeometry(0.9, 0);
      s.scale(1.2, 0.7, 1.2);
      s.translate(0, 0.55, 0);
      return s.toNonIndexed();
    })();
    return { pine, leaf, bush };
  }

  function rockGeo() {
    const g = new THREE.DodecahedronGeometry(1, 0);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const k = 0.72 + Util.hash2(Math.round(x * 41 + y * 13), Math.round(z * 23)) * 0.55;
      p.setXYZ(i, x * k * 1.15, y * k * 0.72, z * k);
    }
    g.computeVertexNormals();
    return g;
  }

  const ROADS_PTS = [
    [[0, 100], [0, 60], [0, 20], [0, -10], [-2, -40], [-2, -70], [0, -100]],
    [[0, 96], [-30, 80], [-56, 62], [-70, 40], [-70, 18], [-70, -4], [-66, -34], [-44, -66], [-10, -90]],
    [[0, 96], [30, 78], [58, 58], [58, 36], [58, 8], [58, -12], [52, -40], [30, -74], [6, -96]],
    [[-86, 44], [-78, 34], [-70, 18]],
    [[80, 40], [70, 30], [58, 8]]
  ];

  function nearRoad(x, z, d) {
    const d2 = d * d;
    for (const r of ROADS_PTS) {
      for (let i = 0; i < r.length - 1; i++) {
        const ax = r[i][0], az = r[i][1], bx = r[i + 1][0], bz = r[i + 1][1];
        const dx = bx - ax, dz = bz - az;
        const len2 = dx * dx + dz * dz || 1;
        let t = ((x - ax) * dx + (z - az) * dz) / len2;
        t = Util.clamp(t, 0, 1);
        const px = ax + dx * t, pz = az + dz * t;
        if (Util.dist2(x, z, px, pz) < d2) return true;
      }
    }
    return false;
  }

  function reservedSpot(x, z, pad) {
    pad = pad || 0;
    for (const p of CONTROL_POINTS) if (Util.dist(x, z, p.x, p.z) < p.r + 6 + pad) return true;
    for (const b of BRIDGES) if (Util.dist(x, z, b.x, riverCenter(b.x)) < 24 + pad) return true;
    if (Util.dist(x, z, BASE_ALLY.x, BASE_ALLY.z) < 34 + pad) return true;
    if (Util.dist(x, z, BASE_ENEMY.x, BASE_ENEMY.z) < 36 + pad) return true;
    return false;
  }

  function scatterVegetation() {
    const grp = new THREE.Group();
    const geos = treeGeos();
    const rng = Util.mulberry32(880221);

    const pineMat = new THREE.MeshStandardMaterial({ color: 0x51603c, roughness: 1, flatShading: true });
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x77803f, roughness: 1, flatShading: true });
    const bushMat = new THREE.MeshStandardMaterial({ color: 0x6d7440, roughness: 1, flatShading: true });
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x8b887f, roughness: 0.95, flatShading: true });

    const pines = [], leaves = [], bushes = [], rocks = [];
    const dummy = new THREE.Object3D();
    const col = new THREE.Color();

    for (let i = 0; i < 26000 && pines.length + leaves.length < 900; i++) {
      const x = -HALF + 10 + rng() * (SIZE - 20);
      const z = -HALF + 10 + rng() * (SIZE - 20);
      const h = height(x, z);
      if (h < WATER_Y + 0.7) continue;
      if (slopeAt(x, z) > 0.85) continue;
      if (reservedSpot(x, z) || nearRoad(x, z, 7)) continue;
      const f = Util.fbm(x * 0.021 + 5.3, z * 0.021 + 9.1, 3);
      const dens = (f - 0.44) * 3.4;
      if (rng() > dens) continue;
      const isPine = rng() < (z < 0 ? 0.72 : 0.42);
      const item = { x, z, h, s: 0.75 + rng() * 0.75, r: rng() * 6.283, tint: 0.78 + rng() * 0.42 };
      (isPine ? pines : leaves).push(item);
    }

    for (let i = 0; i < 14000 && bushes.length < 620; i++) {
      const x = -HALF + 8 + rng() * (SIZE - 16);
      const z = -HALF + 8 + rng() * (SIZE - 16);
      const h = height(x, z);
      if (h < WATER_Y + 0.5) continue;
      if (reservedSpot(x, z) || nearRoad(x, z, 3)) continue;
      if (rng() > 0.3 + Util.fbm(x * 0.03, z * 0.03, 2) * 0.55) continue;
      bushes.push({ x, z, h, s: 0.8 + rng() * 0.95, r: rng() * 6.283, tint: 0.85 + rng() * 0.32 });
    }

    for (let i = 0; i < 9000 && rocks.length < 210; i++) {
      const x = -HALF + 10 + rng() * (SIZE - 20);
      const z = -HALF + 10 + rng() * (SIZE - 20);
      const h = height(x, z);
      if (h < WATER_Y + 0.2) continue;
      if (reservedSpot(x, z, -4) || nearRoad(x, z, 3)) continue;
      if (rng() > 0.25 + slopeAt(x, z) * 0.55) continue;
      rocks.push({ x, z, h, s: 0.6 + rng() * 1.7, r: rng() * 6.283, tint: 0.8 + rng() * 0.42 });
    }

    function instance(geo, mat, list, yOff, cast) {
      if (!list.length) return null;
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      im.castShadow = !!cast;
      im.receiveShadow = true;
      for (let i = 0; i < list.length; i++) {
        const it = list[i];
        dummy.position.set(it.x, it.h + (yOff || 0) - 0.12, it.z);
        dummy.rotation.set(0, it.r, 0);
        const sy = it.s * (0.9 + (it.tint - 1) * 0.35);
        dummy.scale.set(it.s, sy, it.s);
        dummy.updateMatrix();
        im.setMatrixAt(i, dummy.matrix);
        col.setRGB(it.tint, it.tint * 0.97, it.tint * 0.85);
        im.setColorAt(i, col);
      }
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      vegetationChunks.push({ mesh: im, list, dummy, yOff });
      return im;
    }

    const im1 = instance(geos.pine, pineMat, pines, 0, true);
    const im2 = instance(geos.leaf, leafMat, leaves, 0, true);
    const im3 = instance(geos.bush, bushMat, bushes, 0, false);
    const im4 = instance(rockGeo(), rockMat, rocks, -0.18, true);
    for (const m of [im1, im2, im3, im4]) if (m) grp.add(m);

    // --- разрушенные постройки ---
    const ruinMat = Models.mat(0x615c50, 0.95, 0.02);
    const ruins = [
      [-98, 56, 0.4], [70, 58, -0.7], [-60, 68, 1.1], [34, -72, 0.2], [-40, -60, -0.9], [92, -20, 0.5]
    ];
    for (const [rx, rz, rot] of ruins) {
      const y = height(rx, rz);
      const w1 = new THREE.Mesh(new THREE.BoxGeometry(7, 3.4, 0.7), ruinMat);
      w1.position.set(rx, y + 1.4, rz);
      w1.rotation.y = rot;
      w1.castShadow = w1.receiveShadow = true;
      grp.add(w1);
      const w2 = new THREE.Mesh(new THREE.BoxGeometry(0.7, 2.6, 5), ruinMat);
      w2.position.set(rx - 3.2 * Math.cos(rot), y + 1.1, rz + 1.4);
      w2.rotation.y = rot;
      w2.castShadow = true;
      grp.add(w2);
      const rub = new THREE.Mesh(rockGeo(), ruinMat);
      rub.position.set(rx - 1.6, y + 0.15, rz + 2.6);
      rub.scale.set(1.7, 0.45, 1.3);
      rub.castShadow = true;
      grp.add(rub);
    }

    // --- телеграфные столбы вдоль главной дороги ---
    const poleMat = Models.mat(0x5b5346, 0.95, 0.02);
    for (let i = 0; i < 16; i++) {
      const z = 86 - i * 12;
      const x = -6 + Math.sin(z * 0.05) * 2;
      if (Math.abs(z - riverCenter(x)) < 20) continue;
      const y = height(x, z);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 6.5, 5), poleMat);
      pole.position.set(x, y + 3.2, z);
      pole.castShadow = true;
      grp.add(pole);
      const cross = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.12, 0.12), poleMat);
      cross.position.set(x, y + 5.9, z);
      grp.add(cross);
    }

    scene.add(grp);
    return grp;
  }

  // =========================================================
  //  НАВИГАЦИЯ
  // =========================================================
  function buildNav() {
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const idx = j * N + i;
        const x = -HALF + (i + 0.5) * CELL;
        const z = -HALF + (j + 0.5) * CELL;
        const h = height(x, z);
        const edge = Math.min(HALF - Math.abs(x), HALF - Math.abs(z));
        let pass = 0, cost = 1;
        if (edge < 8) pass = 0;
        else if (onBridge(x, z, 0.0)) pass = 1;
        else if (onFord(x, z) && h > WATER_Y - 0.55) { pass = 1; cost = 3.4; }
        else if (h > WATER_Y + 0.15) {
          const sl = slopeAt(x, z);
          if (sl < 1.75) { pass = 1; cost = 1 + sl * 2.0; }
        }
        state.nav[idx] = pass;
        state.cost[idx] = cost;
      }
    }
    // чистим изолированные карманы у баз
    for (const b of [BASE_ALLY, BASE_ENEMY]) {
      for (let dz = -5; dz <= 5; dz++) {
        for (let dx = -5; dx <= 5; dx++) {
          const x = b.x + dx * CELL, z = b.z + dz * CELL;
          const idx = cellIndex(x, z);
          if (idx >= 0 && height(x, z) > WATER_Y) {
            state.nav[idx] = 1;
            state.cost[idx] = Math.min(state.cost[idx], 1.2);
          }
        }
      }
    }
  }

  function cellIndex(x, z) {
    const i = Math.floor((x + HALF) / CELL);
    const j = Math.floor((z + HALF) / CELL);
    if (i < 0 || j < 0 || i >= N || j >= N) return -1;
    return j * N + i;
  }
  function cellCenter(idx) {
    const i = idx % N, j = (idx / N) | 0;
    return { x: -HALF + (i + 0.5) * CELL, z: -HALF + (j + 0.5) * CELL };
  }
  function isNavigable(x, z) {
    const idx = cellIndex(x, z);
    return idx >= 0 && state.nav[idx] === 1;
  }
  function nearestPassable(x, z, maxR) {
    maxR = maxR || 14;
    const idx = cellIndex(x, z);
    if (idx >= 0 && state.nav[idx]) return { x, z };
    const ci = Math.floor((x + HALF) / CELL), cj = Math.floor((z + HALF) / CELL);
    for (let r = 1; r <= maxR; r++) {
      let best = null, bd = Infinity;
      for (let dj = -r; dj <= r; dj++) {
        for (let di = -r; di <= r; di++) {
          if (Math.abs(di) !== r && Math.abs(dj) !== r) continue;
          const i = ci + di, j = cj + dj;
          if (i < 0 || j < 0 || i >= N || j >= N) continue;
          if (!state.nav[j * N + i]) continue;
          const cx = -HALF + (i + 0.5) * CELL, cz = -HALF + (j + 0.5) * CELL;
          const d = Util.dist2(x, z, cx, cz);
          if (d < bd) { bd = d; best = { x: cx, z: cz }; }
        }
      }
      if (best) return best;
    }
    return null;
  }

  // =========================================================
  //  ТУМАН ВОЙНЫ
  // =========================================================
  const fogAccum = new Uint8Array(N * N);

  function revealCircle(cx, cz, radius, occlude) {
    const ci = Math.floor((cx + HALF) / CELL), cj = Math.floor((cz + HALF) / CELL);
    const rr = Math.ceil(radius / CELL);
    const r2 = (radius / CELL) * (radius / CELL);
    const eyeY = height(cx, cz) + 2.4;
    for (let j = cj - rr; j <= cj + rr; j++) {
      if (j < 0 || j >= N) continue;
      for (let i = ci - rr; i <= ci + rr; i++) {
        if (i < 0 || i >= N) continue;
        const dx = i - ci, dz = j - cj;
        const dd = dx * dx + dz * dz;
        if (dd > r2) continue;
        const idx = j * N + i;
        if (fogAccum[idx]) continue;
        if (occlude) {
          const px = -HALF + (i + 0.5) * CELL, pz = -HALF + (j + 0.5) * CELL;
          const d = Math.hypot(px - cx, pz - cz);
          const steps = Math.max(2, Math.ceil(d / 7));
          let blocked = false;
          for (let s = 1; s < steps; s++) {
            const t = s / steps;
            const sx = Util.lerp(cx, px, t), sz = Util.lerp(cz, pz, t);
            const sy = Util.lerp(eyeY, height(px, pz) + 1.4, t);
            if (height(sx, sz) > sy + 0.3) { blocked = true; break; }
          }
          if (blocked) continue;
        }
        fogAccum[idx] = 1;
      }
    }
  }

  function updateFog(units, buildings) {
    fogAccum.fill(0);
    for (let i = 0; i < units.length; i++) {
      const u = units[i];
      if (u.dead || u.faction !== 'ally') continue;
      revealCircle(u.x, u.z, u.vision, true);
    }
    for (let i = 0; i < buildings.length; i++) {
      const b = buildings[i];
      if (b.dead || b.faction !== 'ally') continue;
      revealCircle(b.x, b.z, b.vision, true);
    }
    const vis = state.fogVisible, exp = state.fogExplored;
    for (let i = 0; i < N * N; i++) {
      if (fogAccum[i]) { vis[i] = 1; exp[i] = 1; }
      else vis[i] = 0;
    }
    fogNeedsRefresh = true;
    fogRefreshAcc += 1;
    if (fogRefreshAcc >= 4) {
      fogRefreshAcc = 0;
      fogNeedsRefresh = false;
      updateFogTexture(true);
    }
  }

  function fogVisibleAt(x, z) {
    const idx = cellIndex(x, z);
    return idx >= 0 ? state.fogVisible[idx] === 1 : false;
  }
  function fogExploredAt(x, z) {
    const idx = cellIndex(x, z);
    return idx >= 0 ? state.fogExplored[idx] === 1 : false;
  }

  // =========================================================
  //  ИНИЦИАЛИЗАЦИЯ И КАДР
  // =========================================================
  function init(sc) {
    scene = sc;
    buildHeightGrid();
    const tex = makeGroundTexture();
    initFogTexture();
    group = new THREE.Group();
    const gmesh = makeGroundMesh(tex);
    group.add(gmesh);
    group.add(makeWater());
    for (const b of BRIDGES) group.add(makeBridge(b));
    scatterVegetation();
    scene.add(group);
    buildNav();
    applyFogShader(gmesh.material);
    applyFogShader(waterMesh.material);
    ready = true;
  }

  let waterTime = 0;
  function update(dt) {
    waterTime += dt;
    const sh = waterMesh.material.userData.shader;
    if (sh) sh.uniforms.uTime.value = waterTime;
  }

  // =========================================================
  //  ТУМАН ВОЙНЫ (визуальный слой)
  // =========================================================
  let fogTex = null;
  const fogData = new Uint8Array(N * N * 4);
  let fogNeedsRefresh = true;
  let fogRefreshAcc = 0;
  const vegetationChunks = [];   // { mesh, list, dummy, yOff }

  function initFogTexture() {
    for (let i = 0; i < N * N; i++) {
      fogData[i * 4] = 255; fogData[i * 4 + 1] = 255;
      fogData[i * 4 + 2] = 255; fogData[i * 4 + 3] = 255;
    }
    fogTex = new THREE.DataTexture(fogData, N, N, THREE.RGBAFormat);
    fogTex.magFilter = THREE.LinearFilter;
    fogTex.minFilter = THREE.LinearFilter;
    fogTex.wrapS = fogTex.wrapT = THREE.ClampToEdgeWrapping;
    fogTex.generateMipmaps = false;
    fogTex.needsUpdate = true;
    World.state.fogTexture = fogTex;
    return fogTex;
  }

  // полный сброс тумана (при старте новой операции)
  function resetFog() {
    state.fogVisible.fill(0);
    state.fogExplored.fill(0);
    fogRefreshAcc = 99;
    updateFogTexture(true);
  }

  // показать всю карту (фон меню)
  function showAllFog() {
    state.fogVisible.fill(1);
    state.fogExplored.fill(1);
    updateFogTexture(true);
  }

  // Внедряем туман в шейдеры земли и воды
  function applyFogShader(mat) {
    const prev = mat.onBeforeCompile;
    mat.onBeforeCompile = (sh, renderer) => {
      if (prev) prev(sh, renderer);
      sh.uniforms.uFogTex = { value: fogTex };
      sh.vertexShader = 'varying vec3 vFogW;\n' + sh.vertexShader;
      sh.vertexShader = sh.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         vFogW = (modelMatrix * vec4(transformed, 1.0)).xyz;`
      );
      sh.fragmentShader = 'uniform sampler2D uFogTex;\nvarying vec3 vFogW;\n' + sh.fragmentShader;
      sh.fragmentShader = sh.fragmentShader.replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>
         vec2 fuv = clamp((vFogW.xz + 128.0) / 256.0, vec2(0.002), vec2(0.998));
         vec2 fg = texture2D(uFogTex, fuv).rg;
         float k = mix(0.22, 0.62, fg.g);   // неисследовано / разведано
         k = mix(k, 1.0, fg.r);             // в зоне прямой видимости
         vec3 tinted = mix(gl_FragColor.rgb, gl_FragColor.rgb * vec3(0.72, 0.80, 0.86), (1.0 - fg.g) * 0.5);
         gl_FragColor.rgb = tinted * k;`
      );
    };
  }

  function updateFogTexture(force) {
    const vis = state.fogVisible, exp = state.fogExplored;
    for (let i = 0; i < N * N; i++) {
      const o = i * 4;
      fogData[o] = vis[i] ? 255 : 0;       // R — в зоне прямой видимости
      fogData[o + 1] = exp[i] ? 255 : 0;   // G — разведано ранее
      fogData[o + 2] = 0;
      fogData[o + 3] = 255;
    }
    if (fogTex) fogTex.needsUpdate = true;
    if (force) updateVegetationVisibility();
  }

  // Скрываем растительность в неисследованных зонах
  function updateVegetationVisibility() {
    const exp = state.fogExplored;
    for (const ch of vegetationChunks) {
      const { mesh, list, dummy, yOff } = ch;
      let changed = false;
      for (let i = 0; i < list.length; i++) {
        const it = list[i];
        const idx = cellIndex(it.x, it.z);
        const seen = idx >= 0 && exp[idx] === 1;
        if (it._seen === seen) continue;
        it._seen = seen;
        changed = true;
        dummy.position.set(it.x, it.h + (yOff || 0) - 0.12, it.z);
        dummy.rotation.set(0, it.r, 0);
        if (seen) dummy.scale.set(it.s, it.s * (0.9 + (it.tint - 1) * 0.35), it.s);
        else dummy.scale.set(0.0001, 0.0001, 0.0001);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
      if (changed) mesh.instanceMatrix.needsUpdate = true;
    }
  }

  // =========================================================
  //  ЛУЧ ПО РЕЛЬЕФУ
  // =========================================================
  function pickTerrain(origin, dir, maxDist) {
    maxDist = maxDist || 600;
    let t = 0, prevT = 0;
    let prevY = origin.y - height(origin.x, origin.z);
    while (t < maxDist) {
      prevT = t;
      t += Math.max(0.5, t * 0.012);
      const x = origin.x + dir.x * t, y = origin.y + dir.y * t, z = origin.z + dir.z * t;
      const diff = y - height(x, z);
      if (diff <= 0) {
        let lo = prevT, hi = t;
        for (let i = 0; i < 14; i++) {
          const mid = (lo + hi) * 0.5;
          const mx = origin.x + dir.x * mid, my = origin.y + dir.y * mid, mz = origin.z + dir.z * mid;
          if (my > height(mx, mz)) lo = mid; else hi = mid;
        }
        const ft = (lo + hi) * 0.5;
        return new THREE.Vector3(
          origin.x + dir.x * ft,
          origin.y + dir.y * ft,
          origin.z + dir.z * ft
        );
      }
      prevY = diff;
    }
    return null;
  }

  function lineOfSight(ax, ay, az, bx, by, bz) {
    const dist = Math.hypot(bx - ax, bz - az);
    const steps = Math.max(3, Math.ceil(dist / 3.5));
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const x = Util.lerp(ax, bx, t), z = Util.lerp(az, bz, t);
      const y = Util.lerp(ay, by, t);
      if (height(x, z) > y + 0.28) return false;
    }
    return true;
  }

  return {
    SIZE, HALF, GRID, STEP, CELL, N, WATER_Y, BRIDGES, FORD, BASE_ALLY, BASE_ENEMY, CONTROL_POINTS,
    state, riverCenter, riverHalf, height, normalAt, slopeAt, isWater, onBridge, onFord,
    cellIndex, cellCenter, isNavigable, nearestPassable, buildNav, nearRoad,
    updateFog, fogVisibleAt, fogExploredAt, revealCircle, resetFog, showAllFog,
    init, update, pickTerrain, lineOfSight, reservedSpot,
    get group() { return group; },
    get waterMesh() { return waterMesh; },
    get groundMesh() { return groundMesh; },
    get minimapBase() { return minimapBase; },
    get ready() { return ready; }
  };
})();