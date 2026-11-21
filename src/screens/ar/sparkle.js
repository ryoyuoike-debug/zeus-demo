// =============================================================================
// AR表示: 指先の「線香花火」エフェクト
// ・中心の火の玉（明滅するスプライト）
// ・火花: 飛び出した火花が途中で 3〜4 本に枝分かれする（松葉のような火花）
// ・火花の尾（短い線）で、細くはじける感じを出す
// 単位は mm（ワールド座標）。加算合成・深度テストなし（仮想表示として常に手前）。
// =============================================================================
import * as THREE from 'three';

const MAX = 520;

const VS = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
attribute vec3 aColor;
uniform float uPx;
varying float vAlpha;
varying vec3 vColor;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = max(1.5, aSize * uPx / -mv.z);
  vAlpha = aAlpha;
  vColor = aColor;
}`;
const FS = /* glsl */ `
varying float vAlpha;
varying vec3 vColor;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = dot(c, c) * 4.0;
  if (d > 1.0) discard;
  float core = exp(-d * 3.5);
  gl_FragColor = vec4(vColor * vAlpha * core, 1.0);
}`;

/** 放射グラデーションのスプライト用テクスチャ */
export function glowTexture(inner = 'rgba(255,255,255,1)', mid = 'rgba(255,200,120,0.5)', size = 128) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner);
  g.addColorStop(0.22, mid);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function colorAt(u, out) {
  // 白黄 → 橙 → 赤
  if (u < 0.35) { const k = u / 0.35; out[0] = 1; out[1] = 0.96 - 0.3 * k; out[2] = 0.75 - 0.6 * k; } else { const k = (u - 0.35) / 0.65; out[0] = 1 - 0.15 * k; out[1] = 0.66 - 0.46 * k; out[2] = 0.15 - 0.12 * k; }
  return out;
}

/**
 * @returns {{group:THREE.Group, update:(dt:number, now:number, camera:THREE.Camera)=>void, burst:(n?:number)=>void,
 *            setEmitter:(v:THREE.Vector3)=>void, setActive:(b:boolean)=>void, setPixelScale:(px:number)=>void, dispose:()=>void}}
 */
export function createSparkle() {
  const group = new THREE.Group();
  group.name = 'sparkle';
  group.renderOrder = 50;

  const pos = new Float32Array(MAX * 3);
  const col = new Float32Array(MAX * 3);
  const size = new Float32Array(MAX);
  const alpha = new Float32Array(MAX);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1).setUsage(THREE.DynamicDrawUsage));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
  const mat = new THREE.ShaderMaterial({
    vertexShader: VS, fragmentShader: FS,
    uniforms: { uPx: { value: 700 } },
    transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = 51;
  points.userData.ownGeometry = true;
  group.add(points);

  // 尾（線分）
  const tpos = new Float32Array(MAX * 6);
  const tcol = new Float32Array(MAX * 6);
  const tgeo = new THREE.BufferGeometry();
  tgeo.setAttribute('position', new THREE.BufferAttribute(tpos, 3).setUsage(THREE.DynamicDrawUsage));
  tgeo.setAttribute('color', new THREE.BufferAttribute(tcol, 3).setUsage(THREE.DynamicDrawUsage));
  tgeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
  const tmat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending });
  const trails = new THREE.LineSegments(tgeo, tmat);
  trails.frustumCulled = false;
  trails.renderOrder = 50;
  trails.userData.ownGeometry = true;
  group.add(trails);

  // 火の玉
  const coreTex = glowTexture('rgba(255,250,235,1)', 'rgba(255,150,40,0.55)');
  const coreMat = new THREE.SpriteMaterial({ map: coreTex, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending });
  const core = new THREE.Sprite(coreMat);
  core.renderOrder = 52;
  core.scale.setScalar(0.001);
  group.add(core);

  const parts = [];
  for (let i = 0; i < MAX; i++) parts.push({ alive: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, age: 0, life: 1, gen: 0, split: false, s: 3 });
  const emitter = new THREE.Vector3();
  let active = false;
  let coreLevel = 0;
  let acc = 0;
  let cursor = 0;

  function spawn(x, y, z, speed, life, gen, s) {
    for (let k = 0; k < MAX; k++) {
      cursor = (cursor + 1) % MAX;
      const p = parts[cursor];
      if (p.alive) continue;
      // ランダムな方向（やや上向き寄り）
      const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      p.vx = r * Math.cos(th) * speed;
      p.vy = (u * 0.8 + 0.25) * speed;
      p.vz = r * Math.sin(th) * speed;
      p.x = x; p.y = y; p.z = z;
      p.age = 0; p.life = life; p.gen = gen; p.split = false; p.s = s; p.alive = true;
      return p;
    }
    return null;
  }

  const c3 = [0, 0, 0];
  function update(dt, now) {
    // 火の玉の明るさ（点火・消火をなめらかに）
    coreLevel += ((active ? 1 : 0) - coreLevel) * Math.min(1, dt * 7);
    const flicker = 0.82 + 0.18 * Math.sin(now * 0.031) * Math.sin(now * 0.017 + 1.3) + Math.random() * 0.08;
    core.position.copy(emitter);
    core.scale.setScalar(Math.max(0.001, 26 * coreLevel * flicker));
    coreMat.opacity = Math.min(1, coreLevel * 1.1);

    if (active) {
      acc += dt * 80;
      while (acc >= 1) {
        acc -= 1;
        spawn(emitter.x, emitter.y, emitter.z, 160 + Math.random() * 230, 0.3 + Math.random() * 0.3, 0, 2.6 + Math.random() * 1.4);
      }
    } else acc = 0;

    let n = 0;
    for (const p of parts) {
      if (!p.alive) continue;
      p.age += dt;
      if (p.age >= p.life) { p.alive = false; continue; }
      const u = p.age / p.life;
      // 枝分かれ（松葉）
      if (p.gen === 0 && !p.split && u > 0.42) {
        p.split = true;
        const k = 2 + Math.floor(Math.random() * 3);
        for (let j = 0; j < k; j++) spawn(p.x, p.y, p.z, 70 + Math.random() * 120, 0.1 + Math.random() * 0.16, 1, 1.6 + Math.random() * 0.8);
      }
      p.vy -= 260 * dt;
      const drag = 1 - Math.min(1, dt * 2.2);
      p.vx *= drag; p.vy *= drag; p.vz *= drag;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      const a = (1 - u * u) * (p.gen ? 0.95 : 1);
      colorAt(u, c3);
      pos[n * 3] = p.x; pos[n * 3 + 1] = p.y; pos[n * 3 + 2] = p.z;
      col[n * 3] = c3[0]; col[n * 3 + 1] = c3[1]; col[n * 3 + 2] = c3[2];
      size[n] = p.s * (1 - 0.4 * u);
      alpha[n] = a;
      const tl = p.gen ? 0.018 : 0.03;
      tpos[n * 6] = p.x; tpos[n * 6 + 1] = p.y; tpos[n * 6 + 2] = p.z;
      tpos[n * 6 + 3] = p.x - p.vx * tl; tpos[n * 6 + 4] = p.y - p.vy * tl; tpos[n * 6 + 5] = p.z - p.vz * tl;
      tcol[n * 6] = c3[0] * a; tcol[n * 6 + 1] = c3[1] * a; tcol[n * 6 + 2] = c3[2] * a;
      tcol[n * 6 + 3] = 0; tcol[n * 6 + 4] = 0; tcol[n * 6 + 5] = 0;
      n++;
    }
    geo.setDrawRange(0, n);
    tgeo.setDrawRange(0, n * 2);
    for (const name of ['position', 'aColor', 'aSize', 'aAlpha']) geo.attributes[name].needsUpdate = true;
    tgeo.attributes.position.needsUpdate = true;
    tgeo.attributes.color.needsUpdate = true;
  }

  return {
    group,
    update,
    setEmitter(v) { emitter.copy(v); },
    setActive(b) { active = !!b; },
    isActive() { return active; },
    /** 球を置いたときなどに、まとめて火花を散らす */
    burst(n = 36) {
      for (let i = 0; i < n; i++) spawn(emitter.x, emitter.y, emitter.z, 220 + Math.random() * 260, 0.35 + Math.random() * 0.3, 0, 3 + Math.random() * 1.5);
    },
    clear() { for (const p of parts) p.alive = false; coreLevel = 0; },
    setPixelScale(px) { mat.uniforms.uPx.value = px; },
    dispose() {
      mat.dispose(); tmat.dispose(); coreMat.dispose(); coreTex.dispose();
    },
  };
}
