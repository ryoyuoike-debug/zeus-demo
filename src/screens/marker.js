// =============================================================================
// S4 マーカ確認（PCアプリ「Zeus」）
//   ・CT 撮影時に体表へ貼った 3 点のマーカ（右鎖骨中線／左鎖骨中線／剣状突起）を
//     CT 画像から自動認識し、3D 表示で黄色にハイライトする
//   ・右側: 各マーカが写っているスライスのサムネイルと、2D CT ビューア
//   ・[やり直し] → 確認ダイアログ（はい／いいえ）→ 3D の体表または CT 上をクリックして置き直し
//   ・[確定] → [次へ：関心領域]
//   ・側臥位のデータは 3D 表示を回転した状態で始める
// =============================================================================
import '../styles/screens/marker.css';
import { h, dialog, toast } from '../ui/dom.js';
import { state, setState, subscribe, navigate, currentCase } from '../app/state.js';
import { studyDateTime } from '../data/cases.js';
import { MARKERS, MARKER_RADIUS } from '../data/phantom.js';
import { createCtViewer, zToSliceIndex, sliceIndexToZ, SLICE_COUNT, prefetchSlices } from '../ui/ctViewer.js';
import { createMarkerScene, LAYERS } from './marker/scene3d.js';
import { renderCrop } from './marker/ctCrop.js';
import { snapToSkin } from './marker/geom.js';

const POSITION_LABEL = { supine: '仰臥位', right: '右側臥位', left: '左側臥位' };
const NUM = ['①', '②', '③'];
/** サムネイルの切り出し範囲（mm）と解像度 */
const CROP = { wmm: 100, hmm: 56, pw: 200, ph: 112, dy: -15, ring: 22 };

/** 置き直した位置（画面を離れても保持し、デモのリセットで破棄する） */
let manualPositions = null;
subscribe((s, patch) => {
  // resetDemo() は全項目をまとめて更新する
  if ('imported' in patch && 'roi' in patch && 'markersConfirmed' in patch && !s.markersConfirmed) manualPositions = null;
});

const sliceZ = (z) => sliceIndexToZ(zToSliceIndex(z));
const imLabel = (z) => `Im ${zToSliceIndex(z) + 1}/${SLICE_COUNT}`;

