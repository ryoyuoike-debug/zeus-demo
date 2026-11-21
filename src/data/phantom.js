// =============================================================================
// 合成胸部ファントム（デモ用）
// -----------------------------------------------------------------------------
// 実在の患者データは一切使用していません。胸部の主要構造を解析的な形状
// （楕円体・チューブ・符号付き距離関数）で定義し、
//   - 2D CT スライス（HU 値のサンプリング）
//   - 3D メッシュ（マーチングキューブ / チューブ）
// の両方を同じ定義から生成します。これにより、CT と 3D モデルが一致します。
//
// 座標系（患者座標・単位 mm）
//   x: + = 患者の左   y: + = 腹側（前）   z: + = 頭側（上）
// =============================================================================

// ---------- 小さなベクトル・数学ユーティリティ ----------
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;

/** 決定論的な擬似乱数（mulberry32）。デモ表示を毎回同じにするため。 */
export function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 楕円体の近似符号付き距離（内側が負） */
function sdEllipsoid(px, py, pz, cx, cy, cz, rx, ry, rz) {
  const x = px - cx, y = py - cy, z = pz - cz;
  const k0 = Math.sqrt((x * x) / (rx * rx) + (y * y) / (ry * ry) + (z * z) / (rz * rz));
  const k1 = Math.sqrt((x * x) / (rx ** 4) + (y * y) / (ry ** 4) + (z * z) / (rz ** 4));
  if (k1 < 1e-9) return -Math.min(rx, ry, rz);
  return (k0 * (k0 - 1)) / k1;
}

// ---------- 体表（スーパー楕円の断面をもつ胴体） ----------
export const BODY_Z = [-175, 178];
const BODY_N = 2.6;
export function bodyA(z) {
  let a = 150;
  if (z < -40) a -= (-40 - z) * 0.07;
  if (z > 138) a -= (z - 138) * 1.75;
  return a;
}
export function bodyB(z) {
  let b = 108;
  if (z > 138) b -= (z - 138) * 0.55;
  return b;
}
/** 体表の近似符号付き距離（内側が負、mm） */
export function sdBody(x, y, z) {
  const a = bodyA(z), b = bodyB(z);
  const rho = Math.pow(Math.pow(Math.abs(x) / a, BODY_N) + Math.pow(Math.abs(y) / b, BODY_N), 1 / BODY_N);
  // 方向に応じたスケールで距離に換算
  const scale = rho > 1e-6 ? Math.hypot(x, y) / rho : Math.min(a, b);
  let d = (rho - 1) * scale;
  d = Math.max(d, z - BODY_Z[1], BODY_Z[0] - z);
  return d;
}
/** 体表上（腹側）の y 座標を求める（マーカ配置などに使用） */
export function anteriorSkinY(x, z) {
  let lo = 0, hi = 200;
  for (let i = 0; i < 40; i++) {
    const m = (lo + hi) / 2;
    if (sdBody(x, m, z) < 0) lo = m; else hi = m;
  }
  return lo;
}
/** 体表上（外側・左右）の x 座標を求める */
export function lateralSkinX(side, y, z) {
  let lo = 0, hi = 220;
  for (let i = 0; i < 40; i++) {
    const m = (lo + hi) / 2;
    if (sdBody(side * m, y, z) < 0) lo = m; else hi = m;
  }
  return side * lo;
}

// ---------- 横隔膜 ----------
function zdRight(x, y) { return -46 - 0.012 * (x + 72) ** 2 - 0.006 * (y + 4) ** 2; }
function zdLeft(x, y) { return -58 - 0.012 * (x - 74) ** 2 - 0.006 * (y + 6) ** 2; }
export function diaphragmZ(x, y) { return Math.max(zdRight(x, y), zdLeft(x, y)); }

// ---------- 心臓 ----------
const HEART = { c: [18, 30, -40], r: [58, 46, 50], rot: (28 * Math.PI) / 180 };
export function sdHeart(x, y, z) {
  const dx = x - HEART.c[0], dy = y - HEART.c[1];
  const cs = Math.cos(HEART.rot), sn = Math.sin(HEART.rot);
  const lx = dx * cs + dy * sn, ly = -dx * sn + dy * cs;
  return sdEllipsoid(lx, ly, z, 0, 0, HEART.c[2], HEART.r[0], HEART.r[1], HEART.r[2]);
}

// =============================================================================
// チューブ構造（血管・気道・肋骨など）
// 各チューブは「点列 + 半径」で定義し、Catmull-Rom で滑らかに補間して
// セグメント（線分）に分割します。CT 用の距離計算と 3D 用のチューブ生成で共通。
// =============================================================================

function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return p1.map((_, i) =>
    0.5 * (2 * p1[i] + (-p0[i] + p2[i]) * t + (2 * p0[i] - 5 * p1[i] + 4 * p2[i] - p3[i]) * t2 + (-p0[i] + 3 * p1[i] - 3 * p2[i] + p3[i]) * t3));
}

