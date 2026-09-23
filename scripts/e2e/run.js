#!/usr/bin/env node
// scripts/e2e/run.js — 하니스 러너. health-check.js 동급 게이트 (exit 0/1).
//   사용: node scripts/e2e/run.js --suite mobile           # 특정 스위트
//         node scripts/e2e/run.js --suite mobile,crosscut  # 여러 개
//         node scripts/e2e/run.js                          # 전체
//   INSPECTION_PLAYBOOK.md 참조. 신규 스위트는 SUITES 에 등록.
// ★ DB env 를 **러너가** 먼저 싣는다. 안 그러면 DB 를 쓰는 모듈이 나중에 로드되는 순간
//   `dev-backend/config/database.js` 가 스스로 process.exit(1) 한다 — 결과는 "총 실패: 0" 인데
//   **종료코드 1**. 게이트는 종료코드를 보므로 초록 스위트가 빨간불로 읽힌다(2026-09-12 tabletchrome 실측).
//   카나리마다 각자 dotenv 를 부르던 것을 여기 한 곳으로 올린다.
require('/opt/planq/dev-backend/node_modules/dotenv').config({ path: '/opt/planq/dev-backend/.env' });

const SUITES = {
  mobile: () => require('./mobile-keyboard'),
  // 타이핑 **중** 캐럿 가시성 — mobile 스위트는 focus 만 보고 타이핑을 안 해서 이 계열이 통째로 샜다
  caret: () => require('./canary-caret-visible'),
  // 에디터 업로드 주소 — 프론트 문자열과 백엔드 라우트를 컴파일러가 안 이어준다(#378 실측 404)
  editorupload: () => require('./canary-editor-upload'),
  // RichEditor(Q info·Q Task) 이미지 크기 조절 — Q docs 는 imgresize 가 따로 본다(#378 통일)
  richresize: () => require('./canary-richeditor-resize'),
  narrowtext: () => require('./narrow-text-audit'),   // 세로로 쌓인 텍스트 (제목 붕괴)
  crosscut: () => require('./canary-crawl'),   // 표시명(계정명) 누출 카나리 크롤
  l1: () => require('./canary-l1'),             // L1 개인자원 누출 카나리 (백엔드 API 크롤)
  tenant: () => require('./canary-tenant'),     // 멀티테넌트 격리 카나리 (비멤버 biz 403 실증) — **GET 전용**
  // 일괄 **쓰기** 격리 (2026-09-17 Fable 22차 소견). 정적 문자열 검사는 우회된다 —
  //   `resolveBulkTargetIds` 앞에 한 줄 끼우면 카나리는 초록인데 남의 메시지 34→0 이었다.
  //   판정은 응답이 아니라 **DB** 다: 실제 결함이 `updated:0` 이라고 답하면서 데이터를 고쳤다.
  tenantwrite: () => require('./canary-tenant-write'),
  mail: () => require('./canary-mail-triage'),  // 메일 판정 카나리 (실 mailparser 헤더 — 조용히 눈감는 계열)
  // 메일 **검색**이 조용히 누락하지 않는가 (2026-09-15 Irene: "보낸 사람 이름으로 검색해도 안 나와").
  //   흔한 단어가 섞이면 옛 LIMIT 1000(무정렬)이 27% 를 잘라내고 있었다 — 오류 없이.
  mailsearch: () => require('./canary-mail-search'),
  mailrt: () => require('./canary-mail-realtime'), // #205 실시간 반영 — 한 탭에서 내린 행이 다른 탭에서도 사라지는가
  handles: () => require('./canary-panel-handles'), // 패널 토글 화살표 중복 카나리 (접힘 상태에서만 드러남)
  mobilechrome: () => require('./canary-mobilechrome'),  // 폰 상단 크롬 충돌 계열(제목 크기·빈 줄·오버레이·드로어·메뉴 재클릭)
  tabs: () => require('./canary-tabs'),
  tabtitle: () => require('./canary-tab-title'),
  collapsed: () => require('./canary-collapsed'),        // 좌측 메뉴 접힘 × 전 루트 빈 화면
  docscollapse: () => require('./canary-docs-collapse'), // 문서 **편집 중** 리스트 접기 — 보기 모드에서는 재현 안 됨
  gdrivesync: () => require('./canary-gdrive-sync'),    // Drive 역방향 종단 — 실제 Drive 파일을 만들고 고쳐서 본다
 // 탭 이름이 내용으로 유지되는가 — LRU 정지(alive:false)로 pane 이 언마운트돼도 되돌아가면 안 된다
         // ⑥ 멀티탭 트리 스왑(형제 라우터 무크래시·keep-alive·shell 무회귀)
  hlock: () => require('./canary-qtalk-hlock'), // #245 Q Talk 가로 잠금 — overflow-y:auto 만 두면 반대축이 auto 로 강제(grep 불가)
  // 서브헤더가 스크롤 후 **실제로 붙어 있고 안 가려지는가** (2026-09-03 Irene: "스티키 기능 안되고 헤더 아래로 들어간다").
  //   hlock 과 같은 계열의 반대쪽이다 — 저기는 가로가 세로를 잠그는 것을, 여기는 그 결과로 sticky 가
  //   엉뚱한 스크롤러에 묶이는 것을 본다. 둘 다 CSS grep 으로는 안 잡힌다(선언은 정상으로 보인다).
  sticky: () => require('./canary-sticky'),
  // Q docs 머리줄·두 밴드가 스크롤에 **딸려 올라가지 않는가** (2026-09-15 Irene 신고).
  //   ★ 위 sticky 스위트는 **computed position 이 sticky 인 요소만** 훑는다. 이 결함에서는
  //     좌측 머리줄이 애초에 sticky 가 아니고 우측 밴드는 데스크탑에서 static 이라
  //     훑을 대상이 0건 → 아무 말 없이 초록이었다. 그래서 선언이 아니라 **결과(y)** 를 잰다.
  docsheader: () => require('./canary-docs-header'),
  // 같은 결함이 **다른 화면에도** 있는가 — 전 앱 라우트 × 3폭 머리줄 드리프트 (Irene 2026-09-15:
  //   "다른 모든 곳도 체크해"). 화면마다 눈으로 보는 것은 답이 아니다 — 기계가 전수로 센다.
  headerdrift: () => require('./canary-header-drift'),
  bodygutter: () => require('./canary-body-gutter'),
  fab: () => require('./canary-fab-reach'),
  mailfwd: () => require('./canary-mail-forward'),   // 전달 컴포저 — 원문 미리보기가 **실제 높이**를 갖는가
  // 메일 상세에서 **첨부가 본문 바로 아래**인가 (2026-09-18 신고).
  //   DOM 순서가 아니라 **화면 y** 로 잰다 — JSX 순서만 보면 CSS 로 뒤집혀 있어도 초록이다.
  mailattach: () => require('./canary-mail-attach-order'),
  mailimage: () => require('./canary-mail-image'),   // #378 메일 본문 이미지 — 드래그가 무시되는지 눈으로 구별이 안 되는 계열
  dropdowns: () => require('./canary-dropdowns'),   // 알림↔새소식 규격 일치 + 새 탭으로 열기
  imgresize: () => require('./canary-image-resize'),
  mobileboot: () => require('./canary-mobile-boot'), // 콜드스타트 착지 · 재진입 즉시표시 · Cue 키보드 (저장소+뷰포트+키보드가 합쳐진 뒤에만 존재)
  trash: () => require('./canary-file-trash'),
  // 서명란·서명본·우리 측 서명 (2026-09-22). API 가 맞는데 **화면에 안 보이는** 계열이라
  //   rect + elementFromPoint + 실제 테두리 색으로 잰다. 대조군: 동의 전 제출 막힘 · 남의 칸은 강조 아님.
  signature: () => require('./canary-signature-field'),
  // 서명 **전체 여정** — 멤버 서명 → 고객이 링크·인증번호로 서명 → 완료 → 고정본·PDF.
  //   조각별 검사(signature)와 다른 축이다: 끝까지 걸어야 «중간에 막히는» 것이 드러난다.
  signflow: () => require('./canary-signature-flow'),
  // 문서 복사 + 상단 버튼 정리 (2026-09-22). 복사본에 서명·공유 링크가 따라가면 원본인 척하게 된다.
  docsdup: () => require('./canary-docs-duplicate'),
  // 「지금 결제하면 1개월 추가」(2026-09-23) — 선불 2개월. 카드가 보이는가·문구가 서버 개월과 같은가·
  //   모달이 «2개월» 을 말하는가. 자격 없는 계정에서는 **안 보이는 것이 정답**이라 그대로 판정한다.
  prepay: () => require('./canary-prepay-bonus'),
  // 휴가 알림 딥링크(#424) — 서버가 만든 `?leave=<id>` 를 **읽는 곳이 0곳**이었다.
  //   ★ 탭 keep-alive 로 같은 data-row-id 가 둘이 될 수 있어 «보이는 것» 으로 판정한다.
  //   ★ 이미 처리된 신청도 막다른 길이 아닌지 같이 잰다(대기 목록엔 없다).
  leavelink: () => require('./canary-leave-deeplink'),
  // Q sale 우측 패널이 **한 벌인가** — 문의로 열어도 고객 액션이 있는가 · 이름 중복 · 푸터 한 줄 ·
  //   저장 액션이 묻고 나서 나가는가 · **패널이 열려도 뒤 목록이 스크롤되는가**(2026-09-13 계약 변경).
  //   전부 CSS·런타임이 합쳐진 뒤에만 존재하는 종류라 정적 검사로는 안 잡힌다.
  salepanel: () => require('./canary-sale-panel'),
  // 프로젝트 상세 탭 — 순서·노트 탭이 Q Note 본체인가·정보 탭이 Q info 규격인가·고객 프로필 연결.
  //   순서와 색은 **렌더 뒤에만 존재**한다(배열 grep 은 화면 순서를 증명하지 못한다).
  projecttabs: () => require('./canary-project-tabs'),
  // 프로젝트 «자료» 탭(문서·노트·파일)이 **같은 디자인**인가 — 바탕색·여백·시작점 3폭.
  //   2026-09-13 에 「했다」고 적어 두고 화면은 달랐다. 글이 아니라 기계가 센다.
  projtabstyle: () => require('./canary-project-tab-style'),
  consultlinks: () => require('./canary-consult-links'),
  // 알림을 눌러 **그 화면에 닿는가** + 오프라인 폴백에서 서버로 돌아오는가 (앱이 좌초하던 계열)
  pushdeeplink: () => require('./canary-push-deeplink'),
  // 문서 표 [폭 맞춤] — 누른 뒤 오른쪽에 빈 여백이 남지 않는가 · 열이 균등한가.
  //   colgroup·CSS·컨테이너 폭이 합쳐진 뒤에만 존재하는 종류라 정적 검사로는 못 잡는다.
  tablefit: () => require('./canary-table-fit'),
  // 저장된 문서 **보기** 화면의 표 — 테두리가 중간에 끊기지 않는가.
  //   tablefit(편집기)과 **일부러 가른 스위트**다. 한 런에 넣으면 편집 초안 때문에
  //   페이지 이탈이 끝나지 않아 검사가 멈춘다(2026-09-13 실측 17분 행).
  tableview: () => require('./canary-table-view'),
  publiclang: () => require('./canary-public-lang'),
  detailopen: () => require('./canary-detail-open'), // 상세가 실제로 열리는가 — 딥링크 소생 + "없음" 을 말하는가(침묵 금지)   // 파일 휴지통 — 삭제를 되돌릴 수 있는가(백엔드 아닌 **화면**에서)

  aiopen: () => require('./canary-ai-open'),    // AI 진입 모달이 **눌러서 뜨는가** (early return 아래 훅 = React #310, 런타임에만 드러남)
  rowtags: () => require('./canary-row-tags'),  // 행 태그 버튼이 **눌리는가** (존재 검사로는 button-in-button 을 못 잡는다)     // 우하단 도크 FAB 도달성 — 겹침은 두 파일 CSS 가 합쳐진 뒤에만 존재(정적 검사 불가)
  toggles: () => require('./canary-toggles'),  // 자동저장 토글이 **눌러서 저장되는가** — API 직접 호출 테스트는 화면이 그 API 를 안 부르는 것을 못 잡는다
  csp: () => require('./canary-csp'),
  // 상단 크롬 9 뷰포트 — 탭 게이트·두 겹 여부·탭바 오프셋·사이드바 도달성. 세 CSS 파일이
  // 합쳐진 뒤에만 존재하는 종류라 정적 검사로는 안 잡힌다(2026-09-06 태블릿 96px 겹침).
  // 모달이 **어떤 층 안에서도 최상위로 보이는가** — z-index 숫자는 조상이 층을 만들면 무의미하다.
  //   사이드바 안에서 그려진 모달이 우측 상세 패널 뒤로 깔리던 계열(2026-09-07 Irene 신고).
  //   정적 검사(guard --category=modalportal)는 "포털을 쓰는가" 만 본다 — 실제로 보이는지는 여기서.
  modaltop: () => require('./canary-modal-top'),
  // 메일 본문 iframe 이 내용만큼 커지는가 — srcdoc 은 부모 CSP 를 물려받아서
  //   인라인 스크립트가 조용히 죽으면 높이가 추정치에 고정된다(2026-09-07 운영 신고).
  mailframe: () => require('./canary-mail-frame'),
  // 다른 기기에서 바꾼 것이 **보고 있는 화면에 즉시** 오는가 (CLAUDE.md §16).
  //   근태는 되는데 포커스만 소켓 리스너가 없어 30초 폴링에 의존하고 있었다 —
  //   같은 계열에서 한쪽만 빠지면 "어떤 건 되고 어떤 건 안 되는" 것으로 보인다. 둘을 같이 잰다.
  realtime: () => require('./canary-realtime'),
  // 상세 밴드2 — 폰에서 **몇 줄이고 칩이 성한가**. 줄 수만 보면 2026-09-06 의 음절분해 회귀를
  //   다시 부르고, 칩만 보면 "항상 2줄" 로 되돌아간다. 둘을 한 검사에 묶는다.
  mailband: () => require('./canary-detail-band'),
  crash185: () => require('./canary-crash-185'),
  chromeoffset: () => require('./canary-chrome-offset'),
  // 업무 책임선이 **화면에서도** 지켜지는가 — description=작성자만 / body=담당자만.
  //   서버만 막으면 화면은 열려 있고 저장만 403 이 되는 "저장 실패" 가 된다.
  //   임시 platform_admin 계정으로 본다(기본 하니스 계정은 owner 라 옛 백도어를 안 밟아
  //   양성 대조군이 안 뒤집혔다 — 2026-09-07 실측).
  respline: () => require('./canary-responsibility-line'),
  // 확인 필요 ↔ Q Task 배지가 **같은 것을 세는가** (2026-09-07 신고: 3건인데 2건, Q Task 는 배지 자체가 없음).
  //   '보낸 업무요청' 수집기가 아예 없었다. 실호출 + 양성/음성 대조군으로 잰다 —
  //   시드를 넣으면 오르고 지우면 돌아와야 하며, 내가 컨펌자인 업무는 두 번 세면 안 된다.
  inboxcount: () => require('./canary-inbox-count'),
  // "업무 추가" 가 **어디서 열어도 같은가** (2026-09-12 Irene: "업무추가 팝업이 왜 새거야?").
  //   존재 검사로는 안 잡힌다 — 세 벌이 다 있었고 내용이 달랐다. 필드 집합을 **서로** 비교한다.
  taskaddparity: () => require('./canary-task-add-parity'),
  // 파일을 폴더로 끌어다 놓기 — 서버 이동 API 는 있었는데 화면에 드롭 존이 없었다.
  //   ★ 전용 MIME 으로만 받는지도 같이 잰다(text/plain 으로 받으면 아무 텍스트나 이동이 된다).
  folderdnd: () => require('./canary-folder-dnd'),
  // 끌어서 여러 개 고르기 + 선택한 것 통째로 폴더 이동 (2026-09-20).
  //   ★ folderdnd 와 다른 축이다 — 그쪽은 «한 건을 끌어 옮기는가», 여기는 «여러 건을 고르고
  //     그 전부가 옮겨지는가». 선택모드가 드래그를 꺼 버리던 결함이 여기서 잡힌다.
  filemarquee: () => require('./canary-file-marquee'),
  filepreview: () => require('./canary-file-preview'),
  // 좌측 트리 — 프로젝트가 **한 줄**인가(폴더 섹션에 같은 이름이 또 나오지 않는가) ·
  //   캐럿으로 하위 폴더가 열리는가 · 그 클릭이 파일 목록을 바꾸지 않는가.
  filetree: () => require('./canary-file-tree'),
  // 컨펌 요청이 **요청자에게도** 닿는가. 여태 컨펌자에게만 갔다 —
  //   요청자는 자기가 시킨 일이 결과물까지 온 것을 모르고 지나갔다.
  //   요청자==컨펌자일 때 두 번 울리지 않는 것까지 같이 잰다.
  reviewnotify: () => require('./canary-review-notify'),
  // 결과물을 **댓글이 아니라 회차로** 남길 수 있는가. 여태 버전이 생기는 문이
  //   "확인 요청" 하나뿐이라 중간 결과가 댓글로 갔다. 버튼 가시성 + 실제 박제 + 입력란 비움까지 잰다.
  delivver: () => require('./canary-deliverable-version'),
  chatattach: () => require('./canary-chat-attach-download'),
  chatpreview: () => require('./canary-chat-preview'),   // 채팅 첨부 미리보기 — 받는 쪽(소켓)까지 잰다
  salecriteria: () => require('./canary-sale-criteria'), // Q sale 상담 유입 기준 + 사람이 올리는 문
  maillabel: () => require('./canary-maillabel'),        // 메일 팔로우 폴더 범위 + 목록 문구 충돌(상태 vs 행위)
  // Drive 미러 생명주기 전 전이 — [파인더 공유]가 그 폴더를 «남에게 열리는 면» 으로 바꿨다.
  //   경로를 하나씩 고치다 게이트에서 여섯 번 막혔다(2026-09-17). 경로가 아니라 **표**로 건다.
  drivemirror: () => require('./canary-drive-mirror'),
  filesrc: () => require('./canary-file-source-tags'),
  fileindex: () => require('./canary-file-index'),
  crashreport: () => require('./canary-crash-report'),
  officetext: () => require('./canary-office-text'),
  qnotecue: () => require('./canary-qnote-cue'),
  reviewentry: () => require('./canary-review-entry'),
  mailbrief: () => require('./canary-mail-brief'),
  mailplain: () => require('./canary-mail-plaintext'),
  seriesscope: () => require('./canary-series-scope'),
  admincrawl: () => require('./canary-admin-crawl'),
  // 개발 현황이 **내용을 보여주는가** (2026-09-18 신고: "다 비어서 나와").
  //   JSON 의 모양과 화면이 읽는 필드가 **합쳐진 뒤에만** 존재하는 결함이라 정적 검사로 안 잡힌다.
  //   '—' 가 아니라 심은 문장이 실제로 보이는지로 판정한다(발행 검증 양성/음성 대조군 포함).
  devstatus: () => require('./canary-dev-status'),
  // rawkey — 번역 키가 화면에 그대로 나오는가. 정적 가드는 `t(\`status.${x}\`)` 같은 **동적 키**를
  //   구조적으로 못 본다(뒤가 런타임 값이라 대조할 대상이 없다). 판정을 화면으로 옮긴다.
  //   ★ 반증 완료(2026-09-07): 소스 로케일에서 status.* 를 지우고 **재빌드**하면 폰·데스크탑
  //     두 뷰포트 모두 `status.active` 를 잡는다. 앞서 안 뒤집힌 것은 빌드 산출물만 고치고
  //     재빌드를 안 해서였다 — 대조군은 **소스에서** 만들어야 한다.
  rawkey: () => require('./canary-rawkey'),
  // 상단 탭이 **지금 있는 자리**의 것만인가 — 워크스페이스·플랫폼 관리자 전환(2026-09-08 신고).
  //   저장 키가 갈려 있어도 **키 안의 내용**이 섞이던 계열이라 키 존재 검사로는 안 잡힌다.
  scopetabs: () => require('./canary-scope-tabs'),
  // 관리자 **탭**이 제 이름을 갖고 제 범위에 머무는가 (2026-09-10 신고).
  //   scopetabs 는 이 신고를 구조적으로 못 잡는다 — snap() 이 탭의 path 만 담고 **title 을 버리며**,
  //   탭을 여는 문(`+`)을 한 번도 안 누른다. 여기서 제목과 그 문을 잰다(양성 대조군 포함).
  admintabs: () => require('./canary-admin-tabs'),
  // 지운 Q info 항목을 **화면에서** 되돌릴 수 있는가 (운영 #408).
  //   값은 원래 지워지지 않고 있었다(머지 저장) — 없던 것은 그 값을 꺼낼 화면이다.
  //   그래서 라우트가 아니라 박스가 실제로 보이는지·버튼이 눌리는지를 본다. 음성 대조군 포함.
  qinfoundo: () => require('./canary-qinfo-undo'),
  // 무인증 공개 응답이 화면이 안 쓰는 것까지 싣고 있지 않은가 (2026-09-09).
  //   렌더가 아니라 **응답 raw** 를 스캔한다 — 보이지 않는 것과 나가지 않는 것은 다르다.
  publicpayload: () => require('./canary-public-payload'),
  // 한글 IME 조합 — 자모가 분리되던 운영 #299·#389 계열.
  //   ★ 파일은 2026-08 부터 있었는데 **여기 등록이 빠져 한 번도 안 돌았다**(2026-09-09 발견).
  //     게다가 반환이 배열이 아니라 러너 계약도 안 맞았고, 안 보이는 입력창을 클릭해 죽고 있었다.
  //     셋 다 고쳤다 — 가드는 있는데 부르는 곳이 없으면 없는 가드다.
  hangulime: () => require('./canary-hangul-ime'),
  // 남의 워크스페이스 탭이 떠오르지 않는가 (운영 신고 2026-09-09).
  //   경로만 보는 청소로는 /docs?post=12 가 어느 워크스페이스 것인지 알 수 없다 — 도장으로 본다.
  tabforeign: () => require('./canary-tab-foreign'),
  // 채팅방을 열면 마지막 메시지가 **눈에 보이는가** (2026-09-10 신고: "이상한 위치로 데려가").
  //   바닥 고정 판정이 시간창·증감방향 같은 추정이라 조건이 어긋나면 조용히 풀렸다.
  //   스크롤 호출 여부가 아니라 좌표·가시성으로 재고, 위로 올린 뒤에는 안 끌어내리는지도 본다.
  chatbottom: () => require('./canary-chat-bottom'),
  // 쓰다 만 글이 남는가 · 남의 글과 섞이지 않는가 (DRAFT_PERSISTENCE_DESIGN D-C6). 창 두 개·같은 문서 두 탭·
  //   로그아웃·사칭·옛 키 이관을 실브라우저로 — 인스턴스끼리 덮어쓰는 유실은 한 창 검사로는 안 드러난다.
  drafts: () => require('./canary-drafts'),
  // 입력하고 debounce 안에 떠나도(화면 이동·✕·새로고침·로그아웃) 저장이 나가는가 (D-C3 라운드 1B).
  //   "떠나기 전 0건 + 떠난 뒤 1건" 을 같이 잰다 — 늦게 터진 debounce 와 떠날 때 보낸 것을 가른다.
  leavesave: () => require('./canary-leave-save'),
  wssync: () => require('./canary-workspace-sync'),   // 워크스페이스 전환이 모든 창·팝아웃에 전해지는가 (WORKSPACE_SCOPE_DESIGN C4)
  // Q sale 2차 신고 15건의 화면 계약 — 필터줄·헤더 배치·행 액션·메모판. 폰·태블릿·데스크탑 3폭.
  //   ★ 폭을 하나만 재면 거짓 통과한다(2026-09-14 프로젝트 탭 실측: 데스크탑만 0, 태블릿 20, 폰 398).
  salelayout: () => require('./canary-sale-layout'),
  headerrow: () => require('./canary-header-row'),   // 머리줄 컨트롤 높이 한 값 — CSS 합성 뒤에만 존재하는 값이라 정적 검사 불가
  tabletchrome: () => require('./canary-tablet-chrome'),  // CSP 가 앱을 깨뜨리지 않는가 — 정책은 브라우저가 집행해야만 드러난다(정적 검사 불가)
  // chrome: () => require('./chrome-suppression'),
};

