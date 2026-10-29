/* ============================================================
   ui.js — HUD: ресурсы, выделение, производство, миникарта,
   журнал, оверлеи
   ============================================================ */
'use strict';

const UI = (() => {
  const $ = id => document.getElementById(id);
  let els = {};
  let selDirty = true;
  let logLines = [];
  let minimapCtx = null, minimapCanvas = null;
  let mmBase = null;
  let mmT = 0;
  let overlayKind = null;
  let toastT = 0;

  const ICONS = {
    hq: 'ШТ', barracks: 'КЗ', factory: 'МС', depot: 'СК',
    inf: 'ПХ', ifv: 'БМ', tank: 'ОБ', art: 'СА', aa: 'ПВ', mlrs: 'РС', rec: 'РЗ', drone: 'ДР'
  };

  // ---------------------------------------------------------
  //  ИНИТ
  // ---------------------------------------------------------
  function init() {
    els = {
      hud: $('hud'),
      selbar: $('selbar'),
      res: $('res'), inc: $('inc'), cap: $('cap'),
      clock: $('clock'), objective: $('objective'), subObjective: $('sub-objective'),
      points: $('points'), log: $('log'),
      selTitle: $('sel-title'), selSub: $('sel-sub'), selCards: $('sel-cards'), actions: $('actions'),
      minimap: $('minimap'), tooltip: $('tooltip'), overlay: $('overlay'), ovCard: $('ov-card'),
      btnPause: $('btn-pause'), btnSpeed: $('btn-speed'), btnSound: $('btn-sound'), btnHelp: $('btn-help')
    };
    minimapCanvas = els.minimap;
    minimapCtx = minimapCanvas.getContext('2d');
    minimapCtx.imageSmoothingEnabled = true;

    initFxCanvas();

    els.btnPause.addEventListener('click', () => App.togglePause());
    els.btnSpeed.addEventListener('click', () => App.cycleSpeed());
    els.btnSound.addEventListener('click', () => { Sfx.setEnabled(Sfx.toggle()); updateSoundIcon(); });
    els.btnHelp.addEventListener('click', () => showHelp());

    // тултип
    els.tooltip.classList.add('hidden');
    window.addEventListener('mousemove', e => {
      if (!els.tooltip || els.tooltip.classList.contains('hidden')) return;
      const x = Math.min(e.clientX + 16, window.innerWidth - 270);
      const y = Math.min(e.clientY + 16, window.innerHeight - 160);
      els.tooltip.style.left = x + 'px';
      els.tooltip.style.top = y + 'px';
    });

    // создаём слой логов юнита "toast"
    let t = document.getElementById('toast');
    if (!t) { t = document.createElement('div'); t.id = 'toast'; document.getElementById('hud').appendChild(t); }
    els.toast = t;
    els.buildCards = document.getElementById('build-cards');
    buildDeployPanel();
    buildAbilitiesBar();

    // рамка выделения
    let sr = document.getElementById('selrect');
    if (!sr) { sr = document.createElement('div'); sr.id = 'selrect'; document.getElementById('hud').appendChild(sr); }

    // курсорная подсказка
    let ch = document.getElementById('cursor-hint');
    if (!ch) { ch = document.createElement('div'); ch.id = 'cursor-hint'; document.getElementById('hud').appendChild(ch); }
  }

  function showHud(v) {
    els.hud.classList.toggle('hidden', !v);
    if (v) els.hud.classList.add('on');
  }

  // ---------------------------------------------------------
  //  ПАНЕЛЬ РАЗВЁРТЫВАНИЯ (всегда слева)
  // ---------------------------------------------------------
  const DEPLOY = [
    { type: 'barracks', key: '1' },
    { type: 'factory', key: '2' },
    { type: 'depot', key: '3' }
  ];

  function buildDeployPanel() {
    if (!els.buildCards) return;
    els.buildCards.innerHTML = '';
    for (const d of DEPLOY) {
      const def = BUILDING_DEFS[d.type];
      const card = document.createElement('div');
      card.className = 'b-card';
      card.dataset.type = d.type;
      card.innerHTML = `<img src="${Icons.get(def.icon, '#e6d7ae')}" alt="">
        <span class="bc-t"><span class="bc-n">${def.name}</span><span class="bc-c">${def.cost}</span></span>
        <span class="bc-k">${d.key}</span>`;
      card.addEventListener('click', () => {
        if (Game.resource < def.cost) { toast('Недостаточно снабжения', 'bad'); Sfx.ui('no'); return; }
        Input.startBuildMode(d.type);
      });
      card.addEventListener('mouseenter', () => showTip(card,
        `<b>${def.name}</b><div style="font-size:10.5px;line-height:1.5;color:var(--ink-dim)">${def.desc}</div>
         <div class="tt-row" style="margin-top:4px"><span>Стоимость</span><span>${def.cost}</span></div>
         <div class="tt-row"><span>Прочность</span><span>${def.hp}</span></div>
         <div class="tt-row"><span>Снабжение</span><span>+${def.income}/с</span></div>
         <div class="tt-row"><span>Лимит</span><span>+${def.cap}</span></div>`));
      card.addEventListener('mouseleave', () => els.tooltip.classList.add('hidden'));
      els.buildCards.appendChild(card);
    }
    updateDeployPanel();
  }

  function updateDeployPanel() {
    if (!els.buildCards) return;
    for (const card of els.buildCards.children) {
      const def = BUILDING_DEFS[card.dataset.type];
      card.classList.toggle('dis', !(Game.resource >= def.cost));
    }
  }

  // ---------------------------------------------------------
  //  ПАНЕЛЬ ПОДДЕРЖКИ СТАВКИ (КОМАНДИРСКИЕ ВЫЗОВЫ)
  // ---------------------------------------------------------
  function buildAbilitiesBar() {
    let wrap = document.getElementById('abilities-bar');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = 'abilities-bar';
      wrap.innerHTML = `
        <div class="ab-title">Поддержка ставки</div>
        <div id="ability-cards"></div>
      `;
      const stack = document.getElementById('left-stack');
      if (stack) stack.appendChild(wrap);
    }
    refreshAbilities();
  }

  function refreshAbilities() {
    const cardsEl = document.getElementById('ability-cards');
    if (!cardsEl) return;
    cardsEl.innerHTML = '';
    const abs = Game.abilities || {};
    for (const k in abs) {
      const ab = abs[k];
      const card = document.createElement('div');
      const ready = ab.timer <= 0;
      const canAfford = Game.resource >= ab.cost;
      card.className = 'ab-card' + (!ready || !canAfford ? ' dis' : '');
      card.innerHTML = `
        <span class="ab-k">${ab.key}</span>
        <div class="ab-info">
          <span class="ab-n">${ab.name}</span>
          <span class="ab-c">${ab.cost}</span>
        </div>
        ${!ready ? `<span class="ab-timer">${Math.ceil(ab.timer)}с</span>` : ''}
        <div class="ab-cd-bar" style="width:${ready ? 0 : Math.round((ab.timer / ab.cd) * 100)}%"></div>
      `;
      card.addEventListener('click', () => {
        if (ab.timer > 0) { toast(`${ab.name} на перезарядке (${Math.ceil(ab.timer)}с)`, 'bad'); Sfx.ui('no'); return; }
        if (Game.resource < ab.cost) { toast(`Недостаточно снабжения (нужно ${ab.cost})`, 'bad'); Sfx.ui('no'); return; }
        Input.startAbilityMode(ab.id);
      });
      card.addEventListener('mouseenter', () => showTip(card,
        `<b>${ab.name} [${ab.key}]</b><div style="font-size:10.5px;line-height:1.45;color:var(--ink-dim)">${ab.desc}</div>
         <div class="tt-row" style="margin-top:4px"><span>Стоимость</span><span>${ab.cost}</span></div>
         <div class="tt-row"><span>Перезарядка</span><span>${ab.cd}с</span></div>`));
      card.addEventListener('mouseleave', () => els.tooltip.classList.add('hidden'));
      cardsEl.appendChild(card);
    }
  }

  function showHitmarker(isKill) {
    let hm = document.getElementById('screen-hitmarker');
    if (!hm) {
      hm = document.createElement('div');
      hm.id = 'screen-hitmarker';
      document.body.appendChild(hm);
    }
    hm.className = 'hitmarker-active' + (isKill ? ' kill' : '');
    clearTimeout(hm._t);
    hm._t = setTimeout(() => { hm.className = ''; }, 170);
  }

  function showKillBanner(targetName, bounty) {
    let kb = document.getElementById('kill-banner');
    if (!kb) {
      kb = document.createElement('div');
      kb.id = 'kill-banner';
      document.body.appendChild(kb);
    }
    kb.innerHTML = `<span class="kb-title">ВРАЖЕСКИЙ ОБЪЕКТ УНИЧТОЖЕН</span><span class="kb-name">${targetName.toUpperCase()}</span><span class="kb-bounty">+${bounty} СНАБЖЕНИЯ</span>`;
    kb.classList.add('show');
    clearTimeout(kb._t);
    kb._t = setTimeout(() => { kb.classList.remove('show'); }, 2600);
  }

  // ---------------------------------------------------------
  //  ЛОГ
  // ---------------------------------------------------------
  function log(text, kind) {
    const div = document.createElement('div');
    div.className = 'log-line ' + (kind || '');
    const t = Game.time || 0;
    div.textContent = `${Util.pad2(Math.floor(t / 60))}:${Util.pad2(Math.floor(t % 60))}  ${text}`;
    els.log.appendChild(div);
    logLines.push(div);
    while (logLines.length > 7) {
      const old = logLines.shift();
      if (old.parentNode) old.parentNode.removeChild(old);
    }
    // авто-исчезновение
    setTimeout(() => {
      if (div.parentNode && div.classList) div.style.opacity = '0.45';
    }, 14000);
  }

  function toast(text, kind) {
    const d = document.createElement('div');
    d.className = 'toast-line';
    if (kind === 'bad') d.style.color = 'var(--enemy)';
    d.textContent = text;
    els.toast.appendChild(d);
    setTimeout(() => { d.style.opacity = '0'; d.style.transition = 'opacity .4s'; }, 1800);
    setTimeout(() => { if (d.parentNode) d.parentNode.removeChild(d); }, 2300);
  }

  // ---------------------------------------------------------
  //  ВЕРХНЯЯ ПАНЕЛЬ
  // ---------------------------------------------------------
  let lastRes = -1;
  function updateTop() {
    const r = Math.floor(Game.resource);
    if (r !== lastRes) { els.res.textContent = Util.fmt(r); lastRes = r; }
    els.inc.textContent = `+${Game.income}/с`;
    els.cap.textContent = `${Game.popUsed} / ${Game.popCap}`;
    els.cap.style.color = Game.popUsed >= Game.popCap ? 'var(--enemy)' : '';
    els.clock.textContent = Game.paused ? 'ПАУЗА' : Util.timeStr(Game.time);
    // прогресс задачи: сколько опорных пунктов под контролем и жив ли штаб врага
    const ptsOwned = Game.points.filter(p => p.owner === 'ally').length;
    const hq = Game.buildings.find(b => b.type === 'hq' && b.faction === 'enemy' && !b.dead);
    const hqHp = hq ? hq.hp / hq.maxHp : 0;
    const sub = els.subObjective;
    if (sub) {
      sub.textContent = hq
        ? `Опорные пункты: ${ptsOwned} / ${Game.points.length} · Штаб противника: ${Math.round(hqHp * 100)}%`
        : 'Штаб противника уничтожен';
    }
  }

  // ---------------------------------------------------------
  //  ОПОРНЫЕ ПУНКТЫ
  // ---------------------------------------------------------
  function refreshPoints() {
    let html = '';
    for (const pt of Game.points) {
      const cls = pt.owner === 'ally' ? 'ally' : pt.owner === 'enemy' ? 'enemy' : '';
      const st = pt.owner === 'ally' ? 'НАШ' : pt.owner === 'enemy' ? 'ВРАГ' : 'НЕЙТР.';
      let prog, col;
      if (pt.owner === 'ally') { prog = 100; col = 'var(--ally)'; }
      else if (pt.owner === 'enemy') { prog = 100; col = 'var(--enemy)'; }
      else {
        prog = Math.abs(pt.progress) * 100;
        col = pt.progress >= 0 ? 'var(--ally)' : 'var(--enemy)';
      }
      const extra = pt.contested ? 'БОЙ' : (pt.allyIn || pt.enemyIn) && pt.owner === null ? `${Math.round(prog)}%` : st;
      html += `<div class="pt ${cls}${pt.contested ? ' contested' : ''}" data-id="${pt.id}">
        <span class="nm">${pt.name}</span>
        <span class="bar"><i style="width:${prog.toFixed(0)}%;background:${col}"></i></span>
        <span class="st">${extra}</span>
      </div>`;
    }
    els.points.innerHTML = html;
    els.points.querySelectorAll('.pt').forEach(node => {
      node.addEventListener('click', () => {
        const pt = Game.points.find(p => p.id === node.dataset.id);
        if (pt) Cam.focus(pt.x, pt.z, false);
      });
    });
  }

  // ---------------------------------------------------------
  //  ПАНЕЛЬ ВЫДЕЛЕНИЯ
  // ---------------------------------------------------------
  function refreshSelection() { selDirty = true; }

  function setHover(u) {
    if (!u || u.faction === 'ally' || u.dead) { els.tooltip.classList.add('hidden'); return; }
    const def = u.def || (u.isBuilding ? u.def : null);
    if (!def) return;
    const hpPct = Math.round(u.hp / u.maxHp * 100);
    els.tooltip.innerHTML = `<b>${def.name}</b>
      <div class="tt-row"><span>Прочность</span><span>${Math.max(0, Math.round(u.hp))} / ${u.maxHp}</span></div>
      <div class="tt-row"><span>Броня</span><span>${armorName(u.armor)}</span></div>
      ${u.def && u.def.desc ? `<div style="margin-top:4px;font-size:10.5px;color:var(--ink-faint)">${def.desc}</div>` : ''}`;
    els.tooltip.classList.remove('hidden');
  }

  function armorName(a) {
    return {
      infantry: 'пехота', light: 'лёгкая', heavy: 'тяжёлая',
      air: 'воздух', building: 'строение'
    }[a] || a;
  }

  function buildSelectionPanel() {
    selDirty = false;
    const sel = Game.selection.filter(u => !u.dead);
    const b = Game.selectionBuilding;
    els.selCards.innerHTML = '';
    els.actions.innerHTML = '';
    els.selbar.classList.remove('has-actions');
    els.selbar.classList.remove('has-prod');

    // осмотр врага
    if (!sel.length && !b && Game.inspected && !Game.inspected.dead) {
      const t = Game.inspected;
      els.selTitle.textContent = 'Противник: ' + (t.def ? t.def.name : '');
      els.selSub.textContent = `${armorName(t.armor)} · прочность ${Math.round(t.hp)} / ${t.maxHp}`;
      const card = document.createElement('div');
      card.className = 'u-card';
      card.innerHTML = `<div class="uc-top"><span class="uc-name">${t.def ? t.def.name : ''}</span><span class="uc-hp">${Math.round(t.hp / t.maxHp * 100)}%</span></div>
        <div class="uc-bar"><i style="width:${Math.round(t.hp / t.maxHp * 100)}%;background:var(--enemy)"></i></div>
        <div class="uc-sub"><span>ВРАГ</span><span>${armorName(t.armor)}</span></div>`;
      els.selCards.appendChild(card);
      return;
    }
    Game.inspected = null;

    if (b && !b.dead) {
      buildBuildingPanel(b);
      return;
    }

    if (!sel.length) {
      els.selTitle.textContent = 'Нет выделения';
      els.selSub.textContent = 'ЛКМ — выбрать, ЛКМ+протяжка — рамка, ПКМ — приказ';
      els.selbar.classList.remove('has-actions');
      return;
    }
    els.selbar.classList.add('has-actions');

    // смешанный выбор
    const counts = {};
    for (const u of sel) counts[u.type] = (counts[u.type] || 0) + 1;
    const types = Object.keys(counts);
    if (types.length === 1 && sel.length === 1) {
      const u = sel[0];
      els.selTitle.textContent = u.def.name;
      const st = u.order.kind === 'move' ? 'в пути' : u.order.kind === 'attackmove' ? 'атака с ходу'
        : u.order.kind === 'attack' ? 'атака' : u.order.kind === 'hold' ? 'держит позицию'
          : u.target ? 'ведёт бой' : 'в готовности';
      els.selSub.textContent = `${u.def.tag} · ${st} · прочность ${Math.round(u.hp)} / ${u.maxHp}`;
    } else {
      els.selTitle.textContent = `Группировка: ${sel.length} ед.`;
      els.selSub.textContent = types.map(t => `${UNIT_DEFS[t].name} ×${counts[t]}`).join(' · ');
    }

    // карточки (до 12)
    const shown = sel.slice(0, 12);
    for (const u of shown) {
      const pct = Math.max(0, u.hp / u.maxHp * 100);
      const card = document.createElement('div');
      card.className = 'u-card' + (sel.length === 1 ? ' sel' : '') + (pct < 35 ? ' low' : '');
      const rankBadge = u.veteran >= 2 ? '★★ ' : u.veteran >= 1 ? '★ ' : '';
      card.innerHTML = `<img class="uc-icon" src="${Icons.get(u.def.icon, '#cfe8d6')}" alt="">
        <div class="uc-top"><span class="uc-name">${rankBadge}${shortName(u)}</span><span class="uc-hp">${Math.round(pct)}%</span></div>
        <div class="uc-bar"><i style="width:${pct.toFixed(0)}%"></i></div>
        <div class="uc-sub"><span>${u.veteran >= 2 ? 'АС' : u.veteran >= 1 ? 'ВЕТЕРАН' : u.def.tag.slice(0, 9)}</span><span>${u.target ? 'БОЙ' : u.order.kind === 'idle' ? 'ГОТОВ' : 'ХОД'}</span></div>`;
      card.addEventListener('click', (e) => {
        Game.setSelection(e.shiftKey ? Game.selection.concat([u]) : [u]);
        Sfx.ui('select');
        refreshSelection();
      });
      els.selCards.appendChild(card);
    }
    if (sel.length > 12) {
      const more = document.createElement('div');
      more.className = 'u-card';
      more.style.display = 'flex';
      more.style.alignItems = 'center';
      more.style.justifyContent = 'center';
      more.innerHTML = `<span style="color:var(--ink-faint);font-family:var(--mono);font-size:10px">+${sel.length - 12}</span>`;
      els.selCards.appendChild(more);
    }

    // действия
    addAction('От 1-го лица', 'V', () => {
      if (typeof FPSControl !== 'undefined' && sel.length) {
        FPSControl.enter(sel[0]);
      }
    }, { className: 'act-fps', tip: '<b>Ручной режим от 1-го лица [V]</b>Прямой контроль машины/бойца: WASD — ход, мышь — прицел, ЛКМ — огонь, ПКМ — зум, 1/2 — оружие.' });
    addAction('Стоп', 'S', () => Game.stopAll(), { tip: '<b>Остановить</b>Отменить движение и ожидать приказов.' });
    addAction('Держать', 'H', () => Game.holdAll(), { tip: '<b>Держать позицию</b>Юниты не идут в атаку, но отстреливаются.' });
    addAction('Сбор', 'F', () => Game.toggleStance(), { tip: '<b>Собрать</b>Стянуть группу в одну точку.' });
    addAction('Атака', 'A', () => App.beginAttackMode(), { tip: '<b>Атака по площади</b>Артиллерия и танки бьют по указанной точке.' });
  }

  function shortName(u) {
    // «БМП «Рысь»» -> «БМП», «Мотострелки» -> «Мотострелки»
    const parts = u.def.name.split(' ');
    return parts.length > 1 && parts[0].length <= 4 ? parts[0] : parts[0];
  }

  function addAction(label, key, fn, opts) {
    const btn = document.createElement('button');
    btn.className = 'act' + (opts && opts.className ? ' ' + opts.className : '');
    btn.innerHTML = `${label}<span class="k">${key || ''}</span>${opts && opts.cost !== undefined ? `<span class="cost">${opts.cost}</span>` : ''}`;
    if (opts && opts.disabled) btn.classList.add('dis');
    btn.addEventListener('click', fn);
    if (opts && opts.tip) {
      btn.addEventListener('mouseenter', () => showTip(btn, opts.tip));
      btn.addEventListener('mouseleave', () => els.tooltip.classList.add('hidden'));
    }
    els.actions.appendChild(btn);
    return btn;
  }

  function showTip(el, html) {
    els.tooltip.innerHTML = html;
    els.tooltip.classList.remove('hidden');
    const r = el.getBoundingClientRect();
    els.tooltip.style.left = Math.min(r.left, window.innerWidth - 270) + 'px';
    els.tooltip.style.top = (r.top - 10) + 'px';
  }

  let sellConfirm = null;
  function confirmSell(b) {
    if (sellConfirm === b) {
      const refund = Math.floor((b.def.cost || 0) * 0.6);
      Game.resource += refund;
      b.hp = 0; b.dead = true;
      Game.scene.remove(b.mesh); Game.scene.remove(b.ring);
      Game.removeBuilding(b);
      Game.selectionBuilding = null;
      EffectSafeDust(b.x, b.z);
      toast(`Снято с позиций. Возврат: ${refund}`);
      refreshSelection();
      sellConfirm = null;
    } else {
      sellConfirm = b;
      toast('Нажмите DELETE ещё раз для снятия постройки');
      setTimeout(() => { sellConfirm = null; }, 2500);
    }
  }
  function EffectSafeDust(x, z) { if (typeof Effects !== 'undefined') Effects.dust(x, World.height(x, z), z, 8); }

  function buildBuildingPanel(b) {
    els.selbar.classList.add('has-actions');
    els.selTitle.textContent = b.def.name;
    const q = b.queue[0];
    els.selSub.textContent = `${b.def.tag || 'Постройка'} · прочность ${Math.round(b.hp)} / ${b.maxHp}` +
      (q ? ` · готово через ${Math.max(0, q.t).toFixed(0)} с` : '');

    // карточка постройки
    const card = document.createElement('div');
    const pct = Math.max(0, b.hp / b.maxHp * 100);
    card.className = 'u-card sel' + (pct < 35 ? ' low' : '');
    card.style.width = '150px';
    card.innerHTML = `<img class="uc-icon" src="${Icons.get(b.def.icon, '#e6d7ae')}" style="right:4px;top:4px;width:36px;height:26px" alt="">
      <div class="uc-top"><span class="uc-name">${b.def.name}</span><span class="uc-hp">${Math.round(pct)}%</span></div>
      <div class="uc-bar"><i style="width:${pct.toFixed(0)}%"></i></div>
      <div class="uc-sub"><span>${b.def.income ? '+' + b.def.income + ' снабж.' : ''}</span><span>${b.def.cap ? 'лимит +' + b.def.cap : ''}</span></div>`;
    els.selCards.appendChild(card);

    // очередь
    const queueHtml = document.createElement('div');
    queueHtml.id = 'queue';
    queueHtml.style.cssText = 'display:flex;gap:4px;align-items:center;margin-left:4px';
    if (b.queue.length) {
      let html = '';
      b.queue.forEach((item, i) => {
        html += `<div class="qitem" data-i="${i}" title="Отменить" style="width:34px;height:28px;background:rgba(30,40,33,.9);border:1px solid var(--line);
          display:grid;place-items:center;cursor:pointer;position:relative;overflow:hidden">
          <img src="${Icons.get(UNIT_DEFS[item.type].icon, '#e3be7f')}" style="width:30px;height:20px" alt="">
          <i style="position:absolute;left:0;bottom:0;height:2px;background:var(--ally);width:${((1 - item.t / item.total) * 100).toFixed(0)}%"></i>
        </div>`;
      });
      queueHtml.innerHTML = html;
      queueHtml.querySelectorAll('.qitem').forEach(node => {
        node.addEventListener('click', () => {
          Game.cancelQueue(b, +node.dataset.i);
          refreshSelection();
        });
      });
    }
    els.selCards.appendChild(queueHtml);

    // производство
    if (b.def.builds && b.faction === 'ally') {
      els.selbar.classList.add('has-prod');
      const prod = document.createElement('div');
      prod.className = 'produce';
      prod.style.marginLeft = '10px';
      for (const type of b.def.builds) {
        const def = UNIT_DEFS[type];
        const afford = Game.resource >= def.cost && (Game.popUsed + Game.queuePopAll() + def.pop) <= Game.popCap;
        const pc = document.createElement('div');
        pc.className = 'p-card' + (afford ? '' : ' dis');
        pc.innerHTML = `<img class="pc-icon" src="${Icons.get(def.icon, '#cfe8d6')}" alt="">
          <div class="pc-n">${def.name.split(' ')[0]}</div>
          <div class="pc-d">${def.time}с · ${def.pop} лим.</div>
          <div class="pc-c">${def.cost}</div>`;
        pc.addEventListener('click', () => {
          const res = Game.queueUnit(b, type);
          if (!res.ok) { toast(res.msg, 'bad'); Sfx.ui('no'); } else { toast('В производстве: ' + def.name); }
          refreshSelection();
        });
        pc.addEventListener('mouseenter', () => showTip(pc,
          `<b>${def.name}</b><div style="font-size:10.5px;line-height:1.5;color:var(--ink-dim)">${def.desc}</div>
           <div class="tt-row" style="margin-top:4px"><span>Прочность</span><span>${def.hp}</span></div>
           <div class="tt-row"><span>Броня</span><span>${armorName(def.armor)}</span></div>
           <div class="tt-row"><span>Обзор</span><span>${def.vision}</span></div>`));
        pc.addEventListener('mouseleave', () => els.tooltip.classList.add('hidden'));
        prod.appendChild(pc);
      }
      els.selCards.appendChild(prod);
    }

    // действия (строительство / снятие)
    if (b.faction === 'ally') {
      if (b.def.builds) {
        for (const bt of ['barracks', 'factory', 'depot']) {
          const d = BUILDING_DEFS[bt];
          const can = Game.resource >= d.cost;
          addAction(`${d.name}`, '', () => { Input.startBuildMode(bt); }, {
            cost: d.cost,
            disabled: !can,
            tip: `<b>Развернуть: ${d.name}</b><div style="font-size:10.5px;color:var(--ink-dim)">${d.desc}</div>
              <div class="tt-row" style="margin-top:4px"><span>Стоимость</span><span>${d.cost}</span></div>
              <div class="tt-row"><span>Прочность</span><span>${d.hp}</span></div>`
          });
        }
      }
      if (b.type !== 'hq') addAction('Снять', 'DEL', () => confirmSell(b), { tip: '<b>Снять с позиций</b>Вернуть 60% стоимости. Нажмите дважды.' });
    }
  }

  // ---------------------------------------------------------
  //  МИНИКАРТА
  // ---------------------------------------------------------
  let mmBaseCanvas = null;
  function initMinimap() {
    const base = World.minimapBase;
    mmBaseCanvas = document.createElement('canvas');
    mmBaseCanvas.width = mmBaseCanvas.height = 128;
    const c = mmBaseCanvas.getContext('2d');
    c.drawImage(base, 0, 0, 128, 128);
    mmBase = c;
  }

  function drawMinimap(dt) {
    if (!minimapCtx) return;
    mmT -= dt;
    const S = 256;
    const ctx = minimapCtx;
    const scale = S / World.SIZE;

    // база
    ctx.clearRect(0, 0, S, S);
    if (mmBase) {
      ctx.globalAlpha = 1;
      ctx.drawImage(mmBaseCanvas, 0, 0, S, S);
    }
    // туман (грубый, 4x4 юнита)
    const vis = World.state.fogVisible, exp = World.state.fogExplored;
    const N = World.N;
    const fogC = document.createElement('canvas');
    const step = 4;
    for (let by = 0; by < N; by += step) {
      for (let bx = 0; bx < N; bx += step) {
        let e = 0, v = 0;
        for (let y = 0; y < step; y++) {
          for (let x = 0; x < step; x++) {
            const i = (by + y) * N + (bx + x);
            if (exp[i]) e++;
            if (vis[i]) v++;
          }
        }
        if (!e) {
          ctx.fillStyle = 'rgba(3,6,5,0.90)';
          ctx.fillRect(bx * World.CELL * scale, by * World.CELL * scale, step * World.CELL * scale + 0.5, step * World.CELL * scale + 0.5);
        } else if (!v) {
          ctx.fillStyle = 'rgba(5,9,7,0.45)';
          ctx.fillRect(bx * World.CELL * scale, by * World.CELL * scale, step * World.CELL * scale + 0.5, step * World.CELL * scale + 0.5);
        }
      }
    }

    const w2m = v => (v + World.HALF) * scale;

    // опорные пункты
    for (const pt of Game.points) {
      const x = w2m(pt.x), y = w2m(pt.z);
      const col = pt.owner === 'ally' ? '#79e6b0' : pt.owner === 'enemy' ? '#ff5f45' : '#c9c9a9';
      ctx.strokeStyle = col;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, Math.max(3, pt.r * scale * 1.1), 0, 6.283);
      ctx.stroke();
      ctx.fillStyle = col;
      ctx.globalAlpha = pt.contested ? 0.5 + Math.sin(performance.now() * 0.01) * 0.4 : 0.85;
      ctx.beginPath(); ctx.arc(x, y, 2.2, 0, 6.283); ctx.fill();
      ctx.globalAlpha = 1;
    }

    // постройки
    for (const b of Game.buildings) {
      if (b.dead) continue;
      if (b.faction === 'enemy' && !World.fogExploredAt(b.x, b.z)) continue;
      ctx.fillStyle = b.faction === 'ally' ? '#9fe8c4' : '#ff8a72';
      const s = b.type === 'hq' ? 6 : 4;
      ctx.fillRect(w2m(b.x) - s / 2, w2m(b.z) - s / 2, s, s);
      if (b.type === 'hq') {
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 1;
        ctx.strokeRect(w2m(b.x) - s / 2, w2m(b.z) - s / 2, s, s);
      }
    }

    // юниты
    for (const u of Game.units) {
      if (u.dead) continue;
      if (u.faction === 'enemy' && !World.fogVisibleAt(u.x, u.z)) continue;
      ctx.fillStyle = u.faction === 'ally' ? '#79e6b0' : '#ff5f45';
      const s = u.armor === 'heavy' ? 3.2 : u.armor === 'air' ? 2.2 : 2.4;
      ctx.fillRect(w2m(u.x) - s / 2, w2m(u.z) - s / 2, s, s);
    }

    // выделение
    ctx.strokeStyle = '#e3be7f';
    ctx.lineWidth = 1;
    for (const u of Game.selection) {
      if (u.dead) continue;
      ctx.strokeRect(w2m(u.x) - 2.5, w2m(u.z) - 2.5, 5, 5);
    }

    // рамка камеры
    const rect = Cam.viewRect();
    if (rect) {
      ctx.strokeStyle = 'rgba(227,190,127,0.85)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(w2m(rect[0].x), w2m(rect[0].z));
      for (let i = 1; i < rect.length; i++) ctx.lineTo(w2m(rect[i].x), w2m(rect[i].z));
      ctx.closePath();
      ctx.stroke();
    } else {
      const t = Cam.getTarget();
      ctx.strokeStyle = 'rgba(227,190,127,0.6)';
      ctx.strokeRect(w2m(t.x) - 8, w2m(t.z) - 8, 16, 16);
    }
  }

  // ---------------------------------------------------------
  //  ПАУЗА / СПРАВКА / ИТОГ
  // ---------------------------------------------------------
  function showOverlay(html, kind) {
    els.ovCard.innerHTML = html;
    els.overlay.classList.remove('hidden');
    overlayKind = kind || 'info';
  }
  function closeOverlay() {
    els.overlay.classList.add('hidden');
    overlayKind = null;
    if (Game.running && !Game.gameOver) Game.paused = false;
    updatePauseBtn();
  }

  function updatePauseBtn() {
    els.btnPause.classList.toggle('active', Game.paused);
    els.btnPause.textContent = Game.paused ? '▶' : 'II';
  }

  function showPause() {
    showOverlay(`
      <div class="ov-kicker">Операция приостановлена</div>
      <div class="ov-title">ПАУЗА</div>
      <div class="ov-text">Все процессы остановлены. Снабжение, производство и боевые действия возобновятся после продолжения.</div>
      <div class="ov-btns">
        <button class="ov-btn primary" id="ov-resume">Продолжить</button>
        <button class="ov-btn" id="ov-help">Управление</button>
        <button class="ov-btn" id="ov-restart">Начать заново</button>
      </div>`, 'pause');
    $('ov-resume').onclick = () => closeOverlay();
    $('ov-help').onclick = () => showHelp();
    $('ov-restart').onclick = () => App.restart();
  }

  function showHelp() {
    const wasPaused = Game.paused;
    Game.paused = true;
    updatePauseBtn();
    showOverlay(`
      <div class="ov-kicker">Полевой устав</div>
      <div class="ov-title">УПРАВЛЕНИЕ</div>
      <div class="ov-help">
        <div>
          <h4>Камера</h4>
          <ul>
            <li><b>W A S D</b> панорама (S с Shift — назад)</li>
            <li><b>Стрелки</b> панорама</li>
            <li><b>Колесо</b> приближение</li>
            <li><b>Q / E</b> поворот вида</li>
            <li><b>Space</b> к штабу, <b>Home</b> к центру</li>
            <li><b>Мин.карта</b> ЛКМ — перелёт</li>
          </ul>
          <h4 style="margin-top:12px">Выделение</h4>
          <ul>
            <li><b>ЛКМ</b> выбрать, <b>рамка</b> — группа</li>
            <li><b>Двойной клик</b> все такие на экране</li>
            <li><b>Shift</b> добавить к выделению</li>
            <li><b>Ctrl+1…9</b> назначить группу</li>
          </ul>
          <h4 style="margin-top:12px;color:var(--brass)">Ручной режим (FPS)</h4>
          <ul>
            <li><b>V</b> войти/выйти из режима от 1-го лица</li>
            <li><b>WASD</b> ход шасси / бег пехоты</li>
            <li><b>Мышь</b> наведение орудия и прицел</li>
            <li><b>ЛКМ</b> огонь (автопушка/снаряды/пулемет)</li>
            <li><b>ПКМ</b> снайперский прицел / зум</li>
            <li><b>1 / 2</b> смена оружия</li>
            <li><b>Tab</b> след. союзный юнит</li>
            <li><b>Shift</b> форсаж / ускорение</li>
            <li><b>Z / X / C</b> авиаудар, артобстрел, дым</li>
          </ul>
        </div>
        <div>
          <h4>Приказы</h4>
          <ul>
            <li><b>ПКМ</b> идти / атаковать цель</li>
            <li><b>A + ЛКМ</b> атака по площади</li>
            <li><b>S</b> стоп, <b>H</b> держать позицию</li>
            <li><b>F</b> собрать группу в точку</li>
            <li><b>P</b> пауза, <b>T</b> скорость</li>
            <li><b>M</b> звук, <b>F1</b> справка</li>
          </ul>
          <h4 style="margin-top:12px">Снабжение</h4>
          <ul>
            <li>Опорные пункты дают <b>+3/с</b></li>
            <li>Постройки дают снабжение и лимит</li>
            <li>Захват: пехота и разведка в радиусе</li>
            <li>Уничтожение врагов даёт бонус ресурсов!</li>
          </ul>
        </div>
      </div>
      <div class="ov-btns">
        <button class="ov-btn primary" id="ov-close">Понятно</button>
      </div>`, 'help');
    $('ov-close').onclick = () => {
      els.overlay.classList.add('hidden');
      overlayKind = null;
      if (!Game.gameOver) Game.paused = wasPaused;
      updatePauseBtn();
    };
  }

  function showEnd(win) {
    Game.paused = true;
    const s = Game.stats;
    const t = Util.timeStr(Game.time);
    showOverlay(`
      <div class="ov-kicker">${win ? 'Задача выполнена' : 'Операция провалена'}</div>
      <div class="ov-title ${win ? 'win' : 'lose'}">${win ? 'ПОБЕДА' : 'ПОРАЖЕНИЕ'}</div>
      <div class="ov-text">${win
        ? 'Штаб противника уничтожен, сопротивление сломлено. Северный рубеж под вашим контролем.'
        : 'Штаб группировки пал. Линия обороны прорвана. Операцию необходимо повторить с новым замыслом.'}</div>
      <div class="ov-stats">
        <div class="ov-stat"><div class="k">Время операции</div><div class="v">${t}</div></div>
        <div class="ov-stat"><div class="k">Уничтожено врагов</div><div class="v">${s.kills}</div></div>
        <div class="ov-stat"><div class="k">Потери</div><div class="v">${s.losses}</div></div>
        <div class="ov-stat"><div class="k">Захвачено пунктов</div><div class="v">${s.captured}</div></div>
        <div class="ov-stat"><div class="k">Получено снабжения</div><div class="v">${Util.fmt(s.incomeTotal)}</div></div>
        <div class="ov-stat"><div class="k">Построено объектов</div><div class="v">${s.built}</div></div>
      </div>
      <div class="ov-btns">
        <button class="ov-btn primary" id="ov-again">Новая операция</button>
        <button class="ov-btn" id="ov-menu">В главное меню</button>
      </div>`, 'end');
    $('ov-again').onclick = () => { closeOverlay(); App.restart(); };
    $('ov-menu').onclick = () => { els.overlay.classList.add('hidden'); overlayKind = null; App.showMenu(); };
    Sfx.ui(win ? 'ok' : 'no');
  }

  function setAttackMode(on) {
    const hint = document.getElementById('cursor-hint');
    if (hint) hint.classList.toggle('hidden', !on);
  }

  function updateSoundIcon() {
    if (!els.btnSound) return;
    els.btnSound.classList.toggle('muted', !Sfx.enabled);
    els.btnSound.textContent = Sfx.enabled ? '♪' : '✕';
  }

  let fxCanvas = null, fxCtx = null;
  function initFxCanvas() {
    fxCanvas = document.getElementById('fx');
    if (fxCanvas) {
      fxCanvas.width = window.innerWidth;
      fxCanvas.height = window.innerHeight;
      fxCtx = fxCanvas.getContext('2d');
    }
    window.addEventListener('resize', () => {
      if (fxCanvas) {
        fxCanvas.width = window.innerWidth;
        fxCanvas.height = window.innerHeight;
      }
    });
  }

  function drawTacticalOverlay() {
    if (!fxCtx) return;
    fxCtx.clearRect(0, 0, fxCanvas.width, fxCanvas.height);
    if (typeof FPSControl !== 'undefined' && FPSControl.active) return;
    if (!Game.running || Game.paused) return;

    const now = performance.now() * 0.003;

    // Отрисовка траекторий приказов
    for (const u of Game.selection) {
      if (u.dead) continue;
      let targetX = null, targetZ = null, isAttack = false;

      if (u.order.kind === 'move' || u.order.kind === 'attackmove') {
        targetX = u.order.x; targetZ = u.order.z;
        isAttack = u.order.kind === 'attackmove';
      } else if (u.order.kind === 'attack' && u.order.target && !u.order.target.dead) {
        targetX = u.order.target.x; targetZ = u.order.target.z;
        isAttack = true;
      } else if (u.order.kind === 'ground') {
        targetX = u.order.x; targetZ = u.order.z;
        isAttack = true;
      }

      if (targetX !== null && targetZ !== null) {
        const p1 = Cam.project(u.x, u.centerY ? u.centerY() : u.y + 1, u.z);
        const p2 = Cam.project(targetX, World.height(targetX, targetZ) + 0.5, targetZ);
        if (p1 && p2 && p1.visible && p2.visible) {
          fxCtx.save();
          fxCtx.strokeStyle = isAttack ? 'rgba(255, 95, 69, 0.75)' : 'rgba(121, 230, 176, 0.75)';
          fxCtx.lineWidth = 1.8;
          fxCtx.setLineDash([6, 6]);
          fxCtx.lineDashOffset = -now * 30;
          fxCtx.beginPath();
          fxCtx.moveTo(p1.x, p1.y);
          fxCtx.lineTo(p2.x, p2.y);
          fxCtx.stroke();

          // Пульсирующая конечная точка
          const r = 5 + Math.sin(now * 6) * 1.5;
          fxCtx.fillStyle = isAttack ? 'rgba(255, 95, 69, 0.9)' : 'rgba(121, 230, 176, 0.9)';
          fxCtx.beginPath();
          fxCtx.arc(p2.x, p2.y, r, 0, Math.PI * 2);
          fxCtx.fill();
          fxCtx.restore();
        }
      }
    }

    // Информационные полоски прочности над поврежденными или выделенными юнитами
    for (const u of Game.units) {
      if (u.dead) continue;
      const isDamaged = u.hp < u.maxHp * 0.95;
      const isAlly = u.faction === 'ally';
      if (!isAlly && !World.fogVisibleAt(u.x, u.z)) continue;
      if (!u.selected && !isDamaged && Game.hovered !== u) continue;

      const p = Cam.project(u.x, u.centerY ? u.centerY() + 1.8 : u.y + 3.0, u.z);
      if (!p || !p.visible || p.x < 0 || p.x > window.innerWidth || p.y < 0 || p.y > window.innerHeight) continue;

      const barW = Math.max(26, Math.min(42, 600 / (p.z || 10)));
      const barH = 3;
      const pct = Math.max(0, u.hp / u.maxHp);

      fxCtx.save();
      fxCtx.fillStyle = 'rgba(0, 0, 0, 0.75)';
      fxCtx.fillRect(p.x - barW / 2 - 1, p.y - barH / 2 - 1, barW + 2, barH + 2);
      fxCtx.fillStyle = isAlly ? (pct < 0.35 ? '#ff5f45' : '#79e6b0') : '#ff5f45';
      fxCtx.fillRect(p.x - barW / 2, p.y - barH / 2, barW * pct, barH);

      if (isAlly && u.veteran > 0) {
        fxCtx.font = 'bold 10px Consolas, monospace';
        fxCtx.fillStyle = u.veteran >= 2 ? '#e3be7f' : '#79e6b0';
        fxCtx.textAlign = 'center';
        fxCtx.fillText(u.veteran >= 2 ? '★★' : '★', p.x, p.y - 5);
      }
      fxCtx.restore();
    }
  }

  function update(dt) {
    updateTop();
    if (selDirty) buildSelectionPanel();
    updateDeployPanel();
    refreshAbilities();
    // обновление прогресса очереди без пересборки
    if (!selDirty && Game.selectionBuilding && Game.selectionBuilding.queue.length) {
      const b = Game.selectionBuilding;
      const q = b.queue[0];
      els.selSub.textContent = `${b.def.tag || 'Постройка'} · прочность ${Math.round(b.hp)} / ${b.maxHp} · готово через ${Math.max(0, q.t).toFixed(0)} с`;
      const items = els.selCards.querySelectorAll('.qitem i');
      if (items.length) items[0].style.width = ((1 - q.t / q.total) * 100).toFixed(0) + '%';
    }
    drawMinimap(dt);
    drawTacticalOverlay();
  }

  return {
    init, showHud, log, toast, refreshPoints, refreshSelection, setHover,
    initMinimap, update, showPause, showHelp, showEnd, closeOverlay,
    setAttackMode, updateSoundIcon, updatePauseBtn, confirmSell,
    showHitmarker, showKillBanner, refreshAbilities,
    get overlayKind() { return overlayKind; }
  };
})();