/** 制御点 [x,y,z,r] の配列を、滑らかな点列に補間する */
export function smoothPath(ctrl, perSpan = 6) {
  if (ctrl.length < 2) return ctrl.slice();
  const out = [];
  for (let i = 0; i < ctrl.length - 1; i++) {
    const p0 = ctrl[Math.max(0, i - 1)], p1 = ctrl[i], p2 = ctrl[i + 1], p3 = ctrl[Math.min(ctrl.length - 1, i + 2)];
    for (let k = 0; k < perSpan; k++) out.push(catmull(p0, p1, p2, p3, k / perSpan));
  }
  out.push(ctrl[ctrl.length - 1].slice());
  return out;
}

/**
 * TUBES: { id(構造ID), path: [[x,y,z,r],...], kind: 'vessel'|'airway'|'bone'|'cartilage'|'soft' }
 * 構造ID は STRUCTURES の id に対応。
 */
export const TUBES = [];
function addTube(structure, ctrl, perSpan = 6) {
  const path = smoothPath(ctrl, perSpan);
  TUBES.push({ structure, path });
  return path;
}

// --- 大動脈と弓部分枝 ---
addTube('aorta', [
  [10, 30, -26, 14], [4, 33, 12, 15], [1, 28, 56, 14.5], [6, 12, 82, 13.5], [20, -10, 86, 12.5],
  [30, -30, 70, 12], [32, -38, 40, 11.5], [30, -38, 0, 11], [26, -34, -60, 10.5], [20, -28, -120, 10], [16, -24, -178, 10],
]);
addTube('aorta', [[4, 18, 84, 7], [-14, 22, 110, 6.5], [-28, 20, 140, 6], [-36, 16, 178, 5.5]]); // 腕頭動脈→右総頸動脈
addTube('aorta', [[10, 12, 88, 5], [12, 14, 130, 4.8], [14, 14, 178, 4.6]]); // 左総頸動脈
addTube('aorta', [[18, 0, 88, 6], [34, 0, 120, 5.5], [62, 8, 142, 5], [110, 14, 148, 4.5], [140, 14, 146, 4.2]]); // 左鎖骨下動脈
addTube('aorta', [[-28, 20, 140, 5], [-60, 14, 146, 4.8], [-110, 12, 148, 4.5], [-140, 12, 146, 4.2]]); // 右鎖骨下動脈

// --- 上大静脈・腕頭静脈・鎖骨下静脈・下大静脈 ---
addTube('vein', [[-24, 30, -6, 11], [-26, 32, 30, 11.5], [-26, 34, 62, 11]]); // 上大静脈
addTube('vein', [[-26, 34, 62, 9], [-40, 32, 100, 8], [-56, 30, 132, 7.5], [-100, 26, 140, 7], [-140, 22, 138, 6.5]]); // 右腕頭静脈→右鎖骨下静脈
addTube('vein', [[-26, 34, 62, 8.5], [0, 42, 84, 8], [36, 40, 108, 7.5], [62, 32, 132, 7.5], [100, 26, 140, 7], [140, 22, 138, 6.5]]); // 左腕頭静脈→左鎖骨下静脈
addTube('vein', [[-10, 14, -70, 12], [-12, 4, -120, 12], [-14, 0, -178, 12]]); // 下大静脈

// --- 食道 ---
addTube('esophagus', [[4, -10, 178, 7], [5, -18, 100, 7], [8, -22, 30, 7], [12, -22, -40, 7], [20, -10, -95, 7.5]]);

// --- 気管・主気管支 ---
export const CARINA = [0, 8, 52];
addTube('trachea', [[0, 20, 178, 9.5], [0, 16, 120, 9.5], [0, 10, 70, 9], [0, 8, 52, 8.5]]);
const rMain = addTube('bronchus', [[0, 8, 52, 7.5], [-22, 4, 44, 7], [-40, 0, 36, 6]], 4);
const lMain = addTube('bronchus', [[0, 8, 52, 7], [24, 2, 46, 6.5], [46, -4, 36, 5.5]], 4);

// --- 肺動脈 ---
addTube('pa', [[12, 50, -14, 13], [18, 46, 14, 13], [14, 26, 38, 12]]); // 肺動脈幹
addTube('pa', [[14, 26, 38, 10.5], [-10, 20, 42, 10], [-40, 12, 38, 9], [-58, 6, 32, 8]]); // 右肺動脈
addTube('pa', [[14, 26, 38, 10], [36, 14, 48, 9], [56, -2, 44, 8]]); // 左肺動脈

