## 현재 작업 상태
**마지막 업데이트:** 2026-09-07 08:25 UTC
**작업 상태:** 완료 (운영 배포 2회 · 커밋 2건 · 가드 35/35 · health 41/41 · e2e 11스위트 95항목 실패 0)

### 진행 중인 작업
- 없음 (미커밋 변경 0건)

### 완료된 작업 (이번 세션)

**① 모든 팝업이 최상위로** — 출근 알림이 우측 상세 뒤로 깔리고 태블릿·폰에선 아예 안 보였다.
  원인은 z-index 가 아니라 **층**: 모달을 그리는 위젯이 사이드바 안에 있고 사이드바는
  `position:fixed; z-index:100`(+태블릿 이하 transform)이라 그 안의 1100 은 페이지 기준 100 이다.
  `StandardModal` 을 `document.body` 로 포털. 전면 백드롭 74개 중 66개가 포털을 안 써서
  `--category=modalportal` 래칫으로 동결. 모달 하단 라운드(Footer 가 흰 사각으로 덮던 것)도 수정.

**② 출근 알림이 하루 종일 살아 있던 것** — `autoClockInNotice` 에 시간 제한이 없어 종일 내려왔고,
  모달이 렌더 안 되는 상태에선 "확인" 이 기록되지 않아 몇 시간 뒤 튀어나왔다. 30분 창으로 묶음.

**③ 업무 책임선에서 직급 예외 제거** — description=작성자만 / body=담당자만.
  owner·admin·platform_admin 백도어 삭제(첨부 쓰기도 같은 술어). 삭제·이관 등 운영 권한은 유지
  (Irene: "남의 글을 만지지 못하게 하는 것으로 하고 업무관리는 관리자가 다 되면 된다").

**④ Q docs → Q info** — 서버가 주는 문서 제목을 프론트가 버리고 본문만 AI 에 넘기고 있었다.
  제목을 맥락으로 전달 + 모달 제목 "인포로 보내기 — {문서}" + 값(금액·기간·기한) 추출 규칙 강화.
  운영 문서 실측: 669자 뭉치 소멸 · 14→16항목 · 값 있는 항목 0→15. 항목 상한 20→60.

**⑤ 웹 IA** — `/beta`(앱)와 `/app`(앱 다운로드)이 같은 값을 읽는 두 페이지 → `/app` 하나로 통합
  (+LandingLayout, `/beta` 리다이렉트, BetaPage 삭제). 사용가이드 15건은 이미 위키에 있었고
  blog_category 탓에 인사이트에도 떠 있었다 → 인사이트에서만 제거(옮긴 데이터 0).
  새 소식은 반대로 인사이트로 들임. 도움말 새 탭. 배포 시 **릴리즈 노트 초안 자동 생성**.

**⑥ 브랜드스토리** — 메뉴 "회사"→"브랜드스토리". About 페이지의 지어낸 인용문을 운영 Q docs
  "PlanQ 브랜드 스토리" 원문으로 교체(14문단, ko/en).

**⑦ 모바일 다발** — 메일: 별표 제거·라벨→태그·폴더탭 순서·컨트롤 36px/13px·밴드2 99px 2줄→55px 1줄
  ·전체보기 safe-top·작성 헤더 돌아가기+닫기. 프로젝트: 필터 4→3줄·제목 왼쪽 뒤로가기
  (PageShell.onBack 신설)·문서 탭 핀 localStorage→서버. Q Task: 리스트 제목 인라인 편집 제거
  (클릭=상세)·행 끝 > 제거·업무검색 안내문 13px·태그 메뉴 키보드 대응(visualViewport).
  Q Note: 헤더 접기를 요약·업무추출 밴드로 이전·"요약 펼치기" 중복 버튼 제거·제목 잘림 해소
  ·참여자 바 중복 렌더 제거·`ended` 가 목록에서 "대기" 로 떨어지던 것.

**⑧ 아이폰 알림** — 소리는 이미 정상(APNs `sound:'default'`). 문제는 **유도**였다: 거부되면
  글로만 안내하고 버튼이 없었다 → "설정 열기"(iOS) + "사운드도 켜세요" 안내.

**⑨ 업무 시작·재개 실시간 반영** — 근태는 이미 305ms 였고 **포커스 위젯에만 소켓 리스너가 없었다**
  (30초 폴링). focus 라우트 5개 전이에 broadcast(`user:{id}` 룸) + 위젯 리스너·복귀 안전망.
  실측 302~303ms. 검증 중 `/api/focus/stop` 이 session_id 없이 500 을 내던 것도 400 으로 수정.

