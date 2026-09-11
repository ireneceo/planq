# PlanQ 세션 상태

## 현재 작업 상태
**마지막 업데이트:** 2026-09-11 (Opus 5, 1M)
**작업 상태:** ✅ **운영 배포 완료 `4aa971ef`** (2026-09-11 06:06 UTC, v1.48.21 유지) — Fable PASS ×3

### ⏳ 진행 중 — 워크스페이스 단일 정본 구조화 (Irene 2026-09-11)
> "아무것도 없는 워크스페이스에서 확인필요에 지연 업무 9건·다른 워크스페이스 채팅이 나와" ·
> "팝아웃에서 업무리스트가 워크스페이스 바꾸니까 다 없어졌는데 다시 바꿔도 돌아가지 않아 … 모든 페이지가 하나의 워크스페이스로만 연결되어야지" ·
> **"고치는 걸 왜 자꾸 단편적으로 해? 구조 자체를 … 제대로 적용해서 수정해야지"**
- 1단계 감사 3건 병렬(서브에이전트): ①프론트 워크스페이스 정본·전환·창 전파·팝아웃 결함 원인 ②프론트 API 호출 전수 A/B/C/U 분류 ③서버 범위 기본값·미적용 조회·활성 워크스페이스 표현
- ✅ 감사 3건 완료 → 설계 초안 **`docs/WORKSPACE_SCOPE_DESIGN.md`** (C1 정본=users.active_business_id · C2 apiFetch `X-Workspace-Id` · C3 서버 409 workspace_stale · C4 전환 emit+BroadcastChannel+보류 · C5 서버 기본값 제거 · C6 수집기 WHERE · C7 소켓 클라 필터 · C8 가드 wsscope + e2e)
  - 핵심 사실: 전환은 누른 창만 리로드·전파 0 · 팝아웃은 부팅 때 값만(dev 실측 ws3 44건/ws88 0건) · 프론트 호출 952곳 중 B 7(알림 3 전역) · C 37(프로젝트 상세가 엔티티 워크스페이스로 열림) · 어긋남 버그 2(PostsPage import-from-post, TaskAttachments) · focus/start 멤버십 미검증 · feedback business_id 항상 NULL
- ✅ Fable 설계 게이트 v1 **FAIL**(치명 2: 정본 컬럼 NULL 88명 → 409 루프 · 엔티티 쓰기까지 409 면 보류 창 저장 거부) → **설계 v2** 반영
- ✅ Irene 결정: Q4 **모든 기기 같이** · Q7 **알림 = 현재 워크스페이스만**(+플랫폼 공지, 다른 워크스페이스는 전환기 숫자)
- ✅ **단계 0** `routes/auth.js pickActiveBusinessId` + getUserWithBusiness 자가치유(멱등) — 실HTTP NULL→치유 · 두 번째 무쓰기 · 비멤버 정본 교정
- ✅ **단계 1** 미커밋 선행 수리 흡수 · focus/start 멤버십+업무 소속 · feedback/inquiries 명시값만(프론트 business_id 전송) · push 추측값 저장 중지 · cue_context 개인 캘린더 business_id · TaskAttachments 드로어 워크스페이스 · PostsPage 문서 워크스페이스 · TodoPage 일정 수정/삭제/회의 일정 워크스페이스
  - 신규 가드 `--category=wsscope` 래칫(베이스 11: cue 2·tasks 4·task_templates 2·posts·task_priority·task_tags) · 양성 대조군 +1 FAIL → 원복 md5 동일 → 전체 EXIT 0(45/46)
  - 실HTTP 10/10(원복 0) · health 41/41 · build EXIT 0 · e2e tenant/inboxcount/scopetabs 진행 중
  - feedback·inquiries 는 관리자 알림 발송이 붙어 실HTTP 미실행(코드 확인만)
- ✅ e2e tenant·inboxcount·scopetabs 실패 0 (30항목)
- ✅ **단계 2 구현** — 서버: `middleware/auth.js` req.user.impersonator · `switch-workspace` 사칭 403 + `io.to(user:N).emit('workspace:switched')` ·
  프론트: `utils/reloadSafety.ts`(BuildVersionGuard 에서 추출, 단일 술어) · `services/workspaceSync.ts`(채널·switching·10초 캡·재부팅 착지) ·
  `AuthContext.switchWorkspace` markSwitching+broadcast · `components/Common/WorkspaceSyncGuard.tsx`(수신 멱등·보류 줄·조용한 사본 변화·소켓 재연결 /me) · App.tsx 마운트 · common.json workspaceSync ko/en
  - 카나리 `scripts/e2e/canary-workspace-sync.js` (`--suite wssync`): ⑤대조군 ①A→B 탭2·팝아웃 ②B→A 팝아웃 복귀 ③입력 중 보류·보존·지금전환 ④사칭 403 — **6/6 EXIT 0** (build10)
  - 카나리가 잡은 결함 2건 수리: ①가드가 ShellApp 에만 있어 **데스크탑 탭 모드 창 무반응** → App 루트 마운트 ②10초 캡이 **빠른 왕복 A→B→A 를 막음** → 같은 대상 10초·다른 대상 30초 4회. 루프 안전망 대조군 2/2
  - 카나리 하니스 수리 2건: 뒤에 있는 탭 click 멈춤(bringToFront) · keep-alive 숨은 입력란(보이는 것만)
  - 발견만(검증 중이라 미수리): ChromeOverlays 에 PairCodePrompt 없음 · 탭 모드에서 설치 배너 2개(MainLayout InstallPromptBanner + ChromeOverlays PwaInstallBanner)
