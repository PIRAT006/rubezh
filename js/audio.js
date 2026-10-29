/* ============================================================
   audio.js — процедурный звук (WebAudio), без внешних файлов
   ============================================================ */
'use strict';

const Sfx = (() => {
  let ctx = null, master = null, comp = null, noiseBuf = null;
  let enabled = true, started = false;
  let listener = { x: 0, z: 0 };
  let activeVoices = 0;
  const MAX_VOICES = 26;
  let lastShotTime = 0;

  function init() {
    if (ctx) return;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -18;
      comp.knee.value = 22;
      comp.ratio.value = 8;
      comp.attack.value = 0.003;
      comp.release.value = 0.22;
      master = ctx.createGain();
      master.gain.value = 0.55;
      master.connect(comp);
      comp.connect(ctx.destination);

      // буфер белого шума
      const len = ctx.sampleRate * 2;
      noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      started = true;
    } catch (e) {
      console.warn('audio init failed', e);
    }
  }

  function resume() {
    if (!ctx) init();
    if (ctx && ctx.state === 'suspended') ctx.resume();
  }

  function setListener(x, z) { listener.x = x; listener.z = z; }

  // громкость от расстояния до камеры
  function atten(x, z, near = 26, far = 150) {
    const d = Math.hypot(x - listener.x, z - listener.z);
    if (d > far) return 0;
    const t = Util.clamp((d - near) / (far - near), 0, 1);
    return Math.pow(1 - t, 1.6);
  }

  function noise(dur, gain, filterType, f0, f1, pan = 0, delay = 0, q = 1) {
    if (!ctx || !enabled) return;
    if (activeVoices > MAX_VOICES) return;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    src.playbackRate.value = Util.rnd(0.85, 1.15);
    const flt = ctx.createBiquadFilter();
    flt.type = filterType;
    flt.frequency.setValueAtTime(f0, t);
    flt.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t + dur);
    flt.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + Math.min(0.012, dur * 0.25));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const p = ctx.createStereoPanner();
    p.pan.value = Util.clamp(pan, -1, 1);
    src.connect(flt); flt.connect(g); g.connect(p); p.connect(master);
    src.start(t); src.stop(t + dur + 0.05);
    activeVoices++;
    src.onended = () => { activeVoices--; try { src.disconnect(); } catch (e) { } };
  }

  function tone(dur, gain, f0, f1, type = 'sine', pan = 0, delay = 0) {
    if (!ctx || !enabled) return;
    if (activeVoices > MAX_VOICES) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + Math.min(0.008, dur * 0.3));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const p = ctx.createStereoPanner();
    p.pan.value = Util.clamp(pan, -1, 1);
    o.connect(g); g.connect(p); p.connect(master);
    o.start(t); o.stop(t + dur + 0.05);
    activeVoices++;
    o.onended = () => { activeVoices--; try { o.disconnect(); } catch (e) { } };
  }

  function pan2d(x) { return Util.clamp((x - listener.x) / 70, -1, 1); }

  // ---------- конкретные звуки ----------
  function rifle(x, z) {
    const a = atten(x, z, 18, 110);
    if (a < 0.02) return;
    const p = pan2d(x);
    noise(0.075, 0.16 * a, 'bandpass', 2100, 700, p, 0, 0.8);
    tone(0.055, 0.06 * a, 240, 90, 'square', p);
  }
  function heavyGun(x, z) {
    const a = atten(x, z, 22, 140);
    if (a < 0.02) return;
    const p = pan2d(x);
    noise(0.24, 0.3 * a, 'lowpass', 1400, 180, p, 0, 1.4);
    tone(0.2, 0.22 * a, 120, 42, 'triangle', p);
  }
  function cannon(x, z) {
    const a = atten(x, z, 30, 190);
    if (a < 0.02) return;
    const p = pan2d(x);
    noise(0.5, 0.42 * a, 'lowpass', 900, 90, p, 0, 1.2);
    tone(0.42, 0.34 * a, 150, 34, 'sawtooth', p);
  }
  function explosion(x, z, scale = 1) {
    const a = atten(x, z, 34, 220);
    if (a < 0.02) return;
    const p = pan2d(x);
    const d = Util.clamp(scale, 0.6, 2.4);
    noise(0.6 * d, 0.34 * a * Math.min(1.5, d), 'lowpass', 700, 55, p, 0, 0.9);
    tone(0.5 * d, 0.3 * a, 90, 26, 'sine', p);
    if (d > 1.2) noise(1.1, 0.13 * a, 'lowpass', 320, 40, p, 0.1, 0.6);
  }
  function distantExplosion(x, z) {
    const a = atten(x, z, 60, 300);
    if (a < 0.02) return;
    noise(0.9, 0.1 * a, 'lowpass', 400, 50, pan2d(x));
  }
  function click() {
    tone(0.03, 0.05, 1500, 900, 'square', 0);
  }
  function ui(kind = 'ok') {
    if (kind === 'ok') { tone(0.07, 0.05, 900, 1300, 'sine'); }
    else if (kind === 'no') { tone(0.14, 0.06, 260, 160, 'sawtooth'); }
    else if (kind === 'select') { tone(0.045, 0.04, 1250, 1700, 'sine'); }
    else if (kind === 'build') { tone(0.12, 0.06, 420, 880, 'triangle'); }
    else if (kind === 'alarm') {
      tone(0.4, 0.09, 720, 620, 'sine'); tone(0.4, 0.09, 720, 620, 'sine', 0, 0.5);
    }
  }
  function moveOrder(x, z) {
    const p = pan2d(x);
    tone(0.09, 0.045, 640, 480, 'sine', p);
  }
  function attackOrder(x, z) {
    const p = pan2d(x);
    tone(0.07, 0.05, 300, 220, 'square', p);
    tone(0.12, 0.04, 760, 560, 'sawtooth', p, 0.05);
  }
  function launch(x, z) {
    const a = atten(x, z, 40, 220);
    if (a < 0.02) return;
    const p = pan2d(x);
    noise(0.55, 0.2 * a, 'bandpass', 800, 2600, p, 0, 1.2);
    tone(0.3, 0.1 * a, 220, 640, 'sawtooth', p);
  }
  function capture(x, z, good) {
    const p = pan2d(x);
    if (good) {
      tone(0.18, 0.06, 520, 780, 'sine', p);
      tone(0.3, 0.05, 780, 1040, 'sine', p, 0.14);
    } else {
      tone(0.2, 0.06, 480, 300, 'sine', p);
      tone(0.3, 0.05, 300, 200, 'sine', p, 0.15);
    }
  }
  function siren(x, z) {
    const p = pan2d(x);
    for (let i = 0; i < 3; i++) tone(0.3, 0.05, 600 + i * 90, 500 + i * 90, 'sine', p, i * 0.34);
  }
  function hitmarker(isKill) {
    if (!ctx || !enabled) return;
    if (isKill) {
      // Сочный металлический звук уничтожения цели
      tone(0.12, 0.18, 180, 50, 'sawtooth');
      tone(0.08, 0.15, 600, 240, 'triangle', 0, 0.02);
      noise(0.08, 0.14, 'highpass', 1200, 600, 0, 0, 1.2);
    } else {
      // Четкий тактический тик попадания (как в современных шутерах)
      tone(0.035, 0.12, 2800, 3600, 'sine');
      noise(0.025, 0.08, 'bandpass', 3200, 1800, 0, 0, 2.0);
    }
  }

  function coaxialMG(x, z) {
    const a = atten(x, z, 20, 130);
    if (a < 0.02) return;
    const p = pan2d(x);
    noise(0.065, 0.22 * a, 'bandpass', 2400, 800, p, 0, 0.9);
    tone(0.045, 0.12 * a, 320, 110, 'square', p);
  }

  function jetFlyby(x, z) {
    if (!ctx || !enabled) return;
    const p = pan2d(x);
    // Нарастающий и спадающий рев реактивной турбины с эффектом Доплера
    noise(1.8, 0.35, 'bandpass', 350, 1600, p, 0, 1.1);
    tone(1.6, 0.18, 220, 480, 'sawtooth', p, 0.1);
    noise(2.2, 0.25, 'lowpass', 1200, 200, p, 0.4, 0.8);
  }

  function ricochet(x, z) {
    const a = atten(x, z, 20, 120);
    if (a < 0.02) return;
    const p = pan2d(x);
    tone(0.16, 0.15 * a, 1400, 4800, 'sine', p);
    noise(0.05, 0.08 * a, 'highpass', 2200, 3500, p, 0, 2.0);
  }

  function opticZoom(inOut) {
    if (!ctx || !enabled) return;
    tone(0.06, 0.07, inOut ? 420 : 680, inOut ? 680 : 420, 'sine');
    noise(0.04, 0.04, 'highpass', 2000, 1200);
  }

  // --- Радиопереговоры и боевые доклады ---
  let lastChatterTime = 0;
  function radioChatter(type, text) {
    if (!ctx || !enabled) return;
    const now = performance.now();
    if (now - lastChatterTime < 2400) return; // не частить
    lastChatterTime = now;

    // Радио-пшик (squelch click)
    noise(0.07, 0.09, 'bandpass', 1800, 900, 0, 0, 1.8);

    // Озвучка через SpeechSynthesis, если поддерживается
    if (window.speechSynthesis && typeof SpeechSynthesisUtterance !== 'undefined') {
      try {
        const phrases = {
          kill: ['Цель уничтожена!', 'Есть попадание!', 'Техника противника разбита!', 'Враг нейтрализован!'],
          hit: ['Есть пробитие!', 'Попадание по цели!'],
          underFire: ['По нам ведут огонь!', 'Принимаем бой!', 'Гарнизон атакован!'],
          point: ['Опорный пункт под нашим контролем!', 'Точка зачищена!'],
          airstrike: ['Штаб, запрашиваю авиаудар по координатам!', 'Звено на подходе, пригнитесь!'],
          drone: ['Внимание, вражеский дрон в воздухе!']
        };
        const list = phrases[type] || [text || 'Приказ принят!'];
        const msg = text || list[Math.floor(Math.random() * list.length)];

        const utter = new SpeechSynthesisUtterance(msg);
        utter.lang = 'ru-RU';
        utter.rate = 1.15;
        utter.pitch = 0.95;
        utter.volume = master ? master.gain.value * 0.75 : 0.4;
        window.speechSynthesis.speak(utter);
      } catch (e) {}
    }
  }

  function toggle() {
    enabled = !enabled;
    if (master) master.gain.value = enabled ? 0.55 : 0;
    return enabled;
  }
  function setEnabled(v) {
    enabled = v;
    if (master) master.gain.value = enabled ? 0.55 : 0;
  }

  // общий ограничитель частоты выстрелов
  let shotBudget = 0;
  function budgetReset(dt) { shotBudget = Math.min(6, shotBudget + dt * 14); }
  function canShoot() { if (shotBudget < 1) return false; shotBudget -= 1; return true; }

  return {
    init, resume, setListener, rifle, heavyGun, cannon, explosion, distantExplosion,
    click, ui, moveOrder, attackOrder, launch, capture, siren, toggle, setEnabled,
    budgetReset, canShoot, hitmarker, coaxialMG, jetFlyby, ricochet, opticZoom, radioChatter,
    get enabled() { return enabled; }
  };
})();