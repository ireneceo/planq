# PlanQ 세션 상태

## 현재 작업 상태
**마지막 업데이트:** 2026-07-18 (Opus 4.8, 1M) — IMAP 핫픽스 + 운영 피드백 잔여 개발 + Features 8종 (3배포)
**작업 상태:** 완료 (/개발완료)

### 진행 중인 작업
- 없음 (구현 대기: 게스트 퀵메뉴/위키 UX — "다음 할 일" 참조)

### 완료된 작업 (이번 세션 · 전부 운영 배포됨)
- **IMAP IDLE 재연결 누수 핫픽스** (`52fdf3a`) — `help@irenewp.com` "메일 sync 실패 3회 연속 — Too many simultaneous connections" 알림 폭주 해결. Gmail 계정당 15연결 초과 = node-imap disconnect 시 error+close+end 3이벤트 각각 재연결 + 의도적 end() 재유발 + 타이머 중복. dropped 플래그·reconnectTimers dedup·teardown removeAllListeners·connecting 가드·backstop live-IDLE skip. 운영 실측 fail=0·last_sync 즉시. 메모리 `feedback_imap_idle_reconnect_leak`.
- **순수 개발 잔여 7건** (`df1359e`·`02487c6`): ⑪ 탭 드래그 정렬 · 9b Q Note 폴링 정지(useReallyVisible) · #157 퀵메뉴 배경 딤 · #168 개인보관함 안내문구 · #183 Q project 헤더 필터 아래 행 · #186 메일 받은/보낸 구분(보낸 배지+sent 폴더) · #184 메일 번역(translate 라우트+토글).
- **#146 Features 8종** (`e832e44`) — 통합 인박스·고객관리·전자서명·Q위키·개인보관함·업무보고·포커스·회의록 "더 많은 기능" 섹션 (ko/en).
- **운영 피드백 50→2건** — 43(라이브)+5(배포후) done + 개별 완료 답변. 남은 #126(Google OAuth 검증=Irene)·#146(캡처 이미지=디자인 결정).
- **빌드 heap 8192→4096** — 7.7GB dev 머신에서 8192 반복 abort/Terminated = 배포 프론트빌드 stall 근본원인. 메모리 `feedback_build_heap_4096_on_dev`.
- 검증: 가드 3축(health 30/30·guard 21/21·tenant 0) · 3배포 각 3점 실측(PM2 fresh·청크해시 dev=운영·콘텐츠) · #184/#186 운영 실호출·쿼리.

### 다음 할 일 (최우선)
**게스트 퀵메뉴 · Q helper · /wiki 네비게이션 구현** — 설계 확정, 구현만 남음.
- **설계 문서: `docs/qa/GUEST_QUICKMENU_WIKI_DESIGN.md`** (Fable 정리 + Irene 결정 완료 — 이 문서만 보고 구현).
- 진짜 원인: `App.tsx:156` isMarketing→hideAppChrome 로 마케팅 경로에서 CueHelpDrawer 미마운트(#71 회귀) → 게스트 퀵메뉴 소멸. /wiki 는 목록에 없어 회원이 워크스페이스 런처를 봄(반대). 게스트 모드(위키+문의 2탭)는 이미 완성 — 입구만 막힘.
- 변경 5파일(백엔드 0): 신규 `utils/publicSurface.ts` · `App.tsx`(공개표면 CueHelpDrawer 게스트 마운트 + /wiki 를 LandingLayout/WikiShell 로 감쌈) · `CueHelpDrawer.tsx`(publicSurface prop·guestView·openWikiPath 새탭) · `RightDock.tsx`(공개표면 숨김) · `WikiArticlePage.tsx`(게스트 "화면열기" 숨김).
- Irene 확정: 위키·문의 비회원 완전 자유(로그인 벽 0), "화면 열기"만 게스트 숨김(라벨 아님), 워크스페이스→위키 새 탭.
- 검증: 비로그인/로그인 × 랜딩/위키/워크스페이스 4상태 매트릭스. 회귀 #71(마케팅 Toaster/Banner) 주의.

### 기타 남은 것
- ⑦ 인프라(Irene 액션): Stripe Webhook Secret · SMTP DKIM/SPF/DMARC DNS · Google OAuth 검증 제출(#126 캘린더 양방향 활성).
- #146 캡처: 실제 앱 스크린샷 = 클린 데모 워크스페이스 캡처 필요(고객 실데이터 노출 방지) + 디자인 큐레이션 → Irene 방향 결정 후 진행.
- 네이티브 앱(iOS/Android) 코드 완료·미출시 — Apple Developer $99·Mac Xcode·Firebase(전부 Irene 액션).

---

## 복구 가이드

새 Claude 세션 시작 시 아래 내용을 붙여넣으세요:

```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```

### 참조
- 다음 작업 설계: `docs/qa/GUEST_QUICKMENU_WIKI_DESIGN.md`
- 진행 히스토리: `DEVELOPMENT_PLAN.md` 최상단
- 메모리: `feedback_imap_idle_reconnect_leak` · `feedback_build_heap_4096_on_dev`
