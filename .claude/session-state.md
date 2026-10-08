## 현재 작업 상태

### 완료: 플랫폼 관리자 확인 필요·알림 정비 (2026-10-08 · [Opus] 방 282c4c27) — 운영 미배포
- 원문: *"플랫폼관리자에서 입금확인해야 하는거 알림이 안떠. 여기도 할일필요 메뉴랑 알림표시들 다 제대로 구성되면 좋겠는데 메뉴 전체적으로 훑어보고 정리해줘"*
- 원인: ① `services/platformNotify` 가 **메일만** 보냈다(인박스·푸시 «미구현») — 설정 화면은 토글을 보여 줘 받는 것처럼 보였다 ② 관리자 «확인 필요» 없음, 배지는 문의·피드백뿐 ③ 피드백 배지는 응답 모양(`data.pending`)을 `data.counts.pending` 으로 읽어 **늘 0** ④ 알림 링크 `/admin/plans` 는 없는 주소 ⑤ 구독·결제 화면이 `?status=` 를 안 읽어 메일 링크가 «전체» 로 열림
- 한 것: `services/adminTodo.js` + `GET /api/admin/todo`(입금 통보·세금계산서·문의·피드백, 배지 단일 원천) · platformNotify 인박스+푸시(`notify`, skip email · client_crash 는 메일만) · `/admin/inbox` 화면 · 사이드바 7구역 재배치 + 배지(확인 필요·구독·결제) · 결제 이력 «세금계산서 발행 필요» 탭·입금 통보 표시·실패 건 재발행 · 네 화면 URL 필터 · 회귀 `--suite admininbox`
- 운영 실측(읽기): 결제 #21(워크스페이스 16) 2026-10-08 02:01 입금 통보 — 메일만 갔고 아직 pending. 배포되면 확인 필요에 바로 뜬다.
- Fable 안 씀 — 관리자 내부 도구, 돈 흐름·권한 판정 불변(읽기 집계 + 관리자 본인 알림만). 입금 확인 동작은 기존 화면 그대로.

### 답 기다림 (이전): 플랫폼관리자 «입금…» 지시 원문이 끊김 (2026-10-08 · [Opus] 방 10ba8989) — 방 282c4c27 이 전문을 받아 처리함
- **무엇을:** 지시가 «플랫폼관리자에서 입금욫» 에서 끊겨 무엇을 바꿀지 모른다(관련 화면: `pages/Admin/AdminPaymentsPage.tsx` — 입금 완료 처리·세금계산서·환불)
- **왜 멈췄나:** 결제(돈) 화면이라 추측해서 고치지 않는다
- **답이 오면 할 일:** 원문대로 구현 → 돈 흐름이 바뀌면 Fable 게이트(calc/gate) → dev 검증

### 답 기다림: Fable 기준 공용판 맞추기 — 공용 기준과 어긋나는 Irene 옛 지시 2건 (2026-10-08 · [Opus] 방 09074bb8)
- **한 것:** CLAUDE.md «Fable 사용» 절(기준 = `~/dev-server/FABLE.md`, PlanQ 예시·장치·Irene 원문 출처만) · AI 협업 표 · `/fable-검증`·`/검증`·`/개발완료` 0-F·`/기능설계` · 훅 안내 문구 · docs/AI_COLLABORATION_PROTOCOL.md · 메모리 6개. FABLE_GATE_QUEUE.md 미판정·재검증 묶음 → 상황판 Fable 대기 `fwmuz1uqy3`(gate)·`fwmuz1uqyy`(calc), 그 파일은 «판정 기록 보관소».
- **무엇을:** ① 08-18 «모든 판단은 Fable» vs 공용 «작은 선택은 작업 모델» ② Fable 대기 중인 변경이 있을 때 Irene 의 /배포 지시를 어떻게 다루나
- **왜 멈췄나:** Irene 원문 지시와 공용 기준이 충돌 — 고치지 않고 묻는다(이 일의 규칙)
- **답이 오면 할 일:** ① 공용대로면 memory `feedback_fable_decides_not_opus` 의 08-18 단락에 «좁혀짐» 표시 ② 정한 대로 `.claude/commands/배포.md` 에 한 단락(대기 목록 확인·보고)


