/* ============================================================
   path.js — поиск пути A* по сетке навигации
   ============================================================ */
'use strict';

const Pathfinder = (() => {
  const N = World.N, CELL = World.CELL, HALF = World.HALF;
  const gScore = new Float32Array(N * N);
  const fScore = new Float32Array(N * N);
  const cameFrom = new Int32Array(N * N);
  const closed = new Uint8Array(N * N);
  const stamp = new Int32Array(N * N);
  let searchId = 0;

  const heap = new Util.MinHeap();
  const DIRS = [
    [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
    [1, 1, 1.4142], [1, -1, 1.4142], [-1, 1, 1.4142], [-1, -1, 1.4142]
  ];

  function walkable(idx) { return World.state.nav[idx] === 1; }
  function costAt(idx) { return World.state.cost[idx]; }

  // прямая видимость по клеткам (для сглаживания пути)
  function lineClear(x0, z0, x1, z1) {
    const dx = x1 - x0, dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    const steps = Math.ceil(len / (CELL * 0.6));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const idx = World.cellIndex(x0 + dx * t, z0 + dz * t);
      if (idx < 0 || !walkable(idx)) return false;
    }
    return true;
  }

  /**
   * Поиск пути. Возвращает массив точек {x,z} или null.
   * @param {boolean} partial — разрешить путь до ближайшей достижимой точки (для «идти в точку»)
   */
  function find(startX, startZ, goalX, goalZ, maxNodes = 9000) {
    let s = World.cellIndex(startX, startZ);
    let g = World.cellIndex(goalX, goalZ);
    if (s < 0) return null;
    if (!walkable(s)) {
      const p = World.nearestPassable(startX, startZ, 6);
      if (!p) return null;
      s = World.cellIndex(p.x, p.z);
    }
    if (g < 0) return null;
    if (!walkable(g)) {
      const p = World.nearestPassable(goalX, goalZ, 14);
      if (!p) return null;
      g = World.cellIndex(p.x, p.z);
    }
    if (s === g) {
      const c = World.cellCenter(g);
      return [{ x: c.x, z: c.z }];
    }

    searchId++;
    heap.clear();
    const gx = g % N, gz = (g / N) | 0;

    const heur = (idx) => {
      const i = idx % N, j = (idx / N) | 0;
      const dx = Math.abs(i - gx), dz = Math.abs(j - gz);
      return (dx + dz) * 0.7 + Math.min(dx, dz) * 0.6;
    };

    stamp[s] = searchId; gScore[s] = 0; fScore[s] = heur(s);
    cameFrom[s] = -1; closed[s] = 0;
    heap.push(s, fScore[s]);
    let expanded = 0;
    let bestNode = s, bestH = heur(s);
    let found = false;

    while (heap.size > 0) {
      const cur = heap.pop();
      if (stamp[cur] !== searchId || closed[cur]) continue;
      closed[cur] = 1;
      if (cur === g) { found = true; break; }
      if (++expanded > maxNodes) break;

      const ci = cur % N, cj = (cur / N) | 0;
      const hcur = heur(cur);
      if (hcur < bestH) { bestH = hcur; bestNode = cur; }

      for (let d = 0; d < 8; d++) {
        const ni = ci + DIRS[d][0], nj = cj + DIRS[d][1];
        if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
        const nidx = nj * N + ni;
        if (!walkable(nidx)) continue;
        if (stamp[nidx] !== searchId) {
          stamp[nidx] = searchId; gScore[nidx] = Infinity; closed[nidx] = 0;
        }
        if (closed[nidx]) continue;
        // запрет срезать углы
        if (d >= 4) {
          if (!walkable(cj * N + ni) || !walkable(nj * N + ci)) continue;
        }
        const step = DIRS[d][2] * ((costAt(cur) + costAt(nidx)) * 0.5);
        const ng = gScore[cur] + step;
        if (ng < gScore[nidx]) {
          gScore[nidx] = ng;
          cameFrom[nidx] = cur;
          fScore[nidx] = ng + heur(nidx) * 1.05;
          heap.push(nidx, fScore[nidx]);
        }
      }
    }

    if (!found) {
      // частичный путь до ближайшей точки
      if (bestH > 2.5) return null;
      g = bestNode;
    }

    // восстанавливаем
    const cells = [];
    let c = g;
    let guard = 0;
    while (c !== -1 && guard++ < 5000) {
      cells.push(c);
      if (c === s) break;
      c = cameFrom[c];
    }
    cells.reverse();

    const pts = cells.map(idx => World.cellCenter(idx));
    if (found) {
      const last = pts[pts.length - 1];
      // уточняем конечную точку (если она проходима)
      if (World.isNavigable(goalX, goalZ) && lineClear(last.x, last.z, goalX, goalZ)) {
        last.x = goalX; last.z = goalZ;
      }
    }
    return smooth(pts);
  }

  // сглаживание: выбрасываем промежуточные точки, если прямая проходима
  function smooth(pts) {
    if (pts.length <= 2) return pts;
    const out = [pts[0]];
    let i = 0;
    while (i < pts.length - 1) {
      let j = Math.min(i + 14, pts.length - 1);
      while (j > i + 1 && !lineClear(pts[i].x, pts[i].z, pts[j].x, pts[j].z)) j--;
      out.push(pts[j]);
      i = j;
    }
    return out;
  }

  // путь к точке рядом с целью (для подхода на дистанцию атаки)
  function findApproach(sx, sz, tx, tz, range) {
    const d = Util.dist(sx, sz, tx, tz);
    if (d <= range) return [];
    const dirX = (sx - tx) / d, dirZ = (sz - tz) / d;
    // ищем подходящую точку на окружности радиуса range
    for (let a = 0; a < 6; a++) {
      const ang = (a / 6) * Math.PI * 2;
      const offX = Math.cos(ang) * 3, offZ = Math.sin(ang) * 3;
      const px = tx + dirX * range + offX, pz = tz + dirZ * range + offZ;
      if (World.isNavigable(px, pz)) {
        const p = find(sx, sz, px, pz);
        if (p && p.length) return p;
      }
    }
    return find(sx, sz, tx + dirX * range, tz + dirZ * range);
  }

  return { find, findApproach, lineClear };
})();