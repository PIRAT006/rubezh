/* ============================================================
   util.js — математика, шум, утилиты
   ============================================================ */
'use strict';

const Util = (() => {
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = t => t * t * (3 - 2 * t);
  const damp = (a, b, l, dt) => lerp(a, b, 1 - Math.exp(-l * dt));
  const dist2 = (ax, az, bx, bz) => { const dx = ax - bx, dz = az - bz; return dx * dx + dz * dz; };
  const dist = (ax, az, bx, bz) => Math.sqrt(dist2(ax, az, bx, bz));
  const angleLerp = (a, b, t) => {
    let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
    if (d < -Math.PI) d += Math.PI * 2;
    return a + d * t;
  };
  const rnd = (a = 0, b = 1) => a + Math.random() * (b - a);
  const rndInt = (a, b) => Math.floor(rnd(a, b + 1));
  const pick = arr => arr[(Math.random() * arr.length) | 0];
  const chance = p => Math.random() < p;
  const fmt = n => Math.round(n).toLocaleString('ru-RU');
  const pad2 = n => (n < 10 ? '0' : '') + n;
  const timeStr = s => `${pad2(Math.floor(s / 60))}:${pad2(Math.floor(s % 60))}`;

  // ---- хеш-шум (детерминированный) ----
  function hash2(x, y) {
    let h = x * 374761393 + y * 668265263;
    h = (h ^ (h >> 13)) * 1274126177;
    return ((h ^ (h >> 16)) >>> 0) / 4294967295;
  }
  function vnoise(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = smooth(xf), v = smooth(yf);
    const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
    return lerp(lerp(a, b, u), lerp(c, d, u), v);
  }
  function fbm(x, y, oct = 4, lac = 2.0, gain = 0.5) {
    let s = 0, amp = 1, norm = 0, f = 1;
    for (let i = 0; i < oct; i++) {
      s += vnoise(x * f, y * f) * amp;
      norm += amp; amp *= gain; f *= lac;
    }
    return s / norm;
  }
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---- сегмент против прямоугольника (для рамки выделения) ----
  function pointInRect(px, py, x, y, w, h) {
    return px >= x && px <= x + w && py >= y && py <= y + h;
  }

  // ---- цвет ----
  function mixHex(a, b, t) {
    const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
    const ar = (pa >> 16) & 255, ag = (pa >> 8) & 255, ab = pa & 255;
    const br = (pb >> 16) & 255, bg = (pb >> 8) & 255, bb = pb & 255;
    const r = Math.round(lerp(ar, br, t)), g = Math.round(lerp(ag, bg, t)), bl = Math.round(lerp(ab, bb, t));
    return (r << 16) | (g << 8) | bl;
  }

  // ---- очередь с приоритетом (двоичная куча) для A* ----
  class MinHeap {
    constructor() { this.items = []; this.prio = []; }
    get size() { return this.items.length; }
    clear() { this.items.length = 0; this.prio.length = 0; }
    push(item, p) {
      const it = this.items, pr = this.prio;
      let i = it.length; it.push(item); pr.push(p);
      while (i > 0) {
        const parent = (i - 1) >> 1;
        if (pr[parent] <= p) break;
        it[i] = it[parent]; pr[i] = pr[parent]; i = parent;
      }
      it[i] = item; pr[i] = p;
    }
    pop() {
      const it = this.items, pr = this.prio;
      const top = it[0];
      const lastIt = it.pop(), lastPr = pr.pop();
      if (it.length) {
        let i = 0; const n = it.length;
        while (true) {
          let c = i * 2 + 1; if (c >= n) break;
          if (c + 1 < n && pr[c + 1] < pr[c]) c++;
          if (pr[c] >= lastPr) break;
          it[i] = it[c]; pr[i] = pr[c]; i = c;
        }
        it[i] = lastIt; pr[i] = lastPr;
      }
      return top;
    }
  }

  return {
    clamp, lerp, smooth, damp, dist2, dist, angleLerp, rnd, rndInt, pick, chance,
    fmt, pad2, timeStr, hash2, vnoise, fbm, mulberry32, pointInRect, mixHex, MinHeap
  };
})();