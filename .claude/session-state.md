# PlanQ 개발 세션 상태

## 현재 작업 상태
**마지막 업데이트:** 2026-05-13
**작업 상태:** 완료 — v1.7.3 운영 라이브 (사이클 N+12 + 후속 fix)
**버전:** v1.7.3 (commits `e7e8420` + `78e38a8` + `793a896` + `ccc5d02` + `d6e696f` + `8867807` — 102s + 93s + 93s deploy)

### N+12 후속 fix (사용자 보고 3건)
- **알림 클릭 chunk 에러 자동 복구** (`d6e696f`) — ErrorBoundary 의 reset() 가 chunk error 였으면 location.reload() + SW update. 60초 자동 가드 reload 도 SW update 함께
- **채팅방 진입 스크롤 즉시화** (`d6e696f`) — scrollToBottom 의 RAF×2 지연 제거. useLayoutEffect commit 직후 즉시 scrollIntoView. "위에 갔다 옴" 회귀 차단
- **sw.js push/notificationclick 시점 self.registration.update()** (`8867807`) — 알림 도착·클릭 자체가 새 SW install→activate 트리거. PWA 자동 갱신
- **sw.js badge 진단** (`d6e696f`) — setAppBadge 결과를 client message 로 post. 모바일 디바이스에서 콘솔 진단 가능

### 사이클 N+12 핵심
1. **채팅 푸시 복원** (e7e8420) — EVENT_KINDS 'message' 매트릭스 노출, badge 계산 1.5s timeout, POST /subscribe 입력 검증 + 좀비 sub 자동 unsubscribe→재구독
2. **재진입 메시지 회복** (e7e8420) — QTalkPage useVisibilityRefresh 가 직접 listConversationMessages 호출 + setMessages 교체
3. **입력란 초기 높이** (e7e8420) — ChatPanel auto-resize useEffect → useLayoutEffect + raf 재측정
4. **사이드바 2-step** (e7e8420) — 모바일 통계·분석/설정 NavItem 첫 클릭 펼침, 두 번째 이동
5. **Q Task 격주 반복 저장 fix** (78e38a8 lua) — setTimeout 대신 saveRule({preset:p}) 새 값 직접 전달
6. **Q Task 반복 권한 UX** (78e38a8 lua) — canEditRecurrence 없으면 disabled + 읽기 전용 힌트
7. **push backend desync 자동 복구** (793a896) — GET /api/push/me + backendHasMatchingSub. autoSubscribeIfPossible/syncPermissionOnFocus 모두 granted 상태에서 미스매치 시 자동 재구독. **N+12 회귀 핵심: dev PushLog 7d total=17 sent=0 skipped=12("no_subs") 원인이 좀비 cleanup 후 desync 였음**
8. **외부 발송 입력 검증 + 실패율 모니터링** (78e38a8 lua) — push_service maybeAlertOnFailure (5분 3회 실패 platform_admin email), health-check PushLog 24h 실패율 < 50%
9. **visibility refresh = server fresh 덮어쓰기** (78e38a8 lua) — QTalkPage setConversations(all) 로 stale unread/last_message_at 회귀 차단
10. **health-check PushLog 항목 fix** (ccc5d02) — child_process 분리 + dotenvx prefix 처리

### 검증
- 빌드 937ms, TS 에러 0
- 헬스체크 27/28 PASS (1 fail = pm2 명령 권한 환경 차이, 실제 서비스 online 확인)
- API 8/8 PASS — 401 격리 / VAPID / rate-limit 5-per-min / p256dh 검증 / endpoint whitelist
- 실 채팅 push 발송 검증: u=15 → conv 97 → irene, PushLog **sent code=201 sub_id=9** ✅
- 운영 https://planq.kr/api/health 200, planq-prod-backend v1.7.2 online

---

## 진행 중인 작업
- 없음

---

## 완료된 작업 (이번 세션)

### Q Task 반복 설정 버그 fix 3건

1. **격주 반복 저장 안 되는 버그 fix** — `setRecurPreset(p)` 후 `setTimeout(saveRule, 0)` 호출 시 React state가 아직 업데이트 안 된 이전 값('weekly')으로 RRULE 빌드. `buildRecurRule`과 `saveRule`에 `overrides` 파라미터 추가해서 새 값을 직접 전달.

2. **반복 설정 RRULE 파싱 누락 fix** — 상세 진입 시 `setRecurEnabled(true)`만 호출하고 preset/endType 복원 안 함. `parseRRule()` 사용해서 전체 state 복원.

3. **반복 설정 권한 체크 UX 개선** — 담당자(작성자 아닌 경우)는 `recurrence_rule` 수정 권한이 없는데 UI에서 편집 가능하게 보이고 저장 시 403 에러 발생. `canEditRecurrence` 권한 체크 추가 + disabled UI + "읽기 전용" 힌트.

### 수정 파일
- `dev-frontend/src/components/QTask/TaskDetailDrawer.tsx`

---

## 다음 할 일

1. **운영 GDrive 연결 fix** (irene 직접 진행 필요)
   - Google Console에서 OAuth client에 `https://planq.kr` 리디렉션 URI 추가
   - 운영 `.env`에 `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` 실값 교체
   - `pm2 restart planq-prod-backend`

2. **청크 5 (visibility 배지 카드/행 적용 + 5중 시각 시그널)**

3. **DocsTab 카드 hover share 아이콘**

---

## 환경변수 / 인증 현황
- SMTP 5개 dev/prod populated
- DEEPGRAM 양쪽 EMPTY
- **GOOGLE_CLIENT_ID/SECRET — dev 정상 / 운영 placeholder ★ irene fix 필요**
- JWT_SECRET dev/prod 분리
- platform_admin: irene@irenecompany.com (dev), irene@irenewp.com (prod)
- .env 권한 640

---

## 주요 문서 위치
- 권한 매트릭스: `/opt/planq/docs/PERMISSION_MATRIX.md`
- 4단계 visibility: `/opt/planq/docs/VISIBILITY_VOCABULARY.md`
- 개인 보관함 설계: `/opt/planq/docs/PERSONAL_VAULT_DESIGN.md`
- 개발 로드맵: `/opt/planq/DEVELOPMENT_PLAN.md`

---

## 복구 가이드

새 Claude 세션 시작 시 아래 내용을 붙여넣으세요:

```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```
