# PlanQ «놀랄 만한 디테일» 기능 목록 — 코드 검증본

- 작성: 2026-10-04 · [Claude Code] 코드 직독 조사 (코드 수정 없음)
- 범위: Irene 이 꼽은 12개 + 추가 디테일 29개. **실제로 작동하는 것만** 적었다. 내부 품질 장치(가드·테스트·감사 스크립트)는 뺐다.
- 검증 상태 표기
  - **코드 확인** = 라우트·서비스·화면 코드를 직접 읽음
  - **도움말** = `dev-backend/seed-wiki-content.js` 에 사용자 도움말 글이 있음 (slug 표기)
  - **운영 배포** = 운영 서버(`/opt/planq/backend`, v1.70.1)에서 확인. 백엔드는 핵심 파일 md5 가 dev 와 동일함을 확인(registry.js·email_threads.js·export.js·stats.js), 프론트는 운영 번들에서 해당 코드 문자열 존재 확인. 개별 확인 못 한 것은 «운영 미확인»
- 플랜 한도의 정본은 `dev-backend/config/plans.js` (Starter 9,900원 / Basic 39,000원 / Pro 79,000원). 신규 가입은 Starter 14일 체험.

---

## 가장 강한 10개 (추천)

| # | 기능 | 왜 강한가 |
|---|---|---|
| 1 | **ChatGPT·Claude 에서 말로 PlanQ 업무를 찾고·만들고·고친다** | 경쟁 협업툴 대부분이 아직 못 하는 것. 게다가 «마감 변경·완료·담당 변경은 한 번 더 확인», «삭제·발송·청구는 아예 불가» 라는 안전선이 설명 가능하다 |
| 2 | **고객은 가입·로그인 없이 링크 하나로 대화·서명·결제까지** | 의뢰형 비즈니스의 최대 마찰(고객에게 앱 깔게 하기)을 없앤다. 대화·문서 서명·청구서 결제·상담 예약이 전부 링크로 열린다 |
| 3 | **Q Note — 회의 중 실시간 번역 + 질문을 감지해 답변을 미리 찾아 둔다** | 질문이 나오는 순간 백그라운드에서 답을 준비한다. 답의 근거 순서(내가 올린 우선 Q&A → 자료 → 일반 AI)가 정해져 있어 «지어낸 답» 이 아니다 |
| 4 | **할일 목록을 다른 프로그램 위에 «항상 위» 로 띄워 두기** | 엑셀·디자인툴 작업 중에도 할일·채팅이 떠 있다. 팝아웃 안에서 바로 업무 시작/중지(시간 기록)까지 |
| 5 | **메일 답장 초안 — 받은 메일의 언어로, 지난 대화 6통과 등록된 FAQ 를 근거로** | 영어 메일엔 영어로 쓴다. «더 짧게» 같은 요청으로 다듬을 수 있고, 사람이 손본 초안을 통째로 덮어쓰지 않는다 |
| 6 | **시간이 돈으로 — 프로젝트·고객·멤버별 «시간당 이익»** | 포커스 타이머로 쌓인 실제 시간 × 멤버 단가 → 프로젝트별 시간당 이익·마진, 멤버별 가동률·매출 기여. «수익성 엔진» 문구의 실체 |
| 7 | **서명 받기 — 서명 칸을 문서에 박아 두고, 서명본은 원본 고정 + 증명서 PDF** | 요청 시점 본문을 동결해 «서명 후 내용 바뀜» 분쟁을 막고, 우리 쪽은 로그인으로 바로 서명한다 |
| 8 | **쓰다 만 글은 사라지지 않는다 + 저장 버튼 없음** | 댓글·수정요청을 쓰다 화면을 떠나도, 새로고침해도 남아 있다. 문서는 변경 이력으로 되돌릴 수 있다 |
| 9 | **메일에서 «진짜 고객 문의» 만 골라 상담으로** | 홍보·자동메일을 키워드가 아니라 «우리가 답했나·개인 주소인가·사람이 올렸나» 로 가른다. 놓친 건 우클릭 한 번으로 상담에 넣는다 |
| 10 | **확인필요 숫자 = 메뉴 배지들의 합** | 사이드바 숫자와 목록이 어긋나지 않는다. 한 업무를 두 번 세지 않는다. 작아 보이지만 «믿을 수 있는 도구» 의 근거 |

---

## 업무 (Q Task · Q Project)

