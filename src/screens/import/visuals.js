// =============================================================================
// 新規データ追加・メイン画面で使うインライン SVG と CT サムネイル
// （外部画像は使わない。色は currentColor と CSS 変数で調整する）
// =============================================================================
import '../../styles/screens/import-illus.css';
import { renderAxialHU, huToRGBA, WINDOWS } from '../../data/phantom.js';

// ---------------------------------------------------------------------------
// CT サムネイル（合成ファントムの軸位断）
// ---------------------------------------------------------------------------
const huCache = new Map();
/**
 * 縦隔条件／肺野条件のサムネイルを canvas で返す（心臓の高さのスライス。寝台は切り落とす）
 * @param {'mediastinum'|'lung'} win
 * @param {{size?: number, z?: number}} [o] size = 出力の幅(px)。高さは約 0.79 倍。
 */
export function ctThumb(win = 'mediastinum', { size = 96, z = -30 } = {}) {
  const N = Math.ceil(size / 0.84);
  const key = `${N}:${z}`;
  let hu = huCache.get(key);
  if (!hu) { hu = renderAxialHU(z, N, 360); huCache.set(key, hu); }
  const { ww, wl } = WINDOWS[win];
  const off = document.createElement('canvas');
  off.width = N; off.height = N;
  const og = off.getContext('2d');
  const img = og.createImageData(N, N);
  huToRGBA(hu, ww, wl, img.data);
  og.putImageData(img, 0, 0);
  const c = document.createElement('canvas');
  c.width = size; c.height = Math.round(size * 0.79);
  c.className = 'ct-thumb';
  c.setAttribute('role', 'img');
  c.setAttribute('aria-label', `${WINDOWS[win].name}条件のCT画像（合成ファントム）`);
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = true;
  g.drawImage(off, 0.08 * N, 0.15 * N, 0.84 * N, 0.84 * N * 0.79, 0, 0, c.width, c.height);
  return c;
}

// ---------------------------------------------------------------------------
// 取込元のイラスト
// ---------------------------------------------------------------------------
/** PACS → Zeus（PC） */
export const PACS_ILLUS = `
<svg viewBox="0 0 260 120" class="illus" aria-hidden="true">
  <g class="il-line">
    <rect x="22" y="16" width="58" height="88" rx="7" class="il-box"/>
    <rect x="30" y="26" width="42" height="14" rx="3" class="il-slot"/>
    <rect x="30" y="46" width="42" height="14" rx="3" class="il-slot"/>
    <rect x="30" y="66" width="42" height="14" rx="3" class="il-slot"/>
    <circle cx="64" cy="33" r="2.2" class="il-led"/>
    <circle cx="64" cy="53" r="2.2" class="il-led il-led-2"/>
    <circle cx="64" cy="73" r="2.2" class="il-led il-led-3"/>
    <path d="M36 33h18M36 53h18M36 73h18" class="il-thin"/>
    <path d="M84 60 C 112 60, 128 52, 166 52" class="il-flow"/>
    <rect x="168" y="26" width="72" height="50" rx="5" class="il-box"/>
    <rect x="174" y="32" width="60" height="38" rx="2" class="il-screen"/>
    <ellipse cx="204" cy="51" rx="15" ry="11" class="il-ct"/>
    <ellipse cx="198" cy="50" rx="5" ry="6" class="il-ct-lung"/>
    <ellipse cx="210" cy="50" rx="5" ry="6" class="il-ct-lung"/>
    <path d="M196 76 l-6 14 h28 l-6 -14" class="il-box"/>
  </g>
  <text x="51" y="116" class="il-label">PACS</text>
  <text x="204" y="104" class="il-label">Zeus</text>
</svg>`;

