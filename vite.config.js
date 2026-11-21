import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `npm run build`         -> dist/        (通常のビルド。GitHub Pages 等に配置可能)
// `npm run build:single`  -> dist-single/ (1ファイルの index.html。オフライン展示用にダブルクリックで開ける)
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: mode === 'single' ? [viteSingleFile()] : [],
  build: {
    outDir: mode === 'single' ? 'dist-single' : 'dist',
    chunkSizeWarningLimit: 2000,
  },
}));
