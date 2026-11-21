// =============================================================================
// 端末への転送 — PC から各端末へ流れるデータ粒子のアニメーション（canvas 2D）
//   ・ケーブル: 未接続 = 破線（薄いグレー）／検出中 = 動く破線（琥珀）／接続済み = 青／転送済み = 緑
//   ・転送中は、PC のポートから端末へ粒子（小さなデータ片）が流れる
//   ・接続済みのケーブルには、ときどき小さな光が流れる（待機中の演出）
// 位置は毎フレーム DOM の位置から計算するので、レイアウトが変わっても追従します。
// =============================================================================

const COLORS = {
  off: 'rgba(111, 127, 153, 0.38)',
  detecting: 'rgba(255, 178, 107, 0.9)',
  on: [89, 168, 255],
  done: [74, 222, 128],
};

/**
 * @param {object} o
 * @param {HTMLElement} o.stage   キャンバスを敷く要素（position: relative）
 * @param {HTMLElement} o.startEl PC 側のポート要素
 * @param {Map<string, HTMLElement>} o.targets 端末 ID → カード要素
 * @param {(id:string)=>string} o.getStatus 'off'|'detecting'|'connected'|'sending'|'done'
 * @param {AbortSignal} o.signal
 */
export function createFlow({ stage, startEl, targets, getStatus, signal }) {
  const canvas = document.createElement('canvas');
  canvas.className = 'tf-flow-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  stage.prepend(canvas);
  const g = canvas.getContext('2d');
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  let W = 0, H = 0, dpr = 1;
  let raf = 0, last = performance.now(), time = 0;
  /** @type {{id:string,t:number,v:number,off:number,size:number,white:boolean,square:boolean}[]} */
  const particles = [];
  const flashes = []; // {id, age, rgb}
  const sending = new Map(); // id -> spawn accumulator
  const ids = [...targets.keys()];

  // ---------------------------------------------------------------------
  // 幾何
  // ---------------------------------------------------------------------
  function bez(p, t) {
    const u = 1 - t;
    const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
    return { x: a * p.S.x + b * p.c1.x + c * p.c2.x + d * p.E.x, y: a * p.S.y + b * p.c1.y + c * p.c2.y + d * p.E.y };
  }
  function bezTan(p, t) {
    const u = 1 - t;
    const x = 3 * u * u * (p.c1.x - p.S.x) + 6 * u * t * (p.c2.x - p.c1.x) + 3 * t * t * (p.E.x - p.c2.x);
    const y = 3 * u * u * (p.c1.y - p.S.y) + 6 * u * t * (p.c2.y - p.c1.y) + 3 * t * t * (p.E.y - p.c2.y);
    const l = Math.hypot(x, y) || 1;
    return { x: x / l, y: y / l };
  }
  function geometry() {
    const sr = stage.getBoundingClientRect();
    const pr = startEl.getBoundingClientRect();
    if (!sr.width || !pr.width) return null;
    const S0 = { x: pr.left + pr.width / 2 - sr.left, y: pr.top + pr.height / 2 - sr.top };
    const paths = new Map();
    const n = ids.length;
    ids.forEach((id, i) => {
      const r = targets.get(id).getBoundingClientRect();
      const E = { x: r.left - sr.left - 1, y: r.top + r.height / 2 - sr.top };
      const off = (i - (n - 1) / 2) * 4;
      const S = { x: S0.x, y: S0.y + off };
      const dx = Math.max(30, E.x - S.x);
      const c1 = { x: S.x + dx * 0.48, y: S.y };
      const c2 = { x: E.x - dx * 0.52, y: E.y };
      paths.set(id, { S, c1, c2, E });
    });
    return { w: sr.width, h: sr.height, paths, S0 };
  }
  function resize(w, h) {
    const nd = Math.min(2, window.devicePixelRatio || 1);
    if (Math.round(w * nd) !== canvas.width || Math.round(h * nd) !== canvas.height || nd !== dpr) {
      dpr = nd; W = w; H = h;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    W = w; H = h;
  }

  // ---------------------------------------------------------------------
  // 描画
  // ---------------------------------------------------------------------
  function strokePath(p) {
    g.beginPath();
    g.moveTo(p.S.x, p.S.y);
    g.bezierCurveTo(p.c1.x, p.c1.y, p.c2.x, p.c2.y, p.E.x, p.E.y);
    g.stroke();
  }
  const rgba = (rgb, a) => `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${a})`;

  function drawCable(p, status, i) {
    g.save();
    g.lineCap = 'round';
    if (status === 'off') {
      g.setLineDash([2, 6]);
      g.strokeStyle = COLORS.off;
      g.lineWidth = 1.4;
      strokePath(p);
    } else if (status === 'detecting') {
      g.setLineDash([6, 7]);
      g.lineDashOffset = -time * 40;
      g.strokeStyle = COLORS.detecting;
      g.lineWidth = 1.6;
      strokePath(p);
    } else {
      const rgb = status === 'done' ? COLORS.done : COLORS.on;
      const hot = status === 'sending';
      g.strokeStyle = rgba(rgb, hot ? 0.22 : 0.13);
      g.lineWidth = hot ? 9 : 7;
      strokePath(p);
      g.strokeStyle = rgba(rgb, hot ? 0.95 : 0.75);
      g.lineWidth = hot ? 2.2 : 1.7;
      strokePath(p);
      // 待機中: ときどき小さな光が流れる
      if (!hot && !reduce) {
        const period = 3.2;
        const t = (((time + i * 0.9) % period) / 1.5);
        if (t <= 1) {
          const q = bez(p, t);
          const a = Math.sin(Math.PI * t) * 0.9;
          g.globalCompositeOperation = 'lighter';
          g.fillStyle = rgba(rgb, a * 0.35);
          g.beginPath(); g.arc(q.x, q.y, 5, 0, Math.PI * 2); g.fill();
          g.fillStyle = `rgba(255,255,255,${a * 0.9})`;
          g.beginPath(); g.arc(q.x, q.y, 1.6, 0, Math.PI * 2); g.fill();
        }
      }
    }
    g.restore();
    // 端末側のプラグ
    const plugCol = status === 'off' ? '#31456c' : status === 'detecting' ? '#ffb26b' : status === 'done' ? '#4ade80' : '#59a8ff';
    g.fillStyle = plugCol;
    roundRect(p.E.x - 9, p.E.y - 3.5, 9, 7, 2);
    g.fill();
  }
  function roundRect(x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  function drawHub(S0, anyOn, anySending) {
    g.save();
    g.globalCompositeOperation = 'lighter';
    const r = anySending ? 7 + Math.sin(time * 12) * 1.5 : 5;
    const grad = g.createRadialGradient(S0.x, S0.y, 0, S0.x, S0.y, r * 3);
    const c = anyOn ? (anySending ? [255, 170, 90] : COLORS.on) : [111, 127, 153];
    grad.addColorStop(0, rgba(c, anyOn ? 0.75 : 0.35));
    grad.addColorStop(1, rgba(c, 0));
    g.fillStyle = grad;
    g.beginPath(); g.arc(S0.x, S0.y, r * 3, 0, Math.PI * 2); g.fill();
    g.restore();
  }

  function spawn(id, dt) {
    const rate = reduce ? 14 : 75; // 個/秒
    let acc = (sending.get(id) || 0) + rate * dt;
    while (acc >= 1) {
      acc -= 1;
      particles.push({
        id,
        t: Math.random() * 0.04,
        v: 0.95 + Math.random() * 0.75,
        off: (Math.random() - 0.5) * 9,
        size: 0.9 + Math.random() * 1.7,
        white: Math.random() < 0.22,
        square: Math.random() < 0.18,
      });
    }
    sending.set(id, acc);
  }

  function drawParticles(paths, dt) {
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (let k = particles.length - 1; k >= 0; k--) {
      const q = particles[k];
      q.t += q.v * dt;
      const p = paths.get(q.id);
      if (!p || q.t >= 1) {
        particles.splice(k, 1);
        continue;
      }
      const spread = Math.sin(Math.PI * q.t);
      const pos = bez(p, q.t);
      const tan = bezTan(p, q.t);
      const nx = -tan.y, ny = tan.x;
      const x = pos.x + nx * q.off * spread;
      const y = pos.y + ny * q.off * spread;
      const t0 = Math.max(0, q.t - 0.045);
      const tail = bez(p, t0);
      const tx = tail.x + nx * q.off * Math.sin(Math.PI * t0);
      const ty = tail.y + ny * q.off * Math.sin(Math.PI * t0);
      const fade = Math.min(1, q.t * 8, (1 - q.t) * 6);
      // 尾
      g.strokeStyle = `rgba(89, 168, 255, ${0.35 * fade})`;
      g.lineWidth = q.size;
      g.beginPath(); g.moveTo(tx, ty); g.lineTo(x, y); g.stroke();
      // 光の粒
      g.fillStyle = `rgba(89, 168, 255, ${0.28 * fade})`;
      g.beginPath(); g.arc(x, y, q.size * 2.6, 0, Math.PI * 2); g.fill();
      g.fillStyle = q.white ? `rgba(255,255,255,${0.95 * fade})` : `rgba(160, 210, 255, ${0.95 * fade})`;
      if (q.square) {
        const s = q.size * 1.6;
        g.save(); g.translate(x, y); g.rotate(Math.atan2(tan.y, tan.x)); g.fillRect(-s, -s / 2, s * 2, s); g.restore();
      } else {
        g.beginPath(); g.arc(x, y, q.size, 0, Math.PI * 2); g.fill();
      }
    }
    g.restore();
  }

  function drawFlashes(paths, dt) {
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (let k = flashes.length - 1; k >= 0; k--) {
      const f = flashes[k];
      f.age += dt;
      const u = f.age / 0.7;
      const p = paths.get(f.id);
      if (!p || u >= 1) { flashes.splice(k, 1); continue; }
      const r = 4 + u * 26;
      g.strokeStyle = rgba(f.rgb, (1 - u) * 0.9);
      g.lineWidth = 2.2 * (1 - u) + 0.5;
      g.beginPath(); g.arc(p.E.x - 4, p.E.y, r, 0, Math.PI * 2); g.stroke();
    }
    g.restore();
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    time += dt;
    if (canvas.offsetParent === null) return; // 非表示（狭い画面など）
    const geo = geometry();
    if (!geo) return;
    resize(geo.w, geo.h);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    let anyOn = false, anySending = false;
    ids.forEach((id, i) => {
      const st = getStatus(id);
      if (st !== 'off' && st !== 'detecting') anyOn = true;
      if (st === 'sending') anySending = true;
      drawCable(geo.paths.get(id), st, i);
    });
    drawHub(geo.S0, anyOn, anySending);
    for (const id of sending.keys()) spawn(id, dt);
    drawParticles(geo.paths, dt);
    drawFlashes(geo.paths, dt);
  }
  raf = requestAnimationFrame(frame);

  function destroy() {
    cancelAnimationFrame(raf);
    particles.length = 0;
    canvas.remove();
  }
  signal.addEventListener('abort', destroy, { once: true });

  return {
    /** 転送中の粒子を流す／止める */
    setSending(id, on) {
      if (on) sending.set(id, 0);
      else sending.delete(id);
    },
    /** 端末側で光の輪を広げる（接続・転送完了の合図） */
    flash(id, kind = 'done') {
      flashes.push({ id, age: 0, rgb: kind === 'done' ? COLORS.done : COLORS.on });
    },
    destroy,
  };
}
