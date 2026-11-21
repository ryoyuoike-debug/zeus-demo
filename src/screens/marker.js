// 仮の画面（実装予定）
import { h } from '../ui/dom.js';

export default {
  id: 'marker',
  title: 'マーカ確認',
  frame: 'pc',

  mount(root) {
    root.appendChild(h('div', { class: 'panel', style: { margin: '16px' } }, 'マーカ確認（準備中）'));
    return { destroy() {} };
  },
};
