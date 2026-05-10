// PlanQ Service Worker — Web Push 수신 + 알림 클릭 + Share Target POST 처리.
// payload 형식: { title, body, link?, tag?, icon? }

const SHARE_CACHE = 'planq-share-v1';

self.addEventListener('install', (event) => {
  // 즉시 활성화 (대기 안 함)
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    await self.clients.claim();
    // 새 SW activate = 새 빌드 = 옛 페이지 코드 잠금 풀기.
    // 클라이언트 URL 에 누적된 _v= query 정리 + 강제 navigate (한 번만).
    // 옛 main.tsx 의 무한 reload 루프에 갇힌 사용자를 자동 탈출시킴.
    try {
      const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const c of allClients) {
        try {
          const u = new URL(c.url);
          // _v=숫자 query 모두 제거
          u.searchParams.forEach((_, key, sp) => { if (key === '_v') sp.delete(key); });
          let cleaned = u.searchParams.toString();
          // _v 가 여러 번 누적된 raw search 도 정리
          cleaned = (cleaned ? '?' + cleaned : '');
          const target = u.origin + u.pathname + cleaned + u.hash;
          if (target !== c.url) await c.navigate(target);
        } catch { /* per-client navigate 실패 무시 */ }
      }
    } catch { /* matchAll 실패 무시 */ }
  })());
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
    // App Badging API — 데스크탑 PWA 아이콘 / 모바일 홈스크린 숫자.
    // App Badge — payload.badge 가 number 일 때만 호출. 인자 없이 setAppBadge() 하면
    // 일부 브라우저가 "•"(점) 또는 "1" 로 표시하는 부작용 → Irene 명시: 숫자 없으면 표시 자체 X.
    try {
      if ('setAppBadge' in self.navigator && typeof payload.badge === 'number') {
        if (payload.badge > 0) {
          await self.navigator.setAppBadge(payload.badge);
        } else if ('clearAppBadge' in self.navigator) {
          await self.navigator.clearAppBadge();
        }
      }
    } catch { /* unsupported / blocked — silent */ }
    // 진단용 — push 도달 확인. 클라이언트가 listening 중이면 받음.
    // 자동 진단 모달이 5초 timeout 으로 OS 차단 케이스 detect.
    try {
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const c of clients) {
        c.postMessage({ type: 'planq:push-received', payload });
      }
    } catch { /* silent */ }
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const rawLink = event.notification.data?.link || '/';
  // same-origin URL 은 path 로 추출 (일부 브라우저의 c.navigate 가 절대 URL silent-fail).
  // cross-origin 은 그대로 openWindow 에 넘김 (브라우저가 새 탭으로 처리).
  let targetUrl = rawLink;
  let isSameOrigin = false;
  try {
    const u = new URL(rawLink, self.location.origin);
    if (u.origin === self.location.origin) {
      targetUrl = u.pathname + u.search + u.hash;
      isSameOrigin = true;
    } else {
      targetUrl = u.href;
    }
  } catch { /* invalid URL — rawLink 그대로 사용 */ }

  event.waitUntil((async () => {
    // 클릭 시 badge clear
    try {
      if ('clearAppBadge' in self.navigator) await self.navigator.clearAppBadge();
    } catch { /* silent */ }

    const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // 1) 같은 origin 에 열린 창이 있으면 navigate + focus 시도. navigate 실패하면 다음 fallback.
    if (isSameOrigin) {
      for (const c of clientList) {
        if (!c.url) continue;
        try {
          await c.navigate(targetUrl);
          if ('focus' in c) await c.focus();
          return;
        } catch { /* fallback to openWindow 시도 */ }
      }
    } else {
      // cross-origin — focus 시도만, navigate 안 됨
      for (const c of clientList) {
        if (c.url && c.url.startsWith(targetUrl) && 'focus' in c) {
          return c.focus();
        }
      }
    }
    // 2) 열린 창이 없거나 navigate 실패 → 새 창
    if (self.clients.openWindow) {
      const fullUrl = isSameOrigin ? `${self.location.origin}${targetUrl}` : targetUrl;
      return self.clients.openWindow(fullUrl);
    }
  })());
});
