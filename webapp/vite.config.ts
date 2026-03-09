import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: false,
  },
  build: {
    ssr: false,
    emptyOutDir: true,   // 빌드마다 dist 클린 (구 파일 제거)
    crossOriginLoading: false,  // WebView2 virtual host에서 crossorigin 속성 제거
    rollupOptions: {
      // Node.js 전용 모듈은 번들 제외 (브라우저 환경에서 불필요)
      external: ['fs', 'path', 'os', 'node-ssh', 'node-pty', 'ssh2'],
      output: {
        globals: {},
      },
    },
  },
  resolve: {
    alias: {
      '@components': path.resolve(__dirname, 'src/components'),
      '@hooks': path.resolve(__dirname, 'src/hooks'),
      '@services': path.resolve(__dirname, 'src/services'),
      '@types': path.resolve(__dirname, 'src/types'),
      '@utils': path.resolve(__dirname, 'src/utils'),
      '@styles': path.resolve(__dirname, 'src/styles'),
      '@bridge': path.resolve(__dirname, 'src/bridge'),
    },
  },
})
