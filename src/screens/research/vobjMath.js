// =============================================================================
// 研究開発中の機能: 仮想オブジェクトの計測（デモ用の模擬値）
// -----------------------------------------------------------------------------
// 合成ファントムの符号付き距離関数（SDF）から、
//   ・体表との交点（始点）と先端までの距離／深さ
//   ・方向（体表の法線・冠状面・横断面に対する角度）
//   ・心臓／大血管／肺／食道までの最短距離と、その最近点
//   ・線上の構造（体表 → 先端の順に何を通るか）
// を求めます。座標はすべて患者座標（mm、x+ = 左、y+ = 前、z+ = 頭側）。
// =============================================================================
import {
  sdBody, sdHeart, sdLung, sdNodule, sdSternum, sdSpine, sdLiver,
  SEGMENTS, segDist, STRUCTURE_BY_ID,
} from '../../data/phantom.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const DEG = 180 / Math.PI;

// ---------------------------------------------------------------------------
// チューブ構造（線分の集合）
// ---------------------------------------------------------------------------
const segsOf = (ids) => SEGMENTS.filter((s) => ids.includes(s.structure));
const SEG = {
  great: segsOf(['aorta', 'vein']),
  esophagus: segsOf(['esophagus']),
  pulm: segsOf(['pa', 'pv']),
  airway: segsOf(['trachea', 'bronchus']),
  bone: segsOf(['rib', 'cartilage', 'clavicle']),
};

/** 線分群までの最短距離（表面まで）と最近点 */
function tubeNearest(segs, p) {
  let best = 1e9, bs = null;
  for (const s of segs) {
    const d = segDist(s, p[0], p[1], p[2]);
    if (d < best) { best = d; bs = s; }
  }
  if (!bs) return { d: 1e9, q: null };
  // 軸上の最近点 → 表面へ
  const a = [bs.ax, bs.ay, bs.az], b = [bs.bx, bs.by, bs.bz];
  const ab = sub(b, a);
  const t = clamp(dot(sub(p, a), ab) / (dot(ab, ab) || 1e-9), 0, 1);
  const axis = add(a, scale(ab, t));
  const r = bs.r0 + (bs.r1 - bs.r0) * t;
  const dir = norm(sub(p, axis));
  return { d: best, q: add(axis, scale(dir, r)) };
}
/** 点が線分群の内側か（バウンディングボックスで間引き） */
function tubeInside(segs, p) {
  const [x, y, z] = p;
  for (const s of segs) {
    if (x < s.xmin || x > s.xmax || y < s.ymin || y > s.ymax || z < s.zmin || z > s.zmax) continue;
    if (segDist(s, x, y, z) < 0) return true;
  }
  return false;
}

const lungMin = (x, y, z) => Math.min(sdLung('right', x, y, z), sdLung('left', x, y, z));

/** 数値勾配（外向き・正規化） */
function gradient(fn, p, h = 0.75) {
  const g = [
    fn(p[0] + h, p[1], p[2]) - fn(p[0] - h, p[1], p[2]),
    fn(p[0], p[1] + h, p[2]) - fn(p[0], p[1] - h, p[2]),
    fn(p[0], p[1], p[2] + h) - fn(p[0], p[1], p[2] - h),
  ];
  return norm(g);
}
/** SDF の表面上の最近点（1〜2 回のニュートン反復） */
function fieldNearest(fn, p) {
  let q = p.slice();
  for (let i = 0; i < 3; i++) {
    const d = fn(q[0], q[1], q[2]);
    if (Math.abs(d) < 0.2) break;
    q = sub(q, scale(gradient(fn, q), d));
  }
  return q;
}

/** 体表の外向き法線 */
export function skinNormal(p) {
  return gradient(sdBody, p, 1);
}

// ---------------------------------------------------------------------------
// 線上の構造の分類
// ---------------------------------------------------------------------------
export const PROFILE_CATS = {
  wall: { name: '胸壁・軟部組織', color: '#c98f74' },
  bone: { name: '骨', color: '#efe8d8' },
  lung: { name: '肺', color: '#7fd3ff' },
  nodule: { name: '結節', color: '#ffd400' },
  heart: { name: '心臓', color: '#e0566b' },
  great: { name: '大血管', color: '#ef3b3b' },
  pulm: { name: '肺血管', color: '#3d8bfd' },
  esophagus: { name: '食道', color: '#d9a679' },
  airway: { name: '気管・気管支', color: '#d7e3f4' },
  liver: { name: '肝臓', color: '#a0522d' },
  outside: { name: '体外', color: '#34425f' },
};

