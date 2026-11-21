// =============================================================================
// 3D構成（S3）
//   左：処理の進捗（DICOM読込 → 臓器の自動抽出 → 3Dモデル出力 → 軽量化・端末用変換）と
//       抽出された構造のチェックリスト
//   中央：3D モデルが組み上がる様子（ワイヤーフレーム → ソリッド）
//   右：2D CT ビューア（縦隔／肺野・スライス送り・ズーム／パン）。処理中も操作できる
// 実機の目安は約8分。デモでは約10秒に短縮し、［スキップ］で早送りできる。
// =============================================================================
import '../styles/screens/reconstruct.css';
import { h, researchBadge } from '../ui/dom.js';
import { state, setState, navigate, currentCase } from '../app/state.js';
import { studyDateTime } from '../data/cases.js';
import { createViewer } from '../three/viewer.js';
import { getAnatomyGeometries } from '../three/meshing.js';
import { createCtViewer, SLICE_STEP } from '../ui/ctViewer.js';
import {
  STAGES, STAGE, TOTAL, REAL_MINUTES, CHECKLIST, CHECK_BY_KEY,
  revealedCount, checkedCount, stageProgress, activeStage, lerp, easeOut,
} from './reconstruct/pipeline.js';
import { createBuildScene } from './reconstruct/buildScene.js';
import { createSegOverlay } from './reconstruct/segOverlay.js';

const POSITION_LABEL = { supine: '仰臥位', right: '右側臥位', left: '左側臥位' };
const fmtInt = (n) => Math.round(n).toLocaleString('ja-JP');
const INITIAL_Z = 40;
const SKIP_SPEED = 12;

const ICON_CLOCK = '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><circle cx="8" cy="8" r="6.3" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 4.4V8l2.5 1.6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
const ICON_FF = '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M2 3.5v9l5.5-4.5zM8.5 3.5v9L14 8z" fill="currentColor"/></svg>';
const ICON_REPLAY = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3.2 8a4.8 4.8 0 1 0 1.5-3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M3 2.4v3.1h3.1" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICON_CHEVRON = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICON_CLOSE = '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M3.5 3.5l9 9m0-9-9 9" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';
const ICON_CHECK = '<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICON_TICK = '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICON_RESET = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><circle cx="8" cy="8" r="2.2" fill="currentColor"/><path d="M8 1.5v2.2M8 12.3v2.2M1.5 8h2.2M12.3 8h2.2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="8" cy="8" r="4.6" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>';

