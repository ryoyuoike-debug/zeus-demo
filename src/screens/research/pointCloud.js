// =============================================================================
// 研究段階（構想）: 点群とARマーカーによる位置合わせ
// -----------------------------------------------------------------------------
// iPad・iPhone の LiDAR で取得した体表の点群（ここでは体表メッシュから合成）を、
// ARマーカーを共通の目印にして 3D モデルへ重ね合わせる流れをアニメーションで示します。
// 表示はイメージです（精度や計測値は表示しません）。
// =============================================================================
import * as THREE from 'three';
import { createViewer } from '../../three/viewer.js';
import { getAnatomyGeometries, createAnatomyModel, toWorld } from '../../three/meshing.js';
import { makeRng, anteriorSkinY, STRUCTURE_BY_ID } from '../../data/phantom.js';
import { h, conceptBadge } from '../../ui/dom.js';
import { skinNormal } from './vobjMath.js';

const ORGANS = ['lung_r', 'lung_l', 'heart', 'aorta', 'vein', 'trachea', 'bronchus', 'rib', 'sternum', 'clavicle', 'nodule'];
const CAM = { pos: [560, 190, 600], target: [70, 10, -10] };
const MARKER_AT = [0, 0, 18]; // 体表のマーカ位置（x, -, z）。y は体表から求める
const START = { pos: new THREE.Vector3(200, -34, -120), rot: new THREE.Euler(0.14, -0.4, 0.09) };
const T = { scan: 3.4, marker: 1.6, align: 3.4, reflect: 2.4, hold: 2.2 };
const TOTAL = T.scan + T.marker + T.align + T.reflect + T.hold;
const ITER = 6;

const STEPS = [
  { title: '体表の点群を取得', text: 'iPad・iPhone の LiDAR で、体表の形を点群として取得します。', icon: 'lidar' },
  { title: 'ARマーカーを共通の目印に', text: '体表に置いたARマーカーを、点群と3Dモデルの共通の目印にします。', icon: 'marker' },
  { title: 'PCで位置と向きを計算', text: '点群と3Dモデルを重ね合わせ、モデルの位置と向きを求めます。', icon: 'pc' },
  { title: 'Questに反映', text: '計算した結果を、ARグラスの表示に反映します。', icon: 'hmd' },
];
const ICONS = {
  lidar: '<svg viewBox="0 0 32 32" aria-hidden="true"><rect x="7" y="3" width="18" height="26" rx="3"/><circle cx="20" cy="8" r="2.2"/><path d="M11 22 q5 -4 10 0" class="i-accent"/><path d="M9 25 q7 -6 14 0" class="i-accent i-faint"/></svg>',
  marker: '<svg viewBox="0 0 32 32" aria-hidden="true"><rect x="5" y="5" width="22" height="22" rx="2"/><rect x="9" y="9" width="5" height="5" class="i-fill"/><rect x="18" y="9" width="5" height="5" class="i-fill"/><rect x="9" y="18" width="5" height="5" class="i-fill"/><rect x="16" y="16" width="3" height="3" class="i-fill"/><rect x="20" y="20" width="3" height="3" class="i-fill"/></svg>',
  pc: '<svg viewBox="0 0 32 32" aria-hidden="true"><rect x="3" y="5" width="26" height="17" rx="2"/><path d="M12 27 h8 M16 22 v5"/><path d="M9 16 l4 -5 l3 3 l5 -6" class="i-accent"/></svg>',
  hmd: '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M4 12 q0 -4 4 -4 h16 q4 0 4 4 v6 q0 4 -4 4 h-4 l-2 -3 h-4 l-2 3 h-4 q-4 0 -4 -4 z"/><circle cx="11" cy="15" r="2.5" class="i-accent"/><circle cx="21" cy="15" r="2.5" class="i-accent"/></svg>',
};

