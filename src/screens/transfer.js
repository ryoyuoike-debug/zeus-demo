// 仮の画面（実装予定）
import { h } from '../ui/dom.js';

export default {
  id: 'transfer',
  title: '端末への転送',
  frame: 'pc',

  mount(root) {
    root.appendChild(h('div', { class: 'panel', style: { margin: '16px' } }, '端末への転送（準備中）'));
    return { destroy() {} };
  },
};
