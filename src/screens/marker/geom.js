// =============================================================================
// マーカ確認: 体表まわりの幾何ユーティリティ（患者座標 mm）
//   x: + = 患者の左   y: + = 腹側（前）   z: + = 頭側（上）
// =============================================================================
import { sdBody, BODY_Z, MARKER_RADIUS } from '../../data/phantom.js';

/** 体表の外向き法線（sdBody の勾配） */
export function skinNormal(p) {
  const e = 0.75;
  const gx = sdBody(p[0] + e, p[1], p[2]) - sdBody(p[0] - e, p[1], p[2]);
  const gy = sdBody(p[0], p[1] + e, p[2]) - sdBody(p[0], p[1] - e, p[2]);
  const gz = sdBody(p[0], p[1], p[2] + e) - sdBody(p[0], p[1], p[2] - e);
  const l = Math.hypot(gx, gy, gz) || 1;
  return [gx / l, gy / l, gz / l];
}

/**
 * クリックした点を体表に吸着させ、マーカ（球）の中心位置を返す。
 * 体表から maxDist (mm) 以上離れている場合や、胴体の上下端付近では null。
 * @returns {{pos:[number,number,number], normal:[number,number,number], skin:[number,number,number]} | null}
 */
export function snapToSkin(p, maxDist = 40) {
  const d0 = sdBody(p[0], p[1], p[2]);
  if (!Number.isFinite(d0) || Math.abs(d0) > maxDist) return null;
  let q = [p[0], p[1], p[2]];
  for (let i = 0; i < 14; i++) {
    const d = sdBody(q[0], q[1], q[2]);
    if (Math.abs(d) < 0.05) break;
    const n = skinNormal(q);
    q = [q[0] - n[0] * d, q[1] - n[1] * d, q[2] - n[2] * d];
  }
  if (q[2] > BODY_Z[1] - 12 || q[2] < BODY_Z[0] + 12) return null;
  const n = skinNormal(q);
  // 胴体の上下の端面（首の断端など）は対象外
  if (Math.abs(n[2]) > 0.8) return null;
  const off = MARKER_RADIUS - 0.5;
  return { pos: [q[0] + n[0] * off, q[1] + n[1] * off, q[2] + n[2] * off], normal: n, skin: q };
}