export default {
  id: 'marker',
  title: 'マーカ確認',
  frame: 'pc',

  mount(root, ctx) {
    const { signal } = ctx;
    // 直接開かれた場合は、前の手順（取込・3D構成）が済んでいるものとして扱う
    if (!state.imported || !state.reconstructed) setState({ imported: true, reconstructed: true });
    const c = currentCase();
    const position = POSITION_LABEL[state.position] ? state.position : 'supine';
    const decubitus = position !== 'supine';

    // ---- タイマー（中断可能） ----
    const timers = new Set();
    const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); if (!signal.aborted) fn(); }, ms); timers.add(t); return t; };
    const wait = (ms) => new Promise((resolve, reject) => {
      if (signal.aborted) return reject(new DOMException('aborted', 'AbortError'));
      const t = setTimeout(() => { timers.delete(t); resolve(); }, ms);
      timers.add(t);
      signal.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('aborted', 'AbortError')); }, { once: true });
    });

    // ---- 状態 ----
    const marks = MARKERS.map((m, i) => {
      const manual = manualPositions?.[i] || null;
      return { ...m, idx: i, auto: m.pos, pos: manual || m.pos, manual: !!manual, status: 'pending' };
    });
    /** 'loading' | 'detecting' | 'review' | 'placing' | 'confirmed' */
    let mode = 'loading';
    let selected = -1;
    let placeIdx = -1;
    let backup = null;
    let dialogOpen = false;

    // =====================================================================
    // DOM
    // =====================================================================
    const statusBadge = h('span', { class: 'badge badge-info mk-status-badge' });
    const toolbar = h('div', { class: 'pc-toolbar mk-toolbar' },
      h('div', { class: 'pc-section-title' }, h('span', { class: 'num' }, '2'), 'マーカ確認'),
      h('div', { class: 'mk-case' },
        h('span', { class: 'mk-case-id mono' }, c.id),
        h('span', {}, c.name),
        h('span', { class: 'mk-case-sep' }),
        h('span', { class: 'muted' }, `撮影日 ${studyDateTime(c)}`),
        h('span', { class: 'muted mk-hide-narrow' }, c.description)),
      h('div', { class: 'mk-tb-spacer' }),
      h('span', { class: 'mk-pos-chip' + (decubitus ? ' is-decubitus' : ''), title: '取込時に選んだ体位' }, h('span', { class: 'faint' }, '体位'), POSITION_LABEL[position]),
      statusBadge);

    // ---- 3D 表示 ----
    const host3d = h('div', { class: 'three-host mk-3d-host' });
    const banner = h('div', { class: 'mk-banner', role: 'status', 'aria-live': 'polite' });
    const loading = h('div', { class: 'mk-loading' }, h('span', { class: 'spinner' }), '3Dモデルを準備しています…');
    const layerChips = LAYERS.map((l) => {
      const b = h('button', {
        class: 'chip mk-chip is-on', type: 'button', 'aria-pressed': 'true',
        onclick: () => {
          const on = !b.classList.contains('is-on');
          b.classList.toggle('is-on', on);
          b.setAttribute('aria-pressed', String(on));
          scene.setLayer(l.id, on);
        },
      }, l.name);
      return b;
    });
    const legendText = h('span', {}, '自動認識したマーカ');
    const legend = h('div', { class: 'mk-legend' }, h('span', { class: 'mk-legend-dot' }), legendText);
    const homeBtn = h('button', { class: 'icon-btn mk-icon-btn', type: 'button', title: '全体を表示', onclick: () => scene.home() }, '⟲');
    const frontBtn = decubitus ? h('button', { class: 'btn btn-sm mk-front-btn', type: 'button', onclick: () => scene.front() }, '前面から見る') : null;
    const view3d = h('section', { class: 'mk-3d', 'aria-label': '3D表示' },
      host3d,
      h('div', { class: 'mk-3d-head' },
        h('div', { class: 'mk-3d-title' }, h('strong', {}, '3D表示'),
          decubitus
            ? h('span', { class: 'mk-rot-note', title: `${POSITION_LABEL[position]}で撮影したデータのため、3D表示を回転した状態で始めています` },
              h('span', { class: 'mk-rot-ico', 'aria-hidden': 'true' }, '↻'), `${POSITION_LABEL[position]}：回転した状態で表示`)
            : h('span', { class: 'muted' }, '体表（半透明）・骨・肺'))),
      h('div', { class: 'mk-3d-tools' }, h('div', { class: 'mk-chips', role: 'group', 'aria-label': '表示する構造' }, layerChips), frontBtn, homeBtn),
      banner,
      legend,
      h('div', { class: 'mk-3d-hint' }, 'ドラッグ: 回転　ホイール: 拡大・縮小　右ドラッグ: 移動'),
      loading);

    // ---- 右側: マーカの一覧（スライスのサムネイル）と CT ビューア ----
    const countBadge = h('span', { class: 'badge mk-count' });
    const cards = marks.map((m, i) => {
      const cv = h('canvas', { class: 'mk-thumb-cv', width: CROP.pw, height: CROP.ph });
      const ring = h('span', { class: 'mk-thumb-ring' });
      const im = h('span', { class: 'mk-thumb-im mono' });
      const st = h('span', { class: 'mk-card-state' });
      const el = h('button', {
        class: 'mk-card', type: 'button', 'aria-label': `${m.name}のマーカを表示`,
        onclick: () => onCardClick(i),
      },
      h('span', { class: 'mk-thumb' }, cv, h('span', { class: 'mk-thumb-scan' }), ring, im, st),
      h('span', { class: 'mk-card-name' },
        h('span', { class: 'mk-card-num' }, String(i + 1)),
        h('span', { class: 'mk-card-label' }, m.name),
        h('span', { class: 'mk-ardot', style: { background: m.color }, title: 'ARグラスでの位置合わせで、この点に置く球の色' })));
      return { el, cv, ring, im, st };
    });
    const arNote = h('p', { class: 'mk-ar-note' },
      'ARグラスでの位置合わせでも、同じ3点に順に球を置きます。',
      h('span', { class: 'mk-ar-legend' }, marks.map((m, i) => h('span', {}, h('i', { style: { background: m.color } }), `${i + 1}`))));
    const ctHost = h('div', { class: 'mk-ct-host' });
    const ctSel = h('span', { class: 'mk-ct-sel' });
    const side = h('section', { class: 'mk-side', 'aria-label': 'マーカの一覧とCT画像' },
      h('div', { class: 'mk-list' },
        h('div', { class: 'mk-side-head' }, h('h3', {}, 'マーカ（3点）'), countBadge),
        h('div', { class: 'mk-cards' }, cards.map((x) => x.el)),
        arNote),
      h('div', { class: 'mk-ct' },
        h('div', { class: 'mk-ct-head' }, h('strong', {}, 'CT（軸位断）'), ctSel),
        ctHost));

    // ---- アクションバー ----
    const hint = h('span', { class: 'hint mk-hint' });
    const redoBtn = h('button', { class: 'btn mk-redo', type: 'button', onclick: () => redo() }, h('span', { 'aria-hidden': 'true' }, '↺'), 'やり直し');
    const okBtn = h('button', { class: 'btn btn-primary mk-ok', type: 'button', onclick: () => confirmMarkers() }, h('span', { 'aria-hidden': 'true' }, '✓'), '確定');
    const nextBtn = h('button', { class: 'btn btn-accent btn-lg mk-next', type: 'button', disabled: true, onclick: () => navigate('roi') }, '次へ：関心領域', h('span', { 'aria-hidden': 'true' }, '›'));
    const actionBar = h('div', { class: 'action-bar mk-actions' },
      h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => navigate('home') }, '‹ メイン画面'),
      hint, h('div', { class: 'spacer' }), redoBtn, okBtn, nextBtn);

    const screen = h('div', { class: 'pc-screen mk' + (decubitus ? ' is-decubitus' : '') },
      toolbar,
      h('div', { class: 'mk-content' }, view3d, side),
      actionBar);
    root.appendChild(screen);

    // =====================================================================
    // CT ビューア
    // =====================================================================
    const ct = createCtViewer(ctHost, { z: sliceZ(marks[0].pos[2]), patientLabel: c.id, compact: true });
    prefetchSlices(marks.map((m) => sliceZ(m.auto[2])));
    const ctStage = ct.el.querySelector('.ct-stage');
    const ctPulse = h('span', { class: 'mk-ct-pulse' });
    ctStage.appendChild(ctPulse);
    let ctHover = null; // { pos, ok }

    const onSlice = (m, z) => Math.abs(m.pos[2] - z) <= MARKER_RADIUS + 1.2;
    const ringPx = (api) => Math.max(11, api.mmToPx(10));
    ct.addOverlay((g, api) => {
      const z = api.z;
      let pulseAt = null;
      // 置き直し中: 自動認識した位置（参考）を点線で
      if (mode === 'placing') {
        const cur = marks[placeIdx];
        if (cur && Math.abs(cur.auto[2] - z) <= MARKER_RADIUS + 1.2) {
          const p = api.worldToCanvas(cur.auto[0], cur.auto[1]);
          g.setLineDash([3, 3]);
          g.strokeStyle = 'rgba(200,210,230,0.75)';
          g.lineWidth = 1.2;
          g.beginPath(); g.arc(p.x, p.y, ringPx(api), 0, Math.PI * 2); g.stroke();
          g.setLineDash([]);
          g.font = '600 10.5px system-ui, sans-serif';
          g.fillStyle = 'rgba(200,210,230,0.85)';
          g.textAlign = 'center'; g.textBaseline = 'bottom';
          g.fillText('自動認識の位置', p.x, p.y - ringPx(api) - 3);
        }
      }
      marks.forEach((m, i) => {
        const shown = m.status === 'detected' || m.status === 'placed';
        if (!shown || !onSlice(m, z)) return;
        const p = api.worldToCanvas(m.pos[0], m.pos[1]);
        const r = ringPx(api);
        const sel = i === selected && mode !== 'placing';
        g.strokeStyle = '#ffd400';
        g.shadowColor = 'rgba(255,212,0,0.6)';
        g.shadowBlur = sel ? 8 : 4;
        g.lineWidth = sel ? 2.2 : 1.6;
        g.beginPath(); g.arc(p.x, p.y, r, 0, Math.PI * 2); g.stroke();
        g.shadowBlur = 0;
        // 十字の目盛り
        g.lineWidth = 1.4;
        g.beginPath();
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          g.moveTo(p.x + dx * (r + 3), p.y + dy * (r + 3));
          g.lineTo(p.x + dx * (r + 8), p.y + dy * (r + 8));
        }
        g.stroke();
        // ラベル: 患者の右側のマーカは画像の左へ、左側は右へ、正中は右下へ
        const label = sel ? `${i + 1} ${m.name}` : String(i + 1);
        g.font = '700 11px system-ui, sans-serif';
        const tw = g.measureText(label).width + 10;
        const side = m.pos[0] < -10 ? -1 : 1;
        const lx = side < 0 ? p.x - r - 10 - tw : p.x + r + 10;
        const ly = m.pos[0] < -10 || m.pos[0] > 10 ? p.y - 8 : p.y + r * 0.35;
        g.fillStyle = sel ? 'rgba(255,212,0,0.95)' : 'rgba(10,14,24,0.8)';
        g.strokeStyle = 'rgba(255,212,0,0.8)';
        g.lineWidth = 1;
        g.beginPath();
        g.roundRect ? g.roundRect(lx, ly, tw, 16, 8) : g.rect(lx, ly, tw, 16);
        g.fill(); g.stroke();
        g.fillStyle = sel ? '#1a1400' : '#ffe35a';
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(label, lx + tw / 2, ly + 8.5);
        if (sel) pulseAt = { x: p.x, y: p.y, r };
      });
      // 置き直し中のホバー位置
      if (mode === 'placing' && ctHover) {
        const p = api.worldToCanvas(ctHover.pos[0], ctHover.pos[1]);
        const r = ringPx(api);
        g.strokeStyle = '#ffb020';
        g.setLineDash([4, 3]);
        g.lineWidth = 1.8;
        g.beginPath(); g.arc(p.x, p.y, r, 0, Math.PI * 2); g.stroke();
        g.setLineDash([]);
        g.font = '700 11px system-ui, sans-serif';
        g.textAlign = 'left'; g.textBaseline = 'middle';
        g.fillStyle = '#ffd27a';
        g.fillText(`${placeIdx + 1} ${marks[placeIdx].name}`, p.x + r + 6, p.y);
      }
      if (pulseAt) {
        ctPulse.style.display = 'block';
        ctPulse.style.left = `${pulseAt.x}px`;
        ctPulse.style.top = `${pulseAt.y}px`;
        ctPulse.style.width = ctPulse.style.height = `${pulseAt.r * 2}px`;
      } else ctPulse.style.display = 'none';
    });
    ct.onSliceChange(() => updateCtHeader());

    // CT 上の操作: 置き直し中はクリックで配置、それ以外はリングをクリックで選択
    const ctLocal = (e) => { const r = ct.canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    let ctDown = null;
    ct.canvas.addEventListener('pointerdown', (e) => { ctDown = { x: e.clientX, y: e.clientY, t: performance.now() }; }, { signal });
    ct.canvas.addEventListener('pointermove', (e) => {
      if (mode !== 'placing') return;
      const l = ctLocal(e);
      const w = ct.canvasToWorld(l.x, l.y);
      const s = snapToSkin([w.x, w.y, ct.z], 30);
      ctHover = s ? { pos: s.pos } : null;
      ct.canvas.style.cursor = s ? 'crosshair' : 'not-allowed';
      ct.redraw();
    }, { signal });
    ct.canvas.addEventListener('pointerleave', () => { if (ctHover) { ctHover = null; ct.redraw(); } ct.canvas.style.cursor = ''; }, { signal });
    ct.canvas.addEventListener('pointerup', (e) => {
      const d = ctDown; ctDown = null;
      if (!d || e.button !== 0) return;
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5 || performance.now() - d.t > 700) return;
      const l = ctLocal(e);
      if (mode === 'placing') {
        const w = ct.canvasToWorld(l.x, l.y);
        placeCurrent([w.x, w.y, ct.z], 'ct');
        return;
      }
      if (mode !== 'review' && mode !== 'confirmed') return;
      const r = ringPx(ct) + 8;
      let best = -1, bd = r;
      marks.forEach((m, i) => {
        if (!(m.status === 'detected' || m.status === 'placed') || !onSlice(m, ct.z)) return;
        const p = ct.worldToCanvas(m.pos[0], m.pos[1]);
        const dd = Math.hypot(p.x - l.x, p.y - l.y);
        if (dd < bd) { bd = dd; best = i; }
      });
      if (best >= 0) select(best, { fly: true, ct: false });
    }, { signal });

    // =====================================================================
    // 3D
    // =====================================================================
    const scene = createMarkerScene(host3d, {
      markers: marks.map((m) => ({ id: m.id, name: m.name, pos: m.pos })),
      position,
      onPick: (i) => { if (mode === 'review' || mode === 'confirmed') select(i, { fly: true }); },
      onPlace: (p) => placeCurrent(p, '3d'),
      onMiss: () => toast('体表（人体の表面）をクリックしてください', { kind: 'warn', ms: 1800 }),
      labelText: (i) => `${i + 1} ${marks[i].name} をここに配置`,
    });

    // =====================================================================
    // サムネイル
    // =====================================================================
    function renderThumb(i) {
      const m = marks[i];
      const z = sliceZ(m.pos[2]);
      const cx = m.pos[0], cy = m.pos[1] + CROP.dy;
      renderCrop(cards[i].cv, { cx, cy, z, wmm: CROP.wmm, hmm: CROP.hmm, pw: CROP.pw, ph: CROP.ph });
      const u = (m.pos[0] - (cx - CROP.wmm / 2)) / CROP.wmm;
      const v = (cy + CROP.hmm / 2 - m.pos[1]) / CROP.hmm;
      cards[i].ring.style.left = `${(u * 100).toFixed(2)}%`;
      cards[i].ring.style.top = `${(v * 100).toFixed(2)}%`;
      cards[i].ring.style.width = `${((CROP.ring / CROP.wmm) * 100).toFixed(2)}%`;
      cards[i].im.textContent = `Im ${zToSliceIndex(z) + 1}`;
      cards[i].im.title = imLabel(z);
    }

    // =====================================================================
    // 表示の更新
    // =====================================================================
    const STATUS_VIEW = {
      pending: ['is-pending', '検出中'],
      detected: ['is-ok', '検出'],
      placed: ['is-ok', '配置済み'],
      unplaced: ['is-unplaced', '未配置'],
      placing: ['is-placing', '配置待ち'],
    };
    function renderCards() {
      marks.forEach((m, i) => {
        const k = cards[i];
        const [cls, text] = STATUS_VIEW[m.status] || STATUS_VIEW.pending;
        k.el.className = `mk-card ${cls}` + (i === selected && mode !== 'placing' ? ' is-selected' : '') + (m.manual && m.status === 'placed' ? ' is-manual' : '');
        const icon = m.status === 'pending' ? h('span', { class: 'spinner mk-mini-spin' }) : (m.status === 'detected' || m.status === 'placed') ? h('span', { class: 'check' }, '✓') : null;
        k.st.replaceChildren(...(icon ? [icon, text] : [text]));
      });
    }
    function updateCtHeader() {
      if (mode === 'placing' && placeIdx >= 0) {
        ctSel.replaceChildren(h('span', { class: 'mk-ct-tag is-placing' }, `${NUM[placeIdx]} ${marks[placeIdx].name}`), h('span', { title: 'ホイールでスライスを送れます' }, 'の位置をクリック'));
        return;
      }
      const m = marks[selected];
      if (!m || !(m.status === 'detected' || m.status === 'placed')) { ctSel.replaceChildren(h('span', { class: 'faint' }, 'マーカを選ぶと、そのスライスを表示します')); return; }
      const on = onSlice(m, ct.z);
      ctSel.replaceChildren(
        h('span', { class: 'mk-ct-tag' }, `${NUM[selected]} ${m.name}`),
        on ? h('span', { class: 'mono faint' }, imLabel(sliceZ(m.pos[2]))) : h('button', { class: 'btn btn-sm btn-ghost mk-ct-jump', type: 'button', onclick: () => ct.setZ(m.pos[2]) }, 'このマーカのスライスへ'));
    }
    function render() {
      const detectedCount = marks.filter((m) => m.status === 'detected' || m.status === 'placed').length;
      // ツールバーのバッジ
      const badge = {
        loading: ['badge-info', '準備中'],
        detecting: ['badge-info', '自動認識中…'],
        review: ['badge-warn', '確認待ち'],
        placing: ['badge-warn', `置き直し中 ${Math.min(placeIdx + 1, 3)}/3`],
        confirmed: ['badge-ok', '✓ 確定済み'],
      }[mode];
      statusBadge.className = `badge mk-status-badge ${badge[0]}`;
      statusBadge.textContent = badge[1];
      countBadge.className = `badge mk-count ${detectedCount === 3 ? 'badge-ok' : 'badge-info'}`;
      legendText.textContent = marks.some((m) => m.manual) ? 'マーカ（置き直した位置を含む）' : '自動認識したマーカ';
      countBadge.textContent = mode === 'placing' ? `配置 ${detectedCount}/3` : marks.some((m) => m.manual) ? `配置 ${detectedCount}/3（手動）` : `自動認識 ${detectedCount}/3`;
      // ボタン
      redoBtn.disabled = !(mode === 'review' || mode === 'confirmed');
      okBtn.disabled = mode !== 'review';
      okBtn.classList.toggle('is-done', mode === 'confirmed');
      okBtn.lastChild.textContent = mode === 'confirmed' ? '確定済み' : '確定';
      nextBtn.disabled = mode !== 'confirmed';
      nextBtn.classList.toggle('is-pulse', mode === 'confirmed');
      hint.textContent = {
        loading: '3Dモデルを準備しています…',
        detecting: 'CT画像からマーカを自動認識しています…',
        review: '3点の位置を確認して［確定］を押してください。位置が違う場合は［やり直し］で置き直せます。',
        placing: `${NUM[placeIdx] || ''} ${marks[placeIdx]?.name || ''}の位置を、3D表示の体表またはCT画像上でクリックしてください。`,
        confirmed: 'マーカを確定しました。［次へ］で関心領域の設定に進みます。',
      }[mode];
      screen.classList.toggle('is-placing', mode === 'placing');
      renderCards();
      updateCtHeader();
      renderBanner();
      ct.redraw();
    }

    let bannerKind = null;
    function renderBanner() {
      if (mode === 'placing') {
        bannerKind = 'placing';
        banner.className = 'mk-banner is-shown is-placing';
        banner.replaceChildren(
          h('span', { class: 'mk-banner-step' }, `置き直し ${placeIdx + 1}/3`),
          h('span', { class: 'mk-banner-text' }, h('b', {}, `${NUM[placeIdx]} ${marks[placeIdx].name}`), ' の位置をクリック'),
          h('span', { class: 'mk-banner-dots' }, marks.map((m, i) => h('i', { class: i < placeIdx ? 'is-done' : i === placeIdx ? 'is-cur' : '' }))),
          h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => cancelPlacing() }, 'キャンセル'));
        return;
      }
      if (bannerKind === 'placing') { banner.className = 'mk-banner'; bannerKind = null; }
    }
    function showBanner(kind, text) {
      bannerKind = kind;
      const cls = kind === 'done' ? ' is-done' : '';
      banner.className = `mk-banner is-shown${cls}`;
      banner.replaceChildren(...[
        kind === 'detect' ? h('span', { class: 'spinner' }) : h('span', { class: 'check' }, '✓'),
        h('span', { class: 'mk-banner-text' }, text),
        kind === 'detect' ? h('span', { class: 'mk-banner-bar' }, h('span')) : null].filter(Boolean));
    }
    function hideBanner() { if (bannerKind !== 'placing') { banner.className = 'mk-banner'; bannerKind = null; } }

    // =====================================================================
    // 操作
    // =====================================================================
    function select(i, { fly = false, ct: jump = true } = {}) {
      if (i < 0 || i > 2) return;
      selected = i;
      scene.select(i);
      if (fly) scene.flyToMarker(i);
      if (jump) ct.setZ(marks[i].pos[2]);
      render();
    }
    function onCardClick(i) {
      if (mode === 'placing') {
        // 配置中のマーカのスライスへ移動（参考）
        if (i === placeIdx) ct.setZ(marks[i].auto[2]);
        return;
      }
      if (mode === 'review' || mode === 'confirmed') select(i, { fly: true });
    }

    async function runDetection() {
      mode = 'detecting';
      marks.forEach((m) => { m.status = 'pending'; });
      render();
      showBanner('detect', 'CT画像からマーカを検出中…');
      await wait(250);
      await scene.scan(1900, (i) => scene.setState(i, 'candidate'));
      if (signal.aborted) return;
      showBanner('detect', '3点を確認しています…');
      for (let i = 0; i < 3; i++) {
        scene.setState(i, 'candidate');
        scene.blink(i, 0.66);
        await wait(560);
        marks[i].status = marks[i].manual ? 'placed' : 'detected';
        scene.setState(i, 'detected');
        scene.pulse(i);
        cards[i].el.classList.add('is-reveal');
        render();
        await wait(160);
      }
      mode = 'review';
      select(0);
      showBanner('done', '3点のマーカを検出しました');
      later(hideBanner, 2400);
    }

    function showAllInstant() {
      marks.forEach((m, i) => {
        m.status = m.manual ? 'placed' : 'detected';
        scene.setState(i, 'detected');
      });
      mode = state.markersConfirmed ? 'confirmed' : 'review';
      select(0);
    }

    async function redo() {
      if (!(mode === 'review' || mode === 'confirmed') || dialogOpen) return;
      dialogOpen = true;
      const ok = await dialog({
        title: 'マーカのやり直し',
        body: h('div', { class: 'mk-dialog' },
          h('p', {}, '認識したマーカの位置を破棄して、3点を置き直しますか？'),
          h('ol', { class: 'mk-dialog-steps' }, marks.map((m, i) => h('li', {}, h('span', { class: 'mk-card-num' }, String(i + 1)), m.name))),
          h('p', { class: 'small faint' }, '3D表示の体表、またはCT画像上をクリックして、上の順に配置します。')),
        buttons: [{ label: 'いいえ', value: false }, { label: 'はい', value: true, kind: 'primary' }],
      });
      dialogOpen = false;
      if (!ok || signal.aborted) return;
      startPlacing();
    }

    function startPlacing() {
      backup = marks.map((m) => ({ pos: m.pos, manual: m.manual, status: m.status }));
      if (state.markersConfirmed) setState({ markersConfirmed: false });
      mode = 'placing';
      placeIdx = 0;
      marks.forEach((m, i) => { m.status = i === 0 ? 'placing' : 'unplaced'; scene.setState(i, 'ghost'); });
      scene.select(-1);
      scene.setPlacing(0);
      scene.home();
      ct.setInteraction('custom');
      ct.setZ(marks[0].auto[2]);
      render();
    }

    function placeCurrent(raw, from) {
      if (mode !== 'placing' || placeIdx < 0) return;
      const s = snapToSkin(raw, from === 'ct' ? 30 : 40);
      if (!s) { toast('体表の近くをクリックしてください', { kind: 'warn', ms: 1800 }); return; }
      const i = placeIdx;
      const m = marks[i];
      m.pos = s.pos;
      m.manual = true;
      m.status = 'placed';
      scene.setPos(i, s.pos);
      scene.setState(i, 'detected');
      scene.pulse(i);
      renderThumb(i);
      cards[i].el.classList.remove('is-reveal'); void cards[i].el.offsetWidth; cards[i].el.classList.add('is-reveal');
      ctHover = null;
      placeIdx++;
      if (placeIdx >= 3) { finishPlacing(); return; }
      marks[placeIdx].status = 'placing';
      scene.setPlacing(placeIdx);
      // 3D でクリックした場合は、CT を次のマーカの（自動認識位置の）スライスへ
      ct.setZ(marks[placeIdx].auto[2]);
      render();
    }

    function finishPlacing() {
      mode = 'review';
      placeIdx = -1;
      manualPositions = marks.map((m) => m.pos.slice());
      scene.setPlacing(-1);
      ct.setInteraction('pan');
      ct.canvas.style.cursor = '';
      select(0);
      toast('3点のマーカを置き直しました。確認して［確定］を押してください。', { kind: 'success', ms: 3200 });
    }

    function cancelPlacing() {
      if (mode !== 'placing' || !backup) return;
      marks.forEach((m, i) => {
        m.pos = backup[i].pos; m.manual = backup[i].manual; m.status = backup[i].status === 'placed' || backup[i].manual ? 'placed' : 'detected';
        scene.setPos(i, m.pos);
        scene.setState(i, 'detected');
        renderThumb(i);
      });
      mode = 'review';
      placeIdx = -1;
      ctHover = null;
      scene.setPlacing(-1);
      ct.setInteraction('pan');
      ct.canvas.style.cursor = '';
      select(Math.max(0, selected));
      toast('置き直しをキャンセルしました', { ms: 1800 });
    }

    function confirmMarkers() {
      if (mode !== 'review') return;
      mode = 'confirmed';
      setState({ markersConfirmed: true, markerPositions: marks.map((m) => [...m.pos]) });
      render();
      toast('マーカの位置を確定しました', { kind: 'success' });
    }

    // キーボード: 1〜3 で選択、Esc で置き直しをキャンセル
    document.addEventListener('keydown', (e) => {
      if (dialogOpen || document.querySelector('.dialog-overlay')) return;
      if (e.target instanceof HTMLElement && e.target.closest('input, textarea, select')) return;
      if (e.key === 'Escape' && mode === 'placing') { cancelPlacing(); e.preventDefault(); return; }
      if (['1', '2', '3'].includes(e.key) && (mode === 'review' || mode === 'confirmed')) select(+e.key - 1, { fly: true });
    }, { signal });

    // =====================================================================
    // 起動
    // =====================================================================
    render();
    // サムネイルは最初の描画の後に計算する
    later(() => { marks.forEach((_, i) => renderThumb(i)); }, 30);
    scene.ready.then(() => {
      if (signal.aborted) return;
      loading.classList.add('is-hidden');
      if (state.markersConfirmed) { showAllInstant(); return; }
      runDetection().catch((e) => { if (e?.name !== 'AbortError') console.error(e); });
    });

    return {
      destroy() {
        for (const t of timers) clearTimeout(t);
        timers.clear();
        // 確認ダイアログを開いたまま画面を離れた場合は［いいえ］で閉じる
        if (dialogOpen) document.querySelector('.dialog-overlay .mk-dialog')?.closest('.dialog-overlay')?.querySelector('.dialog-actions .btn')?.click();
        scene.dispose();
        ct.dispose();
      },

      /** ガイドツアー（約25秒） */
      async tour(t) {
        t.caption('CT撮影時に体表へ貼った3点のマーカを、CT画像から自動で認識します。');
        // 検出アニメーションの完了を待つ
        while (mode === 'loading' || mode === 'detecting') { t.check(); await t.sleep(150); }
        if (mode === 'placing') cancelPlacing();
        await t.sleep(400);
        t.caption('認識したマーカは黄色で表示されます。右鎖骨中線・左鎖骨中線・剣状突起の3点です。');
        await t.sleep(2000);

        t.caption('① 右鎖骨中線。3D表示が寄り、CTはそのマーカが写るスライスに切り替わります。');
        await t.click(cards[0].el);
        await t.sleep(1200);
        await t.pointAt(ctStage, 600);
        await t.highlight(ct.el, 800);

        t.caption('② 左鎖骨中線。3D表示のラベルからも選べます。');
        const lbl = host3d.querySelector('.mk3d-label:nth-of-type(2)');
        if (lbl && lbl.classList.contains('is-shown')) await t.click(lbl); else await t.click(cards[1].el);
        await t.sleep(1500);

        t.caption('③ 剣状突起。CTでも、体表の高吸収の点をリングで示します。');
        await t.click(cards[2].el);
        await t.sleep(1000);
        await t.pointAt(ctStage, 600);
        await t.highlight(ct.el, 700);
        scene.home(900);

        t.caption('位置が違う場合は［やり直し］。3D表示またはCT上で置き直せます。');
        await t.click(redoBtn);
        await t.sleep(1300);
        const no = [...document.querySelectorAll('.dialog-overlay .dialog-actions .btn')].find((b) => b.textContent.trim() === 'いいえ');
        if (no) await t.click(no);
        await t.sleep(300);

        t.caption('3点を確認したら［確定］。次は関心領域の設定です。');
        await t.click(okBtn);
        await t.sleep(700);
        await t.pointAt(nextBtn, 600);
        await t.sleep(1000);
      },
    };
  },
};
