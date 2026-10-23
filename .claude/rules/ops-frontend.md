---
paths:
  - "dev-frontend/src/**"
  - "dev-frontend/public/sw.js"
---

<!-- CLAUDE.md 에서 옮긴 규칙 (2026-10-23). 이 경로의 파일을 읽거나 고칠 때 자동으로 실린다. 문장은 옮기기만 했다. -->
# 운영 안정성 — 화면 쪽(자동 새로고침·SW·청크 복구·측정)

2. **PWA 자동 reload 안전** — 새 빌드 감지로 사용자 모르게 reload 시 **입력 도중 데이터 손실 위험**. 정본 가드는 `components/Common/BuildVersionGuard.tsx` 의 `isReloadSafe()`: input/textarea/contentEditable focus + `body.dataset.formDirty='1'` + `[data-form-dirty="1"]` + `body.dataset.pipActive='1'`(핀 PiP) + `body.dataset.recordingActive='1'`(Q Note 녹음) 를 모두 통과한 idle 일 때만 reload, 아니면 **다음 navigation 까지 보류**. 자동 reload 가 다시 들어가는 신규 코드는 같은 가드 재사용. (옛 `version.json` 폴링 + socket `server:build` + `<UpdateBanner>` 토스트 시스템은 사이클 N+3 에 제거됐고 2026-08-14 에 잔존 파일까지 삭제 — 배너로 되돌리려면 새로 만들어야 한다.)

3. **사운드/효과 debounce** — `playPing()` 같은 audio/효과 함수는 짧은 시간 연속 호출 시 중첩 재생 → UX 짜증. 200ms 이내 중복 skip 패턴 (lastTime ref). NotificationToaster.tsx 참조.

7. **Sticky 권한 동기화** — OS/브라우저 권한 OFF (push notification, mic, camera 등) 일 때 backend 의 자원 (구독·토큰·세션) 도 자동 정리. 좀비 endpoint 누적 차단. `services/push.ts:syncPermissionOnFocus()` + `bindPermissionSync()` 패턴 — 페이지 focus 복귀 시 권한 재검사 → denied 면 backend DELETE 자동.

9. **visibility/focus 복원 = server fresh 덮어쓰기 (사이클 N+12 박제)** — `useVisibilityRefresh` 같은 PWA background→foreground 복원 로직에서 list-style 자원 (conv, task, file 등) 은 **server response 전체로 setState 교체**. 신규만 merge 하는 패턴은 stale unread/last_message 회귀 유발. merge 가 정말 필요하면 *왜 server 응답을 무시하는지* 주석 명시. focus 외 `visibilitychange` 도 listen (모바일 PWA focus 발동 보장 없음). 박제: `feedback_visibility_refresh_server_fresh.md`.

10. **sw.js 자가 update — push/notificationclick 시점 (사이클 N+12 후속 박제)** — 옛 SW 가 메모리에 active 인 PWA 에서 새 빌드 떴어도 자동 갱신 안 되는 회귀 차단. `sw.js` 의 `push` handler 와 `notificationclick` handler 시작 부분에 `event.waitUntil(self.registration.update().catch(()=>null))` 호출. PWA wake-up 자체가 SW lifecycle 진행 트리거 — 새 SW 있으면 install→activate. 알림 클릭 시 옛 main bundle 메모리의 옛 chunk hash 가 404 나는 "Importing a module script failed" 회귀의 근본 차단. ErrorBoundary 의 chunk reload 도 SW update 같이 호출 (`Common/ErrorBoundary.tsx`). 박제: `feedback_pwa_sw_self_update.md`.

11. **lazy() chunk 미스매치 자동 복구 강화 (사이클 N+12 후속)** — ErrorBoundary 의 `reset()` 가 chunk error 였으면 단순 state reset 이 아니라 `window.location.reload()` + SW update 강제. 사용자 "다시 시도" 클릭은 60초 자동 가드 무관하게 통과. 자동 reload (componentDidCatch) 도 SW update 동반. 동일 chunk 가 영영 missing 인 무한 reload 만 60초 가드로 막음. SPA 신규 lazy 페이지 추가 시 같은 ErrorBoundary 가 자동 처리.

12. **useLayoutEffect 안의 layout 측정은 즉시, RAF 지연 금지 (사이클 N+12 후속)** — DOM commit 직후 layout phase 라 scrollIntoView/scrollTop 즉시 호출 가능. `requestAnimationFrame x 2` 지연 패턴은 "첫 paint 가 측정 전 위치로 그려진 뒤 2 frame 후 점프" 회귀 유발 — 사용자 입장에서 "위에 갔다 옴". 비동기 콘텐츠 (이미지·번역 박스) 보정만 후속 1 RAF + ResizeObserver 로 별도 처리. ChatPanel `scrollToBottom` 패턴 참조.