// --- 肺静脈（左房から） ---
addTube('pv', [[10, 6, -26, 8], [-20, 2, -14, 8], [-46, -8, -8, 7]]);
addTube('pv', [[10, 8, -22, 8], [-18, 8, 10, 7.5], [-46, 2, 24, 7]]);
addTube('pv', [[24, 6, -26, 8], [44, -10, -10, 7.5], [56, -16, -6, 6.5]]);
addTube('pv', [[24, 8, -22, 8], [42, 0, 14, 7], [56, -6, 22, 6.5]]);

// =============================================================================
// 肺
// =============================================================================
export const LUNGS = {
  right: { c: [-72, -4, 28], r: [54, 74, 118], side: -1 },
  left: { c: [74, -6, 26], r: [52, 72, 116], side: 1 },
};

// 縦隔の大きな構造（肺から除外する）
const MEDIASTINAL_IDS = new Set(['aorta', 'vein', 'esophagus', 'trachea', 'pa']);
let MEDIASTINAL_SEGS = null;

function lungBase(which, x, y, z) {
  const L = LUNGS[which];
  let f = sdEllipsoid(x, y, z, L.c[0], L.c[1], L.c[2], L.r[0], L.r[1], L.r[2]);
  const zd = which === 'right' ? zdRight(x, y) : zdLeft(x, y);
  f = Math.max(f, zd - z);
  // 正中付近は縦隔
  f = which === 'right' ? Math.max(f, x + 14) : Math.max(f, 18 - x);
  // 心臓（左右とも、少し膨らませて除外）
  f = Math.max(f, -(sdHeart(x, y, z) - 5));
  // 脊椎周囲
  f = Math.max(f, -(Math.hypot(x / 1.0, (y + 56) / 1.0) - 34));
  // 体の内側（胸壁）にとどめる
  f = Math.max(f, sdBody(x, y, z) + 29);
  return f;
}

/** 肺の符号付き距離（縦隔の血管・気管を除外） */
export function sdLung(which, x, y, z) {
  let f = lungBase(which, x, y, z);
  if (f > 12) return f;
  if (!MEDIASTINAL_SEGS) MEDIASTINAL_SEGS = SEGMENTS.filter((s) => MEDIASTINAL_IDS.has(s.structure) && s.r0 > 6);
  for (const s of MEDIASTINAL_SEGS) {
    if (z < s.zmin - 30 || z > s.zmax + 30) continue;
    const d = segDist(s, x, y, z) - 4;
    if (-d > f) f = -d;
  }
  return f;
}

// --- 肺内の血管・気管支の樹状分岐（決定論的に生成） ---
function lungPoint(which, rng) {
  // 肺の内部の点をランダムに選ぶ
  const L = LUNGS[which];
  for (let i = 0; i < 200; i++) {
    const p = [L.c[0] + (rng() * 2 - 1) * L.r[0], L.c[1] + (rng() * 2 - 1) * L.r[1], L.c[2] + (rng() * 2 - 1) * L.r[2]];
    if (lungBase(which, p[0], p[1], p[2]) < -10) return p;
  }
  return L.c.slice();
}

function growTree(structure, which, start, dir, radius, length, depth, rng, out) {
  const end = [start[0] + dir[0] * length, start[1] + dir[1] * length, start[2] + dir[2] * length];
  // 肺の外に出ないよう、外に出るなら短くする
  let t = 1;
  for (let k = 0; k < 6 && lungBase(which, end[0] * t + start[0] * (1 - t), end[1] * t + start[1] * (1 - t), end[2] * t + start[2] * (1 - t)) > -6; k++) t *= 0.7;
  const e = [lerp(start[0], end[0], t), lerp(start[1], end[1], t), lerp(start[2], end[2], t)];
  const mid = [lerp(start[0], e[0], 0.5) + (rng() - 0.5) * length * 0.15, lerp(start[1], e[1], 0.5) + (rng() - 0.5) * length * 0.15, lerp(start[2], e[2], 0.5) + (rng() - 0.5) * length * 0.15];
  const r1 = radius * 0.82;
  out.push(addTube(structure, [[...start, radius], [...mid, lerp(radius, r1, 0.5)], [...e, r1]], 3));
  if (depth <= 0 || r1 < 1.1) return;
  const n = depth > 2 ? 2 : (rng() < 0.6 ? 2 : 3);
  for (let i = 0; i < n; i++) {
    // 親の向きを基準に、肺内のランダムな点へ少し引き寄せた方向
    const target = lungPoint(which, rng);
    let d = [target[0] - e[0], target[1] - e[1], target[2] - e[2]];
    const dl = Math.hypot(...d) || 1;
    d = d.map((v, j) => v / dl * 0.55 + dir[j] * 0.45);
    const nl = Math.hypot(...d) || 1;
    d = d.map((v) => v / nl);
    growTree(structure, which, e, d, r1 * (n === 3 ? 0.72 : 0.8), length * 0.78, depth - 1, rng, out);
  }
}

