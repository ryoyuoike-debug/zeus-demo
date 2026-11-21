// =============================================================================
// S6 端末への転送（PCアプリ「Zeus」）
//   ・リスト 3 から症例を選ぶ（既定: 作業中の症例 = DEMO-0001）
//   ・転送先の端末カード: Meta Quest 3 / XREAL（Beam Pro） / iPad / iPhone
//     USB 接続を検出すると点灯する（［接続を確認］で再検出）
//   ・［転送］ボタンは全端末で共通の 1 つ。接続中の端末へまとめて転送する（目安 約1秒）
//   ・完了メッセージ: Quest・XREAL「データ転送完了」／ iPad・iPhone「データ転送準備が完了」
//     （iPad・iPhone はこの後、フォルダを手動でコピーする）
//   ・関心領域（ROI）を設定していなくても転送できる
// =============================================================================
import '../styles/screens/transfer.css';
import { h } from '../ui/dom.js';
import { state, setState, subscribe, navigate } from '../app/state.js';
import { CASES, DEVICES, studyDateTime } from '../data/cases.js';
import { STRUCTURES } from '../data/phantom.js';
import { session as importSession } from './import/session.js';
import { PC_SVG, DEVICE_SVG, ICONS } from './transfer/illustrations.js';
import { createFlow } from './transfer/flow.js';

/** 端末ごとのデモ用の所要時間（ms）。「目安 約1秒」に合わせて短くしてある */
const DURATION = { quest: 1100, xreal: 1250, ios: 850 };
/** ［接続を確認］で端末が順に点灯するまでの時間（ms） */
const DETECT_DELAY = [420, 760, 1080];

// -----------------------------------------------------------------------------
// 画面を離れても保持する小さな状態（デモのリセットで初期化）
// -----------------------------------------------------------------------------
const memory = {
  /** 端末が USB ケーブルでつながっているか（デモ操作で抜き差しできる） */
  plugged: Object.fromEntries(DEVICES.map((d) => [d.id, true])),
  /** 検出済みの端末（null = まだ一度も確認していない） */
  linked: null,
  /** 症例 ID → 転送済みの端末 ID の集合 */
  sent: new Map(),
  /** リストで選んでいる症例 */
  selected: null,
};
const RESET_KEYS = ['imported', 'reconstructed', 'markersConfirmed', 'roi', 'line', 'transferred', 'registered'];
subscribe((_s, patch) => {
  if (RESET_KEYS.every((k) => k in patch)) {
    for (const d of DEVICES) memory.plugged[d.id] = true;
    memory.linked = null;
    memory.sent.clear();
    memory.selected = null;
  }
  // 作業中の症例の切り替え（selectCase）では転送状況が {} に戻るので、転送済みの記録とリストの選択も破棄する
  // （USB の接続状況はそのまま。転送画面の［転送］で症例を変えたときは transferred を含まないので対象外）
  if ('caseId' in patch && 'transferred' in patch) {
    memory.sent.clear();
    memory.selected = null;
  }
});

const byNewest = (a, b) => studyDateTime(b).localeCompare(studyDateTime(a));
const sentFor = (caseId) => {
  if (!memory.sent.has(caseId)) memory.sent.set(caseId, new Set());
  return memory.sent.get(caseId);
};
const abortError = () => new DOMException('aborted', 'AbortError');
const isAbort = (e) => e?.name === 'AbortError';

