import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import viteCompression from 'vite-plugin-compression'
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

// manualChunks — 무거운 vendor 라이브러리를 별도 청크로 분리해 페이지 청크 축소.
//
// 효과:
//   - vendor-recharts: Insights 7탭 + WeeklyReview 만 받음 (다른 페이지 첫 로드 부담 X)
//   - vendor-tiptap: RichEditor/PostEditor 쓰는 페이지만 받음
//   - vendor-react / router / socket / i18n: 첫 로드에 포함되지만 페이지 청크에서 빠짐
//   - 캐시 효율: vendor 청크는 라이브러리 업데이트 전까지 hash 고정 → 페이지 청크만 새로 받음
function manualChunks(id: string): string | void {
  if (!id.includes('node_modules')) return;
  if (id.includes('/recharts/') || id.includes('/d3-')) return 'vendor-recharts';
  if (id.includes('/@tiptap/') || id.includes('/prosemirror-')) return 'vendor-tiptap';
  // 사이클 N+17 — lowlight/highlight.js 분리. PostEditor (lazy page 안) 만 사용하는데
  // catch-all vendor 청크에 들어가면 entry preload 에 끌려옴. 별도 청크로 분리하면 PostEditor
  // import 시점에만 load (Q docs / Q project 진입 시점). ~318KB → 첫 로드에서 빠짐.
  if (id.includes('/lowlight/') || id.includes('/highlight.js/') || id.includes('/hast-util-') ||
      id.includes('/devlop/') || id.includes('/fault/')) return 'vendor-highlight';
  if (id.includes('/react-router')) return 'vendor-router';
  if (id.includes('/react-select') || id.includes('/@floating-ui/')) return 'vendor-select';
  if (id.includes('/socket.io-client') || id.includes('/engine.io-client')) return 'vendor-socket';
  if (id.includes('/i18next') || id.includes('/react-i18next')) return 'vendor-i18n';
  if (id.includes('/styled-components')) return 'vendor-styled';
  if (id.includes('/date-fns') || id.includes('/rrule')) return 'vendor-date';
  if (id.includes('/tippy.js') || id.includes('/@popperjs/')) return 'vendor-tippy';
  if (
    id.includes('/react/') || id.includes('/react-dom/') ||
    id.includes('/scheduler/') || id.includes('/use-sync-external-store/') ||
    // 사이클 N+17 — React 생태계의 작은 의존성들도 묶음. vendor catch-all (160KB) 의 절반이 이것들.
    // 별도 청크 두 개로 분리하느니 vendor-react 와 합쳐 entry preload 1개 (~340KB → gzip 100KB) 깔끔.
    id.includes('/react-is/') || id.includes('/object-assign/') ||
    id.includes('/react-fast-compare/') || id.includes('/immer/')
  ) return 'vendor-react';
  return 'vendor';
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    emitVersionJson(),
    // 사이클 N+17 — 빌드 시 .gz 미리 생성 (압축 레벨 9 = 최대).
    // nginx 의 gzip_static on 이 .gz 파일을 우선 서빙 → 동적 압축 없이 강한 압축 효과.
    // 동적 gzip (현재 nginx default 레벨) 대비 추가 10-15% 절약.
    viteCompression({
      algorithm: 'gzip',
      ext: '.gz',
      threshold: 1024,
      compressionOptions: { level: 9 },
      deleteOriginFile: false,
      verbose: false,
    }),
    // brotli 는 운영 nginx 에 모듈 설치 후 별도 사이클에서 활성. 지금은 gzip 만.
  ],
  define: {
    __BUILD_ID__: JSON.stringify(BUILD_ID),
  },
  build: {
    outDir: '../dev-frontend-build',
    emptyOutDir: true,
    sourcemap: false,
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: { manualChunks },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3003',
      '/socket.io': { target: 'http://localhost:3003', ws: true }
    }
  }
})