| 기능 | 무엇이 놀라운가 | 조건 | 근거 | 검증 상태 |
|---|---|---|---|---|
| 할일·채팅·노트·도움말을 별도 창으로 띄우고, 핀을 누르면 **모든 창 위에 항상 떠 있게** | 다른 도구가 핀을 가져가면 우리 창은 닫히지 않고 일반 창으로 돌아온다 | 데스크탑. «항상 위» 는 **Chrome·Edge**(Document Picture-in-Picture)만. 일반 팝아웃 창은 다른 브라우저도 됨 | `dev-frontend/src/utils/pinHost.ts:1-60,183,517` · 라우트 `/task-popout` 등 `App.tsx:447-462` | 코드 확인 · 도움말 `popout-pin` · 운영 배포 |
| 팝아웃 목록에서 바로 **업무 시작/중지** | 상세를 안 열고도 시간 기록이 시작된다 | 담당자 본인 | `dev-frontend/src/hooks/useFocusControl.ts` · `components/QTask/PopoutFocusButton.tsx` | 코드 확인 · 운영 배포 |
| 업무 시간 **자동 누적** | «진행 중» 이었던 시간을 합산해 실제 시간이 채워진다. 직접 고치면 그때부터 자동 누적을 멈춘다 | 담당자만 시간 입력 가능 | `dev-backend/services/taskActualHours.js` (`recomputeActualHoursFromHistory`) | 코드 확인 · 운영 배포 |
| AI 예상 시간 — **우리 워크스페이스 습관을 학습** | 같은 제목이어도 팀마다 다르게 추정한다(최근 확정 추정을 예시로 사용) | Cue 사용량 차감 | `dev-backend/routes/task_estimations.js:28,48` | 코드 확인 · 운영 미확인(개별) |
| 컨펌 끝나면 바로 완료가 아니라 **«승인완료» 단계** | 담당자가 결과를 확인하고 «최종 완료» 를 눌러야 닫힌다 — 승인 사실을 놓치지 않음 | 컨펌자를 지정한 업무 | `dev-backend/services/weekTaskSet.js:70-73` · CLAUDE.md «승인완료» 절 | 코드 확인 · 도움말 `confirm-review` |
| 의뢰 내용은 **작성자만**, 결과물은 **담당자만** 고친다 | 직급으로 덮어쓰기 불가 — 결과물 수정은 «수정 요청» 으로 돌려보내 기록이 남는다 | 대표·관리자도 예외 없음 | CLAUDE.md «Q Task 본문 필드 책임선» · `TaskDetailDrawer.tsx` | 코드 확인(문서 근거) |
| 관련 업무 연결 | 양방향 링크, 다른 워크스페이스 업무는 연결 불가 | — | `dev-backend/routes/tasks.js` links · `RelatedTasksSection.tsx` | 코드 확인 |
| 업무·프로젝트·문서·청구서 **복사** | 내용은 가져오고 이력·서명·공유 링크는 두고 온다 — 복사본이 원본 행세를 못 함 | 읽을 수 있으면 복사 가능 | `routes/tasks.js:1798` · `routes/posts.js:597` · `routes/invoices.js:729` | 코드 확인 · 도움말 `duplicate-*` |
| 반복 업무 | 반복 규칙으로 자동 생성, 설명을 고치면 «이번만/이후 전부» 를 묻는다 | — | `dev-backend/services/recurringTaskGenerator.js` · `taskSeriesRecurrence.js` | 코드 확인 |
| 프로젝트에 **문서를 탭으로 고정** | 자주 보는 문서를 프로젝트 상단 탭으로. 데스크탑에서 올린 탭이 폰에서도 보인다 | **개인별** 고정(팀 공유 아님) | `dev-frontend/src/pages/QProject/usePinnedDocTabs.ts:1-40` · `/api/projects/:id/pinned-docs` | 코드 확인 · 운영 배포 |
| 프로젝트 안에서 Q docs·Q Note **본체 그대로** | 프로젝트 탭에서 회의록 만들기·녹음·문서 편집이 그대로 된다(목록만 베낀 화면 아님) | — | `components/Docs/PostsPage.tsx` scope · `QNotePage` scope prop | 코드 확인 · 도움말 `project-notes-tab` |
| 목록 키보드 이동 · 우측 패널 단축키(⌘/ · Ctrl+\\) | — | 데스크탑 | `hooks/useListKeyboardNav.ts` · `pages/QTask/QTaskPage.tsx:308` | 코드 확인 |
| 주간 보고 자동 생성 | 매주 일요일 밤 워크스페이스 보고서가 자동으로 박제된다 | — | `dev-backend/services/weeklyReviewCron.js` | 코드 확인 |

## 고객 (Q Talk · Q Sale · 고객 창구)