/** CD-ROM（外付けドライブ）→ Zeus（PC） */
export const CD_ILLUS = `
<svg viewBox="0 0 260 120" class="illus" aria-hidden="true">
  <defs>
    <radialGradient id="cdSheen" cx="0.35" cy="0.3" r="0.9">
      <stop offset="0" stop-color="#cfe6ff" stop-opacity="0.55"/>
      <stop offset="0.45" stop-color="#7fb6ff" stop-opacity="0.18"/>
      <stop offset="0.7" stop-color="#ffb3e1" stop-opacity="0.16"/>
      <stop offset="1" stop-color="#7fb6ff" stop-opacity="0.06"/>
    </radialGradient>
  </defs>
  <g class="il-line">
    <rect x="18" y="64" width="86" height="30" rx="6" class="il-box"/>
    <path d="M28 76h46" class="il-thin"/>
    <circle cx="92" cy="80" r="2.4" class="il-led"/>
    <g class="il-disc-wrap">
      <circle cx="58" cy="40" r="26" fill="url(#cdSheen)" class="il-disc"/>
      <circle cx="58" cy="40" r="8" class="il-disc-hub"/>
      <circle cx="58" cy="40" r="3" class="il-disc-hole"/>
      <path d="M58 18 a22 22 0 0 1 19 11" class="il-disc-glint"/>
    </g>
    <path d="M104 82 C 132 84, 140 56, 166 54" class="il-flow"/>
    <rect x="168" y="26" width="72" height="50" rx="5" class="il-box"/>
    <rect x="174" y="32" width="60" height="38" rx="2" class="il-screen"/>
    <path d="M186 44h14l4 4h16v14h-34z" class="il-folder"/>
    <path d="M196 76 l-6 14 h28 l-6 -14" class="il-box"/>
  </g>
  <text x="61" y="110" class="il-label">CD-ROM</text>
  <text x="204" y="104" class="il-label">Zeus</text>
</svg>`;

/** CD-ROM 取込中の大きなイラスト（ディスク回転・データの流れ） */
export const CD_DRIVE_BIG = `
<svg viewBox="0 0 360 220" class="illus illus-big" aria-hidden="true">
  <defs>
    <radialGradient id="cdSheenBig" cx="0.35" cy="0.3" r="0.9">
      <stop offset="0" stop-color="#d9ecff" stop-opacity="0.6"/>
      <stop offset="0.4" stop-color="#7fb6ff" stop-opacity="0.2"/>
      <stop offset="0.7" stop-color="#ffb3e1" stop-opacity="0.2"/>
      <stop offset="1" stop-color="#7fb6ff" stop-opacity="0.06"/>
    </radialGradient>
    <linearGradient id="driveFace" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#1b2a47"/>
      <stop offset="1" stop-color="#0e1729"/>
    </linearGradient>
  </defs>
  <g class="il-line">
    <!-- ドライブ本体 -->
    <rect x="20" y="118" width="170" height="56" rx="10" fill="url(#driveFace)" class="il-box-solid"/>
    <rect x="34" y="128" width="142" height="10" rx="3" class="il-slot"/>
    <circle cx="168" cy="158" r="3.2" class="il-led cd-led"/>
    <text x="40" y="162" class="il-small">USB</text>
    <!-- 回転するディスク -->
    <g class="cd-spin">
      <circle cx="105" cy="74" r="56" fill="url(#cdSheenBig)" class="il-disc"/>
      <circle cx="105" cy="74" r="38" class="il-disc-ring"/>
      <circle cx="105" cy="74" r="16" class="il-disc-hub"/>
      <circle cx="105" cy="74" r="6" class="il-disc-hole"/>
      <path d="M105 26 a48 48 0 0 1 40 22" class="il-disc-glint"/>
      <path d="M65 102 a48 48 0 0 1 -8 -16" class="il-disc-glint"/>
    </g>
    <!-- ケーブル（データの流れ） -->
    <path id="cdCable" d="M190 150 C 230 152, 236 104, 262 100" class="il-cable"/>
    <path d="M190 150 C 230 152, 236 104, 262 100" class="il-flow cd-flow"/>
    <!-- PC -->
    <rect x="262" y="58" width="86" height="64" rx="6" class="il-box"/>
    <rect x="269" y="65" width="72" height="50" rx="2" class="il-screen"/>
    <path d="M282 80h16l5 5h22v20h-43z" class="il-folder cd-folder"/>
    <path d="M296 122 l-8 18 h34 l-8 -18" class="il-box"/>
  </g>
  <text x="305" y="158" class="il-label">Zeus</text>
</svg>`;

