// =============================================================================
// 画面の登録
// -----------------------------------------------------------------------------
// 画面モジュールの約束事（src/screens/<id>.js の default export）:
//   {
//     id: string, title: string,
//     frame: 'pc' | 'hmd' | 'page',      // 'pc' = PCアプリ「Zeus」のウィンドウ枠, 'hmd' = ARグラス視野の枠
//     flush?: boolean,                   // true なら外側の余白なし
//     mount(root, ctx) => instance       // ctx = { signal: AbortSignal, params, tour: boolean }
//   }
//   instance = { destroy(): void, tour?(t): Promise<void> }
//   tour(t) の t: { caption(text), sleep(ms), pointAt(el|{x,y}), click(el), highlight(el,ms), drag(el, points), signal }
// =============================================================================
import intro from '../screens/intro.js';
import home from '../screens/home.js';
import importScreen from '../screens/import.js';
import reconstruct from '../screens/reconstruct.js';
import marker from '../screens/marker.js';
import roi from '../screens/roi.js';
import transfer from '../screens/transfer.js';
import ar from '../screens/ar.js';
import research from '../screens/research.js';
import summary from '../screens/summary.js';

export const SCREENS = Object.fromEntries(
  [intro, home, importScreen, reconstruct, marker, roi, transfer, ar, research, summary].map((s) => [s.id, s]),
);

/** ステッパーの並び（group: 'pc' | 'hmd' | 'research'） */
export const STEPS = [
  { id: 'intro', label: 'はじめに' },
  { id: 'home', label: 'メイン画面', group: 'pc' },
  { id: 'import', label: '新規データ追加', num: '1', group: 'pc' },
  { id: 'reconstruct', label: '3D構成', num: '1', group: 'pc' },
  { id: 'marker', label: 'マーカ確認', num: '2', group: 'pc' },
  { id: 'roi', label: '関心領域', num: '2', group: 'pc' },
  { id: 'transfer', label: '端末への転送', num: '3', group: 'pc' },
  { id: 'ar', label: 'AR表示', group: 'hmd' },
  { id: 'research', label: '研究開発中の機能', group: 'research', researchOnly: true },
  { id: 'summary', label: 'まとめ' },
];
