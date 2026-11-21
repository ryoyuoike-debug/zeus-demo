// =============================================================================
// S1a データ取込: PACS から（別ウィンドウ「DICOM Gateway」）
//   検索欄: 患者ID / 撮影日、ボタン: [検索] [取得] [設定] [バージョン]
//   結果リスト: スタディを開くとシリーズ（縦隔条件・肺野条件）が並ぶ
//   取得中は進捗バーと「少々お待ちください。」（実機の待ち時間をデモ用に短縮）
// =============================================================================
import { h, dialog, sleep } from '../../ui/dom.js';
import { CASES, DEMO_NETWORK, studyDateTime } from '../../data/cases.js';
import { showSettings, showVersion } from '../../ui/appDialogs.js';
import { GATEWAY_ICON, SEARCH_ICON, DOWNLOAD_ICON, CHEVRON_ICON } from './visuals.js';

const abortErr = () => new DOMException('aborted', 'AbortError');
const seriesKind = (desc) => (desc.includes('肺野') ? 'lung' : 'med');

/**
 * @param {{signal: AbortSignal, fast?: boolean | (() => boolean), onDone:(c:object)=>void, onClose:()=>void}} o
 */
export function createGateway({ signal, fast = false, onDone, onClose }) {
  const isFast = () => (typeof fast === 'function' ? fast() : !!fast);
  const st = { searching: false, results: null, selected: null, expanded: new Set(), retrieving: false, done: false };

  // ---- 検索欄 ----
  const idInput = h('input', { class: 'input mono gw-id', type: 'text', placeholder: '例: DEMO-0001', autocomplete: 'off', spellcheck: 'false', 'aria-label': '患者ID' });
  const dateInput = h('input', { class: 'input gw-date', type: 'date', 'aria-label': '撮影日', min: '2020-01-01', max: '2030-12-31' });
  const searchBtn = h('button', { class: 'btn btn-primary gw-search-btn', onclick: () => search() }, h('span', { class: 'ico', html: SEARCH_ICON }), '検索');
  const clearBtn = h('button', { class: 'btn btn-ghost btn-sm', title: '検索条件をクリア', onclick: () => { idInput.value = ''; dateInput.value = ''; idInput.focus(); } }, 'クリア');
  const settingsBtn = h('button', { class: 'btn btn-ghost btn-sm', onclick: () => showSettings() }, '設定');
  const versionBtn = h('button', { class: 'btn btn-ghost btn-sm', onclick: () => showVersion() }, 'バージョン');
  for (const inp of [idInput, dateInput]) inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); search(); } });

  // ---- 結果 ----
  const tbody = h('tbody');
  const table = h('table', { class: 'table gw-table', 'aria-label': '検索結果' },
    h('colgroup', {}, h('col', { class: 'g-exp' }), h('col', { class: 'g-id' }), h('col', { class: 'g-name' }), h('col', { class: 'g-date' }), h('col', { class: 'g-desc' }), h('col', { class: 'g-mod' }), h('col', { class: 'g-ser' }), h('col', { class: 'g-img' })),
    h('thead', {}, h('tr', {}, h('th', {}, ''), h('th', {}, '患者ID'), h('th', {}, '患者名'), h('th', {}, '撮影日（時刻）'), h('th', {}, '検査内容'), h('th', {}, '種別'), h('th', { class: 'num' }, 'シリーズ'), h('th', { class: 'num' }, '画像数'))),
    tbody);
  const resultsWrap = h('div', { class: 'gw-results' }, table);
  const resultCount = h('span', { class: 'gw-count' });

  // ---- 取得（進捗） ----
  const fetchBtn = h('button', { class: 'btn btn-accent gw-fetch-btn', disabled: true, onclick: () => retrieve() }, h('span', { class: 'ico', html: DOWNLOAD_ICON }), '取得');
  const progBar = h('span');
  const progText = h('span', { class: 'gw-prog-text' });
  const progPct = h('span', { class: 'gw-prog-pct mono' });
  const progSeries = h('div', { class: 'gw-prog-series' });
  const waitMsg = h('div', { class: 'gw-wait', hidden: true }, h('span', { class: 'spinner' }), h('span', {}, '少々お待ちください。'));
  const statusLine = h('div', { class: 'gw-status' });
  const progress = h('div', { class: 'gw-progress', hidden: true },
    h('div', { class: 'gw-prog-head' }, progText, progPct),
    h('div', { class: 'progress is-orange' }, progBar),
    h('div', { class: 'gw-prog-foot' }, progSeries, waitMsg));

  const closeBtn = h('button', { class: 'gw-winbtn gw-close', title: '閉じる', 'aria-label': 'DICOM Gateway を閉じる', onclick: () => { if (!st.retrieving) onClose?.(); } }, '✕');
  const win = h('div', { class: 'gw-window', role: 'dialog', 'aria-label': 'DICOM Gateway' },
    h('div', { class: 'gw-titlebar' },
      h('span', { class: 'gw-icon', html: GATEWAY_ICON }),
      h('span', { class: 'gw-title' }, 'DICOM Gateway'),
      h('span', { class: 'gw-sub' }, '— PACS 検索・取得'),
      h('span', { class: 'gw-winbtns' }, h('span', { class: 'gw-winbtn' }, '—'), closeBtn)),
    h('div', { class: 'gw-search' },
      h('label', { class: 'field gw-field' }, h('span', { class: 'field-label' }, '患者ID'), idInput),
      h('label', { class: 'field gw-field' }, h('span', { class: 'field-label' }, '撮影日'), dateInput),
      h('div', { class: 'gw-search-btns' }, searchBtn, clearBtn),
      h('div', { class: 'gw-spacer' }),
      h('div', { class: 'gw-tools' }, settingsBtn, versionBtn)),
    h('div', { class: 'gw-conn' },
      h('span', { class: 'gw-conn-dot' }),
      h('span', {}, '接続先 ', h('b', { class: 'mono' }, DEMO_NETWORK.remote.ae), h('span', { class: 'mono faint' }, `（${DEMO_NETWORK.remote.host} : ${DEMO_NETWORK.remote.port}）`)),
      h('span', { class: 'faint' }, '｜'),
      h('span', {}, 'ローカル ', h('b', { class: 'mono' }, DEMO_NETWORK.local.ae), h('span', { class: 'mono faint' }, ` : ${DEMO_NETWORK.local.port}`)),
      h('span', { class: 'gw-conn-note faint' }, '※ 接続設定はすべて架空の値です'),
      resultCount),
    resultsWrap,
    h('div', { class: 'gw-footer' },
      h('div', { class: 'gw-footer-main' }, statusLine, progress),
      fetchBtn));
  const el = h('div', { class: 'gw-overlay' }, win);

  // -------------------------------------------------------------------------
  function setStatus(text, kind = '') {
    statusLine.className = 'gw-status' + (kind ? ` is-${kind}` : '');
    const icon = kind === 'busy' ? h('span', { class: 'spinner' }) : kind === 'ok' ? h('span', { class: 'check' }, '✓') : null;
    statusLine.replaceChildren(...[icon, h('span', {}, text)].filter(Boolean));
  }

  function render() {
    tbody.replaceChildren();
    const lock = st.retrieving || st.done;
    idInput.disabled = dateInput.disabled = searchBtn.disabled = clearBtn.disabled = lock || st.searching;
    closeBtn.disabled = st.retrieving;
    fetchBtn.disabled = !st.selected || lock || st.searching;
    resultCount.textContent = st.results ? `検索結果 ${st.results.length} 件` : '';
    if (st.searching) {
      tbody.appendChild(h('tr', { class: 'gw-msg-row' }, h('td', { colspan: 8 }, h('div', { class: 'gw-msg' }, h('span', { class: 'spinner' }), '検索しています…'))));
      return;
    }
    if (!st.results) {
      tbody.appendChild(h('tr', { class: 'gw-msg-row' }, h('td', { colspan: 8 }, h('div', { class: 'gw-msg gw-msg-idle' },
        h('div', {}, '患者ID または 撮影日 を入力して［検索］を押してください。'),
        h('div', { class: 'small faint' }, '患者IDは完全一致で検索します。デモ用データ: DEMO-0001 〜 DEMO-0003')))));
      return;
    }
    if (!st.results.length) {
      tbody.appendChild(h('tr', { class: 'gw-msg-row' }, h('td', { colspan: 8 }, h('div', { class: 'gw-msg' }, '該当する検査はありません。条件を変えて検索してください。'))));
      return;
    }
    st.results.forEach((c, i) => {
      const open = st.expanded.has(c.id);
      const sel = st.selected === c.id;
      const imgs = c.series.reduce((a, s) => a + s.images, 0);
      const expBtn = h('button', {
        class: 'gw-exp' + (open ? ' is-open' : ''), title: open ? 'シリーズを閉じる' : 'シリーズを表示', 'aria-expanded': String(open),
        onclick: (e) => { e.stopPropagation(); toggle(c.id); },
      }, h('span', { class: 'ico', html: CHEVRON_ICON }));
      tbody.appendChild(h('tr', {
        class: 'gw-study is-selectable' + (sel ? ' is-selected' : '') + (st.fresh ? ' is-fresh' : ''),
        style: st.fresh ? { animationDelay: `${i * 70}ms` } : null,
        tabindex: lock ? -1 : 0, dataset: { id: c.id }, 'aria-selected': String(sel),
        onclick: () => select(c.id),
        ondblclick: () => toggle(c.id),
        onkeydown: (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(c.id); }
          if (e.key === 'ArrowRight') toggle(c.id, true);
          if (e.key === 'ArrowLeft') toggle(c.id, false);
        },
      },
      h('td', { class: 'gw-exp-cell' }, expBtn),
      h('td', { class: 'mono' }, c.id),
      h('td', {}, c.name, h('span', { class: 'gw-kana' }, c.kana)),
      h('td', { class: 'mono' }, studyDateTime(c)),
      h('td', {}, c.description),
      h('td', {}, c.modality),
      h('td', { class: 'num mono' }, String(c.series.length)),
      h('td', { class: 'num mono' }, String(imgs))));
      if (open) {
        tbody.appendChild(h('tr', { class: 'gw-series-row' + (sel ? ' is-selected-child' : '') }, h('td', {}),
          h('td', { colspan: 7 }, h('div', { class: 'gw-series' },
            c.series.map((s) => h('div', { class: `gw-series-item is-${seriesKind(s.desc)}`, dataset: { no: s.no } },
              h('span', { class: 'gw-series-tag' }, seriesKind(s.desc) === 'lung' ? '肺野' : '縦隔'),
              h('span', { class: 'gw-series-no mono' }, `シリーズ ${s.no}`),
              h('span', { class: 'gw-series-desc' }, s.desc),
              h('span', { class: 'gw-series-img mono' }, `${s.images} 画像`),
              h('span', { class: 'gw-series-state' }))),
            h('div', { class: 'gw-series-note' }, c.series.length >= 2 ? '✓ 縦隔条件・肺野条件の2シリーズがあります' : '')))));
      }
    });
    st.fresh = false;
  }

  function select(id) {
    if (st.retrieving || st.done) return;
    const hadFocus = document.activeElement?.closest?.('tr.gw-study');
    st.selected = id;
    render();
    if (hadFocus) tbody.querySelector(`tr.gw-study[data-id="${id}"]`)?.focus();
    const c = CASES.find((x) => x.id === id);
    setStatus(`${c.id}（${c.name}）を選択しました。［取得］で Zeus に取り込みます。`);
  }
  function toggle(id, force) {
    const open = force ?? !st.expanded.has(id);
    if (open) st.expanded.add(id); else st.expanded.delete(id);
    if (!st.retrieving && !st.done) st.selected = id;
    render();
  }

  async function search() {
    if (st.searching || st.retrieving || st.done) return;
    const id = idInput.value.trim();
    const date = dateInput.value;
    if (!id && !date) {
      await dialog({ title: '検索条件未入力', body: '患者IDまたは撮影日のいずれかを指定して検索してください', buttons: [{ label: 'OK', value: true, kind: 'primary' }] });
      if (!signal.aborted) idInput.focus();
      return;
    }
    if (/[*＊]/.test(id)) {
      await dialog({ title: '検索条件エラー', body: '患者IDに「*」を使ったあいまい検索はできません。', buttons: [{ label: 'OK', value: true, kind: 'primary' }] });
      if (!signal.aborted) { idInput.focus(); idInput.select(); }
      return;
    }
    st.searching = true; st.selected = null; st.expanded.clear();
    setStatus(`${DEMO_NETWORK.remote.ae} に問い合わせています…`, 'busy');
    render();
    try { await sleep(isFast() ? 450 : 850, signal); } catch { return; }
    const d = date ? date.replaceAll('-', '/') : null;
    st.results = CASES.filter((c) => (!id || c.id.toUpperCase() === id.toUpperCase()) && (!d || c.studyDate === d))
      .sort((a, b) => studyDateTime(b).localeCompare(studyDateTime(a)));
    st.searching = false; st.fresh = true;
    render();
    setStatus(st.results.length ? `${st.results.length} 件見つかりました。検査を選んで［取得］を押してください。` : '該当する検査はありません。', st.results.length ? 'ok' : '');
  }

  function animate(T, fn) {
    return new Promise((resolve, reject) => {
      if (signal.aborted) return reject(abortErr());
      const t0 = performance.now();
      let raf = 0;
      const onAbort = () => { cancelAnimationFrame(raf); reject(abortErr()); };
      const tick = (now) => {
        const u = Math.min(1, (now - t0) / T);
        fn(u);
        if (u < 1) raf = requestAnimationFrame(tick);
        else { signal.removeEventListener('abort', onAbort); resolve(); }
      };
      signal.addEventListener('abort', onAbort, { once: true });
      raf = requestAnimationFrame(tick);
    });
  }

  async function retrieve() {
    const c = st.results?.find((x) => x.id === st.selected);
    if (!c || st.retrieving || st.done) return;
    st.retrieving = true;
    if (!st.expanded.has(c.id)) st.expanded.add(c.id);
    render();
    const total = c.series.reduce((a, s) => a + s.images, 0);
    const firstShare = c.series[0].images / total;
    progress.hidden = false;
    setStatus(`${c.id} のデータを ${DEMO_NETWORK.remote.ae} から取得しています`, 'busy');
    const seriesChips = c.series.map((s) => h('span', { class: 'gw-chip' }, h('i'), s.desc.replace(/\s.*$/, '')));
    progSeries.replaceChildren(...seriesChips);
    // 速く進む → 待ち（少々お待ちください。）→ 再び進む、という実機の雰囲気を短縮して再現
    const curve = (u) => (u < 0.34 ? (u / 0.34) * 0.42 : u < 0.64 ? 0.42 + ((u - 0.34) / 0.3) * 0.1 : 0.52 + ((u - 0.64) / 0.36) * 0.48);
    try {
      await animate(isFast() ? 2000 : 4200, (u) => {
        const p = curve(u);
        progBar.style.width = `${(p * 100).toFixed(1)}%`;
        progPct.textContent = `${Math.round(p * 100)}%`;
        progText.textContent = `取得中… ${Math.round(p * total)} / ${total} 画像`;
        waitMsg.hidden = !(u > 0.37 && u < 0.7);
        seriesChips[0].classList.toggle('is-done', p >= firstShare);
        seriesChips[0].classList.toggle('is-busy', p < firstShare);
        seriesChips[1]?.classList.toggle('is-busy', p >= firstShare && p < 1);
        seriesChips[1]?.classList.toggle('is-done', p >= 1);
        for (const item of tbody.querySelectorAll('.gw-series-item')) {
          const i = c.series.findIndex((s) => String(s.no) === item.dataset.no);
          const done = i === 0 ? p >= firstShare : p >= 1;
          item.classList.toggle('is-done', done);
          item.querySelector('.gw-series-state').textContent = done ? '✓ 取得済み' : (i === 0 || p >= firstShare) ? '取得中…' : '待機中';
        }
      });
    } catch { return; }
    st.retrieving = false; st.done = true;
    progress.classList.add('is-done');
    progress.querySelector('.progress').classList.add('is-done');
    progText.textContent = `取得完了 ${total} / ${total} 画像`;
    waitMsg.hidden = true;
    fetchBtn.replaceChildren(h('span', { class: 'check' }, '✓'), '取得完了');
    render();
    setStatus('取得が完了しました。Zeus に取り込みます…', 'ok');
    try { await sleep(isFast() ? 450 : 900, signal); } catch { return; }
    onDone?.(c);
  }

  return {
    el, win, idInput, dateInput, searchBtn, fetchBtn, settingsBtn, versionBtn, st,
    rowFor: (id) => tbody.querySelector(`tr.gw-study[data-id="${id}"]`),
    expandBtnFor: (id) => tbody.querySelector(`tr.gw-study[data-id="${id}"] .gw-exp`),
    seriesEl: () => tbody.querySelector('.gw-series'),
    search, retrieve,
    init() { render(); setStatus('PACS から検査を検索して取得します。'); },
  };
}
