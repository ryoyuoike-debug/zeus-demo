// =============================================================================
// AR表示: 3D シーン（パススルーの処置室 ＋ 仮想表示）
// -----------------------------------------------------------------------------
// 描画は 2 パス:
//   1) room … パススルー映像に見立てた現実側（部屋・処置台・胸部模型・術者の手）
//   2) virt … 仮想表示（3D モデル・位置合わせの球・線香花火・関心領域・ライン）
//      深度をクリアしてから描くので、胸部模型の「中」にあるモデルも見える（AR と同じ）。
// 単位は mm。胸部模型は仰臥位（前面が上 +Y、頭が奥 -Z、患者の左が +X）。
// =============================================================================
import * as THREE from 'three';
import { getAnatomyGeometries, createAnatomyModel, toWorld } from '../../three/meshing.js';
import { MARKERS, sdBody, anteriorSkinY, bodyA, bodyB, STRUCTURE_BY_ID } from '../../data/phantom.js';
import { buildRoiGeometry, computeLine } from '../roi/geometry.js';
import { buildRoom, TABLE_TOP } from './room.js';
import { createHand } from './hand.js';
import { createSparkle, glowTexture } from './sparkle.js';
import { HOLO_IDS } from './presets.js';
import { rigidFrom3 } from './registration.js';

/** 体の背面までの距離（患者座標 y = -108 が処置台に接する） */
const BACK = 108;
/** 仮想の球の半径（mm） */
export const SPHERE_R = 10;
/** 立った術者の目の位置と注視点 */
const HEAD = { pos: new THREE.Vector3(-430, 1700, 110), target: new THREE.Vector3(40, 965, -25) };
/** 位置合わせ前にモデルが浮かんでいる位置 */
const FLOAT_CENTER = new THREE.Vector3(60, TABLE_TOP + BACK + 190, 400);

const ease = {
  inOut: (u) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2),
  out: (u) => 1 - Math.pow(1 - u, 3),
  outBack: (u) => { const c1 = 1.4, c3 = c1 + 1; return 1 + c3 * Math.pow(u - 1, 3) + c1 * Math.pow(u - 1, 2); },
};
export { ease };
const abortError = () => new DOMException('aborted', 'AbortError');

/** 患者座標の体表の法線（sdBody の勾配） */
function skinNormalPatient(x, y, z) {
  const e = 0.8;
  const n = [sdBody(x + e, y, z) - sdBody(x - e, y, z), sdBody(x, y + e, z) - sdBody(x, y - e, z), sdBody(x, y, z + e) - sdBody(x, y, z - e)];
  const l = Math.hypot(n[0], n[1], n[2]) || 1;
  return [n[0] / l, n[1] / l, n[2] / l];
}

/**
 * @param {HTMLElement} host
 * @param {{signal: AbortSignal}} opts
 */
