// =============================================================================
// マーカ確認: マーカ周辺の CT を切り出したサムネイル（合成ファントムから直接計算）
// 画像の左 = 患者の右、上 = 腹側（CT ビューアと同じ向き）
// =============================================================================
import { sampleHU, SEGMENTS, MARKERS, MARKER_RADIUS, huToRGBA, WINDOWS } from '../../data/phantom.js';

function noise(i, j, k) {
  let h = Math.imul((i * 73856093) ^ (j * 19349663) ^ (k * 83492791), 0x27d4eb2d);
  h ^= h >>> 15;
  return ((h >>> 0) / 4294967295) * 2 - 1;
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{cx:number, cy:number, z:number, wmm:number, hmm:number, pw:number, ph:number, win?:string}} o
 *   cx, cy: 切り出し中心（患者座標 mm）、wmm/hmm: 切り出し幅/高さ（mm）、pw/ph: ピクセル数
 */
export function renderCrop(canvas, { cx, cy, z, wmm, hmm, pw, ph, win = 'mediastinum' }) {
  const segs = SEGMENTS.filter((s) => z >= s.zmin && z <= s.zmax);
  const mks = MARKERS.filter((m) => Math.abs(m.pos[2] - z) < MARKER_RADIUS);
  const hu = new Float32Array(pw * ph);
  const sx = wmm / pw, sy = hmm / ph;
  const kz = Math.round(z * 10);
  for (let j = 0; j < ph; j++) {
    const y = cy + hmm / 2 - (j + 0.5) * sy;
    for (let i = 0; i < pw; i++) {
      const x = cx - wmm / 2 + (i + 0.5) * sx;
      hu[j * pw + i] = sampleHU(x, y, z, segs, mks) + noise(i, j, kz) * 12;
    }
  }
  canvas.width = pw;
  canvas.height = ph;
  const g = canvas.getContext('2d');
  const img = g.createImageData(pw, ph);
  const w = WINDOWS[win] || WINDOWS.mediastinum;
  huToRGBA(hu, w.ww, w.wl, img.data);
  g.putImageData(img, 0, 0);
}
