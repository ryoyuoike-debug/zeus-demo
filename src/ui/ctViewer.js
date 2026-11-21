// =============================================================================
// 2D CT ビューア（合成ファントムの軸位断）
// ・スライススライダー / マウスホイールでスライス送り
// ・[縦隔] [肺野] のウィンドウ切替
// ・ズーム（＋/−/リセット）と、ズーム後のドラッグでパン
// ・オーバーレイ描画フック（マーカ、関心領域、ラインなど）
// =============================================================================
import { renderAxialHU, huToRGBA, WINDOWS, BODY_Z } from '../data/phantom.js';
import { h } from './dom.js';

const IMG = 256;           // HU 計算の解像度
const FOV = 380;           // 表示視野 (mm)
const CY = -6;             // 視野中心の y (mm)
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

/** 背景でスライスを少しずつ先読みする */
let prefetchQueue = [];
let prefetching = false;
export function prefetchSlices(zs) {
  prefetchQueue.push(...zs);
  if (prefetching) return;
  prefetching = true;
  const step = (deadline) => {
    while (prefetchQueue.length && (!deadline || deadline.timeRemaining() > 12)) {
      const z = prefetchQueue.shift();
      if (!huCache.has(Math.round(z * 10))) { getSlice(z); break; }
    }
    if (prefetchQueue.length) schedule(step); else prefetching = false;
  };
  const schedule = (fn) => (window.requestIdleCallback ? requestIdleCallback(fn, { timeout: 200 }) : setTimeout(() => fn(null), 30));
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
  const zoomReset = h('button', { class: 'icon-btn', title: '表示をリセット', onclick: () => { zoom = 1; panX = panY = 0; draw(); } }, '⟲');

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
    ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    ctx.fillStyle = 'rgba(210,230,255,0.85)';
    ctx.textBaseline = 'top';
    const idx = zToSliceIndex(z) + 1;
    ctx.textAlign = 'left';
    if (opts.patientLabel) ctx.fillText(opts.patientLabel, 8, 8);
    ctx.fillText('合成ファントム（デモ）', 8, opts.patientLabel ? 22 : 8);
    ctx.textAlign = 'right';
    ctx.fillText(`Im ${idx}/${SLICE_COUNT}`, cw - 8, 8);
    ctx.fillText(`Z ${z.toFixed(1)} mm`, cw - 8, 22);
    ctx.textBaseline = 'bottom';
    const wdef = WINDOWS[win];
    ctx.fillText(`W ${wdef.ww}  L ${wdef.wl}`, cw - 8, ch - 8);
    ctx.textAlign = 'left';
    ctx.fillText(`${wdef.name}条件  ×${zoom.toFixed(2)}`, 8, ch - 8);
    // 方向ラベル
    ctx.fillStyle = 'rgba(255,200,80,0.9)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 12px system-ui, sans-serif';
    ctx.fillText('A', cw / 2, 12);
    ctx.fillText('P', cw / 2, ch - 12);
    ctx.fillText('R', 12, ch / 2);
    ctx.fillText('L', cw - 12, ch / 2);
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
    win = w;
    winBtns.forEach((b) => b.classList.toggle('is-on', b.dataset.win === w));
    requestDraw();
  }
  function setZoom(zm) {
    zoom = Math.max(1, Math.min(6, zm));
    if (zoom === 1) { panX = panY = 0; }
    requestDraw();
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
    setZ,
    setWindow,
    setZoom,
    setInteraction(m) { interaction = m; },
    worldToCanvas,
    canvasToWorld,
    mmToPx,
    redraw: requestDraw,
    drawNow: draw,
    addOverlay(fn) { overlays.add(fn); requestDraw(); return () => { overlays.delete(fn); requestDraw(); }; },
    onSliceChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    dispose() { ro.disconnect(); overlays.clear(); listeners.clear(); root.remove(); },
  };
  return api;
}