### 완료: 서명 화면 — 빨간 칸에서 바로 서명 창 (2026-10-08 · [Opus] 방 ab77c16a · 커밋 c4fa04f8)
- 칸·맨 아래 버튼 → 같은 창(문서 확인했나요? → 본인 확인 → 서명). 페이지가 위아래로 안 오간다. dev 빌드 반영, 운영 미배포.
- 검증: signflow·signitems 전부 통과(내 칸 화면 위치 259→259→256→256 · 375/820/1440 서명 제출) · i18n·parity 가드 통과. **Fable PASS**(긴 문서·폰 390·키보드·우리쪽 서명자·slot 없음·확인요청 실측). 비차단: ①본인 확인 전 [거절] 은 서버 400 otp_required 인데 오류가 안 보인다(기존 결함) ②창 안에 [거절] 없음 ③짧은 문서+영어에서 칸 21px 이동 ④signflow 픽스처가 짧아 이동 변별력 약함 ⑤Esc 로 그린 서명 사라짐.

### 답 기다림: AI 로 업무의 프로젝트 옮기기 넣을까 (#463) · ChatGPT 재연결·front_v4 확인 (2026-10-08 · [Opus] 방 dfbe4a9b)
- **무엇을:** ① #463 — 업무 프로젝트 옮기기 AI 도구(확인 2단계)를 넣을지 ② Irene 손: ChatGPT·Claude 재연결 + 중복 연결 끊기 · 운영 Q file 에서 front_v4.jpg 열어 보기
- **왜 멈췄나:** ① 옮기면 볼 수 있는 사람이 바뀐다(가시성) — 설계 밖 새 도구 ② 계정 로그인 필요
- **답이 오면 할 일:** ① 넣으면 Fable 설계 → 구현(move_document_to_project 선례) → 게이트, 안 넣으면 #463 답글 그대로 ② agent_grants 읽기 확인
**마지막 업데이트:** 2026-10-07 (개발완료) · **주체:** [Opus] Opus 5.5 (+ Fable 검증 서브에이전트 5회)
**작업 상태:** 완료 — 운영 배포 5회(마지막 f19fbfca 12:39, backup 20261007_123113). 이전: **dev 미배포 5커밋**: bf4353d7 체크박스 디자인 · 59fba176+a6e3b66e AI create_event 칸·감사 대상 · 6169cbfe 반복 회차 날짜 · (위키 시드·UI 가이드 문서)

### 완료: UI/UX 전수 검증 체계 (2026-10-07~08 · [Opus] 방 f6990861 · 커밋 be5a1f45 · Fable 게이트 PASS)
- 정본 문서 `docs/qa/UI_VERIFICATION_SYSTEM.md`(왜 샜나 · 기준 · 언제 · 첫 실측). 답: UI 는 Fable 이 아니라 기계 검사 전부를 매일 돌리고 결과를 아침 방이 읽는 것.
- 새 장치: `scripts/e2e/full-sweep.sh`(등록 스위트 전부, 순찰 직후 자동) · `sweep-summary.js` · `run.js` 계정 상태(현재 워크스페이스) 오염 감지·복원 ·
  순찰 확장(상세 23 + 고객 2환경 + 연 창 모양 판정 + 파일창·내려받기 감지 · `PATROL_TAG`/`PATROL_DETAIL_ONLY`) · cron 16:00 UTC · 개발시작 1-C · 검증 8-D 교체
- 고친 실제 결함: 지워진 대상 알림 표시(`services/notificationTargets`) · 고객 정보탭 오류·새 프로젝트 버튼 · 새 프로젝트 창 잘림 · 칩 팝오버 스크롤 닫기 ·
  메일 상세 늦은 응답 덮어쓰기 · 업무 상세 blur 저장 · Q file 나눠 그리기. 낡은 검사기 8개 갱신.
