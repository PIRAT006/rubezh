/* ============================================================
   effects.js — частицы, трассеры, взрывы, воронки, маркеры приказов
   ============================================================ */
'use strict';

const Effects = (() => {
  let scene = null, camera = null;
  let smoke = null, glow = null, spark = null, tracers = null, decals = null;
  let flashLight = null;
  let time = 0;

  // ---------------------------------------------------------
  //  ТЕКСТУРЫ
  // ---------------------------------------------------------
  function softTexture(inner, power) {
    const S = 128;
    const cv = document.createElement('canvas');
    cv.width = cv.height = S;
    const c = cv.getContext('2d');
    const g = c.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    for (let i = 0; i <= 16; i++) {
      const t = i / 16;
      const a = Math.pow(1 - t, power);
      g.addColorStop(t, `rgba(${inner},${a.toFixed(3)})`);
    }
    c.fillStyle = g;
    c.fillRect(0, 0, S, S);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  function puffTexture() {
    const S = 128;
    const cv = document.createElement('canvas');
    cv.width = cv.height = S;
    const c = cv.getContext('2d');
    const g = c.createRadialGradient(S / 2, S / 2, S * 0.05, S / 2, S / 2, S / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.72)');
    g.addColorStop(0.7, 'rgba(255,255,255,0.26)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, S, S);
    c.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 60; i++) {
      const a = Math.random() * 6.283, r = Math.pow(Math.random(), 0.7) * S * 0.46;
      c.beginPath();
      c.arc(S / 2 + Math.cos(a) * r, S / 2 + Math.sin(a) * r, 3 + Math.random() * 13, 0, 6.283);
      c.fillStyle = `rgba(0,0,0,${(Math.random() * 0.45).toFixed(3)})`;
      c.fill();
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  function ringMeshTexture() {
    const S = 128;
    const cv = document.createElement('canvas');
    cv.width = cv.height = S;
    const c = cv.getContext('2d');
    c.strokeStyle = 'rgba(255,255,255,0.92)';
    c.lineWidth = 3.5;
    c.beginPath(); c.arc(S / 2, S / 2, S / 2 - 9, 0, 6.283); c.stroke();
    c.globalAlpha = 0.55;
    c.lineWidth = 1.6;
    c.beginPath(); c.arc(S / 2, S / 2, S / 2 - 24, 0, 6.283); c.stroke();
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  // ---------------------------------------------------------
  //  ИНСТАНСНЫЙ БАТЧ БИЛБОРДОВ
  // ---------------------------------------------------------
  const VERT = `
    attribute vec3 aPos;
    attribute vec3 aColor;
    attribute vec2 aSR;   // size, rotation
    attribute float aAlpha;
    varying vec3 vColor;
    varying float vAlpha;
    varying vec2 vUv;
    void main(){
      vColor = aColor; vAlpha = aAlpha; vUv = uv;
      vec4 mv = modelViewMatrix * vec4(aPos, 1.0);
      float c = cos(aSR.y), s = sin(aSR.y);
      vec2 corner = position.xy * aSR.x;
      mv.xy += vec2(corner.x * c - corner.y * s, corner.x * s + corner.y * c);
      gl_Position = projectionMatrix * mv;
    }`;
  const FRAG = `
    uniform sampler2D uTex;
    uniform vec3 uTint;
    uniform float uAdd;
    varying vec3 vColor;
    varying float vAlpha;
    varying vec2 vUv;
    void main(){
      vec4 t = texture2D(uTex, vUv);
      float a = t.a * vAlpha;
      if (a < 0.004) discard;
      vec3 rgb = vColor * uTint * (uAdd > 0.5 ? 1.0 : 1.0) * mix(vec3(1.0), t.rgb, 0.5);
      gl_FragColor = vec4(rgb, a);
    }`;

  class Batch {
    constructor(max, tex, additive, tint) {
      this.max = max;
      this.cursor = 0;
      this.alive = new Uint8Array(max);
      this.life = new Float32Array(max);
      this.maxLife = new Float32Array(max);
      this.vx = new Float32Array(max);
      this.vy = new Float32Array(max);
      this.vz = new Float32Array(max);
      this.grow = new Float32Array(max);
      this.drag = new Float32Array(max);
      this.grav = new Float32Array(max);
      this.size0 = new Float32Array(max);
      this.alpha0 = new Float32Array(max);
      this.spin = new Float32Array(max);
      this.rot0 = new Float32Array(max);
      this.fadePow = new Float32Array(max);

      this.aPos = new Float32Array(max * 3);
      this.aCol = new Float32Array(max * 3);
      this.aSR = new Float32Array(max * 2);
      this.aAlpha = new Float32Array(max);

      const quad = new THREE.PlaneGeometry(1, 1);
      const geo = new THREE.InstancedBufferGeometry();
      geo.index = quad.index;
      geo.setAttribute('position', quad.attributes.position);
      geo.setAttribute('uv', quad.attributes.uv);

      this.bPos = new THREE.InstancedBufferAttribute(this.aPos, 3).setUsage(THREE.DynamicDrawUsage);
      this.bCol = new THREE.InstancedBufferAttribute(this.aCol, 3).setUsage(THREE.DynamicDrawUsage);
      this.bSR = new THREE.InstancedBufferAttribute(this.aSR, 2).setUsage(THREE.DynamicDrawUsage);
      this.bAlpha = new THREE.InstancedBufferAttribute(this.aAlpha, 1).setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('aPos', this.bPos);
      geo.setAttribute('aColor', this.bCol);
      geo.setAttribute('aSR', this.bSR);
      geo.setAttribute('aAlpha', this.bAlpha);
      geo.instanceCount = max;

      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uTex: { value: tex },
          uTint: { value: new THREE.Color(tint) },
          uAdd: { value: additive ? 1 : 0 }
        },
        vertexShader: VERT,
        fragmentShader: FRAG,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending
      });
      this.material = mat;
      this.mesh = new THREE.Mesh(geo, mat);
      this.mesh.frustumCulled = false;
      this.mesh.renderOrder = additive ? 8 : 6;
      this.geo = geo;
    }

    spawn(x, y, z, o) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.max;
      this.alive[i] = 1;
      this.life[i] = 0;
      this.maxLife[i] = o.life || 1;
      this.vx[i] = o.vx || 0; this.vy[i] = o.vy || 0; this.vz[i] = o.vz || 0;
      this.grow[i] = o.grow || 0;
      this.drag[i] = o.drag || 0;
      this.grav[i] = o.grav || 0;
      this.size0[i] = o.size || 1;
      this.alpha0[i] = o.alpha === undefined ? 1 : o.alpha;
      this.spin[i] = o.spin || 0;
      this.rot0[i] = Math.random() * 6.283;
      this.fadePow[i] = o.fadePow === undefined ? 1 : o.fadePow;
      this.aPos[i * 3] = x; this.aPos[i * 3 + 1] = y; this.aPos[i * 3 + 2] = z;
      const c = o.color || [1, 1, 1];
      this.aCol[i * 3] = c[0]; this.aCol[i * 3 + 1] = c[1]; this.aCol[i * 3 + 2] = c[2];
      this.aSR[i * 2] = this.size0[i];
      this.aSR[i * 2 + 1] = this.rot0[i];
      this.aAlpha[i] = this.alpha0[i];
    }

    update(dt) {
      const { alive, life, maxLife } = this;
      for (let i = 0; i < this.max; i++) {
        if (!alive[i]) { this.aAlpha[i] = 0; continue; }
        life[i] += dt;
        if (life[i] >= maxLife[i]) { alive[i] = 0; this.aAlpha[i] = 0; continue; }
        const t = life[i] / maxLife[i];
        const d = this.drag[i] ? Math.exp(-this.drag[i] * dt) : 1;
        this.vx[i] *= d; this.vy[i] *= d; this.vz[i] *= d;
        this.vy[i] += this.grav[i] * dt;
        this.aPos[i * 3] += this.vx[i] * dt;
        this.aPos[i * 3 + 1] += this.vy[i] * dt;
        this.aPos[i * 3 + 2] += this.vz[i] * dt;
        this.aSR[i * 2] = this.size0[i] * (1 + this.grow[i] * t);
        this.aSR[i * 2 + 1] = this.rot0[i] + this.spin[i] * life[i];
        this.aAlpha[i] = this.alpha0[i] * Math.pow(1 - t, this.fadePow[i]);
      }
      this.bPos.needsUpdate = true;
      this.bCol.needsUpdate = true;
      this.bSR.needsUpdate = true;
      this.bAlpha.needsUpdate = true;
    }
  }

  // ---------------------------------------------------------
  //  ТРАССЕРЫ
  // ---------------------------------------------------------
  class TracerBatch {
    constructor(max) {
      this.max = max;
      this.items = [];
      this.pos = new Float32Array(max * 6);
      this.col = new Float32Array(max * 6);
      const geo = new THREE.BufferGeometry();
      this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
      this.aCol = new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('position', this.aPos);
      geo.setAttribute('color', this.aCol);
      geo.setDrawRange(0, 0);
      const mat = new THREE.LineBasicMaterial({
        vertexColors: true, transparent: true, opacity: 1,
        blending: THREE.AdditiveBlending, depthWrite: false
      });
      this.mesh = new THREE.LineSegments(geo, mat);
      this.mesh.frustumCulled = false;
      this.mesh.renderOrder = 9;
      this.geo = geo;
    }
    add(a, b, color, life) {
      if (this.items.length >= this.max) this.items.shift();
      this.items.push({ a: [a.x, a.y, a.z], b: [b.x, b.y, b.z], c: color, life: life || 0.08, max: life || 0.08 });
    }
    update(dt) {
      const it = this.items;
      for (let i = it.length - 1; i >= 0; i--) { it[i].life -= dt; if (it[i].life <= 0) it.splice(i, 1); }
      const n = it.length;
      for (let i = 0; i < n; i++) {
        const t = it[i], o = i * 6, k = Math.max(0, t.life / t.max);
        this.pos[o] = t.a[0]; this.pos[o + 1] = t.a[1]; this.pos[o + 2] = t.a[2];
        this.pos[o + 3] = t.b[0]; this.pos[o + 4] = t.b[1]; this.pos[o + 5] = t.b[2];
        this.col[o] = t.c[0] * k; this.col[o + 1] = t.c[1] * k; this.col[o + 2] = t.c[2] * k;
        this.col[o + 3] = t.c[0] * k * 0.2; this.col[o + 4] = t.c[1] * k * 0.2; this.col[o + 5] = t.c[2] * k * 0.2;
      }
      this.geo.setDrawRange(0, n * 2);
      this.aPos.needsUpdate = true;
      this.aCol.needsUpdate = true;
    }
  }

  // ---------------------------------------------------------
  //  ДЕКАЛИ (воронки, следы гусениц)
  // ---------------------------------------------------------
  class DecalPool {
    constructor(max, tex, size, opacity, life, yOff) {
      this.idx = 0;
      this.max = max;
      this.ages = new Float32Array(max);
      this.lifes = new Float32Array(max).fill(1e9);
      this.meshes = [];
      const geo = new THREE.PlaneGeometry(1, 1);
      geo.rotateX(-Math.PI / 2);
      for (let i = 0; i < max; i++) {
        const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
          map: tex, transparent: true, opacity: 0, depthWrite: false,
          polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4
        }));
        m.visible = false;
        m.renderOrder = 2;
        window.__scene ? null : null;
        this.meshes.push(m);
      }
      this.size = size; this.opacity = opacity; this.life = life; this.yOff = yOff;
    }
    addTo(scene) { for (const m of this.meshes) scene.add(m); }
    add(x, y, z, scale) {
      const i = this.idx = (this.idx + 1) % this.max;
      const m = this.meshes[i];
      m.position.set(x, y + this.yOff, z);
      m.rotation.y = Math.random() * 6.283;
      m.scale.setScalar((scale || 1) * this.size);
      m.visible = true;
      this.ages[i] = 0;
      this.lifes[i] = this.life;
      m.material.opacity = this.opacity;
    }
    update(dt) {
      for (let i = 0; i < this.max; i++) {
        if (!this.meshes[i].visible) continue;
        this.ages[i] += dt;
        const t = this.ages[i] / this.lifes[i];
        if (t >= 1) { this.meshes[i].visible = false; continue; }
        this.meshes[i].material.opacity = this.opacity * (1 - t * t);
      }
    }
  }

  function craterTexture() {
    const S = 128;
    const cv = document.createElement('canvas');
    cv.width = cv.height = S;
    const c = cv.getContext('2d');
    const g = c.createRadialGradient(S / 2, S / 2, S * 0.05, S / 2, S / 2, S / 2);
    g.addColorStop(0, 'rgba(14,11,8,0.95)');
    g.addColorStop(0.42, 'rgba(28,22,15,0.72)');
    g.addColorStop(0.78, 'rgba(44,34,22,0.2)');
    g.addColorStop(1, 'rgba(44,34,22,0)');
    c.fillStyle = g; c.fillRect(0, 0, S, S);
    for (let i = 0; i < 70; i++) {
      const a = Math.random() * 6.283, r = Math.pow(Math.random(), 0.6) * S * 0.46;
      c.fillStyle = `rgba(10,8,6,${(Math.random() * 0.45).toFixed(3)})`;
      c.beginPath();
      c.arc(S / 2 + Math.cos(a) * r, S / 2 + Math.sin(a) * r, 0.8 + Math.random() * 5, 0, 6.283);
      c.fill();
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  // ---------------------------------------------------------
  //  МАРКЕРЫ ПРИКАЗА
  // ---------------------------------------------------------
  const markers = [];
  let markerTex = null;

  // ---------------------------------------------------------
  //  ИНИЦИАЛИЗАЦИЯ
  // ---------------------------------------------------------
  function init(sc, cam) {
    scene = sc; camera = cam;

    smoke = new Batch(1100, puffTexture(), false, 0xffffff);
    glow = new Batch(600, softTexture('255,236,190', 2.3), true, 0xffffff);
    spark = new Batch(400, softTexture('255,196,120', 1.5), true, 0xffffff);

    scene.add(smoke.mesh);
    scene.add(glow.mesh);
    scene.add(spark.mesh);

    tracers = new TracerBatch(320);
    scene.add(tracers.mesh);

    decals = new DecalPool(90, craterTexture(), 3, 0.8, 60, 0.05);
    decals.addTo(scene);

    flashLight = new THREE.PointLight(0xffb066, 0, 90, 2);
    flashLight.visible = false;
    scene.add(flashLight);

    // маркеры
    markerTex = ringMeshTexture();
    for (let i = 0; i < 10; i++) {
      const g = new THREE.PlaneGeometry(1, 1);
      g.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
        map: markerTex, transparent: true, opacity: 0, depthWrite: false,
        depthTest: false, blending: THREE.AdditiveBlending
      }));
      m.visible = false;
      m.renderOrder = 30;
      scene.add(m);
      markers.push({ mesh: m, life: 0, max: 1, size: 3 });
    }
  }

  let flashT = 0, flashPeak = 0;

  // ---------------------------------------------------------
  //  API
  // ---------------------------------------------------------
  function muzzle(x, y, z, color, size) {
    color = color || [1, 0.78, 0.4];
    size = size || 0.9;
    glow.spawn(x, y, z, { life: 0.075, size, color, alpha: 0.95, grow: 1.6, fadePow: 1.8 });
    for (let i = 0; i < 3; i++) {
      smoke.spawn(x, y + 0.08, z, {
        life: Util.rnd(0.5, 1.1), size: Util.rnd(0.18, 0.4), color: [0.5, 0.47, 0.42],
        alpha: 0.35, vx: Util.rnd(-0.7, 0.7), vy: Util.rnd(0.3, 1.1), vz: Util.rnd(-0.7, 0.7),
        grow: 3.4, drag: 1.8, fadePow: 1.5
      });
    }
    if (Math.random() < 0.55) {
      flashLight.position.set(x, y + 0.5, z);
      flashPeak = Math.max(flashPeak, 12 + size * 8);
      flashLight.visible = true;
      flashT = 0.001;
    }
  }

  function tracer(a, b, color, life) {
    tracers.add(a, b, color || [1, 0.86, 0.5], life || 0.07);
  }

  function bulletImpact(x, y, z, kind) {
    if (kind === 'metal') {
      for (let i = 0; i < 4; i++) {
        spark.spawn(x, y, z, {
          life: Util.rnd(0.15, 0.4), size: Util.rnd(0.1, 0.24), color: [1, 0.72, 0.32], alpha: 1,
          vx: Util.rnd(-3, 3), vy: Util.rnd(0.5, 4), vz: Util.rnd(-3, 3), grav: -14, drag: 0.5, fadePow: 1
        });
      }
      glow.spawn(x, y, z, { life: 0.06, size: 0.45, color: [1, 0.82, 0.45], alpha: 0.85 });
    } else if (kind === 'water') {
      for (let i = 0; i < 3; i++) {
        smoke.spawn(x, y, z, {
          life: Util.rnd(0.3, 0.6), size: Util.rnd(0.12, 0.24), color: [0.62, 0.7, 0.72], alpha: 0.6,
          vx: Util.rnd(-0.6, 0.6), vy: Util.rnd(1.0, 2.4), vz: Util.rnd(-0.6, 0.6), grow: 2.2, drag: 2.4, grav: -4
        });
      }
    } else {
      for (let i = 0; i < 2; i++) {
        smoke.spawn(x, y, z, {
          life: Util.rnd(0.35, 0.8), size: Util.rnd(0.14, 0.3), color: [0.52, 0.45, 0.34], alpha: 0.65,
          vx: Util.rnd(-0.7, 0.7), vy: Util.rnd(0.7, 2.0), vz: Util.rnd(-0.7, 0.7), grow: 2.6, drag: 2.2, grav: -2
        });
      }
      for (let i = 0; i < 3; i++) {
        spark.spawn(x, y + 0.05, z, {
          life: Util.rnd(0.18, 0.4), size: Util.rnd(0.06, 0.15), color: [0.62, 0.54, 0.4], alpha: 0.9,
          vx: Util.rnd(-2.2, 2.2), vy: Util.rnd(1.5, 4), vz: Util.rnd(-2.2, 2.2), grav: -12, drag: 0.9
        });
      }
    }
  }

  function explosion(x, y, z, scale, opts) {
    const s = scale || 1;
    opts = opts || {};
    glow.spawn(x, y + 0.2 * s, z, {
      life: 0.14, size: 2.2 * s, color: [1, 0.9, 0.65], alpha: 1, grow: 1.9, fadePow: 1.3
    });
    glow.spawn(x, y + 0.3 * s, z, {
      life: 0.3, size: 1.5 * s, color: [1, 0.6, 0.22], alpha: 0.85, grow: 2.3, fadePow: 1.6
    });
    for (let i = 0; i < Math.min(16, 5 + s * 3); i++) {
      const a = Math.random() * 6.283, r = Math.random() * 0.8 * s;
      glow.spawn(x + Math.cos(a) * r, y + Math.random() * 0.9 * s, z + Math.sin(a) * r, {
        life: Util.rnd(0.2, 0.45), size: Util.rnd(0.4, 1.1) * s,
        color: [1, Util.rnd(0.35, 0.7), 0.16], alpha: 0.9,
        vx: Math.cos(a) * Util.rnd(1, 4) * s, vy: Util.rnd(1, 5) * s, vz: Math.sin(a) * Util.rnd(1, 4) * s,
        drag: 2.6, grow: 1.9, fadePow: 1.5
      });
    }
    for (let i = 0; i < Math.min(22, 8 + s * 4); i++) {
      const a = Math.random() * 6.283, r = Math.random() * 1.2 * s;
      smoke.spawn(x + Math.cos(a) * r, y + Math.random() * 1.3 * s, z + Math.sin(a) * r, {
        life: Util.rnd(1.3, 2.8), size: Util.rnd(0.7, 1.6) * s,
        color: [Util.rnd(0.13, 0.22), Util.rnd(0.12, 0.2), Util.rnd(0.11, 0.18)],
        alpha: Util.rnd(0.5, 0.8),
        vx: Math.cos(a) * Util.rnd(1, 4) * s, vy: Util.rnd(1.6, 4.5) * s, vz: Math.sin(a) * Util.rnd(1, 4) * s,
        drag: 1.05, grow: 2.5, fadePow: 1.6, spin: Util.rnd(-0.5, 0.5)
      });
    }
    for (let i = 0; i < Math.min(26, 8 + s * 6); i++) {
      const a = Math.random() * 6.283;
      spark.spawn(x, y + 0.3, z, {
        life: Util.rnd(0.4, 1.3), size: Util.rnd(0.1, 0.3) * s,
        color: [1, Util.rnd(0.55, 0.9), 0.3], alpha: 1,
        vx: Math.cos(a) * Util.rnd(3, 13) * s, vy: Util.rnd(3, 14) * s, vz: Math.sin(a) * Util.rnd(3, 13) * s,
        grav: -16, drag: 0.35, fadePow: 1.7
      });
    }
    for (let i = 0; i < Math.max(4, 5 * s); i++) {
      const a = Math.random() * 6.283;
      smoke.spawn(x + Math.cos(a) * 1.1 * s, y + 0.15, z + Math.sin(a) * 1.1 * s, {
        life: Util.rnd(0.9, 1.9), size: Util.rnd(0.9, 2.0) * s,
        color: [0.4, 0.35, 0.27], alpha: 0.55,
        vx: Math.cos(a) * Util.rnd(3, 7) * s, vy: Util.rnd(0.2, 1.2), vz: Math.sin(a) * Util.rnd(3, 7) * s,
        drag: 2.0, grow: 2.8, fadePow: 1.5
      });
    }
    flashLight.position.set(x, y + 1.5, z);
    flashPeak = Math.max(flashPeak, 45 * s);
    flashLight.visible = true;
    flashT = 0.001;
    if (s > 1.0 && opts.decal !== false) decals.add(x, y, z, 2.2 * s);
    shockwave(x, y + 0.1, z, Math.max(5, s * 7.0), 0.35 + s * 0.08);
    if (typeof Cam !== 'undefined') {
      const cx = Cam.getTarget ? Cam.getTarget().x : 0;
      const cz = Cam.getTarget ? Cam.getTarget().z : 0;
      const d = Math.hypot(x - cx, z - cz);
      const intensity = Math.max(0, 1 - d / 140) * Math.min(2.5, s * 0.85);
      if (intensity > 0.05) Cam.shake(intensity);
    }
  }

  function smokePlume(x, y, z, color, scale, life) {
    smoke.spawn(x, y, z, {
      life: (life || 2.2) * Util.rnd(0.7, 1.2), size: Util.rnd(0.45, 0.85) * (scale || 1),
      color: color || [0.26, 0.25, 0.24], alpha: Util.rnd(0.3, 0.55),
      vx: Util.rnd(-0.5, 0.5), vy: Util.rnd(0.9, 2.2), vz: Util.rnd(-0.5, 0.5),
      grow: 3.2, drag: 0.75, fadePow: 1.4, spin: Util.rnd(-0.6, 0.6)
    });
  }

  function dust(x, y, z, amount) {
    for (let i = 0; i < (amount || 1); i++) {
      smoke.spawn(x + Util.rnd(-0.9, 0.9), y + 0.15, z + Util.rnd(-0.9, 0.9), {
        life: Util.rnd(0.5, 1.3), size: Util.rnd(0.25, 0.55),
        color: [0.46, 0.41, 0.33], alpha: 0.3,
        vx: Util.rnd(-0.9, 0.9), vy: Util.rnd(0.3, 1.0), vz: Util.rnd(-0.9, 0.9),
        grow: 2.8, drag: 1.6, fadePow: 1.5
      });
    }
  }

  function orderMarker(x, y, z, color, size = 3) {
    let mk = null;
    for (const m of markers) {
      if (m.life <= 0) { mk = m; break; }
    }
    if (!mk) mk = markers[0];
    mk.life = 0.55;
    mk.max = mk.life;
    mk.size = size;
    mk.mesh.position.set(x, y + 0.15, z);
    if (Array.isArray(color)) {
      mk.mesh.material.color.setRGB(color[0], color[1], color[2]);
    } else if (typeof color === 'number') {
      mk.mesh.material.color.setHex(color);
    }
    mk.mesh.scale.setScalar(size * 0.5);
    mk.mesh.material.opacity = 0.95;
    mk.mesh.visible = true;
  }

  // ---------------------------------------------------------
  //  УДАРНЫЕ ВОЛНЫ И КОЛЬЦА
  // ---------------------------------------------------------
  const shockwaves = [];
  function initShockwaves() {
    const ringTex = ringMeshTexture();
    for (let i = 0; i < 8; i++) {
      const g = new THREE.PlaneGeometry(1, 1);
      g.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
        map: ringTex, transparent: true, opacity: 0, depthWrite: false,
        blending: THREE.AdditiveBlending, color: 0xffe2aa
      }));
      m.visible = false;
      m.renderOrder = 28;
      scene.add(m);
      shockwaves.push({ mesh: m, life: 0, max: 0.5, maxR: 12, startR: 1 });
    }
  }

  function shockwave(x, y, z, maxR, dur, color) {
    let sw = null;
    for (const s of shockwaves) if (s.life <= 0) { sw = s; break; }
    if (!sw) sw = shockwaves[0];
    sw.life = dur || 0.42;
    sw.max = sw.life;
    sw.maxR = maxR || 10;
    sw.mesh.position.set(x, y + 0.12, z);
    sw.mesh.material.color.set(color || 0xffd28e);
    sw.mesh.scale.setScalar(0.5);
    sw.mesh.visible = true;
  }

  function smokeScreen(x, z, radius = 22, duration = 18) {
    const n = 45;
    for (let i = 0; i < n; i++) {
      const ang = Math.random() * 6.283;
      const dist = Math.sqrt(Math.random()) * radius;
      const px = x + Math.cos(ang) * dist;
      const pz = z + Math.sin(ang) * dist;
      const py = World.height(px, pz) + 0.8;
      smoke.spawn(px, py, pz, {
        life: duration * Util.rnd(0.8, 1.2),
        size: Util.rnd(3.5, 6.0),
        color: [0.85, 0.85, 0.82],
        alpha: 0.82,
        vx: Util.rnd(-0.3, 0.3), vy: Util.rnd(0.2, 0.6), vz: Util.rnd(-0.3, 0.3),
        grow: 1.8, drag: 1.5, fadePow: 1.2
      });
    }
    shockwave(x, World.height(x, z), z, radius * 1.5, 0.8, 0xcccccc);
    Sfx.explosion(x, z, 0.6);
  }

  function hitmarker(isKill) {
    if (typeof UI !== 'undefined' && UI.showHitmarker) {
      UI.showHitmarker(isKill);
    }
    Sfx.hitmarker(isKill);
  }

  function update(dt) {
    time += dt;
    smoke.update(dt);
    glow.update(dt);
    spark.update(dt);
    tracers.update(dt);
    decals.update(dt);

    for (const sw of shockwaves) {
      if (sw.life <= 0) continue;
      sw.life -= dt;
      const t = 1 - sw.life / sw.max;
      const r = THREE.MathUtils.lerp(0.8, sw.maxR, Math.pow(t, 0.55));
      sw.mesh.scale.setScalar(r);
      sw.mesh.material.opacity = Math.pow(1 - t, 1.4) * 0.95;
      if (sw.life <= 0) sw.mesh.visible = false;
    }

    for (const mk of markers) {
      if (mk.life <= 0) { mk.mesh.visible = false; continue; }
      mk.life -= dt;
      const t = 1 - mk.life / mk.max;
      mk.mesh.scale.setScalar(mk.size * (0.5 + t * 1.0));
      mk.mesh.material.opacity = Math.max(0, 1 - t) * 0.9;
      if (mk.life <= 0) mk.mesh.visible = false;
    }

    if (flashLight.visible) {
      flashT += dt;
      flashLight.intensity = flashPeak * Math.exp(-flashT / 0.055);
      if (flashLight.intensity < 0.6) { flashLight.visible = false; flashLight.intensity = 0; flashPeak = 0; }
    }
  }

  return {
    init: (sc, cam) => { init(sc, cam); initShockwaves(); },
    update, muzzle, tracer, bulletImpact, explosion, smokePlume, dust, orderMarker,
    shockwave, smokeScreen, hitmarker,
    get decals() { return decals; }
  };
})();