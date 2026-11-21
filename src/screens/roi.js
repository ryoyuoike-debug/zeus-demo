// 仮の画面（実装予定）
import { h } from '../ui/dom.js';

export default {
  id: 'roi',
  title: '関心領域',
  frame: 'pc',

  mount(root) {
    root.appendChild(h('div', { class: 'panel', style: { margin: '16px' } }, '関心領域（準備中）'));
    return { destroy() {} };
  },
};
