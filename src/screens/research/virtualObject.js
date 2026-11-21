// =============================================================================
// 研究開発中の機能: 仮想オブジェクト（研究開発中・未承認）
// -----------------------------------------------------------------------------
// ・3D モデル（体表は半透明）に仮想オブジェクトを表示。先端は到達位置にスナップ
// ・体表側の始点（オレンジのリング）をドラッグすると、体表上を移動
// ・方向／到達位置／距離・深さ／重要構造までの最短距離をリアルタイムに表示（模擬値）
// ・マーカオブジェクトを体表に何個でも追加できる（ドラッグで移動）
// =============================================================================
import * as THREE from 'three';
import { createViewer } from '../../three/viewer.js';
import { getAnatomyGeometries, createAnatomyModel, toWorld, toPatient } from '../../three/meshing.js';
import { NODULE } from '../../data/phantom.js';
import { state } from '../../app/state.js';
import { h, demoBadge, researchBadge, toast } from '../../ui/dom.js';
import { analyzeRod, regionName, skinNormal, skinPointAt, PROFILE_CATS, structureLabel } from './vobjMath.js';

/** 表示切替 */
const LAYERS = [
  { id: 'skin', name: '体表', members: ['skin'], on: true, color: '#f2c2a0' },
  { id: 'lung', name: '肺', members: ['lung_r', 'lung_l', 'trachea', 'bronchus'], on: true, color: '#7fd3ff' },
  { id: 'heart', name: '心臓', members: ['heart'], on: true, color: '#e0566b' },
  { id: 'great', name: '大血管', members: ['aorta', 'vein'], on: true, color: '#ef3b3b' },
  { id: 'esophagus', name: '食道', members: ['esophagus'], on: true, color: '#d9a679' },
  { id: 'pulm', name: '肺血管', members: ['pa', 'pv'], on: false, color: '#3d8bfd' },
  { id: 'bone', name: '骨', members: ['rib', 'cartilage', 'sternum', 'clavicle', 'spine'], on: true, color: '#efe8d8' },
];
const INCLUDE = [...LAYERS.flatMap((l) => l.members), 'nodule'];
const OPACITY = {
  skin: 0.2, lung_r: 0.14, lung_l: 0.14, trachea: 0.45, bronchus: 0.35, heart: 0.9,
  aorta: 1, vein: 1, esophagus: 1, pa: 0.8, pv: 0.8,
  rib: 0.32, cartilage: 0.26, sternum: 0.42, clavicle: 0.5, spine: 0.32, nodule: 1,
};

/** 最短距離を表示する構造 */
const DIST_KEYS = [
  { id: 'heart', name: '心臓', color: '#ff6b81' },
  { id: 'great', name: '大血管', color: '#ff5a4f', sub: '大動脈・大静脈' },
  { id: 'lung', name: '肺', color: '#7fd3ff' },
  { id: 'esophagus', name: '食道', color: '#e4b48a' },
];
const DIST_SCALE = 60; // バーの最大（mm）

const MARKER_COLORS = ['#2dd4bf', '#a78bfa', '#f472b6', '#38bdf8', '#a3e635', '#fb7185'];

const CAM = { pos: [-392, 172, 300], target: [-70, 58, 28] };
const DEFAULT_ENTRY = skinPointAt(50, 98);
const ROD_OUT = 95; // 体外に出ている部分の長さ（mm）

const fmt = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : '—');