// ★ **«못 쟀다» 를 «통과» 로 세지 않는다** (2026-09-17, Fable 12·13차 지적).
//   카나리가 `push(name, true, '미측정')` 으로 넘기면 `leaked:false` 라 여기서 통과로 세어졌다.
//   실제로 셀렉터 두 개를 깨뜨리자 **12검사 → 9검사, 전부 ✅, «총 실패 0»** 이 나왔다 —
//   검사가 조용히 사라지는데 초록이다. 픽스처는 우리 통제 안이므로 «못 쟀다» 는 곧 «검사가 깨졌다» 다.
//   → 행에 `unmeasured: true` 를 달면 ⚪ 로 표시하고 **게이트 실패로 센다**(fail-closed).
//   데이터가 정말 비어도 되는 검사만 `optional: true` 를 **명시**했을 때 예외로 둔다.
function printSuite(name, results) {
  let fail = 0, fatal = 0, unmeasured = 0;
  console.log(`\n=== ${name} ===`);
  for (const r of results) {
    const unm = (r.unmeasured && !r.optional) ? 1 : 0;
    const bad = (r.fail || 0) + (r.blank ? 1 : 0) + (r.leaked ? 1 : 0) + (r.overblock ? 1 : 0) + (r.error ? 1 : 0) + unm;
    const status = (r.fatal > 0) ? '🔥'
      : (r.unmeasured ? '⚪'
        : (bad > 0 ? '❌' : (r.inputs === 0 && !r.hasCanary && r.route === undefined ? '⚪' : '✅')));
    const metric = (r.path !== undefined)
      ? `(${r.path}) — 입력 ${r.inputs} · 통과 ${r.pass} · 실패 ${r.fail}${r.blank ? ' · 흰화면' : ''}${r.fatal ? ' · FATAL ' + r.fatal : ''}`
      : (r.route !== undefined ? (r.detail || (r.leaked ? '— 누출' : '')) : '');
    console.log(`${status} ${r.name || r.route} ${metric}`);
    (r.details || []).forEach((d) => console.log('     └ ' + d));
    if (r.snippet && r.leaked) console.log('     └ ' + r.snippet);
    fail += bad; fatal += (r.fatal || 0); unmeasured += (r.unmeasured ? 1 : 0);
  }
  if (unmeasured) console.log(`  ⚪ 미측정 ${unmeasured}건 — 통과로 세지 않는다(검사가 깨졌을 수 있다)`);
  return fail + fatal;  // FATAL(하니스 환경 오염)도 게이트 실패로 취급 — 판정 자체를 신뢰 못 함
}

