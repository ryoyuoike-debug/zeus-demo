// =============================================================================
// 研究開発中の機能: マルチプレイ（シミュレーション）
// -----------------------------------------------------------------------------
// 初期設定「使う／使わない」→［保存して開始］→ 役割（ホスト／クライアント）とルーム番号
// →「ホストのアンカー取得中…」→［同期］→ プリセットと透過度が 2 台の端末で同期される様子。
// 右上のステータスはルーム名と役割だけを白文字 1 行で表示（病院IDや内部の名前は出さない）。
// =============================================================================
import * as THREE from 'three';
import { createViewer } from '../../three/viewer.js';
import { getAnatomyGeometries, createAnatomyModel } from '../../three/meshing.js';
import { STRUCTURE_BY_ID } from '../../data/phantom.js';
import { h, researchBadge, toggleSwitch } from '../../ui/dom.js';

const ERROR_TEXT = '接続できませんでした。同じ病院・同じルーム番号で、ホストが起動しているか確認してください。';

const HOLO_IDS = ['lung_r', 'lung_l', 'trachea', 'bronchus', 'heart', 'aorta', 'vein', 'pa', 'pv', 'rib', 'cartilage', 'sternum', 'clavicle', 'spine', 'liver', 'nodule'];
const PRESETS = [
  { id: 'thorax', name: '胸腔モード', op: { lung_r: 0.5, lung_l: 0.5, trachea: 0.5, bronchus: 0.45, rib: 0.9, cartilage: 0.7, sternum: 0.85, clavicle: 0.85, spine: 0.8, heart: 0.5, liver: 0.45, nodule: 1 } },
  { id: 'subclavian', name: '鎖骨下静脈デモ', op: { vein: 1, aorta: 0.85, clavicle: 1, rib: 0.6, cartilage: 0.5, sternum: 0.75, lung_r: 0.25, lung_l: 0.25, heart: 0.35 } },
  { id: 'pulm', name: '肺血管・結節', op: { pa: 1, pv: 1, nodule: 1, lung_r: 0.35, lung_l: 0.35, trachea: 0.5, bronchus: 0.55, heart: 0.4 } },
];
const ROOMS = [1, 2, 3, 4, 5, 6];
const VIEW_CAM = [
  { pos: [-400, 170, 760], target: [0, 10, 0] },
  { pos: [430, 140, 740], target: [0, 10, 0] },
];

/** AR 表示に近い見た目（半透明＋自己発光） */
function styleHolo(model) {
  for (const [id, mesh] of model.meshes) {
    const c = new THREE.Color(STRUCTURE_BY_ID[id].color);
    mesh.material.emissive = c.multiplyScalar(id === 'nodule' ? 0.6 : id.startsWith('lung') ? 0.28 : 0.2);
    mesh.material.emissiveIntensity = 1;
  }
}

