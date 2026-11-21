// =============================================================================
// 「はじめに」「まとめ」で共有する文言・アイコン（インライン SVG）
// 文言は仕様書 1 章（価値訴求）に沿っています。時間はすべて「目安」です。
// =============================================================================
import '../../styles/screens/intro-common.css';
import { h, researchBadge } from '../../ui/dom.js';

const MK = { right: '#ff8a1f', left: '#2f8bff', xiphoid: '#22c55e' };

/** アイコン（viewBox 0 0 48 48 / 線は currentColor） */
export const ICONS = {
  // CT 装置（ガントリー＋寝台）
  ct: `
    <circle cx="24" cy="19" r="14.5"/>
    <circle cx="24" cy="19" r="7"/>
    <rect x="3" y="23.5" width="42" height="4" rx="2" class="ico-fill"/>
    <path d="M16.5 33l-2.5 8M31.5 33l2.5 8M9 41h30"/>
    <path d="M24 4.5v3" class="ico-accent"/>`,
  // 体表の 3 点マーカ
  marker: `
    <path d="M15 5.5C10 7.5 7.5 11 7.5 17v25h33V17c0-6-2.5-9.5-7.5-11.5"/>
    <path d="M18.5 5.5c1.4 2.2 3.3 3.3 5.5 3.3s4.1-1.1 5.5-3.3"/>
    <path d="M24 12v14" opacity=".35"/>
    <circle cx="16.5" cy="16" r="3.1" fill="${MK.right}" stroke="none" class="ico-dot"/>
    <circle cx="31.5" cy="16" r="3.1" fill="${MK.left}" stroke="none" class="ico-dot"/>
    <circle cx="24" cy="30" r="3.1" fill="${MK.xiphoid}" stroke="none" class="ico-dot"/>`,
  // 範囲をなぞる（点線の領域＋ペン）
  trace: `
    <path d="M8.5 25c-1.6-7.6 4.6-14 12.6-14 8.2 0 13.6 4.8 12.6 11.2-.9 5.8-6.8 9.6-13 9.6-6.4 0-11-2.4-12.2-6.8z" stroke-dasharray="3.2 3.2" class="ico-accent"/>
    <path d="M28.5 40.5l11.8-11.8 3.6 3.6-11.8 11.8-5.2 1.6z"/>
    <path d="M37.6 31.4l3.6 3.6"/>`,
  // AR グラス
  view: `
    <path d="M5 19.5h38v9.5a6.5 6.5 0 0 1-6.5 6.5h-6.2l-3.6-4.2h-5.4l-3.6 4.2h-6.2A6.5 6.5 0 0 1 5 29z"/>
    <path d="M5 23l-3 1.6M43 23l3 1.6"/>
    <path d="M38 5v7M34.5 8.5h7" class="ico-accent"/>
    <path d="M12 25.5h7M29 25.5h7" opacity=".45"/>`,
  // 3D（立方体）
  cube: `
    <path d="M24 4.5l16.5 9.3v20.4L24 43.5 7.5 34.2V13.8z"/>
    <path d="M7.5 13.8L24 23.1l16.5-9.3M24 23.1v20.4"/>
    <path d="M15.7 9.2l16.5 9.3" opacity=".35"/>`,
  // 転送（稲妻）
  bolt: `
    <path d="M27.5 4L11 27.5h11.5L19.5 44 37 19.5H25.5z"/>`,
  // 3 点
  points: `
    <path d="M14 14h20L24 35z" stroke-dasharray="3 3" opacity=".7"/>
    <circle cx="14" cy="14" r="4.4" fill="${MK.right}" stroke="none"/>
    <circle cx="34" cy="14" r="4.4" fill="${MK.left}" stroke="none"/>
    <circle cx="24" cy="35" r="4.4" fill="${MK.xiphoid}" stroke="none"/>`,
  // ベッド（病棟・救急外来）
  bed: `
    <path d="M5 37V12M5 29h38v8M43 29v-4.5a6 6 0 0 0-6-6H20.5V29"/>
    <circle cx="12.5" cy="22.5" r="3.6"/>`,
  // PACS（サーバ）＋ CD-ROM
  pacs: `
    <rect x="4.5" y="6.5" width="23" height="9.5" rx="2"/>
    <rect x="4.5" y="19.5" width="23" height="9.5" rx="2"/>
    <path d="M9 11.25h6M9 24.25h6"/>
    <circle cx="34.5" cy="33" r="9.5"/>
    <circle cx="34.5" cy="33" r="2.6"/>
    <path d="M16 29v6.5h8.5" opacity=".6"/>`,
  // 映像共有（モニター＋電波）
  share: `
    <rect x="4.5" y="9.5" width="28" height="20" rx="2.5"/>
    <path d="M12.5 38.5h12M18.5 29.5v9"/>
    <path d="M37 21.5a5.5 5.5 0 0 1 5.5 5.5M37 14.5a12.5 12.5 0 0 1 9 4" />
    <circle cx="37.5" cy="27.5" r="1.6" class="ico-fill"/>`,
  // ---- 構成図用 ----
  monitor: `
    <rect x="3.5" y="6" width="41" height="27" rx="2.5"/>
    <path d="M17 42.5h14M24 33v9.5"/>`,
  server: `
    <rect x="9" y="4.5" width="30" height="11" rx="2"/>
    <rect x="9" y="18.5" width="30" height="11" rx="2"/>
    <rect x="9" y="32.5" width="30" height="11" rx="2"/>
    <path d="M14 10h7M14 24h7M14 38h7"/>
    <circle cx="33.5" cy="10" r="1.3" class="ico-fill"/>
    <circle cx="33.5" cy="24" r="1.3" class="ico-fill"/>
    <circle cx="33.5" cy="38" r="1.3" class="ico-fill"/>`,
  disc: `
    <circle cx="24" cy="24" r="18"/>
    <circle cx="24" cy="24" r="4.5"/>
    <path d="M24 11a13 13 0 0 1 13 13" opacity=".45"/>`,
  hmd: `
    <path d="M4.5 17.5c0-2.8 2.2-5 5-5h29c2.8 0 5 2.2 5 5V29c0 3.6-2.9 6.5-6.5 6.5h-6.8l-3.6-4.6h-5.2l-3.6 4.6H11A6.5 6.5 0 0 1 4.5 29z"/>
    <path d="M10 18h28" opacity=".45"/>
    <path d="M4.5 22H2M43.5 22H46"/>`,
  glasses: `
    <path d="M3 18.5h42"/>
    <path d="M5.5 18.5v4.8c0 4 3.2 7.2 7.2 7.2h3.6c3.4 0 6.2-2.8 6.2-6.2v-5.8M26 18.5v5.8c0 3.4 2.8 6.2 6.2 6.2h3.6c4 0 7.2-3.2 7.2-7.2v-4.8"/>
    <path d="M22.5 21.5h3"/>`,
  phone: `
    <rect x="13.5" y="4.5" width="21" height="39" rx="4"/>
    <path d="M21 39h6"/>`,
  tablet: `
    <rect x="3.5" y="7" width="31" height="36" rx="3.5"/>
    <rect x="30.5" y="17" width="14" height="26" rx="2.6" class="ico-cut"/>
    <path d="M16 39.5h6M35.8 39.5h3.4"/>`,
  torso: `
    <path d="M15 5.5C10 7.5 7.5 11 7.5 17v25h33V17c0-6-2.5-9.5-7.5-11.5"/>
    <path d="M18.5 5.5c1.4 2.2 3.3 3.3 5.5 3.3s4.1-1.1 5.5-3.3"/>`,
  check: `<path d="M12 25l8 8 16-17"/>`,
  // 背景: 肺（空気を含む）
  lungs: `
    <path d="M24 5v15M24 20l-5 5M24 20l5 5"/>
    <path d="M19 13.5c-2.6-1.6-5.5.2-7.6 3.4C8.2 21.8 6.5 29 6.5 35.5c0 4 2.4 6.2 6 5.6 3.4-.6 6.5-2.2 7.6-5.1.7-1.8.9-4.6.9-7.5V16.8c0-1.4-.7-2.6-2-3.3z"/>
    <path d="M29 13.5c2.6-1.6 5.5.2 7.6 3.4 3.2 4.9 4.9 12.1 4.9 18.6 0 4-2.4 6.2-6 5.6-3.4-.6-6.5-2.2-7.6-5.1-.7-1.8-.9-4.6-.9-7.5V16.8c0-1.4.7-2.6 2-3.3z"/>
    <circle cx="13.5" cy="30" r="1.4" class="ico-fill" opacity=".6"/><circle cx="16.5" cy="24" r="1.1" class="ico-fill" opacity=".6"/>
    <circle cx="34.5" cy="30" r="1.4" class="ico-fill" opacity=".6"/><circle cx="31.5" cy="24" r="1.1" class="ico-fill" opacity=".6"/>`,
  // 背景: 注意
  alert: `
    <path d="M24 6L44 41H4z"/>
    <path d="M24 19v10"/>
    <circle cx="24" cy="34.5" r="1.5" class="ico-fill"/>`,
  // 背景: 見える化（目）
  eye: `
    <path d="M3.5 24S11 11.5 24 11.5 44.5 24 44.5 24 37 36.5 24 36.5 3.5 24 3.5 24z"/>
    <circle cx="24" cy="24" r="6.5"/>
    <circle cx="24" cy="24" r="2" class="ico-fill"/>`,
};

