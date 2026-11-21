// =============================================================================
// 再利用できる Three.js ビューア
// 各画面は mount 時に createViewer() し、unmount 時に dispose() します。
// =============================================================================
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

/**
 * @param {HTMLElement} container 描画先（サイズは CSS で決める）
 * @param {{background?: string|null, fov?: number, cameraPos?: [number,number,number], target?: [number,number,number],
 *          controls?: boolean, autoRotate?: boolean, near?: number, far?: number, lights?: 'studio'|'room'|'none'}} [opts]
 */
export function createViewer(container, opts = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: opts.background == null, preserveDrawingBuffer: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.domElement.classList.add('three-canvas');
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  if (opts.background != null) scene.background = new THREE.Color(opts.background);

  const camera = new THREE.PerspectiveCamera(opts.fov ?? 35, 1, opts.near ?? 5, opts.far ?? 20000);
  const cp = opts.cameraPos ?? [0, 60, 900];
  camera.position.set(cp[0], cp[1], cp[2]);
  const target = new THREE.Vector3(...(opts.target ?? [0, 0, 0]));
  camera.lookAt(target);

  let controls = null;
  if (opts.controls !== false) {
    controls = new OrbitControls(camera, renderer.domElement);
    controls.target.copy(target);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.rotateSpeed = 0.7;
    controls.zoomSpeed = 0.8;
    controls.minDistance = 150;
    controls.maxDistance = 3000;
    controls.autoRotate = !!opts.autoRotate;
    controls.autoRotateSpeed = 1.2;
    controls.update();
  }

  if (opts.lights !== 'none') {
    const hemi = new THREE.HemisphereLight(0xdfeaff, 0x1a2233, opts.lights === 'room' ? 0.9 : 1.1);
    scene.add(hemi);
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(400, 700, 900);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x88b4ff, 0.8);
    rim.position.set(-600, 200, -700);
    scene.add(rim);
    const fill = new THREE.DirectionalLight(0xffffff, 0.45);
    fill.position.set(-500, -300, 600);
    scene.add(fill);
  }

  const frameCallbacks = new Set();
  let running = true;
  let visible = true;
  let raf = 0;
  const timer = new THREE.Timer();
  timer.connect?.(document);

  function resize() {
    const w = Math.max(1, container.clientWidth);
    const h = Math.max(1, container.clientHeight);
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();

  const io = new IntersectionObserver((entries) => {
    visible = entries.some((e) => e.isIntersecting);
  });
  io.observe(container);

  function loop() {
    raf = requestAnimationFrame(loop);
    if (!running || !visible || document.hidden) return;
    timer.update();
    const dt = Math.min(timer.getDelta(), 0.1);
    const t = timer.getElapsed();
    for (const cb of frameCallbacks) cb(dt, t);
    controls?.update();
    renderer.render(scene, camera);
  }
  loop();

  return {
    THREE,
    renderer,
    scene,
    camera,
    controls,
    container,
    /** 毎フレーム呼ばれる関数を登録。戻り値で登録解除。 */
    onFrame(cb) { frameCallbacks.add(cb); return () => frameCallbacks.delete(cb); },
    resize,
    pause() { running = false; },
    resume() { running = true; timer.update(); },
    /** カメラを target の周りの指定位置へ（なめらかに）移動 */
    flyTo(pos, tgt = null, ms = 700) {
      const from = camera.position.clone();
      const to = new THREE.Vector3(...pos);
      const t0 = controls ? controls.target.clone() : target.clone();
      const t1 = tgt ? new THREE.Vector3(...tgt) : t0.clone();
      if (!(ms > 0)) {
        // 時間 0 のときはすぐに移動（0 で割らない）
        camera.position.copy(to);
        if (controls) controls.target.copy(t1); else camera.lookAt(t1);
        return;
      }
      const start = performance.now();
      const off = this.onFrame(() => {
        const u = Math.min(1, (performance.now() - start) / ms);
        const e = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
        camera.position.lerpVectors(from, to, e);
        if (controls) controls.target.lerpVectors(t0, t1, e); else camera.lookAt(t0.clone().lerp(t1, e));
        if (u >= 1) off();
      });
    },
    /** スクリーン座標（クライアント座標）からレイを作る */
    raycaster(clientX, clientY) {
      const r = renderer.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
      const rc = new THREE.Raycaster();
      rc.setFromCamera(ndc, camera);
      return rc;
    },
    /** ワールド座標 → コンテナ内のピクセル座標 */
    project(v) {
      const p = v.clone().project(camera);
      return { x: (p.x * 0.5 + 0.5) * container.clientWidth, y: (-p.y * 0.5 + 0.5) * container.clientHeight, behind: p.z > 1 };
    },
    dispose() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      frameCallbacks.clear();
      controls?.dispose();
      timer.dispose?.();
      const disposeMaterial = (m) => {
        if (!m) return;
        // マテリアルが持つテクスチャ（map など）も破棄する
        for (const v of Object.values(m)) if (v && v.isTexture) v.dispose();
        m.dispose?.();
      };
      scene.traverse((o) => {
        // 共有ジオメトリ（解剖モデル）は破棄しない。userData.ownGeometry のものだけ破棄。
        if (o.isMesh || o.isLine || o.isPoints || o.isSprite) {
          if (o.userData.ownGeometry) o.geometry?.dispose();
          const m = o.material;
          if (Array.isArray(m)) m.forEach(disposeMaterial); else disposeMaterial(m);
        }
      });
      if (scene.background?.isTexture) scene.background.dispose();
      if (scene.environment?.isTexture) scene.environment.dispose();
      renderer.dispose();
      renderer.forceContextLoss?.();
      renderer.domElement.remove();
    },
  };
}
