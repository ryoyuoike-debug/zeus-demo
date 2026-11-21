// =============================================================================
// 3D構成：処理段階のタイムラインと、抽出される構造のチェックリスト
// -----------------------------------------------------------------------------
// 画面の表示（進捗バー・チェックリスト・3D・CT の重ね表示）はすべて
// 仮想時刻 T（秒, 0..TOTAL）の関数として決めます。早送り・再生し直し・
// 完了状態の即時表示は、T の進め方を変えるだけで実現します。
// =============================================================================
import { STRUCTURE_BY_ID } from '../../data/phantom.js';

/** 処理段階（実機の目安は全体で約8分。デモでは約10秒に短縮） */
export const STAGES = [
  { id: 'load', label: 'DICOM読込', dur: 1.6 },
  { id: 'extract', label: '臓器の自動抽出', dur: 5.0, ai: true },
  { id: 'output', label: '3Dモデル出力', dur: 2.0 },
  { id: 'convert', label: '軽量化・端末用変換', dur: 1.4 },
];
{
  let acc = 0;
  for (const s of STAGES) { s.start = acc; acc += s.dur; s.end = acc; }
}
export const STAGE = Object.fromEntries(STAGES.map((s) => [s.id, s]));
export const TOTAL = STAGES[STAGES.length - 1].end;
/** 実機での目安（分） */
export const REAL_MINUTES = 8;

/** 脊髄（ファントムでは CT にのみ定義。3D はこの画面でチューブとして作る） */
export const CORD_COLOR = '#f3dc8a';

/**
 * 抽出された構造のチェックリスト（仕様の一覧に合わせた名前とまとめ方）。
 * ids は phantom.js の STRUCTURES の id（'cord' のみこの画面で作るメッシュ）。
 * 並びの順に抽出・表示されます（体表 → 胸腔内 → 骨格 → 腹部）。
 */
export const CHECKLIST = [
  { key: 'skin', name: '体表', ids: ['skin'] },
  { key: 'lung', name: '肺（右・左）', ids: ['lung_r', 'lung_l'] },
  { key: 'heart', name: '心臓', ids: ['heart'] },
  { key: 'aorta', name: '動脈', ids: ['aorta'] },
  { key: 'vein', name: '静脈', ids: ['vein'] },
  { key: 'pa', name: '肺動脈', ids: ['pa'] },
  { key: 'pv', name: '肺静脈', ids: ['pv'] },
  { key: 'airway', name: '気管・気管支', ids: ['trachea', 'bronchus'] },
  { key: 'rib', name: '肋骨', ids: ['rib'] },
  { key: 'spine', name: '椎骨', ids: ['spine'] },
  { key: 'clavicle', name: '鎖骨', ids: ['clavicle'] },
  { key: 'sternum', name: '胸骨', ids: ['sternum'] },
  { key: 'cartilage', name: '肋軟骨', ids: ['cartilage'] },
  { key: 'cord', name: '脊髄', ids: ['cord'] },
  { key: 'esophagus', name: '食道', ids: ['esophagus'] },
  { key: 'liver', name: '肝臓', ids: ['liver'] },
  { key: 'stomach', name: '胃', ids: ['stomach'] },
].map((c, i) => ({ ...c, index: i, color: c.key === 'cord' ? CORD_COLOR : STRUCTURE_BY_ID[c.ids[0]].color }));

export const CHECK_BY_KEY = Object.fromEntries(CHECKLIST.map((c) => [c.key, c]));
/** 構造 id → チェックリストの key */
export const KEY_OF_ID = Object.fromEntries(CHECKLIST.flatMap((c) => c.ids.map((id) => [id, c.key])));
/** この画面で 3D 表示する phantom の構造（結節などの病変は抽出対象に含めない） */
export const MODEL_IDS = CHECKLIST.flatMap((c) => c.ids).filter((id) => id !== 'cord');

const SLOT = STAGE.extract.dur / CHECKLIST.length;
/** i 番目の構造が 3D に現れはじめる時刻 */
export function revealTime(i) { return STAGE.extract.start + (i + 0.3) * SLOT; }
/** i 番目の構造のチェックが付く時刻 */
export function checkTime(i) { return revealTime(i) + SLOT * 0.55; }
/** 時刻 T までに現れた構造の数 */
export function revealedCount(T) {
  let n = 0;
  for (let i = 0; i < CHECKLIST.length; i++) if (T >= revealTime(i)) n = i + 1;
  return n;
}
/** 時刻 T でチェック済みの構造の数 */
export function checkedCount(T) {
  let n = 0;
  for (let i = 0; i < CHECKLIST.length; i++) if (T >= checkTime(i)) n = i + 1;
  return n;
}

export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const easeInOut = (u) => (u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2);
export const easeOut = (u) => 1 - Math.pow(1 - u, 3);
/** 段階 s の進み具合（0..1） */
export function stageProgress(s, T) { return clamp01((T - s.start) / s.dur); }
/** 時刻 T に実行中の段階（完了後は null） */
export function activeStage(T) {
  if (T >= TOTAL) return null;
  return STAGES.find((s) => T < s.end) || null;
}