function classify(p) {
  const [x, y, z] = p;
  if (sdBody(x, y, z) > 0.5) return 'outside';
  if (sdNodule(x, y, z) < 0) return 'nodule';
  if (sdHeart(x, y, z) < 0) return 'heart';
  if (tubeInside(SEG.great, p)) return 'great';
  if (tubeInside(SEG.pulm, p)) return 'pulm';
  if (tubeInside(SEG.esophagus, p)) return 'esophagus';
  if (tubeInside(SEG.airway, p)) return 'airway';
  if (tubeInside(SEG.bone, p) || sdSternum(x, y, z) < 0 || sdSpine(x, y, z) < 0) return 'bone';
  if (lungMin(x, y, z) < 0) return 'lung';
  if (sdLiver(x, y, z) < 0) return 'liver';
  return 'wall';
}

// ---------------------------------------------------------------------------
// 名称
// ---------------------------------------------------------------------------
/** 体表上の位置の呼び名（例: 右前胸部・上） */
export function regionName(p) {
  const [x, y, z] = p;
  const ax = Math.abs(x);
  const side = x < -22 ? '右' : x > 22 ? '左' : '';
  const ang = Math.atan2(y, ax) * DEG; // 前方 = +90°
  let part;
  if (ax <= 22 && y > 0) part = '前胸部（正中）';
  else if (ax <= 22 && y < 0) part = '背部（正中）';
  else if (ang > 38) part = '前胸部';
  else if (ang < -38) part = '背部';
  else part = '側胸部';
  const level = z > 70 ? '上' : z > -10 ? '中' : '下';
  return `${side}${part}・${level}`;
}

/** 点がどの構造の中にあるか（到達位置の補足表示用） */
export function locateName(p) {
  const [x, y, z] = p;
  if (sdNodule(x, y, z) < 0.5) return '結節（右上葉）';
  if (sdHeart(x, y, z) < 0.5) return '心臓';
  const r = sdLung('right', x, y, z), l = sdLung('left', x, y, z);
  if (r < 0.5) return '右肺内';
  if (l < 0.5) return '左肺内';
  const c = classify(p);
  return c === 'outside' ? '体外' : PROFILE_CATS[c].name;
}

/**
 * 先端から見た、仮想オブジェクトの来る向きの言葉（例: 前方から・外側寄り・やや頭側寄り）
 * 左右は、先端のある側を基準に「内側／外側」で表す（正中付近では左右）。
 */
function approachText(dirOut, tip) {
  const [x, y, z] = dirOut;
  const parts = [];
  const side = tip[0] < -15 ? -1 : tip[0] > 15 ? 1 : 0; // 先端が右(-1)・左(+1)・正中(0)
  if (Math.abs(x) > Math.abs(y) * 1.2) {
    if (side !== 0 && Math.sign(x) !== side) parts.push('内側（正中側）から');
    else parts.push(x < 0 ? '右側方から' : '左側方から');
  } else {
    parts.push(y >= 0 ? '前方から' : '後方から');
    if (Math.abs(x) > 0.3) {
      if (side === 0) parts.push(x < 0 ? '右寄り' : '左寄り');
      else parts.push(Math.sign(x) === side ? '外側寄り' : '内側寄り');
    }
  }
  if (z > 0.45) parts.push('頭側寄り');
  else if (z > 0.18) parts.push('やや頭側寄り');
  else if (z < -0.45) parts.push('尾側寄り');
  else if (z < -0.18) parts.push('やや尾側寄り');
  return parts.join('・');
}

// ---------------------------------------------------------------------------
// メイン: 仮想オブジェクトの解析
// ---------------------------------------------------------------------------
/**
 * @param {number[]} tip 先端（到達位置）
 * @param {number[]} entry 体表側の点（ドラッグで指定した体表上の点）
 */
