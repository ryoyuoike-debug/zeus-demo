// =============================================================================
// 「新規データ追加」と「メイン画面」の間で共有する、画面ローカルの小さな状態
// （共有ストア state.js には載せない。デモのリセットで自動的に消える）
// =============================================================================
import { subscribe } from '../../app/state.js';

/** 新規データ追加で取り込む既定の症例（直接 URL で後の画面を開いた場合もこの症例とみなす） */
export const DEFAULT_NEW = 'DEMO-0001';

/** 新規データ追加で最後に取り込んだ症例（3D構成後にメイン画面のリストへ「新規」として追加される） */
export const session = {
  /** 取り込んだ症例 ID（未取込なら null。直接 URL で後の画面を開いた場合は DEMO-0001 とみなす） */
  importedCaseId: null,
  /** 取込元: 'pacs' | 'cd' */
  importedFrom: null,
  /** メイン画面のリストで、新規症例の追加アニメーションを再生済みか */
  announcedFor: null,
  /**
   * 新規データ追加で取り込んだ症例の 3D構成: caseId → true（構成済み）/ false（まだ）。
   * ここにない症例は既存の例（3D構成済み）として扱う。DEMO-0001 は最初から「まだ」。
   * 3D構成が終わった症例は、別の症例を開いたあともメイン画面のリストに残る。
   */
  newCases: new Map([[DEFAULT_NEW, false]]),
  /** メイン画面で一覧から削除した行（デモ上の擬似削除）: リスト番号 → Set<caseId> */
  removed: { marker: new Set(), transfer: new Set() },
  /** 取り込んだ症例の体位: caseId → 'supine' | 'right' | 'left'（ここにない症例は仰臥位） */
  positions: new Map(),
};

/** メイン画面のリスト（2・3）に載る症例か（取り込んで 3D構成がまだの症例は載せない） */
export function isListed(id) {
  return !session.newCases.has(id) || session.newCases.get(id) === true;
}

// resetDemo() はすべての進捗キーをまとめて setState するので、それを検知して初期化する
const RESET_KEYS = ['imported', 'reconstructed', 'markersConfirmed', 'roi', 'line', 'transferred', 'registered'];
subscribe((s, patch) => {
  if (RESET_KEYS.every((k) => k in patch)) {
    session.importedCaseId = null;
    session.importedFrom = null;
    session.announcedFor = null;
    session.newCases.clear();
    session.newCases.set(DEFAULT_NEW, false);
    session.removed.marker.clear();
    session.removed.transfer.clear();
    session.positions.clear();
  }
  // 取り込んだ症例を作業中に 3D構成が終わった（またはやり直した）ら記録する。
  // 別の症例に切り替えても、取り込んだ症例の記録はそのまま残す。
  if ('reconstructed' in patch && session.newCases.has(s.caseId)) {
    session.newCases.set(s.caseId, !!s.reconstructed);
  }
});
