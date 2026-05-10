import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { writeFileSync } from 'fs'
import { join } from 'path'

// 빌드 시점의 고정 ID — i18n JSON cache-bust + PWA 자동 업데이트 감지
const BUILD_ID = Date.now().toString();

// /version.json 산출 — 클라이언트가 주기적 fetch 해서 변경 감지 시 reload
function emitVersionJson(): Plugin {
  return {
    name: 'planq-version-json',
    apply: 'build',
    closeBundle() {
      const out = join(__dirname, '..', 'dev-frontend-build', 'version.json');
      writeFileSync(out, JSON.stringify({ build_id: BUILD_ID, built_at: new Date().toISOString() }));
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), emitVersionJson()],
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
