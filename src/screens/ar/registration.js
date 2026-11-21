// =============================================================================
// AR表示: 3 点の対応から剛体変換（回転＋平行移動）を求める
// 3 点で作る直交座標系（重心原点・1→2 方向・面の法線）どうしを合わせる簡易法。
// =============================================================================
import * as THREE from 'three';

function frameOf(p) {
  const c = new THREE.Vector3().add(p[0]).add(p[1]).add(p[2]).multiplyScalar(1 / 3);
  const e1 = new THREE.Vector3().subVectors(p[1], p[0]);
  const v2 = new THREE.Vector3().subVectors(p[2], p[0]);
  const n = new THREE.Vector3().crossVectors(e1, v2);
  const len = e1.length();
  if (len < 1 || n.length() < 0.05 * len * v2.length()) return null; // 3 点がほぼ一直線
  e1.normalize();
  n.normalize();
  const e2 = new THREE.Vector3().crossVectors(n, e1);
  return { c, m: new THREE.Matrix4().makeBasis(e1, e2, n) };
}

/**
 * src の 3 点を dst の 3 点へ移す剛体変換。
 * @param {THREE.Vector3[]} src
 * @param {THREE.Vector3[]} dst
 * @returns {THREE.Matrix4|null} dst ≈ M · src（求められない場合は null）
 */
export function rigidFrom3(src, dst) {
  const a = frameOf(src), b = frameOf(dst);
  if (!a || !b) return null;
  const R = b.m.clone().multiply(a.m.clone().transpose());
  const t = b.c.clone().sub(a.c.clone().applyMatrix4(R));
  R.setPosition(t);
  return R;
}
