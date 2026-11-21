// デモ用のロゴマーク（稲妻をモチーフにした簡易マーク。正式ロゴではありません）
export const LOGO_SVG = `
<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <defs>
    <linearGradient id="zg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#4aa3ff"/>
      <stop offset="1" stop-color="#1d4fd6"/>
    </linearGradient>
  </defs>
  <rect x="1" y="1" width="30" height="30" rx="8" fill="url(#zg)"/>
  <path d="M18.6 4.8 9.2 18.1h6.1l-2.1 9.1 9.6-13.6h-6.2z" fill="#fff"/>
</svg>`;

export const DISCLAIMER =
  '本デモには研究開発中の未承認機能が含まれます。未承認機能は販売・授与の対象ではありません。表示されている患者情報・画像・数値はすべて架空のデータ（合成ファントム）であり、診断・治療には使用できません。';