function seedTrees() {
  const rng = makeRng(20261121);
  const specs = [
    // 構造, 肺, 起点, 初期方向, 半径, 長さ, 深さ
    ['pa', 'right', [-58, 6, 32], [[-0.3, 0.2, 0.9], [-0.6, 0.2, -0.75], [-0.75, 0.55, 0.1]], 6.5, 46, 4],
    ['pa', 'left', [56, -2, 44], [[0.35, 0.1, 0.9], [0.5, 0.15, -0.85], [0.7, -0.6, -0.1]], 6.2, 46, 4],
    ['pv', 'right', [-46, -8, -8], [[-0.6, -0.1, -0.75], [-0.8, 0.5, 0]], 5.5, 40, 3],
    ['pv', 'right', [-46, 2, 24], [[-0.5, 0.3, 0.8], [-0.85, -0.4, 0.3]], 5.5, 40, 3],
    ['pv', 'left', [56, -16, -6], [[0.6, -0.2, -0.75], [0.8, 0.5, -0.1]], 5.2, 40, 3],
    ['pv', 'left', [56, -6, 22], [[0.45, 0.2, 0.85], [0.85, -0.45, 0.2]], 5.2, 40, 3],
    ['bronchus', 'right', rMain[rMain.length - 1].slice(0, 3), [[-0.2, 0.1, 0.95], [-0.5, 0.0, -0.85], [-0.8, 0.5, -0.1]], 4.8, 38, 4],
    ['bronchus', 'left', lMain[lMain.length - 1].slice(0, 3), [[0.25, 0.0, 0.95], [0.5, -0.1, -0.85], [0.8, 0.5, -0.2]], 4.5, 38, 4],
  ];
  for (const [structure, which, start, dirs, r, len, depth] of specs) {
    for (const d0 of dirs) {
      const l = Math.hypot(...d0);
      growTree(structure, which, start, d0.map((v) => v / l), r, len, depth, rng, []);
    }
  }
}

// =============================================================================
// 骨格（肋骨・肋軟骨・胸骨・鎖骨・椎骨）
// =============================================================================
export const RIB_COUNT = 11;
function buildRibs() {
  for (let i = 0; i < RIB_COUNT; i++) {
    const zHead = 150 - i * 24;
    const th0 = (20 * Math.PI) / 180;
    const th1deg = i < 7 ? 148 - i * 1.5 : [132, 118, 104, 88][i - 7];
    const th1 = (th1deg * Math.PI) / 180;
    const drop = i === 0 ? 28 : 46 + Math.min(i, 6) * 3;
    for (const s of [-1, 1]) {
      const ctrl = [];
      const steps = 12;
      for (let k = 0; k <= steps; k++) {
        const u = k / steps;
        const th = lerp(th0, th1, u);
        const zz = zHead + 8 * Math.sin(u * Math.PI * 0.8) - drop * Math.pow(u, 1.35);
        const inset = i === 0 ? 46 : 24;
        const A = bodyA(zz) - inset - (i === 0 ? 0 : 2 * Math.cos(th));
        const B = bodyB(zz) - 20;
        ctrl.push([s * A * Math.sin(th), -2 - B * Math.cos(th), zz, i === 0 ? 4.6 : 5.4]);
      }
      addTube('rib', ctrl, 3);
      // 肋軟骨（第1〜第7肋骨は胸骨へ）
      const last = ctrl[ctrl.length - 1];
      if (i < 7) {
        const sz = 112 - i * 22;
        addTube('cartilage', [[last[0], last[1], last[2], 5], [s * (24 + i * 1.5), 92 - i * 0.6, lerp(last[2], sz, 0.6), 4.6], [s * 15, 94, sz, 4.4]], 4);
      } else if (i < 10) {
        const prevZ = 112 - 6 * 22;
        addTube('cartilage', [[last[0], last[1], last[2], 4.6], [s * (60 - (i - 7) * 4), 84 - (i - 7) * 8, last[2] + 16, 4.2], [s * 36, 90, prevZ - 10 - (i - 7) * 6, 4]], 4);
      }
    }
  }
  // 鎖骨
  for (const s of [-1, 1]) {
    addTube('clavicle', [[s * 18, 92, 126, 6.5], [s * 50, 88, 134, 7], [s * 90, 66, 142, 6.5], [s * 120, 34, 140, 6.2], [s * 132, 14, 136, 6]], 6);
  }
}