/** アイコンを <svg> 文字列にする */
export function iconSVG(name, { size = 48, cls = '' } = {}) {
  return `<svg class="ico ${cls}" viewBox="0 0 48 48" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
}

/** 4 ステップ（ステップの見出し: 「CTを撮る、マーカを確認する、範囲をなぞる、そして見る。」） */
export const FOUR_STEPS = [
  {
    id: 'ct', icon: 'ct', title: 'CTを撮る',
    desc: '体表に3点のマーカを貼って胸部CTを撮影。PACSまたはCD-ROMから取り込みます。',
    stage: '胸部CT（3点マーカを貼って撮影）',
  },
  {
    id: 'marker', icon: 'marker', title: 'マーカを確認する',
    desc: '3D構成したモデルで、自動認識された3点のマーカを確認します。',
    stage: '3点マーカ：右鎖骨中線・左鎖骨中線・剣状突起',
  },
  {
    id: 'trace', icon: 'trace', title: '範囲をなぞる',
    desc: 'CT画像の上で関心領域をなぞります。2点ラインも引けます。',
    stage: '関心領域（デモ用の結節）',
  },
  {
    id: 'view', icon: 'view', title: 'そして見る',
    desc: 'ARグラスへ転送し、3点で位置合わせして体表に重ねて表示します。',
    stage: 'ARグラスで体表に重ねて表示',
  },
];
export const STEP_HEADLINE = 'CTを撮る、マーカを確認する、範囲をなぞる、そして見る。';

/** 価値訴求カード（仕様 1 章）。research: true は研究開発中・未承認の機能を含むもの。 */
export const VALUES = [
  {
    id: '3d', icon: 'cube', title: '胸部CTから3Dモデルまで', metric: '約8分', unit: '目安',
    desc: '臓器を自動で抽出し、構造ごとの3Dモデルを構成します。処理中は席を離れることもできます。',
    research: true, researchNote: '臓器の自動抽出（AI）',
    short: '約8分で3Dモデル', shortUnit: '目安',
  },
  {
    id: 'transfer', icon: 'bolt', title: 'ワンクリックでARグラスへ', metric: '約1秒', unit: '目安',
    desc: '送り先は Meta Quest 3、XREAL（Beam Pro）、iPad・iPhone。転送ボタンは全端末で共通です。',
    short: 'ワンクリック・約1秒で転送', shortUnit: '目安',
  },
  {
    id: 'markers', icon: 'points', title: '体表への重ね合わせ', metric: '3点マーカ',
    desc: '右鎖骨中線・左鎖骨中線・剣状突起の3点で、3Dモデルを患者の体表に重ねます。',
    dots: true,
    short: '3点マーカで重ね合わせ',
  },
  {
    id: 'compact', icon: 'bed', title: '大型機器の搬入', metric: '不要',
    desc: 'グラス単体で表示するため、病棟や救急外来での利用も想定しています。',
    short: '大型機器の搬入は不要',
  },
  {
    id: 'pacs', icon: 'pacs', title: 'PACS接続', metric: '対応',
    desc: '院内のPACSから画像を取得します。CD-ROMからの取込にも対応します。',
    unit: 'CD-ROMも可',
    short: 'PACS接続（CD-ROMも可）',
  },
  {
    id: 'share', icon: 'share', title: '映像共有', metric: 'ミラーリング',
    desc: 'グラスの映像を手術室のモニターやiPadに映し、グラスを着けていない医師とも同じ映像を見られます。',
    research: true,
    short: '映像共有（ミラーリング）',
  },
];

const MARKER_LEGEND = [
  { name: '右鎖骨中線', color: MK.right },
  { name: '左鎖骨中線', color: MK.left },
  { name: '剣状突起', color: MK.xiphoid },
];

/** 価値訴求カード（はじめに用・詳細） */
export function valueCard(v) {
  return h('article', { class: 'vcard' + (v.research ? ' is-research' : ''), dataset: { id: v.id } },
    h('div', { class: 'vcard-top' },
      h('span', { class: 'vcard-icon', html: iconSVG(v.icon, { size: 30 }) }),
      v.research ? researchBadge() : null),
    h('div', { class: 'vcard-title' }, v.title),
    h('div', { class: 'vcard-metric' },
      h('span', { class: 'vcard-metric-main' }, v.metric),
      v.unit ? h('span', { class: 'vcard-metric-unit' }, `（${v.unit}）`) : null),
    h('p', { class: 'vcard-desc' }, v.desc),
    v.dots ? h('div', { class: 'vcard-dots' }, MARKER_LEGEND.map((m) => h('span', {}, h('i', { style: { background: m.color } }), m.name))) : null,
    v.researchNote ? h('div', { class: 'vcard-note' }, `${v.researchNote}は研究開発中の機能です。`) : null);
}

/** 価値訴求（まとめ用・簡易版） */
export function valueTile(v) {
  return h('div', { class: 'vtile' + (v.research ? ' is-research' : '') },
    h('span', { class: 'vtile-icon', html: iconSVG(v.icon, { size: 24 }) }),
    h('span', { class: 'vtile-text' },
      h('span', {}, v.short, v.shortUnit ? h('small', {}, `（${v.shortUnit}）`) : null),
      v.research ? researchBadge() : null));
}
