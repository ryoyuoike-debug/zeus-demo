// 仮の画面（実装予定）
import { h } from '../ui/dom.js';

export default {
  id: 'import',
  title: '新規データ追加',
  frame: 'pc',

  mount(root) {
    root.appendChild(h('div', { class: 'panel', style: { margin: '16px' } }, '新規データ追加（準備中）'));
    return { destroy() {} };
  },
};
