// PlanQ Service Worker — Web Push 수신 + 알림 클릭 + Share Target POST 처리.
// payload 형식: { title, body, link?, tag?, icon? }

const SHARE_CACHE = 'planq-share-v1';

self.addEventListener('install', (event) => {
  // 즉시 활성화 (대기 안 함)
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Share Target POST — manifest.json 의 share_target.action='/share-receive' (POST)
// 외부 앱이 파일+텍스트를 multipart 로 전송 → SW 가 받아서 Cache 에 임시 저장 →
// ShareReceivePage 로 redirect (파일 처리 시 Cache 에서 다시 읽어옴).
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method === 'POST' && url.pathname === '/share-receive') {
    event.respondWith((async () => {
      try {
        const formData = await event.request.formData();
        const title = formData.get('title') || '';
        const text = formData.get('text') || '';
        const link = formData.get('url') || '';
        const files = formData.getAll('files') || [];

        // Cache 에 파일 임시 저장 (10분 후 자동 정리는 별도 — 일단 새 share 마다 덮어쓰기)
        const cache = await caches.open(SHARE_CACHE);
        await cache.delete('/_share_payload');
        const payload = {
          title: String(title),
          text: String(text),
          url: String(link),
          fileCount: files.length,
          ts: Date.now(),
        };
        await cache.put('/_share_payload', new Response(JSON.stringify(payload), {
          headers: { 'Content-Type': 'application/json' },
        }));
        // 파일들 — index 별로 저장
        for (let i = 0; i < files.length; i++) {
          const f = files[i];
          if (f instanceof File) {
            await cache.put(`/_share_file_${i}`, new Response(f, {
              headers: {
                'Content-Type': f.type || 'application/octet-stream',
                'X-Filename': encodeURIComponent(f.name),
              },
            }));
          }
        }
        // ShareReceivePage 로 redirect — query 로 share 마커
        return Response.redirect('/share-receive?shared=1', 303);
      } catch (e) {
        return Response.redirect('/share-receive?error=share_failed', 303);
      }
    })());
  }
});

self.addEventListener('push', (event) => {
  if (!event.data) return;
  let payload;
  try { payload = event.data.json(); } catch { payload = { title: 'PlanQ', body: event.data.text() }; }
  const title = payload.title || 'PlanQ';
  const options = {
    body: payload.body || '',
    icon: payload.icon || '/icon-192.png',
    badge: '/icon-72.png',
    tag: payload.tag || undefined,
    // 같은 tag 의 최신 알림으로 교체 — 기본은 false (true 면 누적 알림)
    // Slack 패턴: 같은 대화방은 최신만. user 가 못 보고 누적되는 사고 방지.
    renotify: !!payload.tag,
    // 사운드 + 진동 명시 — OS 시스템 알림 사운드/진동 활성. silent:false 가 default 지만
    // 일부 브라우저는 silent 미명시 시 무음으로 처리되는 경우 있어 명시.
    silent: false,
    vibrate: [200, 100, 200],  // 모바일 — 짧은 진동 패턴
    data: { link: payload.link || '/' },
    requireInteraction: false,
  };
  event.waitUntil((async () => {
    await self.registration.showNotification(title, options);
    // App Badging API — 데스크탑 PWA 아이콘 / 모바일 홈스크린 숫자
    // Chrome/Edge desktop · Android Chrome · iOS Safari 16.4+ 지원
    try {
      if ('setAppBadge' in self.navigator) {
        // 정확한 토탈은 클라이언트가 알지만 SW 가 fetch 하면 비용↑ — 알림 1개 도착 = 최소 1
        // 클라이언트 활성 시 setAppBadge(actualTotal) 로 덮어씀.
        await self.navigator.setAppBadge();
      }
    } catch { /* unsupported / blocked — silent */ }
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const link = event.notification.data?.link || '/';
  event.waitUntil((async () => {
    // 클릭 시 badge clear (앱 진입하므로 — 정확한 카운트는 앱 내부에서 다시 setAppBadge)
    try {
      if ('clearAppBadge' in self.navigator) await self.navigator.clearAppBadge();
    } catch { /* silent */ }
    const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of clientList) {
      if (c.url && 'focus' in c) {
        c.navigate(link);
        return c.focus();
      }
    }
    if (self.clients.openWindow) return self.clients.openWindow(link);
  })());
});
