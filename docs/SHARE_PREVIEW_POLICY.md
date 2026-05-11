# 공유 미리보기 페이지 — 정책·노출·디자인 매트릭스

> 작성: 2026-05-11 (사이클 N+8 follow-up)
> 대상: `/public/tasks/:token`, `/public/files/:token`, `/public/kb-documents/:token`, `/public/calendar-events/:token`
> 코드: `dev-frontend/src/pages/Public/Public*.tsx` (4 파일) + 백엔드 `/api/.../public/by-token/:token` 라우트군

이 문서는 통합 공유 시스템 (사이클 N+4) 의 공개 미리보기 페이지의 권한·노출·디자인 정책을 정식 박제. 신규 항목 share_token 추가 시 이 매트릭스를 따라 같은 패턴으로 구현.

---

## 1. 권한 4중 정책

| 층 | 컬럼 / 신호 | 동작 |
|---|---|---|
| **① share_token** | UUID per resource (생성 시 발급, 해제 시 NULL) | 토큰 없으면 GET 라우트 자체 404 |
| **② 비밀번호** (옵션) | `share_password_hash` (bcrypt) | `X-Share-Password` 헤더로 검증. 틀리면 401 + `requires_password: true`. SharePasswordPrompt 자동 노출 |
| **③ 만료** (옵션) | `share_expires_at` TIMESTAMP | `IS NULL OR > NOW()` 조건. 만료 시 not_found 응답 (어떤 자원이 있었는지 누설 X) |
| **④ Smart Routing** | `/auth-check` 엔드포인트 + 인증된 사용자 | `canAccess: true` 응답이면 미리보기 페이지에서 0.3초 후 `appUrl` 로 자동 redirect (App-First) |

**암묵 규칙**:
- 토큰 발급 / 해제 / 비번 설정 / 만료 변경 = workspace owner OR resource owner (라우트 별 가드)
- Token 은 1회 발급 후 영속 (해제 전까지). 새 토큰 발급 = 이전 무효
- 만료 변경 시 즉시 반영 (cache 없음)
- 비번 시도 횟수 제한은 현재 미적용 — brute-force 방어 위한 rate-limit 후속 필요 (선택)

---

## 2. 노출 정보 매트릭스 (자원별)

### Task (PublicTaskPage)
| 노출 | 숨김 |
|---|---|
| 워크스페이스명, 제목, 설명, 카테고리 | 댓글 |
| 상태 (status), 진행률 | 첨부 파일 / 문서 링크 |
| 시작일, 마감일 | 예측·실제 시간 (privacy) |
| 담당자 이름, 요청자 이름 | task_estimations 이력 |
| 프로젝트명 (있을 때) | reviewers·이력 |
| 공유 발급 시각 (`shared_at`) | history / audit |

### File (PublicFilePage)
| 노출 | 숨김 |
|---|---|
| 워크스페이스명, 파일명, mime, 사이즈 | 업로더 이메일·내부 메타 |
| 다운로드 버튼 (스트리밍) | 다른 첨부 / 폴더 컨텍스트 |
| 이미지·PDF inline preview | dedup 정보 (content_hash, ref_count) |
| 공유 발급 시각 | |

### KbDocument (PublicKbDocumentPage)
| 노출 | 숨김 |
|---|---|
| 워크스페이스명, 제목, 본문, 원본 mime | KB 인덱싱 정보 |
| source_type, file_name | 임베딩 chunks |
| 공유 발급 시각 | 인덱싱 사용량 |

### CalendarEvent (PublicCalendarEventPage)
| 노출 | 숨김 |
|---|---|
| 워크스페이스명, 제목, 설명 | 참석자 이메일 |
| 시작·종료 시각 (워크스페이스 tz) | 비공개 메모 |
| 장소, online_url | 다른 참석자 응답 상태 |
| 공유 발급 시각 | |

**공통 원칙**:
- **Read-only** — 외부에서 수정 가능 액션 0개
- **개인정보 최소화** — 이메일·전화번호·민감 메모 비공개
- **워크스페이스 격리** — 다른 워크스페이스 자산 노출 0건 (token 만으로 식별)

---

## 3. 레이아웃 표준

**현재 구조** (4 페이지 공통):
```
<Wrap>                  background: #F8FAFC, padding 40 (모바일 16)
  <Card>                max-width 640, border-radius 14, padding 28/32 (모바일 20/16)
    <WorkspaceLabel>    11px / 700 / uppercase / #94A3B8
    <Title>             22px / 700 / #0F172A
    <MetaRow>           StatusPill + chip
    <Section>           본문 (description / preview)
    <Grid>              KV 2-column (모바일 1fr)
    <CTAArea>           [PlanQ 에서 보기 →] / [로그인] [무료 시작]
    <Footer>            "PlanQ — 일이 일이 되지 않게"
  </Card>
</Wrap>
```