// 椎骨：椎体（楕円柱）＋椎弓＋棘突起＋横突起
export const VERTEBRAE = [];
for (let z = -166; z <= 176; z += 27) VERTEBRAE.push(z);
export function sdSpine(x, y, z) {
  // 最も近い椎骨レベル
  let best = 1e9;
  for (const vz of VERTEBRAE) {
    const dz = Math.abs(z - vz);
    if (dz > 26) continue;
    // 椎体
    const ex = x / 20, ey = (y + 50) / 16;
    const body2d = (Math.hypot(ex, ey) - 1) * 17;
    let f = Math.max(body2d, dz - 11);
    // 椎弓（脊柱管の周りのリング）
    const rc = Math.hypot(x, y + 80);
    const arch = Math.max(Math.max(rc - 15, 9 - rc), dz - 8, -(y + 64));
    f = Math.min(f, arch);
    // 棘突起
    const spin = Math.max(Math.abs(x) - 4, Math.max(-(y + 108) * 1, (y + 92)), dz - 7 + (-(y + 92)) * 0.25);
    f = Math.min(f, spin);
    // 横突起
    const trans = Math.max(Math.abs(x) - 36, Math.abs(y + 80) - 5, dz - 5.5);
    f = Math.min(f, trans);
    if (f < best) best = f;
  }
  return best;
}
export const SPINAL_CORD = { c: [0, -80], r: 6 };

// 胸骨（胸骨柄＋胸骨体＋剣状突起）
export function sdSternum(x, y, z) {
  if (z > 70) {
    // 胸骨柄（上ほど広い）
    const w = lerp(12, 21, clamp((z - 70) / 52, 0, 1));
    return Math.max(Math.abs(x) - w, Math.abs(y - 94) - 6, z - 124, 70 - z);
  }
  if (z > -40) return Math.max(Math.abs(x) - 12, Math.abs(y - 95) - 5.5, z - 72, -40 - z);
  // 剣状突起
  const w = lerp(9, 3, clamp((-40 - z) / 24, 0, 1));
  return Math.max(Math.abs(x) - w, Math.abs(y - 94) - 4, z + 40, -64 - z);
}

// =============================================================================
// 腹部上部（肝臓・胃・脾臓）
// =============================================================================
export function sdLiver(x, y, z) {
  const zd = diaphragmZ(x, y);
  let f = Math.max(z - (zd - 6), sdBody(x, y, z) + 24);
  f = Math.max(f, x - (34 - (zd - z) * 0.25));
  f = Math.max(f, -(Math.hypot(x - 2, y + 40) - 36)); // 脊椎・大動脈の周り
  f = Math.max(f, BODY_Z[0] + 1 - z);
  return f;
}
export function sdStomach(x, y, z) {
  return sdEllipsoid(x, y, z, 60, 18, -118, 44, 40, 46);
}
export function sdSpleen(x, y, z) {
  return sdEllipsoid(x, y, z, 92, -52, -112, 24, 40, 44);
}

// =============================================================================
// 病変・マーカ
// =============================================================================
/** 右上葉の結節（デモ用ターゲット） */
export const NODULE = { c: [-90, 22, 80], r: 11 };
export function sdNodule(x, y, z) {
  const dx = x - NODULE.c[0], dy = y - NODULE.c[1], dz = z - NODULE.c[2];
  const d = Math.hypot(dx, dy, dz);
  if (d < 1e-6) return -NODULE.r;
  const th = Math.atan2(dy, dx), ph = Math.acos(clamp(dz / d, -1, 1));
  const lob = 1 + 0.16 * Math.sin(3 * th) * Math.sin(2 * ph) + 0.08 * Math.cos(5 * th + 1.3);
  return d - NODULE.r * lob;
}

/** CT 撮影時に体表に貼る 3 点マーカ（自動認識の対象） */
export const MARKER_DEFS = [
  { id: 'r_mcl', name: '右鎖骨中線', short: '右', color: '#ff8a1f', x: -72, z: 112 },
  { id: 'l_mcl', name: '左鎖骨中線', short: '左', color: '#2f8bff', x: 72, z: 112 },
  { id: 'xiphoid', name: '剣状突起', short: '剣', color: '#22c55e', x: 0, z: -56 },
];
export const MARKER_RADIUS = 4.5;
export const MARKERS = MARKER_DEFS.map((m) => ({ ...m, pos: [m.x, anteriorSkinY(m.x, m.z) + MARKER_RADIUS - 0.5, m.z] }));

// =============================================================================
// セグメント展開（CT サンプリング高速化用）
// =============================================================================
export const SEGMENTS = [];
function finalizeSegments() {
  for (const t of TUBES) {
    for (let i = 0; i < t.path.length - 1; i++) {
      const a = t.path[i], b = t.path[i + 1];
      const r = Math.max(a[3], b[3]);
      SEGMENTS.push({
        structure: t.structure,
        ax: a[0], ay: a[1], az: a[2], bx: b[0], by: b[1], bz: b[2], r0: a[3], r1: b[3],
        zmin: Math.min(a[2], b[2]) - r, zmax: Math.max(a[2], b[2]) + r,
        xmin: Math.min(a[0], b[0]) - r, xmax: Math.max(a[0], b[0]) + r,
        ymin: Math.min(a[1], b[1]) - r, ymax: Math.max(a[1], b[1]) + r,
      });
    }
  }
}
/** 線分までの距離 − 補間半径 */
function segDist(s, x, y, z) {
  const bax = s.bx - s.ax, bay = s.by - s.ay, baz = s.bz - s.az;
  const pax = x - s.ax, pay = y - s.ay, paz = z - s.az;
  const L2 = bax * bax + bay * bay + baz * baz || 1e-9;
  const h = clamp((pax * bax + pay * bay + paz * baz) / L2, 0, 1);
  const dx = pax - bax * h, dy = pay - bay * h, dz = paz - baz * h;
  return Math.sqrt(dx * dx + dy * dy + dz * dz) - lerp(s.r0, s.r1, h);
}
export { segDist };

