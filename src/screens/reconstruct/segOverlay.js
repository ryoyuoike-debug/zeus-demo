// =============================================================================
// 3D構成：CT（軸位断）に「抽出結果」を色で重ねるオーバーレイ
// -----------------------------------------------------------------------------
// ファントムの形状関数から、スライスごとに構造のラベル画像を作ります。
// 計算は 1 スライス 数十 ms かかるため、アイドル時間に少しずつ（行単位で）進め、
// スライス位置ごとにキャッシュします。抽出済みの構造だけを着色します。
// =============================================================================
import {
  SEGMENTS, segDist, sdBody, sdSternum, sdSpine, sdHeart, sdLung, sdLiver, sdStomach, diaphragmZ, SPINAL_CORD,
} from '../../data/phantom.js';
import { SLICE_STEP } from '../../ui/ctViewer.js';
import { CHECKLIST, KEY_OF_ID } from './pipeline.js';

const N = 192;          // ラベル画像の解像度
const FOV = 380;        // ラベル画像が覆う範囲（mm）。表示位置は CT ビューアの worldToCanvas で合わせる
const CY = -6;          // 範囲の中心（前後方向, mm）
const PX = FOV / N;

// ラベル番号 → 構造 id
const LABEL_IDS = ['', 'skin', 'lung_r', 'lung_l', 'heart', 'aorta', 'vein', 'pa', 'pv', 'trachea', 'bronchus',
  'esophagus', 'rib', 'cartilage', 'sternum', 'clavicle', 'spine', 'cord', 'liver', 'stomach'];
const LABEL_OF = Object.fromEntries(LABEL_IDS.map((id, i) => [id, i]));
const SKIN = LABEL_OF.skin;
const COLOR_OF_KEY = Object.fromEntries(CHECKLIST.map((c) => [c.key, c.color]));
// ラベルごとの塗りの濃さ（肺は広いので薄く）
const FILL_ALPHA = { lung_r: 0.17, lung_l: 0.17, liver: 0.26, stomach: 0.26, heart: 0.3, spine: 0.34, sternum: 0.36 };
const LABEL_RGB = LABEL_IDS.map((id) => {
  if (!id) return [0, 0, 0];
  const hex = COLOR_OF_KEY[KEY_OF_ID[id]] || '#ffffff';
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
});

// ラベル画像はスライス位置だけで決まるので、画面を開き直しても使えるようモジュールで保持する
const cache = new Map(); // zKey → Uint8Array（最大 60 枚 ≒ 2 MB）
const CACHE_MAX = 60;

/** 1 点のラベル（CT 値の判定と同じ優先順位） */
function labelAt(x, y, z, segs) {
  const dB = sdBody(x, y, z);
  if (dB > 0) return 0;
  if (dB > -11) return SKIN;
  let best = 0, hit = null;
  for (const s of segs) {
    if (x < s.xmin || x > s.xmax || y < s.ymin || y > s.ymax) continue;
    const d = segDist(s, x, y, z);
    if (d < best) { best = d; hit = s; }
  }
  if (hit) return LABEL_OF[hit.structure] || SKIN;
  if (sdSternum(x, y, z) < 0) return LABEL_OF.sternum;
  if (sdSpine(x, y, z) < 0) return LABEL_OF.spine;
  if (Math.hypot(x - SPINAL_CORD.c[0], y - SPINAL_CORD.c[1]) < SPINAL_CORD.r + 3 && dB < -30) return LABEL_OF.cord;
  if (dB > -24) return SKIN;
  if (sdHeart(x, y, z) < 0) return LABEL_OF.heart;
  if (z > diaphragmZ(x, y) - 4) {
    // 結節は肺の内側にあるので肺として塗られる（病変の検出結果としては表示しない）
    if (x < 0 ? sdLung('right', x, y, z) < 0 : false) return LABEL_OF.lung_r;
    if (x > 0 ? sdLung('left', x, y, z) < 0 : false) return LABEL_OF.lung_l;
    return SKIN;
  }
  if (sdLiver(x, y, z) < 0) return LABEL_OF.liver;
  if (sdStomach(x, y, z) < 0) return LABEL_OF.stomach;
  return SKIN;
}

/**
 * @param {ReturnType<import('../../ui/ctViewer.js').createCtViewer>} ct
 * @param {{ isVisible: (key:string)=>boolean, signal: AbortSignal }} opts
 */