async function main() {
  const arg = (process.argv.find((s) => s.startsWith('--suite=')) || '').split('=')[1]
    || (process.argv.includes('--suite') ? process.argv[process.argv.indexOf('--suite') + 1] : '')
    || 'all';
  const want = arg === 'all' ? Object.keys(SUITES) : arg.split(',').map((s) => s.trim());
  let totalFail = 0;
  for (const key of want) {
    const load = SUITES[key];
    if (!load) { console.log(`⚠️ 알 수 없는 스위트: ${key} (가능: ${Object.keys(SUITES).join(', ')})`); continue; }
    const suite = load();
    const results = await suite.run();
    totalFail += printSuite(suite.name || key, results);
  }
  console.log(`\n━━━ 총 실패: ${totalFail} ━━━`);
  // ★ DB 풀은 **여기서 한 번만** 닫는다. 카나리가 각자 닫으면 뒤 스위트가
  //   "connection manager was closed" 로 죽는다(2026-09-07 실측). 안 닫으면 프로세스가 안 끝난다.
  try { require('/opt/planq/dev-backend/config/database').sequelize.close(); } catch { /* 안 쓴 실행 */ }
  process.exit(totalFail > 0 ? 1 : 0);
}

main().catch((e) => { console.error('FATAL', e.message); process.exit(2); });
