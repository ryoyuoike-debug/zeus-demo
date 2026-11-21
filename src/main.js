// =============================================================================
// Zeus デモ — アプリのシェル（ヘッダー・ステッパー・画面枠・フッター・ガイドツアー）
// =============================================================================
import './styles/main.css';
import { SCREENS, STEPS } from './app/screens.js';
import { state, setState, subscribe, resetDemo, onNavigate, navigate } from './app/state.js';
import { makeTourHelpers, removeTourCursor } from './app/tour.js';
import { h, toggleSwitch, dialog, closeAllDialogs } from './ui/dom.js';
import { LOGO_SVG, DISCLAIMER } from './ui/brand.js';
import { showSettings, showVersion } from './ui/appDialogs.js';
import { getAnatomyGeometries } from './three/meshing.js';

// ---------------------------------------------------------------------------
// DOM の骨組み
// ---------------------------------------------------------------------------
const tourBtn = h('button', { class: 'btn btn-accent', onclick: () => (tour ? stopTour() : startTour()) });
const researchSwitch = toggleSwitch({
  label: '研究開発機能を表示',
  checked: state.researchMode,
  title: '研究開発中（未承認）の機能をデモに含めます',
  variant: 'research',
  onchange: (v) => setState({ researchMode: v }),
});
const header = h('header', { class: 'app-header' },
  h('div', { class: 'brand' },
    h('span', { class: 'brand-logo', html: LOGO_SVG }),
    h('span', { class: 'brand-name' }, 'Thoracentes Zeus β', h('small', {}, 'デモ')),
    h('span', { class: 'badge badge-research' }, '研究開発中')),
  h('div', { class: 'header-spacer' }),
  h('div', { class: 'header-actions' },
    h('span', { class: 'hide-sm' }, researchSwitch),
    h('button', { class: 'btn btn-ghost btn-sm hide-sm', title: 'デモをはじめからやり直す', onclick: onReset }, '↺ はじめから'),
    tourBtn));

const stepper = h('nav', { class: 'stepper', 'aria-label': 'デモの流れ' });
const screenHost = h('div', { class: 'screen-host' });
const main = h('main', { class: 'app-main' }, screenHost);
const footer = h('footer', { class: 'app-footer' }, h('span', { class: 'footer-icon' }, '⚠'), h('span', {}, DISCLAIMER));
const app = h('div', { class: 'app' }, header, stepper, main, footer);
document.getElementById('app').appendChild(app);

// ---------------------------------------------------------------------------
// ステッパー
// ---------------------------------------------------------------------------
const GROUP_LABEL = { pc: 'PCアプリ「Zeus」', hmd: 'ARグラス', research: '研究開発中' };
function visibleSteps() {
  return STEPS.filter((s) => !s.researchOnly || state.researchMode);
}
function isDone(id) {
  switch (id) {
    case 'import': return state.imported;
    case 'reconstruct': return state.reconstructed;
    case 'marker': return state.markersConfirmed;
    case 'roi': return state.roiCaseId === state.caseId && (state.roi.length > 0 || !!state.line.end);
    case 'transfer': return Object.values(state.transferred).some(Boolean);
    case 'ar': return state.registered;
    default: return false;
  }
}
function renderStepper() {
  stepper.innerHTML = '';
  let group = null, groupEl = null;
  for (const s of visibleSteps()) {
    const g = s.group || '_' + s.id;
    if (g !== group) {
      group = g;
      groupEl = h('div', { class: 'step-group' }, GROUP_LABEL[s.group] ? h('span', { class: 'step-group-label' }, GROUP_LABEL[s.group]) : null);
      stepper.appendChild(groupEl);
    }
    const btn = h('button', {
      class: 'step' + (s.id === currentId ? ' is-current' : '') + (isDone(s.id) ? ' is-done' : '') + (s.group === 'research' ? ' step-research' : ''),
      onclick: () => go(s.id),
      'aria-current': s.id === currentId ? 'step' : null,
    }, s.num ? h('span', { class: 'step-num' }, isDone(s.id) ? '✓' : s.num) : null, s.label);
    groupEl.appendChild(btn);
  }
  // 現在の画面のステップが見えるよう、ステッパーだけを横にスクロール（ページ全体は動かさない）
  const cur = stepper.querySelector('.is-current');
  if (cur && stepperScrolledFor !== currentId) {
    stepperScrolledFor = currentId;
    const sr = stepper.getBoundingClientRect(), cr = cur.getBoundingClientRect();
    if (cr.left < sr.left || cr.right > sr.right) stepper.scrollLeft += cr.left - sr.left - (sr.width - cr.width) / 2;
  }
}
let stepperScrolledFor = null;

