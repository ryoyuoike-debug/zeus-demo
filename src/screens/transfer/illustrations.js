// =============================================================================
// 端末への転送 — インライン SVG のイラスト（PC と転送先の端末）
// いずれも汎用的な形の簡易イラストです（メーカーのロゴや製品写真は使いません）。
// 状態による見た目の変化（点灯・転送中など）は transfer.css の [data-status] で切り替えます。
// =============================================================================

/** 小さな胸部モデルのグリフ（肺・心臓・気管）。中心 (0,0)、高さ約 40 */
const CHEST_GLYPH = `
  <g class="tf-glyph">
    <path d="M0 -20 V -9" stroke="#d7e3f4" stroke-width="2.4" stroke-linecap="round"/>
    <path d="M0 -9 L -5 -4 M0 -9 L 5 -4" stroke="#c3d4ec" stroke-width="1.6" stroke-linecap="round" fill="none"/>
    <path d="M-3.5 -13 C -12 -13 -19 -3 -19 9 C -19 16 -13 19 -7 16 C -4 14 -3.5 8 -3.5 -2 Z" fill="#7fd3ff" fill-opacity=".5" stroke="#7fd3ff" stroke-width="1"/>
    <path d="M3.5 -13 C 12 -13 19 -3 19 9 C 19 16 13 19 7 16 C 4 14 3.5 8 3.5 -2 Z" fill="#9be7ff" fill-opacity=".45" stroke="#9be7ff" stroke-width="1"/>
    <ellipse cx="3.5" cy="7" rx="6" ry="7" fill="#e0566b" fill-opacity=".9"/>
    <circle cx="-11" cy="-3" r="2" fill="#ffd400"/>
  </g>`;

/** PC（ノートPC。画面に Zeus のウィンドウと 3D モデル） viewBox 200x140 */
export const PC_SVG = `
<svg class="tf-svg tf-svg-pc" viewBox="0 0 200 140" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <defs>
    <linearGradient id="tf-pc-base" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#34425f"/><stop offset="1" stop-color="#1b2438"/>
    </linearGradient>
    <radialGradient id="tf-pc-glow" cx="0.5" cy="0.55" r="0.6">
      <stop offset="0" stop-color="#1d4d8f" stop-opacity=".55"/><stop offset="1" stop-color="#050a14" stop-opacity="0"/>
    </radialGradient>
    <clipPath id="tf-pc-clip"><rect x="28" y="12" width="144" height="88" rx="3"/></clipPath>
  </defs>
  <!-- 画面 -->
  <rect x="21" y="5" width="158" height="102" rx="9" fill="#141c2e" stroke="#3a4b6e" stroke-width="1.2"/>
  <rect x="28" y="12" width="144" height="88" rx="3" fill="#060b16"/>
  <g clip-path="url(#tf-pc-clip)">
    <rect x="28" y="12" width="144" height="88" fill="url(#tf-pc-glow)"/>
    <!-- ウィンドウのタイトルバー -->
    <rect x="28" y="12" width="144" height="11" fill="#13203b"/>
    <rect x="31.5" y="14.5" width="6" height="6" rx="1.5" fill="#2f8bff"/>
    <path d="M35.3 15.3 l-2.1 2.9 h1.4 l-0.5 2 2.2-3 h-1.4z" fill="#fff"/>
    <text x="41" y="20.4" font-size="6.4" font-weight="700" fill="#c9d6ea" font-family="system-ui, sans-serif">Zeus</text>
    <rect x="150" y="16" width="4" height="1" fill="#6f7f99"/><rect x="158" y="14.5" width="4" height="4" fill="none" stroke="#6f7f99" stroke-width=".8"/>
    <path d="M165 14.5 l4 4 m0 -4 l-4 4" stroke="#6f7f99" stroke-width=".8"/>
    <!-- 左のリスト風 -->
    <g fill="#1a2a47">
      <rect x="33" y="29" width="34" height="5" rx="1.5"/>
      <rect x="33" y="37" width="34" height="5" rx="1.5" fill="#2f8bff" fill-opacity=".85"/>
      <rect x="33" y="45" width="34" height="5" rx="1.5"/>
      <rect x="33" y="53" width="26" height="5" rx="1.5"/>
    </g>
    <!-- 肋骨のアーチ -->
    <g fill="none" stroke="#f4efe4" stroke-opacity=".28" stroke-width="1.4">
      <path d="M98 40 q20 -10 44 0"/><path d="M95 50 q23 -11 50 0"/><path d="M94 60 q26 -11 52 0"/><path d="M95 70 q25 -10 50 0"/><path d="M98 80 q22 -9 44 0"/>
    </g>
    <g transform="translate(120 60) scale(1.08)">${CHEST_GLYPH}</g>
    <!-- スキャンライン（転送中に流れる） -->
    <rect class="tf-pc-scan" x="80" y="24" width="88" height="2" fill="#59a8ff" fill-opacity=".7"/>
    <!-- 送信中の矢印 -->
    <g class="tf-pc-up" transform="translate(52 82)">
      <rect x="-16" y="-8" width="32" height="14" rx="7" fill="#ff8a1f"/>
      <path d="M-6 2 l6 -6 l6 6 M0 -4 v9" stroke="#1b0d00" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round" transform="translate(0 -0.5) scale(.8)"/>
    </g>
  </g>
  <circle cx="100" cy="8.5" r="1.2" fill="#2a3652"/>
  <!-- 本体 -->
  <path d="M6 108 H194 L184 124 Q182 127 178 127 H22 Q18 127 16 124 Z" fill="url(#tf-pc-base)" stroke="#46577a" stroke-width="1"/>
  <rect x="84" y="108" width="32" height="3.5" rx="1.75" fill="#141c2e"/>
  <!-- USB ポート -->
  <rect x="181" y="113.5" width="7" height="3.6" rx="1" fill="#0b1220" stroke="#59a8ff" stroke-opacity=".7" stroke-width=".8"/>
</svg>`;

