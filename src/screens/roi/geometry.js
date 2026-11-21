// =============================================================================
// 関心領域（ROI）と 2 点ラインの計算
// ・ROI は「現在のスライスに塗った円」の集合 [{x,y,z,r}]（患者座標 mm）
//   - 2D: 円の中心スライス ±1 スライス（±2mm）に表示（ペンの厚み）
//   - 3D: 各円を厚さ ±3mm の円柱とみなし、その和集合を等値面にする
// ・消しゴムは円を削るのではなく、交差する円を格子状の小円に分割して
//   消しゴムの外側だけを残す（state.roi は常に「塗った円」だけの配列に保つ）
// ・2 点ライン: 終点から始点方向へ進み、体表（sdBody = 0）との交点を求める。
//   線は体表から外側へ 10 cm 延長して表示する。深さ = 体表との交点 → 終点。
// =============================================================================
import { marchingCubes } from '../../three/meshing.js';
import { sdBody, sdNodule, NODULE } from '../../data/phantom.js';

/** 2D: 円の中心スライスからこの距離（mm）以内のスライスに表示・消去する */
export const SLICE_REACH = 2.01;
/** 3D: 1 枚の円が覆う厚みの半分（mm）。スライス間隔 2mm × (±1 スライス) + 半スライス */
export const ROI_HALF = 3;
/** ラインの体表からの延長（mm） */
export const EXT_MM = 100;
/** ペン・消しゴムの大きさ（半径 mm） */
export const BRUSH = {
  L: { label: '大', r: 9 },
  M: { label: '中', r: 5 },
  S: { label: '小', r: 2.5 },
};
/** AI ROI（研究開発中）: 結節からのマージン（mm） */
export const AI_MARGIN = 6;

// 消しゴムで分割するときの格子
const LATTICE = 2.0;
const LATTICE_R = 1.5;
const latticeKey = (z, i, j) => `${z}|${i}|${j}`;
const round1 = (v) => Math.round(v * 10) / 10;

/** 円がスライス z に表示されるか */
export const onSlice = (c, z) => Math.abs(c.z - z) <= SLICE_REACH;

/** ペン: 円を 1 つ追加した新しい配列を返す */
export function paintCircle(circles, x, y, z, r) {
  return circles.concat([{ x: round1(x), y: round1(y), z, r }]);
}

/**
 * 消しゴム: スライス z 上の (ex, ey) 半径 re の範囲を消す。
 * 変化がなければ同じ配列を返す。
 */
export function eraseAt(circles, ex, ey, z, re) {
  let changed = false;
  const keep = [];
  const keys = new Set();
  for (const c of circles) if (c.r === LATTICE_R) keys.add(latticeKey(c.z, Math.round(c.x / LATTICE), Math.round(c.y / LATTICE)));
  const add = [];
  for (const c of circles) {
    if (!onSlice(c, z)) { keep.push(c); continue; }
    const d = Math.hypot(c.x - ex, c.y - ey);
    if (d >= c.r + re) { keep.push(c); continue; }
    if (c.r <= LATTICE_R + 1e-6) {
      // 小さな円: 中心が消しゴムの外側なら残す
      if (d >= re + c.r * 0.4) keep.push(c);
      else { changed = true; keys.delete(latticeKey(c.z, Math.round(c.x / LATTICE), Math.round(c.y / LATTICE))); }
      continue;
    }
    changed = true;
    if (d + c.r <= re) continue; // まるごと消える
    // 格子状の小円に分割し、消しゴムの外側だけ残す
    const i0 = Math.ceil((c.x - c.r) / LATTICE), i1 = Math.floor((c.x + c.r) / LATTICE);
    const j0 = Math.ceil((c.y - c.r) / LATTICE), j1 = Math.floor((c.y + c.r) / LATTICE);
    for (let i = i0; i <= i1; i++) {
      const px = i * LATTICE;
      for (let j = j0; j <= j1; j++) {
        const py = j * LATTICE;
        if (Math.hypot(px - c.x, py - c.y) > c.r - LATTICE_R * 0.35) continue;
        if (Math.hypot(px - ex, py - ey) < re + LATTICE_R * 0.4) continue;
        const k = latticeKey(c.z, i, j);
        if (keys.has(k)) continue;
        keys.add(k);
        add.push({ x: round1(px), y: round1(py), z: c.z, r: LATTICE_R });
      }
    }
  }
  return changed ? keep.concat(add) : circles;
}

