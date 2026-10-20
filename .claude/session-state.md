## 현재 작업 상태
**마지막 업데이트:** 2026-10-21 (방 d75372dd — 일정 구글 캘린더 이름 · 근태 0시 조사 · 편집기 툴바 한 줄)
**작업 상태:** 완료 — 개발완료(10/19~10/20 기록 · 게이트 health 88/88 · guard 74/75 · tenant 0 · wiki 통과). 운영은 042c74b4 까지 — 미배포: 91309d09 처리방침 10-28 · f4979e74 업무/요청 전환 · bbf8270e 설명란 가림.

### 완료: 일정 추가 «구글 캘린더 연동» 에 대상 캘린더 이름 (방 d75372dd · 2026-10-21 · [Opus]) — ea0ef5ff, 운영 미배포
- 원문: «일정 추가할 때 구글캘린더 종류는 선택이 안돼? 선택할 수 없으면 기준이 되는 캘린더 이름 표시라도 해줘»
- 올릴 캘린더는 연결마다 하나(개인=내 프로필 외부 연동 · 팀=파일·외부 연동, 대표). 창에 «Google 「이름」 · 계정» + «바꾸기»(새 탭). 일정마다 고르기는 동기화 경로 전체 변경이라 안 함.
- video/status 에 personal_account_email·personal_calendar_summary. calendarLabelOf 를 services/personalCalendar 로(문자열 metadata 도).
- 검증: build 0 · 실HTTP 새 칸·토큰 0 · secrets 12/12 · 화면 1440·834·390 두 줄(긴 주소 말줄임·«바꾸기» 눌림·새 탭 «내 외부 연동») — dev 에 구글 연결이 없어 화면은 응답을 채워 넣고 잼(실연결 미측정). NewEventModal 800줄 넘어 GcalSyncRows 분리. Fable 안 씀 — 표시.

### 완료: 편집기 서식 툴바 모든 폭 한 줄 (방 d75372dd · 2026-10-21 · [Opus]) — 051d4375, 운영 미배포
- 원문: «상단 에디터기능들이 왜 2줄 3줄 … 옆으로 이동해서 보게 해야 하는 거 아냐? … 다른 솔루션들은 어떻게?»
- 640px 조건 제거 → editorToolbarScroll 한 벌(PostEditor·RichEditor). 넘친 쪽 ‹ › · 세로 휠 → 가로 · 서명 메뉴 포털.
- 검증: 문서 툴바 71→41px(1440·1280·834) · 157→37px(390), 대조군(감김)에서 71/157 재현 · › 로 끝 버튼 elementFromPoint 잡힘 · 휠 300px 이동 · 서명 메뉴 4폭 보임 · 메일 작성 41/41/37 · docsheader·docscollapse·mobilesweep 0 실패 · docfind ⑥ 1440 간헐 실패(6회 중 2회, 원래 감김 규칙에서도 같은 경로 — 툴바와 무관한 클릭 위치 흔들림) · guard godfile 은 MainLayout(기존)만. Fable 안 씀 — 화면 배치.
- 남은 선택: «⋯ 더보기» 접기(CKEditor 식)는 안 함 — 한 줄 밀기로 신고 해소.

### 완료(조사): 출근 → 0시 지나면 «미출근» (방 d75372dd · 2026-10-21 · [Opus]) — 고칠 일은 대기열 앞으로
- 원문: «12시가 지나면 미출근 상태가 되는 거야? 그냥 12시에 퇴근 찍히고 다시 출근하는 걸로 기록할 수 없어?»
- 원인(코드): 근태 하루 = work_date 한 행, 화면 GET /attendance/today 는 오늘 날짜 행만 본다 → 0시에 미출근. 어제 열린 행은 매시 5분 자동 마감이 «마지막 활동 시각» 으로 닫고(source auto_close), 오늘 행은 업무 «진행 시작» 순간에만 생겨 측정은 도는데 근태는 미출근. 10/15 커밋(59f9ba65·ec327235·0117c462)은 이 경계를 안 고친다.
- 운영 데이터 확인은 권한 거부(읽기 SSH)로 못 함.
- 자정 분할(24:00 퇴근 + 00:00 출근)은 근태 기록 규칙·통계 변경 + source ENUM 결정이라 Fable 설계 필요 → 상황판 대기열 앞에 조사 결과와 함께 넣음.

### 완료: 일정 추가·수정 «프로젝트 / 업무 연결» 한 줄 (방 6f049386 · 2026-10-21 · [Opus]) — 운영 미배포
- 원문: «일정 추가하고 수정할 때 이거 1행으로 나오면 될 것 같은데 왜 2줄이야? 여기 저기 업무연결 추가된 곳에 이렇게 막 1줄씩 내렸는지 확인해줘»
- 업무 연결 입력(TaskLinkPicker)을 쓰는 곳 전수 = 일정 등록 창 · 일정 상세 · 문서 편집(30aeb3ab 에서 이미 한 줄). 나머지 «연결» 칸(노트·AI 문서·AI 업무·Q note 세션)은 프로젝트 하나뿐이라 대상 아님.
- 고침: NewEventModal·EventDrawer 프로젝트 옆 칸에 업무 연결(2칸 grid, minmax(0,1fr) — 긴 이름이 칸을 밀지 않게). 편집 권한 없으면 업무 칸만. 자리 표시 «업무 검색해서 연결» → «업무 검색»(위 라벨이 이미 «업무 연결», 폰에서 잘렸다).
- 검증: vite build 0 · 범위 tsc 0(전체 tsc -b 는 earlyoom 143) · 실브라우저 1440·834·390·360 등록·상세 모두 두 칸 같은 y, 문서 가로 넘침 0, 자리 표시 잘림 0 · i18n·parity·autosave·autosavekey 가드 통과. Fable 안 씀 — 화면 배치.
- 시험 데이터: ws6 일정 1467 «[확인용] 일정 프로젝트·업무 한 줄»(업무 4075 연결).

### 완료: 앱 다운로드 «이 컴퓨터 (Windows · Mac)» → 지금 OS 표기 (방 b165024d · 2026-10-20 · [Opus]) — 9e1b2b24, 운영 미배포
- 원문: «이 컴퓨터라고 하면서 Windows · Mac 둘다 표시하면 어떻게 해? 이 컴퓨터가 뭔데? 파악 안되면 이 컴퓨터라고 지정하면 안되지»
- DownloadAppPage detectDesktopOs(userAgentData → UA): Windows PC · Mac · Linux PC · Chromebook, 모르면 «데스크탑 앱»/«PlanQ 앱 설치». 설치됨·완료 문구도 OS 별(시작 메뉴 / Launchpad·Dock / 앱 목록).
- 검증: vite build 0 · 범위 tsc(바뀐 파일 오류 0 — 전체 tsc -b 는 earlyoom 143) · /app 실브라우저 UA 5종(Win·Mac·Linux·모름·Mac Safari) 각 표기 확인 · i18n·parity 통과. ★ 첫 빌드에서 os 변수를 안드로이드 함수에 넣어 화면이 죽은 것을 실브라우저로 잡고 고침. Fable 안 씀 — 문구.

### 완료: 문서 편집 분류·연결 줄 — 업무 여러 개 걸어도 한 줄 (방 b165024d · 2026-10-20 · [Opus]) — 30aeb3ab, 운영 미배포
- 원문: «상단에 업무 추가하는 거 높이값 높아지는 ui … 위로 올라가는게 너무 이상해 … 프로젝트>문서> 편집에서 전체 높이가 너무 높아 … 업무 여러 개 연결하면 완전 엉망»
- 원인: DocTaskLinkField 가 칩을 고르는 칸 **위에** 줄바꿈으로 쌓아 칩 수만큼 밴드가 자라고 칸이 밀렸다(업무 1개도 86px).
- 고침: 고르는 칸 먼저 + 칩 한 줄 가로 스크롤 + 둘 이상이면 «연결 N» · 카테고리 기준 폭 180 · 입력 최소 폭 넘침 모든 폭.
- 검증: 업무 5개 실측 1440·1280 분류 줄 196→57px(본문 y 579→440) · 834 242→103 · 폰 펼침 한 줄·가로 넘침 0 · 추가·해제 때 고르는 칸 y 고정·밴드 57 유지 · docsheader·mobilechrome 0 실패 · i18n·parity·autosave 가드 통과. Fable 안 씀 — 화면 배치.
- 남은 것(이 일 밖): 서식 줄 2줄(1280 이하)은 다른 대기 일 · 업무 고르는 칸이 빈 검색일 때 «옵션 없음»(글자를 쳐야 나온다 — 기존 동작).
- 시험 데이터: ws6 프로젝트 35 «[확인용] 문서 업무연결 시험»(post 3187)에 업무 5개 연결.

### 완료: 폰 좌측 메뉴 반응 · 문서 작성 폰 최적화 (방 61f4ddf0 · 2026-10-20 · [Opus]) — 2819ffcb, 운영 미배포
- 원문: «좌측메뉴에서 눌러도 메뉴 이동이 바로 바로 안되고 자꾸 안눌려 … 문서 작성에서 프로젝트업무연결 카테고리가 다 한줄씩 … 에디터가 뒤로 숨고 에디터기능들만 위로 올라와서 … 모든 형식»
- 메뉴 원인: 닫기가 location 이펙트뿐 → 새 화면 렌더(transition)가 끝나야 닫힘. 누르는 순간 닫기(closeMenuOnNav, 펼치기 메뉴는 유지). CPU×6 닫힘 0.82~1.55초 → 0.13~0.32초.
- 문서 원인: 좁은 폭은 Content 가 스크롤 → 밴드(z3)와 서식 줄(z5)이 같은 상자 맨 위에 붙어 서식 줄이 밴드를 덮음. 편집은 본문(EditBody)이 스크롤. 폰 분류·연결 요약 한 줄(펴면 두 칸씩), 키보드 중 숨김. 제목 칸 겹침·«되돌리기» 짧은 글자·표 위 간격·업로드 칸 축소.
- 검증: build 0 · 390/360/768/1440 밴드 201→96 · 키보드 중 밴드 56·서식 줄 겹침 0·40줄 입력 마지막 줄 보임 · 대조군(옛 구조) 서식 줄 y36 재현 · 표·기존 문서 편집 · mobilechrome·docsheader·dropdowns·mobilesweep 0 실패 · guard 74/75(MainLayout 크기, 기존). Fable 미검증(자체 검증) — 화면 배치.

### 완료: 메일 답장창 버튼 줄 아래 빈 띠 (방 9c125642 · 2026-10-20 · [Opus]) — 6ba18452, 운영 미배포
- 원문: «메일 답변하기 들어가면 하단 버튼 아래에 빈 공간이 있어서 내용이 뒷 내용이 보여.»
- 원인: 버튼 줄 sticky bottom 0 이 DetailFooter 아래 padding(14px) 위에서 멈춤 + 단축키 안내가 버튼 줄 뒤에 있어 끝까지 내리면 26px 띠.
- 고침: bottom -14px · 단축키 안내를 버튼 줄 안 오른쪽으로(폰 ≤640 숨김).
- 검증: build 0 · 3폭 스크롤 중간·끝 빈 띠 0(고치기 전 14·26px 재현) · caret 0 실패. Fable 안 씀 — 화면 간격.

### 완료: Q mail 주소로 본 목록 «(unknown)» · 이 사람과 오간 메일이 안 보이던 것 (방 adec65ec · 2026-10-20 · [Opus]) — 운영 미배포
- 원문: «메일주소로 검색하면 unknown 이라고 표시가되잖아. 그리고 다시 받은 메일이랑 연결된 우리가 보낸 메일이나 과거 메일을 알 수가 없네.»
- 원인: 주소 메뉴 «이 주소의 메일 보기»(?address=) 라우트 `GET /email-addresses/:email/threads` 가 스레드 날 행(id·제목·상태)만 줘서 보낸 사람 자리가 «(unknown)», 「보낸」·미리보기·자리(보관) 표시가 비었다. 검색창 주소 검색(c5499935)은 정상이었다(ws3 40개 주소 실측 누락 0).
- 고침: 목록 행 만들기를 `services/mailThreadRows.buildThreadRows` 한 벌로 빼서 목록·주소 보기가 같이 씀(주소를 q 로 넘겨 행마다 그 사람) · 메일 상세 오른쪽 패널에 «이 사람과 오간 메일»(최근 5건 보낸/받은 배지 · 누르면 그 대화 · 모두 보기 N) · 주소 보기에도 자리 칩(보관 등) · 폰·태블릿에서 주소 보기로 가면 목록 칸을 편다(전엔 빈 화면).
- 검증: 범위 tsc 0 + vite build 0(전체 tsc -b 는 earlyoom SIGTERM 143 — 정식 전체 타입검사 아님) · 실HTTP 주소 보기 5주소 «이름 없음» 0 · 남의 워크스페이스 403 · 목록 6폴더 회귀 0 · 화면 3폭 ALL OK, 옛 서버 대조군에서 «(unknown)» 3건·6실패 재현 · health 88/88 · guard 74/75(MainLayout 크기, 기존) · maillabel 0 실패. Fable 안 씀 — 화면 표시·같은 권한 라우트의 응답 모양.
- 시험 데이터: ws6 «[확인용] 오간 메일 —» 스레드 3개(9495 보관·9496 보낸·9497 받은). 시험 메일 계정 425 는 꺼져 있어(is_active 0) owner 화면 목록이 «연결된 계정 없음» 으로 가려짐 — 화면 검사는 계정 목록 응답만 채워 넣고 쟀다.

### 나중에 — Fable 대기: 휴가 종류 직접 추가·수정 기능 설계 · Fable 한도가 풀리면(상황판 재시도 2026-10-20 18:45 KL, fid fwmvgdotw2) · 그때 Fable 설계 → docs/LEAVE_TYPES_DESIGN.md → 구현(설계 전 구현 시작 안 함)
- Irene 2026-10-20 «권고대로»(① 회사가 종류 추가·수정 — 이름·유급/무급·연간 기본 일수, «휴가 설정» 칸을 근태 관리 맨 위로).
- 설계 요청 내용: 이 방 대화의 Fable 프롬프트와 같다 — 현황 파일(LeaveRequest/LeaveGrant ENUM · leaveTransition · routes/leave · pages/Attendance/leaveCategory.ts · AttendanceAdminSettings/TeamTab · 급여 무급 일할)·이행·박제·급여 연결·권한·화면·검증.


### 완료: /app «이 컴퓨터» 설치 안내를 버튼 하나로 · 랜딩 상단 «앱 다운로드» 맨 끝 (방 efa71b43 · 2026-10-20 · [Opus]) — 운영 미배포
- 원문: «다운로드를 왜 이렇게 안내해? 그냥 다운로드 해서 pwa 설치되잖아 … 랜딩페이지에서 앱다운로드 브랜드스토리 뒤로 보내. 맨 마지막. 혼자 아이콘 있잖아»
- DownloadAppPage DesktopPwaInstall: 크롬·엣지는 [이 컴퓨터에 설치] 버튼 항상(설치 창 못 받았으면 누를 때 한 줄 «앱에서 열기/⊕») · Safari 한 줄(파일 → Dock에 추가) · 그 외 «Chrome·Edge 로 열면» 한 줄. 3줄 메뉴 안내·«따로 받을 파일 없이…» 삭제(키 stepsTitle·note 삭제, notReady·otherBrowser 추가).
- LandingLayout 데스크탑 메뉴 줄: …·리소스·브랜드스토리·[아이콘]앱 다운로드(맨 끝). 폰·태블릿 메뉴 시트는 그대로(가입 버튼 아래 — 10-12 지시). 카나리 landinggnb 기대 순서 갱신.
- 검증: 범위 tsc 0 + vite build 0(전체 tsc -b 는 earlyoom 이 3회 SIGTERM — 정식 전체 타입검사 아님) · i18n·parity 가드 통과 · /app 크롬(이벤트 있음=설치 창 열림 / 막음=한 줄)·Safari·Firefox UA 각각 한 줄 · 3줄 목록 0 · landinggnb 0 실패, 대조군 12 실패. Fable 미검증(자체 검증) — 화면 배치·문구.

### 답 기다림 (이전): 휴가 종류를 회사가 직접 추가·수정하게 할지 (방 671b6a35 · 2026-10-20 · [Opus]) — Irene «권고대로» → ① 진행 중(Fable 설계 → docs/LEAVE_TYPES_DESIGN.md)
- 무엇: Irene «연차나 휴가종류 등록/관리 어디에 있어? 관리자 설정에 안보이는데»
- 사실: 연차 부여 = 설정 › 근태 관리(/business/settings/attendance) 세 번째 칸 «연간 부여»(TeamTab GrantForm, owner·admin). 휴가 종류 = 연차·병가·경조사·기타 4개 고정(LeaveRequest.category ENUM · pages/Attendance/leaveCategory.ts · services/leaveTransition LEAVE_CATEGORIES) — 등록·수정 화면 없음.
- 선택지: ① 회사가 종류 추가·수정(이름·유급/무급·연간 기본 일수) + «휴가 설정» 칸 맨 위 — 새 표·화면·마이그레이션 → Fable 설계 1회 ② 종류 고정 유지, «연간 부여» 칸만 맨 위로.
- 권고 ①. 답이 오면: ① → /기능설계(Fable 설계) 후 구현 · ② → 근태 관리 화면 칸 순서만 바꾸고 3폭 확인.
**다음 할 일:** 다음 배포에 91309d09·f4979e74·bbf8270e(+ 위키 «업무 만들기» 글 운영 반영: seed-wiki-content.js) — 처리방침 공지 띠·메일은 그 배포 뒤(늦어도 10-21) · Fable 대기 3건(환불 0eeeef09 완료 검증+구독 해지 설계 · 조직 규모 0단계 fwmvezqzws · 내 명함 v2) · 밤 검사 남은 실패 5(mobileboot·tablemenu·teampresence·guestproject·salelayout) · 운영 피드백 #463·#464 답글 초안 Irene 확인 · #465 답글 달고 done(10-20, 운영 반영·Irene 실기기 확인 근거)


### 완료: 업무·요청 추가 설명란 오른쪽이 가려지던 것 (방 f0ea9ea5 · 2026-10-20 · [Opus]) — 운영 미배포
- 원문: «업무추가/요청추가할 때 설명란에 제대로 전체로 입력이 안돼. 우측에 여백이 들어가고 내용이 안들어가.»
- 우측 서랍(+ 업무 추가)은 1440·900·390 + 한글 조합 입력·긴 글·실제 스크롤바까지 재현 안 됨(설명란 전폭·줄바꿈 정상).
- 재현된 것(목록 아래 «+ 업무 추가» 인라인 폼, 1366×768): ①PC «PlanQ 앱으로 설치» 배너(z 8500)가 설명란 오른쪽을 덮음 — 서랍은 aria-modal 규칙으로 숨는데 인라인 폼은 다이얼로그가 아니라 빠짐
  ②대화 버튼이 [추가] 를 덮음(끝까지 내려도) ③정확히 1366px 에서 우측 패널만 사라지고 «패널 접기» 토글이 화면 가운데 뜸 — JS 는 ≥1366 을 인라인으로, CSS 는 max-width:1366 에서 숨김(경계 한 칸 어긋남).
- 고침: PwaInstallBanner — 인라인 추가 폼이 열렸거나 입력칸 포커스 중이면 숨김 · QTaskPage 인라인 폼에 --pq-fab-clearance 바닥 여백 · RightPanel 숨김 경계 1365.98.
- 검증: build 0 · guard 74/75(문서 신선도 경고만) · 3폭(1366·1280·1440) 설명란 가림 0점·[추가] 눌림·배너 숨김(고치기 전 1366: 가림 43점·[추가] 위 대화 버튼) · taskaddparity 0 실패. Fable 안 씀 — 화면 겹침·CSS 경계.
- 개발완료(같은 방): 위키 «업무 만들기» 갱신 — 반복은 요청에도 남음(10-12 규칙) · [내 업무 | 요청하기] 전환 한 줄. dev 반영(seed 멱등) · 운영은 배포 뒤 seed.

### 완료: 업무 추가 폼에서 [내 업무 | 요청하기] 바로 전환 (방 1178e699 · 2026-10-20 · [Opus]) — f4979e74, 운영 미배포
- 원문: «업무추가할 때 요청하기로 바꾸는 거 쉽게 할 수 없을까? 업무요청 경로가 다른 곳에 있는게 좀 불편한데.» (붙은 kiyullaw.kr 링크는 다른 사이트 미리보기 — 무관, 안 열어 봄)
- TaskCreateForm `allowModeSwitch`(Q task 내 업무 화면만) · 요청 = 담당자 필수·나 제외·예측시간 숨김·제목 «요청 추가» · 요청엔 오늘/주 탭 기본 마감 안 실음 · 남에게 맡긴 업무는 만든 뒤 «요청하기» 탭으로.
- 정찰 계획 결정 2건은 계획 권고대로(요청이면 탭 전환 · 동료 고르면 자동 전환은 안 함).
- 검증: build 0 · 3폭 17/17(토글 32px 제목 위·전환 왕복·실제 요청 생성 DB 담당자=동료·요청하기 탭에 행) · taskaddparity 0 실패(④⑨ 낡은 판정 갱신) · guard 74/75. Fable 안 씀 — 화면 전환만, 서버·권한 무변경.

### 완료: 처리방침 개정 시행일 10-28 로 옮김 — Irene «권고대로» (방 d13688ac · 2026-10-20 · [Claude Code])
- 왜: Irene «이걸 왜 해야 해?»(할 일 todomvdbjkl4). 처리방침 10조가 «시행 7일 전 서비스 공지 및 이메일» 을 약속 — 운영 시행일 10-26 은 오늘 기준 6일.
- 선택지: ① 시행일 10-28(PrivacyPolicy.tsx · legal.json s10 ko/en · emailService POLICY_NOTICE) → 다음 배포 뒤 공지 띠·메일(72명) ② 그대로 오늘 ③ 마케팅 측정 접음(8조·3조 되돌림). 권고 ①.
- 답이 오면: ① → 3곳 날짜 수정·build·/privacy 확인·커밋, 할 일 todomvdbjkl4 를 새 날짜로 다시 올림 · ② → 카드 그대로 · ③ → 문구 되돌림 설계(Fable decision) 뒤 카드 drop.

- 한 일: 날짜 3곳+메일 스크립트 주석+SETUP_GUIDE 수정, 커밋(운영 미배포). 검증 build 0 · /privacy 3폭 10-28 · 옛 날짜 0. Fable 미검증(자체 검증).
- Irene 할 일 todomvdbjkl4 를 새 날짜로 다시 올림 — 이 커밋이 운영에 나간 뒤 공지 띠·메일(늦어도 10-21, 그보다 늦으면 시행일 다시 배포일+7).
### 완료: 폰 상세·팝업이 PlanQ 머리줄 아래로 (방 0e09e2e0 · 2026-10-18~20 · [Opus]) — 실기기 확인 완료
- 289cd865(위로 뜨는 창 --pq-popup-top · 가드 popuptop) + 뒤 수리 9b2bc83b(창 아래 56px 잘림)·c7f066f7·042c74b4(메뉴 층) — 10/20 운영 배포 042c74b4 에 포함.
- Irene 실기기(폰 사파리, 개발서버) 확인 «좋아요» 2026-10-20: 일정·업무 상세 «‹ 제목»·스크롤 · + 메뉴 창 5종 · 창 위 ☰ 메뉴.

### 완료: 정기 점검 10/20 — Irene «권고대로» → 자체 검증으로 운영 배포 042c74b4 (방 94a24d03 · 2026-10-20 · [Claude Code])
- 배포 042c74b4(--routine, 485초) — planq.kr/api/health 200 · pm2 backend·qnote·mcp online · .last-deployed-commit 042c74b4 · PDF 렌더 OK · 운영 CSP MISMATCH(종전 nginx sudo Irene 할 일). 백업 /opt/planq/backups/20261020_014341(운영).
- Fable 미검증(자체 검증·Irene 확인) 배포: 0eeeef09 환불 요청. Fable 대기 fwmvfrcxck 는 그대로(한도 풀리면 사후 판정).
- (이전 질문) 자체 검증만으로 배포할까요? → «권고대로»
- 개발완료: 건너뜀 — 같은 폴더에서 일하는 방 2곳(baa00446 환불·3b9480e1 내 명함).
- 배포: 막힘 — Fable 대기(한도). 나갈 코드 = 676536be..042c74b4(0eeeef09 환불 요청 · 9b2bc83b · c27aa83e · c7f066f7 · f2700201 · 042c74b4). 0eeeef09 의 Fable 완료 검증이 fwmvfrcxck 에 묶여 있음. 나머지 대기 2건은 설계 문서뿐.
- 자체 검증: 0eeeef09 API 25/25+8/8+4 · 화면 3폭 33/33 · 10/20 재측정 health 88/88 · guard 74/75.
- 상황판 질문 askmvg0qwho. 답이 «예» → `./scripts/deploy-planq.sh --routine` · 보고에 «Fable 미검증(자체 검증·Irene 확인) 배포: 0eeeef09». «아니오» → Fable 판정 뒤 배포.
- 개발시작: 운영 피드백 새 1건 #465(폰 알림이 좌측 메뉴에 가려짐) — c7f066f7·042c74b4 로 dev 수리됨, 운영 미배포. 열린 #463·#464 답글 없음. 밤 검사 10-19: 순찰 실패 5(/me/work-settings «브라우저 기준(UTC)» pageerror user_timezone_update_failed ×5환경 — 쓰기 막힘에 예외를 안 잡는 것으로 보임 · 알림→설문 문서 4096 찾을 수 없음 ×2) · 전체 검사 13/144 실패(crosscut·mailrt·mobileboot·consultlinks·tablefit·docfind·tablestyle·tablemenu·taskaddparity·dupname·teampresence·salelayout).

### 완료: 정기 점검 10/19 (방 0c7289b2 · 2026-10-19 · [Claude Code] Opus 5.5)
- 개발완료 676536be — 게이트 health 88/88(첫 회 1건은 밤 검사 allday 픽스처 #1432 가 잠깐 남은 것, 재실행 통과) · guard 74/75 · e2e tenant 0 · wiki 통과.
- 운영 배포 676536be(--routine, 460초) — health 200 · pm2 3개 online · 처리방침 시행일 2026-10-26 노출 확인 · 운영 CSP MISMATCH(nginx sudo = Irene 할 일 이미 상황판, 마케팅 측정이 아직 꺼져 있어 지금 영향 없음). 백업 /opt/planq/backups/20261018_195406(운영).
- 밤 검사 10-18: 순찰 실패 60(어제 9) · 전체 검사 실패 15/144. 원인 셋:
  ① 실제 결함 — 289cd865(운영 나감) 창 14곳 이중 오프셋, 폰에서 창 아래 56px 잘림 → 9b2bc83b 수리(실측 4/4 위 56·아래 844).
  ② 검사기 — 순찰 «폰 패널은 머리줄을 덮어야» 가 10-17 계약과 반대 → 갱신. modaltop «메뉴 열림/최상위» 가 10-18 계약(열린 메뉴가 위)과 반대 → 메뉴를 바깥 눌러 닫고 잼.
  ③ 하니스 — «출근으로 기록했어요» 알림이 새 브라우저마다 떠 클릭을 먹음(dismissBlockers 를 안 부르는 카나리) → goto 가 닫음.
  재실행: chromeoffset·mobilechrome·mobilepanels·modaltop·docsheader 0 · 순찰(폰 2환경 6화면) 0.
- 남은 실패(미착수, 다음 방): mobileboot «cue 입력줄 키보드에 4px 가림(333 vs 337)» · tablemenu 390 손잡이가 칸을 덮음 · teampresence 폰·태블릿 «팀 근무 중» 목록이 최상위 아님(열린 메뉴 10060 과 겹치는지 의심) · guestproject ⑨-14 «고객 공개» 토글 PATCH 0건 · salelayout 폰 카드 14px 움직임. 그 밖 10-17 부터 이어진 crosscut·mailrt·consultlinks·tablefit·tablestyle·taskaddparity·headerrow.
- 운영 피드백: 새 신고 없음(마지막 10-08). 열린 9건 — #463·#464 답글 초안 Irene 확인 대기, 나머지 reviewing(답글 있음).

### 답 기다림 (이전): 고객 요청 환불을 처리하면 구독도 같이 해지할지 (방 baa00446 · 2026-10-19 · [Opus]) → Irene «권고대로»(A 전액 환불이면 해지)
- 한 일(커밋됨, 운영 미배포): 요금제 «환불 요청» 을 문의 창이 아니라 **그 결제에 묶인 요청**으로(RefundRequestModal → routes/plan_refund, 사유 필수·계좌이체는 계좌) ·
  관리자 알림 제목 «[환불 요청] <워크스페이스> — 금액» · 링크 = 관리자 결제 이력 그 행(처리 창이 바로 열림) · 처리 창에 [환불 처리] / [반려](사유 → 대표 앱 알림) ·
  관리자 확인 필요에 일반 요청도 · 옛 번들 문의(source plan_refund) 메일 제목에 «[환불 요청]». 검증 API 25+8+체험 분기 4 · 화면 3폭 33/33 · health 88/88 · guard 74/75.
- 묻는 것: 일반 환불은 처리해도 결제만 «환불» 로 기록되고 구독은 그대로다(옛 관리자 [환불] 과 같은 동작). 전액 환불(7일/14일 이내)이면 구독도 해지할지 · 일할 환불(부분 금액)은 지금 기능이 없다.
- 답이 오면: 해지까지 하기로 하면 Fable 설계(상태 전이·금액) → 구현. 그대로면 할 일 없음.

### 나중에 — Fable 대기: 환불 요청 완료 검증 0eeeef09 (방 baa00446 · 2026-10-19) · 한도가 풀리면(상황판이 14:44 뒤 깨움) · 그때 /fable-검증 다시 → PASS 면 마커 by:fable · 운영 배포는 그 뒤
- 상황판 Fable 대기 fid fwmvepn40a · 마커 by:"unavailable". 자체 검증 숫자는 위 절.

### 나중에 — Fable 대기: 환불 → 구독 해지 설계 (방 baa00446 · 2026-10-19) · 한도가 풀리면(06:44 UTC 뒤) · 그때 docs/REFUND_CANCEL_DESIGN.md 로 Fable 설계 판정(0eeeef09 완료 검증과 묶어 한 번) → 판정대로 구현 → 검증
- 설계 판정 전이라 구현 시작 안 함.

### 나중에 — Fable 대기: 조직 규모 0단계 설계 판정 (방 75b90f45 · 2026-10-19 · [Opus])
- Irene 10-19 «권고대로 진행해 줘»(ORG_SCALE_REVIEW 결정 8건). 0단계 설계 초안 docs/ORG_STAGE0_DESIGN.md — 0-1 퇴사 인수인계 · 0-2 퇴사자 L1 업무(권고 A: L1 유지·인수자를 이름 박힌 사람으로 — L2 로 바꾸면 owner 도 봄) · 0-3 이미 있는 활동 기록을 «관리 행위만»·읽히는 이름으로 · 0-4 여러 명 초대 · 0-5 all-tasks done=recent + 5,000건 표시.
- Fable 설계 판정이 한도(429)로 막힘(10-18·10-19 재시도 네 번 다) → 상황판 Fable 대기 fwmvezqzws. 설계가 막혀 구현은 시작 안 함(코드 변경 0).
- 한도가 풀리면: 설계 판정 1회 → 차단 반영 → 구현(0-1~0-5) → 자체 검증 → R1(0-2·0-3) 완료 검증 Fable 1회 → 보고.
### 답 기다림 (이전): 조직 규모 검토 — Irene 결정 8건 → 10-19 «권고대로»
- 원문: «10-20명 이상의 조직의 경우 우리 솔루션을 쓰면 부족하게 느낄 문제가 뭘까? 보완해야 할 기능이나 구조가 있어? … fable 토큰 생기면 진행하게 해줘.»
- Fable 판정 완료 → docs/ORG_SCALE_REVIEW.md (사실 묶음 docs/for-fable/ORG_SCALE_REVIEW_FACTS.md). 대기 fwmvdbmupa done.
- 정할 것(5절): ①퇴사 인수인계 도입 ②퇴사자 «나만 보기» 처리(R1) ③대표가 보는 변경 이력 범위(R1) ④팀·부서를 대상 집합으로 ⑤부서장 권한(R1) ⑥요금 구조 ⑦1단계 착수 시점 ⑧2단계 인증 시점 — 권고 전부 문서에.
- 답이 오면: «권고대로» 면 0단계(퇴사 인수인계·L1 정책·대표용 이력·여러 명 초대·목록 서버 필터)부터 설계(R1 항목 Fable 설계 1회) → 구현. 1단계는 운영 인원 분포를 읽기 전용으로 본 뒤.

### 완료: 마케팅 측정 — Irene 승인(10-18 «권고대로») 뒤 처리방침 개정·고지 메일·켜는 순서 (방 d103516d · 2026-10-18 · [Opus] · Fable PASS) — 49755935 · 운영 미배포
- 처리방침 8조·3조·10조(시행 2026-10-26, 버전 안 올림) · 처리방침 화면 «쿠키 설정» · scripts/send-policy-notice.js(미리보기 기본·confirm 일치 시만) · docs/marketing/SETUP_GUIDE.md · gtm-container-import.json(가져오기 미검증).
- 검증: Fable 완료 PASS(비차단 반영) · build EXIT 0 · guard 74/75 · e2e marketingtags 0 실패 · /privacy ko/en 3폭(8조 5항목·시행일·넘침 0) · 쿠키 설정 버튼 3폭 눌러 창 열림 · 메일 미리보기 대상 72.
- ★ 배포가 10-19 보다 늦으면 시행일을 배포일+7 로(PrivacyPolicy.tsx · legal.json s10 · emailService POLICY_NOTICE 3곳).
### Irene 할 일 (마케팅 측정 — 상황판에 올림)
- 배포 당일 공지 띠 + 회원 메일(todomvdbjkl4) · nginx CSP sudo(todomvdbjkw2) · GTM·GA4·Meta 계정·ID·가져오기(todomvdbjl6v) · 10-26 이후 GTM 게시 + 운영 ID 입력(todomvdbjlhb, check)
### 답 기다림 (이전): 마케팅 측정(GTM·GA4·Meta 픽셀) 게시 목록 승인 (방 d103516d · 2026-10-17 · [Opus] · 설계·검증 Fable)
- 원문: «이거 해야 하는 거 안한거 있어? 메타 픽셀, 구글 서치콘솔, GA4, GTM 설정. 이벤트는 사이트 구조에 맞게 설계하고 설계서도 남기고 발행·게시 전에는 목록 보여주고 승인»
- 실측: 서치콘솔만 돼 있었고(06-05 부터 sitemap) GTM·GA4·Meta 픽셀은 0 — 09-21 에 CSP·쿠키 동의 때문에 일부러 안 하고 자체 집계를 만들었었다.
- 설계 docs/MARKETING_TRACKING_DESIGN.md (Fable 설계 PASS — 한국 기본 켜짐·그 밖 허용 전 0 · 랜딩+가입 화면만 · 가입 완료 착지 한 곳). 이벤트 11종(§3) · GTM 목록(§7) · 처리방침 문구(§10-1).
- dev 구현: services/marketingTags.ts(판정 한 곳) · components/Landing/MarketingTags(띠·쿠키 설정·페이지뷰·CTA) · 가입/문의/진단/앱 이벤트 · oauth/finish 신규 → /register?done=1 · platform_settings.gtm_container_id(+migrate-marketing-tags.js 배포 슬롯) · /api/platform/info · 관리자 입력칸 · CSP script-src(nginx 스니펫+security.js).
- Fable 완료 검증 FAIL 2(공유 링크 토큰이 redirect 가입·referrer 로 샐 길) → 고침, 재판정 없음(2회 한도) — 자체 검증 e2e marketingtags 15/15 · health 88/88 · guard 73/74(종전) · build EXIT 0.
- 운영: 코드가 나가도 운영 gtm_container_id 가 비어 있어 아무것도 안 돈다(처리방침 그대로 사실). dev 는 가짜 GTM-PLANQDEV(띠 확인용).
- 답이 오면: 승인 → 처리방침 문구 반영(legal.json ko/en, 버전 안 올림) → Irene 할 일(GTM·GA4·Meta 계정·ID, nginx CSP sudo, 개정 공지 7일+메일 승인) → 운영 ID 입력.
- 별개 결함 발견(미착수): /register?redirect=/invite/<잘못된 토큰> 화면 멈춤(dev·운영 같음).
- Fable 재판정 2026-10-18 PASS(대기 fwmvd00fs3 done) — 운영 배포 막는 것 없음(켜기는 여전히 Irene 승인 뒤).

### 완료(빌드 1건 남음): 폰 상세 — PlanQ 앱 머리줄 남기고 상세 머리줄을 그 아래로 (방 1c9351b3 · 2026-10-17 · [Opus]) — 9af2e736 · 운영 미배포
- 원문: «여전히 운영에 플랜큐 헤더가 없어져. 상세에서도 플랜큐 헤더 그대로 나오고 서브 타이틀 아래로 내려가야지. 모바일에서. … 배포 했는데 왜 안바뀌는지»
- 앞 판단 정정: 내가 «A(아이폰 깔림)» 로 권고했는데 틀렸다 — Irene 는 B(앱 머리줄을 남기기)를 원했다. 10-17 배포(bad1b03e)가 아이폰에서 처음으로 패널이 앱 머리줄을 «덮게» 만들어 «헤더가 없어졌다» 가 된 것.
- 고침: index.css --pq-panel-top = --pq-chrome-bottom 모든 폭(10-05 폰 전면 되돌림) · 업무 상세 어두운 막 --chrome-top → --pq-panel-top(폰에서 앱 머리줄을 덮고 메뉴 누름을 가로챘다) · 주석 4곳 · canary mobilechrome 계약+«앱 머리줄 보임» 검사 · CLAUDE.md.
- 검증(21:59 빌드 = 패널 위치 수정 반영): e2e mobilechrome·mobilepanels·tabletchrome ✅55 ❌0(새 «폰 앱 머리줄 보인다» 포함) · 감사 폰390/390+47/360+24/태블릿834+24 × 일정·파일·고객·Q info 모두 패널 top = 앱 머리줄 아래·머리줄 누를 수 있음 · 업무 상세는 화면은 맞으나 막이 머리줄을 덮음 → 고침(9af2e736) **빌드 미반영**(빌드 3회: 2회 다른 방 빌드와 겹쳐 종료, 1회 메모리 부족으로 시스템이 중단) · mobilesweep 은 중간에 브라우저 끊겨 미측정 · Fable 미검증(자체 검증 — 화면 배치).
### 다음 할 일 — 이 방
- 메모리 여유 될 때 `cd dev-frontend && npm run build`(백그라운드) → `node $CLAUDE_JOB_DIR/tmp/panel-audit.js` 업무 ✅ 확인 · `node scripts/e2e/run.js --suite mobilesweep` 단독. 다른 방(마케팅 태그 미커밋 20여 파일)이 빌드하면 그 빌드에 같이 실린다.

### 완료: 정기 점검 10/18 00:15 — 개발완료 · 배포 나갈 것 없음 · 개발시작 (방 f5bf4f06 · 2026-10-17 · [Claude Code])
- 개발완료: 게이트 health 88/88 · guard EXIT 0 · e2e tenant 실패 0 · 도움말 커버리지 통과. Fable 마커(f5ad8c36) 뒤 미판정 5커밋 = 내 명함(Fable 설계·검증 2회 한도 소진, 지적 고친 뒤 자체 검증) + 화면·작은 버그 4건 → Fable 대상 아님/자체 검증, 마커 안 씀.
- 도움말: «내 명함 만들고 링크·QR 로 건네기»(settings / my-name-cards, ko·en, 화면 문구와 대조) — dev 시드 반영(id 324). 운영 시드는 운영 DB 쓰기라 안 함.
- 배포: 운영 .last-deployed-commit = 4fae09e1 — 그 뒤 커밋은 작업기록·이번 개발완료(문서·도움말 원본)뿐, 운영 실행 코드 변화 0 → 배포 안 함.
- 운영 확인(읽기): /api/health ok · /c/ 응답에 X-Robots-Tag 없음(nginx 미적용) → Irene 할 일 todomvclt75t 로 올림.
- 운영 피드백: 열린 9건(#434·439·440·456·457·458·460 reviewing 답글 있음 · #463·#464 pending 답글 없음), 10/08 이후 새 신고 0.
- 밤 검사: 순찰 10-16 exit=2(10-17 회차는 점검 시각에 도는 중) · 10-16 전체 검사 141 중 통과 121·실패 17·시간초과 2(narrowtext·headerdrift — 브라우저 세션 끊김)·죽음 1(mobilepanels). 실패: caret·crosscut(/sale?tab=clients 누출)·mailrt·docscollapse·bodygutter·fab·mobileboot·consultlinks·tablefit·tablestyle·tablemenu·taskaddparity·dupname·guestentry·maillabel·salelayout·headerrow — 판정은 다음 고치는 방(crosscut «누출» 먼저).

### (이전 — 틀린 판단) 폰 상세 패널 머리줄 감사 — Irene «권고대로»(A: 아이폰 깔림, 10-17 수정 운영 미배포) (방 1c9351b3 · 감사 결과 아래 «감사» 줄)
### 답 기다림 (이전): 폰 상세 패널 «헤더가 없어진다» — 어느 헤더인지 (방 1c9351b3 · 2026-10-17 · [Opus])
- 원문: «모바일에서 업무상세 일정 상세 처럼 우측패널 영역을 열면 왜 헤더가 없어져? 서브헤더가 아래로 내려와야지. 모든 것 다 철저히 감사해 … Fable이 판단 안했어?»
- 조사한 것(코드 변경 없음): 10-05 dd60f866 이 Irene «상세 들어가면 상단 헤더가 그대로 있어. 없어져야지» 에 따라 폰 상세 패널을 앱 머리줄을 덮는 전면으로 바꿨다(--pq-panel-top). 아이폰에서는 -webkit-overflow-scrolling 때문에 패널이 앱 머리줄 «아래» 로 깔려 패널 자기 머리줄(‹ 업무명)·태그 줄이 가려졌다 → 10-17 bad1b03e 로 dev 에서 고침, **운영 미배포**. dev 에 Irene 아이폰 접속 기록 없음 → Irene 가 본 것은 운영 앱일 가능성 큼. 운영 로그인 기록 읽기는 권한 거부로 확인 못 함.
- Fable: 10-05 결정은 «UI 레이아웃» 이라 Fable 대상 밖으로 보고 안 불렀다(기록상 Fable 판정 없음).
- 정할 것: A «앱 머리줄 밑에 깔려 패널 머리줄이 안 보인다» 이면 → 이미 dev 에서 고침, 다음 배포로 해소(추가 작업 = 전 상세 패널 3폭·아이폰 모사 감사만). B «앱 머리줄(메뉴·알림)은 남고 패널 머리줄이 그 아래로» 를 원하면 → 10-05 계약을 되돌려 --pq-panel-top 을 폰도 앱 머리줄 아래로(DetailDrawer·TaskDetailDrawer·PanelLayout·QTalk RightPanel·CueHelpDrawer·PostHistoryPanel 등 한 토큰) + mobilechrome 계약·CLAUDE.md 갱신.
- 감사(10-17, dev 빌드 = bad1b03e 포함, 코드 변경 없음): 업무·일정·파일·고객·청구서·Q info 상세 × 폰390/폰390+상태바47/폰360+24/태블릿834+24 — 패널 머리줄 3점 elementFromPoint 모두 패널 안, 폰은 패널이 상태바 바로 아래(앱 머리줄 덮음)·태블릿은 탭 막대 아래, 스크린샷 확인 · e2e mobilechrome·mobilepanels·tabletchrome 실패 0 · 가드 iosstack 통과(소스 0·빌드 0). 아이폰 WebKit 깔림은 크롬으로 재현 불가 — 실기기 확인은 앞 방(47d98562)이 올린 «아이폰 확인» 카드. 운영 반영: 다음 배포 때. Fable 미검증(자체 검증) — 화면 배치·코드 변경 없음.
- 답이 오면(지난): A → 전 상세 패널 감사(폰 390/360·태블릿·앱 상태바 모사, 패널 머리줄 가시성 elementFromPoint) 후 보고. B → 토큰 한 곳 수정 + 같은 감사 + 계약 문서 갱신.

### 완료: 메일 본문 확대 — 전체 화면 [−][100%][+] · 두 손가락 확대 (방 7ca06c7a · 2026-10-17 · [Opus]) — 운영 미배포
- 원문: «메일이 너무 작은 글자로 오면 보기가 어려운데 모바일에서 손가락으로 확대 어렵지? 확대기능»
- 원인: 폰은 넓은 뉴스레터를 폭 맞춤으로 0.4배까지 줄이고(mail-frame.js fitWidth), 페이지 확대는 iOS maximum-scale=1·앱 WebView 로 막혀 있다.
- 고침: 본문 iframe 안에서만 배율 = 맞춤 × 사용자(0.5~3) — mail-frame.js(두 손가락 · 부모 버튼 메시지 · 배율 보고) · MailBodyFullscreen 머리줄 [−][100%][+](평문은 글자 크기) · 전체 화면 srcDoc 은 높이 보고 안 함(frame-id 0 — 뒤 상세 iframe 높이에 섞이던 것). 상세 본문에서도 두 손가락 확대가 먹는다(버튼은 전체 화면에만). 열 때마다 100%.
- 검증: --suite mailzoom 12/12(글자·그림 실제 화면 높이 1.5배 · 핀치 CDP 2점 → 300% · 한 손가락 음성 대조군 · 데스크탑 zoom 미설정) · 양성 대조군(frame-id 되돌림 → 높이 보고 35건 FAIL) · build EXIT 0 · guard 73/74(종전과 같음) · 머리줄 360/390/768 버튼 화면 안·눌림. Fable 안 씀 — 화면 기능, 기계 측정.
- 실기기(앱) 두 손가락은 하니스로 못 잼 → Irene 할 일(check).

### 나중에 — Fable 대기: 내 명함 v2 설계 (방 3b9480e1 · 2026-10-19) · 한도 풀리면(재시도 3회도 한도 — 상황판이 10-20 16:59 뒤 다시 깨움) · 그때 Fable 설계 판정 → 판정대로 구현
- Irene(10-19): 회사·브랜드 분리(회사 하나·브랜드 여러 개 — 이름·간략 설명·사이트/SNS 여러 개 · 워크스페이스 기본 브랜드 · 개인 브랜드) · «이 워크스페이스 기본 명함» 설정과 보여 주는 곳(지금 없음) · 직무 체계(온세상 직무, 계정 언어 한글 + 영어 검색) · 조직에 멤버 추가할 때 직무/역할 선택과 연결 · «제대로 검토해야 하면 fable 기다려».
- 초안 docs/NAME_CARD_V2_DESIGN.md(5절이 Fable 에 묻는 것). 조사: 한국표준직업분류 파일은 공공누리 4유형(상업 이용·변경 금지)이라 그대로 못 씀 → ESCO(EU, 영어 포함 28개 언어·ISCO-08 연결) + 한국어 자체 번역 안. ESCO 이용 조건은 확인 못 함(Fable 이 확인).
- 직책(대표·팀장) / 역할(member_roles — 프로젝트에서 맡은 몫) / 직무(직업) 세 축을 섞지 않는 것이 초안 전제.
- 설계 판정 전이라 구현 시작 안 함(공용 기준). 상황판 Fable 대기 fid fwmvg9wfug(옛 fwmvfrdpfu·fwmvf68euv·fwmveovitt).

### 완료: 내 명함 — 여러 장·자동 채우기·공개 페이지·링크/QR·사진·받은 명함 보관 (방 3b9480e1 · 2026-10-17 · [Opus] · 설계·검증 Fable) — 운영 미배포
- 원문: «내 계정에 내 명함 메뉴를 만들어줘 … 자동으로 불러올 거 불러오고 채울거 채워주고. 수정도 … 종류마다 다르게 … 웹페이지에 제대로 … 링크랑 큐알 … 명함마다 다르게. 사진도 넣으면 나오고 안넣으면 안나오고 … 받은 사람은 다운받아서 저장 … 명함 보관처럼. And나»(끝 «And나» 는 잘린 글로 보고 다루지 않음)
- 설계 docs/BUSINESS_CARD_DESIGN.md(Fable 설계 FAIL 차단 3 → 반영). 명함은 **계정 소유**(name_cards · saved_name_cards), 칸 값은 명함 자신의 값(라이브 연결 아님).
- 서버: routes/name_cards.js(인증, 본인 것만) · routes/name_cards_public.js(무인증 읽기·사진·vcf) · services/nameCard.js(정규화·공개 판정 한 함수·화이트리스트·vCard·사진 EXIF 제거) · ogMeta /c/ · 익명화·data-export 연결 · 감사(공개 켜기/끄기·링크 새로 만들기).
- 공개 링크가 열리는 조건: 공개 켬 ∧ 이름 있음 ∧ 주인 계정 활성 ∧ **이메일 인증됨**(시험 계정 5개는 dev DB·create-test-accounts 로 인증 처리).
- 화면: 내 계정 > 내 명함(/me/cards) · 탭 내 명함/받은 명함 · 편집 드로어(자동저장·사진·강조색·링크·다시 불러오기) · QR 창(PNG 내려받기) · 공개 /c/:token(연락처에 저장 .vcf · 내 명함첩에 보관).
- 운영 적용: migrate-name-cards.js 배포 슬롯(코드 전) · **운영 nginx `location ^~ /c/`** 는 sudo — 배포 사전 점검 2b 가 없으면 경고.
- 검증: 실HTTP 52/52 · health secrets 12/12(새 검사, 양성 대조군 FAIL 확인) · 전체 87/88→raw select 고친 뒤 frontend 4/4 · guard 73/74 · build EXIT 0 · 실브라우저 3폭 73/76(실패 3 = 헤드리스 영어 문구 판정식) · Fable 완료 검증 FAIL 1(nginx 내부 이동으로 noindex 버려짐) → 고침 + 임시 nginx 대조군 · 재판정 없음(2회 한도).
- 확인용(owner ws6): 명함 13 «[확인용] 대표용»(사진) · 14 «[확인용] 강의용(사진 없음)» · member1 명함 15 «[확인용] 디자이너» · 보관본 owner·member1 각 1.
- dev nginx 재적용·실측됨(10-17): Googlebot·Yeti·일반 브라우저·Slackbot UA 모두 `x-robots-tag: noindex, nofollow` · CSP·HSTS 유지 · 화면 정상.
### 완료: 운영 nginx `/c/` 검색 차단 (2026-10-20 Irene 실행 · 운영 백업 /tmp/planq.kr.bak.1792470661) — 실측 브라우저·Googlebot·Yeti·Slackbot 모두 X-Robots-Tag noindex, nofollow · CSP·HSTS 유지 · 홈은 noindex 없음. 스크립트 자체 확인 curl 에 -L 추가(301 만 찍히던 것)

### 완료: 앱(아이패드·아이폰) 구글/애플 로그인 창 교체 (방 4a116d8b · 2026-10-16 · [Opus]) — Fable 완료 검증 PASS · 운영 미배포
- 원문: «아이패드 앱 … 구글계정 자동로그인하는데 팝업이 하얗게 나오고 다시 닫으니까 예전 이상한 코드 넣으라는 잘못된 UI가 그대로 나와. 구글 원터치 로그인 제대로 되게»
- 원인: 앱 로그인 창 = SFSafariViewController 를 popover 로(아이패드에서만 가운데 팝오버 → 하얗게) · 창을 닫기만 해도 «페어링이 열려 있다» 만 보고 6자리 코드 입력창을 띄웠다.
- 고침: ① iOS 앱 안 플러그인 PlanqAuthSessionPlugin(ASWebAuthenticationSession — 사파리 구글 계정 그대로, planq:// 복귀를 OS 가 잡아 창을 닫음, 코드 입력 없음) — AppDelegate.swift + Main.storyboard ② 웹: 플러그인 있으면 그 창, 없으면(옛 앱) 전체 화면 창 ③ POST /api/auth/google/pair/status — 코드 입력창은 브라우저 로그인이 끝났을 때만 ④ 복귀 처리 한 곳 services/nativeReturn.ts.
- 검증: --suite nativelogin 8/8(창 못 뜨면 종전 창 폴백 포함) · pair/status 실HTTP · guard-native-release 새 항목(음성 대조군 FAIL 확인) · guard 72/73 · health 87/87 · build EXIT 0 · pushdeeplink 0.
- 반영: ②③④ 웹 배포 때(옛 앱도 하얀 팝오버·엉뚱한 코드창 해소) · ① 새 앱 빌드(Codemagic) + App Store 심사 필요 — GitHub 푸시함.
### Irene 할 일
- iOS 새 앱 빌드(Codemagic «PlanQ iOS — TestFlight»)·실기기 확인 — 상황판에 올림. iOS 확인창 «로그인을 위해 planq.kr 사용» 1회는 iOS 것이라 끌 수 없음.

### 완료: Cue 고객 자동답변 재료 = 그 고객에 연결된 것만 (방 81843b55 · 2026-10-16 · [Opus] · 설계 Fable) — 운영 미배포 · a0b42a7b
- 원문: «워크스페이스 내용들 중 보안단위가 전체워크스페이스여도 고객에게는 안보이는 거 맞지? 고객은 연결된 곳만 보이는 거야.»
- 있던 구멍: 고객 발화 Cue 답변이 Q info «전체 공개·일반» 워크스페이스 자료 전부 + 그 방 프로젝트 자료 + 운영진 전용(read_policy owner) 자료 + 지식 카드(다른 고객 특성 포함)를 재료로 썼다.
- 고침(Fable 판정 A): access_scope.canClientReadKb/kbClientReadableWhere 한 벌(scope client · client_id/client_ids · 보안등급 일반) — Cue 고객 재료·Q info 고객 판정이 같은 함수 · 지식 카드는 내부 화면만 · 고정 FAQ 는 그대로(고객 답변용 재료) · 다중 고객 자료(client_ids)도 그 고객 것으로 검색.
- 검증: 실호출 20/20(고객 재료에 연결 자료·FAQ 있음 / 워크스페이스·프로젝트·다른 고객·대외비·지식 카드 없음 · 내부 대조군 있음 · 술어 집합 일치) · 새 회귀 health-check kbauth cue_client_kb — 옛 코드로 되돌리면 FAIL · health 87/87 · guard 72/73. Fable 완료 검증 PASS(비차단: 고객 자료 «나만 보기» 등급을 안 본다 — 옛 동작과 같음).
- 남은 것: 고객에게 답할 재료를 넣는 고정 FAQ 화면이 프론트에 없다(API 만) — Fable 이 권한 «고객 자동응답에도 쓰인다» 안내를 붙일 곳이 없음. 워크스페이스 자료를 «고객 공개» 로 표시하는 칸은 신고 오면(Fable: 지금 안 만듦).

### 완료: 묶음 3건 — 시간대 링크 · 새 멤버 시간대 비우기 · 고객 노출 확인 (방 1e4947cc · 2026-10-16 · [Opus]) — 운영 미배포
- 1 ec63a77a: 사이드바 «본인 시간대 설정»·본인/참고 시계 → /me/work-settings#timezone(옛 /profile#timezone 은 시간대 칸이 없는 곳) · 스크롤을 UserTimezoneSection 안으로(라우터 hash). 3폭 실측 통과.
- 2 7cbfa49c: users.timezone NULL 이면 «설정 안 함»(기기 시간대로 채워 «쿠알라룸푸르» 가 내 값처럼 보였다). DB 는 원래 NULL.
- 3 확인만: 고객(client@test, ws6)이 화면·API 로 보는 것 = 연결된 곳만 — 연결 밖 문서·업무·대화·Q info·일정 0건(대표 대조 28·76·39·8). 예외 1: Cue 고객 자동답변이 Q info L3/L4·일반 자료를 연결 무관 인용(cue_context.js:1410, 주석상 의도) → 별 일로 대기열 앞(판정 변경이라 Fable).
- Fable 안 씀 — 링크·표시 버그, 3은 조사만.

### 완료: 멤버 프로젝트 가시성 · 고객→멤버 전환 (방 c6810b76 · 2026-10-16 · [Opus] · 설계 Fable) — 운영 미배포
- 원문: «어떤 프로젝트에서 고객이었는데 같은 이메일로 멤버 가입했는데 그대로 고객이야 … 멤버들은 프로젝트에 들어가 있는 것만 프로젝트 리스트에 나와야 하는데 왜 다 나와? … 자기가 들어가 있는 프로젝트와 그와 연결된 업무들과 일정들만 … 아니면 전체공개분만»
- 설계: docs/MEMBER_PROJECT_SCOPE_DESIGN.md (Fable 설계 판정). 권한 설계서 §1 «열린 문화» 의 프로젝트 예외.
- B 가시성: projects.visibility(members 기본·기존 행도 / workspace) · access_scope.visibleProjectIds·canSeeProject·projectScopeWhere·userCanSeeProject 한 곳 · 목록/상세/업무/일정/대화/파일·문서·Q info/검색/AI 앱/Cue/소켓 방/만들기·옮기기/설문 프로젝트 목록 · 설정 «공개 범위»(관리자·PM) · 카드 «전체 공개» 칩 · 멤버 빈 목록 안내.
- A 전환: services/clientToMember(멤버 초대 수락이 부름) — 고객 행 보관+member_converted_at · 프로젝트 고객→프로젝트 멤버 · 대화 역할 client→member · 멤버를 고객으로 붙이기 409.
- 운영 적용: migrate-project-visibility.js · migrate-client-to-member.js 배포 슬롯 등록(둘 다 코드보다 먼저). dev 실측 «숨겨지는 쌍» 139(멤버 12·프로젝트 37). 옛 데이터 정리는 운영에서 `--apply` 수동.
- 실시간(Fable 검증 FAIL 3회 → 고침): 숨은 프로젝트의 업무 행·대화 본문·팀 메모·이슈·프로젝트 이름이 워크스페이스 방으로 가던 것 → 볼 수 있는 사람(access_scope.hiddenProjectAudience — 현직 프로젝트 멤버 ∪ owner/admin) 개인 방으로만, 나머지엔 신호(taskRoom.emitTask · convBroadcast.emitConvWide · projectRoom.emitBusinessForProject) · 프로젝트 복사 문도 같은 판정 · 좁히거나 멤버를 빼면 소켓 방 회수(socketRevoke.leaveHiddenProjectRooms) · Q sale 고객 초대도 멤버 메일 409 · 폰 프로젝트 설정 2칸→1칸.
- 검증: 실HTTP·소켓 36/36 · 31/31(전체 공개 대조) · 10 · 12 · 9 · 6(내보낸 사람 대조 포함) · 고객→멤버 11/11 + 알림 대조군 · 화면 3폭 18/18 · build EXIT 0(error TS 0) · guard 72/73 · health 85/86(Deepgram 외부 503) · **Fable 설계 + 완료 검증 PASS**(4차, 차단 6건 고친 뒤).
- 확인용(ws6): 프로젝트 714 «[확인용] 참여 멤버만 프로젝트»(owner·member2 참여) · 716 «[확인용] 고객이었다 멤버 된 프로젝트» · 시험 계정 user 1012902 «[확인용] 고객→멤버».

### 완료: 메일 «일정 안내» 기준 — 예약 확정 메일이 확인 권장에도 답변 필요에도 없던 것 (방 b7b3246a · 2026-10-16 · [Opus]) — 운영 미배포 · ab4f3027
- 원문: «스케줄 제대로 예약된 안내인데 확인권장에도 안나오고 답변필요에도 안나와. 이런 미스는 너무 큰데 … 개선 가능해?» (IKEA Kitchen planning appointment KP437429)
- 원인: noreply 발신 → automated_sender → 자동 폴더. 자동 메일을 확인 권장으로 올리는 낱말(돈·서명·보안·가입 완료…)에 «예약·약속» 이 없었다. 같은 계열 dev 28건(Airbnb 예약 확정·리마인더·취소 · AirAsia 확정 · NOL 예약확인서).
- 고침: 새 기준 schedule_notice(확인 권장, 끌 수 있음 — 설정 «메일 분류 기준» 에 보임). 제목 = 예약·약속 + 확정/리마인더/변경/취소 짝 · 한국어 «예약 확정/확인서/변경/취소», «체크인 :» · 본문은 자동 발송일 때만 «예약 번호:»·«Appointment date:» 칸 이름. 광고 «(광고)»·대량 발송 본문·PlanQ 알림·우리가 보낸 것 제외.
- 검증: dev 6,162통 28건 이동 · 엉뚱한 승격 0 · 답변 필요 변화 0 · --suite mail 실패 0(새 8검사) · i18n/parity 가드 통과 · 설정 API 200. Fable 설계+완료 PASS(비차단 3개 반영). dev 워크스페이스 3 의 옛 메일 28건 소급 완료.
- 운영 옛 메일: 배포 뒤 설정 화면 «일정 안내» 미리보기 수를 보고 소급(새 메일은 배포 즉시 적용).

### 완료: 정기 점검 10/17 00:15 — 가드 실패 정리 후 개발완료·배포 (방 e911aa4f · 2026-10-16 · [Opus]) — Irene «권고대로»
- 막힌 것: god-file 래칫 — `routes/signatures.js` 709줄(한도 697, cc15c1b6 이 695 → 709). 배포 게이트도 같은 가드라 배포 불가였다.
- 고침 94ad97f1: 서명 이미지 라우트 → `routes/signature_image.js`(server.js signature_internal 뒤 마운트) · `assertMember` → `services/signatureCore` 한 곳. 669줄. 동작 무변경.
- 검증: 실HTTP 8검사(옮기기 전 기록과 같음) · guard EXIT 0 · health 86/86(첫 회 5건 «fetch failed» = 17:10 밤 검사 중 백엔드 재시작, 다시 돌려 통과) · e2e tenant,signature,signflow,signitems,signinbox 실패 0 · Fable 안 씀(동작 불변 리팩터링).
- 운영 피드백: 열린 9건, 10/08 이후 새 신고 0. #463·#464 답글은 초안 docs/feedback-replies-2026-10-08.json 그대로(앞선 방 결정대로 Irene 확인 후).
- 밤 검사: 10-15 순찰 실패 5 · 전체 검사 141 중 실패 13(mailrt·docscollapse·docsheader·consultlinks·tablefit·tablestyle·tablemenu·taskaddparity·dupname·guestentry·drafts·salelayout·headerrow) — 판정은 다음 고치는 방. 10-16 밤 검사는 점검 시각에 도는 중.

### 완료: 서명 완료본 — 사인+스탬프 2칸인데 1개만 보이던 것 (방 886989c5 · 2026-10-16 · [Opus]) — 운영 미배포 · cc15c1b6
- 원문: «서명1에 사인 서명2에 스탬프 넣었는데 완료 후 사인 하나만 보여 … 문서에 넣은 상태로 봐야 하는 거 아니야?»
- 답: 정본은 문서 본문 서명본(앱·공유 링크·PDF 같은 조립)이고 거기엔 2장 다 들어간다(실측 html 2장 · PDF pdfimages 80×30+60×60). 1장만 보인 곳은 요약 자리 — 문서 «서명 진행» 표 썸네일·공개 서명 «서명 완료» 카드·받은 서명 상세가 첫 장(signature_image_b64)만 그렸다. 받은 서명 상세는 '(present)' 를 그대로 그림 주소로 써 깨진 그림이었다.
- 고침: GET /api/signatures/:id/image?i=<칸>(없으면 0, 서명한 본인도 열람, jpg 허용) · 진행 표·받은 서명 응답 signature_image_count · 공개 서명 GET signature_images(서명 뒤) · 화면 3곳 칸마다 나란히.
- 검증: 실HTTP 12/12(2장 저장·본문 2장·?i=0/1 바이트 일치·?i=2/-1 404·i 없음=첫 장·공개 2장·받은 서명 count 2·고객 403·멤버 200) · 실브라우저 5폭 진행 표 2장 + 공개 완료 카드·받은 서명 상세 폰/데스크탑 2장 · e2e signature 실패 0. Fable 안 씀 — 표시 결함, 본인 서명 열람만 더함(판정 술어 무변경).
- 운영 실례는 못 읽음(운영 읽기 권한 거부) — Irene 문서가 «한 서명자 2칸» 이었는지 «두 서명자» 였는지 확인 못 함.
- 확인용(ws6): 문서 3708 «[확인용] 서명 2칸(사인·스탬프) 완료본»(요청 1643, owner 서명 완료). ws5 문서 3707 도 같은 시험분.

### 완료: Q docs 목록 — 정렬을 아이콘 버튼으로, 검색칸 넓히기 (방 886989c5 · 2026-10-16 · [Opus]) — 운영 미배포 · 5fd46757
- 원문: «문서 리스트에서 검색란이 너무 작아, 정렬 기준이 이렇게 들어가면 어떻게 해? … 모바일은 또 어떤거야? 다 검토해줘.»
- 고침: ListSortSelect variant='icon'(OverflowMenu triggerIcon·triggerActive) — 누르면 «정렬» 목록·체크, 기본(최신 작성순) 아니면 민트 테두리+점. 휴지통과 같은 36(폰 40). 넓은 툴바 3곳(프로젝트 문서 탭·Q info·프로젝트 정보)은 글자 셀렉트 유지.
- 실측(5폭): 검색 상자 1440/1000 87→179px · 820 662 · 390 174→262 · 360 144→232, 안내문 안 잘림, 가로넘침 0, 메뉴 화면 안, 바꿈 표시·되돌림. 대조군(128px 되살림) 입력 49px. e2e docsheader 실패 0. Fable 안 씀(UI 배치).
- 범위 밖: Q file 정렬 셀렉트(키 3종이 다름)는 그대로.

### 완료: 서명 — 이미지 미리보기 폭 · 서명 칸 이름(사인/회사 스탬프) (방 f901a0b2 · 2026-10-16 · [Opus]) — 운영 미배포
- 원문: «서명할 때 이미지 고르기 하면 나오는 창이 좌우로 너무 길게 … 서명 1, 서명 2가 뭔지 모르겠어. 사인인지 회사 스탬프인지 … 없으면 입력란 넣은 사람이 참조 넣어야지»
- 원인 ① 이미지 미리보기 상자가 창 폭 전체(494×140 띠). ② 서명 칸에 «무엇을 넣을지» 담는 자리가 없었다 — 서명자는 «서명 칸 1/2» 만 봤다.
- 고침: 미리보기 280px 이하 · 서명 칸 속성 `caption`(data-caption, 없으면 안 씀 → 옛 문서 바이트 그대로) · 서명 받기 1단계에서 한 사람 칸이 2개 이상이면 칸마다 이름 입력(빈 칸이면 [다음] 막힘) · required_items.captions 로 서명 화면(공개·앱 안) 제목 · 서명본·PDF 칸 머리 «보내는 쪽 · 회사 스탬프» · 손글씨 자리 변환 때 «서명:»·«회사 스탬프:»·«(인)→도장» 으로 자동 이름 · 서명본 속성값 이중 escape 수정. 서버는 이름을 강제하지 않는다(없으면 종전 «서명 칸 n/N»).
- 검증: build EXIT 0(error TS 0) · guard 72/73 · health 86/86(Deepgram 외부 503 제외) · e2e signature 실패 0 · 실HTTP(요청 2명 captions 저장·공개/앱 응답·서명본 표시·& 한 번만 escape) · 실브라우저 3폭 미리보기 494/494/324 → 280/280/280, 넓은 이미지도 상자 안 · 1단계 막힘(빈칸 2 → 1칸 채움 막힘 → 둘 다 채움 풀림, 새로 열어도 값 유지). Fable 미검증(자체 검증) — 표시용 칸 이름, 서명 판정·지문 무변경.
- 확인용(ws6): 문서 3683(서명 요청 중, 칸 이름 있음) · 3684(칸 이름 비어 있음 — 서명 받기 1단계).

### 완료: 사이드바 «메뉴 편집» — 순서 바꾸기·숨기기·더보기 (방 3e1a0e26 · 2026-10-16 · [Opus]) — Irene «권고대로» · 운영 미배포
- 원문: «메뉴를 주요메뉴나 자기가 선택한 순서대로 커스텀하고 가려두고 전체보기 기능이 있게 … 원하면 사용하는 거야. 메뉴 편집?»
- 만든 것: «협업(기능)»·«개인» 칸 제목 옆 연필 → 사이드바 안에서 편집(끌기 · ↑↓ · 눈) · 숨긴 메뉴는 «더보기 (n)» 한 줄(숨긴 메뉴 숫자 합계 배지, 숨긴 메뉴 화면이면 저절로 펼침) · «기본으로 되돌리기» · 대시보드·확인필요·관리·설정 고정 · 숨김 ≠ 권한(검색·탭 + 그대로).
- 저장: business_members.nav_prefs JSON(사람×워크스페이스) · PUT /api/businesses/:id/me/nav-prefs(routes/nav_prefs.js, businesses.js 앞) · 검증 services/navPrefs.js · 읽기 /api/auth/me nav_prefs · 운영 scripts/migrate-nav-prefs.js(배포 슬롯, PM2 reload 전).
- 화면: components/Layout/EditableNavSection.tsx · config/navPrefs.ts(배열 계산) · hooks/useNavPrefsSave.ts · MainLayout 두 칸을 items 배열로(메뉴 줄 모양은 그대로).
- 검증: build EXIT 0(error TS 0) · guard 72/73 · 실HTTP 9검사(저장·재조회·이상한 키 걸러냄·400·고객 403·남의 워크스페이스 403·초기화 null) · 실브라우저 3폭(1440/820/390) 각 17검사 전부 통과(연필 보임·크기 32/36·편집 줄 눌러도 이동 안 함·넘침 0·새로고침 유지·숨긴 화면 저절로 펼침·더보기 펼침·되돌리기=처음 순서) · 접힌 사이드바(아이콘만) 더보기 64×36 · e2e collapsed,inboxcount 실패 0. Fable 안 씀 — 개인 화면 설정(되돌리기 쉬움, 추가 칸 하나), Irene 가 설계 직접 승인 → 자체 검증.

### 완료: 아이폰 앱에서 상세 패널이 앱 머리줄 아래로 깔림 — 업무명·태그 안 보임·스크롤 멈춤 (방 47d98562 · 2026-10-17 · [Opus]) — 운영 미배포
- 원문: «데스크탑에 좌측 헤더가 우측패널 상세영역 열어도 모바일에서 나와. 우측 패널 상세» (운영 로그인 기록: Irene 는 아이폰 앱 iOS 18.7, 폰 모드)
- 원인: 본문 스크롤 상자(MainLayout PageScroll·TabPane·PageShell·Q task ListScroll 등)의 -webkit-overflow-scrolling:touch — 아이폰(WebKit)은 이 상자를 별도 층으로 만들어 그 안의 fixed 상세 패널(z130)이 상자 밖 앱 머리줄(z99) 아래에 깔린다. 크롬은 이 값을 무시해 서버 검사·개발 실측이 늘 초록이었다(10-05 «폰 상세는 앱 헤더를 덮는다» 수정이 아이폰에서만 안 먹은 이유).
- 고침: 19곳 전부 삭제(iOS 13+ 관성 스크롤 기본) · 가드 --category=iosstack 하드 게이트(되살리면 빨간불 대조군 확인). 캘린더 상세(방 «모바일 상세 화면 헤더·스크롤 수정»)도 같은 원인 — 그 방에 알림.
- 실기기 확인 못 함(크롬으로는 재현 불가) — Irene 할 일 «아이폰 … 확인» 카드.

### 완료: 확인필요·업무 상세 — 답하면 «저장 실패» · 폰에서 제목·태그 사라지고 스크롤 멈춤 (방 47d98562 · 2026-10-16 · [Opus]) — 운영 미배포
- 원문: «확인필요에서 업무요청 수정요청 이런거 답하면 에러가 나서 멈춰 … 헤더 … 업무명 못봐 … 뒤로가기는 확인요청으로» + «일반 업무 쪽에서 들어가도 업무명 없어졌어» · «자꾸 위아래 스크롤이 멈춰. 업무명 없어지고 위에 태그 안보이고».
- 원인 ① RichEditor 잠금 전환(setEditable 기본 emitUpdate=true)이 onChange 를 불러 빈 본문(<p></p>) 자동저장 예약 → 확인 요청·완료로 잠긴 뒤 2초 후 PUT → 409 body_locked → 머리줄 «! 저장 실패». (실측: 수정 반영 후 재확인 제출 뒤 PUT {"body":"<p></p>"} 409)
- 원인 ②(추정) 업무 상세 본문 스크롤 상자에만 overscroll-behavior:contain 이 없었다(DetailDrawer.Body 엔 있음). 패널(position:fixed)이 MainLayout PageScroll 안에 그려져 아이폰에서 본문 끝 스크롤이 뒤 상자로 넘어가면 패널째 끌려 올라가는 계열. 헤드리스(크롬)는 스크롤 연결을 «포함 블록» 기준으로 해 재현 안 됨 — 실기기 확인 필요.
- 고침: RichEditor·PostEditor setEditable(x, false) · TaskDetailDrawer Scroll overscroll-behavior:contain.
- 검증: build EXIT 0 · guard 72/73 · 같은 시나리오 고친 뒤 PUT 0건·저장 실패 없음·상태 reviewing · 폰 390/600/768 제목 머리줄 보임 · ‹ 로 닫으면 확인필요.
- 확인용(ws6, member): 업무 4057~4062 «[확인용] 확인필요 업무요청/수정요청 답하기 A·B».

### 완료: 모바일 메모 쓰기 — AI 기능 버튼으로 모으기 · 에디터 메뉴 한 줄 가로 밀기 (방 60743691 · 2026-10-16 · [Opus]) — 운영 미배포
- 원문: «메모쓰기 가면 모바일에서 커서가 안보여 … AI 요약 생성, 업무추출 … 버튼들로 모아서 … 에디터 위에 메뉴가 3줄 … 좌우로 슬라이드 … 다른 기능페이지들도 봐»
- 고침: ① PostEditor 툴바 폰(≤640) 한 줄 + 가로 밀기(Q docs 편집·설문 설명도 같이) ② 메모 상세 요약·업무 밴드 → 밴드2 오른쪽 [AI 요약][업무(후보 수)] 버튼, 칸은 본문 스크롤 안·한 번에 하나·X 로 닫기 ③ 폰 본문 입력 중(키보드)엔 칸·밴드2 접힘(칸 안 입력 중이면 유지). AiAssistButton 에 pressed·count.
- 검증: build EXIT 0(error TS 0) · guard 72/73 · e2e caret,mobilesweep 실패 0 · 실측 4폭 툴바 1줄(37px, 옛 5~6줄 157~187px 대조군) · 키보드 모사 8/8(입력 중 본문 자리 390: 318→365 · 360: 180→261, 칸 강제 표시 대조군 FAIL) · Q docs 편집 폰 1줄. Fable 미검증(자체 검증 — 화면 배치).
- 확인용(ws6): 메모 100000205(요약 있음)·100000206 · 문서 3672.

### 완료: 답장 보낸 주소가 고른 주소(별칭)로 안 보이던 것 (방 5777d091 · 2026-10-16 · [Opus]) — 운영 미배포 · 65cadd84
- 원문: «내가 답변할 때 왜 보낸주소가 선택해서 보낸 도메인이 안나와??? 나 <help@irenewp.com> 받은 주소: nibeas5@naver.com»
- 원인: 실제 발송은 고른 별칭으로 나갔다(운영 읽기 — nibeas5 답장 2건 from_email=help@wor-pro.com, 보낸 메일 80건 중 31건이 별칭). 화면(ThreadMessages 3곳: 메시지 머리·새 창 제목·전체 화면)이 보낸 메일 주소를 늘 계정 주소로 그렸다.
- 고침: from_email(없으면 계정 주소) · 보낸 메일의 수신 라벨 «받은 주소» → «받는 사람»(ko/en).
- 검증: build EXIT 0(error TS 0) · i18n/parity 가드 통과 · 화면 3폭(1440/820/390) 실측 — 별칭 표시·계정 주소 안 보임·«받는 사람»·받은 메일은 «받은 주소» 그대로. Fable 안 씀(화면 표시 버그).
- 확인용(ws6): 스레드 9151 «[확인용] 답장 보낸 주소 — 별칭으로 보냄».

### 완료: 메일 이어 묶기 · 주소 검색 보낸 사람 이름 (방 b2724ed6 · 2026-10-16 · [Opus]) — 운영 미배포 · c5499935
- 원문: «새로 온 메일이 이전 메일이랑 연결해서 안보여주는데? 계속 소통중인데 알 수가 없어. 그리고 이메일주소로 검색해서 해당 내용만 보면 보낸사람 이름이 제대로 안나와.»
- 원인 ① References 마지막 하나만 봤다 — 휴대폰·다른 앱 답장(PlanQ 에 없음)이 끼면 상대 다음 메일이 매번 새 스레드(dev 129건). ② 보낸편지함 사본이 답장보다 늦게 들어오면 답장·사본이 두 스레드로(dev 75건). ③ 제목 접두는 Re/Fwd 두 겹만.
- 고침 services/emailImapCron.findOrCreateThread: References 전부(최근부터) · 거꾸로(이 메일을 가리키는 메일이 있으면 그 스레드, 사칭 격리 스레드 제외) · 접두 «RE[2]:/회신:/답장:/전달:» 여러 겹.
- 검색: 주소(@) 검색이면 그 주소의 사람을 보낸 사람 자리에(services/mailSerialize.searchPartiesByThread) + 검색 이유 «이름 <주소>» · 이름 없는 상대는 워크스페이스가 아는 이름(resolveNamesForEmails).
- 검증: 묶기 7검사(옛 코드 3 실패) · 검색 실HTTP 8검사(옛 코드 3 실패) · guard 72/73 · health 86/86 · Fable 안 씀(새 메일 묶는 규칙의 버그 수정, 데이터 변경 없음 — 자체 검증).
- 확인용(ws6): 스레드 9143~9145 «[확인용] 주소 검색 — …» (검색어 helpdesk@school-check.example).
- 남은 것: 이미 갈라져 있는 옛 대화는 그대로다(새 메일부터 묶인다) — 옛 것 합치기는 아래 답 기다림.

### 완료: 갈라진 옛 메일 대화 합치기 (방 b2724ed6 · 2026-10-16 · [Opus] · Fable 설계 DESIGN-OK · 완료 검증 PASS) — Irene «권고대로» · 운영 미배포
- Fable 판정: 새 메일 묶기 ②(거꾸로)가 반송 메일 쪽으로 끌려가는 회귀(dev 보낸 사본 75건 중 72건) → 우리 사본만·사람 답장만·같은 메일함으로 고침(60d1ab0d). 1·2단계도 같은 메일함만.
- 합치기 `dev-backend/scripts/merge-split-mail-threads.js`(기본 미리보기 · `--apply --expect=<plan>` · `--undo=<run_id>` · `--business` · `--only` 시험용) — 헤더 링크만, 반송·스팸·격리 제외, 같은 메일함, 20개 상한, 고객/프로젝트/공개범위/공유링크 충돌은 건너뜀, 그룹당 트랜잭션, 장부 scripts/out/.
- 옛 링크: `email_thread_redirects` 표(`scripts/migrate-mail-thread-redirects.js`, 배포 슬롯 등록) · 상세 GET 이 옛 번호면 새 스레드 + redirected_from · 화면이 주소를 새 번호로 바꿈.
- dev 실행: 16묶음 · 37스레드 합침 · 실패 0 · 다시 미리보기 0 · 불변식 23/23 · 되돌리기 후 스냅숏 6항목 완전 일치 → 다시 적용. 반송 스레드 3319(288건) 그대로.
- 운영 할 일(배포 뒤 수동): `cd /opt/planq/backend && node scripts/merge-split-mail-threads.js`(미리보기 — 건수를 Irene 에게) → `--apply --expect=<plan 파일>`.
- 확인용(ws6): 스레드 9175 «[확인용] 갈라진 대화 합치기»(옛 9176 링크 → 9175) · 9177/9178 «[확인용] 고객 다른 대화»(건너뜀 확인).

### 완료: 문서·업무 댓글 알림 실제로 오는지 확인 (방 29adeef4 · 2026-10-16 · [Opus]) — 운영 미배포(코드 1줄)
- 원문: «문서에 댓글 달리는 거랑 다른 곳에 댓글달리는 것도 다 알림은 오지? 새로 문서에 댓글기능 단 거 확인해.»
- 실HTTP(시험 계정 4명, ws6) 22검사: 문서 — 작성자·이전 댓글 작성자에게 doc_comment · @멘션 comment_mention(중복 없음) · 고객 댓글 shared 강제 → 팀 전원 · 공유 댓글 → 고객 받음 / 내부 댓글 → 고객 안 받음 · 링크 /docs?post=&comment= · 푸시 sent(구독 있는 대표). 업무 — 담당자·요청자 task 알림 · 멘션 · 개인 메모 0건.
- 고침: 업무 댓글 알림 제목 작성자가 이메일 앞부분(«member1»)이던 것 → 표시명(문서 댓글과 같은 규칙).
- 설계대로(고치지 않음): 멘션만 받고 댓글을 안 쓴 사람은 그 뒤 댓글 알림을 받지 않는다(받는 사람 = 작성자 + 이전 댓글 작성자). 프로젝트 메모는 댓글이 아니라 알림 없음.
- 확인용: 문서 3630·3631 · 업무 4055·4056 «[확인용] 댓글 알림 확인 …»(ws6 프로젝트 35).

### 완료: 운영 배포(배포 버튼, Irene «권고대로») (방 419493aa · 2026-10-16 · [Opus])
- 이 방은 미리보기(dry-run) EXIT 0 까지 하고 일시정지. 그 사이 배포 방이 03:18·03:52 두 번 내보냄(운영 기록 df197a66 · 백업 20261016_035224). 첫 배포에서 운영 메일 목록 500(services/data 빠짐) → db1143b4 로 고친 뒤 재배포.
- 04:23 확인: https://planq.kr/api/health ok · 첫 화면 200 · 운영 PM2 3개 online · confusables-latin.json 있음 · 재시작(04:00) 뒤 메일 500 0건. 남은 미배포 = 6b1411b1(문서만).


### 완료: 확인필요에서 문의·피드백 답 빼기 (방 29399824 · 2026-10-16 · [Opus]) — 운영 미배포
- 원문: «확인필요에 문의/피드백 받는 게 나오는데 … 플랜큐와의 별도 소통 … 업무도 아닌데 알림으로만 오면 되는 거야».
- 10-15 44f6dc17 에서 넣은 확인필요 수집기(collectFeedbackReplies)·feedbackCount·문의·피드백 메뉴 숫자·inbox:refresh 신호를 걷어냄.
  남긴 것: 종 알림(feedbackRespond notify) · /me/feedback 목록 «새 답변» 칩(reply_seen_at, 운영 마이그레이션 슬롯 그대로).
- 검증: 실HTTP — 답 도착(reply_seen_at NULL) 뒤 todo total 6→6 · 문의 항목 0 · 종 알림 1건 · guard 72/73 · build EXIT 0(error TS 0) · e2e inboxcount 실패 0 · Fable 미검증(자체 검증 — 목록 항목 제외·화면 숫자, 대상 아님).
- 확인용: 피드백 #49 «[확인용] 확인필요 제외 확인»(owner ws6, 답 있음·안 읽음).

### 완료(운영 반영됨 — 10-16 03:59 /배포 방 a87a9df6 가 df197a66 배포(db1143b4 포함)): 배포 후 운영 메일 목록 0건 · request_throttled (방 ce0f7668 · 2026-10-16 · [Opus])
- 원인: deploy-planq.sh 보호 목록의 `'data'`(q-note/data 용)가 앵커 없어 `dev-backend/services/data/confusables-latin.json` 이 운영에 안 감 →
  `GET /email-threads` 매번 500(운영 out 로그 03:33 실측) → 화면 apiFetch 폭주 차단이 503 `request_throttled` 로 막음.
- 고침 db1143b4: `'/data/'` 앵커 + `assert_protect_keeps_tracked`(보호 목록이 커밋 파일을 빼면 배포 중단). 대조군 옛 패턴 FAIL·새 패턴 PASS · 운영 q-note/data 보호 유지(rsync -n data 줄 0).
- 운영 반영됨 — 10-16 03:59 /배포 방 a87a9df6 가 df197a66 배포(db1143b4 포함).


### 완료: 정기 점검·배포 버튼이 «배포 스크립트 미커밋» 으로 계속 막히던 것 (방 1740e0b9 · 2026-10-16 · [Opus] · Fable 게이트)
- 원문(서버 방 5b750333 넘김): 10-16 00:15 정기 점검 배포가 다른 방의 미커밋 마이그 슬롯 줄 때문에 deploy-planq.sh 자기-미커밋 검사(10-12 C1)에서 멈춤. Irene «도대체 배포가 언제 되는거야? 왜 이렇게 문제가 지속되는 건데?»
- 고침 ① 11a89574·8498c1ce — 시작 때 HEAD 고정(DEPLOY_PIN) → 그 커밋의 deploy-planq.sh·make-deploy-snapshot.sh 를 /tmp/planq-deploy-self.* 에 꺼내 다시 실행, 사본도 같은 커밋. 미커밋 슬롯 줄은 경고만 하고 불리지 않음. 바꿔치기 대조 두 파일 모두.
- 고침 ② 1761fb14 — 미리보기 배포 중 두 번째 원인 발견: health-check 시험 계정(users 5)의 지금 워크스페이스가 다른 방 시험으로 해지된 73 «WS검증» 이 되어 secrets 3건 실패 → 배포 게이트가 멈춤. 이제 로그인 뒤 «Health Check Biz» 로 스스로 돌아온다.
- 검증: --routine --dry-run 깨끗 EXIT 0 / 미커밋 가짜 슬롯+파일 EXIT 0·가짜 호출 0·마이그 76줄 동일 / 옛 절차 같은 상태 EXIT 1 / 바꿔치기 EXIT 1 / 잔여 0 / health-check active=73 에서 새 판 86/86·옛 판 EXIT 1. Fable 1차(11a89574) PASS — 비차단 1 반영(8498c1ce).
- 남은 것(서버 방 몫): ~/dev-server/morning-check.sh 37·42행 «미커밋 배포 스크립트면 ❌ 로 멈춘다» 문구가 낡음. 다음 후보: 사본 검사에 «슬롯이 부르는 마이그 파일이 커밋에 있는가» 넣기(Fable 비차단 6).

### 완료: dev 링크를 운영 앱이 가로채는 것 — 웹 쪽 차단 준비 (방 272385e0 · 2026-10-15 · [Opus]) — Irene 할 일 1건(sudo)
- 원문(서버 방 56438596 넘김): Irene «상황판 링크가 개발서버인데 모바일에서 앱으로 열려». 옛 스토어 앱(iOS 1.0·옛 안드로이드)이 dev.planq.kr 도 받는다. 앱 쪽 수정(10-09 cap-link-domains.js)은 새 앱 출시 전엔 안 먹는다.
- 판단 ① iOS — **한다.** dev.planq.kr AASA 를 빈 details 로(webcredentials 는 둔다). iOS 는 도메인마다 따로 검증해 planq.kr 링크엔 영향 없음. 대가: Xcode dev 빌드(같은 appID H2HW8BHXNW.app.planq)도 dev 링크를 앱으로 못 연다 — OAuth 복귀는 planq:// 라 영향 없음. 적용은 애플 CDN 이 다시 읽은 뒤(보통 하루~며칠, 앱 재설치하면 바로).
  - ★ `dev-frontend/public/.well-known/` 은 **고치지 않는다** — 배포가 같은 소스의 사본에서 운영 번들을 만들어 운영 AASA 까지 비게 된다. dev nginx 의 AASA location 만 `alias scripts/dev-well-known/apple-app-site-association` 로 돌린다.
  - 스크립트 `scripts/apply-nginx-dev-aasa.sh`(sudo · dev 설정만 · 백업 → 한 줄 바꿈 → nginx -t 실패면 원복 → reload). 복사본으로 시험: 바뀌는 줄은 AASA 블록의 try_files 한 줄뿐.
- 판단 ② 안드로이드 assetlinks 에서 운영 서명 키(6B:F7) 빼기 — **안 한다.** 안드로이드는 설치·갱신 때만 다시 검증해 효과가 작고, 안드로이드 11 이하는 한 앱의 autoVerify 도메인 중 하나만 실패해도 **전체**(planq.kr 포함) 자동 열기가 꺼진다 — 옛 빌드를 새로 까는 사람의 운영 링크가 깨지는 쪽이 더 크다. 새 안드로이드 빌드(planq.kr 만)가 나가면 저절로 해소.
- Irene 할 일: `sudo bash /opt/planq/scripts/apply-nginx-dev-aasa.sh` — 상황판에 올림. 끝나면 `curl -s https://dev.planq.kr/.well-known/apple-app-site-association` 이 `"details": []` 인지 확인(운영 planq.kr 은 그대로여야 한다).

### 완료: 메일 사칭 검사 + 스팸 기준 안내·관리 (방 92bad145 · 2026-10-15 · [Opus] · Fable 설계 + 게이트 PASS) — 운영 미배포
- 원문: 스팸을 어떻게 거르는지 안내돼 있나 · 기준·스팸관리 기능 · 유사 도메인 피싱(숨김 문자·다른 언어 문자·혼동 도메인) 검사 → 의심 경고·강하면 격리·복원 · 한글 도메인 보호 · 원 메일함 이동은 구분.
- 설계 docs/MAIL_IMPERSONATION_DESIGN.md. 판정 services/mailImpersonation.assess 한 함수(혼동 문자 services/data/confusables-latin.json ← scripts/gen-confusables.js, Unicode 18.0.0).
- 격리 = 스팸 폴더(spam_origin='impersonation' · criterion impersonation · 새 스레드 · 알림/고객연결/첨부/자동추출/규칙 제외 · 상세 링크 off · 30일 보존) / 약 신호·아는 상대·풀어 준 스레드 = «사칭 의심» 배지. [스팸 아님] = released_at(재격리 안 함). 업체 메일함에는 안 쓴다.
- 화면: 목록 배지·스팸 행 이유 · 상세 안내 줄(신호별 이유 + 도움말 링크) · 설정 기준 «사칭 의심 격리»(끌 수 있음) · 규칙 목록 «스팸으로 차단 N» 거르기 · 도움말 «스팸·사칭 메일은 이렇게 거릅니다»(로그인 전용) · 메일 알림 제목에서 숨김/방향 문자 제거.
- 검증: 카나리 --suite mailimpersonation 20/20 · 실수집+실HTTP 22/22 · 화면 3폭 24/24 · build EXIT 0 · guard 72/73 · secrets 11/11 · dev 소급 후보 0 · Fable 운영 읽기 시뮬 새 격리 후보 0.
- 운영: 배포 슬롯 migrate-mail-impersonation.js(코드 전) · 배포 뒤 수동 `node seed-wiki-content.js`(도움말) · 옛 메일 배지 `node scripts/retriage-mail.js --impersonation`(dry-run → --apply).
- 다음 사이클 후보: Fable 비차단 ② judgeThread 에 impersonation 싣기 · ③ «풀어도 같은 보낸이 새 메일은 다시 격리» 안내 한 줄.
- 확인용(ws6): 메일함 «[확인용] 사칭 검사 메일함»(account 425, is_active=0 — 켜 두면 가짜 IMAP 동기화가 돈다) · 스레드 9037~9053 · 규칙 64 spam-check-confirm.example.

### 완료: AI 앱 연결 여러 워크스페이스 (방 35bb469f · 2026-10-15 · [Opus] · Fable 설계 + 게이트 PASS) — 운영 미배포
- 원문(상황판): ChatGPT 연동에서 허용된 워크스페이스 목록 조회 + 모든 도구에 workspace_id 지정 · 서버가 매 요청 검증 · 결과에 실제 워크스페이스 이름/ID · 대체 금지 · 생략 = 지금처럼.
- 설계 docs/AI_AGENT_MULTI_WORKSPACE_DESIGN.md (§5 Fable 판정 10개 반영).
- 서버: `agent_grants.extra_business_ids`(`scripts/migrate-agent-multi-ws.js` · 배포 슬롯) · grants.resolveWorkspace 한 곳 · execute 키에 워크스페이스 · 결과 workspace · list_workspaces · 동의 POST · 연결 목록 · 온보딩 · 가드 agentsurface 6줄.
- 화면: 동의 화면 «다른 워크스페이스도 함께 허용» · 연결 목록 워크스페이스 줄 · 해제 확인창 «연결 전체» · 도움말 connect-chatgpt-claude 문구(dev 시드 실행).
- 검증: 실 OAuth+MCP 30/30 · 메일·Cue·principal 7/7 · 화면 3폭 24/24 · agentconsent 실패 0 · build EXIT 0 · guard 72/73 · 양성 대조군 6/6 · secrets 11/11.
- Fable 게이트 PASS(독립 60/60) · 비차단 ③ null 허용 고침 · 기록 docs/FABLE_GATE_QUEUE.md 맨 위.
- 운영: 배포 슬롯 migrate-agent-multi-ws.js(코드 전) + 도움말 seed-wiki-content.js.
- 확인용: ws7 업무 «[확인용] 다중 워크스페이스 시험 …» · health-check 계정 시험 연결은 해제함.

### 답 기다림 (이전): 급여 P2~P4 — 프론트 빌드 다시 돌리기 (방 cd3690dc · 2026-10-15 · [Opus])
- 무엇: 서버(e0fb9f64)는 끝·실HTTP 84/84 · 계산 검산 37/37 · 가드 통과. 화면(회차·대조·항목·내 명세서) 코드는 커밋했지만 `npm run build` 가 서버 메모리 부족으로 Claude Code 가 강제 종료했다(첫 빌드는 끝까지 돌아 TS 오류 2건 = 안 쓰는 import → 고침). 강제 종료된 작업은 지시 없이 다시 돌리지 않는다.
- 답이 오면: ① `cd /opt/planq/dev-frontend && npm run build`(백그라운드) EXIT 0 확인 ② 실브라우저 점검 `node /home/irene/.claude/jobs/cd3690dc/tmp/ui-payroll.js <11월 회차 id>`(없으면 같은 내용을 다시 짠다 — 3폭 × 대표/직원, 가로 넘침·보임·계좌번호 0) ③ (Fable 은 서버로 PASS 받음 — 다시 안 부름) ④ test-payroll-*.js 지우고 /개발완료. Fable 비차단 ②(송금 담당≠확정자면 배정 메일)·③(canary-tenant 에 급여 라우트) 는 다음 사이클 후보.
- 결과(2026-10-15): Irene «권고대로» → 빌드 EXIT 0 · 실브라우저 3폭 72/72(명세서·사람 서랍 항목 줄 잘림을 찾아 고침 73a0814a) · 시험 스크립트 삭제. 다음 사이클 후보 = Fable 비차단 ②③④⑤.
- 확인용 데이터(ws6): 2026-11 회차(지급완료) + 정정 1 · [확인용] 김가상·이가상 · 박개발 무급휴가 [확인용] 2건 · 항목 KR-employee/KR-freelance.

### 답 기다림 (이전): 급여·휴가·직원 통합관리 — 범위를 «급여 정리·대조 도구» 로 넓힐지 (방 671b6a35 · 2026-10-15 · [Opus]) — Irene «권고대로» + «사용할지 말지 정해서 사용하게» → 설계 진행 중(아래 «진행 중»)
- 무엇: Irene «의견부터» 요청. 정찰 계획 `.claude/plans/qmv7o9zh4.md`(이미 있는 것·흐름·표 초안·단계 P0~P5).
- 왜 결정이 필요: 8/18 근태 설계(`docs/ATTENDANCE_LEAVE_DESIGN.md` §1)가 급여를 «비범위» 로 못박았다 — 그 결정을 바꾸는 일이다. 돈·개인정보·계산이라 Fable 설계 대상.
- 권고(Opus 의견): 한다. 단 «급여 계산 엔진» 이 아니라 «계약 → 이달 초안 → 세무사 대장 대조 → 확정 → 명세서·송금 할 일» 도구. 법정 공제(4대보험·소득세)는 **세무사 대장 값이 정답**, PlanQ 계산은 대조용 예상치. 항목은 사용자가 정의(지급/공제·과세/비과세·정산분·계산방식) → 나라와 무관. 프리랜서 포함(3.3% 정률은 계산), 보는 사람 = 대표 + 지정 급여 담당자(admin 자동 아님), 직원은 자기 명세서만, 주민번호 저장 안 함·계좌 암호화, Pro 요금제. 근로계약서 템플릿 문구는 노무사 검수 권고.
- 답이 오면: «예» → /기능설계 로 Fable 설계 1회(P1~P4 표·권한·계산·월급 정본 충돌 — `BusinessMember.monthly_salary` 와 유효 계약 기본급) → P0(계약서 템플릿 3종)부터 구현. «아니오/보류» → 이 절을 (이전) 으로.
- ★ 붙여 준 9월 급여대장은 실명·실급여다 — 시드·시험·문서 예시에 옮기지 않는다(칸 구성만 참고).

### 나중에 — 다중 담당자 «주 담당 + 공동 담당» 설계·구현 · 급여 기능(P0~) 이 끝난 뒤 · 그때 /기능설계(Fable 설계 1회) 후 구현 (Irene 2026-10-15 «권고대로» — 급하지 않으니 급여보다 뒤에)
#### (이전) 답 기다림: 다중 담당자 «한 명씩 완료 → 최종 완료» — 방식 (방 671b6a35 · 2026-10-15 · [Opus]) — 코드 변경 없음
- 무엇: Irene «검토만 먼저». 정찰 계획 `.claude/plans/qmv7sjmz7.md`.
- 사실: 담당자는 `tasks.assignee_id` 하나(백엔드 39파일·프론트 30파일이 읽는다). 컨펌자는 이미 여럿 + all/any 정책(`task_reviewers`·`recalcStatusFromReviewers`) — 같은 모양을 담당에 붙이면 된다.
- 권고: 방식 B «주 담당 + 공동 담당» — `assignee_id` 는 책임자 그대로, 공동 담당 표(사람별 «내 몫 완료») + 정책(기본 전원). 충족되면 컨펌자 있으면 확인 요청, 없으면 승인완료 → 주 담당이 «최종 완료». 공동 담당은 결과물(body)은 못 고치고 자기 시간만. 통째로 다중(A)은 358곳 수정이라 비추천.
- 크기: 큼(새 표 + 상태 전이 생명선 + 공개범위 술어) → Fable 설계 필요. Irene «꼭 필요하진 않다» → 우선순위 낮음.
- 답이 오면: «예» → /기능설계(Fable 설계 1회) 후 구현 · «나중에» → 🕓 로.

### 완료: 긴급 업무요청 알림 강화 (방 671b6a35 · 2026-10-15 · [Opus]) — 운영 미배포
- 원문: «긴급으로 선택한 업무요청은 요청받은 사람에게 팝아웃 업무리스트에도 · 모바일앱 알림도 확실하게 · 무조건 보게».
- 알림 한 문 `services/urgentTaskNotify.js` — 미확인 긴급 요청(확인필요 ① 버킷 술어 + priority_level urgent)이 될 때(생성 · 보통→긴급 전이 · 담당자 변경) 담당자에게 «[긴급] Q Task · 업무 요청 · …» 1건(그때 나가던 «새 업무 배정» 대신). 같은 업무·사람 10분 안 재발송 없음. 본인 업무·확인한 업무·같은 값 재저장은 0.
- `notify({urgent})` → 푸시 tag 업무별 · 웹 PWA `requireInteraction`(닫을 때까지)·긴 진동(sw.js) · iOS `interruption-level: time-sensitive` · Android `PRIORITY_MAX`+잠금화면 공개 · 소켓 `notification:new.urgent` → 앱 안 토스트 빨간 띠.
- 화면: 업무 추가 폼에 «긴급으로 요청» 토글(담당자가 남일 때만, POST 에 `priority_level`) · 팝아웃 맨 위 «긴급 요청 n건» 띠(`PopoutUrgentBand` — my-week `urgent_requests`, 마감 없는/다음 주 요청도 · [확인]=ack · 새 요청이면 소리 + 창 제목 깜빡임).
- 검증: 실HTTP 16/16 + 재배정 1 · 화면 3폭 13/13 · build EXIT 0 · guard 69/70 · **Fable 게이트 PASS**(독립 실HTTP 26/26, 비차단 6 — docs/FABLE_GATE_QUEUE.md 맨 위). 커밋 1bfa57c1.
- 다음에 고칠 것(Fable 비차단 ①): 10분 재발송 억제가 되돌린 재배정의 «배정» 알림까지 삼킴 — 억제에 걸리면 보통 알림으로 떨어지게.
- 남김(앱 빌드 몫): iOS 집중 모드 뚫기는 앱에 time-sensitive 엔타이틀먼트가 있어야 적용(지금은 보통 알림으로 온다) · 실기기 확인 못 함.
- 확인용: 업무 3950 «[확인용] 긴급 요청 시험»(member1 → member2, ws6, 미확인).

### 완료: 역할 사전 — 공통 기본 + 태그관리처럼 커스텀·동기화 (방 c8f9ad50 · 2026-10-15 · [Opus] · Fable 설계 + 게이트 PASS) — 운영 미배포
- 원문: «역할들이 개발/디자인/기획 개발팀 기준 … 기본세팅은 공통 · 태그관리처럼 커스텀 · 설정에서 하거나 각 UI 에서 동기화».
- 설계 docs/MEMBER_ROLES_DESIGN.md: 워크스페이스 역할 사전 `member_roles`(쓰는 문 services/memberRoles 한 벌) · 글자 그대로 저장(개명 = 같은 워크스페이스 두 칸 일괄) · 기본 7개(기획·디자인·제작·영업·마케팅·운영·고객지원 / en) · 잡값(기타·팀원·오너·owner·member) NULL · 프로젝트 역할 = 멤버 «기본 역할» 같은 사전, 넣을 때 미리채움 · 추가 멤버 이상, 이름 변경·삭제 owner/admin · 실시간 member_role:updated.
- 화면: 설정 > 멤버 «역할 관리»(태그 관리창을 공용 DictManageModal 로 빼서 같이 씀) · 새 프로젝트·프로젝트 상세·멤버 기본 역할·초대 폼 = RolePicker(고르기 + «'xx' 역할 추가» + «역할 관리…»).
- 운영: scripts/migrate-member-roles.js — 배포 슬롯 sync-database **앞**(dev 실행함: 118곳 834행).
- 검증: 실HTTP 30/30 · 화면 3폭 50/50(2창 동기화 포함) · 태그 창 회귀 4/4 · build EXIT 0 · guard 72/73 · secrets 11/11 · Fable 1차 FAIL(배포 순서) → 고쳐 2차 PASS.
- 남김: 업무 템플릿 role_hint 는 범위 밖(설계 6) · health-check invite_mail 픽스처 낡음(다른 변경).
- 확인용: 프로젝트 660 «[확인용] 역할 사전 시험»(ws6, 멤버 역할 기획·디자인·[확인용] 현장 진행).

### 진행 중인 작업
- 없음 (이 방 기준). 급여 P2~P4 는 상황판 대기열 맨 앞(설계 docs/PAYROLL_DESIGN.md §10).

### 완료: 급여·계약 관리 — 설계 + P0 + P1 (방 671b6a35 · 2026-10-15 · [Opus] · Fable 설계) — 운영 미배포
- 원문: 급여처리(계약 → 정산 → 세무사 대장 대조 → 명세서 → 송금 할 일) · 정규·계약·프리랜서 · 항목은 사용자가 정의. Irene «권고대로» + «사용할지 말지 정해서 사용하게 할 수 있어?»
- 설계 docs/PAYROLL_DESIGN.md(Fable): 급여는 «계산» 이 아니라 «정리·대조·확정» — 법정 공제는 세무사 대장 값이 정답, PlanQ 숫자는 예상치. 기능 스위치 businesses.modules(payroll 기본 끔). 보는 사람 = 대표 + 지정 담당자(admin 자동 아님). 8/18 근태 설계 §1 «급여 비범위» 를 넓힘.
- P0(c45d87b1): 직원 계약서 템플릿 3종 × ko/en(seed-document-templates.js, schema_json 칸 → SlotFormModal, 근로기준법 §17 칸, 주민번호 칸 없음, «검수 전 초안») · 칸 채우기 미리보기를 HTML 글자 → 문서 모양 · 시드 배포 슬롯 등록. 검증: 시드 2회 멱등 · 본문 칸=입력 칸 6/6 · API · 화면 2폭 8/8.
- P1(470e7ba9): migrate-payroll.js(표 4 + modules, 멱등, 배포 슬롯) · services/modules·payrollAccess·payrollContracts·signatureHooks · routes/payroll.js · PUT /businesses/:id/modules(owner·Pro/체험) · auth/me modules·can_manage_payroll · memberCost source 'contract' · 단가 화면 «계약에서 옴»·월급 직접 수정 409 · 화면 /payroll(목록·상세 서랍·계좌 [보기]·계약 이력 초안→유효→종료) · 설정 «기능 사용»·«급여 담당자» · 사이드바(근태 옆, 관리자만) · 가드 --category=modulegate(양성 대조군 뒤집힘) · health-check secrets 급여 계좌번호 0.
- 검증: 실HTTP 54/54(끔 404·platform_admin 404/403·member/admin/client 403·지정 담당자 200·내보낸 담당자 403·free 409·계좌 원문 0·열람 감사·같은 날 활성 409·옛 계약 superseded·서명 모두/일부·memberCost contract↔끄면 복귀·끄기 데이터 보존) · 화면 3폭 첫 재실행 실패 0 · build EXIT 0 · guard 70/71 · health 85/86(invite 0-F 는 기존·다른 방) · e2e tenant,signature 실패 0. Fable 미검증(자체 검증) — 설계상 Fable 완료 검증은 P4 끝에 1회.
- 남김: ① 근태(attendance) 스위치는 다음 단계 — 근태 라우트가 워크스페이스를 찾는 방식이 제각각이라 서버 가드 품이 큼(설계 §2.2) ② 본인 계약·명세서 열람 화면은 P4(/me/payslips) ③ 계약서 문서 «만들기» 버튼(템플릿 변수 자동 채움)은 미구현 — 지금은 Q docs 템플릿으로 만들고 계약에 연결은 API(post_id)만 ④ dev ws6 를 plan 'pro' 로 올려 둠(확인용, 원래 free).
- 확인용: ws6 대상자 박개발(계약 2건: 변경됨·유효, 계좌 «시험은행 110-123-456789») · [확인용] 프리랜서 박가상 · [확인용] 프리랜서 최가상 · 급여 담당자 = 이디자(member1).
- 계약서 템플릿 검수(2026-10-15 후속): Irene «각자 관리자들이 할 일 · 기본 점검은 너가 해» → 할 일 카드 뺌. 방이 법정 필수 기재(근로기준법 §17·기간제법 §17)를 6벌 대조, 보강 4건(프리랜서 원천징수는 비사업자 개인일 때만·최저임금 이상·기간제 2년 초과 무기계약 간주·설명 «기본 틀 — 회사 사정에 맞게»).

### 완료된 작업 (이번 개발완료에 기록)
- 문서(Q docs) 댓글 — Fable 설계 + 게이트 PASS (아래 첫 절)
- 10/12~10/15 방별 작업 묶음 — DEVELOPMENT_PLAN.md «2026-10-12 ~ 10-15 방별 작업 묶음» 표에 목록으로 옮김(상세는 아래 각 절)

### 다음 할 일
- 운영 반영: 다음 배포 때(배포 방). 문서 댓글은 배포 슬롯 `migrate-post-comments.js`(PM2 reload 전) + 도움말 `seed-wiki-content.js` 운영 실행 필요.
- 대기열 앞: 비가입 고객 직접 관리(정찰 qmv7hp0uc) — 완료됨(d1871180). 답변필요 메일 분류 고도화 — 완료(28cf8581).
- 별건 확인: 업무 상세 응답이 멤버에게 남의 personal 댓글을 싣는지(아래 첫 절 «곁에서 본 것»).

---

### 완료: 고객 화면 한 벌로 — 설정 > 고객 을 Q sale 로 합침 (방 d1871180 · 2026-10-16 · [Opus] · Fable 설계 + 게이트 PASS) — 운영 미배포
- 원문: «원래 설정에 고객리스트와 큐세일즈에 고객이랑 또 따로 만들었어? 큐세일즈랑 연결이나 합쳐서 제대로 구성되게 점검 해줘»
- 점검: 데이터는 한 벌(clients)인데 화면이 네 벌(설정 > 고객·Q sale 고객 탭/패널·Q sale 상세·고객 타임라인). 설정 드로어는 계정 없는 고객의 연결 프로젝트를 0 으로 보였다(dev 5명) · 권한 키 두 개.
- 설계 docs/CLIENT_SCREENS_MERGE_DESIGN.md (Fable 판정: Q sale 하나로).
- 서버: 권한 키 `qsale` 하나(`clients` 폐지, `migrate-menu-key-clients.js --apply` 배포 슬롯 — 더 좁은 쪽·옛 행 보존) · sale 상세 `billing`·`notes`·`reinvite_count`(옛 `biz` 대체) · `clientAccess.projectLinkWhere/projectsByClient` 한 벌 · 목록 `project_count`·`?status=` · PUT 저장 뒤 방송(옛: 안 바뀐 경우에만 방송) · removal-impact 삭제(호출처 없음).
- 화면: `components/Clients/`(ClientStatusBanner·ClientRecordSections·ClientBillingInfoForm·ClientNotesSection·ClientAuditHistory·ClientAddDrawer·LegacyClientsRedirect) · Q sale 패널/상세에 같은 절 · 고객 탭 이메일·프로젝트 열·보관 필터·엑셀·[+ 고객 추가] · 옛 주소 리다이렉트 · 메뉴 «고객·파트너» 제거 · 삭제는 대표에게만 노출.
- 검증: 실HTTP 권한·연결·사업자·필터 14/14 · 소켓 방송 대조군 뒤집힘 · 화면 3폭 44/44 + 보관 메뉴 대조군 · build EXIT 0 · guard 72/73 · health-check 86/86 · e2e tenant·clientlink·salecriteria·detailopen 0 · **Fable 게이트 PASS**(비차단 5 — docs/FABLE_GATE_QUEUE.md 맨 위).
- 운영 반영: 다음 배포 때 — 배포 슬롯 `migrate-menu-key-clients.js --apply`(코드보다 먼저) · 도움말 문구 `seed-wiki-content.js` 운영 실행 필요.
- 확인용: ws7 «[확인용] 통합 시험»(1687·1688) · ws6 고객 66(계정 없음·프로젝트 연결).

### 완료: 설정 › 청구에 카드 결제 «설정 방법» 안내 (방 1d520029 · 2026-10-16 · [Opus]) — 운영 미배포
- 원문: «이거 개발 다 했어? 그럼 그냥 워크스페이스에 제대로 안내를 해. 나중에 거기 보고 진행할게. 워크스페이스 유저라고 생각하고 대응해줘.»
- 상황판 할 일(Stripe 키·웹훅·대금 받는 곳)을 화면 안 안내로 옮기고 할 일 카드는 뺐다(todomv9g0580 drop).
- `pages/QBill/CardPaySetupGuide.tsx`: Stripe 6단계(사업자 확인 주의 · 웹훅 주소 복사 · 이벤트 2개 · 키 · 대금 받는 곳/공개 상호 · 1,000원 시험) — 미설정이면 펼침 / 카드 결제 링크 5단계(접힘). 대시보드 바로가기 링크.
- 단계 모양은 공용 `components/Common/setupSteps.tsx` 로 뺐다(프로필 › AI 앱 연결과 한 벌, 값 그대로).
- 검증: build EXIT 0 · guard 72/73 · 브라우저 3폭 16/16(안내 보임·단계 수·웹훅 주소 ws6·펼침 상태·접고 펴기·가로 넘침 0 · AI 앱 연결 회귀 4단계 18px). Fable 안 씀 — 안내 문구·화면.

### 완료: 청구서 외부 카드 결제 링크 + 카드 «대금 받는 곳» 표시 (방 1d520029 · 2026-10-15 · [Opus]) — 운영 미배포
- 원문: «스트라이프는 그대로 두고 결제링크 … 한국 고객에게 적합한거» → A안 «권고대로» · «카드결제 과정에 대금 수신자 정보가 표시되어야지. 미리 설정에 입력한 걸로».
- 서버: `services/cardPayLink.js` 한 곳(https + 결제 대행사 도메인 목록 · 대금 받는 곳 정규화·공개 표시) · 컬럼 `invoices.card_pay_url`·`invoice_installments.card_pay_url`·`businesses.card_payees`(JSON, 수단별 stripe/link) ·
  `PATCH /api/invoices/:biz/:id/card-pay-link`(owner 게이트 = 발송·결제 마킹과 같은 선, 분할은 회차 id 필수, 결제 완료·취소 400, 감사 `invoice.card_pay_link`) · 설정 `PUT /billing card_payees`(owner/admin) · 공개 청구서 응답에 `card_pay_url`·`card_payees`(링크 수취인은 비면 공급자).
- 화면: 청구서 상세 «카드 결제 링크» 칸(`CardPayLinkSection`, 발행 뒤·owner, 회차별) · 설정 › 청구: Stripe 칸 아래 «대금 받는 곳» + 새 «카드 결제 링크(국내 결제 대행사)» 칸 · 고객용 청구서: «카드로 결제»(새 창, Stripe 와 함께면 «국내 카드로 결제») + «대금 받는 곳: 상호 · 등록번호».
- 결제 결과는 받지 않는다 — 확정은 지금처럼 «결제 완료» 표시. Stripe 결제창 위 상호는 Stripe 대시보드 공개 상세정보가 정한다(코드로 못 바꿈 — 설정 문구에 안내).
- 운영: `migrate-card-pay-link.js` 배포 슬롯 등록(PM2 reload 전).
- 검증: 실HTTP 26건(분 판정 2건은 판정 쪽 — 감사 4행 확인 · http 는 앞단 SSRF 장치가 400) · 브라우저 3폭 26/26 · build EXIT 0(error TS 0) · guard 72/73 · health-check secrets 11/11. Fable 안 씀 — 돈 계산·이동 없음(링크 표시 + 수동 확정), 공개 응답에 필드 2개 추가만.
- 확인용: 청구서 4864(단일, 토스 링크) · 4865(분할, 1회차 페이앱 링크) · ws6 설정 대금 받는 곳 [확인용] 두 칸.

### 답 기다림 (이전): 워크스페이스 국내 결제링크(토스 링크페이·페이앱)를 청구서에 붙일지 — Irene «권고대로»(A) → 아래 완료 (방 1d520029 · 2026-10-15)
- 무엇: A 청구서별 «외부 결제 링크» 칸 + 고객용 청구서 화면 버튼(입금 확인은 수동 결제 완료) / B 토스페이먼츠 API 직접 연동(자동 완료 — Fable 설계 먼저) / C 안 함.
- 왜: Irene «스트라이프는 그대로 두고 한국 고객에게 적합한 결제링크». 지금 청구서에는 외부 결제 링크 칸이 없다(확인함).
- 답이 오면: A → 기술 설계 요약(Invoice 컬럼 1개 + 발행 모달 입력 + 공개 청구서 버튼, https 주소만 허용) 후 구현·검증.

### 완료: 검토 — 구독 Stripe 원화 결제 · 워크스페이스(워프로랩) 카드 청구 점검 (방 1d520029 · 2026-10-15 · [Opus]) — 코드 변경 없음
- 원화: `services/money.toMinorUnits` 가 KRW 를 무소수점으로 보낸다(330000원 → 330000). 구독·Q Bill 같은 함수. 문제 없음.
- 워크스페이스 카드: 키 3개(pk·sk·whsec) + 웹훅 `/api/stripe/webhook/ws/<biz>` 등록이면 켜진다. 서버도 키 둘이 없으면 403. 같은 Stripe 계정을 구독과 같이 써도 두 웹훅이 서로의 결제(metadata.kind)를 무시한다.
- 확인 못 함: 운영 DB 읽기(SSH)가 권한에서 막혀 운영 키 상태·워프로랩 id·APP_URL 을 못 봤다.
- 작은 지적(고치지 않음): 웹훅이 `payment_status==='paid'` 를 안 본다(카드만 쓰면 무관, 지연 결제수단을 켜면 위험).
### Irene 할 일
- 워프로랩 청구서 카드결제 켜기 — 상황판에 올림(todomv9g0580). 먼저 세무사 확인: 한국 법인 청구서 대금이 말레이시아 법인 Stripe 로 들어가는 구조.

### 완료: 상황판 묶음 3건 — 문서 업무 연결 · 프로젝트 일정 탭 보완 · 앱 다운로드 컴퓨터 설치 (방 42e04bed · 2026-10-15 · [Opus]) — 운영 미배포
- ① 문서 작성·수정 «업무 연결»: 편집 줄(MetaRow)에 `components/Docs/DocTaskLinkField` — 연결 정본은 그대로 업무 결과물 첨부(task_attachments.post_id, context task). 걸기 = 기존 `POST /api/tasks/:id/attachments/link`, 떼기 = 기존 `DELETE /api/tasks/attachments/:id`.
  해제 술어를 `services/taskAttachmentLink.canRemoveTaskAttachment` 한 곳으로 빼서 삭제 라우트와 `linkedTasksOf`(attachment_id·can_unlink 추가)가 같이 쓴다. 고르는 부품은 일정 것을 `components/Common/TaskLinkPicker` 로 옮겨 공용(excludeIds·testId). 칩 `LinkedTaskChips` 에 onRemove(×). 새 문서는 고른 업무를 들고 있다가 첫 저장(자동 초안·저장 버튼 둘 다)에 건다. 개인 보관함엔 칸 없음.
  검증: 실HTTP 9/9(연결·중복 없음·member can_unlink=false·member DELETE 403·남의 워크스페이스 업무 403·해제) · 브라우저 3폭 18/18(× 해제→서버 0 · 골라 연결→서버 1 · 새 문서 첫 저장 뒤 업무에 1건).
  남김: 업무 첨부 link/delete 라우트가 실시간 방송을 안 한다(기존 결함, 정찰 계획 4) — 업무 상세를 열어 둔 사람은 새 연결을 다시 열어야 본다.
- ② 프로젝트 > 일정 탭(Q calendar 본체 얹기) 보완: 죽은 Google 토글·캘린더 칩 제거(googleOn = !embedded && 연결) · 액션 줄 + 년/월 줄 두 줄 → 한 줄(폰은 다음 줄) · 높이: 바깥 스크롤 1440 176px·1024 172px → 0(얹는탭 껍데기 ProjectTabFull + 안쪽 여백 ProjectCalendarInner, 일반탭과 같은 x) · 층 선택 기억을 Q calendar 와 분리(`planq:calendar-layers:project`) · 보기·날짜 프로젝트별 기억(sessionStorage `pq:projcal:<id>`).
  검증: 3폭 11/11 · projecttabs·docsheader·tenant 0 실패. Google 0 은 dev 시험 계정이 구글 미연결이라 대조 못 함(코드 판정만).
- ③ /app 앱 다운로드: 데스크탑에서 맨 위 «이 컴퓨터 (Windows · Mac)» 카드 — 설치 창이 되면 [이 컴퓨터에 설치](usePwaInstall), 아니면 브라우저별 메뉴 단계. 단계 함수를 `utils/pwaInstallSteps` 로 빼 설정 > 앱 설치와 공용 · 데스크탑 Safari 문구를 «파일 → Dock에 추가»(Sonoma+)로 정정 · 부제·알림 문구·seo-pages /app 문구 컴퓨터 포함.
  검증: 3폭 10/10(폰 UA 엔 컴퓨터 카드 없음). 설치 버튼 분기는 헤드리스가 설치 창 신호를 안 받아 ⬜ 미측정(메뉴 단계 분기만 확인).
- 확인용: 문서 3187 «[확인용] 문서 업무연결 시험»(프로젝트 35, 업무 157 연결) · 임시저장 «[확인용] 새 문서 업무연결»(업무 157 연결).
- 공통: build EXIT 0 · guard 69/70 · health-check 84/85(invite 0-F 는 다른 방 것).

### 완료: 메일 분류 기준 공개·새 기준·학습 확대 + Q sale 상담 기준 (방 28cf8581 · 2026-10-15 · [Opus] · Fable 설계 + 게이트 2차 PASS) — 운영 미배포
- 원문: Aspiration 학교 자동응답(«We have received your email»)을 놓침 · «자동메일이어도 주문·답변·문의가 왔다는 안내는 무조건 답변필요» · 확인 권장 제대로 나열 · 상세 조건 설정에 공개 · 학습 안내·삭제·추가 · Q sales 도.
- 원인: 자동응답의 `Precedence: bulk` 를 광고로 읽어 자동·마케팅에 묻힘. 설계 docs/MAIL_CRITERIA_DESIGN.md.
- 서버: 기준 카탈로그 `services/mailCriteriaCatalog.js`(엔진·화면 한 벌, 찾는 말 공개) · 끄기 `services/mailCriteria.js`(permissions.mail_criteria.off, owner/admin) · `email_threads.triage_criterion` · 새 기준 inbound_action(답변 필요)·auto_ack·spam_rescue·platform_notice · 재판정 `services/mailRetriage.js`(스크립트·미리보기·소급 공용) · 라우트 `routes/mail_criteria.js` · `POST …/mark-review` · 학습 «답변 필요로»/«확인 권장으로» 2회(반대 규칙 교체) · 자동·마케팅 폴더에서 답변 필요 제외 · Q sale off/domains(saleMailCriteria·salesIntake·customer_entry).
- 화면: 설정 › 메일 계정 «메일 분류 기준·규칙»(공용 CriteriaList, 4묶음 19기준, 끄기 전 건수 확인창, 학습 안내) · 설정 › 권한 «상담 유입» 기준 8개 + 늘 상담/상담 아님 주소 · Q mail 자동·마케팅 행 «확인 권장으로» + 목록 위 학습 안내 줄.
- 결정 ④(Fable): 역할 주소(info@·help@)의 안내는 확인 권장 유지 — 뒤집으면 dev 950건. 꼭 받을 곳은 «답변 필요로» 2회 학습·규칙.
- dev 적용: migrate-mail-criteria · retriage --promote-only --promote-reply-criterion=inbound_action --apply(자동응답 10 → 확인 권장, 새 주문·문의 24 → 답변 필요) · --fill-criterion(5,984 기준 이름만).
- 검증: HEAD 대비 6,300 시뮬 강등 0 · 카나리 mail 40/40(옛 엔진에 돌리면 새 양성 7 FAIL) · salecriteria 18/18 · maillabel·tenant 0 · guard 69/70 · 실HTTP · 브라우저 3폭 · Fable 1차 FAIL(차단 3) → 수정 → 2차 PASS(docs/FABLE_GATE_QUEUE.md 맨 위).
- 남김: ① 마지막 모양 수정 3건(CriteriaList 제목 토큰·상담 칩 × 높이·MailPage 문구 기본값)은 **dev 빌드에 없음** — 재빌드가 메모리 부족으로 시스템에 중단됨. 다음 빌드·배포 때 반영(배포 전 build EXIT 0) ② 끄기 소급 상한 20,000(운영 규모면 수십 초) ③ health-check invite_mail 실패는 다른 방(client_invites.js 분리) 것 ④ dev 세무사 메일 8건은 내 학습 시험 소급으로 옮겨져 근거로 추정 원복.
- 운영: `migrate-mail-criteria.js` 배포 슬롯 등록(PM2 reload 전). 옛 메일 재판정은 배포 뒤 수동 — 운영 읽기 전용 `retriage-mail.js --promote-only --promote-reply-criterion=inbound_action --list` 전수 육안 → `--apply`(+ `--fill-criterion`).

### 완료: 직접 관리 고객(비가입 고객) (방 d1871180 · 2026-10-15 · [Opus] · Fable 설계 + 게이트 PASS) — 운영 미배포
- 원문: «고객이 가입을 안 해도 관리자가 정보를 넣고 직접 관리하는 고객도 포함하면 안돼? 청구서나 다양한 관리에 고객정보가 필요한데 굳이 가입할 필요는 없어서.»
- 설계 docs/CLIENT_MANAGED_DESIGN.md — `clients.status` ENUM 끝 'managed'(정식 고객 한도에 셈) · 술어 `services/clientAccess`(canInviteClient·emailEditable·reactivatedStatusOf) · 응답 can_invite/email_editable.
- 서버: `routes/client_invites.js`(clients.js 에서 분리 — invite[client_id 행 승격]·managed·register-managed·resend-invite[invited 만]) · clients.js PUT status 입력 제거·invite_email/phone 편집 · 보관 해제는 증거로 되살림·문의 보관 409 · `services/clientResponse.js`.
- 화면: 고객 관리 [고객 추가] = «초대 보내기 / 직접 관리로 등록» 모드(같은 CreateDrawer) · 계정 없는 고객 드로어 이메일·전화 자동저장 · «이 고객 초대» · Q sale 패널 ⋯ «계정 없이 정식 고객으로»(useClientRelationActions).
- 운영: `scripts/migrate-client-managed.js` 배포 슬롯 등록(ENUM, PM2 reload 전). 옛 «active+계정없음» 백필은 **수동 `--apply`**(dev 4건 적용함).
- 검증: 실HTTP 39/39 + 분리 후 9/9 · 대조군 뒤집힘 · 화면 3폭 36/36 · build EXIT 0 · guard 69/70 · secrets 10/10 · e2e tenant,clientlink,salecriteria 0 · **Fable 게이트 PASS**(비차단 3 — docs/FABLE_GATE_QUEUE.md 맨 위).
- 확인용: ws7 «[확인용] 화면 등록 …»(1614~1616) · «[확인용] 청구 직접관리»(1608, 청구서 4667) · ws7 기타 1606·1607·1610·1611~1613.

### 완료: 문서(Q docs) 댓글 (방 1abbce29 · 2026-10-15 · [Opus] · Fable 설계 + 게이트 PASS) — 운영 미배포
- 설계 docs/DOC_COMMENTS_DESIGN.md. 새 표 `post_comments`(internal 팀만 / shared 고객도 봄) · 라우트 `routes/post_comments.js`(GET/POST/DELETE `/api/posts/:id/comments`, posts.js 앞 마운트) · 쓰는 문 `post_actions.createComment/deleteComment`(알림·감사·실시간) · 읽기 `services/postComments.js`.
- 화면: 문서 보기 모드 첨부 아래 `DocCommentsSection`(공용 NoteThread — visibilityOptions·highlightId 등 확장, 기존 호출부 동작 그대로). 고객 있는 프로젝트 문서만 [팀만|고객도 봄]. 알림 링크 `/docs?post=&comment=` 스크롤·강조. 알림 설정에 «문서 댓글» 행.
- 운영: `migrate-post-comments.js`(표 + 알림 두 표 ENUM 'doc_comment', 멱등) 배포 슬롯 등록(PM2 reload 전). dev 적용함.
- 검증: 실HTTP 44/44(+Fable 16/16) · 브라우저 3폭 22/22 · 양성 대조군 · guard 69/70 · secrets 10/10 · e2e tenant 0 · build EXIT 0.
- 확인용: ws6 문서 3120 «[확인용] 문서 댓글 시험»(프로젝트 35, 고객 client@).
- 뺀 것(설계): 답글·편집·목록 댓글 수·확인필요 배지·첨부·AI 도구.
- 곁에서 본 것(안 고침): 업무 상세(`GET /api/tasks/:id/detail`)는 멤버에게 남의 personal 댓글도 그대로 싣는다(고객만 거른다) — 화면이 거르는지 확인 필요.

### 완료: 묶음 3건 모두 대기열 앞으로 되돌림 (방 75f6c531 · 2026-10-15 · [Opus]) — 코드 변경 없음
- 문서 댓글 · 비가입 고객 직접 관리 · 답변필요 메일 분류 고도화 — 셋 다 새 표/판정 기준/고객 status 의미가 걸린 설계(Fable) 대상이라 묶음 규칙대로 손대지 않고 `front:true` 로 되돌림.
- 문서 댓글 정찰 메모 새로 씀: `.claude/plans/qdoccomments.md` (나머지 둘은 기존 계획 qmv7hp0uc · qmv7ly27u).

### 완료: Q talk «열어 봄 ≠ 참여» — 초대 안 한 사람이 참여자로 들어가던 것 (방 dadb48f3 · 2026-10-15 · [Opus] · Fable 설계 A + 게이트 PASS) — 운영 미배포
- 원인: 읽음(/read)·핀이 role member 참여자 행을 만들어 열기만 해도 참여자 목록·@·메시지 알림·읽음 분모에 들어갔다. 목록 가시성(멤버 이상은 프로젝트·고객 방을 봄)은 열린 문화 그대로.
- `conversation_participants.is_viewer` + 모델 defaultScope(참여자만) + 쓰는 문 `services/convParticipants.js`(touchOwnRow viewer · joinParticipant 초대·생성·승격 · promoteSpeaker 말하면 참여자 · ownRows · removeRows) + 가드 `--category=convparticipants`. 설계 docs/QTALK_PARTICIPATION_DESIGN.md.
- 운영: `migrate-conv-viewer.js` 배포 슬롯 등록(PM2 reload 전) · 옛 행 `backfill-conv-viewer.js`(**수동** — 배포 뒤 dry-run → `--apply`, 운영 실측 후보 5·사적 방 0). dev: 적용함(8건, 장부 scripts/out/).
- 검증: 실HTTP 23/23 · defaultScope 뺀 대조군 7건 뒤집힘 · 백필 apply→0→revert 8/8 · guard 69/70(docfresh 경고) · health-check 85/85 · e2e tenant,inboxcount 0 · Fable 독립 35검사 PASS.
- 남김(Fable 비차단): 행이 아예 없는 멤버가 바로 말하면 참여자 안 됨(종전과 같음) · touchOwnRow 가 고객 scope 에도 role member(종전과 같음).
- 확인용: ws6 대화 1159 «[확인용] 열어 봄 ≠ 참여 시험» — 이디자(member1) 열어 봄(viewer)·박개발 참여자.

### 완료: 상황판 묶음 3건 — 메모 검색 목록 가림 · Q talk @ 후보 · 모바일 업무 목록 (방 90005e7f · 2026-10-15 · [Opus]) — 운영 미배포
- ① 메모 팝업/분리 창: 검색 목록(z 5)이 에디터 sticky 툴바(z 5, DOM 뒤)에 덮였다 → 목록 z 20. 1440·768·390 3/3 행 · 옛 z 5 대조군 첫 행 = «굵게». 커밋 fc8314f0. 확인용 메모 ws5(health-check) «[확인용] 메모 검색 1~3».
- ② Q talk: 나중에 초대한 사람이 @ 후보에 없던 것 → 서버 참여자 추가·제거 때 `conversation:participants` 신호(id 만, conv 방 + 그 사람 user 방), ChatPanel 이 신호·설정 창 이벤트·탭 복귀·재연결에 다시 읽음. 실호출(추가 201+신호1 · 재추가 200+신호0 · 제거 200+신호1) · 브라우저 1440 추가 직후 @ 후보에 뜸/제거 후 빠짐. 커밋 4ffd92c5.
  «관리자는 무조건 추가? 초대 안 했는데 들어가 있다» = 멤버 이상은 프로젝트·고객 채팅을 목록에서 보고(열린 문화), **열기만 해도 읽음 처리가 참여자 행을 만든다**. 규칙 변경은 설계(Fable) 대상 → 상황판 대기열 앞에 되돌림.
  남김: 서버 멘션 해석(mention_parser)은 워크스페이스 멤버만 — 고객을 @ 해도 멘션 알림은 안 간다(참여자 메시지 알림은 감).
- ③ 모바일 업무 목록(≤640만, 데스크탑·태블릿 표 그대로): Q task 행에 상태 배지(제목 앞)·둘째 줄 프로젝트·마감·담당자(전체 업무), 빈 # 원·⋮·태그 + 는 폰에서 접음, 표 머리줄 숨김, 필터는 [필터] 버튼 하나로. 프로젝트>업무 탭도 같은 둘째 줄(상태·마감), 상태·기간·타임라인 칸 숨김, 보기 전환 글자 세로 접힘 고침. 공용 조각 `components/QTask/phoneRow.ts`.
  실측 390: Q task 행 93→66px · 첫 행 y 455→288(앱 배너 닫음) · 첫 화면 4→8행 · 상태 배지 보임 3/3. 프로젝트 탭 가로 넘침 424/360 → 0(탭 막대만 의도된 가로 흐름). 768·1440 행 40px 그대로.
- build EXIT 0(error TS 0) · guard 68/69(기존) · e2e projecttabs·headerdrift 통과 · mobilesweep 실패 1 = 폰 360 `/tasks?task=` 업무 상세 서랍 입력 div 키보드 가림(bottom 462>410, 두 번 재현 · 390 통과). 안 건드린 서랍이라 3번 변경 없는 기준 빌드로 가르려 했으나 **메모리 부족으로 그 빌드·검사가 강제 종료** → 원인 확인 못 함(다음 방: 3번 변경 없이 같은 검사로 가를 것).
- Fable 안 씀 — 화면 배치·실시간 신호(권한·데이터 규칙 변경 없음). Fable 미검증(자체 검증).

### 완료: 워크스페이스 청구서·알림 점검의 고칠 부분 P1~P4 (방 3aee697b · 2026-10-15 · [Opus]) — 커밋 9807d895, 운영 미배포
- 정찰 qmv7n2sus(방 2406a434 에서 떼어 냄). Fable 설계 판정 P1=B · P3=send(권고대로 진행, Irene 에게 다시 묻지 않음).
- P2·P3: 청구서 고객 본인 알림 = `invoiceDelivery.notifyPayer` 한 함수 — 발송 1건에 정확히 1회(채팅·메일 결과와 무관), 앱 안+푸시만(메일·5분 재알림 끔), eventKind 'invoice'. queueDelivery 에 audience 필수(/send·/resend customer · /send-preview self). 채팅+메일 두 통 → 한 통, 메일만일 때 앱 알림 0 → 1. 팀 참여자 알림은 그대로.
- P4: 알림 본문 수신자 언어로.
- P1: 종 드롭다운 머리 «○○ 알림» · 바닥 «브랜드 파트너스 새 알림 3 [전환]»(최대 3줄, 전환 → /notifications). 숫자 = unread-count 응답 others(`services/notificationOthers`, 전환기와 같은 집합·플랫폼 공지 제외). 종 배지·전환기 숫자는 그대로.
- 검증: 발송 5경우 실측(메일 함수 가로챔) · API 5 · 브라우저 1440/768/390 11/11 + 음성 대조군 · build EXIT 0 · guard 68/69 · e2e inboxcount,wssync 0 · **Fable 게이트 PASS**(docs/FABLE_GATE_QUEUE.md 맨 위).
- 확인용 데이터: owner(15) ws7 알림 «[확인용] 다른 워크스페이스 알림 시험»(미읽음) · ws6 청구서 4507~4509 «[확인용] 청구서 알림 시험».
- 남김(별건): billEvents 'delivered' 가 bill_events ENUM 에 없어 발송 이력이 안 남는다(기존 — ENUM append 마이그레이션 필요).
- /개발완료 안 함 — 같은 폴더 작업 중 방 있음(f08b6db5).

### 완료: 상황판 묶음 3건 — 구글 미팅 시간 기준 · 메일 주소 추천/보내기 위치 · 청구서·알림 점검 (방 2406a434 · 2026-10-15 · [Opus]) — 커밋 307cd9e5·393ff0cc, 운영 미배포
- ① Q calendar: 회의 [링크 복사] 문구가 tz 없이 기기 시간대(KL 17:00)로 찍혀 화면(서울 18:00)과 달랐다 → 워크스페이스 시간대 + «(한국 표준시)», 개인 시간대가 다르면 «내 시간 (말레이시아 시간): …» 줄. 회의 칸에 «구글 캘린더·초대 메일은 각자 구글 계정 시간대로 표시» 안내.
  검증: 브라우저 KL 시간대 × 1440/768/390 6/6(개인 tz KL 일 때 내 시간 줄 포함) · 대조군(옛 식, KL) 17:00. 확인용 일정 ws6 #1345.
  남김: Meet 만들기·구글로 보내기가 시간대를 Asia/Seoul 고정으로 보냄(반복 일정 기준만 영향, 서울 ws 실해 없음) — 캘린더 작업 방(f08b6db5)과 겹쳐 손대지 않음.
- ② Q mail: 받는 사람 추천(email-addresses 한 번 로드 · 함께 받은 사람 to/cc 포함 · cc 는 안읽음 미계산) · 보내는 사람 셀렉트 검색 · 새 메일 [보내기] 좌측 고정(상태줄을 버튼 뒤로).
  검증: member1(ws3) × 3폭 12/12(추천 보임·클릭 칩 1개·Enter 선택·보내기 left 20·가려짐 없음) · 주소 목록 ws5(4735통) 1.19초(작성창 열 때 1회 비동기). 시험 초안 73~75 지움, active ws 6 원복.
- ③ 청구서·알림 점검: 답만 보고(코드 변경 없음). 고칠 부분 P1~P4(다른 워크스페이스 알림 안내 결정 · 채팅+메일 두 통 · 메일만 보낼 때 앱 알림 0 · 알림 본문 한국어 고정)은 결정·Fable 대상이라 대기열 앞에 되돌림(정찰 qmv7n2sus).
- build EXIT 0(error TS 0) · guard 68/69(기존). Fable 안 씀 — 화면 문구·추천(기존 읽기 라우트, 권한 판정 그대로).

### 완료: 문의·피드백 답변을 확인필요·메뉴 배지에 (방 0199896b · 2026-10-15 · [Opus]) — 커밋 44f6dc17, 운영 미배포
- 원문 «문의 피드백에 답변받아도 알림있어야 하잖아» (a57886b7 «받은 서명 알림 점검» 에서 떼어 낸 일).
- `feedback_items.reply_seen_at` 칸: 답 글 있음 ∧ NULL = 안 읽은 답. 답할 때 NULL(상태만 바꾼 회신은 그대로) · /me/feedback 에서 스레드를 열면 `POST /api/feedback/:id/seen`(본인만, 스레드 전체).
- 확인필요 `collectFeedbackReplies`(워크스페이스 무관, 초대처럼 1회 · 한 스레드 = 한 항목 · 링크 /me/feedback?item=) → `feedbackCount` → 문의·피드백 메뉴 배지. 목록 행 «새 답변» 칩. 확인필요 카테고리 묶음에 leave·feedback_reply 가 없던 것(묶음에서 사라짐)도 같이.
- 운영: `scripts/migrate-feedback-reply-seen.js`(멱등, 칸을 처음 만들 때만 옛 답 읽음 백필 — 안 하면 배포 순간 옛 답 전부가 확인필요에 뜬다) — deploy-planq.sh 슬롯 등록(PM2 reload 전). dev 적용함(백필 3건).
- 검증: 실HTTP 9가지(상태만 0 · 답 1 · 합=total · 남의 seen 404 · 읽음 0 · 추가문의 답 1 · 자식 id 읽음 0) · 브라우저 1440/768/390 카드→스레드→배지 사라짐 · 메뉴 배지 보임(1440·1100·폰 메뉴) · build EXIT 0 · guard 전체 통과 · e2e inboxcount 실패 0.
- 확인용 데이터: owner(ws6) 문의 #47 «[확인용] 문의 답변 확인필요 시험» — 안 읽은 답 상태로 둠.
- Fable 안 씀 — 칸 추가(nullable)·읽음 표시 백필은 되돌릴 수 있고(NULL), 권한·돈·외부 발송 변경 없음.
- /개발완료 안 함 — 같은 폴더 작업 중 방 있음(f08b6db5).

### 완료: 상황판 묶음 3건 — 메일 본문 첨부 · 받은 서명 알림/배지 · 서명 잘못 넣은 문서 되돌리기 (방 a57886b7 · 2026-10-15 · [Opus]) — 운영 미배포
- ① 메일 작성·답장: 본문 에디터에 끌어놓거나 붙여넣은 **이미지 아닌 파일 → 첨부 칸**(RichEditor `onAttachFiles` 선택 prop, 메일 두 곳만 넘김), 그림은 종전대로 본문 미리보기(받는 쪽엔 CID 인라인). 파일만 끌면 브라우저가 파일을 열던 것·그림+PDF 같이 끌면 PDF 가 사라지던 것·본문 업로드 실패한 그림이 사라지던 것(→ 첨부로) 함께. 첨부 칸이 접혀 있으면 펼친다. 그림 두 장을 연달아 넣으면 앞 그림이 갈아 끼워지던 결함도(선택된 그림 뒤로 커서). 본문 그림은 첨부 목록에 같이 넣지 않음(Gmail 과 같게 — 두 번 가지 않게).
  남김: 초안에는 «아직 안 올린 첨부»(로컬 파일)가 저장되지 않는다(정찰 계획 3번) — 넣는 순간 올리는 방식은 칩 이름·썸네일이 깨져 이번엔 안 함.
- ② 확인필요 vs 메뉴 숫자: 확인필요에만 잡히고 메뉴 배지가 없던 넷 추가 — 받은 서명(서명·확인 요청) · Q docs(내가 보낸 서명의 거절·의견) · Q calendar(참석 응답·상담 신청) · 근태(휴가 승인). 서버 all.filter 한 공식. 메뉴 합 + 초대 + 요금결제 = total (dev 12계정 불일치 0).
  서명 알림(종) 링크 `/posts/:id`(없는 주소, dev 428건 전부 홈으로 튕김) → `/docs?post=` + 옛 행은 프론트가 읽을 때 옮김. 보내는 쪽(우리) 서명자에게 앱 알림·푸시가 없던 것 → `signatureCore.notifyUsSigners`(메일 끔, 요청한 본인 제외). 문의 답변 알림 제목이 «피드백 …» 이던 것 → 문의/피드백 구분.
  떼어 냄: 문의·피드백 답변을 확인필요·메뉴 배지에 넣기(읽음 칸 DB 추가 필요) → 상황판 대기열 앞에 넣음.
- ③ 서명 문서 되돌리기: 서명 진행 표 — 보내는 쪽(우리) 칸에도 ⋯ [요청 취소](예전엔 받는 쪽만 → 우리 칸 pending 이 남아 문서가 영영 잠김) · 살아 있는 요청 2건 이상이면 [모두 취소]. [서명 받기] 1단계 — [서명 자리 모두 빼기](그 자리 한 줄 확인, 손글씨 바꿔치기한 글자는 안 돌아온다고 알림). 서버 변경 없음.
- 커밋: ① 3687dc0f · ③ 099ee581 · ② 58fb357d + eecf9b1f 재알림 메일 끔.
- Fable: ②의 우리 쪽 서명자 알림만 게이트 대상 → **PASS**(docs/FABLE_GATE_QUEUE.md 맨 위). 비차단 ① 재알림 메일 → 고침. 남김 ② 종 알림 «서명 요청» 클릭이 앱 창을 공개 서명 화면으로 통째로 바꾼다(확인필요는 새 탭) — 아이패드 앱에서 막다른 길 가능, 후속 일. ③ 서명한 본인도 «서명 완료» 알림·정지 계정 미필터(기존).
- 확인용 데이터: ws6 문서 3053(살아 있는 요청 — 우리 쪽 member1·받는 쪽 외부) · 3050 · ws5 3051·3052.

### 완료: 상황판 묶음 3건 — 모바일 녹음 첨부 · 초대메일 브라우저 · 탭 닫기 단축키 (방 4ffaf526 · 2026-10-15 · [Opus]) — 커밋 4a95b9bf·85f5be55, 운영 미배포
- ① 녹음·문서 첨부 문의: 사용법 답 + 녹음 고르는 칸 accept 에 audio/* (안드로이드 회색 방지). .aac 는 audio_probe 가 일부러 뺀 형식(길이 헤더 없음)이라 안 넣음. «다른 앱에서 공유로 녹음 보내기» 는 손대지 않음.
- ② 초대메일 → 브라우저: 정상(의도). native-link-paths 정본이 /invite 를 앱 열기 경로에서 뺌 — dev AASA invite 0건. 고칠 것 없음.
- ③ 탭 닫기: 웹 ⌘W/Ctrl+W 는 브라우저 예약 키라 불가 → ⌥W/Alt+W, 네이티브 앱(아이패드)은 ⌘W/Ctrl+W 도. tryClose 한 벌. 1440 실측 7/7(1개 무시·하나 닫힘·W 단독 대조군·repeat·모달 탭 안 닫힘·입력 중 글자 안 들어감). build EXIT 0 · guard 68/69(기존).
- Fable 안 씀 — 화면 동작.

### 완료: 상황판 묶음 3건 — 메일 전달 초기화 · 캘린더 +N · Q노트 업무 추출 (방 0db309e2 · 2026-10-15 · [Opus]) — 커밋 65526423·0fbf71c7·cfc8dc40, 운영 미배포
- ① Q mail: 전달 중 [+] 가 `setComposeOpen(true)` 만 해서 전달 폼이 그대로 남음 → `resetComposeFields` 한 벌을 모드 바꾸는 6개 문이 같이 씀. 1440 3/3 통과(수정 전 대조군 ①② 실패 재현). 폰·태블릿(≤1024)은 작성 중 [+] 가 닿지 않는 구조(닫기는 원래 폼을 비움).
- ② Q calendar: «+N 더보기» → 그 날 일 보기(호버 카드와 같은 목록 창 삭제). 1440·768·390 통과. 확인용 일정 ws6 #1340~1344 (2026-10-20).
- ③ Q note: NoteTaskExtract(09-19)와 «업무» 칸 중복 → 한 칸 + CueTaskBar(«한 줄로 Cue 에게»). 0건 안내 · 한도 초과(429) 안내 추가. 확인용 노트 ws6 100000114(ws6 는 Cue 한도 소진 — 한도 문구가 보임) · ws5 100000115 · 업무 ws5 #3935.
- Fable 안 씀 — 화면 동작·배치(권한·데이터 규칙 변경 없음).

### 완료: 정기 점검 10/15 — 배포 안 함 (방 5b9aefa0 · 2026-10-15 · [Opus]) — 파일 변경 없음(이 기록만)
- Irene 답(01:21): *"이제 fable 돼. 그런데 배포 지금 하지 말자. 그냥 이 업무 완료해"* → 배포하지 않고 점검 종료. 새 커밋 5개는 다음 배포 때. Fable 대기 7건은 상황판 대기 그대로(한도 풀림 — 각 방이 이어 받음).
- (아래는 질문 당시 기록)
- 무엇: 운영 c7c38dc2 뒤 새 커밋 5개(2511febc·35479644·feeda6f3·b4f2e531·11e4c1b8, 모두 «Fable 안 씀» + 자체 검증 숫자 위 각 절) 배포 여부.
- 왜 멈춤: PlanQ Fable 대기 7건 — 게이트 5건(설문 v2·업무 결과물 액션·팀 캘린더 고르기·dev-login·관리자 컨펌자/알림 ws)은 10-13 배포로 이미 운영에 있음, 설계 2건(초대 인앱 알림·미출근 재개)은 구현 없음. 상황판 질문 askmv8unwts(16:00Z 만료).
- 답이 «예» 면: `./scripts/deploy-planq.sh --routine` → 보고에 «Fable 미검증(자체 검증·Irene 확인) 배포: 위 7건 대기 유지». Fable 대기 항목은 지우지 않는다.
- 개발완료: 안 함 — 같은 폴더 작업 중 방 있음(f08b6db5 구글 캘린더 · 1a0f9989 · 3a26aed0 · a9337893), 미커밋 캘린더 6파일은 그 일의 것.
- 운영 피드백 읽기: 권한 거부(운영 읽기) — 이번엔 못 읽음.
- 밤 검사(10-14): 순찰 실패 5(같은 3종 — 메일 3885 찾을 수 없음 · /talk 다시 시도 · 카나리 설문 알림 post 2914) · 전체 검사 139 중 실패 8(mailrt·tablefit·tablestyle·taskaddparity·filemarquee·drafts·salelayout·headerrow). 새로 빨개진 것: filemarquee·drafts. taskaddparity ④⑨ 는 10-12 «담당자 아니어도 반복» 결정 뒤 검사기 기대값이 옛 규칙.

### 완료: 다른 워크스페이스 고객의 청구서 링크 «찾을 수 없음» (방 ccc7c7e0 · 2026-10-14 · [Opus]) — 커밋 11e4c1b8, 운영 미배포
- 원문 *"최정우 고객에게 청구서 보냈는데 고객이 로그인하고 있었어. 그래서 클릭해서 들어가면 찾을 수 없는 항목이라고 나와 … 청구를 받은 워크스페이스(워프로랩)의 받은 청구서로 고객입장이어야지"*
- 운영 실측(읽기만): 최정우(user 8) = 워프로랩(ws1) 고객 6 · 기율법률(ws17) owner · 마지막 워크스페이스 17. 청구서 INV-2026-0002~0008 5건 모두 ws1·고객 6 앞으로 정상 발행·전부 결제완료, 고객 목록 규칙상 전부 보임. 메일 2026-10-13 06:29 INV-0008 재발송 sent.
- 원인: 메일 링크(공개 청구서)는 로그인한 사람을 앱으로 자동 이동하는데 주소에 워크스페이스가 없어 **지금 워크스페이스(기율법률)** Q bill 에서 invoice 8 을 찾음 → «찾을 수 없음». 청구서 도착 알림 링크도 `/talk/6`(대화방)이라 기율법률에서 열리면 못 찾음.
- 고침: auth-check 7곳 appUrl 에 ?ws= · 화면 `workspaceLink.openAppLink` 한 문(다른 워크스페이스면 문서 새로 열어 ModeGate 가 전환) · 청구서 알림 = 고객 본인은 받은 청구서(/bills?tab=invoices&invoice=), 팀은 /talk?conv=.
- 검증: 실HTTP auth-check → `/bills?tab=invoices&invoice=…&ws=6` · 알림 행 고객=받은 청구서·팀=대화방, 푸시/메일 링크 ws=6 · 실브라우저 1440·390 × (메일 링크·알림 링크) 4/4 = 워크스페이스 6 으로 전환·«받은 청구서»·청구서 번호 보임, 대조군(ws 없는 옛 링크) 2/2 «찾을 수 없음» 재현 · build EXIT 0(error TS 0) · guard 68/69(posts.js godfile 기존). 픽스처(임시 계정)는 지움.
- 남김: 이미 나간 옛 푸시(`/talk/6`, ws 없음)는 종전대로. 메일 링크는 서버 판정이라 옛 메일도 배포 뒤 바로 고쳐진다.
- Fable 안 씀 — 링크 목적지만 바뀌고 권한 판정(canAccess)·전환 허용(switch-workspace 서버 판정)은 그대로.

### 완료: Q task 목록 — 전체 업무 탭을 이번 주 내 업무 기준으로 (방 0064249f · 2026-10-14 · [Opus]) — 커밋 b4f2e531, 운영 미배포
- 원문 *"데스크탑에서 내업무리스트가 정돈되어서 최종인데 전체업무가 위아래 벙벙하고 스타일이 달라. 전체업무탭의 리스트나 다른 탭의 모든 리스트들 점검해서 이번 주 내 업무 리스트 기준으로 맞춰줘."*
- 원인(실측 1440): 전체 업무만 행 51px(다른 탭 40) — 담당자 칸 상자형 셀렉트 · 담당자 머리줄 90px / 행 140px → 뒤 칸 전부 50px 밀림·오른쪽 날짜 칸 잘림. 모든 탭 공통: 태그 칩이 좁을 때 지연 배지 밑으로 겹침 · 업무 칸 최소폭 머리 180 / 행 240 (좁은 폭에서 어긋날 수 있었음).
- 고침: PlanQSelect variant="cell"(24px) · ASSIGNEE_COL_W 한 값 · 업무 칸 최소폭 머리=행(전체 업무 180) · TagChips overflow hidden.
- 검증: build EXIT 0(error TS 0) · guard 68/69(기존) · 5탭 × 1280/1440/1920 행 전부 40px·머리 칸=행 칸 · 390 폰 5탭 모두 93px 같음 · 담당자 바꾸기 저장(반복 회차 «이 회차만» → PUT·DB 일치, 원복).
- 남김: 전체 업무 1440+우측 패널에서 업무 칸이 좁아 지연 배지가 일부 잘림 · 남의 업무의 예측/실제 칸 회색 점선 상자는 기존 규칙(담당자만 입력)대로 둠 · 프로젝트 > 업무 목록(별도 화면, 행 47px)은 손대지 않음.
- Fable 안 씀 — 화면 배치.

### 완료: 기율법률(운영 ws 17) 업무 36건 작성자 → 최정우 (방 3cf3cdbb · 2026-10-14 · [Opus]) — Irene «권고대로» 로 운영 DB 반영
- 원문 *"내 업무에서 내가 담당자가 아닌데 나한테 나오는 이유 … DB에서 직접 넣은건데 … 완료된 업무가 전체업무 탭에서 안 나온다 … 기율법무"*
- 원인 1(데이터): 운영 DB 로 넣은 업무 #547~#582(36건)가 `created_by = 1(김미정)` · 담당 8(최정우). 화면은 작성자를 «내가 맡긴 업무» 로 본다 → Irene 화면 «요청» 탭에 열린 27건, «이번 주» 탭에 이번 주 완료 9건이 뜬다. 그리고 설명(의뢰 명세)은 «작성자만» 고칠 수 있어 최정우님은 이 36건 설명을 못 고친다.
- 원인 2(설계대로): «전체» 탭은 «완료 숨기기» 가 기본 켜짐(커밋 5db3934a, 체크하면 바로 사라지게). 체크를 끄면 보인다. 서버는 완료 포함 전부 준다 — 모든 워크스페이스 같은 동작, 기율만의 문제 아님.
- 곁에서 찾은 결함(고침, feeda6f3, 운영 미배포): 완료 «되돌리기»(revert-status)가 completed_at 을 안 지워 #545·#551 이 «미착수 + 완료 시각» 이었다(운영 ws1 2건·ws17 2건). 통계는 전부 status='completed' 를 같이 보므로 숫자 영향 없음 — 운영 데이터는 손대지 않음.
- 운영 반영(2026-10-14): 트랜잭션 UPDATE created_by 1→8, 대상 36·바뀐 행 36 · 재조회 ws17 작성자=김미정 0건 · 작성자=담당=최정우 38건(원래 2 + 36). 되돌리기: 같은 id 범위 created_by=1.

### 완료: 폰 메일 «크게 보기» 뒤로 버튼 (방 21213be2 · 2026-10-14 · [Opus]) — 커밋 35479644, 운영 미배포
- 원문 *"모바일 메일 상세에서 뒤로 가기 화살표가 없어. 나오게 해줘"*
- 메일 상세 자체(‹ 목록으로)는 폰 360·390·768 에서 보이고 눌림(실측). 뒤로 없는 화면은 본문 «새 창으로 크게 보기» — 폰에서도 window.open 새 창(머리줄·뒤로 없음, 앱은 사파리)이었다(대조군: 390 클릭 → 새 창 1개·앱 안 창 0).
- 고침: ≤1024 또는 손가락 포인터면 앱 안 전체 화면(MailBodyFullscreen) · 머리 왼쪽 ‹(PanelBackButton, ≤1024 ✕ 숨김) · useBackToClose. 데스크탑 1440 은 종전대로 새 창.
- 검증: build EXIT 0(error TS 0) · 360/390/768 새 창 0·‹ 보이고 눌림·눌러서 닫힘 · 폰 브라우저 뒤로 = 창만 닫힘(메일 그대로) · 768(탭 모드)은 브라우저 뒤로가 목록까지 감(탭 모드 히스토리 계약) · guard 68/69(posts.js godfile 기존).
- Fable 안 씀 — 화면 배치.

### 완료: 모바일 상세 머리줄(제목·뒤로) + 폰 Q task 목록 (방 ad77062b · 2026-10-13 · [Opus]) — 커밋 2511febc, 운영 미배포
- 원문 *"큐테스크에서 업무 상세에 어떤 곳이 헤더 업무제목이 안나와 … 서브해더 모바일 다 점검 … 뒤로 가기도 안나오는 거 … 모바일에서 너무 다 생략하고 리스트들이"*(끝이 잘려 옴)
- 폰 상세 13화면 실측: 업무 상세만 머리줄이 «돌아가기» 뿐(제목은 본문 맨 위 → 내리면 사라짐) · 청구서 상세 뒤로 없음(공용 머리 미사용) · 고객 상세(설정>고객) 앱 머리줄 밑에 깔려 «‹ 목록» 가려짐. 문서·메일·Q sale·채팅·프로젝트·노트·정보·일정은 «‹ 제목» 정상.
- 고침: 업무 상세 제목 → 머리줄(누르면 그 자리 수정, 폰 ✕ 숨김) · 청구서 ‹ 추가 · 고객 상세 panelTop+폰 전면 · Q task 목록 폰 = 첫 줄 제목(2줄)·둘째 줄 칩(제목 시작선 정렬) · Q task 머리줄 폰 여백(360 에서 검색 버튼 잘림).
- 검증: 4폭(360·390·768·1440) 실측 실패 0(뒤로·제목 보임·내린 뒤 제목·목록 정렬 dx 0·머리줄 화면 안) · 제목 수정 저장 DB 일치(원복) · build EXIT 0(error TS 0) · guard 68/69(posts.js godfile 기존) · e2e mobilesweep 61/61 · mobilepanels 34/34(첫 회 ①e 픽스처 미측정 1 → 재실행 통과) · mobilechrome·tabletchrome 통과.
- Fable 안 씀 — UI 배치(권한·저장 규칙 불변).

### 완료: 캘린더 상단 정돈 — 큰 단위·필터줄·년/월 순서 + Google 하위 묶음 (방 a22283ec · 2026-10-15 · [Opus]) — 운영 미배포
- 검증: build EXIT 0(error TS 0) · guard 68/69 · 실측 5폭(360·390·834·1024·1440) × Google 연결 있음(요청 가로채기 모사)/없음 실패 0 — 순서·필터줄 한 줄·큰 단위 머리줄·새 일정 보임·가로 넘침 0·Google 끄면 하위 묶음 사라짐·년/월 제목 한 줄 · 프로젝트 탭 3폭 실패 0.
- 확인 못 함: 실제 구글 연결 계정(dev 에 개인 연결 없음).

- 원문 *"필터들은 한줄 … 그룹이 다른 건 알 수 있게 … 필터가 년/월 표시 위 … 헤더에는 전처럼 팀/개인/업무/구글 큰 단위고 나머지 프로젝트별 … 필터 … 구글캘린더 종류들 선택이 구글 하위메뉴인지 알 수가 없어"*
- 머리줄: [✓개인|✓팀|✓업무|✓●Google](연회색 알약 segmentedToggle, 여러 개 켜기 = 작은 체크 상자) ⓘ [보기] [+새 일정]. 프로젝트 셀렉트는 머리줄에서 내려왔다.
- 필터줄 한 줄(줄 바꿈 없음, 넘치면 옆으로 밀림): [프로젝트 ▾](첫 옵션 = 축 이름) │ «● Google · irene@… ›» 이름표 + 그 캘린더 칩들(Google 켰을 때만 — 끄면 묶음째 사라짐). 그 아래 년/월·이동.
- 폰(≤640): 머리줄 둘째 줄 = [알약][ⓘ][+], 보기 고르기는 년/월 줄 오른쪽 끝. 프로젝트 탭 캘린더(얹은 모드)도 같은 구조(프로젝트 필터 없음).
- 파일: pages/QCalendar/{calendarLayers,QCalendarPage,CalendarFrame,ProjectFilter}.tsx · locales qcalendar layer.googleGroup.
- 태그 필터는 안 넣음 — 일정에는 태그가 없고 업무 태그도 캘린더 응답에 안 실린다(새 데이터·설계 필요).
- Fable 안 씀(UI 배치 — 필터 판정·저장 규칙 불변).

### 완료: 관리자 컨펌자 추가 + 다른 워크스페이스 알림 링크 (방 f12b6666 · 2026-10-13~15 · [Opus]) — Fable PASS, 커밋 416a13dc·a6d95df2·b6257d78, 운영 미배포
- ① 서버 canManageReviewers owner→owner|admin(볼 수 있는 업무만) · 화면 canAddReviewer 같은 술어 · PERMISSION_MATRIX 갱신.
- ② 푸시·메일 링크 ?ws= (notification_link.withWorkspace) · 화면 utils/workspaceLink 를 ModeGate·NativeBridge·앱 루트 착지·로그인 뒤 네 문이 사용.
- Fable PASS(2026-10-15): 실HTTP L1 남의 업무 admin/owner 404 · L2/L3 200 · 실브라우저 9/9 + 로그인 전 링크 4/4 · 대조군 재현 · guard 68/69 EXIT 0 · health 85/85 · tenant 0.
- Fable 비차단 지적(다음에 할 것): ⓐ 메일 링크는 호출자 원문 link 를 써서 경로면 상대 href·없으면 CTA 없음 — resolvedLink 절대화로 맞출 것(notifications.js 메일 분기) ⓑ 로그인 전 링크의 planq_boot_deeplink 에 ws 가 남아 tabStore.applyBootPath 가 그대로 탭 경로로 씀 — ModeGate 에서 dl 도 splitWorkspaceParam().clean ⓒ agent/tools/tasks.js add_task_reviewers 설명문 «or a workspace owner» → owner/admin.
- 확인 못 함: 네이티브 앱 콜드 스타트 실기기.
### 완료: 담당자 아니어도 반복하기 + 태블릿 키보드 위 빈 띠 (방 cd805770 · 2026-10-12 · [Opus]) — 운영 미배포
- 원문 *"왜 내가 담당자가 아니면 반복하기 기능을 못 써? … 아이패드에서 수정/컨펌요청 입력하는데 키보드가 올라오고 이상한 공간이 키보드 위에 … 태블릿 아이패드, 안드로이드 다"*
- 반복: 업무 추가 폼이 남에게 요청하는 업무에서 반복 칸을 숨기고 서버(task_actions.createTask)도 반복을 지웠다(옛 §5.7). 이제 담당자와 무관하게 칸·저장. 예측시간 sanitize 는 그대로. 업무 상세의 반복 권한에 admin 이 빠져 있던 것도 서버 FIELD_RULES 와 맞춤. CLAUDE.md·PERMISSION_MATRIX §5.7 갱신.
- 키보드: 키보드 보정(유령 스크롤 되돌리기·가려진 입력 올리기·캐럿 추적, main.tsx)과 앱 셸 고정·키보드 중 안전영역 0(index.css)이 전부 (max-width:768px) 게이트라 태블릿이 못 받았다 → `(max-width: 768px), (pointer: coarse)` 로 넓힘(두 곳 같은 문자열). 큰 태블릿용 키보드 판정(터치 + 150px 넘게 줄면). 업무 상세 패널에 --vv-top(DetailDrawer 와 같은 계약). 폰 전용 «쓰기 모드» 는 768 그대로.
- 검증: 실HTTP 요청 업무 반복 저장·재조회 일치 · 마감 없음 400 · build EXIT 0(error TS 0) · 태블릿 프로브 4기기(iPad 834·1194·1024x1366·안드로이드 800) 패널 바닥=보이는 바닥·입력 보임·셸 고정, 데스크탑 마우스 대조군 변화 없음 · e2e mobilesweep·tabletchrome·mobilepanels 실패 0 · guard 68/69(posts.js godfile 기존).
- 확인 못 함: 실제 아이패드·안드로이드 기기(헤드리스는 iOS 가 화면을 미는 동작을 재현 못 함 — 높이 축소·변수로 모사). 안드로이드 앱(edge-to-edge)에서 키보드가 창을 줄이는지는 실기기 확인 필요.
- Fable 미검증(자체 검증) — 반복은 Irene 직접 결정·가시성 확대 없음, 키보드는 화면 배치.
- 2026-10-16 (방 bbf376c5): 실기기 확인 카드에 Irene «했어요»만(메모 없음) → 결과 모름. 45b2657d 는 10-16 운영 배포에 포함됨을 확인 → 앱(운영)에서 보는 «확인» 카드(✓/✗)로 다시 올림.

### Irene 할 일
- 아이패드·안드로이드 태블릿 앱에서 키보드 위 빈 띠가 없어졌는지 보기 (상황판 todomvamik8z) — ✗ 면 그 기기·화면 기준으로 다시 고친다(안드로이드는 edge-to-edge 에서 키보드가 창을 줄이는지부터).

### 완료: 팀 Google 캘린더 «올릴 캘린더 고르기» 1·2단계 — **Fable PASS 2026-10-15** (방 39dd5af6 · [Opus]+[Fable]) — 커밋 eb8336da, 운영 미배포(다음 배포 때)
- 설계 docs/TEAM_CALENDAR_PICK_DESIGN.md(Fable 설계 · Irene «권고대로» D1 A · D2 A) · 구현 메모 §6.
- 1단계: business_cloud_tokens.gcal_calendar_id·summary · 새 일정·Meet·보내기 = 고른 캘린더, 수정·삭제 = 링크의 캘린더 · 바꾸면 역방향 커서 리셋 · 고아 정리 = 고른 ∪ 링크들 ∪ primary ·
  GET/PUT /api/cloud/gcal/:biz/calendars|calendar-id(대표만 · 목록 안 id만 · 감사·신호) · 설정 카드 «팀 일정을 올릴 Google 캘린더»(목록 권한 없으면 [캘린더 고르기] = 권한 포함 재연결).
- 2단계: 구글 일정 칩 앞 점(sourceLook) · Google 층 칩 «… · irene@…» · 대체색 #64748B · 팀 일정 상세 «팀 일정 → Google 「이름」» · 캘린더 배너 «올라가는 곳».
- 운영: scripts/migrate-gcal-team-calendar.js 배포 슬롯 등록(migrate-task-action-items 뒤, 코드보다 먼저).
- 자체 검증: 서비스·라우트 26/26(가짜 구글 · 대조군 2 뒤집힘) · 실서버 HTTP 7/7 · 화면 3폭 42/42 · build EXIT 0 · health 85/85 · guard 68/69(posts.js godfile 기존) · uispec 597→599(장식 점 2).
- 확인 못 함: 실제 구글 호출(dev 에 팀 연결 없음) · 목록 권한은 구글 OAuth 심사 전(동의 화면 «확인되지 않은 앱» 경고).
- Fable 판정 PASS(2026-10-15, docs/FABLE_GATE_QUEUE.md 맨 위) · 마커 by:fable · 상황판 대기 done. 비차단: PUT 의 구글 목록 호출이 401/403 외 오류면 500 · 상세 GET 1회 추가.
- 확인용: 일정 1260 «[확인용] 팀 일정 (PlanQ)»(ws 6).

### 완료: 업무 «결과물 액션» 1단계 (방 c43d9583 · 2026-10-12~15 · [Opus]+[Fable 설계 1·검증 1 PASS]) — 커밋 5c180d58, 운영 미배포
- 설계 docs/TASK_ACTIONS_DESIGN.md(Fable 설계 · Irene «권고대로»). 표 task_action_items + services/taskActionItems(fulfill·unlink·발행 완료·첨부 삭제 pending·linkedTasksOf·handoff·회차 복사) + routes/task_action_items + 문서·일정 ?from_action= 넘겨받기(hooks/useFromActionHandoff·FromTaskBanner) + 업무 상세 «결과물 액션» 칸 + 문서 밴드2 «업무:» 칩.
- 운영: scripts/migrate-task-action-items.js 배포 슬롯 등록(migrate-task-security-level 뒤, 코드보다 먼저).
- 자체 검증: 실HTTP 42/42 · --suite taskactions 42/42(3폭, 넘겨받기 버그 수정 전 9건 실패) · health 85/85 · tenant 0 · guard 68/69(posts.js godfile 기존) · delivver 12/12 · docsheader 13/13.
- Fable gate PASS(2026-10-15, 실HTTP 86검사 · 테넌트 404 · 비담당 403 · 회차 박제 포함) — 판정 docs/FABLE_GATE_QUEUE.md. 비차단: guard 비통과 원인은 DOCFRESH(godfile 아님) · platform_admin 도 액션 적기 가능(설계 문서에 적음).
- 다음: 2단계(메일·프로젝트) — 별도 승인 없이 설계 §7 대로, 새 방에서.
- 확인용: 업무 3803(ws 6, 담당 member2 · 액션 3) · 문서 2768.

### 완료: 정기 점검 10/13 00:15 (방 76727e26 · 2026-10-12 · [Claude Code]) — 파일 변경 없음(이 기록만)
- 개발완료: 안 함 — 같은 폴더에 일하는 방 3개(f08b6db5 구글 캘린더 · a9337893 미출근 재개 · c43d9583 업무 액션 1단계). 미커밋 21파일은 c43d9583 의 업무 액션 1단계.
- 배포: 막힘 — 상황판 PlanQ Fable 대기 4건(dev-login · 초대 인앱 알림 · 미출근 재개 · 설문 v2 Phase 1). 운영 마지막 배포 62734c6d 뒤 커밋 17개(설문 v2·업무 공개 범위 2차·초대 링크 수리 등) 대기. Fable 대기가 풀리면 다음 정기 점검/수동 배포.
- 운영 피드백(읽기만): 열린 9건. 새 신고 #463(AI 로 프로젝트 옮기기·삭제) · #464(영수증 빈 화면) 은 a176687c · f8585dce 로 이미 고쳐져 운영에 나가 있음 — **답글만 없음**(다음 /개발완료 답글 단계). 삭제는 HIGH 라 AI 도구로 두지 않는 정책 — 답글에 그 이유를 적을 것.
- 밤 검사: 10-11 순찰은 2.5시간 무출력으로 시간초과(exit 124, 보고서 없음 — 10-10 은 실패 3) · 10-12 순찰은 지금 도는 중. 전체 검사 10-11: 132 중 실패 4(signflow ⑦b · detailopen 21 · chatreaction 폰 · leavesave ⑤⑦) + 하니스 죽음 projecttabs + 시간초과 bodygutter. 판정(실결함/검사기) 아직 안 함 — 고치는 방 몫.


### 완료: 업무 상세 필드 정돈 + 셀렉트 X 공간 (방 91f9e22d · 2026-10-12 · [Opus]) — 운영 미배포
- 원문 *"셀렉트박스에서 X까지 … 공간차지를 심하게 해서 실제 내용이 안 보여 · 공개범위랑 보안등급이 위에 붙어야 할까? 하단 … 박스들도 크게 크게 필요한지"*
- 공용 PlanQSelect: X(지우기)는 마우스를 올렸거나 포커스됐을 때만(터치는 누르면 나온다) · sm 화살표 여백 6→4 · `variant="inline"`(테두리 없는 속성 줄 모양, 높이 32) 추가. 셀렉트 쓰는 전 화면에 같이 적용.
- 업무 상세: 칸마다 «위 라벨 + 36px 상자» → «왼쪽 라벨 · 오른쪽 값» 속성 줄(넓으면 2열·폰 1열). 순서 담당자·기간 → 프로젝트·중요도 → 태그 → 예측·실제·진행·주요 업무.
  공개 범위·보안등급은 아래 «설정» 묶음(반복하기와 함께)으로 · 기본값이 아니면(나만·특정·내부·기밀) 제목 아래 배지 줄에도 · 상시 «자동 누적» 안내 상자 → «실제» 옆 ⓘ 누르면 펼침 · 반복하기 테두리 상자 제거 · 읽기 전용은 라벨 옆 자물쇠.
- 업무 추가 폼: 공개 범위·보안등급을 반복 아래 줄로.
- 실측(1440): 프로젝트 글자 칸 ≈55 → 116px · 메타 영역 ≈260 → 179px(+설정 줄) · 폰 390 프로젝트 248px 말줄임 없음 · 가로 넘침 0(3폭).
  상호작용: 데스크탑 평소 X 없음 → hover X → 누르면 PUT 1건(null) / 터치 탭 → X → 누르면 PUT 1건. L2 업무 제목 아래 «공개: 팀» 칩.
- Fable 안 씀(UI 배치·간격 — 권한·저장 규칙 불변). 확인용 업무 3737(L2)·302.

### 완료: 설문 v2 Phase 1 (방 bdb39775 · 2026-10-12 구현 · 2026-10-15 Fable PASS) — 운영 미배포(다음 배포 때)
- Fable 비차단 6건은 docs/FABLE_GATE_QUEUE.md 맨 위 — 다음 손볼 것: 운영 token 칸 정렬 규칙(migrate MODIFY) · 체험 중 발송 캡 · 백그라운드 발송 중단 시 queued 잔류.
- 설계 docs/SURVEY_V2_DESIGN.md(Fable, Irene «권고대로») §9 Phase 1 · 구현 메모 §12. 커밋 1dbe8940.
- 설문 = Q docs kind='survey'(새 문서 «설문» + 시작 질문 세트 4) · 네 탭(질문지·응답·통계·발행) · 문항 별점/척도(NPS)/예아니오 · 설명 = 문서 본문 ·
  보내기(받는 사람 → 같은 모달 2단계에 주소 전부 확인) · 개인 열쇠 1회 응답(410 already_responded) · 회수·다시 보내기 · 익명 · 월 발송 한도 · 일반 표의 «표|통계»·«설문으로 받기» 제거(옛 표-설문은 «설문으로 전환» 줄).
- 운영: scripts/migrate-survey-v2.js 배포 슬롯 등록(migrate-survey.js 뒤, 코드보다 먼저). 프론트 빌드 tsc 힙 5120→6144(기준선 5.2GB 실측).
- 검증: 실HTTP 53/53 · --suite survey 22/22(3폭) · health 85/85 · 가드 68/69 · tenant 0 · 대조군 2.
- 확인용: 문서 2701·2702(설문 [확인용]) · 2703(표→설문 전환) · 2704(복사본) · 2731(대조군) — ws 6.
- 다음: Phase 2(자동 규칙·cron·확인필요 카드·옵트아웃) 별도 방.

### 완료: 초대 링크 «만료되었거나 유효하지 않습니다» — 다른 계정으로 로그인한 채 열었을 때 (방 e263215e · 2026-10-12 · [Opus]) — 운영 미배포
- 원인(개발서버 재현): 이미 그 워크스페이스 멤버인 계정으로 남의 주소 초대 링크를 열면 자동 수락의 «중복 흡수» 가 **초대 행을 지우고** 성공처럼 대시보드로 보냈다 → 이후 링크 404 → 문구는 «만료». (멤버가 아닌 계정이면 그 계정이 대신 합류했다.)
- f2ad9e4a: 흡수는 초대 주소=본인일 때만, 아니면 409 already_member + 초대 보존(멤버·고객 둘 다) · 초대 화면은 주소가 다르면 자동 수락 안 하고 묻는다([초대 주소로 로그인] = 로그아웃 후 /login?redirect · [지금 계정으로 수락]) · 404/410 문구 분리.
- 검증: 실HTTP ①남의 초대 409·행 보존 ②본인 중복 흡수 200(종전) ③410/404 · build 0 · guard 68/69 · 실브라우저 390/834/1440 묻는 화면·자동 수락 요청 0·로그인 버튼 → /login?redirect=/invite/…. Fable 안 씀(단일 수락 함수 버그 — 파괴를 줄이는 방향, 수락 규칙 불변).
- 운영 실제 행은 확인 못 함(운영 읽기 권한 거부). Irene 의 그 초대는 이미 지워졌을 가능성이 커 배포 뒤 다시 보내야 한다. 확인용 초대: ws 6 invite-check@test.planq.kr.

### 완료: Q task 팝아웃 상단 정리 (방 b8c6f058 · 2026-10-12 · [Opus]) — 운영 미배포
- 원문 *"상단에 덜 중요한 영역이 너무 길어 … 오늘/이번주를 제목에서 … 보기 아이콘도 헤더로 … 업무추가·필터는 접어두면 … 태그관리가 나와서 완료가리기가 두 줄·정렬이 우측 밖"*
- ceda7971: 제목 «오늘 내 업무 ▾» 가 범위 고르기(PopoutScopeTitle) · 밀도 아이콘 헤더 · «직접 추가 · 보기 설정» 접기(PopoutToolsFold, 기본 접힘·요약 표시) · 태그 관리 = «태그별» 뒤 톱니 · 칩 줄 wrap.
- 검증: build 0 · guard 68/69 · health frontend 4/4 · --suite rowtags 0 · 실브라우저 420/520/760: 가로 넘침 0, 완료 가리기 한 줄, 정렬 창 안(420 은 둘째 줄 오른쪽), 톱니→태그 관리 모달, 범위 메뉴→제목 바뀜, 접기 상태 새로고침 유지. 목록 시작 y ≈300 → 159(접힘). Fable 안 씀(UI 배치).

### 완료: 초대 이메일이 계정이면 그 계정만 수락 (방 3a26aed0 · 2026-10-15 · [Opus]+[Fable 검증 PASS]) — 운영 미배포
- Irene «권고대로»(나). 540146b1: services/invites.inviteeAccountOf(활성·비게스트) → 다른 계정 수락 403 invite_for_other_account · 공개 GET invitee_has_account · 초대 화면 «지금 계정으로 수락»·회원가입 숨김.
- 자체 실HTTP 10/10 + 대조군 3/10 뒤집힘 · Fable 독립 15/15 · e2e invitenotify 0 · health 85/85 · guard 68/69 · build 0.
- 남은 비차단(다음 사이클): 정지 계정 이메일도 막기(status != deleted) · 회원가입/OAuth 가입이 남의 계정 앞 토큰이면 초대 가입으로 보지 않기(지금은 워크스페이스 0개 계정이 될 수 있음 — 막다른 길은 아님).

### 나중에 — 초대 «수락 전 멤버» 옛 행 정리 (방 3a26aed0 · 2026-10-16)
- 무엇: 이번 수정 전에 기존 계정에게 보낸 미수락 멤버 초대는 운영에서 아직 «수락 전 멤버» 로 남아 있을 수 있다(dev 는 1행이었다). 정리 스크립트 `dev-backend/scripts/migrate-invite-prefill.js`.
- 언제: 다음 운영 배포 때 — 배포 스크립트가 이 스크립트를 **읽기만** 으로 자동 실행해 대상 수·⒝(수락했는데 joined_at 없음)를 배포 기록에 남긴다.
- 그때 할 일: 배포 기록에서 그 출력을 읽는다. 대상 0행이면 끝. 있으면 ⒝=0 확인 뒤 행마다 결정(대기로 되돌림/멤버 확정)을 쉬운 말로 정리해 Irene 에게 «정리할까요?» 로 묻고, «예» 면 `--apply` 를 Irene 할 일로 올린다.
- (2026-10-16 Irene «이거 해야 하는 거 맞아? 뭘 해야 하는지 모르겠어» — 미리 읽게 하던 할 일 카드는 뺐다)
### 완료: 워크스페이스 초대 인앱 알림 + 수락 전 멤버 권한 (방 3a26aed0 · 2026-10-15 · [Opus]+[Fable 설계 1·검증 1 PASS]) — 운영 미배포
- e7f37914: 멤버 초대는 수락 때만 user_id(초대 순간 채워 수락 전부터 멤버였다) · services/inviteNotify 5경로(대기=범위 NULL·/invite/<token> · 프로젝트 고객 기존 계정=그 biz·프로젝트 주소) · 메일·재알림 메일 끔 · 수락/취소/삭제 때 읽음 · 알림 클릭 openNotificationTarget(앱 셸 밖은 문서 이동) · 멤버 초대 응답 토큰 제거 · 백필 migrate-invite-prefill.js(배포 땐 읽기만).
- 자체: 실HTTP 27/27 · 백필 대조군 9/9 · guard 68/69 · health 85/85 · secrets 10/10 · build 0 · e2e invitenotify 0. Fable 재측정 + 독립 프로브 15/15 PASS. 프론트 양성 대조군 빌드는 메모리 부족으로 못 돌림.
- Fable 비차단: 배포 스크립트의 읽기 전용 백필이 던지면 배포가 멈춘다(위험 낮음) · 다른 방 test-*.js 3개 남음.
- 확인용: member1 이 ws7(브랜드 파트너스) 초대를 받은 상태(알림 9358) — 수락하지 말고 둘 것.
### 완료: 미출근인데 업무 «자리 비움 감지·재개» (방 a9337893 · 2026-10-12~15 · [Opus]+[Fable 설계 1]) — 커밋 59f9ba65·e8d3aeb0·ec327235·3329651c, 운영 미배포
- 원인(운영 읽기): 업무 542 세션 236 — 자동 출근 11초 뒤 [취소] → 근태 행만 지워지고 측정 2h40m 계속 → 자리 비움 자동 멈춤.
- Fable 설계 판정(docs/FABLE_GATE_QUEUE.md 2026-10-15): ①취소 = 그 워크스페이스 세션 종료(undo_clock_in) ②/focus/current 범위 — 다른 워크스페이스면 «다른 곳에서 진행 중» 한 줄+전환 ③자동 마감 2차 패스 — 근태 없이 날 넘긴 세션 day_end.
- 자체 검증: 실HTTP 취소→stopped/undo_clock_in·업무 in_progress·current null · ws7 세션 무변(범위 끈 대조군 FAIL) · ws7 창 응답 원문에 제목·task_id 0(범위 끈 대조군 FAIL) · day_end/오늘 무변/clock_out 순서(2차 패스 끈 대조군 FAIL) · 위젯 3폭 other_workspace·재개 없음 · build EXIT 0·error TS 0 · guard 68/69 통과.
- 완료 검증 Fable 안 씀 — 정해진 설계의 구현이고 판정이 전부 기계(대조군)로 갈림. 운영 세션 236 은 배포 뒤 첫 자동 마감이 day_end 로 닫는다.
### 완료: 묶음 3건 중 1건 — 모바일 업무 상세 제목 가림 (방 53a6ad69 · 2026-10-12 · [Opus]) — 운영 미배포
- ① e4a918c2: 업무 상세의 포커스 바(sticky top:0)가 제목 **위**에 있어 폰에서 조금만 스크롤해도 제목을 덮었다(390 실측) → 제목 아래·메타 앞으로. 4폭(390·360·834·1440) 실측: 열었을 때 제목 위 겹침 0, 스크롤 시 바는 제목이 지나간 뒤에만 붙음. build 0 · guard 68/69 · --suite mobilechrome 0. Fable 안 씀(UI 배치). 확인용 업무 3774(ws 6, owner 담당·진행중).
- ②·③ 대기열 앞으로 되돌림(설계 필요): 초대 인앱 알림 = 기존 계정 초대가 수락 전부터 멤버 권한(getUserScope·워크스페이스 목록이 joined_at 미확인) → Fable 설계부터 · 미출근인데 «자리 비움 감지·재개» = 근태↔포커스 규칙 3건(Fable 설계 + 운영 세션 행 확인). 정찰 계획 qmv5802hf·qmv590ace.

### 완료: 업무 공개 범위·보안등급 2차 — 문서·일정과 같은 구조 (방 99ab9b7d · 2026-10-12 · [Opus]+[Fable 설계 1·검증 4]) — 운영 미배포
- Irene *"문서랑 일정처럼 워크스페이스 특정 멤버 나만보기 등 같은 기능 … 보안등급도 있잖아. 기존 기능 그대로"* → 1차 «내부 업무»(ff10d3f6)를 갈아엎음.
  `tasks.vlevel`(L1 나만·L2 프로젝트/특정 멤버·L3·L4, 기본 L3)·`target_member_ids`·`security_level`(일반·내부·기밀). 설계 docs/TASK_SECURITY_LEVEL_DESIGN.md.
- 이름 박힌 사람(작성·담당·요청·컨펌)은 범위 무관 · owner/admin 도 남의 L1 못 보고 못 고침(D2) · 고객은 관계로 닿되 L1·지정 멤버 제외 · 등급은 외부 공유만 막음.
- 판정 한 곳 access_scope.canAccessTask/taskListWhere · 값 정규화 services/taskVisibility · 실시간 services/taskRoom.emitTask(L1·L2 행은 볼 사람 개인 방만) ·
  행동 계층 fieldContext·canChangeStatus·canManageReviewers·revertStatus 의 관리자 권한 ∧ canAccessTask · 워크플로 loadTaskOrFail 404 · 멘션 알림 거름 · 업무 제목 노출 경로 약 35곳.
- 화면: 업무 상세·추가에 문서와 같은 VisibilityChip+VisibilityChangeModal(추가 폼은 외부 숨김 — modal 에 hide prop) + 보안등급 선택.
- Fable: 2차 FAIL(행동 계층·projects PATCH·멘션) → 3차 FAIL(태그·AI 추정) → 4차 PASS(델타). 자체: 실HTTP 51/51 + 대조군(13건·3건 뒤집힘) · guard 68/69 · health 84/84 · e2e tenant·realtime·seriesscope·respline·taskaddparity·clientlink 0 · build 0 · 화면 3폭.
- 남은 비차단: comments·share·attachments 가 못 보는 업무에 403(존재만 노출) · cue/rerun 400 · 업무 목록 행 공개 범위 표시 없음.
- 운영: migrate-task-security-level.js 배포 슬롯 등록(코드보다 먼저). 확인용 3734~3739.

### 완료: Cue 원가 절반 + 턴 과금 + «나» 담당자 수리 (방 004312ae · 2026-10-12 · [Opus]+[Fable 검증 2]) — 운영 미배포
- be965698: 프롬프트 캐시(고정 지시문/컨텍스트 두 메시지 · 24h 보존 · 마지막 라운드 allowed_tools) — 질문 1건 실비 $0.021 → 약 $0.010(도구 47개 그대로). 원장에 캐시 단가 반영.
- 이어서(Irene «권고대로»): Cue 횟수 = 질문 한 번(턴) 1회 · 카드/묶음 실행 0 · 실행엔 한도 게이트 없음(외부 MCP 는 그대로). 사용량 라벨 «Cue 질문 (답변·실행 제안)». Fable PASS.
- 덤 수리: Cue 프롬프트에 질문자가 없어 «담당자는 나» 가 다른 멤버로 잡혔다 → `[질문자]` 줄.
- 남은 권고(Fable): Pro 7,500 은 운영 원가가 요금 50% 넘는 Pro 가 나오면 4,000 으로 — 월 원장 점검. ws 6 시험 워크스페이스 Cue 한도(무료 30)는 이번 실측으로 10월분 소진.
### 완료: 업무 «내부 업무» 보안등급 (방 99ab9b7d · 2026-10-12 · [Opus]+[Fable 설계 1·검증 1]) — 운영 미배포
- 원문 *"업무에서도 보안이랑 공유범위 있어야 하지 않아?"* → Fable 설계: `tasks.security_level`(general/internal) 한 축. 공개 범위(나만/프로젝트만)는 두지 않음(멤버끼리 열린 문화 · 업무 읽는 121곳 감사 필요 → 요구가 생기면 2단계).
- internal = 프로젝트 고객·대화 참여 고객·게스트 프로젝트 링크·공개 공유 링크에서 행이 빠짐 · 멤버와 이름이 박힌 관계자 고객(담당·작성·요청·컨펌)은 그대로 · 올리면 공유 링크 끊김 · 복사·반복·시리즈 전파 승계 · 바꾸는 사람 작성자(고객 제외)∨owner/admin.
- 화면: 업무 상세 «공개» 칸(일반 / 내부 업무(팀만)) · 업무 추가 폼 «공개». 설계·검증 docs/TASK_SECURITY_LEVEL_DESIGN.md.
- 운영: `scripts/migrate-task-security-level.js` 배포 슬롯 등록(코드보다 먼저).
- 확인용 업무 3621(일반)·3622(내부)·3623(내부+고객 컨펌)·3624(내부 복사).


### 완료: 묶음 2건 — 업무 보안·공유범위(되돌림) · Cue 다중 업무 추가 (방 4bde0632 · 2026-10-12 · [Opus]+[Fable 설계 1·검증 1]) — 운영 미배포
- ① 업무 보안·공유범위: 손대지 않고 대기열 앞으로 되돌림 — DB 칸 신설·권한 술어 전수·2026-09-27 Fable «업무 등급 칸 안 만든다» 판정을 뒤집는 일이라 Fable 설계부터(정찰 계획 .claude/plans/qmv4pwb7c.md).
- ② Cue 다중 업무: 3e18ef9d(Cue 바 — 나열 항목당 1건 프롬프트 · 번호/글머리 개수 안전망 1회 재요구 · «N개 중 M개» 안내 · 8개↑ 출력 상한 8000, 옛 코드는 20개에서 전량 유실)
  + b6695797(Fable 설계 (다) — Cue 대화·음성: 업무 2개↑ = task_batch 후보 목록 한 덩이(상한 40) → AiCandidateCard + [N개 추가] → confirm mode cue_batch → 행마다 executeTool(create_task) · 계량 턴 1회 · 행별 부분 실패 · Q task 팝아웃에 CueTaskBar).
- 남은 작은 것: Cue 바 제목에 «수정 작성» 처럼 «작성» 이 붙는 경우가 있음(개수는 맞음).

### 완료: 서명 화면을 «웹으로 보기» 틀로 (방 29329809 · 2026-10-12 · [Opus]) — 운영 미배포
- 원문 *"서명하기 할 때 나오는 페이지는 웹으로 보기 페이지처럼 … 우측하단 채팅버튼 없고. 내가 로그인해서 이렇게 나오는 거야? 웹용으로 열리는 건 다 통일된 상단"*
- dac43aa4. 원인: `/sign/` 만 공개 화면 판정에서 빠져 Q helper(채팅 모양) 버튼이 로그인·비로그인 모두 떴고, 로그인이면 도크·메모 단추까지 → `utils/publicSurface.isPublicViewPath`(/public/·/sign/).
  머리줄은 `PublicPageShell` 의 `PublicToolbar` 한 벌 — 서명 화면·옛 공개 문서·공개 청구서가 같이 씀(서명 화면은 단계·할 일 줄과 묶음째 sticky). 서명 후 머리줄 PDF.
- 검증: 3폭 × 비로그인/로그인 6/6(고정 버튼 0 · 머리줄 전폭 · 스크롤 뒤 할 일 줄 위 · 가로 넘침 0) · 수정 전 같은 측정에서 버튼 1개(대조) · build 0 · guard 68/69 · --suite signature 0 실패 · Fable 안 씀(UI 틀).
- 확인 못 함: 공개 청구서·옛 공개 문서(/public/docs) 실화면 — 개발 DB 에 열린 공유 링크 없음(빌드만).
- 웹 보기의 홍보 띠(«플랜큐 바로가기»)는 서명 화면에 안 넣음 — 같은 자리에 민트색 할 일 줄이 있어 두 띠가 겹친다.

### 완료: 묶음 3건 — 설계 3개 승인됨 (방 f3217c67 · 2026-10-12 · [Opus]+[Fable 설계 3회]) — 연동 팝업 수리는 완료, 운영 미배포
- ✅ 연동 팝업(0f0ec6b0): OAuth 마지막 화면 인라인 스크립트가 helmet CSP 에 막혀 닫기·완료 신호가 한 번도 안 돌던 것 → 같은 출처 파일 /api/oauth/popup-done.js·native-return.js + 화면 한 벌 utils/oauthPopupPage + 받는 쪽 hooks/useOauthPopupDone(4곳).
  내 외부 연동 › 구글 캘린더에 «Q calendar 에 보일 캘린더 (여러 개)»(visible-calendars 재사용). 검증: 팝업 7/7(대조군 뒤집힘) · 화면 3폭 · PUT 1건 · build 0 · guard 68/69 · health 84/84 · Fable 미검증(자체 검증 — 값 없는 정적 스크립트, CSP 안 넓힘).
- 설계 3개(커밋 5a99dbf7·47729c14·0f0ec6b0 안 문서): docs/SURVEY_V2_DESIGN.md · docs/TASK_ACTIONS_DESIGN.md · docs/TEAM_CALENDAR_PICK_DESIGN.md.
- Irene 답(2026-10-12): 8개 모두 «권고대로». 결정 내용:
  설문 ①자동 발행 메일 = 확인 후 발송(대표가 규칙별 자동 전환) ②일반 표에서 «표|통계»·«설문으로 받기» 뺌 ③월 발송 한도 starter20/basic100/pro500/business2000/enterprise무제한, 자동 규칙 basic↑
  업무 액션 ④적기=작성자·담당자·owner·admin, 만들러 가기·연결=담당자만 ⑤액션으로 만든 문서는 결과물 첨부에 자동 ⑥1단계 문서·일정 → 2단계 메일·프로젝트 이어서
  팀 캘린더 ⑦팀원에게 회사 계정 캘린더 읽기는 안 열고 «팀 일정을 올릴 캘린더 하나 고르기»만 ⑧바꿀 사람 = 대표만
- 구현은 상황판 대기열에 3건 넣음(각 방이 설계 문서대로 구현 → Fable 완료 검증 1회): 설문 v2 Phase 1 · 업무 액션 1단계 · 팀 캘린더 올릴 캘린더 고르기.

### 완료: dev-login — 상황판 «시험 계정으로 열기» (방 1a0f9989 · 2026-10-12 · [Opus]) — 운영 미배포
- 커밋 827b9df8. POST /api/auth/dev-login(개발 .env DEV_LOGIN_SECRET + NODE_ENV=development 일 때만 마운트, 그 밖 404) · /dev-login 화면 · 배포 가드(운영 .env 에 비밀 있으면 멈춤) · CLAUDE.md «시험 역할» 표 · [확인용] 7일 정리 scripts/cleanup-check-data.js(/개발완료 7단계).
- 시험 계정 4개(owner·member1·member2·client) 약관 버전을 개발 DB 에서 현재 버전으로 맞춤(착지 화면이 재동의 창에 덮였다).
- 상황판 쪽 «planq devLogin 켜기» 는 서버 대기열에 넣음 — 켜진 뒤 실제 버튼 클릭 1번 확인 남음.
#### (이전) 답 기다림: dev-login Fable 검증이 또 허락 창에서 멈춤 (2026-10-15) — 해결: 4차 재시도 Fable PASS
- 무엇을: Fable 이 개발서버에서 검사(시험 스크립트·명령)를 돌리려 할 때마다 허락 창이 떠서, 화면을 안 보는 백그라운드에서는 3분 뒤 닫힌다(10-12 1회 · 10-15 1회, 그 사이 2회는 한도 429).
- 왜: 로그인 영역이라 완료 검증 Fable 1회가 규칙. 판정 없이는 운영 배포 보류.
- 답이 오면: «지금 돌려» → Irene 가 이 방을 보고 있을 때 /fable-검증 다시(허락 창을 Irene 가 누름) · «자체 검증으로» → Fable 대기만 남기고 배포 때 «자체 검증만으로 배포할까요?» 로 묻기.

#### (이전) 답 기다림: Fable 완료 검증이 허락 창에서 멈춤 (2026-10-12)
- 무엇을: Fable 이 개발서버에서 검증용 시험 스크립트(dev-backend/fable-devlogin-test.js — 개발 3003 에 dev-login 호출만, 운영 무관)를 돌리려다 허락 창에서 3분 넘게 멈춤 → 창이 닫혀 실행 안 됨. 남은 스크립트는 지움.
- 왜: dev-login 은 로그인·권한 영역이라 완료 검증 Fable 1회가 규칙(아직 판정 없음 · 마커 없음).
- 답이 오면: «다시 돌려» → 이 방이 /fable-검증 을 다시 부른다(같은 사실 묶음) → PASS 면 마커 + 서버 대기열에 «planq devLogin 켜기(커밋 827b9df8)» 넣기 · FAIL 이면 지적 고치고 재검증.
  «Fable 없이» → 자체 검증 숫자로 보고(«Fable 미검증(자체 검증)») + 상황판 Fable 대기 + 서버 대기열 넣기. 운영 배포는 Fable 통과 뒤로.

### (해결 2026-10-15 Fable PASS) Fable 대기: dev-login 완료 검증 · Fable 한도가 풀리면(상황판이 깨움) · 그때 /fable-검증 다시(같은 사실 묶음 — 커밋 827b9df8), PASS 면 마커 by:fable + 상황판 fable-wait done. 운영 배포는 Fable 통과 뒤로.
- 2026-10-12 재시도 2회 → 둘 다 Fable 한도(429)로 중단(fid fwmv5atte1 다시 올림). 마커 by:unavailable. 상황판 서버 대기열에 «planq devLogin 켜기» 넣음(개발 상황판 버튼만 — 운영 무관).

#### 덤으로 발견 — 관리자 «사칭» 새 탭이 사칭이 아니다 (고치지 않음, 기록만)
- 실브라우저 실측(admin@test → /admin/users → member1 [사칭]): 새 탭 `/dashboard?_impersonate=1` 이 **관리자 본인**으로 열림 · sessionStorage 비어 있음(noopener 라 안 넘어감) · 사칭 배너 없음.
- 게다가 사칭 토큰을 새 탭에 싣는 코드가 아예 없다(_impersonate 를 읽는 곳 0) · 관리자 탭에는 `impersonate_pending` 이 남아 isImpersonatingNow()=true → **관리자 탭의 초안 저장이 꺼진다**.
- 권한 영역(사칭)이라 설계부터 — 상황판 대기열에 넣음.

### 완료: 묶음 3건 — 메일 AI 요청 바 · 구독 환불 입구 · 업무시작↔근태 동기화 (방 877fb88f · 2026-10-12 · [Opus]) — 운영 미배포
- ① 메일 AI(ed4cafe4): 답장창 본문 위 늘 보이는 AI 요청 바(cueBarShell 별표·빨간 라인) — 처음부터 요청 / 비우고 Enter=알아서 / 초안 있으면 다듬기. 하단 [AI 초안 다시 생성] 삭제. 새 메일도 같은 바. 서버 프롬프트 «초안 없이 요청» 분기. 첨부 접기는 a00f2785 에 이미 있음.
  실호출: 빈 요청 200 · 요청만(«다음 주 화요일 2시 통화») → 초안에 반영 · 다듬기 200. 화면 390/820/1440: 바가 본문 위·가려짐 없음·다시생성 버튼 0.
- ② 환불(4c5a8520): 결제 이력 위 약관 제4조 기준 + [환불 요청](대표) · 행마다 [환불 요청] → 문의 창 «환불» 모드(contact_inquiries kind general, source plan_refund → 플랫폼 관리자). 선결제 카드 «환불 안 함» → «약관 제4조». PaymentHistory 분리.
  남은 것(필요하면 별도 일, Fable 설계): 일반 구독 환불을 서버 술어·요청 버튼으로(일할 계산 등). 신고 고객 건은 관리자 결제 관리 [환불]로 수동 처리 가능.
- ③ 근태(0117c462): useAttendance 가 focus:refresh·focus:updated·socket:reconnected 에도 다시 읽음 · /focus/resume 자동 출근 · focusSync 진입(보류 해제·컨펌 취소)은 담당자 본인 동작일 때만.
  실측: 퇴근 상태 → resume → working / 남이 진행 전환 → done 유지(음성 대조군) / 본인 → working. 화면: broadcast 놓침 → «퇴근» 유지(대조군) → focus:refresh → «근무중».
- 가드 68/69 통과 · health-check 84/84 · build EXIT 0 · Fable 안 씀(UI·기존 규칙 확장)

### 답 기다림: 다른 워크스페이스(기율 법무) 업무 알림이 담당자·컨펌자 아닌 Irene 에게 오는 이유 (방 c7943a5f · 2026-10-12 · [Opus]) — 코드 변경 없음
- 원문 *"내 업무가 아닌데 알림이 와. 다른 워크스페이스에서. 내가 담당자도 아니고 컨펌자도 아닌데 기율 법무에서 하는 업무 알림"*
- 코드상 원인 후보(확정은 운영 읽기 필요 — 이 방은 운영 읽기 권한 거부):
  ① 업무 알림 받는 사람에 **«만든 사람(created_by)»** 이 들어간다 — 댓글·컨펌 시작·완료·보류·기간 변경(task_actions.notifyComment / notifyStatusAudience · taskTransition · tasks.js PUT).
     요청자 칸이 비면 만든 사람이 곧 «요청자». 정기 업무는 회차마다 원본의 created_by·request_by 를 그대로 복사(recurringTaskGenerator:130·149) → 한 번 만든 시리즈가 영원히 알림.
  ② **notify() 는 받는 사람이 지금 그 워크스페이스 사람인지 보지 않는다**(routes/notifications.js:113 — 워크스페이스 삭제·게스트·AI 만 거른다). dev 실측: 내보낸 멤버(ws3 user15)에게 notify → 알림 행 생김.
  ③ 종(알림 목록)은 현재 워크스페이스만 보여 주지만(Q7) 푸시·메일은 워크스페이스 무관 → 폰·메일로만 «이상하게» 온다.
- **운영 확인 결과(Irene 실행, 2026-10-12)**: 기율법률 = ws 17(owner_id 8). Irene 계정 user 1(irene@irenewp.com)이 ws17 **owner 멤버**(내보내진 것 아님).
  업무 563~582 등이 **created_by=1(Irene) · 담당자 user 8 · 요청자 칸 비어 있음** → 담당자가 완료하면 «완료» 알림이 만든 사람=Irene 에게 간다(오늘 2203·2205·2207·2208 «Q Task · 완료»). 컨펌자로 걸린 것 0. 누수·버그 아님 — 규칙대로.
  어떻게 user1 이름으로 만들어졌는지(직접 입력·ChatGPT 연동 등)는 `.claude/plans/notify-gilyul-check2.js` 로 확인 가능(미실행).
- Irene 답(2026-10-12): 규칙은 A(그대로). 이어서 *"등록자를 나 말고 최정우로 바꿀 수 없어? 운영서버가 이렇게 했나본데"*
- ⏸ 답 기다림: 운영 데이터 수정 — ws17 업무 중 created_by=1(Irene)·담당자 user 8 인 것의 created_by 를 8(최정우 추정)로. 화면에 «등록자 바꾸기» 기능은 없음.
  수정 스크립트를 쓰려 했으나 이 방 권한이 «운영 데이터 변경 스크립트 작성» 을 막음 → Irene 의 명시 허락을 받고 다시. 답이 «진행» 이면: user 8 이름=최정우·ws17 멤버 확인(아니면 중단) → 한 트랜잭션 UPDATE + audit_logs 1행(task.creator_reassign, id 목록) → 미리보기 명령/적용 명령을 Irene 가 «!» 로 실행.
- (이전) «만든 사람 = 자동 요청자» 규칙을 바꿀지 — A 그대로 두고 Irene 가 기율법률 알림 설정에서 업무 알림 끄기(권고, 지금 가능) / B 요청자를 명시로 고른 경우에만 요청자 알림(규칙 변경 → Fable 설계). 답이 B 면 Fable 설계 → 구현.
- 별건(②): notify() 가 받는 사람의 현재 멤버십을 안 본다 — 내보낸 멤버에게도 감. 이번 신고 원인은 아니지만 고칠 거리(고객 알림도 같은 문이라 Fable 설계 필요).
- 운영 확인 명령(읽기 전용): `ssh 87.106.78.146 'cd /opt/planq/backend && node -' < /opt/planq/.claude/plans/notify-gilyul-check.js` (dev 에서 돌려 동작 확인)
#### Irene 할 일
- (했음) 운영에서 기율 법무 알림 원인 확인 명령 실행

### 완료: 팝아웃 직접 정렬을 «보기마다 따로» 로 + Cue 칸 여백 (방 56931759 · 2026-10-12 · [Opus]) — 운영 미배포
- Irene 답 *"Cue에게 말하기가 위에 여백없고, 좌우 레이아웃 여백없어서 이상해. 그리고 내 순서라는 기능이 아니라 … 태그별로 그룹핑된 상태에서 순서 달라야"*
- «내 순서» 보기 칩 삭제 → 정렬 «직접 정렬»(기본) + 손잡이로 태그별·프로젝트별·마감일별 **각각** 순서. 표 `task_user_orders.view_key` 추가(설계 문서 «2026-10-12 수정» 절).
- Cue 칸: 팝아웃에서만 좌우 12px·위 10px(탭 줄·목록과 같은 축). CueTaskBar 를 넣은 커밋 b6695797 이 compact(여백 0)로 얹었다.
- 검증(Fable 안 씀 — 승인된 설계에 보기 축 한 칸 추가, 권한·범위·공개 표면 무변경): 서버 25/25(보기 400·태그에서 옮겨도 마감일 불변·my_order 보기별) ·
  화면 40/40(520·390 — Cue 여백 12/12·위 10 · 칩 없음 · 옛 저장값 recent/mine 이어도 직접 정렬·탭 기본 보기 · 태그 그룹 안 이동 PUT 1(그 그룹 4건만) · 다른 태그 위 원위치 PUT 0 ·
  태그별 이동 뒤 프로젝트별·마감일별 불변 · Alt+↓ · 이름순 손잡이 0 · 퀵애드 그 날짜 그룹 맨 위 · 대조군) · migrate 2회 + 빈 표 새로 만들기 경로(임시 이름) · build EXIT 0 · guard 68/69 · health 84/84 · tenant 0.
- 시험 데이터: 태그 «[확인용] 디자인/개발» ws6(88·89, 시험 오너 업무 8건) · ws5(90·91). dev 의 user 3 옛 순서 49행은 «마감일별» 로 이관.

### 완료: 오늘의 업무 팝아웃 — 한 줄 «촘촘히» 보기 + 끌어서 옮기는 «내 순서» (방 56931759 · 2026-10-12 · [Opus]+[Fable]) — 운영 미배포
- 원문 *"팝아웃에서 더 많은 할일이 보이게 … 한줄로 극단적으로 최소화 … 태그별로 보든 마감일별로 보든 소팅을 자유롭게 … 리스트 재배치가 자유자재였으면"* → 제안 «권고대로».
- f7ba4c93. Fable 설계 1회(docs/TASK_USER_ORDER_DESIGN.md) → 구현 → Fable 완료 검증 **PASS**(마커 by:fable).
- ① 촘촘히(탭 줄 오른쪽 토글, 두 탭 공통): 행 62~86 → 32px, 한 화면 6~8 → 18행(520/380/760 실측). 상태는 색 점(요청·수정요청·검토·승인완료만 글자).
- ② 내 순서: 새 표 `task_user_orders`(사람×업무, pos 정수 간격) · `PUT /api/tasks/my-order` · my-week `my_pos` · user 방 `task:my-order`.
  보기 칩 «내 순서»(처음 기본, 그룹 없음) + 정렬 셀렉트 «내 순서»(그룹 안) · 손잡이 끌기 · Alt+↑/↓ · 다른 그룹 위 드롭은 원위치 · 퀵애드는 맨 위.
  팝아웃 우선순위 번호 버튼·안내줄 내림(priority_order 데이터·메인 Q task 번호 그대로). 공용 훅 `Common/useVerticalReorder`(메인 목록에 나중에 같은 훅).
- 검증: 서버 20/20 · 화면 32/32(520·390) · 촘촘히 FAIL 0 · build EXIT 0 · guard 통과 · health 84/84 · tenant 0 · Fable 독립 재측정 + 동시 PUT 3건 직렬화.
- 운영: `migrate-task-user-order.js` 를 배포 슬롯(PM2 reload 전)에 등록 — 다음 배포 때.
- 다음 사이클(Fable 비차단): move() 의 visible_ids 500 상한 자르기(placeOnTop 만 자름) · 메인 Q task 목록 끌기·우선순위 정리는 Irene 가 팝아웃을 써 본 뒤.
- 시험 데이터([확인용], ws 5): 업무 «[확인용] 내순서 …» 몇 건.

### 완료: 묶음 3건 — 구독관리 체험 워크스페이스·주인 이메일 · Q task 추가 위치 보여주기 · Cue 팝아웃 [열기] (방 ad990038 · 2026-10-12 · [Opus]) — 운영 미배포
- ① 원문 *"stillstandingahhcat@gmail.com 이 만든 워크스페이스가 구독관리에 안 나와 … 사용자/이메일이 표시되어야지"* →
  구독관리는 `subscriptions` 행만 나열했는데 그 행은 «결제하기» 때만 생긴다 → 가입만 한 체험 워크스페이스는 영영 안 나왔다(면제·옛 이관 active 도 같은 구멍, dev 9건).
  `services/adminSubscriptionView.js` 한 함수(목록·요약 같이) — 전체 탭에 섞고 «체험» 탭 신설 · 주인 이름·이메일 표시·검색 · 체험 종료일·가입일.
  같은 길에 옛 결함: 구독 행의 created_at 이 늘 비어 있었다(createdAt 속성) → 고침. de9f5626.
  **그 계정의 운영 상태는 확인 못 함**(운영 읽기 권한 거부) → Irene 할 일로 올림.
- ② 원문 *"기본 정렬이 마감일 기준 … 추가하면 어디 추가된 건지 알 수 없어 … 오늘의 업무 팝업은 최신등록순 … 의견"* →
  정렬은 그대로(메인 = 무엇부터 할까 / 팝업 = 방금 넣은 것 훑기 — 목적이 달라 다른 게 맞다). 추가 직후 그 행으로 스크롤 + 1.8초 강조, 지금 보기에 안 걸리면 아래 안내 줄 + [열기]. `hooks/useRevealRow`(추가 폼·Cue 바·AI 생성 3곳). f27f0047.
- ③ 원문 *"Cue 팝아웃에서 업무 3개 추가해달라 했는데 하나만 … 열기 누르니 팝아웃이 닫혀 … 버전 문제야? 요금"* →
  모델 문제 아님(이미 gpt-5.1). 3개→1개는 운영 코드의 «카드 1장» 한도 — dev 에는 c17375ad(카드 최대 3장)로 이미 고쳐져 있다(운영 미배포).
  [열기] → 팝아웃 자기 창에서 이동 후 window.close() 였다 → 메인 창에 새 탭으로 부탁하고 팝아웃은 남김. 093c8c1c.
  요금 실측(dev cue_usage 10월): Cue 질문 1건 평균 입력 15.8k 토큰 · $0.023 (9월 읽기 루프 전 $0.006 의 4배 — 도구 설명 47개 ≈ 41k자를 매 라운드 보냄).
  카드 나온 턴은 원장에 $0 로 남아(«제안 무과금») 실제 원가가 빠진다. 한도 끝까지 쓰면 Basic 1,500회 ≈ $35 (요금 $39) · Pro 7,500회 ≈ $172 (요금 $79).
  → 원가 줄이기·실비 기록은 상황판 대기열에 따로 넣음(Fable calc 대상).
- 검증(Fable 안 씀 — 관리자 읽기 목록·화면 동작·팝아웃 버튼): 빌드 EXIT 0 · 가드 68/69 · health 84/84 ·
  ①API 9검사(체험 행·summary 체험 수 == 목록 · 주인 이메일 검색 · 활성 탭 제외 · pending 생기면 한 번만·체험 탭에서 빠짐 · 만든 날 빈칸 0·내림차순·2쪽 일치) + 3폭 화면(주인 이메일 보임·elementFromPoint · 버튼 없음 · 가로 넘침 0 · 이메일 검색 1건)
  ②3폭 6검사(46~50번째 행 = 원래 화면 밖 → 추가 후 화면 안·elementFromPoint 자기 행 · 검색 걸린 추가 → 안내 줄 → [열기] → ?task=<새 id>) — 폰은 처음 실패(추가 창이 닫히며 포커스 복귀가 목록을 되감음) → 시작 450ms 로 고쳐 통과
  ③실 Cue 왕복: 팝아웃에서 업무 추가 → [열기] → 팝아웃 주소 그대로·메인 창 /tasks?task=3576 새 탭.
- 미측정: Cue 바·AI 생성 경로의 강조(같은 함수, LLM 호출 비용으로 생략). 다른 방 i18n 가드 1건(QCalendar/types.ts 주석) 같이 고침 3d9f95ad.
- 시험 데이터([확인용]): 워크스페이스 4106 «[확인용] 체험 가입자 워크스페이스»(주인 trial-signup-check@test.planq.kr) · 업무 3574·3575(ws 5) · Cue 업무 3576.
#### Irene 할 일
- 운영에서 stillstandingahhcat@gmail.com 워크스페이스 상태 읽기 확인 — 상황판에 올림

### 완료: 캘린더 2단계 — 구글 캘린더마다 칩으로 보기/가리기 (방 f08b6db5 · 2026-10-12 · [Opus]+[Fable]) — 운영 미배포
- 원문 *"구글캘린더 종류는 연동이 안되는 거야? … 다른 캘린더 앱은 구글캘린더 종류 다 가져와서 보기/가리기 다되는데"*
- Fable 설계 1회 → 구현 → Fable 완료 검증 **PASS**(마커 by:fable, 23e9adf0). 23e9adf0 · 6be0aa4f(비차단 1·4·5).
- Google 칩을 켜면 캘린더별 칩(구글 색 점+이름, 5개 넘으면 +N 팝오버) → 누르면 바로 가리고 서버 저장 `PUT /api/me/calendar/visible-calendars`
  (`external_connections.metadata.visible_calendar_ids`, 상한 15, 올리는 캘린더는 늘 포함). 미저장 기본 = 구글 selected.
  목록 권한 없는 옛 연결 = 종전(하나) + «다른 캘린더» 팝오버에서 권한 요청(버튼 한 벌 `components/Calendar/GoogleCalendarListConsent`).
- 일정 색 = 캘린더 색 · 상세 «캘린더» 줄 · PATCH/DELETE 에 calendar_id 필수(쓰기 캘린더 또는 보이는 owner·writer 만, 아니면 403).
- 조회 연결당 15·동시 4·25초·일정 60초/목록 24시간 캐시(metadata.calendar_list_cache)·실패는 캘린더 단위.
- 방침 문구 ko/en(구독 캘린더 목록 쓰임 확장) + `bump-privacy-version.js` TARGET **1.4** → 다음 배포 때 전 사용자 재동의 창. PrivacyPolicy effectiveDate 2026-10-12(배포일과 다르면 그날로).
- 검증: 서버 36/36(가짜 구글 API·양성 대조군 2건) · 화면 48/48(1440·768·390+옛 연결) · build EXIT 0 · guard · secrets 9/9 · tenant 0 실패.
- 미측정: 진짜 구글 왕복(dev 개인 연결 0건). 운영 영향 연결 2건(목록 권한 ○ 1 · ✕ 1) — 배포 뒤 목록 권한 있는 계정으로 칩 확인.
- 다음 사이클(Fable 비차단 2·3): Cue 맥락(`cue_context.js:279`)도 보이는 캘린더들로 · 목록 캐시를 metadata 밖으로(동시 쓰기 덮임 가능성).
#### Irene 할 일
- Google Cloud 콘솔 «데이터 액세스» 의 calendarlist.readonly 사용 이유를 새 문안으로 교체(심사 제출 때) — `docs/GOOGLE_OAUTH_CALENDARLIST_GUIDE.md` ④ · 상황판에 올림

### 완료: 묶음 3건 — Cue 링크 점검 · 캘린더 분류 버튼 · 날짜 호버 카드 (방 d92a9665 · 2026-10-12 · [Opus]) — 운영 미배포
- ① 원문 *"Cue가 일정을 추가한 후 등록했다고 해서 링크 따라가면 안열려. Cue가 제공하는 모든 서비스 연결 링크들 문제 없게 종합 점검해"* →
  캘린더가 `?event=`/`?task=` 를 마운트 때 한 번만 읽었다(캘린더를 보며 Cue [열기] = 같은 화면이라 안 열림) → `useUrlDetailParams`.
  Q info 링크 `/knowledge?doc=` → 정본 `/info?doc=`(도구 3곳·전역검색·Cue 기본), 탭 pane 에도 옛 주소 넘김. upload_file 링크 id. 3c192c26.
  나머지 링크(업무·문서·파일·노트·메일·채팅·고객·프로젝트)는 appRoutes 대조로 이상 없음.
- ② 원문 *"나, 업무, 일정 << 이게 뭐야? … 개인, 팀, 업무 … 버튼처럼 … 누르는대로 다 나오게. 구글 캘린더 … 어떤 캘린더가 지금 보이는 건지"* →
  알약 버튼 개인(L1)·팀(L2~4)·업무(마감)·Google(연결 시, 칩에 보고 있는 캘린더 이름) 여러 개 켜기 + ⓘ 설명. «나(내 것만)» 축은 없앴다(종류 축과 섞이던 원인). a96c5253.
  **구글 여러 캘린더 보기/가리기(2단계)는 Fable 설계 대상 → 상황판 대기열 앞에 따로 넣음.**
- ③ 원문 *"캘린더 해당 날짜에 마우스 오버하면 그 날 일정 좀 크게 확대해서 … 클릭할 수 있게"* → 월 보기 호버 카드(0.35초·마우스만·칸 옆·더보기와 같은 목록). 42940c6a.
- 검증(Fable 안 씀 — 링크 주소·화면 필터·팝오버, 권한·공개 표면 무변경): 빌드 EXIT 0 · 가드 68/69 · Cue executeTool 실측 open_url `/calendar?event=1229`·`/info?doc=794` ·
  임시 측정 3폭 28/28(같은 노드 = 리마운트 없음 증명 후 ?event= 이동 → 상세 · /knowledge → /info 상세 · 칩 끔/켬 일정 8→0→8·업무 유지·주소 유지 · 호버 150ms 안 뜸/350ms 뜸 · 카드로 이동 유지 · 항목 → 상세 · 날짜 → 일 보기 · 토요일 끝 칸 → 왼쪽·화면 안 · 폰/태블릿 탭 → 카드 없음).
- 시험 데이터([확인용], ws 5): calendar_events 1229(Cue·개인)·1230(토 10/31) · kb_documents 794.


### 완료: Cue 복합 요청 2단계 — 한 답 카드 여러 장 · 업무 만들며 컨펌자 · 앞 턴 실행 결과 이어받기 (방 e006be41 · 2026-10-12 · [Opus] · 설계·검증 Fable PASS) — 운영 미배포
- 원문 *"Cue에 업무든 일정이든 자세한 설정 요청하면 안되잖아. 되게 해줘. 다 대응되게. … 일을 단편적으로만 대응해주면 어떻게 해?"* (1단계 = 759469fa 화상 링크)
- Fable 설계: 카드 최대 3·서로 독립·각자 실행 / create_task `reviewer_user_ids`(있으면 MEDIUM, 요청자 자동 컨펌자는 뺌, 부분 실패는 결과 줄) / 참조 카드 없음 — 앞 턴 **실행 결과(#번호)** 를 history 로 → 다음 턴 «그 업무에 연결해» 가 실제 id. 그 길에 필요한 `update_event.task_id` 추가(화면 PUT 과 같은 resolveTaskLink). c17375ad.
- 검증: test-cue-multi 17/17 · 중복 제거 대조군 뒤집힘 · 연결 3검사 · 실 LLM(카드 2장, 컨펌자 칸, D3 실제 id — 대조군: 실행 결과 없으면 «어떤 업무?» 되묻기) · 3폭 카드 2장 겹침 0·각자 실행 · 빌드 EXIT 0 · 가드 68/69 · health 84/84 · Fable 완료 PASS.
- 남은 것(Fable 비차단): 도구를 부를 때 모델 글이 비어 «업무 카드 실행 뒤 '연결해' 라고 말해 주세요» 안내가 안 보인다 → 카드가 있고 글이 비면 고정 문구(다음 사이클). 셋째 턴 3번 중 1번은 모델이 task_id 를 빠뜨림(편차). 앱 자체 업무 추가 폼의 컨펌자 칸은 범위 밖.
- 시험 데이터([확인용], ws 5): 업무 3553~3562 · 일정 1223·1224·1228.

### 완료: 묶음 3건 — 워크스페이스 생성 후 안내 · Q task 기본 정렬 · Cue 화상링크 (방 759469fa · 2026-10-12 · [Opus]) — 운영 미배포
- ① 원문 *"새 워크스페이스 만들기를 하고 바로 멤버 초대나 다른 설정을 안내해줘서 헷갈리지 않게"* → 만든 직후 착지 /talk → **/dashboard**(회원가입과 같은 곳 — 팀 적응 단계 카드 1단계 «팀원 초대하기 [열기]»). 만들기 창 설명에 «만든 뒤 팀원 초대부터 차례로 안내해 드려요» 한 문장. 새 안내 화면은 안 만듦(OnboardingChecklist 재사용). 3456664d.
- ② 원문 *"Q task 기본 소팅이 마감일 기준으로 오래된 것부터 … 맞아?"* → **아니었다** — 모든 탭이 숨은 `priority_order` 가 먼저였다(전역 컬럼이라 지난 주 번호 남은 업무가 맨 위). 이제 `#` 칸 없는 탭(전체·요청·워크스페이스)은 마감 오래된 순(없음 맨 뒤)→제목→id, 이번 주·오늘 탭은 그대로(번호→마감), 완료·취소는 모든 탭 맨 아래. «기간 ↑» 가 머리에 보인다. 46579ccd.
- ③ 원문 *"일정 추가하고 화상 체크하라고 하면 등록한 다음 나한테 화상링크도 주고 그래야지"* → «화상» 만 말하면 미리보기가 `meet_requires_team_visibility` 로 거절해 모델이 «직접 하세요» 로 답했다. `normalizeCall` 이 create_meeting 이면 visibility team 을 채움(카드에 보임, 사람 확인 후 실행) + 프롬프트 한 줄 · 실행 결과에 `meeting_url` · 완료 줄에 링크+[복사](`CueMeetingLink`, 음성 시트도). 60b0031a.
  - 2단계(한 답에 카드 여러 개 · create_task 컨펌자 칸)는 **Fable 설계 필요**라 상황판 대기열 앞에 되돌림.
- 검증(Fable 안 씀 — 화면 이동·정렬·표시·인자 기본값, 실행은 사람 확인 카드 뒤라 권한·발송 무변경): 빌드 EXIT 0 ×2 · 가드 68/69 · ②3폭 전체 탭 44행 DB 대조 위반 0, 대조군(마감 없는 업무에 번호 1 → 옛 규칙이면 맨 위) 지금은 마감순 첫 행 유지(픽스처 원복) · ①1440 생성 → /dashboard + 3폭 «팀원 초대하기» 보임·elementFromPoint · [열기] → /business/members · ③함수 실측: 화상 요청 → 카드 visibility team / private 말하면 그대로 / 대조군(정규화 없이) 거절 · create_event·update_event 결과에 meeting_url, 링크 없으면 없음 · 실제 LLM 두 문장 모두 create_meeting+team 카드 · 3폭 Cue 실행 → 링크 줄 보임(새 탭·복사 44×32).
- 확인 못 함: 실제 Google Meet 자동 생성(dev 구글 미연동 → meet_warning 경로만 · 링크는 직접 입력 링크로 같은 결과 줄 확인).
- 시험 데이터: 워크스페이스 3967 «[확인용] 새 워크스페이스 안내»(health-check 소유 · 활성 워크스페이스는 5 로 되돌림) · calendar_events 1219·1220 + Cue 실행분 3건 «[확인용] Cue 링크 회의»(ws 5).

### 완료: 묶음 3건 — 화상미팅 등록 후 상세 · 랜딩 인사이트·앱 다운로드 별도 메뉴 · 업무명 안내 (방 c5ba4f88 · 2026-10-12 · [Opus]) — 운영 미배포
- ① 원문 *"화상미팅 체크 하면 바로 링크가 생성되어서 복사할 수 있으면 안돼? 아니면 등록 후 그냥 상세가 그대로 남아있어야 … 판단 좀 해줘"* → 판단: 체크 순간 생성은 안 함(구글 캘린더에 일정을 먼저 만들어야 링크가 나와, 취소하면 주인 없는 외부 일정이 남는다). **링크가 있는 등록(Meet 자동·직접 입력)·Meet 실패만** 등록 뒤 상세를 연다 — 상세가 곧 «등록됨» 의 증거이고 [링크 복사]가 이미 거기 있다. 보통 일정은 #124(자동 오픈 안 함) 그대로. `QCalendarPage.handleCreate` 한 줄. 92143588.
- ② 원문 *"랜딩페이지에서 인사이트랑 앱다운로드는 별도 메뉴로 빼줘. 중요해"* → 상단 = 기능·요금제·컨설팅·인사이트·앱 다운로드(폰 아이콘)·리소스▾(시작 가이드·도움말)·브랜드스토리 / 우측 = KO·EN·문의·로그인·무료로 시작. 1024~1279 는 메뉴 간격 0·여백 6px(영어 42px 넘침 → 0). 폰 시트: 앱 다운로드는 가입 버튼 아래 그대로, 인사이트는 주 메뉴로. 32c18aac.
- ③ 원문 *"업무명을 완료시점을 명확히 아는 형태로 만들기를 추천한다는 안내 … 중요표시하고 이유는 마우스 오버"* → 공용 `TaskCreateForm` 제목 아래 한 줄(코랄 ! + «끝나는 순간이 보이게 적어 주세요 — 예: «A사 견적서 보내기»» + ⓘ HelpDot 이유). 정적 안내(입력값 판정 없음). 79249f7a.
- 검증(Fable 안 씀 — 화면 동작·메뉴 배치·문구): 빌드 EXIT 0 · 가드 68/69(QCalendarPage 802줄로 god-file 걸려 주석 줄여 799) · `--suite landinggnb` 4폭 실패 0, 대조군 12건 실패 · 임시 측정 ko/en × 1024/1100/1279/1440 넘침 0·한 줄 · 3폭(390/820/1440) 업무 안내 보임·ⓘ 탭/올림 이유 보임 · 일정 링크 등록 → ?event= + [링크 복사] 보임 / 링크 없이 → 안 열림 · eventnotify·eventmaterials 실패 0.
- 확인 못 함: 실제 Google Meet 자동 생성 경로(시험 계정 구글 연동 없음 — 직접 입력 링크로 같은 분기 확인). 시험 데이터: calendar_events 1206·1208·1210([확인용] 링크 있음), 1207·1209·1211(없음) — 워크스페이스 5.
- 후속 후보(범위 밖 메모): 요청 추가 «요청자 = 완료 확인하는 사람» · 컨펌자 «컨펌 = 완료 기준 확인» · 마감 «마감 = 끝나는 날» 같은 HelpDot.

### 완료: 묶음 3건 — 상단 브랜드스토리 이름 복원 · 앱 다운로드 QR · 내 외부 연동 링크 (방 8b3346c0 · 2026-10-12 · [Opus]) — 운영 미배포
- ① 원문 *"브랜드스토리도 … 상단메뉴에서 빼버리고 푸터만 나오게 하면 어떻게 해?"* → 메뉴 자리는 있었고 이름이 «소개» 로 바뀌어 있었다(7d5a699c). ko «브랜드스토리» / en «Brand Story» · seo-pages /about 제목·h1·라벨 «브랜드 스토리». 라벨이 길어 1024px 에서 36px 넘침 → 1024~1279 간격·버튼 여백만 줄임. 앱 다운로드는 2e8edd94 로 이미 상단. faaf97c0.
- ② QR — 공용 `components/Common/AppQrCode`(지금 서버의 /app·/en/app 을 담음, 스토어 주소 아님). 랜딩 /app 데스크탑 + 설정 › 알림 «앱 설치» 칸 «휴대폰 앱» 줄(데스크탑만). 글자 주소도 실제 주소로. 965bf938.
- ③ 내 외부 연동 맨 아래 «회사 설정으로» → 회사 메일함이 아니라 `/business/settings/storage`(파일·외부 연동), 버튼 «회사 외부 연동으로». a6d240ce.
- 검증(Fable 안 씀 — 메뉴 이름·이미지·링크): 빌드 EXIT 0 · 가드 68/69 · `--suite landinggnb` 4폭 실패 0 · 한국어 1024/1100/1280/1440 넘침 0 · QR 해독 = 기대 주소(오차 0, 다른 주소 대조군 불일치) · 폰 UA QR 없음 · 링크 클릭 → /business/settings/storage 착지(Google Drive 보임). 실기기 QR 촬영은 확인 못 함.
- 남은 판단: /about 페이지 안 순서(지금 «PlanQ 하는 일 → 창업자 이야기»)를 브랜드 스토리 먼저로 되돌릴지 — 보고에 질문.

### 완료: 묶음 3건 — Q sales 유입 설정 안내 · 서명 안내 한 상자 · 랜딩 앱 다운로드 상단 복귀 (방 c7e9845b · 2026-10-12 · [Opus]) — 운영 미배포
- ① Q sales «자동 유입이 꺼져 있습니다» 줄 → 문구에 «설정 › 권한 › 상담 유입» + [설정에서 바꾸기] → `/business/settings/permissions?focus=sales-intake` 로 가서 카드가 스스로 스크롤·민트 강조(1.6초). 토글은 새로 만들지 않음(이미 설정에 있음). 499e80cd.
- ② 서명 화면 안내 3상자 → 한 상자(`sign-notice`): «N번 칸이 회원님의 [서명 자리]입니다»(누르면 내 칸으로) + 작은 [서명하기] + 범위 고지(뜻 그대로) + «보낸 분 메모». 버튼은 맨 위 할 일 줄과 같은 `primaryAction`. 69f5635c.
- ③ 랜딩 앱 다운로드 → 리소스 드롭다운에서 빼 데스크탑 우측 묶음 맨 앞(폰 아이콘+글자) · 폰 시트 가입 버튼 바로 아래. 2e8edd94.
- 검증(Fable 안 씀 — UI 링크·배치·문구): 임시 측정 3폭(390/820/1440) — ①링크 보임·이동·카드 화면 안·강조 / 대조군 focus 없이 열면 카드 1488~1826px 아래(화면 밖) ②상자 1개·«서명 자리» 클릭 → 칸 화면 안·상자 버튼 → 서명 창 · `--suite landinggnb` 4폭 실패 0, 대조군 12건 실패로 뒤집힘 · `--suite signature` 0 · 빌드 EXIT 0 · 가드 68/69.
- 시험 데이터: signature_requests id=1035([확인용] 메모 붙은 서명 요청, 861 복제).

### 완료: Q mail 묶음 3건 — 탭별 마지막 메일 기억 · 목록 60건에서 멈춤 · 자가진단 확인 (방 46e39ba1 · 2026-10-12 · [Opus]) — 운영 미배포
- ① 원문 *"메일 탭을 이동할 때 이전 탭에 열고 있던 메일이 그대로 열리게"* → `MailPage.tsx` 폴더 탭마다 마지막 연 메일을 메모리(ref)에 기억(키 = 워크스페이스|계정필터|폴더), 탭 복귀 시 `?thread=` 로 다시 연다. 재클릭 닫기·처리완료(clearSelection)·404/403·지금 탭 재클릭은 기억을 지운다. 좁은 화면의 [‹](목록 보기)는 지우지 않는다(폰·태블릿은 그 길로만 탭을 바꾼다). 폴더 탭에 `data-testid="mail-folder-<키>"`.
- ② 원문 *"확인권장이 529개인데 리스트에서는 다 볼 수가 없어 … 날짜로 끊기는"* → 실측 원인 둘: (a) **무한 스크롤이 늘 60행(2쪽)에서 멈췄다** — `loadMore` 가 «새로 붙은 수» 를 setThreads 업데이터 안에서 세서 React 18 에선 setHasMore 때 0 → hasMore=false. ref 로 미리 센다. (b) 조용한 새로고침이 30×쪽수를 한 번에 요청해 서버 상한 200 에서 잘리고 사이 구간이 빠짐 → 200 이하 offset 조각으로 이어 받음. 정찰 계획은 (b) 만 봤다.
- ③ 자가진단 한 글자 — 이미 92bccd5c 로 고쳐져 운영 반영(운영·dev landing.json 12문항 49~16자 실측). 코드 무변경.
- 검증(Fable 안 씀 — 목록 페이징·UI 선택 상태): 임시 측정 14/14(3폭 탭 복귀 A/B · 재클릭 닫힘 유지 · 330행→조용한 새로고침 뒤 330 · 450행 API 순서 일치) · 대조: 고치기 전 빌드 스크롤 60행 정지 실측, 서버 330 요청 → 200 · 빌드 EXIT 0 · 가드 68/69 · maillabel·mailsentvia 실패 0.

### 완료: 상황판 «정찰 방» 읽기 전용 장치 — 정찰 장치 켜짐 (방 02ca045f · 2026-10-12 · [Opus] · 검증 Fable) — 운영 무관(개발 서버 훅)
- 요청: 서버 방 · Fable 설계 판정 D 의 PlanQ 몫(Irene «플랜큐만 일이 쌓였는데 하나씩 처리하는게 너무 더딘데? 서버부하에 맞추면 되지»).
- 넣은 것: `.claude/hooks/scout-detect.sh`(판정 한 곳 — 첫 사용자 메시지 첫 줄 == «[상황판 정찰 방 — 읽기 전용]», 방별 캐시 /tmp/planq-scout-cache) · `scout-guard.sh`+`scout-guard.js`(PreToolUse, settings.json 매처 Bash|Edit|Write|MultiEdit|NotebookEdit|mcp__.*) — 정찰 방이면 plans 밖 파일 도구·빌드(tsc --noEmit 포함)·pm2 바꾸기·git 쓰기·rm/mv/sed -i·소스 리다이렉트·DB 쓰기·배포·ssh/scp·API 쓰기·MCP 쓰기 deny, 일반 방은 출력 없음 · `fable-gate-stop.sh`·`idle-autosave-stop.sh` 정찰이면 바로 끝 · `.gitignore` `.claude/plans/` · CLAUDE.md «상황판이 주는 일» 두 줄. 지문 경로에 plans 없음 확인.
- 검증: 시험 121/121 · 대조군(판정 끔 57건·git 검사 끔 11건 뒤집힘) · Fable 1차 FAIL(히어독·curl -sf) → 고침 → **PASS**(실방 72건 재생 deny 2 = 운영 접속). 기록 docs/FABLE_GATE_QUEUE.md 맨 위. 마커는 안 씀(다른 방 커밋 4건을 덮지 않게).
- 남은 것: Fable 비차단 지적(curl 붙여 쓴 플래그·wget 기본 저장 등) — 휴리스틱 범위.

### 완료: Q mail 보낸메일함 — PlanQ에서 / 다른 곳에서 필터 + «PlanQ 발송» 표시 (방 0bb57a17 · 2026-10-12 · [Opus]) — 운영 미배포
- 원문: *"내 이메일주소에서 다른 ai 나 플랫폼에서 보낸 이메일도 보낸메일에서 봐야 해. 그냥 나오게 하고 우리가 보낸 메일은 여기서 보낸 메일은 제대로 체크해주고 필터링으로 각각 볼 수 있게 하거나 하면 어때? 지금 우리가 보낸 것만 나오면 문제가 되서. 이걸 하려면 심사를 다시 해야 해?"*
- 이미 있던 것: 업체 보낸편지함 가져오기(b507d670·82b4bc0e, 10/07 — IMAP 읽기 전용, 첫 30일). dev Irene Gmail 계정(#32)은 보낸편지함 18통이 들어와 보낸메일함에 보인다.
- 고침: 보낸메일함 위 알약 줄 [전체 | PlanQ에서 | 다른 곳에서](URL `?via=`) + PlanQ 에서 보낸 행에 «PlanQ 발송» 표시. 기준 = 발송 원장 `email_messages.sent_by_user_id`(PlanQ 답장·새 메일·전달은 사람 id, 업체 보낸편지함 사본은 NULL) — 술어는 `services/mailFolders.sentViaWhere`·`SENT_VIA_SQL` 한 곳(목록 필터·정렬·행 표시가 같은 조각). 한 스레드에 둘 다 있으면 두 필터 모두에 나온다.
- 검증(Fable 안 씀 — 이미 볼 수 있는 보낸메일 안에서 좁히는 필터·표시, 권한·격리·가져오기 규칙 무변경): 새 `--suite mailsentvia` 서버 4 + 3폭(390/820/1440)×6 = 22검사 실패 0 · 양성 대조군(서버 필터 끔) 4건 실패로 뒤집힘 · maillabel 0 · 빌드 EXIT 0 · 가드 68/69 · health 84/84.
- 확인 못 함: 운영에서 Irene 계정의 보낸편지함이 실제로 들어오고 있는지(운영 읽기 권한 거부). 플랫폼 발송 주소(SMTP_FROM)와 같은 계정·별칭이면 보낸편지함을 통째로 건너뛴다(`emailImapCron` platform_sender, Fable 10/07 — 남의 워크스페이스로 보낸 알림이 섞이지 않게). Irene 할 일로 «메일 계정 화면의 보낸편지함 줄» 확인을 올렸다. 그 경우 규칙을 «시스템 알림만 거름» 으로 바꾸는 것은 Fable design 대상.
- 심사: 앱 비밀번호(IMAP) 계정은 구글 심사와 무관. 구글 로그인(OAuth) 메일 연결은 지금 막혀 있고, 보낸편지함 읽기도 같은 메일 권한 범위라 새 심사 항목은 아니다(scope 추가 없음).

### 완료: 랜딩 상단 메뉴 정리 — 9개 → 5개 + 리소스 묶음 · 문의 버튼 · «소개» 재배치 · 요금제↔컨설팅 잇기 (방 9284ee07 · 2026-10-12 · [Opus] · 설계 Fable) — 운영 미배포
- 원문: *"랜딩페이지 GNB가 너무 많은데 문의나 다운로드를 내워크스페이스처럼 버튼으로 하고 우측으로 빼서 흰색 버튼으로 할까? … 브랜드스토리가 [소개]로 … 요금/서비스로 페이지 합쳐? … 시작가이드가 GNB에 어울려? 전체 다 판단 좀 해줘. fable이"*
- Fable 판정: Q1 문의만 우측 흰(outline) 버튼, 앱 다운로드는 «리소스» 로 · Q2 [소개] 채택 — PlanQ 먼저, 창업자 이야기 뒤(새 문장 0) · Q3 요금/서비스 합치기 **반대**(2026-06-23 끼워팔기 금지 유지) — 요금제 하단 한 줄 + 컨설팅 페이지 역링크로 잇는다 · Q4 시작 가이드는 GNB 평면 메뉴 말고 리소스 묶음 + 홈 히어로 아래 한 줄. 라벨 «서비스» → «컨설팅»(Fable 권고대로).
- 고침: `LandingLayout` 메뉴 = 기능·요금제·컨설팅·리소스▾(시작 가이드·도움말·인사이트·앱 다운로드)·소개 / 우측 KO·EN·[문의] outline·로그인(글자)·[무료로 시작] / 1024~1279 숨김 항목 없음 / 폰 시트 순서 재배치. 리소스는 올리면 열림·누르면 열림(올려서 열린 직후 클릭이 닫던 것 실측으로 잡음)·Esc·바깥 클릭 닫힘. `AboutPage` 순서 = 슬로건+정의(hero.*) → PlanQ 로 하는 일(features.q.* 10개) → 미션·가치 → 타임라인 → 창업자 이야기 → 컨설팅 한 줄. `PricingPage` FAQ 아래 컨설팅 한 줄 · `ServicePage` 요금제 역링크 · `HomePage` 히어로 아래 «처음이신가요? 시작 가이드 보기 →». seo-pages /about 제목·설명 «소개». URL 변경 없음.
- 검증(Fable = 설계 1회, 완료 검증은 자체 — UI 배치·라벨): 새 `--suite landinggnb` 4폭(390/820/1024/1440) 25검사 실패 0 · 대조군(문의·리소스 패널·시트 앱 숨김 CSS) 8건 실패로 뒤집힘 · `--suite onboarding` ⑩⑪ 새 구조로 고쳐 실패 0 · 빌드 EXIT 0 · 가드 68/69.
- 확인 못 함: 로그인 상태 우측 묶음([문의]+[내 워크스페이스])은 눈으로만(코드 분기) — 재지 않았다.

### 완료: 도움말(/guide) — 랜딩 KO/EN 을 눌러도 도움말 내용이 안 바뀌던 것 (방 b53f321b · 2026-10-12 · [Opus]) — 운영 미배포
- 원문: *"도움말 헤더가 그대로 랜딩페이지랑 같게 나오는데 언어는 적용이 안되는데. 콘텐츠관리를 언어별로 하는 거 맞아?"*
- 답: 콘텐츠는 언어별이 맞다 — 카테고리·문서 제목·요약·본문이 `_ko`/`_en` 칸으로 따로 저장(dev 문서 139건 전부 영어본 있음, 관리자 화면도 언어별 입력).
- 원인: 도움말 화면이 처음 열 때 한 번만 그 언어로 읽고, 랜딩 GNB 의 KO/EN(changeLanguage)에 다시 읽지 않았다 → 머리 문구만 바뀌고 카테고리·목록·문서 본문은 그대로.
- 고침: `services/wiki.wikiLang`(i18n 하나가 정본) — 목록(WikiPage)·문서(WikiArticlePage)·PlanQ 안내 패널(CueHelpDrawer)이 언어를 의존성으로 걸어 다시 읽는다. 문서는 언어만 바꾸면 읽던 자리 유지(맨 위로는 다른 글을 열 때만).
- 검증(Fable 안 씀 — 화면 재조회): 임시 측정 3폭 390/820/1440 × 18검사 실패 0(KO→EN 목록 한글 0 · 상세 제자리 EN 전환 한글 0 · KO 복귀 · 가로넘침 0) · 음성 대조군: 옛 빌드에서 6건 실패 · 빌드 EXIT 0 · 가드 68/69.

### 완료: 도움말(/guide) — 랜딩 폭으로 맞추고 같은 창으로 (방 d0845548 · 2026-10-12 · [Opus]) — 운영 미배포
- 원문: *"도움말에 랜딩헤더가 그냥 그대로 나오는데 콘텐츠는 레이아웃이 지정된 사이즈인데 도움말은 풀레이아웃이야 … 헤더가 그냥 있을거면 새창 안해도 되고 레이아웃도 기존 랜딩페이지랑 맞추면 되는 거 아니야? 어디에 따로 팝업뜨거나 도움말링크로 열리는 곳 있으면 거기는 적합하게"*
- 원인: /guide 는 랜딩 GNB·푸터(1200px)로 감싸면서 본문은 앱용 PageShell(전체 폭 머리줄 + 회색 바탕)이었다.
- 고침: 새 `pages/Wiki/WikiFrame.tsx` — 랜딩 셸이면 인사이트와 같은 서브 히어로(HELP CENTER · 도움말 · 설명 · 검색) + 가운데 1080px(문서 상세는 760px 읽기 폭), 팝아웃 창(isPopoutWindow — WikiShell 과 같은 판정)이면 종전 PageShell. 랜딩 GNB·푸터의 «도움말» 새 창(target=_blank) 제거 → 같은 창. 앱 안 문(도움말 패널·AI 앱 연결 안내)은 새 탭 그대로. 곁 결함: 문서 단계 번호가 블록 순번이라 «4» 부터 나오던 것 → 이어지는 단계 묶음마다 1부터.
- 검증(Fable 안 씀 — 레이아웃·링크 대상): 임시 측정 3폭(390/820/1440) × 목록·카테고리·문서 76검사 실패 0 — PageShell 없음 · 컨테이너 1080/808 가운데 · 가로넘침 0 · 제목 보임(elementFromPoint) · 푸터 · /guide 링크 2개 target 없음 · GNB 클릭 같은 창 · 팝아웃은 PageShell·GNB/푸터 없음. 음성 대조군: 옛 빌드에서 컨테이너 없음·단계 «4부터» 실패. 빌드 EXIT 0 · 가드 68/69.

### 완료: 운영 배포를 «마지막 커밋의 깨끗한 사본» 에서 — 다른 방의 미커밋은 빼고 나간다 (방 533798e8 · 2026-10-12 · [Opus]) — 운영 미배포(배포 절차 자체 변경)
- 원문: Irene 2026-10-11 *"배포를 하면 모든 작업 일시정지하고 점검 후 배포해야지. 진행중인 거 있으면 그건 빼고"* · *"배포는 아침점검에서 자동으로"* (FABLE.md §7 조건 2)
- 고침: `scripts/make-deploy-snapshot.sh`(git archive HEAD 사본 + 프론트 .env·node_modules 링크·tsbuildinfo 복사 + 백엔드 검사용 .env) · `deploy-planq.sh` 가 가드(PLANQ_GUARD_ROOT)·빌드(사본 안, dev 빌드 안 건드림)·rsync·마이그 판정·릴리즈노트·장부·개발현황·.last-deployed-commit 을 모두 사본/DEPLOY_COMMIT 으로 · 작업 폴더는 읽기만(stash·커밋 없음) · rsync 보호 목록(secrets/·backups/·.claude/·.last-deployed-commit + git 무시 경로 전부 — 없으면 운영 앱 푸시 키 삭제, rsync -n 실측 10건→0건) · `scripts/check-deploy-snapshot.js`(사본 문법·커밋에 없는 require, --skip-gates 여도) · `--routine`(정기 점검 = --auto + 릴리즈노트 없음) · `--skip-build` 는 프론트 안 보냄 · 배포 스크립트 미커밋이면 --auto/--routine 중단(Fable C1) · wip: auto-save 커밋이면 중단.
- 배포.md: 미커밋 = 다른 방의 진행 중 일 — 커밋하지 않고 빼고 배포 · 배포 방 산출물만 `git commit -- <경로>` · «정기 점검 배포» 절(Irene 상시 지시 = /배포와 같게, 버전·릴리즈노트·공지·메일 없음).
- 검증: 사본 빌드 EXIT 0(3분10초·5.3GB, 파일 목록 동일) · 가드 사본 69/69 + 양성 대조군 EXIT 1 · 사본 검사 777파일 0 + 대조군 EXIT 1 · 전체 --dry-run EXIT 0(미커밋 시험 파일 «뺀다» 표시, /tmp 정리) · Fable 게이트 1차 FAIL(C1 배포 스크립트 미커밋) → 고침 46412c84 → 미커밋 시 EXIT 1 / 커밋 후 EXIT 0 → **Fable PASS**(판정 docs/FABLE_GATE_QUEUE.md 맨 위).
- 남은 것: 첫 실배포는 수동 /배포 1회로 끝까지 본 뒤 정기 점검 자동 배포(Fable N6) · 상황판 projects.json PlanQ «cleanDeploy: true» + FABLE.md §7 PlanQ 줄 갱신은 서버 방(대기열에 올림).

### 완료: 랜딩 «PlanQ 안내» 팝업 — 도움말 칩을 묶음으로 (방 9d5d7e86 · 2026-10-12 · [Opus]) — 운영 미배포
- 원문: *"태그가 너무 길게 나와 안내멘트 자체가 안보여 … 시작하기, 기능, 요금 등 첫 안내 누른 후 나머지 또 나오게"*
- 고침: `CueHelpDrawer` 도움말 패널 — 카테고리 18개 → 묶음 4개(시작하기·기능 둘러보기·요금·설정·권한). 묶음을 누르면 그 안의 카테고리가 펼쳐지고 다시 누르면 접힌다. 요금 = /pricing 바로 이동, 하나뿐인 묶음(설정·권한)은 바로 연다. 묶음은 화면에서만(모르는 새 카테고리는 «기능»). 커밋 0dcfd8b5.
- 검증(Fable 안 씀 — UI 배치): 3폭 375/820/1440 실브라우저 — 묶음 4 · 처음엔 펼침 없음 · 안내 제목·설명이 보임(elementFromPoint) · 기능 14개/시작하기 2개 펼침 · 재클릭 접힘 · 요금 → /pricing. 빌드 EXIT 0 · 가드 68/69.

### 완료: Q docs 변경 기록 — 시각이 늘 빈칸·첫 수정 전 내용 없음·확인 없는 되돌리기 (방 1405bb66 · 2026-10-12 · [Opus]) — 운영 미배포
- 원문: *"같은 문서 수정하면 히스토리 저장되고 있어? 수정한 일시랑 수정한 사람 저장되고 되돌리는거 되는지 확인하고 제대로 구성된 ui/ux인지 체크해서 제대로 만들어"*
- 점검 결과: 저장(누가·내용 스냅샷)·되돌리기 서버는 있었다. 결함 3 — ①목록 시각이 **2026-08-25 부터 늘 빈칸**(라우트가 인스턴스 `r.created_at` 을 읽음 = undefined, 실제 속성은 createdAt) ②기록은 저장 «뒤» 내용만 남겨 **첫 수정 전 원래 내용이 어디에도 없었다**(dev 문서 138건 중 기록 13건) ③[이 시점으로] 가 미리보기·확인 없이 본문을 통째로 갈아끼움(버전 본문 API 는 있는데 화면이 안 부름).
- 고침(서버): `services/postRevisions.ensureBaselineRevision` — 기록 없는 문서는 고치기 직전 내용을 1번(처음 버전, 시각·사람 = 그 내용의 마지막 저장)으로 남김(문서 PUT·AI 도구 updatePostContent). 1번에는 합치지 않고 상한 정리에서도 지우지 않음. 목록 응답 `saved_at`(묶음의 마지막 저장)·`text_delta`·`title_changed`·`category_changed`·`is_first` · 버전 본문에 사람·시각 · 되돌리면 고친 사람 = 되돌린 사람.
- 고침(화면): `PostHistoryPanel` 을 표준 우측 패널(DetailDrawer)로 — 행: 사람·시각·«현재/되돌림/처음 버전»·«제목 변경 · +N자» → 누르면 그 버전 미리보기 + [이 버전으로 되돌리기] → 확인창(시각·사람, «지금 내용은 기록에 남음») → 목록 맨 위 «현재·되돌림» 이 결과. 표 문서는 «칸 내용은 버전 대상 아님» 안내. 서명 진행 문서는 409 문구.
- 검증(Fable 안 씀 — 기존 기록 기능의 시각 표시 버그·기록 시점 보강·화면, 권한·격리 술어 무변경): `--suite posthistory` 21검사 실패 0(서버 A1~A4 실호출 + 3폭 390/820/1440 패널·미리보기·확인창·되돌린 뒤 DB 본문·가로넘침 0) · 대조군: 고치기 전 실행에서 ①③a 6건 실패(시각 빈칸을 잡음) · 처음 버전 호출 끔 → A1·A4·② 8건 실패 · 빌드 EXIT 0 · 가드 68/69 · health 84/84.
- 확인용 데이터: dev biz 5 문서 #2389 «[확인용] 변경 기록 문서 (수정)» (버전 4개, 다른 사람 편집 포함).
- 남은 것: 같은 사람이 10분 안에 이어 고친 것은 한 버전으로 묶인다(설계 그대로 — 그 안의 실수는 편집기 되돌리기 Ctrl+Z). 표 칸 내용은 버전 대상이 아니다.

### 완료: 문서 안 표 — 편집 메뉴를 «손잡이 → 펼침» 으로 (방 0ddf10a7 · 2026-10-12 · [Opus]) — 운영 미배포
- 원문: *"표 만들고 수정할 때 커서를 넣으면 행, 열 추가할지 뜨는데 내용을 수정할 때는 너무 불편한데 이거 UI 개선방법 없어?"*
- 원인: 표 안 커서마다 행·열·칸 색 메뉴 전체가 **커서 바로 위**에 떠 윗줄 칸을 가렸다.
- 고침: 새 `components/Docs/TableBubbleMenu.tsx` — 표 **오른쪽 위 모서리 바깥**에 작은 [표 ⋯] 손잡이만(기준점 = 표 위 모서리, 표 머리가 툴바 밑으로 숨으면 지금 칸 위) → 누르면 기존 메뉴 + [✕ 접기] · 글자를 치면 접힘 · 표 밖이면 사라짐. 메뉴 내용·툴바 표 묶음 그대로. 폰은 메뉴가 두 줄로 접힌다.
- 검증(Fable 안 씀 — 편집기 UI 배치): `--suite tablemenu` 3폭 18검사 실패 0(손잡이만 · 어떤 칸도 안 덮음 elementFromPoint · 펼침→행 추가 · 치면 접힘 · 표 밖 사라짐 · 가로넘침 0) · 양성 대조군(기준점을 커서로 되돌림 → ② 3폭 모두 실패) · `tablefill` 39검사 0(손잡이 먼저 누르게 고침) · 빌드 EXIT 0 · 가드 68/69.

### 완료: Q docs 표 — 칸·열·행 채우기 색 + 표 문서 «열 색» (방 0a07252e · 2026-10-12 · [Opus]) — 운영 미배포
- 원문: *"문서 표에서 열에 색상넣게 기능 넣어줄 수 있어? 글자굵게하고 색상도, 지금 문서 전체 글자 색상, 글자 배경색상 넣기도 없는데 필요해. 검토하고 기본 기능들 넣어줘."*
- 검토: 글자색·글자 배경·크기·굵게는 05643cb7(10/11, 운영 미배포)에 이미 있다 — 편집기 툴바 [A] · 표 문서 서식 줄. 빠진 것은 **칸 자체를 칠하는 색**이었다.
- 문서 안 표: 표 버블 [칸 색] → 범위(고른 칸·열 전체·행 전체, 기본 열 전체) + 견본 8. 칸 속성 `backgroundColor`(`editorTableCellFill` PqTableCell/PqTableHeader — 보기 변환도 같은 확장) · PDF/워드 변환 반영(#rrggbb 만).
- 표 문서: 열 설정에 «열 색» — 열 정의 `bg`(팔레트 key, 서버 `colBgOf` 가 key 모양만 저장) · 머리칸·그 열 칸 바탕, 칸 서식 배경이 있으면 그것이 위. 견본(FillSwatches)은 두 표가 같은 것.
- 곁 결함: 게스트 문서 보기·서명본 등 `sanitizeRichText` 화면이 style 을 통째로 지워 글자색·정렬이 사라졌다 → style 은 색·배경·크기·정렬만 모양 검사 후 남김(이 호출 동안만 훅). 반증: url()·expression·position·javascript: 6건 제거 · 메일 정화기 무변화. `forceKeepAttr` 가 고친 값이 아니라 원문을 남기는 것을 반증으로 잡아 노드에 직접 쓴다.
- 검증(Fable 안 씀 — 화면 서식 + 정화기 허용을 «모양 검사» 로 좁힌 것, 기계로 반증): `--suite tablefill` 39검사 2회 실패 0(3폭 · 팝오버 elementFromPoint · 열/칸/행 · 보기 화면 · PDF·워드 · 서버 거름 음성 대조군) · 양성 대조군(서버 bg 저장 제거 → 6건 실패) · tablestyle 0 · 빌드 EXIT 0 · 가드 68/69 · health 84/84.

### 완료: 확인필요 — 임시답변 보낸 메일은 «임시답변함 · 답장 대기» 로 (방 cc06f611 · 2026-10-12 · [Opus]) — 운영 미배포
- 원문: *"할일필요에서 임시답변했으면 임시답변 했다고 알려주면 어때?"*
- 고침: `routes/dashboard.js collectMails` 가 `reply_needed_reason==='holding'` 이면 verb `reply_holding`(ko «임시답변함 · 답장 대기» / en «Holding reply sent · reply due»). 세는 방식·배지 수 그대로(같은 type 'email').
- 검증(Fable 안 씀 — 라벨): dev biz 5 스레드 3122 실호출 reply → holding 으로 바꾸면 reply_holding → 원복 reply/inbound 확인 · 빌드 EXIT 0(.gz 반영) · 가드 68/69.

### 완료: 서명 화면 — 단계 표시(1 문서 검토 · 2 본인 확인 · 3 서명)도 머리줄과 함께 고정 (방 674413d9 · 2026-10-12 · [Opus]) — 운영 미배포
- 원문: *"서명에서 서명할 때 이 탭 나오면 스티키가 되어야 하는 거 아니야? 헤더랑 같이?"*
- 고침: 단계 줄을 머리줄 묶음(StickyHead) 안, 머리줄 바로 아래로 옮김(할 일 줄 위). 폰은 단계 칸 여백만 줄임(36px). top 숫자 없음.
- 검증(Fable 안 씀 — 위치만): 3폭(390/820/1440) 맨 아래까지 스크롤해도 단계 top 83 그대로·보임·가로넘침 0 / 대조군(묶음 sticky 끔) -3449·-2010·-2210 · 빌드 EXIT 0 · 가드 68/69.

### 완료: Q mail 업무 추출 — 자동발송 메일(평문이 대체 문구뿐)에서 업무가 0건이던 것 (방 2dabd842 · 2026-10-12 · [Opus]) — 운영 미배포
- 원문: *"메일 내용 자체가 이런데도 업무후보가 안나오고 업무추출도 안돼. 당연히 세금계산서 발행 링크솔루션, 이래야지."* (help@irenewp.com «[관리] 세금계산서 발행 필요 1건»)
- 원인 ①: 그 메일은 평문 칸이 «HTML 메일입니다. 청구서/리포트 링크를 확인해 주세요.» 한 줄이고 내용은 HTML 에만 있다. 업무 추출·Cue 메일 맥락이 평문만 읽어 내용을 못 봤다. → `emailBodyClean.preferHtmlBody`(평문 원문 ≤80자 ∧ HTML 글자가 3배·80자 초과면 HTML) 한 판정을 cleanVisibleBody·업무 추출·cue_context 가 같이 쓴다. dev 받은 메일 8,219건 중 바뀌는 것 555건 — 전부 자동발송 요약 한 줄(사람이 쓴 짧은 답장 0건).
- 원인 ②: 추출 기준이 «사람이 맡긴 일만·보수적» 이라 시스템 알림 속 «발행 필요» 를 버렸다. → 메일 경로 안내문에만 «처리할 일을 알리는 자동 메일은 항목마다 업무 1건(같은 알림 반복은 1건) · 완료 통지·뉴스레터·광고·보안 알림은 아님» 추가(Irene 가 원하는 결과를 직접 지시 — 채팅 추출 기준 무변경).
- 검증(Fable 안 씀 — Irene 가 기대 결과를 직접 지정, 결과는 사람이 등록·거절하는 대기 후보뿐): 실호출 POST /api/businesses/3/email-threads/8395/extract-tasks 200 → 후보 «링크솔루션 세금계산서 발행»(근거 메일 4통) · 대조 자동메일 4건(카페24 발행 완료·Anthropic 영수증·Notion 공지·DMARC 보고) 0건 · 가드 68/69 · health 84/84. 자동 추출은 그 계정이 꺼짐(off)이라 해당 없음.
- 남은 것: 설명에 «발행 필요 목록 →» 링크 주소가 안 실린다(HTML→글자 변환이 href 를 버림 — 공용 변환이라 손대지 않음).

### 완료: Q mail 번역 — 번역문이 본문 위에 뜨고 그 자리로 데려간다 (방 5f573abc · 2026-10-12 · [Opus]) — 운영 미배포
- 원문: *"이메일에서 번역하면 번역한게 올라와서 바로 보이게 해야 하는데 버튼 아래로 생겨서 생긴걸 모르는 ui야"*
- 고침: 번역문을 번역 버튼 아래 → **본문 위**(머리 «번역 · 한국어» + 닫기 ×)로 옮기고, 새로 펼쳐지는 순간 그 머리로 스크롤(ThreadMessages transBoxRefs). 원문은 아래 그대로. 버튼 줄([번역하기]/[번역 닫기]·이메일 확인)은 제자리.
- 곁 결함: URL 많은 긴 영문 메일(Plesk 알림)은 모델이 원문을 그대로 돌려줬는데 화면이 그걸 «번역» 으로 보여 줬다 → `translation_service.translateOne` 이 원문 언어≠대상인데 결과==원문이면 실패(untranslated_echo) · 재시도 1회는 «원문 그대로 돌려줬다, 번역하라» 를 덧붙인다. 실측: 그 메일 재시도 후 한국어로 번역됨.
- 검증(Fable 안 씀 — 화면 위치·번역 실패 판정, 권한·데이터 무변경): 3폭(1440/820/390) 버튼을 화면 아래에 두고 눌러 → 번역문 top 259/255/283(화면 안·elementFromPoint 내 것) · 원문은 그 아래 · 가로넘침 0 · API 3건(영문 2·러시아어 1) 200 · 빌드 EXIT 0 · 가드 68/69 · mailattach 0.

### 완료: Q mail [Cue 의견 듣기] — 메일 받고 «다음에 뭘 하지» 를 한 번에 묻기 (방 7d066e19 · 2026-10-12 · [Opus]) — 운영 미배포
- 원문: *"메일이 온 것에 대해 답변 말고도 다음 할일에 대해 피드백 받을 수 있게 Cue를 연결하면 어때? 의견을 좀 듣고 싶으면 바로 받게."*
- 이미 있던 것: 맥락 패널 «Cue 에게 묻기» 칸(그 메일을 읽고 답함) — 단 접힌 칸·접힌 패널 안이라 찾기 어렵고 매번 질문을 써야 했다.
- 고침: 메일 상세 아래 [답장하기][AI 답변 초안] 옆에 **[Cue 의견 듣기]** — 맥락 패널(폰·태블릿은 오버레이)을 열고 Cue 칸을 펴서 정해진 질문(답장 말고 챙길 일 3~5줄·이미 만든 업무 먼저·만들 것은 카드로)을 한 번 보낸다. 새 화면 없음 — 업무 추출과 같은 «늦게 뜬 패널도 받는» 모듈 요청(`requestCueAdvice`) · `CuePanelSection autoAsk`(key 당 1회, 복원 뒤).
- Cue 가 보는 것 넓힘(읽기만): 메일에 연결된 고객·프로젝트 스냅샷(주소에 없을 때 · 각자 질문자 scope 로 거름) · 이 메일로 이미 만든 업무(canAccessTask, 최대 8 — 같은 업무 재제안 방지) · 마지막 받은 메일 본문 300 → 1500자(요청 문장이 잘렸다).
- 검증(Fable 안 씀 — 기존 Cue 칸에 버튼으로 질문 건네기 + 읽기 맥락 추가, 쓰기·권한·발송 무변경. 카드는 종전대로 눌러야 실행): 실호출 /api/cue/help — 답이 기존 업무 #3549·연결 고객을 짚음 · 맥락 internal 에만 업무 목록, client_facing 대조군엔 없음 · 3폭(390/820/1440) 버튼 보임·누름 내 것·질문 정확히 1건·답 도착·가로넘침 0 · 빌드 EXIT 0 · 가드 68/69(내 raw 상태값 1건 잡혀 label() 로 고침) · health 84/84.
- 확인용 데이터: dev biz 5 업무 #3549 «[확인용] Wishpond 제안 검토» (메일 5791 에 연결).

### 완료: Q mail — 답장을 보내도 받은 메일 목록 순서가 움직이지 않게 (방 a5979f15 · 2026-10-12 · [Opus]) — 운영 미배포
- 원문: *"내가 임시답변으로 답변했는데 전체탭에 다시 올라와서 다시 메일을 받은 것 같아. 내가 보낸메일의 경우 전체메일에 새로 올라오는게 맞아? 보낸 메일에 대한 처리 기준을 점검해줘."*
- 원인: 받은 메일 폴더(전체·답변 필요·확인 권장 등)가 «마지막 메시지 시각»(내가 보낸 것 포함) 순이었다. 답장하면 맨 위로 올라가고, 행에는 상대 이름·상대 글(#438)·방금 시각이 같이 그려져 새로 받은 메일로 보였다.
- 고침: 보낸메일함 밖 폴더는 **마지막으로 받은 시각** 순 + 행의 시각도 같은 값(`services/mailFolders receivedOrder/receivedAtAttribute`, `mailSerialize` stamp). 받은 것이 없는 스레드(내가 먼저 보낸 것)는 마지막 시각. 보낸메일함은 종전대로 내가 보낸 시각 순. 담는 범위(전체에 보낸 스레드도 보임)·답변 필요·임시답변 규칙은 그대로.
- 검증(Fable 안 씀 — 목록 정렬, 권한·데이터 무변경): dev biz 5 실호출 — 8번째 스레드를 답장한 것처럼 바꿔도 8번째·시각 그대로(옛 정렬이면 0번째) · 원복 확인 · 30행 시각 내림차순 · 7개 폴더 200 · 전체 70ms · 가드 68/69 · health 84/84 · maillabel 실패 0. 프론트 변경 없음(빌드 불필요). 운영 해당 스레드 직접 조회는 권한 거부로 못 함.

### 완료: 메일 AI 초안 — 만든 자리로 데려가기 · 맺음 이름을 보내는 주소·메일 언어에 맞추기 (방 4393a377 · 2026-10-12 · [Opus]) — 운영 미배포
- 원문: *"이메일 자동초안 쓸 때 쓴 후에 보이는 곳이 자동으로 작성한 곳이어야 하는데 그냥 있던 곳에 머물러서 어디에 들어갔는지 모르겠어. 그리고 마지막 이름을 붙일 때 이메일마다 맞춰서 이름붙여야 하는데 마음대로 붙고, 그리고 영어인데 한글로 붙어."*
- 자리: Q mail [AI 초안 다시 생성](답장창 맨 아래)을 누르면 답장창 스크롤이 그 자리에 머물러 새 초안이 위쪽 화면 밖이었다 → 채운 뒤 에디터 머리로 스크롤. Cue 로 만든 답장 초안은 실행 즉시 그 메일 답장창으로 이동(메일 화면 옆 패널이면 보던 탭에서) — `?reply=1` 이 같은 메일·열린 답장창이어도 다시 열고 초안을 다시 읽는다.
- 이름: 새 `services/mailClosing.js` 한 벌(ai-suggest·ai-compose·create_mail_reply_draft). 모델은 맺음 문구까지만, 이름은 서버가 — 그 메일이 나갈 신원(`outgoingIdentityFor`)에 서명이 붙으면 안 붙이고(서명이 싣는다), 없으면 보내는 주소 표시명을 메일 언어로(영문인데 한글뿐이면 name_localized.en, 없으면 생략). 모델이 지어 붙인 «워프로랩 드림» 같은 꼬리는 걷는다.
- 곁 결함: Cue 가 «이 메일 답장 초안» 에 thread_id 를 1 로 지어내 실행이 실패했고 영문 메일에 한국어 본문을 썼다 → 메일 맥락에 thread_id·답장 언어를 싣는다(cue_context).
- 검증(Fable 안 씀 — 화면 이동·문구 생성 규칙, 권한·발송 무변경): 실호출 ai-suggest 2·compose ko/en — 서명 붙는 계정이라 이름 없이 «Best regards,» 로 끝남 · 서명 없는 계정(id 32) en «Irene» / ko «Irene 드림» · Cue 도구 경로 한글 이름 꼬리 걷힘 · 화면 3폭(1440/820/390) 다시 생성 뒤 에디터 머리 top -87~-145 → 8 · Cue 패널(1440) 실행 → 같은 메일 답장창 열림+초안 보임(태블릿·폰은 그 패널이 없어 미측정) · 빌드 EXIT 0 · 가드 68/69 · health 84/84.
- 남은 것: 영문 메일인데 영문 서명이 없으면 한국어 서명이 붙는다(화면이 이미 «영문 서명 설정» 으로 안내 — 서명은 우리가 지어낼 수 없다).

### 완료: Cue 범위 확장 — 에이전트 카탈로그 위로 (방 a4cd46a9 → 4ded853f 이어받음 · 2026-10-12 · [Fable] 설계 DESIGN-OK · 완료 검증 PASS · [Opus] 구현) — 운영 미배포
- 원문: *"화상미팅 하고 싶으면 구글링크 생성버튼 누른 것처럼 등록할 수 없어? … 태그나 다른 설정 요청하면 다 되는 거 맞냐 … 다른 업무, 이메일 쓰기, 프로젝트 등록, 노트 작성, 등등 Cue가 할 수 있는 범위를 넓히라는 거야. 그리고 수정까지."*
- 설계 docs/CUE_REGISTRY_FOLD_DESIGN.md (결정 ⑥ 이행): cue_tools = 레지스트리 어댑터(쓰기 24·읽기 23) · 읽기 루프(4라운드·6읽기·12초) · 카드 누름 = 확인(humanConfirmed, provider cue 한정) · 공통 카드 1장 · 스위치 CUE_TOOLS_ENABLED 독립.
- 새 쓰기: create_event 참석자·Meet 자동(참석자/Meet 있으면 MEDIUM) · update_event · add_meeting_to_event · reschedule_events(MEDIUM) · submit_review · update_task 태그·분류·예상시간 · create_task completed. 행동 계층 신설/이동: event_actions.updateEvent·addMeeting(라우트 POST /:id/meeting 위임) · task_actions.setTags(라우트 PUT /:id/tags 위임) · updateFields 분류·예상시간. 시간 변경 시 참석자 알림.
- 검증(자체): 설계 D 15항목 ✅(/help 쓰기 0 + 대조군 · 루프 상한 · 스위치 · 격리 · 비작성자 설명 거절 · 참석자 3행·알림 2 · 시간변경 알림 2 · 반복 409 · Meet 비공개 거절 · 미연동 경고 · 카드 수정값 저장 · 옛 이름) · 실호출 태그/마감/일정 수정 각 실행 1·두 번 누름 replayed·계량 +1 · 옮긴 두 라우트 동작 동일 · 가드 68/69 · cuetools 대조군 2 뒤집힘 · health 84/84 · tenant 0 · 빌드 EXIT 0 · 카드 3폭. 실제 구글 Meet 생성은 dev 에 구글 연동이 없어 확인 못 함.
- 2차(설계): 메일 새 초안·프로젝트 수정·메모/Q info 수정·일정 PUT 전체 위임·한 답에 여러 카드.
- 4ded853f: 실 LLM 범위 시험(일정+Meet·프로젝트·메모·Q info·문서 2·목요일 3건 옮기기) — 문서 초안을 채팅 글로 답해서 프롬프트에 «할 수 있는 일» 동사→도구 지도 추가 후 전부 카드. Fable 완료 검증 PASS(차단 0). 비차단 수리: execute-action `constructor` 500 → 400(isAlias) · 제목으로 지목한 업무는 assignee:'anyone' 로 찾기 · i18n qhelper.field.project. 
- 남은 것(비차단): `FIELD_RULES.estimated_hours` 는 owner/admin 허용인데 PATCH /tasks/:id 인라인 검사는 담당자·owner 만 — admin 이 AI 로만 남의 예상시간을 바꿀 수 있다(M2-b 기존 규칙). 한 술어로 맞추는 것은 권한 변경이라 다음 사이클 Fable 설계로. 실제 구글 Meet 생성은 dev 미연동이라 미측정.

### 나중에 — 휴대폰 «공유하기»에 PlanQ 띄우기 (방 10e2e2be · 2026-10-12 재확인 · Irene «권고대로»)
- 원문: *"파일이나 사진을 모바일에서 공유하기 해도 우리 앱이 안나오는데 아직 개발이 안된거야? 이거 언제 가능해?"*
- 10/12 재확인: Apple 설정 흔적 없음(저장소에 App Group·확장 0건, 앱스토어 공개 버전 1.0 그대로) · Play 새 빌드 여부는 이 서버에서 확인 불가 → 둘 다 Irene 몫이라 상황판 «Irene 할 일» 2건으로 올림(«했어요» 누르면 이어서 할 일이 이 방/새 방으로 온다).
- 안드로이드: 코드 완료(76da612a, GitHub·운영 웹 반영) — Irene 이 Codemagic «PlanQ Android — Play» 빌드 → Play 업로드하면 끝.
- 아이폰: Apple 설정 4가지 끝나면 iOS Share Extension 구현(설계 docs/NATIVE_SHARE_RECEIVE.md iOS 절) → Codemagic 서명 → TestFlight → 심사.
- 곁: guard-native-release 실패 1건(nativeShare.ts 의 @capacitor/core static import — 실해 없음). iOS 작업 때 같이 정리.
- 10/12 Codemagic 안드로이드 빌드 1시간 멈춤 신고 → 같은 커밋(origin/main 3c4231e8)을 서버에서 CI 단계 그대로 재현: npm ci 18초 · cap:beta:android 통과 · bundleRelease 3분22초 · AAB 검사 통과 · google-play 번호 조회는 1초 만에 실패(정상 경로). 코드 원인 아님 → Codemagic 쪽(대기열·한 단계 멈춤). «Irene 할 일: 멈춘 빌드 취소·재시도 + 멈춘 단계 이름 메모» 올림.
- 10/15 Irene: 취소·재시도해도 계속 돌기만 함(멈춘 단계 이름은 못 받음, «다른 작업방에 말했어» — 그 뒤 codemagic.yaml·android 커밋 0건). 빌드 시간 한도 60분인데 1시간 넘게 돈다 = 실행이 아니라 «대기열» 가능성 큼. → «Irene 할 일: Codemagic API 토큰을 secrets/codemagic-token 에(서버 창 read -s)» 올림. 들어오면 API 로 빌드 상태·단계 로그를 직접 읽는다(빌드 시작·취소는 안 함).
- 10/16 Irene: «빌드 다 했어» → 토큰 할 일 뺌. 남은 것: Play 업로드·실기기 확인(«안드로이드 앱 새 빌드 올리기» 할 일 그대로) · 아이폰은 Apple 설정 대기.
- 10/16 Irene «공유할 때 어디로 갈지 너무 어려울 것 같아 … 검토 제대로 해» → [Fable] UX 설계 판정(그대로 iPhone 불가) → [Opus] 받은 뒤 화면 재설계 구현(추천 카드 1장+최근 칩 · 대화방 검색·묶음 · 프로젝트 행 → 폴더 · 저장 결과 카드 · 대화방 입력칸 위 줄 · 썸네일 · 배너 숨김 · 뒤로 가기) → [Fable] 완성 점검 PASS. sharereceive 66/66 · 빌드 0 · guard 72/73. 남음: 고객 역할 실측 · 실기기(안드로이드 Play 업데이트 뒤) · iOS 는 Apple 설정 뒤 착수.

### 정기 점검 10/12 (방 69426d00 · [Opus])
- 개발완료: health 84/84 · guard 68/69 · e2e tenant 0 · 위키 커버리지 통과 → 10/11 작업 6건 DEVELOPMENT_PLAN·next.json 기록.
- 배포: ✅ 운영 b0593491 (2e9f6df4 이후 9커밋 — Cue 일정 옮기기 · 표 서식·행/열 · 고객 링크 가로 배치 · AI 수정 버튼 · 시작 가이드 · 캘린더 지난 마감). 스키마 변경 없음. 운영 health 200 · PM2 3개 online · PDF·이미지게이트·CSP OK · 개발 현황 id=207. 백업 /opt/planq/backups/20261011_162128(운영).
- 할 것(안 함): 버전 올리기·릴리즈노트·공지 없음 · 운영 위키 시드(`node seed-wiki-content.js` — 10/11 «Cue란?» 한 줄 반영용) 는 다음 배포 때.
- 운영 피드백: 열린 9건, 10/08 이후 새 신고 0. #463·#464 는 고쳐서 운영에 나갔지만 답글 없음(pending) — 초안 docs/feedback-replies-2026-10-08.json, 다는 것은 Irene 확인 후.
- 밤 검사: 10-10 실패 3은 10/11 아침에 처리됨. 오늘(10-11) 순찰은 점검 시각에 돌고 있어 결과 미확인.

### 진행 중인 작업
- 없음

### 완료: 메일 답장 — 파일 첨부 칸 접기 (방 7b544459 · 2026-10-12 · [Opus]) — a00f2785, 운영 미배포
- 원문: *"메일 답변쓰기 할 때 … 파일첨부영역이 너무 넓어서 작성이 불편하네. 파일첨부 열고 닫기 되게 하고 접어두자."*
- 고침: `AttachmentField` 에 `collapsible`(기본 꺼짐) — 켜면 «📎 파일 첨부 (N) ▾» 한 줄로 접혀 시작, 눌러 열고 닫기, 접힌 줄에 파일을 떨어뜨려도 붙는다. 메일 답장·새 메일(전달 포함) 두 곳에 적용. 다른 화면 무변경.
- 검증(Fable 안 씀 — 화면 접기): 3폭(390/820/1440) 답장 열면 접힘(드롭존 없음)·줄 높이 40/36/36·누름 내 것·열면 드롭존 보임·다시 닫힘·가로넘침 0 · 빌드 EXIT 0 · 가드 68/69.

### 완료: 서명 화면 — [거절][확인했습니다 · 서명하기] 를 맨 위에 (방 eef0a73e · 2026-10-12 · [Opus]) — 0d5b4122, 운영 미배포
- 원문: *"서명하기 눌러서 페이지 나오면 상단에 서명하는 곳으로 보내는 안내 있어야 … 이미 페이퍼로 읽은 상태일 수 있잖아 … 이게 헤더에 붙어있으면 어때?"*
- 고침: 머리줄+할 일 줄 한 묶음 sticky(`StickyHead`) — 검토(거절·확인했습니다 · 서명하기 / 로그인하고 서명하기)·이어하기(서명 계속하기) 같은 줄. 맨 아래 칸 삭제. 서명 화면엔 «앱으로 열기» 알림을 안 띄움(위=새 버튼, 아래=완료 화면 [서명한 문서 보기] 를 덮었다 — 실측).
- 검증(Fable 안 씀 — 화면 배치·문구, 서버 무변경): 3폭(375/820/1440) 처음·맨 끝 스크롤 모두 버튼 보임·누름 내 것·가로넘침 0·누르면 서명 창 · 대조군(sticky 끔) 맨 끝에서 3폭 모두 «안 보임» 으로 뒤집힘 · signitems/signinbox/signature 전부 통과 · signflow 손님 쪽 ①~⑦·⑨~⑪·⑭ 통과(⑧⑫⑬ 앱 안 화면은 다른 방이 시험 계정 워크스페이스를 바꿔 흔들림 — 첫 실행에선 통과) · 빌드 EXIT 0 · 가드 68/69.

### 완료: Cue «기존 일정 옮기기» — 여러 건을 한 번에 (방 a4cd46a9 · 2026-10-11 · [Opus]) — 운영 미배포
- 원문: *"Cue에 이런 요청도 되게 해줘. 왜 이렇게 범위가 좁아? 목요일에 넣어두었던 일정들 중에 고두밥 가는 거 빼고 다 못했어. 세 개 일정 다음 주 월요일로 바꿔줘"* — Cue 는 «기존 일정 수정은 못 써요» 라고 답했다.
- 원인: Cue 도구는 일정 «만들기» 뿐이었고, 프롬프트엔 오늘~7일 일정만(지난 목요일은 안 보였다·id 없음).
- 고침: ①일정 얘기일 때 «옮길 수 있는 일정» 목록(지난 14일~35일, #id·요일·시각, 못 옮기는 것은 이유 표시)을 싣는다 ②새 도구 `reschedule_events`(최대 20건) → 확인 카드 한 장(옛→새 시각, 줄마다 ×빼기, 날짜 한 번에 바꾸기, «일정 N건 옮기기») ③실행은 행동 계층 `event_actions.rescheduleEvent` 한 문 — 화면 수정과 같은 판정(멤버·qcalendar 쓰기·canEditEvent·상담 예약 409·반복 원본 409·종일 날짜 부호화·알림 기록 리셋·감사·구글 반영·신호 방송). 새 시각은 서버가 다시 계산(길이 유지, 시간대·서머타임 맞춤). 참석자 변경 알림은 안 보냄(화면 기본값과 같음 — 카드가 말한다). 일부 실패는 «N건은 못 옮겼어요» 로.
- 검증(Fable 안 씀 — 사람이 누르는 확인 카드 · 화면 수정과 같은 권한 함수 · 시간만 바꾸고 되돌리기 쉬움 · 새 공개 표면 없음): 실 API — 목요일 4건 중 «고두밥 빼고» 3건만 제안·이동, 고두밥 그대로 · 종일 일정 날짜 유지 · 반복 409 · 섞으면 1건 이동+1건 실패 보고 · 남의 워크스페이스 id 404 · 멤버는 오너 «나만 보기» 일정이 목록·카드에 안 보이고 팀 일정은 «만든 사람만» 막힘 · 서머타임 경계 2건. 실브라우저 3폭(375/820/1440): 카드 3줄 보임·가로 넘침 0·× 빼면 «2건» · 데스크탑 실행 «✓ 일정 2건을 옮겼어요» + DB 확인. 빌드 EXIT 0 · 가드 68/69 · health 84/84. 도움말 «Cue란?» 에 한 줄(dev seed 반영).
- 남은 것: 반복 일정의 회차 하나 옮기기·업무 마감 여러 건 옮기기는 아직 Cue 로 안 된다(캘린더·업무 화면에서).

### 완료: 표 문서 «표 설명»은 원할 때만 (방 cb71ac3c · 2026-10-11 · [Opus]) — 운영 미배포
- 원문: *"표 설명을 원할 때만 나와야 하는 거 아니야? 문서 형식이 표인데 설명문 넣는 에디터 나오니까 좀 이상해"*
- 원인: 설명 유무를 `JSON 길이 > 30` 으로 봐서 빈 설명(빈 문단 46자)도 «있음» → 편집할 때마다 설명 편집기가 열리고 보기 화면엔 빈 칸.
- 고침: `utils/docHasContent`(글자·그림·표 등 보이는 내용) · 편집은 비면 «+ 표 설명 추가» 버튼만(누르면 편집기) · 보기는 내용 있을 때만. 회귀 tablestyle ⑧ 3폭 → 39/39.

### 완료: 표 글자 서식 · 행/열 끼워넣기 — 문서 안 표 + 표 문서 (방 cb71ac3c · 2026-10-11 · [Opus]) — 운영 미배포
- 원문: *"표에는 에디터가 왜 안돼? 글자들 색상 굵기 크기 조정이 안되는데? 그리고 행사이에 행을 추가하거나 열 사이에 열을 추가하고 싶은 건 어떻게 해? 문서 안의 표, 표 형식 문서의 표. 어느 것이든 다 같이 체크해줘"*
- 문서 편집기(본문·문서 안 표): 툴바 [A] — 글자색 7·배경 6·크기 4(`textStylePalette` 한 벌, `@tiptap/extension-text-style`). 바깥 붙여넣기의 색·크기는 걷음(우리 문서끼리 복사는 유지). 보기 변환(postContentHtml)·PDF·워드도 같은 서식(서버는 #hex·em 모양만). 굵게는 원래 B. 행·열 사이 추가는 원래 표 안 검은 버블(＋행↑↓ ＋열←→) — 실브라우저로 확인.
- 표 문서(그리드): 행 번호 누르면 «위에/아래에 행 추가·행 삭제»(서버 `services/recordRows.insertRow` — 옛 표 position 겹침 정리 후 끼움, 다른 표 행 id 404) · 열 설정 «←왼쪽/오른쪽→ 열 추가» · 칸 서식 줄 [B][A] — 행 값 예약 키 `_fmt[열id]`(팔레트 key).
- 고친 실제 결함 2: ①[A] 메뉴가 sticky 툴바 층 안이라 표 안에서 검은 버블이 클릭을 먹음 → body 포털 ②데스크탑 «리스트 접기» 손잡이 잡는 자리(22px)가 표 문서 행 번호 칸을 덮음 → >900 행 번호 칸 64px.
- 검증(Fable 안 씀 — 화면·편집 기능, 되돌리기 쉬움·기계 판정): `--suite tablestyle` 33/33(문서 표 2폭 + 표 문서 3폭, 보기 화면 유지·음성 대조군 포함 · 두 결함은 이 검사가 먼저 빨간불) · API 행 끼우기 6건 · docfind·tablefit·docsheader 0실패 · 빌드 EXIT 0 · 가드 68/69 · health 84/84.
- 남은 것(작은): 게스트(무로그인) 문서 보기는 정화기가 style 을 지워 색·크기 없이 글자만 보인다(글자는 나옴 — 브라우저로는 확인 못 함).

### 답 기다림 (이전): 운영 메일 재분류 적용 여부 (방 534adfe0 · 2026-10-11 · [Opus]) — Irene «권고대로» → 운영 `--promote-only --apply` 179건 적용, 재실행 0(멱등) · 4355 GFM 등 7건 확인권장 확인 · 운영 critical_notice 54
- 무엇을: 운영 `cd /opt/planq/backend && node scripts/retriage-mail.js --promote-only --apply` — 이미 받은 메일 179건을 자동·마케팅 → 확인 권장으로(승격만)
- 왜: 배포로 새 메일부터는 새 기준이 적용됐다. 이미 묻힌 옛 메일(GFM 4355 · Claude API 1170 · 시프티 결제 실패 · Time 연체 · 넷플릭스 보류 · Tally 유출 등)은 재분류해야 확인 권장에 보인다. 미리보기 ~/.claude/jobs/534adfe0/tmp/prod-preview2.txt
- 답이 오면: 위 명령 실행 → 운영 확인 권장 폴더에 4355 확인 → 보고

### 답 기다림 (이전): 메일 분류 — 반복 거래 알림 처리 + 운영 배포 — Irene «해» → 규칙 등록(dev 3·5, 운영 1: 규칙 id 7·8) + 운영 배포 2e9f6df4 완료
- 무엇을: adaptispay «(NPROD) Statement of Account and Tax Invoice»(매일, dev 164건)·Grab «Your report … is ready»(매주, 37건)를 확인 권장에 둘지, 발신자 규칙으로 자동·마케팅에 보낼지 · 그리고 배포·운영 재분류 지시
- 왜: 새 분류 기준(Fable PASS)으로 이 둘이 확인 권장 승격분의 70% 를 차지하고, 새로 들어오면 푸시 알림도 간다. 발신자 규칙은 Irene 메일함 설정이라 임의로 안 만든다.
- 답이 오면: 규칙이면 Q mail 발신자 규칙 2건 등록(dev 확인) → `/배포` 지시 때 운영 코드 배포 → 운영 `node scripts/retriage-mail.js --promote-only --list` 미리보기 보고 → Irene 확인 후 `--apply`.

### 카톡·왓츠앱 대화 → PlanQ (방 86a95d11 · 2026-10-11 · [Opus]) — 완료, 운영 미배포
- Irene 결정: 동기화·메시지 풀어넣기 안 함. «내보내기 → 공유 → PlanQ» 를 편하게만(«그냥 내보내기 기능만 … 앱들 편하게»).
- c9011e96: `utils/chatExport` 판정 + 공유 화면 «대화 기록으로 보관» 카드 + 파일 이름 «카카오톡 대화 - 상대 - 날짜». 회귀 `--suite sharereceive` ④ 3폭 0실패.
- 남은 것(앱): 안드로이드 앱은 새 Play 빌드가 나가야 공유 시트에 PlanQ 가 뜬다(76da612a 부터 대기) · 아이폰 공유 받기는 App Group 대기. 실제 카톡·왓츠앱 내보내기 파일로는 확인 못 함(형식은 알려진 모양으로 판정).
- 왓츠앱 «미디어 포함» 내보내기는 사진·음성 형식을 받지 않아 PlanQ 가 공유 목록에 안 뜰 수 있다 — 화면은 «미디어 없이» 를 권한다.

### 아침 점검 10/11 (방 c7f09277 · [Opus])
- 개발완료: 게이트 health 84/84 · guard 68/69 · e2e tenant 0 → 10/10 낮 4건(9888764a·d08b5274·bdc8c657·9c08b7a7) DEVELOPMENT_PLAN·next.json 기록 · 도움말 글 project-external-view-link 갱신(«세 탭·주소 한 번만» 으로 낡아 있었다 → 6탭·[복사]·새 주소 받기·고객 공개·파일 보기, dev seed 반영 · wiki-coverage 통과).
- 밤 검사 10-10(실패 3) 처리: mobilechrome = 재실행 통과(흔들림) · leavelink = 검사기가 «오늘+14일» 을 픽스처 날짜로 써 토요일에 돌면 주말이 걸려 400 → 근무일 찾기로 수정, 15/15 · signflow ⑬ = 검사기가 «가장 최근 대화방» 을 골랐는데 그게 10/09 보안 점검이 남긴 비참여 사적 방(sec-d3, 메시지 0)이라 D3 규칙상 카드가 안 그려짐 → «내가 참여한 방» 으로 수정(같은 조건에서 0 실패) + dev 잔여 방 2건(840·841) 삭제.
- 순찰 10-10: /talk 태블릿 «다시 시도» 1건은 지금 재현 안 됨(⬜ 오늘 밤 순찰로 확인) · 메일 2건은 알려진 비차단(앱 메일 새 창·다른 스레드 링크).
- 운영 피드백(읽기): 열린 9건, 10/08 이후 새 신고 0. #463·#464 는 dev 에서 고침·배포 대기(답글 초안 docs/feedback-replies-2026-10-08.json).

### 완료(dev): 메일 분류 대점검 (2026-10-11 · 방 534adfe0 · [Fable] 설계 판정 · [Opus] 조사·구현) — 운영 미배포
- 신고: GFM B2B «Online Sign Up»(G4049) 이 자동·마케팅에 묻힘. 원인 SendGrid 헤더 하나로 광고 판정. 정본 docs/MAIL_TRIAGE_AUDIT_2026-10-11.md §5.
- ESP 헤더 → automated · HTML 전용 본문 판정(triageBodyOf) · 가입 완료 안내 · CRITICAL_NOTICE(제목, 결제 실패·연체·계정 보류·유출·예약 문의·빌드 실패) · 새 로그인 패턴.
- 검증: dev 전수 광고함→확인권장 357 · 답변필요 변동 0 · 강등 0 · 카나리 mail 23/23 · 대조군 115→0 · guard 68/69 · health 84/84. dev 에 `retriage-mail.js --promote-only --apply` 388건.
- **배포 때**: 코드 배포 후 운영에서 `node scripts/retriage-mail.js --promote-only --list` 미리보기 → Irene 확인 → `--apply`(운영 데이터 쓰기 = Irene 지시 필요). 운영 읽기 전용 시뮬은 이 방에서 권한 거부로 못 함.

### 진행 중인 작업
- 없음

### 답 기다림 (이전): 운영 서버에 PDF 그림 도구(poppler-utils) 설치 — 2026-10-11 Irene 설치함(poppler-utils 24.02.0) → Fable 재판정 PASS
- 무엇: 고객 링크 파일 «보기» 의 PDF 미리보기가 `pdftoppm`·`pdfinfo` 를 쓴다. dev 엔 있고 **운영엔 없다**(Fable 실측). 설치는 sudo 라 Irene 몫.
- 왜: Fable 완료 검증 FAIL 의 유일한 남은 차단 항목. 코드 쪽 두 지적(포이즌 캐시 · 배포 사전검사)은 고쳤다 — 도구가 없으면 PDF 에 «보기» 를 안 붙이고, 배포 스크립트가 멈춘다.
- 답이 오면: 운영 `pdftoppm -v` 확인 → `/fable-검증` 재판정(설치·preflight·캐시 수정 확인) → PASS 마커 → 배포는 Irene `/배포` 지시 때. 배포 뒤 K-DINE 링크 PDF 1건 X-Pq-Pages 200 실측.

### 완료·운영 배포됨(2026-10-11 e1c5f56a, Fable 재판정 PASS): 고객 프로젝트 링크 — 개요 통계·주요 이슈·히스토리 탭·파일 «보기» (2026-10-10 · 방 e205bfa8 · [Fable] 설계 §I · [Opus] 구현)
- 2026-10-11 추가(42066f02·d54a4784, 개발서버만 · 운영 반영: 다음 배포 때): Irene «아래로 하지 말고 가로로 · PC·반응형 · 왼쪽 쏠림/공백» → 기본 정보 PC 5칸 한 줄(폰 2칸) · 개요 두 덩어리 나란히(지연|이번 주, 최근 완료|주별 추이, 진행 단계|업무 진행) · 업무 통계 칸이 줄을 채움 · 업무 탭 PC 칸 정렬(담당·상태·기간·진행률 막대) · 히스토리 종류·날짜 오른쪽. guestproject 100 ✅ · 3폭 스크린샷. Fable 안 씀(레이아웃).
- 원문: *"고객 프로젝트 안내에 … 기본 정보들 주요이슈들 통계들, 업무진행 통계들, 히스토리들 … 제대로 제공이 안되고 있어. 파일에서 미리보기도 안되고"*
- 운영 실측(해당 링크): 파일 수십 건 전부 downloadable:false → 미리보기 0(옛 §D 규칙상 «영원히 0»). 개요는 단계·완료수뿐. 업무 상태 done_feedback 등 원문 노출.
- 설계 docs/GUEST_PROJECT_VIEW_DECISIONS.md §I. 개요 기본 정보(빈 칸 «—»)·업무 통계(guestTaskStats.ts)·주요 이슈 3 · 6번째 탭 «히스토리» · 히스토리 항목별 «고객 공개» 토글(기본 꺼짐, PATCH /api/projects/:id/history-entries/:entryId) · GET /api/guest/:token/history · 파일 보기 GET /api/guest/:token/files/:id/preview(이미지 webp·PDF 한 쪽 png, 원본 금지, 링크 토큰 아래) · 받기는 종전(L4) · 멤버 링크 창 안내 3줄.
- **운영 배포 때**: `scripts/migrate-history-entry-client-visible.js` 가 코드보다 먼저(배포 슬롯 등록함). 기존 행 전부 꺼짐 → K-DINE 링크 «주요 이슈» 는 멤버가 켜야 보인다.
- 검증: guestproject 100 ✅ · tenant·projecttabs 포함 129 ✅ · 대조군 2개 뒤집힘 · health 84/84 · guard 68/69 · vite build 0 · 범위 tsc 0. Drive 저장분 미리보기 ⬜ 미측정.
- Fable 완료 검증 1차 **FAIL**(dev 코드는 설계와 일치 · 27검사 독립 재현 · 전체 tsc -b heap 5120 으로 2분 31초 EXIT 0): 운영에 poppler 없음 + 도구 실패를 «못 읽는 PDF» 로 영구 캐시. → `pdfToolsAvailable()`(없으면 PDF «보기» 꺼짐) · 도구 실패는 캐시 안 함 · `deploy-planq.sh preflight_check` 에 poppler 검사(없으면 배포 중단). 재측정 5/5 + 도구없음 판정 + 카나리 100 · guard 68/69 · health 84/84.
- Fable 팁: 전체 `tsc -b` 는 `NODE_OPTIONS=--max-old-space-size=5120` 이면 dev 에서 끝난다(«77초 사망» 의 실체가 heap OOM 일 수 있다).
- 남김(I-6): 로그인 고객 앱의 개요·히스토리 탭 · 로그인 고객 파일 가시성(fileListWhereByLevel 고객 분기 없음 — 자기 업로드만 보임) — 별도 Fable 설계.

### 완료: 옛 방식 고객 링크 — «복사할 수 있는 새 주소 받기» (옛 링크는 열린 채) (2026-10-10 · 방 59f070bf · [Opus] · Fable 안 씀 — 같은 자리·같은 범위 링크 하나 추가, 새 공개 라우트·범위 확장 없음)
- 신고: 프로젝트 외부 열람 링크가 «이전 방식 링크라 주소를 다시 볼 수 없어요» 로 복사 불가. 운영 실측: 살아 있는 공유 링크 4개 중 #1·#2·#5 가 9/24 파생 토큰 이전 난수 링크(원문 없음 — 되살릴 수 없음). 신고 건은 #5(워프로랩 프로젝트 3, 9/27 고객 열람).
- 전엔 [새 링크로 교체] 뿐 → 옛 주소를 받은 고객이 끊겼다. 이제 옛 링크면 [복사할 수 있는 새 주소 받기]: 옛 것은 닫지 않고 파생 링크 하나 추가(문의 허용·메모 이름 물려받음), 옛 것은 «지금 열려 있는 링크» 로 내려가 따로 닫는다. 서버 `issueOrReuseSharedLink({upgradeLegacy})` — **옛 링크일 때만** 새로 만들고 파생이면 재사용(자리당 링크가 늘지 않음). 감사 oldValue `kept_legacy_link_id`. 프로젝트·대화방 두 라우트 `upgrade_legacy:true`.
- 검증: API 12/12(옛 토큰 계속 200 · 새 토큰 200 · 두 번째는 reused · 옛 닫으면 404/새 200) · 실브라우저 3폭 12/12(버튼 보임·누름·새 주소=DB·클립보드 일치) · build EXIT 0 · guard 68/69 · health 84/84 · e2e guestproject 0 · 픽스처 잔여 0. 운영 미배포.

### 완료: 고객 링크 창 — «지금 열려 있는 링크» 줄에 [복사] (2026-10-10 · 방 a06909e5 · [Opus] · Fable 안 씀 — 화면 버튼 추가, 공개 표면·토큰 규칙 변경 없음)
- 신고: 대화방 고객 링크 창에서 대화 링크가 옛 난수 방식(주소 복원 불가)이고 같은 방의 프로젝트 링크는 목록 줄에 복사 문이 없어 «다시 복사가 안돼».
- 서버는 이미 목록에 `url` 을 싣고 있었다 → `GuestLinkButton` 목록 줄에 url 있을 때만 [복사](복사됨 2초). 옛 난수 링크는 여전히 주소를 못 되살린다(설계상 — [새 링크로 교체]).
- 검증: build EXIT 0 · guard 68/69 · 실브라우저 3폭(390/900/1440) 버튼 보임·가림 없음·누르면 정확한 주소 복사 · 대조군(프로젝트 링크도 옛 방식) 버튼 0 · 픽스처 삭제. 운영 미배포.

### 완료: 캘린더 지난 일정 흐리게 (2026-10-10 · 방 fae6dd42 · [Opus] · Fable 안 씀 — 색·표시만, 공용 기준상 대상 아님)
- 끝난 일정(끝 시각 ≤ 지금, 워크스페이스 벽시계) = 불투명도 0.55 · 마우스 올리면 0.85. 업무(마감)는 흐리게 안 함(늦은 것 ≠ 끝난 것). 진행 중·오늘 종일은 그대로.
- 한 벌 `pages/QCalendar/pastLook.ts`(pastAttr·pastCss·useWallNow 1분 갱신) — 월 칸·월 팝오버·종일·시간표·목록 5곳. 시간표의 현재 시각 선도 1분마다 움직이게(전엔 화면 연 시각에 멈춰 있었다).
- 검증: build EXIT 0 · guard 68/69 · 실브라우저 3폭×3보기 58 ✅ 0 ❌(미측정 6 = 다른 보기에서 잰 것) · 픽스처 잔여 0. 운영 미배포.
- 10-11 Irene 답 «업무일정은 적용이 안되고 있어 · 오늘 이전은 연회색으로» → 업무 마감도 마감일이 지나면 흐림 · 오늘 이전 날짜 칸 연회색(#F1F5F9) + 날짜 글자 회색(#94A3B8) — 월 칸·주/일 머리·종일·시간 열·목록 머리줄. 실브라우저 81 ✅(이번 주는 오늘=일요일이라 지난 칸 0이 정답, 지난 주로 21칸 확인) · build 0 · 픽스처 잔여 0.

### 아침 점검 10/10 (방 58f2d114 · [Opus]) — 배포 가능 상태 확인
- 개발완료 건너뜀: 마지막 개발완료(f4377490) 뒤 문서 2커밋뿐·푸시됨. 게이트 health 84/84 · guard 68/69 통과 · e2e tenant 0.
- 밤 검사 10-09 실패 10스위트 재실행 → 9개 통과(이미 고쳐짐), qnotecue 는 검사기 기대값(401→404, 보안 2차의 존재 숨김) 수정. 순찰 10-09 는 하니스 죽음(Connection closed) — 오늘 밤 결과를 볼 것.
- next.json 을 미배포 전체(dab6c857 이후 ~100커밋)로 갱신.
- 운영 피드백 읽기(ssh)는 이 방에서 권한 거부 — 확인 못 함.

### 완료: 관리자 열람 규칙 D2·D3·D4 (2026-10-10 새벽 · [Opus]+[Fable] D3 설계 PASS·완료 PASS · 방 006a5c5d = 옛 166c2f84) — 운영 미배포
- D2 owner/admin 도 남의 «나만 보기» Q info·일정 닫힘 · D3 프로젝트·고객 없는 팀 대화 참여자만(docs/PRIVATE_CHAT_DESIGN.md) · D4 관리자는 남의 개인 메일 끄기만 · D10 그대로(대표가 개인 회고를 본다 — Irene).
- 검증: D2/D4 12/12(원본 대조 8 뒤집힘) · D3 26/26 실HTTP+실소켓(원본 대조 16) · Fable 107+9 실측 누수 0 · health 84/84 · guard 68/69 · build 0 · e2e tenant·clientlink·clienthome·inboxcount·chatattach 0.
- 운영 영향(읽기 실측): 프로젝트 없는 팀 대화 6개, 비참여자가 쓴 방 0 — 대화방을 잃는 사람 없음. 참여자 자동 백필 안 함.
- nginx 2중 차단(dev) 적용됨 — Irene 이 고친 스크립트를 다시 실행(20:32). 옛 백업은 /etc/nginx/backups 로 옮겨졌고 실측 /api/internal·/api/INTERNAL·/qnote/…/internal 403 · /qnote/health 200. 운영은 다음 배포 때 같은 스크립트 prod.

### 답 기다림 (이전): 관리자가 멤버의 «나만 보기»·개인 메일·개인 회고·참여 안 한 대화방을 보는 규칙 — Irene «권고대로»(D10 은 그대로)

### 완료: 보안 점검 2차 (2026-10-09 밤 · [Opus]+[Fable] 1차 FAIL→2차 PASS · 방 166c2f84) — 운영 미배포
- 원문: *"완벽한 서비스 운영을 위해 보안점검 다시 해줘. 고객정보 새거나 외부인이 함부로 보게 되는 거 없는지 …"*
- 정본 `docs/SECURITY_SWEEP_2026-10-09.md` — 고친 것 30여 건(치명 1: 문서 서식 자동채움으로 남의 워크스페이스 프로젝트·고객 읽기 · 고객사 간 채널 누수 · 고객에게 계약금액·전략·공수 · 프로젝트/대화 방송 누수 · 개인 메일·메모 방송 · 비밀번호 재설정 후 세션 생존 · 공유 비밀번호 대입 · 지운 워크스페이스 공유 링크 · Q Note 내부 주소 · 구글 콜백 HTML 주입 …).
- 새 장치: `services/projectRoom.emitProject`(프로젝트 방 직원/고객 분리, 가드 `checkProjectRoom`) · `services/socketRevoke` · 전역 toJSON 비밀값 내리기 확장 · `shareOpenable.workspaceAliveParam` · q-note `_internal_gate` · `utils/botUa`.
- 검증: 재현 62 ✅ 0 ❌(원본 대조 13 뒤집힘) · 공개 파일 서버 10/10·브라우저 10/10 · health 83/83 · guard 67/68 · build EXIT 0 · e2e tenant·tenantwrite·clientlink·clienthome·bookingapi·inboxcount·guestproject 0 · Fable 2차 PASS.
- 부수: 대조 실행 중 dev 고객 채널 644 에 시험 메시지 1건이 들어가 지웠고, 푸시 1건이 dev 계정(user 3)에 나갔다.
- **배포 시 할 일**: nginx 두 겹 `sudo /opt/planq/scripts/apply-nginx-internal-deny.sh dev|prod`(Irene, root) · 운영 posts.vlevel NULL 0 확인은 필터가 NULL 을 포함하므로 불필요.

### 다음 할 일 (보안 점검 2차에서 넘긴 것 — Fable «고칠 것»)
- D5 구글 «연결» OAuth state 를 브라우저/세션에 묶기 — 웹 경로부터, 네이티브는 설계 1회. **다음 사이클을 넘기지 말 것**(Fable).
- D1 메뉴 권한(none/read) 서버 적용 — 업무·문서·파일·채팅·일정·Q info. Fable 설계 1회 후. `requireMenu(…,{allowNonMember})` 모양 재사용.
- D7 Stripe 웹훅 payment_status·금액 대조(Fable calc) · D6 통합보고서 공개 링크 만료(스키마) · D8 의존성 1단계(nodemailer·multer·mysql2·socket.io·axios) → 2단계(sharp·puppeteer·tiptap·capacitor).

### 완료: 체험 중 결제 «해지하고 환불 요청» (2026-10-09~10 · [Fable] 설계·완료 검증 PASS · [Opus] 구현 · 방 58947e65) — 운영 미배포
- 원문: *"체험기간은 그대로 주고 체험기간엔 환불 가능. 체험 끝나는 시점부터 유료 적용 2달"* → A *"권고대로 설계해"*. 설계 docs/TRIAL_REFUND_DESIGN.md.
- 대표: 요금제 화면 [해지하고 환불 요청](계좌이체면 은행·계좌·예금주) → «관리자 확인 중» + [요청 취소]. 관리자: 확인 필요 «환불 요청» · 결제 이력 [체험 환불 처리](계좌 열람 감사 · «이체 마침» 확인 / 카드는 Stripe 환불) → 결제 환불 · 구독 체험 복귀(종료일 불변, 늦으면 past_due+7일) · 완료 메일.
- 약관 제4조 한 줄 + 요청 경로(버전 안 올림) · 선결제 카드·대시보드 문구 «체험 끝나기 전 해지하면 전액 환불».
- 검증: API·DB 31/31 · 브라우저 24/24(3폭) · health 84/84(secrets 환불 계좌 원문 0 추가) · guard 67/68 · e2e prepay·admininbox·tenant 0 · migrate 멱등. Fable 독립 55검사·브라우저 19/19.
- **운영 배포 때**: `scripts/migrate-trial-refund.js` 가 코드보다 먼저(배포 슬롯 등록됨). 첫 운영 카드 환불은 Stripe 대시보드와 대조(dev 에선 실 Stripe 호출 미측정).
- Irene 인지: 카드 환불 수수료는 우리 부담 · 세금계산서 발행된 건은 수정세금계산서 따로 · 체험 환불 뒤 재결제엔 +1개월이 다시 붙음(환불 1회).

### 답 기다림 (이전): «체험 중에는 환불 가능» 을 어떻게 처리할까 — Irene 답 «권고대로 설계해» → A 로 구현 완료(아래) (2026-10-09 밤 · 방 58947e65)
- Irene 원문: *"처음에 플랜 선택하는 거 아니야? 체험 시점에? 그리고 결제를 먼저 하면 +1달 주는 거 안내해서 결제유도 하자. 체험기간은 그대로 주고 체험기간엔 환불 가능. 체험 끝나는 시점부터 유료 적용 2달 되는 거지. 어때?"*
- 이미 된 것: 가입 때 플랜 고르기(방 c3d0da3b) · 체험은 그대로 + 유료 기간은 체험 끝나는 날부터 2개월(billing.resolvePeriodStart — 실측 10/10 결제·체험끝 10/24 → 10/24~12/24).
- 이번에 한 것: 대시보드 체험 카드(오너)에 «지금 결제하면 1개월 더 · 체험 끝나는 날부터 2개월» + [+1개월 받고 결제] → 요금제 화면 선결제 카드 · 체험 카드 «Starter 체험» 고정 → 실제 플랜 이름. 브라우저 6/6(3폭) · prepay·onboarding 0 실패 · 빌드 EXIT 0 · 가드 66/67.
- 남은 것: 환불. 지금 문구 «이미 결제한 1개월 요금은 해지해도 환불되지 않습니다» 와 약관 4조(월간 7일 내 100%)가 그대로다. 사용자가 스스로 해지·환불하는 길이 없고, 관리자 [환불] 은 결제 기록만 «환불» 로 바꿀 뿐 구독은 그대로 둔다(카드 환불은 Stripe 에서 손으로).
- 답이 오면: 돈·약관이라 Fable 설계 1회(체험 중 해지→환불 요청→관리자 환불 시 구독을 체험 상태로 되돌림·카드/계좌 처리·약관 문구) → 구현 → Fable 검증.

### 완료: 가입 때 혼자·팀 고르기 → 고른 플랜으로 14일 체험 · 체험 중 결제 없이 플랜 바꾸기 (2026-10-09 · [Opus]+[Fable] 설계·완료 PASS · 방 c3d0da3b) — 운영 미배포
- 원문(답): *"처음에 혼자 쓸지 말지 선택 가능한거 아니야? 플랜마다 다른 거잖아."* — 앞 질문(체험 중 팀원 초대)의 B.
- 가입 화면·«새 워크스페이스 만들기» 창에 «어떻게 쓰실 건가요?» 혼자 Starter 1명 / 팀과 함께 Basic 5명(처음 선택) / 큰 팀 Pro 10명 (`components/Auth/TrialPlanPicker`). 요금제 화면 버튼 → `/register?plan=…`. 구글·애플 가입도 고른 값을 state 로 나른다.
- 체험 중에는 결제 없이 바꾼다: 한도 창(멤버 한도)에 대표만 «팀 체험으로 바꾸기» · 플랜 화면 카드 «이 플랜으로 체험». 체험 종료일 그대로 · 내릴 때 인원이 넘으면 막고 이유 표시 · 이미 만든 옛 금액 사전청구는 닫힌다.
- 체험 중 AI 실행 월 50회·녹음 60분은 플랜과 무관(비용 캡). 결제가 확정되면 풀린다. 사용량 막대·경고 카드·AI 창 남은 횟수가 실제 적용 한도를 읽는다.
- 서버 정본 `config/plans.newTrialBusinessFields` · `POST /api/plan/:biz/trial-plan` · 가드 `--category=trialplan`. 운영 스키마 변경 없음(이력 reason 은 trial_start + 메모·감사).
- 검증: API 38/38 · 브라우저 34/34(390/820/1440) · 빌드 EXIT 0 · 가드 66/67 · health 83/83 · tenant·prepay 0 · 멤버 내보내기 캐시 수정 실측. Fable 판정 docs/FABLE_GATE_QUEUE.md 맨 위.
- 테스트 데이터: dev 워크스페이스 1317~1363 대(example.com) 삭제 표시. 검증 중 dev 결제 1건(삭제된 테스트 워크스페이스) 확정 처리됨.

### 정해짐(A · 그대로 둠, Irene 2026-10-09): 상황판 dev 링크를 «앱으로» 열려면 dev 를 보는 앱이 폰에 있어야 한다 (2026-10-09 · 방 33a23fc2)
- 무엇: 폰에 깔린 PlanQ 앱(스토어·TestFlight)은 운영(planq.kr) 껍데기다. dev.planq.kr 링크를 그 앱으로 열면 운영 데이터가 보인다 → 이번에 운영 앱은 planq.kr 링크만 받게 바꿨다(dev 링크는 브라우저).
- 선택지: A 그대로(dev 링크 = 브라우저, 운영 링크 = 앱) / B 안드로이드 dev 앱(apk, dev.planq.kr) 따로 설치 / C iOS «PlanQ Dev» 별도 앱(번들 id 분리 + App Store Connect 앱 등록 + TestFlight — Irene 손작업).
- Irene 답: «그대로 둬» → A. dev 링크는 브라우저, 운영 링크는 앱. 따로 할 일 없음.

### 답 기다림 (이전): 새 팀은 체험 중 팀원을 초대할 수 없다 (2026-10-09 · 방 58947e65) — Irene 답 «처음에 혼자 쓸지 말지 선택 가능한거 아니야? 플랜마다 다른 거잖아» → B(가입 때 혼자·팀 선택 = 플랜별 체험), 방 c3d0da3b 진행
- (10-09 밤 Irene 답이 «체험 처음에» 에서 끊겨 옴 → 다시 물음)
- 무엇: 신규 가입 = 스타터 체험(멤버 1명 한도, config/plans.js starter.members_max=1). 팀 적응 1단계 «팀원 초대하기» 를 누르면 «멤버 수 한도 도달» 창 — 새 팀이 첫날 막힌다.
- 선택지: A 체험을 베이직 한도(5명)로 / B 가입 때 «혼자·팀» 선택(팀이면 베이직 체험) / C 그대로 두고 안내만(«팀원 초대는 베이직부터»).
- 답이 오면: A·B 는 요금·한도 엔진 변경(체험 끝에 한도 초과 상태 처리 포함)이라 Fable 설계 1회 → 구현 · C 는 1단계 «팀원 초대» 줄·초대 칸 문구만.

### 다음 할 일
- 체험 비용 캡을 미결제 유예 7일에도(Fable 비차단 ②) — `services/plan.getEffectiveLimits` 술어를 «플랜 결제 0건 ∧ active 아님» 으로. 돈 관련이라 다음 사이클에 Fable 판정과 함께.
- 별도 건: 같은 초대 토큰 동시 가입 경합(services/invites.acceptInvite 의 bm.update 에 joined_at IS NULL 조건 + affectedRows 0 이면 already_accepted) — Fable 비차단 지적.
- 팀 적응 5단계 — Irene 이 dev 에서 보고 3~5단계 구성·랜딩 노출 위치(푸터·기능 페이지 끝, 홈 미노출)를 고치라 하면 문구·순서만 고친다(세 곳 = dashboard.json stage.* · landing.json startPage · 도움말 글, 서버 STEPS).
- 다음 /배포 때: 배포 후 운영에서 `node seed-wiki-content.js`(도움말 글 team-adoption-stages · trial-options 플랜 고르기 절) · 운영 owner 첫 화면 단계 실측(이번엔 운영 읽기 권한 거부)
- **Irene 운영 손작업**: 플랫폼 관리 > 구독 관리 > 결제대기 > 루아테스트2 [입금 확인] (운영 결제 #21)
- 다음 /배포 — 관리자 확인 필요·배지·알림(cd372c3a) + 입금 확인 링크(6431fc29) + 공휴일·가동률 수정 + 돈 정합 0-A/0-B 가 같이 나간다. 배포 뒤 답글 초안 docs/feedback-replies-2026-10-08.json 적용
- 비차단 후속: 관리자 푸시 본문 400자 → excerpt · 일정 알림 비교 기준(Fable 권고) · 순찰 2건(앱 메일 새 창 · 다른 스레드 링크)

---

### 완료: 링크 → 앱 열기 — 경로 넓힘 · 빌드별 도메인 하나 · 다른 서버 링크는 브라우저 (2026-10-09 · [Opus] 방 33a23fc2) — 커밋됨(방 c3d0da3b /개발완료)·운영 미배포 — 안드로이드·iOS 도메인 반영은 GitHub 푸시 후 새 앱 빌드
- 요청(서버 방 경유): 상황판 «확인할 곳» 링크를 폰에서 누르면 앱이 깔려 있으면 앱으로.
- 정본 `scripts/native-link-paths.js`(로그인해서 쓰는 앱 화면 25 접두어 + /oauth/native-return, 공개 표면 제외) → `scripts/cap-link-domains.js` 가 AASA·AndroidManifest(pq:app-links 표식 사이)·iOS entitlements 를 쓴다. 도메인 = 각 플랫폼 capacitor.config.json server.url 호스트 하나(운영 빌드 planq.kr / dev 빌드 dev.planq.kr). cap:sync:*·cap:beta* 에 물렸고 `--check` 는 cap:check* · guard-native-release 에.
- NativeBridge appUrlOpen: https 링크 출처 ≠ 앱 출처면 앱 안 이동 대신 Browser.open(옛 빌드가 두 도메인을 다 받으므로).
- 검증: 빌드 EXIT 0 · 가드 65/66 · guard-native-release 새 항목 통과(기존 실패 1 nativeShare 는 원래부터) · --check 양성 대조군 2건(manifest host·AASA 경로 바꾸면 exit 1) · 앱 라우트 전수 대조(빠짐 /share-receive 의도 · 공개 경로 잡힘 0). 실기기 확인 못 함.
- 반영: iOS 경로 = 웹 배포(AASA, 애플 캐시 시간) · iOS 도메인 분리·안드로이드 경로/도메인 = 새 앱 빌드(Codemagic 은 GitHub 에서 당김 → 커밋·푸시 필요) · 다른 서버 링크 가드 = 웹 배포.

### 완료: 새 팀 첫 길 점검 — 가입 → 팀원 초대 → 합류 → 업무 요청 → 대화 (2026-10-09 · [Opus] 방 58947e65) — 운영 미배포
- 원문: *"이제 새로운 팀이 시작하게 할거야. 기본 루트에서 사용하는데 불편함이 없는지 체계적인 점검 가능해? 불친절한 안내는 없는지더"*
- 방법: dev 에서 새 대표 가입(화면) → 13개 메뉴 첫 화면(데스크탑·폰) → 팀원 초대(화면) → 초대 링크로 가입 → 업무 요청 → 새 대화. 실브라우저 스크린샷.
- 고친 것(12): ① Q task 기본 탭 업무 추가에서 고른 담당자를 버리고 «나» 로 저장(요청이 조용히 내 업무가 됨) ② 초대 링크로 가입하면 «이미 수락된 초대입니다» 화면에 떨어짐 → 바로 대시보드 ③ 같은 사무실(IP)에서 4번째 팀원 가입이 1시간 막힘(가입 제한 3회) → 살아 있는 초대 토큰 가입은 세지 않음(middleware/security.js, 같은 해석기 resolveInviteToken) ④ 초대 가입 화면이 «14일 무료 체험» → «○○ 에 팀원으로 합류» + 초대 메일 주소 채움 + «가입하고 합류하기» ⑤ 가입 직후 1인 워크스페이스 «한도를 초과 100%+» 빨강 → 딱 찬 것은 «한도에 도달» 노랑, 사용량 카드는 오너만 ⑥ 팀원 대시보드 «Starter 체험 · 결제 페이지» → 팀원은 결제 버튼 없음·평상시 체험 안내 숨김 ⑦ 새 대화 창 스위치 3개가 빈 네모(공용 체크박스 스타일이 role=switch 를 덮음) → index.css 에 스위치 모양 ⑧ «(Q note 패턴)» 개발 용어 ⑨ Q note «세션» → «노트» ⑩ 폰 Q talk 빈 목록에 버튼·안내 없음 → «팀원과 첫 대화방…» + [새 대화 시작] ⑪ 폰 알림 배너 × 가 아래 테두리에 걸침 ⑫ 데스크탑 앱 설치 안내(z 8500)가 우측 서랍의 입력·버튼을 덮음 → 다이얼로그 열리면 비킴. + 멤버 초대 칸 안내 한 줄·두 번째 칸 이름(맡은 일), 가입 버튼 약관 미동의여도 눌려 이유 표시, 워크스페이스 칸 «회사·팀 이름».
- **Fable**: 가입 제한 예외(③)만 대상 — 1차 FAIL(한도로 수락 못 하는 토큰 = 영구 열쇠) → 수락과 같은 술어 + 토큰당 5/시간 → 2차 PASS(docs/FABLE_GATE_QUEUE.md 맨 위). 나머지는 화면·문구라 «Fable 미검증(자체 검증)».
- 남은 것(별도 건): 같은 초대 토큰 동시 가입 경합 — acceptInvite bm.update 에 joined_at IS NULL 조건.
- 검증(자체): 빌드 EXIT 0(error TS 0) · 가드 65/66(기존과 같음) · 실브라우저 22/22(가입·초대·합류·요청 DB 대조·스위치 계산 스타일·서랍 위 설치 안내·폰 버튼 elementFromPoint·음성 대조: 남이 쓴 초대) · 가입 제한 5/5(양성: 일반 가입 4번째 429 · 음성: 없는 토큰 429 · 이미 쓴 토큰 429 · 초대 3건 201 · 실제 합류 3). 앞의 수리 전 상태가 대조군(업무 3257 담당자=대표, 화면엔 팀원).
- 관찰만(규칙이라 손대지 않음): 내가 만든 업무를 상세에서 동료로 «바꾸면» 동료 확인 필요에 안 뜬다(요청은 생성 때만 request_by). 팀원 첫 방문에 «오늘 시작하기» 창이 바로 뜬다.
- 테스트 데이터: 만든 워크스페이스 1211~1216(example.com 계정) 삭제 표시(deleted_at).

### 완료: 시작 가이드가 안 보인다 — 랜딩 상단 메뉴 · 확인 필요 화면 (2026-10-11 · [Opus] 방 cdf8db0c) — 운영 반영: 다음 배포 때
- 원문: *"시작 가이드가 상단에 어디에서도 알 수 없어. 랜딩페이지나 처음시작하는 사람의 워크스페이스에 제대로 나와? 랜딩페이지에는 안보여."*
- 랜딩: 상단 메뉴(GNB)에 «시작 가이드»(/start) 추가. 메뉴 9개가 좁은 데스크탑에서 넘쳐(실측 1024px +115px) 1023px 이하는 메뉴 시트로 접고, 1024~1279px 에서는 브랜드스토리·앱 다운로드를 숨김(푸터·시트에는 그대로).
- 워크스페이스: 로그인하면 «확인 필요»(/inbox)로 오는데 단계 카드는 대시보드·설정에만 있었다 → /inbox 맨 위에도 같은 카드. 이미 다 쓰는 계정(단계 모두 끝)이나 닫은 사람에게는 카드가 안 보이는 것이 정상.
- 검증(Fable 안 씀 — 메뉴·배치): --suite onboarding 152검사 실패 0(새: inbox 카드 3폭×2역할 · GNB 1024/1100/1280 한 줄·넘침 0 · 시트 390/820). 메뉴 넘침 검사는 고치기 전 빨간불 → 고친 뒤 초록. 빌드 EXIT 0 · guard 68/69.

### 완료: 팀 적응 5단계 — 대시보드 카드 · 도움말 · 랜딩 /start (2026-10-09 · [Opus]+Fable 설계 · 방 cdf8db0c) — 운영 미배포
- 원문: *"플랜큐는 기능이 너무 많아. 팀이 적응하는데 필요한 단계별 안내가 필요해 … 처음 가장 효과적인 건 업무 관리 업무요청 … 말로하기도 있고 챗지피티랑 클로드에서도 가능해. 프로젝트랑 연결해서 업무등록. 그리고 채팅과 이메일로 소통하는 거. 여기까지가 2단계"*
- 다섯 단계: ① 업무 공유·요청(팀원 초대·업무 등록·동료 요청 / 선택: 프로젝트 연결·말로·AI) ② 대화·메일 ③ 일정·회의 ④ 자료·문서 ⑤ 고객과 함께. 정본 docs/TEAM_ADOPTION_STAGES_DESIGN.md.
- 대시보드·설정 최상단 기존 카드(OnboardingChecklist)의 «워크스페이스» 묶음 자리를 단계로 바꿨다(새 카드 아님). 지금 단계만 펼침 · 점 5개 · «n/5단계» · 실데이터로 저절로 체크.
- Fable 설계 1회 PASS-WITH-CHANGES → 6건 반영. 완성 검증은 자체(Fable 미검증 — 안내 UI): onboarding 118검사 0실패 · 양성 대조군 19건 뒤집힘 · health 83/83 · guard 65/66 · tenant 0 · 빌드 EXIT 0.
- 확인 못 함: 운영 데이터로 기존 워크스페이스가 몇 단계로 뜨는지(운영 읽기 권한 거부). dev 실측: 바쁜 팀 대표 «다 끝남» · 그 팀 멤버 3단계 · 혼자 쓰는 대표 1단계(팀원 초대).

### 완료: 확인필요 «서명» 항목을 눌러도 서명 문서가 안 나오던 것 — 앱(탭 모드) 빈 탭 (2026-10-09 · [Opus] 방 407a9eb7) — 운영 미배포
- 원문: *"확인필요에 이 업무가 있는데 눌러도 서명문서 안나와. 다시 서명과정 점검해줘."* (K-DINE with MIN 추가 매장 가맹 및 운영계약서 ver.03 · 만료 10/19)
- 운영 실측(읽기): 문서 #77 · 서명 요청 #3(우리 쪽 · 서명자 Irene user 1 · 대기 · 고정본·별첨 3 정상) · #4 상대 서명 완료 · #5 상대 발송. 운영 서명 API 200, 링크를 직접 열면 데스크탑·폰 모두 문서가 그려진다 → 데이터·서버 문제 아님.
- 원인: 확인필요는 `/sign/:token` 을 새 창으로 연다. 웹은 새 브라우저 탭이라 멀쩡. **앱(아이패드 = 데스크탑 탭 모드)** 은 nativeLinks 가 그 창을 앱 안 새 탭으로 돌리는데 탭 본문 표(TabPane)에 `/sign` 이 없어 **주소만 바뀌고 빈 탭**. 대시보드 «확인 필요 미리보기»·받은 서명 목록도 같은 길.
- 수리: `TabPane` 에 `/sign/:token` 공개 화면 예외 1줄(appRoutes 는 MainLayout 라우트와 1:1 이라 넣지 않음) · 서명 화면이 탭 안이면 탭 이름 = 문서 제목 · [닫기] = 탭 닫기 · 맨 위로 = 탭 본문 · 높이 100vh → 탭 칸. 탭 아이콘 = 문서.
- 검증(Fable 안 씀 — 화면 라우팅 버그, 서명 판정·증거 불변): 새 `--suite signinbox` 4환경(데스크탑 웹·아이패드 앱 흉내·폰 웹·폰 앱) 8/8 · **양성 대조군**(수리 1줄 빼고 빌드) → 아이패드 앱 2건만 실패로 뒤집힘 · signflow·signitems·signature 실패 0 · 빌드 EXIT 0(error TS 0) · 가드 65/66 · app-routes 일치.
- 남은 것: 다음 /배포 때 나간다(앱은 원격 껍데기라 웹 배포로 고쳐진다). 그 전까지 아이패드 앱에서는 «받은 서명» 대신 웹 브라우저로 열면 서명 가능.

### 완료: 플랫폼 관리자 «할일 필요» 메뉴 재요청 — dev 에 이미 있음, 운영 미배포 (2026-10-09 · [Opus] 방 314f4070)
- 원문: *"플랫폼 관리자에 할일필요 메뉴를 추가해서 결제 입금확인 요청이나 문의 오거나 해서 할일이 발생하면 알려줘. 좌측 메뉴에 알림들 표시하고 중요하게 할일들이 묶여있는 메뉴들을 위쪽으로 정돈해."*
- 10/8 방 282c4c27(cd372c3a) + 10/9 방 acfb43d5(6431fc29) 가 이미 했다 — 운영(v1.70.1)에 안 나가서 안 보이는 것. 코드 변경 없음.
- 재확인: `--suite admininbox` 3폭 실패 0(배지=서버 total · 입금 행 → 그 구독 [입금 확인] · 음성 대조군). 수집 종류: 입금 통보(플랜·추가구매)·세금계산서 요청/실패·문의(자가진단 리드 포함)·피드백.
- 남은 것: 다음 /배포.

### 완료: 플랫폼 관리자 «어디서 입금 완료?» — 알림이 그 구독 행으로 데려간다 (2026-10-09 · [Opus] 방 acfb43d5) — 운영 미배포
- 원문: *"루아가 구독신청을 은행입금으로 했대. 그런데 플랫폼관리자가 어디서 입금완료해야 하는지 모르겠어. 안나와."*
- 운영 실측(읽기): 결제 #21 · 루아테스트2(biz 16) · starter 월 9,900원 · 입금자 한수정 · 10/8 11:01 KST 입금 통보 · **아직 pending**. (#20 은 같은 워크스페이스의 교체된 옛 체크아웃 — 확정 불가 가드가 막는다, 손대지 말 것)
- 원인: 운영(v1.70.1)은 10/8 «확인 필요» 정비(cd372c3a) 전 — 관리자 알림은 메일뿐 + 메일 링크가 없는 주소 `/admin/plans` · 사이드바 배지 없음. 버튼 자체는 **플랫폼 관리 > 구독 관리** 행의 [입금 확인] 에 있었다(목록 맨 끝 메뉴라 안 보임).
- dev 보완: 입금 통보 알림·확인 필요 행 링크가 **그 구독**(`/admin/subscriptions?status=pending&sub=:id`, 추가 구매는 결제 이력 `?payment=`)을 가리키고, 구독 관리가 그 행으로 스크롤 + 테두리 표시(결제 이력과 같은 방식). 통보 없는 체험 대기 결제들 사이에서 찾지 않아도 된다.
- 검증(Fable 안 씀 — 링크·강조 UI, 입금 확정 함수 불변): API 실호출 5/5(통보 200 · 종 알림 링크 · 확인 필요 링크 · 5분 재통보 알림 0) · `--suite admininbox` 3폭 전부 통과(새 검사: 그 행 [입금 확인] 화면 안·elementFromPoint·강조 테두리) · 빌드 EXIT 0 · 가드 65/66.
- **Irene 지금 할 일(운영)**: 플랫폼 관리 > **구독 관리** > «결제대기» 탭 > 루아테스트2(초록 «입금 통보» 표시) > [입금 확인]. 확인 필요 메뉴·배지는 다음 /배포 때 나간다.

### 완료: 밤 검사(10/8) 실패 6건 처리 (2026-10-09 · [Opus] 방 61760b6c) — 운영 미배포
- **실제 결함 1** — 플랫폼 관리자 화면에서 다른 워크스페이스를 고르면 **간헐적으로 /admin 에 그대로 남았다**(서버 전환은 됨).
  원인: 서버가 응답보다 먼저 소켓 'workspace:switched' 를 쏘는데 누른 창은 응답 뒤에야 «내가 전환 중» 표시 → WorkspaceSyncGuard 가 남의 전환으로 읽고 관리자 화면 제자리 재부팅.
  수리: `AuthContext.switchWorkspace` 가 요청 **전에** markSwitching, 실패 시 `clearSwitching`. 검증 crash185 수리 전 7회 중 5회 실패 → 수리 후 5/5 · wssync·scopetabs·admintabs 통과 · 빌드 EXIT 0 · 가드 65/66.
- **검사기 고장 4** — modaltop(지난 세션 임시 폴더 경로가 박힌 스크린샷 → `SHOT_DIR` 있을 때만) · publicpayload(공개 서명 라우트가 10/8 없어져 서명이 안 심어져 «안 나간다» 3검사가 **값이 없어서** 통과 중이었다 → DB 에 직접 심고 «전제» 검사 추가) ·
  admintabs(관리자에도 «확인 필요»가 생겨 글자 판정이 누출로 오인 → 메뉴 키로 판정) · docsheader(전체 검사 중 픽스처 생성 실패 — 단독 통과, 다음엔 이유가 로그에 남게).
- **단독 통과(흔들림)** — mobilechrome 태블릿 «메뉴 재클릭 시 추가 폼 닫힘»: 다음 밤 결과에서 다시 보이면 원인 조사.
- 순찰 2건(앱에서 메일 «새 창으로 크게 보기» 가 새 창 · 메일 상세 다른 스레드 링크 가끔 찾을 수 없음)은 아래 UI/UX 전수 검증 절 «남은 것 ①②» 그대로 — 미착수.
- 운영 피드백: 열린 9건 중 #463·#464 는 dev 에서 고침(답글 초안 docs/feedback-replies-2026-10-08.json — 배포 뒤 발송). 나머지 reviewing 7건은 답글 달린 상태로 새 조치 없음.

### 완료: Fable 대기 fwmuz1uqyy(공휴일 18개국 · Insights 가동률 분모) — Fable FAIL 2회 → 지적대로 수정 (2026-10-08 · [Opus]+Fable 방 de8a1de5) — 운영 미배포
- 판정 원문 `docs/FABLE_GATE_QUEUE.md` 맨 위 절. 두 커밋은 **이미 운영에 있다**(v1.70.1) — 운영 biz1 Insights 가동률이 Cue 때문에 절반으로 나오는 중 → 다음 /배포 때 같이 나가야 한다.
- 수정: CN·TW·VN 선택지 제외(데이터셋 삭제) · 국가 행은 모든 문에서 «오늘 이후만»(`ensureNationalRows` fromDate 필수) · 가동률 분모·팀 표·주간 리뷰에서 AI 멤버 제외 · cron 데이터셋 공백 경고 · 국가 저장 트랜잭션.
- 자체 검증(Fable 미검증 — 이 사안 Fable 2회 상한): 위 절 숫자. 비차단 미반영 3건(2027 관보 대조·weekly_holidays 이중 차감·개요 분자 Cue 담당분).

### 완료: Fable 대기 묶음(10/04~10/07 자체 검증분) 판정 — PASS (2026-10-08 · [Opus]+Fable 방 21f1f11b)
- 상황판 `fwmuz1uqy3` 처리 완료(목록에서 뺌). 판정 원문 `docs/FABLE_GATE_QUEUE.md` 맨 위 절 · 두 표 행 ✅.
- 차단 0. **수정 권고(비차단)**: 행6 일정 알림 — 발송시각 뒤 ≤5분 안에 일정을 고치면 그 회차 알림이 사라진다 → 비교 기준을 «알림 시간을 정한 시각» 으로(다음 작업 후보).
- (상황판 `fwmuz1uqyy` 는 방 de8a1de5 에서 판정·처리)

### 완료: 문서 편집기 찾기·바꾸기 + 기본 서식 버튼 (2026-10-08 · [Opus] 방 cb71ac3c) — 운영 미배포
- 원문: *"문서 수정이 찾기, 문구 교체 등 문서들 기본 기능도 추가해줘."*
- 편집 툴바 끝 돋보기 / ⌘·Ctrl+F → 툴바 아래 찾기 막대(결과 수·이전/다음·대소문자 구분·Esc 닫기). ⌘⇧H(맥)·Ctrl+H 또는 ▸ 로 바꾸기 줄 — [바꾸기] 지금 결과 1곳 · [모두 바꾸기 (N)] 한 번에(실행 취소 한 번으로 통째 복구). 고른 글이 있으면 그것으로 시작. 바꾼 글은 그 자리 서식(굵게·링크)을 이어받는다.
- 툴바에 원래 들어 있던 기능의 버튼을 꺼냄: 밑줄 · 구분선 · 서식 지우기. (PDF·워드 내보내기는 원래 underline·hr 를 그린다)
- 구조: `components/Docs/editorFindReplace.ts`(ProseMirror 꾸밈 — 저장 JSON 에 안 들어감) · `FindReplaceBar.tsx` · PostEditor 툴바+막대를 한 sticky 묶음(Head)으로. 표 폭 맞춤 함수는 `editorTableFit.ts` 로 분리(800줄 가드, 동작 불변).
- 검증(Fable 안 씀 — 편집기 UI, 되돌리기 쉬움·기계로 판정): `--suite docfind` 3폭 13검사 ×3 = 39/39 (5회 중 1회 ⑥ 타이밍 흔들림 → 대기 보강 후 3연속 통과) · tablefit·docsheader 회귀 통과 · 빌드 EXIT 0 · 가드 65/66 통과 · health-check 83/83.
- 범위 밖(다음 후보): 보기 모드 찾기(브라우저 찾기가 이미 됨) · 메모 팝업(compact)도 같은 편집기라 함께 들어감.

### 완료: Q docs «AI로 수정» — 지시 → 전후 보기 → 고른 곳만 반영 (2026-10-08 · [Opus] 방 fb03844c · 커밋 53b28bfe) — 운영 미배포
- 2026-10-11 2차(커밋 fbbdb7e6): «옛 형식» 오류는 **표 문서**에서 났다 → 표 칸(글·숫자·선택)도 AI 수정 · 되돌리기를 «전/후 뒤집어 적용» 으로(버전 복원은 표 값을 못 돌렸다) · 문구 «수정안 만들기/수정안 N곳/문서에 적용/수정 전·후». 화면 28/28. 확인용 문서 #2162(글)·#2160(표, health-check 워크스페이스).
- 2026-10-11 Irene: *"별표 넣고 똑같이 헤더에 버튼이 있어야 하는 거 아니야? AI로 작성할 때처럼 수정도."* → 문을 ⋯ 메뉴에서 **편집 옆 ★ «AI 수정»**(AI 작성과 같은 `AiActionButton`)으로 옮김. 화면 3폭 18/18.
- 원문: *"문서를 ai 사용해서 수정도 하는게 편하면 좋겠어. 예를 들면 소고기 가격 표시된 걸 모두 5링깃으로 바꿔줘 … 전후도 제대로 봐야 하는거"*
- 설계 `docs/DOC_AI_EDIT_DESIGN.md` — **Fable 설계 PASS**(반드시 고칠 것 7 전부 반영). 문서 보기 ⋯ 맨 위 «AI로 수정» → 우측 패널: 지시 → 칸별 전/후 카드(체크) → [선택한 N곳 반영] → 본문 위 «N곳 반영 · 되돌리기».
- 구조: 본문을 번호 붙은 글 칸으로 뽑아 모델(gpt-5.1, purpose `doc_edit`)은 «몇 번 칸을 이렇게» 만 낸다 — 안 고른 칸은 JSON 그대로, 고친 칸도 바뀐 글자만(서식·이미지·줄바꿈 보존). 반영 전/후 버전 따로(`recordRevision noCoalesce`) · 그 사이 수정되면 409 · 사용량 `docs_edit`.
- 자체 검증(Fable 미검증 — 완료 검증은 자체): API 14항목(3곳 찾음·돼지고기 안 건드림·일부 반영·안 고른 칸 동일·버전 2행·되돌리기=원본 동일·409 stale/칸 불일치·400 0건·서명 잠금 409·다른 워크스페이스 403·행 추가 요청 → «못 했어요»·번역) · 화면 390/820/1440 18/18 · 빌드 EXIT 0 · 가드 통과.
- v2 후보: 문단·표 행 추가/삭제 · 편집 모드 초안에 적용 · 카드 누르면 본문 해당 칸 표시 · 옛 HTML 형식 문서(dev 3건)는 «편집에서 한 번 저장» 안내.

### 완료: 플랫폼 관리자 확인 필요·알림 정비 (2026-10-08 · [Opus] 방 282c4c27) — 운영 미배포
- 원문: *"플랫폼관리자에서 입금확인해야 하는거 알림이 안떠. 여기도 할일필요 메뉴랑 알림표시들 다 제대로 구성되면 좋겠는데 메뉴 전체적으로 훑어보고 정리해줘"*
- 원인: ① `services/platformNotify` 가 **메일만** 보냈다(인박스·푸시 «미구현») — 설정 화면은 토글을 보여 줘 받는 것처럼 보였다 ② 관리자 «확인 필요» 없음, 배지는 문의·피드백뿐 ③ 피드백 배지는 응답 모양(`data.pending`)을 `data.counts.pending` 으로 읽어 **늘 0** ④ 알림 링크 `/admin/plans` 는 없는 주소 ⑤ 구독·결제 화면이 `?status=` 를 안 읽어 메일 링크가 «전체» 로 열림
- 한 것: `services/adminTodo.js` + `GET /api/admin/todo`(입금 통보·세금계산서·문의·피드백, 배지 단일 원천) · platformNotify 인박스+푸시(`notify`, skip email · client_crash 는 메일만) · `/admin/inbox` 화면 · 사이드바 7구역 재배치 + 배지(확인 필요·구독·결제) · 결제 이력 «세금계산서 발행 필요» 탭·입금 통보 표시·실패 건 재발행 · 네 화면 URL 필터 · 회귀 `--suite admininbox`
- 운영 실측(읽기): 결제 #21(워크스페이스 16) 2026-10-08 02:01 입금 통보 — 메일만 갔고 아직 pending. 배포되면 확인 필요에 바로 뜬다.
- **Fable 게이트 PASS**(외부 발송=푸시 트리거 확대라 대상): 26/26 실호출 · 에스컬레이션 크론 재발송 0 · 비관리자 누수 0 · 운영 실측 관리자 알림 75건/30일(최다 14/일).
- 다음(비차단): ① 피드백·문의 푸시에 본문 400자가 실려 잠금화면까지 간다 → `notifyPlatformAdmins` 에 `previewPolicy:'excerpt'` 한 줄 ② 배지 소켓 즉시갱신 종류에 trial·system 없음(30초 폴링으로는 맞음)

### 답 기다림 (이전): 플랫폼관리자 «입금…» 지시 원문이 끊김 (2026-10-08 · [Opus] 방 10ba8989) — 방 282c4c27 이 전문을 받아 처리함
- **무엇을:** 지시가 «플랫폼관리자에서 입금욫» 에서 끊겨 무엇을 바꿀지 모른다(관련 화면: `pages/Admin/AdminPaymentsPage.tsx` — 입금 완료 처리·세금계산서·환불)
- **왜 멈췄나:** 결제(돈) 화면이라 추측해서 고치지 않는다
- **답이 오면 할 일:** 원문대로 구현 → 돈 흐름이 바뀌면 Fable 게이트(calc/gate) → dev 검증

### 완료: Fable 기준 공용판 맞추기 (2026-10-08 · [Opus] 방 09074bb8) — 옛 지시 2건 Irene «권고대로» 반영
- **한 것:** CLAUDE.md «Fable 사용» 절(기준 = `~/dev-server/FABLE.md`, PlanQ 예시·장치·Irene 원문 출처만) · AI 협업 표 · `/fable-검증`·`/검증`·`/개발완료` 0-F·`/기능설계` · 훅 안내 문구 · docs/AI_COLLABORATION_PROTOCOL.md · 메모리 6개. FABLE_GATE_QUEUE.md 미판정·재검증 묶음 → 상황판 Fable 대기 `fwmuz1uqy3`(gate)·`fwmuz1uqyy`(calc), 그 파일은 «판정 기록 보관소».
- **무엇을:** ① 08-18 «모든 판단은 Fable» vs 공용 «작은 선택은 작업 모델» ② Fable 대기 중인 변경이 있을 때 Irene 의 /배포 지시를 어떻게 다루나
- **왜 멈췄나:** Irene 원문 지시와 공용 기준이 충돌 — 고치지 않고 묻는다(이 일의 규칙)
- **답(권고대로) 반영:** ① 08-18 «모든 판단은 Fable» → 되돌리기 어려운 선택·판정 조건 변경에만(CLAUDE.md 출처·memory) ② `/배포` 0-B단계 — Irene 직접 지시 = 승인, 배포하고 상황판 Fable 대기(planq) 항목을 보고에 적는다


### 완료: 서명 화면 — 빨간 칸에서 바로 서명 창 (2026-10-08 · [Opus] 방 ab77c16a · 커밋 c4fa04f8)
- 칸·맨 아래 버튼 → 같은 창(문서 확인했나요? → 본인 확인 → 서명). 페이지가 위아래로 안 오간다. dev 빌드 반영, 운영 미배포.
- 검증: signflow·signitems 전부 통과(내 칸 화면 위치 259→259→256→256 · 375/820/1440 서명 제출) · i18n·parity 가드 통과. **Fable PASS**(긴 문서·폰 390·키보드·우리쪽 서명자·slot 없음·확인요청 실측). 비차단: ①본인 확인 전 [거절] 은 서버 400 otp_required 인데 오류가 안 보인다(기존 결함) ②창 안에 [거절] 없음 ③짧은 문서+영어에서 칸 21px 이동 ④signflow 픽스처가 짧아 이동 변별력 약함 ⑤Esc 로 그린 서명 사라짐.

### 완료: #463 AI 로 업무 프로젝트 옮기기 (2026-10-08 · [Opus]+[Fable] 방 dfbe4a9b) — Irene «해»
- `move_task_to_project`(MEDIUM, tasks:write — 재연결 불필요) + 화면 PUT 도 같은 판정(`task_actions.prepareMove/afterMove`). Fable 설계 READY → 검증 PASS(27/27). 기록 docs/FABLE_GATE_QUEUE.md 맨 위
- 화면: 업무 상세 프로젝트 변경이 거절되면(외부 파트너 담당자·닫힌 프로젝트) 원래 값으로 되돌리고 이유를 띄움
- dev 반영(빌드·backend·mcp 재시작) · **운영 미배포** — 배포 때 MCP reload 는 deploy-planq.sh 가 한다. 마이그레이션 없음
- 운영 답글 초안 docs/feedback-replies-2026-10-08.json(#463·#464 done) — 배포 뒤 `node dev-backend/scripts/feedback-reply.js <json> --apply`
- Fable 비차단: PUT 의 회차 동반이 이력 try/catch 안(실패해도 200)

### 답 기다림 (이전): Irene 손 — ChatGPT·Claude 재연결 + 중복 연결 끊기 · 운영 front_v4.jpg 열어 보기

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

## 2026-10-16 [Claude Code] 운영 Q mail 보낸편지함 확인 (할 일 카드 todomv4o8078 → 뺌)
- Irene: «너가 확인하고 넘겨. 나중에 안 되면 운영에서 보고 다시 요청할게.» → 카드 뺌.
- 확인함(PlanQ 연결 도구, 읽기): 운영 ws1 «워프로랩» 개인 계정 #5 irene@irenewp.com — 켜짐 · 07:06Z 동기화(몇 분 전) · 계정 오류 없음. 공용 #3 help@ 도 정상.
- 확인 못 함: 보낸편지함 폴더 줄(email_account_folders) 상태와 가져온 사본 수 — 운영 SSH 읽기·보낸메일 검색 모두 권한 거부. 코드상 건너뛰는 경우는 그 주소가 운영 SMTP_FROM/SMTP_USER 이거나 별칭일 때뿐(dev 는 help@ 가 발송 주소).

### 완료: «확인되지 않은 앱» 경고 원인 설명 (2026-10-16 · [Opus] 방 ec554023)
- 원인: 구글 연결 전부(로그인·팀/개인 캘린더·Drive)가 같은 구글 앱(GOOGLE_CLIENT_ID 하나)을 쓰는데, 그 앱이 민감 권한(calendar.events · calendar.calendarlist.readonly)에 대한 구글 심사를 아직 통과하지 못함. 코드 버그 아님, 코드로 끌 수 없음.
- 조치: Irene 할 일 «구글 콘솔 인증 센터 상태 확인하고 심사 제출하기» 상황판에 올림(todomvbdo20g). 절차·문안·영상 대본 docs/GOOGLE_OAUTH_CALENDARLIST_GUIDE.md.
- 코드 변경 없음.

### ✅ (끝남 2026-10-20) 모바일 메뉴 알림·공지 드롭다운 (방 995e64cb)
- 무엇: Irene «메뉴 닫지 말고 드롭다운이 가장 앞에» 반영 — 미커밋 5파일(dropdownShell MenuPopover z 10070 · Notification/WhatsNewDropdown · GlobalSearchModal · WorkspaceSwitcher 만들기 창 · MainLayout 메뉴 닫기 되돌림). 팀 상태 z 10070 은 c7f066f7 에 이미.
- 조건: 서버 메모리 부족으로 빌드가 계속 중단됨(Claude Code 가 저메모리로 백그라운드 빌드를 멈춤).
- 그때 할 일: `npm run build` → `$CLAUDE_JOB_DIR/tmp/probe.js`(390/360/768 · 메뉴 열린 채 목록이 맨 앞인지) → 5파일만 커밋.
