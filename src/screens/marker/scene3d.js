// =============================================================================
// マーカ確認: 3D 表示
// ・体表（フレネルの半透明）＋ 骨・肺・心臓（淡く）
// ・自動認識した 3 点のマーカを黄色でハイライト（ラベル・引き出し線つき）
// ・「検出中」の走査アニメーション（体表を走るスキャン帯＋走査リング）
// ・置き直しモード: 体表へのレイキャストで位置を指定（ホバー中はプレビュー球）
// ・側臥位のデータは、モデルを体軸まわりに回転させた状態で表示
// =============================================================================
import * as THREE from 'three';
import { createViewer } from '../../three/viewer.js';
import { getAnatomyGeometries, createAnatomyModel, toWorld, toPatient } from '../../three/meshing.js';
import { BODY_Z, MARKER_RADIUS } from '../../data/phantom.js';
import { h, svg } from '../../ui/dom.js';
import { skinNormal } from './geom.js';

const YELLOW = new THREE.Color('#ffd400');
const CANDIDATE = new THREE.Color('#dff1ff');
const GHOST = new THREE.Color('#a9b6cc');
const SCAN = new THREE.Color('#57d0ff');

/** 3D 表示の表示切替（チップ） */
export const LAYERS = [
  { id: 'skin', name: '体表', members: ['skin'] },
  { id: 'bone', name: '骨', members: ['rib', 'cartilage', 'sternum', 'clavicle', 'spine'] },
  { id: 'lung', name: '肺', members: ['lung_r', 'lung_l', 'trachea', 'bronchus'] },
  { id: 'heart', name: '心臓', members: ['heart'] },
];
const INCLUDE = LAYERS.flatMap((l) => l.members);
const OPACITY = {
  lung_r: 0.13, lung_l: 0.13, trachea: 0.26, bronchus: 0.2, heart: 0.22,
  rib: 0.3, cartilage: 0.24, sternum: 0.3, clavicle: 0.4, spine: 0.22,
};

