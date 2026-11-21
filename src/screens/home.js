// =============================================================================
// S1 メイン画面（PCアプリ「Zeus」のハブ）
//   1 新規データ追加 / 2 マーカ・関心領域 / 3 端末への転送
//   リスト 2・3: 撮影日（時刻）・患者ID・患者名（撮影日の新しい順）。行を選んでからボタンを押す。
// =============================================================================
import '../styles/screens/home.css';
import { h, dialog, toast } from '../ui/dom.js';
import { state, subscribe, navigate, selectCase } from '../app/state.js';
import { CASES, studyDateTime, DEVICES } from '../data/cases.js';
import { showSettings } from '../ui/appDialogs.js';
import { session, DEFAULT_NEW } from './import/session.js';
import { HOME_IMPORT_ILLUS, PLUS_ICON, TRASH_ICON, CHEVRON_ICON } from './import/visuals.js';

const byNewest = (a, b) => studyDateTime(b).localeCompare(studyDateTime(a));

/** 最後に取り込んだ症例（3D構成が終わっていれば。直接 URL で開いた場合は DEMO-0001） */
function newCaseId() {
  const id = session.importedCaseId || DEFAULT_NEW;
  return session.newCases.get(id) ? id : null;
}
/** リストに並ぶ症例（既存の例 + 3D構成が終わった新規症例。取り込んで 3D構成がまだの症例は載せない） */
function baseRows() {
  return CASES.filter((c) => !session.newCases.has(c.id) || session.newCases.get(c.id)).sort(byNewest);
}
/** 症例ごとの進み具合（作業中の症例は共有状態、それ以外は「3D構成済み」のみ。関心領域は描いた症例だけ） */
function caseStatus(id) {
  const roi = id === state.roiCaseId && (state.roi.length > 0 || !!state.line.end);
  if (id === state.caseId && state.reconstructed) {
    return {
      recon: true,
      marker: state.markersConfirmed,
      roi,
      transfer: Object.values(state.transferred).some(Boolean),
    };
  }
  return { recon: true, marker: false, roi, transfer: false };
}
/** 新規症例のマーカ確認がまだか（「新規」バッジ・お知らせを出すか） */
const newPending = (id) => !!id && !(id === state.caseId && state.markersConfirmed);
/** 次に進むべきセクション番号 */
function nextSection() {
  if (!state.reconstructed) return 1;
  if (!state.markersConfirmed) return 2;
  if (!Object.values(state.transferred).some(Boolean)) return 3;
  return 0;
}

