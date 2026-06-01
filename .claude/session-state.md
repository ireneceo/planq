# PlanQ 세션 상태

**마지막 업데이트:** 2026-06-01 (사이클 N+76 외부 연동 Phase 2-4 — dev 검증 완료, 미커밋·미배포)
**작업 상태:** dev 구현+검증 완료. 커밋 대기(/개발완료) + 운영 배포 대기(Irene /배포). 직전 라이브 v1.22.0 (`6b52029`)

---

## 🚧 사이클 N+76 — 외부 연동 팀/개인 Phase 2-4 (개인 GCal·Drive·Gmail)

**계기:** 사용자 "외부연동 팀/개인 정리 우선 아니었어? 다 했어?" → Phase 1(틀)만 됐고 Phase 2-4(개인 실연결)는 placeholder 였음 → 이번 사이클 실연결.

**완료 (dev 검증):**
- **Chunk 1** 개인 OAuth 공통 — `services/personalOauth.js` + `routes/external_connections.js` initiate/callback (단일 redirect URI, provider state 분기). 검증 13/13
- **Phase 2** 개인 GCal overlay — `personalCalendar.js` + `GET /me/calendar/events` + QCalendarPage violet 토글 + ProfileIntegrations 연결버튼
- **Phase 4** 개인 GDrive — `personalDrive.js` + `GET /me/drive/files` + QFilePage 탭 분리 + PersonalDriveTab. 검증 4/4
- **Phase 3** 개인 Gmail — `email_accounts.owner_user_id` 컬럼(ALTER 완료) + 기존 cron 무변경 자동수집 + **프라이버시 격리**(accessibleAccountIds, list/detail/mark/reply 전부) + MailPage 회사/개인 폴더 그룹. **격리 검증 9/9**
- 빌드 3회 exit 0, SPA 4페이지 200, gmail initiate scope OK

**남은 것 (E2E 완결 위해 Irene 액션 필요):**
1. **Google Cloud Console** 에 redirect URI 추가 등록: `https://dev.planq.kr/api/me/oauth/google/callback` (운영도 `https://planq.kr/...`)
2. 실제 Google 동의 클릭으로 개인 캘린더/Drive/Gmail 연결 → overlay·파일·메일 도착 최종 확인
3. `/개발완료` 로 커밋 + `/배포` 로 운영 반영

**후순위:** Microsoft(Phase 5), 옛 모델→external_connections 마이그레이션(Phase 6-7)

---

## (이전) 사이클 N+75 완료 — v1.22.0 운영 라이브 (commit `6b52029`)

---

## ⚡ 빠른 재개

새 세션 시작 시:
```
session-state.md 읽고 이어서 개발해.
```

---

## 완료된 작업 (사이클 N+71~N+72-6, 8 commit)

| commit | 사이클 | 내용 |
|---|---|---|
| `b0aa7d9` | N+71 | Q Talk 리스트 unread 실시간 회귀 fix (business room broadcast + join:business) |
| `20c22c2` | N+72 Phase 1 | 외부 연동 통합 모델 + ProfileIntegrationsPage |
| `0a92d36` | N+72 시급 3건 | 문서 실시간 + 공유권한 UI + L4 권한 회귀 |
| `b491416` | N+72-2 | PostsPage L2-members 멤버 안 보임 fix |
| `eae15bb` | N+72-3 | 권한 전수 검사 + Cue 멤버 제외 4곳 일괄 |
| `94c4dcc` | N+72-4 | Q docs default L3 + 리스트 vlevel chip + Public 외부뷰 + 아이콘 텍스트화 |
| `821a8a0` | N+72-5 | Q info RichEditor + 카테고리 트리 sticky top:0 |
| `028f9ef` | N+72-6 | 알림 통합 (전 워크스페이스 합산 + 실시간 + 워크스페이스 selector dot) |

운영 배포: 121s, https://planq.kr/api/health 200 ✓

---

## 다음 사이클 (N+75+) — 우선순위 순

### 🥇 1순위 — Q Mail M3 답장 / 라벨 / 할당 / AI 답변

- 답장 (Tiptap RichEditor + AttachmentField + SMTP 전송)
- 라벨 / 스타 / 할당 (assignee_user_id) / 팔로우
- AI 답변 제안 (Cue 통합 — KbDocument 참조 FAQ)
- email_threads.js mutation 라우트 socket broadcast 추가 (M2 read-only 라 0)

### 🥈 2순위 — 외부 연동 Phase 2-4 (개인 자산)

- Phase 2: 개인 GCal (owner_scope='user')
- Phase 3: 개인 Gmail (owner_scope='user', XOAUTH2)
- Phase 4: 개인 Drive (owner_scope='user', drive.file scope)
- ProfileIntegrationsPage 의 Phase 2-4 placeholder → 실 UI

### 🥉 3순위 — FAQ 자동 클러스터링 (Q Mail M4)

- email_faq_suggestions 라우트 (Q_MAIL_SPEC §3.6)
- 사용자가 자주 답하는 패턴 → KbDocument 자동 등록 제안

### 4순위 — 기타

- Settings → "Google 로그인 연결/해제" UI (backend API 존재)
- Microsoft OAuth (Task B/D) — 한국 시장 후순위
- Q Mail M3 — 답글/전송/Draft (SMTP)
- AdminAuditLogs 보강 후속

---

## ✅ N+74 완료된 항목 (참조용)
- 외부 공유 팀(L2) target_member_ids — files/posts 양쪽
- canAccessFile/Post L2-members JSON_CONTAINS 분기
- shareExpiryNotify D-3 자동 알림 cron
- shareTokenCleanup 6 자산 확장
- share_expiry event_kind 신규 + NotificationPref 매트릭스 등록
- 알림 deep link 절대 URL → path 정규화 (운영 42건 backfill)

---

## 환경

- dev: dev.planq.kr / 87.106.11.184 / port 3003
- prod: **planq.kr / 87.106.78.146 / port 3004** (v1.21.0 라이브)
- DB: planq_dev_db (dev) / planq_admin (prod)
- PM2: planq-dev-backend / planq-qnote (dev) · planq-prod-backend / planq-prod-qnote (prod)

---

## 핵심 메모리 신규 박제

- `project_unread_unified_arch.md` — 알림 통합 패턴 (단일 endpoint + 모듈 캐시 hook + 4 트리거)
- `project_external_connections_owner_scope.md` — 외부 연동 owner_scope ENUM

---

## 복구 가이드

```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```
