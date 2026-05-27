# PlanQ 세션 상태

**마지막 업데이트:** 2026-05-27 07:05 (사이클 N+74 A/B/C/D 완료)
**작업 상태:** 완료 — v1.21.0 운영 라이브 (commit `468fcda` + 운영 backfill 42건)

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

### 🥇 1순위 — 명칭 통일 후속 (N+72-7 에서 Q docs 만 처리됨)

- "공유 범위" → "공개" — Q file / Q info / Q calendar / Q task 4 자산 동일 적용
- VisibilityBadge fullLabel 통일 ("워크스페이스 공개" 등)
- 사용자 일관성 호소 (N+72-7 박제) 후속 작업

### 🥈 2순위 — Q Mail M2 인박스 read-only UI

- MailPage 3컬럼 (계정·폴더·스레드 / 스레드 리스트 / 스레드 본문)
- MailThreadList — pagination + filter (읽음/안읽음/답변필요/스팸)
- MailThreadDetail — iframe sandbox (HTML 보안 격리) + 첨부 다운로드 + 답글 placeholder
- 인박스(/inbox) 의 Q Mail 카드 통합

### 🥉 3순위 — 외부 연동 Phase 2-4 (개인 자산)

- Phase 2: 개인 GCal (owner_scope='user')
- Phase 3: 개인 Gmail (owner_scope='user', XOAUTH2)
- Phase 4: 개인 Drive (owner_scope='user', drive.file scope)
- ProfileIntegrationsPage 의 Phase 2-4 placeholder → 실 UI

### 4순위 — 빌드 메모리 8GB 옵션 deploy 스크립트 박제

- N+74 배포 시 4GB OOM Kill → 수동 8GB 빌드 + rsync + restart 복구
- scripts/deploy-planq.sh 에 NODE_OPTIONS='--max-old-space-size=8192' 환경변수 옵션 추가
- 또는 deploy 시 시스템 메모리 확인 후 자동 설정

### 5순위 — 기타

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
