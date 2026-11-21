// =============================================================================
// AR表示: プリセット（表示する構造と透過度の組み合わせ）と、透過度スライダーの対象
// 値は不透明度（0〜1）。載っていない構造は非表示。
// =============================================================================
const BONES = ['rib', 'cartilage', 'sternum', 'clavicle', 'spine'];

/** AR に転送される構造（体表は実物＝胸部模型が見えているので含めない） */
export const HOLO_IDS = ['lung_r', 'lung_l', 'trachea', 'bronchus', 'heart', 'aorta', 'vein', 'pa', 'pv', 'rib', 'cartilage', 'sternum', 'clavicle', 'spine', 'liver', 'nodule'];

export const PRESETS = [
  {
    id: 'thorax', name: '胸腔モード', desc: '肺・肋骨・横隔膜',
    op: { lung_r: 0.42, lung_l: 0.42, trachea: 0.5, bronchus: 0.45, rib: 0.95, cartilage: 0.8, sternum: 0.9, clavicle: 0.9, spine: 0.85, heart: 0.55, liver: 0.28, nodule: 1 },
  },
  {
    id: 'subclavian', name: '鎖骨下静脈デモ', desc: '鎖骨・静脈・動脈',
    op: { vein: 1, aorta: 0.85, clavicle: 1, rib: 0.7, cartilage: 0.55, sternum: 0.8, lung_r: 0.16, lung_l: 0.16, heart: 0.4 },
  },
  {
    id: 'bonelung', name: '骨・肺', desc: '肋骨と肺の重なり',
    op: { rib: 1, cartilage: 0.9, sternum: 1, clavicle: 1, spine: 1, lung_r: 0.45, lung_l: 0.45, trachea: 0.6, bronchus: 0.55 },
  },
  {
    id: 'pulm', name: '肺血管・結節', desc: '肺動脈・肺静脈・結節',
    op: { pa: 1, pv: 1, nodule: 1, lung_r: 0.2, lung_l: 0.2, trachea: 0.55, bronchus: 0.6, heart: 0.45 },
  },
  {
    id: 'all', name: 'すべて表示', desc: '転送された全構造',
    op: { lung_r: 0.35, lung_l: 0.35, trachea: 0.55, bronchus: 0.5, heart: 0.75, aorta: 0.95, vein: 0.95, pa: 0.85, pv: 0.85, rib: 0.95, cartilage: 0.8, sternum: 0.9, clavicle: 0.95, spine: 0.9, liver: 0.35, nodule: 1 },
  },
];

/** 透過度スライダーの対象（臓器ごと） */
export const OPACITY_TARGETS = [
  { id: 'lung', name: '肺', members: ['lung_r', 'lung_l'] },
  { id: 'bone', name: '骨', members: BONES },
  { id: 'heart', name: '心臓', members: ['heart'] },
  { id: 'vessel', name: '血管', members: ['aorta', 'vein', 'pa', 'pv'] },
];
