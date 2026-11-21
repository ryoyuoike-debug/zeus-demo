// =============================================================================
// 3D メッシュ生成（合成ファントム → Three.js ジオメトリ）
// -----------------------------------------------------------------------------
// ・フィールド型の構造（肺・心臓・体表など）: マーチングキューブで等値面を抽出
// ・チューブ型の構造（血管・気道・肋骨など）: 点列に沿ってチューブを掃引
// 生成したジオメトリはキャッシュし、各画面で共有します（画面ごとにマテリアルだけ作る）。
//
// 座標変換: 患者座標 (x: 左+, y: 前+, z: 頭+) [mm] → Three.js (X = x, Y = z, Z = y)
// （正面から見ると患者の左が画面右、頭が上、前面がカメラ側）
// =============================================================================
import * as THREE from 'three';
import { edgeTable, triTable } from 'three/examples/jsm/objects/MarchingCubes.js';
import { FIELD_STRUCTURES, STRUCTURES, TUBES } from '../data/phantom.js';

/** 患者座標 [x,y,z] → THREE.Vector3 */
export function toWorld(p, out = new THREE.Vector3()) {
  return out.set(p[0], p[2], p[1]);
}
/** THREE.Vector3 → 患者座標 [x,y,z] */
export function toPatient(v) {
  return [v.x, v.z, v.y];
}

// -----------------------------------------------------------------------------
// マーチングキューブ（エッジ共有・勾配法線つき）
// -----------------------------------------------------------------------------
// Paul Bourke の頂点順序:
// v0(0,0,0) v1(1,0,0) v2(1,1,0) v3(0,1,0) v4(0,0,1) v5(1,0,1) v6(1,1,1) v7(0,1,1)
const CORNER = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]];
// 各エッジ: [始点コーナー, 終点コーナー]
const EDGE = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];

/**
 * 符号付き距離関数 fn(x,y,z)（内側が負）の等値面 0 を抽出する。
 * @returns {THREE.BufferGeometry}
 */
