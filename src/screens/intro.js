// 仮の画面（実装予定）
import { h } from '../ui/dom.js';

export default {
  id: 'intro',
  title: 'はじめに',
  frame: 'page',

  mount(root) {
    root.appendChild(h('div', { class: 'panel', style: { margin: '16px' } }, 'はじめに（準備中）'));
    return { destroy() {} };
  },
};
