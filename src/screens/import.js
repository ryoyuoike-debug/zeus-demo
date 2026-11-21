// =============================================================================
// 新規データ追加（S1a PACS / S1b CD-ROM / S2 体位選択）
//   取込元の選択 → データの取得（DICOM Gateway または CD-ROM）→ 体位選択 → [3D構成を開始]
// =============================================================================
import '../styles/screens/import.css';
import { h, toast } from '../ui/dom.js';
import { state, setState, navigate } from '../app/state.js';
import { CASES, studyDateTime } from '../data/cases.js';
import { createGateway } from './import/gateway.js';
import { createCdImport } from './import/cdrom.js';
import { session } from './import/session.js';
import { PACS_ILLUS, CD_ILLUS, POSITIONS, positionSvg, ctThumb, CHEVRON_ICON } from './import/visuals.js';

const STAGES = [
  { k: 'source', label: '取込元の選択' },
  { k: 'fetch', label: 'データの取得' },
  { k: 'position', label: '体位選択' },
  { k: 'recon', label: '3D構成' },
];
const POS_LABEL = Object.fromEntries(POSITIONS.map((p) => [p.id, p.label]));

export default {
  id: 'import',
  title: '新規データ追加',
  frame: 'pc',

  mount(root, ctx) {
    const { signal } = ctx;
    const fast = !!ctx.tour || !!state.tourActive;
    let stage = 'source';
    let stageAbort = null;
    let gateway = null;
    let cd = null;
    let imported = null; // { case, from }
    let position = state.position || 'supine';

    const newStageSignal = () => {
      stageAbort?.abort();
      stageAbort = new AbortController();
      const parent = signal;
      if (parent.aborted) stageAbort.abort();
      else parent.addEventListener('abort', () => stageAbort.abort(), { once: true, signal: stageAbort.signal });
      return stageAbort.signal;
    };

    // ---------------------------------------------------------------------
    // 骨組み
    // ---------------------------------------------------------------------
    const crumbs = h('ol', { class: 'imp-crumbs', 'aria-label': '新規データ追加の手順' });
    const toolbar = h('div', { class: 'pc-toolbar imp-toolbar' },
      h('strong', { class: 'imp-tb-title' }, '新規データ追加'),
      crumbs);
    const content = h('div', { class: 'pc-content imp-content' });
    const overlayHost = h('div', { class: 'imp-overlay-host' });
    const body = h('div', { class: 'imp-body' }, content);

    const backBtn = h('button', { class: 'btn btn-ghost', onclick: () => back() }, '‹ 戻る');
    const hint = h('span', { class: 'hint' });
    const nextBtn = h('button', { class: 'btn btn-accent btn-lg imp-next', onclick: () => next() });
    const actionBar = h('div', { class: 'action-bar' }, backBtn, hint, h('div', { class: 'spacer' }), nextBtn);
    // DICOM Gateway は Zeus の上に重なる「別ウィンドウ」として、画面全体に重ねる
    const screen = h('div', { class: 'pc-screen imp' }, toolbar, body, actionBar, overlayHost);
    root.appendChild(screen);

    function renderCrumbs() {
      const cur = stage === 'pacs' || stage === 'cd' ? 'fetch' : stage;
      const idx = STAGES.findIndex((s) => s.k === cur);
      crumbs.replaceChildren(...STAGES.map((s, i) => h('li', {
        class: 'imp-crumb' + (i < idx ? ' is-done' : '') + (i === idx ? ' is-current' : '') + (s.k === 'recon' ? ' is-next-screen' : ''),
        'aria-current': i === idx ? 'step' : null,
      },
      h('span', { class: 'imp-crumb-n' }, i < idx ? '✓' : String(i + 1)),
      h('span', {}, s.k === 'fetch' && (stage === 'pacs' || imported?.from === 'pacs') ? 'PACSから取得' : s.k === 'fetch' && (stage === 'cd' || imported?.from === 'cd') ? 'CD-ROMから取込' : s.label),
      i < STAGES.length - 1 ? h('span', { class: 'imp-crumb-sep', html: CHEVRON_ICON }) : null)));
    }

    // ---------------------------------------------------------------------
    // ステージ 1: 取込元の選択
    // ---------------------------------------------------------------------
    const srcTile = (src, illus, title, desc, points) => h('button', {
      class: `imp-src-tile imp-src-${src}`, dataset: { src },
      onclick: () => go(src === 'pacs' ? 'pacs' : 'cd'),
    },
    h('div', { class: 'imp-src-illus', html: illus }),
    h('div', { class: 'imp-src-text' },
      h('div', { class: 'imp-src-title' }, title, h('span', { class: 'imp-src-go', html: CHEVRON_ICON })),
      h('p', { class: 'imp-src-desc' }, desc),
      h('ul', { class: 'imp-src-points' }, points.map((p) => h('li', {}, p)))));
    const pacsTile = srcTile('pacs', PACS_ILLUS, 'PACSから取得',
      '院内の画像サーバ（PACS）から、患者IDまたは撮影日で検査を検索して取り込みます。',
      ['別ウィンドウ「DICOM Gateway」で検索・取得', '縦隔条件・肺野条件のシリーズを選択']);
    const cdTile = srcTile('cd', CD_ILLUS, 'CD-ROMから取込',
      'CD-ROM／DVD に書き出した DICOM データを、外付けドライブから PC へコピーして取り込みます。',
      ['ディスクを入れると自動でコピー', '縦隔／肺野シリーズを自動で確認']);

    function viewSource() {
      return h('div', { class: 'imp-source' },
        h('div', { class: 'imp-head' },
          h('h2', {}, '取込元を選んでください'),
          h('p', { class: 'muted' }, '胸部CT（DICOM）の縦隔条件・肺野条件の 2 シリーズを取り込み、3D構成に使います。')),
        h('div', { class: 'imp-src-grid' }, pacsTile, cdTile),
        h('div', { class: 'imp-facts' },
          fact('必要なシリーズ', '縦隔条件・肺野条件（各 1 シリーズ）'),
          fact('DICOM取込と3D化', '目安 約8分（この間は席を離れられます）'),
          fact('このデモでは', '処理時間を数秒に短縮しています')),
        state.imported ? h('p', { class: 'imp-prev small faint' }, `取込済み: ${(CASES.find((c) => c.id === state.caseId) || CASES[0]).id}（体位: ${POS_LABEL[state.position] || '仰臥位'}）。もう一度取り込むこともできます。`) : null);
    }
    const fact = (k, v) => h('div', { class: 'imp-fact' }, h('span', { class: 'imp-fact-k' }, k), h('span', { class: 'imp-fact-v' }, v));

    // ---------------------------------------------------------------------
    // ステージ 2a: PACS（DICOM Gateway を別ウィンドウとして重ねる）
    // ---------------------------------------------------------------------
    function openGateway() {
      const sig = newStageSignal();
      gateway = createGateway({
        signal: sig, fast,
        onClose: () => go('source'),
        onDone: (c) => finishImport(c, 'pacs'),
      });
      gateway.init();
      overlayHost.replaceChildren(gateway.el);
      requestAnimationFrame(() => gateway?.el.classList.add('is-open'));
      if (!ctx.tour) setTimeout(() => { if (!sig.aborted && document.activeElement === document.body) gateway?.idInput.focus(); }, 260);
    }
    function closeGateway() {
      if (!gateway) return;
      const el = gateway.el;
      el.classList.remove('is-open');
      el.classList.add('is-closing');
      setTimeout(() => el.remove(), 220);
      gateway = null;
    }

    // ---------------------------------------------------------------------
    // ステージ 2b: CD-ROM
    // ---------------------------------------------------------------------
    function viewCd() {
      const sig = newStageSignal();
      cd = createCdImport({ signal: sig, fast, caseId: 'DEMO-0001', onDone: (c) => finishImport(c, 'cd') });
      cd.run();
      return cd.el;
    }

    function finishImport(c, from) {
      imported = { case: c, from };
      session.importedCaseId = c.id;
      session.importedFrom = from;
      session.announcedFor = null;
      setState({ caseId: c.id });
      toast(`${c.id} のデータを取り込みました`, { kind: 'success' });
      go('position');
    }

    // ---------------------------------------------------------------------
    // ステージ 3: 体位選択
    // ---------------------------------------------------------------------
    let posCards = {};
    function viewPosition() {
      const c = imported?.case || CASES.find((x) => x.id === state.caseId) || CASES[0];
      const from = imported?.from || 'pacs';
      const summary = h('aside', { class: 'imp-summary' },
        h('div', { class: 'imp-sum-head' }, h('span', {}, '取込データ'), h('span', { class: 'badge badge-ok' }, '取込完了')),
        h('div', { class: 'imp-sum-id mono' }, c.id),
        h('div', { class: 'imp-sum-name' }, c.name),
        h('div', { class: 'imp-sum-meta' }, `${studyDateTime(c)}　${c.description}`),
        h('div', { class: 'imp-sum-thumbs' }, c.series.map((s) => {
          const win = s.desc.includes('肺野') ? 'lung' : 'mediastinum';
          return h('figure', { class: 'imp-sum-thumb' }, ctThumb(win, { size: 120 }),
            h('figcaption', {}, h('b', {}, win === 'lung' ? '肺野条件' : '縦隔条件'), h('span', { class: 'mono faint' }, `${s.images} 画像`)));
        })),
        h('div', { class: 'imp-sum-check' }, h('span', { class: 'check' }, '✓'), '縦隔／肺野シリーズを検出'),
        h('div', { class: 'imp-sum-src small faint' }, `取込元: ${from === 'cd' ? 'CD-ROM' : 'PACS（DICOM Gateway）'}`));

      posCards = {};
      const grid = h('div', { class: 'imp-pos-grid', role: 'radiogroup', 'aria-label': '撮影時の体位' });
      for (const p of POSITIONS) {
        const card = h('button', {
          class: 'imp-pos-card' + (p.id === position ? ' is-on' : ''), role: 'radio', 'aria-checked': String(p.id === position),
          dataset: { pos: p.id },
          onclick: () => selectPosition(p.id),
          onkeydown: (e) => {
            const i = POSITIONS.findIndex((x) => x.id === p.id);
            const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
            if (d) { e.preventDefault(); const n = POSITIONS[(i + d + POSITIONS.length) % POSITIONS.length]; selectPosition(n.id); posCards[n.id].focus(); }
          },
        },
        h('span', { class: 'imp-pos-radio' }),
        h('div', { class: 'imp-pos-art', html: positionSvg(p.id) }),
        h('div', { class: 'imp-pos-label' }, p.label),
        h('div', { class: 'imp-pos-sub' }, p.sub),
        p.down ? h('span', { class: 'imp-pos-down' }, p.down) : null);
        posCards[p.id] = card;
        grid.appendChild(card);
      }
      const posNote = h('div', { class: 'imp-pos-note' });
      const main = h('section', { class: 'imp-pos-main' },
        h('div', { class: 'imp-head' },
          h('h2', {}, '撮影時の体位を選択'),
          h('p', { class: 'muted' }, 'CT を撮影したときの体位を選んでから、3D構成を開始します。')),
        grid,
        posNote);
      updatePosNote(posNote);
      return h('div', { class: 'imp-pos' }, summary, main);
    }
    function updatePosNote(el = content.querySelector('.imp-pos-note')) {
      if (!el) return;
      el.replaceChildren(
        h('span', { class: 'imp-pos-note-i' }, 'i'),
        position === 'supine'
          ? '側臥位を選ぶと、マーカ確認の 3D 表示が回転した状態で始まります。'
          : `${POS_LABEL[position]}：マーカ確認の 3D 表示は、体位に合わせて回転した状態で始まります。`);
      el.classList.toggle('is-lateral', position !== 'supine');
    }
    function selectPosition(id) {
      position = id;
      for (const [k, card] of Object.entries(posCards)) {
        card.classList.toggle('is-on', k === id);
        card.setAttribute('aria-checked', String(k === id));
      }
      updatePosNote();
    }

    // ---------------------------------------------------------------------
    // ステージ切り替え
    // ---------------------------------------------------------------------
    function go(next) {
      const prev = stage;
      stage = next;
      if (next !== 'pacs') closeGateway();
      if (next !== 'cd' && next !== 'pacs') { stageAbort?.abort(); cd = null; }
      if (next === 'pacs') {
        if (prev !== 'source' || !content.firstChild) setContent(viewSource());
        content.classList.add('is-dimmed');
        openGateway();
      } else {
        content.classList.remove('is-dimmed');
        setContent(next === 'source' ? viewSource() : next === 'cd' ? viewCd() : viewPosition());
      }
      renderCrumbs();
      renderActions();
    }
    function setContent(node) {
      content.replaceChildren(node);
      node.classList.add('imp-stage-in');
      content.scrollTop = 0;
    }
    function renderActions() {
      nextBtn.className = 'btn btn-accent btn-lg imp-next';
      nextBtn.disabled = false;
      nextBtn.hidden = false;
      backBtn.textContent = stage === 'source' ? '‹ メイン画面' : '‹ 戻る';
      switch (stage) {
        case 'source':
          hint.textContent = '取込元を選んでください。';
          nextBtn.hidden = true;
          break;
        case 'pacs':
          hint.textContent = 'DICOM Gateway で検査を検索し、［取得］を押してください。';
          nextBtn.hidden = true;
          break;
        case 'cd':
          hint.textContent = 'コピーが終わると自動で次に進みます。';
          nextBtn.hidden = true;
          break;
        case 'position':
          hint.replaceChildren(h('span', {}, '3D構成：目安 約8分（この間は席を離れられます）'), h('span', { class: 'imp-hint-demo' }, 'デモでは約10秒'));
          nextBtn.replaceChildren('3D構成を開始', h('span', { class: 'ico', html: CHEVRON_ICON }));
          break;
      }
    }
    function back() {
      if (stage === 'source') navigate('home');
      else go('source');
    }
    function next() {
      if (stage !== 'position') return;
      setState({ imported: true, position });
      navigate('reconstruct');
    }

    // 初期ステージ（メイン画面の「取込元」ボタンから来た場合はそのまま開く）
    const src = ctx.params?.source;
    go(src === 'pacs' ? 'pacs' : src === 'cd' ? 'cd' : 'source');

    // ---------------------------------------------------------------------
    // ガイドツアー（約 12 秒）
    // ---------------------------------------------------------------------
    async function waitFor(t, cond, max = 8000) {
      const t0 = performance.now();
      while (!cond()) {
        t.check();
        if (performance.now() - t0 > max) return false;
        await t.sleep(80);
      }
      return true;
    }

    return {
      destroy() {
        stageAbort?.abort();
        gateway = null;
        cd = null;
      },
      async tour(t) {
        // 素早いクリック（カーソル移動を短めにする）
        const qclick = async (el, ms = 380) => { await t.pointAt(el, ms); await t.click(el, { move: false }); };
        if (stage !== 'source') go('source');
        t.caption('新規データ追加：PACS から取得するか、CD-ROM から取り込みます。');
        await t.pointAt(cdTile, 420);
        await qclick(pacsTile, 420);
        await waitFor(t, () => gateway);
        const gw = gateway;
        await t.sleep(200);
        t.caption('DICOM Gateway で患者IDを入力して検索します。');
        await qclick(gw.idInput);
        gw.idInput.focus();
        for (const ch of 'DEMO-0001') {
          t.check();
          gw.idInput.value += ch;
          gw.idInput.dispatchEvent(new Event('input', { bubbles: true }));
          await t.sleep(45);
        }
        await t.sleep(120);
        await qclick(gw.searchBtn);
        await waitFor(t, () => gw.st.results && !gw.st.searching);
        await t.sleep(200);
        t.caption('検査を開くと、縦隔条件・肺野条件の 2 シリーズが並びます。');
        await qclick(gw.expandBtnFor('DEMO-0001'));
        await t.sleep(450);
        await qclick(gw.fetchBtn);
        t.caption('取得中…（待ち時間はデモ用に短縮しています）');
        await waitFor(t, () => stage === 'position', 12000);
        await t.sleep(300);
        t.caption('撮影時の体位を選びます。側臥位では 3D 表示が回転した状態で始まります。');
        await t.pointAt(posCards.right, 450);
        await t.sleep(150);
        await qclick(posCards.supine);
        t.caption('［3D構成を開始］で、臓器の 3D モデルづくりに進みます。');
        await t.pointAt(nextBtn, 420);
        await t.highlight(nextBtn, 900);
        setState({ imported: true, position });
      },
    };
  },
};
