// =============================================================================
// AR表示: パススルー映像に見立てた処置室（床・壁・処置台・モニター台など）
// 単位は mm。床が y = 0、処置台の上面（シーツ上）が TABLE_TOP。
// 患者は仰臥位で、頭は -Z 方向（奥）、足は +Z 方向（手前）。
// =============================================================================
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { renderAxialHU, huToRGBA, WINDOWS } from '../../data/phantom.js';

/** 処置台のシーツ上面の高さ（mm） */
export const TABLE_TOP = 790;

// -----------------------------------------------------------------------------
// 手続き的テクスチャ（外部画像は使わない）
// -----------------------------------------------------------------------------
function canvasTexture(w, hgt, draw, { repeat = null, srgb = true } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = hgt;
  draw(c.getContext('2d'), w, hgt);
  const tex = new THREE.CanvasTexture(c);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  if (repeat) { tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(repeat[0], repeat[1]); }
  return tex;
}

function speckle(ctx, w, hgt, n, colors, rmax = 1.4, seed = 7) {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = colors[Math.floor(rnd() * colors.length)];
    ctx.globalAlpha = 0.25 + rnd() * 0.35;
    ctx.beginPath();
    ctx.arc(rnd() * w, rnd() * hgt, 0.4 + rnd() * rmax, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/** 床（ビニル床材のタイル 600mm 角） */
function floorTexture() {
  return canvasTexture(512, 512, (ctx, w, hgt) => {
    ctx.fillStyle = '#c3c8c6';
    ctx.fillRect(0, 0, w, hgt);
    speckle(ctx, w, hgt, 2600, ['#aeb4b2', '#d7dbd9', '#9da3a1', '#e1e4e2']);
    ctx.strokeStyle = 'rgba(80,90,92,0.35)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, w - 2, hgt - 2);
  }, { repeat: [14, 14] });
}

/** 壁（わずかなムラ） */
function wallTexture() {
  return canvasTexture(256, 256, (ctx, w, hgt) => {
    ctx.fillStyle = '#dfe3df';
    ctx.fillRect(0, 0, w, hgt);
    speckle(ctx, w, hgt, 900, ['#d5d9d5', '#e8ebe8'], 2.2, 11);
  }, { repeat: [6, 2] });
}

/** 壁掛けモニターに映す CT 画像（合成ファントム・肺野条件） */
function ctTexture() {
  return canvasTexture(256, 160, (ctx, w, hgt) => {
    ctx.fillStyle = '#05070b';
    ctx.fillRect(0, 0, w, hgt);
    const size = 128;
    const hu = renderAxialHU(80, size);
    const win = WINDOWS.lung || { ww: 1500, wl: -600 };
    const rgba = huToRGBA(hu, win.ww, win.wl);
    const img = new ImageData(rgba, size, size);
    const tmp = document.createElement('canvas');
    tmp.width = size; tmp.height = size;
    tmp.getContext('2d').putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(tmp, 8, 8, 144, 144);
    ctx.drawImage(tmp, 160, 18, 88, 88);
    ctx.fillStyle = 'rgba(160,200,255,0.75)';
    ctx.font = '9px sans-serif';
    ctx.fillText('DEMO-0001', 162, 124);
    ctx.fillText('Axial', 162, 138);
    ctx.strokeStyle = 'rgba(120,170,255,0.4)';
    ctx.strokeRect(158.5, 16.5, 91, 91);
  });
}

// -----------------------------------------------------------------------------
// 布（ドレープ）の形状
// -----------------------------------------------------------------------------
/** 処置台にかけた布のふくらみ（断面: 中央が高く、台の縁から垂れる）。+Z 方向に len の長さ */
function drapeGeometry({ halfW, len, h0, h1, drop }) {
  const NU = 64, NV = 40;
  const pos = [];
  const idx = [];
  const W = halfW;
  for (let j = 0; j <= NV; j++) {
    const v = j / NV;
    const sv = v * v * (3 - 2 * v);
    const H = h0 + (h1 - h0) * sv;
    for (let i = 0; i <= NU; i++) {
      const u = i / NU;
      const x = -W - 24 + (2 * W + 48) * u;
      const ax = Math.abs(x);
      let y;
      if (ax <= W) {
        const q = 1 - Math.pow(ax / W, 2);
        y = H * Math.pow(Math.max(q, 0), 0.24) + 6;
      } else {
        const k = (ax - W) / 24;
        y = 6 - drop * Math.pow(k, 1.4);
      }
      // しわ
      const fold = Math.sin(u * 23 + v * 5.3) * Math.sin(v * 9.0 + u * 3.1);
      y += 3.2 * fold * (0.4 + 0.6 * v);
      const xx = x + (ax > W ? Math.sign(x) * 6 * Math.sin(v * 17 + u) : 0);
      pos.push(xx, y, v * len);
    }
  }
  for (let j = 0; j < NV; j++) {
    for (let i = 0; i < NU; i++) {
      const a = j * (NU + 1) + i, b = a + 1, c = a + NU + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// -----------------------------------------------------------------------------
// 部屋を組み立てる
// -----------------------------------------------------------------------------
/**
 * @param {THREE.Scene} scene
 * @returns {{dispose:()=>void, keyLight:THREE.DirectionalLight}}
 */
export function buildRoom(scene) {
  const own = []; // 破棄するジオメトリ・マテリアル・テクスチャ
  const keep = (x) => { own.push(x); return x; };
  const mesh = (geo, mat, { cast = false, receive = false } = {}) => {
    const m = new THREE.Mesh(keep(geo), mat);
    m.castShadow = cast;
    m.receiveShadow = receive;
    m.userData.ownGeometry = true;
    return m;
  };
  const std = (o) => keep(new THREE.MeshStandardMaterial(o));

  scene.background = new THREE.Color('#aab1b3');
  scene.fog = new THREE.Fog('#b7bdbd', 3800, 9000);

  // ---- 照明（天井の柔らかい光） ----
  const hemi = new THREE.HemisphereLight('#f3f6f8', '#7d8486', 1.15);
  scene.add(hemi);
  const key = new THREE.DirectionalLight('#ffffff', 1.65);
  key.position.set(700, 2900, 900);
  key.target.position.set(0, TABLE_TOP, -60);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -900; key.shadow.camera.right = 900;
  key.shadow.camera.top = 900; key.shadow.camera.bottom = -900;
  key.shadow.camera.near = 1200; key.shadow.camera.far = 4200;
  key.shadow.bias = -0.0008;
  key.shadow.normalBias = 1.5;
    scene.add(key, key.target);
  const fill = new THREE.DirectionalLight('#dfe8ff', 0.45);
  fill.position.set(-1600, 1800, 1400);
  scene.add(fill);

  // ---- 床・壁 ----
  const floor = mesh(new THREE.PlaneGeometry(9000, 9000), std({ map: keep(floorTexture()), roughness: 0.82, metalness: 0 }), { receive: true });
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  const wallTex = keep(wallTexture());
  const wallMat = std({ map: wallTex, roughness: 0.95 });
  const back = mesh(new THREE.PlaneGeometry(9000, 3200), wallMat);
  back.position.set(0, 1600, -2300);
  scene.add(back);
  const side = mesh(new THREE.PlaneGeometry(9000, 3200), wallMat);
  side.rotation.y = -Math.PI / 2;
  side.position.set(2100, 1600, 0);
  scene.add(side);
  const sideL = mesh(new THREE.PlaneGeometry(9000, 3200), wallMat);
  sideL.rotation.y = Math.PI / 2;
  sideL.position.set(-2900, 1600, 0);
  scene.add(sideL);
  // 幅木・腰の保護レール
  const trimMat = std({ color: '#7e8a8c', roughness: 0.6 });
  const railMat = std({ color: '#c9d2d4', roughness: 0.4, metalness: 0.2 });
  for (const [w, x, z, ry] of [[9000, 0, -2296, 0], [9000, 2096, 0, -Math.PI / 2], [9000, -2896, 0, Math.PI / 2]]) {
    const b = mesh(new THREE.BoxGeometry(w, 110, 10), trimMat);
    b.position.set(x, 55, z); b.rotation.y = ry; scene.add(b);
    const r = mesh(new THREE.BoxGeometry(w, 60, 26), railMat);
    r.position.set(x, 900, z); r.rotation.y = ry; scene.add(r);
  }

  // ---- 壁掛けモニター（奥の壁） ----
  const monFrame = mesh(new THREE.BoxGeometry(50, 640, 1100), std({ color: '#1b1f24', roughness: 0.5 }));
  monFrame.position.set(2070, 1780, -420);
  scene.add(monFrame);
  const ctTex = keep(ctTexture());
  const monScreen = mesh(new THREE.PlaneGeometry(1040, 650 * 0.9), keep(new THREE.MeshBasicMaterial({ map: ctTex, toneMapped: false, color: '#b9c3cc' })));
  monScreen.position.set(2044, 1780, -420);
  monScreen.rotation.y = -Math.PI / 2;
  scene.add(monScreen);
  // 壁の医療ガス配管パネル（簡略）
  const panel = mesh(new THREE.BoxGeometry(40, 240, 700), std({ color: '#e9ecea', roughness: 0.6 }));
  panel.position.set(2080, 1380, 700);
  scene.add(panel);
  const portMat = std({ color: '#5e6b70', roughness: 0.5, metalness: 0.4 });
  for (let i = 0; i < 4; i++) {
    const p = mesh(new THREE.CylinderGeometry(22, 22, 30, 20), portMat);
    p.rotation.z = Math.PI / 2;
    p.position.set(2052, 1380, 500 + i * 130);
    scene.add(p);
  }
  // 収納棚（右の壁際）
  const cab = mesh(new RoundedBoxGeometry(460, 860, 1200, 3, 12), std({ color: '#eef0ee', roughness: 0.55 }), { cast: true, receive: true });
  cab.position.set(1860, 430, 1500);
  scene.add(cab);
  const handleMat = std({ color: '#9aa4a8', roughness: 0.3, metalness: 0.6 });
  for (let i = 0; i < 3; i++) {
    const hd = mesh(new THREE.BoxGeometry(14, 22, 220), handleMat);
    hd.position.set(1625, 680 - i * 250, 1500);
    scene.add(hd);
  }

  // ---- 処置台 ----
  const metal = std({ color: '#b9c0c4', roughness: 0.32, metalness: 0.75 });
  const darkMetal = std({ color: '#4c545c', roughness: 0.45, metalness: 0.5 });
  const pad = mesh(new RoundedBoxGeometry(660, 90, 2050, 4, 28), std({ color: '#3c4b5c', roughness: 0.55, metalness: 0.05 }), { cast: true, receive: true });
  pad.position.set(0, TABLE_TOP - 6 - 45, -150);
  scene.add(pad);
  const sheet = mesh(new RoundedBoxGeometry(690, 8, 1500, 2, 3), std({ color: '#eef2f4', roughness: 0.9 }), { receive: true });
  sheet.position.set(0, TABLE_TOP - 4, -60);
  scene.add(sheet);
  const frame = mesh(new THREE.BoxGeometry(600, 70, 1800), darkMetal, { cast: true });
  frame.position.set(0, TABLE_TOP - 6 - 90 - 35, -150);
  scene.add(frame);
  const column = mesh(new RoundedBoxGeometry(320, TABLE_TOP - 240, 420, 3, 20), std({ color: '#d9dee1', roughness: 0.45, metalness: 0.1 }), { cast: true, receive: true });
  column.position.set(0, (TABLE_TOP - 240) / 2 + 40, -150);
  scene.add(column);
  const base = mesh(new RoundedBoxGeometry(700, 60, 1100, 3, 20), std({ color: '#c7cdd1', roughness: 0.5, metalness: 0.1 }), { cast: true, receive: true });
  base.position.set(0, 30, -150);
  scene.add(base);
  // サイドレール
  for (const sx of [-1, 1]) {
    const rail = mesh(new THREE.BoxGeometry(14, 30, 1500), metal);
    rail.position.set(sx * 345, TABLE_TOP - 70, -150);
    scene.add(rail);
  }

  // ---- ドレープ（下半身側）と頭側のスクリーン ----
  // 胸部模型の腹側の切断面（z = +175）を覆い、患者の体の続きのように見せる
  const drapeMat = std({ color: '#3f78a6', roughness: 0.92, side: THREE.DoubleSide });
  const lower = mesh(drapeGeometry({ halfW: 330, len: 760, h0: 236, h1: 150, drop: 150 }), drapeMat, { cast: true, receive: true });
  lower.position.set(0, TABLE_TOP - 4, 145);
  scene.add(lower);
  // ---- 点滴スタンド（頭側・右） ----
  const ivPole = mesh(new THREE.CylinderGeometry(10, 10, 1900, 14), metal, { cast: true });
  ivPole.position.set(-480, 950, -1250);
  scene.add(ivPole);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const leg = mesh(new THREE.BoxGeometry(320, 18, 26), metal, { cast: true });
    leg.position.set(-480 + Math.cos(a) * 150, 40, -1250 + Math.sin(a) * 150);
    leg.rotation.y = -a;
    scene.add(leg);
  }
  const hook = mesh(new THREE.TorusGeometry(70, 7, 8, 32, Math.PI), metal);
  hook.position.set(-480, 1900, -1250);
  scene.add(hook);

  // ---- 移動式モニタースタンド（患者の左・頭側） ----
  const stand = new THREE.Group();
  stand.position.set(880, 0, -1050);
  stand.rotation.y = -1.0;
  scene.add(stand);
  const sPole = mesh(new THREE.CylinderGeometry(22, 22, 1250, 16), metal, { cast: true });
  sPole.position.set(0, 680, 0);
  stand.add(sPole);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const leg = mesh(new THREE.BoxGeometry(300, 24, 40), darkMetal, { cast: true });
    leg.position.set(Math.cos(a) * 140, 60, Math.sin(a) * 140);
    leg.rotation.y = -a;
    stand.add(leg);
    const wheel = mesh(new THREE.CylinderGeometry(30, 30, 24, 14), darkMetal);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(Math.cos(a) * 280, 30, Math.sin(a) * 280);
    stand.add(wheel);
  }
  const sMon = mesh(new RoundedBoxGeometry(560, 360, 50, 2, 10), std({ color: '#22272d', roughness: 0.45 }), { cast: true });
  sMon.position.set(0, 1360, 30);
  sMon.rotation.x = -0.18;
  stand.add(sMon);
  const sScreen = mesh(new THREE.PlaneGeometry(520, 320), keep(new THREE.MeshBasicMaterial({ color: '#0e1a2b', toneMapped: false })));
  sScreen.position.set(0, 1360 + 4, 56);
  sScreen.rotation.x = -0.18;
  stand.add(sScreen);

  // ---- 器械台（術者の右手前） ----
  const mayo = new THREE.Group();
  mayo.position.set(-430, 0, 760);
  mayo.rotation.y = 0.35;
  scene.add(mayo);
  const mPole = mesh(new THREE.CylinderGeometry(16, 16, 900, 12), metal, { cast: true });
  mPole.position.set(-140, 450, 0);
  mayo.add(mPole);
  const tray = mesh(new RoundedBoxGeometry(520, 24, 380, 2, 6), metal, { cast: true, receive: true });
  tray.position.set(0, 910, 0);
  mayo.add(tray);
  const drape = mesh(new RoundedBoxGeometry(540, 6, 400, 2, 3), std({ color: '#4f8a78', roughness: 0.95 }), { receive: true });
  drape.position.set(0, 925, 0);
  mayo.add(drape);
  const gauze = mesh(new RoundedBoxGeometry(110, 18, 90, 2, 5), std({ color: '#f4f5f2', roughness: 0.95 }), { cast: true });
  gauze.position.set(120, 938, -60);
  mayo.add(gauze);
  const bowl = mesh(new THREE.CylinderGeometry(70, 50, 40, 24, 1, true), keep(new THREE.MeshStandardMaterial({ color: '#c3c9cc', roughness: 0.25, metalness: 0.85, side: THREE.DoubleSide })), { cast: true });
  bowl.position.set(-120, 948, 70);
  mayo.add(bowl);
  const mBase = mesh(new THREE.BoxGeometry(500, 30, 60), darkMetal);
  mBase.position.set(-140, 30, 0);
  mayo.add(mBase);

  return {
    keyLight: key,
    dispose() {
      for (const x of own) x.dispose?.();
    },
  };
}
