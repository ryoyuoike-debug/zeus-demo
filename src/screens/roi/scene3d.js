// =============================================================================
// 関心領域: 3D 表示
// ・背景: 薄いボリュームレンダリング風の表示（解剖モデルの表面から点群を作り、
//         加算合成で淡く光らせる）。表示切替をすべて OFF にしても常に表示
// ・表示切替: 体表 / 肺 / 心臓 / 血管 / 骨 / 結節（＋研究開発機能の AI ROI）
// ・関心領域（ROI）のメッシュ（state.roi から生成し直す）
// ・2 点ライン（体表から外側へ 10 cm 延長）と始点・終点・体表との交点
// ・体表の透過度。透過度 0 のときは青いテンプレートガイドを体表に重ねる
// =============================================================================
import * as THREE from 'three';
import { createViewer } from '../../three/viewer.js';
import { getAnatomyGeometries, createAnatomyModel, toWorld } from '../../three/meshing.js';
import { makeRng, NODULE } from '../../data/phantom.js';
import { h } from '../../ui/dom.js';
import { buildRoiGeometry, aiRoiGeometry } from './geometry.js';

/** 表示切替（チップ） */
export const LAYERS = [
  { id: 'skin', name: '体表', members: ['skin'], on: true, color: '#f2c2a0' },
  { id: 'lung', name: '肺', members: ['lung_r', 'lung_l', 'trachea', 'bronchus'], on: true, color: '#7fd3ff' },
  { id: 'heart', name: '心臓', members: ['heart'], on: false, color: '#e0566b' },
  { id: 'vessel', name: '血管', members: ['aorta', 'vein', 'pa', 'pv'], on: false, color: '#ef3b3b' },
  { id: 'bone', name: '骨', members: ['rib', 'cartilage', 'sternum', 'clavicle', 'spine'], on: true, color: '#efe8d8' },
  { id: 'nodule', name: '結節', members: ['nodule'], on: true, color: '#ffd400' },
];
const INCLUDE = LAYERS.flatMap((l) => l.members);
const OPACITY = {
  skin: 0.3, lung_r: 0.16, lung_l: 0.16, trachea: 0.4, bronchus: 0.3, heart: 0.8,
  aorta: 0.95, vein: 0.95, pa: 0.85, pv: 0.85,
  rib: 0.62, cartilage: 0.5, sternum: 0.7, clavicle: 0.75, spine: 0.85, nodule: 1,
};

export const COLORS = {
  roi: '#ff8a1f',
  line: '#3ee0ff',
  ai: '#ff4fa3',
  guide: '#2f8bff',
};

// ---------------------------------------------------------------------------
// 背景のボリューム表示（点群）
// ---------------------------------------------------------------------------
const CLOUD_SPEC = [
  // 構造, 点の数, 色, 不透明度, 大きさ(mm), 内側へのばらつき(mm)
  ['skin', 26000, '#ffc9a8', 0.028, 2.4, 6],
  ['rib', 9000, '#fff0d6', 0.2, 2.2, 3],
  ['cartilage', 2000, '#e6f3ea', 0.12, 2.2, 3],
  ['sternum', 2600, '#fff0d6', 0.2, 2.2, 3],
  ['clavicle', 1200, '#fff0d6', 0.2, 2.2, 3],
  ['spine', 9000, '#fff0d6', 0.18, 2.3, 4],
  ['lung_r', 6000, '#69b8ff', 0.035, 3.2, 14],
  ['lung_l', 6000, '#69b8ff', 0.035, 3.2, 14],
  ['heart', 5000, '#ff6a72', 0.09, 2.8, 12],
  ['aorta', 2400, '#ff5a50', 0.13, 2.4, 3],
  ['vein', 1400, '#7d8bff', 0.1, 2.4, 3],
  ['pa', 3000, '#5c9bff', 0.07, 2.0, 2],
  ['pv', 2000, '#ff7f9f', 0.06, 2.0, 2],
  ['liver', 5000, '#c9714a', 0.05, 3.0, 12],
  ['bronchus', 1600, '#d7e3f4', 0.05, 2.0, 1],
];