**규칙**:
- PageShell 사용 X (공개 페이지 별도 톤 — 사이드바·로그인 UI 노출 부적합)
- COLOR_GUIDE 토큰 준수 (Primary #14B8A6, Text #0F172A/#64748B/#94A3B8 등)
- Card shadow: `0 4px 12px rgba(0,0,0,0.06)` 만 사용 (가벼운 elevation)
- 반응형 분기: 640px (Card padding) + 480px (Grid 1fr)
- Footer 는 PlanQ 브랜드 노출 + 무료 가입 유도

---

## 4. 로그인 후 실페이지 진입 흐름 (Smart Routing)

### 인증된 사용자 (PlanQ 토큰 있음)
```
미리보기 페이지 마운트
  → 1차: GET /api/.../public/by-token/:token (token 으로 자원 조회)
  → 2차: GET /api/.../public/by-token/:token/auth-check (Authorization Bearer)
  → canAccess=true + appUrl 응답
  → 0.3초 후 navigate(appUrl)
```
**잔류**: 600~900ms (첫 fetch + auth-check + 0.3s delay)

### 미인증 사용자
```
미리보기 페이지 노출 + CTA
  → [PlanQ 로그인] 클릭
  → /login?next=/public/tasks/:token
  → 로그인 성공
  → /public/tasks/:token 복귀
  → 위의 인증된 사용자 흐름
```
**잔류**: 추가 600~900ms

### 외부 사용자 (회원가입 의사 없음)
- 미리보기만 보고 종료. CTA "무료로 시작하기" 가 회원가입 유도.

---

## 5. 평가 — 30년차 시각 (2026-05-11)

### 잘 된 점 ✅
1. 권한 4중 일관 적용 — 4 페이지 동일
2. Read-only privacy 정합 — 댓글·시간·이메일 비공개
3. SharePasswordPrompt 공통 컴포넌트로 분리
4. 모바일 반응형
5. Smart Routing 으로 인증 사용자 흐름 자연

### 보강 권장 📋

| # | 항목 | 이유 | 작업량 |
|:-:|---|---|:-:|
| 1 | 공유자 정체성 (sender + workspace 로고 + 보낸 시각) | Trust 강화 — 받는 사람이 누가 보냈는지 즉시 인지 | 1일 |
| 2 | PublicShell 공통 컴포넌트 (4 페이지 통합) | DRY — Wrap/Card 4중복 → 한 곳 수정으로 일관 | 1일 |
| 3 | 로그인 후 1-step redirect (`login?next=appUrl` 직접) | 600ms 깜빡임 제거 — token→id 사전 resolve 또는 login 시 자원 정보 prefetch | 0.5일 |
| 4 | i18n ko/en 풀세트 (STATUS_LABEL_DEFAULTS 등) | 영문 환경에서 한국어 fallback 노출 차단 | 0.5일 |
| 5 | viewed_at 추적 (옵션) | 발송자가 "받는 사람이 봤는지" 확인 가능 | 1일 |
| 6 | OG 메타 태그 (옵션) | SNS·메신저 공유 시 카드 미리보기. SPA 라 별도 OG 엔드포인트 또는 SSR 필요 | 2일 |
| 7 | 만료 알림 cron (옵션) | 발송자에게 D-1 알림 | 1일 |
| 8 | 비번 시도 rate-limit (옵션) | brute-force 방어 — IP 당 분당 5회 | 0.5일 |

**현재 운영 적합** — 즉시 fix 항목 없음. 보강 시 #1~#4 부터.

---

## 6. 신규 자원에 share_token 추가 시 체크리스트

다른 자원 (예: invoice, project, post) 에 공유 기능 추가할 때 이 매트릭스 따라 일관 구현:

- [ ] 모델 4 컬럼: `share_token` (UUID unique) + `shared_at` + `share_password_hash` + `share_expires_at`
- [ ] 백엔드 라우트 3종: `POST /api/.../:id/share` (발급) + `GET /api/.../public/by-token/:token` (공개 조회) + `GET /api/.../public/by-token/:token/auth-check` (Smart Routing)
- [ ] 프론트 페이지: `/public/<자원>/:token` (Public 패턴)
- [ ] 가드: `verifySharePassword` 헬퍼 (`services/share_helper.js`) 사용
- [ ] 노출 매트릭스: 위 §2 패턴 따라 read-only 컬럼만 노출
- [ ] PublicShell 사용 (도입 시) — 4 페이지 일관
- [ ] i18n ko/en 키 풀세트
- [ ] ShareModal 의 entity 옵션에 추가 (사이클 N+4 통합 ShareModal 패턴)

---

## 7. 이력
- 2026-05-08 사이클 N+4: 통합 공유 시스템 1~6차 (signature + 4 자원 + ShareModal + 비번/만료 + 통합 이메일 + 채팅방 카드)
- 2026-05-11 사이클 N+8 follow-up: 정책·노출·디자인 매트릭스 정식 박제 (이 문서)
