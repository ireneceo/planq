# PlanQ 제품 종합 감사 — 통합 보고 (2026-10-07 · Fable 종합 검토)

> 입력: 영역별 감사 6편(`docs/audit-2026-10-07/{work,comms,content,revenue,ai,shell}.md`).
> 이 문서는 ①그 보고서들이 찾은 결함을 코드·dev DB 로 **다시 확인**하고 ②영역을 가로지르는 공통 원인을 뽑아
> ③하나의 순서로 된 로드맵과 Irene 가 정할 목록을 적는다. 저장소·DB 는 바꾸지 않았다(dev SELECT·코드 읽기만, 운영 미접속).
> 쉬운 말로 적었다. 코드 위치(`파일:줄`)는 개발자가 바로 찾아가도록 괄호 안에만 둔다.

## 10줄 요약

1. **재검증 28건 중 25건 CONFIRMED · 2건 PARTIAL · 1건 FALSE.** 영역 보고서의 사실 판정은 믿어도 된다.
2. **돈이 새거나 막히는 결함이 6건**이고 전부 지금 운영에서 돌고 있다 — 결제 링크 30일 뒤 소실(dev 4건 실측) · 잠긴 워크스페이스가 송금해도 복구 500(dev 고아 결제 18건) · 다운그레이드 예약이 영영 미적용 · 애드온이 첫 달만 과금 · 외화 금액 정수 절단 · 청구서 번호가 회사 간에 섞임(dev 3개 회사 번호 교차 실측).
3. **남의 자료가 보이는 결함이 7건** — 서명 링크(토큰)가 멤버 전원에게 내려감 · 영업 단계 바꿀 때 고객 행 전체(초대 열쇠 포함)를 방송 · 서명/지식/폴더 라우트가 «멤버면 통과» 라 남의 비공개 문서까지 닿음 · 청구서에 남의 회사 고객을 붙일 수 있음 · 위키 공개 이미지가 번호 앞자리만 맞으면 열림(잠재) · 상담 메모가 남의 개인 메일 스레드에 닿음.
4. **«관리자(admin)» 역할이 화면과 서버에서 서로 다르게 정의돼** 채팅 보관은 눌러도 403, 설정은 서버가 허락하는데 화면이 읽기전용 — 그리고 멤버 메뉴 «숨김» 은 서버만 알고 사이드바는 그대로 보여 준다.
5. **초대 경로가 4곳에서 끊긴다** — 초대 링크로 구글 가입하면 초대가 버려지고 새 워크스페이스가 생기며, 기존 계정이 초대를 수락해도 옛 워크스페이스에 떨어진다.
6. 공통 원인은 다섯 가지다: **서버는 있는데 화면이 없다**(영역마다 1~5개) · **같은 판정이 두세 벌**(관리자·메뉴 권한·한도표·매출 공식·보관 일수) · **밖으로 나가는 것에 확인·가림이 빠짐**(발송 확인창·방송 행 전체·토큰 응답) · **ko/en 양쪽 다 없는 문구 ~60개**(가드는 있으나 기준선에 묻힘) · **협업 층(댓글·멘션·답글·음소거) 부재**.
7. 자동으로 만들어지지만 아무도 쓰지 않는 것이 많다 — 보고서 자동 확정 682건 중 사람 확정 0 · 지식 카드 0 · 설문 0 · 예약 0 · 창구 링크 0 · 태그 0 · 이모지 반응 0. **운영 수치로 재확인한 뒤 접을지 결정**이 필요하다.
8. 전체 UX 점수 **6.0 / 10**. 기능 폭은 동급 SaaS 를 넘지만, «다음에 뭘 누르면 되는지» 가 첫 화면에 없고(업무 드로어·프로젝트 상세·확인필요) 메뉴 20개·설정 21곳이 인지 부담을 만든다.
9. 로드맵은 0단계(지금 고칠 결함 10묶음) → 1단계(사용자 체감 P0 15건) → 2단계(P1 30여 건) → 3단계(대형·전략 12건). 0단계는 묶음 단위로 Fable 게이트(R=1) 7묶음·자체 검증 3묶음이다.
10. **Irene 가 정할 것 14건**을 맨 끝에 모았다 — 휴지통 보관 일수를 어느 쪽으로 맞출지, 외화 청구를 당장 숨길지, 보고서 자동 확정을 끌지, 채팅 메일 알림을 묶을지, 안 쓰는 기능을 접을지 등.

---

## A. 버그 재검증 (코드·dev DB 로 직접 다시 확인)

판정: **CONFIRMED** = 코드/DB 에서 그대로 확인 · **PARTIAL** = 일부만 맞거나 완화 요인 있음 · **FALSE** = 보고와 다름.
R=1 = 되돌릴 수 없는 종류(돈·격리·비가역 삭제·외부 발송·무인증 표면) → 수정은 Fable 게이트.

