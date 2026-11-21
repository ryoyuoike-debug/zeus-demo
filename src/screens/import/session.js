// =============================================================================
// 「新規データ追加」と「メイン画面」の間で共有する、画面ローカルの小さな状態
// （共有ストア state.js には載せない。デモのリセットで自動的に消える）
// =============================================================================
import { subscribe } from '../../app/state.js';

/** 新規データ追加で最後に取り込んだ症例（3D構成後にメイン画面のリストへ「新規」として追加される） */
export const session = {
  /** 取り込んだ症例 ID（未取込なら null。直接 URL で後の画面を開いた場合は DEMO-0001 とみなす） */
  importedCaseId: null,
  /** 取込元: 'pacs' | 'cd' */
  importedFrom: null,
  /** メイン画面のリストで、新規症例の追加アニメーションを再生済みか */
  announcedFor: null,
  /** メイン画面で一覧から削除した行（デモ上の擬似削除）: リスト番号 → Set<caseId> */
  removed: { marker: new Set(), transfer: new Set() },
};

// resetDemo() はすべての進捗キーをまとめて setState するので、それを検知して初期化する
const RESET_KEYS = ['imported', 'reconstructed', 'markersConfirmed', 'roi', 'line', 'transferred', 'registered'];
subscribe((_s, patch) => {
  if (RESET_KEYS.every((k) => k in patch)) {
    session.importedCaseId = null;
    session.importedFrom = null;
    session.announcedFor = null;
    session.removed.marker.clear();
    session.removed.transfer.clear();
  }
});
