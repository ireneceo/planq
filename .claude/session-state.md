# PlanQ 개발 세션 상태

## 현재 작업 상태
**마지막 업데이트:** 2026-05-14
**작업 상태:** dev fix 완료 + 검증 PASS — 운영 배포 대기 (사용자 `/배포` 명령 필요)
**버전:** v1.7.3 (dev) — 운영도 v1.7.3 이지만 v1.8.0 으로 bump 후 배포 예정

### 사이클 N+13 — 알림 발송 trigger 누락 회귀 fix

**근본 원인 (운영 진단):**
- `routes/projects.js:551` POST `/conversations/:id/messages` — **notify 호출 0건**. frontend `services/qtalk.ts:394 sendMessage` 가 이 라우트로 발송하는데 push/email 트리거 없음. 운영에서 채팅 push 가 단 한 번도 도달한 적 없음. 5/13 07:27 의 sent 는 lua 가 디바이스 알림 테스트로 직접 발송한 흔적.
- `routes/task_workflow.js` 7 라우트 (ack, submit-review, cancel-review, approve, revision, complete, reviewers POST) — **notify 호출 0건**. 확인요청 보내도 reviewer 알림 0, 수정요청 받아도 담당자 알림 0, 컨펌 완료 후 요청자 알림 0.
- `PushSubscription` 좀비 — 운영 user_id=1 (irene) 의 iPhone iOS 18 web push sub `id=3,4,11` 3개나 active. iOS Safari endpoint 갱신 시 옛 sub 가 `expired_at NULL` 그대로 → silent drop 변동성.

**fix 3 영역 (dev 적용 + 검증 PASS):**

1. **`routes/projects.js`** POST `/conversations/:id/messages` 에 notifyMany 추가 (mention + message). `routes/conversations.js` 패턴 복사. internal 채널은 client 제외, sender 자동 제외, mention 분리.
2. **`routes/task_workflow.js`** 7 라우트 notify 추가:
   - `ack` → 요청자 ("담당자가 요청을 확인했습니다")
   - `submit-review` → reviewers ("업무 검토 요청")
   - `cancel-review` → reviewers ("검토 요청이 취소되었습니다")
   - `approve` → completed 면 요청자 ("요청한 업무 완료"), 아니면 담당자 ("컨펌자가 승인했습니다")
   - `revision` → 담당자 ("업무 수정 요청") + note 본문
   - `complete` → 요청자 ("업무 완료")
   - `reviewers POST` → 새 reviewer ("업무 검토 요청" 또는 "컨펌자로 추가됨")
3. **`services/push_service.js` + `routes/push.js`**:
   - `webpush.sendNotification` 에 `TTL: 86400, urgency: 'high'` 옵션 — 모바일 도착률 ↑
   - `expireSameHostZombies(userId, newEndpoint, keepId)` 헬퍼 — POST `/subscribe` 시점 같은 host 의 옛 active sub 자동 만료. 한 user × 한 host = active 1개.

**검증 (5/5 PASS, node test 스크립트):**
- [1] 채팅 메시지 push trigger — PushLog row `김오너 · notify-test-...` 생성됨 ✓
- [2] submit-review reviewer push ✓
- [3] revision 담당자 push ✓
- [4] approve completed 요청자 push ✓
- [5] same-host 좀비 sub 자동 정리 — 옛 fcm sub 1개 expired ✓

(test 스크립트는 검증 후 삭제, dev DB 데이터 원복 완료)

### 박제 (이번 세션 신규)

- 메모리 `feedback_notify_trigger_required.md` — 메시지/status 전이 라우트 notify 호출 강제 회귀 패턴
- 메모리 `feedback_push_same_host_zombie.md` — PushSubscription 같은 host 좀비 자동 만료
- CLAUDE.md §13 — notify 호출 강제
- CLAUDE.md §14 — 같은 host 좀비 자동 만료
- CLAUDE.md §15 — web-push urgency 'high' + TTL 1일

### 변경 파일

| 파일 | 변경 |
|---|---|
| `routes/projects.js` | POST `/conversations/:id/messages` 에 notifyMany 추가 (mention + message) |
| `routes/task_workflow.js` | 7 라우트 notify 추가 + `notifyTask`/`notifyTaskMany`/`buildTaskLink`/`workspaceName` 헬퍼 |
| `routes/push.js` | `expireSameHostZombies` 헬퍼 + POST `/subscribe` 두 분기에 호출 |
| `services/push_service.js` | `webpush.sendNotification` 에 `TTL: 86400, urgency: 'high'` 추가 |
| `CLAUDE.md` | §13~§15 운영 안정성 신규 |
| `MEMORY.md` + 2 신규 메모리 | 회귀 패턴 박제 |

---

## 다음 진입 ★ 운영 배포

사용자 `/배포` 명령 받으면:

1. version bump v1.7.3 → v1.8.0 (minor — 채팅/업무 알림 정상화 = 의미 있는 기능 회복)
2. commit + push
3. dev/scripts/deploy-planq.sh 실행
4. 운영 https://planq.kr 헬스체크 + 직접 채팅 메시지 1건 보내 PushLog 'sent' 확인
5. **운영 좀비 정리 (별도 한 번)** — 운영 DB 의 옛 active sub 들 직접 expireSameHostZombies 호출. v1.8.0 배포 후 사용자가 디바이스에서 다시 subscribe 하면 자동 정리되지만, 명시적 cleanup 도 안전. 단 일회성이라 운영 데이터 변경은 사용자 승인 후.

---

## 운영 GDrive 연결 fix (이전 세션부터 대기 — irene 직접 진행)

- Google Cloud Console → dev OAuth client 의 redirect URI 에 `https://planq.kr/api/cloud/callback/gdrive` 추가, 원본에 `https://planq.kr` 추가
- 운영 `/opt/planq/backend/.env` 의 `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` 두 줄 실값 교체
- `ssh irene@87.106.78.146 "pm2 restart planq-prod-backend"`
- https://planq.kr 에서 Drive 연결 재시도 검증

---

## 진행 중인 작업
- 없음 (dev fix + 검증 완료)

---

## 차순위 (배포 후)

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

## PM2 운영 현황 (dev)

- **lua PM2** 가 진짜 dev backend (port 3003) 운영 — PID 45523 → 새 코드 reload 후 v1.7.3
- **irene PM2** 의 planq-dev-backend 는 좀비 (21228회 restart 실패) → 이번 세션에서 `pm2 delete` 로 정리
- 코드 변경 시 `sudo -n -u lua pm2 restart planq-dev-backend` 명령으로 reload

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
