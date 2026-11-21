// =============================================================================
// S9 まとめ
// 4 ステップの振り返り（デモで体験した内容にチェック）・特長・注記・お問い合わせ
// =============================================================================
import '../styles/screens/summary.css';
import { h, researchBadge } from '../ui/dom.js';
import { state, subscribe, navigate, resetDemo } from '../app/state.js';
import { DEVICES } from '../data/cases.js';
import { FOUR_STEPS, STEP_HEADLINE, VALUES, iconSVG, valueTile } from './intro/content.js';

const anyTransferred = (s) => Object.values(s.transferred || {}).some(Boolean);

/** ステップごとの小項目（state から体験済みかを判定） */
const SUBS = {
  ct: [
    { label: 'データ取込（PACS / CD-ROM）', done: (s) => s.imported, screen: 'import' },
    { label: '3D構成', done: (s) => s.reconstructed, screen: 'reconstruct' },
  ],
  marker: [
    { label: '3点マーカの確認', done: (s) => s.markersConfirmed, screen: 'marker' },
  ],
  trace: [
    { label: '関心領域', done: (s) => (s.roi?.length || 0) > 0, screen: 'roi' },
    { label: '2点ライン', done: (s) => !!s.line?.end, screen: 'roi' },
  ],
  view: [
    {
      label: '端末への転送', done: anyTransferred, screen: 'transfer',
      detail: (s) => DEVICES.filter((d) => s.transferred?.[d.id]).map((d) => d.name).join('・'),
    },
    { label: '3点で位置合わせ・AR表示', done: (s) => s.registered, screen: 'ar' },
  ],
};
/** ステップ全体の完了（ヘッダーのステッパーと同じ考え方） */
const STEP_DONE = {
  ct: (s) => s.imported && s.reconstructed,
  marker: (s) => s.markersConfirmed,
  trace: (s) => (s.roi?.length || 0) > 0 || !!s.line?.end,
  view: (s) => anyTransferred(s) && s.registered,
};

const CHECK_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

function resetAndRestart() {
  if (state.tourActive) window.__zeus?.stopTour?.();
  resetDemo();
  navigate('intro');
}