- dev 빌드 반영 · 백엔드 재시작 · 커밋 be5a1f45(내 파일만). 운영 미배포. 감사 방(billing 등)이 이어서 편집 중 — 그 미커밋은 그쪽 것.
- **남은 것(다음 방이 이어서)** — 확장 순찰 첫 전체 실행(`logs/patrol/patrol-2026-10-08-full.log`, 7환경 누름 1,727 · 연 창 221 · 연 창 모양 실패 0 · 폰/태블릿 웹·고객 실패 0):
  ① 앱(폰·아이패드 흉내)에서 «새 탭에서 열기»(`/files?file=`) · «새 창으로 크게 보기»(메일)가 **새 창**을 연다 — 앱에선 window.open 이 사파리로 간다(memory `feedback_ipad_app_is_desktop_mode`). services/nativeLinks 경로로.
  ② 메일 상세에서 다른 스레드 링크(피드백 알림 메일 안 «PlanQ … 피드백» 행)를 누르면 가끔 **detail-fallback-error**(앱 환경 · 서버 GET 은 200). 오늘 넣은 «마지막 요청만 반영» 뒤에도 남음 — 실브라우저로 앱 UA 재현부터.
  ③ ipad-app `/talk` 에 «다시 시도» 오류 상태가 떠 있었다(목록 로딩 실패) — 재현 확인.
  ④ 하니스: 순찰 실행 시간이 2h45m(동시 부하 포함) — `nightly-patrol.sh` timeout 9000 을 넘을 수 있다 → 10800 으로 · full-sweep 총 시간 상한 없음(Fable 비차단).
  ⑤ Fable 비차단: 일반 멤버(member) 역할 스위트 없음 · 실시간 2-브라우저 시나리오 부족 · dupname 옛 경로(project_id NULL) 변별력 축소.

### 완료: 감사 0단계 결함 수리 — 전 묶음 Fable PASS, dev 반영·운영 미배포 (2026-10-08 · [Opus]+[Fable] 감사 방 629e3b90) — Irene «권고대로»
- 운영 실측(읽기): RETENTION_PURGE_APPLY=1 · 청구서 7건 전부 KRW · sent 1건 토큰 살아 있음 · canceled 구독에 매달린 pending 결제 4건 · 애드온 결제 0
- ✅ 0-A·0-B 돈·청구(설계 docs/FIX_0AB_MONEY_DESIGN.md): 93c558a2 + 2dfd8320 — Fable 1차 FAIL(예약 다운그레이드 못 보고 못 취소) → 수정 → **PASS**
- ✅ 0-C 격리 ccd7b793 · 0-D 휴지통 7a5f30a3 · 0-E 관리자·메뉴 숨김 1c87444a · 0-F 초대 78a7c300 (설계 docs/FIX_0CDEF_ACCESS_DESIGN.md) — **Fable PASS**
- ✅ 0-G 숫자 d9f538f3 · 0-H 알림 e2a9f10e(채팅 메일 5분 묶음) · 0-I 문구 38d1d64e(610키) · 0-J 작은 결함 43e48a10 · 후속 6d554be7(카드 공유 열쇠 business 방 제거) — **Fable PASS**
- 다음: 1단계(사용자 체감 P0 15건 — 확인필요 바로 처리·업무 드로어 다음 액션·프로젝트 개요 한 장·메시지→업무·답글·전체답장 등, docs/FABLE_PRODUCT_AUDIT_2026-10-07.md §C) — 운영 배포는 Irene /배포 지시 뒤
- 운영 배포 전 추가 SELECT(0-C): signature_requests entity_type<>'post' 0 · 위키 문자열 file_id 0 · documents 살아 있는 share_token 수
- 운영 배포 전 필수: 0-A §1-2 운영 SELECT(고아 4건 plan_code=plan·live 0) · 마이그레이션 슬롯 2개(migrate-invoice-money · migrate-billing-0a) · CONTENT_TRASH_PURGE_APPLY 는 리포트 하루 뒤 켠다
- Irene 할 일: `dev-backend/scripts/plan-expiry-check.js` 삭제(권한 거부, 미배선이라 동작 영향 없음)

