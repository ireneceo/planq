// 링크를 누르면 «앱이 깔려 있으면 앱으로» 열리는 경로 — iOS AASA 와 안드로이드 App Links 의 **단일 정본** (2026-10-09).
//
// 기준: 로그인해서 쓰는 앱 화면(MainLayout 라우트 = src/routes/appRoutes.tsx)만 넣는다.
//   넣지 않는 것 — 로그인 없이 웹으로 봐야 하는 표면: 랜딩·요금·위키(/, /pricing, /guide …) · 로그인/가입/초대
//   (/login, /register, /invite) · 공개 공유·서명·설문·게스트(/public, /sign, /g, /survey) · AI 연결 동의(/connect) ·
//   앱 내부 전용(/share-receive). 앱을 깐 사람이 고객에게 보낸 공유 링크를 눌러도 브라우저 미리보기로 열려야 한다.
// 접두어로 맞춘다(AASA `"/x*"` = 안드로이드 `pathPrefix="/x"`). 다른 경로의 앞부분이 되는 접두어는 `/` 로 끝낸다
//   (`/me` 는 `/memo` 를 삼킨다 → `/me/`).
// 고치면 `node scripts/cap-link-domains.js` 로 AASA·AndroidManifest 를 다시 쓴다. 안드로이드는 새 Play 빌드가 있어야 폰에 닿는다.
module.exports = {
  exact: ['/oauth/native-return'],
  prefixes: [
    '/inbox', '/notifications', '/dashboard', '/home',
    '/talk', '/task', '/projects', '/docs', '/notes', '/calendar', '/mail', '/files', '/info',
    '/bills', '/sale', '/signatures', '/attendance', '/stats', '/whats-new', '/personal-vault',
    '/business/', '/settings', '/profile', '/me/', '/admin',
  ],
};
