// =============================================================================
// 「はじめに」のヒーロー表示: ゆっくり回る胸部 3D モデル（合成ファントム）
// -----------------------------------------------------------------------------
// ・体表はフレネル（輪郭が光る）シェーダーで半透明に、臓器は通常の色で表示
// ・読み込み時は CT のガントリーが下から上へ走査して、モデルが組み上がる演出
// ・setStage(i) で 4 ステップに合わせて強調を切り替える
//     0: CTを撮る（走査リング）   1: マーカを確認する（3 点を強調＋ラベル）
//     2: 範囲をなぞる（関心領域）  3/4: そして見る（全体を表示）
// =============================================================================
import * as THREE from 'three';
import { createViewer } from '../../three/viewer.js';
import { getAnatomyGeometries, createAnatomyModel, toWorld } from '../../three/meshing.js';
import { MARKERS, NODULE, BODY_Z } from '../../data/phantom.js';
import { h } from '../../ui/dom.js';

const SKIN_VS = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
varying float vY;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vY = wp.y;
  vN = normalize(normalMatrix * normal);
  vec4 mv = viewMatrix * wp;
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;

const SKIN_FS = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uScanColor;
uniform float uIntensity;
uniform float uPower;
uniform float uScanY;
uniform float uScanAmt;
uniform float uReveal;
uniform float uTime;
uniform float uLines;
uniform vec2 uFade;
varying vec3 vN;
varying vec3 vV;
varying float vY;
void main() {
  if (vY > uReveal) discard;
  float fade = smoothstep(uFade.x, uFade.x + 60.0, vY) * (1.0 - smoothstep(uFade.y - 45.0, uFade.y, vY));
  float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), uPower);
  float lines = uLines * (0.5 + 0.5 * sin(vY * 0.9 - uTime * 1.6));
  float band = uScanAmt * exp(-pow((vY - uScanY) / 4.5, 2.0));
  float edge = exp(-pow((vY - uReveal) / 5.0, 2.0));
  float body = (f * uIntensity * (1.0 - 0.3 * lines) + 0.055 * uIntensity) * fade;
  vec3 col = uColor * body + uScanColor * (band + edge) * 1.2;
  float a = clamp(body + (band + edge) * 0.85, 0.0, 1.0);
  gl_FragColor = vec4(col, a);
}`;

function canvasTexture(size, draw) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function glowTexture() {
  return canvasTexture(128, (g, s) => {
    const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.18, 'rgba(255,255,255,0.65)');
    grad.addColorStop(0.45, 'rgba(255,255,255,0.16)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, s, s);
  });
}

/** 床の目盛りリング */
function floorTexture() {
  return canvasTexture(512, (g, s) => {
    const c = s / 2;
    const fade = g.createRadialGradient(c, c, 0, c, c, c);
    fade.addColorStop(0, 'rgba(74,163,255,0.22)');
    fade.addColorStop(0.55, 'rgba(74,163,255,0.06)');
    fade.addColorStop(1, 'rgba(74,163,255,0)');
    g.fillStyle = fade;
    g.fillRect(0, 0, s, s);
    g.strokeStyle = 'rgba(120,190,255,0.9)';
    const rings = [[0.30, 2.2, 0.9], [0.40, 1.2, 0.5], [0.62, 1.4, 0.45], [0.86, 1, 0.25]];
    for (const [r, w, a] of rings) {
      g.globalAlpha = a; g.lineWidth = w;
      g.beginPath(); g.arc(c, c, r * c, 0, Math.PI * 2); g.stroke();
    }
    // 目盛り
    g.globalAlpha = 0.7; g.lineWidth = 1.5;
    for (let i = 0; i < 120; i++) {
      const a = (i / 120) * Math.PI * 2;
      const r0 = 0.62 * c, r1 = (i % 10 === 0 ? 0.70 : 0.655) * c;
      g.beginPath(); g.moveTo(c + Math.cos(a) * r0, c + Math.sin(a) * r0); g.lineTo(c + Math.cos(a) * r1, c + Math.sin(a) * r1); g.stroke();
    }
    // 弧（アクセント）
    g.globalAlpha = 0.95; g.lineWidth = 4; g.strokeStyle = 'rgba(255,170,80,0.9)';
    g.beginPath(); g.arc(c, c, 0.4 * c, -0.5, 0.35); g.stroke();
    g.strokeStyle = 'rgba(120,200,255,1)';
    g.beginPath(); g.arc(c, c, 0.4 * c, 2.4, 3.6); g.stroke();
    g.globalAlpha = 1;
  });
}

/** 走査面（CT のスライス面） */
function sliceTexture() {
  return canvasTexture(256, (g, s) => {
    const c = s / 2;
    const grad = g.createRadialGradient(c, c, c * 0.2, c, c, c);
    grad.addColorStop(0, 'rgba(90,200,255,0.05)');
    grad.addColorStop(0.82, 'rgba(90,200,255,0.22)');
    grad.addColorStop(0.97, 'rgba(160,230,255,0.75)');
    grad.addColorStop(1, 'rgba(160,230,255,0)');
    g.fillStyle = grad;
    g.beginPath(); g.arc(c, c, c, 0, Math.PI * 2); g.fill();
    g.save();
    g.beginPath(); g.arc(c, c, c * 0.95, 0, Math.PI * 2); g.clip();
    g.strokeStyle = 'rgba(140,210,255,0.16)'; g.lineWidth = 1;
    for (let x = 0; x <= s; x += 16) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, s); g.stroke(); g.beginPath(); g.moveTo(0, x); g.lineTo(s, x); g.stroke(); }
    g.restore();
  });
}

const STAGES = {
  idle: { scan: 0, marker: 0.35, label: 0, roi: 0, view: 0.4 },
  0: { scan: 1, marker: 0.3, label: 0, roi: 0, view: 0 },
  1: { scan: 0, marker: 1, label: 1, roi: 0, view: 0 },
  2: { scan: 0, marker: 0.3, label: 0, roi: 1, view: 0 },
  3: { scan: 0, marker: 0.55, label: 0, roi: 0.45, view: 1 },
  4: { scan: 0, marker: 0.55, label: 0, roi: 0.45, view: 1 },
};

/**
 * @param {HTMLElement} host 描画先（position: relative）
 * @param {{signal: AbortSignal, onReady?: () => void}} opts
 */
export function createHeroVisual(host, { signal, onReady } = {}) {
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const coarse = window.matchMedia?.('(pointer: coarse)').matches;
  const viewer = createViewer(host, { background: null, fov: 24, cameraPos: [0, 150, 1240], target: [0, -2, 0], lights: 'studio' });
  const { scene, camera, renderer, controls } = viewer;
  renderer.localClippingEnabled = true;
  if (controls) {
    controls.enableZoom = false;
    controls.enablePan = false;
    controls.rotateSpeed = 0.45;
    controls.minPolarAngle = 1.0;
    controls.maxPolarAngle = 1.85;
    if (coarse) {
      controls.enabled = false;
      renderer.domElement.style.touchAction = 'pan-y';
    }
  }

  const textures = [];
  const extraMaterials = [];
  const track = (t) => { textures.push(t); return t; };
  const glowTex = track(glowTexture());

  const rig = new THREE.Group();
  scene.add(rig);

  // ---- 床のリング ----
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(820, 820),
    new THREE.MeshBasicMaterial({ map: track(floorTexture()), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, opacity: 0.85 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = BODY_Z[0] - 30;
  floor.userData.ownGeometry = true;
  scene.add(floor);

  // ---- CT ガントリー（走査リング）と走査面 ----
  const scanGroup = new THREE.Group();
  const gantryMat = new THREE.MeshBasicMaterial({ color: 0x7fd0ff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, opacity: 0.9 });
  const gantry = new THREE.Mesh(new THREE.TorusGeometry(228, 2.2, 10, 180), gantryMat);
  gantry.rotation.x = Math.PI / 2;
  gantry.userData.ownGeometry = true;
  const gantry2 = new THREE.Mesh(new THREE.TorusGeometry(240, 0.8, 6, 180), gantryMat);
  gantry2.rotation.x = Math.PI / 2;
  gantry2.userData.ownGeometry = true;
  const sliceMat = new THREE.MeshBasicMaterial({ map: track(sliceTexture()), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, opacity: 0.6, side: THREE.DoubleSide });
  const slice = new THREE.Mesh(new THREE.CircleGeometry(226, 96), sliceMat);
  slice.rotation.x = -Math.PI / 2;
  slice.userData.ownGeometry = true;
  scanGroup.add(gantry, gantry2, slice);
  scene.add(scanGroup);

  // ---- 浮遊する粒子 ----
  const PCOUNT = reduced ? 0 : 140;
  const pPos = new Float32Array(PCOUNT * 3);
  const pSpeed = new Float32Array(PCOUNT);
  for (let i = 0; i < PCOUNT; i++) {
    const a = Math.random() * Math.PI * 2, r = 170 + Math.random() * 190;
    pPos[i * 3] = Math.cos(a) * r;
    pPos[i * 3 + 1] = BODY_Z[0] - 20 + Math.random() * 420;
    pPos[i * 3 + 2] = Math.sin(a) * r;
    pSpeed[i] = 6 + Math.random() * 14;
  }
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  const particles = new THREE.Points(pGeo, new THREE.PointsMaterial({
    size: 7, map: glowTex, color: 0x6fb8ff, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, sizeAttenuation: true,
  }));
  particles.userData.ownGeometry = true;
  scene.add(particles);

  // ---- マーカ（3 点）と光輪 ----
  const markerGeo = new THREE.SphereGeometry(6, 24, 16);
  const markers = MARKERS.map((m, i) => {
    const color = new THREE.Color(m.color);
    const mesh = new THREE.Mesh(markerGeo, new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.9, roughness: 0.3, toneMapped: false }));
    mesh.userData.ownGeometry = i === 0;
    toWorld(m.pos, mesh.position);
    mesh.position.z += 2;
    const haloMat = new THREE.SpriteMaterial({ map: glowTex, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
    extraMaterials.push(haloMat);
    const halo = new THREE.Sprite(haloMat);
    halo.position.copy(mesh.position);
    rig.add(mesh, halo);
    return { def: m, mesh, halo, haloMat };
  });

  // ---- 関心領域（結節のまわり） ----
  const roiPos = toWorld(NODULE.c);
  const roiU = {
    uColor: { value: new THREE.Color('#ffc233') }, uScanColor: { value: new THREE.Color('#ffd27a') },
    uIntensity: { value: 0 }, uPower: { value: 1.6 }, uScanY: { value: -1e4 }, uScanAmt: { value: 0 },
    uReveal: { value: 1e4 }, uTime: { value: 0 }, uLines: { value: 0.6 }, uFade: { value: new THREE.Vector2(-1e4, 1e4) },
  };
  const roiMesh = new THREE.Mesh(new THREE.SphereGeometry(26, 40, 28), new THREE.ShaderMaterial({
    uniforms: roiU, vertexShader: SKIN_VS, fragmentShader: SKIN_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  roiMesh.position.copy(roiPos);
  roiMesh.userData.ownGeometry = true;
  roiMesh.renderOrder = 12;
  const roiHaloMat = new THREE.SpriteMaterial({ map: glowTex, color: 0xffb020, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, opacity: 0 });
  extraMaterials.push(roiHaloMat);
  const roiHalo = new THREE.Sprite(roiHaloMat);
  roiHalo.position.copy(roiPos);
  rig.add(roiMesh, roiHalo);

  // ---- マーカ名ラベル（HTML） ----
  const labelsLayer = h('div', { class: 'hero3d-labels', 'aria-hidden': 'true' });
  const labels = markers.map((m) => {
    const el = h('div', { class: 'hero3d-label' + (m.def.id === 'r_mcl' ? ' is-left' : '') }, h('i', { style: { background: m.def.color, boxShadow: `0 0 10px ${m.def.color}` } }), m.def.name);
    labelsLayer.appendChild(el);
    return el;
  });
  host.appendChild(labelsLayer);

  // ---- 解剖モデル（非同期で生成） ----
  let model = null;
  let skinU = null;
  let noduleMat = null;
  let disposed = false;
  const clip = new THREE.Plane(new THREE.Vector3(0, -1, 0), BODY_Z[0] - 30);
  const REVEAL_FROM = BODY_Z[0] - 20, REVEAL_TO = BODY_Z[1] + 20, REVEAL_MS = reduced ? 10 : 2200;
  let revealStart = 0;
  let revealDone = false;
  let scanT0 = 0;

  const startTimer = setTimeout(() => {
    getAnatomyGeometries().then((geoms) => {
      if (disposed || signal?.aborted) return;
      model = createAnatomyModel(geoms, {
        style: 'clinical',
        opacity: {
          lung_r: 0.3, lung_l: 0.3, liver: 0.3, stomach: 0.3, heart: 0.95,
          rib: 0.62, cartilage: 0.5, sternum: 0.7, clavicle: 0.8, spine: 0.85,
        },
      });
      for (const [id, mesh] of model.meshes) {
        if (id === 'skin') continue;
        mesh.material.clippingPlanes = [clip];
        // 暗い背景で沈まないよう、わずかに自己発光させる
        if (id !== 'nodule' && mesh.material.emissive) {
          mesh.material.emissive = mesh.material.color.clone();
          mesh.material.emissiveIntensity = id.startsWith('lung') ? 0.25 : 0.1;
        }
      }
      noduleMat = model.meshes.get('nodule')?.material || null;
      // 体表はフレネルシェーダーに置き換え
      const skin = model.meshes.get('skin');
      if (skin) {
        skin.material.dispose();
        skinU = {
          uColor: { value: new THREE.Color('#4aa8ff') }, uScanColor: { value: new THREE.Color('#9fe6ff') },
          uIntensity: { value: 1 }, uPower: { value: 2.4 }, uScanY: { value: REVEAL_FROM }, uScanAmt: { value: 1 },
          uReveal: { value: REVEAL_FROM }, uTime: { value: 0 }, uLines: { value: 0.5 },
          uFade: { value: new THREE.Vector2(BODY_Z[0] - 10, BODY_Z[1] + 6) },
        };
        skin.material = new THREE.ShaderMaterial({
          uniforms: skinU, vertexShader: SKIN_VS, fragmentShader: SKIN_FS,
          transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
        });
        skin.renderOrder = 10;
      }
      rig.add(model.group);
      revealStart = performance.now();
      host.classList.add('is-ready');
      onReady?.();
    }).catch((e) => { if (!disposed) console.error(e); });
  }, 320);

  // ---- 強調の状態 ----
  const amt = { ...STAGES.idle };
  let goal = { ...STAGES.idle };
  const tmp = new THREE.Vector3();

  viewer.onFrame((dt, t) => {
    // 目標値へなめらかに近づける
    const k = 1 - Math.exp(-dt * 3.5);
    for (const key in amt) amt[key] += (goal[key] - amt[key]) * k;

    // ゆっくり回転（正面寄りで往復）
    rig.rotation.y = reduced ? 0.25 : Math.sin(t * 0.19) * 0.68 + Math.sin(t * 0.07) * 0.12;
    floor.rotation.z = t * 0.05;

    // 組み上げ（下 → 上へ走査）
    let revealY = REVEAL_FROM;
    let scanY, scanAmt;
    if (model && !revealDone) {
      const u = Math.min(1, (performance.now() - revealStart) / REVEAL_MS);
      const e = 1 - Math.pow(1 - u, 2.2);
      revealY = REVEAL_FROM + (REVEAL_TO - REVEAL_FROM) * e;
      if (u >= 1) { revealDone = true; scanT0 = t; revealY = 1e4; }
      scanY = Math.min(revealY, REVEAL_TO);
      scanAmt = 1;
    } else if (model) {
      revealY = 1e4;
      const mid = (BODY_Z[0] + BODY_Z[1]) / 2 + 10, amp = (BODY_Z[1] - BODY_Z[0]) / 2 - 22;
      scanY = mid + amp * Math.cos((t - scanT0) * 0.75);
      scanAmt = amt.scan;
    } else {
      // 生成待ち: リングだけ上下に動かす
      scanY = Math.sin(t * 1.2) * 120;
      scanAmt = 1;
    }
    clip.constant = revealY;
    scanGroup.position.y = scanY;
    gantryMat.opacity = 0.95 * scanAmt;
    sliceMat.opacity = 0.55 * scanAmt;
    scanGroup.visible = scanAmt > 0.01;
    const gs = 1 + 0.015 * Math.sin(t * 6);
    gantry.scale.set(gs, gs, 1);

    if (skinU) {
      skinU.uTime.value = t;
      skinU.uReveal.value = revealY;
      skinU.uScanY.value = scanY;
      skinU.uScanAmt.value = scanAmt;
      skinU.uIntensity.value = 0.95 + 0.75 * amt.view;
      skinU.uLines.value = 0.35 + 0.45 * amt.view;
    }

    // 粒子
    if (PCOUNT) {
      for (let i = 0; i < PCOUNT; i++) {
        let y = pPos[i * 3 + 1] + pSpeed[i] * dt;
        if (y > BODY_Z[1] + 60) y = BODY_Z[0] - 30;
        pPos[i * 3 + 1] = y;
      }
      pGeo.attributes.position.needsUpdate = true;
    }

    // マーカ: 強調時は順に脈動
    const showMarkers = model && revealY > -1e3 ? 1 : 0;
    markers.forEach((m, i) => {
      const visible = revealDone || (model && m.mesh.position.y < revealY);
      m.mesh.visible = !!visible;
      m.halo.visible = !!visible;
      const pulse = 0.5 + 0.5 * Math.sin(t * 4.2 - i * 1.3);
      const s = 22 + 26 * amt.marker + 16 * amt.marker * pulse;
      m.halo.scale.set(s, s, 1);
      m.haloMat.opacity = (0.35 + 0.6 * amt.marker) * showMarkers;
      m.mesh.material.emissiveIntensity = 0.6 + 0.8 * amt.marker * pulse;
      const ms = 1 + 0.35 * amt.marker;
      m.mesh.scale.setScalar(ms);
    });

    // 関心領域
    const rp = 0.5 + 0.5 * Math.sin(t * 3);
    roiU.uTime.value = t;
    roiU.uIntensity.value = amt.roi * (1.5 + 0.5 * rp);
    roiMesh.visible = amt.roi > 0.01 && revealDone;
    roiHalo.visible = roiMesh.visible;
    roiHaloMat.opacity = amt.roi * (0.55 + 0.3 * rp);
    const rs = 70 + 20 * rp;
    roiHalo.scale.set(rs, rs, 1);
    if (noduleMat) noduleMat.emissiveIntensity = 0.35 + 1.1 * amt.roi;

    // ラベル（正面を向いているときだけ）
    if (amt.label > 0.01 && revealDone) {
      labelsLayer.style.opacity = '1';
      markers.forEach((m, i) => {
        m.mesh.getWorldPosition(tmp);
        const nx = Math.sin(rig.rotation.y), nz = Math.cos(rig.rotation.y);
        const vx = camera.position.x - tmp.x, vz = camera.position.z - tmp.z;
        const facing = (nx * vx + nz * vz) / (Math.hypot(vx, vz) || 1);
        const f = Math.max(0, Math.min(1, (facing - 0.1) / 0.3));
        const p = viewer.project(tmp);
        const el = labels[i];
        el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`;
        el.style.opacity = (amt.label * f).toFixed(3);
      });
    } else {
      labelsLayer.style.opacity = '0';
    }
  });

  return {
    /** 4 ステップの強調（-1 = 通常表示） */
    setStage(i) {
      goal = { ...(STAGES[i] || STAGES.idle) };
    },
    get ready() { return !!model; },
    dispose() {
      disposed = true;
      clearTimeout(startTimer);
      viewer.dispose();
      model?.dispose();
      for (const t of textures) t.dispose();
      for (const m of extraMaterials) m.dispose();
      labelsLayer.remove();
    },
  };
}