### 답 기다림 (이전): Fable 제품 종합 감사 — 결정 14건 + 0단계 결함 착수 지시 (2026-10-07 · [Opus]+[Fable] 감사 방) — Irene «권고대로»
- **무엇을:** Fable 이 6개 영역을 감사했다(`docs/audit-2026-10-07/*.md`). 종합·재검증·로드맵은 `docs/FABLE_PRODUCT_AUDIT_2026-10-07.md` — 결함 30건 재검증(사실로 확인 27), 전체 UX 6.0/10.
  Irene 결정 14건(문서 끝) + 0단계 결함 10묶음(돈·구독 0-A, 청구 정합 0-B, 격리 0-C, 휴지통 0-D 는 R=1 → Fable 게이트) 착수 지시.
- **왜 멈췄나:** ① 정책·가시성·돈 결정은 Irene 몫 ② 같은 폴더에서 «UI/UX 전수 검증» 방이 소스를 고치는 중(한 솔루션 한 편집 방) ③ 운영 읽기(SELECT 5건: 토큰 NULL 청구서·고아 pending 결제·외화·RETENTION_PURGE_APPLY·위키 file_id)가 권한 거부됨
- **답이 오면 할 일:** 편집 방이 비면 0단계 묶음 순서대로 구현 → R=1 묶음마다 Fable 게이트. 운영 SELECT 는 Irene 허용 시 실행해 0-A·0-D 긴급도 확정

