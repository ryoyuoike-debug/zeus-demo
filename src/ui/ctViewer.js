// =============================================================================
// 2D CT ビューア（合成ファントムの軸位断）
// ・スライススライダー / マウスホイールでスライス送り
// ・[縦隔] [肺野] のウィンドウ切替
// ・ズーム（＋/−/リセット）と、ズーム後のドラッグでパン
// ・オーバーレイ描画フック（マーカ、関心領域、ラインなど）
// =============================================================================
import { renderAxialHU, renderAxialHURows, huToRGBA, WINDOWS, BODY_Z } from '../data/phantom.js';
import { h } from './dom.js';

const IMG = 256;           // HU 計算の解像度
const FOV = 380;           // 表示視野 (mm)
const CY = -6;             // 視野中心の y (mm)
/** 画像の範囲（患者座標 mm）。オーバーレイを画像全体に重ねるときに使う。 */
export const CT_IMAGE = Object.freeze({ size: IMG, fov: FOV, cx: 0, cy: CY });
export const SLICE_STEP = 2;
export const Z_MIN = BODY_Z[0] + 3;
export const Z_MAX = BODY_Z[1] - 3;
export const SLICE_COUNT = Math.floor((Z_MAX - Z_MIN) / SLICE_STEP) + 1;

const huCache = new Map();
const CACHE_MAX = 120;
function getSlice(z) {
  const key = Math.round(z * 10);
  let hu = huCache.get(key);
  if (hu) { huCache.delete(key); huCache.set(key, hu); return hu; }
  hu = renderAxialHU(z, IMG, FOV);
  huCache.set(key, hu);
  if (huCache.size > CACHE_MAX) huCache.delete(huCache.keys().next().value);
  return hu;
}
export function sliceIndexToZ(i) { return Z_MAX - i * SLICE_STEP; }
export function zToSliceIndex(z) { return Math.round((Z_MAX - z) / SLICE_STEP); }

/**
 * 背景でスライスを少しずつ先読みする。
 * 1 枚の計算（40〜190 ms）をそのまま行うと 3D のアニメーションがカクつくので、
 * 数行ずつ（1 回あたり約 6 ms まで）に分けて計算する。
 */
let prefetchQueue = [];
let prefetching = false;
let partial = null; // { key, z, out, row }
const BUDGET_MS = 6;
export function prefetchSlices(zs) {
  prefetchQueue.push(...zs);
  if (prefetching) return;
  prefetching = true;
  const step = () => {
    const t0 = performance.now();
    while (performance.now() - t0 < BUDGET_MS) {
      if (!partial) {
        // 次の未計算スライスを探す
        while (prefetchQueue.length && huCache.has(Math.round(prefetchQueue[0] * 10))) prefetchQueue.shift();
        if (!prefetchQueue.length) break;
        const z = prefetchQueue.shift();
        partial = { key: Math.round(z * 10), z, out: new Float32Array(IMG * IMG), row: 0 };
      }
      if (huCache.has(partial.key)) { partial = null; continue; } // 途中で表示用に計算済みになった
      const rows = Math.min(IMG - partial.row, 8);
      renderAxialHURows(partial.z, IMG, FOV, partial.out, partial.row, partial.row + rows);
      partial.row += rows;
      if (partial.row >= IMG) {
        huCache.set(partial.key, partial.out);
        if (huCache.size > CACHE_MAX) huCache.delete(huCache.keys().next().value);
        partial = null;
      }
    }
    if (prefetchQueue.length || partial) schedule(step); else prefetching = false;
  };
  const schedule = (fn) => (window.requestIdleCallback ? requestIdleCallback(fn, { timeout: 500 }) : setTimeout(fn, 30));
  schedule(step);
}

/**
 * @param {HTMLElement} container
 * @param {{z?: number, window?: 'mediastinum'|'lung', showControls?: boolean, patientLabel?: string,
 *          onSliceChange?: (z:number)=>void, interaction?: 'pan'|'custom', compact?: boolean}} [opts]
 */
