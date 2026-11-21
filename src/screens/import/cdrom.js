// =============================================================================
// S1b データ取込: CD-ROM から
//   ディスクを確認 → PC へコピー（進捗バー）→ 「縦隔／肺野シリーズを検出」→ 体位選択へ
// =============================================================================
import { h, sleep } from '../../ui/dom.js';
import { CASES, studyDateTime } from '../../data/cases.js';
import { CD_DRIVE_BIG, ctThumb } from './visuals.js';

const abortErr = () => new DOMException('aborted', 'AbortError');

/**
 * @param {{signal: AbortSignal, fast?: boolean, caseId?: string, onDone:(c:object)=>void}} o
 */
export function createCdImport({ signal, fast = false, caseId = 'DEMO-0001', onDone }) {
  const c = CASES.find((x) => x.id === caseId) || CASES[0];
  const totalImages = c.series.reduce((a, s) => a + s.images, 0);
  const totalFiles = totalImages + 1; // + DICOMDIR
  const totalMB = totalImages * 0.52;

  const step = (n, title) => {
    const state = h('span', { class: 'cd-step-state' });
    const body = h('div', { class: 'cd-step-body' });
    const el = h('li', { class: 'cd-step' }, h('span', { class: 'cd-step-n' }, n), h('div', { class: 'cd-step-main' }, h('div', { class: 'cd-step-title' }, title, state), body));
    return { el, state, body, set(kind, text) { el.className = `cd-step is-${kind}`; state.textContent = text || ''; } };
  };
  const s1 = step('1', 'ディスクを確認');
  const s2 = step('2', 'PC へコピー');
  const s3 = step('3', 'シリーズを確認');

  const bar = h('span');
  const copyText = h('span', { class: 'mono' });
  const copySize = h('span', { class: 'mono faint' });
  s2.body.append(h('div', { class: 'progress' }, bar), h('div', { class: 'cd-copy-meta' }, copyText, copySize));
  const detected = h('div', { class: 'cd-detected is-pending' }, h('span', { class: 'check' }, '✓'), '縦隔／肺野シリーズを検出');
  // サムネイルの場所を先に確保しておく（表示時にレイアウトが動かないように）
  const slots = c.series.map((s) => h('div', { class: 'cd-slot' }, h('span', {}, s.desc.includes('肺野') ? '肺野条件' : '縦隔条件')));
  const thumbs = h('div', { class: 'cd-thumbs' }, slots);
  s3.body.append(thumbs, detected);

  const stageLabel = h('div', { class: 'cd-drive-label' }, 'ディスクを読み込んでいます…');
  const el = h('div', { class: 'cd-view' },
    h('div', { class: 'cd-visual' },
      h('div', { class: 'cd-drive', html: CD_DRIVE_BIG }),
      stageLabel,
      h('div', { class: 'cd-disc-info' },
        h('div', { class: 'cd-disc-row' }, h('span', { class: 'faint' }, 'ディスク'), h('span', { class: 'mono' }, 'DICOM（DICOMDIR あり）')),
        h('div', { class: 'cd-disc-row' }, h('span', { class: 'faint' }, '患者ID'), h('span', { class: 'mono cd-pid' }, '—')),
        h('div', { class: 'cd-disc-row' }, h('span', { class: 'faint' }, '撮影日'), h('span', { class: 'mono cd-date' }, '—')))),
    h('div', { class: 'cd-steps-panel' },
      h('div', { class: 'cd-steps-title' }, 'CD-ROM から取込', h('span', { class: 'small faint' }, '外付けドライブにディスクを入れると自動で始まります')),
      h('ol', { class: 'cd-steps' }, s1.el, s2.el, s3.el)));

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

  const st = { done: false, phase: 'idle' };
  async function run() {
    try {
      st.phase = 'disc';
      el.classList.add('is-spinning');
      s1.set('busy', '確認中…');
      s2.set('wait', '待機中');
      s3.set('wait', '待機中');
      await sleep(fast ? 700 : 1000, signal);
      s1.set('done', '✓ DICOM データを検出');
      el.querySelector('.cd-pid').textContent = c.id;
      el.querySelector('.cd-date').textContent = studyDateTime(c);

      st.phase = 'copy';
      stageLabel.textContent = 'PC へコピーしています…';
      el.classList.add('is-copying');
      s2.set('busy', 'コピー中…');
      await animate(fast ? 2200 : 3200, (u) => {
        const p = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
        bar.style.width = `${(p * 100).toFixed(1)}%`;
        copyText.textContent = `${Math.round(p * totalFiles)} / ${totalFiles} ファイル`;
        copySize.textContent = `${(p * totalMB).toFixed(1)} / ${totalMB.toFixed(1)} MB`;
      });
      s2.set('done', '✓ コピー完了');
      bar.parentElement.classList.add('is-done');
      el.classList.remove('is-copying');

      st.phase = 'series';
      stageLabel.textContent = 'シリーズを確認しています…';
      s3.set('busy', '確認中…');
      for (const [i, s] of c.series.entries()) {
        await sleep(fast ? 280 : 420, signal);
        const win = s.desc.includes('肺野') ? 'lung' : 'mediastinum';
        slots[i].replaceWith(h('figure', { class: 'cd-thumb', style: { animationDelay: `${i * 40}ms` } },
          ctThumb(win, { size: 112 }),
          h('figcaption', {}, h('b', {}, win === 'lung' ? '肺野条件' : '縦隔条件'), h('span', { class: 'mono faint' }, `${s.images} 画像`)),
          h('span', { class: 'cd-thumb-ok' }, '✓')));
      }
      await sleep(fast ? 250 : 400, signal);
      detected.classList.remove('is-pending');
      s3.set('done', '✓ 2 シリーズ');
      el.classList.remove('is-spinning');
      el.classList.add('is-done');
      stageLabel.textContent = 'ディスクの読み込みが完了しました';
      st.done = true;
      st.phase = 'done';
      await sleep(fast ? 900 : 1300, signal);
      onDone?.(c);
    } catch (e) {
      if (e?.name !== 'AbortError') console.error(e);
    }
  }

  return { el, st, run, case: c };
}
