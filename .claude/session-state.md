# PlanQ 세션 상태

**마지막 업데이트:** 2026-05-26 06:58 (사이클 N+71~N+72-6 완료)
**작업 상태:** 완료 — v1.20.0 운영 라이브 (commit `028f9ef`)

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

## 다음 사이클 (N+73+) — 우선순위 순

### 🥇 1순위 — 알림 시스템 동기화 + 클릭 링크 회귀 fix (사용자 호소 2026-05-26)

> "우측 상단 알림 배너랑 좌측 알림종 드롭다운 숫자가 동기화 안 됨. 닫거나 클릭하면 둘 다 읽음 처리되어야"
> "알림 내용 누르면 링크가 다 제대로 안 걸리고 랜딩페이지로 가는데, 우측 상단 배너는 잘 감"

**범위:**
- **(a) 동기화** — 우측 NotificationToaster (in-app 토스터) + 좌측 BellDropdown (알림 종) + OS app badge — 셋 다 단일 source. `useUnreadTotal` 패턴 재사용
- **(b) 닫기/클릭 = 읽음** — 토스터 닫기·드롭다운 클릭 모두 backend `mark-read` 호출 + 옵티미스틱 -1
- **(c) 링크 회귀** — 좌측 종 드롭다운 알림 클릭 시 deep link 누락 (랜딩페이지로 fallback). 우측 토스터의 deep link 로직과 동일하게. `notification.target_url` 또는 `target_type + target_id` 기반 라우팅 표 점검
- 검증 — 알림 7 카테고리 (메시지/업무/문서/파일/일정/청구/서명) 각각 클릭 → 정확한 URL 진입 확인 (drawer URL 싱크 `?task=N` `?post=N` 등)

**관련 코드:**
- `components/Common/NotificationToaster.tsx` (우측 in-app 토스터)
- `components/Common/BellDropdown.tsx` 또는 사이드바 종 (좌측 드롭다운)
- `routes/notifications.js` (backend mark-read + listing)
- `hooks/useUnreadTotal.ts` (N+72-6 박제 — 단일 캐시 패턴 재사용)

### 🥈 2순위 — 외부 공유 = 팀 + 개인 (사용자 강조)

> "외부공유 팀+개인 이게 제일 중요한데"

**범위:**
- visibility L2 (팀 비공개) 공유 — project_members 또는 명시 member 리스트
- visibility L4 (외부) share_token — 만료 + revoke + 7일 미사용 NULL cron 이미 존재
- 통합 ShareModal — Q task / Q file / Q info / Q calendar 4 자산 동일 UX
- 개인 보관함 (L1) — Apple Photos 패턴: Single Source / Multiple Views

**관련 설계 문서:**
- `docs/SHARE_SYSTEM_UNIFIED.md` (project_share_system_unified.md memory)
- `docs/VISIBILITY_VOCABULARY.md` (project_visibility_unified_arch.md memory)
- `docs/PERSONAL_VAULT_DESIGN.md` (project_personal_vault.md memory)
- `docs/SMART_ROUTING_DESIGN.md` (project_smart_routing_appfirst.md memory)

**현재 상태:**
- visibility 4단계 vocab 박제 완료 (L1/L2/L3/L4)
- canAccess L4 회귀 fix 완료 (N+72)
- Q docs default L3 변경 완료 (N+72-4)
- 4 자산 visibility 컬럼 + filter 강제 완료
- N+72 운영 DB `posts.target_member_ids` 컬럼 추가 완료 (N+72-7)
- **남은 작업:** L2 팀 공유 UX 표준화 (target_member_ids selector + Audit) + 통합 ShareModal 컴포넌트 + 외부 share 만료 알림

### 🥉 3순위 — Q Mail M2 인박스 read-only UI

- MailPage 3컬럼 (계정·폴더·스레드 / 스레드 리스트 / 스레드 본문)
- MailThreadList — pagination + filter (읽음/안읽음/답변필요/스팸)
- MailThreadDetail — iframe sandbox (HTML 보안 격리) + 첨부 다운로드 + 답글 placeholder
- 인박스(/inbox) 의 Q Mail 카드 통합

### 4순위 — 외부 연동 Phase 2-4 (개인 자산)

- Phase 2: 개인 GCal (owner_scope='user')
- Phase 3: 개인 Gmail (owner_scope='user', XOAUTH2)
- Phase 4: 개인 Drive (owner_scope='user', drive.file scope)
- ProfileIntegrationsPage 의 Phase 2-4 placeholder → 실 UI

### 5순위 — 명칭 통일 후속 (N+72-7 에서 Q docs 만 처리됨)

- "공유 범위" → "공개" — Q file / Q info / Q calendar / Q task 모두 동일 적용
- VisibilityBadge fullLabel 통일

### 6순위 — 기타

- Settings → "Google 로그인 연결/해제" UI (backend API 존재)
- Microsoft OAuth (Task B/D) — 한국 시장 후순위
- Q Mail M3 — 답글/전송/Draft (SMTP)
- AdminAuditLogs 보강 후속

---

## 환경

- dev: dev.planq.kr / 87.106.11.184 / port 3003
- prod: **planq.kr / 87.106.78.146 / port 3004** (v1.20.0 라이브)
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