/** DICOM Gateway のウィンドウアイコン */
export const GATEWAY_ICON = `
<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
  <rect x="1.5" y="2" width="7" height="16" rx="1.6" fill="none" stroke="#7fb6ff" stroke-width="1.4"/>
  <path d="M3.5 6h3M3.5 9h3M3.5 12h3" stroke="#7fb6ff" stroke-width="1.2"/>
  <path d="M10 10h4.5" stroke="#ffb26b" stroke-width="1.6" stroke-dasharray="2 1.4"/>
  <path d="M13.5 7.5l2.6 2.5-2.6 2.5" fill="none" stroke="#ffb26b" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
  <rect x="16.6" y="4" width="2" height="12" rx="1" fill="#7fb6ff"/>
</svg>`;

export const SEARCH_ICON = `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><circle cx="7" cy="7" r="4.6" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M10.4 10.4 14 14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
export const DOWNLOAD_ICON = `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M8 2v8M4.5 6.8 8 10.3l3.5-3.5M3 13.5h10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
export const TRASH_ICON = `<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
export const PLUS_ICON = `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>`;
export const CHEVRON_ICON = `<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

// ---------------------------------------------------------------------------
// 体位のピクトグラム（上から見た姿勢 + 足側から見た軸位断）
// ---------------------------------------------------------------------------
export const POSITIONS = [
  { id: 'supine', label: '仰臥位', sub: 'あおむけ', down: null },
  { id: 'right', label: '右側臥位', sub: '右側を下にした横向き', down: '右側が下' },
  { id: 'left', label: '左側臥位', sub: '左側を下にした横向き', down: '左側が下' },
];

/** 上から見た人のピクトグラム（頭は左。側臥位は膝を軽く曲げる） */
function figureTop(kind) {
  if (kind === 'supine') {
    return `
      <g class="pf-figure">
        <circle cx="34" cy="66" r="9.5" class="pf-head"/>
        <rect x="47" y="52" width="52" height="28" rx="12" class="pf-body"/>
        <path d="M52 55 L 17 47 M52 77 L 17 85" class="pf-limb"/>
        <path d="M98 60 L 146 58 M98 72 L 146 74" class="pf-limb pf-leg"/>
      </g>`;
  }
  // 右側臥位: 顔が画像の下側を向く（左側臥位は上下反転）
  const flip = kind === 'left' ? ' transform="translate(0 132) scale(1 -1)"' : '';
  return `
    <g class="pf-figure"${flip}>
      <circle cx="34" cy="64" r="9.5" class="pf-head"/>
      <path d="M31 73.2 q3 3.6 7 0" class="pf-face"/>
      <rect x="47" y="56" width="52" height="20" rx="9" class="pf-body"/>
      <path d="M54 70 L 20 80 M56 74 L 24 86" class="pf-limb"/>
      <path d="M98 64 L 124 78 L 150 70" class="pf-limb pf-leg pf-leg-back"/>
      <path d="M98 71 L 122 90 L 148 84" class="pf-limb pf-leg"/>
    </g>`;
}

/** 足側から見た軸位断（R/L と寝台）。放射線科の表示規約: 画像の左 = 患者の右 */
function axialInset(kind) {
  const cx = 202;
  const rot = kind === 'supine' ? 0 : kind === 'right' ? -90 : 90;
  const cy = kind === 'supine' ? 97 : 86;
  const rad = (rot * Math.PI) / 180;
  const at = (lx, ly) => [cx + lx * Math.cos(rad) - ly * Math.sin(rad), cy + lx * Math.sin(rad) + ly * Math.cos(rad)];
  const [rx, ry] = at(-37, 0);
  const [lx, ly] = at(37, 0);
  const downSide = kind === 'right' ? 'R' : kind === 'left' ? 'L' : null;
  const lab = (t, x, y) => `<text x="${x.toFixed(1)}" y="${(y + 4).toFixed(1)}" class="pf-rl${downSide === t ? ' is-down' : ''}">${t}</text>`;
  return `
    <g class="pf-axial">
      <path d="M168 117 Q 202 126 236 117" class="pf-table"/>
      <g transform="translate(${cx} ${cy}) rotate(${rot})">
        <ellipse cx="0" cy="0" rx="28" ry="17" class="pf-ax-body"/>
        <ellipse cx="-12" cy="-1" rx="9.5" ry="10.5" class="pf-ax-lung"/>
        <ellipse cx="12" cy="-1" rx="9.5" ry="10.5" class="pf-ax-lung"/>
        <ellipse cx="3.5" cy="-4" rx="6.2" ry="5.2" class="pf-ax-heart"/>
        <circle cx="0" cy="11.5" r="3.6" class="pf-ax-spine"/>
        <rect x="-2" y="-16.5" width="4" height="3" rx="1" class="pf-ax-spine"/>
      </g>
      ${lab('R', rx, ry)}${lab('L', lx, ly)}
    </g>`;
}