| # | 항목 (출처) | 판정 | 심각도 | 다시 확인한 근거 |
|---|---|:-:|:-:|---|
| 1 | 서명 링크(토큰·`sign_url`) 가 멤버 전원에게 내려가고 화면이 «URL 복사» 로 노출 (content 5-1) | **CONFIRMED** | 높음 R=1 | 직렬화가 `token`·`sign_url` 을 그대로 싣는다(`routes/signatures.js:669-670`), 목록 라우트는 «멤버면 통과»(`:298`), 화면 복사 버튼(`SignatureProgressSection.tsx:122,307`). **확인(confirm) 에 OTP 가 없는 것은 Fable 판정으로 의도된 것**(`signature_confirm.js:20-25` — «신원은 사람별 토큰이 담보한다»). 즉 토큰이 안 새야 성립하는 설계인데 토큰이 새고 있다 — 전제가 깨졌다 |
| 2 | 서명 멤버 라우트(목록·생성·취소·리마인드)가 문서 읽기 권한을 안 봄 (content 5-2) | **CONFIRMED** | 중 R=1 | 생성 `:111-116`, 목록 `:298`, 취소 `:350`, 리마인드 `:370` 모두 `assertMember` 만. `canReadPost` 호출 0 |
| 3 | 청구서 결제 링크가 30일 뒤 조용히 죽음 (revenue 5-1) | **CONFIRMED** | **높음 R=1** | 일일 정리가 상태를 안 보고 `updated_at` 30일 기준으로 토큰을 지운다(`services/shareTokenCleanup.js:25,34-43`); 발송 라우트 주석은 «기본 무제한»(`routes/invoices.js:1389`). **dev 실측: 보낸 상태 2건(id 37·52)·연체 2건(79·572) 토큰 NULL** = 고객이 가진 링크 404. 운영도 같은 cron |
| 4 | 외화 금액 정수 절단 (revenue 5-2) | **CONFIRMED** | 높음 R=1 | 모델뿐 아니라 **실제 DB 컬럼**이 `decimal(12,0)` — invoices.total_amount·tax_amount·grand_total, invoice_items.unit_price·amount. 같은 표의 subtotal·paid_amount 는 (14,2) 로 혼재. USD 99.99 → 100 |
| 5 | 청구서 번호 전역 채번 (revenue 5-3) | **CONFIRMED** | 높음 R=1 | 번호 생성이 회사(business_id) 조건 없이 전체를 훑는다(`invoices.js:107-120`, `recurring_invoice.js:22-34` 동일). **dev 실측: 회사 5 가 0005~0044, 회사 105 가 0034~0042, 회사 122 가 0032~0033** — 번호가 섞여 있다 |
| 6 | 영업 단계 변경 방송이 고객 행 전체(초대 열쇠 포함) 를 뿌림 (revenue 5-4) | **CONFIRMED** | 높음 R=1 | `salesStage.js:76` 이 `client.toJSON()` 통째로 emit. Client 모델에 가리는 toJSON 없음, 전역 toJSON 은 시각 이름만 바꾼다(`models/index.js:171`), `stripClientSecrets` 는 `routes/clients.js` 응답에만 |
| 7 | 위키 공개 이미지가 번호 앞자리 일치로 열림 (content 5-5) | **CONFIRMED (잠재)** | 중 R=1 | `%"file_id":12%` 가 `"file_id":123` 에도 맞는다(`routes/wiki.js:236-240`). dev 위키 본문엔 file_id 가 0건이라 지금은 발현 안 함 — 글에 이미지가 들어가는 순간 열린다 |
| 8 | 휴지통 «90/365일» 표시인데 30일에 바이트 삭제 (content 5-18) | **CONFIRMED** | 중→**높음(비가역)** | cron 은 `RETENTION_PURGE_APPLY=1` 이 없으면 30일 고정(`services/uploadCleanup.js:22-30`), dev `.env` 에 그 키 없음. 화면은 플랜 일수를 받아 그린다(`routes/file_trash.js:47-72` → plans.js 7/14/30/90/365). pro·enterprise 는 **약속보다 일찍 영구 삭제**. 운영 `.env` 는 확인 못 함(접속 금지) — **운영 확인 필수** |
| 9 | 폴더 «같이 삭제» 가 파일 삭제 권한을 우회 (content 5-16·17) | **CONFIRMED** | 중 | 폴더 삭제는 «아무 멤버»(`file_folders.js:17-21`, 해제된 멤버 `removed_at` 도 안 봄) 인데 안의 파일을 전부 휴지통행(`:291-293`); 파일 단건은 본인·오너·PM 만(`files.js:953-968`). 복구는 가능하다 |
| 10 | 초대 링크로 구글/애플 가입 → 초대 유실 (shell) | **CONFIRMED** | 높음 | OAuth 라우트에 초대·redirect 전달 0, 성공 착지는 무조건 `/inbox`(`oauth/core.js:160`), 신규면 새 워크스페이스 생성(`:95-146`) |
| 11 | 기존 계정이 멤버 초대 수락 → 옛 워크스페이스 착지 (shell) | **CONFIRMED** | 높음 | `routes/invites.js` 에 `active_business_id` 갱신 0건; 화면은 `refreshUser()` 후 `/dashboard` 로 가므로 옛 워크스페이스가 뜬다(`InvitePage.tsx:59-60`) |
| 12 | admin 역할 — 채팅 보관·핀·삭제·내보내기 403 (comms A·B) | **CONFIRMED** | 높음 | 서버 `isAdmin`·보관·핀·삭제·내보내기가 전부 **오너만**(`conversations.js:17-18,541,958,979,1329`), 화면은 admin 에게 버튼을 보여 준다(`QTalkPage.tsx:329-332`) |
| 13 | admin 역할 — 설정·권한 매트릭스 편집 불가 (shell) | **CONFIRMED** | 높음 | 화면 `isAdmin = owner ∥ platform_admin`(`WorkspaceSettingsPage.tsx:514`, 권한 화면 `:1339`), 서버는 owner/admin 허용(`businesses.js:1039-1047`) |
| 14 | 멤버 메뉴 «숨김» 이 사이드바에 반영 안 됨 (shell) | **CONFIRMED** | 높음 | `MainLayout.tsx` 에 메뉴 권한 읽는 코드 0(역할 `hasBiz` 58곳뿐). 서버만 403 |
| 15 | 확인필요 «요청 확인» 버킷이 컨펌 중 업무까지 집음 (work 5-1) | **CONFIRMED** | 중 | 상태 제외가 완료·취소·보류 셋뿐(`dashboard.js:113-121`). **dev 실측 3건**(id 785·695·363, 전부 reviewing) 에 «요청을 확인하세요» 가 뜬다. 수정요청·승인완료 상태면 revise/finish 와 **같은 업무가 두 항목**(중복 제거 Set 은 컨펌자 축에만 `:160`) |
| 16 | 잠긴 워크스페이스가 송금해도 복구 안 됨 (revenue 5-13) | **CONFIRMED** | **높음 R=1** | 잠글 때 구독만 canceled 로 바꾸고 결제는 pending 으로 남긴다(`trial.js:172-181`) → `/status` 가 그 결제를 내려주고(`routes/plan.js:115`) → 결제창은 기존 결제가 있으면 새로 안 만든다(`CheckoutModal.tsx:86-89`) → 관리자 [입금 확인] 이 `subscription_superseded` 를 던져 500(`billing.js:296-298`, `admin_billing.js:173-182` next(err)). **dev 고아 pending 18건 실측** |
| 17 | 다운그레이드 예약 미적용 (revenue 5-14) | **CONFIRMED** | 높음 R=1 | `scheduled_plan` 을 읽어 적용하는 코드 0 — 쓰기·null 화(`billing.js:373,449`)·관리자 표시만. 갱신 금액은 `sub.price` 옛값(`:534-536`) |
| 18 | 애드온 영구 무료 (revenue 5-15) | **CONFIRMED** | 높음 R=1 | 갱신 청구가 `sub.price` 또는 플랜표만 본다(`billing.js:534-536`) — 애드온 수량 미합산 |
| 19 | 설정>Cue 한도표가 실제 게이트와 다른 표 (ai 5-1) | **CONFIRMED** | 상 | `routes/businesses.js:41-46,1243`(free 500/pro 25,000) vs `config/plans.js:28/61/97/129`(30/50/1,500/7,500) |
| 20 | Cue 가 업무 결과물(body) 을 덮어쓰고 이전 본을 안 남김 (ai 5-2) | **PARTIAL** | 중 | 덮어쓰기는 사실(`cue_task_executor.js:274-282`). 그러나 검토 제출 함수가 **새 본**을 결과물 버전으로 박는다(`taskTransition.js:131,57-81` → TaskDeliverableVersion). 사람이 전에 제출한 적이 있으면 그 본은 버전에 남고, 처음이면 소실. **«이전으로 되돌리기» 버튼은 없음**(복원 라우트는 있음 `task_actions.js:1276`) |
| 21 | 청구서 생성/수정이 고객·프로젝트의 회사 소속을 안 봄 (revenue 5-6) | **CONFIRMED** | 중 R=1 | 출처 문서만 회사 검증(`invoices.js:861`), `client_id`·`project_id` 는 그대로 저장(`:903-904,919`) |
| 22 | 고객 메뉴 권한이 서버에서 강제되지 않음 (revenue 5-5) | **CONFIRMED** | 중 | `routes/clients.js` 12개 라우트에 `requireMenu` 0건(키는 `menu_permission.js:34` 에 있다) |
| 23 | 지식(KB) 보안등급 변경·공유 해제가 «멤버면 통과» (content 5-4) | **CONFIRMED** | 중 R=1 | `routes/kb.js:1463-1491` `isMemberOrAbove` 만 |
| 24 | 옛 Document 공개 서명에 OTP·레이트리밋 없음 (content 5-3) | **CONFIRMED** | 중 R=1 | `routes/docs.js:888-900` 토큰만으로 서명 저장 |
| 25 | 휴가·설문 알림을 끌 수 없음 (comms D) | **CONFIRMED** | 중 | 라우트 목록(`notifications.js:12-35`)에 `leave`·`survey` 없음, 모델 ENUM 에는 있음(`NotificationPref.js:42,46`), 발송은 함 |
| 26 | 채팅 메시지마다 메일 즉시 발송 (comms E) | **CONFIRMED** | 중 | `projects.js:1396-1409` `notifyMany` 에 메일 제외 없음 — 기본이 메일까지 (CLAUDE.md 가 이미 적은 함정) |
| 27 | Q Note 목록 첫 20건 고정 (content 5-8) | **CONFIRMED** | 중 | `QNotePage.tsx:690` `listSessions(biz, 1, 20)` |
| 28 | ko/en 양쪽 다 없는 문구 키 (comms H · shell E13 · revenue 5-8 · content Q file) | **CONFIRMED / 일부 FALSE** | 중 | 직접 조회: `qmail compose.new/to`, `actions.follow`, `auth verify`, `auth register.terms`, `qfile tabs`, `qsale inquiry.name`, `common toaster.clearAll`, `layout notifications.filterAll` — **전부 양쪽 없음**. `common adminUsers` 는 **있다**(shell 보고 일부 FALSE). ★ «패리티 가드가 못 잡는 유형» 은 부정확 — `guard-invariants.js:345` 에 «양쪽 다 없는 t() 키 래칫» 이 이미 있다. 기준선에 묻힌 **동결 부채**다 → 기준선을 0 으로 조이면 된다 |
| 29 | Q Project 빈 상태가 Q talk 로 보냄 (work 5-3·shell) | **CONFIRMED** | 하 | `QProjectPage.tsx:441` `navigate('/talk')` |
| 30 | `Ctrl+\` 가 전역검색·우측패널 동시 발화 (shell) | **CONFIRMED** | 하 | `MainLayout.tsx:1002` 와 `QTalkPage.tsx:457-458`·`MailPage.tsx:466` 둘 다 Ctrl+\ 를 받는다 |

재검증하지 않은 중·하 항목(영역 보고서의 코드 근거가 충분하고 R=0): 전송 실패 입력 소실, 알림 100건 상한, 메시지 전송 경로 두 벌, 상담 «불발» 400, 다음 연락 미표시, 보고서 자동 확정, 체험 중 결제 시 잔여일 소멸, 영수증 PDF 공급자 정보, 한국어 하드코딩(청구 발행 섹션·서버 reason 문자열) 등 — 로드맵에는 넣었다.

---

## B. 영역을 가로지르는 공통 주제 — 그리고 «구조로 고치는 법»

### B-1. 서버는 있는데 화면이 없다 (6영역 전부)
**무엇** — 지식 뜻검색(`POST kb/search` 화면 호출 0) · 문서 공유 비밀번호/만료(서버만) · 문서 버전 미리보기(서버만) · 채팅 답글(컬럼·서버·서비스 인자까지 있고 UI 0) · 메일 CC/BCC(서버 받음·칸 없음) · 메일 «담당» 폴더(서버만) · 메일 과거 백필 버튼 0 · 메일 검색 필터(날짜·첨부·보낸사람 서버만) · Pinned FAQ(화면 0) · 재색인 버튼 0 · Q Note 공유 만료(컬럼만) · Cue 방 단위 끄기 라우트(화면 0) · 결과물 버전 복원(UI 미확인) · 죽은 라우트 영역당 5~11개.
**왜 생기나** — «백엔드 완료» 를 완료로 세고, 호출처 없는 라우트를 세는 기계가 없다(`duproute` 는 중복만 본다).
**구조** —
- 가드 `--category=deadroute`: 라우트 파일의 `method+path` 를 FE(`services/*.ts`)·mcp·scripts·services 전수에서 대조해 **호출처 0 라우트를 래칫**으로 센다(지금 수치가 기준선, 늘면 실패). 한 라운드로 죽은 라우트를 지우거나 화면을 붙인다.
- 완료 정의에 «화면에서 눌러 결과를 본다» 를 넣는다(이미 CLAUDE.md 검증 절에 있으나 «서버만» 으로 끝난 전례가 많다 — memory `feedback_backend_done_ui_missing`).

### B-2. 같은 판정이 두세 벌 — 권한
**무엇** — «관리자(admin)» 가 채팅에선 오너만(서버), 설정에선 오너∥플랫폼관리자(화면), 권한 라우트에선 오너/관리자(서버) · 멤버 메뉴 권한은 서버 94곳 `requireMenu` 인데 화면은 역할만 · 고객 라우트는 `requireMenu` 0 · 서명·지식·폴더 «항목» 라우트가 «멤버면 통과».
**구조** —
- 서버 `services/workspaceRole.js isWorkspaceAdmin(req)` **한 함수**(owner ∥ admin ∥ platform_admin) — `req.businessRole === 'owner'` 단독 비교를 가드로 막는다(`--category=adminpredicate`, 지금 conversations.js 5곳·businesses.js 1곳이 양성 대조군).
- 화면 `hasBiz('owner','admin')` 한 함수로 통일(`WorkspaceSettingsPage.tsx:514` 가 첫 대상).
- 부팅 때 `GET /me/menu-levels` 한 번 → `visibleNavMenus({scope, levels})` 가 사이드바·전역검색·탭 `+` 를 **같이** 그린다(지금 사이드바만 수기 JSX).
- 가드 `--category=itemauth`: `/:id` 를 받는 라우트에서 `assertMember`·`isMemberOrAbove` 단독이면 실패(래칫). 항목 라우트는 항목 술어(`canReadPost`·`canAccessKbDocumentByLevel`·`canMutateFile`) 를 쓴다 — 2026-09-27 «공유·참조 다섯 규칙» 의 ①을 서명·지식·폴더에 확장.

### B-3. 밖으로 나가는 것에 확인·가림이 빠진다
**무엇** — 발송 확인창에 받는 주소 없음(청구서 드로어·모달·독촉·재발송 4곳, 멤버/프로젝트 초대) · 방송이 행 전체(영업 단계) · 응답에 토큰(서명 목록·공개 청구서 응답의 출처 문서 토큰·결제 목록 `toJSON()`) · 채팅 1건 = 메일 1통.
**구조** —
- `health-check --category=secrets` 에 `sign_url`·`"token":`·`invite_token` 을 **소켓 payload 와 서명 목록 응답**에서도 잰다(지금은 고객 목록만).
- 방송 헬퍼 한 벌: `broadcastSignal(io, room, event, {id, business_id, ...})` — `emit(` 에 `toJSON()` 이 들어가면 가드 실패(정규식 한 줄).
- 가드 `--category=sendconfirm`: 발송 API(`/send`, `/remind`, `/resend-invite`, `/invite`) 를 부르는 컴포넌트에 `ConfirmDialog` + 주소 보간이 없으면 래칫 실패. 지금 4+2곳이 양성 대조군.
- 메일 채널은 `notify()` 호출부가 아니라 **수신자 필터 한 함수**(muted·quiet hours·digest) 에서 결정한다(아래 B-6).

### B-4. 숫자의 공식·표가 두 벌
**무엇** — Cue 한도표(설정 vs 게이트) · 매출(개요 `paid_amount` vs 원장) · 청구서 번호(회사 축 없음) · 휴지통 일수(화면 플랜값 vs cron 30) · 갱신 금액(애드온·예약 플랜 미반영) · 체험 배지(결제 후에도 «N일 남음») · 확인필요 동사(ack 버킷).
**구조** — 한도·기간·금액은 `config/plans.js`·`services/billing.js`·`services/plan.js` 의 함수만 읽는다. 가드 `--category=planlimits`: `routes/` 안에 플랜 코드 키를 가진 숫자 상수 객체가 있으면 실패(`PLAN_CUE_LIMITS` 가 양성 대조군). 매출은 `services/stats.js` 원장 함수를 export 해 청구 개요가 **같은 함수**를 쓴다.

### B-5. ko/en 양쪽 다 없는 문구 ~60키
**무엇** — 메일 작성/답장 25키 · 인증(이메일 인증·약관 동의) 블록 · Q file 탭/드라이브 14키 · Q sale Cue 바 4키 · 알림 페이지 3키 · 토스터 1키. 영어 사용자에게 한글 기본값이 뜬다.
**구조** — 가드는 **이미 있다**(`parity_missing_keys` 래칫). 문제는 기준선에 동결된 것 — 한 라운드로 전부 채우고 **기준선을 0 으로 조인다**(`--update-baseline` 은 전체 실행으로만, memory `feedback_update_baseline_loosens_godfile`). 이후 신규 0 유지.
+ 서버가 만드는 한국어 문자열(게스트 알림 제목·단계 이력 reason·AI 요약 라벨·내보내기 403 문구) 은 **코드로 내리고 화면이 번역**한다(`notifyTitle` 규약).

### B-6. 협업 층이 없다
**무엇** — 문서 댓글·멘션 0 · 채팅 답글 UI 0 · 메일 전체답장/CC 0 · 알림 음소거/방해금지/묶음 0 · 읽음은 숫자만.
**구조** —
- 댓글은 `task_comments` + `NoteThread` 를 **엔티티 축(entity_type·entity_id)** 으로 일반화해 업무·문서·파일·지식이 한 벌(새 모델 아님, 컬럼 2개 + 멱등 마이그레이션 → S=1·R=0 이지만 설계는 Fable).
- 알림은 `notify()` 안쪽에 **수신자 필터 한 함수** `services/notificationGate.js`(대화방 음소거·방해금지·메일 묶음 전환) — 호출부 60여 곳을 안 고치고 한 곳에서 결정.

### B-7. 자동으로 만들지만 아무도 안 쓴다
**무엇** — 단위 보고서 682건 중 사람 확정 0(자동 확정이 «확정» 의 뜻을 지웠다) · 개인 주간결산 363건 전부 자동 · 지식 카드 0 · 설문 0 · 예약 0 · 창구 링크 0 · 태그 0 · 반응 0 · `review_policy='any'` 0/274 · 피드백 버튼 전부 NULL · 위키 질문 루프 0회.
**구조** — 이건 코드가 아니라 **결정**이다. 운영 DB 로 같은 수치를 재고(SELECT 만), 쓰이지 않는 것은 ①기본 노출에서 내리거나 ②입구를 한 곳으로 모으거나(보고서 입구 6→1) ③제거한다. Irene 결정 목록 ⑥.

### B-8. 끝부분(전이·초대) 의 누락
**무엇** — 초대 수락이 `active_business_id` 를 안 바꿈 · OAuth 가 초대를 모름 · 신규 초대 방송 없음 · 초대 메일 실패를 삼키고 «보냈다» · 문서 공유→채팅·서명 카드가 `Message.create` 만(실시간·알림 없음) · 담당 지정 알림 0 · 영업 won 뒤 아무 일 없음.
**구조** — 초대 수락을 `services/invites.acceptInvite(user, invite)` **한 함수**로(세 종류 공통 후처리: active_business_id·방송·알림·감사) 하고 OAuth finish·회원가입·InvitePage 가 같은 함수를 부른다. 채팅에 메시지를 «쓰는» 모든 경로는 `services/chatPost.postMessage` 한 문(방송+알림 포함) — 지금 `Message.create` 직접 호출 3곳이 양성 대조군.

### B-9. 거대 파일
`ChatPanel.tsx` 3,996 · `PostsPage.tsx` 3,467 · `TaskDetailDrawer.tsx` 3,441 · `DocsTab.tsx` 2,924 · `MainLayout.tsx` 2,390 · `StartMeetingModal` 2,161. god-file 래칫은 있으므로 **새 분할 작업을 따로 세우지 않고** 1단계의 해당 화면 개편(드로어 탭화·사이드바 표 렌더·개요 한 장) 에 묶는다.

---

## C. 통합 로드맵 (중복 제거 · 하나의 순서)

표기: 규모 S/M/L · R(1=Fable 게이트) · 근거 = 영역 보고서 §.

### 0단계 — 지금 고칠 결함 (묶음 단위 · 묶음마다 한 번 게이트)

| 묶음 | 문제 | 해결 | 규모 | R | 예상 파일 | 근거 |
|---|---|---|:-:|:-:|---|---|
| **0-A 돈·구독** | 결제 링크 30일 소실 · 잠금 복구 500 · 다운그레이드 예약 미적용 · 애드온 미합산 · 체험 중 결제 시 잔여일 소멸 | ①정리 cron 에서 청구서 제외(또는 paid/canceled 만) ②잠금 때 pending 결제를 `replaced` 로 닫고, 잠금 상태면 결제창이 **새 checkout** 을 만들며, 관리자 입금확인도 같은 함수로 구독 재생성 ③갱신 청구가 `scheduled_plan` 가격 + 애드온 수량을 읽고 결제 확정 시 적용 ④체험 잔여일을 첫 기간에 더함 | M | **1** | `services/shareTokenCleanup.js` · `services/trial.js` · `services/billing.js`(markPaymentPaid·ensureRenewalPayment·computePeriodEnd) · `routes/plan.js` · `CheckoutModal.tsx` · `routes/admin_billing.js` | revenue 5-1·13·14·15·16 |
| **0-B 청구 정합** | 외화 정수 절단 · 번호 전역 채번 · 고객/프로젝트 회사 미검증 · 공개 응답에 출처 문서 토큰 · 공개 토큰으로 고객 마스터 덮어쓰기 | ①금액 컬럼 `DECIMAL(14,2)` 통일 + 통화별 반올림(멱등 마이그레이션, 배포 슬롯) — **그 전까지 KRW 외 통화 선택 숨김**(Irene ②) ②번호를 `business_id` 축 + 트랜잭션 락, 세 생성 경로가 한 함수 ③`client_id`·`project_id` 회사 검증(client_subscriptions 와 같은 술어) ④공개 응답에서 `share_token` 제거 ⑤receipt-request 는 청구서의 수신 메일만 갱신 | M | **1** | `models/Invoice.js`·`InvoiceItem.js` · `scripts/migrate-invoice-decimal.js`(신규) · `routes/invoices.js:107,188,210,560-583,903,1265` · `recurring_invoice.js` · `clientSubscriptionBilling.js` | revenue 5-2·3·6·11·19 |
| **0-C 격리·가시성** | 서명 토큰 멤버 노출 + 멤버 라우트 읽기 술어 없음 · 영업 방송 행 전체 · 지식 등급/공유 술어 · 폴더 삭제 우회(+해제 멤버) · 위키 이미지 LIKE · 옛 Document 공개 서명 · 상담 메모 개인 스레드 · 고객 라우트 requireMenu | ①직렬화에서 `token`·`sign_url` 제거, 복사 버튼 → «링크 다시 보내기»(요청자)/«내 메일로 받기»(본인) · 멤버 라우트에 `canReadPost`/`canEditPost` ②방송 `{id, business_id}` 만 ③`canAccessKbDocumentByLevel` ④폴더 삭제는 안의 파일마다 `canMutateFile`, `removed_at` 검사 ⑤`JSON_CONTAINS` 또는 `"file_id":12[,}]` 정확 매치 ⑥옛 공개 서명 라우트 제거 + Cue 의 Document 생성을 Post 로 ⑦`accessibleAccountIds` ⑧`requireMenu('clients', …)` 12곳. `secrets` 검사 확장(B-3) | M | **1** | `routes/signatures.js` · `SignatureProgressSection.tsx` · `services/salesStage.js` · `routes/kb.js:1463-1491` · `routes/file_folders.js` · `routes/wiki.js:236` · `routes/docs.js:888` · `services/cue_tools.js:17` · `routes/sale_interactions.js:126-175` · `routes/clients.js` · `scripts/health-check.js` | content 5-1~5·16·17 · revenue 5-4·5·12 · ai 5-13 |
| **0-D 휴지통 보관** | 화면 «90/365일» 인데 30일에 영구 삭제 · 문서·정보 휴지통 cron 없음 · 삭제 문구 30일 하드코딩 | **운영 `.env` 확인** → Irene ① 결정에 따라 `RETENTION_PURGE_APPLY=1`(짧은 플랜은 30일 하한) 또는 화면을 30일로. 문서·정보 휴지통도 같은 cron. 문구는 플랜값 보간 | S | **1** | `services/uploadCleanup.js` · `services/retentionPolicy.js` · `routes/content_trash.js` · `DocsTab.tsx:1946,1970,1996` | content 5-18·21 |
| **0-E 관리자 역할·메뉴 권한** | admin 이 채팅 보관 403 · 설정 읽기전용 · 메뉴 숨김 미반영 · 사이드바 정본 이탈 4건 | `isWorkspaceAdmin` 한 함수(서버 5곳) + 화면 `hasBiz('owner','admin')` · `GET /me/menu-levels` → `visibleNavMenus` 로 사이드바 렌더(수기 JSX → `WORKSPACE_MENUS.map`) · 권한 변경 방송 · 가드 `adminpredicate`·`navregistry` | M | 0 | `routes/conversations.js:17,541,958,979,1329` · `WorkspaceSettingsPage.tsx:514,1339` · `middleware/menu_permission.js`(판정 export) · `routes/businesses.js`(라우트 1) · `config/navMenus.ts` · `MainLayout.tsx:1474-1860` | comms A·B · shell 5 |
| **0-F 초대 경로** | OAuth 초대 유실 · 수락 후 옛 워크스페이스 · 가입↔로그인 redirect 유실 · 409 영어 · 초대 메일 실패 삼킴 · 신규 초대 방송 없음 | `acceptInvite` 한 함수(B-8) · OAuth state 에 `redirect`/`invite_token`, 초대 모드면 워크스페이스 생성 안 함 · 링크에 redirect 보존 · `apiError.ts` 매핑 · 메일 실패를 응답에 싣기(`invite_email_failed`) | S | 0 | `routes/oauth/{login,apple,finish,core}.js` · `routes/invites.js:249` · `routes/clients.js:361-375` · `RegisterPage.tsx:489` · `LoginPage.tsx:661` · `utils/apiError.ts` · `GoogleAuthButton.tsx:74` | shell D1 · revenue 1-B |
| **0-G 숫자·표 한 벌** | Cue 한도표 · 확인필요 ack 버킷 · 매출 공식 두 벌 · 체험 배지 · 결제내역 비원장 · Cue 과금 기록 모델명 · 제안+실행 2회 차감 | `PLAN_CUE_LIMITS` 삭제 → `plan.getLimit` · ack 버킷을 미진행·대기·진행 상태로 좁힘 · 개요 KPI 를 원장 함수로(1단계 집계 라우트의 선행) · `inTrial` 이 활성 구독이면 false · 과금 기록 모델명 실제값 · 제안 무과금(주석과 일치) | S | 0 | `routes/businesses.js:41,1243` · `routes/dashboard.js:113-121` · `OverviewTab.tsx:313-325` · `services/plan.js:81` · `cue_task_executor.js:294` · `routes/cue.js:398-402` | ai 5-1·3·4 · work 5-1 · revenue 5-10 · 2 |
| **0-H 알림 계약** | 휴가·설문 못 끔 · 채팅 1건 = 메일 1통 · 토스터 같은 탭 · 억제돼도 소리 · 담당 지정 알림 0 · 문서 공유/서명 카드 실시간 없음 | `EVENT_KINDS` 를 모델 ENUM 과 **한 목록** 공유 · 채팅 메시지 메일을 5분 에스컬레이션으로만(Irene ⑤) · 토스터 `openInNewTab` · 담당 지정 `notify` · 카드 생성은 `postMessage` 한 문(방송+알림) | S | 0(발송 **줄이는** 쪽) | `routes/notifications.js:12-35` · `models/NotificationPref.js` · `routes/projects.js:1396` · `NotificationToaster.tsx:290,588` · `routes/email_threads.js:1836` · `routes/posts.js:1604` · `routes/signatures.js:245` | comms D·E·I · content 5-11 |
| **0-I 문구·i18n** | 양쪽 없는 키 ~60 · 서버 한국어 문자열(게스트 알림·단계 reason·AI 요약 라벨·403 문구) · 청구 발행 섹션 하드코딩 · 인증 성공 문구 거짓 · 가입 부제 «무료» | 키 전부 채우고 `parity_missing_keys` 기준선 0 · 서버 문자열은 코드로 · 문구 3건 코드와 맞춤 | S | 0 | `locales/{ko,en}/{qmail,auth,qfile,qsale,common,layout}.json` · `routes/guest.js:261,404` · `sale_save.js:393` · `booking.js:625,813` · `saleSummary.js:107` · `NewInvoiceModal.tsx` · `VerifyEmailPage.tsx` | comms H · shell E13 · revenue 5-8 · content Q file |
| **0-J 작은 결함** | Q Project 빈 CTA · Q Note 20건 · `Ctrl+\` 충돌·`⌘T` 가로챔 · 전송 실패 입력 소실·스켈레톤 영구 · 상담 «불발» 400 · 다음 연락 미표시 · 알림 100건 상한 · 파괴 동작 확인 없음 9곳 · Cue 결과물 «이전으로» 버튼 + `created_via='agent'` · 해제 안 되는 파일 공유 B · 죽은 라우트·컴포넌트 정리 라운드(+`deadroute` 가드) | 각각 한 줄 수정 | S | 0 | `QProjectPage.tsx:441` · `QNotePage.tsx:690` · `MainLayout.tsx:1002` · `CueTaskBar.tsx:82` · `ChatPanel.tsx:768` · `QTalkPage.tsx:888,1480` · `SaleInboxList.tsx:376` · `clientTimeline.js` · `NotificationsPage.tsx:22` · 설정 9곳 · `TaskDetailDrawer.tsx` · `DocsTab.tsx:887` | work 5-3·4 · content 5-8·19 · shell 5 · comms C·J·K · revenue 5-7 · ai 5-6 |

**0단계 운영 확인(배포 전에 SELECT 로)** — ① 토큰이 사라진 살아 있는 청구서 수(`status IN ('sent','overdue','partially_paid') AND share_token IS NULL`) ② 잠긴 워크스페이스의 고아 pending 결제 수 ③ 소수점 금액 청구서 수 ④ `.env` 의 `RETENTION_PURGE_APPLY` ⑤ 위키 본문 `file_id` 건수.

### 1단계 — P0 사용자 체감 (S/M 위주)

| # | 문제 | 해결 | 규모 | R | 근거 |
|---|---|---|:-:|:-:|---|
| 1-1 | 확인필요에서 승인 하나에 다섯 번 누른다 | 행 인라인 처리(확인·승인·최종완료·참석·휴가 승인) + «나중에» | M | 0 | work E1·4-1 |
| 1-2 | 업무 상세를 열면 뭘 눌러야 할지 안 보인다 | 밴드2 에 «다음 액션» 1개 고정 + 메타 칩 + 본문 탭 4개(드로어 분할 겸함) | M | 0 | work E2·4-2 |
| 1-3 | 프로젝트 «지금 어디까지» 가 다섯 탭에 흩어짐 | 개요 탭 = 상태 한 장(진척·단계·다음 할 일·이번 주 마감·최근 활동·담당·고객), 캔버스는 접힘 | M | 0 | work E3·4-3 |
| 1-4 | 채팅 메시지 1건을 업무로 못 만든다 · 답글이 없다 | 메시지 툴바 «업무 만들기»(기존 `CreateDrawer` 폼) + 답글 UI(플럼빙 완료) | S+S | 0 | comms 1·2·4-1·4-2 |
| 1-5 | 메일 전체답장·CC/BCC 가 없다 | 답장 모드 + CC/BCC 칸(서버가 이미 받음), 수신자 계산은 서버 한 함수 | S | 0 | comms 3·4-3 |
| 1-6 | 알림을 줄일 수단이 «종류별 끄기» 뿐 | 대화방 음소거 · 방해금지 · 채팅 메일 묶음 — `notificationGate` 한 함수 | M | 0 | comms 4·4-4 |
| 1-7 | 가입 직후 빈 화면(빈 워크스페이스 66%) | 1문항 역할 선택 → 예시 프로젝트/업무/고객(실 DB 행·«예시» 태그·한 번에 삭제) + 체크리스트 «팀원 초대» (Irene ⑩) | M | 0 | shell E2·D2 |
| 1-8 | 메뉴 20개·안 쓰는 Q 가 보인다 | 0-E 위에 «안 쓰는 Q 끄기»(기본 권한 none) + 개인 즐겨찾기 | M | 0 | shell E3·D3 |
| 1-9 | Q info 검색이 제목만 | 화면 검색을 하이브리드 `POST kb/search` 로 + L1/L2 포함 + 고객 차단 | S | 0 | content 5·4-3 |
| 1-10 | 공유 링크가 영역마다 옵션이 다르고 파일 B 는 해제 불가 | 공용 `ShareLinkModal` 한 벌(문서 비밀번호/만료 노출 · Q Note 만료 · 파일 B 흡수) | M | 0 | content 6·17·4-4 |
| 1-11 | Cue 답에 클릭할 근거가 없다 · 외부 AI 가 한 일이 안 보인다 | 출처 칩(`refs`) + AI 활동 피드 + 목록 ✦ 표시 | M | 0 | ai 1·2·4-1·4-2 |
| 1-12 | 계약 서명·청구 결제가 고객 단계를 안 올린다(38/39 none) | `salesStageSync`(auto 상향만, reason 코드화) (Irene ⑬) | M | 0 | revenue 1·4-1 |
| 1-13 | «이번 달 들어올 돈» 을 보는 화면이 없다 | 청구 개요 서버 집계(에이징·고객별·입금 예정·CSV, 원장 한 함수) | M | 0 | revenue 2·4-2 |
| 1-14 | 청구서를 보내기 전에 어디로 가는지 모른다 | 발송 4곳 `ConfirmDialog` + 주소 보간, 없으면 비활성+이유 (+멤버/프로젝트 초대 2곳) | S | 0 | revenue 10·4-4 |
| 1-15 | 고객 창구가 «권한» 안에 숨어 있어 아무도 안 걸었다 | 설정>고객 상단 카드 + 고객 0명 빈 상태 CTA + 체크리스트 | S | 0 | revenue 4-5 |
| 1-16 | 첫 로드 105요청·600KB | i18n 4 ns 만 선로드 + 설정 허브 15절 lazy | S | 0 | shell E14·D6 |

### 2단계 — P1 확장

| # | 항목 | 규모 | R | 근거 |
|---|---|:-:|:-:|---|
| 2-1 | 캘린더 끌어 놓기 + 업무 마감 조정 + 폰 주간뷰 | M | 0 | work E5·4-5 |
| 2-2 | 업무 다중 선택·일괄 변경(삭제 제외) | M | 0 | work E6 |
| 2-3 | 컨펌 경량 모드(컨펌자 0 → 시작·완료 2단계, 승인완료 단계 설정) | S | 0 | work E7 |
| 2-4 | 보고서 입구 6→1 + 자동 확정 기본 OFF + 확인필요 «보고서 확정» (Irene ④) | M | 0 | work E4·4-4 |
| 2-5 | 메일 — 받는사람 자동완성 · 자주 쓰는 답장 · «담당» 탭 · 외부 이미지 차단 · 행 다중 선택 · 검색 필터 UI | S×6 | 0 | comms 5·6·8·9·10·1-C |
| 2-6 | 메일 예약발송·발송취소 10초 | M | **1** | comms 7 |
| 2-7 | 채팅·메일 본문 FULLTEXT 검색(통합검색 `messages` 종류) | M | 0 | comms 11 |
| 2-8 | 전송 실패 복구·로드 오류 상태(채팅) — 0-J 와 합칠 수 있음 | S | 0 | comms 4-5 |
| 2-9 | 표 문서 정렬·필터·CSV | M | 0 | content 4 |
| 2-10 | 회의 종료 자동 요약 + 결정/할 일 구조화 → 업무 후보 (+ Cue 후처리 번들) | M | 0 | content 2·4-5 · ai 8 |
| 2-11 | 프로젝트>정보 탭 = `<KnowledgePage embedded>` | S | 0 | content 4-6 |
| 2-12 | KB — PDF/DOCX 가져오기 · 재색인 버튼 · 실패 표시 · 거짓 번역 스위치 제거 · 임베딩 플랜 게이트 | S | 0 | content 7 · 5-6·7 |
| 2-13 | Q file — 검색을 본문 색인에 연결 · 종류/올린이/태그 필터 · 폴더 이동(parent) · 트리 DnD | S+S | 0 | content 13·14 |
| 2-14 | 영업 파이프라인 보드(목록/보드 토글·금액·가중) + won 후속 + 상담 목록 실시간 | M+S | 0 | revenue 3·4·4-3 |
| 2-15 | 예약 리마인더(전날·1시간 전) | S | **1** | revenue 5 |
| 2-16 | 견적 «승인» 공개 액션 → 청구 연결 | M | **1** | revenue 6 |
| 2-17 | 로그인 고객 홈 «내 상태» 카드 | S | 0 | revenue 7 |
| 2-18 | 셀프 해지 라우트(문구에만 있는 «해지») · 환불 시 구독 원복 · 유료 만료 정책 통일 (Irene ⑭) | M | **1** | revenue 1-E · 5-16·17 |
| 2-19 | 설정 검색 + 개인/워크스페이스 URL 분리 | S | 0 | shell E4·D4 |
| 2-20 | 권한 프리셋 3종·«같게» 복사·일괄 PUT·단계 뜻 툴팁 | M | 0 | shell E5·D5 |
| 2-21 | 워크스페이스 전환 시 보던 탭 복원 · 탭 오버플로 메뉴·단축키·단축키 도움말 | S+S | 0 | shell E6·E7 |
| 2-22 | 폰 하단 내비 4+1 | M | 0 | shell E8 |
| 2-23 | 내 데이터 내보내기에 업무·메시지·일정·청구 포함 · 고객 역할 내보내기 | M | 0 | shell E9 |
| 2-24 | OAuth 전용 계정 삭제 OTP | S | **1** | shell E10 |
| 2-25 | Cue — 동작별 과금 고지 · 자동응답 방 단위 끄기/근거 · 공개 Q helper 사용법 우선 · AI 회귀 세트 30문항 · 무계량 경로 계량 | S×4+M | 0 | ai 5·7·4-6·10·5-5 |
| 2-26 | 통합 검색 «내용으로 찾기» 그룹(시맨틱) | M | 0 | ai 6 |
| 2-27 | 근태 팀 탭 복귀 + 월 CSV · 프로젝트 복제에 업무 템플릿 · 담당자별 주간 부하 | S×3 | 0 | work E8·E9·E10 |
| 2-28 | 서명 리마인드·만료 cron · 버전 미리보기+diff · 전사 편집 · 회의록 내보내기 | S×4 | 2-28a=**1** | content 9·10·11·12 |
| 2-29 | 게스트 채팅 SSE + «담당자·보통 N시간 내 답장» · 읽음 아바타 목록 | M+S | 0 | comms 13·14 |

### 3단계 — P2 · 전략 (대형 · Irene 결정 필요)

| # | 항목 | 규모 | R | 근거 |
|---|---|:-:|:-:|---|
| 3-1 | 문서 댓글(블록 앵커)+@멘션 — 엔티티 축 댓글 한 벌(B-6) (Irene ⑪) | L | 0 (S=1) | content 1 |
| 3-2 | 고객용 보고서(프로젝트 단위 공개 링크/PDF 발송) (Irene ⑫) | L | **1** | work E4 2단계 |
| 3-3 | 회의 오디오 보관 옵션 + 전사 클릭 재생(기본 꺼짐·동의) | L | **1** | content 3 |
| 3-4 | Office 미리보기(서버 변환) · 파일 버전 사슬 · KB 담당자/검증일/만료 | M×3 | 0 | content 15·16·8 |
| 3-5 | 사용자별 «내 언어로 자동 번역» | M | 0 | comms 12 |
| 3-6 | 디자인 토큰화(raw hex 9,156·색 129 → 토큰·대비 토큰) + 접근성(outline·skip link·nav) | L | 0 | shell 2 |
| 3-7 | 프로젝트 상세 13탭 재편(자료 축/관리 축 분리, 폰 탭 축소) (Irene ⑧) | L | 0 | work 2 |
| 3-8 | 안 쓰이는 기능 접기/제거(반응·태그·설문·지식 카드·review_policy any·창구·단위보고서 자동) — 운영 수치 뒤 (Irene ⑥) | S~M | 0 | work 5-7 · ai 1-A · content 1 |
| 3-9 | 플랫폼 관리자 — 사용자 정지 · 손님 문의 메일 회신 · 세금계산서 큐 UI | S×3 | **1** | shell E11·E12 |
| 3-10 | 보고서 저장소 4→통합(백필) | L | **1** | work 4-4 2단계 |
| 3-11 | 조직(부서·팀) 을 담당자 선택·필터·권한에 연결(지금은 집계용) | M | 0 | shell 1 |
| 3-12 | 프롬프트 주입 방어를 메일 초안·요약·추출 입력까지 | S | 0 | ai 5-14 |

---

## Irene 결정 목록 (선택지 · 결과 · 권고)

| # | 정할 것 | 선택지 | 결과 | 권고 |
|---|---|---|---|---|
| ① | 휴지통 보관 일수 (0-D) | (a) 플랜 일수를 실제로 적용(`RETENTION_PURGE_APPLY=1`) (b) 화면을 30일로 통일 | (a) pro/enterprise 약속 지킴, 단 7/14일 플랜은 지금보다 **빨리** 지워짐 → 30일 하한 두면 안전 (b) 비용 0 이지만 플랜 차별점이 사라짐 | **(a) + 30일 하한** |
| ② | 외화 청구 (0-B) | (a) 마이그레이션 전까지 KRW 외 통화 선택 숨김 (b) 그대로 두고 마이그레이션 급행 | (a) 지금 즉시 사고 차단 (b) 그 사이 USD 청구 1건이면 금액 틀림 | **(a) 먼저, (b) 0-B 에서** |
| ③ | 청구서 번호 (0-B) | (a) 기존 번호 유지 + 앞으로만 회사별 채번 (b) 기존도 재번호 | (b) 는 이미 발행된 세무 증빙 번호가 바뀐다 | **(a)** |
| ④ | 보고서 자동 확정 (2-4) | (a) 기본 OFF(초안 유지, 사람이 확정) (b) 유지 | (a) «확정» 이 뜻을 되찾음, 확인필요에 항목 1종 늘어남 (b) 지금처럼 0/682 | **(a)** |
| ⑤ | 채팅 메일 알림 (0-H) | (a) 즉시 발송 → 5분 안 읽으면 묶어서 1통 (b) 유지 | (a) 메일량 급감·스팸 평판 보호, «바로 메일로 받던» 사람에겐 체감 변화 (b) dev 30일 779통 읽음 0 그대로 | **(a)** |
| ⑥ | 안 쓰는 기능 (3-8) | 운영 SELECT 로 사용률 재확인 → 접기/입구 통합/제거 | 메뉴·설정 인지 부담 감소 | **운영 수치 먼저, 그 다음 한 번에 결정** |
| ⑦ | 서명 진행표 «URL 복사» (0-C) | (a) «링크 다시 보내기(본인 메일)» 로 교체 (b) 복사 유지 | (b) 는 토큰을 멤버 전원에게 계속 내려야 한다 — 보안 결함 유지 | **(a)** |
| ⑧ | 프로젝트 상세 탭 재편 (3-7) | (a) 1-3 «개요 한 장» 만 먼저 (b) 13탭 축 분리까지 | (a) 가장 큰 체감을 M 규모로 (b) L 규모·설계 승인 필요 | **(a) 먼저** |
| ⑨ | 메뉴 숨김 반영 (0-E) | 반영하면 «숨김» 으로 둔 멤버의 사이드바에서 그 메뉴가 **즉시 사라진다** | 권한 화면이 사실이 됨 | **반영** |
| ⑩ | 첫 화면 역할 질문 + 예시 데이터 (1-7) | (a) 도입 (b) 체크리스트만 강화 | 예시 행은 **실 DB 행**(«예시» 태그·한 번에 삭제) 이라 mock 금지 원칙과 다르지만, 제품에 가짜 데이터가 «보이는» 것이므로 승인 필요 | (a) — 단 «예시» 표식·일괄 삭제 필수 |
| ⑪ | 문서 댓글·멘션 착수 (3-1) | L 규모·설계(엔티티 축 댓글) | 검토 루프가 문서 안에서 끝남 | 2단계 끝난 뒤 착수 |
| ⑫ | 고객용 보고서 발송 (3-2) | L·R=1 | 에이전시 핵심 니즈, 외부 발송·공개 표면 | 설계는 Fable 로 먼저 |
| ⑬ | 영업 단계 자동 상향 (1-12) | 견적/제안 발행 → 제안, 계약 서명 → 성사(자동은 올리기만) | 파이프라인이 «사실» 이 됨, 사람이 내린 단계는 안 건드림 | **승인 권고** |
| ⑭ | 안 낸 돈의 결과 통일 (2-18) | (a) 체험·유료 모두 «잠금» (b) 모두 «free 한도로 강등» | 지금은 체험=잠금 / 유료 만료=폐지된 free 강등으로 다르다 | (a) — free 는 폐지된 플랜 |

---

## D. 전체 UX 점수와 «최고 수준까지의 격차»

**6.0 / 10** (영역별: 업무 6.0 · 소통 6.0 · 콘텐츠 6.1 · 매출 6.6 · AI 5.9 · 껍데기 5.7).

PlanQ 는 **기능의 폭**에서는 이미 동급 B2B SaaS 를 넘는다 — 10단계 업무 상태·컨펌 정책·실시간 STT 와 화자 자동 이름·3단계 서명·분할 청구·증빙 정정·IMAP 실시간 메일·MCP 44 도구·권한 범위 안의 AI 컨텍스트는 Linear·Notion·HubSpot 어느 하나도 한 제품 안에 다 갖고 있지 않다. 그리고 구조 계약(두 밴드·드로어 480·휴지통 한 벌·첨부 한 벌·자동저장·가드)이 박제돼 «같은 일이 같은 모양» 인 비율도 높다. 격차는 세 겹이다. **첫째, «다음에 뭘 누르면 되는지» 가 첫 화면에 없다** — 업무 드로어는 9개 메타 아래로 스크롤해야 액션이 나오고, 확인필요는 열어야만 처리되며, 프로젝트는 다섯 탭을 돌아야 지금 상태를 안다. Linear 는 상태가 머리줄 한 칸이고 Slack 받은편지함은 행에서 끝난다. **둘째, 인지 부담** — 상위 메뉴 20·설정 21·Q 접두 11개가 같은 무게로 놓여 있고, 권한으로 숨긴 것도 보인다. Notion 은 7개로 시작한다. **셋째, 신뢰의 마감** — Cue 답에 근거 링크가 없고, AI 가 바꾼 것을 되돌릴 버튼이 없고, 알림을 줄일 축이 없고, 영어 사용자에게 한글 문구가 60곳이며, 돈이 걸린 자리(결제 링크·잠금 복구·번호·외화)에 조용한 결함이 남아 있다. 이 셋을 0단계(결함)·1단계(첫 화면의 다음 액션·메뉴 다이어트·근거와 되돌리기) 로 닫으면 **7.5~8** 에 닿고, 협업 층(댓글·멘션)·디자인 토큰화·고객용 보고서까지 가면 «최고 수준» 과의 차이는 브랜드와 생태계의 문제로 좁혀진다.

---

### 부록 — 영역 보고서 UX 점수 원표
| 영역 | 세부 점수 |
|---|---|
| work | Q Task 목록 7 · 상세 6 · 확인필요 6 · 프로젝트 목록 7 · 프로젝트 상세 5 · 캘린더 6 · 근태 6 · 인사이트 7 · 보고서 4 |
| comms | Q Talk 6.5 · 게스트/고객 6 · Q Mail 5.5 · 알림 5 · 새 소식/번역 7 |
| content | Q docs 7 · 서명 7 · 표/설문 5 · Q File 6 · Q info 5 · Q위키 7 · Q Note 6 |
| revenue | Q sale 6.5 · 고객 관리 7 · 창구/포털 7.5 · Q Bill 6.5 · 구독 5.5 |
| ai | Cue 대화 6 · 실행 카드 7 · AI 업무 생성 7 · 외부 연동 7 · 통합 검색 6 · 과금 UX 5 · 신뢰 4 · 지식 루프 5 · 모바일 7 |
| shell | 첫 경험 6 · 초대 4 · 내비 5 · 멀티탭 7 · 설정 5 · 권한 5 · 모바일 6 · 접근성 4 · 디자인 일관성 5 · 관리자 7 · 도움말 8 · 성능 6 |
