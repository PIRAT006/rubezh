/* ============================================================
   sprites.js — рисованные иконки юнитов и постройки для HUD
   ============================================================ */
'use strict';

const Icons = (() => {
  let cache = new Map();

  function ctxFor(w, h) {
    const cv = document.createElement('canvas');
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = w * dpr; cv.height = h * dpr;
    const c = cv.getContext('2d');
    c.scale(dpr, dpr);
    return { cv, c };
  }

  function drawTroopers(c, s, color) {
    // три фигурки-силуэта с оружием
    c.strokeStyle = color; c.fillStyle = color;
    c.lineWidth = s * 0.075; c.lineCap = 'round'; c.lineJoin = 'round';
    for (let i = 0; i < 3; i++) {
      const x = s * (0.27 + i * 0.23), y = s * (0.5 + (i === 1 ? -0.06 : 0));
      const h = s * (i === 1 ? 0.34 : 0.3);
      // голова
      c.beginPath(); c.arc(x, y - h * 0.86, s * 0.062, 0, 6.283); c.fill();
      // корпус
      c.beginPath(); c.moveTo(x, y - h * 0.74); c.lineTo(x, y + h * 0.28); c.stroke();
      // ноги
      c.beginPath(); c.moveTo(x, y + h * 0.28); c.lineTo(x - s * 0.07, y + h * 0.62); c.stroke();
      c.beginPath(); c.moveTo(x, y + h * 0.28); c.lineTo(x + s * 0.07, y + h * 0.62); c.stroke();
      // автомат
      c.lineWidth = s * 0.045;
      c.beginPath(); c.moveTo(x - s * 0.1, y - h * 0.18); c.lineTo(x + s * 0.08, y - h * 0.5); c.stroke();
      c.lineWidth = s * 0.075;
    }
  }

  function drawTank(c, s, color, hull) {
    c.fillStyle = color; c.strokeStyle = color;
    // ствол
    c.lineWidth = s * 0.06; c.lineCap = 'round';
    c.beginPath(); c.moveTo(s * 0.5, s * 0.42); c.lineTo(s * 0.93, s * 0.42); c.stroke();
    // корпус (вид сбоку-сверху)
    c.beginPath();
    c.moveTo(s * 0.16, s * 0.68); c.lineTo(s * 0.2, s * 0.52); c.lineTo(s * 0.72, s * 0.5);
    c.lineTo(s * 0.8, s * 0.62); c.lineTo(s * 0.78, s * 0.76); c.lineTo(s * 0.2, s * 0.78);
    c.closePath(); c.fill();
    // башня
    c.beginPath(); c.roundRect ? c.roundRect(s * 0.34, s * 0.34, s * 0.26, s * 0.2, s * 0.05) : c.rect(s * 0.34, s * 0.34, s * 0.26, s * 0.2);
    c.fill();
    // гусеницы светлее
    if (hull) {
      c.fillStyle = hull;
      c.fillRect(s * 0.18, s * 0.74, s * 0.6, s * 0.07);
    }
  }

  function drawIfv(c, s, color) {
    c.fillStyle = color; c.strokeStyle = color;
    // колесо-силуэт корпуса
    c.beginPath();
    c.moveTo(s * 0.1, s * 0.66); c.lineTo(s * 0.22, s * 0.48); c.lineTo(s * 0.78, s * 0.48);
    c.lineTo(s * 0.9, s * 0.66); c.lineTo(s * 0.88, s * 0.78); c.lineTo(s * 0.12, s * 0.78);
    c.closePath(); c.fill();
    // башня
    c.beginPath(); c.arc(s * 0.52, s * 0.42, s * 0.1, 0, 6.283); c.fill();
    // пушка
    c.lineWidth = s * 0.045; c.lineCap = 'round';
    c.beginPath(); c.moveTo(s * 0.6, s * 0.42); c.lineTo(s * 0.88, s * 0.38); c.stroke();
    // колёса
    c.fillStyle = 'rgba(0,0,0,0.28)';
    for (const x of [0.3, 0.5, 0.72]) { c.beginPath(); c.arc(s * x, s * 0.78, s * 0.055, 0, 6.283); c.fill(); }
  }

  function drawArtillery(c, s, color) {
    c.fillStyle = color; c.strokeStyle = color;
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(s * 0.12, s * 0.7); c.lineTo(s * 0.2, s * 0.58); c.lineTo(s * 0.82, s * 0.54);
    c.lineTo(s * 0.88, s * 0.68); c.lineTo(s * 0.84, s * 0.8); c.lineTo(s * 0.16, s * 0.8);
    c.closePath(); c.fill();
    c.beginPath(); c.arc(s * 0.44, s * 0.5, s * 0.11, 0, 6.283); c.fill();
    c.lineWidth = s * 0.07;
    c.beginPath(); c.moveTo(s * 0.5, s * 0.46); c.lineTo(s * 0.98, s * 0.26); c.stroke();
  }

  function drawAA(c, s, color) {
    c.fillStyle = color; c.strokeStyle = color; c.lineCap = 'round';
    c.beginPath();
    c.moveTo(s * 0.14, s * 0.72); c.lineTo(s * 0.22, s * 0.62); c.lineTo(s * 0.8, s * 0.62);
    c.lineTo(s * 0.86, s * 0.72); c.lineTo(s * 0.82, s * 0.8); c.lineTo(s * 0.18, s * 0.8);
    c.closePath(); c.fill();
    // пара ракет вверх
    c.lineWidth = s * 0.06;
    for (const dx of [-0.07, 0.07]) {
      c.beginPath(); c.moveTo(s * (0.48 + dx), s * 0.56); c.lineTo(s * (0.56 + dx), s * 0.18); c.stroke();
    }
    // радар
    c.beginPath(); c.arc(s * 0.28, s * 0.5, s * 0.06, 0, 6.283); c.fill();
  }

  function drawRockets(c, s, color) {
    c.fillStyle = color;
    c.beginPath();
    c.moveTo(s * 0.14, s * 0.72); c.lineTo(s * 0.22, s * 0.6); c.lineTo(s * 0.7, s * 0.6);
    c.lineTo(s * 0.7, s * 0.5); c.lineTo(s * 0.9, s * 0.44); c.lineTo(s * 0.9, s * 0.6);
    c.lineTo(s * 0.82, s * 0.72); c.lineTo(s * 0.78, s * 0.8); c.lineTo(s * 0.18, s * 0.8);
    c.closePath(); c.fill();
    c.fillStyle = 'rgba(0,0,0,0.35)';
    for (let i = 0; i < 3; i++) c.fillRect(s * 0.34, s * 0.52 + i * s * 0.055, s * 0.34, s * 0.025);
  }

  function drawRecon(c, s, color) {
    c.strokeStyle = color; c.fillStyle = color; c.lineCap = 'round';
    c.beginPath();
    c.moveTo(s * 0.14, s * 0.64); c.lineTo(s * 0.26, s * 0.5); c.lineTo(s * 0.7, s * 0.5);
    c.lineTo(s * 0.86, s * 0.64); c.lineTo(s * 0.84, s * 0.74); c.lineTo(s * 0.16, s * 0.74);
    c.closePath(); c.fill();
    // антенна + бинокль
    c.lineWidth = s * 0.035;
    c.beginPath(); c.moveTo(s * 0.6, s * 0.5); c.lineTo(s * 0.72, s * 0.16); c.stroke();
    c.beginPath(); c.arc(s * 0.72, s * 0.16, s * 0.035, 0, 6.283); c.fill();
    c.fillStyle = 'rgba(0,0,0,0.3)';
    for (const x of [0.3, 0.7]) { c.beginPath(); c.arc(s * x, s * 0.75, s * 0.055, 0, 6.283); c.fill(); }
  }

  function drawDrone(c, s, color) {
    c.strokeStyle = color; c.fillStyle = color; c.lineCap = 'round';
    // лучи
    c.lineWidth = s * 0.04;
    for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      c.beginPath(); c.moveTo(s * 0.5, s * 0.5); c.lineTo(s * (0.5 + dx * 0.3), s * (0.5 + dy * 0.3)); c.stroke();
    }
    // винты
    c.lineWidth = s * 0.045;
    for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const x = s * (0.5 + dx * 0.3), y = s * (0.5 + dy * 0.3);
      c.beginPath(); c.moveTo(x - s * 0.09, y); c.lineTo(x + s * 0.09, y); c.stroke();
    }
    // корпус
    c.beginPath(); c.ellipse(s * 0.5, s * 0.5, s * 0.1, s * 0.13, 0, 0, 6.283); c.fill();
    c.beginPath(); c.moveTo(s * 0.44, s * 0.62); c.lineTo(s * 0.5, s * 0.74); c.lineTo(s * 0.56, s * 0.62); c.fill();
  }

  function drawBuilding(c, s, kind, color) {
    c.fillStyle = color;
    if (kind === 'hq') {
      c.fillRect(s * 0.14, s * 0.38, s * 0.72, s * 0.46);
      c.fillRect(s * 0.34, s * 0.2, s * 0.32, s * 0.16);
      c.fillStyle = 'rgba(0,0,0,0.45)';
      for (let i = 0; i < 4; i++) c.fillRect(s * (0.2 + i * 0.16), s * 0.48, s * 0.08, s * 0.1);
      c.fillStyle = color;
      c.fillRect(s * 0.2, s * 0.3, s * 0.04, s * 0.5);
      // флаг
      c.beginPath(); c.moveTo(s * 0.78, s * 0.22); c.lineTo(s * 0.78, s * 0.02); c.lineTo(s * 0.94, s * 0.08); c.closePath(); c.fill();
    } else if (kind === 'barracks') {
      c.beginPath(); c.moveTo(s * 0.1, s * 0.5); c.lineTo(s * 0.5, s * 0.24); c.lineTo(s * 0.9, s * 0.5); c.closePath(); c.fill();
      c.fillRect(s * 0.18, s * 0.5, s * 0.64, s * 0.32);
      c.fillStyle = 'rgba(0,0,0,0.5)'; c.fillRect(s * 0.42, s * 0.6, s * 0.16, s * 0.22);
    } else if (kind === 'factory') {
      // пилообразная крыша
      c.beginPath();
      c.moveTo(s * 0.1, s * 0.3); c.lineTo(s * 0.3, s * 0.18); c.lineTo(s * 0.3, s * 0.3);
      c.lineTo(s * 0.5, s * 0.18); c.lineTo(s * 0.5, s * 0.3);
      c.lineTo(s * 0.7, s * 0.18); c.lineTo(s * 0.7, s * 0.3);
      c.lineTo(s * 0.9, s * 0.18); c.lineTo(s * 0.9, s * 0.82); c.lineTo(s * 0.1, s * 0.82);
      c.closePath(); c.fill();
      c.fillStyle = 'rgba(0,0,0,0.45)';
      c.fillRect(s * 0.4, s * 0.6, s * 0.2, s * 0.22);
      c.fillStyle = color; c.fillRect(s * 0.14, s * 0.0, s * 0.08, s * 0.24);
    } else if (kind === 'depot') {
      c.fillRect(s * 0.14, s * 0.38, s * 0.72, s * 0.42);
      c.fillStyle = 'rgba(0,0,0,0.45)';
      c.fillRect(s * 0.22, s * 0.44, s * 0.56, s * 0.08);
      c.fillRect(s * 0.22, s * 0.58, s * 0.56, s * 0.08);
      c.fillStyle = color;
      c.beginPath(); c.arc(s * 0.5, s * 0.2, s * 0.1, 0, 6.283); c.fill();
    }
  }

  function get(key, color, w = 48, h = 32) {
    const ck = key + '|' + color + '|' + w + 'x' + h;
    if (cache.has(ck)) return cache.get(ck);
    const { cv, c } = ctxFor(w, h);
    const s = Math.min(w, h);
    c.translate((w - s) / 2, (h - s) / 2);
    const hull = 'rgba(0,0,0,0.3)';
    switch (key) {
      case 'infantry': drawTroopers(c, s, color); break;
      case 'ifv': drawIfv(c, s, color); break;
      case 'tank': drawTank(c, s, color, hull); break;
      case 'artillery': drawArtillery(c, s, color); break;
      case 'aa': drawAA(c, s, color); break;
      case 'mlrs': drawRockets(c, s, color); break;
      case 'recon': drawRecon(c, s, color); break;
      case 'drone': drawDrone(c, s, color); break;
      case 'hq': case 'barracks': case 'factory': case 'depot':
        drawBuilding(c, s, key, color); break;
      default: break;
    }
    const url = cv.toDataURL('image/png');
    cache.set(ck, url);
    return url;
  }

  function clearCache() { cache = new Map(); }

  return { get, clearCache };
})();