/** Meta Quest 3（白いヘッドセット。前面に縦長のセンサー部が 3 つ） viewBox 120x80 */
const QUEST_SVG = `
<svg class="tf-svg" viewBox="0 0 120 80" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <defs>
    <linearGradient id="tf-q-body" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#f6f8fc"/><stop offset=".7" stop-color="#cfd7e4"/><stop offset="1" stop-color="#aab5c8"/>
    </linearGradient>
    <linearGradient id="tf-q-pill" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#232b3b"/><stop offset="1" stop-color="#0f141e"/>
    </linearGradient>
  </defs>
  <path class="tf-strap" d="M14 46 C 3 46 2 28 15 26" stroke="#4d586f" stroke-width="5" fill="none" stroke-linecap="round"/>
  <path class="tf-strap" d="M106 46 C 117 46 118 28 105 26" stroke="#4d586f" stroke-width="5" fill="none" stroke-linecap="round"/>
  <path d="M27 60 H93 Q91 69 83 69 H37 Q29 69 27 60 Z" fill="#2a3242"/>
  <rect x="12" y="17" width="96" height="47" rx="19" fill="url(#tf-q-body)"/>
  <rect x="16" y="20" width="88" height="20" rx="10" fill="#ffffff" fill-opacity=".35"/>
  <g fill="url(#tf-q-pill)">
    <rect x="26" y="27" width="11.5" height="27" rx="5.75"/>
    <rect x="54.25" y="27" width="11.5" height="27" rx="5.75"/>
    <rect x="82.5" y="27" width="11.5" height="27" rx="5.75"/>
  </g>
  <g fill="#3a4a68">
    <circle cx="31.75" cy="34" r="2.7"/><circle cx="31.75" cy="47" r="2.7"/>
    <circle cx="60" cy="37" r="2.4"/><circle cx="60" cy="46" r="1.8"/>
    <circle cx="88.25" cy="34" r="2.7"/><circle cx="88.25" cy="47" r="2.7"/>
  </g>
  <g fill="#9fc8ff" fill-opacity=".55">
    <circle cx="30.9" cy="33.2" r=".9"/><circle cx="30.9" cy="46.2" r=".9"/><circle cx="87.4" cy="33.2" r=".9"/><circle cx="87.4" cy="46.2" r=".9"/>
  </g>
  <circle class="tf-svg-led" cx="99" cy="57" r="1.8"/>
</svg>`;

