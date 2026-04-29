// PlanQ Service Worker — Web Push 수신 + 알림 클릭 처리.
// payload 형식: { title, body, link?, tag?, icon? }

self.addEventListener('install', (event) => {
  // 즉시 활성화 (대기 안 함)
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
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
    data: { link: payload.link || '/' },
    requireInteraction: false,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const link = event.notification.data?.link || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // 이미 열린 창 있으면 포커스 + 이동
      for (const c of clientList) {
        if (c.url && 'focus' in c) {
          c.navigate(link);
          return c.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(link);
    })
  );
});