export function createArScene(host, { signal }) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.autoClear = false;
  renderer.domElement.classList.add('ar-canvas');
  host.appendChild(renderer.domElement);

  const camera = new THREE.PerspectiveCamera(50, 1, 20, 20000);
  camera.position.copy(HEAD.pos);
  camera.lookAt(HEAD.target);

  const room = new THREE.Scene();
  const virt = new THREE.Scene();
  const roomBuilt = buildRoom(room);
  const ownMaterials = [];
  const ownTextures = [];
  const keepMat = (m) => { ownMaterials.push(m); return m; };
  const keepTex = (t) => { ownTextures.push(t); return t; };
  const ownMesh = (geo, mat) => { const m = new THREE.Mesh(geo, mat); m.userData.ownGeometry = true; return m; };

  // 仮想表示用の照明（モデルの陰影を見やすく）
  virt.add(new THREE.HemisphereLight('#e8f1ff', '#2a3344', 1.1));
  const vKey = new THREE.DirectionalLight('#ffffff', 1.5);
  vKey.position.set(-300, 2600, 900);
  virt.add(vKey);
  const vRim = new THREE.DirectionalLight('#9cc4ff', 0.7);
  vRim.position.set(900, 600, -1500);
  virt.add(vRim);

  // ---------------------------------------------------------------------------
  // 胸部模型（実物側）
  // ---------------------------------------------------------------------------
  const torsoRoot = new THREE.Group();
  torsoRoot.name = 'torso';
  torsoRoot.position.set(0, TABLE_TOP + BACK, 0);
  torsoRoot.rotation.x = -Math.PI / 2; // モデルの +Z（前面）を上へ、+Y（頭側）を奥（-Z）へ
  room.add(torsoRoot);
  torsoRoot.updateMatrixWorld(true);
  const torsoInv = torsoRoot.matrixWorld.clone().invert();

  /** 患者座標 → ワールド座標（胸部模型の位置） */
  const patientToWorld = (p, out = new THREE.Vector3()) => torsoRoot.localToWorld(toWorld(p, out));

  // CT 撮影時に貼ったマーカ（実物のシール）と、その位置・法線
  const markerSurf = MARKERS.map((m) => {
    const y = anteriorSkinY(m.x, m.z);
    const p = [m.x, y, m.z];
    const n = skinNormalPatient(m.x, y, m.z);
    const point = patientToWorld(p);
    const normal = toWorld(n).applyQuaternion(torsoRoot.quaternion).normalize();
    return { point, normal, local: toWorld(p), localN: toWorld(n) };
  });
  {
    const discGeo = new THREE.CylinderGeometry(8.5, 8.5, 1.0, 28);
    const beadGeo = new THREE.SphereGeometry(3.0, 16, 10);
    const discMat = keepMat(new THREE.MeshStandardMaterial({ color: '#f5f6f2', roughness: 0.7 }));
    const beadMat = keepMat(new THREE.MeshStandardMaterial({ color: '#8b9399', roughness: 0.25, metalness: 0.8 }));
    markerSurf.forEach((s, i) => {
      const g = new THREE.Group();
      g.position.copy(s.local).addScaledVector(s.localN, 0.4);
      g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), s.localN);
      const d = new THREE.Mesh(discGeo, discMat);
      d.receiveShadow = true;
      const b = new THREE.Mesh(beadGeo, beadMat);
      b.position.y = 0.8;
      b.scale.y = 0.6;
      if (i === 0) { d.userData.ownGeometry = true; b.userData.ownGeometry = true; }
      g.add(d, b);
      torsoRoot.add(g);
    });
  }

  // ---------------------------------------------------------------------------
  // 術者の手（実物側）と線香花火（仮想）
  // ---------------------------------------------------------------------------
  const hand = createHand();
  hand.group.visible = false;
  room.add(hand.group);
  const handState = { visible: false, target: new THREE.Vector3(), pos: new THREE.Vector3(), ok: 1, okTarget: 1, follow: 18, roll: -0.95 };

  const sparkle = createSparkle();
  virt.add(sparkle.group);

  // ---------------------------------------------------------------------------
  // 位置合わせの球（右鎖骨中線＝オレンジ / 左鎖骨中線＝青 / 剣状突起＝緑）
  // ---------------------------------------------------------------------------
  const sphereGeo = new THREE.SphereGeometry(SPHERE_R, 36, 22);
  const ringGeo = new THREE.RingGeometry(SPHERE_R * 1.45, SPHERE_R * 1.75, 48);
  const guideGeo = new THREE.RingGeometry(15, 18.5, 56);
  const haloTex = keepTex(glowTexture('rgba(255,255,255,0.9)', 'rgba(255,255,255,0.28)'));
  const spheres = MARKERS.map((m, i) => {
    const color = new THREE.Color(m.color);
    const g = new THREE.Group();
    g.visible = false;
    const mat = keepMat(new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.55, roughness: 0.25, metalness: 0.05, transparent: true, opacity: 0.97, depthTest: false }));
    const ball = new THREE.Mesh(sphereGeo, mat);
    ball.renderOrder = 41;
    if (i === 0) ball.userData.ownGeometry = true;
    const halo = new THREE.Sprite(keepMat(new THREE.SpriteMaterial({ map: haloTex, color, transparent: true, opacity: 0.55, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending })));
    halo.renderOrder = 40;
    halo.scale.setScalar(SPHERE_R * 5);
    const ringMat = keepMat(new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, depthTest: false }));
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.renderOrder = 42;
    if (i === 0) ring.userData.ownGeometry = true;
    g.add(halo, ball, ring);
    virt.add(g);
    return { g, ball, halo, ring, mat, ringMat, phase: 'none', t0: 0, pop: 0 };
  });
  // 目標マーカのガイド（脈動する輪）
  const guide = (() => {
    const mat = keepMat(new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.0, side: THREE.DoubleSide, depthWrite: false }));
    const m = new THREE.Mesh(guideGeo, mat);
    m.userData.ownGeometry = true;
    m.visible = false;
    virt.add(m);
    return { mesh: m, mat, index: -1 };
  })();
  // 3 点を結ぶ三角形
  const tri = (() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(12), 3));
    const mat = keepMat(new THREE.LineDashedMaterial({ color: '#ffffff', dashSize: 9, gapSize: 6, transparent: true, opacity: 0.0, depthWrite: false, depthTest: false }));
    const line = new THREE.Line(geo, mat);
    line.renderOrder = 39;
    line.userData.ownGeometry = true;
    line.visible = false;
    virt.add(line);
    return { line, geo, mat, on: false };
  })();
  // 位置合わせ中: 置いた球 ↔ モデル上の対応点を結ぶ線（モデルが近づくと縮んで消える）
  const links = (() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(18), 3));
    const col = [];
    for (const m of MARKERS) { const c = new THREE.Color(m.color); col.push(c.r, c.g, c.b, c.r, c.g, c.b); }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    const mat = keepMat(new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0, depthTest: false, depthWrite: false }));
    const seg = new THREE.LineSegments(geo, mat);
    seg.userData.ownGeometry = true;
    seg.renderOrder = 38;
    seg.frustumCulled = false;
    seg.visible = false;
    virt.add(seg);
    // モデル側の対応点（ローカル座標 = 胸部模型と同じ）
    const local = MARKERS.map((_, i) => markerSurf[i].local.clone().addScaledVector(markerSurf[i].localN, SPHERE_R + 0.5));
    const dots = MARKERS.map((m) => {
      const d = new THREE.Mesh(new THREE.SphereGeometry(4.5, 16, 10), keepMat(new THREE.MeshBasicMaterial({ color: m.color, transparent: true, opacity: 0, depthTest: false, depthWrite: false })));
      d.userData.ownGeometry = true;
      d.renderOrder = 38;
      d.visible = false;
      virt.add(d);
      return d;
    });
    return { seg, geo, mat, local, dots };
  })();
  const tmpV = new THREE.Vector3();
  function updateLinks(u) {
    const on = u !== null;
    links.seg.visible = on;
    for (const d of links.dots) d.visible = on;
    if (!on) return;
    const a = links.geo.attributes.position;
    for (let i = 0; i < 3; i++) {
      tmpV.copy(links.local[i]).applyMatrix4(holoRoot.matrix);
      const sp = spheres[i].g.position;
      a.setXYZ(i * 2, tmpV.x, tmpV.y, tmpV.z);
      a.setXYZ(i * 2 + 1, sp.x, sp.y, sp.z);
      links.dots[i].position.copy(tmpV);
      links.dots[i].material.opacity = 0.95 * (1 - u * u);
    }
    a.needsUpdate = true;
    links.mat.opacity = 0.9 * (1 - u * u);
  }

  // 球を置いたときに広がる波紋
  const ripples = [];
  const rippleGeo = new THREE.RingGeometry(0.8, 1, 64);
  function ripple(pos, normal, color) {
    const mat = keepMat(new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
    const m = new THREE.Mesh(rippleGeo, mat);
    m.position.copy(pos).addScaledVector(normal, -SPHERE_R + 1.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
    virt.add(m);
    ripples.push({ m, mat, t0: performance.now() });
  }

  // ---------------------------------------------------------------------------
  // 3D モデル（仮想）と関心領域・ライン
  // ---------------------------------------------------------------------------
  const holoRoot = new THREE.Group();
  holoRoot.name = 'holoRoot';
  holoRoot.matrixAutoUpdate = false;
  holoRoot.visible = false;
  virt.add(holoRoot);
  const canonMatrix = torsoRoot.matrixWorld.clone();
  const holo = {
    model: null,
    state: 'hidden', // hidden | float | aligning | aligned
    ops: {}, // 構造ごとの不透明度（プリセット＋スライダー）
    fade: 0, fadeTarget: 0,
    shown: true, // 3D表示 ON/OFF
    finalMatrix: canonMatrix.clone(),
    grab: new THREE.Vector3(),
    grabYaw: 0,
    floatP: new THREE.Vector3(), floatQ: new THREE.Quaternion(),
    alignFrom: null, alignT0: 0, alignMs: 1600, alignResolve: null,
    flash: 0,
  };
  const roiGroup = new THREE.Group();
  roiGroup.visible = false;
  holoRoot.add(roiGroup);

  // 位置合わせ完了時のスキャン（体軸方向に走る断面リング）
  const scan = (() => {
    const g = new THREE.Group();
    g.visible = false;
    const z0 = 40;
    const pts = [];
    const N = 96;
    for (let i = 0; i < N; i++) {
      const th = (i / N) * Math.PI * 2;
      const cx = Math.cos(th), cy = Math.sin(th);
      let lo = 0, hi = 260;
      for (let k = 0; k < 24; k++) { const m = (lo + hi) / 2; if (sdBody(cx * m, cy * m, z0) < 0) lo = m; else hi = m; }
      pts.push(new THREE.Vector3(cx * (lo + 6), 0, cy * (lo + 6)));
    }
    const curve = new THREE.CatmullRomCurve3(pts, true);
    const tubeGeo = new THREE.TubeGeometry(curve, 160, 1.8, 8, true);
    const tubeMat = keepMat(new THREE.MeshBasicMaterial({ color: '#7fe9ff', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
    const tube = ownMesh(tubeGeo, tubeMat);
    const shape = new THREE.Shape(pts.map((p) => new THREE.Vector2(p.x, p.z)));
    const fillGeo = new THREE.ShapeGeometry(shape, 2);
    const fillMat = keepMat(new THREE.MeshBasicMaterial({ color: '#3fb8ff', transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
    const fill = ownMesh(fillGeo, fillMat);
    fill.rotation.x = Math.PI / 2;
    g.add(fill, tube);
    holoRoot.add(g);
    return { g, tubeMat, fillMat, a0: bodyA(z0), b0: bodyB(z0), t0: 0, ms: 1300, on: false };
  })();
  function startScan() { scan.on = true; scan.t0 = performance.now(); scan.g.visible = true; }

  // 仮想の体表（暗い半透明＋輪郭の発光）。パススルーの上でモデルを見やすくする「窓」
  const SHELL_VS = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
void main() {
  vN = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;
  const SHELL_FS = /* glsl */ `
uniform vec3 uInner;
uniform vec3 uRim;
uniform float uOpacity;
uniform float uGlow;
varying vec3 vN;
varying vec3 vV;
void main() {
  float ndv = abs(dot(normalize(vN), normalize(vV)));
  float f = pow(1.0 - ndv, 2.4);
  vec3 col = mix(uInner, uRim * (1.0 + uGlow), f);
  float a = uOpacity * (0.34 + 0.62 * f + 0.25 * uGlow);
  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
  #include <colorspace_fragment>
}`;
  const shellMat = keepMat(new THREE.ShaderMaterial({
    vertexShader: SHELL_VS, fragmentShader: SHELL_FS,
    uniforms: { uInner: { value: new THREE.Color('#061423') }, uRim: { value: new THREE.Color('#6fd3ff') }, uOpacity: { value: 0 }, uGlow: { value: 0 } },
    transparent: true, depthWrite: false,
  }));
  let shell = null;

  function applyHoloOpacity() {
    shellMat.uniforms.uOpacity.value = holo.fade;
    const m = holo.model;
    if (!m) return;
    for (const id of HOLO_IDS) {
      const op = holo.ops[id] ?? 0;
      m.setOpacity(id, op * holo.fade);
      m.setVisible(id, op > 0);
    }
  }

  function styleHolo(model) {
    for (const [id, mesh] of model.meshes) {
      const s = STRUCTURE_BY_ID[id];
      const mat = mesh.material;
      const c = new THREE.Color(s.color);
      mat.emissive = c.clone().multiplyScalar(id === 'nodule' ? 0.6 : id.startsWith('lung') ? 0.28 : 0.2);
      mat.emissiveIntensity = 1;
      mat.roughness = 0.4;
      mesh.renderOrder = id.startsWith('lung') ? 8 : mesh.renderOrder;
    }
  }

  // 胸部模型の付属部分（首の台座・切断面のプレート）。CT の撮影範囲の外なので 3D モデルには含まれない
  function addPhantomParts(skinMat) {
    const plateMat = keepMat(new THREE.MeshStandardMaterial({ color: '#59616b', roughness: 0.5, metalness: 0.2 }));
    const contour = (z, off) => {
      const pts = [];
      for (let i = 0; i < 72; i++) {
        const th = (i / 72) * Math.PI * 2;
        const cx = Math.cos(th), cy = Math.sin(th);
        let lo = 0, hi = 260;
        for (let k = 0; k < 24; k++) { const m = (lo + hi) / 2; if (sdBody(cx * m, cy * m, z) < 0) lo = m; else hi = m; }
        pts.push(new THREE.Vector2(cx * (lo + off), cy * (lo + off)));
      }
      return new THREE.Shape(pts);
    };
    // 下端（腹部側）の切断面に、樹脂のプレート
    const zb = -174.5;
    const plateGeo = new THREE.ExtrudeGeometry(contour(zb + 1, 1.5), { depth: 8, bevelEnabled: true, bevelSize: 1.5, bevelThickness: 1.5, bevelSegments: 2, curveSegments: 4 });
    const plate = ownMesh(plateGeo, plateMat);
    // Extrude は XY 平面・+Z 方向 → モデル座標（X=x, Y=z, Z=y）へ
    plate.rotation.x = Math.PI / 2;
    plate.position.y = zb + 3;
    plate.castShadow = true;
    torsoRoot.add(plate);
    // 上端（頸部側）にも小さなプレート
    const zt = 177.5;
    const topGeo = new THREE.ExtrudeGeometry(contour(zt - 1, 1.2), { depth: 5, bevelEnabled: true, bevelSize: 1.2, bevelThickness: 1.2, bevelSegments: 2, curveSegments: 4 });
    const top = ownMesh(topGeo, plateMat);
    top.rotation.x = Math.PI / 2;
    top.position.y = zt + 5.5;
    top.castShadow = true;
    torsoRoot.add(top);
  }

  // ---------------------------------------------------------------------------
  // 読み込み（ジオメトリ生成は初回のみ ~1.5 秒）
  // ---------------------------------------------------------------------------
  let torsoMesh = null;
  const ready = getAnatomyGeometries().then((geoms) => {
    if (signal.aborted) return;
    const torsoMat = keepMat(new THREE.MeshPhysicalMaterial({ color: '#e2c2a3', roughness: 0.42, metalness: 0, clearcoat: 0.35, clearcoatRoughness: 0.45, sheen: 0.3, sheenColor: new THREE.Color('#ffe9d6') }));
    torsoMesh = new THREE.Mesh(geoms.get('skin'), torsoMat);
    torsoMesh.castShadow = true;
    torsoMesh.receiveShadow = true;
    torsoRoot.add(torsoMesh);
    addPhantomParts(torsoMat);
    shell = new THREE.Mesh(geoms.get('skin'), shellMat);
    shell.renderOrder = -10;
    holoRoot.add(shell);
    const model = createAnatomyModel(geoms, { style: 'clinical', include: HOLO_IDS, opacity: { lung_r: 0.4, lung_l: 0.4 } });
    styleHolo(model);
    holo.model = model;
    holoRoot.add(model.group);
    applyHoloOpacity();
  });

  // ---------------------------------------------------------------------------
  // カメラ（頭の揺れ・見回し・前かがみ）
  // ---------------------------------------------------------------------------
  const baseFwd = HEAD.target.clone().sub(HEAD.pos).normalize();
  const baseYaw = Math.atan2(-baseFwd.x, -baseFwd.z);
  const basePitch = Math.asin(baseFwd.y);
  const look = { yaw: 0, pitch: 0, lean: 0, tYaw: 0, tPitch: 0, tLean: 0, yawLag: 0, pitchLag: 0, swayX: 0, swayY: 0 };
  const euler = new THREE.Euler(0, 0, 0, 'YXZ');
  function updateCamera(dt, t) {
    const k = 1 - Math.exp(-dt * 9);
    look.yaw += (look.tYaw - look.yaw) * k;
    look.pitch += (look.tPitch - look.pitch) * k;
    look.lean += (look.tLean - look.lean) * k;
    const kl = 1 - Math.exp(-dt * 2.6);
    look.yawLag += (look.yaw - look.yawLag) * kl;
    look.pitchLag += (look.pitch - look.pitchLag) * kl;
    // 頭の自然な揺れ（呼吸・姿勢の微調整）
    const sx = 2.4 * Math.sin(t * 0.61) + 1.1 * Math.sin(t * 1.37 + 0.4);
    const sy = 2.0 * Math.sin(t * 0.83 + 1.0) + 0.6 * Math.sin(t * 2.1);
    const sz = 1.6 * Math.sin(t * 0.47 + 2.0);
    const ry = 0.0032 * Math.sin(t * 0.31) + 0.0012 * Math.sin(t * 0.93 + 1.1);
    const rp = 0.0026 * Math.sin(t * 0.53 + 0.7) + 0.001 * Math.sin(t * 1.7);
    const rr = 0.0022 * Math.sin(t * 0.41 + 0.2);
    look.swayX = ry; look.swayY = rp;
    camera.position.copy(HEAD.pos).addScaledVector(baseFwd, look.lean);
    camera.position.x += sx; camera.position.y += sy; camera.position.z += sz;
    euler.set(basePitch + look.pitch + rp, baseYaw + look.yaw + ry, rr);
    camera.quaternion.setFromEuler(euler);
    camera.updateMatrixWorld();
  }

  // ---------------------------------------------------------------------------
  // フレームごとの更新
  // ---------------------------------------------------------------------------
  const frameCbs = new Set();
  let mirror = null; // { ctx, canvas, every }
  let frameNo = 0;
  const tmpM = new THREE.Matrix4(), tmpP = new THREE.Vector3(), tmpQ = new THREE.Quaternion(), tmpS = new THREE.Vector3(1, 1, 1);
  const finP = new THREE.Vector3(), finQ = new THREE.Quaternion(), finS = new THREE.Vector3();
  const yawQ = new THREE.Quaternion(), tiltQ = new THREE.Quaternion(), Yax = new THREE.Vector3(0, 1, 0), Xax = new THREE.Vector3(1, 0, 0);
  const canonQ = torsoRoot.quaternion.clone();
  const camRight = new THREE.Vector3(), camUp = new THREE.Vector3(), camBack = new THREE.Vector3();

  function floatPose(t, outP, outQ) {
    yawQ.setFromAxisAngle(Yax, 0.35 + 0.22 * Math.sin(t * 0.35));
    tiltQ.setFromAxisAngle(Xax, 0.12);
    outQ.copy(yawQ).multiply(tiltQ).multiply(canonQ);
    outP.copy(FLOAT_CENTER);
    outP.y += 9 * Math.sin(t * 1.15);
  }
  function finalPose(outP, outQ) {
    holo.finalMatrix.decompose(outP, outQ, finS);
    if (holo.grab.lengthSq() > 0 || holo.grabYaw) {
      outP.add(holo.grab);
      yawQ.setFromAxisAngle(Yax, holo.grabYaw);
      outQ.premultiply(yawQ);
    }
  }

  function updateHolo(now, t, dt) {
    if (!holo.model) return;
    const kf = 1 - Math.exp(-dt * 5);
    if (Math.abs(holo.fade - holo.fadeTarget) > 0.002) {
      holo.fade += (holo.fadeTarget - holo.fade) * kf;
      applyHoloOpacity();
    } else if (holo.fade !== holo.fadeTarget) { holo.fade = holo.fadeTarget; applyHoloOpacity(); }
    holoRoot.visible = holo.state !== 'hidden' && holo.shown && holo.fade > 0.003;
    let scale = 1;
    if (holo.state === 'float') {
      floatPose(t, tmpP, tmpQ);
      scale = 0.94 + 0.06 * holo.fade;
    } else if (holo.state === 'aligning') {
      const u = Math.min(1, (now - holo.alignT0) / holo.alignMs);
      floatPose(t, tmpP, tmpQ);
      finalPose(finP, finQ);
      const e = ease.inOut(u);
      tmpP.lerp(finP, e);
      tmpQ.slerp(finQ, e);
      if (u >= 1) {
        holo.state = 'aligned';
        holo.flash = 1;
        startScan();
        const r = holo.alignResolve; holo.alignResolve = null; r?.();
      }
    } else {
      finalPose(tmpP, tmpQ);
    }
    tmpS.setScalar(scale);
    holoRoot.matrix.compose(tmpP, tmpQ, tmpS);
    holoRoot.matrixWorldNeedsUpdate = true;
    updateLinks(holo.state === 'aligning' ? Math.min(1, (now - holo.alignT0) / holo.alignMs) : null);
    // 重なった瞬間の発光
    shellMat.uniforms.uGlow.value = holo.flash;
    if (holo.flash > 0) {
      holo.flash = Math.max(0, holo.flash - dt * 1.1);
      for (const [id, m] of holo.model.meshes) {
        const base = m.userData.baseEmissive || (m.userData.baseEmissive = m.material.emissive.clone());
        m.material.emissive.copy(base).lerp(new THREE.Color('#bfe9ff'), holo.flash * (id.startsWith('lung') ? 0.35 : 0.5));
      }
    }
    // スキャン
    if (scan.on) {
      const u = Math.min(1, (now - scan.t0) / scan.ms);
      const z = 150 - u * 300; // 頭側 → 足側
      scan.g.position.y = z;
      scan.g.scale.set(bodyA(z) / scan.a0, 1, bodyB(z) / scan.b0);
      const a = Math.sin(u * Math.PI);
      scan.tubeMat.opacity = 0.95 * a;
      scan.fillMat.opacity = 0.13 * a;
      if (u >= 1) { scan.on = false; scan.g.visible = false; }
    }
  }

  function updateHand(dt) {
    if (!handState.visible) { hand.group.visible = false; return; }
    hand.group.visible = true;
    const k = 1 - Math.exp(-dt * handState.follow);
    handState.pos.lerp(handState.target, k);
    handState.ok += (handState.okTarget - handState.ok) * (1 - Math.exp(-dt * 10));
    hand.setOk(handState.ok);
    hand.orient(handState.pos, camera, handState.roll);
  }

  function updateSpheres(now, t, dt) {
    for (const s of spheres) {
      if (!s.g.visible) continue;
      s.pop = Math.min(1, s.pop + dt * 4.5);
      const pop = ease.outBack(s.pop);
      const pulse = s.phase === 'carry' ? 1 + 0.06 * Math.sin(now * 0.012) : 1;
      s.ball.scale.setScalar(Math.max(0.001, pop * pulse));
      s.halo.material.opacity = (s.phase === 'confirmed' ? 0.35 : 0.6) * pop * (0.85 + 0.15 * Math.sin(now * 0.006));
      // 確定済みの輪（カメラの方を向く）
      s.ring.quaternion.copy(camera.quaternion);
      const ringTarget = s.phase === 'confirmed' ? 0.9 : 0;
      s.ringMat.opacity += (ringTarget - s.ringMat.opacity) * 0.15;
      const ru = Math.min(1, (now - s.t0) / 450);
      s.ring.scale.setScalar(s.phase === 'confirmed' ? 0.6 + 0.4 * ease.outBack(ru) : 1);
    }
    if (guide.index >= 0) {
      const s = markerSurf[guide.index];
      guide.mesh.visible = true;
      guide.mesh.position.copy(s.point).addScaledVector(s.normal, 1.5);
      guide.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), s.normal);
      const u = (now % 1400) / 1400;
      guide.mesh.scale.setScalar(0.75 + 0.6 * u);
      guide.mat.opacity = 0.85 * (1 - u);
    } else guide.mesh.visible = false;
    if (tri.line.visible) {
      tri.mat.opacity += ((tri.on ? 0.75 : 0) - tri.mat.opacity) * 0.1;
      if (!tri.on && tri.mat.opacity < 0.02) tri.line.visible = false;
    }
    for (let i = ripples.length - 1; i >= 0; i--) {
      const r = ripples[i];
      const u = (now - r.t0) / 700;
      if (u >= 1) { virt.remove(r.m); r.mat.dispose(); ownMaterials.splice(ownMaterials.indexOf(r.mat), 1); ripples.splice(i, 1); continue; }
      r.m.scale.setScalar(SPHERE_R + 46 * ease.out(u));
      r.mat.opacity = 0.9 * (1 - u);
    }
  }

  const viewShift = { x: 0, y: 0 };
  function resize() {
    const w = Math.max(1, host.clientWidth), hgt = Math.max(1, host.clientHeight);
    renderer.setSize(w, hgt, false);
    camera.aspect = w / hgt;
    if (viewShift.x || viewShift.y) camera.setViewOffset(w, hgt, viewShift.x, viewShift.y, w, hgt);
    else camera.clearViewOffset();
    camera.updateProjectionMatrix();
    sparkle.setPixelScale((hgt * renderer.getPixelRatio()) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))));
  }
  const ro = new ResizeObserver(resize);
  ro.observe(host);
  resize();
  let visible = true;
  const io = new IntersectionObserver((es) => { visible = es.some((e) => e.isIntersecting); });
  io.observe(host);

  let raf = 0;
  let last = performance.now();
  const t0 = last;
  function loop() {
    raf = requestAnimationFrame(loop);
    if (!visible || document.hidden) { last = performance.now(); return; }
    const now = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const t = (now - t0) / 1000;
    updateCamera(dt, t);
    updateHand(dt);
    updateHolo(now, t, dt);
    updateSpheres(now, t, dt);
    for (const cb of frameCbs) cb(dt, now);
    sparkle.update(dt, now);
    renderer.clear();
    renderer.render(room, camera);
    renderer.clearDepth();
    renderer.render(virt, camera);
    frameNo++;
    if (mirror && frameNo % mirror.every === 0) {
      const c = mirror.canvas;
      const sw = renderer.domElement.width, sh = renderer.domElement.height;
      // 子画面の縦横比に合わせて中央を切り出す
      const ar = c.width / c.height;
      let cw = sw, ch = sw / ar;
      if (ch > sh) { ch = sh; cw = sh * ar; }
      mirror.ctx.drawImage(renderer.domElement, (sw - cw) / 2, (sh - ch) / 2, cw, ch, 0, 0, c.width, c.height);
    }
  }
  loop();

  // ---------------------------------------------------------------------------
  // ピッキング（体表をレイマーチングで求める。胸部模型の形状は解析的に定義されている）
  // ---------------------------------------------------------------------------
  const rc = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  function pick(clientX, clientY) {
    if (!torsoMesh) return null;
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    rc.setFromCamera(ndc, camera);
    const o = rc.ray.origin.clone().applyMatrix4(torsoInv);
    const d = rc.ray.direction.clone().transformDirection(torsoInv);
    // モデル座標 (X=x, Y=z, Z=y) → 患者座標
    const px = o.x, py = o.z, pz = o.y, dx = d.x, dy = d.z, dz = d.y;
    let t = 0;
    for (let i = 0; i < 200; i++) {
      const x = px + dx * t, y = py + dy * t, z = pz + dz * t;
      const s = sdBody(x, y, z);
      if (s < 0.25) {
        const n = skinNormalPatient(x, y, z);
        const point = patientToWorld([x, y, z]);
        const normal = toWorld(n).applyQuaternion(torsoRoot.quaternion).normalize();
        return { point, normal, patient: [x, y, z] };
      }
      t += Math.max(0.4, s * 0.85);
      if (t > 8000) break;
    }
    return null;
  }
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  /** クライアント座標のレイと水平面 y = height の交点 */
  function rayPlane(clientX, clientY, height) {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    rc.setFromCamera(ndc, camera);
    plane.constant = -height;
    return rc.ray.intersectPlane(plane, new THREE.Vector3());
  }
  function project(v) {
    const p = v.clone().project(camera);
    return { x: (p.x * 0.5 + 0.5) * host.clientWidth, y: (-p.y * 0.5 + 0.5) * host.clientHeight, behind: p.z > 1 };
  }

  // ---------------------------------------------------------------------------
  // 時間指定のアニメーション（signal で中断）
  // ---------------------------------------------------------------------------
  function tween(ms, fn, sig) {
    return new Promise((resolve, reject) => {
      if (sig?.aborted || signal.aborted) return reject(abortError());
      const start = performance.now();
      let off = null;
      const onAbort = () => { off?.(); reject(abortError()); };
      sig?.addEventListener('abort', onAbort, { once: true });
      signal.addEventListener('abort', onAbort, { once: true });
      const cb = () => {
        const u = Math.min(1, (performance.now() - start) / ms);
        fn(u);
        if (u >= 1) {
          off();
          sig?.removeEventListener('abort', onAbort);
          signal.removeEventListener('abort', onAbort);
          resolve();
        }
      };
      frameCbs.add(cb);
      off = () => frameCbs.delete(cb);
      fn(0);
    });
  }

  // ---------------------------------------------------------------------------
  // 公開 API
  // ---------------------------------------------------------------------------
  const api = {
    renderer, camera, room, virt, ready,
    onFrame(cb) { frameCbs.add(cb); return () => frameCbs.delete(cb); },
    pick, project, tween, rayPlane,
    /** 画面の左右のパネルを避けて、胸部模型が空いている所の中央に来るよう投影をずらす（px） */
    setViewShift(px, py = 0) { viewShift.x = px; viewShift.y = py; resize(); },
    markerSurface: (i) => markerSurf[i],
    /** マーカ i に球を置くときの球の中心（体表から半径ぶん浮かせる） */
    sphereTarget(i) { const s = markerSurf[i]; return s.point.clone().addScaledVector(s.normal, SPHERE_R + 0.5); },

    // --- 見回し ---
    look: {
      state: look,
      drag(dx, dy) {
        look.tYaw = THREE.MathUtils.clamp(look.tYaw + dx * 0.0022, -0.55, 0.55);
        look.tPitch = THREE.MathUtils.clamp(look.tPitch + dy * 0.0022, -0.3, 0.34);
      },
      lean(delta) { look.tLean = THREE.MathUtils.clamp(look.tLean + delta, -220, 330); },
      reset() { look.tYaw = 0; look.tPitch = 0; look.tLean = 0; },
      isDefault() { return Math.abs(look.tYaw) + Math.abs(look.tPitch) < 0.01 && Math.abs(look.tLean) < 1; },
    },

    // --- 手 ---
    hand: {
      state: handState,
      show(v, { from = null } = {}) {
        if (v && !handState.visible) {
          handState.pos.copy(from || handState.target);
        }
        handState.visible = v;
      },
      setTarget(v, immediate = false) { handState.target.copy(v); if (immediate) handState.pos.copy(v); },
      setOk(v) { handState.okTarget = v; },
      setFollow(k) { handState.follow = k; },
      /** 指先（球を持つ位置）の現在位置 */
      tip() { return handState.pos; },
      /** 画面外（右下）の手の待機位置 */
      offscreen(target) {
        camera.matrixWorld.extractBasis(camRight, camUp, camBack);
        return target.clone().addScaledVector(camRight, 330).addScaledVector(camUp, -260).addScaledVector(camBack, 260);
      },
    },
    sparkle,

    // --- 球 ---
    spheres: {
      show(i, pos) {
        const s = spheres[i];
        if (!s.g.visible) { s.pop = 0; s.g.visible = true; }
        s.g.position.copy(pos);
      },
      move(i, pos) { spheres[i].g.position.copy(pos); },
      pos(i) { return spheres[i].g.position; },
      visible(i) { return spheres[i].g.visible; },
      setPhase(i, phase) {
        const s = spheres[i];
        if (phase === 'confirmed' && s.phase !== 'confirmed') s.t0 = performance.now();
        s.phase = phase;
        s.mat.emissiveIntensity = phase === 'carry' ? 0.75 : 0.55;
      },
      hide(i) { spheres[i].g.visible = false; spheres[i].phase = 'none'; },
      hideAll() { for (let i = 0; i < spheres.length; i++) api.spheres.hide(i); },
      ripple(i) {
        const s = spheres[i];
        const n = new THREE.Vector3();
        const hit = markerSurf[i];
        // 球の位置での体表法線（近似: いちばん近いマーカの法線）
        n.copy(hit.normal);
        ripple(s.g.position, n, MARKERS[i].color);
      },
    },
    setGuide(i) { guide.index = i; if (i >= 0) guide.mat.color.set(MARKERS[i].color); },
    setTriangle(on) {
      tri.on = on;
      if (on) {
        const a = tri.geo.attributes.position;
        for (let i = 0; i < 4; i++) { const p = spheres[i % 3].g.position; a.setXYZ(i, p.x, p.y, p.z); }
        a.needsUpdate = true;
        tri.line.computeLineDistances();
        tri.line.visible = true;
      }
    },

    // --- 3D モデル ---
    holo: {
      get model() { return holo.model; },
      get state() { return holo.state; },
      setOps(ops) { holo.ops = { ...ops }; applyHoloOpacity(); },
      getOps() { return holo.ops; },
      setShown(v) { holo.shown = v; },
      /** 浮かんだ状態で出現（位置合わせ前） */
      appear() { holo.state = 'float'; holo.fade = 0; holo.fadeTarget = 1; holo.grab.set(0, 0, 0); holo.grabYaw = 0; applyHoloOpacity(); },
      hide() { holo.fadeTarget = 0; setTimeout(() => { if (holo.fadeTarget === 0) holo.state = 'hidden'; }, 600); },
      hideNow() { holo.state = 'hidden'; holo.fade = 0; holo.fadeTarget = 0; applyHoloOpacity(); },
      /** 位置合わせ（浮かんだ位置 → 体表へ）。完了で resolve */
      align(matrix, ms = 1700) {
        holo.finalMatrix.copy(matrix ? matrix.clone().multiply(canonMatrix) : canonMatrix);
        holo.grab.set(0, 0, 0); holo.grabYaw = 0;
        holo.fadeTarget = 1;
        if (holo.state === 'hidden') { holo.state = 'float'; holo.fade = 0.2; }
        holo.state = 'aligning';
        holo.alignT0 = performance.now();
        holo.alignMs = ms;
        return new Promise((resolve) => { holo.alignResolve = resolve; });
      },
      /** すぐに位置合わせ済みの状態にする */
      alignNow(matrix) {
        holo.finalMatrix.copy(matrix ? matrix.clone().multiply(canonMatrix) : canonMatrix);
        holo.state = 'aligned'; holo.fade = 1; holo.fadeTarget = 1; holo.grab.set(0, 0, 0); holo.grabYaw = 0;
        applyHoloOpacity();
      },
      setGrab(v, yaw = 0) { holo.grab.copy(v); holo.grabYaw = yaw; },
      getGrab() { return { v: holo.grab.clone(), yaw: holo.grabYaw }; },
      /** 浮かんでいるモデルの中心（ラベル表示用） */
      center() { const p = new THREE.Vector3(); holoRoot.matrix.decompose(p, tmpQ, finS); return p; },
      scan: startScan,
    },

    /** 3 点（ワールド座標）から位置合わせの変換を求める */
    registration(points) {
      const src = markerSurf.map((s, i) => api.sphereTarget(i));
      return rigidFrom3(src, points) || new THREE.Matrix4();
    },

    // --- 関心領域・ライン ---
    setRoiLine(circles, lineIn) {
      for (const c of [...roiGroup.children]) {
        roiGroup.remove(c);
        c.traverse((o) => { if (o.isMesh) { if (o.userData.ownGeometry) o.geometry.dispose(); o.material.dispose(); } });
      }
      let has = false;
      if (circles?.length) {
        const r = buildRoiGeometry(circles);
        if (r) {
          // 関心領域はモデルの手前に重ねて描く（肺や肋骨に隠れないように）
          const mat = new THREE.MeshStandardMaterial({ color: '#ff8a1f', emissive: '#ff6a00', emissiveIntensity: 0.6, roughness: 0.4, transparent: true, opacity: 0.78, depthWrite: false, depthTest: false });
          const m = ownMesh(r.geometry, mat);
          m.renderOrder = 30;
          roiGroup.add(m);
          const glow = new THREE.Mesh(r.geometry, new THREE.MeshBasicMaterial({ color: '#ff9a3c', transparent: true, opacity: 0.35, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, side: THREE.BackSide }));
          glow.scale.setScalar(1.0);
          glow.renderOrder = 29;
          roiGroup.add(glow);
          has = true;
        }
      }
      const L = lineIn?.start && lineIn?.end ? computeLine(lineIn.start, lineIn.end) : null;
      if (L) {
        const a = toWorld(L.ext), b = toWorld(L.end);
        const rod = (radius, mat) => {
          const len = a.distanceTo(b);
          const g = new THREE.CylinderGeometry(radius, radius, len, 16, 1, false);
          const m = ownMesh(g, mat);
          m.position.copy(a).add(b).multiplyScalar(0.5);
          m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
          m.renderOrder = 32;
          return m;
        };
        roiGroup.add(rod(1.4, new THREE.MeshBasicMaterial({ color: '#d9fbff', transparent: true, opacity: 0.95, depthWrite: false, depthTest: false })));
        roiGroup.add(rod(4.2, new THREE.MeshBasicMaterial({ color: '#3ee0ff', transparent: true, opacity: 0.3, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending })));
        const dot = (p, r, color) => {
          const m = ownMesh(new THREE.SphereGeometry(r, 20, 14), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, depthWrite: false, depthTest: false }));
          m.position.copy(toWorld(p));
          m.renderOrder = 33;
          return m;
        };
        roiGroup.add(dot(L.end, 3.6, '#3ee0ff'));
        if (L.skin) roiGroup.add(dot(L.skin, 3.0, '#ffffff'));
        has = true;
      }
      return has;
    },
    setRoiVisible(v) { roiGroup.visible = v; },

    // --- ミラーリング ---
    setMirror(canvas) {
      mirror = canvas ? { canvas, ctx: canvas.getContext('2d'), every: 2 } : null;
    },

    dispose() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      frameCbs.clear();
      if (holo.alignResolve) { holo.alignResolve = null; }
      for (const sc of [room, virt]) {
        sc.traverse((o) => {
          if ((o.isMesh || o.isLine || o.isPoints || o.isSprite) && o.userData.ownGeometry) o.geometry?.dispose();
        });
      }
      holo.model?.dispose();
      hand.dispose();
      sparkle.dispose();
      roomBuilt.dispose();
      for (const m of ownMaterials) m.dispose();
      for (const t of ownTextures) t.dispose();
      rippleGeo.dispose();
      roiGroup.traverse((o) => { if (o.isMesh) o.material.dispose(); });
      renderer.dispose();
      renderer.forceContextLoss?.();
      renderer.domElement.remove();
    },
  };
  return api;
}
