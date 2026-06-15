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
  // push 도착 시 새 SW 자가 점검 — 옛 SW 가 활성인데 새 빌드가 떠 있으면 install + activate.
  // PWA wake-up 자체가 SW lifecycle 진행 트리거 (모바일에서 자동 update 안 도는 회귀 차단).
  // ★ 2026-06-15 회귀 fix: self.registration.update() 를 showNotification 완료 후로 이동.
  //   먼저 호출하면 새 sw.js 가 있을 때 skipWaiting 으로 현재 SW 가 즉시 terminate 되어
  //   showNotification 이 안 끝나고 알림이 안 뜸 (201 인데 배너 안 옴의 근본 원인).
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
    // OS 배너는 항상 표시 (안 오는 것보다 가끔 2번 보이는 게 낫다 — 운영 원칙).
    //   배너 중복은 in-app 토스터 쪽에서 조율 (push 권한 granted 면 토스터 skip).
    await self.registration.showNotification(title, options);
    // App Badging API — 데스크탑 PWA 아이콘 / 모바일 홈스크린 숫자.
    // 진단 정보를 client 로 post 해 디바이스에서 콘솔로 확인 가능 (사이클 N+12 박제).
    const badgeDiag = {
      hasSetAppBadge: 'setAppBadge' in self.navigator,
      hasClearAppBadge: 'clearAppBadge' in self.navigator,
      payloadBadge: payload.badge,
      payloadBadgeType: typeof payload.badge,
      result: 'skipped',
      error: null,
    };
    // 사이클 N+22: visible client (=페이지 active) 있으면 SW 의 setAppBadge skip — client useGlobalBadge
    // 가 단일 진실. 옛 race: 사용자가 conv 읽어 client setAppBadge(3) 호출 → 직후 SW push 가 payload.badge=4
    // (잘못된 stale 값) 로 덮어쓰던 회귀. payload.badge 자체도 backend 시점 snapshot 이라 client 의 즉시
    // 갱신과 desync 가능. 그래서 client 가 살아있으면 SW 는 알림만 띄우고 badge 는 client 에 위임.
    try {
      const visibleClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: false });
      const hasFocusedClient = visibleClients.some(c => c.focused || c.visibilityState === 'visible');
      if (hasFocusedClient) {
        badgeDiag.result = 'skipped_active_client';
      } else if ('setAppBadge' in self.navigator && typeof payload.badge === 'number') {
        if (payload.badge > 0) {
          await self.navigator.setAppBadge(payload.badge);
          badgeDiag.result = 'set:' + payload.badge;
        } else if ('clearAppBadge' in self.navigator) {
          await self.navigator.clearAppBadge();
          badgeDiag.result = 'cleared';
        }
      } else {
        badgeDiag.result = !('setAppBadge' in self.navigator) ? 'unsupported_api' : 'no_badge_number';
      }
    } catch (e) {
      badgeDiag.result = 'error';
      badgeDiag.error = String(e && e.message || e);
    }
    // 진단용 — push 도달 + badge 호출 결과 client 에 전달. DevTools 콘솔로 확인.
    try {
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const c of clients) {
        c.postMessage({ type: 'planq:push-received', payload, badgeDiag });
      }
    } catch { /* silent */ }
    // [진단] delivery 측정 — SW 가 push 를 실제 받았음을 서버에 알림 (도달 확정용)
    try { await fetch('/api/push/ack?t=' + Date.now(), { method: 'POST', keepalive: true }); } catch { /* silent */ }
    // ★ self.registration.update() 제거 — push 처리 중 SW 전환으로 알림이 2번 뜨거나 안 뜨는 회귀 차단.
    //   SW 자가 갱신은 BuildVersionGuard(앱)의 reg.update() 가 담당.
  })());
});

// 구독 만료/교체 자동 감지 — 브라우저가 push 구독을 무효화/갱신할 때 발화.
//   SW 는 인증 토큰이 없어 서버 등록 불가 → 살아있는 client(앱 탭)에 재구독 요청 postMessage.
//   client 가 없으면 다음 앱 로드 시 push.ts 의 24h 자동 재구독이 처리 (이중 안전망).
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil((async () => {
    try {
      const cs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const c of cs) c.postMessage({ type: 'planq:resubscribe-needed' });
    } catch (e) { /* silent */ }
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  // ★ 2026-06-15: update() 를 navigate 완료 후로 이동 (먼저 호출 시 SW terminate 로 navigate 실패 가능).
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
      await self.clients.openWindow(fullUrl);
    }
    // ★ self.registration.update() 제거 — SW 전환 부작용 차단. 갱신은 BuildVersionGuard 담당.
  })());
});
