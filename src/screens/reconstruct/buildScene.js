// =============================================================================
// 3D構成：3D モデルが組み上がっていく表示
// -----------------------------------------------------------------------------
//   DICOM読込      … 体表の輪郭リングが頭側から足側へ積み重なる（スライスの読込）
//   臓器の自動抽出  … 走査面が上下し、構造が 1 つずつワイヤーフレームで現れる
//   3Dモデル出力    … 走査面が頭→足へ進み、通過した部分がソリッドに置き換わる
//   軽量化・端末用変換 … 走査面が足→頭へ戻り、残っていた細かな線が消える
// apply(T) は仮想時刻 T だけで見た目を決める（早送り・再生し直しに強い）。
// 共有の解剖ジオメトリは破棄しない。この画面で作るジオメトリには userData.ownGeometry を付ける。
// =============================================================================
import * as THREE from 'three';
import { createAnatomyModel, tubesGeometry } from '../../three/meshing.js';
import { sdBody, BODY_Z, SPINAL_CORD } from '../../data/phantom.js';
import {
  CHECKLIST, MODEL_IDS, STAGE, TOTAL, CORD_COLOR, KEY_OF_ID,
  revealTime, clamp01, lerp, easeInOut, easeOut,
} from './pipeline.js';

const Z_TOP = BODY_Z[1] - 4;
const Z_BOT = BODY_Z[0] + 4;
const RING_N = 52;          // DICOM 読込で積み重ねる輪郭リングの数
const SEG = 72;             // 輪郭 1 周の分割数
const TARGET = new THREE.Vector3(0, -6, 0);

// -----------------------------------------------------------------------------
// 体表の輪郭（その高さの軸位断で、体の外形をなぞる閉曲線）
// -----------------------------------------------------------------------------
const contourCache = new Map();
/** 患者座標の z における体表輪郭 [[x,y], ...]（SEG 点） */
export function bodyContour(z) {
  const zz = Math.max(BODY_Z[0] + 0.5, Math.min(BODY_Z[1] - 0.5, z));
  const key = Math.round(zz * 2);
  let pts = contourCache.get(key);
  if (pts) return pts;
  pts = [];
  for (let k = 0; k < SEG; k++) {
    const th = (k / SEG) * Math.PI * 2;
    const dx = Math.cos(th), dy = Math.sin(th);
    let lo = 0, hi = 260;
    for (let i = 0; i < 22; i++) {
      const m = (lo + hi) / 2;
      if (sdBody(m * dx, m * dy, key / 2) < 0) lo = m; else hi = m;
    }
    pts.push([lo * dx, lo * dy]);
  }
  if (contourCache.size > 600) contourCache.clear();
  contourCache.set(key, pts);
  return pts;
}