export function createCtViewer(container, opts = {}) {
  let z = opts.z ?? 40;
  let win = opts.window ?? 'mediastinum';
  let zoom = 1, panX = 0, panY = 0;
  let interaction = opts.interaction ?? 'pan';
  const overlays = new Set();
  const listeners = new Set();
  const winListeners = new Set();
  if (opts.onSliceChange) listeners.add(opts.onSliceChange);

  const canvas = h('canvas', { class: 'ct-canvas' });
  const ctx = canvas.getContext('2d');
  const off = document.createElement('canvas');
  off.width = IMG; off.height = IMG;
  const offCtx = off.getContext('2d');
  const imgData = offCtx.createImageData(IMG, IMG);

  const slider = h('input', { type: 'range', min: 0, max: SLICE_COUNT - 1, step: 1, value: zToSliceIndex(z), class: 'ct-slider', 'aria-label': 'スライス位置' });
  const winBtns = ['mediastinum', 'lung'].map((w) =>
    h('button', { class: 'seg-btn' + (w === win ? ' is-on' : ''), 'data-win': w, onclick: () => setWindow(w) }, WINDOWS[w].name));
  const zoomIn = h('button', { class: 'icon-btn', title: '拡大', onclick: () => setZoom(zoom * 1.25) }, '＋');
  const zoomOut = h('button', { class: 'icon-btn', title: '縮小', onclick: () => setZoom(zoom / 1.25) }, '－');
  const zoomReset = h('button', { class: 'icon-btn', title: '表示をリセット', onclick: () => { stopAnim(); zoom = 1; panX = panY = 0; draw(); } }, '⟲');

  const controls = h('div', { class: 'ct-controls' + (opts.compact ? ' is-compact' : '') },
    h('div', { class: 'seg' }, ...winBtns),
    h('div', { class: 'ct-slider-wrap' }, h('span', { class: 'ct-slider-label' }, 'スライス'), slider),
    h('div', { class: 'ct-zoom' }, zoomOut, zoomIn, zoomReset));
  const stage = h('div', { class: 'ct-stage' }, canvas);
  const root = h('div', { class: 'ct-viewer' }, stage, opts.showControls === false ? null : controls);
  container.appendChild(root);

  // ---- 座標変換 ----
  function layout() {
    const w = canvas.width, hgt = canvas.height;
    const base = Math.min(w, hgt);
    const size = base * zoom;
    return { x: (w - size) / 2 + panX * devicePixelRatio, y: (hgt - size) / 2 + panY * devicePixelRatio, size };
  }
  /** 患者座標 (x, y) → キャンバス上の CSS ピクセル */
  function worldToCanvas(x, y) {
    const L = layout();
    const u = (x + FOV / 2) / FOV;              // 画像左 = 患者右
    const v = (CY + FOV / 2 - y) / FOV;          // 画像上 = 前
    return { x: (L.x + u * L.size) / devicePixelRatio, y: (L.y + v * L.size) / devicePixelRatio };
  }
  /** キャンバス上の CSS ピクセル → 患者座標 */
  function canvasToWorld(px, py) {
    const L = layout();
    const u = (px * devicePixelRatio - L.x) / L.size;
    const v = (py * devicePixelRatio - L.y) / L.size;
    return { x: u * FOV - FOV / 2, y: CY + FOV / 2 - v * FOV, z };
  }
  /** mm → CSS ピクセル */
  function mmToPx(mm) { return (mm / FOV) * layout().size / devicePixelRatio; }

  // ---- 描画 ----
  let lowRes = false;
  function draw() {
    const W = Math.max(1, Math.round(stage.clientWidth * devicePixelRatio));
    const H = Math.max(1, Math.round(stage.clientHeight * devicePixelRatio));
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    const hu = getSlice(z);
    const wdef = WINDOWS[win];
    huToRGBA(hu, wdef.ww, wdef.wl, imgData.data);
    offCtx.putImageData(imgData, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    const L = layout();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = lowRes ? 'low' : 'high';
    ctx.drawImage(off, L.x, L.y, L.size, L.size);
    // オーバーレイは CSS ピクセル座標で描く
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    for (const fn of overlays) {
      ctx.save();
      try { fn(ctx, api); } catch (e) { console.error(e); }
      ctx.restore();
    }
    drawCorners();
  }
  function drawCorners() {
    const cw = canvas.width / devicePixelRatio, ch = canvas.height / devicePixelRatio;
    // 明るい部分に重なっても読めるよう、文字に暗い縁取りを付ける
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    const text = (s, x, y) => { ctx.strokeText(s, x, y); ctx.fillText(s, x, y); };
    ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    ctx.fillStyle = 'rgba(210,230,255,0.9)';
    ctx.textBaseline = 'top';
    const idx = zToSliceIndex(z) + 1;
    ctx.textAlign = 'left';
    if (opts.patientLabel) text(opts.patientLabel, 8, 8);
    text('合成ファントム（デモ）', 8, opts.patientLabel ? 22 : 8);
    ctx.textAlign = 'right';
    text(`Im ${idx}/${SLICE_COUNT}`, cw - 8, 8);
    text(`Z ${z.toFixed(1)} mm`, cw - 8, 22);
    ctx.textBaseline = 'bottom';
    const wdef = WINDOWS[win];
    text(`W ${wdef.ww}  L ${wdef.wl}`, cw - 8, ch - 8);
    ctx.textAlign = 'left';
    text(`${wdef.name}条件  ×${zoom.toFixed(2)}`, 8, ch - 8);
    // 方向ラベル
    ctx.fillStyle = 'rgba(255,200,80,0.95)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 12px system-ui, sans-serif';
    text('A', cw / 2, 12);
    text('P', cw / 2, ch - 12);
    text('R', 12, ch / 2);
    text('L', cw - 12, ch / 2);
  }

  let pending = false;
  function requestDraw() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; draw(); });
  }

  // ---- 操作 ----
  function setZ(nz, { silent = false } = {}) {
    nz = Math.max(Z_MIN, Math.min(Z_MAX, nz));
    nz = sliceIndexToZ(zToSliceIndex(nz));
    if (nz === z) return;
    z = nz;
    slider.value = zToSliceIndex(z);
    requestDraw();
    if (!silent) for (const l of listeners) l(z);
  }
  function setWindow(w) {
    if (!WINDOWS[w]) return;
    const changed = w !== win;
    win = w;
    winBtns.forEach((b) => b.classList.toggle('is-on', b.dataset.win === w));
    requestDraw();
    if (changed) for (const l of winListeners) l(win);
  }
  function setZoom(zm) {
    stopAnim();
    zoom = Math.max(1, Math.min(6, zm));
    if (zoom === 1) { panX = panY = 0; }
    requestDraw();
  }
  /** 表示中のキャンバスの大きさ（CSS ピクセル） */
  function stageSize() {
    return { w: Math.max(1, stage.clientWidth), h: Math.max(1, stage.clientHeight) };
  }
  /** 指定の倍率で、患者座標 (cx, cy) が表示の中央に来るパン量（CSS ピクセル） */
  function panFor(zm, cx, cy) {
    const { w, h: hh } = stageSize();
    const size = Math.min(w, hh) * zm;
    const u = (cx + FOV / 2) / FOV;
    const v = (CY + FOV / 2 - cy) / FOV;
    return { x: size * (0.5 - u), y: size * (0.5 - v) };
  }
  let anim = 0;
  function stopAnim() { if (anim) cancelAnimationFrame(anim); anim = 0; }
  /**
   * 表示の倍率と中心を指定する。centerX / centerY は患者座標 (mm)。
   * ms を指定するとなめらかに移動する。
   */
  function setView({ zoom: zm = zoom, centerX = null, centerY = null, ms = 0 } = {}) {
    stopAnim();
    const z1 = Math.max(1, Math.min(6, zm));
    const target = centerX == null || centerY == null || z1 === 1 ? { x: 0, y: 0 } : panFor(z1, centerX, centerY);
    if (!(ms > 0)) {
      zoom = z1; panX = target.x; panY = target.y;
      requestDraw();
      return;
    }
    const from = { zoom, x: panX, y: panY };
    const t0 = performance.now();
    const tick = () => {
      const u = Math.min(1, (performance.now() - t0) / ms);
      const e = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
      zoom = from.zoom + (z1 - from.zoom) * e;
      panX = from.x + (target.x - from.x) * e;
      panY = from.y + (target.y - from.y) * e;
      draw();
      anim = u < 1 ? requestAnimationFrame(tick) : 0;
    };
    anim = requestAnimationFrame(tick);
  }
  slider.addEventListener('input', () => setZ(sliceIndexToZ(+slider.value)));
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) setZoom(zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
    else setZ(z + (e.deltaY > 0 ? -SLICE_STEP : SLICE_STEP));
  }, { passive: false });

  let drag = null;
  canvas.addEventListener('pointerdown', (e) => {
    if (interaction !== 'pan' || zoom <= 1) return;
    stopAnim();
    drag = { x: e.clientX, y: e.clientY, px: panX, py: panY };
    canvas.setPointerCapture(e.pointerId);
    canvas.style.cursor = 'grabbing';
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    panX = drag.px + (e.clientX - drag.x);
    panY = drag.py + (e.clientY - drag.y);
    requestDraw();
  });
  const endDrag = () => { drag = null; canvas.style.cursor = ''; };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  const ro = new ResizeObserver(() => requestDraw());
  ro.observe(stage);
  draw();
  // 現在位置の前後を先読み
  const i0 = zToSliceIndex(z);
  prefetchSlices(Array.from({ length: 24 }, (_, k) => sliceIndexToZ(Math.max(0, Math.min(SLICE_COUNT - 1, i0 + (k % 2 ? 1 : -1) * Math.ceil(k / 2))))));

  const api = {
    el: root,
    canvas,
    get z() { return z; },
    get window() { return win; },
    get zoom() { return zoom; },
    /** 現在の表示中心（患者座標 mm） */
    get center() { const { w, h: hh } = stageSize(); return canvasToWorld(w / 2, hh / 2); },
    setZ,
    setWindow,
    setZoom,
    setView,
    /** 画像の範囲（患者座標 mm）: { size, fov, cx, cy } */
    imageRect: () => CT_IMAGE,
    setInteraction(m) { interaction = m; },
    worldToCanvas,
    canvasToWorld,
    mmToPx,
    redraw: requestDraw,
    drawNow: draw,
    addOverlay(fn) { overlays.add(fn); requestDraw(); return () => { overlays.delete(fn); requestDraw(); }; },
    onSliceChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    /** [縦隔]/[肺野] の切り替えを購読。戻り値で解除。 */
    onWindowChange(fn) { winListeners.add(fn); return () => winListeners.delete(fn); },
    dispose() { stopAnim(); ro.disconnect(); overlays.clear(); listeners.clear(); winListeners.clear(); root.remove(); },
  };
  return api;
}
