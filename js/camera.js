/* ============================================================
   camera.js — RTS-камера: наклонный вид, зум, поворот
   ============================================================ */
'use strict';

const Cam = (() => {
  let camera = null, renderer = null, sceneFog = null;
  const target = new THREE.Vector3(0, 0, 70);
  const desired = new THREE.Vector3(0, 0, 70);
  const camPos = new THREE.Vector3();
  let zoom = 0.85, desiredZoom = 0.85;
  let yaw = 0, desiredYaw = 0;
  const MIN_ZOOM = 0.5, MAX_ZOOM = 3.0;
  let shakeT = 0, shakeMag = 0;

  function init(rendererRef, cam, fog) {
    renderer = rendererRef;
    camera = cam;
    sceneFog = fog || null;
  }

  function resize() {
    if (!renderer || !camera) return;
    const w = window.innerWidth, h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  }

  function clampTarget(v) {
    const lim = World.HALF - 12;
    v.x = Util.clamp(v.x, -lim, lim);
    v.z = Util.clamp(v.z, -lim, lim);
  }

  // смещение взгляда в экранных осях (справа = +x экрана)
  function pan(dxRight, dzForward) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    // экранная правая ось
    const rx = c, rz = -s;
    // вперёд (вглубь экрана, от камеры)
    const fx = s, fz = c;
    desired.x += rx * dxRight + fx * dzForward;
    desired.z += rz * dxRight + fz * dzForward;
    clampTarget(desired);
  }

  function panWorld(dx, dz) {
    desired.x += dx; desired.z += dz;
    clampTarget(desired);
  }

  function zoomBy(f) {
    desiredZoom = Util.clamp(desiredZoom * f, MIN_ZOOM, MAX_ZOOM);
  }
  function setZoom(z) {
    desiredZoom = Util.clamp(z, MIN_ZOOM, MAX_ZOOM);
  }
  function rotate(d) { desiredYaw += d; }

  function focus(x, z, snap) {
    desired.x = x; desired.z = z;
    clampTarget(desired);
    if (snap) { target.copy(desired); update(0.016); }
  }

  let fpsActive = false;

  function setFPS(v) {
    fpsActive = !!v;
    if (!fpsActive && camera) {
      camera.fov = 42;
      camera.updateProjectionMatrix();
    }
  }

  function isFPS() { return fpsActive; }

  function shake(mag) { shakeMag = Math.max(shakeMag, mag); shakeT = 0; }

  function update(dt) {
    if (!camera) return;
    if (fpsActive) return;
    const k = 1 - Math.exp(-dt * 10);
    target.x += (desired.x - target.x) * k;
    target.z += (desired.z - target.z) * k;
    zoom += (desiredZoom - zoom) * (1 - Math.exp(-dt * 9));
    yaw += (desiredYaw - yaw) * (1 - Math.exp(-dt * 12));

    // ограничение дальности относительно зума
    apply(dt);
  }

  function apply(dt) {
    const groundY = World.height(target.x, target.z);
    const t = Util.clamp((zoom - MIN_ZOOM) / (MAX_ZOOM - MIN_ZOOM), 0, 1);
    const dist = Util.lerp(22, 112, Math.pow(t, 1.22));
    const height = Util.lerp(17, 92, Math.pow(t, 1.1));

    let sx = 0, sz = 0;
    if (shakeMag > 0.001) {
      shakeT += dt;
      const decay = Math.exp(-shakeT * 5);
      sx = (Math.random() - 0.5) * shakeMag * decay;
      sz = (Math.random() - 0.5) * shakeMag * decay;
      if (decay < 0.02) shakeMag = 0;
    }

    const cx = target.x - Math.sin(yaw) * dist + sx;
    const cz = target.z - Math.cos(yaw) * dist + sz;
    const cy = groundY + height;
    camera.position.set(cx, cy, cz);
    camera.lookAt(target.x + sx * 0.3, groundY + 1.5, target.z + sz * 0.3);
    camera.updateMatrixWorld();

    if (sceneFog) {
      sceneFog.near = Math.max(0.5, dist * 0.35);
      sceneFog.far = 300 + zoom * 160;
    }
  }

  function getZoom() { return zoom; }
  function getYaw() { return yaw; }
  function getTarget() { return target; }

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  function updateRay(sx, sy) {
    ndc.x = (sx / window.innerWidth) * 2 - 1;
    ndc.y = -(sy / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(ndc, camera);
  }
  function screenToGround(sx, sy) {
    if (!camera) return null;
    updateRay(sx, sy);
    const o = raycaster.ray.origin, d = raycaster.ray.direction;
    return World.pickTerrain(o, d, 900);
  }
  function screenToRay(sx, sy) {
    updateRay(sx, sy);
    return raycaster.ray;
  }

  const _pv = new THREE.Vector3();
  function project(x, y, z) {
    if (!camera) return null;
    _pv.set(x, y, z).project(camera);
    return {
      x: (_pv.x * 0.5 + 0.5) * window.innerWidth,
      y: (-_pv.y * 0.5 + 0.5) * window.innerHeight,
      z: _pv.z,
      visible: _pv.z < 1
    };
  }

  // рамка видимости на миникарте
  function viewRect() {
    const corners = [];
    for (const [sx, sy] of [[0, 0], [window.innerWidth, 0], [window.innerWidth, window.innerHeight], [0, window.innerHeight]]) {
      const p = screenToGround(sx, sy);
      if (p) corners.push(p);
    }
    if (corners.length < 4) return null;
    return corners;
  }

  return {
    init, resize, pan, panWorld, zoomBy, setZoom, rotate, focus, update, apply, shake,
    screenToGround, screenToRay, project, getZoom, getYaw, getTarget, viewRect,
    setFPS, isFPS,
    get desired() { return desired; },
    get camera() { return camera; }
  };
})();