// 構築（モジュール読み込み時に一度だけ）
buildRibs();
// 肺内の樹は肺の判定（lungBase）が必要。lungBase は縦隔セグメントを使わないので先に生成できる。
seedTrees();
finalizeSegments();

/** 構造ごとの符号付き距離（チューブ系はセグメントの最小値） */
export function sdTubes(structure, x, y, z, pad = 0) {
  let best = 1e9;
  for (const s of SEGMENTS) {
    if (s.structure !== structure) continue;
    if (x < s.xmin - pad || x > s.xmax + pad || y < s.ymin - pad || y > s.ymax + pad || z < s.zmin - pad || z > s.zmax + pad) continue;
    const d = segDist(s, x, y, z);
    if (d < best) best = d;
  }
  return best;
}

// =============================================================================
// 構造の一覧（AI セグメンテーション結果として表示するもの）
// =============================================================================
export const STRUCTURES = [
  { id: 'skin', name: '体表', color: '#f2c2a0', group: '体表', mesh: 'field' },
  { id: 'lung_r', name: '右肺', color: '#7fd3ff', group: '肺', mesh: 'field' },
  { id: 'lung_l', name: '左肺', color: '#9be7ff', group: '肺', mesh: 'field' },
  { id: 'trachea', name: '気管', color: '#d7e3f4', group: '気道', mesh: 'tube' },
  { id: 'bronchus', name: '気管支', color: '#c3d4ec', group: '気道', mesh: 'tube' },
  { id: 'heart', name: '心臓', color: '#e0566b', group: '心臓・血管', mesh: 'field' },
  { id: 'aorta', name: '大動脈・分枝', color: '#ef3b3b', group: '心臓・血管', mesh: 'tube' },
  { id: 'vein', name: '大静脈・鎖骨下静脈', color: '#5b6cff', group: '心臓・血管', mesh: 'tube' },
  { id: 'pa', name: '肺動脈', color: '#3d8bfd', group: '肺血管', mesh: 'tube' },
  { id: 'pv', name: '肺静脈', color: '#ff7b9c', group: '肺血管', mesh: 'tube' },
  { id: 'esophagus', name: '食道', color: '#d9a679', group: '縦隔', mesh: 'tube' },
  { id: 'rib', name: '肋骨', color: '#f4efe4', group: '骨', mesh: 'tube' },
  { id: 'cartilage', name: '肋軟骨', color: '#cfe6dc', group: '骨', mesh: 'tube' },
  { id: 'sternum', name: '胸骨', color: '#efe8d8', group: '骨', mesh: 'field' },
  { id: 'clavicle', name: '鎖骨', color: '#efe8d8', group: '骨', mesh: 'tube' },
  { id: 'spine', name: '椎骨', color: '#e9e1cf', group: '骨', mesh: 'field' },
  { id: 'liver', name: '肝臓', color: '#a0522d', group: '腹部', mesh: 'field' },
  { id: 'stomach', name: '胃', color: '#d58b6a', group: '腹部', mesh: 'field' },
  { id: 'nodule', name: '結節（右上葉）', color: '#ffd400', group: '病変', mesh: 'field' },
];
export const STRUCTURE_BY_ID = Object.fromEntries(STRUCTURES.map((s) => [s.id, s]));

/** フィールド（符号付き距離）で定義される構造の関数と、メッシュ化する範囲 [min, max] (mm) */
export const FIELD_STRUCTURES = {
  skin: { f: sdBody, box: [[-160, -118, BODY_Z[0] - 4], [160, 118, BODY_Z[1] + 4]], step: 5 },
  lung_r: { f: (x, y, z) => sdLung('right', x, y, z), box: [[-132, -82, -100], [-8, 74, 150]], step: 3 },
  lung_l: { f: (x, y, z) => sdLung('left', x, y, z), box: [[10, -82, -110], [132, 70, 146]], step: 3 },
  heart: { f: sdHeart, box: [[-50, -30, -100], [90, 90, 20]], step: 3 },
  sternum: { f: sdSternum, box: [[-30, 84, -68], [30, 104, 128]], step: 2, geomNormals: true },
  spine: { f: sdSpine, box: [[-42, -112, BODY_Z[0]], [42, -30, BODY_Z[1]]], step: 2, geomNormals: true },
  liver: { f: sdLiver, box: [[-150, -110, BODY_Z[0]], [50, 110, -40]], step: 3, geomNormals: true },
  stomach: { f: sdStomach, box: [[12, -26, -168], [108, 62, -68]], step: 3, geomNormals: true },
  nodule: { f: sdNodule, box: [[-106, 6, 64], [-74, 38, 96]], step: 1 },
};

