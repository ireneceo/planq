# PlanQ 개발 세션 상태

## 현재 작업 상태
**마지막 업데이트:** 2026-05-13
**작업 상태:** 완료 — v1.7.3 운영 라이브 (사이클 N+12 + 후속 fix)
**버전:** v1.7.3 (commits `e7e8420` + `78e38a8` + `793a896` + `ccc5d02` + `d6e696f` + `8867807` + `c96d515` — 102s + 93s + 93s + 38s deploy)

### 사이클 N+12 + 후속 핵심 (7건)

1. **채팅 푸시 복원** (e7e8420) — EVENT_KINDS 'message' 매트릭스 노출, badge 계산 1.5s AbortController timeout, POST /subscribe p256dh ≥ 80 + auth ≥ 8 검증 + frontend 좀비 자동 unsubscribe→재구독
2. **재진입 메시지 회복** (e7e8420) — QTalkPage useVisibilityRefresh 가 직접 listConversationMessages 호출 + setMessages 교체
3. **Q Task 격주 반복 저장 + 권한 UX** (78e38a8 lua) — buildRecurRule overrides 파라미터 + canEditRecurrence 분기
4. **push backend desync 자동 복구** (793a896) — GET /api/push/me + backendHasMatchingSub. autoSubscribeIfPossible/syncPermissionOnFocus 둘 다 granted 상태에서 미스매치 시 자동 재구독. 네트워크 에러 시 보수적으로 matched=true (무한 루프 방지). **N+12 회귀 핵심: dev PushLog 7d total=17 sent=0 skipped=12("no_subs") 원인이 좀비 cleanup 후 desync 였음**
5. **알림 클릭 chunk 에러 자동 복구** (d6e696f) — ErrorBoundary reset() 가 chunk error 였으면 location.reload() + SW update. 60초 자동 가드 reload 도 SW update 함께
6. **채팅방 진입 스크롤 즉시화** (d6e696f) — scrollToBottom 의 RAF×2 지연 제거. useLayoutEffect commit 직후 즉시 scrollIntoView. "위에 갔다 옴" 회귀 차단
7. **sw.js push/notificationclick 자가 update** (8867807) — `self.registration.update()` 호출. PWA wake-up 자체가 새 SW install→activate 트리거. 사용자 재시작 불필요

### 검증
- 빌드 0.93~1.05s, TS 에러 0
- 헬스체크 27/28 PASS (1 fail = pm2 권한 환경 차이, 실제 서비스 online)
- API 8/8 PASS — 401 격리 / VAPID / rate-limit 5-per-min / p256dh 검증 / endpoint whitelist
- 실 채팅 검증 (dev): u=15 → conv 97 → irene, PushLog sent code=201 sub_id=9 ✅
- 실 채팅 검증 (운영): lua u=3 → conv 10 → irene u=1, **3 디바이스 모두 sent code=201** ✅
- 운영 https://planq.kr/api/health 200, planq-prod-backend v1.7.3 online

### 메모리 박제 (이번 세션 신규)
- `feedback_pwa_sw_self_update.md` — sw.js push/notificationclick 시점 self.registration.update() 자가 점검. 옛 SW + 새 빌드 desync 자동 회복

### CLAUDE.md 박제 (이번 세션 신규)
- §8 외부 발송 입력 검증 + 실패율 모니터링 (78e38a8)
- §9 visibility/focus 복원 = server fresh 덮어쓰기 (78e38a8)
- §10 sw.js 자가 update — push/notificationclick 시점 (8867807)
- §11 lazy() chunk 미스매치 자동 복구 강화 (d6e696f)
- §12 useLayoutEffect 안의 layout 측정은 즉시, RAF 지연 금지 (d6e696f)
- 검증 시나리오: 채팅·알림 4 시나리오 (78e38a8)

---

## 진행 중인 작업
- 없음

---

## 다음 진입 ★ (2026-05-14 또는 다음 세션)

### 최우선: 운영 GDrive 연결 fix (irene 직접 진행 필요)

**증상:** 운영서버(https://planq.kr) 에서 Google Drive 연결 오류 계속. dev (https://dev.planq.kr) 는 정상.

**원인 (진단 완료):** 운영 `.env` 의 GOOGLE OAuth credentials 가 example placeholder 그대로.

**해결 절차:**

1. **Google Cloud Console** (https://console.cloud.google.com/apis/credentials)
   - dev 에서 쓰는 OAuth client 선택
   - 승인된 리디렉션 URI 에 `https://planq.kr/api/cloud/callback/gdrive` 추가
   - 승인된 JavaScript 원본 에 `https://planq.kr` 추가
2. **운영 .env 두 줄 교체** (`/opt/planq/backend/.env`):
   ```
   GOOGLE_CLIENT_ID=<dev .env 실값>
   GOOGLE_CLIENT_SECRET=<dev .env 실값>
   ```
3. **운영 재시작:**
   ```bash
   ssh irene@87.106.78.146 "pm2 restart planq-prod-backend"
   pm2 logs planq-prod-backend --lines 20
   ```
4. **검증:** https://planq.kr 에서 Drive 연결 재시도 → OAuth 동의 화면 정상 노출 → 파일 업로드 1회 테스트.

### 사용자 디바이스 검증 후속 (오늘 작업 결과)

v1.7.3 배포 후 사용자 모바일 PWA 1회 재시작 필요 (이번 1회만 — 다음부터 sw.js 자가 update).

검증 항목:
1. 알림 도착 후 클릭 → 채팅방 정상 진입 (옛 "Something went wrong" 안 뜨는지)
2. 채팅방 진입 시 마지막 위치로 즉시 (위로 갔다 오는 회귀 해소)
3. 앱 아이콘 badge 숫자 — 어느 디바이스에서 표시되는지 / 안 되면 `badgeDiag` 콘솔 출력 진단

---

## 차순위 (GDrive fix 끝난 후)

- 청크 5 (visibility 배지 카드/행 적용 + 5중 시각 시그널)
- DocsTab 카드 hover share 아이콘
- 동적 OG (backend SSR + nginx /public/* proxy)
- Q note 텍스트 type + Quick Capture
- Custom SMTP (Pro+)
- 설문 기능 MVP (4 사이클)

---

## 환경변수 / 인증 현황

- SMTP 5개 dev/prod populated
- DEEPGRAM 양쪽 EMPTY
- **GOOGLE_CLIENT_ID/SECRET — dev 정상 / 운영 placeholder ★ fix 필요**
- VAPID — dev/prod 둘 다 configured
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
