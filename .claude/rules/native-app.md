---
paths:
  - "dev-frontend/ios/**"
  - "dev-frontend/android/**"
  - "dev-frontend/capacitor.config.ts"
  - "dev-frontend/src/components/NativeBridge.tsx"
  - "dev-frontend/src/stores/tabStore.ts"
  - "dev-frontend/public/**"
  - "scripts/cap-offline-fallback.js"
  - "scripts/*-beta-check.js"
---

<!-- CLAUDE.md 에서 옮긴 규칙 (2026-10-23). 이 경로의 파일을 읽거나 고칠 때 자동으로 실린다. 문장은 옮기기만 했다. -->
# 네이티브 앱(Capacitor) — 딥링크·오프라인 화면

## 네이티브 앱은 **우리 JS 가 돌기 전에** 죽을 수 있다 (2026-09-14 박제)

> Irene: *"모바일에서 알림이오면 눌러서 갈 수가 없어 커넥션 문제라고 나와 모든 알림 다."*
> (아이폰 앱·안드로이드 앱 **양쪽**. 웹/PWA 는 이 경로를 안 타서 멀쩡했다.)

앱은 원격 껍데기(`server.url`)다. 그래서 **메인 프레임 로드가 실패하는 순간 우리 코드가 사라진다** —
Capacitor 가 `errorPath`(번들 안 로컬 파일)로 갈아끼우기 때문이다. 그 화면에서는 크래시 리포트도
안 올라오고 소켓도 없다. **앱 신고인데 서버 로그가 조용하면 이 계열을 먼저 의심한다.**

1. **딥링크는 문서를 다시 로드하지 않는다.** `NativeBridge.deepLinkNav` 는 SPA 이동을 2.4초 기다리고,
   그래도 못 가면 **한 번만** 절대 URL 로 간다. 앱이 뜨는 중에 메인 프레임을 다시 로드하면
   그 자체가 오프라인 화면으로 가는 길이다.
   - **상대경로로 이동하지 않는다** — 이미 오프라인 화면(로컬 스킴)에 있으면 자기 자신으로 돈다.
2. **이동을 조용히 버리지 않는다.** `tabStore` 미러 분기는 통로(`navigateDelegate`)가 없으면
   **보류했다가** `setTabNavigator` 가 붙을 때 보낸다(TTL 15초). 앱 콜드 스타트가 바로 그 순간이다.
3. **오프라인 화면에서 서버로 돌아갈 수 있어야 한다.** `location.reload()` 는 **로컬 파일을 다시 읽을
   뿐**이라 거기서 못 나온다. 절대 서버 URL 로 나가고, 연결 복귀·앱이 앞으로 나온 순간 자동 복귀한다
   (최소 간격 8초 — 서버가 죽어 있을 때 무한 로드 루프가 되지 않게).
   그 URL 은 **손으로 적지 않는다** — `node scripts/cap-offline-fallback.js` 가 플랫폼
   `capacitor.config.json` 의 `server.url` 에서 박고, `--check` 가 어긋나면 실패한다
   (`{ios,android}-beta-check.js` 에 물려 있다).
4. **앱 번들 안의 것은 웹 배포로 안 간다.** 위 3번은 새 앱 빌드(`npm run cap:beta` /
   `cap:beta:android`)가 있어야 사용자 폰에 도달한다. 1·2 만 웹 배포로 반영된다 —
   **보고할 때 이 구분을 적는다.**
5. **생성물이 소스보다 오래됐는지 본다.** 2026-09-14 실측 — iOS 생성물이 8/25 자라
   `presentationOptions` 가 빈 배열이었다. 그대로 아카이브하면 dev 서버를 가리키고
   8/27 에 고친 "포그라운드도 OS 배너" 가 되돌아간다. beta-check 가 경고한다.

회귀: `node scripts/e2e/run.js --suite pushdeeplink` — 콜드스타트 딥링크가 **문서 로드 없이** 닿는가 ·
폴백이 여전히 살아 있는가(양성 대조군) · 오프라인 화면이 서버로 나가는가 · 옛 `reload` 는 못 나간다(음성 대조군).

---