**⑩ 휴가 부여** — 이미 구현돼 있었고 정상 작동 확인(실호출 7/7: 본인·멤버·음수 정정·400).

**신규 검사기 4종** (전부 양성 대조군으로 반증 확인):
  `modaltop`(21) · `respline`(5) · `mailband`(9) · `realtime`(7) + 가드 `modalportal`

### 이번 세션에 스스로 만든 사고와 교훈
- **styled 주석에 백틱** → 빌드 붕괴. 일괄 치환 스크립트가 중첩 템플릿까지 1,429곳 손상.
  `git checkout` 대신 HEAD 와 줄 단위 대조로 822줄만 복구, 편집 24개 표식 전수 확인(유실 0).
  빌드가 못 잡은 `t('state.${key}')` 같은 **문법은 맞고 뜻이 틀린** 3건은 따로 잡았다.
- **측정이 네 번 거짓말** — ①밴드2 를 찾을 때 메시지 본문을 집었다 ②근무중일 때도 "휴게" 버튼이
  있어 판정이 영영 참이 못 됐다 ③사이드바 시계가 포커스 타이머 정규식에 걸렸다
  ④`fields` 를 서버는 `custom_columns` 로 내보내는데 옛 키를 봤다. **코드와 같은 렌즈로 재라.**
- **검사기가 다른 검사를 죽였다 4건** — 살아 있는 자동출근 알림이 뒤 스위트의 클릭을 가로챘고,
  그 원복은 rate-limit 429 에 막혔고, early return 이 러너 계약을 안 지켜 FATAL 이 났고,
  카나리가 공유 DB 풀을 닫았다. 원복은 DB 로, 풀은 러너가 한 번만.

### 주요 변경 파일
- 백엔드: `routes/{tasks,task_attachments,kb,projects,blog,app_download,focus}.js` ·
  `services/{attendanceTransition,focusBroadcast(신규)}.js` · `models/ProjectPinnedDoc.js`(신규) ·
  `scripts/{migrate-project-pinned-docs,make-release-note-draft}.js`(신규)
- 프론트: `components/Common/{StandardModal,ChipPopover,SearchBox,NotificationToaster,PushPromptBanner}.tsx` ·
  `components/Layout/{PageShell,PanelHeader,MainLayout}.tsx` · `components/Focus/FocusWidget.tsx` ·
  `pages/QMail/*` · `pages/QNote/QNotePage.tsx` · `pages/QProject/*` · `pages/QTask/QTaskPage.tsx` ·
  `pages/Landing/AboutPage.tsx` · `pages/DownloadApp/DownloadAppPage.tsx` · `services/native.ts`
- 검사/문서: `scripts/e2e/{run,canary-modal-top,canary-detail-band,canary-responsibility-line,canary-realtime,canary-rawkey}.js` ·
  `scripts/{guard-invariants,guards-baseline,deploy-planq.sh}` · `CLAUDE.md` · `docs/PERMISSION_MATRIX.md`

### 다음 할 일
1. **실기기 확인 대기** — 태블릿↔데스크탑 업무재개 즉시 반영 · 아이폰 알림 소리와 "설정 열기" ·
   Q Note 제목·접기 · 브랜드스토리/앱/인사이트 화면 · 태블릿 세로 메뉴 열고 출근 알림
2. **메일 첨부 밑 여백** — 4가지로 쟀지만 재현 못 함(첨부 아래 13px · iframe 과보고 0px).
   Irene 이 화면을 특정해 주면 재개
3. **Q info 중첩 가격표 규격별 분해** — 업체별로는 갈렸으나 규격까지는 아직(16항목 중 4개가 값 2개↑)
4. **canary-rawkey 반증 완료 후 게이트 등록** — 번들 로케일 사본 의심, 지금은 미등록
5. **Q Note 기능 전수 점검** — 신고분만 고쳤다
6. **릴리즈 노트 초안 다듬어 발행** — 운영에 미발행 초안 2건(update-1-48-12 포함)

### Git 상태
- 브랜치 main · **미커밋 0건**
- `ac1f2853` fix: 업무 시작·재개 실시간 반영 · focus/stop 500 · 검사기 오염 제거 (운영 배포됨 08:16)
- `48d879df` fix: 팝업 최상위 · 업무 책임선 · 모바일 다발 · Q info 추출 · 웹 IA (운영 배포됨 06:52)
- 운영 롤백: `ssh irene@87.106.78.146 'tar -xzf /opt/planq/backups/20260907_081628/backend.tar.gz -C /opt/planq && pm2 reload planq-prod-backend'`

---

## 복구 가이드

새 Claude 세션 시작 시 아래 내용을 붙여넣으세요:

```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```