| 기능 | 무엇이 놀라운가 | 조건 | 근거 | 검증 상태 |
|---|---|---|---|---|
| 고객은 **로그인 없이 링크로** 대화방·프로젝트 보기 참여 | 링크마다 여는 범위가 정해져 있다(대화방 링크로 프로젝트는 못 연다) | 발급은 멤버 | `dev-backend/routes/guest.js:116` · `services/guest_link.js:235` | 코드 확인 · 도움말 `project-external-view-link` |
| 고객이 링크에서 **상담 시간 예약** | 받는 시간대만 슬롯으로 보이고, 확정되면 고객에게 캘린더 파일(.ics) 메일, 담당자 Google Meet 링크 | 창구 설정 필요 · Meet 은 담당자 본인 구글 연동 | `dev-backend/services/booking.js` · `routes/guest_booking.js` | 코드 확인 · 도움말 `customer-entry-booking` · 운영 배포 |
| 채팅 메시지 **자동 번역** | 보내는 순간 두 언어로 번역해 둔다(ko·en·ja·zh·es 중 2개) | 대화방에서 번역 켜기 · Cue 사용량 | `dev-backend/services/translation_service.js:1-30` | 코드 확인 · 도움말 `translation` |
| 대화에서 바로 업무 만들기 · AI 업무 추출 | 원문 메시지가 업무에 연결된다 | Cue 사용량(AI 추출 시) | 도움말 `auto-task-extract` · `task_candidates` | 도움말 · 코드 확인(부분) |
| Cue 가 고객 질문에 **자동 응답 또는 초안** | 확신이 낮거나 민감한 말이면 자동 발송 대신 초안으로 멈춘다 | Cue 모드 켜기 · 월 Cue 한도 | `dev-backend/services/cue_orchestrator.js:1-15` | 코드 확인 · 도움말 `cue-in-chat-and-mail` |
| 지운 메시지는 «삭제된 메시지» 로 — **번역 사본까지** 서버가 지운다 | 화면에서만 숨기는 게 아니라 응답에서 원문이 안 나간다 | — | `dev-backend/utils/deletedMessage.js:26` | 코드 확인 |
| 상담 기록은 **고객 한 사람에 모인다** | 메일·채팅·회의록·직접 기록이 전부 같은 고객 타임라인으로. 회의록을 상담으로 저장하면 노트도 그 고객에 연결 | 멤버 | `dev-backend/services/clientTimeline.js` · `routes/sale_save.js:224` | 코드 확인 · 도움말 `save-to-consult` |
| 영업 단계(문의→상담→제안→협상→수주/실패) | 단계 변경 이력이 자동으로 남는다 | 고객 역할은 접근 불가 | `dev-backend/services/salesStage.js:31` | 코드 확인 · 도움말 `qsale` |
| 채팅에서 사람 아이콘 → **고객/멤버 프로필**로 | 새 탭으로 열려 보던 대화가 안 사라진다 | — | CLAUDE.md «사람 아이콘은 프로필로» · `UserInfoPopover` | 코드 확인(문서 근거) |
| 로그인한 고객 전용 홈 | 내 문의·예약을 어느 입구로 신청했든 한곳에서 본다 | 고객 계정 | `dev-frontend/src/pages/ClientHome` | 코드 확인 |

## 메일 (Q Mail)

| 기능 | 무엇이 놀라운가 | 조건 | 근거 | 검증 상태 |
|---|---|---|---|---|
| **AI 답장 초안** — 받은 메일 언어로, 최근 6통 흐름 + 등록 FAQ 근거 | 두 번째부터는 «어떻게 고칠지» 요청을 받아 다듬는다(손본 초안을 갈아엎지 않음) | 버튼 클릭(자동 아님) · Q mail 쓰기 권한 · 분 10회/일 200회 · Cue 사용량 | `dev-backend/routes/email_threads.js:1697-1760` · `pages/QMail/MailPage.tsx:1425-1445` | 코드 확인 · 도움말 `qmail-cue-draft` · 운영 배포 |
| 새 메일도 «이런 내용으로 써 줘» 로 AI 작성 | — | 지시 필수 | `routes/email_threads.js:1802` · `ComposeAiRow.tsx` | 코드 확인 |
| 답장 보내는 주소 **자동 선택** | 별칭 주소로 받은 메일은 그 별칭으로 답한다(받는사람→참조 순) | 별칭 등록 필요 | `dev-backend/services/mailIdentity.js:31` | 코드 확인 · 운영 배포 |
| 홍보 메일은 상담에 안 들어온다 | 키워드가 아니라 «우리가 답함 / 개인 주소 / 사람이 올림» 으로 판정 | — | `dev-backend/services/saleMailCriteria.js:34` | 코드 확인 · 도움말 `sale-inbox-criteria` · 운영 배포 |
| 우클릭 «상담으로 보내기» | 놓친 문의를 메일 목록·상세·채팅에서 바로 살린다 | 멤버 | `routes/sale_save.js:224` · `components/Common/AppContextMenu.tsx` | 코드 확인 · 도움말 `right-click-menu` |
| 답이 없으면 **후속 알림** · «답변 필요» 표시 | 팔로우·담당 표시는 «확인 완료» 해도 안 사라진다 | — | `routes/email_threads.js:880,965` · `services/mailFolders.js` | 코드 확인 · 도움말 `qmail-follow-up` |
| 메일 요약·번역·업무 추출 | — | Cue 사용량 | `routes/email_threads.js` (CLAUDE.md·M3 설계서 §101 의 라우트 목록) | 코드 확인(라우트 존재) |
| «모두 읽음 (3475)» — **버튼에 적힌 수만큼 정말 처리** | 수천 건도 끝까지 처리하고, 상한에 닿으면 화면이 말한다 | — | CLAUDE.md «Q mail 폴더·배지 계약 ④» | 코드 확인(문서 근거) |

