/* ============================================================
   fps.js — Ручное управление юнитами от 1-го лица (FPS / Direct Control)
   ============================================================ */
'use strict';

const FPSControl = (() => {
  let active = false;
  let unit = null;
  let canvas = null;

  // Углы обзора камеры
  let yaw = 0;
  let pitch = 0;
  let recoilPitch = 0;
  let recoilYaw = 0;

  // Оптика и зум
  let zooming = false;
  let currentFov = 42;
  const NORMAL_FOV = 42;
  const ZOOM_FOV_VEHICLE = 15;
  const ZOOM_FOV_INFANTRY = 22;

  // Управление движением
  const keys = {};
  let currentSpeed = 0;
  let bobbingTimer = 0;
  let engineSoundTimer = 0;

  // Оружие
  let activeWeaponIdx = 0;
  let isFiring = false;
  let targetDistance = 0;
  let hoveredTarget = null;

  // HUD оверлей
  let hudEl = null;
  let hudCtx = null;
  let hudCanvas = null;

  // ---------------------------------------------------------
  //  ИНИЦИАЛИЗАЦИЯ
  // ---------------------------------------------------------
  function init(glCanvas) {
    canvas = glCanvas;

    // Создаем HUD холст для эффектов прицеливания и кокпита
    createFpsHud();

    // Слушатели указателя мыши и блокировки
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    document.addEventListener('pointerlockchange', onPointerLockChange);
    document.addEventListener('mozpointerlockchange', onPointerLockChange);
  }

  function createFpsHud() {
    let wrap = document.getElementById('fps-hud');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = 'fps-hud';
      wrap.className = 'hidden';
      wrap.innerHTML = `
        <canvas id="fps-canvas"></canvas>
        <div id="fps-scope" class="hidden">
          <div class="scope-grid"></div>
          <div class="scope-vignette"></div>
          <div class="scope-readout">
            <span class="sr-tag">ОПТИКА 4.5×</span>
            <span id="scope-range" class="sr-val">ДАЛЬНОСТЬ: --- м</span>
          </div>
        </div>
        <div id="fps-damage-vignette"></div>
        <div id="fps-crosshair">
          <div class="ch-bracket ch-tl"></div>
          <div class="ch-bracket ch-tr"></div>
          <div class="ch-bracket ch-bl"></div>
          <div class="ch-bracket ch-br"></div>
          <div class="ch-dot"></div>
          <div id="fps-target-info" class="hidden">
            <span id="target-name">ЦЕЛЬ</span>
            <span id="target-armor">БРОНЯ</span>
            <div id="target-hp-bar"><i></i></div>
          </div>
        </div>
        <div id="fps-compass">
          <div id="compass-tape"></div>
          <div class="compass-pointer">▼</div>
        </div>
        <div id="fps-bottom-bar">
          <div class="fps-panel fps-left">
            <div class="unit-badge">
              <span id="fps-unit-name" class="unit-name">ОБТ «ГРАНИТ»</span>
              <span id="fps-unit-rank" class="unit-rank">★ ВЕТЕРАН</span>
            </div>
            <div class="bar-wrap">
              <span class="bar-lbl">ПРОЧНОСТЬ</span>
              <div class="meter-bar"><i id="fps-hp-bar" style="width:100%"></i></div>
              <span id="fps-hp-num" class="bar-num">480 / 480</span>
            </div>
            <div class="speed-row">
              <span id="fps-speedo" class="speed-val">00</span>
              <span class="speed-unit">КМ/Ч</span>
              <span id="fps-turbo-badge" class="turbo-badge">ТУРБО ГОТОВО [SHIFT]</span>
            </div>
          </div>

          <div class="fps-panel fps-mid">
            <div id="fps-hull-widget" title="Ориентация корпуса и башни">
              <div id="hull-icon"></div>
              <div id="turret-icon"></div>
            </div>
            <div class="fps-hints">
              <span>[WASD] Ход</span> · <span>[SHIFT] Ускорение</span> · <span>[ЛКМ] Огонь</span> · <span>[ПКМ] Прицел</span><br>
              <span>[1/2] Оружие</span> · <span>[Z/X/C] Поддержка</span> · <span>[TAB] След. юнит</span> · <b style="color:var(--brass)">[V] / [ESC] ВЫХОД В ШТАБ</b>
            </div>
          </div>

          <div class="fps-panel fps-right">
            <div class="weapon-box" id="weapon-box-0">
              <span class="w-key">1</span>
              <div class="w-info">
                <span id="w0-name" class="w-name">ОСНОВНОЕ</span>
                <span id="w0-status" class="w-status">ГОТОВО</span>
              </div>
              <div class="w-reload-bar"><i id="w0-bar"></i></div>
            </div>
            <div class="weapon-box" id="weapon-box-1">
              <span class="w-key">2</span>
              <div class="w-info">
                <span id="w1-name" class="w-name">ДОПОЛНИТЕЛЬНОЕ</span>
                <span id="w1-status" class="w-status">ГОТОВО</span>
              </div>
              <div class="w-reload-bar"><i id="w1-bar"></i></div>
            </div>
          </div>
        </div>
      `;
      document.body.appendChild(wrap);
    }

    hudEl = wrap;
    hudCanvas = document.getElementById('fps-canvas');
    if (hudCanvas) {
      hudCanvas.width = window.innerWidth;
      hudCanvas.height = window.innerHeight;
      hudCtx = hudCanvas.getContext('2d');
    }

    window.addEventListener('resize', () => {
      if (hudCanvas) {
        hudCanvas.width = window.innerWidth;
        hudCanvas.height = window.innerHeight;
      }
    });
  }

  // ---------------------------------------------------------
  //  ВХОД И ВЫХОД ИЗ РЕЖИМА
  // ---------------------------------------------------------
  function enter(targetUnit) {
    if (!targetUnit || targetUnit.dead || targetUnit.faction !== 'ally') {
      // Если юнит не выбран, ищем ближайший союзный боевой юнит
      const cands = Game.units.filter(u => u.faction === 'ally' && !u.dead);
      if (!cands.length) {
        UI.toast('Нет доступных союзных боевых юнитов для управления', 'bad');
        return false;
      }
      targetUnit = cands[0];
    }

    unit = targetUnit;
    active = true;
    yaw = unit.turret ? unit.turretAngle : unit.angle;
    pitch = 0;
    recoilPitch = 0;
    recoilYaw = 0;
    currentSpeed = 0;
    zooming = false;
    currentFov = NORMAL_FOV;
    activeWeaponIdx = 0;

    // Останавливаем старые ИИ-приказы на юните
    unit.stop();

    // Захватываем курсор мыши (безопасно для тестов и браузерных ограничений)
    if (canvas && canvas.requestPointerLock) {
      try {
        const pr = canvas.requestPointerLock();
        if (pr && typeof pr.catch === 'function') pr.catch(() => {});
      } catch (e) {}
    }

    // Переключаем камеру
    Cam.setFPS(true);

    // Включаем интерфейс от первого лица
    if (hudEl) hudEl.classList.remove('hidden');
    const menuEl = document.getElementById('menu');
    if (menuEl) menuEl.style.display = 'none';
    UI.showHud(false); // Скрываем RTS панели, оставляем верхнюю полосу ресурсов

    updateWeaponCardNames();
    Sfx.ui('ok');
    Sfx.opticZoom(true);
    UI.toast(`[РУЧНОЙ РЕЖИМ] Боевая машина: ${unit.def.name}. [V] или [ESC] — возврат в штаб.`, 'info');

    return true;
  }

  function exit() {
    if (!active) return;
    active = false;
    zooming = false;

    if (document.exitPointerLock) {
      try { document.exitPointerLock(); } catch (e) {}
    }

    Cam.setFPS(false);

    // Восстанавливаем нормальный FOV камеры
    const cam = Cam.camera;
    if (cam) {
      cam.fov = 42;
      cam.updateProjectionMatrix();
    }

    if (hudEl) hudEl.classList.add('hidden');
    UI.showHud(true);

    // Фокусируем RTS камеру на месте, где остался юнит
    if (unit && !unit.dead) {
      Cam.focus(unit.x, unit.z, true);
      Game.setSelection([unit]);
      UI.refreshSelection();
    }

    Sfx.ui('select');
    UI.toast('Возврат к общему тактическому командованию', 'info');
    unit = null;
  }

  function toggle(targetUnit) {
    if (active) exit();
    else enter(targetUnit || (Game.selection.length ? Game.selection[0] : null));
  }

  function onUnitDestroyed() {
    if (!active) return;
    Cam.shake(2.2);
    Sfx.explosion(unit.x, unit.z, 2.0);
    UI.toast('ВАША БОЕВАЯ МАШИНА УНИЧТОЖЕНА!', 'bad');
    exit();
  }

  function cycleUnit(dir = 1) {
    if (!active) return;
    const allies = Game.units.filter(u => u.faction === 'ally' && !u.dead);
    if (!allies.length) { exit(); return; }
    let idx = allies.indexOf(unit);
    if (idx < 0) idx = 0;
    else idx = (idx + dir + allies.length) % allies.length;
    unit = allies[idx];
    yaw = unit.turret ? unit.turretAngle : unit.angle;
    pitch = 0;
    updateWeaponCardNames();
    Sfx.ui('select');
    UI.toast(`Управление переключено: ${unit.def.name}`, 'info');
  }

  // ---------------------------------------------------------
  //  ОБРАБОТКА МЫШИ И БЛОКИРОВКИ
  // ---------------------------------------------------------
  function onPointerLockChange() {
    const locked = document.pointerLockElement === canvas || document.mozPointerLockElement === canvas;
    if (!locked && active) {
      // Игрок нажал ESC или свернул окно — мягко выходим
      exit();
    }
  }

  function onMouseMove(e) {
    if (!active) return;
    const isLocked = document.pointerLockElement === canvas || document.mozPointerLockElement === canvas;
    if (!isLocked) return;

    const sens = 0.0022 * (zooming ? 0.38 : 1.0);
    yaw -= e.movementX * sens;
    pitch -= e.movementY * sens;

    // Ограничиваем угол наклона взгляда по вертикали
    const isInf = unit && unit.def && unit.def.model === 'infantry';
    const minP = isInf ? -0.7 : -0.32;
    const maxP = isInf ? 1.05 : 0.65;
    pitch = Util.clamp(pitch, minP, maxP);

    // Нормализация yaw в [-PI, PI]
    while (yaw > Math.PI) yaw -= Math.PI * 2;
    while (yaw < -Math.PI) yaw += Math.PI * 2;
  }

  function onMouseDown(e) {
    if (!active) return;
    if (e.button === 0) {
      // ЛКМ — огонь
      isFiring = true;
      fireActiveWeapon();
    } else if (e.button === 2) {
      // ПКМ — оптический прицел / зум
      e.preventDefault();
      setZoom(!zooming);
    }
  }

  function onMouseUp(e) {
    if (!active) return;
    if (e.button === 0) isFiring = false;
  }

  function setZoom(v) {
    zooming = v;
    const scopeEl = document.getElementById('fps-scope');
    if (scopeEl) scopeEl.classList.toggle('hidden', !zooming);
    Sfx.opticZoom(zooming);
  }

  // ---------------------------------------------------------
  //  ОБРАБОТКА КЛАВИШ
  // ---------------------------------------------------------
  function onKeyDown(e) {
    const k = e.key.toLowerCase();
    keys[k] = true;

    // Горячая клавиша входа/выхода в режим от 1-го лица
    if (k === 'v') {
      toggle(Game.selection.length ? Game.selection[0] : null);
      e.preventDefault();
      return;
    }

    if (!active) return;

    if (k === 'escape') {
      exit();
      e.preventDefault();
      return;
    }

    if (k === 'tab') {
      cycleUnit(e.shiftKey ? -1 : 1);
      e.preventDefault();
      return;
    }

    // Переключение оружия клавишами 1 и 2
    if (k === '1') { selectWeapon(0); e.preventDefault(); }
    if (k === '2') { selectWeapon(1); e.preventDefault(); }

    // Тактическая поддержка прямо из кабины
    if (k === 'z') { triggerCommanderAbility('airstrike'); e.preventDefault(); }
    if (k === 'x') { triggerCommanderAbility('barrage'); e.preventDefault(); }
    if (k === 'c') { triggerCommanderAbility('smoke'); e.preventDefault(); }
  }

  function onKeyUp(e) {
    const k = e.key.toLowerCase();
    keys[k] = false;
  }

  function selectWeapon(idx) {
    if (!unit || !unit.def.weapons || !unit.def.weapons[idx]) return;
    activeWeaponIdx = idx;
    Sfx.ui('select');
    updateWeaponCards();
  }

  // ---------------------------------------------------------
  //  СТРЕЛЬБА В РУЧНОМ РЕЖИМЕ
  // ---------------------------------------------------------
  const raycaster = new THREE.Raycaster();
  const screenCenter = new THREE.Vector2(0, 0);

  function getAimPoint() {
    const cam = Cam.camera;
    if (!cam) return null;
    raycaster.setFromCamera(screenCenter, cam);

    // Проверяем попадание луча в террейн
    const groundHit = World.pickTerrain(raycaster.ray.origin, raycaster.ray.direction, 700);

    // Проверяем прямое попадание луча в юниты врага
    let bestDist = groundHit ? Math.hypot(groundHit.x - raycaster.ray.origin.x, groundHit.z - raycaster.ray.origin.z) : 600;
    let hitTarget = null;
    let hitPos = groundHit || raycaster.ray.origin.clone().addScaledVector(raycaster.ray.direction, 300);

    for (const u of Game.units) {
      if (u.dead || u.faction === 'ally') continue;
      const cy = u.centerY();
      const uPos = new THREE.Vector3(u.x, cy, u.z);
      const distToRay = raycaster.ray.distanceToPoint(uPos);
      if (distToRay < u.radius * 1.35) {
        const d = raycaster.ray.origin.distanceTo(uPos);
        if (d < bestDist) {
          bestDist = d;
          hitTarget = u;
          hitPos = { x: u.x, y: cy, z: u.z };
        }
      }
    }

    // Проверяем постройки
    for (const b of Game.buildings) {
      if (b.dead || b.faction === 'ally') continue;
      const bPos = new THREE.Vector3(b.x, b.y + 3, b.z);
      const distToRay = raycaster.ray.distanceToPoint(bPos);
      if (distToRay < b.radius * 1.1) {
        const d = raycaster.ray.origin.distanceTo(bPos);
        if (d < bestDist) {
          bestDist = d;
          hitTarget = b;
          hitPos = { x: b.x, y: b.y + 2.5, z: b.z };
        }
      }
    }

    return { pos: hitPos, target: hitTarget, dist: bestDist };
  }

  function fireActiveWeapon() {
    if (!active || !unit || unit.dead) return;
    const w = unit.def.weapons[activeWeaponIdx];
    if (!w) return;

    const aim = getAimPoint();
    if (!aim) return;

    const ok = unit.fireDirect(activeWeaponIdx, aim.pos, aim.target, Game);
    if (ok) {
      // Добавляем импульс отдачи на камеру
      const recoilMult = w.type === 'shell' ? 0.055 : w.type === 'artillery' ? 0.09 : 0.016;
      recoilPitch += recoilMult;
      recoilYaw += (Math.random() - 0.5) * recoilMult * 0.45;

      // Тряска камеры при мощных выстрелах
      if (w.type === 'shell' || w.type === 'artillery') {
        Cam.shake(0.35);
      }
    }
  }

  // ---------------------------------------------------------
  //  ПОДДЕРЖКА СТАВКИ ИЗ КАБИНЫ
  // ---------------------------------------------------------
  function triggerCommanderAbility(abilityId) {
    const aim = getAimPoint();
    if (!aim || !aim.pos) return;
    if (typeof Game.triggerAbility === 'function') {
      Game.triggerAbility(abilityId, aim.pos.x, aim.pos.z);
    }
  }

  // ---------------------------------------------------------
  //  ОСНОВНОЙ КАДРОВЫЙ ЦИКЛ ОБНОВЛЕНИЯ
  // ---------------------------------------------------------
  function update(dt) {
    if (!active || !unit || unit.dead) return;

    // 1. Плавный откат отдачи
    recoilPitch *= Math.exp(-dt * 14);
    recoilYaw *= Math.exp(-dt * 14);

    // 2. Управление движением машины / пехоты
    updateMovement(dt);

    // 3. Непрерывный огонь при удержании ЛКМ
    if (isFiring) {
      fireActiveWeapon();
    }

    // 4. Позиционирование камеры и направление взгляда
    updateCamera(dt);

    // 5. Определение дистанции и цели под прицелом
    const aim = getAimPoint();
    if (aim) {
      targetDistance = Math.round(aim.dist);
      hoveredTarget = aim.target;
    }

    // 6. Отрисовка HUD кокпита
    updateHud(dt);
  }

  function updateMovement(dt) {
    const def = unit.def;
    const isInf = def.model === 'infantry';
    const isVehicle = !isInf && def.armor !== 'air';

    // Ввод движения
    let fwd = 0;
    if (keys['w'] || keys['ц'] || keys['arrowup']) fwd += 1;
    if (keys['s'] || keys['ы'] || keys['arrowdown']) fwd -= 1;

    let strafe = 0;
    if (keys['a'] || keys['ф'] || keys['arrowleft']) strafe -= 1;
    if (keys['d'] || keys['в'] || keys['arrowright']) strafe += 1;

    const turbo = (keys['shift'] || keys['sprint']) ? 1.4 : 1.0;
    const maxSpd = unit.speed * turbo;

    if (isVehicle) {
      // Танковая модель: A/D поворачивают корпус машины
      const turnRate = (def.turn || 2.4) * (turbo > 1 ? 1.25 : 1.0);
      if (strafe !== 0) {
        unit.angle += -strafe * turnRate * dt;
      }

      // Плавное ускорение и инерция
      const accel = fwd !== 0 ? 8.0 : 12.0;
      const targetSpd = fwd * (fwd > 0 ? maxSpd : maxSpd * 0.45);
      currentSpeed = Util.lerp(currentSpeed, targetSpd, Math.min(1, dt * accel));

      if (Math.abs(currentSpeed) > 0.05) {
        const vx = Math.sin(unit.angle) * currentSpeed;
        const vz = Math.cos(unit.angle) * currentSpeed;
        unit._move(dt, vx, vz);

        // Форсажные эффекты
        if (turbo > 1 && Math.random() < 0.35) {
          Effects.dust(unit.x - Math.sin(unit.angle) * 2.5, unit.y, unit.z - Math.cos(unit.angle) * 2.5, 1);
        }
      }

      // Башня следует за направлением прицела (yaw)
      if (unit.turret) {
        unit.turretAngle = Util.angleLerp(unit.turretAngle, yaw, Math.min(1, dt * 16));
      } else {
        unit.angle = Util.angleLerp(unit.angle, yaw, Math.min(1, dt * 8));
      }

    } else if (isInf) {
      // Пехотная модель: свободное движение во всех направлениях относительно камеры
      unit.angle = yaw;
      const spd = (Math.hypot(fwd, strafe) > 0 ? maxSpd : 0);
      currentSpeed = Util.lerp(currentSpeed, spd, Math.min(1, dt * 14));

      if (spd > 0) {
        const moveAng = yaw + Math.atan2(strafe, fwd);
        const vx = Math.sin(moveAng) * currentSpeed;
        const vz = Math.cos(moveAng) * currentSpeed;
        unit._move(dt, vx, vz);
        bobbingTimer += dt * (turbo > 1 ? 14 : 9);
      }
    } else {
      // Дрон / Авиация
      unit.angle = yaw;
      const spd = maxSpd * (fwd !== 0 ? (fwd > 0 ? 1 : 0.5) : 0.8);
      currentSpeed = Util.lerp(currentSpeed, spd, Math.min(1, dt * 10));
      const vx = Math.sin(yaw) * currentSpeed;
      const vz = Math.cos(yaw) * currentSpeed;
      unit._move(dt, vx, vz);
    }
  }

  function updateCamera(dt) {
    const cam = Cam.camera;
    if (!cam) return;

    // Плавное приближение зума (FOV)
    const targetFov = zooming ? (unit.def.model === 'infantry' ? ZOOM_FOV_INFANTRY : ZOOM_FOV_VEHICLE) : NORMAL_FOV;
    currentFov = Util.lerp(currentFov, targetFov, Math.min(1, dt * 14));
    cam.fov = currentFov;
    cam.updateProjectionMatrix();

    // Расчет точки сокета камеры
    const isInf = unit.def.model === 'infantry';
    const isAir = unit.isAir;

    let eyeY = unit.y;
    let camX = unit.x;
    let camZ = unit.z;

    if (isInf) {
      eyeY += 1.45 + (currentSpeed > 0.5 ? Math.sin(bobbingTimer) * 0.05 : 0);
    } else if (isAir) {
      eyeY += (unit.def.fly || 15) - 0.2;
    } else {
      // Бронетехника: позиция командира / наводчика
      const turretAng = unit.turret ? unit.turretAngle : unit.angle;
      const forwardOffset = unit.type === 'tank' ? 0.3 : 0.2;
      const sideOffset = unit.type === 'tank' ? 0.45 : 0;
      eyeY += (unit.type === 'tank' ? 2.35 : 2.15);
      camX += Math.sin(turretAng) * forwardOffset - Math.cos(turretAng) * sideOffset;
      camZ += Math.cos(turretAng) * forwardOffset + Math.sin(turretAng) * sideOffset;
    }

    cam.position.set(camX, eyeY, camZ);

    // Направление взгляда с учетом отдачи
    const finalYaw = yaw + recoilYaw;
    const finalPitch = pitch + recoilPitch;

    const lookDist = 100;
    const lx = camX + Math.sin(finalYaw) * Math.cos(finalPitch) * lookDist;
    const ly = eyeY + Math.sin(finalPitch) * lookDist;
    const lz = camZ + Math.cos(finalYaw) * Math.cos(finalPitch) * lookDist;

    cam.lookAt(lx, ly, lz);
    cam.updateMatrixWorld();
  }

  // ---------------------------------------------------------
  //  ОБНОВЛЕНИЕ ИНТЕРФЕЙСА (HUD)
  // ---------------------------------------------------------
  function updateWeaponCardNames() {
    if (!unit) return;
    const w0 = unit.def.weapons[0];
    const w1 = unit.def.weapons[1];

    const w0NameEl = document.getElementById('w0-name');
    const w1NameEl = document.getElementById('w1-name');
    const w1Box = document.getElementById('weapon-box-1');

    if (w0NameEl) w0NameEl.textContent = w0 ? (w0.name || w0.type.toUpperCase()) : '---';
    if (w1NameEl) w1NameEl.textContent = w1 ? (w1.name || w1.type.toUpperCase()) : '---';
    if (w1Box) w1Box.style.display = w1 ? 'flex' : 'none';

    const unitNameEl = document.getElementById('fps-unit-name');
    const unitRankEl = document.getElementById('fps-unit-rank');
    if (unitNameEl) unitNameEl.textContent = unit.def.name.toUpperCase();
    if (unitRankEl) {
      unitRankEl.textContent = unit.veteran >= 2 ? '★★ АС' : unit.veteran >= 1 ? '★ ВЕТЕРАН' : 'НОВОБРАНЕЦ';
      unitRankEl.style.color = unit.veteran >= 2 ? 'var(--brass)' : unit.veteran >= 1 ? 'var(--ally)' : 'var(--ink-dim)';
    }

    updateWeaponCards();
  }

  function updateWeaponCards() {
    const b0 = document.getElementById('weapon-box-0');
    const b1 = document.getElementById('weapon-box-1');
    if (b0) b0.classList.toggle('active', activeWeaponIdx === 0);
    if (b1) b1.classList.toggle('active', activeWeaponIdx === 1);
  }

  function updateHud(dt) {
    if (!hudEl || !unit) return;

    // 1. Прочность юнита
    const hpPct = Math.max(0, unit.hp / unit.maxHp * 100);
    const hpBar = document.getElementById('fps-hp-bar');
    const hpNum = document.getElementById('fps-hp-num');
    if (hpBar) {
      hpBar.style.width = hpPct.toFixed(0) + '%';
      hpBar.style.background = hpPct < 30 ? 'var(--enemy)' : hpPct < 60 ? 'var(--brass)' : 'var(--ally)';
    }
    if (hpNum) hpNum.textContent = `${Math.round(unit.hp)} / ${unit.maxHp}`;

    // 2. Спидометр
    const speedo = document.getElementById('fps-speedo');
    if (speedo) {
      const kmh = Math.abs(Math.round(currentSpeed * 3.6));
      speedo.textContent = (kmh < 10 ? '0' : '') + kmh;
    }

    // 3. Статус перезарядки оружия
    for (let i = 0; i < 2; i++) {
      const w = unit.def.weapons[i];
      if (!w) continue;
      const cd = unit.cooldowns[i];
      const maxCd = w.cd * (unit.veteran >= 2 ? 0.7 : unit.veteran >= 1 ? 0.85 : 1.0);
      const isReady = cd <= 0;
      const pct = isReady ? 100 : Math.max(0, (1 - cd / maxCd) * 100);

      const bar = document.getElementById(`w${i}-bar`);
      const st = document.getElementById(`w${i}-status`);
      if (bar) bar.style.width = pct.toFixed(0) + '%';
      if (st) {
        st.textContent = isReady ? 'ГОТОВО' : `${cd.toFixed(1)}с`;
        st.style.color = isReady ? 'var(--ally)' : 'var(--brass)';
      }
    }

    // 4. Компас
    const tape = document.getElementById('compass-tape');
    if (tape) {
      // Сдвигаем ленту компаса в зависимости от угла yaw
      const deg = Math.round(((yaw % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2)) * 180 / Math.PI);
      tape.textContent = `${deg}°  С   •   СВ   •   В   •   ЮВ   •   Ю   •   ЮЗ   •   З   •   СЗ   •   ${deg}°`;
    }

    // 5. Виджет ориентации башни и корпуса
    const turretIcon = document.getElementById('turret-icon');
    if (turretIcon) {
      const relTurret = unit.turret ? (unit.turretAngle - unit.angle) : 0;
      turretIcon.style.transform = `rotate(${Math.round(relTurret * 180 / Math.PI)}deg)`;
    }

    // 6. Дальномер и статус цели под перекрестием
    const scopeRange = document.getElementById('scope-range');
    if (scopeRange) {
      scopeRange.textContent = `ДАЛЬНОСТЬ: ${targetDistance > 0 ? targetDistance : '---'} м`;
    }

    const targetInfoEl = document.getElementById('fps-target-info');
    const chEl = document.getElementById('fps-crosshair');
    if (hoveredTarget && !hoveredTarget.dead) {
      if (chEl) chEl.classList.add('enemy-lock');
      if (targetInfoEl) {
        targetInfoEl.classList.remove('hidden');
        const tName = document.getElementById('target-name');
        const tArmor = document.getElementById('target-armor');
        const tBar = targetInfoEl.querySelector('#target-hp-bar i');
        if (tName) tName.textContent = hoveredTarget.def ? hoveredTarget.def.name : 'ЦЕЛЬ';
        if (tArmor) tArmor.textContent = `${Math.round(hoveredTarget.hp)} HP • ${targetDistance}м`;
        if (tBar) tBar.style.width = Math.round(hoveredTarget.hp / hoveredTarget.maxHp * 100) + '%';
      }
    } else {
      if (chEl) chEl.classList.remove('enemy-lock');
      if (targetInfoEl) targetInfoEl.classList.add('hidden');
    }

    // 7. Красная виньетка при критическом здоровье
    const dmgVignette = document.getElementById('fps-damage-vignette');
    if (dmgVignette) {
      dmgVignette.style.opacity = hpPct < 30 ? (0.45 + Math.sin(performance.now() * 0.008) * 0.25) : 0;
    }
  }

  return {
    init, enter, exit, toggle, update, onUnitDestroyed, cycleUnit,
    get active() { return active; },
    get unit() { return unit; },
    get isZooming() { return zooming; }
  };
})();

window.FPSControl = FPSControl;