/** ARマーカー風のテクスチャ（汎用の白黒パターン） */
function markerTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#000'; g.fillRect(8, 8, 112, 112);
  const rng = makeRng(2024);
  const cell = 96 / 6;
  for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) {
    const edge = i === 0 || j === 0 || i === 5 || j === 5;
    if (!edge && rng() > 0.5) { g.fillStyle = '#fff'; g.fillRect(16 + i * cell, 16 + j * cell, cell, cell); }
  }
  g.fillStyle = '#fff'; g.fillRect(16 + cell, 16 + cell, cell, cell); // 向きの目印
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createPointCloud({ signal }) {
  let destroyed = false;
  let ready = false;

  // ---------------------------------------------------------------------------
  // DOM
  // ---------------------------------------------------------------------------
  const host = h('div', { class: 'three-host rs-pc-host' });
  const phaseLabel = h('div', { class: 'rs-pc-phase' });
  const loading = h('div', { class: 'rs-loading' }, h('span', { class: 'spinner' }), '準備しています…');
  const stage = h('div', { class: 'rs-pc-stage' }, host, phaseLabel,
    h('div', { class: 'rs-pc-legend' },
      h('span', {}, h('i', { class: 'is-cloud' }), '体表の点群（合成）'),
      h('span', {}, h('i', { class: 'is-model' }), '3Dモデル'),
      h('span', {}, h('i', { class: 'is-marker' }), 'ARマーカー')),
    loading);
  const stepEls = STEPS.map((s, i) => h('li', { class: 'rs-pc-step' },
    h('span', { class: 'rs-pc-icon', html: ICONS[s.icon] }),
    h('div', {}, h('div', { class: 'rs-pc-step-title' }, h('b', {}, `${i + 1}`), s.title), h('p', {}, s.text)),
    h('span', { class: 'rs-pc-bar' }, h('span'))));
  const replayBtn = h('button', { class: 'btn btn-sm', onclick: () => { time = 0; paused = false; } }, '↺ もう一度再生');
  const el = h('section', { class: 'rs-sec rs-pc' },
    h('div', { class: 'rs-pc-main' },
      h('div', { class: 'rs-sec-head' },
        h('div', { class: 'rs-sec-title' }, '点群とARマーカーによる位置合わせ', conceptBadge()),
        h('p', { class: 'rs-sec-lead' }, '体表の点群とARマーカーを手がかりに、3Dモデルの位置と向きを求める研究です。')),
      stage),
    h('aside', { class: 'rs-pc-side' },
      h('ol', { class: 'rs-pc-steps' }, stepEls),
      h('div', { class: 'rs-pc-actions' }, replayBtn),
      h('p', { class: 'rs-note' }, '研究段階（構想）の内容です。表示はイメージで、精度や計測値を示すものではありません。')));

  // ---------------------------------------------------------------------------
  // 3D
  // ---------------------------------------------------------------------------
  const viewer = createViewer(host, { cameraPos: CAM.pos, target: CAM.target, lights: 'studio' });
  viewer.controls.minDistance = 260;
  viewer.controls.maxDistance = 1600;
  const scene = viewer.scene;
  let time = 0;
  let paused = false;
  const textures = [];
  let state3d = null;

  getAnatomyGeometries().then((geoms) => {
    if (destroyed || signal.aborted) return;
    // モデル（ホログラム）＋体表のワイヤーフレーム
    const model = createAnatomyModel(geoms, { style: 'clinical', include: ORGANS, opacity: { lung_r: 0.3, lung_l: 0.3, rib: 0.7, sternum: 0.8, clavicle: 0.8 } });
    for (const [id, mesh] of model.meshes) {
      mesh.material.emissive = new THREE.Color(STRUCTURE_BY_ID[id].color).multiplyScalar(id === 'nodule' ? 0.6 : 0.22);
      mesh.material.emissiveIntensity = 1;
    }
    scene.add(model.group);
    const skinGeo = geoms.get('skin');

    // 点群（体表の前面から合成）
    const P = skinGeo.attributes.position;
    const rng = makeRng(77);
    const cand = [];
    for (let i = 0; i < P.count; i++) {
      const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
      if (z > -8 && y > -110 && y < 150) cand.push(i);
    }
    const N = Math.min(9000, cand.length * 2);
    const pts = [];
    for (let k = 0; k < N; k++) {
      const i = cand[Math.floor(rng() * cand.length)];
      pts.push([P.getX(i) + (rng() - 0.5) * 5, P.getY(i) + (rng() - 0.5) * 5, P.getZ(i) + (rng() - 0.5) * 4]);
    }
    pts.sort((a, b) => b[1] - a[1]); // 上から下へスキャン
    const pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
    const c0 = new THREE.Color('#3be0ff'), c1 = new THREE.Color('#a78bfa'), cc = new THREE.Color();
    pts.forEach((p, k) => {
      pos.set(p, k * 3);
      cc.copy(c0).lerp(c1, (150 - p[1]) / 260);
      col.set([cc.r, cc.g, cc.b], k * 3);
    });
    const cloudGeo = new THREE.BufferGeometry();
    cloudGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    cloudGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    cloudGeo.computeBoundingSphere();
    const cloudMat = new THREE.PointsMaterial({ size: 3.2, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false });
    const cloud = new THREE.Points(cloudGeo, cloudMat);
    cloud.userData.ownGeometry = true;
    const cloudGroup = new THREE.Group();
    cloudGroup.add(cloud);
    scene.add(cloudGroup);

    // スキャンの帯
    const scanGeo = new THREE.TorusGeometry(1, 0.012, 6, 64, Math.PI); // 前面だけの半周
    const scan = new THREE.Mesh(scanGeo, new THREE.MeshBasicMaterial({ color: '#3be0ff', transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending }));
    scan.userData.ownGeometry = true;
    scan.rotation.x = Math.PI / 2;
    scan.scale.set(165, 122, 1);
    cloudGroup.add(scan);

    // ARマーカー（モデル側と点群側）
    const tex = markerTexture();
    textures.push(tex);
    const mY = anteriorSkinY(MARKER_AT[0], MARKER_AT[2]);
    const mP = [MARKER_AT[0], mY, MARKER_AT[2]];
    const mN = toWorld(skinNormal(mP)).normalize();
    const mW = toWorld(mP).addScaledVector(mN, 1.2);
    const plateGeo = new THREE.PlaneGeometry(40, 40);
    const frameGeo = new THREE.EdgesGeometry(new THREE.PlaneGeometry(46, 46));
    const mkMarker = (frameColor) => {
      const g = new THREE.Group();
      const plate = new THREE.Mesh(plateGeo, new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, transparent: true, opacity: 0.95 }));
      plate.userData.ownGeometry = true;
      const frame = new THREE.LineSegments(frameGeo, new THREE.LineBasicMaterial({ color: frameColor, transparent: true, opacity: 0.9 }));
      frame.userData.ownGeometry = true;
      g.add(plate, frame);
      g.position.copy(mW);
      g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), mN);
      return { g, plate, frame };
    };
    const mkModel = mkMarker('#ffb26b');
    const mkCloud = mkMarker('#3be0ff');
    scene.add(mkModel.g);
    cloudGroup.add(mkCloud.g);

    // マーカ同士を結ぶ線
    const linkGeo = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(6), 3));
    const linkLine = new THREE.Line(linkGeo, new THREE.LineDashedMaterial({ color: '#ffd400', dashSize: 6, gapSize: 4, transparent: true, opacity: 0, depthTest: false }));
    linkLine.userData.ownGeometry = true;
    linkLine.renderOrder = 20;
    scene.add(linkLine);

    const baseOp = {};
    for (const id of ORGANS) baseOp[id] = model.getOpacity(id);
    state3d = { model, cloud, cloudGroup, cloudMat, scan, mkModel, mkCloud, linkLine, N, baseOp };
    ready = true;
    loading.classList.add('is-done');
  });

  // ---------------------------------------------------------------------------
  // タイムライン
  // ---------------------------------------------------------------------------
  const qStart = new THREE.Quaternion().setFromEuler(START.rot), qId = new THREE.Quaternion(), qTmp = new THREE.Quaternion();
  const wa = new THREE.Vector3(), wb = new THREE.Vector3();
  const ease = (u) => (u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2);
  let lastPhase = -1;
  function setPhase(i, text) {
    if (i !== lastPhase) {
      lastPhase = i;
      stepEls.forEach((e, k) => { e.classList.toggle('is-active', k === i); e.classList.toggle('is-done', k < i); });
    }
    if (phaseLabel.textContent !== text) phaseLabel.textContent = text;
  }
  function setAlign(a) {
    const s = state3d;
    s.cloudGroup.position.copy(START.pos).multiplyScalar(1 - a);
    qTmp.copy(qStart).slerp(qId, a);
    s.cloudGroup.quaternion.copy(qTmp);
  }

  viewer.onFrame((dt) => {
    if (!ready) return;
    const s = state3d;
    if (!paused) time += dt;
    if (time > TOTAL) time = 0;
    let t = time;
    const bars = [0, 0, 0, 0];
    // 1) スキャン
    if (t < T.scan) {
      const u = t / T.scan;
      bars[0] = u;
      s.cloud.geometry.setDrawRange(0, Math.floor(s.N * Math.min(1, u * 1.08)));
      s.scan.visible = true;
      s.scan.position.set(0, 150 - 270 * u, 0);
      s.scan.material.opacity = 0.85;
      setAlign(0);
      s.cloudMat.opacity = 0.95;
      s.linkLine.material.opacity = 0;
      s.mkCloud.g.visible = u > 0.55;
      for (const id of ORGANS) s.model.setOpacity(id, s.baseOp[id] * 0.25);
      setPhase(0, '① 体表の点群を取得しています…');
      updateBars(bars);
      return;
    }
    s.scan.visible = false;
    s.cloud.geometry.setDrawRange(0, s.N);
    s.mkCloud.g.visible = true;
    bars[0] = 1;
    t -= T.scan;
    // 2) マーカー
    if (t < T.marker) {
      const u = t / T.marker;
      bars[1] = u;
      setAlign(0);
      const pulse = 0.5 + 0.5 * Math.sin(u * Math.PI * 4);
      s.mkCloud.frame.material.opacity = s.mkModel.frame.material.opacity = 0.5 + 0.5 * pulse;
      s.mkCloud.g.scale.setScalar(1 + 0.12 * pulse);
      s.mkModel.g.scale.setScalar(1 + 0.12 * pulse);
      updateLink(Math.min(1, u * 2));
      setPhase(1, '② ARマーカーを共通の目印として検出');
      updateBars(bars);
      return;
    }
    s.mkCloud.g.scale.setScalar(1); s.mkModel.g.scale.setScalar(1);
    bars[1] = 1;
    t -= T.marker;
    // 3) 位置合わせ（反復）
    if (t < T.align) {
      const u = t / T.align;
      bars[2] = u;
      const k = Math.min(ITER - 1, Math.floor(u * ITER));
      const f = (u * ITER) - k;
      const a0 = 1 - Math.pow(0.42, k), a1 = k === ITER - 1 ? 1 : 1 - Math.pow(0.42, k + 1);
      setAlign(a0 + (a1 - a0) * ease(f));
      updateLink(1 - u);
      setPhase(2, `③ 位置と向きを計算しています…（反復 ${k + 1}/${ITER}）`);
      updateBars(bars);
      return;
    }
    bars[2] = 1;
    setAlign(1);
    updateLink(0);
    t -= T.align;
    // 4) 反映
    const u = Math.min(1, t / T.reflect);
    bars[3] = u;
    for (const id of ORGANS) s.model.setOpacity(id, s.baseOp[id] * (0.25 + 0.75 * ease(u)));
    s.cloudMat.opacity = 0.95 - 0.6 * ease(u);
    setPhase(3, t < T.reflect ? '④ 結果をQuestの表示に反映' : '位置合わせの流れ（イメージ）');
    updateBars(bars);
  });

  function updateLink(op) {
    const s = state3d;
    s.mkModel.g.getWorldPosition(wa);
    s.mkCloud.g.getWorldPosition(wb);
    const p = s.linkLine.geometry.attributes.position;
    p.setXYZ(0, wa.x, wa.y, wa.z); p.setXYZ(1, wb.x, wb.y, wb.z);
    p.needsUpdate = true;
    s.linkLine.computeLineDistances();
    s.linkLine.material.opacity = op * 0.9;
    s.linkLine.visible = op > 0.01;
  }
  let lastBars = '';
  function updateBars(b) {
    const key = b.map((v) => v.toFixed(2)).join();
    if (key === lastBars) return;
    lastBars = key;
    stepEls.forEach((e, i) => { e.querySelector('.rs-pc-bar > span').style.width = `${b[i] * 100}%`; });
  }

  return {
    el,
    activate() { viewer.resume(); viewer.resize(); },
    deactivate() { viewer.pause(); },
    destroy() {
      destroyed = true;
      state3d?.model.dispose();
      viewer.dispose();
      textures.forEach((tx) => tx.dispose());
    },
    async tour(t) { await t.sleep(2000); },
  };
}