## 회의 (Q Note)

| 기능 | 무엇이 놀라운가 | 조건 | 근거 | 검증 상태 |
|---|---|---|---|---|
| 회의 중 **실시간 받아쓰기 + 번역** | 말하는 대로 자막과 번역이 같이 뜬다 | 월 분 한도: Starter 60분 · Basic 15시간 · Pro 60시간 | `q-note/routers/live.py:254-272` · `config/plans.js:62,98,130` | 코드 확인 · 도움말 `record-meeting` · 운영 배포(프로세스 존재) |
| 질문을 감지하면 **답변을 미리 찾아 둔다** | 질문이 나오는 순간 백그라운드로 준비 → 누르면 즉시. 근거 순서: 우선 Q&A → 직접 입력 Q&A → 같은 회의의 앞선 답 → 자료에서 생성한 Q&A → 문서 검색 → 일반 AI | 회의 전 자료·Q&A 업로드할수록 정확 | `q-note/services/answer_service.py:1-20` · `routers/live.py:372-400` | 코드 확인 |
| 우선 Q&A 를 **CSV 로 일괄 등록** · URL 자료 등록 | 영업·인터뷰용 «예상 질문 답변집» | — | `q-note/routers/sessions.py:2343,2416,2536,1843` | 코드 확인 |
| **내 목소리 등록** → 화자 구분 | — | — | `q-note/routers/sessions.py:1914` · `services/voice_fingerprint.py` | 코드 확인 |
| 녹음 파일 올려서 받아쓰기 | 지난 회의도 노트로 | 분 한도 차감 | `q-note/routers/audio_upload.py` | 코드 확인 · 도움말 `upload-recording` |
| 회의록에서 업무 추출 | — | Cue 사용량 | `dev-frontend/src/hooks/useNoteTaskExtraction.ts` | 코드 확인 · 도움말 `extract-tasks` |
| 노트는 **진짜 사적 공간** | 기본은 작성자만 — 대표도 못 본다. 작성자가 연 범위만 열린다 | — | `q-note/routers/sessions.py` `_load_session_or_403` | 코드 확인(문서 근거) |

## 문서 (Q docs)

| 기능 | 무엇이 놀라운가 | 조건 | 근거 | 검증 상태 |
|---|---|---|---|---|
| **목차 자동 생성** | 본문 제목에서 매번 뽑아 낡지 않는다. 켜기/끄기·접기는 보는 사람마다 | 제목 2개 이상 | `dev-frontend/src/components/Docs/DocToc.tsx:1-30` | 코드 확인 · 운영 배포 |
| 표 문서 — 합계·평균 열, 열 하단 집계 | 문서 안에서 가벼운 스프레드시트 | — | `components/Docs/PostTableGrid.tsx:44,69,131` · `models/Post.js:45` | 코드 확인 |
| **변경 이력 + 되돌리기** | 저장 버튼 없이도 안심 — 이전 버전에서 쓰인 파일은 지워도 보관 | — | `components/Docs/PostHistoryPanel.tsx:1-15` | 코드 확인 |
| 누가 편집 중인지 표시 | 구글 문서처럼 편집 중인 사람 이름 | 동시 타이핑 병합은 아님 | `hooks/usePostPresence.ts` | 코드 확인 |
| 공유 링크를 연 채로 원본을 고치면 **보는 쪽도 갱신** | 탭으로 돌아오거나 60초마다 다시 읽는다(서명 입력 중엔 멈춤) | — | `dev-frontend/src/hooks/usePublicRevalidate.ts:22` | 코드 확인 |
| AI 로 문서 초안 | — | Cue 사용량 | `components/Docs/PostAiModal.tsx` | 코드 확인 |

## 서명 (전자서명)

| 기능 | 무엇이 놀라운가 | 조건 | 근거 | 검증 상태 |
|---|---|---|---|---|
| 링크 하나로 서명, 고객은 로그인 없이 · 이메일 인증번호 | — | — | `dev-backend/routes/signature_public.js:14` · `routes/signatures.js:87-95` (OTP 제한) | 코드 확인 · 도움말 `collect-signature` · 운영 배포 |
| 문서에 **서명 칸**을 박아 두면 서명이 그 자리에 들어간다 | 요청 시 본문을 고정 — 서명 후 원본이 바뀌지 않는다 | — | `dev-backend/services/signedDocument.js:32,80` · `components/Docs/SignatureField.ts` | 코드 확인 · 운영 배포 |
| **서명본 PDF + 증명서 장**(이메일·IP·시각) | 증명서는 내부 PDF 에만, 공개 링크엔 안 나감 | — | `services/signedDocument.js:102` | 코드 확인 · 도움말 `signed-copy-pdf` |
| 우리 쪽은 메일 없이 **로그인으로 바로 서명** | 증거는 고객 서명과 같은 수준으로 남는다 | — | `dev-backend/routes/signature_internal.js:31` | 코드 확인 |
| 서명 링크는 **본인 메일로만** | 단체방에 서명 링크를 띄우지 않는다 | — | CLAUDE.md «서명본» 절 · `routes/signature_public.js:142` | 코드 확인 |