- ⏳ **Fable 재게이트 진행 중** (설계 v2 + 단계 0~2 + Q Note·도크 묶음) — Fable 중간: health 41/41 · guard EXIT 0 · wsscope 반증 · e2e 51/0 · 실HTTP 17/17 · wssync 독립 실행 대기 → PASS 면 커밋 → 마커 → 단계 3(헤더 관찰 모드)
- 🆕 Irene: "업무상세에서 수정요청·댓글 쓰다가 나가면 다 날라가는데 모든 입력란은 임시저장 되어 있게 못해?" → **구조로**
  - ✅ 감사 완료 → 설계 초안 **`docs/DRAFT_PERSISTENCE_DESIGN.md`**: 쓰다 나가면 사라지는 입력 ~67곳/17화면 · 업무상세 수정요청 사유·확인요청 메모·승인 코멘트·보류 사유·댓글 수정·댓글 첨부 저장 없음(댓글 본문만 useDraftText)
  - 조용한 유실: **AutoSaveField 언마운트 시 debounce 취소만(저장 안 함)** ~13곳 · 메일 초안 닫기/전환 1.5초 · Q Note 메모 1초
  - 키 구멍: StartMeetingModal `qnote_meeting_draft_v1` 사용자·워크스페이스 축 없음 · 로그아웃이 초안 안 지움 · 민감 입력 21곳 제외 필요
  - 순서: ①조용한 유실 flush ②useDraftText 정본화(키 user+biz+entity·로그아웃 정리) ③공용 껍데기 + 업무상세 6입력 먼저 ④민감 차단·가드·e2e — R=1·S=1 설계부터 Fable
  - 워크스페이스 단계 2 검증 뒤 착수
- **미커밋 선행 수리(구조에 흡수 예정)**: `routes/insights.js`(business_id 필수, 첫 워크스페이스 폴백 제거) ·
  `services/insights.js`(일정 calendarListWhere · 서명 business_id) · `routes/today_review.js`(채팅 방을 워크스페이스로 먼저 거름) ·
  `InsightCards.tsx`(businessId prop·전환 시 비움·닫기 키 워크스페이스별) · `TodoPage.tsx`. 백엔드 재시작·검증 **아직 안 함**

### 같은 턴에 받은 Q Note·도크 요청 (Irene 2026-09-11) — 구현·빌드 중(미커밋)
> "우측 하단에 채팅 버튼에 Q talk Q task Q note 다 Q만 대문자" · "Q note는 탭으로 메모, 음성메모 2가지 다 쓰게" · "음성노트랑 녹음파일 링크로 가게 연결" ·
> "+ 누르면 나오는 순서도 메모, 바로녹음, 녹음파일, 음성노트(대화형)" · "바로 녹음은 음성메모라고 하자. 모든 곳 이름 바꿔줘"
- ✅ 도크·팝아웃 창 이름 Q만 대문자(ko/en common.json dock · RightDock · Standalone 3종 pin title/holder label) — 브랜드 memory 에 규칙 추가
- ✅ "바로 녹음" → **음성메모** (qnote.json quickLabel · quickRecord.title "음성메모 {{time}}" · en Voice memo) · voiceLabel "음성 노트 (대화형)"
- ✅ + 메뉴 순서 메모 → 음성메모 → 녹음 파일 → 음성 노트(대화형)
- ✅ `/notes?new=memo|voice|upload|quick` 딥링크(keep-alive 에서도 매번 소비). quick 은 자동 시작하지 않고 + 메뉴를 연다(제스처 없는 AudioContext 잠김)
- ✅ 메모 팝업에 "음성 노트 (대화형) → · 녹음 파일 →" 링크(팝아웃은 PopoutBridge 로 메인 창 새 탭)
- ❌ **도크 Q note 창 안의 [메모 | 음성메모] 탭** — 녹음 엔진이 QNotePage(4,964줄) 안에 박혀 있어 공용 훅 추출이 필요. 워크스페이스 구조 작업 뒤 설계
- ✅ 자체 검증(F=1): build EXIT 0 / error TS 0 · guard-invariants 44/45 EXIT 0 · 실브라우저 7/7(도크 이름 · + 메뉴 순서 좌표 · ?new=upload/voice(떠 있는 화면 포함)/quick · 메모 링크 클릭 착지) · 링크 줄 데스크탑·폰 2/2(보임·아이콘·36px·가로넘침 0) · 스크린샷 확인 — "→" 문자가 밑줄처럼 깨져 SVG 꺾쇠로 교체

