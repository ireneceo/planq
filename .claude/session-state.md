# PlanQ 개발 세션 상태

## 현재 작업 상태
**마지막 업데이트:** 2026-05-12
**작업 상태:** 완료 — v1.7.0 운영 라이브 (사이클 N+10)
**버전:** v1.7.0 (commits `5807d2f` 181s + `da62196` 49s hotfix + `ec85423` 47s 버전 bump)

---

## 진행 중인 작업
- 없음

---

## 완료된 작업 (이번 세션 — 사이클 N+10)

### 메인 (commit 5807d2f, 181s)

**사용자 보고 4건 + 추가 4건 fix + 캘린더 click fix:**

1. **활성 conv unread 차단** — LeftPanel `isActive` 체크로 시각 차단 + socket message:new 시 활성이면 즉시 markConversationRead 호출 → 백엔드 last_read_at 갱신 → 다음 GET 응답도 0
2. **refresh_tokens.client_kind ENUM('pwa','web')** — PWA standalone=365일 / web=30일 sliding renewal. login/register/refresh 모두 X-Client-Kind 헤더 + body 자동 전달. JWT expiresIn + cookie maxAge 동기. 로그인 라벨 "(7일)" 제거
3. **핀 토글 socket emit** — `io.to(\`user:${userId}\`).emit('conversation:pin', ...)`. 프론트 listener 추가. server.js connection 시 `user:N` room 자동 join (다중 디바이스 동기화 인프라)
4. **보관함 시스템** — `GET /:bizId/archived` + `POST /:bizId/:id/unarchive` + `DELETE /:bizId/:id` 3 라우트 + `ArchivedChatsModal.tsx` 신규 + `LeftPanel` 풋터 진입점 (workspace admin only) + `Conversation.archivedBy` User association
5. **LoginPage 100dvh 모바일 풀스크린** — `100vh → 100dvh` (iOS Safari toolbar 보정) + 모바일 box-shadow/radius 제거 풀스크린 + LeftSection 축소 + RightSection 자체 스크롤 + `safe-area-inset-bottom`
6. **CalendarPicker createPortal stopPropagation** — React synthetic event 가 virtual DOM tree 따라 bubble 하던 함정. Wrapper 에 `onClick + onMouseDown` stopPropagation. **10 호출처 일괄 해결** (DateRangeCell, NewEventModal, ProjectTaskList, AdminBusinessesPage, NewProjectModal, SingleDateField, CandidateEditCard, TaskDetailDrawer 등)
7. **i18n 풀세트** — `qtalk.archived.*` 21 key + `qtalk.left.viewArchived` + `qtalk.left.menu.archive` 라벨 "보관함으로 옮기기" 로 명확화 (ko/en)

### Hotfix (commit da62196, 49s)
- 보관함 라우트 순서 충돌 fix — `/:businessId/archived` 가 `/:businessId/:id` 뒤에 정의되어 Express 가 `id="archived"` 로 매칭 → conversation lookup 404. 라우트를 `/:businessId/:id` 앞으로 이동
- **메모리 박제: [[feedback-express-route-order]]**

### 버전 bump (commit ec85423, 47s)
- 1.6.1 → 1.7.0 minor (사용자 노출 큰 변경 묶음)
- DEVELOPMENT_PLAN.md + session-state.md + package.json (backend + frontend)
- 한/영 릴리즈노트 출력 (Q Talk 보관함 / 모바일 PWA 365일 / 즐겨찾기 동기화 / 활성 conv unread / 모바일 로그인 / Q Task 캘린더)

### 검증
- 헬스체크 27/27 PASS (PM2 instance 재등록 후)
- 빌드 1.6 ~ 3.25s (3회), TS 에러 0
- 외부 https://planq.kr/api/health 200, planq-prod-backend v1.7.0

---

## 메모리 박제 (이번 세션)

- `feedback_react_portal_bubble.md` (신규) — React createPortal 자식 이벤트가 virtual DOM tree 따라 bubble. Wrapper 에 stopPropagation 필수
- `feedback_express_route_order.md` (신규) — Express 정의 순서 매칭 함정. literal route 는 param route 앞에
- 기존 `project_multi_device_session.md` 는 별도 업데이트 불요 (CLAUDE.md 인라인 노트에 client_kind TTL 정책 추가됨)

---

## 다음 할 일

DEVELOPMENT_PLAN 차순위:

### 즉시 진입 가능
- **⋮ 메뉴 "00" 정체** — 사용자 새 v1.7.0 받으면 자연 해소 가능성 (옛 build SW 캐시). 그래도 모바일 실측 후 결과 봐서 진행
- **청크 5 (visibility 배지 카드/행 적용 + 5중 시각 시그널)** — lua 모바일 반응형 commit 2b64012 정리 완료. 이제 시작 가능. Q file `DocsTab`, Q docs `PostsPage`, Q info 카드 + VisibilityChangeModal 진입점 + 5중 시그널

### 차순위
- Q note 텍스트 type + Quick Capture (중)
- Custom SMTP (Pro+) (소)
- 설문 기능 MVP (4 사이클, docs 완료)
- AI 사용량 세분화 + Task AI 예측·번역 recordUsage 통합
- Signature 알림 통일

---

## 환경변수 / 인증 현황
- SMTP 5개 dev/prod populated
- DEEPGRAM 양쪽 EMPTY
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
