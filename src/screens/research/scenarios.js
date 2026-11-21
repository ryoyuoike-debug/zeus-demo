// =============================================================================
// 研究開発中の機能: 臨床シナリオ（研究用途として想定している使い方の紹介）
// 3 つのシナリオをタブで切り替え、手順ごとに簡単なイラスト（インライン SVG）を表示。
// 文言は中立に保ち、効果・安全性・手技の妥当性を示す表現は使わない。
// =============================================================================
import { h, researchBadge } from '../../ui/dom.js';

// ---------------------------------------------------------------------------
// イラスト部品（viewBox 0 0 240 150）
// ---------------------------------------------------------------------------
const TORSO = 'M104 0 L104 15 C92 22 62 24 42 31 C27 37 22 51 22 70 L25 150 L215 150 L218 70 C218 51 213 37 198 31 C178 24 148 22 136 15 L136 0 Z';
const LUNG_R = 'M113 38 C92 33 64 45 58 76 C53 106 59 128 70 136 C86 133 103 125 111 116 Z';
const LUNG_L = 'M127 38 C148 33 176 45 182 76 C187 106 181 128 170 136 C154 133 137 125 129 116 Z';
const torso = (extra = '') => `<path class="sv-torso" d="${TORSO}"/>${extra}`;
const ribs = (cls = 'sv-rib') => {
  let s = '';
  for (let i = 0; i < 6; i++) {
    const y = 44 + i * 16;
    s += `<path class="${cls}" d="M118 ${y} Q84 ${y - 5} 48 ${y + 16}"/><path class="${cls}" d="M122 ${y} Q156 ${y - 5} 192 ${y + 16}"/>`;
  }
  return s;
};
const holoLungs = (cls = '') => `<g class="sv-holo ${cls}"><path d="${LUNG_R}"/><path d="${LUNG_L}"/><path class="sv-holo-heart" d="M114 92 C126 80 150 86 150 104 C150 120 132 128 120 132 C112 124 104 108 114 92 Z"/></g>`;
const markers3 = '<circle class="sv-mk" cx="80" cy="38" r="4.2" fill="#ff8a1f"/><circle class="sv-mk" cx="160" cy="38" r="4.2" fill="#2f8bff" style="animation-delay:.25s"/><circle class="sv-mk" cx="120" cy="124" r="4.2" fill="#22c55e" style="animation-delay:.5s"/>';
const glasses = (x = 10, y = 10) => `<g class="sv-glasses" transform="translate(${x} ${y})"><rect x="0" y="0" width="40" height="17" rx="7"/><path d="M8 17 l-2 5 M32 17 l2 5"/><circle cx="12" cy="8.5" r="4"/><circle cx="28" cy="8.5" r="4"/></g>`;
const nodule = (x = 86, y = 62) => `<circle class="sv-nodule" cx="${x}" cy="${y}" r="6"/><circle class="sv-nodule-ring" cx="${x}" cy="${y}" r="10"/>`;
const xMark = (x, y, cls = '') => `<g class="sv-xmark ${cls}" transform="translate(${x} ${y})"><path d="M-6 -6 L6 6 M6 -6 L-6 6"/></g>`;
const pen = (x, y) => `<g class="sv-pen" transform="translate(${x} ${y}) rotate(-35)"><rect x="-3" y="-44" width="6" height="36" rx="2"/><path d="M-3 -8 L0 0 L3 -8 Z"/></g>`;
const drape = (wx, wy, ww, wh) => `<path class="sv-drape" fill-rule="evenodd" d="M14 22 H226 V150 H14 Z M${wx} ${wy} H${wx + ww} V${wy + wh} H${wx} Z"/><path class="sv-drape-fold" d="M30 30 L52 150 M196 26 L214 150 M150 112 L176 150 M40 118 L64 150"/><rect class="sv-drape-edge" x="${wx}" y="${wy}" width="${ww}" height="${wh}" rx="2"/>`;
const check = (x, y) => `<g transform="translate(${x} ${y})"><g class="sv-check"><circle r="11"/><path d="M-5 0 L-1 4 L6 -4"/></g></g>`;
const offToggle = (x, y) => `<g class="sv-off" transform="translate(${x} ${y})"><rect x="0" y="0" width="62" height="22" rx="11"/><circle cx="11" cy="11" r="7"/><text x="38" y="15" text-anchor="middle">3D OFF</text></g>`;

