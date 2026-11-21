// 仮の画面（実装予定）
import { h } from '../ui/dom.js';

export default {
  id: 'summary',
  title: 'まとめ',
  frame: 'page',

  mount(root) {
    root.appendChild(h('div', { class: 'panel', style: { margin: '16px' } }, 'まとめ（準備中）'));
    return { destroy() {} };
  },
};
