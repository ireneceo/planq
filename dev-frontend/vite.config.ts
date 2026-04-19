import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 빌드 시점의 고정 ID — i18n JSON cache-bust 용
const BUILD_ID = Date.now().toString();

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    __BUILD_ID__: JSON.stringify(BUILD_ID),
  },
  build: {
    outDir: '../dev-frontend-build',
    emptyOutDir: true
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3003',
      '/socket.io': { target: 'http://localhost:3003', ws: true }
    }
  }
})