export default {
  id: 'summary',
  title: 'まとめ',
  frame: 'page',

  mount(root, ctx) {
    const { signal } = ctx;
    const cleanups = [];

    // ---------------------------------------------------------------- 見出し＋進捗リング
    const R = 34, C = 2 * Math.PI * R;
    const ring = h('div', { class: 'sum-ring', html: `
      <svg viewBox="0 0 84 84" width="84" height="84" aria-hidden="true">
        <circle cx="42" cy="42" r="${R}" class="sum-ring-bg"/>
        <circle cx="42" cy="42" r="${R}" class="sum-ring-fg" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${C.toFixed(1)}" transform="rotate(-90 42 42)"/>
      </svg>` });
    const ringNum = h('div', { class: 'sum-ring-num' }, h('b', {}, '0'), h('span', {}, '/4'));
    ring.appendChild(ringNum);
    const progressText = h('div', { class: 'sum-progress-text' });
    const progress = h('div', { class: 'sum-progress' }, ring,
      h('div', {}, h('div', { class: 'sum-progress-label' }, 'このデモで体験したステップ'), progressText));

    const head = h('header', { class: 'sum-head' },
      h('div', { class: 'sum-head-copy' },
        h('div', { class: 'sum-kicker' }, 'まとめ'),
        h('h1', { class: 'sum-title' }, STEP_HEADLINE),
        h('p', { class: 'sum-lead' },
          'Thoracentes Zeus β（研究開発中）は、胸部CTの情報を3Dモデルにして、ARグラスで患者の体表に重ねて見える化します。')),
      progress);

    // ---------------------------------------------------------------- 4 ステップ
    const parts = [];
    const stepCards = FOUR_STEPS.map((s, i) => {
      const status = h('span', { class: 'sum-status' });
      const list = h('ul', { class: 'sum-subs' });
      const goBtn = h('button', { class: 'btn btn-ghost btn-sm sum-go' }, '画面へ', h('span', { 'aria-hidden': 'true' }, '→'));
      const card = h('article', { class: 'sum-step', style: { animationDelay: `${0.06 * i + 0.05}s` } },
        h('div', { class: 'sum-step-top' },
          h('span', { class: 'sum-step-icon', html: iconSVG(s.icon, { size: 34 }) }),
          h('div', { class: 'sum-step-head' },
            h('div', { class: 'sum-step-num' }, `STEP ${i + 1}`),
            h('div', { class: 'sum-step-title' }, s.title)),
          h('span', { class: 'sum-step-check', html: CHECK_SVG })),
        list,
        h('div', { class: 'sum-step-foot' }, status, goBtn));
      parts.push({ status, list, goBtn, step: s });
      return card;
    });

    // ---------------------------------------------------------------- 特長・注記
    const values = h('section', { class: 'sum-card sum-values' },
      h('div', { class: 'sum-card-title' }, '特長', h('span', { class: 'sum-card-sub' }, '時間はいずれも目安です')),
      h('div', { class: 'sum-tiles' }, VALUES.map(valueTile)));
    const notes = h('section', { class: 'sum-card sum-notes' },
      h('div', { class: 'sum-card-title' }, h('span', { class: 'sum-warn', 'aria-hidden': 'true' }, '⚠'), 'ご注意'),
      h('ul', { class: 'sum-note-list' },
        h('li', {}, '本デモには研究開発中の未承認機能が含まれます。未承認機能は販売・授与の対象ではありません。', researchBadge()),
        h('li', {}, '表示した患者情報・画像・数値はすべて架空のデータ（合成ファントム）です。診断・治療には使用できません。'),
        h('li', {}, '処理時間は目安です。デモ内のアニメーションは実際より短くしています。'),
        h('li', {}, '穿刺・ドレナージを行う際は、三次元画像の表示をOFFにしてください。')));

    // ---------------------------------------------------------------- お問い合わせ
    const againBtn = h('button', { class: 'btn btn-accent btn-lg', onclick: resetAndRestart }, h('span', { 'aria-hidden': 'true' }, '↺'), 'もう一度見る');
    const freeBtn = h('button', { class: 'btn btn-ghost btn-lg', onclick: () => navigate('home') }, '自由操作で各画面を見る');
    const cta = h('section', { class: 'sum-cta' },
      h('div', { class: 'sum-cta-glow', 'aria-hidden': 'true' }),
      h('div', { class: 'sum-cta-copy' },
        h('div', { class: 'sum-cta-title' }, 'お問い合わせは担当者までお気軽にどうぞ'),
        h('p', {}, 'デモの内容や研究開発の状況について、担当者よりご説明します。')),
      h('div', { class: 'sum-cta-actions' }, againBtn, freeBtn));

    const page = h('div', { class: 'sum' },
      head,
      h('section', { class: 'sum-steps', 'aria-label': '4つのステップの振り返り' }, stepCards),
      h('div', { class: 'sum-row' }, values, notes),
      cta);
    root.appendChild(page);

    // ---------------------------------------------------------------- 状態の反映
    let firstRender = true;
    function render() {
      let doneCount = 0;
      stepCards.forEach((card, i) => {
        const { status, list, goBtn, step } = parts[i];
        const subs = SUBS[step.id];
        const subDone = subs.map((x) => !!x.done(state));
        const done = !!STEP_DONE[step.id](state);
        const partial = !done && subDone.some(Boolean);
        if (done) doneCount++;
        card.classList.toggle('is-done', done);
        card.classList.toggle('is-partial', partial);
        status.className = 'sum-status ' + (done ? 'is-done' : partial ? 'is-partial' : '');
        status.textContent = done ? '体験済み' : partial ? '一部体験済み' : '未体験';
        list.innerHTML = '';
        subs.forEach((x, k) => {
          const detail = subDone[k] && x.detail ? x.detail(state) : '';
          list.appendChild(h('li', { class: subDone[k] ? 'is-done' : '' },
            h('span', { class: 'sum-sub-mark', html: subDone[k] ? CHECK_SVG : '' }),
            h('span', {}, x.label, detail ? h('small', {}, `（${detail}）`) : null)));
        });
        const target = subs.find((x, k) => !subDone[k])?.screen || subs[0].screen;
        goBtn.onclick = () => navigate(target);
        goBtn.title = `「${step.title}」の画面を開きます`;
        if (firstRender) card.style.setProperty('--check-delay', `${0.35 + i * 0.18}s`);
      });
      // 進捗リング
      const fg = ring.querySelector('.sum-ring-fg');
      const off = C * (1 - doneCount / 4);
      if (firstRender) requestAnimationFrame(() => requestAnimationFrame(() => fg.setAttribute('stroke-dashoffset', off.toFixed(1))));
      else fg.setAttribute('stroke-dashoffset', off.toFixed(1));
      ringNum.querySelector('b').textContent = String(doneCount);
      progress.classList.toggle('is-complete', doneCount === 4);
      progressText.textContent = doneCount === 4
        ? '4つのステップをすべて体験しました'
        : doneCount === 0
          ? '各ステップは「画面へ」から体験できます'
          : '残りは「画面へ」から体験できます';
      firstRender = false;
    }
    render();
    cleanups.push(subscribe((s, patch) => {
      if (['imported', 'reconstructed', 'markersConfirmed', 'roi', 'line', 'transferred', 'registered'].some((k) => k in patch)) render();
    }));
    signal.addEventListener('abort', () => cleanups.splice(0).forEach((fn) => fn()), { once: true });

    const scroller = root.closest('.screen-host');
    return {
      destroy() { cleanups.splice(0).forEach((fn) => fn()); },

      /** ガイドツアー（約12秒） */
      async tour(t) {
        // ツアーの字幕バーに隠れないよう、下に余白を足す
        page.classList.add('is-touring');
        try {
          await runTour(t);
        } finally {
          page.classList.remove('is-touring');
        }
      },
    };

    async function runTour(t) {
      if (scroller) scroller.scrollTop = 0;
      t.caption('まとめです。CTを撮る、マーカを確認する、範囲をなぞる、そして見る。');
      await t.pointAt(head.querySelector('.sum-title'), 550);
      await t.sleep(1200);
      for (const card of stepCards) {
        t.check();
        await t.pointAt(card, 330);
        await t.highlight(card, 650);
      }
      t.caption('PACS接続、ワンクリック・約1秒での転送（目安）、3点マーカでの重ね合わせ。');
      await t.pointAt(values, 450);
      await t.highlight(values, 1600);
      t.caption('表示した患者情報・画像はすべて架空のデータです。研究開発中の未承認機能を含みます。');
      await t.pointAt(notes, 450);
      await t.highlight(notes, 1500);
      t.caption('お問い合わせは担当者までお気軽にどうぞ。');
      cta.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await t.sleep(350);
      await t.pointAt(againBtn, 450);
      await t.highlight(cta, 1500);
    }
  },
};