### 이번 세션에 운영으로 나간 것
- **확인필요·대시보드·Q Bill 워크스페이스 격리** (`a8ae55a6`) — 운영 dashboard.js md5 = HEAD 확인
- **플랫폼 관리자 탭** 이름·identity·`+` 범위
- **공개 화면 여백** (center 420 · 폰 16px · 툴바 전폭)
- **모바일 채팅 (#409·#410)** — 타이핑 중 바닥 유지 · 전송/수신 즉시 바닥(smooth·조상 scrollIntoView 제거) ·
  터치 기기 진입 시 키보드 안 띄움 · 알림 탭(planq:navigate) → 바닥 + 포커스 해제 · 키보드 up 입력란 28% 캡
- **AI 일정 수정 서버 1차** + 안정화 — 선점(동시 1회)·지금값 대조·0건 409 해제·결과 원장·요약 알림 1통·include_closed.
  운영 `schedule_batches` 생성 확인(0행). **화면은 아직 없음**
- **업무 날짜** — PUT 과 일괄 수정이 같은 이력·알림 함수 · 제목 시작일/마감일/일정 변경 · 이력 라벨 "일정 변경" ·
  빈 값 저장(옛 500) · 잘못된 날짜 400 · 완료 업무: 단건 수정 허용 / 일괄 기본 제외
- **메일 자동 연결** — 초대 주소가 프로젝트 여럿이면 프로젝트 미배치
- 릴리즈노트 **v1.48.21 운영 발행**(배포 스크립트 자동) · 개발 현황 id=78

### 배포 검증 (3점 + 기능)
last-deployed 4aa971ef · planq-prod-backend uptime 56s · QTalkPage 청크 06:06 + 터치 판정 포함 ·
ko 라벨 "일정 변경" · schedule_batches 존재 · https://planq.kr/api/health 200 · / 200

### 다음 할 일 (우선순위 순)
1. **운영 신고 #409·#410 답글** — 관리자 > 피드백에서 답글 달기(Irene). 장부 스크립트는 답글 있는 건만 닫는다.
   `scripts/feedback-close-backlog.txt` 에 올려 둠 → 답글 후 다음 배포에서 자동으로 닫힌다
2. **iOS 앱 재빌드** — Codemagic `ios-testflight` 수동 트리거. `AppDelegate.swift` 의 키보드 위 ▲▼✓ 줄 제거가
   앱 번들에만 들어간다. Swift 는 개발서버에서 컴파일 불가 → 빌드 성공·실기기(바 사라짐·키보드 높이 정상) 확인 필요
3. **실기기 확인** — 폰 Q Talk 여러 줄 입력 · 전송 직후 바닥 · 알림 탭 진입 시 키보드 닫힘 (#410 끊김은 헤드리스로 재현 불가 — 기전으로만 판정)
4. `pages/Guest/GuestChatPanel.tsx` — 같은 계열(`bottomRef.scrollIntoView`, 타이핑 추적 없음)
5. AI 일정 수정 화면(`pages/QProject/ScheduleEditModal.tsx`) — 서버 운영 반영됨. 설계 `docs/AI_SCHEDULE_EDIT_DESIGN.md`
6. 운영 메일 자동연결 백필(`dev-backend/scripts/backfill-mail-links.js`) — 권한 분류기에 막혀 있던 건. Fable: 다중 프로젝트 수리 후 dry-run 정상
7. Irene 판단 3건 — 관리자 모드 알림 벨 범위 전환 · PublicSignPage 이메일 선노출 · 보고서 공유 링크 무만료
8. 백로그 — 프로젝트 "주요 이슈" 자동화 · #407 · #381/#382 Q sale · Finance 고정비 입력 UI

### 이번 세션에서 배운 것 (박제)
- `feedback_headless_hides_smooth_scroll_jank` — 헤드리스는 짧은 smooth 를 한 프레임에 끝낸다. 프레임 기록은 옛 코드도 초록 → 기전(호출 수)을 센다. 절대값 판정은 쉬는 자리부터 빨간불
- MEMORY.md 압축(342 링크 보존 · 도메인 섹션 → `index_domains.md`)
- `routes/tasks.js` 의 errorResponse 는 `middleware/errorHandler` 것 — 코드를 `message` 에 싣는다(`utils/response` 는 `code`). 테스트 판정은 둘 다 본다
- 운영 확인 명령에 `pm2` 와 `dev-backend` 문자열이 같이 있으면 POS 보호 훅이 막는다 — 나눠서 실행

---

## 복구 가이드

새 Claude 세션 시작 시 아래 내용을 붙여넣으세요:

```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```
