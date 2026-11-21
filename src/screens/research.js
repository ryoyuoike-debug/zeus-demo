// =============================================================================
// S8 研究開発中の機能（Zeus β）
// -----------------------------------------------------------------------------
// ヘッダーの「研究開発機能を表示」が ON のときだけステッパーに出る画面です。
// 上部に「研究開発中・未承認」の帯を常に表示し、次の 5 つをタブで切り替えます。
//   1. 仮想オブジェクト（3D・操作可能）        … 研究開発中・未承認
//   2. 臨床シナリオ                          … 研究開発中・未承認
//   3. マルチプレイ（シミュレーション）        … 研究開発中・未承認
//   4. 点群とARマーカによる位置合わせ       … 研究段階（構想）
//   5. 将来機能                              … 研究段階（構想）
// 各タブは最初に開いたときに作り、以後は非表示にして保持します（3D は一時停止）。
// =============================================================================
import '../styles/screens/research.css';
import { h, researchBadge, conceptBadge } from '../ui/dom.js';
import { state, subscribe } from '../app/state.js';
import { createVirtualObject } from './research/virtualObject.js';
import { createScenarios } from './research/scenarios.js';
import { createMultiplayer } from './research/multiplayer.js';
import { createPointCloud } from './research/pointCloud.js';
import { createFuture } from './research/future.js';

export const RESEARCH_BAND_TEXT = '研究開発中・未承認の機能です。医療機器としての承認を受けたものではなく、販売・授与の対象ではありません。';

const TABS = [
  { id: 'vobj', num: '1', label: '仮想オブジェクト', kind: 'research', create: createVirtualObject },
  { id: 'scenario', num: '2', label: '臨床シナリオ', kind: 'research', create: createScenarios },
  { id: 'multi', num: '3', label: 'マルチプレイ', kind: 'research', create: createMultiplayer },
  { id: 'cloud', num: '4', label: '点群位置合わせ', kind: 'concept', create: createPointCloud },
  { id: 'future', num: '5', label: '将来機能', kind: 'concept', create: createFuture },
];

export default {
  id: 'research',
  title: '研究開発中の機能',
  frame: 'page',
  researchOnly: true,

  mount(root, ctx) {
    const { signal } = ctx;
    const sections = {};
    let current = null;

    // ---------------------------------------------------------------- 帯・見出し・タブ
    const band = h('div', { class: 'research-band rs-band', role: 'note' },
      h('span', { class: 'rs-band-icon', 'aria-hidden': 'true' }, '⚠'),
      h('span', {}, RESEARCH_BAND_TEXT));

    const tabBtns = {};
    const tabs = h('div', { class: 'rs-tabs', role: 'tablist', 'aria-label': '研究開発中の機能' }, TABS.map((t) => {
      const b = h('button', {
        class: `rs-tab is-${t.kind}`, role: 'tab', 'aria-selected': 'false', id: `rs-tab-${t.id}`,
        title: t.kind === 'concept' ? '研究段階（構想）' : '研究開発中・未承認',
        onclick: () => select(t.id),
      }, h('span', { class: 'rs-tab-num' }, t.num), h('span', { class: 'rs-tab-label' }, t.label));
      tabBtns[t.id] = b;
      return b;
    }));
    tabs.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const i = TABS.findIndex((t) => t.id === current);
      const n = TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length];
      select(n.id);
      tabBtns[n.id].focus();
    }, { signal });

    const head = h('header', { class: 'rs-head' },
      h('div', { class: 'rs-head-title' },
        h('h1', {}, '研究開発中の機能'),
        h('span', { class: 'rs-head-badges' }, researchBadge(), conceptBadge())),
      tabs);

    const body = h('div', { class: 'rs-body' });
    const wrap = h('div', { class: 'rs' }, band, head, body);
    root.appendChild(wrap);

    // ---------------------------------------------------------------- タブ切替
    function select(id) {
      if (current === id) return;
      const prev = current && sections[current];
      if (prev) { prev.deactivate?.(); prev.el.classList.remove('is-active'); }
      current = id;
      let sec = sections[id];
      if (!sec) {
        const def = TABS.find((t) => t.id === id);
        sec = sections[id] = def.create({ signal });
        body.appendChild(sec.el);
      }
      sec.el.classList.add('is-active');
      sec.el.setAttribute('role', 'tabpanel');
      sec.el.setAttribute('aria-labelledby', `rs-tab-${id}`);
      for (const t of TABS) {
        tabBtns[t.id].classList.toggle('is-on', t.id === id);
        tabBtns[t.id].setAttribute('aria-selected', String(t.id === id));
      }
      sec.activate?.();
    }
    const initial = TABS.some((t) => t.id === ctx.params?.tab) ? ctx.params.tab : 'vobj';
    select(initial);

    // ガイドツアー中は下部の字幕バーと重ならないように余白を取る
    const applyTour = () => wrap.classList.toggle('is-touring', !!state.tourActive);
    applyTour();
    const unsub = subscribe((s, patch) => { if ('tourActive' in patch) applyTour(); });

    return {
      destroy() {
        unsub();
        for (const sec of Object.values(sections)) {
          try { sec.destroy?.(); } catch (e) { console.error(e); }
        }
      },

      // ------------------------------------------------------------ ガイドツアー（約30秒）
      async tour(t) {
        // この画面では、クリック前のカーソル移動を少し速くする
        const ft = {
          ...t,
          async click(el) {
            if (!el) return;
            await t.pointAt(el, 380);
            await t.click(el, { move: false });
          },
        };
        t.caption('研究開発中（未承認）の機能をまとめた画面です。上部の帯は常に表示されます。');
        await t.highlight(band, 1100);

        // 1. 仮想オブジェクト
        if (current !== 'vobj') await ft.click(tabBtns.vobj);
        const vo = sections.vobj;
        for (let i = 0; i < 80 && !vo.ready; i++) await t.sleep(100);
        await vo.tour(ft);

        // 2. 臨床シナリオ
        t.caption('臨床シナリオ：研究用途として想定している使い方を、手順ごとに紹介します。');
        await ft.click(tabBtns.scenario);
        await sections.scenario.tour(ft);

        // 3. マルチプレイ
        t.caption('マルチプレイ（シミュレーション）：複数の端末で、同じ表示を共有します。');
        await ft.click(tabBtns.multi);
        await sections.multi.tour(ft);

        // 4〜5. 構想
        t.caption('点群による位置合わせや将来機能は、研究段階（構想）として紹介しています。');
        await ft.click(tabBtns.future);
        await t.sleep(1500);
      },
    };
  },
};
