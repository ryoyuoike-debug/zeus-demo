// =============================================================================
// S5 関心領域（描画画面）— PCアプリ「Zeus」
//   左: 描画ツール（ライン / ペン（大・中・小）/ 消しゴム / 全て削除）と深度計測
//   中央: CT（軸位断）。2 点ライン（始点・終点）を置き、ペンで関心領域を塗る
//   右: 3D 表示。背景に薄いボリュームレンダリング風の表示を常に出し、
//       関心領域のメッシュとライン（体表から外側へ 10 cm 延長）を重ねる
//   ・入った直後は［ライン］がアクティブ。2 点を置くと自動でペン（ROI 描画）に切り替わり、
//     ROI 描画中は［ライン］をグレーアウト（「ラインを引き直す」で再指定できる）
// =============================================================================
import '../styles/screens/roi.css';
import { h, dialog, toast, researchBadge, demoBadge, slider } from '../ui/dom.js';
import { state, setState, subscribe, navigate, currentCase } from '../app/state.js';
import { studyDateTime } from '../data/cases.js';
import { NODULE, lateralSkinX } from '../data/phantom.js';
import { createCtViewer, zToSliceIndex, sliceIndexToZ, SLICE_COUNT, SLICE_STEP, Z_MIN, Z_MAX, prefetchSlices } from '../ui/ctViewer.js';
import { createRoiScene, LAYERS, COLORS } from './roi/scene3d.js';
import { createCtOverlay } from './roi/ctOverlay.js';
import { BRUSH, EXT_MM, paintCircle, eraseAt, computeLine, paintedSlices } from './roi/geometry.js';
import { ICON } from './roi/icons.js';

const FOV_HALF = 190;
const CT_CY = -6;
const SKIN_DEFAULT = 70;
const round1 = (v) => Math.round(v * 10) / 10;
const sliceZ = (z) => sliceIndexToZ(zToSliceIndex(z));
const imOf = (z) => zToSliceIndex(z) + 1;

