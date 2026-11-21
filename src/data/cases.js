// =============================================================================
// デモ用の架空症例（実在の患者ではありません）
// 3D・CT 表示はすべて同じ合成ファントムを使います。
// =============================================================================
export const CASES = [
  {
    id: 'DEMO-0001', name: 'デモ 患者001', kana: 'デモ カンジャ001', sex: 'M', age: 68,
    studyDate: '2026/11/20', studyTime: '14:32', modality: 'CT', description: '胸部 CT（造影）',
    series: [
      { no: 2, desc: '縦隔条件 1.0mm', images: 174 },
      { no: 3, desc: '肺野条件 1.0mm', images: 174 },
    ],
    source: 'PACS',
  },
  {
    id: 'DEMO-0002', name: 'デモ 患者002', kana: 'デモ カンジャ002', sex: 'F', age: 54,
    studyDate: '2026/11/18', studyTime: '09:05', modality: 'CT', description: '胸部 CT（単純）',
    series: [
      { no: 2, desc: '縦隔条件 1.0mm', images: 174 },
      { no: 3, desc: '肺野条件 1.0mm', images: 174 },
    ],
    source: 'CD-ROM',
  },
  {
    id: 'DEMO-0003', name: 'デモ 患者003', kana: 'デモ カンジャ003', sex: 'M', age: 75,
    studyDate: '2026/11/12', studyTime: '16:48', modality: 'CT', description: '胸部 CT（造影）',
    series: [
      { no: 2, desc: '縦隔条件 1.0mm', images: 174 },
      { no: 3, desc: '肺野条件 1.0mm', images: 174 },
    ],
    source: 'PACS',
  },
];

/** 画面表示用の「撮影日 時刻」 */
export const studyDateTime = (c) => `${c.studyDate} ${c.studyTime}`;

/** デモの接続設定（すべて架空の値） */
export const DEMO_NETWORK = {
  local: { ae: 'DEMO_AE', port: 104 },
  remote: { ae: 'PACS_AE', host: '192.168.0.10', port: 104 },
};

/** デモの AR 端末 */
export const DEVICES = [
  { id: 'quest', name: 'Meta Quest 3', kind: 'HMD', conn: 'USB', doneMessage: 'データ転送完了' },
  { id: 'xreal', name: 'XREAL（Beam Pro）', kind: 'ARグラス', conn: 'USB', doneMessage: 'データ転送完了' },
  { id: 'ios', name: 'iPad・iPhone', kind: 'タブレット・スマートフォン', conn: 'USB', doneMessage: 'データ転送準備が完了' },
];
