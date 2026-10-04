// IndexNow — 공개 주소가 새로 생기거나 바뀌었음을 Bing(+Yandex 등 IndexNow 참여 엔진)에 바로 알린다 (2026-10-04 GEO §7-①).
//   ChatGPT 검색은 Bing 색인 의존도가 높다. 웹마스터 도구 소유 확인 없이도 **키 파일**(/<key>.txt)로 소유를 증명한다.
//   실행: 배포 직후(deploy-planq.sh, generate-seo 다음). 운영에서만 보낸다 — dev 주소를 검색엔진에 알리지 않는다.
//   보내는 것: 운영 sitemap.xml 의 공개 주소뿐(로그인 화면·사적 데이터 없음). 실패해도 배포를 막지 않는다.
require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');

const KEY = 'e404272dcf90323b20dd5fdcbbd18bf7';
const ORIGIN = 'https://planq.kr';

(async () => {
  if (process.env.NODE_ENV !== 'production') { console.log('[indexnow] skip (not production)'); return; }
  const dir = process.env.FRONTEND_BUILD_DIR || '/opt/planq/frontend-build';
  if (!fs.existsSync(path.join(dir, `${KEY}.txt`))) { console.log('[indexnow] skip (key file missing)'); return; }
  let xml = '';
  try { xml = fs.readFileSync(path.join(dir, 'sitemap.xml'), 'utf8'); } catch { console.log('[indexnow] skip (no sitemap)'); return; }
  const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]).filter((u) => u.startsWith(ORIGIN + '/')).slice(0, 10000);
  if (!urls.length) { console.log('[indexnow] skip (0 urls)'); return; }
  try {
    const r = await fetch('https://api.indexnow.org/indexnow', {
      method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ host: 'planq.kr', key: KEY, keyLocation: `${ORIGIN}/${KEY}.txt`, urlList: urls }),
      signal: AbortSignal.timeout(15000),
    });
    console.log(`[indexnow] ${r.status} · ${urls.length} urls`);
  } catch (e) { console.log('[indexnow] failed', e.message); }
})();