export default {
  id: 'home',
  title: 'メイン画面',
  frame: 'pc',

  mount(root, ctx) {
    const { signal } = ctx;
    const timers = new Set();
    const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); if (!signal.aborted) fn(); }, ms); timers.add(t); return t; };

    // ---------------------------------------------------------------------
    // セクション 1: 新規データ追加
    // ---------------------------------------------------------------------
    const addBtn = h('button', {
      class: 'btn btn-accent btn-lg home-add-btn',
      onclick: () => navigate('import'),
    }, h('span', { class: 'ico', html: PLUS_ICON }), '新規データ追加');
    const srcBtn = (label, source) => h('button', {
      class: 'btn btn-ghost btn-sm', onclick: () => navigate('import', { source }), title: `${label}を直接開きます`,
    }, label);
    const flowStep = (n, title, sub) => h('li', {}, h('span', { class: 'home-flow-n' }, n), h('div', {}, h('div', { class: 'home-flow-t' }, title), h('div', { class: 'home-flow-s' }, sub)));

    const sec1 = h('section', { class: 'home-sec home-sec-1', 'aria-labelledby': 'home-sec1-title' },
      sectionHead(1, '新規データ追加', 'home-sec1-title', '目安 約8分'),
      h('div', { class: 'home-illus', html: HOME_IMPORT_ILLUS }),
      h('ol', { class: 'home-flow' },
        flowStep('a', '取込元を選ぶ', 'PACS から取得 ／ CD-ROM から取込'),
        flowStep('b', '体位を選ぶ', '仰臥位 ／ 右側臥位 ／ 左側臥位'),
        flowStep('c', '3D構成', 'DICOM取込と3D化で 目安 約8分')),
      h('p', { class: 'home-note' }, '3D構成の間は席を離れられます。2D画像の確認もできます。'),
      h('div', { class: 'home-sec-foot home-sec1-foot' },
        addBtn,
        h('div', { class: 'home-src-row' }, h('span', { class: 'small faint' }, '取込元:'), srcBtn('PACS', 'pacs'), srcBtn('CD-ROM', 'cd'))));

    // ---------------------------------------------------------------------
    // セクション 2・3: 症例リスト
    // ---------------------------------------------------------------------
    const lists = {
      marker: makeList({
        key: 'marker', num: 2, title: 'マーカ・関心領域', estimate: '目安 2〜5分',
        helper: [['マーカ確認', '目安 1〜2分'], ['関心領域の設定', '目安 1〜3分']],
        actionLabel: 'マーカ・関心領域', target: 'marker',
      }),
      transfer: makeList({
        key: 'transfer', num: 3, title: '端末への転送', estimate: '目安 約1秒',
        helper: [['転送先', DEVICES.map((d) => d.name).join(' ／ ')]],
        actionLabel: '端末への転送', target: 'transfer',
      }),
    };

    function makeList({ key, num, title, estimate, helper, actionLabel, target }) {
      let selected = null;
      const tbody = h('tbody');
      const table = h('table', { class: 'table home-table', role: 'grid', 'aria-label': `${title}の症例一覧` },
        h('colgroup', {}, h('col', { class: 'c-date' }), h('col', { class: 'c-id' }), h('col', { class: 'c-name' })),
        h('thead', {}, h('tr', {}, h('th', {}, '撮影日（時刻）', h('span', { class: 'sort-ind', title: '新しい順' }, '▼')), h('th', {}, '患者ID'), h('th', {}, '患者名'))),
        tbody);
      const wrap = h('div', { class: 'home-table-wrap' }, table);
      const notice = h('div', { class: 'home-notice', hidden: true });
      const openBtn = h('button', { class: 'btn btn-primary home-open-btn', disabled: true, onclick: () => open() },
        actionLabel, h('span', { class: 'ico', html: CHEVRON_ICON }));
      const delBtn = h('button', { class: 'btn btn-danger btn-sm home-del-btn', disabled: true, title: '選択した行を一覧から削除', onclick: () => remove() },
        h('span', { class: 'ico', html: TRASH_ICON }), '削除');
      const selInfo = h('span', { class: 'home-selinfo' });
      const detail = h('div', { class: 'home-detail' });
      const el = h('section', { class: `home-sec home-sec-${num}`, 'aria-labelledby': `home-sec${num}-title` },
        sectionHead(num, title, `home-sec${num}-title`, estimate),
        h('dl', { class: 'home-helper' }, helper.map(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])),
        notice,
        wrap,
        detail,
        h('div', { class: 'home-sec-foot' },
          h('div', { class: 'home-foot-row' }, delBtn, h('div', { class: 'spacer' }), openBtn),
          h('div', { class: 'home-foot-hint' }, selInfo)));

      const rows = () => baseRows().filter((c) => !session.removed[key].has(c.id));

      function render({ hideNew = false, enteringId = null } = {}) {
        const newId = newCaseId();
        const list = rows().filter((c) => !(hideNew && c.id === newId));
        if (selected && !rows().some((c) => c.id === selected)) selected = null;
        tbody.replaceChildren();
        if (!list.length) {
          tbody.appendChild(h('tr', { class: 'home-empty' }, h('td', { colspan: 3 },
            h('div', { class: 'home-empty-box' },
              h('div', {}, '表示できるデータがありません'),
              h('div', { class: 'small faint' }, state.reconstructed ? '削除した行は「↺ はじめから」で元に戻ります。' : '［新規データ追加］から取り込むと、ここに追加されます。')))));
        }
        for (const c of list) {
          const isNew = c.id === newId && newPending(newId);
          const tr = h('tr', {
            class: 'is-selectable' + (c.id === selected ? ' is-selected' : '') + (c.id === enteringId ? ' is-new is-entering' : ''),
            tabindex: 0,
            'aria-selected': c.id === selected ? 'true' : 'false',
            dataset: { id: c.id },
            onclick: () => select(c.id),
            ondblclick: () => { select(c.id); open(); },
            onkeydown: (e) => onRowKey(e, c.id),
          },
          h('td', { class: 'mono home-date', title: studyDateTime(c) }, c.studyDate, ' ', h('span', { class: 'home-time' }, c.studyTime)),
          h('td', { class: 'mono' }, c.id),
          h('td', {}, h('span', { class: 'home-name' }, c.name, isNew ? h('span', { class: 'badge badge-warn home-new-badge' }, '新規') : null)));
          tbody.appendChild(tr);
        }
        updateButtons();
      }
      function updateButtons() {
        openBtn.disabled = !selected;
        delBtn.disabled = !selected;
        const c = CASES.find((x) => x.id === selected);
        selInfo.textContent = c ? `選択中: ${c.id}（${c.name}）` : '行を選んでからボタンを押してください（ダブルクリックでも開けます）';
        selInfo.classList.toggle('is-sel', !!c);
        renderDetail(c);
      }
      function renderDetail(c) {
        detail.classList.toggle('is-empty', !c);
        if (!c) {
          detail.replaceChildren(h('span', { class: 'home-detail-ph' }, '行を選ぶと、検査の内容と進み具合をここに表示します'));
          return;
        }
        const st = caseStatus(c.id);
        const pill = (label, on) => h('span', { class: 'home-pill' + (on ? ' is-on' : '') }, h('span', { class: 'home-pill-dot' }, on ? '✓' : ''), label);
        detail.replaceChildren(
          h('div', { class: 'home-detail-top' },
            h('span', { class: 'home-detail-id mono' }, c.id),
            h('span', { class: 'home-detail-name' }, c.name),
            h('span', { class: 'home-detail-desc' }, c.description)),
          h('div', { class: 'home-detail-meta' },
            `${c.sex === 'F' ? '女性' : '男性'} ${c.age}歳`, h('i'), `シリーズ ${c.series.length}（縦隔・肺野）`, h('i'), `${c.series[0].images} 画像 × ${c.series.length}`),
          h('div', { class: 'home-detail-pills' },
            pill('3D構成', st.recon), pill('マーカ確認', st.marker), pill('関心領域', st.roi), pill('転送', st.transfer)));
      }
      function select(id) {
        selected = id;
        for (const tr of tbody.querySelectorAll('tr[data-id]')) {
          const on = tr.dataset.id === id;
          tr.classList.toggle('is-selected', on);
          tr.setAttribute('aria-selected', on ? 'true' : 'false');
        }
        updateButtons();
      }
      function onRowKey(e, id) {
        const trs = [...tbody.querySelectorAll('tr[data-id]')];
        const i = trs.findIndex((tr) => tr.dataset.id === id);
        if (e.key === 'Enter') { e.preventDefault(); select(id); open(); }
        else if (e.key === ' ') { e.preventDefault(); select(id); }
        else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          const n = trs[Math.max(0, Math.min(trs.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
          if (n) { n.focus(); select(n.dataset.id); }
        } else if (e.key === 'Delete') { e.preventDefault(); select(id); remove(); }
      }
      function open() {
        if (!selected) return;
        // 別の症例を開くときは、その症例用に進捗をリセットする（リスト 2・3 の症例は 3D構成済み）
        if (selected !== state.caseId) selectCase(selected, { reconstructed: true, position: session.positions.get(selected) ?? 'supine' });
        navigate(target);
      }
      async function remove() {
        const c = CASES.find((x) => x.id === selected);
        if (!c) return;
        const ok = await dialog({
          title: 'データの削除',
          body: h('div', { class: 'col' },
            h('p', {}, `次のデータを「${num} ${title}」の一覧から削除しますか？`),
            h('div', { class: 'home-del-target mono' }, `${studyDateTime(c)}　${c.id}　${c.name}`),
            h('p', { class: 'small faint' }, 'デモでは実際のデータは削除されません。「↺ はじめから」で元に戻ります。')),
          buttons: [{ label: 'いいえ', value: false }, { label: 'はい', value: true, kind: 'danger' }],
        });
        if (!ok || signal.aborted) return;
        const tr = tbody.querySelector(`tr[data-id="${c.id}"]`);
        tr?.classList.add('is-removing');
        later(() => {
          session.removed[key].add(c.id);
          if (selected === c.id) selected = null;
          render();
          toast(`${c.id} を一覧から削除しました（デモ）`);
        }, 260);
      }
      function setNotice(text) {
        notice.hidden = !text;
        notice.replaceChildren(...(text ? [h('span', { class: 'check' }, '✓'), text] : []));
      }
      return {
        el, render, select, setNotice, openBtn, delBtn, wrap,
        get selected() { return selected; },
        set selected(v) { selected = v; },
        has: (id) => rows().some((c) => c.id === id),
      };
    }

    function sectionHead(num, title, id, estimate) {
      return h('header', { class: 'home-sec-head' },
        h('span', { class: 'num' }, String(num)),
        h('h2', { id }, title),
        h('span', { class: 'home-next-tag' }, '次のステップ'),
        h('span', { class: 'home-est' }, estimate));
    }

    // ---------------------------------------------------------------------
    // 全体
    // ---------------------------------------------------------------------
    const flowArrow = () => h('div', { class: 'home-arrow', 'aria-hidden': 'true', html: CHEVRON_ICON });
    const grid = h('div', { class: 'home-grid' }, sec1, flowArrow(), lists.marker.el, flowArrow(), lists.transfer.el);
    const toolbar = h('div', { class: 'pc-toolbar home-toolbar' },
      h('div', { class: 'home-tb-title' },
        h('strong', {}, '症例データ'),
        h('span', { class: 'small muted' }, '1 → 2 → 3 の順に進めます')),
      h('div', { class: 'spacer grow' }),
      h('div', { class: 'home-tb-est' }, h('span', { class: 'faint' }, 'PCでの操作全体'), h('strong', {}, '目安 11〜14分')),
      h('button', { class: 'btn btn-ghost btn-sm', onclick: () => showSettings() }, '⚙ 設定'));
    const screen = h('div', { class: 'pc-screen home' }, toolbar, h('div', { class: 'pc-content home-content' }, grid));
    root.appendChild(screen);

    function applyNext() {
      const n = nextSection();
      [sec1, lists.marker.el, lists.transfer.el].forEach((el, i) => el.classList.toggle('is-next', n === i + 1));
      addBtn.classList.toggle('is-pulse', n === 1 && !state.tourActive);
    }

    function initialSelect() {
      for (const l of Object.values(lists)) l.selected = l.has(state.caseId) && state.reconstructed ? state.caseId : null;
    }

    function renderAll() {
      const newId = newCaseId();
      const animate = newId && session.announcedFor !== newId;
      initialSelect();
      if (animate) {
        // 新しく3D構成が終わった症例を、少し遅れてリストの先頭に追加して見せる
        for (const l of Object.values(lists)) l.render({ hideNew: true });
        session.announcedFor = newId;
        later(() => {
          lists.marker.render({ enteringId: newId });
          const c = CASES.find((x) => x.id === newId);
          if (newPending(newId)) lists.marker.setNotice(`${c.id} の3D構成が完了し、リスト2に追加されました`);
        }, 500);
        later(() => lists.transfer.render({ enteringId: newId }), 750);
      } else {
        for (const l of Object.values(lists)) l.render();
        const c = newId && CASES.find((x) => x.id === newId);
        lists.marker.setNotice(c && newPending(newId) ? `${c.id} の3D構成が完了しました` : '');
      }
      applyNext();
    }
    renderAll();

    const unsub = subscribe((_s, patch) => {
      if ('tourActive' in patch) applyNext();
      if ('reconstructed' in patch || 'markersConfirmed' in patch || 'transferred' in patch || 'caseId' in patch) {
        if ('reconstructed' in patch && !state.reconstructed) { lists.marker.setNotice(''); }
        renderAll();
      }
    });

    return {
      destroy() {
        unsub();
        timers.forEach(clearTimeout);
        timers.clear();
      },
      async tour(t) {
        t.caption('メイン画面です。1 → 2 → 3 の番号順に操作を進めます。');
        await t.pointAt(sec1.querySelector('.home-sec-head'), 500);
        await t.sleep(450);
        t.caption('1 新規データ追加：PACS または CD-ROM から胸部CTを取り込みます。');
        await t.pointAt(addBtn, 500);
        await t.highlight(addBtn, 850);
        t.caption('2 マーカ・関心領域：3D構成が終わった症例を選び、マーカ確認と範囲の設定へ。');
        await t.pointAt(lists.marker.wrap, 550);
        await t.highlight(lists.marker.el, 900);
        t.caption('3 端末への転送：ARグラスなどの端末へワンクリックで送ります。');
        await t.pointAt(lists.transfer.openBtn, 550);
        await t.highlight(lists.transfer.el, 800);
        t.caption('まずは［新規データ追加］から始めます。');
        await t.pointAt(addBtn, 450);
        await t.sleep(150);
      },
    };
  },
};