function radialTexture(stops, size = 128) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, col] of stops) grad.addColorStop(o, col);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 走査面のテクスチャ（中心が明るい円形のグロー＋細かいグリッド） */
function scanTexture() {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const glow = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  glow.addColorStop(0, 'rgba(255,255,255,0.42)');
  glow.addColorStop(0.55, 'rgba(255,255,255,0.16)');
  glow.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, S, S);
  // グリッド（外側ほど薄く）
  const grid = document.createElement('canvas');
  grid.width = grid.height = S;
  const gg = grid.getContext('2d');
  gg.strokeStyle = 'rgba(255,255,255,0.55)';
  gg.lineWidth = 1;
  for (let i = 8; i < S; i += 16) {
    gg.beginPath(); gg.moveTo(i + 0.5, 0); gg.lineTo(i + 0.5, S); gg.stroke();
    gg.beginPath(); gg.moveTo(0, i + 0.5); gg.lineTo(S, i + 0.5); gg.stroke();
  }
  gg.globalCompositeOperation = 'destination-in';
  const mask = gg.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  mask.addColorStop(0, 'rgba(0,0,0,0.9)');
  mask.addColorStop(0.7, 'rgba(0,0,0,0.25)');
  mask.addColorStop(1, 'rgba(0,0,0,0)');
  gg.fillStyle = mask;
  gg.fillRect(0, 0, S, S);
  g.drawImage(grid, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// 構造ごとのワイヤーフレームの濃さ（細かいメッシュほど薄く）
const WIRE_OPACITY = {
  skin: 0.028, lung_r: 0.07, lung_l: 0.07, heart: 0.2, spine: 0.045, liver: 0.12, stomach: 0.16, sternum: 0.08,
  pa: 0.09, pv: 0.09, bronchus: 0.08, trachea: 0.18, rib: 0.075, cartilage: 0.11, clavicle: 0.13, cord: 0.35,
};

/**
 * 台座・輪郭リング・走査面などは即座に作り、解剖モデルは setGeometries() で後から加える
 * （初回はジオメトリ生成に 1〜2 秒かかるため、その間も DICOM 読込の表示を進められる）。
 * @param {ReturnType<import('../../three/viewer.js').createViewer>} viewer
 */
export function createBuildScene(viewer) {
  const { scene, renderer, camera, controls } = viewer;
  renderer.localClippingEnabled = true;
  const root = new THREE.Group();
  root.name = 'reconstruct-root';
  scene.add(root);
  const own = (o) => { o.userData.ownGeometry = true; return o; };
  const textures = [];

  // ---- カメラ側からの補助光（回り込んでも正面が暗くならないように） ----
  const headlight = new THREE.DirectionalLight(0xffffff, 0.55);
  root.add(headlight, headlight.target);

  // ---- 台座（ホログラム風の円形グリッドと光だまり） ----
  const polar = own(new THREE.PolarGridHelper(230, 12, 5, 96, 0x2a6aa8, 0x163a60));
  polar.material.transparent = true;
  polar.material.opacity = 0.5;
  polar.material.depthWrite = false;
  polar.material.toneMapped = false;
  polar.position.y = Z_BOT - 16;
  root.add(polar);
  const poolTex = radialTexture([[0, 'rgba(70,150,255,0.55)'], [0.5, 'rgba(40,110,255,0.14)'], [1, 'rgba(20,60,160,0)']]);
  textures.push(poolTex);
  const pool = own(new THREE.Mesh(new THREE.CircleGeometry(250, 64).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: poolTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false })));
  pool.position.y = Z_BOT - 17;
  root.add(pool);

  // ---- 解剖モデル（setGeometries で作成） ----
  const solidPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -1e4);
  const wirePlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 1e4);
  let model = null;
  let cordGeo = null;
  const solidById = new Map();
  const baseOpacity = new Map();
  const wireGroup = new THREE.Group();
  root.add(wireGroup);
  const wires = [];
  let triangles = 0;

  // ---- DICOM 読込：積み重なる体表の輪郭リング ----
  const ringPos = new Float32Array(RING_N * SEG * 2 * 3);
  for (let r = 0; r < RING_N; r++) {
    const z = lerp(Z_TOP, Z_BOT, r / (RING_N - 1));
    const pts = bodyContour(z);
    for (let k = 0; k < SEG; k++) {
      const a = pts[k], b = pts[(k + 1) % SEG];
      const o = (r * SEG + k) * 6;
      ringPos[o] = a[0]; ringPos[o + 1] = z; ringPos[o + 2] = a[1];
      ringPos[o + 3] = b[0]; ringPos[o + 4] = z; ringPos[o + 5] = b[1];
    }
  }
  const ringGeo = new THREE.BufferGeometry();
  ringGeo.setAttribute('position', new THREE.BufferAttribute(ringPos, 3));
  ringGeo.setDrawRange(0, 0);
  const ringMat = new THREE.LineBasicMaterial({ color: 0x5ab8ff, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
  const rings = own(new THREE.LineSegments(ringGeo, ringMat));
  rings.frustumCulled = false;
  root.add(rings);

  // ---- 走査面（輪郭リング＋グリッドの面） ----
  const loopGeo = () => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SEG * 3), 3));
    return g;
  };
  const scan = new THREE.Group();
  const scanTex = scanTexture();
  textures.push(scanTex);
  const scanPlaneMat = new THREE.MeshBasicMaterial({ map: scanTex, color: 0x58c4ff, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, toneMapped: false });
  const scanPlane = own(new THREE.Mesh(new THREE.PlaneGeometry(440, 330).rotateX(-Math.PI / 2), scanPlaneMat));
  scan.add(scanPlane);
  const scanRingGeo = loopGeo();
  const scanRingMats = [1, 0.45, 0.2].map((o) => new THREE.LineBasicMaterial({ color: 0x8fe6ff, transparent: true, opacity: o, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
  scanRingMats.forEach((m, i) => {
    const l = new THREE.LineLoop(scanRingGeo, m);
    if (i === 0) own(l);
    l.scale.set(1 + i * 0.025, 1, 1 + i * 0.025);
    l.frustumCulled = false;
    scan.add(l);
  });
  scan.visible = false;
  root.add(scan);
  let scanRingZ = null;
  function setLoop(geo, z, yOffset = 0) {
    const pts = bodyContour(z);
    const a = geo.attributes.position.array;
    for (let k = 0; k < SEG; k++) { a[k * 3] = pts[k][0]; a[k * 3 + 1] = yOffset; a[k * 3 + 2] = pts[k][1]; }
    geo.attributes.position.needsUpdate = true;
    geo.computeBoundingSphere();
  }

  // ---- 2D 表示中のスライス位置（CT ビューアと連動） ----
  const slice = new THREE.Group();
  const sliceLineGeo = loopGeo();
  const sliceLine = own(new THREE.LineLoop(sliceLineGeo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false, toneMapped: false })));
  sliceLine.frustumCulled = false;
  const fanGeo = new THREE.BufferGeometry();
  fanGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((SEG + 1) * 3), 3));
  const fanIdx = [];
  for (let k = 0; k < SEG; k++) fanIdx.push(SEG, k, (k + 1) % SEG);
  fanGeo.setIndex(fanIdx);
  const sliceFill = own(new THREE.Mesh(fanGeo, new THREE.MeshBasicMaterial({ color: 0xbfd8ff, transparent: true, opacity: 0.09, depthWrite: false, side: THREE.DoubleSide, toneMapped: false })));
  sliceFill.frustumCulled = false;
  slice.add(sliceLine, sliceFill);
  root.add(slice);
  function setSliceZ(z) {
    setLoop(sliceLineGeo, z);
    const pts = bodyContour(z);
    const a = fanGeo.attributes.position.array;
    for (let k = 0; k < SEG; k++) { a[k * 3] = pts[k][0]; a[k * 3 + 1] = 0; a[k * 3 + 2] = pts[k][1]; }
    a[SEG * 3] = 0; a[SEG * 3 + 1] = 0; a[SEG * 3 + 2] = 0;
    fanGeo.attributes.position.needsUpdate = true;
    fanGeo.computeBoundingSphere();
    slice.position.y = z;
  }

  function setGeometries(geoms) {
    if (model) return;
    // ソリッドの 3D モデル（出力段階で走査面より上を表示）
    model = createAnatomyModel(geoms, { include: MODEL_IDS });
    for (const m of model.meshes.values()) {
      m.material.clippingPlanes = [solidPlane];
      m.material.needsUpdate = true;
    }
    // 脊髄（CT の脊柱管内の構造。共有ジオメトリにはないのでここで作る）
    const cz0 = BODY_Z[0] + 30, cz1 = BODY_Z[1] - 30;
    const [cx, cy] = SPINAL_CORD.c;
    cordGeo = tubesGeometry([[[cx, cy, cz0, SPINAL_CORD.r * 0.85], [cx, cy, (cz0 + cz1) / 2, SPINAL_CORD.r], [cx, cy, cz1, SPINAL_CORD.r * 0.85]]], 12);
    const cordMesh = own(new THREE.Mesh(cordGeo, new THREE.MeshStandardMaterial({ color: CORD_COLOR, roughness: 0.5, metalness: 0.02, clippingPlanes: [solidPlane] })));
    cordMesh.name = 'cord';
    model.group.add(cordMesh);
    model.group.visible = false;
    root.add(model.group);
    for (const [id, m] of model.meshes) { solidById.set(id, m); baseOpacity.set(id, model.getOpacity(id)); }
    solidById.set('cord', cordMesh);
    baseOpacity.set('cord', 1);

    // ワイヤーフレーム（抽出段階）
    for (const c of CHECKLIST) {
      for (const id of c.ids) {
        const geo = id === 'cord' ? cordGeo : geoms.get(id);
        if (!geo) continue;
        const mat = new THREE.MeshBasicMaterial({
          color: c.color, wireframe: true, transparent: true, opacity: 0, depthWrite: false,
          blending: THREE.AdditiveBlending, toneMapped: false, clippingPlanes: [wirePlane],
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.name = `wire-${id}`;
        mesh.visible = false;
        if (!geo.boundingBox) geo.computeBoundingBox();
        const center = geo.boundingBox.getCenter(new THREE.Vector3());
        wireGroup.add(mesh);
        wires.push({ index: c.index, mesh, mat, center, base: WIRE_OPACITY[id] ?? 0.38 });
      }
    }
    for (const id of MODEL_IDS) { const g = geoms.get(id); if (g?.index) triangles += g.index.count / 3; }
    triangles += cordGeo.index.count / 3;
    lastT = -1;
  }

  // -----------------------------------------------------------------------------
  // 仮想時刻 T による見た目の決定
  // -----------------------------------------------------------------------------
  const L = STAGE.load, E = STAGE.extract, O = STAGE.output, C = STAGE.convert;
  const cScan = new THREE.Color(0x58c4ff), cConvert = new THREE.Color(0x3ee0b0), cRing = new THREE.Color(0x8fe6ff), cRingConvert = new THREE.Color(0x8ff5d2);
  let lastT = -1;

  function scanState(T) {
    // 走査面の高さと濃さ
    if (T < L.end) {
      const u = clamp01((T - L.start) / L.dur);
      return { y: lerp(Z_TOP, Z_BOT, u), op: 0.5 * clamp01(T / 0.25), mix: 0 };
    }
    if (T < E.end) {
      // 足側から始めて 2.5 往復し、頭側で終える（次の出力段階につなぐ）
      const u = (T - E.start) / E.dur;
      const y = lerp(Z_BOT, Z_TOP, (1 - Math.cos(Math.PI * 5 * u)) / 2);
      return { y, op: 0.62, mix: 0 };
    }
    if (T < O.end) {
      const u = easeInOut((T - O.start) / O.dur);
      return { y: lerp(Z_TOP, Z_BOT, u), op: 0.9, mix: 0 };
    }
    if (T < C.end) {
      const u = (T - C.start) / C.dur;
      return { y: lerp(Z_BOT, Z_TOP, easeInOut(u)), op: 0.75 * (1 - clamp01((u - 0.8) / 0.2)), mix: clamp01(u * 4) };
    }
    return null;
  }

  let lastDensity = 0;
  function apply(T) {
    // 表示が小さいほど 1 ピクセルに重なる線が増えて白飛びするので、ワイヤーの濃さを描画解像度で補正する
    const density = THREE.MathUtils.clamp(renderer.domElement.height / 560, 0.45, 1.6);
    if (T === lastT && density === lastDensity) return;
    lastT = T;
    lastDensity = density;
    const done = T >= TOTAL;

    // DICOM 読込のリング
    const nR = Math.round(clamp01((T - L.start) / L.dur) * RING_N);
    ringGeo.setDrawRange(0, nR * SEG * 2);
    let ringOp = 0.34;
    if (T > E.start) ringOp = lerp(0.34, 0.07, clamp01((T - E.start) / 1.4));
    if (T > O.start) ringOp *= 1 - clamp01((T - O.start) / 0.9);
    ringMat.opacity = ringOp;
    rings.visible = nR > 0 && ringOp > 0.004;

    // 走査面
    const s = scanState(T);
    scan.visible = !!s && s.op > 0.004;
    if (s) {
      scan.position.y = s.y;
      const zKey = Math.round(s.y * 2) / 2;
      if (zKey !== scanRingZ) { setLoop(scanRingGeo, zKey); scanRingZ = zKey; }
      scanPlaneMat.opacity = s.op * 0.55;
      scanPlaneMat.color.copy(cScan).lerp(cConvert, s.mix);
      scanRingMats.forEach((m, i) => { m.opacity = s.op * [1, 0.42, 0.18][i]; m.color.copy(cRing).lerp(cRingConvert, s.mix); });
    }

    // ソリッドとワイヤーフレームの切り替え（クリッピング面）
    if (model) model.group.visible = T >= O.start;
    if (T < O.start) {
      solidPlane.constant = -1e4;
      wirePlane.normal.set(0, -1, 0); wirePlane.constant = 1e4;
    } else if (T < O.end) {
      solidPlane.constant = -s.y;                       // 走査面より上（頭側）をソリッドで表示
      wirePlane.normal.set(0, -1, 0); wirePlane.constant = s.y; // 走査面より下はワイヤーフレーム
    } else {
      solidPlane.constant = 1e4;
      wirePlane.normal.set(0, 1, 0); wirePlane.constant = s ? -s.y : -1e4; // 変換段階：走査面より上に細い線が残る
    }

    // ワイヤーフレーム：1 つずつフェード＆スケールイン
    const inConvert = T >= O.end && !done;
    wireGroup.visible = !done;
    for (const w of wires) {
      const t0 = revealTime(w.index);
      if (T < t0 || done) { w.mesh.visible = false; continue; }
      w.mesh.visible = true;
      const r = clamp01((T - t0) / 0.55);
      const flash = 1 - easeOut(r);
      // 現れた瞬間だけ明るく（大きな構造が白飛びしないよう上限を付ける）
      let op = w.base * density + Math.min(w.base * 1.6, 0.2) * flash;
      if (inConvert) op = w.base * density * 0.55;
      w.mat.opacity = Math.min(1, op);
      const sc = 1 + 0.05 * flash;
      w.mesh.scale.setScalar(sc);
      w.mesh.position.copy(w.center).multiplyScalar(1 - sc);
    }
  }

  // -----------------------------------------------------------------------------
  // 完了後の強調表示（チェックリスト・3D のホバー）
  // -----------------------------------------------------------------------------
  let highlighted = null;
  /** key の構造を強調（dim = true なら他の構造を薄くする） */
  function setHighlight(key, { dim = true } = {}) {
    const sig = key ? `${key}|${dim}` : null;
    if (sig === highlighted) return;
    highlighted = sig;
    const ids = key ? new Set(CHECKLIST.find((c) => c.key === key)?.ids || []) : null;
    for (const [id, mesh] of solidById) {
      const base = baseOpacity.get(id) ?? 1;
      const on = !ids || !dim || ids.has(id);
      const v = on ? base : Math.max(0.035, base * 0.14);
      if (id === 'cord') {
        const t = v < 0.999;
        if (mesh.material.transparent !== t) { mesh.material.transparent = t; mesh.material.needsUpdate = true; }
        mesh.material.opacity = v;
        mesh.material.depthWrite = !t;
      } else {
        model.setOpacity(id, v);
      }
      const m = mesh.material;
      if (m.emissive) {
        if (m.userData.baseEmissive === undefined) m.userData.baseEmissive = m.emissive.getHex();
        if (ids && ids.has(id)) { m.emissive.set(m.color).multiplyScalar(0.35); } else m.emissive.setHex(m.userData.baseEmissive);
      }
    }
  }

  /** クライアント座標の位置にある構造（体表以外の最前面）を返す */
  function pick(clientX, clientY) {
    if (!model?.group.visible) return null;
    const rc = viewer.raycaster(clientX, clientY);
    const objs = [...solidById.values()].filter((m) => m.visible && m.name !== 'skin');
    const hits = rc.intersectObjects(objs, false);
    if (!hits.length) return null;
    const hit = hits[0];
    return { key: KEY_OF_ID[hit.object.name], point: hit.point };
  }

  // -----------------------------------------------------------------------------
  // カメラ：ゆっくり左右に振る自動回転（操作すると止まる）
  // -----------------------------------------------------------------------------
  const orbit = { on: true, t: 0, center: 0, el: 0.16, dist: null };
  controls?.target.copy(TARGET);
  function fitDistance() {
    const vf = THREE.MathUtils.degToRad(camera.fov);
    const needH = 540, needW = 420;
    const dv = needH / 2 / Math.tan(vf / 2);
    const hf = 2 * Math.atan(Math.tan(vf / 2) * camera.aspect);
    const dh = needW / 2 / Math.tan(hf / 2);
    return Math.max(dv, dh);
  }
  function placeCamera(az, el, d) {
    const tg = controls ? controls.target : TARGET;
    camera.position.set(tg.x + d * Math.sin(az) * Math.cos(el), tg.y + d * Math.sin(el), tg.z + d * Math.cos(az) * Math.cos(el));
    camera.lookAt(tg);
  }
  function updateCamera(dt) {
    headlight.position.copy(camera.position);
    headlight.target.position.copy(controls ? controls.target : TARGET);
    if (!orbit.on) return;
    orbit.t += dt;
    const az = orbit.center + 0.42 * Math.sin(orbit.t * 0.3);
    placeCamera(az, orbit.el, orbit.dist ?? fitDistance());
  }
  function setAutoOrbit(on) {
    if (on && !orbit.on) {
      // 今の視点から続けて振る
      const tg = controls ? controls.target : TARGET;
      const v = camera.position.clone().sub(tg);
      orbit.dist = v.length();
      orbit.center = Math.atan2(v.x, v.z);
      orbit.el = Math.asin(THREE.MathUtils.clamp(v.y / orbit.dist, -0.95, 0.95));
      orbit.t = 0;
    }
    orbit.on = on;
  }
  function resetView() {
    orbit.on = false;
    const d = fitDistance();
    const el = 0.16;
    viewer.flyTo([TARGET.x, TARGET.y + d * Math.sin(el), TARGET.z + d * Math.cos(el)], [TARGET.x, TARGET.y, TARGET.z], 700);
    return () => { Object.assign(orbit, { on: true, t: 0, center: 0, el, dist: null }); };
  }
  placeCamera(0, orbit.el, fitDistance());

  return {
    setGeometries,
    get ready() { return !!model; },
    apply,
    setSliceZ,
    setHighlight,
    pick,
    updateCamera,
    setAutoOrbit,
    resetView,
    get autoOrbit() { return orbit.on; },
    get triangles() { return triangles; },
    dispose() {
      model?.dispose();
      for (const t of textures) t.dispose();
      scene.remove(root);
      // 自前のジオメトリ（ownGeometry）とマテリアルは viewer.dispose() でも解放されるが、ここでも明示的に解放する
      root.traverse((o) => {
        if (o.userData.ownGeometry) o.geometry?.dispose();
        if (o.material && !Array.isArray(o.material)) o.material.dispose();
      });
      ringGeo.dispose();
      scanRingGeo.dispose();
    },
  };
}
