// =============================================================================
// システム構成図（インライン SVG）
// CT・PACS → PC アプリ「Zeus」 → Meta Quest 3 / XREAL（Beam Pro） / iPad・iPhone
// 狭い画面では縦並びの HTML 版に切り替えます（CSS）。
// =============================================================================
import { h } from '../../ui/dom.js';
import { ICONS, iconSVG } from './content.js';

const icon = (name, x, y, size, cls = '') =>
  `<svg x="${x}" y="${y}" width="${size}" height="${size}" viewBox="0 0 48 48" class="dg-ico ${cls}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;

const pill = (cx, y, text, cls = '') => {
  const w = Math.round(text.length * 13 + 26);
  return `<g class="dg-tag ${cls}"><rect x="${cx - w / 2}" y="${y}" width="${w}" height="24" rx="12"/><text x="${cx}" y="${y + 16.5}" text-anchor="middle">${text}</text></g>`;
};

const DEVICES = [
  { icon: 'hmd', name: 'Meta Quest 3', sub: 'ARグラス（HMD）' },
  { icon: 'glasses', name: 'XREAL（Beam Pro）', sub: 'ARグラス' },
  { icon: 'tablet', name: 'iPad・iPhone', sub: 'タブレット・スマートフォン' },
];

function buildSVG() {
  const NY = 40, NH = 220, CY = NY + NH / 2; // ノードの上端・高さ・中心
  const DX = 810, DW = 298, DH = 64, DG = 14;
  const devY = DEVICES.map((_, i) => NY + i * (DH + DG));
  const fan = devY.map((y) => {
    const ty = y + DH / 2;
    return ty === CY ? `M672 ${CY} H${DX}` : `M672 ${CY} C741 ${CY} 741 ${ty} ${DX} ${ty}`;
  });
  const ab = `M274 ${CY} H392`;

  return `
<svg class="dg-svg" viewBox="0 0 1120 270" role="img" aria-label="システム構成図：CT・PACS から PCアプリ「Zeus」へ画像を取り込み、Meta Quest 3、XREAL（Beam Pro）、iPad・iPhone へ転送します。">
  <defs>
    <linearGradient id="dgBox" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#14213a"/><stop offset="1" stop-color="#0d1628"/>
    </linearGradient>
    <linearGradient id="dgBoxZeus" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#16294d"/><stop offset="1" stop-color="#0e1a33"/>
    </linearGradient>
  </defs>

  <!-- ステップのタグ -->
  ${pill(143, 4, '① CTを撮る')}
  ${pill(454, 4, '② マーカを確認する')}
  ${pill(612, 4, '③ 範囲をなぞる')}
  ${pill(959, 4, '④ そして見る')}

  <!-- 接続線 -->
  <g class="dg-edges">
    <path d="${ab}" class="dg-edge"/>
    <path d="${ab}" class="dg-flow"/>
    ${fan.map((d) => `<path d="${d}" class="dg-edge"/><path d="${d}" class="dg-flow is-orange"/>`).join('')}
    <polygon points="384,${CY - 6} 393,${CY} 384,${CY + 6}" class="dg-head"/>
    ${devY.map((y) => `<polygon points="${DX - 9},${y + DH / 2 - 6} ${DX},${y + DH / 2} ${DX - 9},${y + DH / 2 + 6}" class="dg-head is-orange"/>`).join('')}
    <circle r="4.5" class="dg-packet"><animateMotion dur="2.2s" repeatCount="indefinite" path="${ab}"/></circle>
    ${fan.map((d, i) => `<circle r="4.5" class="dg-packet is-orange"><animateMotion dur="1.6s" begin="${(i * 0.25).toFixed(2)}s" repeatCount="indefinite" path="${d}"/></circle>`).join('')}
  </g>

  <!-- ラベル（接続線の上） -->
  <g class="dg-edge-label">
    <rect x="${333 - 38}" y="${CY - 12}" width="76" height="24" rx="12"/>
    <text x="333" y="${CY + 4.5}" text-anchor="middle">DICOM</text>
  </g>
  <g class="dg-edge-label is-orange">
    <rect x="${741 - 64}" y="${CY - 21}" width="128" height="42" rx="12"/>
    <text x="741" y="${CY - 3}" text-anchor="middle" class="dg-strong">ワンクリック転送</text>
    <text x="741" y="${CY + 13}" text-anchor="middle" class="dg-small">約1秒（目安）・USB</text>
  </g>

  <!-- ノード A: CT・PACS -->
  <g class="dg-node" data-k="0">
    <rect x="12" y="${NY}" width="262" height="${NH}" rx="16" class="dg-box"/>
    ${icon('ct', 45, NY + 24, 70)}
    ${icon('server', 129, NY + 33, 52)}
    ${icon('disc', 195, NY + 36, 46)}
    <text x="143" y="${NY + 132}" text-anchor="middle" class="dg-title">CT・PACS</text>
    <text x="143" y="${NY + 160}" text-anchor="middle" class="dg-sub">PACSからDICOMで取得</text>
    <text x="143" y="${NY + 182}" text-anchor="middle" class="dg-sub">CD-ROMからの取込も可</text>
  </g>

  <!-- ノード B: PC アプリ「Zeus」 -->
  <g class="dg-node is-zeus" data-k="1">
    <rect x="392" y="${NY}" width="280" height="${NH}" rx="16" class="dg-box"/>
    ${icon('monitor', 482, NY + 12, 100)}
    <g class="dg-logo" transform="translate(516 ${NY + 37}) scale(1)">
      <rect x="1" y="1" width="30" height="30" rx="8"/>
      <path d="M18.6 4.8 9.2 18.1h6.1l-2.1 9.1 9.6-13.6h-6.2z" class="dg-logo-bolt"/>
    </g>
    <text x="532" y="${NY + 132}" text-anchor="middle" class="dg-title">PCアプリ「Zeus」</text>
    <text x="532" y="${NY + 160}" text-anchor="middle" class="dg-sub">データ取込・3D構成</text>
    <text x="532" y="${NY + 182}" text-anchor="middle" class="dg-sub">マーカ確認・関心領域・端末への転送</text>
  </g>

  <!-- ノード C: 端末 -->
  <g class="dg-node" data-k="2">
    ${DEVICES.map((d, i) => `
    <g class="dg-device">
      <rect x="${DX}" y="${devY[i]}" width="${DW}" height="${DH}" rx="14" class="dg-box"/>
      ${icon(d.icon, DX + 16, devY[i] + 10, 44)}
      <text x="${DX + 74}" y="${devY[i] + 29}" class="dg-name">${d.name}</text>
      <text x="${DX + 74}" y="${devY[i] + 49}" class="dg-sub">${d.sub}</text>
    </g>`).join('')}
  </g>