export function analyzeRod(tip, entry) {
  let out = sub(entry, tip);
  if (len(out) < 1e-3) out = [0, 1, 0];
  const u = norm(out); // 先端 → 体外 の向き
  // 体表との交点（先端から外向きに進んで、最初に体外へ出る点）
  let skin = tip.slice();
  if (sdBody(tip[0], tip[1], tip[2]) < 0) {
    let lo = 0, hi = 0;
    for (let s = 2; s <= 500; s += 2) {
      const p = add(tip, scale(u, s));
      if (sdBody(p[0], p[1], p[2]) >= 0) { hi = s; break; }
      lo = s;
    }
    if (hi === 0) hi = lo;
    for (let i = 0; i < 24; i++) {
      const m = (lo + hi) / 2;
      const p = add(tip, scale(u, m));
      if (sdBody(p[0], p[1], p[2]) < 0) lo = m; else hi = m;
    }
    skin = add(tip, scale(u, (lo + hi) / 2));
  }
  const depth = len(sub(skin, tip));
  const dirIn = scale(u, -1);
  const nOut = skinNormal(skin);

  // 角度
  const angNormal = Math.acos(clamp(dot(dirIn, scale(nOut, -1)), -1, 1)) * DEG;
  const angCoronal = Math.asin(clamp(Math.abs(dirIn[1]), 0, 1)) * DEG;
  const angAxial = Math.asin(clamp(Math.abs(dirIn[2]), 0, 1)) * DEG;

  // 線上のサンプリング（体表 → 先端）
  const step = depth > 160 ? 2 : 1;
  const n = Math.max(1, Math.ceil(depth / step));
  const samples = [];
  for (let i = 0; i <= n; i++) {
    const s = Math.min(depth, i * step);
    samples.push({ s, p: add(skin, scale(dirIn, s)) });
  }

  // 線上の構造（ランレングス）
  const profile = [];
  for (let i = 0; i < samples.length; i++) {
    const c = classify(samples[i].p);
    const s0 = i === 0 ? 0 : (samples[i - 1].s + samples[i].s) / 2;
    const s1 = i === samples.length - 1 ? depth : (samples[i].s + samples[i + 1].s) / 2;
    const last = profile[profile.length - 1];
    if (last && last.cat === c) last.to = s1;
    else profile.push({ cat: c, from: s0, to: s1 });
  }
  // 1mm 未満の細切れは前の区間にまとめる（先端の結節は残す）
  for (let i = profile.length - 2; i >= 1; i--) {
    if (profile[i].to - profile[i].from < 1 && profile[i].cat !== 'nodule') {
      profile[i - 1].to = profile[i].to;
      profile.splice(i, 1);
    }
  }
  for (let i = profile.length - 1; i >= 1; i--) {
    if (profile[i].cat === profile[i - 1].cat) { profile[i - 1].to = profile[i].to; profile.splice(i, 1); }
  }

  // 重要構造までの最短距離（線分上で最小）
  const coarse = samples.filter((_, i) => i % 2 === 0 || i === samples.length - 1);
  const nearest = (fnD) => {
    let best = { d: 1e9, p: null, i: -1 };
    coarse.forEach((smp, i) => {
      const d = fnD(smp.p);
      if (d < best.d) best = { d, p: smp.p, i };
    });
    return best;
  };
  // 心臓
  const hb = nearest((p) => sdHeart(p[0], p[1], p[2]));
  const heart = { d: hb.d, p: hb.p, q: hb.d > 0 ? fieldNearest(sdHeart, hb.p) : null };
  // 大血管・食道（チューブ）
  const tubeRes = (segs) => {
    let best = { d: 1e9, p: null, q: null };
    for (const smp of coarse) {
      const r = tubeNearest(segs, smp.p);
      if (r.d < best.d) best = { d: r.d, p: smp.p, q: r.q };
    }
    return best;
  };
  const great = tubeRes(SEG.great);
  const esophagus = tubeRes(SEG.esophagus);
  // 肺: 線が肺を通るかどうかで表示を変える
  let inLungLen = 0;
  for (const seg of profile) if (seg.cat === 'lung' || seg.cat === 'nodule' || seg.cat === 'pulm') inLungLen += seg.to - seg.from;
  const lb = nearest((p) => lungMin(p[0], p[1], p[2]));
  const tipLung = lungMin(tip[0], tip[1], tip[2]);
  const tipInLung = tipLung < 0 || (sdNodule(tip[0], tip[1], tip[2]) < 0.5 && inLungLen > 0);
  const lung = {
    d: lb.d, p: lb.p,
    q: lb.d > 0 ? fieldNearest(lungMin, lb.p) : null,
    crosses: lb.d < 0,
    tipInside: tipInLung,
    // 先端から胸膜（肺の表面）まで
    tipToPleura: tipInLung ? Math.max(0, -tipLung) : null,
    lengthInside: inLungLen,
  };
  return {
    tip, skin, depth, dirIn, normalOut: nOut,
    angles: { normal: angNormal, coronal: angCoronal, axial: angAxial },
    approach: approachText(u, tip),
    region: regionName(skin),
    tipPlace: locateName(tip),
    dist: { heart, great, lung, esophagus },
    profile,
  };
}

/** モデル上で指定された点の名前（到達位置の表示用） */
export function structureLabel(id) {
  return STRUCTURE_BY_ID[id]?.name ?? '指定した点';
}

/** 体軸まわりの角度 theta（0 = 患者の右側方, 90° = 正面, 180° = 左側方）と高さ z の体表上の点 */
export function skinPointAt(thetaDeg, z) {
  const th = (thetaDeg * Math.PI) / 180;
  const cx = -Math.cos(th), cy = Math.sin(th);
  let lo = 0, hi = 240;
  for (let i = 0; i < 40; i++) {
    const m = (lo + hi) / 2;
    if (sdBody(cx * m, cy * m, z) < 0) lo = m; else hi = m;
  }
  return [cx * lo, cy * lo, z];
}
