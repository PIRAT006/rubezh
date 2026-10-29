/* ============================================================
   main.js — инициализация приложения и главный цикл
   ============================================================ */
'use strict';

const App = (() => {
  let renderer, scene, camera, fog;
  let clock = 0;
  let started = false;
  let needResize = true;
  let fpsAcc = 0, fpsN = 0, fps = 60;

  function init() {
    const canvas = document.getElementById('gl');
    renderer = new THREE.WebGLRenderer({
      canvas, antialias: true, powerPreference: 'high-performance'
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.06;

    scene = Game.scene;
    scene.background = new THREE.Color(0x9aa6a2);
    fog = new THREE.Fog(0x929f9b, 170, 430);
    scene.fog = fog;

    camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.5, 900);

    // ---------------- свет ----------------
    const hemi = new THREE.HemisphereLight(0xc4d6e0, 0x4a4433, 0.95);
    scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xffe3bd, 2.3);
    sun.position.set(70, 120, 40);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = 100;
    sun.shadow.camera.left = -sc;
    sun.shadow.camera.right = sc;
    sun.shadow.camera.top = sc;
    sun.shadow.camera.bottom = -sc;
    sun.shadow.camera.near = 10;
    sun.shadow.camera.far = 340;
    sun.shadow.bias = -0.0007;
    sun.shadow.normalBias = 0.03;
    scene.add(sun);
    scene.add(sun.target);
    App.sun = sun;

    scene.add(new THREE.AmbientLight(0x8a9a92, 0.22));

    // ---------------- небо ----------------
    const skyGeo = new THREE.SphereGeometry(700, 24, 16);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {
        top: { value: new THREE.Color(0x4f6f80) },
        mid: { value: new THREE.Color(0x9fb0ac) },
        bot: { value: new THREE.Color(0xcbc6ae) }
      },
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `
        uniform vec3 top; uniform vec3 mid; uniform vec3 bot; varying vec3 vP;
        void main(){
          float h = normalize(vP).y;
          vec3 c = h > 0.1 ? mix(mid, top, smoothstep(0.1, 0.8, h))
                           : mix(bot, mid, smoothstep(-0.3, 0.1, h));
          gl_FragColor = vec4(c, 1.0);
        }`
    });
    const sky = new THREE.Mesh(skyGeo, skyMat);
    sky.renderOrder = -1;
    scene.add(sky);
    App.sky = sky;

    // ---------------- мир ----------------
    World.init(scene);
    Effects.init(scene, camera);
    Cam.init(renderer, camera, fog);
    Cam.focus(0, 60, true);
    Input.init(canvas);
    if (typeof FPSControl !== 'undefined') FPSControl.init(canvas);
    UI.init();

    // отражения для металла: простое окружение
    scene.environment = makeEnvironment(renderer);

    Cam.resize();
    window.addEventListener('resize', () => { needResize = true; });

    Game.enabled = false;
    if (World.showAllFog) World.showAllFog();
    menuCamera();
    startLoop();
  }

  function makeEnvironment(r) {
    try {
      const pmrem = new THREE.PMREMGenerator(r);
      const envScene = new THREE.Scene();
      const g = new THREE.SphereGeometry(10, 16, 12);
      const m = new THREE.ShaderMaterial({
        side: THREE.BackSide,
        vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: `
          varying vec3 vP;
          void main(){
            float h = normalize(vP).y;
            vec3 sky = mix(vec3(0.55,0.58,0.55), vec3(0.32,0.45,0.58), smoothstep(0.0,0.9,h));
            vec3 ground = vec3(0.26,0.24,0.18);
            vec3 c = h > 0.0 ? sky : mix(ground, sky, smoothstep(-0.4,0.0,h));
            gl_FragColor = vec4(c,1.0);
          }`
      });
      envScene.add(new THREE.Mesh(g, m));
      const rt = pmrem.fromScene(envScene, 0.04);
      pmrem.dispose();
      return rt.texture;
    } catch (e) {
      console.warn('env failed', e);
      return null;
    }
  }

  // ---------------------------------------------------------
  //  КАМЕРА ОБЛЁТА В МЕНЮ
  // ---------------------------------------------------------
  function menuCamera() {
    let t = App.menuT || 0;
    App.menuUpdate = (dt) => {
      t += dt * 0.04;
      App.menuT = t;
      // медленный облёт над южным берегом и мостами
      Cam.focus(Math.sin(t * 0.7) * 52, 30 + Math.cos(t * 0.55) * 42, false);
      Cam.setZoom(1.25 + Math.sin(t * 0.35) * 0.25);
    };
  }

  // ---------------------------------------------------------
  //  ЗАПУСК
  // ---------------------------------------------------------
  function startGame(diff) {
    const d = diff || App.selectedDiff || 'normal';
    UI.initMinimap();
    Game.reset(d);
    GameAI.init(Game);
    Game.enabled = true;
    Game.paused = false;
    Game.speed = 1;
    App.menuUpdate = null;
    Sfx.resume();
    document.getElementById('btn-speed').textContent = '1×';

    UI.showHud(true);
    UI.refreshPoints();
    Game.setSelection([]);
    UI.refreshSelection();
    UI.updateSoundIcon();
    UI.updatePauseBtn();
    UI.log('Операция «Северный рубеж» начата', 'info');
    UI.log('Задача: уничтожить штаб противника', 'warn');

    const menu = document.getElementById('menu');
    menu.classList.add('gone');
    setTimeout(() => { menu.style.display = 'none'; }, 900);

    Cam.focus(0, 66, true);
    Cam.setZoom(0.9);
    Cam.apply(0.016);
    Game.running = true;
    started = true;
  }

  function restart() {
    document.getElementById('overlay').classList.add('hidden');
    UI.closeOverlay();
    Game.reset(App.selectedDiff || 'normal');
    GameAI.init(Game);
    Game.enabled = true;
    Game.paused = false;
    Game.running = true;
    Game.speed = 1;
    document.getElementById('btn-speed').textContent = '1×';
    UI.showHud(true);
    UI.refreshPoints();
    Game.setSelection([]);
    UI.refreshSelection();
    UI.updatePauseBtn();
    UI.log('Новая операция начата', 'info');
    Cam.focus(0, 66, true);
  }

  function showMenu() {
    Game.enabled = false;
    Game.running = false;
    Game.paused = false;
    UI.showHud(false);
    const menu = document.getElementById('menu');
    menu.style.display = '';
    requestAnimationFrame(() => menu.classList.remove('gone'));
    menuCamera();
  }

  function togglePause() {
    if (!Game.running || Game.gameOver) return;
    if (UI.overlayKind === 'help') { UI.closeOverlay(); return; }
    Game.paused = !Game.paused;
    UI.updatePauseBtn();
    if (Game.paused) UI.showPause(); else UI.closeOverlay();
  }

  const SPEEDS = [1, 2, 3];
  function cycleSpeed() {
    const i = SPEEDS.indexOf(Game.speed);
    Game.speed = SPEEDS[(i + 1) % SPEEDS.length];
    document.getElementById('btn-speed').textContent = Game.speed + '×';
    Sfx.ui('select');
  }

  function beginAttackMode() { Input.startAttackMode(); }

  // ---------------------------------------------------------
  //  ЦИКЛ
  // ---------------------------------------------------------
  function startLoop() {
    clock = performance.now();
    requestAnimationFrame(loop);
  }

  function loop(now) {
    requestAnimationFrame(loop);
    let dt = (now - clock) / 1000;
    clock = now;
    if (!isFinite(dt) || dt < 0) dt = 0.016;
    dt = Math.min(dt, 0.08);

    if (needResize) { needResize = false; Cam.resize(); }

    fpsAcc += dt; fpsN++;
    if (fpsAcc > 0.5) { fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; }

    if (App.menuUpdate) App.menuUpdate(dt);

    Input.update(dt);
    if (typeof FPSControl !== 'undefined' && FPSControl.active) {
      FPSControl.update(dt);
    } else {
      Cam.update(dt);
    }
    try {
      Game.update(dt);
    } catch (e) {
      console.error('game update', e);
    }
    Effects.update(Game.paused ? dt * 0.1 : dt * Math.min(3, Game.speed));
    World.update(Game.paused ? 0 : dt);

    if (started && Game.running) UI.update(dt);

    // тень следует за камерой или управляемым юнитом
    const isFps = typeof FPSControl !== 'undefined' && FPSControl.active;
    const focusX = isFps ? camera.position.x : Cam.getTarget().x;
    const focusZ = isFps ? camera.position.z : Cam.getTarget().z;
    App.sun.position.set(focusX + 70, 120, focusZ + 40);
    App.sun.target.position.set(focusX, 0, focusZ);
    App.sun.target.updateMatrixWorld();
    App.sky.position.copy(camera.position);

    Sfx.setListener(focusX, focusZ);

    renderer.render(scene, camera);
  }

  // ---------------------------------------------------------
  //  МЕНЮ
  // ---------------------------------------------------------
  function initMenu() {
    const btns = document.querySelectorAll('#diff button');
    App.selectedDiff = 'normal';
    btns.forEach(b => {
      b.addEventListener('click', () => {
        btns.forEach(x => x.classList.remove('on'));
        b.classList.add('on');
        App.selectedDiff = b.dataset.diff;
        Sfx.resume();
        Sfx.ui('select');
      });
    });
    const start = document.getElementById('start-btn');
    start.addEventListener('click', () => {
      Sfx.resume();
      Sfx.ui('ok');
      startGame(App.selectedDiff);
    });
  }

  function captureError(msg, src, line, col, err) {
    let el = document.getElementById('crash');
    if (!el) {
      el = document.createElement('div');
      el.id = 'crash';
      document.body.appendChild(el);
    }
    el.textContent += `\n${msg} @ ${src || '?'}:${line || 0}:${col || 0}\n${err && err.stack ? err.stack : ''}\n`;
  }

  function boot() {
    window.addEventListener('error', e => captureError(e.message, e.filename, e.lineno, e.colno, e.error));
    window.addEventListener('unhandledrejection', e => captureError('Promise rejection', '', 0, 0, e.reason));
    window.__APP__ = App;
    window.__GAME__ = Game;
    window.__WORLD__ = World;
    try {
      init();
      initMenu();
      console.log('[РУБЕЖ] инициализация завершена');
    } catch (err) {
      captureError(err.message, 'boot', 0, 0, err);
      console.error(err);
    }
  }

  return {
    boot, startGame, restart, showMenu, togglePause, cycleSpeed, beginAttackMode,
    cameraFocusX: () => Cam.getTarget().x,
    get fps() { return fps; },
    get scene() { return scene; },
    get camera() { return camera; },
    get renderer() { return renderer; }
  };
})();

window.App = App;
if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', () => App.boot());
} else {
  App.boot();
}