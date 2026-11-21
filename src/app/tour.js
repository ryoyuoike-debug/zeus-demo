// =============================================================================
// ガイドツアー（自動デモ）
// 各画面モジュールの mount() が返すインスタンスの tour(t) を順番に実行します。
// t には字幕・待機・仮想カーソル操作などのヘルパーが入っています。
// =============================================================================
import { h } from '../ui/dom.js';

const CURSOR_SVG = '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M3 2l7.5 19 2.6-7.6L21 10.8z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>';

/**
 * ツアー用ヘルパーを作る
 * @param {{signal: AbortSignal, setCaption:(s:string)=>void}} base
 */
export function makeTourHelpers({ signal, setCaption }) {
  let cursor = document.querySelector('.tour-cursor');
  if (!cursor) {
    cursor = h('div', { class: 'tour-cursor', html: CURSOR_SVG });
    cursor.style.left = `${window.innerWidth / 2}px`;
    cursor.style.top = `${window.innerHeight / 2}px`;
    document.body.appendChild(cursor);
  }
  const check = () => { if (signal.aborted) throw new DOMException('aborted', 'AbortError'); };
  const sleep = (ms) => new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException('aborted', 'AbortError'));
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('aborted', 'AbortError')); }, { once: true });
  });
  const centerOf = (target) => {
    if (target instanceof Element) {
      const r = target.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }
    return target;
  };
  const t = {
    signal,
    sleep,
    check,
    /** 字幕を表示 */
    caption(text) { check(); setCaption(text); },
    /** 仮想カーソルを要素（または {x,y} のクライアント座標）へ動かす */
    async pointAt(target, ms = 650, { block } = {}) {
      check();
      // 狭い画面（ページ全体がスクロール）では、対象を画面の中央に寄せる
      block ??= window.matchMedia('(max-width: 900px)').matches ? 'center' : 'nearest';
      // 画面下の字幕バーに隠れないよう、スクロール側に scroll-padding を設定している（main.css）
      if (target instanceof Element) target.scrollIntoView?.({ block, inline: 'nearest' });
      const p = centerOf(target);
      cursor.style.transitionDuration = `${ms}ms`;
      cursor.style.left = `${p.x}px`;
      cursor.style.top = `${p.y}px`;
      await sleep(ms + 50);
    },
    /** 要素をクリックする（カーソル移動 → クリック演出 → el.click()） */
    async click(el, { move = true, ms = 650 } = {}) {
      check();
      if (!el) return;
      if (move) await t.pointAt(el, ms);
      cursor.classList.remove('is-click');
      void cursor.offsetWidth;
      cursor.classList.add('is-click');
      await sleep(180);
      el.click();
      await sleep(250);
    },
    /** 要素を一定時間ハイライト */
    async highlight(el, ms = 1200) {
      check();
      if (!el) return;
      el.classList.add('tour-highlight');
      try { await sleep(ms); } finally { el.classList.remove('tour-highlight'); }
    },
    /**
     * ポインタ操作（ドラッグ）を再現する。points はクライアント座標の配列。
     * 対象要素に pointerdown / pointermove / pointerup を送る。
     */
    async drag(el, points, { stepMs = 16, button = 0 } = {}) {
      check();
      if (!el || !points.length) return;
      await t.pointAt(points[0], 400);
      const fire = (type, p) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: p.x, clientY: p.y, pointerId: 77, pointerType: 'mouse', button, buttons: type === 'pointerup' ? 0 : 1, isPrimary: true }));
      fire('pointerdown', points[0]);
      let last = points[0];
      try {
        for (const p of points.slice(1)) {
          check();
          cursor.style.transitionDuration = '0ms';
          cursor.style.left = `${p.x}px`;
          cursor.style.top = `${p.y}px`;
          fire('pointermove', p);
          last = p;
          await sleep(stepMs);
        }
      } finally {
        // 途中でツアーを止めても、押したままにならないよう必ず離す
        fire(signal.aborted ? 'pointercancel' : 'pointerup', last);
        cursor.style.transitionDuration = '';
      }
    },
    hideCursor() { cursor.style.opacity = '0'; },
    showCursor() { cursor.style.opacity = '1'; },
  };
  return t;
}

export function removeTourCursor() {
  document.querySelector('.tour-cursor')?.remove();
}