## 자료 (Q File · Q info · Drive)

| 기능 | 무엇이 놀라운가 | 조건 | 근거 | 검증 상태 |
|---|---|---|---|---|
| **Q info 를 데이터베이스처럼** — 항목(열) 직접 정의 | 텍스트·긴글·숫자·날짜·URL·이메일·전화·선택·체크·**시크릿** 10종. 목록에 보일 열을 고른다 | — | `dev-backend/models/KbDocument.js:135-147` · `pages/Knowledge/KnowledgePage.tsx:68-72` | 코드 확인 · 도움말 `knowledge-base` |
| **시크릿 칸** — 가려 두고 눌러서 보기·복사 | 검색·AI 에서도 빠진다(계정 정보 보관용) | — | `components/Knowledge/kbListShell.tsx:122-160` · `dev-backend/utils/searchCells.js:20-24` | 코드 확인 |
| Q info **CSV 일괄 등록 / AI 자동 분리 등록** · 한↔영 자동 번역 | 긴 글을 붙여 넣으면 AI 가 주제별로 나눠 분류·태그 | AI 분리는 Cue 사용량 | `pages/Knowledge/KbCsvIngestModal.tsx` · `KbAiIngestModal.tsx` · `KbDocument.js` auto_translate | 코드 확인 |
| Q info 내용이 **AI 답변의 근거**가 된다 | 메일 초안·Cue 자동응답이 등록 FAQ 를 쓴다 | 메일 초안엔 «일반 등급» 만 | `routes/email_threads.js:1730-1745` | 코드 확인 |
| 첨부 창에서 **내 구글 드라이브 파일 바로 가져오기** | 가져온 파일은 PlanQ 파일이 되어 팀원 누구나 열린다(드라이브 링크 공유 권한 걱정 없음) | 개인 Google 연동 · 분 20/일 500회 | `dev-frontend/src/components/Common/DriveImportSection.tsx` · `dev-backend/routes/personal_drive.js:243-245` · `services/driveImport.js` | 코드 확인 · 운영 배포 |
| 워크스페이스 드라이브 폴더에 넣은 파일이 **자동으로 파일함에** | 미리보기·검색·중복 제거 그대로, 용량 한도 안에서 | **대표만** 연결 · 구글 문서/시트 원본은 제외 | `dev-backend/services/gdriveIngest.js:1-20` · `routes/cloud.js:240,279` | 코드 확인 · 운영 배포 |
| `.gdoc` 바로가기 파일을 **구글 문서로 열어 준다** | 172바이트 링크 파일을 실제 문서로 연다 | — | `dev-backend/services/googleShortcut.js` | 코드 확인 |
| 파일을 **바탕화면으로 끌어내기** | 브라우저 밖으로 드래그해 저장 | Chrome·Edge 만 | `dev-frontend/src/hooks/useFileDragOut.ts` | 코드 확인 · 운영 배포 |
| 빈 곳을 끌어 **여러 파일 선택** · 폴더에 끌어 넣기 · 로컬 파일을 폴더에 바로 업로드 | 탐색기처럼 | 데스크탑 | `hooks/useMarqueeSelect.ts` · `docs/folderDrop.ts` | 코드 확인 |
| 메일 첨부는 파일함 **«메일» 칸**에 정리 | 버리지도 섞지도 않는다 | — | CLAUDE.md «Q file 좌측 트리» 절 | 코드 확인(문서 근거) |
| 첨부 **전체 다운로드(zip)** | 항목마다 권한을 다시 확인 | 멤버 | `dev-backend/routes/files.js:1815` · `components/Common/AttachmentList.tsx` | 코드 확인 |
| 같은 파일은 한 번만 저장(중복 제거) | 용량을 두 번 안 먹는다 | — | CLAUDE.md «SHA-256 dedup» | 문서 근거 |
| **휴지통 하나** — 파일·문서·정보 다 여기서 복원 | 보관 기간 Starter 14일 · Basic 30일 · Pro 90일 | — | `dev-frontend/src/components/Trash/TrashDrawer.tsx` · `config/plans.js` trash_retention_days | 코드 확인 · 도움말 `file-trash-restore` |
| **내 자료 내보내기(zip)** · 워크스페이스 자료 백업 · 다른 워크스페이스로 옮기기 | 퇴사·이동 때 내 개인 파일·문서·회의록을 챙긴다. 완료되면 알림 | 워크스페이스 백업은 대표·관리자 | `dev-backend/routes/export.js:95-150,178,205,242,361` · `services/exportJobWorker.js:345` | 코드 확인 · 운영 배포 — **범위 제한 있음(주의 참조)** |

## 청구 (Q Bill)