### 완료: 피드백 방 기록 (2026-10-07 밤 · 2026-10-08 재확인 — 3cfbbb8b 는 dev 빌드 03:41 에 들어 있음 · 운영 미배포, 다음 /배포 때 HEAD 와 같이 나감)
- [Opus] 피드백 방 (2026-10-07 밤): ① 운영 답글 5건 발송 완료(#458·#434·#456·#460 reviewing · #415 wontfix) ③ 말하기 데스크탑 4종 끝까지 확인 + Cue 카드 일정 날짜·시간 편집·시간대 일치(3cfbbb8b)
  ② 설문 구현(725ec330 — 설계 docs/SURVEY_DESIGN.md · Fable 설계 수정 7건 반영 · dev 마이그레이션 적용) → ✅ **Fable 라운드 D PASS**(차단 0) · 비차단 a(열쇠 정확 일치 78c5b3e8)·d(시험 데이터) 처리 · 운영 배포는 «결정 8건» 방이 HEAD 통째로 한다(PASS 통보함)
  · 운영 배포 시: `migrate-survey.js` 가 배포 슬롯에 등록됨(코드보다 먼저). 안드로이드 공유는 새 Play 빌드 필요

### 답 기다림 (이전): 남은 피드백 5건 — 운영 답글 승인 + 결정 2개 (2026-10-07 · [Opus] 피드백 정리 방) — Irene 답: ①보내 ②외부 포함 누구나 ③그대로+제대로 → 처리함(아래 «진행 중»)
- **무엇을:** ① 운영 피드백 답글 5건 보내도 되나(초안 `docs/feedback-replies-2026-10-07.json` — #458·#434·#456·#460 reviewing, #415 wontfix(본인이 남긴 빈 글)) ② #460 설문: 누가 응답하나(내부·로그인 고객만 / 외부 누구나) ③ #458 데스크탑 말하기: 그대로 보이기(권고) / 숨기기
- **왜 멈췄나:** 답글은 운영 데이터 쓰기 + 보고자 알림(Irene 지시 없이 안 함). 설문 외부 응답은 무인증 공개 표면(R=1)이라 Irene 결정 뒤 Fable 설계
- **답이 오면 할 일:** ① 배포 후 운영에서 `node scripts/feedback-reply.js <json> --apply`(배포 전이면 /tmp 로 복사) ② (가)면 표 문서 «설문으로 받기»+통계 구현 / (나)면 Fable 설계 게이트부터 ③ 숨기기면 RightDock 말하기 항목을 마이크 없는 기기에서 숨김

### 답 기다림 (이전): Irene 직접 할 일 3가지 — 구글 심사 · AI 앱 재연결 · 중복 연결 정리 (2026-10-07 · [Opus] 결정 8건 방, 상황판 요청 askmuyci17b)
- **무엇을:** ① 구글 콘솔 «데이터 액세스» 에 `calendar.calendarlist.readonly` 추가 → 사유·영상 → 심사 제출(`docs/GOOGLE_OAUTH_CALENDARLIST_GUIDE.md`) ② ChatGPT·Claude 에서 PlanQ 다시 연결(projects:write) ③ 프로필 › 외부 연동 › 연결된 AI 앱 — 운영 ChatGPT 연결 2개(grant 3: 10/5, grant 4: 10/6) → ② 뒤 앱마다 최신 1개만 남기고 끊기
- **왜 멈췄나:** 구글 계정 주인·ChatGPT/Claude 계정 로그인이 필요한 일이라 제가 할 수 없음
- **답이 오면 할 일:** 운영 `agent_grants` 에서 revoked_at IS NULL 인 행이 앱마다 1개인지·scopes 에 projects:write 가 있는지 확인(읽기만). 구글은 심사 메일이 오면 답장 문안 작성

### 진행 중(미완료): 결정 8건 — 7건 운영 반영 끝, ⑥ 구글 캘린더 목록 권한은 심사 제출·승인 전이라 끝나지 않음 (2026-10-07 · [Opus] 결정 8건 방)
- 운영 배포 2회: 174fee38(마이그레이션 3종·K-DINE Aidan → 방 28·방침 1.2→1.3 배포가 자동으로 올림) · dc3f7b30(참석자 안내 문구 — #462 이후 거짓이 된 문구)
- 운영 실테스트(biz 10): 실HTTP 19/19 · 화면 planq.kr 3폭(일정 알림 체크·외부 링크 «어느 고객에게») 전부 PASS · 운영 시험 데이터 전부 정리(0건 확인)
- [Fable] 운영 검증 PASS — 헬스·pm2 재시작 0·코드 md5 일치·방침 감사행 보관기한·고객 채널 점검 0건·플랫폼 발송 계정 보낸편지함 건너뜀·locale .gz 일치·마이그레이션 멱등
- #462 답글 done 발송(운영)
- **Irene 손이 필요한 것(코드 작업 없음):** ① 구글 콘솔에 `calendar.calendarlist.readonly` 추가 + 심사 제출 — 순서·붙여 넣을 문안·영상 대본 `docs/GOOGLE_OAUTH_CALENDARLIST_GUIDE.md` (지금 쓰는 연결엔 영향 없음) ② ChatGPT·Claude 앱 다시 연결(새 권한 projects:write) ③ 운영 ChatGPT 중복 연결 1개 끊기(프로필 > 외부 연동 > AI 연결)

### 답 기다림 (이전): 결정 8건 구현분 배포 지시 + Irene 손이 필요한 4가지 (2026-10-07 · [Opus] 결정 8건 방)
- **무엇을:** Irene «fable 판정대로 해» → 8건 전부 Fable 판정대로 구현·Fable 검증 PASS(4라운드). dev 미배포 커밋:
  e55e24e5 고객 채널=프로젝트×고객·복사본 · 293104c6 AI 쓰기 도구 · a5e91e45 #462 일정 알림 선택 · 48e0164d 구글 캘린더 고르기 ·
  b507d670+82b4bc0e 메일 보낸편지함·스팸함 · 774d6aab Cue 질문 분석 · 0eeb0b4b 방침 문구 · 4b27bd7e+f5964b67 외부 열람 링크 고객별
- **왜 멈췄나:** 운영 배포·운영 데이터 쓰기·외부 계정 작업은 Irene 지시 없이 하지 않는다
- **답이 오면 할 일:** ① /배포 — 마이그레이션 슬롯 3개(migrate-mail-folders · migrate-cue-question-analysis · migrate-customer-channel-per-client → migrate-project-client-user 순) 자동.
  배포 직후 운영 K-DINE(방 18) Aidan 이 자기 방으로 옮겨진다 · help_question_logs 90일 소급(지금 운영 최고 8/31 → 지울 행 0)
  ② 배포 때 Irene: 운영 `privacy_version` 올리기(재동의 창) + `PrivacyPolicy.tsx effectiveDate` 를 배포일로
  ③ Irene: Google Cloud 콘솔 OAuth «데이터 액세스» 에 `calendar.calendarlist.readonly` 추가 후 심사 제출(이 권한 넣어서)
  ④ Irene: ChatGPT·Claude 앱 다시 연결(새 권한 projects:write) · #462 답글(기능 반영)
- **확인 못 함:** 네이버 Message-ID 보존(운영 네이버 개인 계정 1개·PlanQ 발송 0건) · 실제 구글 캘린더 목록/선택 저장(재연결 필요) · clientlink 카나리 ④ 태블릿·데스크탑(메모리 부족으로 끊김, 서버 검사·폰은 통과)

### 답 기다림 (이전): Irene 결정 8건 (2026-10-07 · Fable B 판정) — Irene «fable 판정대로 해» → 구현 완료

- **무엇을:** ①Kate·Aidan 같은 회사?·고객별 채널 ②프로젝트 복사본 고객 연결 ③AI 쓰기 보강(고객 연결·projects:write·태그 생성·메모 L1) ④메일 보낸편지함 먼저·스팸 30일·14일 ⑤Cue 질문 분석 켜짐/꺼짐·help_question_logs 90일 소급 ⑥구글 캘린더 목록 권한을 OAuth 심사에 넣기 ⑦Claude 개인/조직 겹침·운영 ChatGPT 중복 연결 정리 ⑧#462 일정 알림 선택
- **왜 멈췄나:** 전부 정책·가시성·외부 발송·운영 데이터 결정이라 Irene 몫(Fable 도 결정을 넘김). 질문지·권고·답이 오면 할 일은 `docs/IRENE_DECISIONS_2026-10-07.md` 표 한 장, Fable 원문은 같은 문서 부록(전에는 세션 기록에만 있었다)
- **답이 오면 할 일:** 표의 «답이 오면 할 일» 칸대로. R=1 인 1·3·4·5·8 은 구현 뒤 Fable 게이트

### 답 기다림 (이전): 운영 위키 시드 실행 (2026-10-07) — Irene «너가 해» → 실행 완료(카테고리 17·글 86), #459 done 답글
- **무엇을:** 운영에서 `cd /opt/planq/backend && node seed-wiki-content.js` (배포 후 단계)
- **왜 멈췄나:** 운영 데이터 쓰기 명령이 권한 검사에서 거부됨 — 우회하지 않음
- **답이 오면 할 일:** Irene 이 직접 실행하거나 허용 → 실행 후 #459 답글(체크박스 2차, done)

### 완료: 종일 일정 날짜 (2026-10-07 · [Opus] 종일 날짜 방)
- 원인: 종일을 기기 자정 instant 로 저장 → 다른 기기·워크스페이스 시간대에서 하루 밀림 + 반복 종일 요일이 하루 밀림(서울 저장 매주 수 → 목) + 구글 {date}·알림 날짜·알림 문구가 시간대마다 다름
- 고침: 한 벌 헬퍼(서버 `utils/allDayDate.js` · 화면 `utils/allDayDate.ts`, 반올림) · 서버 쓰기 정규화 · 구글·역동기화·개인 오버레이 · 알림 cron · 알림 문구 · 오늘 리뷰 · 확인필요 · AI create_event · 공개 페이지 · 화면 격자·상세·등록
- 백필 `dev-backend/scripts/migrate-allday-utc-date.js`(멱등·updated_at 보존·회차 키 이동·--revert) — 배포 «재시작 뒤» 슬롯 + 0건 단언
- 검증: 실HTTP 21/21 · AI 4케이스 · 실브라우저 서울·KL·LA × 3폭 10/10(`--suite allday`), 양성 대조군(옛 표시 빌드) LA 5건 실패 · health 53/53 · 가드 통과 · Fable 설계 판정 + 구현 PASS

### 완료된 작업 (이번 세션)
- 서명 흐름: 확인필요·받은 서명 → /sign/:token · 문서 먼저 → 서명 위치 → 본인 확인 → 서명 · 우리 쪽 링크를 로그아웃/다른 계정으로 열면 로그인 안내
- 구독: 결제 대기 유예 중 전부 잠기던 결함 → `services/planActive` 상태표(운영 biz 10 해제 확인) + health-check billing 6건
- 채팅 푸시: 다른 기기에서 그 방을 보고 있으면 생략(`services/presence`, PushLog viewer_active, fail-open)
- 통합 검색 둘째 줄(업무 담당·작성·마감 / 문서 #분류 / 파일 올린 사람·날짜) · 파일 설명·태그 검색
- Q calendar: 워크스페이스 시간대 · 겹침 나란히 · 업무 연결 · 알림 제목 · 프로젝트 필터 · 프로젝트 «일정» 탭
- 랜딩·로그인·SEO 정의 «의뢰형 고객 업무» 포지셔닝 원복(Irene: 주 업무는 업무관리·내부소통)
- Fable 지적 수정: AI 감사 대상(문서·일정) · L1 문서 owner/admin 편집 차단 · 메일 아는 상대 자기 증명 · 삭제된 업무 표시 · 동의 문구
- 피드백 회신 함수(`services/feedbackRespond` + `scripts/feedback-reply.js`) · 개발시작/개발완료 스킬에 운영 피드백 확인·답변 단계
- 체크박스·라디오 우리 모양(전역 `:where()`) · AI create_event 종류·알림·업무·화상 링크
- 운영 피드백 답변: #461 done · #462 reviewing

### 답 기다림 (이전): 운영 배포 지시 (2026-10-07) — 12:39 배포 완료 f19fbfca
- **무엇을:** dev 미배포 6커밋(59fba176 · 6169cbfe · bf4353d7 · a6e3b66e · fd9d972c + 기록) 운영 배포
- **왜 멈췄나:** 배포는 Irene 의 명시 «/배포» 로만 한다(CLAUDE.md 배포 규칙 · 상황판 지시 «운영 배포 Irene 지시 없이 안 함»). 상황판 항목 배정만으로는 배포 지시로 보지 않았다
- **배포 준비 상태(2026-10-07 확인):** health-check 51/51 · 불변식 가드 통과 · dev 빌드 12:22(fd9d972c 12:09 이후) 반영 · dev.planq.kr 200. Fable: 59fba176 41/43 PASS + 감사 대상 한 줄 수정(a6e3b66e)은 Fable 미검증(자체 검증)
- **답이 오면 할 일:** /배포(--auto) → 운영 verify 3종 → `ssh …prod "cd /opt/planq/backend && node seed-wiki-content.js"` → #459 답글(체크박스 2차, done)

### 다음 할 일
1. **배포 대기 6커밋** (⏸ Irene /배포 지시 대기 — 위 «답 기다림») (+fd9d972c 코드 블록 [+] 띠 편집 모드에서만) — 배포 후 운영 위키 시드(`ssh …prod "cd /opt/planq/backend && node seed-wiki-content.js"`) · #459 답글(체크박스 2차, 배포 후 done)
2. **Irene 결정 8건 — 미완료.** 7건은 운영 반영·실테스트·Fable 운영 게이트 PASS. ⑥ 구글 «캘린더 목록 보기» 권한: 콘솔 추가 + 심사 재제출(Irene) → 승인 메일 확인 → 승인 후 planq.kr 에서 [캘린더 고르기] 경고 없이 열리는지 실측해야 완료. AI 앱 재연결·중복 연결 정리도 남음(위 «답 기다림»)
3. ~~남은 피드백 5건~~ ✅ 2026-10-07 — #458 말하기(59b04893) · #434/#456 안드로이드 공유 받기(76da612a, 새 Play 빌드 필요 · iOS 는 App Group 대기) · #460 설문 의견 문서 · #457 회신 알림 언어 수정(c11cf194, 보고자 답 대기) · #415 닫기 제안 → 답글 승인 대기(위 «답 기다림»). Fable C PASS + 지적 2건 수정(a16fa23b). **dev 미배포 4커밋**
4. ~~종일 일정 시간대~~ ✅ 2026-10-07 [Opus]+[Fable] — 종일 = UTC 자정 날짜(docs/ALLDAY_EVENT_DATE_DESIGN.md). c79778d1 + ea44f5f5, Fable 설계 판정 U → 구현 검증 PASS. **dev 미배포** — 배포 때 `post_restart_backfills` 가 운영 종일 3행(id 42·43·44) 재부호화 후 0건 단언. Fable 관찰(비차단): 배포 스크립트 단언 줄은 ssh 자체 실패 시 set -e 로 멈춤 — 다음에 만질 때 `|| LEFT=@@ERR`. 따로 남김: 시간 일정 반복의 UTC 전개(서울 08:00 매주 수 → 목) — 회차 키 이동·자기 백필이 따라오는 별도 R=1, Fable 설계부터
5. Irene: ChatGPT 재연결(docs:write) · front_v4.jpg 운영 확인 — 2026-10-08 [Opus] 방 dfbe4a9b 점검: 둘 다 **Irene 손으로만** 끝난다.
   - front_v4.jpg: 고친 코드(feac9580·5d530d27·122f042d)는 운영 f19fbfca 에 들어 있음 — planq.kr locale 에 «이미지 불러오는 중…»·«크게 보기» 실측. 실제 그 파일이 뜨는지는 Irene 로그인 화면에서만 확인 가능(운영 DB 읽기는 권한 거부)
   - ChatGPT 재연결: 위 «답 기다림: Irene 직접 할 일 3가지» ②③ 과 같은 일 — 한 번 다시 연결하면 docs:write·files:write·projects:write 가 함께 붙는다. 연결 뒤 앱마다 최신 1개만 남기고 끊기
   - 답이 오면 할 일: 운영 agent_grants 읽기(권한 허용 시) — 앱별 살아 있는 연결 1개 · scopes 에 docs:write·projects:write
   - 2026-10-08 운영 피드백 재확인(Irene «관련 내용 더 있을 텐데 봐봐»): 새 pending 2건
     · #464 [영수증] 빈 화면(no_token) — ✅ 고침 f8585dce · **Fable PASS**(실브라우저 2폭×2회·인증 헤더·500 대조군) (링크 → downloadFromApi, 실패 문구). dev 실측: 헤더 없음 401·토큰 200 PDF·남의 결제 404 · 데스크탑/폰 눌러서 receipt-N.pdf(%PDF-) 받음·새 창 0 · 500 대조군에서 오류 문구 뜸. 운영 미배포. 답글 초안 docs/feedback-replies-2026-10-08.json(배포 뒤 발송)
     · #463 (user 3, Claude 연결) AI 로 업무의 프로젝트 변경·업무 삭제 불가 — 삭제는 설계상 HIGH(도구 없음). 프로젝트 옮기기는 가시성 변경이라 새 MEDIUM 도구(move_task_to_project, move_document_to_project 와 같은 2단계 확인) 여부를 Irene 결정 → 하면 Fable 설계 1회부터
     · #456 끝 질문 «챗지피티에서 플랜큐 어떻게 써? 어디 설정?» 에 답글이 빠져 있었음 — 보고에서 답함(PlanQ 개인 설정 › 외부 연동 › «연결된 AI 앱» 의 [ChatGPT 에서 열기] · 주소 https://planq.kr/agent/mcp · 위키 «ChatGPT·Claude 연결하기»)

### 주요 변경사항
- 신규: `services/{planActive,presence,feedbackRespond}.js` · `scripts/feedback-reply.js` · `pages/QCalendar/{ProjectFilter,CalendarFrame}.tsx`
- `QCalendarPage` scope prop(프로젝트 탭) · `NewEventModal initialProjectId` · `services/socket.ts registerViewing`
- 기억: memory `feedback_positioning_needs_explicit_decision` (포지셔닝 문장은 Irene 이 정한 것만)

---

## 복구 가이드

새 Claude 세션 시작 시 아래 내용을 붙여넣으세요:

```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```