export default {
  id: 'reconstruct',
  title: '3D構成',
  frame: 'pc',

  mount(root, ctx) {
    const { signal } = ctx;
    // URL から直接開いた場合も、取込は済んでいるものとして扱う
    if (!state.imported) setState({ imported: true });
    const cs = currentCase();
    const totalImages = cs.series.reduce((a, s) => a + s.images, 0);
    const timers = new Set();
    const later = (fn, ms) => { const id = setTimeout(() => { timers.delete(id); fn(); }, ms); timers.add(id); return id; };

    // -------------------------------------------------------------------------
    // ツールバー（右上に［閉じる］）
    // -------------------------------------------------------------------------
    const statusPill = h('span', { class: 'rc-status', role: 'status' });
    const closeBtn = h('button', { class: 'btn btn-ghost btn-sm rc-close', title: 'メイン画面に戻る', onclick: () => navigate('home') },
      h('span', { class: 'rc-ico', html: ICON_CLOSE }), '閉じる');
    const toolbar = h('div', { class: 'pc-toolbar rc-toolbar' },
      h('strong', { class: 'rc-tb-title' }, '3D構成'),
      h('div', { class: 'rc-tb-meta' },
        h('span', { class: 'rc-tb-id mono' }, cs.id),
        h('span', { class: 'rc-tb-name' }, cs.name),
        h('span', { class: 'rc-tb-item rc-tb-date' }, studyDateTime(cs)),
        h('span', { class: 'rc-tb-item rc-tb-desc' }, cs.description),
        h('span', { class: 'rc-tb-pos' }, `体位：${POSITION_LABEL[state.position] || '仰臥位'}`)),
      h('div', { class: 'rc-tb-spacer' }),
      statusPill,
      closeBtn);

    // -------------------------------------------------------------------------
    // 左：進捗パネル
    // -------------------------------------------------------------------------
    const totalPct = h('span', { class: 'rc-total-pct mono' }, '0%');
    const totalFill = h('span');
    const totalBar = h('div', { class: 'progress rc-total-bar', role: 'progressbar', 'aria-label': '3D構成の進捗', 'aria-valuemin': '0', 'aria-valuemax': '100' }, totalFill);
    const remainEl = h('span', { class: 'rc-remain' });
    const stageEls = STAGES.map((s, i) => {
      const icon = h('span', { class: 'rc-stage-icon' }, String(i + 1));
      const pct = h('span', { class: 'rc-stage-pct mono' });
      const fill = h('span');
      const bar = h('div', { class: 'progress rc-stage-bar' }, fill);
      const el = h('li', { class: 'rc-stage is-pending', dataset: { stage: s.id } },
        icon,
        h('div', { class: 'rc-stage-main' },
          h('div', { class: 'rc-stage-head' }, h('span', { class: 'rc-stage-label' }, s.label), bar, pct),
          s.ai ? h('div', { class: 'rc-stage-flag' }, researchBadge(), h('span', { class: 'rc-flag-text' }, 'AIによる自動抽出')) : null));
      return { s, el, icon, pct, fill, bar, cache: {} };
    });

    const countEl = h('span', { class: 'rc-count mono' });
    const stList = h('ul', { class: 'rc-st-list' });
    const items = CHECKLIST.map((c) => {
      const el = h('li', {
        class: 'rc-st is-pending', dataset: { key: c.key }, style: { '--c': c.color },
        onpointerenter: () => hover(c.key, 'list'),
        onpointerleave: () => hover(null, 'list'),
      },
      h('span', { class: 'rc-st-dot' }),
      h('span', { class: 'rc-st-name' }, c.name),
      h('span', { class: 'rc-st-mark' }));
      stList.appendChild(el);
      return { c, el, st: 'pending' };
    });

    const progressSec = h('section', { class: 'rc-card rc-prog', 'aria-label': '処理の進捗' },
      h('div', { class: 'rc-sec-head' }, h('span', { class: 'rc-sec-title' }, '処理の進捗'), remainEl, totalPct),
      totalBar,
      h('div', { class: 'rc-eta' }, h('span', { class: 'rc-ico', html: ICON_CLOCK }), `目安 約${REAL_MINUTES}分（この間は席を離れても可）`),
      h('ol', { class: 'rc-stages' }, stageEls.map((x) => x.el)),
      h('div', { class: 'rc-demo-note' }, h('span', { class: 'rc-ico', html: ICON_FF }), 'デモでは処理時間を短縮して表示しています'));
    const structSec = h('section', { class: 'rc-card rc-structs', 'aria-label': '抽出された構造' },
      h('div', { class: 'rc-sec-head' }, h('span', { class: 'rc-sec-title' }, '抽出された構造'), countEl),
      stList);
    const side = h('aside', { class: 'rc-side' }, progressSec, structSec);

    // -------------------------------------------------------------------------
    // 中央：3D ビュー
    // -------------------------------------------------------------------------
    const threeHost = h('div', { class: 'three-host rc-three' });
    const vpStage = h('div', { class: 'rc-vp-stage' });
    const autoBtn = h('button', { class: 'chip is-on rc-auto', 'aria-pressed': 'true', title: '3Dモデルをゆっくり左右に回して表示します', onclick: () => setAuto(!build?.autoOrbit) }, '自動回転');
    const resetBtn = h('button', { class: 'icon-btn rc-reset', title: '視点をリセット', 'aria-label': '視点をリセット', onclick: () => resetView(), html: ICON_RESET });
    const tip = h('div', { class: 'rc-tip', 'aria-hidden': 'true' });
    const banner = h('div', { class: 'rc-banner', role: 'status' },
      h('span', { class: 'rc-banner-ico', html: ICON_CHECK }),
      h('div', {},
        h('div', { class: 'rc-banner-title' }, '3D構成が完了しました'),
        h('div', { class: 'rc-banner-sub' }, `${CHECKLIST.length} 構造の3Dモデルを作成し、端末用に変換しました`)));
    // WebGL が使えない環境でだけ表示するメッセージ（通常は DICOM 読込の表示中に裏でモデルを準備する）
    const loading = h('div', { class: 'rc-loading is-hidden' });
    const view3d = h('section', { class: 'rc-view', 'aria-label': '3Dモデルのプレビュー' },
      threeHost,
      h('div', { class: 'rc-vp-label' }, h('b', {}, '3Dモデル'), h('span', {}, '合成ファントム（デモ）')),
      h('div', { class: 'rc-vp-tools' }, autoBtn, resetBtn),
      vpStage,
      h('div', { class: 'rc-vp-legend' }, h('span', { class: 'rc-legend-swatch' }), '2D表示中のスライス位置'),
      h('div', { class: 'rc-vp-hint' }, 'ドラッグ：回転　ホイール：拡大'),
      loading, tip, banner);

    // -------------------------------------------------------------------------
    // 右：2D CT ビューア
    // -------------------------------------------------------------------------
    const segChip = h('button', { class: 'chip is-on rc-seg-chip', 'aria-pressed': 'true', title: '抽出済みの構造を色で重ねて表示します', onclick: () => toggleSeg() },
      h('span', { class: 'dot' }), '抽出結果を重ねる');
    const ctHost = h('div', { class: 'rc-ct-host' });
    const ctPanel = h('section', { class: 'rc-ct', 'aria-label': '2D画像' },
      h('div', { class: 'rc-ct-head' },
        h('span', { class: 'rc-sec-title' }, '2D画像（軸位断）'),
        h('span', { class: 'rc-ct-sub' }, '処理中も確認できます'),
        h('div', { class: 'rc-tb-spacer' }),
        segChip),
      ctHost);

    // -------------------------------------------------------------------------
    // 下：アクションバー
    // -------------------------------------------------------------------------
    const hint = h('span', { class: 'hint rc-hint' });
    const skipBtn = h('button', { class: 'btn btn-ghost rc-skip', title: '処理の表示を早送りします', onclick: () => skip() },
      h('span', { class: 'rc-ico', html: ICON_FF }), 'スキップ');
    const replayBtn = h('button', { class: 'btn btn-ghost rc-replay', onclick: () => replay() },
      h('span', { class: 'rc-ico', html: ICON_REPLAY }), 'もう一度再生');
    const nextBtn = h('button', { class: 'btn btn-accent btn-lg rc-next', onclick: () => navigate('marker') },
      '次へ：マーカ確認', h('span', { class: 'rc-ico', html: ICON_CHEVRON }));
    const actionBar = h('div', { class: 'action-bar rc-actions' }, hint, h('div', { class: 'spacer' }), skipBtn, replayBtn, nextBtn);

    const screen = h('div', { class: 'pc-screen rc' }, toolbar, h('div', { class: 'rc-body' }, side, view3d, ctPanel), actionBar);
    root.appendChild(screen);

    // -------------------------------------------------------------------------
    // 2D CT ビューアと抽出結果の重ね表示
    // -------------------------------------------------------------------------
    let shownChecked = -1;
    const ct = createCtViewer(ctHost, { z: INITIAL_Z, patientLabel: cs.id });
    const seg = createSegOverlay(ct, { isVisible: (key) => CHECK_BY_KEY[key] && CHECK_BY_KEY[key].index < shownChecked, signal });
    ct.onSliceChange((z) => build?.setSliceZ(z));
    function toggleSeg() {
      const on = !seg.enabled;
      seg.setEnabled(on);
      segChip.classList.toggle('is-on', on);
      segChip.setAttribute('aria-pressed', String(on));
    }

    // -------------------------------------------------------------------------
    // 3D ビュー
    // -------------------------------------------------------------------------
    let viewer = null;
    let build = null;
    let sceneReady = false;
    try {
      viewer = createViewer(threeHost, { background: null, fov: 32, cameraPos: [0, 120, 900], target: [0, -6, 0] });
      viewer.controls?.addEventListener('start', () => { if (build?.autoOrbit) setAuto(false); });
      build = createBuildScene(viewer);
      build.setSliceZ(ct.z);
      viewer.onFrame((dt) => { build?.updateCamera(dt); build?.apply(T); });
    } catch {
      viewer?.dispose();
      viewer = null;
      build = null;
      loading.replaceChildren('この環境では3D表示を利用できません（WebGL）。2D画像と進捗は表示できます。');
      loading.classList.remove('is-hidden');
      loading.classList.add('is-error');
    }
    getAnatomyGeometries().then((geoms) => {
      if (signal.aborted) return;
      build?.setGeometries(geoms);
      sceneReady = true;
    });

    function setAuto(on) {
      build?.setAutoOrbit(on);
      autoBtn.classList.toggle('is-on', on);
      autoBtn.setAttribute('aria-pressed', String(on));
    }
    function resetView() {
      if (!build?.ready) return;
      autoBtn.classList.add('is-on');
      autoBtn.setAttribute('aria-pressed', 'true');
      const resume = build.resetView();
      later(() => { if (autoBtn.classList.contains('is-on')) resume(); }, 720);
    }

    // ホバーで構造名を表示・強調、クリックでその高さの 2D 画像へ
    let hoverKey = null;
    let pickPending = false;
    let lastPick = 0;
    let down = null;
    let hoverSig = null;
    function hover(key, src) {
      if (T < TOTAL || !build?.ready) key = null;
      const sig = key ? `${key}|${src}` : null;
      if (sig === hoverSig) return;
      hoverSig = sig;
      hoverKey = key;
      for (const it of items) it.el.classList.toggle('is-hover', it.c.key === key);
      build?.setHighlight(key, { dim: src === 'list' });
    }
    threeHost.addEventListener('pointermove', (e) => {
      if (T < TOTAL || !build?.ready || e.buttons) { tip.classList.remove('is-show'); return; }
      const now = performance.now();
      if (pickPending || now - lastPick < 45) return;
      pickPending = true;
      requestAnimationFrame(() => {
        pickPending = false;
        lastPick = performance.now();
        if (signal.aborted || !build) return;
        const hit = build.pick(e.clientX, e.clientY);
        const r = view3d.getBoundingClientRect();
        if (hit?.key) {
          const c = CHECK_BY_KEY[hit.key];
          tip.replaceChildren(h('span', { class: 'rc-tip-dot', style: { background: c.color } }), h('b', {}, c.name), h('span', { class: 'rc-tip-sub' }, 'クリックで2D画像へ'));
          tip.style.left = `${e.clientX - r.left}px`;
          tip.style.top = `${e.clientY - r.top}px`;
          tip.classList.add('is-show');
          threeHost.style.cursor = 'pointer';
          hover(hit.key, '3d');
        } else {
          tip.classList.remove('is-show');
          threeHost.style.cursor = '';
          hover(null, '3d');
        }
      });
    }, { signal });
    threeHost.addEventListener('pointerleave', () => { tip.classList.remove('is-show'); threeHost.style.cursor = ''; hover(null, '3d'); }, { signal });
    threeHost.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; tip.classList.remove('is-show'); }, { signal });
    threeHost.addEventListener('pointerup', (e) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) { down = null; return; }
      down = null;
      if (T < TOTAL || !build?.ready) return;
      const hit = build.pick(e.clientX, e.clientY);
      if (hit) ct.setZ(hit.point.y); // Three.js の Y = 患者の z（頭尾方向）
    }, { signal });

    // -------------------------------------------------------------------------
    // タイムライン（仮想時刻 T）
    // -------------------------------------------------------------------------
    let T = state.reconstructed ? TOTAL : 0;
    let running = !state.reconstructed;
    let speed = 1;
    let raf = 0;
    let lastNow = performance.now();

    function tick(now) {
      raf = requestAnimationFrame(tick);
      const dt = Math.min(0.25, Math.max(0, (now - lastNow) / 1000));
      lastNow = now;
      if (running) {
        let nt = T + dt * speed;
        // ジオメトリの準備ができるまでは、DICOM読込の終わりで待つ
        if (!sceneReady) nt = Math.min(nt, STAGE.load.end - 0.12);
        T = Math.min(TOTAL, nt);
        if (T >= TOTAL) complete();
      }
      render();
    }

    const set = (obj, k, v, fn) => { if (obj[k] !== v) { obj[k] = v; fn(v); } };
    const ui = {};
    function render() {
      const done = T >= TOTAL;
      const pct = Math.floor((T / TOTAL) * 100);
      set(ui, 'pct', pct, (v) => {
        totalPct.textContent = `${v}%`;
        totalFill.style.width = `${v}%`;
        totalBar.setAttribute('aria-valuenow', String(v));
      });
      set(ui, 'remain', done ? -1 : Math.max(1, Math.ceil((1 - T / TOTAL) * REAL_MINUTES)), (v) => {
        remainEl.textContent = v < 0 ? '' : `残り 約${v}分`;
        remainEl.title = v < 0 ? '' : '実機での目安';
      });
      totalBar.classList.toggle('is-done', done);

      // 段階ごと
      const act = activeStage(T);
      const nRevealed = revealedCount(T);
      const nChecked = checkedCount(T);
      for (const x of stageEls) {
        const { s } = x;
        const p = stageProgress(s, T);
        const st = T >= s.end ? 'done' : act === s && (running || T > 0) ? 'active' : 'pending';
        set(x.cache, 'st', st, (v) => {
          x.el.className = `rc-stage is-${v}`;
          x.icon.innerHTML = v === 'done' ? ICON_TICK : String(STAGES.indexOf(s) + 1);
          x.bar.classList.toggle('is-done', v === 'done');
        });
        const w = Math.round(p * 1000) / 10;
        set(x.cache, 'w', w, (v) => { x.fill.style.width = `${v}%`; });
        set(x.cache, 'pct', st === 'pending' ? '' : st === 'done' ? '完了' : `${Math.floor(p * 100)}%`, (v) => { x.pct.textContent = v; });
      }

      // チェックリスト
      items.forEach((it, i) => {
        const st = i < nChecked ? 'done' : i < nRevealed ? 'active' : 'pending';
        if (it.st !== st) {
          const wasActive = it.st === 'active';
          it.st = st;
          it.el.className = `rc-st is-${st}${st === 'done' && wasActive ? ' just-done' : ''}${hoverKey === it.c.key ? ' is-hover' : ''}`;
          if (st === 'active') keepVisible(it.el);
        }
      });
      set(ui, 'count', nChecked, (v) => { countEl.textContent = `${v} / ${CHECKLIST.length}`; });
      if (nChecked !== shownChecked) { shownChecked = nChecked; seg.refresh(); }

      // 3D ビューの段階表示・ステータス
      set(ui, 'vp', act ? stageSub(act, stageProgress(act, T), nRevealed) : '3D構成 完了', (v) => {
        vpStage.replaceChildren(done ? h('span', { class: 'rc-ico', html: ICON_TICK }) : h('span', { class: 'rc-vp-dot' }), v);
        vpStage.classList.toggle('is-done', done);
      });
      set(ui, 'status', done ? 'done' : 'run', (v) => {
        statusPill.className = `rc-status is-${v}`;
        statusPill.replaceChildren(...(v === 'done'
          ? [h('span', { class: 'rc-ico', html: ICON_TICK }), '3D構成 完了']
          : [h('span', { class: 'spinner' }), '3D構成中']));
      });
      updateActions();
    }

    /** 実行中の段階で、いま何をしているか（3D ビュー下部の表示） */
    function stageSub(s, p, nRevealed) {
      switch (s.id) {
        case 'load':
          return `DICOMを読込中　${fmtInt(p * totalImages)} / ${totalImages} 画像`;
        case 'extract':
          return nRevealed ? `臓器を抽出中：${CHECKLIST[nRevealed - 1].name}（${nRevealed} / ${CHECKLIST.length}）` : '解析の準備中…';
        case 'output':
          return `3Dモデルを出力中：ワイヤーフレーム → ソリッド`;
        case 'convert': {
          const tri = build?.triangles || 270000;
          return `軽量化・端末用に変換中：ポリゴン数 ${fmtInt(lerp(tri, tri * 0.25, easeOut(p)))}`;
        }
        default: return '';
      }
    }
    // チェックリストが枠からはみ出す場合、処理中の項目が見えるようにスクロール
    function keepVisible(el) {
      const box = stList;
      const top = el.offsetTop - box.offsetTop;
      if (top < box.scrollTop) box.scrollTop = top - 4;
      else if (top + el.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTop = top + el.offsetHeight - box.clientHeight + 4;
    }

    function updateActions() {
      const done = T >= TOTAL;
      set(ui, 'actions', `${done}|${speed > 1}|${state.reconstructed}`, () => {
        skipBtn.hidden = done;
        skipBtn.disabled = speed > 1;
        replayBtn.hidden = !done;
        nextBtn.disabled = !done && !state.reconstructed;
        nextBtn.classList.toggle('is-pulse', done);
        hint.textContent = done
          ? '3Dモデルにマウスを合わせると構造名を表示し、クリックするとその位置の2D画像を表示します。'
          : speed > 1
            ? '早送りしています…'
            : '処理中も2D画像を確認できます（ホイール：スライス送り／＋：拡大、拡大後はドラッグで移動）。';
      });
    }

    function complete() {
      running = false;
      speed = 1;
      if (!state.reconstructed || !state.imported) setState({ imported: true, reconstructed: true });
      banner.classList.remove('is-out');
      banner.classList.add('is-show');
      later(() => banner.classList.add('is-out'), 3200);
    }
    function skip() {
      if (T >= TOTAL) return;
      speed = SKIP_SPEED;
      running = true;
    }
    function replay() {
      T = 0;
      speed = 1;
      running = true;
      hover(null, 'list');
      tip.classList.remove('is-show');
      banner.classList.remove('is-show', 'is-out');
      for (const it of items) it.st = null;
      stList.scrollTop = 0;
    }

    render();
    raf = requestAnimationFrame(tick);

    // -------------------------------------------------------------------------
    // ガイドツアー（約12秒）
    // -------------------------------------------------------------------------
    async function waitUntil(t, cond, max = 15000) {
      const t0 = performance.now();
      while (!cond()) {
        t.check();
        if (performance.now() - t0 > max) return false;
        await t.sleep(100);
      }
      return true;
    }
    const sliderEl = () => ctHost.querySelector('.ct-slider');
    function thumbPoint(slider) {
      const r = slider.getBoundingClientRect();
      const f = (+slider.value - +slider.min) / ((+slider.max - +slider.min) || 1);
      return { x: r.left + 8 + f * (r.width - 16), y: r.top + r.height / 2 };
    }

    return {
      /** 検証用：仮想時刻を移動して止める（t 秒、0〜10） */
      seek(t) { T = Math.max(0, Math.min(TOTAL, t)); running = false; if (T >= TOTAL) complete(); },
      destroy() {
        cancelAnimationFrame(raf);
        for (const id of timers) clearTimeout(id);
        timers.clear();
        seg.dispose();
        build?.dispose();
        build = null;
        viewer?.dispose();
        ct.dispose();
      },
      async tour(t) {
        // 字幕は処理の進み（仮想時刻 T）に合わせて出す。遅い環境でも映像と説明がずれないようにする。
        if (T >= TOTAL || !running) replay();
        t.caption('3D構成：CTから臓器を自動で抽出し、3Dモデルをつくります。');
        await t.pointAt(stageEls[0].el, 600);
        await waitUntil(t, () => T >= STAGE.extract.start + 0.6, 6000);
        t.caption('臓器の自動抽出は研究開発中（未承認）の機能です。抽出できた構造から順にチェックが付きます。');
        await t.pointAt(stageEls[1].el, 500);
        await waitUntil(t, () => T >= 4.4, 6000);
        t.caption('実機の目安は約8分。処理中も2D画像をスクロールしたり、肺野条件に切り替えたりできます。');
        const sl = sliderEl();
        if (sl) {
          const steps = 7;
          seg.prefetch(Array.from({ length: steps }, (_, k) => ct.z - (k + 1) * SLICE_STEP));
          await t.pointAt(thumbPoint(sl), 550);
          for (let k = 0; k < steps && T < STAGE.output.start - 0.3; k++) {
            t.check();
            ct.setZ(ct.z - SLICE_STEP);
            await t.pointAt(thumbPoint(sl), 90);
          }
        }
        const lungBtn = ctHost.querySelector('.seg-btn[data-win="lung"]');
        if (lungBtn) { await t.pointAt(lungBtn, 450); await t.click(lungBtn, { move: false }); }
        if (T < STAGE.output.end - 0.5) {
          t.caption('走査面が通過したところから、ワイヤーフレームがソリッドの3Dモデルに置き換わります。');
          const r = view3d.getBoundingClientRect();
          await t.pointAt({ x: r.left + r.width * 0.62, y: r.top + r.height * 0.42 }, 700);
        }
        await waitUntil(t, () => T >= TOTAL);
        t.caption('3D構成が完了しました。次はマーカ確認に進みます。');
        await t.sleep(500);
        await t.pointAt(nextBtn, 600);
        await t.highlight(nextBtn, 1000);
      },
    };
  },
};