| 기능 | 무엇이 놀라운가 | 조건 | 근거 | 검증 상태 |
|---|---|---|---|---|
| 청구서 링크 — 고객이 열어 **«입금했어요» 통보 / 카드 결제 / 세금계산서·현금영수증 요청** | 고객 쪽 행동이 전부 한 링크에서 | 카드는 워크스페이스 **자체 Stripe 계정 연결** 필요 | `dev-backend/routes/invoices.js:125,330,417,501` · `routes/stripeWorkspaceWebhook.js` | 코드 확인 · 도움말 `card-payment` |
| **분할 청구**(회차별 결제·증빙 표시) | 착수금/중도금/잔금 | — | `routes/invoices.js:1669-1854` | 코드 확인 |
| 정기·구독 청구서 — 다음 발행일 표시 | 고객 결제 페이지에도 «매월 N일 발행» | — | `dev-backend/services/invoiceRecurring.js` · `routes/client_subscriptions.js` | 코드 확인 |
| 연체 독촉 · 재발송 | 보낼 주소를 확인창에 적어 묻는다 | 발송·결제확인은 **대표만** | `routes/invoices.js:1509,1588,1621` | 코드 확인 · 도움말 `overdue-reminder` |
| 세금계산서·현금영수증 **정정 이력**(수정세금계산서 사유) | 원 발행은 보존, 정정을 이벤트로 | 홈택스 자동발행 아님 — 외부 발행 후 표시 | `routes/invoices.js:2154-2162` | 코드 확인 · 도움말 `tax-cash-receipt` |
| 외화 청구(USD·EUR·JPY·CNY) + SWIFT 입금 정보 자동 표시 | 통계는 통화를 섞지 않는다 | — | `services/stats.js:18-40` · CLAUDE.md Phase E | 코드 확인 |
| 견적→계약→청구 **거래 단계 자동 진행** | 문서 상태에 따라 프로젝트 단계가 알아서 넘어간다 | — | `services/projectStageEngine.js` | 문서 근거 |

## 근태 · 통계

| 기능 | 무엇이 놀라운가 | 조건 | 근거 | 검증 상태 |
|---|---|---|---|---|
| 출근·휴게·퇴근 · 휴가 신청/승인/잔여 | 동료에게는 **상태(근무중/휴게/퇴근)만**, 시각·누계는 본인과 관리자만 | 멤버(고객 제외) | `dev-backend/routes/attendance.js:1-60,102-105` · `routes/leave.js:42-184` | 코드 확인 · 도움말 `clock-in-out`·`request-leave` · 운영 배포 |
| **업무를 시작하면 자동 출근** (되돌리기 가능) | — | 개인 설정으로 끌 수 있음 | `dev-backend/services/attendanceTransition.js:338` · `routes/attendance.js:435` | 코드 확인 |
| 워크스페이스 휴일이 캘린더에 표시 | — | — | `hooks/useWorkspaceHolidays.ts` | 코드 확인 |
| **프로젝트·고객별 시간당 이익·마진** | 실제 시간 × 멤버 단가 + 직접비 + 고정비 | 멤버 시급/월급 입력 필요(없으면 «단가 미입력» 경고) | `dev-backend/services/stats.js:564,691-711,808-822` · `routes/businesses.js:854-953` | 코드 확인 · 도움말 `project-profitability` · 운영 배포 |
| **멤버별 가동률·매출 기여·실효 시급** | 수금액을 고객 프로젝트 투입 시간 비중으로 배분 | Insights 읽기 권한 | `services/stats.js:908-1097` | 코드 확인 · 운영 배포 |
| 예상 시간 vs 실제 시간 **정확도** | 누가 늘 과소/과대 추정하는지 | — | `services/stats.js` `mape` | 코드 확인 |
| 첫 응답 시간 | 고객 요청에 얼마나 빨리 반응했나 | — | `services/stats.js:384` | 코드 확인 |
| 통계 CSV 내려받기 · 보고서 PDF | — | — | `pages/Insights/tabs/*.tsx` (`utils/csv.ts`) · `routes/stats.js:266` | 코드 확인 |

## AI (Cue · 외부 AI 연동)

| 기능 | 무엇이 놀라운가 | 조건 | 근거 | 검증 상태 |
|---|---|---|---|---|
| **ChatGPT·Claude 에서 PlanQ 업무 조회·추가·수정** — 도구 19개 | 업무 검색/생성/필드 수정·메모·상담 기록·프로젝트 메모·일정 조회/생성·고객/프로젝트/멤버 조회 | 멤버 이상(고객 불가) · 워크스페이스 **하나만** 연결 · 호출마다 Cue 1회 차감 · 모든 플랜 | `dev-backend/services/agent/registry.js:18-187` · `services/agent_oauth/grants.js:19` · `services/agent/execute.js:72` | 코드 확인 · 도움말 `connect-chatgpt-claude` · **운영 배포·켜짐**(AGENT_ENABLED=1, 쓰기 켜짐) |
| 마감 변경·완료·담당자 변경은 **확인 2단계** | 첫 호출은 미리보기만, 사용자가 동의해야 실행(5분·1회용 확인 토큰) | — | `registry.js:161-180,207` | 코드 확인 |
| **삭제·발송·청구·권한 변경은 AI 도구로 아예 없음** · 금액 비노출 | «AI 가 사고 칠 수 있는 버튼» 자체가 없다 | — | `registry.js:205-207` (LOW/MEDIUM 만 허용) | 코드 확인 |
| 연결 범위 = **연결한 사람의 권한 그대로** | 멤버십이 끊기면 다음 호출부터 즉시 막힘 | — | `grants.js:91` 주석(매 호출 재확인) | 코드 확인 |
| Cue 에게 업무 맡기기 | AI 팀원으로 업무 담당 지정 | Cue 한도 | 도움말 `assign-task-to-cue` · `services/cue_task_executor.js` | 도움말 · 코드 존재 |