// =============================================================================
// CT 値（HU）のサンプリング
// =============================================================================
const HU = {
  air: -1000, lung: -860, fat: -95, skin: 30, muscle: 55, blood: 45, contrast: 230, myo: 60,
  cortical: 950, cancellous: 260, cartilage: 140, liver: 110, spleen: 115, stomach: 45,
  esophagus: 40, nodule: 35, marker: 2600, table: 180, cord: 35, mediastinum: -70,
};

/** 決定論的ノイズ（-1..1） */
function hashNoise(x, y, z) {
  let h = Math.imul((x * 73856093) ^ (y * 19349663) ^ (z * 83492791), 0x27d4eb2d);
  h ^= h >>> 15;
  return ((h >>> 0) / 4294967295) * 2 - 1;
}

/**
 * 1 スライス分の HU を計算する（軸位断）。
 * @param {number} z スライス位置（mm）
 * @param {number} size 画像の一辺（ピクセル）
 * @param {number} fov 表示視野（mm）
 * @returns {Float32Array} size*size の HU 値（行 = 前→後、列 = 患者右→左）
 */
export function renderAxialHU(z, size = 256, fov = 380) {
  const out = new Float32Array(size * size);
  const segs = SEGMENTS.filter((s) => z >= s.zmin && z <= s.zmax);
  const px = fov / size;
  const cx = 0, cy = -6;
  const markers = MARKERS.filter((m) => Math.abs(m.pos[2] - z) < MARKER_RADIUS);
  for (let j = 0; j < size; j++) {
    // 画像上が腹側（前）
    const y = cy + fov / 2 - (j + 0.5) * px;
    for (let i = 0; i < size; i++) {
      // 画像の左 = 患者の右（放射線科の表示規約）
      const x = cx - fov / 2 + (i + 0.5) * px;
      out[j * size + i] = sampleHU(x, y, z, segs, markers) + hashNoise(i, j, Math.round(z * 10)) * 14;
    }
  }
  return out;
}

/** 冠状断（前額断）: 行 = 頭→足、列 = 患者右→左 */
export function renderCoronalHU(y, width = 256, height = 256, fovX = 380, zRange = [BODY_Z[0], BODY_Z[1]]) {
  const out = new Float32Array(width * height);
  const pxX = fovX / width, pxZ = (zRange[1] - zRange[0]) / height;
  for (let j = 0; j < height; j++) {
    const z = zRange[1] - (j + 0.5) * pxZ;
    const segs = SEGMENTS.filter((s) => z >= s.zmin && z <= s.zmax);
    const markers = MARKERS.filter((m) => Math.abs(m.pos[2] - z) < MARKER_RADIUS);
    for (let i = 0; i < width; i++) {
      const x = -fovX / 2 + (i + 0.5) * pxX;
      out[j * width + i] = sampleHU(x, y, z, segs, markers) + hashNoise(i, j, Math.round(y * 10) + 7) * 14;
    }
  }
  return out;
}

/** 矢状断: 行 = 頭→足、列 = 前→後 */
export function renderSagittalHU(x, width = 256, height = 256, fovY = 300, zRange = [BODY_Z[0], BODY_Z[1]]) {
  const out = new Float32Array(width * height);
  const pxY = fovY / width, pxZ = (zRange[1] - zRange[0]) / height;
  for (let j = 0; j < height; j++) {
    const z = zRange[1] - (j + 0.5) * pxZ;
    const segs = SEGMENTS.filter((s) => z >= s.zmin && z <= s.zmax);
    const markers = MARKERS.filter((m) => Math.abs(m.pos[2] - z) < MARKER_RADIUS);
    for (let i = 0; i < width; i++) {
      const y = fovY / 2 - 6 - (i + 0.5) * pxY;
      out[j * width + i] = sampleHU(x, y, z, segs, markers) + hashNoise(i, j, Math.round(x * 10) + 13) * 14;
    }
  }
  return out;
}