export default {
  id: 'roi',
  title: '関心領域',
  frame: 'pc',

  mount(root, ctx) {
    const { signal } = ctx;
    // 直接開かれた場合は、前の手順（取込・3D構成・マーカ確認）が済んでいるものとして扱う
    if (!state.imported || !state.reconstructed || !state.markersConfirmed) {
      setState({ imported: true, reconstructed: true, markersConfirmed: true });
    }
    const c = currentCase();

    // ---- タイマー（画面を離れたら止める） ----
    const timers = new Set();
    const later = (fn, ms) => {
      const t = setTimeout(() => { timers.delete(t); if (!signal.aborted) fn(); }, ms);
      timers.add(t);
      return t;
    };

    /** ガイドツアー中は字幕で説明するので、トーストは出さない */
    const notify = (msg, o) => { if (!state.tourActive && !tourRunning) toast(msg, o); };
    let tourRunning = false;

    // =====================================================================
    // 状態
    // =====================================================================
    // 別の症例で描いた関心領域・ラインは読み込まない（state.roiCaseId が描いた症例）
    const ownRoi = !state.roiCaseId || state.roiCaseId === state.caseId;
    /** @type {Array<{x:number,y:number,z:number,r:number}>} */
    let circles = ownRoi && Array.isArray(state.roi) ? state.roi.map((o) => ({ ...o })) : [];
    let line = ownRoi && state.line?.start && state.line?.end ? computeLine(state.line.start, state.line.end) : null;
    /** 'line' | 'pen' | 'eraser' */
    let tool = line ? 'pen' : 'line';
    let size = 'L';
    let draftStart = null;     // ライン指定中の始点
    let redrawing = false;     // 既存のラインを引き直し中
    let hover = null;          // CT 上のカーソル位置（CSS px）
    let stroke = null;         // ペン・消しゴムのドラッグ中
    let spacePan = false;
    let grow = 1;              // ラインが延びるアニメーション（0..1）
    let depthText = '';
    let volumeMl = null;
    let aiOn = false;
    let dialogOpen = false;
    const undo = [];

    // =====================================================================
    // DOM
    // =====================================================================
    const modeBadge = h('span', { class: 'badge roi-mode-badge' });
    const toolbar = h('div', { class: 'pc-toolbar roi-toolbar' },
      h('div', { class: 'pc-section-title' }, h('span', { class: 'num' }, '2'), '関心領域'),
      h('div', { class: 'roi-case' },
        h('span', { class: 'roi-case-id mono' }, c.id),
        h('span', {}, c.name),
        h('span', { class: 'roi-case-sep' }),
        h('span', { class: 'muted' }, `撮影日 ${studyDateTime(c)}`),
        h('span', { class: 'muted roi-hide-narrow' }, c.description)),
      h('div', { class: 'roi-tb-spacer' }),
      modeBadge);

    // ---- 描画ツール ----
    const toolBtn = (id, icon, label, title) => h('button', {
      class: 'roi-tool', type: 'button', 'data-tool': id, title, 'aria-pressed': 'false',
      onclick: () => setTool(id),
    }, h('span', { class: 'roi-tool-ico', html: icon }), h('span', { class: 'roi-tool-label' }, label));
    const lineBtn = toolBtn('line', ICON.line, 'ライン', '2点ライン：始点と終点をクリック');
    const penBtn = toolBtn('pen', ICON.pen, 'ペン', 'ペン：ドラッグで関心領域を塗る（P）');
    const eraserBtn = toolBtn('eraser', ICON.eraser, '消しゴム', '消しゴム：塗った範囲を消す（E）');
    const sizeBtns = Object.entries(BRUSH).map(([k, b], i) => h('button', {
      class: 'seg-btn roi-size-btn', type: 'button', 'data-size': k, title: `円のサイズ：${b.label}（${i + 1}）`,
      onclick: () => setSize(k),
    }, h('i', { class: 'roi-size-dot', style: { width: `${4 + b.r}px`, height: `${4 + b.r}px` } }), b.label));
    const sizeSeg = h('div', { class: 'seg roi-size-seg', role: 'group', 'aria-label': '円のサイズ' }, sizeBtns);
    const undoBtn = h('button', { class: 'btn btn-sm btn-ghost roi-mini', type: 'button', title: '元に戻す（Ctrl+Z）', onclick: () => doUndo() },
      h('span', { class: 'roi-mini-ico', html: ICON.undo }), '元に戻す');
    const clearBtn = h('button', { class: 'btn btn-sm btn-danger roi-mini', type: 'button', title: '塗った関心領域をすべて削除', onclick: () => clearAll() },
      h('span', { class: 'roi-mini-ico', html: ICON.trash }), '全て削除');
    const toolsCard = h('section', { class: 'roi-card roi-tools', 'aria-label': '描画ツール' },
      h('div', { class: 'roi-card-head' }, '描画ツール'),
      h('div', { class: 'roi-tool-grid' }, lineBtn, penBtn, eraserBtn),
      h('div', { class: 'roi-size-row' }, h('span', { class: 'roi-size-label' }, '円のサイズ'), sizeSeg),
      h('div', { class: 'roi-mini-row' }, undoBtn, clearBtn));

    // ---- 2 点ライン・深度計測 ----
    const startVal = h('span', { class: 'roi-pt-val mono' }, '—');
    const endVal = h('span', { class: 'roi-pt-val mono' }, '—');
    const startRow = h('div', { class: 'roi-pt' }, h('span', { class: 'roi-pt-dot is-start' }), h('span', { class: 'roi-pt-name' }, '始点'), startVal);
    const endRow = h('div', { class: 'roi-pt' }, h('span', { class: 'roi-pt-dot is-end' }), h('span', { class: 'roi-pt-name' }, '終点'), endVal);
    const depthVal = h('span', { class: 'roi-depth-num mono' }, '—');
    const lengthVal = h('span', { class: 'mono' }, '—');
    const depthNote = h('div', { class: 'roi-depth-note' });
    const relineLabel = h('span', {}, 'ラインを引き直す');
    const relineBtn = h('button', { class: 'btn btn-sm roi-reline', type: 'button', onclick: () => onRelineClick() },
      h('span', { class: 'roi-mini-ico', html: ICON.redo }), relineLabel);
    const depthBox = h('div', { class: 'roi-depth' },
      h('div', { class: 'roi-depth-label' }, h('span', { class: 'roi-depth-ico', html: ICON.depth }), '深さ（体表→終点）'),
      h('div', { class: 'roi-depth-value' }, depthVal, h('span', { class: 'roi-unit' }, 'mm')),
      h('div', { class: 'roi-kv' }, h('span', {}, '全長（始点→終点）'), h('span', {}, lengthVal, h('span', { class: 'roi-unit-s' }, ' mm'))));
    const lineCard = h('section', { class: 'roi-card roi-line-card', 'aria-label': '2点ライン・深度計測' },
      h('div', { class: 'roi-card-head' }, h('span', {}, '2点ライン'), h('span', { class: 'roi-head-badge' }, demoBadge())),
      h('div', { class: 'roi-pts' }, startRow, endRow),
      depthBox,
      depthNote,
      relineBtn);

    // ---- 関心領域の情報 ----
    const roiSlicesVal = h('span', { class: 'mono' }, '—');
    const roiVolVal = h('span', { class: 'mono' }, '—');
    const statsCard = h('section', { class: 'roi-card roi-stats', 'aria-label': '関心領域' },
      h('div', { class: 'roi-card-head' }, h('span', { class: 'roi-swatch' }), h('span', {}, '関心領域'), h('span', { class: 'roi-head-badge' }, demoBadge())),
      h('div', { class: 'roi-kv' }, h('span', {}, 'スライス'), roiSlicesVal),
      h('div', { class: 'roi-kv' }, h('span', {}, '体積の目安'), roiVolVal));

    const rail = h('aside', { class: 'roi-rail' }, toolsCard, lineCard, statsCard);

    // ---- CT ----
    const prompt = h('span', { class: 'roi-prompt' });
    const zoomLabel = h('span', {}, '拡大表示');
    const zoomBtn = h('button', { class: 'btn btn-sm btn-ghost roi-zoom-btn', type: 'button', title: '関心領域・ラインの周囲を拡大して表示（拡大中は Space キーを押しながらドラッグで表示を移動）', onclick: () => toggleZoom() },
      h('span', { class: 'roi-mini-ico', html: ICON.focus }), zoomLabel);
    const ctHost = h('div', { class: 'roi-ct-host' });
    const ctPanel = h('section', { class: 'roi-ct', 'aria-label': 'CT画像' },
      h('div', { class: 'roi-panel-head' }, h('strong', {}, 'CT（軸位断）'), prompt, zoomBtn),
      ctHost);

    // ---- 3D ----
    const chipEls = LAYERS.map((l) => {
      const b = h('button', {
        class: 'chip roi-chip' + (l.on ? ' is-on' : ''), type: 'button', 'aria-pressed': String(l.on), 'data-layer': l.id,
        onclick: () => {
          const on = !b.classList.contains('is-on');
          b.classList.toggle('is-on', on);
          b.setAttribute('aria-pressed', String(on));
          scene.setLayer(l.id, on);
          renderLegend();
          if (l.id === 'skin') updateGuideNote();
        },
      }, h('span', { class: 'dot', style: { background: l.color } }), l.name);
      return b;
    });
    const aiChip = h('button', {
      class: 'chip roi-chip roi-chip-ai', type: 'button', 'aria-pressed': 'false',
      title: '研究開発中の機能です（未承認）',
      onclick: () => setAi(!aiOn),
    }, h('span', { class: 'dot', style: { background: COLORS.ai } }), 'AI ROI', researchBadge());
    const aiWrap = h('div', { class: 'roi-chips roi-chips-ai', role: 'group', 'aria-label': '研究開発中の表示' }, aiChip);
    const host3d = h('div', { class: 'three-host roi-3d-host' });
    const loading3d = h('div', { class: 'roi-3d-loading' }, h('span', { class: 'spinner' }), '3Dモデルを準備しています…');
    const homeBtn = h('button', { class: 'icon-btn roi-3d-btn', type: 'button', title: '全体を表示', 'aria-label': '全体を表示', onclick: () => scene.home(), html: ICON.home });
    const focusBtn = h('button', { class: 'icon-btn roi-3d-btn', type: 'button', title: '関心領域・ラインに寄る', 'aria-label': '関心領域・ラインに寄る', onclick: () => scene.focus(), html: ICON.focus });
    const legend = h('div', { class: 'roi-legend' });
    const view3dInner = h('div', { class: 'roi-3d-view' },
      host3d,
      h('div', { class: 'roi-3d-caption' }, h('span', {}, '背景：ボリュームレンダリング（簡易表示）')),
      h('div', { class: 'roi-3d-tools' }, focusBtn, homeBtn),
      legend,
      h('div', { class: 'roi-3d-hint' }, 'ドラッグ：回転　ホイール：拡大・縮小'),
      loading3d);
    const skinSlider = slider({ label: '体表の透過度', min: 0, max: 100, step: 1, value: SKIN_DEFAULT, format: (v) => `${v}%`, oninput: (v) => onSkin(v) });
    const guideNote = h('span', { class: 'roi-guide-note', title: '透過度0（体表を不透明表示）のときに表示されます' }, h('i'), 'テンプレートガイド表示中');
    const view3d = h('section', { class: 'roi-3d', 'aria-label': '3D表示' },
      h('div', { class: 'roi-panel-head roi-3d-head' },
        h('strong', {}, '3D表示'),
        h('div', { class: 'roi-chip-groups' },
          h('div', { class: 'roi-chips', role: 'group', 'aria-label': '表示切替' }, chipEls),
          aiWrap)),
      view3dInner,
      h('div', { class: 'roi-3d-foot' }, skinSlider, guideNote));

    // ---- アクションバー ----
    const hint = h('span', { class: 'hint roi-hint' });
    const backBtn = h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => navigate('marker') }, '‹ 戻る');
    const nextBtn = h('button', { class: 'btn btn-accent btn-lg roi-next', type: 'button', onclick: () => saveAndNext() },
      '保存して次へ：端末への転送', h('span', { 'aria-hidden': 'true' }, '›'));
    const actionBar = h('div', { class: 'action-bar roi-actions' }, backBtn, hint, h('div', { class: 'spacer' }), nextBtn);

    const screen = h('div', { class: 'pc-screen roi' },
      toolbar,
      h('div', { class: 'roi-content' }, rail, ctPanel, view3d),
      actionBar);
    root.appendChild(screen);

    // =====================================================================
    // CT ビューア
    // =====================================================================
    const z0 = line ? sliceZ(line.end[2]) : circles.length ? sliceZ(circles[circles.length - 1].z) : sliceZ(NODULE.c[2]);
    const ct = createCtViewer(ctHost, { z: z0, window: 'lung', patientLabel: c.id, compact: true, interaction: 'custom' });
    prefetchSlices(Array.from({ length: 9 }, (_, k) => sliceZ(NODULE.c[2]) + (k - 4) * SLICE_STEP));
    ct.canvas.style.cursor = 'crosshair';
    ct.addOverlay(createCtOverlay(() => ({
      circles,
      line: redrawing && draftStart ? null : line,
      lineDim: redrawing,
      grow,
      draftStart,
      hover,
      tool,
      brushR: BRUSH[size].r,
      depthText,
      ai: aiOn && state.researchMode,
      painting: !!stroke,
    })));

    // スライダー上に、ROI・始点・終点のあるスライスの印を付ける
    const sliderEl = ct.el.querySelector('.ct-slider');
    const marks = h('div', { class: 'roi-slice-marks', 'aria-hidden': 'true' });
    sliderEl?.parentElement?.appendChild(marks);
    const layoutMarks = () => {
      if (!sliderEl) return;
      marks.style.left = `${sliderEl.offsetLeft + 8}px`;
      marks.style.width = `${Math.max(0, sliderEl.offsetWidth - 16)}px`;
      marks.style.top = `${sliderEl.offsetTop + sliderEl.offsetHeight / 2 + 5}px`;
    };
    const roMarks = new ResizeObserver(layoutMarks);
    if (sliderEl) roMarks.observe(sliderEl);
    const pct = (z) => `${((zToSliceIndex(z) / (SLICE_COUNT - 1)) * 100).toFixed(2)}%`;
    function renderSliceMarks() {
      const items = [];
      const covered = coveredSlices();
      for (const z of covered) items.push(h('i', { class: 'is-roi', style: { left: pct(z) } }));
      const L = redrawing && draftStart ? null : line;
      if (L) {
        items.push(h('i', { class: 'is-pt', style: { left: pct(L.start[2]) }, title: '始点' }));
        items.push(h('i', { class: 'is-pt is-end', style: { left: pct(L.end[2]) }, title: '終点' }));
      }
      if (draftStart) items.push(h('i', { class: 'is-pt', style: { left: pct(draftStart[2]) } }));
      marks.replaceChildren(...items);
    }
    ct.onSliceChange(() => { if (stroke) endStroke(); render(); });

    // =====================================================================
    // 3D
    // =====================================================================
    const scene = createRoiScene(host3d, {
      onReady: () => loading3d.classList.add('is-hidden'),
      onRoiBuilt: (info) => { volumeMl = info ? info.volumeMl : null; renderStats(); },
    });
    scene.setSkinTransparency(SKIN_DEFAULT);
    if (line) { scene.setLine(line); setDepthDisplay(line); }
    if (circles.length) scene.setRoi(circles, { immediate: true });

    // =====================================================================
    // 表示の更新
    // =====================================================================
    function coveredSlices() {
      const set = new Set();
      for (const z of paintedSlices(circles)) {
        for (const dz of [-SLICE_STEP, 0, SLICE_STEP]) {
          const zz = z + dz;
          if (zz >= Z_MIN - 0.01 && zz <= Z_MAX + 0.01) set.add(sliceZ(zz));
        }
      }
      return [...set].sort((a, b) => b - a);
    }

    function render() {
      for (const [b, id] of [[lineBtn, 'line'], [penBtn, 'pen'], [eraserBtn, 'eraser']]) {
        b.classList.toggle('is-on', tool === id);
        b.setAttribute('aria-pressed', String(tool === id));
      }
      lineBtn.disabled = tool !== 'line';
      lineBtn.title = tool !== 'line'
        ? 'ROI描画中は選べません。［ラインを引き直す］から指定できます'
        : '2点ライン：始点と終点をクリック';
      sizeBtns.forEach((b) => b.classList.toggle('is-on', b.dataset.size === size));
      sizeSeg.classList.toggle('is-dim', tool === 'line');
      undoBtn.disabled = !undo.length;
      clearBtn.disabled = !circles.length && !line;

      // 2 点ライン
      const shownLine = redrawing && draftStart ? null : line;
      const s = draftStart || shownLine?.start;
      const e = draftStart ? null : shownLine?.end;
      startVal.textContent = s ? `Im ${imOf(s[2])}` : '—';
      endVal.textContent = e ? `Im ${imOf(e[2])}` : '—';
      startRow.classList.toggle('is-set', !!s);
      endRow.classList.toggle('is-set', !!e);
      startRow.classList.toggle('is-wait', tool === 'line' && !draftStart);
      endRow.classList.toggle('is-wait', tool === 'line' && !!draftStart);
      lineCard.classList.toggle('is-active', tool === 'line');
      lineCard.classList.toggle('is-empty', !line);
      relineBtn.hidden = tool === 'line' && !line && !draftStart;
      if (tool === 'line') {
        relineLabel.textContent = '指定をキャンセル';
      } else {
        relineLabel.textContent = line ? 'ラインを引き直す' : 'ラインを引く';
      }
      if (!line) depthNote.textContent = tool === 'line' ? 'CT上で始点と終点をクリックすると、深さを表示します。' : '2点ラインは未設定です。';
      else if (line.depth == null) depthNote.textContent = '終点が体表の外側にあるため、深さは表示できません。';
      else depthNote.textContent = `ラインは体表から外側へ ${EXT_MM / 10} cm 延長して表示しています。`;
      depthNote.hidden = !!line && line.depth != null && !(tool === 'line');
      zoomLabel.textContent = ct.zoom > 1.05 ? '全体表示' : '拡大表示';

      // モード表示
      let badge, promptText, hintText;
      if (tool === 'line') {
        badge = ['badge-info', draftStart ? 'ライン：終点を指定' : 'ライン：始点を指定'];
        promptText = draftStart
          ? [h('b', {}, '② 終点'), 'をクリック（別のスライスでも可）']
          : [h('b', {}, '① 始点'), 'をクリック'];
        hintText = draftStart
          ? '［終点］をクリックすると2点ラインが引かれ、ROI描画（ペン）に切り替わります。Esc でキャンセル。'
          : 'CT画像上で［始点］をクリックしてください。スライスはホイール・↑↓キー・スライダーで送れます。';
      } else {
        const sz = BRUSH[size].label;
        badge = ['badge-warn', `ROI描画：${tool === 'pen' ? 'ペン' : '消しゴム'}（${sz}）`];
        promptText = tool === 'pen'
          ? [h('b', {}, `ペン（${sz}）`), 'ドラッグで塗る']
          : [h('b', {}, `消しゴム（${sz}）`), 'ドラッグで消す'];
        hintText = tool === 'pen'
          ? 'ドラッグで関心領域を塗ります。前後のスライス（±2mm）にも反映され、3D表示も自動で更新されます。'
          : 'ドラッグで塗った範囲を消します。Ctrl+Z で元に戻せます。';
      }
      modeBadge.className = `badge roi-mode-badge ${badge[0]}`;
      modeBadge.textContent = badge[1];
      prompt.className = `roi-prompt is-${tool}`;
      prompt.replaceChildren(...promptText);
      hint.textContent = hintText;
      screen.dataset.tool = tool;
      renderSliceMarks();
      ct.redraw();
    }

    function renderStats() {
      const cov = coveredSlices();
      roiSlicesVal.textContent = cov.length ? `${cov.length}枚（Im ${imOf(cov[0])}–${imOf(cov[cov.length - 1])}）` : '—';
      roiVolVal.textContent = circles.length && volumeMl != null ? `約 ${volumeMl.toFixed(1)} mL` : '—';
      statsCard.classList.toggle('is-empty', !circles.length);
    }

    function renderLegend() {
      const on = (id) => chipEls.find((b) => b.dataset.layer === id)?.classList.contains('is-on');
      const items = [
        h('span', { class: 'roi-lg' }, h('i', { class: 'is-roi' }), '関心領域'),
        h('span', { class: 'roi-lg' }, h('i', { class: 'is-line' }), 'ライン'),
      ];
      if (on('nodule')) items.push(h('span', { class: 'roi-lg' }, h('i', { class: 'is-nodule' }), '結節'));
      if (aiOn && state.researchMode) items.push(h('span', { class: 'roi-lg' }, h('i', { class: 'is-ai' }), 'AI ROI', researchBadge()));
      legend.replaceChildren(...items);
    }

    function renderAiChip() {
      aiChip.hidden = !state.researchMode;
      aiWrap.hidden = !state.researchMode;
      if (!state.researchMode && aiOn) setAi(false);
      renderLegend();
    }

    function setDepthDisplay(L, f = 1) {
      if (!L) {
        depthVal.textContent = '—'; lengthVal.textContent = '—'; depthText = '';
        scene.setDepthText('');
        return;
      }
      lengthVal.textContent = (L.length * f).toFixed(1);
      if (L.depth != null) {
        const d = (L.depth * f).toFixed(1);
        depthVal.textContent = d;
        depthText = `深さ ${d} mm（模擬値）`;
      } else {
        depthVal.textContent = '—';
        depthText = '';
      }
      scene.setDepthText(depthText);
    }

    let animRaf = 0;
    function startLineAnim() {
      cancelAnimationFrame(animRaf);
      const L = line;
      const t0 = performance.now();
      depthBox.classList.remove('is-counting'); void depthBox.offsetWidth; depthBox.classList.add('is-counting');
      const tick = () => {
        animRaf = 0;
        if (signal.aborted || line !== L) return;
        const now = performance.now();
        const u = Math.min(1, (now - t0) / 900);
        grow = 1 - Math.pow(1 - u, 3);
        const u2 = Math.min(1, Math.max(0, (now - t0 - 300) / 1300));
        setDepthDisplay(L, 1 - Math.pow(1 - u2, 3));
        ct.redraw();
        if (u < 1 || u2 < 1) animRaf = requestAnimationFrame(tick);
        else depthBox.classList.remove('is-counting');
      };
      tick();
    }

    // =====================================================================
    // 操作
    // =====================================================================
    function pushUndo() {
      undo.push({ circles, line });
      if (undo.length > 40) undo.shift();
    }
    /** 関心領域・ラインを state に保存する（描いた症例の ID も一緒に。どちらも空なら null） */
    function commitRoi() {
      setState({
        roi: circles.map((o) => ({ ...o })),
        line: line ? { start: line.start.slice(), end: line.end.slice() } : { start: null, end: null },
        roiCaseId: circles.length || line ? state.caseId : null,
      });
    }

    function setTool(t) {
      if (t === 'line') { if (tool !== 'line') enterLineMode(); return; }
      if (tool === 'line') cancelDraft();
      tool = t;
      render();
    }
    function setSize(k) {
      size = k;
      if (tool === 'line') setTool('pen'); else render();
    }
    function enterLineMode() {
      if (stroke) endStroke();
      tool = 'line';
      draftStart = null;
      redrawing = !!line;
      scene.setLineDim(redrawing);
      render();
    }
    function cancelDraft() {
      draftStart = null;
      if (redrawing) {
        redrawing = false;
        scene.setLineDim(false);
        scene.setLine(line);
      }
    }
    function onRelineClick() {
      if (tool !== 'line') { enterLineMode(); return; }
      // ライン指定中: キャンセルしてペンへ
      cancelDraft();
      tool = 'pen';
      render();
    }

    function inImage(w) {
      return Math.abs(w.x) <= FOV_HALF && Math.abs(w.y - CT_CY) <= FOV_HALF;
    }

    function placeLinePoint(p) {
      if (!draftStart) {
        draftStart = p;
        if (redrawing) scene.setLine(null);
        render();
        return;
      }
      const L = computeLine(draftStart, p);
      if (!L || L.length < 3) { notify('始点から離れた位置を指定してください', { kind: 'warn', ms: 1800 }); return; }
      pushUndo();
      line = L;
      draftStart = null;
      redrawing = false;
      scene.setLineDim(false);
      scene.setLine(L, { animate: true });
      commitRoi();
      grow = 0;
      startLineAnim();
      // 2 点を置いたら、自動で ROI 描画（ペン）に切り替える
      tool = 'pen';
      render();
      penBtn.classList.remove('is-auto'); void penBtn.offsetWidth; penBtn.classList.add('is-auto');
      later(() => penBtn.classList.remove('is-auto'), 1800);
      notify('2点ラインを引きました。ROI描画（ペン）に切り替えます。', { kind: 'success', ms: 2400 });
    }

    function applyBrushTo(x, y) {
      const r = BRUSH[size].r;
      const spacing = Math.max(0.8, r * 0.3);
      const from = stroke.last;
      const pts = [];
      if (!from) pts.push([x, y]);
      else {
        const d = Math.hypot(x - from[0], y - from[1]);
        if (d < spacing) return;
        const n = Math.ceil(d / spacing);
        for (let i = 1; i <= n; i++) pts.push([from[0] + ((x - from[0]) * i) / n, from[1] + ((y - from[1]) * i) / n]);
      }
      const z = ct.z;
      let next = circles;
      for (const [px, py] of pts) next = tool === 'pen' ? paintCircle(next, px, py, z, r) : eraseAt(next, px, py, z, r);
      stroke.last = [x, y];
      if (next !== circles) {
        circles = next;
        stroke.changed = true;
        scene.setRoi(circles, { delay: 160 });
      }
    }
    function endStroke() {
      if (!stroke) return;
      const changed = stroke.changed;
      stroke = null;
      if (changed) {
        commitRoi();
        scene.setRoi(circles, { delay: 40 });
      } else undo.pop();
      renderStats();
      render();
    }

    function doUndo() {
      if (stroke) return;
      const s = undo.pop();
      if (!s) { notify('元に戻す操作はありません', { ms: 1500 }); return; }
      const lineChanged = s.line !== line;
      // ラインの引き直し中（始点を置くと 3D のラインを隠している）なら、3D のラインも戻す
      const wasRedrawing = redrawing;
      circles = s.circles;
      line = s.line;
      if (tool === 'line') { draftStart = null; redrawing = false; scene.setLineDim(false); if (line) tool = 'pen'; }
      commitRoi();
      scene.setRoi(circles, { immediate: true });
      if (lineChanged || wasRedrawing) { cancelAnimationFrame(animRaf); grow = 1; scene.setLine(line); setDepthDisplay(line); }
      renderStats();
      render();
    }

    async function clearAll() {
      if (dialogOpen || stroke) return;
      if (!circles.length && !line) return;
      const cb = h('input', { type: 'checkbox' });
      dialogOpen = true;
      const ok = await dialog({
        title: '全て削除',
        body: h('div', { class: 'roi-dialog' },
          h('p', {}, circles.length ? '塗った関心領域をすべて削除しますか？' : '関心領域はまだ塗られていません。'),
          line ? h('label', { class: 'roi-check' }, cb, h('span', {}, '2点ラインも削除する')) : null,
          h('p', { class: 'small faint' }, '削除した後も［元に戻す］で取り消せます。')),
        buttons: [{ label: 'キャンセル', value: false }, { label: '削除', value: true, kind: 'primary' }],
      });
      dialogOpen = false;
      if (!ok || signal.aborted) return;
      const dropLine = !!line && cb.checked;
      if (!circles.length && !dropLine) return;
      pushUndo();
      circles = [];
      if (dropLine) {
        line = null;
        cancelAnimationFrame(animRaf);
        scene.setLine(null);
        setDepthDisplay(null);
      }
      commitRoi();
      scene.setRoi([], { immediate: true });
      renderStats();
      render();
      notify(dropLine ? '関心領域とラインを削除しました' : '関心領域を削除しました', { ms: 2000 });
    }

    function setAi(on) {
      aiOn = on && state.researchMode;
      aiChip.classList.toggle('is-on', aiOn);
      aiChip.setAttribute('aria-pressed', String(aiOn));
      scene.setAiRoi(aiOn);
      renderLegend();
      ct.redraw();
    }

    let skinPct = SKIN_DEFAULT;
    function onSkin(v) {
      skinPct = v;
      scene.setSkinTransparency(v);
      updateGuideNote();
    }
    function updateGuideNote() {
      const skinOn = chipEls.find((b) => b.dataset.layer === 'skin')?.classList.contains('is-on');
      guideNote.classList.toggle('is-shown', skinPct <= 0 && !!skinOn);
    }

    function saveAndNext() {
      if (stroke) endStroke();
      if (tool === 'line' && draftStart) cancelDraft();
      // 何も描いていないときは、別の症例で描いた関心領域・ラインを消さない
      if (circles.length || line || !state.roiCaseId || state.roiCaseId === state.caseId) commitRoi();
      if (circles.length || line) toast('関心領域とラインを保存しました', { kind: 'success', ms: 2000 });
      else toast('関心領域は未設定のまま、端末への転送に進みます', { ms: 2400 });
      navigate('transfer');
    }

    // =====================================================================
    // CT の拡大表示（指定した点を中心に）
    // =====================================================================
    const synthPanning = false;
    function viewAt(cx, cy, zoom) {
      ct.setView({ zoom, centerX: cx, centerY: cy });
      ct.redraw();
      render();
    }
    /** 拡大の中心: 現在のスライスの ROI → ROI 全体 → ライン → 結節 */
    function focusPoint() {
      const cur = circles.filter((o) => Math.abs(o.z - ct.z) <= 2.01);
      const list = cur.length ? cur : circles;
      if (list.length) {
        let x = 0, y = 0;
        for (const o of list) { x += o.x; y += o.y; }
        return [x / list.length, y / list.length];
      }
      if (line) return line.skin ? [(line.end[0] + line.skin[0]) / 2, (line.end[1] + line.skin[1]) / 2] : [line.end[0], line.end[1]];
      return [NODULE.c[0], NODULE.c[1]];
    }
    function toggleZoom() {
      if (ct.zoom > 1.05) viewAt(0, 0, 1);
      else { const [x, y] = focusPoint(); viewAt(x, y, 2); }
    }

    // =====================================================================
    // CT 上のポインタ操作
    // =====================================================================
    const local = (e) => { const r = ct.canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    let down = null;
    ct.canvas.addEventListener('pointerdown', (e) => {
      if (synthPanning || spacePan || e.button !== 0 || dialogOpen) return;
      const l = local(e);
      hover = l;
      if (tool === 'line') { down = { x: e.clientX, y: e.clientY }; return; }
      const w = ct.canvasToWorld(l.x, l.y);
      pushUndo();
      stroke = { last: null, changed: false };
      try { ct.canvas.setPointerCapture(e.pointerId); } catch { /* ツアーの合成イベントなど */ }
      applyBrushTo(w.x, w.y);
      ct.redraw();
    }, { signal });
    ct.canvas.addEventListener('pointermove', (e) => {
      if (synthPanning) return;
      hover = local(e);
      if (stroke) { const w = ct.canvasToWorld(hover.x, hover.y); applyBrushTo(w.x, w.y); }
      ct.redraw();
    }, { signal });
    ct.canvas.addEventListener('pointerup', (e) => {
      if (synthPanning) return;
      const l = local(e);
      if (tool === 'line' && down) {
        const d = down;
        down = null;
        if (Math.hypot(e.clientX - d.x, e.clientY - d.y) <= 6) {
          const w = ct.canvasToWorld(l.x, l.y);
          if (!inImage(w)) notify('CT画像の範囲内をクリックしてください', { kind: 'warn', ms: 1600 });
          else placeLinePoint([round1(w.x), round1(w.y), ct.z]);
        }
      }
      if (stroke) endStroke();
    }, { signal });
    ct.canvas.addEventListener('pointercancel', () => { down = null; if (stroke) endStroke(); }, { signal });
    ct.canvas.addEventListener('pointerleave', () => { if (!stroke) { hover = null; ct.redraw(); } }, { signal });

    // =====================================================================
    // キーボード
    // =====================================================================
    const blocked = (e) => dialogOpen || document.querySelector('.dialog-overlay') || (e.target instanceof HTMLElement && e.target.closest('input, textarea, select'));
    document.addEventListener('keydown', (e) => {
      if (blocked(e)) return;
      if (e.code === 'Space' && hover) {
        e.preventDefault();
        if (!spacePan && !stroke) { spacePan = true; ct.setInteraction('pan'); ct.canvas.style.cursor = 'grab'; }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); doUndo(); return; }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      switch (e.key) {
        case 'Escape':
          if (tool === 'line' && (draftStart || redrawing)) { e.preventDefault(); cancelDraft(); if (line) tool = 'pen'; render(); }
          break;
        case 'ArrowUp': e.preventDefault(); ct.setZ(ct.z + SLICE_STEP); break;
        case 'ArrowDown': e.preventDefault(); ct.setZ(ct.z - SLICE_STEP); break;
        case 'p': case 'P': setTool('pen'); break;
        case 'e': case 'E': setTool('eraser'); break;
        case '1': setSize('L'); break;
        case '2': setSize('M'); break;
        case '3': setSize('S'); break;
        default: break;
      }
    }, { signal });
    document.addEventListener('keyup', (e) => {
      if (e.code === 'Space' && spacePan) {
        e.preventDefault();
        spacePan = false;
        ct.setInteraction('custom');
        ct.canvas.style.cursor = 'crosshair';
      }
    }, { signal });

    const unsub = subscribe((s, patch) => { if ('researchMode' in patch) renderAiChip(); });

    // =====================================================================
    // 起動
    // =====================================================================
    renderAiChip();
    renderStats();
    render();
    requestAnimationFrame(layoutMarks);

    // ---- ツアー用の小道具 ----
    const clientOf = (x, y) => {
      const r = ct.canvas.getBoundingClientRect();
      const p = ct.worldToCanvas(x, y);
      return { x: r.left + p.x, y: r.top + p.y };
    };
    function resetForTour() {
      if (stroke) endStroke();
      cancelAnimationFrame(animRaf);
      circles = []; line = null; draftStart = null; redrawing = false; undo.length = 0;
      tool = 'line'; size = 'L'; grow = 1;
      commitRoi();
      scene.setRoi([], { immediate: true });
      scene.setLine(null);
      scene.setLineDim(false);
      setDepthDisplay(null);
      chipEls.forEach((b) => {
        const l = LAYERS.find((x) => x.id === b.dataset.layer);
        b.classList.toggle('is-on', l.on);
        b.setAttribute('aria-pressed', String(l.on));
        scene.setLayer(l.id, l.on);
      });
      skinSlider.set(SKIN_DEFAULT);
      onSkin(SKIN_DEFAULT);
      renderStats();
      render();
    }
    async function stepSlices(t, target, ms = 150) {
      target = sliceZ(target);
      while (ct.z !== target) {
        t.check();
        ct.setZ(ct.z + (target > ct.z ? SLICE_STEP : -SLICE_STEP));
        await t.sleep(ms);
      }
    }
    function moveEvent(p) {
      ct.canvas.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: p.x, clientY: p.y, pointerId: 77, pointerType: 'mouse', buttons: 0, isPrimary: true }));
    }
    async function hoverTo(t, a, b, n = 14) {
      for (let i = 1; i <= n; i++) {
        const p = { x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n };
        moveEvent(p);
        await t.pointAt(p, 40);
      }
    }
    /** 中心 (cx, cy)・半径 R の周りをなぞるクライアント座標の点列 */
    function loopPath(cx, cy, R, n = 44, turns = 1.15, phase = 0) {
      const pts = [];
      for (let i = 0; i <= n; i++) {
        const th = phase + (i / n) * Math.PI * 2 * turns;
        const rr = R * (1 + 0.08 * Math.sin(th * 3 + 0.7));
        pts.push(clientOf(cx + Math.cos(th) * rr, cy + Math.sin(th) * rr));
      }
      return pts;
    }
    /** スライダーのつまみの位置（クライアント座標） */
    const thumbAt = (v) => {
      const r = skinSlider.input.getBoundingClientRect();
      return { x: r.left + 8 + (v / 100) * (r.width - 16), y: r.top + r.height / 2 };
    };
    async function animateSkin(t, from, to, ms) {
      const n = Math.max(1, Math.round(ms / 70));
      await t.pointAt(thumbAt(from), 350);
      for (let i = 1; i <= n; i++) {
        const v = Math.round(from + ((to - from) * i) / n);
        skinSlider.set(v);
        onSkin(v);
        await t.pointAt(thumbAt(v), 20);
      }
    }

    /**
     * ツアー中にこの画面が破棄された（別の画面へ移動した）ら、それ以上は操作しないように
     * ツアーのヘルパーを包んで、画面の signal も確認する
     */
    function guardTour(t) {
      const alive = () => { if (signal.aborted) throw new DOMException('aborted', 'AbortError'); };
      const wrap = (fn) => async (...args) => { alive(); const r = await fn(...args); alive(); return r; };
      return {
        ...t,
        check: () => { t.check(); alive(); },
        caption: (text) => { alive(); t.caption(text); },
        sleep: wrap(t.sleep),
        pointAt: wrap(t.pointAt),
        click: wrap(t.click),
        highlight: wrap(t.highlight),
        drag: wrap(t.drag),
      };
    }

    async function runTour(t) {
      resetForTour();
      ct.setWindow('lung');
      if (ct.zoom > 1) viewAt(0, 0, 1);
      const zNod = sliceZ(NODULE.c[2]);
      const zStart = zNod + 2 * SLICE_STEP;
      const sy = 24;
      const start = [round1(lateralSkinX(-1, sy, zStart) - 1.5), sy, zStart];
      const end = [NODULE.c[0], NODULE.c[1], zNod];
      if (ct.z !== zNod) ct.setZ(zNod);

      t.caption('関心領域の画面です。最初は［ライン］ツールが選ばれています。');
      await t.highlight(lineBtn, 1700);

      t.caption('CT上で2点を指定して「2点ライン」を引きます。まず右胸壁の体表付近に［始点］。');
      await t.pointAt(sliderEl || ct.el, 450);
      await stepSlices(t, zStart, 160);
      await t.sleep(250);
      const ps = clientOf(start[0], start[1]);
      await t.drag(ct.canvas, [ps, ps], { stepMs: 80 });
      await t.sleep(700);

      t.caption('［終点］は別のスライスでも指定できます。結節のあるスライスへ移動して、結節の中心に［終点］。');
      await t.pointAt(sliderEl || ct.el, 450);
      await stepSlices(t, zNod, 200);
      await t.sleep(200);
      const pe = clientOf(end[0], end[1]);
      await hoverTo(t, ps, pe, 12);
      await t.sleep(250);
      await t.drag(ct.canvas, [pe, pe], { stepMs: 80 });
      await t.sleep(500);

      t.caption('線は体表から外側へ10cm延長して表示。体表から終点までの深さがカウントアップします（デモ用の模擬値）。');
      await t.highlight(depthBox, 3400);

      t.caption('2点を置くと自動でROI描画（ペン）に切り替わり、［ライン］はグレー表示になります。');
      await t.highlight(penBtn, 1100);
      await t.highlight(lineBtn, 900);

      t.caption('ペン（大）で結節の周りをなぞり、関心領域を塗ります。');
      await t.click(zoomBtn);
      await t.sleep(500);
      await t.click(sizeBtns[0]);
      await t.drag(ct.canvas, loopPath(end[0], end[1], 7, 40, 1.15), { stepMs: 24 });
      await t.sleep(500);

      t.caption('前後のスライスも塗ると、3Dの関心領域が立体的になります。');
      const paintAt = async (dz, R, n, phase) => {
        await stepSlices(t, zNod + dz, 120);
        await t.drag(ct.canvas, loopPath(end[0], end[1], R, n, 1.1, phase), { stepMs: 22 });
        await t.sleep(150);
      };
      await t.pointAt(sliderEl || ct.el, 400);
      await paintAt(3 * SLICE_STEP, 4.5, 30, 1.2);
      await paintAt(5 * SLICE_STEP, 1.2, 16, 0.4);
      await paintAt(-3 * SLICE_STEP, 4.5, 30, 2.4);
      await paintAt(-5 * SLICE_STEP, 1.2, 16, 3.1);
      await stepSlices(t, zNod, 100);

      t.caption('3D表示にも、塗った関心領域とラインがすぐに反映されます。');
      await t.click(focusBtn);
      await t.sleep(2000);

      t.caption('表示切替で心臓・血管を表示。どれも選ばないときは、背景のボリュームだけになります。');
      const chipOf = (id) => chipEls.find((b) => b.dataset.layer === id);
      await t.click(chipOf('heart'));
      await t.click(chipOf('vessel'));
      await t.sleep(1400);
      await t.click(chipOf('heart'));
      await t.click(chipOf('vessel'));
      if (state.researchMode && !aiChip.hidden) {
        t.caption('研究開発中・未承認の自動生成ROIは、研究開発機能をONにしたときだけ表示します（既定はOFF）。');
        await t.click(aiChip);
        await t.sleep(1600);
        await t.click(aiChip);
      }

      t.caption('体表の透過度を0にすると、青いテンプレートガイドを表示します。');
      await t.click(homeBtn);
      await animateSkin(t, SKIN_DEFAULT, 0, 1200);
      await t.sleep(2200);
      await animateSkin(t, 0, SKIN_DEFAULT, 600);

      t.caption('描画が終わったら［保存して次へ］で、端末への転送に進みます。');
      await t.pointAt(nextBtn, 600);
      await t.highlight(nextBtn, 1400);
    }

    return {
      destroy() {
        for (const t of timers) clearTimeout(t);
        timers.clear();
        cancelAnimationFrame(animRaf);
        unsub();
        roMarks.disconnect();
        // 確認ダイアログを開いたまま画面を離れた場合は［キャンセル］で閉じる
        if (dialogOpen) document.querySelector('.dialog-overlay .roi-dialog')?.closest('.dialog-overlay')?.querySelector('.dialog-actions .btn')?.click();
        scene.dispose();
        ct.dispose();
      },

      /** ガイドツアー（約40秒） */
      async tour(t) {
        tourRunning = true;
        try {
          await runTour(guardTour(t));
        } finally {
          tourRunning = false;
        }
      },
    };
  },
};
