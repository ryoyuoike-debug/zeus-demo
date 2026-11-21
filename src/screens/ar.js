// 仮の画面（実装予定）
import { h } from '../ui/dom.js';

export default {
  id: 'ar',
  title: 'AR表示',
  frame: 'hmd',

  mount(root) {
    root.appendChild(h('div', { class: 'panel', style: { margin: '16px' } }, 'AR表示（準備中）'));
    return { destroy() {} };
  },
};
