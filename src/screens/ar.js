// =============================================================================
// S7 AR表示（ARグラスの視野のシミュレーション）
//   S7a 起動とデータ選択 … [位置合わせ]（オレンジ）/ [患者データ選択]（青）、左メニュー: 患者データ一覧・削除・全削除
//   S7b 3点位置合わせ   … 右鎖骨中線 → 左鎖骨中線 → 剣状突起。右手の OK サインで球を出し（線香花火）、
//                          マーカに合わせて [確定]。3 点そろうと 3D モデルが体表にスナップ → [ロック]
//   S7c 表示の操作       … プリセット / 透過度（臓器ごと）/ 3D表示 ON・OFF / 関心領域・ライン（なし・あり）
//                          サイドボタン: 利き手・掴み・ロック・同期
//   S7d 映像共有         … ミラーリング（手術室モニター / iPad）の子画面
//                          【区分要確認】のため研究開発機能の扱い（「研究開発機能を表示」ON のときだけ・バッジ付き）
// 背景はパススルー映像に見立てた処置室と胸部模型（すべて手続き的に生成した合成データ）。
// =============================================================================
import '../styles/screens/ar.css';
import { h, researchBadge } from '../ui/dom.js';
import { state, setState, subscribe } from '../app/state.js';
import { CASES, studyDateTime } from '../data/cases.js';
import { MARKERS } from '../data/phantom.js';
import { createArScene, SPHERE_R, ease } from './ar/scene.js';
import { PRESETS, OPACITY_TARGETS } from './ar/presets.js';
import { ICON } from './ar/icons.js';

const NOTICE = '穿刺・ドレナージを行う際は、三次元画像の表示をOFFにしてください。';
const GRAB_OPTS = [
  { id: 'none', label: '不可' },
  { id: 'right', label: '右手' },
  { id: 'left', label: '左手' },
  { id: 'both', label: '両手' },
];
const POINT_NO = ['①', '②', '③'];

// 画面を離れても保持する小さな状態（デモのリセットで初期化）
//   deleted    … グラスから削除した患者データ
//   loadedCase … グラスで読み込んだ患者データ（作業中の症例 state.caseId とは別に持つ）
const memory = { deleted: new Set(), loadedCase: null };
subscribe((_s, patch) => {
  if ('registered' in patch && 'roi' in patch && 'line' in patch) memory.deleted.clear();
  // デモのリセット・作業中の症例の切り替え（selectCase）では位置合わせが解除されるので、読み込んだ症例も忘れる
  if ('caseId' in patch && 'registered' in patch) memory.loadedCase = null;
});

const abortError = () => new DOMException('aborted', 'AbortError');
const isAbort = (e) => e?.name === 'AbortError';
const icon = (name, cls = 'ar-ic') => h('span', { class: cls, html: ICON[name] });
/** パススルー映像のざらつき用のノイズ画像（実行時に生成） */
let noiseCache = null;
function noiseUrl() {
  if (noiseCache) return noiseCache;
  const c = document.createElement('canvas');
  c.width = c.height = 160;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(160, 160);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.random() * 255;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  noiseCache = c.toDataURL('image/png');
  return noiseCache;
}