/** ROI のあるスライス（円の中心 z）の一覧 */
export function paintedSlices(circles) {
  return [...new Set(circles.map((c) => c.z))].sort((a, b) => b - a);
}

// -----------------------------------------------------------------------------
// 3D: 円柱の和集合 → 距離場 → マーチングキューブ
// -----------------------------------------------------------------------------
/**
 * @returns {{sample:(x:number,y:number,z:number)=>number, box:number[][], step:number, volumeMl:number, center:number[]}|null}
 */
export function buildRoiField(circles) {
  if (!circles.length) return null;
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (const c of circles) {
    x0 = Math.min(x0, c.x - c.r); x1 = Math.max(x1, c.x + c.r);
    y0 = Math.min(y0, c.y - c.r); y1 = Math.max(y1, c.y + c.r);
    z0 = Math.min(z0, c.z - ROI_HALF); z1 = Math.max(z1, c.z + ROI_HALF);
  }
  const ext = Math.max(x1 - x0, y1 - y0, z1 - z0);
  const step = Math.min(2.4, Math.max(0.8, ext / 54));
  const pad = step * 2.5;
  const min = [x0 - pad, y0 - pad, z0 - pad];
  const nx = Math.ceil((x1 + pad - min[0]) / step) + 1;
  const ny = Math.ceil((y1 + pad - min[1]) / step) + 1;
  const nz = Math.ceil((z1 + pad - min[2]) / step) + 1;
  const N = nx * ny * nz;
  const FAR = 6;
  let F = new Float32Array(N).fill(FAR);
  const idx = (i, j, k) => i + nx * (j + ny * k);

  for (const c of circles) {
    const m = c.r + step * 2;
    const i0 = Math.max(0, Math.floor((c.x - m - min[0]) / step)), i1 = Math.min(nx - 1, Math.ceil((c.x + m - min[0]) / step));
    const j0 = Math.max(0, Math.floor((c.y - m - min[1]) / step)), j1 = Math.min(ny - 1, Math.ceil((c.y + m - min[1]) / step));
    const mz = ROI_HALF + step * 2;
    const k0 = Math.max(0, Math.floor((c.z - mz - min[2]) / step)), k1 = Math.min(nz - 1, Math.ceil((c.z + mz - min[2]) / step));
    for (let k = k0; k <= k1; k++) {
      const dz = Math.abs(min[2] + k * step - c.z) - ROI_HALF;
      for (let j = j0; j <= j1; j++) {
        const yy = min[1] + j * step - c.y;
        for (let i = i0; i <= i1; i++) {
          const xx = min[0] + i * step - c.x;
          const dr = Math.sqrt(xx * xx + yy * yy) - c.r;
          const ox = dr > 0 ? dr : 0, oz = dz > 0 ? dz : 0;
          const d = Math.sqrt(ox * ox + oz * oz) + Math.min(Math.max(dr, dz), 0);
          const q = idx(i, j, k);
          if (d < F[q]) F[q] = d;
        }
      }
    }
  }

  // なめらかにする（各軸 [1,2,1]/4 のぼかし。スライス方向の段差は少し強めにならす）
  const blurAxis = (src, axis) => {
    const dst = new Float32Array(N);
    const sx = axis === 0 ? 1 : axis === 1 ? nx : nx * ny;
    const n = axis === 0 ? nx : axis === 1 ? ny : nz;
    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const q = idx(i, j, k);
      const p = axis === 0 ? i : axis === 1 ? j : k;
      const a = p > 0 ? src[q - sx] : src[q];
      const b = p < n - 1 ? src[q + sx] : src[q];
      dst[q] = (a + 2 * src[q] + b) * 0.25;
    }
    return dst;
  };
  F = blurAxis(blurAxis(blurAxis(F, 0), 1), 2);
  const zPasses = Math.max(1, Math.round(2.4 / step));
  for (let i = 0; i < zPasses; i++) F = blurAxis(F, 2);
  F = blurAxis(blurAxis(F, 0), 1);

  let inside = 0, cx = 0, cy = 0, cz = 0;
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    if (F[idx(i, j, k)] < 0) { inside++; cx += i; cy += j; cz += k; }
  }
  const center = inside
    ? [min[0] + (cx / inside) * step, min[1] + (cy / inside) * step, min[2] + (cz / inside) * step]
    : [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2];

  const sample = (x, y, z) => {
    const fx = (x - min[0]) / step, fy = (y - min[1]) / step, fz = (z - min[2]) / step;
    if (fx < 0 || fy < 0 || fz < 0 || fx > nx - 1 || fy > ny - 1 || fz > nz - 1) return FAR;
    const i = Math.min(nx - 2, Math.floor(fx)), j = Math.min(ny - 2, Math.floor(fy)), k = Math.min(nz - 2, Math.floor(fz));
    const u = fx - i, v = fy - j, w = fz - k;
    const q = idx(i, j, k);
    const c000 = F[q], c100 = F[q + 1], c010 = F[q + nx], c110 = F[q + nx + 1];
    const q2 = q + nx * ny;
    const c001 = F[q2], c101 = F[q2 + 1], c011 = F[q2 + nx], c111 = F[q2 + nx + 1];
    const a = c000 + (c100 - c000) * u, b = c010 + (c110 - c010) * u;
    const c = c001 + (c101 - c001) * u, d = c011 + (c111 - c011) * u;
    const e = a + (b - a) * v, f = c + (d - c) * v;
    return e + (f - e) * w;
  };
  const max = [min[0] + (nx - 1) * step, min[1] + (ny - 1) * step, min[2] + (nz - 1) * step];
  return { sample, box: [min, max], step, volumeMl: (inside * step ** 3) / 1000, center, top: [center[0], center[1], z1] };
}

