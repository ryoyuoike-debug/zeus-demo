// =============================================================================
// アプリ全体の状態（シンプルなストア）
// 画面間で共有するもの: 選択中の症例、体位、各ステップの進捗、関心領域、ラインなど。
// =============================================================================
import { CASES } from '../data/cases.js';

const initial = () => ({
  /** 選択中の症例 ID（CASES の id） */
  caseId: CASES[0].id,
  /** 取込済み（新規データ追加が完了） */
  imported: false,
  /** 体位: 'supine' | 'right' | 'left' */
  position: 'supine',
  /** 3D 構成が完了 */
  reconstructed: false,
  /** マーカ確認が完了 */
  markersConfirmed: false,
  /** マーカの位置（やり直しで置き直した場合）: [[x,y,z] ×3]（患者座標 mm）。null なら検出したままの位置 */
  markerPositions: null,
  /** 関心領域（ROI）: ペンで塗った円の集合 [{x,y,z,r}]（患者座標 mm） */
  roi: [],
  /** 2 点ライン: {start:[x,y,z]|null, end:[x,y,z]|null} */
  line: { start: null, end: null },
  /** 端末への転送状況: { quest: 'done'|null, xreal: ..., ios: ... } */
  transferred: {},
  /** AR 表示: 位置合わせ済み */
  registered: false,
  /** ヘッダーの「研究開発機能を表示」 */
  researchMode: false,
  /** ガイドツアー実行中 */
  tourActive: false,
});

export const state = initial();
const bus = new EventTarget();

/** 状態を部分更新して 'change' を通知 */
export function setState(patch) {
  Object.assign(state, typeof patch === 'function' ? patch(state) : patch);
  bus.dispatchEvent(new CustomEvent('change', { detail: { ...patch } }));
}
/** 変更を購読。戻り値で解除。 */
export function subscribe(fn) {
  const l = (e) => fn(state, e.detail);
  bus.addEventListener('change', l);
  return () => bus.removeEventListener('change', l);
}
/** デモをはじめから（研究モードの設定は保持） */
export function resetDemo() {
  const keep = { researchMode: state.researchMode };
  setState({ ...initial(), ...keep });
}
export function currentCase() {
  return CASES.find((c) => c.id === state.caseId) || CASES[0];
}

// 画面遷移イベント（ルーターと画面の間）
const nav = new EventTarget();
export function navigate(screenId, params = {}) {
  nav.dispatchEvent(new CustomEvent('navigate', { detail: { screenId, params } }));
}
export function onNavigate(fn) {
  const l = (e) => fn(e.detail.screenId, e.detail.params);
  nav.addEventListener('navigate', l);
  return () => nav.removeEventListener('navigate', l);
}
