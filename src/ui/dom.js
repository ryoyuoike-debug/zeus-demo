// =============================================================================
// 小さな DOM ヘルパーと共通 UI 部品（ダイアログ・トースト・バッジ）
// =============================================================================

/**
 * 要素を作る。h('div', {class:'x', onclick: fn}, '文字', childEl, [配列も可])
 * 属性: class / style(文字列 or オブジェクト) / dataset / on*(イベント) / html(innerHTML) / それ以外は setAttribute
 * 子要素に null / false / undefined は無視される。
 */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') {
      // CSS カスタムプロパティ（--xxx）は setProperty でないと設定できない
      for (const [sk, sv] of Object.entries(v)) {
        if (sv == null) continue;
        if (sk.startsWith('--')) el.style.setProperty(sk, sv); else el.style[sk] = sv;
      }
    }
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value' && 'value' in el) el.value = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  appendChildren(el, children);
  return el;
}
function appendChildren(el, children) {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) appendChildren(el, c);
    else el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

/** SVG 要素を作る */
export function svg(tag, attrs = {}, ...children) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v != null) el.setAttribute(k, v);
  for (const c of children.flat()) if (c != null) el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}

/** 研究開発中バッジ */
export function researchBadge(text = '研究開発中・未承認') {
  return h('span', { class: 'badge badge-research', title: '研究開発中の機能です。医療機器としての承認を受けたものではありません。' }, text);
}
/** 研究段階（構想）バッジ */
export function conceptBadge(text = '研究段階（構想）') {
  return h('span', { class: 'badge badge-concept' }, text);
}
/** デモ用・模擬値バッジ */
export function demoBadge(text = 'デモ用の模擬値') {
  return h('span', { class: 'badge badge-demo' }, text);
}

/** 開いているダイアログ（画面を切り替えたときにまとめて閉じる） */
const openDialogs = new Set();
/** 開いているダイアログをすべて閉じる（結果は null） */
export function closeAllDialogs() {
  for (const close of [...openDialogs]) close(null);
}

/**
 * モーダルダイアログ。
 * @param {{title:string, body: (Node|string), buttons?: Array<{label:string, value:any, kind?:'primary'|'accent'|'ghost'}>, width?: string, signal?: AbortSignal}} o
 * @returns {Promise<any>} 押されたボタンの value（Esc / 背景クリック / signal の中断は null）
 */
export function dialog({ title, body, buttons = [{ label: 'OK', value: true, kind: 'primary' }], width, signal }) {
  return new Promise((resolve) => {
    if (signal?.aborted) { resolve(null); return; }
    let closed = false;
    const close = (v) => {
      if (closed) return;
      closed = true;
      openDialogs.delete(close);
      signal?.removeEventListener('abort', onAbort);
      overlay.classList.remove('is-open');
      setTimeout(() => overlay.remove(), 160);
      document.removeEventListener('keydown', onKey);
      resolve(v);
    };
    const onAbort = () => close(null);
    signal?.addEventListener('abort', onAbort, { once: true });
    openDialogs.add(close);
    const onKey = (e) => { if (e.key === 'Escape') close(null); };
    const box = h('div', { class: 'dialog', role: 'dialog', 'aria-modal': 'true', style: width ? { width } : null },
      h('div', { class: 'dialog-title' }, title),
      h('div', { class: 'dialog-body' }, typeof body === 'string' ? h('p', {}, body) : body),
      h('div', { class: 'dialog-actions' }, buttons.map((b) => h('button', { class: `btn btn-${b.kind || 'ghost'}`, onclick: () => close(b.value) }, b.label))));
    // ダブルクリックの 2 回目で背景がクリックされて、すぐ閉じてしまわないようにする
    const openedAt = performance.now();
    const overlay = h('div', { class: 'dialog-overlay', onclick: (e) => { if (e.target === overlay && e.detail < 2 && performance.now() - openedAt > 300) close(null); } }, box);
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('is-open'));
    document.addEventListener('keydown', onKey);
    box.querySelector('.btn-primary, .btn-accent, .btn')?.focus();
  });
}

/** 画面下部に一時的なメッセージを出す */
export function toast(message, { kind = 'info', ms = 2600 } = {}) {
  let host = document.querySelector('.toast-host');
  if (!host) { host = h('div', { class: 'toast-host', 'aria-live': 'polite' }); document.body.appendChild(host); }
  const t = h('div', { class: `toast toast-${kind}` }, message);
  host.appendChild(t);
  requestAnimationFrame(() => t.classList.add('is-in'));
  setTimeout(() => { t.classList.remove('is-in'); setTimeout(() => t.remove(), 250); }, ms);
}

/** 指定ミリ秒待つ（アニメーション用）。signal で中断可能。 */
export function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException('aborted', 'AbortError')); return; }
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('aborted', 'AbortError')); }, { once: true });
  });
}

/** 数値を ms かけてカウントアップ表示 */
export function animateNumber(el, from, to, ms = 800, fmt = (v) => v.toFixed(0)) {
  const t0 = performance.now();
  const tick = () => {
    const u = Math.min(1, (performance.now() - t0) / ms);
    const e = 1 - Math.pow(1 - u, 3);
    el.textContent = fmt(from + (to - from) * e);
    if (u < 1) requestAnimationFrame(tick);
  };
  tick();
}

/** トグルスイッチ（variant: 'research' で研究開発中の色） */
export function toggleSwitch({ label, checked = false, onchange, title, variant }) {
  const input = h('input', { type: 'checkbox', role: 'switch' });
  input.checked = checked;
  input.addEventListener('change', () => onchange?.(input.checked));
  return h('label', { class: 'switch' + (variant ? ` switch-${variant}` : ''), title }, input, h('span', { class: 'switch-track' }, h('span', { class: 'switch-thumb' })), label ? h('span', { class: 'switch-label' }, label) : null);
}

/** ラベル付きスライダー */
export function slider({ label, min = 0, max = 100, step = 1, value = 50, format = (v) => `${v}`, oninput }) {
  const out = h('span', { class: 'slider-value' }, format(value));
  const input = h('input', { type: 'range', min, max, step, value, class: 'range' });
  input.addEventListener('input', () => { out.textContent = format(+input.value); oninput?.(+input.value); });
  const el = h('label', { class: 'slider' }, h('span', { class: 'slider-label' }, label), input, out);
  el.input = input;
  el.set = (v) => { input.value = v; out.textContent = format(+v); };
  return el;
}