export function positionSvg(kind) {
  return `
<svg viewBox="0 0 244 132" class="pos-svg" aria-hidden="true">
  <rect x="8" y="30" width="150" height="72" rx="12" class="pf-bed"/>
  <path d="M14 40 h138" class="pf-bed-line"/>
  ${figureTop(kind)}
  <path d="M164 22 v96" class="pf-sep"/>
  ${axialInset(kind)}
  <text x="83" y="122" class="pf-cap">上から</text>
  <text x="202" y="22" class="pf-cap">足側から</text>
</svg>`;
}

// ---------------------------------------------------------------------------
// メイン画面: セクション1 のイラスト（取込元 → Zeus）
// ---------------------------------------------------------------------------
export const HOME_IMPORT_ILLUS = `
<svg viewBox="0 -6 300 134" class="illus" aria-hidden="true">
  <g class="il-line">
    <!-- PACS -->
    <rect x="16" y="10" width="40" height="50" rx="5" class="il-box"/>
    <path d="M23 22h18M23 34h18M23 46h18" class="il-thin"/>
    <circle cx="48" cy="22" r="1.9" class="il-led"/>
    <circle cx="48" cy="34" r="1.9" class="il-led il-led-2"/>
    <circle cx="48" cy="46" r="1.9" class="il-led il-led-3"/>
    <!-- CD-ROM -->
    <circle cx="36" cy="92" r="19" class="il-disc-flat"/>
    <circle cx="36" cy="92" r="5" class="il-disc-hub"/>
    <!-- 流れ -->
    <path d="M60 36 C 100 36, 110 58, 146 60" class="il-flow"/>
    <path d="M58 92 C 100 92, 110 64, 146 62" class="il-flow il-flow-2"/>
    <!-- PC -->
    <rect x="148" y="30" width="70" height="50" rx="5" class="il-box"/>
    <rect x="154" y="36" width="58" height="38" rx="2" class="il-screen"/>
    <ellipse cx="183" cy="55" rx="14" ry="10" class="il-ct"/>
    <ellipse cx="177" cy="54" rx="4.6" ry="5.6" class="il-ct-lung"/>
    <ellipse cx="189" cy="54" rx="4.6" ry="5.6" class="il-ct-lung"/>
    <path d="M176 80 l-5 12 h24 l-5 -12" class="il-box"/>
    <!-- 3D -->
    <path d="M226 55 h14" class="il-flow il-flow-3"/>
    <g class="il-holo">
      <path d="M262 26 c-12 0-16 10-16 22 v26 c0 12 8 18 16 18 s16-6 16-18 v-26 c0-12-4-22-16-22z" class="il-holo-body"/>
      <path d="M255 46 c-5 4-6 14-4 22 M269 46 c5 4 6 14 4 22" class="il-holo-lung"/>
      <ellipse cx="264" cy="64" rx="5" ry="6" class="il-holo-heart"/>
    </g>
  </g>
  <text x="36" y="7" class="il-label il-label-s">PACS</text>
  <text x="36" y="119" class="il-label il-label-s">CD-ROM</text>
  <text x="183" y="106" class="il-label il-label-s">Zeus</text>
  <text x="262" y="106" class="il-label il-label-s">3D構成</text>
</svg>`;
