/* ============================================================
   input.js — мышь и клавиатура, выделение, приказы, размещение
   ============================================================ */
'use strict';

const Input = (() => {
  const state = {
    mx: 0, my: 0,
    down: false, downX: 0, downY: 0,
    dragging: false,
    keys: {},
    groups: {},
    buildMode: null,   // { type }
    attackGround: false,
    panSpeed: 1
  };

  let el = null, selRectEl = null, cursorHintEl = null;
  let shift = false, ctrl = false, alt = false;
  let edgeScrollEnabled = true;
  let mouseInside = false;
  let mouseMoved = false;
  let lastClickTime = 0;
  let lastClickUnit = null;

  // ---------------------------------------------------------
  function init(canvasEl) {
    el = canvasEl;
    selRectEl = document.getElementById('selrect');
    cursorHintEl = document.getElementById('cursor-hint');

    window.addEventListener('mousemove', onMove, { passive: true });
    window.addEventListener('mousedown', onDown);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('contextmenu', e => { e.preventDefault(); });
    window.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', () => { state.keys = {}; });
    window.addEventListener('resize', () => Cam.resize());

    const mm = document.getElementById('minimap');
    if (mm) {
      let mmDown = false;
      const jump = (e) => {
        const r = mm.getBoundingClientRect();
        const u = (e.clientX - r.left) / r.width;
        const v = (e.clientY - r.top) / r.height;
        const x = -World.HALF + u * World.SIZE;
        const z = -World.HALF + v * World.SIZE;
        Cam.focus(x, z, false);
      };
      mm.addEventListener('mousedown', e => { e.preventDefault(); mmDown = true; jump(e); });
      window.addEventListener('mousemove', e => { if (mmDown) jump(e); });
      window.addEventListener('mouseup', () => { mmDown = false; });
    }
  }

  // ---------------------------------------------------------
  //  МЫШЬ
  // ---------------------------------------------------------
  function onMove(e) {
    state.mx = e.clientX;
    state.my = e.clientY;
    mouseInside = true;
    mouseMoved = true;
    shift = e.shiftKey;
    if (state.down) {
      const d = Math.hypot(e.clientX - state.downX, e.clientY - state.downY);
      if (d > 6) state.dragging = true;
      if (state.dragging) drawRect();
    }
    updateHover();
    updateCursorHint();
  }

  function updateHover() {
    if (state.dragging) return;
    const u = pickAt(state.mx, state.my);
    if (Game.hovered !== u) {
      Game.hovered = u;
      UI.setHover(u);
    }
  }

  function drawRect() {
    if (!selRectEl) selRectEl = document.getElementById('selrect');
    if (!selRectEl) return;
    const x = Math.min(state.downX, state.mx);
    const y = Math.min(state.downY, state.my);
    const w = Math.abs(state.mx - state.downX);
    const h = Math.abs(state.my - state.downY);
    selRectEl.style.display = 'block';
    selRectEl.style.left = x + 'px';
    selRectEl.style.top = y + 'px';
    selRectEl.style.width = w + 'px';
    selRectEl.style.height = h + 'px';
  }

  function hideRect() {
    if (!selRectEl) selRectEl = document.getElementById('selrect');
    if (selRectEl) selRectEl.style.display = 'none';
  }

  // клики по элементам интерфейса не должны попадать в игровой мир
  function inUI(e) {
    const t = e.target;
    if (!t || !t.closest) return false;
    return !!t.closest('#selbar, #topbar, #left-stack, #minimap-wrap, #points, #buildbar, #log, #overlay, #menu, #toast, #tooltip, .icon-btn, .act, .p-card, .b-card, .u-card, .pt');
  }

  function onDown(e) {
    if (typeof FPSControl !== 'undefined' && FPSControl.active) return;
    if (!Game.enabled) return;
    if (inUI(e)) return;
    Sfx.resume();

    if (e.button === 2) {
      // ПКМ — приказ
      handleRightClick(e);
      return;
    }
    if (e.button !== 0) return;

    state.down = true;
    state.downX = e.clientX;
    state.downY = e.clientY;
    state.dragging = false;
    edgeScrollEnabled = false;

    // в режиме размещения
    if (state.buildMode) return;
  }

  function onUp(e) {
    if (typeof FPSControl !== 'undefined' && FPSControl.active) return;
    if (e.button === 2) return;
    if (!state.down) return;
    state.down = false;
    edgeScrollEnabled = true;

    const wasDrag = state.dragging;
    state.dragging = false;
    hideRect();

    if (!Game.enabled || Game.paused) return;
    if (inUI(e) && !state.buildMode && !state.attackGround && !state.abilityMode) return;

    // режим постройки
    if (state.buildMode) {
      const p = Cam.screenToGround(e.clientX, e.clientY);
      if (p) {
        const res = Game.placeBuilding(state.buildMode, 'ally', p.x, p.z);
        if (res.ok) {
          UI.toast(`Развёрнуто: ${BUILDING_DEFS[state.buildMode].name}`);
          if (!e.shiftKey) cancelBuildMode();
        } else {
          UI.toast(res.msg, 'bad');
          Sfx.ui('no');
        }
      }
      if (state.buildMode) { document.body.style.cursor = 'crosshair'; }
      return;
    }

    // режим атаки по площади
    if (state.attackGround) {
      const p = Cam.screenToGround(e.clientX, e.clientY);
      if (p) Game.issueAttackGround(p.x, p.z);
      state.attackGround = false;
      UI.setAttackMode(false);
      document.body.style.cursor = 'default';
      return;
    }

    // режим вызова поддержки ставки (авиаудар, артобстрел, дым)
    if (state.abilityMode) {
      const p = Cam.screenToGround(e.clientX, e.clientY);
      if (p) {
        Game.triggerAbility(state.abilityMode, p.x, p.z);
      }
      state.abilityMode = null;
      document.body.style.cursor = 'default';
      return;
    }

    if (wasDrag) {
      boxSelect(e.shiftKey || e.ctrlKey);
    } else {
      clickSelect(e.shiftKey || e.ctrlKey);
    }
  }

  function onWheel(e) {
    e.preventDefault();
    if (!Game.enabled) return;
    const f = Math.pow(1.0015, e.deltaY);
    Cam.zoomBy(Util.clamp(f, 0.8, 1.25));
  }

  // ---------------------------------------------------------
  //  ПИКИНГ
  // ---------------------------------------------------------
  function pickAt(sx, sy) {
    let best = null, bestScore = Infinity;
    const units = Game.units;
    for (let i = 0; i < units.length; i++) {
      const u = units[i];
      if (u.dead) continue;
      if (u.faction !== 'ally' && !World.fogVisibleAt(u.x, u.z)) continue;
      const cy = u.centerY();
      const p = Cam.project(u.x, cy, u.z);
      if (!p || !p.visible) continue;
      // экранный радиус
      const p2 = Cam.project(u.x + u.radius, cy, u.z);
      const pr = Math.max(9, Math.abs(p2.x - p.x) + 4);
      const d = Math.hypot(sx - p.x, sy - p.y);
      if (d < pr && d < bestScore) { bestScore = d; best = u; }
    }
    // постройки
    for (const b of Game.buildings) {
      if (b.dead) continue;
      if (b.faction !== 'ally' && !World.fogExploredAt(b.x, b.z)) continue;
      const p = Cam.project(b.x, b.y + 4, b.z);
      if (!p || !p.visible) continue;
      const p2 = Cam.project(b.x + b.radius, b.y + 4, b.z);
      const pr = Math.max(12, Math.abs(p2.x - p.x) + 6);
      const d = Math.hypot(sx - p.x, sy - p.y) * 0.75;
      if (d < pr && d < bestScore) { bestScore = d; best = b; }
    }
    return best;
  }

  function clickSelect(additive) {
    const hit = pickAt(state.mx, state.my);
    const now = performance.now();
    const dbl = hit && hit === lastClickUnit && (now - lastClickTime < 340);

    if (!hit) {
      if (!additive) { Game.setSelection([]); Game.selectionBuilding = null; Game.inspected = null; }
      UI.refreshSelection();
      lastClickUnit = null;
      return;
    }
    lastClickTime = now;
    lastClickUnit = hit;

    if (hit.isBuilding) {
      Game.setSelection([]);
      Game.selectionBuilding = hit;
      Game.inspected = null;
      Sfx.ui('select');
      UI.refreshSelection();
      return;
    }
    if (hit.faction !== 'ally') {
      // показать врага (осмотр)
      Game.setSelection([]);
      Game.selectionBuilding = null;
      Game.inspected = hit;
      Sfx.ui('select');
      UI.refreshSelection();
      return;
    }
    Game.selectionBuilding = null;
    Game.inspected = null;

    if (dbl) {
      // выбрать всех того же типа на экране
      const list = Game.units.filter(u =>
        u.faction === 'ally' && !u.dead && u.type === hit.type &&
        onScreen(u.x, u.z));
      Game.setSelection(list);
      Sfx.ui('select');
      UI.refreshSelection();
      return;
    }

    let list;
    if (additive) {
      list = Game.selection.slice();
      const i = list.indexOf(hit);
      if (i >= 0) list.splice(i, 1); else list.push(hit);
    } else {
      list = [hit];
    }
    Game.setSelection(list);
    Sfx.ui('select');
    UI.refreshSelection();
  }

  function onScreen(x, z) {
    const p = Cam.project(x, World.height(x, z) + 2, z);
    return p && p.visible && p.x > 0 && p.y > 0 && p.x < window.innerWidth && p.y < window.innerHeight;
  }

  function boxSelect(additive) {
    const x0 = Math.min(state.downX, state.mx), x1 = Math.max(state.downX, state.mx);
    const y0 = Math.min(state.downY, state.my), y1 = Math.max(state.downY, state.my);
    // считаем, что рамка меньше 8px — не рамка
    const picked = [];
    for (const u of Game.units) {
      if (u.dead || u.faction !== 'ally') continue;
      const p = Cam.project(u.x, u.centerY(), u.z);
      if (!p || !p.visible) continue;
      if (p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1) picked.push(u);
    }
    if (!picked.length) {
      if (!additive) { Game.setSelection([]); UI.refreshSelection(); }
      return;
    }
    // приоритет боевым
    let list = picked;
    if (!additive) {
      Game.setSelection(list);
    } else {
      const cur = Game.selection.slice();
      for (const u of list) if (cur.indexOf(u) < 0) cur.push(u);
      Game.setSelection(cur);
    }
    Game.selectionBuilding = null;
    Sfx.ui('select');
    UI.refreshSelection();
  }

  // ---------------------------------------------------------
  //  ПКМ — приказ
  // ---------------------------------------------------------
  function handleRightClick(e) {
    if (!Game.enabled) return;
    if (inUI(e)) return;
    if (state.buildMode) { cancelBuildMode(); return; }
    if (state.attackGround) { state.attackGround = false; UI.setAttackMode(false); return; }

    if (!Game.selection.length) {
      // может постройка выбрана?
      if (Game.selectionBuilding) {
        const p = Cam.screenToGround(e.clientX, e.clientY);
        if (p) {
          UI.toast('Точка сбора установлена');
          Effects.orderMarker(p.x, World.height(p.x, p.z), p.z, [0.89, 0.75, 0.5], 2.4);
        }
      }
      return;
    }

    // цель под курсором
    const hit = pickAt(e.clientX, e.clientY);
    if (hit && !hit.isBuilding && hit.faction !== 'ally') {
      Game.issueAttack(hit);
      return;
    }
    if (hit && hit.isBuilding && hit.faction !== 'ally') {
      Game.issueAttack(hit);
      return;
    }
    if (hit && hit.faction === 'ally') {
      // приказ следовать/идти к союзнику
      Game.issueMove(hit.x, hit.z, false);
      return;
    }
    const p = Cam.screenToGround(e.clientX, e.clientY);
    if (p) {
      if (!World.isNavigable(p.x, p.z)) {
        const np = World.nearestPassable(p.x, p.z, 18);
        if (!np) { UI.toast('Непроходимая местность', 'bad'); Sfx.ui('no'); return; }
        Game.issueMove(np.x, np.z, false);
      } else {
        Game.issueMove(p.x, p.z, false);
      }
    }
  }

  // ---------------------------------------------------------
  //  КЛАВИАТУРА
  // ---------------------------------------------------------
  function onKeyDown(e) {
    const k = e.key.toLowerCase();
    state.keys[k] = true;
    ctrl = e.ctrlKey || e.metaKey;
    shift = e.shiftKey;
    alt = e.altKey;

    if (!Game.enabled) {
      if (k === 'enter' && !Game.running) { App.startGame(); e.preventDefault(); }
      return;
    }

    // группы
    if (/^[1-9]$/.test(k)) {
      if (ctrl) {
        state.groups[k] = Game.selection.slice();
        UI.toast(`Группа ${k}: ${Game.selection.length} ед.`);
        e.preventDefault();
      } else {
        const g = state.groups[k];
        if (g) {
          const alive = g.filter(u => !u.dead);
          state.groups[k] = alive;
          if (alive.length) {
            Game.setSelection(alive);
            Game.selectionBuilding = null;
            const cx = alive.reduce((s, u) => s + u.x, 0) / alive.length;
            const cz = alive.reduce((s, u) => s + u.z, 0) / alive.length;
            Cam.focus(cx, cz, false);
            UI.refreshSelection();
            Sfx.ui('select');
          }
        }
      }
      return;
    }

    switch (k) {
      case 'escape':
        if (state.abilityMode) { state.abilityMode = null; document.body.style.cursor = 'default'; }
        else if (state.buildMode) cancelBuildMode();
        else if (state.attackGround) { state.attackGround = false; UI.setAttackMode(false); }
        else { Game.setSelection([]); Game.selectionBuilding = null; UI.refreshSelection(); }
        if (UI.overlayKind === 'help') UI.closeOverlay();
        break;
      case 'v':
        if (typeof FPSControl !== 'undefined') {
          const u = Game.selection.length ? Game.selection[0] : null;
          FPSControl.toggle(u);
        }
        e.preventDefault();
        break;
      case 'z':
        startAbilityMode('airstrike');
        e.preventDefault();
        break;
      case 'x':
        startAbilityMode('barrage');
        e.preventDefault();
        break;
      case 'c':
        startAbilityMode('smoke');
        e.preventDefault();
        break;
      case 'a':
        if (!shift) {
          startAttackMode();
          e.preventDefault();
        }
        break;
      case 's': Game.stopAll(); UI.toast('Стоп'); break;
      case 'h': Game.holdAll(); UI.toast('Держать позицию'); break;
      case 'f': Game.toggleStance(); break;
      case 'p': App.togglePause(); break;
      case 't': App.cycleSpeed(); break;
      case 'm': Sfx.setEnabled(Sfx.toggle()); UI.updateSoundIcon(); break;
      case ' ':
        if (Game.allyHQ) Cam.focus(Game.allyHQ.x, Game.allyHQ.z + 10, false);
        e.preventDefault();
        break;
      case 'home': Cam.focus(0, 0, false); break;
      case 'f1':
        UI.showHelp();
        e.preventDefault();
        break;
      case 'q': Cam.rotate(0.12); break;
      case 'e': Cam.rotate(-0.12); break;
      case 'b':
        if (Game.selectionBuilding && Game.selectionBuilding.def.builds) {
          UI.refreshSelection();
        }
        break;
      case 'delete':
        if (Game.selectionBuilding && Game.selectionBuilding.faction === 'ally' && Game.selectionBuilding.type !== 'hq') {
          UI.confirmSell(Game.selectionBuilding);
        }
        break;
    }
  }

  function startAbilityMode(id) {
    if (typeof FPSControl !== 'undefined' && FPSControl.active) return;
    const ab = Game.abilities[id];
    if (!ab) return;
    if (ab.timer > 0) { UI.toast(`${ab.name} на перезарядке (${Math.ceil(ab.timer)}с)`, 'bad'); Sfx.ui('no'); return; }
    if (Game.resource < ab.cost) { UI.toast(`Недостаточно снабжения (нужно ${ab.cost})`, 'bad'); Sfx.ui('no'); return; }
    state.abilityMode = id;
    document.body.style.cursor = 'crosshair';
    UI.toast(`[${ab.key}] Укажите сектор для: ${ab.name}`);
    Sfx.ui('select');
  }

  function onKeyUp(e) {
    state.keys[e.key.toLowerCase()] = false;
  }

  // ---------------------------------------------------------
  //  РЕЖИМЫ
  // ---------------------------------------------------------
  function startBuildMode(type) {
    state.buildMode = type;
    state.attackGround = false;
    UI.setAttackMode(false);
    document.body.style.cursor = 'crosshair';
    UI.toast(`Размещение: ${BUILDING_DEFS[type].name} — ЛКМ поставить, Esc отмена`);
  }
  function cancelBuildMode() {
    state.buildMode = null;
    document.body.style.cursor = 'default';
    UI.refreshSelection();
  }

  function startAttackMode() {
    if (!Game.selection.length) { UI.toast('Сначала выделите подразделения', 'bad'); Sfx.ui('no'); return; }
    state.attackGround = true;
    state.buildMode = null;
    UI.setAttackMode(true);
    document.body.style.cursor = 'crosshair';
    UI.toast('Атака по площади: укажите точку ЛКМ');
  }

  // ---------------------------------------------------------
  //  КАДР
  // ---------------------------------------------------------
  function updateCursorHint() {
    if (!cursorHintEl) cursorHintEl = document.getElementById('cursor-hint');
    if (!cursorHintEl) return;
    const show = (state.buildMode || state.attackGround) && Game.enabled;
    cursorHintEl.classList.toggle('hidden', !show);
    if (!show) return;
    cursorHintEl.textContent = state.buildMode
      ? 'РАЗВЕРНУТЬ: ' + BUILDING_DEFS[state.buildMode].name
      : 'АТАКА ПО ПЛОЩАДИ';
    cursorHintEl.style.left = state.mx + 'px';
    cursorHintEl.style.top = state.my + 'px';
  }

  const EDGE = 14;
  function update(dt) {
    if (!Game.enabled) return;
    const k = state.keys;
    let dx = 0, dz = 0;
    const sp = (26 / Math.max(0.6, Cam.getZoom())) * dt * 2.4;

    // W/S/A/D — панорама (дубли совместимых раскладок), A при зажатом Shift
    if (k['w'] || k['ц']) dz += sp;
    if (k['s'] && shift) dz -= sp;
    if (k['a'] && shift) dx -= sp;
    if (k['d'] || k['в']) dx += sp;
    // стрелки всегда
    if (k['arrowup']) dz += sp;
    if (k['arrowdown']) dz -= sp;
    if (k['arrowleft']) dx -= sp;
    if (k['arrowright']) dx += sp;

    // край экрана (только если курсор реально двигался в окне)
    if (edgeScrollEnabled && mouseMoved && mouseInside && !state.dragging) {
      const edge = EDGE;
      if (state.mx < edge) dx -= sp;
      if (state.mx > window.innerWidth - edge) dx += sp;
      if (state.my < edge + 46) dz += sp;
      if (state.my > window.innerHeight - edge) dz -= sp;
    }

    if (dx || dz) Cam.pan(dx, dz);
    if (k['q'] || k['й']) Cam.rotate(1.6 * dt);
    if (k['e'] || k['у']) Cam.rotate(-1.6 * dt);
    updateCursorHint();
  }

  function isDown(k) { return !!state.keys[k]; }
  function buildMode() { return state.buildMode; }
  function attackMode() { return state.attackGround; }

  return {
    init, update, startBuildMode, cancelBuildMode, startAttackMode, startAbilityMode, buildMode, attackMode,
    pickAt, isDown, get groups() { return state.groups; },
    get mx() { return state.mx; }, get my() { return state.my; }
  };
})();