## 모바일

| 기능 | 무엇이 놀라운가 | 조건 | 근거 | 검증 상태 |
|---|---|---|---|---|
| iOS·Android 앱 | — | App Store(2026-10-01)·Play 공개 | memory `project_app_release_status` | 운영(스토어) 확인됨 — 메모 기준 |
| 알림을 누르면 **해당 화면으로** | 앱이 꺼져 있다가 켜질 때도 이동을 버리지 않는다 | 앱 | CLAUDE.md «네이티브 앱» 절 · `NativeBridge` | 문서 근거 |
| **키보드가 입력란·버튼을 가리지 않게** | 입력 중엔 부가 카드를 접고, 하단 버튼줄 뒤로 숨은 입력도 끌어올린다 | 폰 | `dev-frontend/src/main.tsx:166-167,236` | 코드 확인 · 운영 배포 |
| 우측 패널은 **뒤로 가기로 닫힌다** | — | 폰·태블릿·데스크탑 | `hooks/useBackToClose.ts` · `components/Tab/UrlMirror.tsx` | 코드 확인 |
| 웹앱(PWA) 로그인 365일 유지 · 여러 기기 동시 로그인 | — | 홈 화면 설치 | CLAUDE.md refresh_token TTL | 문서 근거 |

## 공통 · 보안 · 신뢰

| 기능 | 무엇이 놀라운가 | 조건 | 근거 | 검증 상태 |
|---|---|---|---|---|
| **저장 버튼 없음** — 입력하면 자동 저장, 화면을 떠나는 순간에도 마지막 입력을 보낸다 | 새로고침·로그아웃·워크스페이스 전환 직전에 마저 저장 | — | `components/Common/AutoSaveField.tsx` · `hooks/useLeaveSave.ts` | 코드 확인 |
| **쓰다 만 글 보존** — 댓글·수정요청·사유 | 업무를 닫고 다시 열어도 남아 있다. 로그아웃하면 지운다 | 같은 브라우저 | `hooks/useDraftText.ts` · `hooks/draftKinds.ts` | 코드 확인 |
| **새로고침 없이 실시간 반영** | 동료가 바꾼 업무·메시지·파일이 바로 보인다. 앱을 다시 열면 놓친 것을 채운다 | — | CLAUDE.md §16 · `hooks/useVisibilityRefresh.ts` | 코드 확인(문서 근거) |
| 입력 중에는 새 버전이 와도 **강제 새로고침 안 함** | 녹음·입력 중 화면이 날아가지 않는다 | — | `components/Common/BuildVersionGuard.tsx` | 코드 확인 |
| 확인필요 숫자 = 메뉴 배지 합 | 한 업무를 두 번 세지 않는다 | — | `dev-backend/routes/dashboard.js:1087` | 코드 확인 |
| 공유 링크 **비밀번호·만료** · 범위를 좁히면 **이미 나간 링크도 끊긴다** | PDF·첨부 같은 하위 주소도 비밀번호를 본다 | — | `dev-backend/services/share_helper.js:105-136` | 코드 확인 |
| 문서·파일·정보별 **보안 등급**(내부·대외비는 외부로 못 나감) | — | — | CLAUDE.md «공유·참조 다섯 규칙» | 문서 근거 |
| 고객·외부로 메일이 나가는 버튼은 **받을 주소를 보여 주고** 묻는다 | — | 고객 초대·초대 재발송·청구 발송 | CLAUDE.md «외부 발송은 확인을 받는다» | 문서 근거 |
| 워크스페이스 여러 개 — 한 창은 한 워크스페이스, **전환하면 다른 창도 따라온다** | 섞여 보이지 않는다 | — | CLAUDE.md «워크스페이스 단일 정본 계약» | 문서 근거 |
| 앱 안 탭(브라우저처럼 여러 화면 동시에) | 워크스페이스마다 탭 세트가 따로 | 데스크탑 | `hooks/useTabStore.ts` · `components/Tab/*` | 코드 확인 |
| 통합 검색 — 비밀 칸은 검색에서 제외, 왜 걸렸는지 표시 | — | — | `dev-backend/routes/search.js` · `utils/searchMatch.js` | 코드 확인 |
| 구글·애플 로그인 | — | 애플은 자격 등록 시 | `dev-backend/routes/oauth/apple.js` · `oauth/finish.js` | 코드 확인 · 운영 동작(메모) |