export default {
  id: 'transfer',
  title: '端末への転送',
  frame: 'pc',

  mount(root, ctx) {
    const { signal } = ctx;

    // 直接 URL で開いた場合は、取込と 3D 構成が終わっているものとみなす
    if (!state.imported || !state.reconstructed) setState({ imported: true, reconstructed: true });
    // この画面での転送の記録がまだなく、state.transferred だけがある（直接 URL で AR 表示を開いたなど）場合は、
    // 作業中の症例の転送済みとして扱う（transferred は症例ごとではないので、記録がある場合は使わない）
    const recorded = [...memory.sent.values()].some((set) => set.size > 0);
    if (!recorded) for (const [id, v] of Object.entries(state.transferred)) if (v) sentFor(state.caseId).add(id);

    // ---------------------------------------------------------------------
    // 小さなユーティリティ（すべて signal で中断できる）
    // ---------------------------------------------------------------------
    const wait = (ms) => new Promise((resolve, reject) => {
      if (signal.aborted) return reject(abortError());
      const t = setTimeout(resolve, ms);
      signal.addEventListener('abort', () => { clearTimeout(t); reject(abortError()); }, { once: true });
    });
    const tween = (ms, fn) => new Promise((resolve, reject) => {
      if (signal.aborted) return reject(abortError());
      const t0 = performance.now();
      let id = 0;
      const step = (now) => {
        const u = Math.min(1, (now - t0) / ms);
        fn(u);
        if (u < 1) id = requestAnimationFrame(step);
        else resolve();
      };
      id = requestAnimationFrame(step);
      signal.addEventListener('abort', () => { cancelAnimationFrame(id); reject(abortError()); }, { once: true });
    });

    // ---------------------------------------------------------------------
    // 端末ごとの実行時の状態
    // ---------------------------------------------------------------------
    const dev = Object.fromEntries(DEVICES.map((d) => [d.id, {
      ...d,
      link: memory.linked?.has(d.id) && memory.plugged[d.id] ? 'on' : 'off', // 'off' | 'detecting' | 'on'
      sending: false,
      progress: 0,
    }]));
    let scanning = false;
    let busy = false; // 転送中

    const rows = () => {
      const removed = importSession?.removed?.transfer;
      return CASES.filter((c) => c.id === state.caseId || !removed?.has(c.id)).sort(byNewest);
    };
    let selectedId = memory.selected && rows().some((c) => c.id === memory.selected) ? memory.selected : state.caseId;
    const selectedCase = () => CASES.find((c) => c.id === selectedId) || CASES[0];

    function statusOf(id) {
      const d = dev[id];
      if (d.link !== 'on') return d.link;
      if (d.sending) return 'sending';
      if (sentFor(selectedId).has(id)) return 'done';
      return 'connected';
    }
    const connectedIds = () => DEVICES.map((d) => d.id).filter((id) => dev[id].link === 'on');

    // =====================================================================
    // DOM
    // =====================================================================
    // ---- ツールバー ----
    const tbId = h('span', { class: 'tf-case-id mono' });
    const tbName = h('span');
    const tbDate = h('span', { class: 'muted' });
    const tbDesc = h('span', { class: 'muted tf-hide-narrow' });
    const statusBadge = h('span', { class: 'badge tf-status-badge' });
    const toolbar = h('div', { class: 'pc-toolbar tf-toolbar' },
      h('div', { class: 'pc-section-title' }, h('span', { class: 'num' }, '3'), '端末への転送'),
      h('div', { class: 'tf-case' }, tbId, tbName, h('span', { class: 'tf-case-sep' }), tbDate, tbDesc),
      h('div', { class: 'tf-tb-spacer' }),
      statusBadge);

    // ---- 左: 症例リスト ----
    const tbody = h('tbody');
    const table = h('table', { class: 'table tf-table', role: 'grid', 'aria-label': '端末への転送の症例一覧' },
      h('colgroup', {}, h('col', { class: 'c-date' }), h('col', { class: 'c-id' }), h('col', { class: 'c-name' })),
      h('thead', {}, h('tr', {},
        h('th', {}, '撮影日（時刻）', h('span', { class: 'tf-sort', title: '新しい順' }, '▼')),
        h('th', {}, '患者ID'),
        h('th', {}, '患者名'))),
      tbody);
    const listPanel = h('section', { class: 'panel tf-list', 'aria-label': '症例の選択' },
      h('div', { class: 'panel-title' }, '症例を選択', h('span', { class: 'muted small tf-title-sub' }, '3D構成済み・撮影日の新しい順')),
      h('div', { class: 'tf-table-wrap' }, table));

    // ---- 左: 送信内容 ----
    const pkgPatient = h('div', { class: 'tf-pkg-patient' });
    const dots = h('div', { class: 'tf-dots', 'aria-hidden': 'true' },
      STRUCTURES.map((s, i) => h('span', { style: { background: s.color, animationDelay: `${i * 40}ms` }, title: s.name })));
    const pkgItem = (key, icon, title) => {
      const val = h('span', { class: 'tf-pkg-val' });
      const sub = h('div', { class: 'tf-pkg-sub' });
      const el = h('li', { class: `tf-pkg-item tf-pkg-${key}` },
        h('span', { class: 'tf-pkg-ico', html: icon }),
        h('div', { class: 'tf-pkg-main' }, h('div', { class: 'tf-pkg-row' }, h('span', { class: 'tf-pkg-name' }, title), val), sub));
      return { el, val, sub };
    };
    const itModel = pkgItem('model', ICONS.model, '3Dモデル');
    const itRoi = pkgItem('roi', ICONS.roi, '関心領域');
    const itLine = pkgItem('line', ICONS.line, '2点ライン');
    itModel.el.querySelector('.tf-pkg-main').appendChild(dots);
    const pkgPanel = h('section', { class: 'panel tf-pkg', 'aria-label': '送信内容' },
      h('div', { class: 'panel-title' }, '送信内容'),
      pkgPatient,
      h('ul', { class: 'tf-pkg-list' }, itModel.el, itRoi.el, itLine.el),
      h('p', { class: 'tf-pkg-note' }, '端末側では［患者データ選択］から症例を選んで表示します。'));

    // ---- 中央: PC ----
    const pcPort = h('span', { class: 'tf-port', 'aria-hidden': 'true' });
    const pcIllus = h('div', { class: 'tf-pc-illus', html: PC_SVG }, pcPort);
    const pcCase = h('div', { class: 'tf-pc-case' });
    const sendLabel = h('span', {}, '転送');
    const sendBtn = h('button', { class: 'btn btn-accent btn-lg tf-send', type: 'button', onclick: () => send() },
      h('span', { class: 'tf-ico', html: ICONS.send }), sendLabel);
    const sendNote = h('div', { class: 'tf-send-note' });
    const pcNode = h('div', { class: 'tf-pc' },
      h('div', { class: 'tf-node-label' }, 'PC', h('span', { class: 'tf-node-sub' }, 'Zeus')),
      pcIllus,
      pcCase,
      h('div', { class: 'tf-send-wrap' },
        sendBtn,
        h('div', { class: 'tf-est' }, h('span', { class: 'tf-ico', html: ICONS.clock }), '転送時間の目安：約1秒'),
        sendNote));

    // ---- 右: 端末カード ----
    const cards = new Map();
    const cardParts = {};
    for (const d of DEVICES) {
      const led = h('span', { class: 'tf-led' });
      const stText = h('span', { class: 'tf-st-text' });
      const bar = h('span');
      const pct = h('span', { class: 'tf-pct mono' }, '0%');
      const plugBtn = h('button', {
        class: 'tf-plug', type: 'button', title: 'USBケーブルの抜き差しを再現します（デモ操作）',
        onclick: () => togglePlug(d.id),
      });
      const el = h('article', { class: 'tf-dev', dataset: { dev: d.id, status: 'off' }, 'aria-label': d.name },
        h('div', { class: 'tf-dev-illus', html: DEVICE_SVG[d.id] }, h('span', { class: 'tf-dev-ok', 'aria-hidden': 'true' }, '✓')),
        h('div', { class: 'tf-dev-body' },
          h('div', { class: 'tf-dev-head' },
            h('span', { class: 'tf-dev-name' }, d.name),
            h('span', { class: 'tf-dev-st', role: 'status' }, led, stText)),
          h('div', { class: 'tf-dev-kind' }, h('span', {}, d.kind), plugBtn),
          h('div', { class: 'tf-dev-foot' },
            h('div', { class: 'tf-idle' }),
            h('div', { class: 'tf-prog' }, h('div', { class: 'progress' }, bar), pct),
            h('div', { class: 'tf-msg' }, h('span', { class: 'check' }, '✓'), h('span', { class: 'tf-msg-text' }, d.doneMessage)),
            d.id === 'ios'
              ? h('div', { class: 'tf-folder-note' }, h('span', { class: 'tf-ico', html: ICONS.folder }), 'この後、USDZフォルダを手動でコピーします')
              : null)));
      cards.set(d.id, el);
      cardParts[d.id] = { el, led, stText, bar, pct, plugBtn, idle: el.querySelector('.tf-idle') };
    }
    const connCount = h('span', { class: 'tf-conn-count' });
    const checkLabel = h('span', {}, '接続を確認');
    const checkBtn = h('button', { class: 'btn btn-sm tf-check', type: 'button', onclick: () => scan() },
      h('span', { class: 'tf-ico tf-check-ico', html: ICONS.refresh }), checkLabel);
    const devsNode = h('div', { class: 'tf-devs' },
      h('div', { class: 'tf-devs-head' },
        h('span', { class: 'tf-node-label' }, '転送先の端末'),
        connCount,
        h('span', { class: 'tf-tb-spacer' }),
        checkBtn),
      h('div', { class: 'tf-devs-list' }, [...cards.values()]));

    const stage = h('section', { class: 'tf-stage', 'aria-label': 'PCから端末への転送' },
      pcNode, h('div', { class: 'tf-flow-gap', 'aria-hidden': 'true' }), devsNode);

    // ---- アクションバー ----
    const hint = h('span', { class: 'hint tf-hint' });
    const nextBtn = h('button', { class: 'btn btn-accent btn-lg tf-next', type: 'button', disabled: true, onclick: () => navigate('ar') },
      '次へ：AR表示', h('span', { 'aria-hidden': 'true' }, '›'));
    const actionBar = h('div', { class: 'action-bar tf-actions' },
      h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => navigate('home') }, '‹ メイン画面'),
      hint, h('div', { class: 'spacer' }), nextBtn);

    const screen = h('div', { class: 'pc-screen tf' },
      toolbar,
      h('div', { class: 'tf-content' }, h('div', { class: 'tf-side' }, listPanel, pkgPanel), stage),
      actionBar);
    root.appendChild(screen);

    const flow = createFlow({ stage, startEl: pcPort, targets: cards, getStatus: statusOf, signal });

    // =====================================================================
    // 表示の更新
    // =====================================================================
    function renderRows() {
      tbody.replaceChildren();
      for (const c of rows()) {
        const tr = h('tr', {
          class: 'is-selectable' + (c.id === selectedId ? ' is-selected' : ''),
          tabindex: c.id === selectedId ? 0 : -1,
          'aria-selected': c.id === selectedId ? 'true' : 'false',
          dataset: { id: c.id },
          onclick: () => select(c.id),
          onkeydown: (e) => onRowKey(e, c.id),
        },
        h('td', { class: 'mono' }, studyDateTime(c)),
        h('td', { class: 'mono' }, c.id),
        h('td', {}, c.name));
        tbody.appendChild(tr);
      }
    }
    function select(id) {
      if (busy || id === selectedId) return;
      selectedId = id;
      memory.selected = id;
      renderRows();
      render();
    }
    function onRowKey(e, id) {
      const trs = [...tbody.querySelectorAll('tr[data-id]')];
      const i = trs.findIndex((tr) => tr.dataset.id === id);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const n = trs[Math.max(0, Math.min(trs.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
        if (n && !busy) { select(n.dataset.id); tbody.querySelector(`tr[data-id="${n.dataset.id}"]`)?.focus(); }
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        select(id);
      }
    }

    function renderCase() {
      const c = selectedCase();
      tbId.textContent = c.id;
      tbName.textContent = c.name;
      tbDate.textContent = `撮影日 ${studyDateTime(c)}`;
      tbDesc.textContent = c.description;
      pkgPatient.replaceChildren(
        h('span', { class: 'tf-ico', html: ICONS.patient }),
        h('span', { class: 'mono tf-pkg-id' }, c.id),
        h('span', {}, c.name),
        h('span', { class: 'faint tf-pkg-desc' }, c.description));
      pcCase.replaceChildren(h('span', { class: 'mono' }, c.id), h('span', { class: 'faint' }, c.name));

      // 送信内容
      itModel.val.textContent = `${STRUCTURES.length}構造`;
      itModel.sub.textContent = '端末用に軽量化・変換済み';
      const isWork = c.id === state.roiCaseId;
      const hasRoi = isWork && state.roi.length > 0;
      const hasLine = isWork && !!state.line?.end;
      itRoi.el.classList.toggle('is-off', !hasRoi);
      itRoi.val.textContent = hasRoi ? 'あり' : 'なし';
      itRoi.sub.textContent = hasRoi ? 'ペンでなぞった範囲' : '未設定でも転送できます';
      itLine.el.classList.toggle('is-off', !hasLine);
      itLine.val.textContent = hasLine ? 'あり' : 'なし';
      itLine.sub.textContent = hasLine ? '始点・終点（体表の外へ延長して表示）' : '未設定';
    }

    function renderCard(id) {
      const p = cardParts[id];
      const st = statusOf(id);
      p.el.dataset.status = st;
      p.el.classList.toggle('is-unplugged', !memory.plugged[id]);
      p.stText.textContent = { off: '未接続', detecting: '検出中…', connected: 'USB接続済み', sending: '転送中', done: 'USB接続済み' }[st];
      if (st === 'off') {
        p.idle.textContent = memory.plugged[id]
          ? (memory.linked ? 'USB接続が見つかりません' : '［接続を確認］で検出します')
          : 'USBケーブルで接続してください';
      } else if (st === 'detecting') {
        p.idle.textContent = 'USB接続を確認しています…';
      } else {
        p.idle.textContent = '転送待ち';
      }
      p.plugBtn.textContent = memory.plugged[id] ? '取り外す' : '接続する';
      p.plugBtn.disabled = busy || scanning || dev[id].link === 'detecting';
      updateProgress(id);
    }
    function updateProgress(id) {
      const p = cardParts[id];
      const v = Math.round(dev[id].progress * 100);
      p.bar.style.width = `${v}%`;
      p.pct.textContent = `${v}%`;
    }

    function render() {
      renderCase();
      for (const d of DEVICES) renderCard(d.id);
      const conn = connectedIds();
      const sentSet = sentFor(selectedId);
      const allDone = conn.length > 0 && conn.every((id) => sentSet.has(id));
      const anySent = Object.values(state.transferred).some(Boolean);

      connCount.replaceChildren(
        h('span', { class: 'tf-ico', html: ICONS.usb }),
        `USB接続 ${conn.length}/${DEVICES.length}`);
      connCount.classList.toggle('is-on', conn.length > 0);

      checkBtn.disabled = scanning || busy;
      checkBtn.classList.toggle('is-scanning', scanning);
      checkLabel.textContent = scanning ? '確認中…' : '接続を確認';
      checkBtn.classList.toggle('is-pulse-blue', !scanning && !busy && memory.linked == null);

      sendBtn.disabled = busy || scanning || conn.length === 0;
      sendBtn.classList.toggle('is-busy', busy);
      sendBtn.classList.toggle('btn-accent', !allDone || busy);
      sendBtn.classList.toggle('is-again', allDone && !busy);
      sendBtn.classList.toggle('is-pulse', !busy && !scanning && conn.length > 0 && !allDone && !ctx.tour);
      sendLabel.textContent = busy ? '転送中…' : allDone ? 'もう一度転送' : '転送';
      sendNote.classList.toggle('is-done', allDone && !busy);
      sendNote.textContent = busy
        ? `${conn.length}台の端末へ転送しています`
        : allDone
          ? `✓ ${conn.length}台の端末へ転送しました`
          : conn.length > 0
            ? `接続中の${conn.length}台へまとめて転送します`
            : '端末をUSBで接続してください';
      stage.classList.toggle('is-sending', busy);
      pcNode.classList.toggle('is-sending', busy);

      // ステータス
      statusBadge.className = 'badge tf-status-badge ' + (busy ? 'badge-warn' : sentSet.size ? 'badge-ok' : 'badge-info');
      statusBadge.textContent = busy ? '転送中' : sentSet.size ? `転送済み ${sentSet.size}台` : '未転送';

      // ヒント
      hint.textContent = scanning
        ? 'USB接続を確認しています…'
        : busy
          ? '転送中です。完了までお待ちください。'
          : allDone
            ? `転送が終わりました。ARグラスの［患者データ選択］から ${selectedId} を選んで表示します。`
            : conn.length === 0
              ? '端末をUSBケーブルでPCに接続し、［接続を確認］を押してください。'
              : '症例を選んで［転送］を押すと、接続中のすべての端末へ転送します。関心領域を設定していなくても転送できます。';
      hint.title = hint.textContent;

      nextBtn.disabled = !anySent || busy;
      nextBtn.classList.toggle('is-pulse', anySent && allDone && !busy);
      tbody.classList.toggle('is-locked', busy);
    }

    // =====================================================================
    // 操作
    // =====================================================================
    function saveLinked() {
      memory.linked = new Set(connectedIds());
    }

    async function scan() {
      if (scanning || busy) return;
      scanning = true;
      const plugged = DEVICES.map((d) => d.id).filter((id) => memory.plugged[id]);
      for (const d of DEVICES) dev[d.id].link = memory.plugged[d.id] ? 'detecting' : 'off';
      render();
      try {
        await Promise.all(plugged.map((id, i) => wait(DETECT_DELAY[i] ?? DETECT_DELAY.at(-1)).then(() => {
          dev[id].link = 'on';
          flow.flash(id, 'on');
          cardParts[id].el.classList.remove('is-lit');
          void cardParts[id].el.offsetWidth;
          cardParts[id].el.classList.add('is-lit');
          render();
        })));
        await wait(160);
      } catch (e) {
        if (!isAbort(e)) console.error(e);
        return;
      }
      scanning = false;
      saveLinked();
      render();
    }

    async function togglePlug(id) {
      if (busy || scanning) return;
      memory.plugged[id] = !memory.plugged[id];
      if (!memory.plugged[id]) {
        dev[id].link = 'off';
        if (memory.linked == null) memory.linked = new Set();
        saveLinked();
        render();
        return;
      }
      // 差し込んだ端末を自動で検出
      dev[id].link = 'detecting';
      render();
      try { await wait(650); } catch { return; }
      if (!memory.plugged[id]) return;
      dev[id].link = 'on';
      flow.flash(id, 'on');
      saveLinked();
      render();
    }

    async function send() {
      const ids = connectedIds();
      if (!ids.length || busy || scanning) return;
      busy = true;
      const caseId = selectedId;
      // 作業中の症例を切り替える（関心領域・ラインは roiCaseId で描いた症例を区別する。マーカの置き直し位置は前の症例のものなので破棄）
      if (state.caseId !== caseId) setState({ caseId, markerPositions: null });
      const set = sentFor(caseId);
      for (const id of ids) { set.delete(id); dev[id].sending = true; dev[id].progress = 0; }
      renderRows();
      render();
      try {
        await Promise.all(ids.map(async (id, i) => {
          await wait(i * 110);
          flow.setSending(id, true);
          await tween(DURATION[id] || 1000, (u) => {
            // 少し不規則に進むように見せる（最後はなめらかに 100% へ）
            const e = 1 - Math.pow(1 - u, 2.1);
            const wobble = u < 0.92 ? Math.sin(u * 23 + i) * 0.012 : 0;
            dev[id].progress = Math.max(dev[id].progress, Math.min(1, e + wobble));
            updateProgress(id);
          });
          dev[id].progress = 1;
          flow.setSending(id, false);
          dev[id].sending = false;
          set.add(id);
          flow.flash(id, 'done');
          const card = cardParts[id].el;
          card.classList.remove('is-arrived');
          void card.offsetWidth;
          card.classList.add('is-arrived');
          setState({ transferred: { ...state.transferred, [id]: 'done' } });
          render();
        }));
      } catch (e) {
        if (!isAbort(e)) console.error(e);
        return;
      }
      busy = false;
      renderRows();
      render();
    }

    // 状態の変化（ほかの画面・リセット）に追従
    const unsub = subscribe((_s, patch) => {
      if (busy) return;
      if ('roi' in patch || 'line' in patch || 'roiCaseId' in patch || 'transferred' in patch || 'caseId' in patch) render();
    });

    renderRows();
    render();

    // 初回は USB 接続を自動で確認（ツアー中はツアーが［接続を確認］を押す）
    let autoTimer = 0;
    if (memory.linked == null && !ctx.tour) autoTimer = setTimeout(() => { if (!signal.aborted) scan(); }, 550);

    return {
      destroy() {
        clearTimeout(autoTimer);
        unsub();
        flow.destroy();
      },
      async tour(t) {
        const until = async (cond, maxMs = 6000) => {
          const t0 = performance.now();
          while (!cond() && performance.now() - t0 < maxMs) { t.check(); await t.sleep(80); }
        };
        clearTimeout(autoTimer);
        // 自動確認が走っている場合は終わるのを待つ
        await until(() => !scanning && !busy);

        t.caption('3 端末への転送：3D構成が終わった症例（DEMO-0001）を選びます。');
        const row = tbody.querySelector(`tr[data-id="${selectedId}"]`) || tbody.querySelector('tr');
        if (row) {
          await t.click(row);
          await t.sleep(250);
        }
        t.caption('端末をUSBでPCに接続し、［接続を確認］。検出された端末が点灯します。');
        await t.click(checkBtn);
        await until(() => !scanning);
        await t.sleep(250);

        t.caption('［転送］は全端末で共通の1つ。接続中の端末へまとめて送ります（目安 約1秒）。');
        await t.pointAt(sendBtn, 550);
        await t.sleep(200);
        await t.click(sendBtn, { move: false });
        await until(() => !busy);
        await t.sleep(300);

        t.caption('Quest・XREALは「データ転送完了」。iPad・iPhoneは準備完了後、フォルダを手動でコピーします。');
        const iosMsg = cardParts.ios.el.querySelector('.tf-msg');
        await t.pointAt(iosMsg, 550);
        await t.highlight(cardParts.ios.el, 1500);

        t.caption('次は、ARグラスで患者データを選び、体表に重ねて表示します。');
        await t.pointAt(nextBtn, 550);
        await t.sleep(500);
      },
    };
  },
};