/** ROI のジオメトリ（THREE.BufferGeometry）と体積の目安 */
export function buildRoiGeometry(circles) {
  const field = buildRoiField(circles);
  if (!field) return null;
  const geometry = marchingCubes(field.sample, field.box, field.step);
  return { geometry, volumeMl: field.volumeMl, center: field.center, top: field.top };
}

// -----------------------------------------------------------------------------
// AI ROI（研究開発中・未承認）: 結節の周囲に自動生成した領域
// -----------------------------------------------------------------------------
export const sdAiRoi = (x, y, z) => sdNodule(x, y, z) - AI_MARGIN;
let aiGeo = null;
export function aiRoiGeometry() {
  if (aiGeo) return aiGeo;
  const r = NODULE.r * 1.35 + AI_MARGIN + 4;
  const c = NODULE.c;
  aiGeo = marchingCubes(sdAiRoi, [[c[0] - r, c[1] - r, c[2] - r], [c[0] + r, c[1] + r, c[2] + r]], 1.4);
  return aiGeo;
}

/**
 * AI ROI の断面の輪郭（マーチングスクエア）。線分 [[x0,y0,x1,y1], ...]（mm）
 */
const aiContourCache = new Map();
export function aiRoiContour(z) {
  const key = Math.round(z * 10);
  if (aiContourCache.has(key)) return aiContourCache.get(key);
  const out = [];
  const R = NODULE.r * 1.35 + AI_MARGIN + 3;
  if (Math.abs(z - NODULE.c[2]) <= R) {
    const s = 1;
    const x0 = NODULE.c[0] - R, y0 = NODULE.c[1] - R;
    const n = Math.ceil((2 * R) / s) + 1;
    const v = new Float32Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) v[j * n + i] = sdAiRoi(x0 + i * s, y0 + j * s, z);
    const lerpPt = (ax, ay, va, bx, by, vb) => {
      const t = va / (va - vb);
      return [ax + (bx - ax) * t, ay + (by - ay) * t];
    };
    for (let j = 0; j < n - 1; j++) {
      for (let i = 0; i < n - 1; i++) {
        const a = v[j * n + i], b = v[j * n + i + 1], c = v[(j + 1) * n + i + 1], d = v[(j + 1) * n + i];
        const xa = x0 + i * s, ya = y0 + j * s, xb = xa + s, yb = ya + s;
        const pts = [];
        if ((a < 0) !== (b < 0)) pts.push(lerpPt(xa, ya, a, xb, ya, b));
        if ((b < 0) !== (c < 0)) pts.push(lerpPt(xb, ya, b, xb, yb, c));
        if ((c < 0) !== (d < 0)) pts.push(lerpPt(xb, yb, c, xa, yb, d));
        if ((d < 0) !== (a < 0)) pts.push(lerpPt(xa, yb, d, xa, ya, a));
        if (pts.length >= 2) out.push([pts[0][0], pts[0][1], pts[1][0], pts[1][1]]);
        if (pts.length === 4) out.push([pts[2][0], pts[2][1], pts[3][0], pts[3][1]]);
      }
    }
  }
  if (aiContourCache.size > 200) aiContourCache.clear();
  aiContourCache.set(key, out);
  return out;
}

