// =============================================================================
// 研究段階（構想）: 将来機能のタイル
// 提供時期や実装を約束するものではないため、すべて「研究段階（構想）」バッジを付けます。
// =============================================================================
import { h, conceptBadge } from '../../ui/dom.js';

const S = (body) => `<svg viewBox="0 0 48 48" aria-hidden="true">${body}</svg>`;
const TILES = [
  {
    title: 'MRIからの3D化', text: 'CTに加えて、MRI画像から3Dモデルをつくる研究です。',
    icon: S('<rect x="6" y="8" width="36" height="32" rx="6" class="f-line"/><circle cx="24" cy="24" r="10" class="f-line"/><circle cx="24" cy="24" r="5" class="f-acc"/><path d="M10 40 h28" class="f-line"/>'),
  },
  {
    title: '肺区域の分割', text: '肺を区域ごとに分けて、色分けして表示します。',
    icon: S('<path d="M23 8 C14 8 8 18 8 30 C8 38 12 41 16 41 C20 41 23 37 23 32 Z" class="f-line"/><path d="M25 8 C34 8 40 18 40 30 C40 38 36 41 32 41 C28 41 25 37 25 32 Z" class="f-line"/><path d="M9 24 L23 20 M10 33 L23 28 M39 23 L25 20 M38 32 L25 28" class="f-acc"/>'),
  },
  {
    title: 'セグメンテーションの修正', text: '自動で抽出した結果を、PC上で手作業で修正できるようにします。',
    icon: S('<path d="M8 34 C12 20 22 12 34 12" class="f-line f-dash"/><path d="M8 34 C14 26 24 22 36 24" class="f-acc"/><path d="M30 34 l10 -10 l3 3 l-10 10 l-4 1 z" class="f-line"/>'),
  },
  {
    title: '外部STLの取り込み', text: 'ほかのソフトでつくった3Dモデル（STL）を読み込みます。',
    icon: S('<path d="M12 6 h17 l8 8 v28 h-25 z" class="f-line"/><path d="M29 6 v8 h8" class="f-line"/><path d="M24 20 v14 m-6 -6 l6 6 l6 -6" class="f-acc"/>'),
  },
  {
    title: '3D化の高速化', text: 'CTから3Dモデルができるまでの時間を短くする研究です。',
    icon: S('<circle cx="24" cy="26" r="15" class="f-line"/><path d="M24 26 L33 18" class="f-acc"/><path d="M19 7 h10 M24 7 v4" class="f-line"/><path d="M4 22 h6 M3 28 h6 M5 34 h6" class="f-acc f-faint"/>'),
  },
  {
    title: '肋骨表示の切替', text: 'ARグラス側で、肋骨の表示と非表示を切り替えます。',
    icon: S('<path d="M24 8 v32" class="f-line"/><path d="M23 14 Q12 12 8 20 M23 21 Q12 19 8 27 M23 28 Q12 26 8 34" class="f-line"/><path d="M25 14 Q36 12 40 20 M25 21 Q36 19 40 27 M25 28 Q36 26 40 34" class="f-acc f-dash"/>'),
  },
  {
    title: '他の診療科への展開', text: '整形外科、脳神経外科、泌尿器科など、胸部以外への応用を検討しています。',
    icon: S('<circle cx="24" cy="10" r="5" class="f-line"/><path d="M14 20 h20 M24 20 v12 M24 32 l-7 10 M24 32 l7 10" class="f-line"/><circle cx="12" cy="30" r="3.5" class="f-acc"/><circle cx="36" cy="30" r="3.5" class="f-acc"/><circle cx="24" cy="25" r="3" class="f-acc"/>'),
  },
  {
    title: 'ボリュームレンダリング表示', text: 'ゴーグル型の端末やスマートフォンで、CTを立体的にそのまま表示する研究です。',
    icon: S('<path d="M24 6 L40 15 V33 L24 42 L8 33 V15 Z" class="f-line"/><path d="M8 15 L24 24 L40 15 M24 24 V42" class="f-line f-faint"/><circle cx="20" cy="27" r="3" class="f-acc f-fill"/><circle cx="28" cy="22" r="2.2" class="f-acc f-fill"/><circle cx="25" cy="32" r="1.8" class="f-acc f-fill"/>'),
  },
  {
    title: 'ハンドだけの操作（改善案）', text: '左手のひらを返すと手元に「仮想操作モニター」が出て、右手の指でボタンを押して操作します。',
    icon: S('<path d="M14 40 C8 34 8 26 10 20 L12 14 C13 11 16 12 16 15 L16 22 L17 9 C17 6 21 6 21 9 L21 20 L22 7 C22 4 26 4 26 7 L26 20 L27 10 C27 7 31 7 31 10 L31 26 C31 34 28 40 22 41 Z" class="f-line"/><rect x="31" y="6" width="13" height="10" rx="2" class="f-acc"/>'),
  },
];

export function createFuture() {
  const el = h('section', { class: 'rs-sec rs-ft' },
    h('div', { class: 'rs-ft-head' },
      h('div', { class: 'rs-sec-title' }, '将来機能', conceptBadge()),
      h('p', { class: 'rs-sec-lead rs-keep' }, '研究段階の構想です。提供の時期や内容を約束するものではありません。')),
    h('div', { class: 'rs-ft-grid' }, TILES.map((t, i) => h('article', { class: 'rs-ft-tile', style: { animationDelay: `${0.04 * i}s` } },
      h('div', { class: 'rs-ft-icon', html: t.icon }),
      h('div', { class: 'rs-ft-main' },
        h('div', { class: 'rs-ft-thead' }, h('span', { class: 'rs-ft-title' }, t.title), conceptBadge()),
        h('p', { class: 'rs-ft-text' }, t.text))))));
  return { el, activate() {}, deactivate() {}, destroy() {}, async tour(t) { await t.sleep(1500); } };
}