const ART = {
  overlay: () => torso(`${ribs('sv-rib is-faint')}${holoLungs('is-scan')}${markers3}${glasses(10, 8)}`),
  drapeCheck: () => torso(`<clipPath id="svw1"><rect x="66" y="50" width="76" height="56" rx="2"/></clipPath>
    <g clip-path="url(#svw1)">${holoLungs()}</g>${drape(66, 50, 76, 56)}${check(196, 36)}${glasses(10, 8)}`),
  procedureOff: () => torso(`${drape(74, 58, 60, 44)}<g class="sv-holo is-off"><path d="${LUNG_R}"/></g>${offToggle(158, 14)}`),
  skinMark: () => torso(`${holoLungs('is-dim')}${nodule(86, 64)}${xMark(86, 44, 'is-draw')}${pen(100, 40)}`),
  swab: () => `<path class="sv-skinline" d="M0 58 C60 52 180 52 240 60"/>
    <path class="sv-lung-side" d="M18 150 C26 104 62 80 120 78 C178 80 214 104 222 150 Z"/>
    ${nodule(120, 118)}
    <line class="sv-rod" x1="120" y1="118" x2="168" y2="14"/>
    <circle class="sv-rod-knob" cx="168" cy="14" r="4"/>
    ${xMark(149.5, 54)}
    <g class="sv-swab"><line x1="149.5" y1="54" x2="193.5" y2="-42"/><ellipse cx="149.5" cy="56" rx="4" ry="6" transform="rotate(25 149.5 56)"/></g>`,
  inflate: () => `    <path class="sv-lung-collapsed" d="M70 130 C64 96 82 64 120 60 C158 64 176 96 170 130 Z"/>
    <path class="sv-lung-inflate" d="M44 140 C34 86 66 34 120 30 C174 34 206 86 196 140 Z"/>
    ${nodule(104, 70)}<g class="sv-arrows"><path d="M28 86 l-10 0 m4 -4 l-4 4 l4 4"/><path d="M212 86 l10 0 m-4 -4 l4 4 l-4 4"/><path d="M120 18 l0 -10 m-4 4 l4 -4 l4 4"/></g>`,
  lungMark: () => `    <path class="sv-lung-inflate is-static" d="M44 140 C34 86 66 34 120 30 C174 34 206 86 196 140 Z"/>
    ${nodule(104, 70)}${xMark(104, 52, 'is-draw')}<g class="sv-swab is-tilt"><line x1="104" y1="48" x2="150" y2="-30"/><ellipse cx="104" cy="50" rx="4.5" ry="6.5" transform="rotate(30 104 50)"/></g>`,
  ribsOverlay: () => torso(`${ribs('sv-rib is-holo')}${markers3}${glasses(10, 8)}`),
  intercostal: () => torso(`${ribs('sv-rib is-holo')}<path class="sv-ics" d="M118 84 Q84 79 48 100 L48 116 Q84 95 118 100 Z"/><text class="sv-label" x="34" y="138">肋間</text>`),
  ports: () => torso(`${ribs('sv-rib is-holo is-dim')}${[[62, 92], [52, 112], [82, 122]].map(([x, y], i) => `<circle class="sv-port" cx="${x}" cy="${y}" r="5.5" style="animation-delay:${0.3 * i}s"/>`).join('')}${pen(98, 120)}`),
};
const svgOf = (key) => `<svg viewBox="0 0 240 150" preserveAspectRatio="xMidYMid meet" aria-hidden="true">${ART[key]()}</svg>`;

// ---------------------------------------------------------------------------
// シナリオ定義
// ---------------------------------------------------------------------------
const SCENARIOS = [
  {
    id: 'drain', label: '胸腔ドレナージ',
    lead: '手技の前に、3Dモデルを体表に重ねて位置を確認する使い方です。',
    steps: [
      { title: '重畳', text: '3点マーカで位置合わせし、3Dモデルを体表に重ねます。', art: 'overlay' },
      { title: 'ドレーピング後に確認', text: 'ドレーピングの後に、もう一度重ねて位置を確認します。', art: 'drapeCheck' },
      { title: '穿刺・ドレナージ', text: '三次元画像の表示をOFFにしてから行います。', art: 'procedureOff' },
    ],
  },
  {
    id: 'tumor', label: '肺がん手術での腫瘍同定',
    lead: '手術中に、腫瘍の位置を体表と肺の表面に示す使い方の研究です。',
    steps: [
      { title: '体表にマーキング', text: '3Dモデルを重ねて、体表に印を付けます。', art: 'skinMark' },
      { title: '綿棒を仮想オブジェクトに合わせる', text: '綿棒の向きを、仮想オブジェクトの方向に合わせます。', art: 'swab' },
      { title: '肺を膨らませる', text: '肺を膨らませた状態にします。', art: 'inflate' },
      { title: 'マーキング', text: '綿棒で示した位置に、印を付けます。', art: 'lungMark' },
    ],
  },
  {
    id: 'port', label: 'ポート配置・肋間同定',
    lead: '重畳表示だけを使い、手術の前にポートの位置や肋間を確認します。術中には使いません。',
    steps: [
      { title: '重畳', text: '3Dモデルを体表に重ねます。', art: 'ribsOverlay' },
      { title: '肋間の確認', text: '肋骨と肋間の位置を、体表の上で確認します。', art: 'intercostal' },
      { title: 'ポート位置の検討', text: '体表に印を付けて、ポートの位置を検討します。', art: 'ports' },
    ],
  },
];