export function createMultiplayer({ signal }) {
  // ---------------------------------------------------------------------------
  // 状態
  // ---------------------------------------------------------------------------
  const mp = {
    phase: 'setup', // setup | single | room | connecting | error | ready | synced
    use: null, // true | false
    role: null, // 'host' | 'client'
    room: null,
    errorExample: false,
  };
  /** 端末（0 = この端末、1 = もう一台） */
  const dev = [
    { preset: 'thorax', lungT: 30, offset: 0, name: 'この端末' },
    { preset: 'pulm', lungT: 60, offset: 1, name: 'もう一台の端末' },
  ];
  const timers = new Set();
  const later = (fn, ms) => { const id = setTimeout(() => { timers.delete(id); fn(); }, ms); timers.add(id); return id; };
  const clearTimers = () => { for (const id of timers) clearTimeout(id); timers.clear(); };
  signal.addEventListener('abort', clearTimers);
  let destroyed = false;

  const roleName = (r) => (r === 'host' ? 'ホスト' : 'クライアント');
  const otherRole = () => (mp.role === 'host' ? 'client' : 'host');
  const hostIndex = () => (mp.role === 'host' ? 0 : 1);

  // ---------------------------------------------------------------------------
  // Quest 風の設定パネル
  // ---------------------------------------------------------------------------
  const ui = {};
  const qSteps = h('div', { class: 'rs-q-steps' }, ['初期設定', '役割・ルーム', '同期'].map((s, i) => h('span', { class: 'rs-q-step', 'data-i': i }, h('b', {}, String(i + 1)), s)));
  const qBody = h('div', { class: 'rs-q-body' });
  const quest = h('div', { class: 'rs-quest', role: 'group', 'aria-label': 'ARグラスのメニュー（シミュレーション）' },
    h('div', { class: 'rs-q-top' }, h('span', { class: 'rs-q-app' }, 'マルチプレイ'), h('span', { class: 'rs-q-dev' }, 'この端末のメニュー')),
    qSteps, qBody);
  const errSwitch = toggleSwitch({ label: '接続エラーの表示例', checked: false, title: '接続に失敗したときの表示を確認できます', onchange: (v) => { mp.errorExample = v; } });

  const qBtn = (label, { on = false, kind = '', onclick, disabled = false } = {}) => {
    const b = h('button', { class: `rs-q-btn${kind ? ` is-${kind}` : ''}${on ? ' is-on' : ''}`, onclick, disabled });
    b.textContent = label;
    return b;
  };

  function render() {
    qBody.innerHTML = '';
    const stepIdx = { setup: 0, single: 0, room: 1, connecting: 2, error: 1, ready: 2, synced: 2 }[mp.phase];
    qSteps.querySelectorAll('.rs-q-step').forEach((e, i) => {
      e.classList.toggle('is-current', i === stepIdx);
      e.classList.toggle('is-done', i < stepIdx || (mp.phase === 'synced' && i === 2));
    });
    const add = (...nodes) => nodes.forEach((n) => qBody.appendChild(n));
    if (mp.phase === 'setup') {
      ui.use = qBtn('使う', { on: mp.use === true, onclick: () => { mp.use = true; render(); } });
      ui.notUse = qBtn('使わない', { on: mp.use === false, onclick: () => { mp.use = false; render(); } });
      ui.start = qBtn('保存して開始', { kind: 'accent', disabled: mp.use == null, onclick: () => { mp.phase = mp.use ? 'room' : 'single'; render(); updateViews(); } });
      add(h('div', { class: 'rs-q-title' }, '初期設定'),
        h('div', { class: 'rs-q-field' }, h('span', { class: 'rs-q-label' }, 'マルチプレイ'), h('div', { class: 'rs-q-seg' }, ui.use, ui.notUse)),
        h('div', { class: 'rs-q-actions' }, ui.start));
    } else if (mp.phase === 'single') {
      add(h('div', { class: 'rs-q-title' }, 'マルチプレイを使わずに開始しました'),
        h('p', { class: 'rs-q-text' }, 'この端末だけで表示します。'),
        h('div', { class: 'rs-q-actions' }, qBtn('初期設定に戻る', { onclick: () => { mp.phase = 'setup'; render(); updateViews(); } })));
    } else if (mp.phase === 'room') {
      ui.host = qBtn('ホスト', { on: mp.role === 'host', onclick: () => { mp.role = 'host'; render(); updateViews(); } });
      ui.client = qBtn('クライアント', { on: mp.role === 'client', onclick: () => { mp.role = 'client'; render(); updateViews(); } });
      ui.rooms = {};
      const grid = h('div', { class: 'rs-q-rooms' }, ROOMS.map((n) => (ui.rooms[n] = qBtn(String(n), { on: mp.room === n, onclick: () => { mp.room = n; render(); } }))));
      ui.connect = qBtn('接続', { kind: 'accent', disabled: !mp.role || !mp.room, onclick: connect });
      add(h('div', { class: 'rs-q-title' }, '役割とルーム番号'),
        h('div', { class: 'rs-q-field' }, h('span', { class: 'rs-q-label' }, '役割'), h('div', { class: 'rs-q-seg' }, ui.host, ui.client)),
        h('div', { class: 'rs-q-field' }, h('span', { class: 'rs-q-label' }, 'ルーム番号'), grid),
        h('div', { class: 'rs-q-actions' }, qBtn('戻る', { onclick: () => { mp.phase = 'setup'; render(); updateViews(); } }), ui.connect));
    } else if (mp.phase === 'connecting') {
      add(h('div', { class: 'rs-q-wait' }, h('span', { class: 'rs-q-spin' }),
        h('span', {}, mp.role === 'client' ? 'ホストのアンカー取得中…' : 'クライアントの参加を待っています…')),
      h('p', { class: 'rs-q-text' }, `ルーム ${mp.room}｜${roleName(mp.role)}`));
    } else if (mp.phase === 'error') {
      add(h('div', { class: 'rs-q-error', role: 'alert' }, h('span', { class: 'rs-q-error-icon', 'aria-hidden': 'true' }, '!'), h('span', {}, ERROR_TEXT)),
        h('div', { class: 'rs-q-actions' }, qBtn('戻る', { onclick: () => { mp.phase = 'room'; render(); updateViews(); } })));
    } else if (mp.phase === 'ready') {
      ui.sync = qBtn('同期', { kind: 'accent', onclick: doSync });
      ui.sync.classList.add('is-pulse');
      add(h('div', { class: 'rs-q-title' }, mp.role === 'client' ? 'ホストのアンカーを取得しました' : 'クライアントが参加しました'),
        h('p', { class: 'rs-q-text' }, '［同期］を押すと、表示の位置とプリセットがホストにそろいます。'),
        h('div', { class: 'rs-q-actions' }, ui.sync));
    } else if (mp.phase === 'synced') {
      add(h('div', { class: 'rs-q-title is-ok' }, h('span', { class: 'rs-q-ok', 'aria-hidden': 'true' }, '✓'), '同期しました'),
        h('p', { class: 'rs-q-text' }, 'プリセットと透過度は、ほかの端末にも同期されます。右の2台で操作してみてください。'),
        h('div', { class: 'rs-q-actions' }, qBtn('切断', { onclick: () => { mp.phase = 'room'; render(); updateViews(); } })));
    }
  }

  function connect() {
    mp.phase = 'connecting';
    render(); updateViews();
    later(() => {
      if (mp.errorExample) { mp.phase = 'error'; render(); updateViews(); return; }
      mp.phase = 'ready'; render(); updateViews();
    }, mp.errorExample ? 1400 : 1700);
  }
  function doSync() {
    const hi = hostIndex(), ci = 1 - hi;
    sendPacket(hi, () => {
      dev[ci].preset = dev[hi].preset;
      dev[ci].lungT = dev[hi].lungT;
      views[ci]?.alignTo(0);
      mp.phase = 'synced';
      render(); updateViews();
      flash(ci, '同期しました');
      flash(hi, '同期しました');
    });
  }

  // ---------------------------------------------------------------------------
  // 2 台の端末の表示
  // ---------------------------------------------------------------------------
  const link = h('div', { class: 'rs-mp-link', 'aria-hidden': 'true' },
    h('div', { class: 'rs-mp-link-line' }), h('div', { class: 'rs-mp-link-icon' }, '⇄'), h('div', { class: 'rs-mp-link-label' }, '同期'));
  const views = [];
  const viewEls = dev.map((d, i) => {
    const host3 = h('div', { class: 'three-host rs-mp-3d' });
    const status = h('div', { class: 'rs-mp-status' });
    const flashEl = h('div', { class: 'rs-mp-flash' });
    const waitEl = h('div', { class: 'rs-mp-wait' });
    const roleChip = h('span', { class: 'rs-mp-role' });
    const presetBtns = {};
    const presets = h('div', { class: 'rs-mp-presets' }, PRESETS.map((p) => (presetBtns[p.id] = qBtn(p.name, { onclick: () => change(i, { preset: p.id }) }))));
    const range = h('input', { type: 'range', min: 0, max: 100, step: 1, value: d.lungT, class: 'rs-mp-range', 'aria-label': `${d.name}：肺の透過度` });
    const rangeVal = h('span', { class: 'rs-mp-range-val' });
    range.addEventListener('input', () => change(i, { lungT: +range.value }), { signal });
    const ctrl = h('div', { class: 'rs-mp-ctrl' }, presets,
      h('label', { class: 'rs-mp-slider' }, h('span', {}, '肺の透過度'), range, rangeVal));
    const box = h('div', { class: 'rs-mp-view' },
      h('div', { class: 'rs-mp-view-head' }, h('span', { class: 'rs-mp-dev' }, d.name), roleChip),
      h('div', { class: 'rs-mp-hmd' }, host3, status, flashEl, waitEl),
      ctrl);
    return { box, host3, status, flashEl, waitEl, roleChip, presetBtns, range, rangeVal };
  });

  function updateViews() {
    const connected = ['ready', 'synced'].includes(mp.phase);
    viewEls.forEach((v, i) => {
      const d = dev[i];
      // 役割
      let role = null;
      if (mp.role && ['connecting', 'ready', 'synced', 'error'].includes(mp.phase)) role = i === 0 ? mp.role : otherRole();
      else if (i === 1 && mp.phase !== 'single' && mp.phase !== 'setup' && mp.role) role = otherRole();
      v.roleChip.textContent = role ? roleName(role) : (i === 0 && mp.phase === 'single' ? 'シングル' : '未設定');
      v.roleChip.className = `rs-mp-role${role === 'host' ? ' is-host' : role === 'client' ? ' is-client' : ''}`;
      // ステータス（右上・白文字・1行）
      let st = '未接続';
      if (i === 0 && mp.phase === 'single') st = 'シングル';
      else if (connected && mp.room) st = `ルーム ${mp.room}｜${roleName(role)}`;
      else if (mp.phase === 'connecting') st = i === 0 ? '接続中…' : (role === 'host' ? `ルーム ${mp.room}｜ホスト` : '接続中…');
      else if (mp.phase === 'error' && i === 0) st = '接続エラー';
      v.status.textContent = st;
      v.waitEl.textContent = mp.phase === 'connecting' && i === 0 && mp.role === 'client' ? 'ホストのアンカー取得中…' : '';
      v.waitEl.classList.toggle('is-on', !!v.waitEl.textContent);
      // 操作
      for (const p of PRESETS) v.presetBtns[p.id].classList.toggle('is-on', d.preset === p.id);
      if (+v.range.value !== d.lungT) v.range.value = d.lungT;
      v.rangeVal.textContent = `${d.lungT}%`;
      v.box.classList.toggle('is-synced', mp.phase === 'synced');
      views[i]?.apply(d);
    });
    link.classList.toggle('is-on', mp.phase === 'synced');
    link.classList.toggle('is-wait', ['connecting', 'ready'].includes(mp.phase));
    // 同期前は、クライアント側の表示がホストのアンカーとずれている
    if (mp.phase !== 'synced') {
      const ci = mp.role === 'client' ? 0 : 1;
      views[ci]?.alignTo(1);
      views[1 - ci]?.alignTo(0);
    }
  }

  /** 端末 i の操作。同期中ならもう一台へ送る */
  function change(i, patch) {
    Object.assign(dev[i], patch);
    updateViews();
    if (mp.phase !== 'synced') return;
    const j = 1 - i;
    sendPacket(i, () => {
      Object.assign(dev[j], patch);
      updateViews();
      flash(j, 'Sync');
    }, Object.keys(patch).join());
  }

  const lastSend = new Map();
  function sendPacket(from, onArrive, key = 'sync') {
    // スライダー連続操作などは 1 つのパケットにまとめる
    const prev = lastSend.get(key);
    if (prev && performance.now() - prev.t < 300) { prev.cb = onArrive; return; }
    const rec = { t: performance.now(), cb: onArrive };
    lastSend.set(key, rec);
    const pk = h('span', { class: `rs-mp-packet ${from === 0 ? 'is-ltr' : 'is-rtl'}` });
    viewsWrap.appendChild(pk);
    later(() => { pk.remove(); if (lastSend.get(key) === rec) lastSend.delete(key); rec.cb(); }, 620);
  }
  function flash(i, text) {
    const f = viewEls[i].flashEl;
    f.textContent = text === 'Sync' ? '同期' : text;
    f.classList.remove('is-on');
    void f.offsetWidth;
    f.classList.add('is-on');
  }

  const viewsWrap = h('div', { class: 'rs-mp-views' }, viewEls[0].box, link, viewEls[1].box);
  const el = h('section', { class: 'rs-sec rs-mp' },
    h('div', { class: 'rs-mp-left' },
      h('div', { class: 'rs-sec-title' }, 'マルチプレイ', researchBadge(), h('span', { class: 'badge badge-info' }, 'シミュレーション')),
      h('p', { class: 'rs-sec-lead' }, '複数のARグラスで、同じ3Dモデルの表示を共有します。'),
      quest,
      h('div', { class: 'rs-mp-opts' }, errSwitch),
      h('ul', { class: 'rs-mp-how' },
        h('li', {}, h('b', {}, 'ホスト'), 'ルームを作成し、表示の基準（アンカー）を共有します。'),
        h('li', {}, h('b', {}, 'クライアント'), 'ホストのアンカーを取得して［同期］します。'),
        h('li', {}, h('b', {}, '同期後'), 'プリセットと透過度が、ほかの端末にも反映されます。')),
      h('p', { class: 'rs-note' }, '画面はシミュレーションです。実際の端末の画面とは異なります。')),
    viewsWrap);

  // ---------------------------------------------------------------------------
  // 3D（ホログラム表示）
  // ---------------------------------------------------------------------------
  const viewers = viewEls.map((v, i) => createViewer(v.host3, { controls: false, cameraPos: VIEW_CAM[i].pos, target: VIEW_CAM[i].target, lights: 'studio', fov: 32 }));
  getAnatomyGeometries().then((geoms) => {
    if (destroyed || signal.aborted) return;
    viewers.forEach((viewer, i) => {
      const model = createAnatomyModel(geoms, { style: 'clinical', include: HOLO_IDS, opacity: { lung_r: 0.4, lung_l: 0.4 } });
      styleHolo(model);
      viewer.scene.add(model.group);
      const cur = {}, goal = {};
      for (const id of HOLO_IDS) { cur[id] = 0; goal[id] = 0; model.setOpacity(id, 0); }
      let offset = dev[i].offset, offGoal = dev[i].offset;
      const cam = VIEW_CAM[i];
      viewer.onFrame((dt, t) => {
        // 透過度をなめらかに目標値へ
        const k = Math.min(1, dt * 7);
        for (const id of HOLO_IDS) {
          if (Math.abs(cur[id] - goal[id]) > 0.002) { cur[id] += (goal[id] - cur[id]) * k; model.setOpacity(id, cur[id]); }
        }
        offset += (offGoal - offset) * Math.min(1, dt * 3.2);
        model.group.position.set(offset * 46, offset * 8, offset * -24);
        model.group.rotation.y = offset * 0.2;
        // 頭の小さな揺れ（装着者の視点）
        viewer.camera.position.set(cam.pos[0] + Math.sin(t * 0.37 + i) * 14, cam.pos[1] + Math.sin(t * 0.51 + i * 2) * 6, cam.pos[2]);
        viewer.camera.lookAt(cam.target[0], cam.target[1], cam.target[2]);
      });
      views[i] = {
        model,
        apply(d) {
          const p = PRESETS.find((x) => x.id === d.preset);
          for (const id of HOLO_IDS) {
            let v = p.op[id] ?? 0;
            if ((id === 'lung_r' || id === 'lung_l') && v > 0) v = 0.04 + 0.66 * (1 - d.lungT / 100);
            goal[id] = v;
          }
        },
        alignTo(v) { offGoal = v; dev[i].offset = v; },
      };
      views[i].apply(dev[i]);
    });
  });

  render();
  updateViews();

  return {
    el,
    activate() { viewers.forEach((v) => { v.resume(); v.resize(); }); },
    deactivate() { viewers.forEach((v) => v.pause()); },
    destroy() {
      destroyed = true;
      clearTimers();
      views.forEach((v) => v?.model.dispose());
      viewers.forEach((v) => v.dispose());
    },
    /** ガイドツアー（約11秒） */
    async tour(t) {
      // はじめから
      clearTimers();
      Object.assign(mp, { phase: 'setup', use: null, role: null, room: null, errorExample: false });
      errSwitch.querySelector('input').checked = false;
      dev[0].preset = 'thorax'; dev[0].lungT = 30;
      dev[1].preset = 'pulm'; dev[1].lungT = 60;
      views[0]?.alignTo(0); views[1]?.alignTo(1);
      render(); updateViews();
      await t.sleep(300);
      t.caption('初期設定で「使う」を選び、［保存して開始］を押します。');
      await t.click(ui.use);
      await t.click(ui.start);
      t.caption('役割とルーム番号を選んで、接続します。');
      await t.click(ui.client);
      await t.click(ui.rooms[3]);
      await t.click(ui.connect);
      t.caption('「ホストのアンカー取得中…」の後、［同期］を押すと、表示の位置とプリセットがホストにそろいます。');
      for (let i = 0; i < 60 && mp.phase !== 'ready'; i++) await t.sleep(100);
      await t.click(ui.sync);
      await t.sleep(1200);
      t.caption('プリセットや透過度を変えると、もう一台の端末にも同期されます。');
      await t.click(viewEls[0].presetBtns.subclavian);
      await t.sleep(800);
      const r = viewEls[1].range;
      await t.pointAt(r, 400);
      for (let v = dev[1].lungT; v <= 85; v += 3) {
        t.check();
        r.value = v;
        r.dispatchEvent(new Event('input', { bubbles: true }));
        await t.sleep(45);
      }
      await t.sleep(1000);
    },
  };
}