// ---------------------------------------------------------------------------
// 画面の切り替え（ハッシュルーティング: #/roi など）
// ---------------------------------------------------------------------------
let currentId = null;
let current = null; // { id, instance, abort }
let screenSeq = 0;

function frameFor(screen, body) {
  if (screen.frame === 'pc') {
    const menu = h('div', { class: 'pc-menu' },
      h('button', { onclick: () => go('home') }, 'メイン画面'),
      h('button', { onclick: () => showSettings() }, '設定'),
      h('button', { onclick: () => showVersion() }, 'バージョン'));
    return h('div', { class: 'pc-window' },
      h('div', { class: 'pc-titlebar' },
        h('span', { class: 'app-icon', html: LOGO_SVG }),
        h('span', { class: 'pc-title' }, 'Zeus'),
        h('span', { class: 'pc-subtitle' }, `— ${screen.title}`),
        menu,
        h('div', { class: 'pc-winbtns' }, h('span', {}, '—'), h('span', {}, '☐'), h('span', {}, '✕'))),
      h('div', { class: 'pc-body' }, body));
  }
  if (screen.frame === 'hmd') {
    return h('div', { class: 'hmd-frame' }, h('div', { class: 'hmd-label' }, 'ARグラスの視野（シミュレーション）'), body);
  }
  return body;
}

function go(id, params = {}, { fromHash = false, byTour = false } = {}) {
  // ツアー以外からの画面移動（画面内のボタン、メニュー、URL など）はツアーを止める
  if (tour && !byTour) stopTour();
  const screen = SCREENS[id] ? SCREENS[id] : SCREENS.intro;
  if (screen.researchOnly && !state.researchMode) setState({ researchMode: true });
  // 前の画面で開いたダイアログを閉じてから、前の画面を破棄
  closeAllDialogs();
  if (current) {
    current.abort.abort();
    try { current.instance?.destroy?.(); } catch (e) { console.error(e); }
  }
  screenHost.innerHTML = '';
  screenHost.classList.toggle('is-flush', !!screen.flush);
  const abort = new AbortController();
  const body = h('div', { class: `screen screen-${screen.id}`, style: { height: '100%' } });
  const framed = frameFor(screen, body);
  framed.classList.add('screen-enter');
  screenHost.appendChild(framed);
  currentId = screen.id;
  const seq = ++screenSeq;
  let instance = null;
  try {
    instance = screen.mount(body, { signal: abort.signal, params, tour: !!tour }) || null;
  } catch (e) {
    console.error(e);
    body.appendChild(h('div', { class: 'panel' }, '画面の表示中にエラーが発生しました。'));
  }
  current = { id: screen.id, instance, abort, seq };
  if (!fromHash && location.hash !== `#/${screen.id}`) history.replaceState(null, '', `#/${screen.id}`);
  document.title = `${screen.title} — Thoracentes Zeus β デモ`;
  renderStepper();
  screenHost.scrollTop = 0;
  // 狭い画面ではページ全体がスクロールするので、先頭に戻す
  if (window.matchMedia('(max-width: 900px)').matches) window.scrollTo(0, 0);
  return current;
}

