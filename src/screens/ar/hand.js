// =============================================================================
// AR表示: パススルーに映る術者の右手（手袋）
// 関節の位置を直接指定した「球＋円錐台」の簡易モデル。開いた手 ↔ OKサインを補間する。
// ローカル座標（mm）: 手のひらは下（-Y）、指先は -Z、手首は +Z、親指は -X 側（右手）。
// グループの原点は OK サインの「親指と人差し指の先が触れる点」（＝球を持つ位置）。
// =============================================================================
import * as THREE from 'three';

// 各指の関節（付け根 → 先端）
const OPEN = {
  thumb: [[-30, -10, 15], [-52, -16, -8], [-66, -20, -30], [-76, -24, -48]],
  index: [[-28, 2, -40], [-31, 1, -78], [-33, -3, -102], [-34, -9, -120]],
  middle: [[-8, 3, -45], [-8, 2, -90], [-8, -2, -118], [-8, -8, -138]],
  ring: [[14, 1, -42], [16, 0, -84], [17, -4, -110], [18, -9, -128]],
  pinky: [[33, -3, -35], [37, -5, -68], [39, -9, -88], [40, -13, -104]],
};
const OK = {
  thumb: [[-30, -10, 15], [-48, -24, -12], [-47, -40, -40], [-40, -50, -60]],
  index: [[-28, 2, -40], [-34, -6, -74], [-38, -30, -84], [-38, -48, -66]],
  middle: [[-8, 3, -45], [-6, 6, -88], [-4, 6, -116], [-3, 2, -136]],
  ring: [[14, 1, -42], [18, 3, -83], [21, 2, -108], [23, -2, -126]],
  pinky: [[33, -3, -35], [40, -2, -66], [44, -4, -86], [47, -8, -101]],
};
const RADII = {
  thumb: [13, 11, 9.5, 8.2],
  index: [9.8, 8.8, 7.8, 7.0],
  middle: [10, 9, 8, 7.2],
  ring: [9.6, 8.6, 7.6, 6.9],
  pinky: [8.6, 7.6, 6.8, 6.2],
};
const FINGERS = Object.keys(OPEN);
/** OK サインで指先が触れる点（ローカル座標） */
const CONTACT = new THREE.Vector3(-39, -49, -63);

/**
 * @returns {{group:THREE.Group, setOk:(v:number)=>void, orient:(tip:THREE.Vector3, camera:THREE.Camera, roll?:number)=>void, dispose:()=>void}}
 */
export function createHand() {
  const own = [];
  const glove = new THREE.MeshStandardMaterial({ color: '#6f9fdc', roughness: 0.52, metalness: 0.0 });
  const sleeve = new THREE.MeshStandardMaterial({ color: '#2f5f6e', roughness: 0.9 });
  own.push(glove, sleeve);

  const group = new THREE.Group();
  group.name = 'hand';
  const inner = new THREE.Group();
  inner.position.copy(CONTACT).multiplyScalar(-1);
  group.add(inner);

  const sphereGeo = new THREE.SphereGeometry(1, 18, 12);
  own.push(sphereGeo);
  const addMesh = (geo, mat) => {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    m.userData.ownGeometry = true;
    inner.add(m);
    return m;
  };

  // 手のひら・母指球・手首・前腕
  const palm = addMesh(sphereGeo, glove);
  palm.position.set(1, -5, -14);
  palm.scale.set(44, 17, 40);
  const palmFront = addMesh(sphereGeo, glove);
  palmFront.position.set(2, -3, -34);
  palmFront.scale.set(42, 14, 16);
  const thenar = addMesh(sphereGeo, glove);
  thenar.position.set(-26, -12, 2);
  thenar.scale.set(17, 13, 26);
  thenar.rotation.y = 0.35;
  const wristGeo = new THREE.CylinderGeometry(27, 31, 1, 22, 1);
  const armGeo = new THREE.CylinderGeometry(34, 30, 1, 22, 1);
  own.push(wristGeo, armGeo);
  const seg = (geo, mat, a, b) => {
    const m = addMesh(geo, mat);
    const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
    m.position.copy(A).add(B).multiplyScalar(0.5);
    m.scale.set(1, A.distanceTo(B), 1);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
    return m;
  };
  seg(wristGeo, glove, [0, -4, 14], [0, -2, 120]);
  const cuff = addMesh(sphereGeo, glove);
  cuff.position.set(0, -2, 120);
  cuff.scale.set(31, 30, 8);
  seg(armGeo, sleeve, [0, -1, 128], [0, 8, 420]);

  // 指（関節球 + 関節間の円錐台）
  const joints = {};
  const bones = {};
  for (const f of FINGERS) {
    joints[f] = RADII[f].map((r) => {
      const m = addMesh(sphereGeo, glove);
      m.scale.setScalar(r);
      return m;
    });
    bones[f] = [0, 1, 2].map((i) => {
      const g = new THREE.CylinderGeometry(RADII[f][i + 1], RADII[f][i], 1, 16, 1);
      own.push(g);
      return addMesh(g, glove);
    });
  }

  const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), dir = new THREE.Vector3();
  function setOk(v) {
    const k = THREE.MathUtils.clamp(v, 0, 1);
    for (const f of FINGERS) {
      const pts = OPEN[f].map((p, i) => {
        const q = OK[f][i];
        return [p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k, p[2] + (q[2] - p[2]) * k];
      });
      pts.forEach((p, i) => joints[f][i].position.set(p[0], p[1], p[2]));
      for (let i = 0; i < 3; i++) {
        tmpA.fromArray(pts[i]);
        tmpB.fromArray(pts[i + 1]);
        const b = bones[f][i];
        b.position.copy(tmpA).add(tmpB).multiplyScalar(0.5);
        dir.subVectors(tmpB, tmpA);
        b.scale.set(1, dir.length(), 1);
        b.quaternion.setFromUnitVectors(up, dir.normalize());
      }
    }
  }
  setOk(1);

  // 手の向き: 手首はカメラの右下（術者の右肩）方向、手の甲はおおむね上向き
  const m4 = new THREE.Matrix4();
  const camRight = new THREE.Vector3(), camUp = new THREE.Vector3(), camFwd = new THREE.Vector3();
  const shoulder = new THREE.Vector3(), zAx = new THREE.Vector3(), xAx = new THREE.Vector3(), yAx = new THREE.Vector3();
  const rollQ = new THREE.Quaternion();
  const Z = new THREE.Vector3(0, 0, 1);
  function orient(tip, camera, roll = -0.95, side = 1) {
    camera.matrixWorld.extractBasis(camRight, camUp, camFwd); // camFwd = カメラの +Z（後方）
    shoulder.copy(camera.position).addScaledVector(camRight, 260 * side).addScaledVector(camUp, -430).addScaledVector(camFwd, -60);
    zAx.subVectors(shoulder, tip).normalize();
    xAx.crossVectors(camUp, zAx).normalize();
    yAx.crossVectors(zAx, xAx).normalize();
    m4.makeBasis(xAx, yAx, zAx);
    group.quaternion.setFromRotationMatrix(m4);
    rollQ.setFromAxisAngle(Z, roll);
    group.quaternion.multiply(rollQ);
    group.position.copy(tip);
  }

  return {
    group,
    setOk,
    orient,
    dispose() { for (const x of own) x.dispose(); },
  };
}