---

## 주의 (확인 못 한 것 · 생각보다 약한 것)

1. **메일 답장 초안은 «자동» 이 아니다.** 사람이 «Cue 답변 초안» 버튼을 눌러야 생성된다. 광고·자동메일엔 제안하지 않는다. «자동 작성» 이라고 쓰면 과장 — «버튼 한 번에 초안» 이 정확하다. AI 앱(ChatGPT·Claude)에서 답장 초안 만들기(`create_mail_reply_draft`)는 **아직 설계 단계(M3-c)** 로 미구현.
2. **«모든 데이터 다운로드» 는 사실이 아니다.** 내보내기 zip 에는 **파일과 문서(+선택 시 회의록)만** 들어간다. 업무·채팅·메일·청구·고객 목록은 zip 에 없다(통계·고객 화면의 CSV 는 별도). 또 «내 자료» 는 **개인(L1) 파일·내 초안/개인 문서만**, 워크스페이스 백업은 개인 자료를 뺀다. **구글 드라이브에 저장된 파일은 zip 에서 빠진다**(`storage_provider: 'planq'` 조건, `routes/export.js:101,131`). 항목 상한 5,000.
3. **«항상 위» 핀은 Chrome·Edge 데스크탑만.** Safari·Firefox·모바일은 일반 팝아웃 창까지만. 바탕화면으로 파일 끌어내기도 Chromium 만.
4. **ChatGPT·Claude 연동**: 운영에 켜져 있지만 최근 커밋(404fc8a5)이 «운영에서 ChatGPT 에서 안 돈다» 진단용 기록을 넣은 것 — **ChatGPT 쪽 실제 동작은 미확인.** 호출마다 Cue 1회가 차감돼 Starter(월 50회)는 금방 소진된다. 메일·문서·파일·Q info 조회는 아직 없다(M3 설계 중).
5. **프로젝트 문서 탭 고정은 개인별**이다. 팀 전체에 탭이 생기는 게 아니다.
6. **Drive 는 양방향 동기화가 아니다.** 가져오기(개인)와 워크스페이스 폴더 → PlanQ 들이기(대표 연결)뿐. PlanQ 에서 고친 것이 드라이브 원본에 반영되지 않는다(Irene 결정으로 안 함). 구글 문서/시트 원본은 워크스페이스 들이기에서 제외. 개인 가져오기는 `drive.file` 권한이라 **PlanQ 로 연 적 있는 파일만** 보인다.
7. **통계의 «시간별·근무별 매출»** 은 근태 출퇴근 기록이 아니라 **업무 실제 시간(포커스 타이머)** 기준이다. 멤버별 매출은 청구서가 업무와 직접 연결되지 않아 **고객 프로젝트 투입 시간 비중으로 배분한 추정치**다. 멤버 단가를 입력하지 않으면 노동비 0 으로 계산되고 «미입력» 경고가 뜬다. 외화 매출은 홈 통화와 합산하지 않고 따로 보여 준다(환산 없음).
8. **카드 결제(Q Bill)** 는 워크스페이스가 **자기 Stripe 계정**을 연결해야 된다. 세금계산서·현금영수증은 **홈택스 자동 발행이 아니라** 외부 발행 후 기록·추적.
9. **문서 동시 편집**은 «누가 편집 중인지 표시» 까지. 같은 문단 동시 타이핑 병합(구글 문서식)은 아니다.
10. **Q Note 번역·답변**은 분 한도가 있다(Starter 60분). 답변 품질은 미리 올린 자료·Q&A 에 크게 좌우되고, 자료가 없으면 마지막 단계(일반 AI)로 떨어진다. 번역 언어 목록은 Q Note 쪽에서 확인하지 못했다(채팅 번역은 ko·en·ja·zh·es 5개 중 2개).
11. **Q info «데이터베이스»** 는 항목(열) 정의·목록 표시·CSV/AI 일괄 등록·비밀 칸까지. **정렬·필터·관계형 연결·수식 열은 확인하지 못했다.** 합계·평균 같은 계산은 Q docs **표 문서** 쪽 기능이다(둘을 섞어 말하지 말 것).
12. **«운영 배포»** 는 백엔드 핵심 4파일의 해시 일치와 운영 번들의 코드 문자열 존재로 판단했다. 운영 번들 디렉터리에 옛 빌드가 함께 남아 있어 프론트 문자열 존재는 «언젠가 배포됨» 의 증거이지 «현재 화면» 의 증거는 아니다. 근거가 «CLAUDE.md(문서 근거)» 인 항목은 코드 줄까지 다시 열어 보지 않았다.
13. 시간 «AI 예상» 은 워크스페이스별 최근 확정 추정을 예시로 쓰는 방식이다 — «학습» 이라고 쓰면 모델 학습으로 오해될 수 있어 «우리 팀 기록을 참고해» 가 정확하다.