onNavigate((id, params) => go(id, params));
window.addEventListener('hashchange', () => {
  const id = location.hash.replace(/^#\/?/, '');
  if (id && id !== currentId) go(id, {}, { fromHash: true });
});
subscribe((s, patch) => {
  if ('researchMode' in patch) {
    const input = researchSwitch.querySelector('input');
    if (input.checked !== s.researchMode) input.checked = s.researchMode;
    if (!s.researchMode && SCREENS[currentId]?.researchOnly) go('ar');
  }
  renderStepper();
});

async function onReset() {
  const ok = await dialog({
    title: 'デモをはじめから',
    body: '進行状況（取込・マーカ確認・関心領域・転送など）をリセットして、最初の画面に戻ります。',
    buttons: [{ label: 'キャンセル', value: false }, { label: 'リセット', value: true, kind: 'primary' }],
  });
  if (!ok) return;
  stopTour();
  resetDemo();
  go('intro');
}

// ---------------------------------------------------------------------------
// ガイドツアー
// ---------------------------------------------------------------------------
let tour = null; // { abort }
const tourCaption = h('div', { class: 'tour-caption' });
const tourMeta = h('div', { class: 'tour-meta' });
const tourProgress = h('span');
const tourBar = h('div', { class: 'tour-bar', role: 'status', 'aria-live': 'polite' },
  h('span', { class: 'badge badge-warn' }, 'ガイドツアー'),
  tourCaption, tourMeta,
  h('button', { class: 'btn btn-ghost btn-sm', onclick: () => stopTour() }, '■ 停止'),
  h('div', { class: 'tour-progress' }, tourProgress));

// フッター（注意書き）の高さを CSS 変数に反映（狭い画面では折り返して高くなる）
new ResizeObserver(() => {
  document.documentElement.style.setProperty('--footer-real-h', `${Math.ceil(footer.offsetHeight)}px`);
}).observe(footer);

// 字幕バーの高さを CSS 変数に反映（PC 画面の下側の余白に使う）
const tourBarRO = new ResizeObserver(() => {
  document.documentElement.style.setProperty('--tour-bar-h', `${Math.ceil(tourBar.offsetHeight)}px`);
});

function updateTourButton() {
  // 狭い画面では短いラベル（main.css の .lbl-long / .lbl-short）
  tourBtn.replaceChildren(
    h('span', { class: 'lbl-long' }, tour ? '■ ツアーを停止' : '▶ ガイドツアー'),
    h('span', { class: 'lbl-short' }, tour ? '■ 停止' : '▶ ツアー'));
  tourBtn.title = tour ? 'ガイドツアーを停止' : 'ガイドツアーを開始';
  tourBtn.classList.toggle('btn-accent', !tour);
  tourBtn.classList.toggle('btn-ghost', !!tour);
}
updateTourButton();

async function startTour() {
  if (tour) return;
  const abort = new AbortController();
  const me = { abort };
  tour = me;
  updateTourButton();
  setState({ tourActive: true });
  resetDemo();
  setState({ tourActive: true });
  document.body.appendChild(tourBar);
  document.body.classList.add('is-touring');
  tourBarRO.observe(tourBar);
  const steps = visibleSteps().filter((s) => s.inTour !== false);
  const setCaption = (text) => { tourCaption.textContent = text; };
  const t = makeTourHelpers({ signal: abort.signal, setCaption });
  try {
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      tourMeta.textContent = `${i + 1} / ${steps.length}　${s.label}`;
      tourProgress.style.width = `${(i / steps.length) * 100}%`;
      const cur = go(s.id, {}, { byTour: true });
      t.setScrollBlock(null);
      await t.sleep(450);
      if (cur.instance?.tour) await cur.instance.tour(t);
      else await t.sleep(2500);
    }
    tourProgress.style.width = '100%';
    setCaption('ガイドツアーは以上です。各画面は自由に操作できます。');
    await t.sleep(3500);
  } catch (e) {
    if (e?.name !== 'AbortError') console.error(e);
  } finally {
    endTour(me);
  }
}
/** ツアーを止める（すぐに後片付けまで行い、次に表示する画面がツアー状態にならないようにする） */
function stopTour() {
  if (!tour) return;
  const cur = tour;
  cur.abort.abort();
  endTour(cur);
  closeAllDialogs(); // ツアーが開いたダイアログを残さない
}
function endTour(which = tour) {
  if (!which || tour !== which) return;
  tour = null;
  tourBarRO.disconnect();
  tourBar.remove();
  document.body.classList.remove('is-touring');
  removeTourCursor();
  updateTourButton();
  setState({ tourActive: false });
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && tour) stopTour(); });

// ---------------------------------------------------------------------------
// 起動
// ---------------------------------------------------------------------------
const initial = location.hash.replace(/^#\/?/, '') || 'intro';
go(initial, {}, { fromHash: true });
// 3D モデルを裏で先に作っておく（最初の 3D 画面を速く表示するため）
setTimeout(() => getAnatomyGeometries(), 600);

// デバッグ・自動テスト用
window.__zeus = { go, state, setState, navigate, startTour, stopTour };