const SKIN_VS = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
varying float vH;
void main() {
  vH = position.y;
  vN = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;
const SKIN_FS = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uRim;
uniform vec3 uScanColor;
uniform float uOpacity;
uniform float uScanY;
uniform float uScanAmt;
varying vec3 vN;
varying vec3 vV;
varying float vH;
void main() {
  float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.4);
  float band = uScanAmt * exp(-pow((vH - uScanY) / 3.2, 2.0));
  float trail = uScanAmt * 0.22 * smoothstep(uScanY, uScanY + 70.0, vH) * (1.0 - smoothstep(uScanY + 70.0, uScanY + 200.0, vH));
  float a = uOpacity * (0.32 + 1.25 * f);
  vec3 col = mix(uColor, uRim, f);
  col += uScanColor * (band * 1.6 + trail);
  a = clamp(a + band * 0.9 + trail * 0.35, 0.0, 1.0);
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}`;

function canvasTexture(w, hgt, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = hgt;
  draw(c.getContext('2d'), w, hgt);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const glowTexture = () => canvasTexture(128, 128, (g, s) => {
  const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.16, 'rgba(255,255,255,0.75)');
  grad.addColorStop(0.42, 'rgba(255,255,255,0.18)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
});
/** 走査面（CT のスライス面に見立てた円盤） */
const scanDiscTexture = () => canvasTexture(256, 256, (g, s) => {
  const c = s / 2;
  const grad = g.createRadialGradient(c, c, c * 0.15, c, c, c);
  grad.addColorStop(0, 'rgba(87,208,255,0.0)');
  grad.addColorStop(0.7, 'rgba(87,208,255,0.10)');
  grad.addColorStop(0.93, 'rgba(140,225,255,0.45)');
  grad.addColorStop(0.97, 'rgba(200,240,255,0.9)');
  grad.addColorStop(1, 'rgba(200,240,255,0)');
  g.fillStyle = grad;
  g.beginPath(); g.arc(c, c, c, 0, Math.PI * 2); g.fill();
  g.strokeStyle = 'rgba(180,235,255,0.7)';
  g.lineWidth = 1.5;
  for (let i = 0; i < 72; i++) {
    const a = (i / 72) * Math.PI * 2;
    const r0 = c * 0.84, r1 = c * (i % 6 === 0 ? 0.9 : 0.87);
    g.beginPath(); g.moveTo(c + Math.cos(a) * r0, c + Math.sin(a) * r0); g.lineTo(c + Math.cos(a) * r1, c + Math.sin(a) * r1); g.stroke();
  }
});

const ease = (u) => (u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2);
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const Y_AXIS = new THREE.Vector3(0, 1, 0);

/**
 * @param {HTMLElement} host .three-host
 * @param {{markers: Array<{id:string,name:string,pos:number[]}>, position?: 'supine'|'right'|'left',
 *          onPick?:(i:number)=>void, onPlace?:(p:number[])=>void, onReady?:()=>void, labelText?:(i:number)=>string}} opts
 */
export function createMarkerScene(host, opts) {
  const viewer = createViewer(host, { background: null, fov: 30, near: 5, far: 8000 });
  const { scene, camera, controls } = viewer;
  controls.minDistance = 220;
  controls.maxDistance = 2400;
  controls.enablePan = true;

  const root = new THREE.Group();
  root.name = 'patient';
  const rotY = opts.position === 'right' ? -Math.PI / 2 : opts.position === 'left' ? Math.PI / 2 : 0;
  root.rotation.y = rotY;
  scene.add(root);
  root.updateMatrixWorld(true);

  const textures = [];
  const extraMaterials = [];
  const glowTex = glowTexture(); textures.push(glowTex);

  // ---------------------------------------------------------------------
  // カメラ（コンテナの縦横比に合わせて全身が収まる距離）
  // ---------------------------------------------------------------------
  const TARGET = new THREE.Vector3(0, 6, 0);
  // 側臥位では、回転した前面（マーカのある側）が少し見える斜めの視点にする
  const VIEW_DIR = new THREE.Vector3(rotY < 0 ? -0.42 : rotY > 0 ? 0.42 : 0.2, 0.1, 1).normalize();
  function fitDistance() {
    const aspect = Math.max(0.3, host.clientWidth / Math.max(1, host.clientHeight));
    const tv = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    return Math.max(236 / tv, 220 / (tv * aspect));
  }
  const homePos = () => TARGET.clone().addScaledVector(VIEW_DIR, fitDistance());
  /** 患者の前面（腹側）から見る位置 */
  function frontPos() {
    const ant = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), rotY);
    const side = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), rotY);
    const dir = ant.multiplyScalar(1).addScaledVector(side, 0.12).add(new THREE.Vector3(0, 0.1, 0)).normalize();
    return TARGET.clone().addScaledVector(dir, fitDistance());
  }
  camera.position.copy(homePos());
  controls.target.copy(TARGET);
  controls.update();

  // ---------------------------------------------------------------------
  // 解剖モデル
  // ---------------------------------------------------------------------
  let model = null;
  let skinMesh = null;
  const skinMat = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color('#e9b796') },
      uRim: { value: new THREE.Color('#ffe6d2') },
      uScanColor: { value: SCAN.clone() },
      uOpacity: { value: 0.2 },
      uScanY: { value: -9999 },
      uScanAmt: { value: 0 },
    },
    vertexShader: SKIN_VS,
    fragmentShader: SKIN_FS,
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
  });

  const layerState = new Map();
  function applyLayer(id, on) {
    const l = LAYERS.find((x) => x.id === id);
    if (!l || !model) return;
    for (const m of l.members) model.setVisible(m, on);
  }
  let disposed = false;
  const ready = getAnatomyGeometries().then((geoms) => {
    if (disposed) return;
    model = createAnatomyModel(geoms, { include: INCLUDE, opacity: OPACITY });
    skinMesh = model.meshes.get('skin');
    if (skinMesh) {
      skinMesh.material.dispose();
      skinMesh.material = skinMat;
      skinMesh.renderOrder = 10;
    }
    for (const [id, on] of layerState) applyLayer(id, on);
    root.add(model.group);
    opts.onReady?.();
  });

  // ---------------------------------------------------------------------
  // 走査（CT の走査面に見立てたリング＋円盤）
  // ---------------------------------------------------------------------
  const scanGroup = new THREE.Group();
  scanGroup.visible = false;
  const discTex = scanDiscTexture(); textures.push(discTex);
  const disc = new THREE.Mesh(new THREE.CircleGeometry(222, 96), new THREE.MeshBasicMaterial({
    map: discTex, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, opacity: 0.9,
  }));
  disc.rotation.x = -Math.PI / 2;
  disc.userData.ownGeometry = true;
  disc.renderOrder = 12;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(222, 1.5, 8, 160), new THREE.MeshBasicMaterial({
    color: SCAN, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  ring.rotation.x = -Math.PI / 2;
  ring.userData.ownGeometry = true;
  scanGroup.add(disc, ring);
  root.add(scanGroup);
  let scan = null; // { t0, ms, from, to, passed:Set, onPass, resolve }

  // ---------------------------------------------------------------------
  // マーカ
  // ---------------------------------------------------------------------
  const sphereGeo = new THREE.SphereGeometry(MARKER_RADIUS + 0.9, 28, 18);
  const ringGeo = new THREE.RingGeometry(9.5, 11.2, 64);
  const pulseGeo = new THREE.RingGeometry(10, 11.6, 64);

  function makeMarkerObject() {
    const g = new THREE.Group();
    const core = new THREE.Mesh(sphereGeo, new THREE.MeshStandardMaterial({
      color: YELLOW, emissive: YELLOW, emissiveIntensity: 0.75, roughness: 0.3, metalness: 0, transparent: true, toneMapped: false,
    }));
    core.userData.ownGeometry = true;
    core.renderOrder = 4;
    const haloMat = new THREE.SpriteMaterial({ map: glowTex, color: YELLOW, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.6 });
    extraMaterials.push(haloMat);
    const halo = new THREE.Sprite(haloMat);
    halo.scale.set(44, 44, 1);
    halo.renderOrder = 20;
    const flat = new THREE.Group(); // 体表に沿った面（リング類）
    const ringM = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: YELLOW, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }));
    ringM.userData.ownGeometry = true;
    ringM.renderOrder = 15;
    const pulse = new THREE.Mesh(pulseGeo, new THREE.MeshBasicMaterial({ color: YELLOW, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }));
    pulse.userData.ownGeometry = true;
    pulse.renderOrder = 16;
    flat.add(ringM, pulse);
    g.add(core, halo, flat);
    root.add(g);
    return { g, core, halo, haloMat, flat, ring: ringM, pulse };
  }

  function orient(obj, pos) {
    obj.g.position.copy(toWorld(pos));
    const n = skinNormal(pos);
    const nw = toWorld(n).normalize();
    obj.normal = nw;
    obj.flat.quaternion.setFromUnitVectors(Z_AXIS, nw);
    // リングは体表の高さ（球の中心から少し内側）に置く
    obj.flat.position.copy(nw).multiplyScalar(-(MARKER_RADIUS - 1.2));
  }

  const marks = opts.markers.map((m) => {
    const o = makeMarkerObject();
    o.state = 'hidden';
    o.selected = false;
    o.blink = 0;
    o.pulseT = -1;
    o.flash = 0;
    orient(o, m.pos);
    o.g.visible = false;
    return o;
  });

  // ホバー時のプレビュー（置き直しモード）
  const preview = makeMarkerObject();
  preview.g.visible = false;
  preview.core.material.opacity = 0.7;
  preview.ring.material.opacity = 0.7;
  let placing = -1;
  let hoverPending = null;
  let hoverHit = null;

  function applyState(o) {
    const s = o.state;
    o.g.visible = s !== 'hidden';
    const col = s === 'candidate' ? CANDIDATE : s === 'ghost' ? GHOST : YELLOW;
    o.core.material.color.copy(col);
    o.core.material.emissive.copy(col);
    o.core.material.emissiveIntensity = s === 'ghost' ? 0.25 : s === 'candidate' ? 0.9 : 0.75;
    o.core.material.opacity = s === 'ghost' ? 0.6 : 1;
    o.haloMat.color.copy(col);
    o.ring.material.color.copy(col);
    o.ring.visible = s === 'detected' || s === 'ghost';
    o.ring.material.opacity = s === 'ghost' ? 0.5 : 0.95;
    o.pulse.material.color.copy(col);
  }

  // ---------------------------------------------------------------------
  // ラベル（HTML オーバーレイ）と引き出し線
  // ---------------------------------------------------------------------
  const leaders = svg('svg', { class: 'mk3d-leaders', 'aria-hidden': 'true' });
  const labelLayer = h('div', { class: 'mk3d-labels' });
  const lines = marks.map(() => { const l = svg('line', {}); leaders.appendChild(l); return l; });
  const labels = opts.markers.map((m, i) => {
    const el = h('button', {
      class: 'mk3d-label', type: 'button', tabindex: '-1',
      onclick: (e) => { e.stopPropagation(); opts.onPick?.(i); },
    }, h('span', { class: 'mk3d-label-num' }, String(i + 1)), h('span', { class: 'mk3d-label-text' }, m.name));
    labelLayer.appendChild(el);
    return el;
  });
  const previewLabel = h('div', { class: 'mk3d-label is-preview' }, h('span', { class: 'mk3d-label-text' }));
  labelLayer.appendChild(previewLabel);
  host.append(leaders, labelLayer);

  const vTmp = new THREE.Vector3();
  const vCam = new THREE.Vector3();
  function screenOf(local) {
    vTmp.copy(local);
    root.localToWorld(vTmp);
    return viewer.project(vTmp);
  }
  const CENTER_LOCAL = new THREE.Vector3(0, 30, 0);
  const labelW = new Map();
  const widthOf = (el) => {
    let w = labelW.get(el);
    if (!w) { w = el.offsetWidth; if (w) labelW.set(el, w); }
    return w || 120;
  };
  function updateLabels() {
    const c = screenOf(CENTER_LOCAL);
    const W = host.clientWidth, H = host.clientHeight;
    const items = [];
    marks.forEach((o, i) => {
      const el = labels[i];
      const show = o.state === 'detected' || (o.state === 'ghost' && i === placing);
      const p = show && o.g.visible ? screenOf(o.g.position) : null;
      if (!p || p.behind) {
        el.classList.remove('is-shown');
        lines[i].setAttribute('opacity', '0');
        return;
      }
      let dx = p.x - c.x, dy = p.y - c.y;
      const len = Math.hypot(dx, dy);
      if (len < 24) { dx = 0; dy = 1; } else { dx /= len; dy /= len; }
      // 上半身のマーカは上方向へ寄せる
      if (o.g.position.y > 60) dy = Math.min(dy, -0.55);
      const dl = Math.hypot(dx, dy); dx /= dl; dy /= dl;
      const dist = 62;
      items.push({ o, i, el, p, dx, dy, lx: p.x + dx * dist, ly: p.y + dy * dist, w: widthOf(el) });
    });
    // ラベル同士の重なりを上下にずらして解消
    for (let iter = 0; iter < 4; iter++) {
      for (let a = 0; a < items.length; a++) {
        for (let b = a + 1; b < items.length; b++) {
          const A = items[a], B = items[b];
          const ox = (A.w + B.w) / 2 + 8 - Math.abs(A.lx - B.lx);
          const oy = 30 - Math.abs(A.ly - B.ly);
          if (ox > 0 && oy > 0) {
            const up = A.ly <= B.ly ? A : B, dn = up === A ? B : A;
            up.ly -= oy / 2; dn.ly += oy / 2;
          }
        }
      }
    }
    for (const it of items) {
      const { o, i, el, p, dx, dy } = it;
      // 上端（表示切替のツールバー）と下端（凡例）にかからないように
      const lx = Math.max(it.w / 2 + 8, Math.min(W - it.w / 2 - 8, it.lx));
      const ly = Math.max(60, Math.min(H - 48, it.ly));
      el.style.transform = `translate(${lx.toFixed(1)}px, ${ly.toFixed(1)}px) translate(-50%, -50%)`;
      el.classList.add('is-shown');
      el.classList.toggle('is-selected', o.selected);
      el.classList.toggle('is-ghost', o.state === 'ghost');
      // 背面にあるときは薄く
      vCam.copy(camera.position).sub(root.localToWorld(vTmp.copy(o.g.position)));
      const nWorld = vTmp.copy(o.normal).applyAxisAngle(Y_AXIS, rotY);
      const facing = nWorld.dot(vCam.normalize()) > -0.05;
      el.classList.toggle('is-back', !facing);
      const l = lines[i];
      l.setAttribute('x1', (p.x + dx * 9).toFixed(1));
      l.setAttribute('y1', (p.y + dy * 9).toFixed(1));
      l.setAttribute('x2', lx.toFixed(1));
      l.setAttribute('y2', ly.toFixed(1));
      l.setAttribute('opacity', facing ? (o.state === 'ghost' ? '0.45' : '0.85') : '0.3');
      l.setAttribute('class', o.state === 'ghost' ? 'is-ghost' : o.selected ? 'is-selected' : '');
    }
    // プレビュー
    if (placing >= 0 && preview.g.visible) {
      const p = screenOf(preview.g.position);
      previewLabel.style.transform = `translate(${(p.x + 16).toFixed(1)}px, ${(p.y - 16).toFixed(1)}px) translate(0, -100%)`;
      previewLabel.classList.add('is-shown');
    } else {
      previewLabel.classList.remove('is-shown');
    }
  }

  // ---------------------------------------------------------------------
  // 毎フレームの更新
  // ---------------------------------------------------------------------
  viewer.onFrame((dt, t) => {
    const now = performance.now();
    // 走査
    if (scan) {
      const u = Math.min(1, (now - scan.t0) / scan.ms);
      const y = scan.from + (scan.to - scan.from) * ease(u);
      scanGroup.position.y = y;
      const fade = Math.min(1, u / 0.08, (1 - u) / 0.1);
      disc.material.opacity = 0.9 * fade;
      ring.material.opacity = 0.85 * fade;
      skinMat.uniforms.uScanY.value = y;
      skinMat.uniforms.uScanAmt.value = fade;
      opts.markers.forEach((m, i) => {
        if (!scan.passed.has(i) && y <= marks[i].g.position.y) { scan.passed.add(i); scan.onPass?.(i); }
      });
      if (u >= 1) {
        scanGroup.visible = false;
        skinMat.uniforms.uScanAmt.value = 0;
        const r = scan.resolve; scan = null; r();
      }
    }
    // マーカ
    for (const o of marks) {
      if (!o.g.visible) continue;
      const breathe = 0.5 + 0.5 * Math.sin(t * 3.2);
      if (o.state === 'candidate') {
        o.flash = Math.max(0, o.flash - dt * 1.6);
        o.haloMat.opacity = 0.35 + 0.6 * o.flash;
        const s = 30 + 40 * o.flash; o.halo.scale.set(s, s, 1);
      } else if (o.state === 'ghost') {
        o.haloMat.opacity = 0;
      } else {
        o.haloMat.opacity = (o.selected ? 0.75 : 0.5) + 0.2 * breathe;
        const s = (o.selected ? 52 : 40) + 6 * breathe; o.halo.scale.set(s, s, 1);
      }
      // 点滅（検出 → 確定）
      if (o.blink > 0) {
        o.blink = Math.max(0, o.blink - dt);
        o.core.visible = Math.floor(o.blink / 0.11) % 2 === 0;
        o.halo.visible = o.core.visible;
        if (o.blink === 0) { o.core.visible = true; o.halo.visible = true; }
      }
      // 広がるリング
      if (o.pulseT >= 0) {
        o.pulseT += dt;
        const u = o.pulseT / 0.95;
        if (u >= 1) { o.pulseT = o.selected && o.state === 'detected' ? -0.65 : -1; o.pulse.material.opacity = 0; }
        else if (u >= 0) {
          const s = 1 + u * 2.4;
          o.pulse.scale.set(s, s, 1);
          o.pulse.material.opacity = 0.9 * (1 - u);
        }
      } else if (o.pulseT < -0.001 && o.pulseT > -1) {
        o.pulseT += dt;
        if (o.pulseT >= 0) o.pulseT = 0;
      }
      const sc = o.selected ? 1.18 + 0.06 * breathe : 1;
      o.core.scale.setScalar(sc);
    }
    // プレビュー（置き直し）
    if (hoverPending && placing >= 0) {
      const { x, y } = hoverPending;
      hoverPending = null;
      hoverHit = pickSkin(x, y);
      if (hoverHit) {
        preview.g.visible = true;
        orient(preview, hoverHit.markerPos);
      } else preview.g.visible = false;
    }
    if (preview.g.visible) {
      const b = 0.5 + 0.5 * Math.sin(t * 6);
      preview.haloMat.opacity = 0.35 + 0.35 * b;
      preview.core.material.opacity = 0.55 + 0.3 * b;
    }
    updateLabels();
  });

  // ---------------------------------------------------------------------
  // ポインタ操作（クリックの判定はドラッグと区別する）
  // ---------------------------------------------------------------------
  function pickSkin(clientX, clientY) {
    if (!skinMesh) return null;
    const rc = viewer.raycaster(clientX, clientY);
    const hits = rc.intersectObject(skinMesh, false);
    if (!hits.length) return null;
    const local = root.worldToLocal(hits[0].point.clone());
    const p = toPatient(local);
    const n = skinNormal(p);
    const off = MARKER_RADIUS - 0.5;
    return { patient: p, markerPos: [p[0] + n[0] * off, p[1] + n[1] * off, p[2] + n[2] * off] };
  }
  const canvas = viewer.renderer.domElement;
  let down = null;
  const ac = new AbortController();
  const sig = { signal: ac.signal };
  canvas.addEventListener('pointerdown', (e) => {
    down = { x: e.clientX, y: e.clientY, t: performance.now(), button: e.button };
  }, sig);
  canvas.addEventListener('pointermove', (e) => {
    if (placing < 0) return;
    if (e.buttons) { preview.g.visible = false; return; }
    hoverPending = { x: e.clientX, y: e.clientY };
  }, sig);
  canvas.addEventListener('pointerleave', () => { preview.g.visible = false; hoverPending = null; }, sig);
  canvas.addEventListener('pointerup', (e) => {
    const d = down; down = null;
    if (!d || d.button !== 0) return;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5 || performance.now() - d.t > 700) return;
    if (placing >= 0) {
      const hit = pickSkin(e.clientX, e.clientY);
      if (hit) opts.onPlace?.(hit.patient);
      else opts.onMiss?.();
      return;
    }
    // マーカの近くをクリックしたら選択
    const r = host.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    let best = -1, bd = 26;
    marks.forEach((o, i) => {
      if (o.state !== 'detected' || !o.g.visible) return;
      const p = screenOf(o.g.position);
      const dd = Math.hypot(p.x - mx, p.y - my);
      if (dd < bd) { bd = dd; best = i; }
    });
    if (best >= 0) opts.onPick?.(best);
  }, sig);

  // ---------------------------------------------------------------------
  // 公開 API
  // ---------------------------------------------------------------------
  return {
    viewer,
    ready,
    get isReady() { return !!model; },
    /** マーカの状態: 'hidden' | 'candidate' | 'detected' | 'ghost' */
    setState(i, s) {
      const o = marks[i];
      o.state = s;
      applyState(o);
      if (s === 'candidate') o.flash = 1;
    },
    setPos(i, pos) { orient(marks[i], pos); },
    blink(i, sec = 0.75) { marks[i].blink = sec; },
    pulse(i) { marks[i].pulseT = 0; },
    select(i) {
      marks.forEach((o, k) => {
        const was = o.selected;
        o.selected = k === i;
        if (o.selected && !was && o.state === 'detected') o.pulseT = 0;
      });
    },
    /** 体表を上から下へ走査する。マーカの高さを通過するたびに onPass(i) */
    scan(ms, onPass) {
      return new Promise((resolve) => {
        scanGroup.visible = true;
        scan = { t0: performance.now(), ms, from: BODY_Z[1] + 8, to: BODY_Z[0] + 20, passed: new Set(), onPass, resolve };
      });
    },
    /** 置き直しモード（i = 配置中のマーカ番号、-1 で終了） */
    setPlacing(i) {
      placing = i;
      preview.g.visible = false;
      hoverHit = null;
      canvas.style.cursor = i >= 0 ? 'crosshair' : '';
      if (i >= 0) previewLabel.querySelector('.mk3d-label-text').textContent = opts.labelText ? opts.labelText(i) : opts.markers[i].name;
    },
    setLayer(id, on) {
      layerState.set(id, on);
      applyLayer(id, on);
    },
    flyToMarker(i, ms = 900) {
      const o = marks[i];
      const p = root.localToWorld(o.g.position.clone());
      const n = o.normal.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), rotY);
      const dir = n.clone().add(new THREE.Vector3(0, 0.22, 0)).normalize();
      const dist = Math.max(430, fitDistance() * 0.55);
      const cam = p.clone().addScaledVector(dir, dist);
      // 体の中心側に少し寄せた点を注視（周囲の位置関係も見えるように）
      const tgt = p.clone().lerp(new THREE.Vector3(0, p.y, 0), 0.25);
      viewer.flyTo(cam.toArray(), tgt.toArray(), ms);
    },
    home(ms = 800) { viewer.flyTo(homePos().toArray(), TARGET.toArray(), ms); },
    front(ms = 800) { viewer.flyTo(frontPos().toArray(), TARGET.toArray(), ms); },
    screenPosOf(i) {
      const p = screenOf(marks[i].g.position);
      const r = host.getBoundingClientRect();
      return { x: r.left + p.x, y: r.top + p.y };
    },
    dispose() {
      disposed = true;
      ac.abort();
      if (scan) { const r = scan.resolve; scan = null; r(); }
      leaders.remove();
      labelLayer.remove();
      for (const m of extraMaterials) m.dispose();
      for (const t of textures) t.dispose();
      skinMat.dispose();
      model?.dispose();
      viewer.dispose();
    },
  };
}