const CLOUD_VS = /* glsl */ `
attribute vec3 color;
attribute float alpha;
attribute float psize;
attribute float phase;
uniform float uTime;
uniform float uPx;
uniform float uFade;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = max(1.0, psize * uPx / -mv.z);
  vColor = color;
  vAlpha = alpha * uFade * (0.8 + 0.2 * sin(uTime * 0.8 + phase));
}`;
const CLOUD_FS = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = dot(c, c) * 4.0;
  if (d > 1.0) discard;
  gl_FragColor = vec4(vColor, vAlpha * (1.0 - d));
  #include <colorspace_fragment>
}`;

function buildCloud(geoms) {
  const rng = makeRng(5150);
  const pos = [], col = [], alp = [], siz = [], pha = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const na = new THREE.Vector3(), nb = new THREE.Vector3(), nc = new THREE.Vector3();
  const p = new THREE.Vector3(), n = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
  const color = new THREE.Color();
  for (const [id, count, hex, alpha, size, jitter] of CLOUD_SPEC) {
    const g = geoms.get(id);
    if (!g || !g.index) continue;
    const P = g.attributes.position, N = g.attributes.normal, I = g.index.array;
    const tris = I.length / 3;
    // 面積で重み付け
    const cum = new Float32Array(tris);
    let total = 0;
    for (let t = 0; t < tris; t++) {
      a.fromBufferAttribute(P, I[t * 3]); b.fromBufferAttribute(P, I[t * 3 + 1]); c.fromBufferAttribute(P, I[t * 3 + 2]);
      total += e1.subVectors(b, a).cross(e2.subVectors(c, a)).length() * 0.5;
      cum[t] = total;
    }
    color.set(hex);
    for (let k = 0; k < count; k++) {
      const r = rng() * total;
      let lo = 0, hi = tris - 1;
      while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m] < r) lo = m + 1; else hi = m; }
      const t = lo;
      let u = rng(), v = rng();
      if (u + v > 1) { u = 1 - u; v = 1 - v; }
      const w = 1 - u - v;
      a.fromBufferAttribute(P, I[t * 3]); b.fromBufferAttribute(P, I[t * 3 + 1]); c.fromBufferAttribute(P, I[t * 3 + 2]);
      na.fromBufferAttribute(N, I[t * 3]); nb.fromBufferAttribute(N, I[t * 3 + 1]); nc.fromBufferAttribute(N, I[t * 3 + 2]);
      p.set(0, 0, 0).addScaledVector(a, w).addScaledVector(b, u).addScaledVector(c, v);
      n.set(0, 0, 0).addScaledVector(na, w).addScaledVector(nb, u).addScaledVector(nc, v).normalize();
      // 表面から内側へ少しばらつかせて、体積感を出す
      p.addScaledVector(n, -Math.pow(rng(), 1.6) * jitter);
      pos.push(p.x, p.y, p.z);
      const shade = 0.75 + rng() * 0.5;
      col.push(color.r * shade, color.g * shade, color.b * shade);
      alp.push(alpha * (0.6 + rng() * 0.8));
      siz.push(size * (0.7 + rng() * 0.6));
      pha.push(rng() * Math.PI * 2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute('alpha', new THREE.Float32BufferAttribute(alp, 1));
  geo.setAttribute('psize', new THREE.Float32BufferAttribute(siz, 1));
  geo.setAttribute('phase', new THREE.Float32BufferAttribute(pha, 1));
  geo.computeBoundingSphere();
  return geo;
}
let cloudGeoCache = null;

// ---------------------------------------------------------------------------
// 体表（フレネルの半透明 → 透過度 0 で不透明）
// ---------------------------------------------------------------------------
const SKIN_VS = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
varying vec3 vP;
void main() {
  vP = position;
  vN = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;
const SKIN_FS = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uGlass;
uniform vec3 uRim;
uniform float uOpacity;
uniform float uGuide;
uniform vec3 uGuideColor;
varying vec3 vN;
varying vec3 vV;
varying vec3 vP;
// テンプレートガイド: 体軸方向 16mm ごとの輪と、周方向 32 分割の線（画面上で一定の太さ）
float gridLine(float coord, float width) {
  float w = fwidth(coord);
  float d = abs(fract(coord - 0.5) - 0.5);
  return 1.0 - smoothstep(w * (width - 0.5), w * (width + 0.5), d);
}
void main() {
  vec3 n = normalize(vN);
  vec3 v = normalize(vV);
  if (!gl_FrontFacing) n = -n;
  float ndv = abs(dot(n, v));
  float f = pow(1.0 - ndv, 2.2);
  vec3 L = normalize(vec3(0.35, 0.65, 0.75));
  float diff = max(dot(n, L), 0.0);
  float spec = pow(max(dot(reflect(-L, n), v), 0.0), 24.0);
  vec3 lit = uColor * (0.28 + 0.78 * diff) + vec3(0.10) * spec + uRim * f * 0.25;
  vec3 glass = mix(uGlass * 0.45, uRim, f);
  float k = uOpacity * uOpacity;
  float a = mix(uOpacity * (0.22 + 1.25 * f), 1.0, k * uOpacity);
  vec3 col = mix(glass, lit, k);
  if (uGuide > 0.001) {
    // 患者座標: x = vP.x, y = vP.z（前）, z = vP.y（頭）
    float zc = (vP.y + 2.0) / 16.0;
    float ang = atan(vP.z + 6.0, vP.x) / 6.2831853 * 32.0;
    float g = max(gridLine(zc, 1.1), gridLine(ang, 1.1));
    float major = max(gridLine(zc / 4.0, 1.6), gridLine((ang - 8.0) / 16.0, 1.6));
    float cap = 1.0 - smoothstep(130.0, 136.0, vP.y);
    float m = clamp(max(g * 0.85, major), 0.0, 1.0) * uGuide * cap;
    col = mix(col, uGuideColor, m);
    a = max(a, m);
  }
  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
  #include <colorspace_fragment>
}`;