export default {
  id: 'ar',
  title: 'AR表示',
  frame: 'hmd',
  flush: false,

  mount(root, ctx) {
    const { signal } = ctx;
    // 直接 URL で開いた場合は、PC 側の手順（取込・3D構成・マーカ確認・転送）が済んでいるものとみなす
    const pre = {};
    if (!state.imported) pre.imported = true;
    if (!state.reconstructed) pre.reconstructed = true;
    if (!state.markersConfirmed) pre.markersConfirmed = true;
    if (!Object.values(state.transferred).some(Boolean)) pre.transferred = { quest: 'done' };
    if (Object.keys(pre).length) setState(pre);

    const on = (el, type, fn, opts = {}) => el.addEventListener(type, fn, { ...opts, signal });
    const wait = (ms, sig) => new Promise((resolve, reject) => {
      if (signal.aborted || sig?.aborted) return reject(abortError());
      const tm = setTimeout(resolve, ms);
      const ab = () => { clearTimeout(tm); reject(abortError()); };
      signal.addEventListener('abort', ab, { once: true });
      sig?.addEventListener('abort', ab, { once: true });
    });

    // -------------------------------------------------------------------------
    // 画面の状態
    // -------------------------------------------------------------------------
    const ui = {
      phase: 'loading', // loading | start | register | aligning | aligned | view
      listOpen: false,
      loadedCase: null,
      loadingCase: null,
      selectedCase: null,
      confirm: null, // { kind: 'one'|'all' }
      locked: false,
      hand: 'right',
      grab: 'none',
      grabMenu: false,
      preset: 'thorax',
      opTarget: 'lung',
      show3d: true,
      hasRoi: false,
      roiOn: true,
      mirrorOn: false,
      mirrorDev: 'monitor',
      toast: null,
    };
    const reg = { idx: 0, mode: 'hold', hold: 0, placed: [null, null, null], confirmed: [false, false, false], auto: false, autoAbort: null, matrix: null };
    const casesOnDevice = () => CASES.filter((c) => !memory.deleted.has(c.id));
    const caseById = (id) => CASES.find((c) => c.id === id);

    // -------------------------------------------------------------------------
    // DOM
    // -------------------------------------------------------------------------
    root.classList.add('ar-root');
    const glHost = h('div', { class: 'ar-gl' });
    const fade = h('div', { class: 'ar-fade' });
    const grain = h('div', { class: 'ar-grain' });
    grain.style.backgroundImage = `url(${noiseUrl()})`;
    const NS = 'http://www.w3.org/2000/svg';
    const fx = document.createElementNS(NS, 'svg');
    fx.setAttribute('class', 'ar-fx');
    fx.innerHTML = `
      <defs>
        <linearGradient id="arRayGrad" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#2f8bff" stop-opacity="0"/>
          <stop offset="0.55" stop-color="#4b9dff" stop-opacity="0.55"/>
          <stop offset="1" stop-color="#8cc4ff" stop-opacity="0.95"/>
        </linearGradient>
      </defs>
      <line class="ar-ray" x1="0" y1="0" x2="0" y2="0" stroke="url(#arRayGrad)" stroke-width="3" stroke-linecap="round"/>
      <circle class="ar-ray-dot" r="5" cx="-20" cy="-20"/>
      <g class="ar-hold" transform="translate(-100,-100)">
        <circle class="ar-hold-bg" r="26"/>
        <circle class="ar-hold-fg" r="26" transform="rotate(-90)"/>
      </g>`;
    const rayLine = fx.querySelector('.ar-ray');
    const rayGrad = fx.querySelector('#arRayGrad');
    const rayDot = fx.querySelector('.ar-ray-dot');
    const holdG = fx.querySelector('.ar-hold');
    const holdFg = fx.querySelector('.ar-hold-fg');
    const HOLD_C = 2 * Math.PI * 26;
    holdFg.setAttribute('stroke-dasharray', `${HOLD_C}`);
    const holdLabel = h('div', { class: 'ar-tag ar-tag-hold' }, 'OKサイン認識中…');
    const targetTag = h('div', { class: 'ar-tag ar-tag-target' }, h('i'), h('span'));
    const modelTag = h('div', { class: 'ar-tag ar-tag-model' });
    const labels = h('div', { class: 'ar-labels' }, holdLabel, targetTag, modelTag);

    // ---- 上部: ステータス（白文字 1 行）とツール ----
    const statusText = h('span', { class: 'ar-status-text' });
    const statusDot = h('i', { class: 'ar-status-dot' });
    const status = h('div', { class: 'ar-status', role: 'status', 'aria-live': 'polite' }, statusDot, statusText);
    const toastEl = h('div', { class: 'ar-toast' });
    // 映像共有（ミラーリング）は【区分要確認】→ 研究開発機能として、研究モードのときだけバッジ付きで表示
    const mirrorBtn = h('button', { class: 'ar-tool ar-tool-research', type: 'button', title: '手術室モニター・iPad へのミラーリング（研究開発中・未承認）', onclick: () => setMirror(!ui.mirrorOn) }, icon('cast'), h('span', {}, 'ミラーリング'), researchBadge());
    const recenterBtn = h('button', { class: 'ar-tool ar-tool-icon', type: 'button', title: '視点を戻す', onclick: () => scene.look.reset() }, icon('recenter'));
    const topbar = h('div', { class: 'ar-top' }, h('div', { class: 'ar-top-c' }, status, toastEl), h('div', { class: 'ar-top-r' }, recenterBtn, mirrorBtn));
    const hint = h('div', { class: 'ar-hint' }, 'ドラッグ：見回す　ホイール：近づく　ダブルクリック：視点を戻す');

    // ---- S7a: 起動パネル ----
    const alignBtn = h('button', { class: 'qbtn qbtn-orange qbtn-lg', type: 'button', onclick: () => onAlignClick() }, icon('target'), '位置合わせ');
    const selectBtn = h('button', { class: 'qbtn qbtn-blue qbtn-lg', type: 'button', onclick: () => openList() }, icon('data'), '患者データ選択');
    const startNote = h('p', { class: 'ar-note' });
    const backToMenu = h('button', { class: 'ar-link', type: 'button', onclick: () => { ui.phase = 'view'; ui.listOpen = false; render(); layoutShift(); } }, '表示メニューに戻る');
    const startPanel = h('section', { class: 'ar-panel ar-start', 'aria-label': 'Zeus 起動メニュー' },
      h('div', { class: 'ar-panel-head' }, h('span', { class: 'ar-app' }, 'Zeus'), h('span', { class: 'ar-sub' }, 'AR表示')),
      h('div', { class: 'ar-start-btns' }, alignBtn, selectBtn),
      startNote, backToMenu);

    // ---- S7a: 左メニュー（患者データ一覧・削除・全削除） ----
    const listBody = h('div', { class: 'ar-list', role: 'listbox', 'aria-label': '患者データ一覧' });
    const delBtn = h('button', { class: 'qbtn qbtn-sm', type: 'button', onclick: () => askDelete('one') }, icon('trash'), '削除');
    const delAllBtn = h('button', { class: 'qbtn qbtn-sm qbtn-danger', type: 'button', onclick: () => askDelete('all') }, '全削除');
    const confirmBox = h('div', { class: 'ar-confirm', hidden: true });
    const listPanel = h('section', { class: 'ar-panel ar-listpanel', 'aria-label': '患者データ一覧' },
      h('div', { class: 'ar-panel-head' }, icon('list'), h('span', {}, '患者データ一覧'), h('span', { class: 'ar-count' })),
      listBody,
      confirmBox,
      h('div', { class: 'ar-row ar-list-actions' }, delBtn, delAllBtn));

    // ---- S7b: 位置合わせガイド ----
    const stepEls = MARKERS.map((m, i) => h('li', { class: 'ar-step' },
      h('i', { class: 'ar-step-dot', style: `--c:${m.color}` }),
      h('span', { class: 'ar-step-name' }, `${POINT_NO[i]} ${m.name}`),
      h('span', { class: 'ar-step-state' })));
    const guideText = h('p', { class: 'ar-guide-text' });
    const confirmBtn = h('button', { class: 'qbtn qbtn-blue', type: 'button', onclick: () => confirmPoint() }, icon('check'), '確定');
    const redoBtn = h('button', { class: 'qbtn', type: 'button', onclick: () => redoRegistration() }, 'やり直し');
    const autoBtn = h('button', { class: 'qbtn qbtn-ghost', type: 'button', title: 'デモ用: 3点を自動で配置します', onclick: () => runAuto() }, 'おまかせ配置', h('small', { class: 'ar-demo-tag' }, 'デモ'));
    const lockBtn = h('button', { class: 'qbtn qbtn-orange qbtn-lg', type: 'button', onclick: () => lockModel() }, icon('lock'), 'ロック');
    const cancelBtn = h('button', { class: 'ar-link', type: 'button', onclick: () => cancelRegistration() }, '中止してメニューへ');
    const guideActions = h('div', { class: 'ar-guide-actions' }, h('div', { class: 'ar-row' }, confirmBtn, redoBtn), autoBtn);
    const doneBox = h('div', { class: 'ar-done', hidden: true },
      h('div', { class: 'ar-done-title' }, icon('check', 'ar-ic ar-ic-ok'), '位置合わせ完了'),
      h('p', { class: 'ar-guide-text' }, '3Dモデルを体表に重ねました。この位置で固定するには［ロック］を押します。'),
      h('div', { class: 'ar-row' }, lockBtn, h('button', { class: 'qbtn', type: 'button', onclick: () => redoRegistration() }, 'やり直し')));
    const guidePanel = h('section', { class: 'ar-panel ar-guide', 'aria-label': '3点位置合わせ' },
      h('div', { class: 'ar-panel-head' }, icon('target'), h('span', {}, '位置合わせ（3点）')),
      h('ol', { class: 'ar-steps' }, stepEls),
      guideText, guideActions, doneBox, cancelBtn);

    // ---- S7c: 表示メニュー ----
    const presetBtns = PRESETS.map((p) => h('button', { class: 'qbtn qbtn-preset', type: 'button', 'data-id': p.id, onclick: () => applyPreset(p.id) }, h('b', {}, p.name), h('small', {}, p.desc)));
    const opSeg = h('div', { class: 'qseg' }, OPACITY_TARGETS.map((o) => h('button', { type: 'button', 'data-id': o.id, onclick: () => { ui.opTarget = o.id; syncSlider(); render(); } }, o.name)));
    const opRange = h('input', { type: 'range', min: 0, max: 95, step: 1, value: 50, class: 'ar-range', 'aria-label': '透過度' });
    const opVal = h('span', { class: 'ar-range-val' }, '50%');
    on(opRange, 'input', () => setTransparency(+opRange.value));
    const roiSeg = h('div', { class: 'qseg qseg-2' },
      h('button', { type: 'button', 'data-v': 'off', onclick: () => setRoi(false) }, 'なし'),
      h('button', { type: 'button', 'data-v': 'on', onclick: () => setRoi(true) }, 'あり'));
    const roiNote = h('p', { class: 'ar-note ar-note-sm' });
    const driftBox = h('div', { class: 'ar-drift', hidden: true }, icon('warn'), h('span', {}, '位置合わせした位置からモデルが動いています'), h('button', { class: 'qbtn qbtn-sm', type: 'button', onclick: () => resetGrab() }, '元に戻す'));
    const menuPanel = h('section', { class: 'ar-panel ar-menu', 'aria-label': '表示メニュー' },
      h('div', { class: 'ar-panel-head' }, icon('layers'), h('span', {}, '表示メニュー'), h('span', { class: 'ar-case-chip' })),
      driftBox,
      h('div', { class: 'ar-row ar-menu-top' },
        h('button', { class: 'qbtn qbtn-orange qbtn-sm', type: 'button', onclick: () => onAlignClick() }, '位置合わせ'),
        h('button', { class: 'qbtn qbtn-blue qbtn-sm', type: 'button', onclick: () => { ui.phase = 'start'; openList(); } }, '患者データ選択')),
      h('div', { class: 'ar-sec' }, h('div', { class: 'ar-sec-title' }, 'プリセット'), h('div', { class: 'ar-presets' }, presetBtns)),
      h('div', { class: 'ar-sec' }, h('div', { class: 'ar-sec-title' }, '透過度', h('span', { class: 'ar-sec-sub' }, '臓器ごと')), opSeg,
        h('div', { class: 'ar-range-row' }, opRange, opVal)),
      h('div', { class: 'ar-sec ar-sec-roi' }, h('div', { class: 'ar-sec-title' }, '関心領域・ライン'), roiSeg, roiNote));

    // ---- サイドボタン（利き手 / 掴み / ロック / 同期） ----
    const sideVal = {};
    const sideBtn = (id, ic, label, onclick) => {
      sideVal[id] = h('small', {});
      return h('button', { class: 'sbtn', type: 'button', 'data-id': id, onclick }, icon(ic), h('span', {}, label), sideVal[id]);
    };
    const handBtn = sideBtn('hand', 'hand', '利き手', () => { ui.hand = ui.hand === 'right' ? 'left' : 'right'; render(); layoutShift(); });
    const grabBtn = sideBtn('grab', 'grab', '掴み', () => { ui.grabMenu = !ui.grabMenu; render(); });
    const lockSideBtn = sideBtn('lock', 'lock', 'ロック', () => { ui.locked = !ui.locked; render(); });
    const syncBtn = sideBtn('sync', 'sync', '同期', () => doSync());
    const grabMenu = h('div', { class: 'ar-grabmenu', hidden: true }, GRAB_OPTS.map((o) => h('button', { type: 'button', class: 'qbtn qbtn-sm', 'data-id': o.id, onclick: () => { ui.grab = o.id; ui.grabMenu = false; render(); } }, o.label)));
    const side = h('div', { class: 'ar-side', 'aria-label': 'サイドボタン' }, handBtn, grabBtn, lockSideBtn, syncBtn, grabMenu);
    const menuWrap = h('div', { class: 'ar-menuwrap' }, menuPanel, side);

    // ---- 常時の注意表示（3D表示 ON/OFF とセット） ----
    const show3dBtn = h('button', { class: 'ar-switch', type: 'button', role: 'switch', 'aria-checked': 'true', 'aria-label': '3D表示', onclick: () => set3d(!ui.show3d) },
      h('span', { class: 'ar-switch-label' }, '3D表示'),
      h('span', { class: 'ar-switch-row' }, h('span', { class: 'ar-switch-track' }, h('span', { class: 'ar-switch-thumb' })), h('b', { class: 'ar-switch-val' }, 'ON')));
    const notice = h('div', { class: 'ar-notice' }, show3dBtn, h('p', { class: 'ar-notice-text' }, icon('warn', 'ar-ic ar-ic-warn'), h('span', {}, NOTICE)));

    // ---- S7d: ミラーリングの子画面 ----
    const pipCanvas = h('canvas', { class: 'ar-pip-canvas', width: 576, height: 324 });
    const pipSeg = h('div', { class: 'qseg qseg-dark' },
      h('button', { type: 'button', 'data-v': 'monitor', onclick: () => { ui.mirrorDev = 'monitor'; render(); sizePip(); } }, icon('monitor'), '手術室モニター'),
      h('button', { type: 'button', 'data-v': 'ipad', onclick: () => { ui.mirrorDev = 'ipad'; render(); sizePip(); } }, icon('tablet'), 'iPad'));
    const pipScreen = h('div', { class: 'ar-pip-screen' }, pipCanvas, h('div', { class: 'ar-pip-badge' }, 'ミラーリング中'));
    const pip = h('section', { class: 'ar-pip', hidden: true, 'aria-label': 'ミラーリング' },
      h('div', { class: 'ar-pip-head' }, h('b', {}, 'ミラーリング'), researchBadge()),
      pipSeg,
      h('div', { class: 'ar-pip-device' }, pipScreen),
      h('p', { class: 'ar-pip-note' }, 'グラスを着けていない医師も同じ映像を確認できます'));

    // ---- 読み込み中 ----
    const loader = h('div', { class: 'ar-loader' }, h('span', { class: 'ar-spin' }), h('span', {}, '空間を認識しています…'));

    const colL = h('div', { class: 'ar-col ar-col-l' }, startPanel, listPanel, guidePanel, h('div', { class: 'ar-col-spacer' }), pip);
    const colR = h('div', { class: 'ar-col ar-col-r' }, menuWrap, h('div', { class: 'ar-col-spacer' }), notice);
    const hud = h('div', { class: 'ar-hud' }, topbar, colL, colR, hint);
    const stage = h('div', { class: 'ar-stage' }, glHost, grain, fx, labels, loader, fade);
    root.append(stage, hud);

    // -------------------------------------------------------------------------
    // 3D シーン
    // -------------------------------------------------------------------------
    const scene = createArScene(glHost, { signal });
    let isReady = false;
    scene.ready.then(() => {
      if (signal.aborted) return;
      isReady = true;
      // 関心領域・ライン（PC で設定した作業中の症例のもの）
      setTimeout(() => {
        if (signal.aborted) return;
        try {
          ui.hasRoi = scene.setRoiLine(state.roi, state.line);
        } catch (e) { console.error(e); ui.hasRoi = false; }
        scene.setRoiVisible(ui.roiOn && roiApplies());
        render();
      }, 60);
      if (state.registered) {
        // すでに位置合わせ済み → 表示メニューから（グラスで読み込んだ症例を復元）
        ui.loadedCase = memory.loadedCase || state.caseId;
        ui.selectedCase = ui.loadedCase;
        ui.locked = true;
        scene.holo.setOps(PRESETS[0].op);
        scene.holo.alignNow(null);
        ui.phase = 'view';
        syncSlider();
      } else {
        ui.phase = 'start';
        // 読み込み済み（位置合わせ前）の症例があれば、浮かんだ状態で復元
        if (memory.loadedCase) {
          ui.loadedCase = memory.loadedCase;
          ui.selectedCase = memory.loadedCase;
          scene.holo.setOps(PRESETS[0].op);
          scene.holo.appear();
        }
      }
      root.classList.add('is-ready');
      render();
      layoutShift();
    }).catch((e) => { if (!signal.aborted) console.error(e); });

    // 関心領域・ラインは、描いた症例（state.roiCaseId）を読み込んでいるときだけ重ねる
    const roiApplies = () => !!ui.loadedCase && ui.loadedCase === state.roiCaseId;

    // -------------------------------------------------------------------------
    // 描画（状態 → DOM）
    // -------------------------------------------------------------------------
    function statusLine() {
      const c = ui.loadedCase ? caseById(ui.loadedCase) : null;
      const off = ui.show3d ? '' : '　｜　3D表示：OFF';
      switch (ui.phase) {
        case 'loading': return ['空間を認識しています…', 'idle'];
        case 'start':
          if (ui.loadingCase) return [`${ui.loadingCase} を読み込んでいます…`, 'busy'];
          if (!c) return ['患者データを選択してください', 'idle'];
          return state.registered ? [`${c.id}　｜　位置合わせ完了${off}`, 'ok'] : [`${c.id}　｜　位置合わせ：未実施${off}`, 'warn'];
        case 'register': return [`位置合わせ（${Math.min(reg.idx + 1, 3)}/3）：${MARKERS[Math.min(reg.idx, 2)].name}${off}`, 'busy'];
        case 'aligning': return ['位置合わせ中…', 'busy'];
        case 'aligned': return [`位置合わせ完了　｜　${c?.id ?? ''}${off}`, 'ok'];
        case 'view': return [`位置合わせ完了　｜　${ui.locked ? 'ロック中' : 'ロック解除中'}　｜　${c?.id ?? ''}${off}`, ui.locked ? 'ok' : 'warn'];
        default: return ['', 'idle'];
      }
    }

    function renderList() {
      const list = casesOnDevice();
      listBody.innerHTML = '';
      listPanel.querySelector('.ar-count').textContent = `${list.length}件`;
      if (!list.length) {
        listBody.appendChild(h('div', { class: 'ar-empty' },
          h('p', {}, '患者データがありません。PCアプリから転送してください。'),
          h('button', { class: 'qbtn qbtn-sm', type: 'button', onclick: () => { memory.deleted.clear(); render(); } }, 'デモ用データを戻す')));
      }
      for (const c of list) {
        const sel = ui.selectedCase === c.id;
        const loading = ui.loadingCase === c.id;
        const hasRoi = c.id === state.roiCaseId && (state.roi.length > 0 || !!state.line.end);
        listBody.appendChild(h('button', {
          class: 'ar-li' + (sel ? ' is-on' : ''), type: 'button', role: 'option', 'aria-selected': sel ? 'true' : 'false', 'data-id': c.id,
          onclick: () => selectCase(c.id),
        },
        h('span', { class: 'ar-li-main' }, h('b', {}, c.id),
          hasRoi ? h('em', {}, 'ROI・ライン') : null,
          loading ? h('span', { class: 'ar-li-spin' }) : ui.loadedCase === c.id ? h('span', { class: 'ar-li-loaded' }, '表示中') : null),
        h('span', { class: 'ar-li-sub' }, h('span', { class: 'mono' }, studyDateTime(c)), h('span', {}, c.description))));
      }
      delBtn.disabled = !ui.selectedCase || !list.some((c) => c.id === ui.selectedCase);
      delAllBtn.disabled = !list.length;
      // 削除の確認
      confirmBox.hidden = !ui.confirm;
      confirmBox.innerHTML = '';
      if (ui.confirm) {
        const msg = ui.confirm.kind === 'all' ? 'すべての患者データを削除しますか？' : `${ui.selectedCase} を削除しますか？`;
        confirmBox.append(h('p', {}, msg), h('div', { class: 'ar-row' },
          h('button', { class: 'qbtn qbtn-sm qbtn-danger-solid', type: 'button', onclick: () => doDelete() }, '削除する'),
          h('button', { class: 'qbtn qbtn-sm', type: 'button', onclick: () => { ui.confirm = null; render(); } }, 'キャンセル')));
      }
    }

    function render() {
      const [st, kind] = statusLine();
      statusText.textContent = st;
      status.dataset.kind = kind;
      root.dataset.phase = ui.phase;
      root.classList.toggle('is-lefty', ui.hand === 'left');
      root.classList.toggle('is-tour', !!state.tourActive);
      root.classList.toggle('is-research', !!state.researchMode);

      // S7a
      const showStart = ui.phase === 'start';
      startPanel.hidden = !showStart;
      listPanel.hidden = !(showStart && ui.listOpen);
      selectBtn.classList.toggle('is-on', ui.listOpen);
      const regDone = !!ui.loadedCase && state.registered && scene.holo.state === 'aligned';
      alignBtn.classList.toggle('is-pulse', !!ui.loadedCase && showStart && !ui.loadingCase && !regDone);
      startNote.textContent = regDone
        ? `${ui.loadedCase} は位置合わせ済みです。やり直すときは［位置合わせ］を押します。`
        : ui.loadedCase
          ? `${ui.loadedCase} の3Dモデルを読み込みました。［位置合わせ］で体表に重ねます。`
          : '［患者データ選択］から、PCアプリで転送したデータを選びます。';
      backToMenu.hidden = !regDone;
      if (showStart && ui.listOpen) renderList();

      // S7b
      const showGuide = ui.phase === 'register' || ui.phase === 'aligning' || ui.phase === 'aligned';
      guidePanel.hidden = !showGuide;
      if (showGuide) {
        stepEls.forEach((el, i) => {
          const done = reg.confirmed[i];
          const cur = ui.phase === 'register' && i === reg.idx;
          el.classList.toggle('is-done', done);
          el.classList.toggle('is-current', cur);
          el.querySelector('.ar-step-state').textContent = done ? '確定' : cur ? (reg.mode === 'placed' ? '配置済み' : '配置中') : '';
        });
        const m = MARKERS[Math.min(reg.idx, 2)];
        if (ui.phase === 'register') {
          guideText.textContent = reg.auto
            ? `${m.name}に球を運んでいます…`
            : reg.mode === 'placed'
              ? `球の位置がよければ［確定］を押します。置き直すときは、もう一度クリックします。`
              : reg.mode === 'carry'
                ? `球を${m.name}のマーカに合わせて、クリックで置きます。`
                : `右手でOKサインを作り、1秒保つと指先に球が出ます。胸部模型の${m.name}のマーカにカーソルを合わせてください。`;
        } else if (ui.phase === 'aligning') guideText.textContent = '3Dモデルを体表に重ねています…';
        guideText.hidden = ui.phase === 'aligned';
        guideActions.hidden = ui.phase !== 'register';
        doneBox.hidden = ui.phase !== 'aligned';
        confirmBtn.disabled = !(ui.phase === 'register' && reg.mode === 'placed' && !reg.auto);
        confirmBtn.classList.toggle('is-pulse-blue', !confirmBtn.disabled);
        redoBtn.disabled = reg.auto || (reg.idx === 0 && !reg.placed[0]);
        autoBtn.disabled = reg.auto;
        cancelBtn.hidden = ui.phase === 'aligning';
        lockBtn.classList.toggle('is-pulse', ui.phase === 'aligned');
      }

      // S7c
      const showMenu = ui.phase === 'view';
      menuWrap.hidden = !showMenu;
      if (showMenu) {
        menuPanel.querySelector('.ar-case-chip').textContent = ui.loadedCase || '';
        for (const b of presetBtns) b.classList.toggle('is-on', b.dataset.id === ui.preset);
        for (const b of opSeg.children) b.classList.toggle('is-on', b.dataset.id === ui.opTarget);
        const roiOk = ui.hasRoi && roiApplies();
        for (const b of roiSeg.children) {
          b.classList.toggle('is-on', roiOk && (b.dataset.v === 'on') === ui.roiOn);
          b.disabled = !roiOk;
        }
        roiNote.textContent = roiOk
          ? (ui.roiOn ? 'PCで描いた関心領域（オレンジ）とラインを重ねています。' : 'モデルだけを表示しています。')
          : 'PCアプリで関心領域・ラインを設定すると、ここで重ねて表示できます。';
        sideVal.hand.textContent = ui.hand === 'right' ? '右手' : '左手';
        sideVal.grab.textContent = GRAB_OPTS.find((o) => o.id === ui.grab).label;
        sideVal.lock.textContent = ui.locked ? 'ON' : 'OFF';
        sideVal.sync.textContent = '';
        lockSideBtn.classList.toggle('is-on', ui.locked);
        lockSideBtn.querySelector('.ar-ic').innerHTML = ui.locked ? ICON.lock : ICON.unlock;
        grabBtn.classList.toggle('is-on', ui.grab !== 'none');
        handBtn.classList.toggle('is-on', false);
        grabMenu.hidden = !ui.grabMenu;
        for (const b of grabMenu.children) b.classList.toggle('is-on', b.dataset.id === ui.grab);
        const g = scene.holo.getGrab();
        driftBox.hidden = g.v.lengthSq() < 1 && Math.abs(g.yaw) < 0.002;
      }

      // 3D表示
      const modelLoaded = !!ui.loadedCase;
      show3dBtn.disabled = !modelLoaded;
      show3dBtn.setAttribute('aria-checked', ui.show3d ? 'true' : 'false');
      show3dBtn.classList.toggle('is-off', !ui.show3d);
      show3dBtn.querySelector('.ar-switch-val').textContent = ui.show3d ? 'ON' : 'OFF';

      // S7d（研究開発機能: 研究モードのときだけ）
      mirrorBtn.hidden = !state.researchMode;
      pip.hidden = !(ui.mirrorOn && state.researchMode);
      mirrorBtn.classList.toggle('is-on', ui.mirrorOn);
      pip.dataset.dev = ui.mirrorDev;
      for (const b of pipSeg.children) b.classList.toggle('is-on', b.dataset.v === ui.mirrorDev);
      hint.hidden = ui.phase === 'loading';
      hint.textContent = ui.phase === 'register'
        ? 'クリック：球を置く　ドラッグ：見回す'
        : ui.phase === 'view' && !ui.locked && ui.grab !== 'none'
          ? 'モデルをドラッグ：移動（掴み）　それ以外：見回す'
          : 'ドラッグ：見回す　ホイール：近づく　ダブルクリック：視点を戻す';
    }

    // 左右のパネルを避けて、胸部模型を空いている所の中央に
    function layoutShift() {
      const w = stage.clientWidth;
      if (w < 900 || window.innerWidth < 900) { scene.setViewShift(0, 0); return; }
      const lw = colL.offsetWidth + 16, rw = colR.offsetWidth + 16;
      const shift = Math.round((rw - lw) / 2) * (ui.hand === 'left' ? -1 : 1);
      scene.setViewShift(shift, -10);
    }
    const ro = new ResizeObserver(() => layoutShift());
    ro.observe(stage);

    function showToast(msg, ms = 1800) {
      toastEl.textContent = msg;
      toastEl.classList.add('is-in');
      clearTimeout(ui.toast);
      ui.toast = setTimeout(() => toastEl.classList.remove('is-in'), ms);
    }

    // -------------------------------------------------------------------------
    // S7a: データ選択
    // -------------------------------------------------------------------------
    function openList() {
      ui.listOpen = true;
      if (ui.phase === 'view') ui.phase = 'start';
      render();
    }
    let loadTimer = 0;
    function selectCase(id) {
      ui.selectedCase = id;
      ui.confirm = null;
      if (ui.loadedCase === id) { render(); return; }
      ui.loadingCase = id;
      if (ui.loadedCase) scene.holo.hideNow();
      ui.loadedCase = null;
      memory.loadedCase = null;
      reg.matrix = null;
      setState({ registered: false });
      render();
      clearTimeout(loadTimer);
      loadTimer = setTimeout(() => {
        if (signal.aborted || ui.loadingCase !== id) return;
        ui.loadingCase = null;
        ui.loadedCase = id;
        memory.loadedCase = id;
        ui.preset = 'thorax';
        scene.holo.setOps(PRESETS[0].op);
        scene.holo.appear();
        scene.setRoiVisible(ui.roiOn && roiApplies());
        render();
      }, 650);
    }
    function askDelete(kind) {
      if (kind === 'one' && !ui.selectedCase) return;
      ui.confirm = { kind };
      render();
    }
    function doDelete() {
      const kind = ui.confirm?.kind;
      ui.confirm = null;
      const ids = kind === 'all' ? casesOnDevice().map((c) => c.id) : [ui.selectedCase];
      for (const id of ids) memory.deleted.add(id);
      if (ids.includes(ui.loadedCase) || ids.includes(ui.loadingCase)) {
        scene.holo.hideNow();
        ui.loadedCase = null;
        ui.loadingCase = null;
        memory.loadedCase = null;
        setState({ registered: false });
      }
      ui.selectedCase = null;
      showToast(kind === 'all' ? '患者データをすべて削除しました' : '患者データを削除しました');
      render();
    }
    function onAlignClick() {
      if (!ui.loadedCase) {
        ui.listOpen = true;
        render();
        showToast('先に患者データを選択してください');
        listPanel.classList.remove('is-flash');
        void listPanel.offsetWidth;
        listPanel.classList.add('is-flash');
        return;
      }
      startRegistration();
    }

    // -------------------------------------------------------------------------
    // S7b: 3点位置合わせ
    // -------------------------------------------------------------------------
    function resetReg() {
      reg.autoAbort?.abort();
      reg.idx = 0; reg.mode = 'hold'; reg.hold = 0;
      reg.placed = [null, null, null];
      reg.confirmed = [false, false, false];
      reg.auto = false;
      scene.spheres.hideAll();
      scene.setTriangle(false);
      scene.sparkle.setActive(false);
      scene.hand.show(false);
    }
    function startRegistration() {
      resetReg();
      ui.phase = 'register';
      ui.listOpen = false;
      ui.locked = false;
      ui.grabMenu = false;
      setState({ registered: false });
      scene.holo.setGrab({ x: 0, y: 0, z: 0 }, 0);
      if (scene.holo.state !== 'float') scene.holo.appear();
      scene.setGuide(0);
      render();
    }
    function redoRegistration() {
      startRegistration();
      showToast('位置合わせをやり直します');
    }
    function cancelRegistration() {
      resetReg();
      scene.setGuide(-1);
      setState({ registered: false });
      ui.phase = 'start';
      if (scene.holo.state !== 'float' && ui.loadedCase) scene.holo.appear();
      render();
    }
    function enterCarry() {
      reg.mode = 'carry';
      reg.hold = 1;
      scene.spheres.show(reg.idx, scene.hand.tip());
      scene.spheres.setPhase(reg.idx, 'carry');
      scene.sparkle.setEmitter(scene.hand.tip());
      scene.sparkle.setActive(true);
      render();
    }
    function placeSphere(pos) {
      const i = reg.idx;
      scene.spheres.show(i, pos);
      scene.spheres.setPhase(i, 'placed');
      scene.spheres.ripple(i);
      scene.sparkle.setEmitter(pos);
      scene.sparkle.burst(40);
      scene.sparkle.setActive(false);
      reg.placed[i] = pos.clone();
      reg.mode = 'placed';
      scene.hand.setOk(0.2);
      render();
    }
    function confirmPoint() {
      if (ui.phase !== 'register' || reg.mode !== 'placed') return;
      const i = reg.idx;
      reg.confirmed[i] = true;
      scene.spheres.setPhase(i, 'confirmed');
      if (i >= 2) { finishRegistration(); return; }
      reg.idx = i + 1;
      reg.mode = 'hold';
      reg.hold = 0;
      scene.setGuide(reg.idx);
      render();
    }
    async function finishRegistration() {
      ui.phase = 'aligning';
      scene.setGuide(-1);
      scene.hand.show(false);
      scene.sparkle.setActive(false);
      scene.setTriangle(true);
      render();
      reg.matrix = scene.registration(reg.placed);
      await scene.holo.align(reg.matrix, 1700);
      if (signal.aborted || ui.phase !== 'aligning') return;
      ui.phase = 'aligned';
      setState({ registered: true });
      render();
    }
    function lockModel() {
      ui.locked = true;
      ui.phase = 'view';
      scene.setTriangle(false);
      scene.spheres.hideAll();
      showToast('ロックしました（モデルの位置を固定）');
      syncSlider();
      render();
      layoutShift();
    }

    /** 球 i を自動で運んで置く（おまかせ配置・ガイドツアー用） */
    async function autoPlace(i, sig) {
      const target = scene.sphereTarget(i);
      const n = scene.markerSurface(i).normal;
      const approach = target.clone().addScaledVector(n, 70);
      approach.x -= 40; approach.z += 50;
      const start = scene.hand.offscreen(approach);
      reg.auto = true;
      render();
      try {
        scene.hand.setFollow(40);
        scene.hand.setTarget(start, true);
        scene.hand.setOk(0.05);
        scene.hand.show(true, { from: start });
        await scene.tween(720, (u) => scene.hand.setTarget(start.clone().lerp(approach, ease.out(u))), sig);
        // OK サインを 1 秒保つ
        reg.mode = 'hold';
        scene.hand.setOk(1);
        await scene.tween(1000, (u) => { reg.hold = u; }, sig);
        enterCarry();
        await wait(220, sig);
        // 球を運ぶ
        await scene.tween(680, (u) => scene.hand.setTarget(approach.clone().lerp(target, ease.inOut(u))), sig);
        placeSphere(target);
        await wait(160, sig);
        // 手を引っ込める（待たずに次の操作へ）
        const away = scene.hand.offscreen(target);
        scene.tween(600, (u) => scene.hand.setTarget(target.clone().lerp(away, ease.inOut(u))))
          .then(() => { if (!reg.auto && reg.mode !== 'carry') scene.hand.show(false); }, () => {});
      } catch (e) {
        if (isAbort(e) && !signal.aborted && reg.idx === i && ui.phase === 'register' && reg.mode !== 'placed') placeSphere(target);
        throw e;
      } finally {
        reg.auto = false;
        scene.hand.setFollow(18);
        if (!signal.aborted) render();
      }
    }
    async function runAuto() {
      if (reg.auto || ui.phase !== 'register') return;
      const ac = new AbortController();
      reg.autoAbort = ac;
      try {
        while (ui.phase === 'register' && reg.idx <= 2) {
          const i = reg.idx;
          if (reg.mode !== 'placed') await autoPlace(i, ac.signal);
          else await wait(200, ac.signal);
          await wait(380, ac.signal);
          confirmPoint();
          await wait(250, ac.signal);
        }
      } catch (e) {
        if (!isAbort(e)) console.error(e);
      } finally {
        if (reg.autoAbort === ac) reg.autoAbort = null;
      }
    }

    // -------------------------------------------------------------------------
    // S7c: 表示の操作
    // -------------------------------------------------------------------------
    function presetOps() { return { ...PRESETS.find((p) => p.id === ui.preset).op }; }
    function applyPreset(id) {
      ui.preset = id;
      scene.holo.setOps(presetOps());
      syncSlider();
      render();
    }
    function syncSlider() {
      const target = OPACITY_TARGETS.find((o) => o.id === ui.opTarget);
      const ops = scene.holo.getOps();
      const vis = target.members.filter((m) => (ops[m] ?? 0) > 0);
      opRange.disabled = !vis.length;
      const v = vis.length ? Math.round((1 - ops[vis[0]]) * 100) : 100;
      opRange.value = String(Math.min(95, v));
      opVal.textContent = vis.length ? `${Math.min(95, v)}%` : '非表示';
      opRange.style.setProperty('--p', `${(Math.min(95, v) / 95) * 100}%`);
    }
    function setTransparency(v) {
      const target = OPACITY_TARGETS.find((o) => o.id === ui.opTarget);
      const ops = { ...scene.holo.getOps() };
      for (const m of target.members) if ((ops[m] ?? 0) > 0) ops[m] = Math.max(0.05, 1 - v / 100);
      scene.holo.setOps(ops);
      opRange.value = String(v);
      opVal.textContent = `${v}%`;
      opRange.style.setProperty('--p', `${(v / 95) * 100}%`);
    }
    function setRoi(v) {
      ui.roiOn = v;
      scene.setRoiVisible(v && roiApplies());
      render();
    }
    function set3d(v) {
      ui.show3d = v;
      scene.holo.setShown(v);
      showToast(v ? '3D表示：ON' : '3D表示：OFF（三次元画像を非表示）');
      render();
    }
    function resetGrab() {
      scene.holo.setGrab({ x: 0, y: 0, z: 0 }, 0);
      render();
    }
    let syncTimer = 0;
    function doSync() {
      syncBtn.classList.add('is-busy');
      clearTimeout(syncTimer);
      syncTimer = setTimeout(() => { syncBtn.classList.remove('is-busy'); showToast('表示設定を同期しました（デモ表示）'); }, 900);
    }

    // -------------------------------------------------------------------------
    // S7d: ミラーリング
    // -------------------------------------------------------------------------
    function sizePip() {
      const ipad = ui.mirrorDev === 'ipad';
      const w = ipad ? 432 : 576, hh = ipad ? 324 : 324;
      if (pipCanvas.width !== w) { pipCanvas.width = w; pipCanvas.height = hh; }
    }
    function setMirror(v) {
      ui.mirrorOn = v && state.researchMode;
      sizePip();
      scene.setMirror(ui.mirrorOn ? pipCanvas : null);
      render();
    }

    // -------------------------------------------------------------------------
    // ポインタ操作（クリックで球を置く・ドラッグで見回す・掴みでモデルを動かす）
    // -------------------------------------------------------------------------
    const pointer = { x: 0, y: 0, t: 0, inside: false, overPanel: false, down: null, hit: null };
    const PANEL_SEL = '.ar-panel, .ar-side, .ar-notice, .ar-pip, .ar-tool, .ar-grabmenu';
    const canvasEl = scene.renderer.domElement;
    on(stage, 'pointermove', (e) => {
      pointer.x = e.clientX; pointer.y = e.clientY; pointer.t = performance.now(); pointer.inside = true; pointer.overPanel = false;
      const d = pointer.down;
      if (d && d.id === e.pointerId) {
        const dx = e.clientX - d.x0, dy = e.clientY - d.y0;
        if (!d.drag && Math.hypot(dx, dy) > 5) d.drag = true;
        if (d.drag) {
          if (d.mode === 'grab') {
            const p = scene.rayPlane(e.clientX, e.clientY, d.planeY);
            if (p) { const v = p.sub(d.p0).add(d.g0); v.y = 0; scene.holo.setGrab(v, d.yaw0); render(); }
          } else {
            scene.look.drag(e.clientX - d.lx, e.clientY - d.ly);
          }
          d.lx = e.clientX; d.ly = e.clientY;
        }
      }
    });
    on(hud, 'pointermove', (e) => {
      pointer.x = e.clientX; pointer.y = e.clientY; pointer.t = performance.now(); pointer.inside = true;
      pointer.overPanel = !!e.target.closest?.(PANEL_SEL);
    });
    on(root, 'pointerleave', () => { pointer.inside = false; pointer.overPanel = false; });
    on(stage, 'pointerdown', (e) => {
      if (e.button !== 0) return;
      const d = { id: e.pointerId, x0: e.clientX, y0: e.clientY, lx: e.clientX, ly: e.clientY, drag: false, mode: 'look' };
      // 掴み: 表示されている 3D モデルに当たったときだけ（動かした後のモデルも掴めるよう、胸部模型ではなくモデルで判定）
      if (ui.phase === 'view' && !ui.locked && ui.grab !== 'none' && scene.pickHolo(e.clientX, e.clientY)) {
        const g = scene.holo.getGrab();
        const planeY = 960;
        const p0 = scene.rayPlane(e.clientX, e.clientY, planeY);
        if (p0) Object.assign(d, { mode: 'grab', planeY, p0, g0: g.v, yaw0: g.yaw });
      }
      pointer.down = d;
      stage.setPointerCapture?.(e.pointerId);
      stage.classList.toggle('is-grabbing', d.mode === 'grab');
    });
    const endPointer = (e) => {
      const d = pointer.down;
      if (!d || d.id !== e.pointerId) return;
      pointer.down = null;
      stage.classList.remove('is-grabbing');
      if (!d.drag && e.type === 'pointerup') onStageClick(e.clientX, e.clientY);
    };
    on(stage, 'pointerup', endPointer);
    on(stage, 'pointercancel', endPointer);
    on(stage, 'dblclick', () => scene.look.reset());
    on(stage, 'wheel', (e) => { e.preventDefault(); scene.look.lean(-e.deltaY * 0.6); }, { passive: false });
    on(canvasEl, 'contextmenu', (e) => e.preventDefault());

    function onStageClick(x, y) {
      if (ui.phase === 'register' && !reg.auto) {
        const hit = scene.pick(x, y);
        if (!hit) return;
        const pos = hit.point.clone().addScaledVector(hit.normal, SPHERE_R + 0.5);
        if (reg.mode === 'hold') { scene.hand.setTarget(pos, true); }
        placeSphere(pos);
      } else if (ui.grabMenu) {
        ui.grabMenu = false;
        render();
      }
    }

    // -------------------------------------------------------------------------
    // フレームごとの更新（手・球・ラベル・レイ・HUD の追従）
    // -------------------------------------------------------------------------
    let hoverEl = null;
    const tourCursorPos = () => {
      if (!state.tourActive) return null;
      const c = document.querySelector('.tour-cursor');
      if (!c || c.style.opacity === '0') return null;
      const r = c.getBoundingClientRect();
      return { x: r.left + 4, y: r.top + 4 };
    };
    scene.onFrame((dt, now) => {
      const sr = stage.getBoundingClientRect();
      // ---- 手（位置合わせ中・手動） ----
      if (ui.phase === 'register' && !reg.auto) {
        let hit = null;
        if (pointer.inside && !pointer.overPanel && !pointer.down) hit = scene.pick(pointer.x, pointer.y);
        if (hit) {
          const p = hit.point.clone().addScaledVector(hit.normal, SPHERE_R + 2);
          if (!scene.hand.state.visible) scene.hand.show(true, { from: scene.hand.offscreen(p) });
          scene.hand.setTarget(p);
          if (reg.mode === 'hold') {
            reg.hold = Math.min(1, reg.hold + dt);
            scene.hand.setOk(0.35 + 0.65 * reg.hold);
            if (reg.hold >= 1) enterCarry();
          } else if (reg.mode === 'carry') scene.hand.setOk(1);
        } else {
          if (scene.hand.state.visible) scene.hand.show(false);
          if (reg.mode === 'hold') reg.hold = Math.max(0, reg.hold - dt * 2);
        }
      }
      // 運んでいる球は指先に
      if (ui.phase === 'register' && reg.mode === 'carry') {
        scene.spheres.move(reg.idx, scene.hand.tip());
        scene.sparkle.setEmitter(scene.hand.tip());
      }
      // ---- OK サインの認識リング ----
      const showHold = ui.phase === 'register' && reg.mode === 'hold' && scene.hand.state.visible && reg.hold > 0.01;
      if (showHold) {
        const p = scene.project(scene.hand.tip());
        holdG.setAttribute('transform', `translate(${p.x},${p.y})`);
        holdFg.setAttribute('stroke-dashoffset', `${HOLD_C * (1 - reg.hold)}`);
        holdLabel.style.transform = `translate(${p.x}px, ${p.y + 34}px) translateX(-50%)`;
      }
      holdG.style.opacity = showHold ? '1' : '0';
      holdLabel.style.opacity = showHold ? '1' : '0';
      // ---- 目標マーカのラベル ----
      const showTarget = ui.phase === 'register' && reg.mode !== 'placed' && reg.idx <= 2;
      if (showTarget) {
        const s = scene.markerSurface(reg.idx);
        const p = scene.project(s.point);
        targetTag.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) translate(-50%, -100%) translateY(-34px)`;
        targetTag.querySelector('i').style.background = MARKERS[reg.idx].color;
        targetTag.querySelector('span').textContent = `${MARKERS[reg.idx].name}（マーカ）`;
      }
      targetTag.classList.toggle('is-on', showTarget);
      // ---- 浮かんでいるモデルのラベル ----
      const showModel = (ui.phase === 'start' || ui.phase === 'register') && scene.holo.state === 'float' && !!ui.loadedCase && ui.show3d;
      if (showModel) {
        const c = scene.holo.center();
        c.y += 150;
        const p = scene.project(c);
        modelTag.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) translate(-50%, -100%)`;
        modelTag.textContent = `${ui.loadedCase} の3Dモデル（位置合わせ前）`;
      }
      modelTag.classList.toggle('is-on', showModel);

      // ---- レイ（青い指示線）: パネルを指しているとき ----
      const tc = tourCursorPos();
      const px = tc ? tc.x : pointer.x, py = tc ? tc.y : pointer.y;
      let over = false;
      let el = null;
      const idle = !tc && now - pointer.t > 3000;
      if ((tc || pointer.inside) && !idle) {
        el = document.elementFromPoint(px, py);
        over = !!el?.closest?.(PANEL_SEL);
      }
      const handVisible = scene.hand.state.visible;
      if (over && !handVisible && !pointer.down) {
        const ox = ui.hand === 'left' ? sr.width * 0.14 : sr.width * 0.86, oy = sr.height + 40;
        const ex = px - sr.left, ey = py - sr.top;
        rayLine.setAttribute('x1', ox); rayLine.setAttribute('y1', oy);
        rayLine.setAttribute('x2', ex); rayLine.setAttribute('y2', ey);
        rayGrad.setAttribute('x1', ox); rayGrad.setAttribute('y1', oy);
        rayGrad.setAttribute('x2', ex); rayGrad.setAttribute('y2', ey);
        rayDot.setAttribute('cx', ex); rayDot.setAttribute('cy', ey);
        fx.classList.add('is-ray');
      } else fx.classList.remove('is-ray');
      // ツアー中は、カーソルが指しているボタンにホバー表示
      const hb = tc && over ? el?.closest?.('button') : null;
      if (hb !== hoverEl) { hoverEl?.classList.remove('is-hover'); hb?.classList.add('is-hover'); hoverEl = hb; }

      // ---- HUD の追従（頭を動かすと少し遅れてついてくる） ----
      const L = scene.look.state;
      const ox = Math.round((L.yaw - L.yawLag) * 520);
      const oy = Math.round((L.pitch - L.pitchLag) * 520);
      const tf = ox || oy ? `translate3d(${ox}px, ${oy}px, 0)` : '';
      if (hud.style.transform !== tf) hud.style.transform = tf;
      recenterBtn.classList.toggle('is-visible', !scene.look.isDefault());
    });

    const unsub = subscribe((s, patch) => {
      // 研究モードを OFF にしたら、ミラーリング（研究開発機能）も止める
      if ('researchMode' in patch && !s.researchMode && ui.mirrorOn) setMirror(false);
      else if ('tourActive' in patch || 'researchMode' in patch) render();
    });
    on(window, 'resize', () => layoutShift());

    // ブート演出（暗転からパススルーへ）
    scene.ready.then(() => { if (!signal.aborted) requestAnimationFrame(() => root.classList.add('is-booted')); });
    render();

    // -------------------------------------------------------------------------
    // 画面をはじめの状態に戻す（ガイドツアーの開始時）
    // -------------------------------------------------------------------------
    function resetScreen() {
      resetReg();
      scene.setGuide(-1);
      scene.holo.hideNow();
      scene.holo.setShown(true);
      scene.look.reset();
      clearTimeout(loadTimer);
      Object.assign(ui, { phase: 'start', listOpen: false, loadedCase: null, loadingCase: null, selectedCase: null, confirm: null, locked: false, hand: 'right', grab: 'none', grabMenu: false, preset: 'thorax', opTarget: 'lung', show3d: true, roiOn: true });
      setMirror(false);
      memory.deleted.clear();
      memory.loadedCase = null;
      setState({ registered: false });
      render();
      layoutShift();
    }

    // -------------------------------------------------------------------------
    // ガイドツアー（約 50 秒）
    // -------------------------------------------------------------------------
    async function tour(t) {
      while (!isReady) await t.sleep(100);
      resetScreen();
      await t.sleep(300);
      t.caption('ARグラスをかけると、処置台の胸部模型の上に Zeus のメニューが浮かびます。');
      await t.sleep(2100);
      t.caption('［患者データ選択］から、PCで転送した患者データを選びます。');
      await t.click(selectBtn);
      await t.sleep(400);
      const item = listBody.querySelector(`[data-id="${state.caseId}"]`) || listBody.querySelector('.ar-li');
      await t.click(item);
      await t.sleep(700);
      t.caption('読み込んだ3Dモデルは、まだ体とは別の位置に浮かんでいます。');
      await t.sleep(1600);
      t.caption('［位置合わせ］：CT撮影時に貼ったマーカ3点に、順に球を合わせます。');
      await t.click(alignBtn);
      await t.sleep(700);
      const captions = [
        '① 右鎖骨中線：右手でOKサインを1秒保つと、指先に線香花火のエフェクトと球が出ます。',
        '② 左鎖骨中線：同じように球を運んで、マーカに合わせます。',
        '③ 剣状突起：最後の1点です。',
      ];
      for (let i = 0; i < 3; i++) {
        t.check();
        t.caption(captions[i]);
        t.hideCursor();
        try { await autoPlace(i, t.signal); } finally { t.showCursor(); }
        if (i === 0) t.caption('球がマーカに重なったら［確定］を押します。');
        await t.click(confirmBtn);
        await t.sleep(i === 2 ? 150 : 250);
      }
      t.caption('3点がそろうと、3Dモデルが体表にスナップして重なります。');
      while (ui.phase === 'aligning') await t.sleep(100);
      await t.sleep(1100);
      t.caption('位置が決まったら［ロック］で固定します。');
      await t.click(lockBtn);
      await t.sleep(700);
      t.caption('プリセットはワンタップ。表示する臓器と透過度の組み合わせを切り替えます。');
      for (const id of ['subclavian', 'pulm']) {
        await t.click(presetBtns.find((b) => b.dataset.id === id));
        await t.sleep(850);
      }
      t.caption('透過度は臓器ごとに調整できます（例：肺）。');
      await t.click(opSeg.querySelector('[data-id="lung"]'));
      const rr = opRange.getBoundingClientRect();
      const posFor = (v) => ({ x: rr.left + 8 + (rr.width - 16) * (v / 95), y: rr.top + rr.height / 2 });
      let v = +opRange.value;
      await t.pointAt(posFor(v), 450);
      for (const goal of [86, 42]) {
        const steps = 9;
        const from = v;
        for (let k = 1; k <= steps; k++) {
          t.check();
          v = Math.round(from + (goal - from) * (k / steps));
          setTransparency(v);
          await t.pointAt(posFor(v), 50);
        }
        await t.sleep(350);
      }
      if (ui.hasRoi && roiApplies()) {
        t.caption('PCで描いた関心領域とラインも重ねられます。なし／ありで見比べます。');
        await t.click(roiSeg.querySelector('[data-v="off"]'));
        await t.sleep(1000);
        await t.click(roiSeg.querySelector('[data-v="on"]'));
        await t.sleep(1300);
      }
      t.caption('穿刺・ドレナージを行う際は、三次元画像の表示をOFFにします。');
      await t.click(show3dBtn);
      await t.highlight(notice, 1800);
      t.caption('3D表示は、いつでも ON に戻せます。');
      await t.click(show3dBtn);
      await t.sleep(700);
      // 映像共有（ミラーリング）は研究開発機能（【区分要確認】）なので、研究モードのときだけ案内する
      if (state.researchMode) {
        t.caption('研究開発中・未承認の映像共有（ミラーリング）：手術室モニターや iPad に、グラスと同じ映像を映せます。');
        await t.click(mirrorBtn);
        await t.sleep(1400);
        await t.click(pipSeg.querySelector('[data-v="ipad"]'));
        await t.sleep(1500);
      }
    }

    return {
      tour,
      destroy() {
        unsub();
        ro.disconnect();
        clearTimeout(loadTimer);
        clearTimeout(syncTimer);
        clearTimeout(ui.toast);
        reg.autoAbort?.abort();
        hoverEl?.classList.remove('is-hover');
        scene.dispose();
      },
    };
  },
};