export function createSegOverlay(ct, { isVisible, signal }) {
  let enabled = true;
  let job = null;          // { key, z, row, data, segs }
  let timer = 0;
  let version = 0;         // 表示する構造の組が変わったら増やす
  const off = document.createElement('canvas');
  off.width = off.height = N;
  const offCtx = off.getContext('2d');
  const img = offCtx.createImageData(N, N);
  let painted = { key: null, version: -1 };
  let debounce = 0;

  const keyOf = (z) => Math.round(z * 10);
  const queue = []; // 先読みするスライス位置

  function startJob(z) {
    const key = keyOf(z);
    if (cache.has(key) || (job && job.key === key)) return;
    job = { key, z, row: 0, data: new Uint8Array(N * N), segs: SEGMENTS.filter((s) => z >= s.zmin && z <= s.zmax) };
    schedule();
  }
  /** 次の計算：表示中のスライスを最優先、次に先読みの列 */
  function next() {
    if (job) return;
    if (!cache.has(keyOf(ct.z))) { startJob(ct.z); return; }
    while (queue.length) {
      const z = queue.shift();
      if (!cache.has(keyOf(z))) { startJob(z); return; }
    }
  }
  function prefetch(zs) {
    for (const z of zs) if (!cache.has(keyOf(z)) && !queue.some((q) => keyOf(q) === keyOf(z))) queue.push(z);
    next();
  }
  function schedule() {
    if (timer || signal.aborted) return;
    timer = setTimeout(step, 16);
  }
  function step() {
    timer = 0;
    if (!job || signal.aborted) return;
    const t0 = performance.now();
    const { z, data, segs } = job;
    while (job.row < N && performance.now() - t0 < 7) {
      const j = job.row++;
      const y = CY + FOV / 2 - (j + 0.5) * PX;
      for (let i = 0; i < N; i++) {
        const x = -FOV / 2 + (i + 0.5) * PX;
        data[j * N + i] = labelAt(x, y, z, segs);
      }
    }
    if (job.row >= N) {
      cache.set(job.key, data);
      if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
      const done = job;
      job = null;
      if (keyOf(ct.z) === done.key) {
        ct.redraw();
        // 前後のスライスも用意しておく（スクロールしても色が途切れにくい）
        prefetch([1, -1, 2, -2, 3, -3].map((k) => done.z + k * SLICE_STEP));
      } else next();
    } else schedule();
  }

  /** ラベル画像を着色して offscreen canvas に描く */
  function paint(key, labels) {
    if (painted.key === key && painted.version === version) return;
    painted = { key, version };
    const d = img.data;
    const vis = LABEL_IDS.map((id) => !!id && isVisible(KEY_OF_ID[id]));
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const p = j * N + i;
        const L = labels[p];
        const o = p * 4;
        if (!L || !vis[L]) { d[o + 3] = 0; continue; }
        const l = i > 0 ? labels[p - 1] : 0, r = i < N - 1 ? labels[p + 1] : 0;
        const u = j > 0 ? labels[p - N] : 0, dn = j < N - 1 ? labels[p + N] : 0;
        let a;
        if (L === SKIN) {
          // 体表は外形の線だけ
          a = l === 0 || r === 0 || u === 0 || dn === 0 ? 0.8 : 0;
        } else {
          const edge = l !== L || r !== L || u !== L || dn !== L;
          a = edge ? 0.95 : (FILL_ALPHA[LABEL_IDS[L]] ?? 0.4);
        }
        const c = LABEL_RGB[L];
        d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = Math.round(a * 255);
      }
    }
    offCtx.putImageData(img, 0, 0);
  }

  function draw(g, api) {
    if (!enabled) return;
    const key = keyOf(api.z);
    const labels = cache.get(key);
    if (!labels) {
      clearTimeout(debounce);
      debounce = setTimeout(() => { if (!job || job.key !== keyOf(ct.z)) { job = null; clearTimeout(timer); timer = 0; startJob(ct.z); } }, 60);
      return;
    }
    paint(key, labels);
    const a = api.worldToCanvas(-FOV / 2, CY + FOV / 2);
    const b = api.worldToCanvas(FOV / 2, CY - FOV / 2);
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(off, a.x, a.y, b.x - a.x, b.y - a.y);
  }
  const removeOverlay = ct.addOverlay(draw);
  startJob(ct.z);

  return {
    get enabled() { return enabled; },
    setEnabled(v) { enabled = v; ct.redraw(); },
    /** 表示する構造の組が変わったとき */
    refresh() { version++; ct.redraw(); },
    /** 指定したスライス位置のラベルを先に計算しておく */
    prefetch,
    dispose() {
      clearTimeout(timer);
      clearTimeout(debounce);
      timer = 0;
      job = null;
      queue.length = 0;
      removeOverlay();
    },
  };
}