export function createVirtualObject({ signal }) {
  // ---------------------------------------------------------------------------
  // 状態
  // ---------------------------------------------------------------------------
  const vs = {
    targetMode: 'nodule',
    target: NODULE.c.slice(),
    targetName: '結節（右上葉）',
    entry: DEFAULT_ENTRY.slice(),
    markers: [],
    mode: 'idle', // 'idle' | 'pickTarget' | 'placeMarker'
    hoverDist: null,
    analysis: null,
  };
  let markerSeq = 0;
  let ready = false;
  let destroyed = false;

  // ---------------------------------------------------------------------------
  // DOM
  // ---------------------------------------------------------------------------
  const targetDefs = [
    { id: 'nodule', label: '結節', title: '先端を結節（右上葉）にスナップ' },
    { id: 'roi', label: '関心領域', title: '先端を関心領域（ROI）の中心にスナップ' },
    { id: 'line', label: 'ラインの終点', title: '先端を2点ラインの終点にスナップ' },
    { id: 'custom', label: 'モデル上で指定', title: '3Dモデル上をクリックして到達位置を指定' },
  ];
  const targetBtns = {};
  const targetSeg = h('div', { class: 'seg rs-vo-target' }, targetDefs.map((d) => {
    const b = h('button', { class: 'seg-btn', title: d.title, onclick: () => chooseTarget(d.id) }, d.label);
    targetBtns[d.id] = b;
    return b;
  }));
  const addMarkerBtn = h('button', { class: 'btn btn-sm rs-vo-add', onclick: () => setMode(vs.mode === 'placeMarker' ? 'idle' : 'placeMarker') },
    h('span', { class: 'rs-plus', 'aria-hidden': 'true' }, '＋'), 'マーカオブジェクトを追加');
  const resetViewBtn = h('button', { class: 'icon-btn', title: '視点を戻す', 'aria-label': '視点を戻す', onclick: () => viewer.flyTo(CAM.pos, CAM.target, 800) }, '⟲');

  const toolbar = h('div', { class: 'rs-vo-toolbar' },
    h('span', { class: 'rs-tool-label' }, '到達位置'), targetSeg,
    h('span', { class: 'rs-grow' }),
    addMarkerBtn, resetViewBtn);

  const host = h('div', { class: 'three-host rs-vo-host' });
  const labelLayer = h('div', { class: 'rs-vo-labels', 'aria-hidden': 'true' });
  const layerChips = h('div', { class: 'rs-vo-layers' }, LAYERS.map((l) => {
    const chip = h('button', { class: 'chip rs-chip-sm' + (l.on ? ' is-on' : ''), onclick: () => {
      l.on = !l.on; chip.classList.toggle('is-on', l.on);
      for (const id of l.members) model?.setVisible(id, l.on);
    } }, h('span', { class: 'dot', style: { background: l.color } }), l.name);
    return chip;
  }));
  const markerList = h('div', { class: 'rs-vo-mlist', hidden: true });
  const modeBanner = h('div', { class: 'rs-vo-mode', hidden: true });
  const hint = h('div', { class: 'rs-vo-hint' },
    h('span', {}, h('i', { class: 'rs-dot-orange' }), 'オレンジのリング（始点）をドラッグ：体表上で移動'),
    h('span', {}, '背景をドラッグ：回転'), h('span', {}, 'ホイール：拡大・縮小'));
  const loading = h('div', { class: 'rs-loading' }, h('span', { class: 'spinner' }), '3Dモデルを準備しています…');
  const stage = h('div', { class: 'rs-vo-stage' }, host, labelLayer, layerChips, markerList, modeBanner, hint, loading);

  // ---- 計測パネル ----
  const depthNum = h('span', { class: 'rs-big-num' }, '—');
  const depthTile = h('div', { class: 'rs-tile rs-tile-depth' },
    h('div', { class: 'rs-tile-label' }, '距離／深さ'),
    h('div', { class: 'rs-tile-value' }, depthNum, h('span', { class: 'rs-unit' }, 'mm')),
    h('div', { class: 'rs-tile-sub' }, '体表（始点）から先端まで'));
  const targetName = h('div', { class: 'rs-tile-name' }, '—');
  const targetSub = h('div', { class: 'rs-tile-sub' }, '');
  const targetTile = h('div', { class: 'rs-tile rs-tile-target' },
    h('div', { class: 'rs-tile-label' }, '到達位置'), targetName, targetSub);

  const dial = h('div', { class: 'rs-dial' });
  const approach = h('div', { class: 'rs-approach' }, '—');
  const angNormal = h('b', {}, '—'), angCoronal = h('b', {}, '—'), angAxial = h('b', {}, '—');
  const dirTile = h('div', { class: 'rs-tile rs-tile-dir' },
    h('div', { class: 'rs-tile-label' }, '方向（角度）'),
    h('div', { class: 'rs-dir-body' },
      dial,
      h('div', { class: 'rs-dir-text' },
        approach,
        h('div', { class: 'rs-angles' },
          h('span', {}, '体表の法線に対して', angNormal),
          h('span', {}, '冠状面に対して', angCoronal),
          h('span', {}, '横断面に対して', angAxial)))));

  const distRows = {};
  const distList = h('div', { class: 'rs-dist-list' }, DIST_KEYS.map((k) => {
    const fill = h('span', { class: 'rs-bar-fill' });
    const val = h('span', { class: 'rs-dist-val' }, '—');
    const sub = h('span', { class: 'rs-dist-sub' }, k.sub || '');
    const row = h('div', { class: 'rs-dist-row',
      onpointerenter: () => { vs.hoverDist = k.id; refreshDistLines(); },
      onpointerleave: () => { vs.hoverDist = null; refreshDistLines(); } },
      h('span', { class: 'rs-dist-name' }, h('i', { class: 'rs-swatch' }), k.name),
      h('span', { class: 'rs-bar' }, fill, h('span', { class: 'rs-bar-tick', style: { left: `${(10 / DIST_SCALE) * 100}%` } })),
      val, sub);
    row.style.setProperty('--c', k.color); // h() の style オブジェクトはカスタムプロパティを設定できない
    distRows[k.id] = { row, fill, val, sub, def: k };
    return row;
  }));

  const profileBar = h('div', { class: 'rs-profile-bar' });
  const profileEnd = h('span', {}, '—');
  const profileLegend = h('div', { class: 'rs-profile-legend' });
  const profile = h('div', { class: 'rs-profile' },
    h('div', { class: 'rs-sub-title' }, '線上の構造', h('span', { class: 'faint' }, '体表 → 先端')),
    profileBar,
    h('div', { class: 'rs-profile-scale' }, h('span', {}, '0'), profileEnd),
    profileLegend);

  const side = h('aside', { class: 'rs-vo-side' },
    h('div', { class: 'rs-side-head' },
      h('div', { class: 'rs-side-title' }, '仮想オブジェクトの計測'), demoBadge()),
    h('div', { class: 'rs-tiles2' }, depthTile, targetTile),
    dirTile,
    h('div', { class: 'rs-dist' },
      h('div', { class: 'rs-sub-title' }, '重要構造までの最短距離', h('span', { class: 'rs-live' }, h('i'), 'リアルタイム')),
      distList,
      h('div', { class: 'rs-note' }, 'バーは0〜60mm。行にカーソルを置くと、3Dに最短距離の位置を表示します。')),
    profile);

  const el = h('section', { class: 'rs-sec rs-vo' },
    h('div', { class: 'rs-vo-main' },
      h('div', { class: 'rs-sec-head' },
        h('div', { class: 'rs-sec-title' }, '仮想オブジェクト', researchBadge()),
        h('p', { class: 'rs-sec-lead' }, '先端は到達位置（CTで設定したターゲットや関心領域）にスナップします。体表側の始点を動かすと、方向と各構造までの距離が変わります。')),
      toolbar, stage),
    side);

  // ---------------------------------------------------------------------------
  // 3D
  // ---------------------------------------------------------------------------
  const viewer = createViewer(host, { cameraPos: CAM.pos, target: CAM.target, lights: 'studio' });
  viewer.controls.minDistance = 200;
  viewer.controls.maxDistance = 1700;
  const scene = viewer.scene;
  const canvas = viewer.renderer.domElement;
  let model = null, skinMesh = null;

  const own = (mesh) => { mesh.userData.ownGeometry = true; return mesh; };
  const cylGeo = new THREE.CylinderGeometry(1, 1, 1, 18, 1);
  const sphereGeo = new THREE.SphereGeometry(1, 20, 14);
  const coneGeo = new THREE.ConeGeometry(2.8, 10, 20); coneGeo.translate(0, -5, 0);
  const ringGeo = new THREE.TorusGeometry(9.5, 1.5, 10, 56);
  const discGeo = new THREE.CircleGeometry(9.5, 40);
  const tickGeo = new THREE.TorusGeometry(2.6, 0.5, 6, 18);
  const pulseGeo = new THREE.TorusGeometry(7, 0.55, 8, 48);
  const pinRingGeo = new THREE.TorusGeometry(4.4, 0.6, 8, 32);

  const rod = new THREE.Group();
  rod.name = 'virtual-object';
  const matInner = new THREE.MeshStandardMaterial({ color: '#eafcff', emissive: '#3be0ff', emissiveIntensity: 0.9, roughness: 0.3 });
  const matGhost = new THREE.MeshBasicMaterial({ color: '#3be0ff', transparent: true, opacity: 0.38, depthTest: false, depthWrite: false });
  const matOuter = new THREE.MeshStandardMaterial({ color: '#7cecff', emissive: '#139bb8', emissiveIntensity: 0.55, roughness: 0.25, metalness: 0.1, transparent: true, opacity: 0.88 });
  const matTip = new THREE.MeshStandardMaterial({ color: '#fff3b0', emissive: '#ffb300', emissiveIntensity: 0.9 });
  const matTipGhost = new THREE.MeshBasicMaterial({ color: '#ffd400', transparent: true, opacity: 0.55, depthTest: false, depthWrite: false });
  const matPulse = new THREE.MeshBasicMaterial({ color: '#ffd400', transparent: true, opacity: 0.8, depthTest: false, depthWrite: false });
  const matRing = new THREE.MeshStandardMaterial({ color: '#ff8a1f', emissive: '#ff6a00', emissiveIntensity: 0.55, roughness: 0.35 });
  const matDisc = new THREE.MeshBasicMaterial({ color: '#ff8a1f', transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false });
  const matTick = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.75, depthTest: false, depthWrite: false });

  const rodIn = own(new THREE.Mesh(cylGeo, matInner));
  const rodInGhost = own(new THREE.Mesh(cylGeo, matGhost)); rodInGhost.renderOrder = 30;
  const rodOut = own(new THREE.Mesh(cylGeo, matOuter)); rodOut.renderOrder = 12;
  const knob = own(new THREE.Mesh(sphereGeo, matOuter)); knob.scale.setScalar(4.4); knob.renderOrder = 12;
  const tipCone = own(new THREE.Mesh(coneGeo, matTip));
  const tipGhost = own(new THREE.Mesh(sphereGeo, matTipGhost)); tipGhost.scale.setScalar(2.4); tipGhost.renderOrder = 31;
  const tipPulse = own(new THREE.Mesh(pulseGeo, matPulse)); tipPulse.renderOrder = 32;
  const entry = new THREE.Group();
  const entryRing = own(new THREE.Mesh(ringGeo, matRing));
  const entryDisc = own(new THREE.Mesh(discGeo, matDisc)); entryDisc.renderOrder = 11;
  entry.add(entryRing, entryDisc);
  const MAX_TICKS = 40;
  const ticks = own(new THREE.InstancedMesh(tickGeo, matTick, MAX_TICKS)); ticks.renderOrder = 31; ticks.count = 0;
  rod.add(rodIn, rodInGhost, rodOut, knob, tipCone, tipGhost, tipPulse, entry, ticks);
  rod.visible = false;
  scene.add(rod);

  // 最短距離の補助線（細い円柱＋両端の点）
  const distLines = {};
  for (const k of DIST_KEYS) {
    const mat = new THREE.MeshBasicMaterial({ color: k.color, transparent: true, opacity: 0.5, depthTest: false, depthWrite: false });
    const line = own(new THREE.Mesh(cylGeo, mat));
    line.renderOrder = 33;
    const dot = own(new THREE.Mesh(sphereGeo, mat));
    dot.renderOrder = 33;
    const dot0 = own(new THREE.Mesh(sphereGeo, mat));
    dot0.renderOrder = 33;
    line.visible = dot.visible = dot0.visible = false;
    scene.add(line, dot, dot0);
    distLines[k.id] = { line, dot, dot0, mat, has: false, d: Infinity };
  }

  // ---- DOM ラベル（3D 上） ----
  const labels = [];
  function addLabel(cls, text) {
    const inner = h('span', { class: `rs-3dlabel-in ${cls}` }, text);
    const l = h('div', { class: 'rs-3dlabel' }, inner);
    labelLayer.appendChild(l);
    const rec = { el: inner, box: l, world: new THREE.Vector3(), on: false };
    labels.push(rec);
    return rec;
  }
  const lblTip = addLabel('is-tip', '到達位置');
  const lblEntry = addLabel('is-entry', '始点（体表）');
  const lblDepth = addLabel('is-depth', '');
  const lblDist = addLabel('is-dist', '');

  // ---------------------------------------------------------------------------
  // 仮想オブジェクトの配置
  // ---------------------------------------------------------------------------
  const Y = new THREE.Vector3(0, 1, 0), Zax = new THREE.Vector3(0, 0, 1);
  const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3(), tmpD = new THREE.Vector3();
  const tmpQ = new THREE.Quaternion(), tmpM = new THREE.Matrix4(), tmpS = new THREE.Vector3();
  function placeCyl(mesh, a, b, r) {
    tmpD.subVectors(b, a);
    const L = Math.max(0.01, tmpD.length());
    mesh.position.addVectors(a, b).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(Y, tmpD.normalize());
    mesh.scale.set(r, L, r);
  }

  function applyAnalysis(a) {
    vs.analysis = a;
    const tipW = toWorld(a.tip, new THREE.Vector3());
    const skinW = toWorld(a.skin, new THREE.Vector3());
    const dirInW = toWorld(a.dirIn, new THREE.Vector3()).normalize();
    const outEnd = skinW.clone().addScaledVector(dirInW, -ROD_OUT);
    placeCyl(rodIn, skinW, tipW, 1.25);
    placeCyl(rodInGhost, skinW, tipW, 1.1);
    placeCyl(rodOut, outEnd, skinW, 2.6);
    knob.position.copy(outEnd);
    tipCone.position.copy(tipW);
    tipCone.quaternion.setFromUnitVectors(Y, dirInW);
    tipGhost.position.copy(tipW);
    tipPulse.position.copy(tipW);
    const nW = toWorld(a.normalOut, new THREE.Vector3()).normalize();
    entry.position.copy(skinW).addScaledVector(nW, 0.9);
    entry.quaternion.setFromUnitVectors(Zax, nW);
    // 10mm ごとの目盛り
    const n = Math.min(MAX_TICKS, Math.floor(a.depth / 10));
    tmpQ.setFromUnitVectors(Zax, dirInW);
    tmpS.set(1, 1, 1);
    for (let i = 0; i < n; i++) {
      tmpA.copy(skinW).addScaledVector(dirInW, (i + 1) * 10);
      tmpM.compose(tmpA, tmpQ, tmpS);
      ticks.setMatrixAt(i, tmpM);
    }
    ticks.count = n;
    ticks.instanceMatrix.needsUpdate = true;
    rod.visible = true;

    lblTip.world.copy(tipW); lblTip.on = true;
    lblEntry.world.copy(skinW).addScaledVector(nW, 6); lblEntry.on = true;
    lblDepth.world.copy(skinW).lerp(tipW, 0.5);
    lblDepth.el.textContent = `${fmt(a.depth)} mm`;

    for (const k of DIST_KEYS) {
      const r = a.dist[k.id];
      const rec = distLines[k.id];
      rec.has = !!(r.p && r.q && r.d > 0.5 && r.d < 120);
      rec.d = r.d;
      if (rec.has) {
        toWorld(r.p, tmpA); toWorld(r.q, tmpB);
        placeCyl(rec.line, tmpA, tmpB, 0.6);
        rec.dot.position.copy(tmpB);
        rec.dot0.position.copy(tmpA);
        rec.mid = tmpA.clone().lerp(tmpB, 0.5);
      }
    }
    refreshDistLines();
    updateReadouts(a);
    // マーカ一覧の「先端まで」は先端が動いたときだけ更新（ドラッグ中に DOM を作り直さない）
    const tipKey = a.tip.map((v) => v.toFixed(1)).join();
    if (tipKey !== lastTipKey) { lastTipKey = tipKey; updateMarkerList(); }
  }
  let lastTipKey = '';

  function refreshDistLines() {
    for (const k of DIST_KEYS) {
      const rec = distLines[k.id];
      const hl = vs.hoverDist === k.id;
      // 通常は 40mm 以内のものだけ淡く、行にカーソルを置いたものははっきり表示
      rec.line.visible = rec.dot.visible = rec.dot0.visible = rec.has && ready && (hl || (vs.hoverDist == null && rec.d < 40));
      rec.mat.opacity = hl ? 0.95 : 0.4;
      rec.line.scale.x = rec.line.scale.z = hl ? 0.9 : 0.5;
      rec.dot.scale.setScalar(hl ? 2.8 : 1.8);
      rec.dot0.scale.setScalar(hl ? 1.8 : 1.2);
      distRows[k.id].row.classList.toggle('is-hover', hl);
    }
    const k = vs.hoverDist && DIST_KEYS.find((d) => d.id === vs.hoverDist);
    const rec = k && distLines[k.id];
    if (rec?.has && vs.analysis) {
      lblDist.on = true;
      lblDist.world.copy(rec.mid);
      lblDist.el.textContent = `${k.name} ${fmt(vs.analysis.dist[k.id].d)} mm`;
      lblDist.el.style.setProperty('--c', k.color);
    } else lblDist.on = false;
  }

  // ---------------------------------------------------------------------------
  // 計測パネルの更新
  // ---------------------------------------------------------------------------
  function updateReadouts(a) {
    depthNum.textContent = fmt(a.depth);
    targetName.textContent = vs.targetName;
    targetSub.textContent = a.tipPlace && a.tipPlace !== vs.targetName ? `先端：${a.tipPlace}` : `始点：${a.region}`;
    approach.textContent = a.approach;
    angNormal.textContent = `${fmt(a.angles.normal, 0)}°`;
    angCoronal.textContent = `${fmt(a.angles.coronal, 0)}°`;
    angAxial.textContent = `${fmt(a.angles.axial, 0)}°`;
    dial.innerHTML = dialSVG(a.angles.normal);

    for (const k of DIST_KEYS) {
      const r = a.dist[k.id];
      const row = distRows[k.id];
      row.row.classList.remove('is-near', 'is-mid', 'is-inside', 'is-cross');
      if (k.id === 'lung' && r.crosses) {
        row.row.classList.add('is-inside');
        row.val.textContent = r.tipInside ? '肺内' : '通過';
        row.sub.textContent = r.tipInside ? `先端から胸膜まで ${fmt(r.tipToPleura)} mm` : `肺内の長さ ${fmt(r.lengthInside)} mm`;
        row.fill.style.width = '100%';
        continue;
      }
      if (r.d < 0.5) {
        row.row.classList.add('is-cross');
        row.val.textContent = r.d < -0.5 ? '交差' : '0.0 mm';
        row.fill.style.width = '0%';
        if (k.id === 'lung') row.sub.textContent = '';
        continue;
      }
      if (k.id === 'lung') row.sub.textContent = '線は肺を通過しません';
      row.val.textContent = r.d > 199 ? '200 mm 以上' : `${fmt(r.d)} mm`;
      row.fill.style.width = `${Math.min(100, (r.d / DIST_SCALE) * 100)}%`;
      if (r.d < 10) row.row.classList.add('is-near');
      else if (r.d < 25) row.row.classList.add('is-mid');
    }

    // 線上の構造
    profileBar.innerHTML = '';
    const seen = new Map();
    for (const seg of a.profile) {
      const cat = PROFILE_CATS[seg.cat];
      const w = ((seg.to - seg.from) / Math.max(1, a.depth)) * 100;
      profileBar.appendChild(h('span', { class: 'rs-pseg', style: { width: `${w}%`, background: cat.color }, title: `${cat.name} ${fmt(seg.from, 0)}–${fmt(seg.to, 0)} mm` }));
      seen.set(seg.cat, (seen.get(seg.cat) || 0) + (seg.to - seg.from));
    }
    profileEnd.textContent = `${fmt(a.depth, 0)} mm`;
    profileLegend.innerHTML = '';
    for (const [cat, mm] of seen) {
      const c = PROFILE_CATS[cat];
      profileLegend.appendChild(h('span', {}, h('i', { style: { background: c.color } }), c.name, h('b', {}, `${fmt(mm, 0)}mm`)));
    }
  }

  function dialSVG(angle) {
    const th = (Math.min(89, Math.max(0, angle)) * Math.PI) / 180;
    const cx = 44, cy = 38;
    const ox = cx - Math.sin(th) * 34, oy = cy - Math.cos(th) * 34;
    const ix = cx + Math.sin(th) * 16, iy = cy + Math.cos(th) * 16;
    const ar = 17;
    const ax = cx - Math.sin(th) * ar, ay = cy - Math.cos(th) * ar;
    return `<svg viewBox="0 0 88 58" width="88" height="58" aria-hidden="true">
      <rect x="2" y="${cy}" width="84" height="18" rx="2" fill="rgba(242,194,160,0.12)"/>
      <line x1="2" y1="${cy}" x2="86" y2="${cy}" stroke="#f2c2a0" stroke-opacity="0.7" stroke-width="1.5"/>
      <line x1="${cx}" y1="${cy}" x2="${cx}" y2="4" stroke="#a3b3cc" stroke-dasharray="3 3" stroke-width="1.2"/>
      <path d="M ${cx} ${cy - ar} A ${ar} ${ar} 0 0 0 ${ax.toFixed(1)} ${ay.toFixed(1)}" fill="none" stroke="#ffd400" stroke-width="1.6"/>
      <line x1="${ox.toFixed(1)}" y1="${oy.toFixed(1)}" x2="${cx}" y2="${cy}" stroke="#7cecff" stroke-width="3.4" stroke-linecap="round"/>
      <line x1="${cx}" y1="${cy}" x2="${ix.toFixed(1)}" y2="${iy.toFixed(1)}" stroke="#eafcff" stroke-width="1.8" stroke-linecap="round"/>
      <circle cx="${cx}" cy="${cy}" r="3.4" fill="none" stroke="#ff8a1f" stroke-width="1.8"/>
      <circle cx="${ix.toFixed(1)}" cy="${iy.toFixed(1)}" r="2" fill="#ffd400"/>
    </svg>`;
  }

  // ---------------------------------------------------------------------------
  // 更新のスケジュール（1 フレームに 1 回）
  // ---------------------------------------------------------------------------
  let raf = 0;
  function scheduleUpdate() {
    if (raf || destroyed) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      if (destroyed) return;
      applyAnalysis(analyzeRod(vs.target, vs.entry));
    });
  }

  // 先端の移動アニメーション
  let tipAnim = null;
  function moveTipTo(p) {
    tipAnim = { from: vs.target.slice(), to: p.slice(), t0: performance.now(), ms: 520 };
  }

  // ---------------------------------------------------------------------------
  // 到達位置の選択
  // ---------------------------------------------------------------------------
  function roiCenter() {
    const roi = state.roi || [];
    if (!roi.length) return null;
    let x = 0, y = 0, z = 0;
    for (const c of roi) { x += c.x; y += c.y; z += c.z; }
    return [x / roi.length, y / roi.length, z / roi.length];
  }
  function refreshTargetButtons() {
    const hasRoi = !!roiCenter();
    const hasLine = !!state.line?.end;
    targetBtns.roi.disabled = !hasRoi;
    targetBtns.roi.title = hasRoi ? targetDefs[1].title : '関心領域が未設定です（「関心領域」の画面で設定できます）';
    targetBtns.line.disabled = !hasLine;
    targetBtns.line.title = hasLine ? targetDefs[2].title : '2点ラインが未設定です（「関心領域」の画面で設定できます）';
    for (const d of targetDefs) targetBtns[d.id].classList.toggle('is-on', vs.targetMode === d.id || (d.id === 'custom' && vs.mode === 'pickTarget'));
  }
  function chooseTarget(id) {
    if (!ready) return;
    if (id === 'custom') { setMode(vs.mode === 'pickTarget' ? 'idle' : 'pickTarget'); return; }
    setMode('idle');
    if (id === 'nodule') { vs.targetName = '結節（右上葉）'; moveTipTo(NODULE.c); }
    else if (id === 'roi') { const c = roiCenter(); if (!c) return; vs.targetName = '関心領域の中心'; moveTipTo(c); }
    else if (id === 'line') {
      const { start, end } = state.line || {};
      if (!end) return;
      vs.targetName = '2点ラインの終点';
      moveTipTo(end);
      if (start) vs.entry = start.slice();
    }
    vs.targetMode = id;
    refreshTargetButtons();
  }

  function setMode(m) {
    vs.mode = m;
    addMarkerBtn.classList.toggle('is-on', m === 'placeMarker');
    stage.classList.toggle('is-placing', m !== 'idle');
    modeBanner.hidden = m === 'idle';
    modeBanner.textContent = m === 'placeMarker'
      ? '体表をクリックして、マーカオブジェクトを置きます（Esc でキャンセル）'
      : m === 'pickTarget' ? '3Dモデル上をクリックして、到達位置を指定します（Esc でキャンセル）' : '';
    refreshTargetButtons();
  }

  // ---------------------------------------------------------------------------
  // マーカオブジェクト
  // ---------------------------------------------------------------------------
  function addMarker(p) {
    const n = ++markerSeq;
    const color = MARKER_COLORS[(n - 1) % MARKER_COLORS.length];
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.35, roughness: 0.4 });
    const stem = own(new THREE.Mesh(cylGeo, mat));
    stem.scale.set(0.9, 12, 0.9); stem.position.set(0, 0, 6); stem.rotation.x = Math.PI / 2;
    const head = own(new THREE.Mesh(sphereGeo, mat));
    head.scale.setScalar(3.8); head.position.set(0, 0, 13);
    const base = own(new THREE.Mesh(pinRingGeo, mat));
    g.add(stem, head, base);
    scene.add(g);
    const label = addLabel('is-marker', `M${n}`);
    label.el.style.setProperty('--c', color);
    const m = { id: n, color, pos: p.slice(), group: g, label, mat };
    vs.markers.push(m);
    placeMarker(m, p);
    updateMarkerList();
    return m;
  }
  function placeMarker(m, p) {
    m.pos = p.slice();
    const w = toWorld(p, new THREE.Vector3());
    const nW = toWorld(skinNormal(p), new THREE.Vector3()).normalize();
    m.group.position.copy(w).addScaledVector(nW, 0.6);
    m.group.quaternion.setFromUnitVectors(Zax, nW);
    m.label.world.copy(w).addScaledVector(nW, 22);
    m.label.on = true;
  }
  function removeMarker(id) {
    const i = vs.markers.findIndex((m) => m.id === id);
    if (i < 0) return;
    const m = vs.markers[i];
    scene.remove(m.group);
    m.mat.dispose();
    m.label.box.remove();
    labels.splice(labels.indexOf(m.label), 1);
    vs.markers.splice(i, 1);
    updateMarkerList();
  }
  function updateMarkerList() {
    markerList.hidden = vs.markers.length === 0;
    markerList.innerHTML = '';
    if (!vs.markers.length) return;
    markerList.appendChild(h('div', { class: 'rs-mlist-head' },
      h('span', {}, `マーカオブジェクト（${vs.markers.length}）`),
      h('button', { class: 'rs-link', onclick: () => { for (const m of [...vs.markers]) removeMarker(m.id); } }, 'すべて削除')));
    const tip = vs.analysis?.tip || vs.target;
    for (const m of vs.markers) {
      const d = Math.hypot(m.pos[0] - tip[0], m.pos[1] - tip[1], m.pos[2] - tip[2]);
      const row = h('div', { class: 'rs-mlist-row',
        onpointerenter: () => m.label.el.classList.add('is-hl'), onpointerleave: () => m.label.el.classList.remove('is-hl') },
        h('b', {}, `M${m.id}`),
        h('span', { class: 'rs-mlist-where' }, regionName(m.pos)),
        h('span', { class: 'rs-mlist-d' }, `先端まで ${fmt(d, 0)} mm`),
        h('button', { class: 'rs-x', title: '削除', 'aria-label': `M${m.id} を削除`, onclick: () => removeMarker(m.id) }, '✕'));
      row.style.setProperty('--c', m.color);
      markerList.appendChild(row);
    }
  }

  // ---------------------------------------------------------------------------
  // ポインタ操作
  // ---------------------------------------------------------------------------
  const CHEST_Z = [-130, 150];
  function raycastSkin(x, y) {
    if (!skinMesh) return null;
    const hit = viewer.raycaster(x, y).intersectObject(skinMesh, false)[0];
    if (!hit) return null;
    const p = toPatient(hit.point);
    if (p[2] < CHEST_Z[0] || p[2] > CHEST_Z[1]) return null;
    return p;
  }
  function raycastInner(x, y) {
    if (!model) return null;
    const objs = [...model.meshes.values()].filter((m) => m.visible && m.name !== 'skin');
    const hits = viewer.raycaster(x, y).intersectObjects(objs, false);
    if (!hits.length) return null;
    const hit = hits.find((hh) => (hh.object.material.opacity ?? 1) >= 0.5) || hits[0];
    return { p: toPatient(hit.point), id: hit.object.name };
  }
  function screenOf(world) {
    const r = canvas.getBoundingClientRect();
    const p = viewer.project(world);
    return { x: r.left + p.x, y: r.top + p.y, behind: p.behind };
  }
  function pickHandle(x, y) {
    let best = null, bd = 1e9;
    if (vs.analysis) {
      const s = screenOf(entry.position);
      const d = Math.hypot(s.x - x, s.y - y);
      if (d < 24 && d < bd) { best = { kind: 'entry' }; bd = d; }
    }
    for (const m of vs.markers) {
      const s = screenOf(tmpA.copy(m.group.position).add(tmpB.set(0, 0, 13).applyQuaternion(m.group.quaternion)));
      const s2 = screenOf(m.group.position);
      const d = Math.min(Math.hypot(s.x - x, s.y - y), Math.hypot(s2.x - x, s2.y - y));
      if (d < 16 && d < bd) { best = { kind: 'marker', id: m.id }; bd = d; }
    }
    return best;
  }

  let drag = null, hover = null, movePending = null, moveRaf = 0, dragged = false;
  const stop = (e) => { e.stopPropagation(); e.preventDefault(); };
  function onDown(e) {
    if (e.target !== canvas || e.button !== 0 || !ready) return;
    if (vs.mode === 'pickTarget') {
      const hit = raycastInner(e.clientX, e.clientY);
      if (hit) {
        stop(e);
        vs.targetMode = 'custom';
        vs.targetName = `${structureLabel(hit.id)}（指定した点）`;
        moveTipTo(hit.p);
        setMode('idle');
      }
      return;
    }
    if (vs.mode === 'placeMarker') {
      const p = raycastSkin(e.clientX, e.clientY);
      if (p) { stop(e); addMarker(p); setMode('idle'); }
      return;
    }
    const hd = pickHandle(e.clientX, e.clientY);
    if (!hd) return;
    stop(e);
    drag = hd;
    dragged = false;
    viewer.controls.enabled = false;
    stage.classList.add('is-dragging');
    try { canvas.setPointerCapture(e.pointerId); } catch { /* 合成イベントでは失敗してよい */ }
  }
  function onMove(e) {
    // ボタンを押していない移動が来たら、ドラッグは終わっている（ツアー中断などで pointerup が来なかった場合）
    if (drag && e.buttons === 0) onUp();
    movePending = { x: e.clientX, y: e.clientY, onCanvas: e.target === canvas };
    if (moveRaf) return;
    moveRaf = requestAnimationFrame(() => {
      moveRaf = 0;
      const mv = movePending;
      if (!mv || destroyed) return;
      if (drag) {
        const p = raycastSkin(mv.x, mv.y);
        if (!p) return;
        dragged = true;
        if (drag.kind === 'entry') { vs.entry = p; hint.classList.add('is-used'); scheduleUpdate(); }
        else {
          const m = vs.markers.find((mm) => mm.id === drag.id);
          if (m) { placeMarker(m, p); updateMarkerList(); }
        }
        return;
      }
      if (!mv.onCanvas || !ready) { if (hover) setHover(null); return; }
      if (vs.mode === 'placeMarker') { setHover(null); canvas.style.cursor = raycastSkin(mv.x, mv.y) ? 'copy' : ''; return; }
      if (vs.mode === 'pickTarget') { setHover(null); canvas.style.cursor = raycastInner(mv.x, mv.y) ? 'crosshair' : ''; return; }
      setHover(pickHandle(mv.x, mv.y));
    });
  }
  function onUp() {
    if (!drag) return;
    drag = null;
    viewer.controls.enabled = true;
    stage.classList.remove('is-dragging');
    canvas.style.cursor = hover ? 'grab' : '';
    if (dragged) updateMarkerList();
  }
  function setHover(hd) {
    hover = hd;
    const onEntry = hd?.kind === 'entry';
    matRing.emissiveIntensity = onEntry ? 1.1 : 0.55;
    entryDisc.material.opacity = onEntry ? 0.4 : 0.22;
    lblEntry.el.classList.toggle('is-hl', onEntry);
    for (const m of vs.markers) m.label.el.classList.toggle('is-hl', hd?.kind === 'marker' && hd.id === m.id);
    canvas.style.cursor = drag ? 'grabbing' : hd ? 'grab' : '';
  }
  stage.addEventListener('pointerdown', onDown, { capture: true, signal });
  window.addEventListener('pointermove', onMove, { signal });
  window.addEventListener('pointerup', onUp, { signal });
  window.addEventListener('pointercancel', onUp, { signal });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && vs.mode !== 'idle' && active) setMode('idle'); }, { signal });

  // ---------------------------------------------------------------------------
  // 毎フレーム: ラベル位置・先端のパルス・先端移動アニメ
  // ---------------------------------------------------------------------------
  const camPos = new THREE.Vector3();
  viewer.onFrame((dt, t) => {
    if (tipAnim) {
      const u = Math.min(1, (performance.now() - tipAnim.t0) / tipAnim.ms);
      const e = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
      vs.target = tipAnim.from.map((v, i) => v + (tipAnim.to[i] - v) * e);
      if (u >= 1) { vs.target = tipAnim.to.slice(); tipAnim = null; }
      scheduleUpdate();
    }
    // パルス（カメラに向ける）
    camPos.copy(viewer.camera.position);
    tipPulse.lookAt(camPos);
    const k = (t * 0.9) % 1;
    tipPulse.scale.setScalar(0.6 + k * 1.3);
    matPulse.opacity = 0.85 * (1 - k);
    // ラベル（仮想オブジェクトが画面上で短く見えるときは、深さのラベルを隠して重なりを避ける）
    const w = host.clientWidth, hh = host.clientHeight;
    if (vs.analysis) {
      const a = viewer.project(lblTip.world), b = viewer.project(lblEntry.world);
      lblDepth.on = Math.hypot(a.x - b.x, a.y - b.y) > 90;
    }
    for (const l of labels) {
      if (!l.on || !ready) { l.box.style.opacity = '0'; continue; }
      const p = viewer.project(l.world);
      const vis = !p.behind && p.x > -40 && p.x < w + 40 && p.y > -20 && p.y < hh + 20;
      l.box.style.opacity = vis ? '' : '0';
      l.box.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`;
    }
  });

  // ---------------------------------------------------------------------------
  // モデルの読み込み
  // ---------------------------------------------------------------------------
  getAnatomyGeometries().then((geoms) => {
    if (destroyed || signal.aborted) return;
    model = createAnatomyModel(geoms, { style: 'clinical', include: INCLUDE, opacity: OPACITY });
    for (const l of LAYERS) if (!l.on) for (const id of l.members) model.setVisible(id, false);
    scene.add(model.group);
    skinMesh = model.meshes.get('skin');
    ready = true;
    loading.classList.add('is-done');
    refreshTargetButtons();
    applyAnalysis(analyzeRod(vs.target, vs.entry));
  });

  refreshTargetButtons();

  let active = false;
  return {
    el,
    get ready() { return ready; },
    activate() {
      active = true;
      viewer.resume();
      viewer.resize();
      refreshTargetButtons();
    },
    deactivate() {
      active = false;
      if (vs.mode !== 'idle') setMode('idle');
      viewer.pause();
    },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(raf);
      cancelAnimationFrame(moveRaf);
      model?.dispose();
      for (const m of vs.markers) m.mat.dispose();
      viewer.dispose();
      [cylGeo, sphereGeo, coneGeo, ringGeo, discGeo, tickGeo, pulseGeo, pinRingGeo].forEach((g) => g.dispose());
    },
    // ---- ガイドツアー用 ----
    canvas,
    addMarkerBtn,
    targetBtns,
    side,
    distList,
    /** 体表上の点（患者座標）→ クライアント座標 */
    clientOf(p) { return screenOf(toWorld(p, new THREE.Vector3())); },
    entryClient() { return screenOf(entry.position); },
    get entry() { return vs.entry.slice(); },
    setHoverDist(id) { vs.hoverDist = id; refreshDistLines(); },
    flyHome(ms = 700) { viewer.flyTo(CAM.pos, CAM.target, ms); },

    /** ガイドツアー（約8秒） */
    async tour(t) {
      if (vs.mode !== 'idle') setMode('idle');
      if (vs.targetMode !== 'nodule') chooseTarget('nodule');
      viewer.flyTo(CAM.pos, CAM.target, 500);
      t.caption('仮想オブジェクト：先端は到達位置（ここでは結節）にスナップし、計測値を表示します。');
      await t.highlight(side, 1300);

      // 始点を体表に沿って側方へドラッグ
      t.caption('体表の始点をドラッグすると、方向・距離／深さ・重要構造までの最短距離がリアルタイムに変わります（デモ用の模擬値）。');
      const path = (th0, z0, th1, z1, n) => {
        const pts = [this.entryClient()];
        for (let i = 1; i <= n; i++) {
          const u = i / n, e = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
          pts.push(this.clientOf(skinPointAt(th0 + (th1 - th0) * e, z0 + (z1 - z0) * e)));
        }
        return pts;
      };
      await t.drag(canvas, path(50, 98, 14, 76, 26), { stepMs: 40 });
      await t.sleep(400);
      this.setHoverDist('great');
      distRows.great.row.classList.add('tour-highlight');
      await t.sleep(1200).finally(() => { distRows.great.row.classList.remove('tour-highlight'); this.setHoverDist(null); });
      await t.drag(canvas, path(14, 76, 72, 60, 26), { stepMs: 40 });
      await t.sleep(500);

      // マーカオブジェクト
      t.caption('マーカオブジェクトは、体表にいくつでも追加できます。');
      await t.click(addMarkerBtn);
      const mp = this.clientOf(skinPointAt(40, 30));
      await t.drag(canvas, [mp, mp]);
      await t.sleep(700);
    },
  };
}
