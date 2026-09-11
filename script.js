/* =========================================================
   粒子星座 · Particle Constellation
   场景 + 形状(含自定义+持久化) + 信号脉冲 + 禁止复制 + 反馈 + iOS
   ========================================================= */
(function () {
  'use strict';

  /* =========================================================
     禁止复制 / 选择 / 右键菜单 / 拖拽
     ========================================================= */
  function blockEvent(e) {
    e.preventDefault();
    return false;
  }

  document.addEventListener('copy', blockEvent);
  document.addEventListener('cut', blockEvent);
  document.addEventListener('paste', blockEvent);
  document.addEventListener('selectstart', blockEvent);
  document.addEventListener('contextmenu', blockEvent);
  document.addEventListener('dragstart', blockEvent);
  document.addEventListener('drop', blockEvent);

  /* =========================================================
     iOS 检测
     ========================================================= */
  function isIOS() {
    if (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) {
      return true;
    }
    return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  }

  /* ---------- DOM ---------- */
  const canvas = document.getElementById('scene');
  const ctx = canvas.getContext('2d', { alpha: true });

  const ui = {
    fps:       document.getElementById('fps'),
    count:     document.getElementById('count'),
    countVal:  document.getElementById('countVal'),
    link:      document.getElementById('link'),
    linkVal:   document.getElementById('linkVal'),
    speed:     document.getElementById('speed'),
    speedVal:  document.getElementById('speedVal'),
    themes:    Array.prototype.slice.call(document.querySelectorAll('.theme-btn')),
    scenes:    Array.prototype.slice.call(document.querySelectorAll('.scene-btn')),
    panel:     document.getElementById('panel'),
    panelBtn:  document.getElementById('panelToggle')
  };

  /* ---------- 环境探测 ---------- */
  const isCoarse = window.matchMedia('(pointer: coarse)').matches;
  const isSmallScreen = Math.min(window.innerWidth, window.innerHeight) < 640;

  /* =========================================================
     场景预设
     ========================================================= */
  const SCENES = {
    nebula: {
      speed: 1.0, linkDist: 130, linkAlpha: 0.33, swirl: 0,
      pulseSpeed: 0.025, pulseAmp: 0.25, sizeMul: 1.0, glowMul: 1.0,
      pulseInterval: 1.4
    },
    storm: {
      speed: 3.5, linkDist: 80, linkAlpha: 0.5, swirl: 0,
      pulseSpeed: 0.09, pulseAmp: 0.35, sizeMul: 0.55, glowMul: 0.5,
      pulseInterval: 0.35
    },
    wormhole: {
      speed: 1.3, linkDist: 180, linkAlpha: 0.25, swirl: 1.0,
      pulseSpeed: 0.04, pulseAmp: 0.15, sizeMul: 1.4, glowMul: 1.6,
      pulseInterval: 0.9
    },
    firefly: {
      speed: 0.3, linkDist: 80, linkAlpha: 0.15, swirl: 0,
      pulseSpeed: 0.13, pulseAmp: 0.7, sizeMul: 2.0, glowMul: 2.5,
      pulseInterval: 2.8
    }
  };

  /* ---------- 状态 ---------- */
  const TAU = Math.PI * 2;
  const POINTER_R = isCoarse ? 130 : 155;

  const state = {
    count: 130, linkDist: 130, linkAlpha: 0.33, speed: 1, hue: 200,
    swirl: 0, pulseSpeed: 0.025, pulseAmp: 0.25, sizeMul: 1.0, glowMul: 1.0,
    pulseInterval: 1.4,
    shape: 'free'
  };

  let W = 0;
  let H = 0;
  let DPR = 1;
  let particles = [];
  let ripples = [];
  let signals = [];
  let pulseTimer = 0.6;
  let shapeTime = 0;
  let shapeScale = 10;

  /* ---------- 自定义形状（持久化） ---------- */
  const customShapes = [];       // [{ id, name, strokes, connect }]
  const STORAGE_KEY = 'constellation-custom-shapes-v1';

  function saveCustomShapes() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(customShapes));
    } catch (e) {
      /* 隐私模式或存储满，静默失败 */
    }
  }

  function loadCustomShapes() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return;
      for (let i = 0; i < arr.length; i++) {
        const s = arr[i];
        if (s && s.id && s.strokes && s.strokes.length > 0) {
          customShapes.push({
            id: s.id,
            name: s.name || ('图形 ' + (i + 1)),
            strokes: s.strokes,
            connect: s.connect === true
          });
        }
      }
    } catch (e) {}
  }

  function nextShapeNumber() {
    let max = 0;
    for (let i = 0; i < customShapes.length; i++) {
      const m = /图形\s*(\d+)/.exec(customShapes[i].name);
      if (m) {
        const n = parseInt(m[1], 10);
        if (n > max) max = n;
      }
    }
    return max + 1;
  }

  /* ---------- 画板状态 ---------- */
  const drawState = {
    active: false,
    drawing: false,
    strokes: [],
    currentStroke: null,
    canvasW: 0,
    canvasH: 0
  };

  const pointer = { x: -9999, y: -9999, active: false };

  /* ---------- 空间网格 ---------- */
  let gridCols = 0;
  let gridRows = 0;
  let gridCell = 130;
  let gridBuckets = [];

  function buildGrid() {
    gridCell = Math.max(60, state.linkDist);
    gridCols = Math.max(1, Math.ceil(W / gridCell));
    gridRows = Math.max(1, Math.ceil(H / gridCell));

    const total = gridCols * gridRows;

    if (gridBuckets.length !== total) {
      gridBuckets = new Array(total);
      for (let i = 0; i < total; i++) gridBuckets[i] = [];
    } else {
      for (let i = 0; i < total; i++) gridBuckets[i].length = 0;
    }

    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      p.idx = i;
      let cx = Math.floor(p.x / gridCell);
      let cy = Math.floor(p.y / gridCell);
      if (cx < 0) cx = 0; else if (cx >= gridCols) cx = gridCols - 1;
      if (cy < 0) cy = 0; else if (cy >= gridRows) cy = gridRows - 1;

      p.gx = cx;
      p.gy = cy;
      gridBuckets[cy * gridCols + cx].push(i);
    }
  }

  /* ---------- 粒子 ---------- */
  function createParticle(x, y) {
    const angle = Math.random() * TAU;
    const base = 0.25 + Math.random() * 0.5;

    return {
      x: x !== undefined ? x : Math.random() * W,
      y: y !== undefined ? y : Math.random() * H,
      vx: Math.cos(angle) * base,
      vy: Math.sin(angle) * base,
      base: base,
      r: 0.9 + Math.random() * 1.7,
      hueOff: (Math.random() - 0.5) * 70,
      pulse: Math.random() * TAU,
      gx: 0,
      gy: 0,
      idx: 0,
      flash: 0,
      tx: 0,
      ty: 0,
      shapeT: 0
    };
  }

  function syncCount() {
    while (particles.length < state.count) particles.push(createParticle());
    if (particles.length > state.count) particles.length = state.count;
  }

  /* ---------- 尺寸 ---------- */
  function resize() {
    const maxDPR = isCoarse ? 1.5 : 2;
    DPR = Math.min(window.devicePixelRatio || 1, maxDPR);

    W = window.innerWidth;
    H = window.innerHeight;

    canvas.width = Math.floor(W * DPR);
    canvas.height = Math.floor(H * DPR);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';

    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      if (p.x > W) p.x = W;
      if (p.y > H) p.y = H;
      if (p.x < 0) p.x = 0;
      if (p.y < 0) p.y = 0;
    }

    shapeScale = Math.min(W, H) * 0.65 / 32;

    if (state.shape !== 'free') {
      updateShapeTargets();
    }

    syncCount();
  }

  /* ---------- 稳定伪随机 ---------- */
  function stableRandom(p, offset) {
    const seed = p.hueOff * 100 + p.base * 37 + offset * 71.3;
    const x = Math.sin(seed) * 43758.5453;
    return x - Math.floor(x);
  }

  /* =========================================================
     自定义形状采样
     ========================================================= */

  /* 单条曲线：等距采 count 个点 */
  function sampleSequence(points, count) {
    if (points.length < 2 || count < 1) return [];

    const segs = [];
    let totalLen = 0;
    for (let i = 1; i < points.length; i++) {
      const dx = points[i].x - points[i - 1].x;
      const dy = points[i].y - points[i - 1].y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > 0.5) {
        segs.push({ len: d, from: points[i - 1], to: points[i] });
        totalLen += d;
      }
    }
    if (totalLen < 1) return [];

    const result = new Array(count);
    const step = totalLen / count;
    let segIdx = 0;
    let segAcc = 0;

    for (let i = 0; i < count; i++) {
      const target = i * step;
      while (segIdx < segs.length && segAcc + segs[segIdx].len < target) {
        segAcc += segs[segIdx].len;
        segIdx++;
      }
      if (segIdx >= segs.length) {
        result[i] = {
          x: points[points.length - 1].x,
          y: points[points.length - 1].y
        };
        continue;
      }
      const seg = segs[segIdx];
      const t = seg.len > 0 ? (target - segAcc) / seg.len : 0;
      result[i] = {
        x: seg.from.x + (seg.to.x - seg.from.x) * t,
        y: seg.from.y + (seg.to.y - seg.from.y) * t
      };
    }
    return result;
  }

  /* 模式 A：所有笔画连成一条 */
  function sampleConnectedShape(shape, count) {
    const allPoints = [];
    for (let s = 0; s < shape.strokes.length; s++) {
      const pts = shape.strokes[s].points;
      for (let i = 0; i < pts.length; i++) {
        allPoints.push({
          x: pts[i].x * W,
          y: pts[i].y * H
        });
      }
    }
    return sampleSequence(allPoints, count);
  }

  /* 模式 B：每笔独立，按长度比例分配粒子 */
  function sampleSeparateShape(shape, count) {
    const infos = [];
    let totalLen = 0;

    for (let s = 0; s < shape.strokes.length; s++) {
      const rawPts = shape.strokes[s].points;
      const pts = rawPts.map(function (pt) {
        return { x: pt.x * W, y: pt.y * H };
      });
      let len = 0;
      for (let i = 1; i < pts.length; i++) {
        const dx = pts[i].x - pts[i - 1].x;
        const dy = pts[i].y - pts[i - 1].y;
        len += Math.sqrt(dx * dx + dy * dy);
      }
      infos.push({ pts: pts, len: len });
      totalLen += len;
    }

    if (totalLen < 1) return [];

    const result = [];
    const minPerStroke = 4;

    for (let s = 0; s < infos.length; s++) {
      const info = infos[s];
      let share = Math.round(count * info.len / totalLen);
      if (share < minPerStroke) share = minPerStroke;
      const sub = sampleSequence(info.pts, share);
      for (let i = 0; i < sub.length; i++) {
        result.push(sub[i]);
      }
    }

    if (result.length > count) {
      result.length = count;
    } else {
      while (result.length < count) {
        const last = result[result.length - 1] || { x: W * 0.5, y: H * 0.5 };
        result.push({ x: last.x, y: last.y });
      }
    }
    return result;
  }

  function sampleCustomShape(shape, count) {
    if (shape.connect === true) {
      return sampleConnectedShape(shape, count);
    }
    return sampleSeparateShape(shape, count);
  }

  /* =========================================================
     形状目标点计算 —— 只在切换/尺寸变化时调用
     ========================================================= */
  function updateShapeTargets() {
    const n = particles.length;
    if (n === 0) return;

    const cx = W * 0.5;
    const cy = H * 0.5;
    const s = shapeScale;
    const shape = state.shape;

    /* ---------- 自定义形状 ---------- */
    if (shape.indexOf('custom-') === 0) {
      let customShape = null;
      for (let k = 0; k < customShapes.length; k++) {
        if (customShapes[k].id === shape) { customShape = customShapes[k]; break; }
      }
      if (!customShape) return;

      const points = sampleCustomShape(customShape, n);
      for (let i = 0; i < n; i++) {
        const p = particles[i];
        p.shapeT = (i / n) * TAU;
        if (points[i]) {
          p.tx = points[i].x;
          p.ty = points[i].y;
        }
      }
      return;
    }

    for (let i = 0; i < n; i++) {
      const p = particles[i];
      p.shapeT = (i / n) * TAU;

      /* ---------- 爱心 ---------- */
      if (shape === 'heart') {
        const t = (i / n) * TAU;
        const hx = 16 * Math.pow(Math.sin(t), 3);
        const hy = 13 * Math.cos(t) - 5 * Math.cos(2 * t)
                 - 2 * Math.cos(3 * t) - Math.cos(4 * t);

        p.tx = cx + hx * s;
        p.ty = cy - hy * s * 0.88;

      /* ---------- 烟花 ---------- */
      } else if (shape === 'fireworks') {
        const frac = i / n;

        if (frac < 0.15) {
          const seed1 = stableRandom(p, 10);
          const seed2 = stableRandom(p, 11);
          const a = seed1 * TAU;
          const r = Math.sqrt(seed2) * 0.16;
          p.tx = cx + Math.cos(a) * r * s * 14;
          p.ty = cy + Math.sin(a) * r * s * 14;

        } else if (frac < 0.85) {
          const rayFrac = (frac - 0.15) / 0.70;
          const rays = 12;
          const rayIdx = Math.min(rays - 1, Math.floor(rayFrac * rays));
          const inRay  = rayFrac * rays - rayIdx;

          const seed = stableRandom(p, 20);
          const rayAngle = (rayIdx / rays) * TAU
                         + (seed - 0.5) * 0.08;

          const dist = 0.12 + Math.pow(inRay, 0.6) * 1.05;

          const jSeed = stableRandom(p, 21);
          const jitter = (jSeed - 0.5) * 0.10;

          const cosA = Math.cos(rayAngle);
          const sinA = Math.sin(rayAngle);
          const cosP = Math.cos(rayAngle + Math.PI / 2);
          const sinP = Math.sin(rayAngle + Math.PI / 2);

          p.tx = cx + (cosA * dist + cosP * jitter) * s * 14;
          p.ty = cy + (sinA * dist + sinP * jitter) * s * 14;

        } else {
          const seed1 = stableRandom(p, 30);
          const seed2 = stableRandom(p, 31);
          const a = seed1 * TAU;
          const r = 0.4 + seed2 * 0.7;
          p.tx = cx + Math.cos(a) * r * s * 14;
          p.ty = cy + Math.sin(a) * r * s * 14;
        }

      /* ---------- 自由 ---------- */
      } else {
        p.tx = p.x;
        p.ty = p.y;
      }
    }
  }

  /* =========================================================
     信号脉冲
     ========================================================= */
  function findNeighbors(p, maxDist, maxCount) {
    const result = [];
    const maxD2 = maxDist * maxDist;
    const cx = p.gx;
    const cy = p.gy;

    for (let oy = -1; oy <= 1; oy++) {
      const ny = cy + oy;
      if (ny < 0 || ny >= gridRows) continue;

      for (let ox = -1; ox <= 1; ox++) {
        const nx = cx + ox;
        if (nx < 0 || nx >= gridCols) continue;

        const bucket = gridBuckets[ny * gridCols + nx];
        for (let k = 0; k < bucket.length; k++) {
          const j = bucket[k];
          if (j === p.idx) continue;

          const q = particles[j];
          const dx = q.x - p.x;
          const dy = q.y - p.y;
          const d2 = dx * dx + dy * dy;

          if (d2 < maxD2 && d2 > 1) result.push(j);
        }
      }
    }

    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = result[i];
      result[i] = result[j];
      result[j] = tmp;
    }
    return result.slice(0, maxCount);
  }

  function spawnSignalFromParticle(idx, depth) {
    if (signals.length > 120) return;

    const from = particles[idx];
    if (!from) return;

    const neighbors = findNeighbors(from, state.linkDist, 4);
    if (neighbors.length === 0) return;

    const count = 1 + (Math.random() < 0.4 ? 1 : 0);

    for (let k = 0; k < count && k < neighbors.length; k++) {
      const j = neighbors[k];
      const to = particles[j];
      if (!to) continue;

      signals.push({
        ax: from.x, ay: from.y,
        bx: to.x,  by: to.y,
        fromIdx: idx,
        toIdx: j,
        t: 0,
        speed: 0.05 + Math.random() * 0.02,
        depth: depth,
        hueOff: (Math.random() - 0.5) * 40
      });
    }
  }

  function updateSignals(dt) {
    const dtSec = dt / 60;

    pulseTimer -= dtSec;
    if (pulseTimer <= 0) {
      pulseTimer = state.pulseInterval * (0.7 + Math.random() * 0.6);
      if (particles.length > 0 && signals.length < 100) {
        const startIdx = Math.floor(Math.random() * particles.length);
        particles[startIdx].flash = 0.9;
        spawnSignalFromParticle(startIdx, 0);
      }
    }

    for (let i = signals.length - 1; i >= 0; i--) {
      const s = signals[i];
      s.t += s.speed * dt;

      if (s.t >= 1) {
        const target = particles[s.toIdx];
        if (target) {
          target.flash = 1;
          if (s.depth < 5 && Math.random() < 0.7) {
            spawnSignalFromParticle(s.toIdx, s.depth + 1);
          }
        }
        signals.splice(i, 1);
      }
    }

    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      if (p.flash > 0) {
        p.flash -= 0.03 * dt;
        if (p.flash < 0) p.flash = 0;
      }
    }
  }

  /* ---------- 爆炸 ---------- */
  function explode(x, y, power) {
    power = power || 9;
    const R = isCoarse ? 150 : 190;
    const R2 = R * R;

    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      const dx = p.x - x;
      const dy = p.y - y;
      const d2 = dx * dx + dy * dy;

      if (d2 < R2 && d2 > 1) {
        const d = Math.sqrt(d2);
        const force = (1 - d / R) * power;
        p.vx += (dx / d) * force;
        p.vy += (dy / d) * force;
      }
    }

    if (ripples.length > 8) ripples.shift();
    ripples.push({ x: x, y: y, r: 6, max: R, life: 1 });

    if (signals.length < 100 && particles.length > 0) {
      for (let k = 0; k < 3; k++) {
        const idx = Math.floor(Math.random() * particles.length);
        if (particles[idx]) {
          particles[idx].flash = 0.85;
          spawnSignalFromParticle(idx, 0);
        }
      }
    }
  }

  /* ---------- 更新 ---------- */
  function update(dt) {
    const R2 = POINTER_R * POINTER_R;
    const len = particles.length;
    const swirl = state.swirl;
    const inShapeMode = state.shape !== 'free';

    shapeTime += dt / 60;

    for (let i = 0; i < len; i++) {
      const p = particles[i];

      if (pointer.active) {
        const dx = p.x - pointer.x;
        const dy = p.y - pointer.y;
        const d2 = dx * dx + dy * dy;

        if (d2 < R2 && d2 > 0.01) {
          const d = Math.sqrt(d2);
          const force = (1 - d / POINTER_R) * 1.5 * dt;
          p.vx += (dx / d) * force;
          p.vy += (dy / d) * force;
        }
      }

      if (inShapeMode) {
        const dx = p.tx - p.x;
        const dy = p.ty - p.y;
        const k = 0.0055;

        p.vx += dx * k * dt;
        p.vy += dy * k * dt;

        const damp = Math.pow(0.93, dt);
        p.vx *= damp;
        p.vy *= damp;

        p.vx += (Math.random() - 0.5) * 0.18 * dt;
        p.vy += (Math.random() - 0.5) * 0.18 * dt;

      } else {
        if (swirl > 0) {
          const rot = swirl * 0.05 * dt;
          const cos = Math.cos(rot);
          const sin = Math.sin(rot);
          const nvx = p.vx * cos - p.vy * sin;
          const nvy = p.vx * sin + p.vy * cos;
          p.vx = nvx;
          p.vy = nvy;
        }

        const sp = Math.sqrt(p.vx * p.vx + p.vy * p.vy) || 1e-4;
        const target = p.base * state.speed;
        const newSp = sp + (target - sp) * 0.06 * dt;
        const k = newSp / sp;
        p.vx *= k;
        p.vy *= k;
      }

      p.x += p.vx * dt;
      p.y += p.vy * dt;

      if (p.x < 0)      { p.x = 0; p.vx = Math.abs(p.vx); }
      else if (p.x > W) { p.x = W; p.vx = -Math.abs(p.vx); }

      if (p.y < 0)      { p.y = 0; p.vy = Math.abs(p.vy); }
      else if (p.y > H) { p.y = H; p.vy = -Math.abs(p.vy); }

      p.pulse += state.pulseSpeed * dt;
    }

    for (let i = ripples.length - 1; i >= 0; i--) {
      const rp = ripples[i];
      rp.r += (rp.max - rp.r) * 0.14 * dt;
      rp.life -= 0.032 * dt;
      if (rp.life <= 0 || rp.r >= rp.max - 2) {
        ripples.splice(i, 1);
      }
    }

    updateSignals(dt);
  }

  /* ---------- 绘制：连线 ---------- */
  function drawLinks() {
    const hue = state.hue;
    const linkDist = state.linkDist;
    const linkDist2 = linkDist * linkDist;
    const alpha = state.linkAlpha;
    const len = particles.length;

    ctx.lineWidth = 1;

    for (let i = 0; i < len; i++) {
      const a = particles[i];
      const cx = a.gx;
      const cy = a.gy;

      for (let oy = -1; oy <= 1; oy++) {
        const ny = cy + oy;
        if (ny < 0 || ny >= gridRows) continue;

        for (let ox = -1; ox <= 1; ox++) {
          const nx = cx + ox;
          if (nx < 0 || nx >= gridCols) continue;

          const bucket = gridBuckets[ny * gridCols + nx];
          const bn = bucket.length;

          for (let k = 0; k < bn; k++) {
            const j = bucket[k];
            if (j <= i) continue;

            const b = particles[j];
            const dx = a.x - b.x;
            const dy = a.y - b.y;
            const d2 = dx * dx + dy * dy;

            if (d2 > linkDist2) continue;

            const t = 1 - Math.sqrt(d2) / linkDist;
            const h = hue + (a.hueOff + b.hueOff) * 0.5;
            const flashMax = a.flash > b.flash ? a.flash : b.flash;
            const aFinal = Math.min(0.85, t * alpha + flashMax * 0.45);

            ctx.strokeStyle = 'hsla(' + h + ', 90%, 66%, ' + aFinal + ')';
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
      }
    }
  }

  /* ---------- 绘制：粒子 ---------- */
  function drawParticles() {
    const hue = state.hue;
    const len = particles.length;
    const glow = state.glowMul;
    const sizeMul = state.sizeMul;
    const amp = state.pulseAmp;

    for (let i = 0; i < len; i++) {
      const p = particles[i];
      const h = hue + p.hueOff;
      const tw = (1 - amp) + Math.sin(p.pulse) * amp;
      const flash = p.flash;

      const rr = p.r * sizeMul * (0.6 + tw * 0.6) * (1 + flash * 1.1);
      const glowBoost = glow * (1 + flash * 2.5);

      ctx.beginPath();
      ctx.arc(p.x, p.y, rr * 3, 0, TAU);
      ctx.fillStyle = 'hsla(' + h + ', 95%, 66%, ' + (0.07 * tw * glowBoost) + ')';
      ctx.fill();

      const light = 76 + flash * 22;
      ctx.beginPath();
      ctx.arc(p.x, p.y, rr, 0, TAU);
      ctx.fillStyle = 'hsla(' + h + ', 95%, ' + light + '%, 0.95)';
      ctx.fill();
    }
  }

  /* ---------- 绘制：信号脉冲 ---------- */
  function drawSignals() {
    if (signals.length === 0) return;

    const hue = state.hue;

    for (let i = 0; i < signals.length; i++) {
      const s = signals[i];
      const h = hue + s.hueOff;

      const x = s.ax + (s.bx - s.ax) * s.t;
      const y = s.ay + (s.by - s.ay) * s.t;

      const trailLen = 0.18;
      const t0 = Math.max(0, s.t - trailLen);
      const tx = s.ax + (s.bx - s.ax) * t0;
      const ty = s.ay + (s.by - s.ay) * t0;

      const grad = ctx.createLinearGradient(tx, ty, x, y);
      grad.addColorStop(0, 'hsla(' + h + ', 100%, 70%, 0)');
      grad.addColorStop(1, 'hsla(' + h + ', 100%, 78%, 0.85)');

      ctx.strokeStyle = grad;
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(x, y);
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(x, y, 9, 0, TAU);
      ctx.fillStyle = 'hsla(' + h + ', 100%, 72%, 0.28)';
      ctx.fill();

      ctx.beginPath();
      ctx.arc(x, y, 3.2, 0, TAU);
      ctx.fillStyle = 'hsla(' + h + ', 100%, 92%, 1)';
      ctx.fill();
    }

    ctx.lineCap = 'butt';
  }

  /* ---------- 绘制：指针光晕 ---------- */
  function drawPointerGlow() {
    if (!pointer.active) return;

    const g = ctx.createRadialGradient(
      pointer.x, pointer.y, 0,
      pointer.x, pointer.y, POINTER_R
    );
    g.addColorStop(0, 'hsla(' + state.hue + ', 95%, 70%, 0.16)');
    g.addColorStop(1, 'hsla(' + state.hue + ', 95%, 70%, 0)');

    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(pointer.x, pointer.y, POINTER_R, 0, TAU);
    ctx.fill();
  }

  /* ---------- 绘制：爆炸涟漪 ---------- */
  function drawRipples() {
    if (ripples.length === 0) return;

    const hue = state.hue;

    for (let i = 0; i < ripples.length; i++) {
      const rp = ripples[i];
      const a = rp.life * rp.life;

      ctx.beginPath();
      ctx.arc(rp.x, rp.y, rp.r, 0, TAU);
      ctx.strokeStyle = 'hsla(' + hue + ', 95%, 72%, ' + (a * 0.7) + ')';
      ctx.lineWidth = 2.5 * rp.life;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(rp.x, rp.y, rp.r * 0.65, 0, TAU);
      ctx.strokeStyle = 'hsla(' + (hue + 30) + ', 95%, 80%, ' + (a * 0.4) + ')';
      ctx.lineWidth = 1.5 * rp.life;
      ctx.stroke();
    }
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    buildGrid();
    drawLinks();
    drawParticles();
    drawSignals();
    drawPointerGlow();
    drawRipples();
  }

  /* ---------- 帧率统计 ---------- */
  let fpsFrames = 0;
  let fpsElapsed = 0;
  let lastFpsShown = -1;

  function reportFps(fps) {
    if (fps === lastFpsShown) return;
    lastFpsShown = fps;

    ui.fps.textContent = fps + ' FPS';
    ui.fps.className =
      'fps' + (fps >= 50 ? '' : fps >= 30 ? ' mid' : ' bad');
  }

  /* ---------- 主循环 ---------- */
  let lastTime = performance.now();

  function loop(now) {
    const raw = now - lastTime;
    lastTime = now;

    if (raw > 0 && raw < 250) {
      fpsFrames++;
      fpsElapsed += raw;

      if (fpsElapsed >= 420) {
        reportFps(Math.round((fpsFrames * 1000) / fpsElapsed));
        fpsFrames = 0;
        fpsElapsed = 0;
      }
    } else {
      fpsFrames = 0;
      fpsElapsed = 0;
    }

    const dt = Math.min(raw / 16.667, 3);

    update(dt);
    draw();

    requestAnimationFrame(loop);
  }

  /* =========================================================
     场景切换
     ========================================================= */
  function applyScene(key) {
    const s = SCENES[key];
    if (!s) return;

    state.speed         = s.speed;
    state.linkDist      = s.linkDist;
    state.linkAlpha     = s.linkAlpha;
    state.swirl         = s.swirl;
    state.pulseSpeed    = s.pulseSpeed;
    state.pulseAmp      = s.pulseAmp;
    state.sizeMul       = s.sizeMul;
    state.glowMul       = s.glowMul;
    state.pulseInterval = s.pulseInterval;

    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      const sp = Math.sqrt(p.vx * p.vx + p.vy * p.vy) || 1e-4;
      const target = p.base * state.speed;
      const k = target / sp;
      p.vx *= k;
      p.vy *= k;
    }

    ui.speed.value = Math.round(s.speed * 100);
    ui.speedVal.textContent = s.speed.toFixed(1) + 'x';
    ui.link.value = s.linkDist;
    ui.linkVal.textContent = s.linkDist;

    ui.scenes.forEach(function (b) {
      b.classList.toggle('active', b.dataset.scene === key);
    });

    pulseTimer = 0.1;
    explode(W * 0.5, H * 0.5, 14);
  }

  /* =========================================================
     形状切换
     ========================================================= */
  const SHAPE_NAMES = {
    free: '自由',
    heart: '爱心',
    fireworks: '烟花'
  };

  function applyShape(key) {
    const isBuiltin = SHAPE_NAMES[key] !== undefined;
    let isCustom = false;
    for (let i = 0; i < customShapes.length; i++) {
      if (customShapes[i].id === key) { isCustom = true; break; }
    }
    if (!isBuiltin && !isCustom) return;

    state.shape = key;
    shapeTime = 0;

    const allBtns = document.querySelectorAll('.shape-btn');
    for (let i = 0; i < allBtns.length; i++) {
      allBtns[i].classList.toggle('active', allBtns[i].dataset.shape === key);
    }

    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      p.vx *= 0.4;
      p.vy *= 0.4;
    }

    updateShapeTargets();
    pulseTimer = 0.1;
  }

  /* =========================================================
     自定义形状 · 画板
     ========================================================= */
  const drawpadEl       = document.getElementById('drawpad');
  const drawpadCanvas   = document.getElementById('drawpadCanvas');
  const drawpadCtx      = drawpadCanvas ? drawpadCanvas.getContext('2d') : null;
  const drawpadClear    = document.getElementById('drawpadClear');
  const drawpadCancel   = document.getElementById('drawpadCancel');
  const drawpadDone     = document.getElementById('drawpadDone');
  const drawpadConnect  = document.getElementById('drawpadConnect');
  const customAddBtn    = document.getElementById('customAddBtn');
  const customShapesRow = document.getElementById('customShapesRow');

  function resizeDrawpad() {
    if (!drawpadCanvas) return;
    const rect = drawpadCanvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    drawState.canvasW = rect.width;
    drawState.canvasH = rect.height;
    drawpadCanvas.width = Math.floor(rect.width * dpr);
    drawpadCanvas.height = Math.floor(rect.height * dpr);
    drawpadCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function drawStrokeOnPad(points) {
    if (points.length < 2) return;
    drawpadCtx.beginPath();
    drawpadCtx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      drawpadCtx.lineTo(points[i].x, points[i].y);
    }
    drawpadCtx.stroke();
  }

  function redrawDrawpad() {
    if (!drawpadCtx) return;
    drawpadCtx.clearRect(0, 0, drawState.canvasW, drawState.canvasH);

    drawpadCtx.lineCap = 'round';
    drawpadCtx.lineJoin = 'round';
    drawpadCtx.strokeStyle = 'rgba(120, 220, 255, 0.9)';
    drawpadCtx.shadowColor = 'rgba(120, 200, 255, 0.8)';
    drawpadCtx.shadowBlur = 8;
    drawpadCtx.lineWidth = 3;

    for (let i = 0; i < drawState.strokes.length; i++) {
      drawStrokeOnPad(drawState.strokes[i].points);
    }
    if (drawState.drawing && drawState.currentStroke) {
      drawStrokeOnPad(drawState.currentStroke.points);
    }

    drawpadCtx.shadowBlur = 0;
  }

  function openDrawpad() {
    if (!drawpadEl) return;

    drawState.active = true;
    drawState.drawing = false;
    drawState.strokes = [];
    drawState.currentStroke = null;

    if (drawpadConnect) drawpadConnect.checked = false;

    drawpadEl.hidden = false;
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        drawpadEl.classList.add('show');
        resizeDrawpad();
        redrawDrawpad();
      });
    });
  }

  function closeDrawpad() {
    if (!drawpadEl) return;
    drawState.active = false;
    drawState.drawing = false;
    drawpadEl.classList.remove('show');
    setTimeout(function () {
      drawpadEl.hidden = true;
    }, 300);
  }

  function handleDrawpadResize() {
    if (!drawState.active) return;
    const oldW = drawState.canvasW || 1;
    const oldH = drawState.canvasH || 1;
    resizeDrawpad();
    const rx = drawState.canvasW / oldW;
    const ry = drawState.canvasH / oldH;
    if (rx !== 1 || ry !== 1) {
      for (let i = 0; i < drawState.strokes.length; i++) {
        const pts = drawState.strokes[i].points;
        for (let j = 0; j < pts.length; j++) {
          pts[j].x *= rx;
          pts[j].y *= ry;
        }
      }
      if (drawState.currentStroke) {
        for (let j = 0; j < drawState.currentStroke.points.length; j++) {
          drawState.currentStroke.points[j].x *= rx;
          drawState.currentStroke.points[j].y *= ry;
        }
      }
      redrawDrawpad();
    }
  }

  /* =========================================================
     自定义形状 · 按钮
     ========================================================= */
  function createCustomShapeButton(shape) {
    if (!customShapesRow) return;

    const btn = document.createElement('button');
    btn.className = 'shape-btn';
    btn.type = 'button';
    btn.dataset.shape = shape.id;
    btn.textContent = shape.name;

    let pressTimer = null;
    let longPressed = false;

    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (longPressed) {
        longPressed = false;
        return;
      }
      applyShape(shape.id);
    });

    btn.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.stopPropagation();

      longPressed = false;
      if (pressTimer) clearTimeout(pressTimer);
      pressTimer = setTimeout(function () {
        longPressed = true;
        openConfirmDelete(shape.id, shape.name);
      }, 600);
    });

    const clearPress = function () {
      if (pressTimer) {
        clearTimeout(pressTimer);
        pressTimer = null;
      }
    };

    btn.addEventListener('pointerup', clearPress);
    btn.addEventListener('pointercancel', clearPress);
    btn.addEventListener('pointerleave', clearPress);

    customShapesRow.appendChild(btn);
  }

  /* =========================================================
     删除确认弹窗
     ========================================================= */
  const confirmDialog    = document.getElementById('confirmDialog');
  const confirmShapeName = document.getElementById('confirmShapeName');
  const confirmOk        = document.getElementById('confirmOk');
  const confirmCancel    = document.getElementById('confirmCancel');

  let pendingDeleteId = null;

  function openConfirmDelete(id, name) {
    if (!confirmDialog) return;
    pendingDeleteId = id;
    confirmShapeName.textContent = '「' + name + '」将被永久删除';
    confirmDialog.hidden = false;
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        confirmDialog.classList.add('show');
      });
    });
  }

  function closeConfirmDelete() {
    if (!confirmDialog) return;
    confirmDialog.classList.remove('show');
    setTimeout(function () {
      confirmDialog.hidden = true;
    }, 300);
  }

  function deleteCustomShape(id) {
    let idx = -1;
    for (let i = 0; i < customShapes.length; i++) {
      if (customShapes[i].id === id) { idx = i; break; }
    }
    if (idx < 0) return;

    customShapes.splice(idx, 1);
    saveCustomShapes();

    if (customShapesRow) {
      const btn = customShapesRow.querySelector('[data-shape="' + id + '"]');
      if (btn) btn.remove();
    }

    if (state.shape === id) {
      applyShape('free');
    }

    showToast('已删除');
  }

  /* =========================================================
     画板事件绑定
     ========================================================= */
  function initDrawpad() {
    if (!drawpadCanvas) return;

    drawpadCanvas.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();

      const rect = drawpadCanvas.getBoundingClientRect();
      drawState.drawing = true;
      drawState.currentStroke = {
        points: [{ x: e.clientX - rect.left, y: e.clientY - rect.top }]
      };
      try { drawpadCanvas.setPointerCapture(e.pointerId); } catch (err) {}
      redrawDrawpad();
    }, { passive: false });

    drawpadCanvas.addEventListener('pointermove', function (e) {
      if (!drawState.drawing || !drawState.currentStroke) return;
      e.preventDefault();

      const rect = drawpadCanvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const pts = drawState.currentStroke.points;
      const last = pts[pts.length - 1];

      const dx = x - last.x;
      const dy = y - last.y;
      if (dx * dx + dy * dy < 4) return;

      pts.push({ x: x, y: y });
      redrawDrawpad();
    }, { passive: false });

    const finishStroke = function () {
      if (!drawState.drawing) return;
      drawState.drawing = false;
      if (drawState.currentStroke && drawState.currentStroke.points.length > 1) {
        drawState.strokes.push(drawState.currentStroke);
      }
      drawState.currentStroke = null;
      redrawDrawpad();
    };

    drawpadCanvas.addEventListener('pointerup', finishStroke);
    drawpadCanvas.addEventListener('pointercancel', finishStroke);

    if (drawpadClear) {
      drawpadClear.addEventListener('click', function () {
        drawState.strokes = [];
        drawState.currentStroke = null;
        redrawDrawpad();
      });
    }

    if (drawpadCancel) {
      drawpadCancel.addEventListener('click', function () {
        closeDrawpad();
      });
    }

    if (drawpadDone) {
      drawpadDone.addEventListener('click', function () {
        if (drawState.strokes.length === 0) {
          showToast('还没画呢');
          return;
        }

        const W0 = drawState.canvasW || 1;
        const H0 = drawState.canvasH || 1;

        const strokes = drawState.strokes.map(function (s) {
          return {
            points: s.points.map(function (pt) {
              return { x: pt.x / W0, y: pt.y / H0 };
            })
          };
        });

        const num = nextShapeNumber();
        const id = 'custom-' + Date.now() + '-' + num;
        const name = '图形 ' + num;
        const connect = drawpadConnect ? drawpadConnect.checked : false;

        const newShape = {
          id: id,
          name: name,
          strokes: strokes,
          connect: connect
        };
        customShapes.push(newShape);
        saveCustomShapes();
        createCustomShapeButton(newShape);

        closeDrawpad();

        setTimeout(function () {
          applyShape(id);
        }, 320);

        showToast('已保存：' + name);
      });
    }

    if (customAddBtn) {
      customAddBtn.addEventListener('click', function () {
        openDrawpad();
      });
    }

    if (confirmOk) {
      confirmOk.addEventListener('click', function () {
        if (pendingDeleteId) {
          deleteCustomShape(pendingDeleteId);
          pendingDeleteId = null;
        }
        closeConfirmDelete();
      });
    }

    if (confirmCancel) {
      confirmCancel.addEventListener('click', function () {
        pendingDeleteId = null;
        closeConfirmDelete();
      });
    }

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        if (confirmDialog && !confirmDialog.hidden) {
          pendingDeleteId = null;
          closeConfirmDelete();
        } else if (drawState.active) {
          closeDrawpad();
        }
      }
    });
  }

  /* =========================================================
     Toast 轻提示
     ========================================================= */
  const toastEl = document.getElementById('toast');
  let toastTimer = null;

  function showToast(text, duration) {
    if (!toastEl) return;

    duration = duration || 1800;

    if (toastTimer) {
      clearTimeout(toastTimer);
      toastTimer = null;
    }

    toastEl.textContent = text;
    toastEl.classList.add('show');

    toastTimer = setTimeout(function () {
      toastEl.classList.remove('show');
      toastTimer = null;
    }, duration);
  }

  /* =========================================================
     面板收起 / 展开
     ========================================================= */
  function initPanelToggle() {
    var panel = document.getElementById('panel');
    var btn   = document.getElementById('panelToggle');

    if (!panel || !btn) return;

    btn.onclick = function (e) {
      e.preventDefault();
      e.stopPropagation();
      panel.classList.toggle('collapsed');
    };

    btn.addEventListener('pointerdown', function (e) {
      e.stopPropagation();
    });
  }

  /* =========================================================
     反馈弹窗
     ========================================================= */
  const feedbackEl     = document.getElementById('feedback');
  const feedbackClose  = document.getElementById('feedbackClose');
  const feedbackCancel = document.getElementById('feedbackCancel');
  const feedbackCopy   = document.getElementById('feedbackCopy');
  const feedbackInput  = document.getElementById('feedbackInput');
  const feedbackMeta   = document.getElementById('feedbackMeta');

  let feedbackTimer = null;

  const SCENE_NAMES = {
    nebula: '星云', storm: '风暴', wormhole: '虫洞', firefly: '萤火虫'
  };

  function getActiveScene() {
    for (var i = 0; i < ui.scenes.length; i++) {
      if (ui.scenes[i].classList.contains('active')) {
        return ui.scenes[i].dataset.scene;
      }
    }
    return 'nebula';
  }

  function getShapeName(key) {
    if (SHAPE_NAMES[key]) return SHAPE_NAMES[key];
    for (var i = 0; i < customShapes.length; i++) {
      if (customShapes[i].id === key) return customShapes[i].name;
    }
    return key;
  }

  function getDeviceInfo() {
    var ua = navigator.userAgent;
    var browser = '未知';
    if (/Edg\//.test(ua)) browser = 'Edge';
    else if (/Chrome\//.test(ua)) browser = 'Chrome';
    else if (/Firefox\//.test(ua)) browser = 'Firefox';
    else if (/Safari\//.test(ua)) browser = 'Safari';

    var platform = '未知';
    if (isIOS()) platform = 'iOS';
    else if (/Android/.test(ua)) platform = 'Android';
    else if (/Mac/.test(ua)) platform = 'macOS';
    else if (/Windows/.test(ua)) platform = 'Windows';

    return platform + ' · ' + browser + ' · ' +
           window.innerWidth + ' × ' + window.innerHeight;
  }

  function buildMeta() {
    var scene = SCENE_NAMES[getActiveScene()] || getActiveScene();
    var shape = getShapeName(state.shape);
    return [
      '设备：' + getDeviceInfo(),
      '场景：' + scene,
      '形状：' + shape,
      '粒子：' + state.count,
      '连线：' + state.linkDist,
      '速度：' + state.speed.toFixed(1) + 'x',
      '版本：v2.3-beta'
    ].join('\n');
  }

  function openFeedback() {
    if (!feedbackEl) return;
    if (feedbackTimer) { clearTimeout(feedbackTimer); feedbackTimer = null; }

    feedbackMeta.textContent = buildMeta();
    feedbackInput.value = '';

    feedbackEl.hidden = false;
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        feedbackEl.classList.add('show');
        setTimeout(function () { feedbackInput.focus(); }, 260);
      });
    });
  }

  function closeFeedback() {
    if (!feedbackEl) return;
    feedbackEl.classList.remove('show');
    feedbackTimer = setTimeout(function () {
      feedbackEl.hidden = true;
      feedbackTimer = null;
    }, 380);
  }

  function copyToClipboard(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      ta.setAttribute('readonly', '');
      document.body.appendChild(ta);
      ta.select();
      try {
        var ok = document.execCommand('copy');
        document.body.removeChild(ta);
        ok ? resolve() : reject();
      } catch (e) {
        document.body.removeChild(ta);
        reject(e);
      }
    });
  }

  function initFeedback() {
    if (!feedbackEl) return;

    if (feedbackClose)  feedbackClose.addEventListener('click', closeFeedback);
    if (feedbackCancel) feedbackCancel.addEventListener('click', closeFeedback);

    if (feedbackCopy) {
      feedbackCopy.addEventListener('click', function () {
        var content = feedbackInput.value.trim();
        if (!content) {
          showToast('还没写内容呢');
          return;
        }

        var full = '【粒子星座反馈】\n' + content + '\n\n---\n' + buildMeta();

        copyToClipboard(full).then(function () {
          showToast('已复制，去粘贴发送吧 ✅');
          setTimeout(closeFeedback, 800);
        }).catch(function () {
          showToast('复制失败，请手动选择内容复制');
        });
      });
    }

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !feedbackEl.hidden) {
        closeFeedback();
      }
    });
  }

  /* =========================================================
     iOS 暂不支持
     ========================================================= */
  function initIOSBlock() {
    var blockEl = document.getElementById('iosBlock');
    var okBtn   = document.getElementById('iosBlockOk');

    if (!blockEl) return;

    blockEl.hidden = false;
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        blockEl.classList.add('show');
      });
    });

    function closeBlock() {
      blockEl.classList.remove('show');
      setTimeout(function () {
        blockEl.hidden = true;
      }, 380);
    }

    if (okBtn) okBtn.addEventListener('click', closeBlock);

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !blockEl.hidden) {
        closeBlock();
      }
    });
  }

  /* =========================================================
     公告
     ========================================================= */
  const noticeEl    = document.getElementById('notice');
  const noticeClose = document.getElementById('noticeClose');
  const noticeOk    = document.getElementById('noticeOk');

  let noticeTimer = null;

  function showNotice() {
    if (noticeTimer) {
      clearTimeout(noticeTimer);
      noticeTimer = null;
    }

    noticeEl.hidden = false;

    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        noticeEl.classList.add('show');
      });
    });
  }

  function hideNotice() {
    noticeEl.classList.remove('show');

    noticeTimer = setTimeout(function () {
      noticeEl.hidden = true;
      noticeTimer = null;
    }, 380);
  }

  function initNotice() {
    setTimeout(showNotice, 500);

    noticeClose.addEventListener('click', hideNotice);
    noticeOk.addEventListener('click', hideNotice);

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !noticeEl.hidden) {
        hideNotice();
      }
    });
  }

  /* ---------- 事件绑定 ---------- */
  function bindEvents() {
    window.addEventListener('resize', function () {
      resize();
      handleDrawpadResize();
    });
    window.addEventListener('orientationchange', function () {
      setTimeout(function () {
        resize();
        handleDrawpadResize();
      }, 180);
    });

    window.addEventListener('pointermove', function (e) {
      pointer.x = e.clientX;
      pointer.y = e.clientY;
      pointer.active = true;
    }, { passive: true });

    window.addEventListener('pointerdown', function (e) {
      if (e.target.closest && (
        e.target.closest('.panel') ||
        e.target.closest('.ios-block') ||
        e.target.closest('.notice') ||
        e.target.closest('.feedback') ||
        e.target.closest('.drawpad') ||
        e.target.closest('.confirm')
      )) {
        return;
      }

      if (e.pointerType === 'mouse' && e.button !== 0) return;

      pointer.x = e.clientX;
      pointer.y = e.clientY;
      pointer.active = true;
      explode(e.clientX, e.clientY, 9);
    }, { passive: true });

    window.addEventListener('pointerup', function (e) {
      if (e.pointerType === 'touch') pointer.active = false;
    }, { passive: true });

    window.addEventListener('pointercancel', function () {
      pointer.active = false;
    });

    window.addEventListener('pointerleave', function () {
      pointer.active = false;
    });

    window.addEventListener('blur', function () {
      pointer.active = false;
    });

    ui.count.addEventListener('input', function () {
      state.count = parseInt(ui.count.value, 10);
      ui.countVal.textContent = state.count;
      syncCount();

      if (state.shape !== 'free') {
        updateShapeTargets();
      }
    });

    ui.link.addEventListener('input', function () {
      state.linkDist = parseInt(ui.link.value, 10);
      ui.linkVal.textContent = state.linkDist;
    });

    ui.speed.addEventListener('input', function () {
      state.speed = parseInt(ui.speed.value, 10) / 100;
      ui.speedVal.textContent = state.speed.toFixed(1) + 'x';
    });

    ui.themes.forEach(function (btn) {
      btn.addEventListener('click', function () {
        ui.themes.forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        state.hue = parseInt(btn.dataset.hue, 10);
      });
    });

    ui.scenes.forEach(function (btn) {
      btn.addEventListener('click', function () {
        applyScene(btn.dataset.scene);
      });
    });

    var builtinShapes = document.querySelectorAll('.shape-btn:not(.shape-btn--add)');
    builtinShapes.forEach(function (btn) {
      btn.addEventListener('click', function () {
        applyShape(btn.dataset.shape);
      });
    });

    const feedbackBtn = document.getElementById('feedbackBtn');
    if (feedbackBtn) {
      feedbackBtn.addEventListener('click', openFeedback);
    }
  }

  /* ---------- 启动 ---------- */
  function init() {
    if (isSmallScreen) {
      state.count = 80;
      ui.count.value = 80;
      ui.countVal.textContent = '80';

      state.linkDist = 110;
      ui.link.value = 110;
      ui.linkVal.textContent = '110';
    }

    resize();
    syncCount();

    /* 先恢复自定义形状，再绑定按钮 */
    loadCustomShapes();
    for (let i = 0; i < customShapes.length; i++) {
      createCustomShapeButton(customShapes[i]);
    }

    bindEvents();
    initPanelToggle();
    initDrawpad();
    initFeedback();
    initNotice();

    if (isIOS()) {
      initIOSBlock();
    }

    requestAnimationFrame(loop);
  }

  init();
})();