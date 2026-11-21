// PC アプリの「設定」「バージョン」ダイアログ（値はすべてデモ用のダミー）
import { h, dialog, researchBadge } from './dom.js';
import { DEMO_NETWORK } from '../data/cases.js';

export function showSettings() {
  const row = (k, v) => h('tr', {}, h('th', {}, k), h('td', { class: 'mono' }, v));
  const body = h('div', { class: 'col' },
    h('p', {}, 'DICOM 通信（PACS 接続）の設定画面のイメージです。表示している値はすべて架空のものです。'),
    h('table', { class: 'table' },
      h('tbody', {},
        row('ローカル AE', `${DEMO_NETWORK.local.ae}　/　ポート ${DEMO_NETWORK.local.port}`),
        row('リモート AE（PACS）', DEMO_NETWORK.remote.ae),
        row('ホスト', DEMO_NETWORK.remote.host),
        row('ポート', String(DEMO_NETWORK.remote.port)))),
    h('p', { class: 'small faint' }, 'マニュアル・サポート窓口の案内もこの画面から確認できます（デモでは省略）。'));
  return dialog({ title: '設定', body, width: '520px', buttons: [{ label: '閉じる', value: true, kind: 'primary' }] });
}

export function showVersion() {
  const row = (k, v) => h('tr', {}, h('th', {}, k), h('td', {}, v));
  const body = h('div', { class: 'col' },
    h('table', { class: 'table' },
      h('tbody', {},
        row('アプリ', 'Zeus（デモビルド）'),
        row('バージョン', 'Demo build'),
        row('画像データ', '合成胸部ファントム（架空のデータ）'),
        row('臓器の自動抽出', h('span', {}, 'オープンソースのセグメンテーションモデル（nnU-Net 系）を利用 ', researchBadge())))),
    h('p', { class: 'small faint' }, 'このデモは説明用のシミュレーションです。実製品のバージョン情報・認証番号は表示していません。'));
  return dialog({ title: 'バージョン情報', body, width: '540px', buttons: [{ label: '閉じる', value: true, kind: 'primary' }] });
}