export function marchingCubes(fn, box, step) {
  const [min, max] = box;
  const nx = Math.ceil((max[0] - min[0]) / step) + 1;
  const ny = Math.ceil((max[1] - min[1]) / step) + 1;
  const nz = Math.ceil((max[2] - min[2]) / step) + 1;
  const F = new Float32Array(nx * ny * nz);
  const idx = (i, j, k) => i + nx * (j + ny * k);
  for (let k = 0; k < nz; k++) {
    const z = min[2] + k * step;
    for (let j = 0; j < ny; j++) {
      const y = min[1] + j * step;
      for (let i = 0; i < nx; i++) {
        const x = min[0] + i * step;
        let v = fn(x, y, z);
        // 範囲の境界は外側扱いにして、閉じたメッシュにする
        if (i === 0 || j === 0 || k === 0 || i === nx - 1 || j === ny - 1 || k === nz - 1) v = Math.max(v, 0.01);
        F[idx(i, j, k)] = v;
      }
    }
  }

  const positions = [];
  const normals = [];
  const indices = [];
  const edgeCache = new Map();
  const h = step * 0.5;
  const grad = [0, 0, 0];
  const gradient = (x, y, z) => {
    grad[0] = fn(x + h, y, z) - fn(x - h, y, z);
    grad[1] = fn(x, y + h, z) - fn(x, y - h, z);
    grad[2] = fn(x, y, z + h) - fn(x, y, z - h);
    const l = Math.hypot(grad[0], grad[1], grad[2]) || 1;
    grad[0] /= l; grad[1] /= l; grad[2] /= l;
    return grad;
  };

  const vals = new Float32Array(8);
  const edgeVert = new Int32Array(12);
  for (let k = 0; k < nz - 1; k++) {
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        let cube = 0;
        for (let c = 0; c < 8; c++) {
          const v = F[idx(i + CORNER[c][0], j + CORNER[c][1], k + CORNER[c][2])];
          vals[c] = v;
          if (v < 0) cube |= 1 << c;
        }
        const bits = edgeTable[cube];
        if (bits === 0) continue;
        for (let e = 0; e < 12; e++) {
          if (!(bits & (1 << e))) continue;
          const [ca, cb] = EDGE[e];
          const ia = idx(i + CORNER[ca][0], j + CORNER[ca][1], k + CORNER[ca][2]);
          const ib = idx(i + CORNER[cb][0], j + CORNER[cb][1], k + CORNER[cb][2]);
          const key = ia < ib ? ia * 8388608 + ib : ib * 8388608 + ia;
          let vi = edgeCache.get(key);
          if (vi === undefined) {
            const va = vals[ca], vb = vals[cb];
            const t = Math.abs(va - vb) < 1e-9 ? 0.5 : va / (va - vb);
            const x = min[0] + (i + CORNER[ca][0] + (CORNER[cb][0] - CORNER[ca][0]) * t) * step;
            const y = min[1] + (j + CORNER[ca][1] + (CORNER[cb][1] - CORNER[ca][1]) * t) * step;
            const z = min[2] + (k + CORNER[ca][2] + (CORNER[cb][2] - CORNER[ca][2]) * t) * step;
            const g = gradient(x, y, z);
            vi = positions.length / 3;
            // 患者座標 → Three.js 座標
            positions.push(x, z, y);
            normals.push(g[0], g[2], g[1]);
            edgeCache.set(key, vi);
          }
          edgeVert[e] = vi;
        }
        const o = cube * 16;
        for (let t = 0; triTable[o + t] !== -1; t += 3) {
          indices.push(edgeVert[triTable[o + t]], edgeVert[triTable[o + t + 1]], edgeVert[triTable[o + t + 2]]);
        }
      }
    }
  }

  // 三角形の向きを法線（勾配＝外向き）にそろえる
  if (indices.length >= 3) {
    let agree = 0, total = 0;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
    for (let t = 0; t < indices.length && total < 200; t += 3 * Math.max(1, Math.floor(indices.length / 600))) {
      const i0 = indices[t], i1 = indices[t + 1], i2 = indices[t + 2];
      a.fromArray(positions, i0 * 3); b.fromArray(positions, i1 * 3); c.fromArray(positions, i2 * 3);
      n.subVectors(b, a).cross(c.sub(a));
      const d = n.x * normals[i0 * 3] + n.y * normals[i0 * 3 + 1] + n.z * normals[i0 * 3 + 2];
      if (d > 0) agree++;
      total++;
    }
    if (agree < total / 2) {
      for (let t = 0; t < indices.length; t += 3) {
        const tmp = indices[t + 1]; indices[t + 1] = indices[t + 2]; indices[t + 2] = tmp;
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setIndex(positions.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(indices, 1) : new THREE.Uint16BufferAttribute(indices, 1));
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
  return geo;
}

// -----------------------------------------------------------------------------
// 半径可変チューブ（平行移動フレーム）
// -----------------------------------------------------------------------------
/**
 * @param {Array<Array<[number,number,number,number]>>} paths 点列 [x,y,z,r]（患者座標）の配列
 * @returns {THREE.BufferGeometry} すべてのチューブを 1 つにまとめたジオメトリ
 */
export function tubesGeometry(paths, radialSegments = 10) {
  const positions = [];
  const normals = [];
  const indices = [];
  const T = new THREE.Vector3(), N = new THREE.Vector3(), B = new THREE.Vector3(), tmp = new THREE.Vector3();
  for (const path of paths) {
    if (path.length < 2) continue;
    const pts = path.map((p) => toWorld(p));
    const radii = path.map((p) => p[3]);
    const seg = radii[0] < 2.5 ? 6 : radialSegments;
    // 初期法線
    T.subVectors(pts[1], pts[0]).normalize();
    tmp.set(0, 1, 0);
    if (Math.abs(T.dot(tmp)) > 0.9) tmp.set(1, 0, 0);
    N.crossVectors(T, tmp).normalize();
    B.crossVectors(T, N).normalize();
    const base = positions.length / 3;
    for (let i = 0; i < pts.length; i++) {
      // 接線
      const prev = pts[Math.max(0, i - 1)], next = pts[Math.min(pts.length - 1, i + 1)];
      const Ti = new THREE.Vector3().subVectors(next, prev).normalize();
      // 平行移動: N を新しい接線に直交するよう回す
      N.sub(tmp.copy(Ti).multiplyScalar(N.dot(Ti))).normalize();
      B.crossVectors(Ti, N).normalize();
      const r = radii[i];
      for (let s = 0; s < seg; s++) {
        const a = (s / seg) * Math.PI * 2;
        const ca = Math.cos(a), sa = Math.sin(a);
        const nx = N.x * ca + B.x * sa, ny = N.y * ca + B.y * sa, nz = N.z * ca + B.z * sa;
        positions.push(pts[i].x + nx * r, pts[i].y + ny * r, pts[i].z + nz * r);
        normals.push(nx, ny, nz);
      }
    }
    for (let i = 0; i < pts.length - 1; i++) {
      for (let s = 0; s < seg; s++) {
        const a = base + i * seg + s;
        const b = base + i * seg + ((s + 1) % seg);
        const c = base + (i + 1) * seg + s;
        const d = base + (i + 1) * seg + ((s + 1) % seg);
        indices.push(a, c, b, b, c, d);
      }
    }
    // 端のキャップ
    for (const end of [0, pts.length - 1]) {
      const center = positions.length / 3;
      const dir = end === 0 ? tmp.subVectors(pts[0], pts[1]).normalize() : tmp.subVectors(pts[end], pts[end - 1]).normalize();
      positions.push(pts[end].x, pts[end].y, pts[end].z);
      normals.push(dir.x, dir.y, dir.z);
      const ring = base + end * seg;
      for (let s = 0; s < seg; s++) {
        const a = ring + s, b = ring + ((s + 1) % seg);
        if (end === 0) indices.push(center, b, a); else indices.push(center, a, b);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setIndex(positions.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(indices, 1) : new THREE.Uint16BufferAttribute(indices, 1));
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
  return geo;
}

// -----------------------------------------------------------------------------
// 全構造のジオメトリ生成（キャッシュ付き・進捗通知）
// -----------------------------------------------------------------------------
let cache = null;
const nextFrame = () => new Promise((r) => setTimeout(r, 0));

/**
 * すべての構造のジオメトリを生成する（2 回目以降はキャッシュを返す）。
 * @param {(p:{done:number,total:number,id:string,name:string})=>void} [onProgress]
 * @returns {Promise<Map<string, THREE.BufferGeometry>>}
 */
export function getAnatomyGeometries(onProgress) {
  if (cache) {
    if (onProgress) cache.then((m) => onProgress({ done: STRUCTURES.length, total: STRUCTURES.length, id: '', name: '' }));
    return cache;
  }
  cache = (async () => {
    const map = new Map();
    let done = 0;
    for (const s of STRUCTURES) {
      await nextFrame();
      if (s.mesh === 'field') {
        const def = FIELD_STRUCTURES[s.id];
        const geo = marchingCubes(def.f, def.box, def.step);
        // 角（max/min の境目）がある形状は、勾配法線より面法線の平均のほうが自然に見える
        if (def.geomNormals) geo.computeVertexNormals();
        map.set(s.id, geo);
      } else {
        const paths = TUBES.filter((t) => t.structure === s.id).map((t) => t.path);
        map.set(s.id, tubesGeometry(paths));
      }
      done++;
      onProgress?.({ done, total: STRUCTURES.length, id: s.id, name: s.name });
    }
    resolved = map;
    return map;
  })();
  return cache;
}

/** すでに生成済みならジオメトリを同期的に返す（未生成なら null） */
let resolved = null;
export function getAnatomyGeometriesSync() {
  return resolved;
}

// -----------------------------------------------------------------------------
// モデル（メッシュ群）の作成
// -----------------------------------------------------------------------------
const DEFAULT_OPACITY = {
  skin: 0.16, lung_r: 0.28, lung_l: 0.28, liver: 0.85, stomach: 0.85, heart: 0.92,
};

/**
 * 構造ごとのメッシュをまとめたモデルを作る。
 * @param {Map<string,THREE.BufferGeometry>} geoms getAnatomyGeometries() の結果
 * @param {{style?: 'clinical'|'hologram', include?: string[], opacity?: Object<string,number>}} [opts]
 * @returns {{group: THREE.Group, meshes: Map<string, THREE.Mesh>, setVisible:(id:string,v:boolean)=>void,
 *            setOpacity:(id:string,v:number)=>void, getOpacity:(id:string)=>number, isVisible:(id:string)=>boolean, dispose:()=>void}}
 */
export function createAnatomyModel(geoms, opts = {}) {
  const style = opts.style || 'clinical';
  const group = new THREE.Group();
  group.name = 'anatomy';
  const meshes = new Map();
  const opacities = new Map();
  for (const s of STRUCTURES) {
    if (opts.include && !opts.include.includes(s.id)) continue;
    const geo = geoms.get(s.id);
    if (!geo) continue;
    const op = opts.opacity?.[s.id] ?? DEFAULT_OPACITY[s.id] ?? 1;
    const color = new THREE.Color(s.color);
    let mat;
    if (style === 'hologram') {
      mat = new THREE.MeshStandardMaterial({
        color: color.clone().multiplyScalar(0.55), emissive: color, emissiveIntensity: 0.55,
        roughness: 0.35, metalness: 0.0, transparent: true, opacity: Math.min(op, 0.85), depthWrite: false,
        side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
      });
    } else {
      mat = new THREE.MeshStandardMaterial({
        color, roughness: s.id === 'skin' ? 0.6 : 0.45, metalness: 0.02,
        transparent: op < 1, opacity: op, depthWrite: op >= 1,
        side: op < 1 && s.id !== 'skin' ? THREE.DoubleSide : THREE.FrontSide,
      });
      if (s.id === 'nodule') { mat.emissive = new THREE.Color('#ffb300'); mat.emissiveIntensity = 0.35; }
    }
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = s.id;
    mesh.userData.structure = s;
    // 透明物は後に描画（体表を最後に）
    mesh.renderOrder = s.id === 'skin' ? 10 : op < 1 ? 5 : 0;
    group.add(mesh);
    meshes.set(s.id, mesh);
    opacities.set(s.id, op);
  }
  const applyOpacity = (id, v) => {
    const m = meshes.get(id);
    if (!m) return;
    opacities.set(id, v);
    const mat = m.material;
    mat.opacity = style === 'hologram' ? Math.min(v, 0.85) : v;
    if (style !== 'hologram') {
      const t = v < 0.999;
      if (mat.transparent !== t) { mat.transparent = t; mat.needsUpdate = true; }
      mat.depthWrite = !t;
      mat.side = t && id !== 'skin' ? THREE.DoubleSide : THREE.FrontSide;
      m.renderOrder = id === 'skin' ? 10 : t ? 5 : 0;
    }
    m.visible = v > 0.001 && m.userData.on !== false;
  };
  return {
    group,
    meshes,
    style,
    setVisible(id, v) {
      const m = meshes.get(id);
      if (!m) return;
      m.userData.on = v;
      m.visible = v && (opacities.get(id) ?? 1) > 0.001;
    },
    isVisible(id) { const m = meshes.get(id); return !!m && m.userData.on !== false; },
    setOpacity: applyOpacity,
    getOpacity(id) { return opacities.get(id) ?? 1; },
    dispose() { for (const m of meshes.values()) m.material.dispose(); },
  };
}

/** 構造 ID のグループ（UI の表示切替ボタン用） */
export const LAYER_GROUPS = [
  { id: 'skin', name: '体表', members: ['skin'] },
  { id: 'lung', name: '肺', members: ['lung_r', 'lung_l'] },
  { id: 'airway', name: '気管・気管支', members: ['trachea', 'bronchus'] },
  { id: 'heart', name: '心臓', members: ['heart'] },
  { id: 'vessel', name: '血管', members: ['aorta', 'vein'] },
  { id: 'pulmvessel', name: '肺血管', members: ['pa', 'pv'] },
  { id: 'bone', name: '骨', members: ['rib', 'cartilage', 'sternum', 'clavicle', 'spine'] },
  { id: 'abdomen', name: '腹部臓器', members: ['liver', 'stomach'] },
  { id: 'mediastinum', name: '食道', members: ['esophagus'] },
  { id: 'nodule', name: '結節', members: ['nodule'] },
];