/** XREAL（AR グラス）＋ Beam Pro（ケーブルでつなぐ小型端末） viewBox 120x80 */
const XREAL_SVG = `
<svg class="tf-svg" viewBox="0 0 120 80" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <defs>
    <linearGradient id="tf-x-lens" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#22385c"/><stop offset=".55" stop-color="#111c33"/><stop offset="1" stop-color="#2a4c7e"/>
    </linearGradient>
  </defs>
  <!-- ケーブル -->
  <path class="tf-x-cable" d="M83 22 C 99 22 101 30 101 39" stroke="#56627c" stroke-width="2" fill="none" stroke-linecap="round"/>
  <!-- つる -->
  <path d="M8 21 L2 24" stroke="#56627c" stroke-width="3" stroke-linecap="round"/>
  <!-- レンズ -->
  <path d="M9 18 H43 V31 Q43 41 33 41 H18 Q9 41 9 32 Z" fill="url(#tf-x-lens)" stroke="#5a6683" stroke-width="2.4"/>
  <path d="M51 18 H85 V32 Q85 41 76 41 H61 Q51 41 51 31 Z" fill="url(#tf-x-lens)" stroke="#5a6683" stroke-width="2.4"/>
  <path class="tf-x-holo" d="M13 22 H39 V30 Q39 37 32 37 H19 Q13 37 13 31 Z M55 22 H81 V31 Q81 37 75 37 H62 Q55 37 55 30 Z" fill="#59a8ff"/>
  <path d="M15 21 L23 21 L15 33 Z M57 21 L65 21 L57 33 Z" fill="#ffffff" fill-opacity=".09"/>
  <path d="M43 22 Q47 18.5 51 22" stroke="#5a6683" stroke-width="2.4" fill="none"/>
  <rect x="7" y="15.5" width="80" height="4" rx="2" fill="#69758f"/>
  <rect x="9" y="15.9" width="76" height="1.2" rx=".6" fill="#ffffff" fill-opacity=".25"/>
  <!-- Beam Pro -->
  <rect x="88" y="38" width="26" height="40" rx="4.5" fill="#1a2030" stroke="#46526c" stroke-width="1"/>
  <rect class="tf-scr" x="91" y="42" width="20" height="31" rx="2"/>
  <g class="tf-scr-glyph" transform="translate(101 58) scale(.42)">${CHEST_GLYPH}</g>
  <circle cx="101" cy="40" r=".9" fill="#46526c"/>
  <circle class="tf-svg-led" cx="110" cy="75.2" r="1.3"/>
</svg>`;

/** iPad / iPhone（横置きタブレットと手前のスマートフォン） viewBox 120x80 */
const IOS_SVG = `
<svg class="tf-svg" viewBox="0 0 120 80" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <rect x="5" y="9" width="80" height="58" rx="7" fill="#1a2030" stroke="#46526c" stroke-width="1"/>
  <rect class="tf-scr" x="10" y="14" width="70" height="48" rx="3"/>
  <g class="tf-scr-glyph" transform="translate(42 38) scale(.8)">${CHEST_GLYPH}</g>
  <circle cx="45" cy="11.5" r=".9" fill="#46526c"/>
  <rect x="80" y="27" width="31" height="50" rx="6.5" fill="#1a2030" stroke="#46526c" stroke-width="1"/>
  <rect class="tf-scr" x="83" y="31" width="25" height="42" rx="3.5"/>
  <g class="tf-scr-glyph" transform="translate(95.5 52) scale(.5)">${CHEST_GLYPH}</g>
  <rect x="91.5" y="32.5" width="8" height="2.4" rx="1.2" fill="#0b0f18"/>
  <circle class="tf-svg-led" cx="104" cy="74.6" r="1.1"/>
</svg>`;

export const DEVICE_SVG = { quest: QUEST_SVG, xreal: XREAL_SVG, ios: IOS_SVG };

/** 小さなアイコン（送信内容のリストなど） */
export const ICONS = {
  model: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.8 20.2 7.4v9.2L12 21.2 3.8 16.6V7.4Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M3.8 7.4 12 12l8.2-4.6M12 12v9.2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
  roi: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 7.5C9 4 16.8 4.2 18.6 8.4c1.6 3.8-.9 8.9-5.6 9.9-4.6 1-9-1.6-9.4-5.2-.2-2.2 1.2-3.9 2.9-5.6Z" fill="currentColor" fill-opacity=".22" stroke="currentColor" stroke-width="1.6" stroke-dasharray="3 2.2"/></svg>',
  line: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 18.5 19 5.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="5.5" cy="18" r="2.6" fill="currentColor"/><circle cx="18.5" cy="6" r="2.6" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
  patient: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.6" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M4.8 20c.8-3.9 3.7-6 7.2-6s6.4 2.1 7.2 6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  send: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15.5V4.5M7 9l5-5 5 5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M4.5 14.5v3.2c0 1 .8 1.8 1.8 1.8h11.4c1 0 1.8-.8 1.8-1.8v-3.2" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4.2h-4.2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  usb: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v15M12 3l-2.4 3.2h4.8Z M12 13.5l-4.5-3V8.2M12 15.5l4.5-3V10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="19.5" r="1.9" fill="currentColor"/><circle cx="7.5" cy="7.4" r="1.3" fill="currentColor"/><rect x="15.3" y="8" width="2.4" height="2.4" fill="currentColor"/></svg>',
  folder: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 7.2c0-1 .8-1.7 1.7-1.7h4.2l2 2.1h7.4c1 0 1.7.8 1.7 1.7v8.5c0 1-.8 1.7-1.7 1.7H5.2c-1 0-1.7-.8-1.7-1.7Z" fill="currentColor" fill-opacity=".2" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
  clock: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M12 7.5V12l3 2" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
};