</svg>`;
}

/** 狭い画面用（縦並び） */
function buildList() {
  const block = (icons, title, sub, tag) => h('div', { class: 'dg-lblock' },
    h('div', { class: 'dg-ltag' }, tag),
    h('div', { class: 'dg-licons', html: icons.map((n) => iconSVG(n, { size: 34 })).join('') }),
    h('div', { class: 'dg-ltitle' }, title),
    h('div', { class: 'dg-lsub' }, sub));
  const arrow = (label) => h('div', { class: 'dg-larrow' }, h('span', {}, '↓'), label);
  return h('div', { class: 'dg-list' },
    block(['ct', 'server', 'disc'], 'CT・PACS', 'PACSからDICOMで取得（CD-ROMからの取込も可）', '① CTを撮る'),
    arrow('DICOM'),
    block(['monitor'], 'PCアプリ「Zeus」', 'データ取込・3D構成・マーカ確認・関心領域・端末への転送', '② マーカを確認する　③ 範囲をなぞる'),
    arrow('ワンクリック転送（約1秒・目安）'),
    block(['hmd', 'glasses', 'tablet'], 'Meta Quest 3 / XREAL（Beam Pro） / iPad・iPhone', 'ARグラス・タブレット・スマートフォン', '④ そして見る'));
}

export function createDiagram() {
  const el = h('figure', { class: 'dg' });
  el.insertAdjacentHTML('beforeend', buildSVG());
  el.appendChild(buildList());
  el.appendChild(h('figcaption', { class: 'dg-caption' }, '構成図はイメージです。転送時間は目安で、環境によって異なります。'));
  const nodes = [...el.querySelectorAll('.dg-node')];
  return {
    el,
    /** k 番目のノードを点灯（-1 で消灯） */
    light(k) { nodes.forEach((n, i) => n.classList.toggle('is-lit', i === k)); },
    nodeEl(k) {
      const svgVisible = el.querySelector('.dg-svg')?.getBoundingClientRect().width > 0;
      return svgVisible ? nodes[k] : el.querySelectorAll('.dg-lblock')[k];
    },
    destroy() { el.remove(); },
  };
}