// ---------------------------------------------------------------------------
// 小物
// ---------------------------------------------------------------------------
function glowTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const g = cv.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.2, 'rgba(255,255,255,0.7)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.15)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const ease = (u) => 1 - Math.pow(1 - u, 3);
const Y_UP = new THREE.Vector3(0, 1, 0);

/**
 * @param {HTMLElement} host .three-host
 * @param {{onReady?:()=>void, onRoiBuilt?:(info:{volumeMl:number}|null)=>void}} [opts]
 */
export function createRoiScene(host, opts = {}) {
  const viewer = createViewer(host, { background: null, fov: 30, near: 5, far: 8000 });
  const { scene, camera, controls, renderer } = viewer;
  controls.minDistance = 160;
  controls.maxDistance = 2600;
  controls.enablePan = true;

  const root = new THREE.Group();
  root.name = 'roi-scene';
  scene.add(root);

  const disposables = [];
  const glowTex = glowTexture(); disposables.push(glowTex);

  // ---- カメラ ----
  const HOME = { target: new THREE.Vector3(-22, 28, 6), dir: new THREE.Vector3(-0.56, 0.2, 0.8).normalize() };
  const nod = toWorld(NODULE.c);
  function fitDistance(radius) {
    const aspect = Math.max(0.3, host.clientWidth / Math.max(1, host.clientHeight));
    const tv = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    return Math.max(radius / tv, radius / (tv * aspect)) * 1.04;
  }
  function home(ms = 800) {
    const d = fitDistance(225);
    const pos = HOME.target.clone().addScaledVector(HOME.dir, d);
    if (ms <= 0) { camera.position.copy(pos); controls.target.copy(HOME.target); controls.update(); return; }
    viewer.flyTo(pos.toArray(), HOME.target.toArray(), ms);
  }
  function focus(center, ms = 900) {
    const tgt = center ? toWorld(center) : nod.clone();
    // ROI とラインがよく見える、右前の斜め上から
    const dir = new THREE.Vector3(-0.7, 0.3, 0.65).normalize();
    const d = fitDistance(72);
    viewer.flyTo(tgt.clone().addScaledVector(dir, d).toArray(), tgt.toArray(), ms);
  }
  home(0);

  // ---- 背景のボリューム表示（点群） ----
  const cloudMat = new THREE.ShaderMaterial({
    vertexShader: CLOUD_VS, fragmentShader: CLOUD_FS,
    uniforms: { uTime: { value: 0 }, uPx: { value: 800 }, uFade: { value: 0 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  disposables.push(cloudMat);
  let cloud = null;
  const updatePx = () => {
    const hgt = renderer.domElement.height || host.clientHeight;
    cloudMat.uniforms.uPx.value = hgt / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
  };
  updatePx();
  const ro = new ResizeObserver(updatePx);
  ro.observe(host);

  // ---- 解剖モデル（表示切替） ----
  let model = null;
  const layerOn = Object.fromEntries(LAYERS.map((l) => [l.id, l.on]));
  let skinOpacity = OPACITY.skin;
  const skinMat = new THREE.ShaderMaterial({
    vertexShader: SKIN_VS, fragmentShader: SKIN_FS,
    uniforms: {
      uColor: { value: new THREE.Color('#e3b08f') }, uGlass: { value: new THREE.Color('#9db4cc') },
      uRim: { value: new THREE.Color('#dfeeff') }, uOpacity: { value: skinOpacity },
      uGuide: { value: 0 }, uGuideColor: { value: new THREE.Color('#1f7bff') },
    },
    transparent: true, depthWrite: false, side: THREE.FrontSide,
  });
  disposables.push(skinMat);
  let skinMesh = null;
  function applySkin() {
    skinMat.uniforms.uOpacity.value = skinOpacity;
    skinMat.depthWrite = skinOpacity >= 0.999;
    if (skinMesh) skinMesh.visible = !!layerOn.skin && skinOpacity > 0.002;
  }

  // ---- テンプレートガイド（体表のシェーダーで描く）----
  let guideTarget = 0;

  // ---- ROI ----
  const roiMat = new THREE.MeshStandardMaterial({
    color: COLORS.roi, emissive: '#ff6a00', emissiveIntensity: 0.5, roughness: 0.38, metalness: 0,
    transparent: true, opacity: 0.72, depthWrite: false, side: THREE.DoubleSide,
  });
  const roiMesh = new THREE.Mesh(new THREE.BufferGeometry(), roiMat);
  roiMesh.userData.ownGeometry = true;
  roiMesh.renderOrder = 7;
  roiMesh.visible = false;
  root.add(roiMesh);
  let roiFlash = 0;
  let roiCenter = null;
  let roiTop = null;

  // ---- AI ROI（研究開発中） ----
  let aiMesh = null, aiWire = null;
  const aiGroup = new THREE.Group();
  aiGroup.visible = false;
  root.add(aiGroup);
  let aiFade = 0, aiTarget = 0;

  // ---- 2 点ライン ----
  const lineGroup = new THREE.Group();
  lineGroup.visible = false;
  root.add(lineGroup);
  const lineMat = new THREE.MeshBasicMaterial({ color: COLORS.line, toneMapped: false });
  const extMat = new THREE.MeshBasicMaterial({ color: COLORS.line, transparent: true, opacity: 0.55, toneMapped: false });
  const startMat = new THREE.MeshBasicMaterial({ color: '#c9f6ff', toneMapped: false });
  const endMat = new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false });
  const ringMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.85, side: THREE.DoubleSide, toneMapped: false });
  const glowMat = new THREE.SpriteMaterial({ map: glowTex, color: COLORS.line, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  disposables.push(lineMat, extMat, startMat, endMat, ringMat, glowMat);
  const unitCyl = new THREE.CylinderGeometry(1, 1, 1, 14, 1, false);
  const sphereGeo = new THREE.SphereGeometry(1, 20, 14);
  const ringGeo = new THREE.TorusGeometry(6, 0.6, 8, 40);
  disposables.push(unitCyl, sphereGeo, ringGeo);
  let lineInfo = null;
  let lineGrow = 1;
  let lineParts = null;

  function clearLine() {
    for (const o of [...lineGroup.children]) lineGroup.remove(o);
    lineParts = null;
  }
  function cylBetween(a, b, r, mat) {
    const m = new THREE.Mesh(unitCyl, mat);
    const d = new THREE.Vector3().subVectors(b, a);
    const len = d.length();
    m.position.copy(a).addScaledVector(d, 0.5);
    m.scale.set(r, Math.max(0.001, len), r);
    if (len > 1e-6) m.quaternion.setFromUnitVectors(Y_UP, d.normalize());
    return m;
  }
  /** grow: 0..1（終点 → 延長端に向かって線が延びる） */
  function layoutLine(grow) {
    if (!lineInfo) return;
    clearLine();
    const L = lineInfo;
    const end = toWorld(L.end), ext = toWorld(L.ext);
    const skin = L.skin ? toWorld(L.skin) : toWorld(L.start);
    const full = end.distanceTo(ext);
    const reach = full * grow;
    const dirW = new THREE.Vector3().subVectors(ext, end).normalize();
    const at = (s) => end.clone().addScaledVector(dirW, Math.min(s, reach));
    const inner = end.distanceTo(skin);
    // 体内側（体表との交点 → 終点）: 実線
    if (reach > 0.01) lineGroup.add(cylBetween(end, at(inner), 1.15, lineMat));
    // 体表から外側（延長 10cm）: 破線
    if (reach > inner) {
      const dash = 7, gap = 5;
      for (let s = inner; s < Math.min(full, reach); s += dash + gap) {
        lineGroup.add(cylBetween(at(s), at(Math.min(s + dash, full)), 0.85, extMat));
      }
    }
    // 終点
    const e = new THREE.Mesh(sphereGeo, endMat);
    e.position.copy(end); e.scale.setScalar(3.1);
    lineGroup.add(e);
    const eg = new THREE.Sprite(glowMat);
    eg.position.copy(end); eg.scale.setScalar(26);
    eg.renderOrder = 14;
    lineGroup.add(eg);
    // 始点
    const sp = toWorld(L.start);
    if (end.distanceTo(sp) <= reach + 0.5) {
      const s = new THREE.Mesh(sphereGeo, startMat);
      s.position.copy(sp); s.scale.setScalar(2.6);
      lineGroup.add(s);
    }
    // 体表との交点（輪）
    if (L.skin && reach >= inner) {
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.position.copy(skin);
      ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dirW);
      lineGroup.add(ring);
    }
    lineParts = { end, glow: eg };
  }
  function setLine(info, { animate = false } = {}) {
    lineInfo = info;
    if (!info) { clearLine(); lineGroup.visible = false; return; }
    lineGroup.visible = true;
    if (animate) { lineGrow = 0; layoutLine(0.001); } else { lineGrow = 1; layoutLine(1); }
  }
  function setLineDim(dim) {
    lineMat.transparent = dim; lineMat.opacity = dim ? 0.3 : 1; lineMat.needsUpdate = true;
    extMat.opacity = dim ? 0.2 : 0.55;
    startMat.transparent = endMat.transparent = dim;
    startMat.opacity = endMat.opacity = dim ? 0.35 : 1;
    startMat.needsUpdate = endMat.needsUpdate = true;
    ringMat.opacity = dim ? 0.3 : 0.85;
    glowMat.opacity = dim ? 0.25 : 1;
    labelsDim = dim;
  }

  // ---- ラベル（HTML） ----
  const labStart = h('div', { class: 'roi3d-label is-start' }, '始点');
  const labEnd = h('div', { class: 'roi3d-label is-end' }, '終点');
  const labDepth = h('div', { class: 'roi3d-label is-depth' });
  const labExt = h('div', { class: 'roi3d-label is-ext' }, '体表から外側へ10cm延長');
  const labRoi = h('div', { class: 'roi3d-label is-roi' }, '関心領域');
  const labels = h('div', { class: 'roi3d-labels' }, labStart, labEnd, labDepth, labExt, labRoi);
  host.appendChild(labels);
  let depthText = '';
  let labelsDim = false;
  const tmpV = new THREE.Vector3();
  /** ラベルを 3D の点に合わせて置く（anchor: ラベルのどこを点に合わせるか 0..1）。パネルの内側に収める。 */
  function place(el, wp, show, { dx = 0, dy = 0, ax = 0.5, ay = 0.5 } = {}) {
    if (!show) { el.classList.remove('is-shown'); return; }
    const p = viewer.project(wp);
    const W = host.clientWidth, H = host.clientHeight;
    const inView = !p.behind && p.x > -20 && p.y > -20 && p.x < W + 20 && p.y < H + 20;
    el.classList.toggle('is-shown', inView);
    el.classList.toggle('is-dim', labelsDim);
    if (!inView) return;
    if (!el._w) { el._w = el.offsetWidth; el._h = el.offsetHeight; }
    const x = Math.max(4, Math.min(W - el._w - 4, p.x + dx - ax * el._w));
    const y = Math.max(4, Math.min(H - el._h - 4, p.y + dy - ay * el._h));
    el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
  }

  // ---- フレームごとの更新 ----
  viewer.onFrame((dt, t) => {
    cloudMat.uniforms.uTime.value = t;
    if (cloud) {
      const anyOn = LAYERS.some((l) => layerOn[l.id]);
      const target = anyOn ? 0.6 : 1;
      const u = cloudMat.uniforms.uFade;
      u.value += Math.sign(target - u.value) * Math.min(Math.abs(target - u.value), dt * 1.2);
    }
    // テンプレートガイドのフェード
    const gu = skinMat.uniforms.uGuide;
    gu.value += (guideTarget - gu.value) * Math.min(1, dt * 6);
    if (gu.value < 0.002) gu.value = 0;
    // AI ROI のフェード
    if (aiMesh) {
      aiFade += (aiTarget - aiFade) * Math.min(1, dt * 6);
      aiGroup.visible = aiFade > 0.01;
      aiMesh.material.opacity = 0.32 * aiFade;
      aiWire.material.opacity = 0.55 * aiFade * (0.75 + 0.25 * Math.sin(t * 3));
    }
    // ROI の更新時のハイライト
    if (roiFlash > 0) {
      roiFlash = Math.max(0, roiFlash - dt * 1.8);
      roiMat.emissiveIntensity = 0.5 + roiFlash * 0.9;
    }
    // ラインが延びるアニメーション
    if (lineInfo && lineGrow < 1) {
      lineGrow = Math.min(1, lineGrow + dt / 0.9);
      layoutLine(ease(lineGrow));
    }
    if (lineParts) lineParts.glow.material.opacity = (labelsDim ? 0.25 : 1) * (0.65 + 0.35 * Math.sin(t * 4));
    // ラベル
    const L = lineInfo;
    const done = L && lineGrow >= 1;
    place(labEnd, L ? toWorld(L.end, tmpV) : tmpV, !!L, { dx: 9, dy: 8, ax: 0, ay: 0 });
    place(labStart, L ? toWorld(L.start, tmpV) : tmpV, !!done && (!L.skin || Math.hypot(L.start[0] - L.skin[0], L.start[1] - L.skin[1], L.start[2] - L.skin[2]) > 6), { dx: 8, dy: -6, ax: 0, ay: 1 });
    if (L && L.skin) {
      // 画面上でラインが短いときは、深さのラベルを出さない（終点のラベルと重なるため）
      const a = viewer.project(toWorld(L.end, tmpV)), b = viewer.project(toWorld(L.skin, tmpV));
      const longEnough = Math.hypot(a.x - b.x, a.y - b.y) > 120;
      const mid = toWorld([(L.end[0] + L.skin[0]) / 2, (L.end[1] + L.skin[1]) / 2, (L.end[2] + L.skin[2]) / 2], tmpV);
      place(labDepth, mid, !!done && !!depthText && longEnough, { dy: 12, ax: 0.5, ay: 0 });
      const ex = toWorld([L.skin[0] + (L.ext[0] - L.skin[0]) * 0.45, L.skin[1] + (L.ext[1] - L.skin[1]) * 0.45, L.skin[2] + (L.ext[2] - L.skin[2]) * 0.45], tmpV);
      place(labExt, ex, !!done, { dy: -9, ax: 0.5, ay: 1 });
    } else { place(labDepth, tmpV, false); place(labExt, tmpV, false); }
    place(labRoi, roiTop ? toWorld(roiTop, tmpV) : tmpV, !!roiTop && roiMesh.visible, { dy: -10, ax: 0.5, ay: 1 });
  });

  // ---- 解剖モデルの読み込み ----
  let disposed = false;
  const ready = getAnatomyGeometries().then((geoms) => {
    if (disposed) return;
    if (!cloudGeoCache) cloudGeoCache = buildCloud(geoms);
    cloud = new THREE.Points(cloudGeoCache, cloudMat);
    cloud.renderOrder = 1;
    cloud.frustumCulled = false;
    root.add(cloud);
    model = createAnatomyModel(geoms, { style: 'clinical', include: INCLUDE, opacity: { ...OPACITY, skin: skinOpacity } });
    root.add(model.group);
    for (const l of LAYERS) for (const m of l.members) model.setVisible(m, layerOn[l.id]);
    // 体表は専用のシェーダーに差し替える
    skinMesh = model.meshes.get('skin');
    if (skinMesh) {
      skinMesh.material.dispose();
      skinMesh.material = skinMat;
      skinMesh.renderOrder = 10;
    }
    applySkin();
    opts.onReady?.();
  });

  // ---- ROI の再構築（間引き） ----
  let roiTimer = 0;
  let pendingCircles = null;
  function rebuildRoi() {
    roiTimer = 0;
    const circles = pendingCircles;
    pendingCircles = null;
    if (disposed || !circles) return;
    const built = circles.length ? buildRoiGeometry(circles) : null;
    const old = roiMesh.geometry;
    if (built && built.geometry.attributes.position.count > 0) {
      roiMesh.geometry = built.geometry;
      roiMesh.visible = true;
      roiCenter = built.center;
      roiTop = built.top;
      roiFlash = 1;
    } else {
      roiMesh.geometry = new THREE.BufferGeometry();
      roiMesh.visible = false;
      roiCenter = null;
      roiTop = null;
    }
    old.dispose();
    opts.onRoiBuilt?.(built ? { volumeMl: built.volumeMl } : null);
  }
  function setRoi(circles, { immediate = false, delay = 140 } = {}) {
    pendingCircles = circles;
    if (immediate) { clearTimeout(roiTimer); rebuildRoi(); return; }
    if (!roiTimer) roiTimer = setTimeout(rebuildRoi, delay);
  }

  // ---- 公開 API ----
  return {
    viewer,
    ready,
    home,
    focus: (ms) => focus(roiCenter || (lineInfo ? lineInfo.end : null), ms),
    setLayer(id, on) {
      layerOn[id] = on;
      const l = LAYERS.find((x) => x.id === id);
      if (model && l) for (const m of l.members) model.setVisible(m, on);
      if (id === 'skin') applySkin();
    },
    /** 体表の透過度 0..100（%） */
    setSkinTransparency(pct) {
      skinOpacity = Math.max(0, Math.min(1, 1 - pct / 100));
      applySkin();
      guideTarget = pct <= 0 ? 1 : 0;
    },
    setRoi,
    setLine,
    setLineDim,
    setDepthText(text) { if (text !== depthText) { depthText = text; labDepth.textContent = text; labDepth._w = 0; } },
    setAiRoi(on) {
      if (on && !aiMesh) {
        const geo = aiRoiGeometry();
        aiMesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
          color: COLORS.ai, emissive: COLORS.ai, emissiveIntensity: 0.45, transparent: true, opacity: 0,
          depthWrite: false, side: THREE.DoubleSide, roughness: 0.5,
        }));
        aiMesh.renderOrder = 8;
        aiWire = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: COLORS.ai, wireframe: true, transparent: true, opacity: 0, depthWrite: false, toneMapped: false }));
        aiWire.renderOrder = 9;
        aiGroup.add(aiMesh, aiWire);
      }
      aiTarget = on ? 1 : 0;
    },
    dispose() {
      disposed = true;
      clearTimeout(roiTimer);
      ro.disconnect();
      if (cloud) root.remove(cloud); // 点群のジオメトリは画面間で再利用する
      model?.dispose();
      if (model) root.remove(model.group);
      if (aiGroup.parent) root.remove(aiGroup);
      aiMesh?.material.dispose(); aiWire?.material.dispose();
      for (const d of disposables) d.dispose();
      viewer.dispose();
      labels.remove();
    },
  };
}
