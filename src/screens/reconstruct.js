// 仮の画面（コア動作確認用）
import { h } from '../ui/dom.js';
import { createViewer } from '../three/viewer.js';
import { getAnatomyGeometries, createAnatomyModel } from '../three/meshing.js';
import { createCtViewer } from '../ui/ctViewer.js';

export default {
  id: 'reconstruct',
  title: '3D構成',
  frame: 'pc',
  mount(root, ctx) {
    const left = h('div', { class: 'three-host', style: { height: '520px' } });
    const right = h('div', { style: { height: '520px' } });
    root.appendChild(h('div', { class: 'split', style: { padding: '14px' } }, left, right));
    const v = createViewer(left, { background: '#05080f', cameraPos: [0, 40, 1000] });
    let model;
    getAnatomyGeometries().then((g) => { if (ctx.signal.aborted) return; model = createAnatomyModel(g); v.scene.add(model.group); window.__model = model; window.__viewer = v; });
    const ct = createCtViewer(right, { z: 80, patientLabel: 'DEMO-0001' });
    return { destroy() { model?.dispose(); v.dispose(); ct.dispose(); } };
  },
};