// -----------------------------------------------------------------------------
// 2 点ライン
// -----------------------------------------------------------------------------
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const addScaled = (a, d, t) => [a[0] + d[0] * t, a[1] + d[1] * t, a[2] + d[2] * t];
export const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/**
 * @param {number[]} start 始点 [x,y,z]
 * @param {number[]} end 終点 [x,y,z]
 * @returns {{start:number[], end:number[], dir:number[], length:number, skin:number[]|null, depth:number|null, ext:number[]}|null}
 *   dir: 終点 → 始点方向の単位ベクトル / skin: 体表との交点 / ext: 体表から外側へ EXT_MM 延長した端
 */
export function computeLine(start, end) {
  if (!start || !end) return null;
  const v = sub(start, end);
  const length = Math.hypot(v[0], v[1], v[2]);
  if (length < 0.5) return null;
  const dir = v.map((a) => a / length);
  let skin = null, depth = null;
  if (sdBody(end[0], end[1], end[2]) < 0) {
    let lo = 0, hi = 0;
    for (let t = 1; t <= 900; t += 1) {
      const p = addScaled(end, dir, t);
      if (sdBody(p[0], p[1], p[2]) >= 0) { hi = t; break; }
      lo = t;
    }
    if (hi > 0) {
      for (let i = 0; i < 30; i++) {
        const m = (lo + hi) / 2;
        const p = addScaled(end, dir, m);
        if (sdBody(p[0], p[1], p[2]) < 0) lo = m; else hi = m;
      }
      depth = (lo + hi) / 2;
      skin = addScaled(end, dir, depth);
    }
  }
  const base = skin || start;
  const ext = addScaled(base, dir, EXT_MM);
  return { start: start.slice(), end: end.slice(), dir, length, skin, depth, ext };
}

/** 線分 a→b のうち、スライス z の厚み（±half）に入る区間 [t0, t1]（なければ null） */
export function slabInterval(a, b, z, half = 1.0) {
  const dz = b[2] - a[2];
  if (Math.abs(dz) < 1e-6) return Math.abs(a[2] - z) <= half ? [0, 1] : null;
  let t0 = (z - half - a[2]) / dz, t1 = (z + half - a[2]) / dz;
  if (t0 > t1) [t0, t1] = [t1, t0];
  t0 = Math.max(0, t0); t1 = Math.min(1, t1);
  return t0 <= t1 ? [t0, t1] : null;
}
