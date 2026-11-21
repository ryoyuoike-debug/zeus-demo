// 仮の画面（実装予定）
import { h } from '../ui/dom.js';

export default {
  id: 'home',
  title: 'メイン画面',
  frame: 'pc',

  mount(root) {
    root.appendChild(h('div', { class: 'panel', style: { margin: '16px' } }, 'メイン画面（準備中）'));
    return { destroy() {} };
  },
};