export function createScenarios({ signal }) {
  let current = null;
  let cycleTimer = 0;
  let activeStep = 0;
  let paused = false;
  let shown = false;

  const tabBtns = {};
  const seg = h('div', { class: 'rs-sc-tabs', role: 'tablist' }, SCENARIOS.map((s, i) => {
    const b = h('button', { class: 'rs-sc-tab', role: 'tab', onclick: () => select(s.id) },
      h('span', { class: 'rs-sc-tab-num' }, String(i + 1)), s.label);
    tabBtns[s.id] = b;
    return b;
  }));
  const title = h('div', { class: 'rs-sc-title' });
  const lead = h('p', { class: 'rs-sc-lead' });
  const steps = h('div', { class: 'rs-sc-steps' });
  steps.addEventListener('pointerenter', () => { paused = true; }, { signal });
  steps.addEventListener('pointerleave', () => { paused = false; }, { signal });
  const card = h('div', { class: 'rs-sc-card' },
    h('div', { class: 'rs-sc-head' }, h('div', { class: 'rs-sc-head-text' }, title, lead)),
    steps);

  const el = h('section', { class: 'rs-sec rs-sc' },
    h('div', { class: 'rs-sc-top' },
      h('div', { class: 'rs-sec-title' }, '臨床シナリオ', researchBadge()),
      seg),
    card,
    h('p', { class: 'rs-note rs-sc-foot' }, '研究用途として想定しているシナリオの紹介です（イラストはイメージです）。手技の手順や有効性を示すものではありません。'));

  function select(id) {
    if (current === id) return;
    current = id;
    const s = SCENARIOS.find((x) => x.id === id);
    for (const x of SCENARIOS) {
      tabBtns[x.id].classList.toggle('is-on', x.id === id);
      tabBtns[x.id].setAttribute('aria-selected', String(x.id === id));
    }
    title.textContent = s.label;
    lead.textContent = s.lead;
    steps.innerHTML = '';
    steps.style.setProperty('--n', s.steps.length);
    s.steps.forEach((st, i) => {
      if (i > 0) steps.appendChild(h('div', { class: 'rs-sc-arrow', 'aria-hidden': 'true' }, h('span')));
      steps.appendChild(h('article', { class: 'rs-sc-step', style: { animationDelay: `${i * 0.08}s` }, onclick: () => setStep(i) },
        h('div', { class: 'rs-sc-art', html: svgOf(st.art) }),
        h('div', { class: 'rs-sc-step-head' }, h('span', { class: 'rs-sc-num' }, String(i + 1)), h('span', { class: 'rs-sc-step-title' }, st.title)),
        h('p', { class: 'rs-sc-text' }, st.text)));
    });
    setStep(0);
    restartCycle();
  }
  function setStep(i) {
    activeStep = i;
    steps.querySelectorAll('.rs-sc-step').forEach((e, k) => e.classList.toggle('is-active', k === i));
    steps.querySelectorAll('.rs-sc-arrow').forEach((e, k) => e.classList.toggle('is-active', k < i));
  }
  function restartCycle() {
    clearInterval(cycleTimer);
    if (!shown) return;
    cycleTimer = setInterval(() => {
      if (paused) return;
      const n = steps.querySelectorAll('.rs-sc-step').length;
      setStep((activeStep + 1) % n);
    }, 2400);
  }
  signal.addEventListener('abort', () => clearInterval(cycleTimer));
  select('drain');

  return {
    el,
    activate() { shown = true; restartCycle(); },
    deactivate() { shown = false; clearInterval(cycleTimer); },
    destroy() { clearInterval(cycleTimer); },
    /** ガイドツアー（約6秒） */
    async tour(t) {
      if (current !== 'drain') select('drain');
      await t.sleep(1100);
      t.caption('肺がん手術での腫瘍同定：体表へのマーキングから、仮想オブジェクトに綿棒を合わせる流れです。');
      await t.click(tabBtns.tumor);
      await t.sleep(1900);
      t.caption('ポート配置・肋間同定：重畳表示だけを使い、術中には使いません。');
      await t.click(tabBtns.port);
      await t.sleep(1500);
    },
  };
}