/** 任意の点の HU。segs/markers は呼び出し側で z により絞り込んだもの（省略可）。 */
export function sampleHU(x, y, z, segs = SEGMENTS, markers = MARKERS) {
  // CT 寝台
  const dBody = sdBody(x, y, z);
  if (dBody > 0) {
    for (const m of markers) {
      if (Math.hypot(x - m.pos[0], y - m.pos[1], z - m.pos[2]) < MARKER_RADIUS) return HU.marker;
    }
    if (y < -122 && y > -134 && Math.abs(x) < 210) return HU.table;
    return HU.air;
  }
  // 皮膚・皮下脂肪・筋肉（胸壁）
  if (dBody > -2) return HU.skin;
  if (dBody > -11) return HU.fat;

  // 骨（チューブ系：肋骨・肋軟骨・鎖骨）
  let tubeHit = null, tubeD = 1e9;
  for (const s of segs) {
    if (x < s.xmin || x > s.xmax || y < s.ymin || y > s.ymax) continue;
    const d = segDist(s, x, y, z);
    if (d < 0 && d < tubeD) { tubeD = d; tubeHit = s; }
  }
  if (tubeHit) {
    const st = tubeHit.structure;
    const r = lerp(tubeHit.r0, tubeHit.r1, 0.5);
    switch (st) {
      case 'rib': case 'clavicle': return -tubeD < 1.6 ? HU.cortical : HU.cancellous + (r > 0 ? 0 : 0);
      case 'cartilage': return HU.cartilage;
      case 'aorta': case 'vein': case 'pa': return -tubeD < 1.2 && r > 5 ? HU.blood + 20 : HU.contrast;
      case 'pv': return HU.contrast - 20;
      case 'trachea': case 'bronchus': return -tubeD < (r > 4 ? 1.8 : 0.6) ? HU.muscle - 10 : HU.air + 40;
      case 'esophagus': return -tubeD > 4.5 ? -600 : HU.esophagus;
      default: break;
    }
  }

  if (sdSternum(x, y, z) < 0) return sdSternum(x, y, z) > -1.6 ? HU.cortical : HU.cancellous;
  const dSp = sdSpine(x, y, z);
  if (dSp < 0) return dSp > -2 ? HU.cortical : HU.cancellous;
  if (Math.hypot(x - SPINAL_CORD.c[0], y - SPINAL_CORD.c[1]) < SPINAL_CORD.r + 3 && dBody < -30) return HU.cord;

  if (dBody > -24) return HU.muscle; // 胸壁の筋肉層

  const dH = sdHeart(x, y, z);
  if (dH < 0) {
    if (dH > -8) return HU.myo;
    // 心室中隔・房室の境界（造影された内腔の中の心筋）
    const dx = x - HEART.c[0], dy = y - HEART.c[1];
    const cs = Math.cos(HEART.rot), sn = Math.sin(HEART.rot);
    const lx = dx * cs + dy * sn, ly = -dx * sn + dy * cs;
    if (Math.abs(ly - 0.35 * lx + 4) < 4.5 && z < HEART.c[2] + 30) return HU.myo;
    if (Math.abs(z - (HEART.c[2] + 18) + 0.2 * lx) < 2.5) return HU.myo - 10;
    return HU.contrast;
  }

  if (sdNodule(x, y, z) < 0) return HU.nodule;

  if (z > diaphragmZ(x, y) - 4) {
    if (sdLung('right', x, y, z) < 0 || sdLung('left', x, y, z) < 0) return HU.lung;
    // 横隔膜の筋層
    if (z < diaphragmZ(x, y) + 2) return HU.muscle;
    return HU.mediastinum;
  }
  if (sdLiver(x, y, z) < 0) return HU.liver;
  if (sdStomach(x, y, z) < 0) {
    // 胃泡（立位でなく仰臥位なので腹側にガス）
    return y > 34 ? HU.air + 80 : HU.stomach;
  }
  if (sdSpleen(x, y, z) < 0) return HU.spleen;
  return HU.fat + 15;
}

/** ウィンドウ設定（縦隔条件・肺野条件） */
export const WINDOWS = {
  mediastinum: { name: '縦隔', ww: 400, wl: 40 },
  lung: { name: '肺野', ww: 1500, wl: -600 },
  bone: { name: '骨', ww: 1800, wl: 400 },
};

/** HU 配列をグレースケール RGBA に変換 */
export function huToRGBA(hu, ww, wl, rgba = new Uint8ClampedArray(hu.length * 4)) {
  const lo = wl - ww / 2;
  for (let i = 0; i < hu.length; i++) {
    const v = clamp(((hu[i] - lo) / ww) * 255, 0, 255);
    rgba[i * 4] = v; rgba[i * 4 + 1] = v; rgba[i * 4 + 2] = v; rgba[i * 4 + 3] = 255;
  }
  return rgba;
}

/** 体表から点 p までの、方向 dir に沿った深さ（mm）。2点ラインの深度計測に使用。 */
export function depthAlong(entry, target) {
  return Math.hypot(target[0] - entry[0], target[1] - entry[1], target[2] - entry[2]);
}

export const PHANTOM_INFO = {
  description: '合成胸部ファントム（解析形状から生成。実在の患者データではありません）',
  sliceThickness: 1.0,
  zRange: BODY_Z,
};
