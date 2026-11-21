// 仮の画面（実装予定）
import { h } from '../ui/dom.js';

export default {
  id: 'research',
  title: '研究開発中の機能',
  frame: 'page',
  researchOnly: true,
  mount(root) {
    root.appendChild(h('div', { class: 'panel', style: { margin: '16px' } }, '研究開発中の機能（準備中）'));
    return { destroy() {} };
  },
};
