---
paths:
  - "dev-backend/routes/**"
  - "dev-backend/services/**"
  - "dev-backend/middleware/**"
---

<!-- CLAUDE.md 에서 옮긴 규칙 (2026-10-23). 이 경로의 파일을 읽거나 고칠 때 자동으로 실린다. 문장은 옮기기만 했다. -->
# 운영 안정성 — 서버 쪽(비용 한도·외부 발송·알림 트리거·푸시)

> - **보안 .env 권한 600 → 640** — planq 그룹 (irene + lua) read 허용. lua PM2 환경변수 정상 로드. q-note/.env 도 강화
## 운영 안정성 규칙 (사이클 N+3 박제)

외부 점검에서 도출된 7가지 — 신규 코드 작성 시 처음부터 적용. 같은 계열 회귀 차단.

1. **Rate-limit (외부 quota·비용 라우트)** — push/email/sms/llm 처럼 외부 quota 또는 비용을 발생시키는 라우트는 **per-user rate-limit 필수**. `keyGenerator: req => 'name-' + req.user.id` 로 IP NAT 우회. 예: `/api/push/test` 분당 5회. 정책 누락 시 사용자 1명이 quota 폭주 가능. **공유 헬퍼 `middleware/costGuard.js`** 사용 강제: `perUserLimiter`/`perUserDaily`(분+일 이중 윈도우)/`capText`(입력 크기 캡). LLM 라우트는 rate-limit + `plan.can('use_cue')` 게이트 + 입력 캡 3종 세트. **함정: `plan.fileSizeLimit`은 존재하지 않는 유령함수** — 파일 업로드는 `plan.can('upload_file', {size, external})` + `BusinessStorageUsage` 집계(files.js 패턴). 신규 첨부/업로드 경로는 쿼터 집계 누락 금지(2026-07-02 비용폭탄 총점검 박제).

4. **외부 endpoint 화이트리스트 (DB 저장 전)** — webhook · push · OAuth callback 등 외부 URL 을 DB 에 저장하는 경우 `new URL(...).protocol === 'https:'` + 알려진 도메인 화이트리스트 검증 필수. 임의 URL 무검증 저장 금지. `routes/push.js:isAllowedEndpoint()` 패턴 재사용.

5. **Sub-resource 재등록 명시 cleanup** — endpoint·token·serial 같은 unique 자원이 다른 user 로 재등록될 때, 옛 row 를 `expired_at = NOW()` 명시 마크 후 신규 row insert. 그냥 update reassign 하면 감사 기록 사라짐. `routes/push.js` POST `/subscribe` 패턴 참조.

6. **외부 발송 = LogTable 처음부터** — push/email/sms 같은 외부 발송은 처음 release 부터 Log 테이블 (user_id, target, status, status_code, error_message, sent_at). 운영 시작 후 추가는 히스토리 없음. PushLog/EmailLog 모델 참조.

8. **외부 발송 입력 검증 + 실패율 모니터링 (사이클 N+12 박제)** — push/email/sms 라우트는 형식 검증 표준:
   - web push: `p256dh.length >= 80` (base64url 65 bytes), `auth.length >= 8`
   - email: RFC 5322 form, sms: E.164
   존재 검사만으로 부족 — 깨진 데이터가 DB 저장되면 발송 시점 silent fail. 동일 user 5분 윈도우 3회 실패 → platform_admin email 알림 (push 채널은 본인이 실패 중일 수 있어 사용 금지). 헬스체크에 24h 실패율 임계치 항목 추가. `services/push_service.js:maybeAlertOnFailure()` 패턴 참조. 박제: `feedback_external_dispatch_validation.md`.

13. **메시지/status 전이 라우트는 notify 호출 강제 (사이클 N+13 박제)** — 새 메시지 발송 라우트, status 전이 라우트, reviewer/assignee 변경 라우트는 **반드시 `routes/notifications.js` 의 `notify` / `notifyMany` 호출 코드 포함**. 누락 시 OS push 영영 0. 사이클 N+13 회귀 실사례: `routes/projects.js POST /conversations/:id/messages` (frontend qtalk.ts sendMessage 호출) + `routes/task_workflow.js` 7 라우트 (ack, submit-review, cancel-review, approve, revision, complete, reviewers POST) 모두 notify 누락 상태였음. 운영 데이터로 PushLog 검증 시 `'테스트 알림' 또는 admin 직접 발송' 만 sent` 패턴이면 trigger 누락 강한 의심. 검증 패턴 — node test 스크립트: login → POST → sleep 3000 → `SELECT FROM push_logs WHERE user_id IN (...) AND created_at >= since` row ≥ 1 확인. 박제: `feedback_notify_trigger_required.md`.

14. **PushSubscription 같은 host 좀비 자동 만료 (사이클 N+13 박제)** — `POST /api/push/subscribe` 시점에 **같은 user 의 같은 push service host (web.push.apple.com / fcm.googleapis.com / ...) 의 다른 active sub 들 자동 `expired_at` 마크**. 한 user × 한 host = active 1개만. 다른 host 는 별개 (Mac Chrome + iPhone Safari 동시 OK). iOS Safari 가 endpoint 갱신 시 옛 sub 가 `expired_at IS NULL` 그대로 → `sendPushToUser` 가 모든 active sub 로 fan-out → Apple push service 가 옛 endpoint silent drop → 사용자 "한 번은 오고 한 번은 안 오는" 변동성 회귀 차단. unique 제약 해소 위해 옛 row 의 `endpoint` 를 `'expired:<id>:<원본>'` 으로 prefix 변경. 박제: `feedback_push_same_host_zombie.md`.

15. **web-push 발송 옵션 — urgency 'high' + TTL 1일 (사이클 N+13 박제)** — `webpush.sendNotification(sub, json, { TTL: 86400, urgency: 'high' })`. urgency 'high' 는 push service 가 즉시 전달 시도 (default 'normal' 보다 빠름, 모바일 도착률 ↑). TTL 86400 = 1일 (default 28일은 너무 길어 stale 알림 도착). topic 옵션은 의도적으로 비활성 — 짧은 시간 다건 메시지가 collapse 되지 않게.

