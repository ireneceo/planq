# 소통 영역 감사 — Q Talk · Q Mail · 알림/푸시 · 게스트 링크 · 새 소식 · 번역 (2026-10-07, Fable)

> 범위 밖: 다른 작업방이 미커밋으로 고치는 중인 알림 «대상 지워짐(target_missing)» 변경은 진행 중 작업으로 보고 판단만 했다(§5-G).
> 근거는 전부 `파일:줄`. 실브라우저는 쓰지 않았다(코드·라우트·i18n·dev DB SELECT 로만 판정).

## 요약 5줄
1. **기반은 두텁다** — 채팅(실시간·번역·Cue·후보 추출·카드·게스트 링크)·메일(IMAP IDLE·스레딩·판정·라벨·규칙·초안·AI·FAQ)·알림(인앱/푸시/메일 3채널·언어별 제목·presence 로 푸시 생략)이 모두 실 API 로 돈다. 죽은 UI 는 없고, 죽은 **서버 라우트**가 11개 남아 있다.
2. **메일 클라이언트로서는 미완** — 전체답장 없음 · CC/BCC 입력칸 없음(서버는 받는다) · 받는사람 자동완성 없음 · 예약발송/발송취소/템플릿 없음 · 외부 이미지 차단 없음 · 「담당」 폴더 서버만 있고 탭 없음 · 담당 지정해도 알림 0. **ko/en 양쪽에 없는 i18n 키 25개**가 영어 사용자에게 한글로 뜬다.
3. **채팅 ↔ 업무 연결은 «대화 단위» 까지만** — 자동/수동 후보 추출은 되지만 **«이 메시지로 업무 만들기» 가 없다.** 답글(reply_to)은 DB·서버·서비스 함수까지 있고 **UI 만 없다.** 메시지 검색·전달·북마크·전달 없음. 전송 실패 시 입력한 글이 사라진다.
4. **알림 과부하 구조** — 채팅 메시지 1건 = 참여자 전원에게 인앱+푸시+**메일** 즉시(기본 ON, 묶음·방해금지·대화방 음소거·멘션만 모드 전부 없음). dev 30일 실측: 메일 알림 779건 중 **읽음 0**, 한 사용자 하루 174건. 두 알림 종류(`leave`·`survey`)는 끌 수조차 없다(PUT prefs 가 거절).
5. **고객 화면은 «읽고 쓰기» 수준** — 고객 계정은 금지 항목이 잘 가려져 있고, 게스트는 5초 폴링 텍스트 전용(첨부·반응·수정 불가). 워크스페이스 **admin 역할이 보관·핀·내보내기 버튼을 보지만 서버는 owner 만 통과**(403) — 실버그.

---

## 1. 구현 상태

### 1-A. Q Talk (채팅)
| 기능 | 상태 | 근거 |
|---|---|---|
| 메시지 전송(옵티미스틱)·수정·삭제(마스킹 화이트리스트)·일괄 삭제 | ✅ | `QTalkPage.tsx:1385-1413` → `services/qtalk.ts:484` → `routes/projects.js:1264` · 수정 `conversations.js:911` · 삭제 `:945`, `utils/deletedMessage.js:17-38` |
| 반응(이모지 8종)·입력 이모지 피커 | ✅ | `message_reactions.js:16,64` · `EmojiPickerButton.tsx:11` (dev DB reactions 0건 — 쓰이지 않고 있다) |
| @멘션(참여자 자동완성 + `mention` 알림) | ✅ | `ChatPanel.tsx:277-347` · `projects.js:1364-1394` |
| 핀(메시지)·핀(대화방)·보관·복원·삭제 | ✅ | `conversations.js:971/1007/247/1318/1378/1408` |
| 파일·이미지 업로드(드래그·붙여넣기)·라이트박스·전체 다운로드 | ✅ | `ChatPanel.tsx:1257-1293,2344-2359` · `message_attachments.js:171` |
| 읽음 표시 | 🟡 | 수만 보여 준다(`read_by_count`, `projects.js:1692-1705`, `ChatPanel.tsx:2072`) — 누가 읽었는지 없음 |
| 안읽음 구분선·맨아래 버튼 | 🟡 | 구분선 `ChatPanel.tsx:229-240,1551` · **첫 안읽음으로 자동 스크롤 없음** |
| **답글(인용)** | 🔴 UI 없음 | 컬럼 `models/Message.js:126` · 서버 `projects.js:1307,1319` · `qtalk.ts:484 replyTo` 까지 있고 호출부가 안 넘긴다(`QTalkPage.tsx:1413`). dev DB 에 2건(seed) |
| 스레드·북마크·전달(forward)·메시지 검색·타이핑 표시·링크 미리보기·마크다운/코드블록·음성 메시지 | 🔴 | 라우트·UI 모두 없음. 좌측 검색은 방 이름·마지막 메시지만(`LeftPanel.tsx:116-128`), 전역검색은 방 제목만(`routes/search.js:51-53`) |
| **고객방 내부 메모(is_internal)** | 🔴 죽음 | 서버 옛 경로만 지원(`conversations.js:748,811` staff 룸) — 앱이 쓰는 경로는 `is_internal:false` 고정(`projects.js:1318`), `ChatPanel` 토글 없음. DB 9건 전부 4/20 seed |
| 대화 종류 | 🟡 | DB 는 `customer`/`internal` 둘뿐(`conversations.js:401-414`). DM 전용 타입 없음(멤버 1명 그룹으로 흉내) |
| 생성(이름·프로젝트·고객·게스트방·번역쌍·자동추출·멤버)·이름변경·참여자 추가/삭제·프로젝트 연결 해제 | ✅ | `NewChatModal.tsx` · `ChatSettingsModal.tsx:111-135` · `projects.js:1177,1205` |
| 음소거·나가기 버튼 | 🔴 | 음소거는 컬럼·UI 모두 없음. 나가기는 서버 허용(`conversations.js:540`)이나 버튼 없음(내 행의 «내보내기» 로만) |
| 번역(대화방 단위, 발송 시 백그라운드, 캐시, 소켓) | ✅ | `projects.js:1413-1439` · `ChatSettingsModal.tsx:48-88` (dev 실측 163건 중 26건 번역됨) |
| Cue 초안 승인/거절·평가, 카드 7종(서명·청구·업무·파일·정보·일정·문서) | ✅ | `ChatPanel.tsx:1650-1792,2006-2067` · `projects.js:1508/1597` |
| 수동 추출·자동 추출(디바운스)·후보 등록/병합/거절 | ✅ | `QTalkPage.tsx:1584,1628` · `projects.js:2991,3056` · `taskExtractorScheduler.js:107` |
| **메시지 1건 → 업무 만들기** | 🔴 | 메시지 툴바에 없음(툴바: 반응·복사·상담저장·수정·핀·더보기 `ChatPanel.tsx:2099-2175`). 한 줄 추가는 우측 `CueTaskBar`(`RightPanel.tsx:245-256`) — 대화 단위 |
| 메시지 → 상담 저장 | ✅(조건부) | `ChatPanel.tsx:703-720` — 고객방 + **연결 고객 없음**일 때만 |
| 메시지 → 일정 / 문서·노트 | 🔴 | 없음(역방향 문서→채팅 공유는 있음 `QTalkPage.tsx:1429`) |
| 실시간(소켓 12종)·방 join·재연결·가시성 읽음 | ✅ | `QTalkPage.tsx:518-813`, `server.js:237-253` |
| 빈/로딩/오류 상태 | 🟡 | 빈 상태 키 7종 ✅. **전송 실패 = 입력 소실**(`ChatPanel.tsx:768-770` 응답 전에 비움, `QTalkPage.tsx:1480-1487` 버블 제거만) · 메시지 로드 2회 실패 시 스켈레톤 영구(`QTalkPage.tsx:888-895`) · 목록 실패 → «아직 대화가 없습니다» 로 위장(`:493,977`) |
| 모바일 | ✅ | ≤1024 전환·뒤로·키보드 시 메타 밴드 숨김·44px·탭하면 툴바(`ChatPanel.tsx:371-424,1566,2525`). 롱프레스는 예정 주석(`:2097`) |

### 1-B. 게스트 링크 / 고객 계정
| 기능 | 상태 | 근거 |
|---|---|---|
| 링크 발급·쓰기 토글·scope(대화/프로젝트)·만료·회수·개인별 링크 | ✅ | `GuestLinkButton.tsx:143,165,281` · `guest_admin.js:24/61/129` (dev: 56건 중 51 회수) |
| 게스트 읽기·텍스트 쓰기(태그 제거·4000자·분당 10)·표시명·사칭 차단 | ✅ | `guest.js:193,321-350` |
| 게스트 카드 열기·계정 요청·답장 알림 OTP 구독·예약·프로젝트 탭 | ✅ | `guest.js:296,228` · `guest_subscribe.js` · `guest_project.js` |
| 게스트 실시간 | 🟡 | 5초 폴링(`GuestChatPanel.tsx:78`), 소켓 없음 |
| 게스트 첨부·반응·수정·삭제 | 🔴 | 없음(의도적일 수 있으나 안내 문구 없음) |
| 고객 계정 숨김(새 채팅·내부 채널·이름변경·설정·게스트링크·후보·Cue 초안·상담·멤버 목록) | ✅ | `LeftPanel.tsx:89,95,160` · `ChatPanel.tsx:214,704,1324,1355,1361,1473,2006` · 서버 `projects.js:1271,1640`, `messageVisibility.js:25-62` |

### 1-C. Q Mail
| 기능 | 상태 | 근거 |
|---|---|---|
| IMAP/SMTP 계정 CRUD·연결 테스트(받기+보내기)·기본 계정·공용/개인·건강 배지·수동 동기화 | ✅ | `email_accounts.js:121-399,351,427` · `EmailAccountSettings.tsx` |
| Gmail OAuth | 🟡 꺼짐 | `googleScopes.js:54 OAUTH_CONSENT_DISABLED` · `EmailAccountSettings.tsx:30` (memory 결정 — 복원 스위치 2개) |
| 동기화: IDLE 실시간 + 3분 틱 + Sent/Spam 보조 폴더 | ✅ | `emailImapCron.js:1245-1266,1437-1443`, `email_account_folders.js:16` |
| 사용자 지정 폴더·Archive/Trash 동기화 · **보낸 메일 IMAP Sent 에 append** | 🔴 | append 호출 0건 — 제공자 자동저장에 의존, 중복은 `isPlanqSentTwin`(`emailImapCron.js:511,773`) |
| 과거 메일 백필 | 🔴 호출처 0 | `POST /email-accounts/:id/backfill`(`email_accounts.js:446`) — 화면에 버튼 없음 |
| 스레드 보기·그룹핑(In-Reply-To→References→제목+참여자 30일)·접기·인용 접기·cid 이미지·새 창·전체화면·첨부 미리보기/저장 | ✅ | `emailImapCron.js:60-130` · `ThreadMessages.tsx` · `MessageAttachments.tsx` · `useInlineCidImages.ts` |
| HTML 정화(DOMPurify + sandbox iframe) | ✅ | `utils/sanitizeHtml.ts`, `mailSrcDoc.ts:49` |
| **외부 이미지 차단(추적 픽셀)** · 인쇄 | 🔴 | `mailSrcDoc.ts:94-100` 은 크기만 다룬다. «이미지 보기» 토글·i18n 없음 |
| 새 메일·답장·전달(첨부 포함) · 초안 서버 자동저장+pagehide keepalive · 리치 에디터·인라인 이미지 | ✅ | `email_threads.js:1304,1049,1393,1554-1587` · `MailPage.tsx:1566-1595,2787` |
| **전체답장** | 🔴 | 답장은 마지막 inbound 발신자 1명(`email_threads.js:1081-1083`) — FE 는 to/cc 를 안 보낸다(`MailPage.tsx:1746`) |
| **CC/BCC** | 🔴 FE 없음 | 서버는 받고 저장·발송(`email_threads.js:1055,1309,1399`, `emailSend.js:369`) — 화면에 칸이 없다(`MailPage.tsx:2009,2138`) |
| **받는사람 자동완성**(고객·과거 주소) | 🔴 | `RecipientInput.tsx` 는 칩 입력만 |
| 예약발송·발송취소·템플릿/자주 쓰는 답장 | 🔴 | grep 0건(`optimisticOutbound.ts` 는 실패 롤백만) |
| 서명 3단(별칭>계정>워크스페이스, ko/en 자동) · 별칭·발신주소 자동선택·«별칭으로 등록» | ✅ | `emailSend.js:150-190` · `mail_aliases.js:37-109` · `MailPage.tsx:1626-1669` |
| AI 답장 제안·새 메일 작성·요약·브리프·FAQ 제안(일 04:10)·번역(캐시 없음) | ✅ | `email_threads.js:1603,1710,2128,2165,1969,1749` |
| 폴더 탭 | 🟡 | 답변필요·확인권장·전체·팔로잉·보낸·광고·스팸·보관(`MailPage.tsx:188,294-311`). **«담당» 폴더는 서버만**(`mailFolders.js:34`) |
| 라벨(20개 상한)·팔로우·담당 지정·후속 알림(3/7/14/30일, 일 1회 cron)·스팸/해제·발신자 차단 | ✅ | `email_threads.js:1892-1948,1861,1836,789` · `mailFollowUpCron.js` |
| **담당 지정 알림** | 🔴 | `email_threads.js:1836-1860` 에 notify 호출 0 — 지정받은 사람은 모른다 |
| 발신자 규칙 | 🟡 | 조건 address/domain/keyword × 판정 5종, 자동 학습(`mailSenderRules.js:40-130,186-227`). **수정(PUT) 없음**, 복합 조건·라벨/폴더 이동 액션 없음 |
| 일괄 처리 | 🟡 | 폴더 전체(건수 표기·500씩·BULK_MAX) ✅(`MailPage.tsx:1105`, `email_threads.js:923-955`). **행 다중 선택 UI 없음**(서버는 thread_ids 받음) |
| 스누즈·스레드 삭제 | 🔴 | 라우트 없음 |
| 검색(본문·제목·발신·수신·첨부명 LIKE, 점수, 강조, 300ms) | ✅ | `mailSearchWhere.js:21-124` · `MailPage.tsx:2453-2505` |
| 검색 필터 | 🟡 | 계정·라벨·프로젝트·문의만 UI(`MailPage.tsx:734-738`). 서버의 `client_id`·`starred`·`received_at`(날짜)·첨부유무·from/to 는 호출처 0. FULLTEXT 인덱스 없음(8,195건 LIKE 스캔) |
| 메일→업무 후보(수동·자동 scope)·고객/프로젝트 자동/수동 연결·상담 승격·이슈·노트 | ✅ | `email_threads.js:2039-2106,1808-1822,2183-2289` · `mailLink.js:45-190` · `MailPage.tsx:755` |
| 메일 → 일정 | 🔴 | 직접 액션 없음(Cue 질문창 경유만 `MailContextPanel.tsx:402`) |
| 새 메일 알림(계정 scope 3종·시간당 20 캡·10분 중복제거) | ✅ | `mailNotify.js:17-70` — 공용 계정은 **멤버 전원**, 담당자·팔로워 우선 없음(`:89-95`) |
| **i18n 누락 25키(ko/en 양쪽)** | 🔴 | `compose.new/to/subject/subjectPh/bodyPh/send/cancel/sendFailed/noAccount/toRequired/bodyRequired/keptDraft`, `actions.follow/following/newLabel/removeLabel/unassigned`, `account.personal`, `common.close`, `forward.originalIncluded/previewTitle`, `reply.aiFailed/aiNoInbound/aiUnavailable` — `MailPage.tsx:1465-1476,2033,2121-2196,2728-2846,3012-3027`. 영어 사용자에게 한글 기본값이 뜬다(검증: `node -e` 로 양쪽 json 키 부재 확인) |
| 빈/로딩/오류·모바일(≤1024 사이드바 접힘·뒤로) | ✅ | `MailPage.tsx:843,2399-2420,2859-2873,650-717` |

### 1-D. 알림 · 푸시 · 새 소식 · 번역
| 기능 | 상태 | 근거 |
|---|---|---|
| notify/notifyMany 3채널(인앱·메일·푸시)·수신자 언어 제목·게스트/AI/삭제 워크스페이스 가드·excerpt 정책 | ✅ | `routes/notifications.js:133-372` · `notifyTitle.js:139-145` |
| 환경설정 매트릭스(워크스페이스별 13종 × 4열) | 🟡 | `NotificationSettings.tsx:26-40`. **`chat` 열은 토스터만 읽고 서버는 안 본다**(`NotificationToaster.tsx:225-259`), `push_fallback` 행에도 4열 전부 렌더. 전역(워크스페이스 공통) 설정 없음 |
| **끌 수 없는 종류** | 🔴 | `leave`(`leaveTransition.js:170,192`)·`survey`(`survey_public.js:97`)가 라우트 `EVENT_KINDS`(`notifications.js:12-35`)에 없어 `PUT /prefs` 가 `invalid_event_kind` 로 거절, 설정 화면에도 없음 |
| prefs 전역 폴백 | 🟡 | `isAllowed` 는 `business_id` 정확 일치만(`notifications.js:83-96`) — 모델 주석 «NULL=전역 기본» (`NotificationPref.js:102`)과 어긋남 |
| 방해금지(quiet hours)·대화방 음소거·멘션만·다이제스트·서버측 중복제거 | 🔴 | grep 0건. 유일한 묶음은 5분 미읽음 메일 에스컬레이션(`unreadEscalationCron.js:16,80-135`) |
| **채팅 메시지 → 메일 즉시 발송** | 🟡 과부하 | `projects.js:1395-1410` 에 skipChannels 없음 → `notifications.js:279-301` 메일 채널 기본 ON, 스로틀 없음(`emailService.js:1196`). dev 30일 `email_logs` 상위에 «Q Talk · 새 메시지» 80건 |
| 푸시: VAPID·APNs/FCM·좀비 만료·410 삭제·실패 경보·테스트·권한 동기화·sw 배지 | ✅ | `push_service.js:20-186` · `push.js:24-105,154-160` · `sw.js:83-197` · `nativePush.ts` |
| 푸시 collapse | 🟡 | `tag` 만. `push_service.js:12` 주석의 Topic 헤더는 **안 보낸다**(`:114`) |
| 같은 사람 다른 기기가 보는 중이면 푸시 생략 | ✅ | `services/presence.js`, `notifications.js:305-316` (인앱 행은 그대로 쌓인다) |
| 드롭다운(10건·새 탭·모두 읽음)·전체 페이지(전체/안읽음) | 🟡 | 오류 상태 없음(`useNotifications.ts:158` 침묵). 페이지 `limit:100` 고정, 서버 `before` 커서 호출처 0(`NotificationsPage.tsx:22`, `notifications.js:419`) → 100건 이전은 못 본다. 종류 필터·날짜 묶음 없음 |
| 토스터 | 🟡 | 최대 3·소리 200ms 디바운스 ✅. **클릭은 같은 탭 이동**(`NotificationToaster.tsx:588`) ↔ 드롭다운/페이지는 새 탭(규칙 «얹히는 진입점은 새 탭» 위반). 토스트가 억제돼도 소리는 난다(`:290-291`) |
| 링크 해석 | 🟡 | `notification_link.js:22-50`. `email_thread`·`leave_request`·`export_job`·`project` 매핑 없음(호출부가 link 를 넘겨야) |
| i18n 누락 | 🔴 | `notifications.filterAll/filterUnread/emptyUnreadTitle`(`NotificationsPage.tsx:41,44,65`) · `toaster.clearAll`(common) — ko/en 모두 없음 |
| 새 소식(help_articles updates·watermark+개별 읽음·platform_admin 발행) | ✅ | `whats_new.js:16-88` · `WhatsNewDropdown.tsx:90` |
| 번역: 채팅(대화방 단위 캐시)·메일(요청 시, 캐시 없음) | ✅ | `translation_service.js:5,36-45` (gpt-4o-mini, 5개 언어) |
| **사용자별 자동 번역**(내 언어로) | 🔴 | `User.language` 는 알림 제목에만. 채팅 표시는 «감지 언어의 반대편»(`ChatPanel.tsx:1837-1853`) |
| KB `auto_translate`·`translation_visibility` | 🔴 죽음 | 저장만(`routes/kb.js:1283,1329,1370`) — 읽는 곳 0 |

### 1-E. 죽은 서버 라우트(호출처 0 — FE·mcp·scripts·services 전수 grep)
`routes/conversations.js`: `POST /:biz/:id/messages`(732, canary·seed 만) · `PATCH /:id/archive`(1262) · `cue/trigger|pause|resume|suggestions`(1068-1154) · `messages/:id/approve|reject`(1183/1220) · `client/:id/summary` GET+refresh(1280/1294) · `GET /:id/pinned`(1037). `routes/email_accounts.js`: `backfill`(446). 목록 인자 `client_id/starred/received_at`.

---

## 2. UX 점수 · 최고 수준과의 격차

| 영역 | 점수 | 근거(첫 사용자·빈/오류·일관성·모바일·클릭 수·용어·되돌리기) |
|---|---|---|
| Q Talk | **6.5/10** | 강점: 옵티미스틱 전송·카드·번역·후보 배너·모바일 전환이 Slack 급으로 자연스럽다. 격차: ①답글/스레드/검색/전달 없음 → 10명 넘는 방에서 맥락을 못 쫓는다 ②메시지에서 업무로 가는 길이 «후보 추출» 한 길뿐(Slack «Create task from message»·Linear 연동은 메시지 1건이 단위) ③전송 실패가 글을 지운다(되돌리기 0) ④읽음은 숫자만 ⑤«내부 메모» 가 서버에만 있어 고객방에서 팀끼리 속말을 못 한다(RightPanel 노트로 우회 — 흐름 밖) ⑥ChatPanel 3,996줄 단일 파일(800줄 기준 5배)이라 수리 비용이 높다 |
| 게스트/고객 | **6/10** | 고객 계정 숨김은 꼼꼼하다. 격차: 게스트 5초 폴링(답이 늦게 보인다) · 첨부 불가인데 «왜 안 되는지» 문구 없음 · 고객이 «지금 누가 응대하나/언제 답이 오나» 를 모른다(Intercom 식 기대응답시간·담당자 표시 없음) |
| Q Mail | **5.5/10** | 메일을 «업무 큐» 로 다루는 판정·폴더·FAQ·브리프는 HubSpot Conversations 보다 앞선다. 격차는 **기본 메일 동작**: 전체답장·CC/BCC·자동완성·예약·템플릿·이미지 차단·다중 선택·담당 탭/알림 — Gmail 을 떠나지 못하게 하는 바로 그 항목들. 영어 UI 에 한글 25곳. 검색 필터(날짜·첨부·보낸사람) 서버는 되는데 UI 가 없다 |
| 알림 | **5/10** | 3채널·언어·presence 생략은 좋다. 격차: 사용자가 소음을 줄일 수단이 «종류별 끄기» 뿐 — Slack(방별 음소거·멘션만·방해금지·요약)·Linear(묶음 메일)에 비해 **조절 축이 없다.** 메일 알림 읽음 0 은 «쓸모없는 알림» 의 지표. 토스터 vs 드롭다운 탭 동작 불일치. 100건 이전 영영 못 봄 |
| 새 소식·번역 | **7/10** | 단순하고 맞다. 번역은 «내 언어로 자동» 이 없어 2개 국어 팀에서 매 방마다 설정해야 한다 |

---

## 3. 확장 기능 제안

| # | 문제(사용자 말) | 제안 | 기대효과 | 규모 | R | 우선 |
|---|---|---|---|---|---|---|
| 1 | «고객이 채팅으로 요청했는데 그걸 업무로 바로 못 만들어. 후보 추출은 엉뚱한 것도 올라와» | **메시지 툴바 «업무 만들기»** — 기존 `CreateDrawer` 업무 폼을 열고 제목=메시지 앞 60자·설명=본문·대화방·프로젝트·고객 prefill, 메시지에 `task_id` 연결(컬럼 이미 있음 `messages.task_id`) + 업무 카드 자동 게시. 메일도 같은 문(스레드 ⋯ «업무 만들기» — 후보 경유 없이) | 1클릭 전환, 출처 추적 | S | R=0 | **P0** |
| 2 | «긴 방에서 누구 말에 답한 건지 몰라» | **답글(인용) UI** — 서버·컬럼·서비스 인자(`replyTo`) 이미 있음. 툴바 «답글» → 입력창 위 인용 칩 → 버블에 인용 블록·클릭 시 원문으로 스크롤 | 맥락 유지 | S | R=0 | **P0** |
| 3 | «답장했는데 참조 걸린 사람들이 빠졌대» | **전체답장 + CC/BCC 칸** — 서버가 이미 받는다. 답장 모드 토글(답장/전체답장), 받는사람 줄에 «CC/BCC» 펼침 | 메일 기본기 | S | R=0(발송 자체는 기존 경로) | **P0** |
| 4 | «메일 알림이 너무 많이 와서 다 꺼버렸어» / «밤에 푸시 와» | **알림 조절 3축** — ①대화방 음소거(`conversation_participants.muted_until` 신설 → `notifyMany` 에서 제외) ②채팅 메일 채널을 «즉시» 가 아니라 5분 에스컬레이션 cron 으로만(기존 `unreadEscalationCron` 재사용, `projects.js` 메시지 notify 에 `skipChannels:['email']`) ③방해금지 시간(`users.quiet_hours` → 푸시·메일만 보류, 인앱은 그대로) | 소음 ↓, 알림 신뢰 회복 | M | R=0(외부 발송 **줄이는** 쪽) | **P0** |
| 5 | «받는 주소를 매번 타이핑해» | **받는사람 자동완성** — 소스: 고객(`clients.email`)·멤버·최근 주고받은 주소(`email_thread_participants`). 기존 `RecipientInput` 에 드롭다운(`dropdownShell`) | 오타·누락 ↓ | S | R=0 | P1 |
| 6 | «같은 답을 하루에 열 번 써» | **자주 쓰는 답장(템플릿)** — 워크스페이스 공용 + 개인, 변수 `{{고객명}}`, FAQ 제안 수락 결과를 템플릿으로 저장(이미 `email_faq_suggestions` 가 있다 — 그 결과를 재사용하는 문이 없을 뿐) | 응답 시간 ↓ | M | R=0 | P1 |
| 7 | «퇴근 전에 써 두고 아침 9시에 나가게» | **예약발송** — `email_drafts` 에 `send_at` 추가 + 기존 메일 cron 에 발송 틱, 발송 전 취소. «발송취소 10초» 는 같은 틱으로 (즉시 발송을 10초 지연) | 실수 회수 | M | **R=1**(외부 발송 트리거) — Fable 게이트 | P1 |
| 8 | «담당 걸어 놨는데 걔는 몰라» | 담당 지정 알림 + «담당» 탭(서버 폴더 이미 있음 `mailFolders.js:34`) + 공용 계정 새 메일 알림을 담당자·팔로워 우선 | 책임선 명확 | S | R=0 | P1 |
| 9 | «메일 열면 상대가 읽은 걸 알잖아» | 외부 이미지 차단 기본 + «이미지 보기»(발신자별 허용 기억 — `mail_sender_rules` 재사용) | 추적 차단·보안 | S | R=0 | P1 |
| 10 | «여러 통 골라서 한꺼번에 보관하고 싶어» | 행 체크박스 다중 선택 → 기존 `bulk-*`(`thread_ids` 이미 받음) | 처리 속도 | S | R=0 | P1 |
| 11 | «지난 달에 그 고객이 뭐라고 했더라» | **채팅 메시지 검색** — `messages.content` FULLTEXT(ngram) + `routes/search.js` 에 `messages` 종류 추가(권한은 `canAccessConversation`·`messageVisibility`) · 메일도 FULLTEXT 인덱스로 LIKE 스캔 대체 | 검색 가능 | M | R=0(읽기) · 스키마 변경 멱등 스크립트 | P1 |
| 12 | «영어 쓰는 팀원이 매번 번역 눌러» | 사용자별 «내 언어로 자동 번역»(`User.language` 활용, 대화방 설정 없이) — 번역 캐시 구조 그대로 | 2개 국어 팀 | M | R=0(Cue 사용량 ↑ — 한도 안) | P2 |
| 13 | «고객이 지금 답이 오는지 모르겠대» | 고객·게스트 화면에 «담당자·보통 N시간 안에 답장» 표시 + 게스트 폴링을 SSE 로 | 고객 안심 | M | R=0 | P2 |
| 14 | «읽었는지 누가 읽었는지» | 읽음 표시를 «n명» → 아바타 목록(`conversation_participants.last_read_at` 이미 있음) | 확인 ↓ | S | R=0 | P2 |

(이미 있어서 제안하지 않은 것: 후속 알림·FAQ 제안·AI 답장·브리프·라벨·발신자 규칙·상담 승격·게스트 링크·푸시 presence 생략.)

---

## 4. 개선 설계 (바로 구현 가능 수준)

### 4-1. 메시지 → 업무 만들기 (P0, S)
- **문제**: 메시지 단위 전환 문이 없다. 후보 추출은 «대화 전체» 가 단위라 원하는 한 문장을 업무로 못 만든다.
- **와이어**(메시지 툴바): `[😊 반응] [복사] [답글] [✓ 업무 만들기] [⋯]` → 누르면 **기존** `CreateDrawer` + Q Task 의 공용 추가 폼(CLAUDE.md «새로 만들지 않는다» — `QTaskPage` 의 `PanelAddForm` 을 공용으로 뺀 것). prefill: 제목(앞 60자, 줄바꿈 제거)·설명(본문 전체 + «출처: 대화방명 · 보낸이 · 시각»)·프로젝트(`conv.project_id`)·고객(`conv.client_id`)·담당자 비움. 저장 → `POST /api/tasks`(행동 계층 `taskActions.createTask`) 응답 `task.id` 로 `PATCH messages/:id {task_id}`(새 소라우트 1개 — `conversations.js` 에 두되 같은 경로 중복 가드 `duproute` 확인) + 기존 업무 카드 게시 경로(`kind:'card'`) 재사용.
- **파일**: `ChatPanel.tsx`(툴바 버튼·`onCreateTaskFromMessage`), `QTalkPage.tsx`(드로어 열기·prefill), `components/Common/CreateDrawer`, `routes/conversations.js`(task_id 연결), 메일은 `MailPage.tsx` ⋯ 메뉴 + `MailContextPanel` 같은 폼.
- **ko/en**: `qtalk.json chat.toolbar.createTask` «업무 만들기» / «Create task» · `chat.taskSource` «출처: {{conv}} · {{sender}}» / «From: {{conv}} · {{sender}}» · 성공 배지 없음(카드가 곧 피드백).
- **검증**: 실HTTP — 로그인 → 메시지 생성 → 업무 생성 → `messages.task_id` 일치 → 카드 1건 → 고객 계정에는 버튼 없음(403 대조군). e2e `canary-chat-more-menu.js` 에 툴바 항목 추가.

### 4-2. 답글(인용) (P0, S)
- **문제**: 플럼빙은 끝까지 있고 UI 만 없다(`reply_to_message_id`).
- **와이어**: 툴바 «답글» → 입력창 위 `┌ ↩ 홍길동: 견적서 다시 보내… ✕ ┐` 칩 → 전송 시 `replyTo` 전달(`qtalk.ts:484` 인자 그대로) → 버블 상단에 회색 인용 블록(앞 80자·클릭 시 원문으로 `scrollIntoView` + 1초 하이라이트). 삭제된 원문은 «삭제된 메시지». 고객·게스트도 볼 수 있음(원문 가시성은 `messageVisibility` 가 이미 가른다 — 원문이 안 보이면 인용도 «볼 수 없는 메시지»).
- **파일**: `ChatPanel.tsx`(상태 `replyTo`, 칩, 인용 렌더), `QTalkPage.tsx:1413`(인자 전달), `projects.js:1640` 목록 응답에 `reply_to:{id,sender_name,excerpt}` include(마스킹 뒤에 붙인다 — `maskDeletedMessages` 순서).
- **ko/en**: `chat.reply` «답글» / «Reply» · `chat.replyingTo` «{{name}}에게 답글» / «Replying to {{name}}» · `chat.replyUnavailable` «볼 수 없는 메시지» / «Unavailable message».
- **검증**: 전송 → DB `reply_to_message_id` → 재조회 응답에 excerpt · 원문 삭제 후 excerpt 비움(화이트리스트 마스킹 대조군) · 고객 계정으로 내부 원문 인용 시 excerpt 없음.

### 4-3. 전체답장 + CC/BCC (P0, S)
- **와이어**(답장 영역 머리): `[답장 ▾]` 메뉴 «답장 / 전체답장» · 받는사람 줄 오른쪽 `CC` `BCC` 링크 → 칸 펼침(`RecipientInput` 재사용 3개). 전체답장 기본값: to = 마지막 inbound 발신자 + 그 메일의 to/cc 중 **우리 주소 제외**(`mailIdentity.receivedAddressesOf` 의 보수 — 같은 함수군에 `replyAllRecipientsOf` 추가, 서버가 계산해 `mail-outgoing-identity` 응답에 실어 준다 — 화면이 주소를 스스로 세지 않는다).
- **파일**: `MailPage.tsx`(답장 폼 상태 `cc/bcc`, 모드), `RecipientInput.tsx`, `services/mailIdentity.js`, `email_threads.js:427`(identity 응답에 `reply_all`) · `:1049` 는 이미 cc/bcc 를 받는다. 초안에도 `cc_emails/bcc_emails` 이미 있음.
- **ko/en**: `reply.mode.reply` «답장»/«Reply» · `reply.mode.all` «전체답장»/«Reply all» · `compose.cc` «참조»/«Cc» · `compose.bcc` «숨은참조»/«Bcc» · 그리고 §1-C 의 누락 25키를 같은 커밋에 채운다.
- **검증**: dev 계정으로 inbound 1건 선택 → 전체답장 → 서버 `email_messages.to/cc` 저장값 = 미리보기 값 · 우리 별칭이 수신자에 없음(대조군: 별칭을 수신자에 넣었을 때 제거되는가) · 실제 외부 발송은 dev 에서 테스트 주소로만.

### 4-4. 알림 조절 — 음소거·메일 묶음·방해금지 (P0, M)
- **문제**: 채팅 1건 = 메일 1통(기본 ON). 조절 축 없음. `leave`·`survey` 는 끌 수도 없다.
- **설계**:
  1. `conversation_participants.muted_until DATETIME NULL`(멱등 스크립트). 대화방 ⋮ «알림 끄기(1시간/오늘/해제할 때까지)». `notifyMany` 호출 전 `projects.js:1395` 에서 muted 참여자 제거(멘션은 예외 — Slack 계약과 같게). LeftPanel 행에 🔕 아이콘, 배지는 유지하되 회색.
  2. 채팅 `message` 알림의 메일 채널: 즉시 발송 제거(`skipChannels:['email']`) → 5분 미읽음이면 기존 `unreadEscalationCron` 이 묶어 1통(이미 «최대 10건 요약» 구현). 설정 화면 `message` 행의 «메일» 열 설명을 «5분 안 읽으면 묶어서» 로.
  3. `users.quiet_hours JSON {start:'22:00', end:'08:00', tz}` — `notify()` 푸시·메일 분기 앞에서 보류(인앱 행·소켓은 그대로). 보류분은 에스컬레이션 cron 이 종료 시각에 1통.
  4. `EVENT_KINDS` 에 `leave`·`survey` 추가(모델 ENUM 과 **한 목록**을 공유하도록 `models/NotificationPref.js` 에서 export), 설정 화면 행 추가.
- **파일**: `routes/notifications.js:12-35,279-301`, `routes/projects.js:1395`, `services/unreadEscalationCron.js`, `models/ConversationParticipant.js`, `LeftPanel.tsx:269-308`(⋮ 메뉴), `NotificationSettings.tsx`, `pages/Settings` 개인 설정(방해금지).
- **ko/en**: `left.mute` «알림 끄기»/«Mute» · `left.muteFor.hour|today|forever` · `left.unmute` «알림 켜기»/«Unmute» · `settings.quietHours` «방해 금지 시간»/«Quiet hours» · `settings.quietHoursHint` «이 시간엔 푸시·메일을 보류하고 끝나면 한 번에 보냅니다»/«Push and email are held and sent together afterwards».
- **검증**(R=0 이지만 발송 경로라 **실HTTP + email_logs 로 수치**): 음소거 전 메시지 → 알림 행 1 / 음소거 후 → 0, 멘션 → 1(대조군) · 메시지 후 `email_logs` 즉시 0건 → 5분 후 cron 1건 · 방해금지 중 push_logs 0 · `PUT /prefs {leave,email,false}` 200.

### 4-5. 전송 실패 복구 + 로드 오류 상태 (P1, S)
- **문제**: `ChatPanel.tsx:768-770` 이 응답 전에 입력을 비운다. 실패하면 글이 사라진다. 로드 실패는 스켈레톤 영구·«대화 없음» 위장.
- **설계**: 실패 버블을 지우지 말고 `status:'failed'` 로 남겨 «전송 실패 · [다시 보내기] [삭제]» (Slack 과 같음). 입력 초안(`draftKey`)은 성공 응답 뒤에 지운다. `QTalkPage.tsx:888-895` 2회 실패 → `messagesLoading=false` + `DetailFallback status="error"` + 재시도. 목록 실패 → `[]` 대신 오류 상태(`left.loadFailed`).
- **파일**: `ChatPanel.tsx`, `QTalkPage.tsx:1480-1487,888-895,493,977`.
- **ko/en**: `chat.sendFailedRow` «전송 실패»/«Not sent» · `chat.resend` «다시 보내기»/«Retry» · `left.loadFailed` «대화 목록을 불러오지 못했습니다»/«Couldn't load conversations».
- **검증**: 네트워크 차단(puppeteer `setOfflineMode`) 후 전송 → 실패 행 유지 → 온라인 → 재전송 1 POST · 403 대조군(보관된 방) → 실패 행.

### 4-6. 메일 «담당» 탭 + 담당 알림 + 다중 선택 (P1, S)
- **와이어**: 폴더 탭에 «담당 n» 추가(서버 `folder=assigned` 그대로, 배지는 `classifyMailThreads` 한 공식에서). 행 왼쪽 체크박스(hover/롱프레스) → 상단 «n건 선택: [읽음] [확인완료] [보관] [라벨]» → 기존 `bulk-*` 에 `thread_ids`. 담당 지정 시 `notify({eventKind:'mail', titleSpec:{feature:'mail', action:'mail_assigned', subject}})`(`notifyTitle.ACTIONS` 에 ko/en 추가).
- **파일**: `MailPage.tsx:188,294-311,1105-1115,1181`, `email_threads.js:1836`, `services/notifyTitle.js`.
- **검증**: 지정 → 상대 알림 행 1(자기 지정은 0) · 체크 3건 보관 → 응답 updated 3 = 라벨 수치.

---

## 5. 버그 · 위험 발견

| # | 심각도 | 내용 | 근거 |
|---|---|---|---|
| A | **높음(권한 불일치)** | 워크스페이스 **admin** 역할: 화면은 ⋮ 보관·보관함 진입을 보여 주지만(`QTalkPage.tsx:329,332` admin 포함) 서버 보관은 `wsMember.role==='owner'`/프로젝트 오너/플랫폼 관리자만(`conversations.js:1329-1342`) → **403**. 같은 계열: 타인 메시지 삭제(958)·메시지 핀(979)·참여자 내보내기(541)·`isAdmin`(18) 전부 `businessRole==='owner'` 만. PERMISSION_MATRIX «admin = owner_only 외 전권» 과 어긋남. 메일 쪽은 `canManageAccount` 가 admin 을 포함하므로 채팅만 샌다 | `conversations.js:18,541,958,979,1014,1329` |
| B | 중간 | 내보내기 버튼이 모든 멤버에게 보이지만 서버는 본인/오너만 → 멤버가 누르면 403 (문구는 서버 하드코딩 한글 `'본인 나가기 또는 오너만…'`) | `ChatSettingsModal.tsx:233` ↔ `conversations.js:541-544` |
| C | 중간 | 채팅 전송 실패 시 입력 소실(되돌리기 없음) · 메시지 로드 2회 실패 시 스켈레톤 영구 · 목록 실패를 빈 상태로 위장 | `ChatPanel.tsx:768-770`, `QTalkPage.tsx:888-895,493,977,1480-1487` |
| D | 중간 | 알림 종류 `leave`·`survey` 를 사용자가 끌 수 없음(`PUT /prefs` 거절) — 모델 ENUM 과 라우트 목록이 두 벌 | `notifications.js:12-35` vs `NotificationPref.js:105-121` |
| E | 중간 | 채팅 메시지마다 참여자 전원 메일 즉시 발송(스로틀 없음) — 외부 발송량·스팸 평판 위험. dev 30일 메일 알림 779건 읽음 0 | `projects.js:1395-1410`, `notifications.js:279-301`, dev DB |
| F | 중간 | 메시지 전송 경로 **두 벌**(`conversations.js:732` vs `projects.js:1264`)이 이미 갈라져 있다 — 옛 경로엔 내부 메모·감사 로그·staff 룸, 새 경로엔 답글·번역·Cue·자동추출. 앱이 쓰는 새 경로에는 **AuditLog 0**(«모든 CUD 감사» 규칙 위반), 옛 경로는 canary 전용. 한쪽으로 합치고 가드(`duproute` 는 다른 파일이라 못 잡는다) | `conversations.js:732-910`, `projects.js:1264-1505` |
| G | 낮음(진행 중 작업 관찰) | 다른 작업방의 `notificationTargets.js:17-19` 링크 파싱이 `/talk/(\d+)` 인데 실제 채팅 링크는 `/talk?conv=` (`notification_link.js:23`) — entity_type 없는 옛 채팅 알림은 판정되지 않는다. `event` 별칭·`post` 미포함. **건드리지 않았다** — 그 방에 전달할 것 |
| H | 낮음 | i18n 양쪽 누락: 메일 25키 · 알림 페이지 3키 · 토스터 1키(§1-C/§1-D). 서버 하드코딩 한글: 게스트 알림 제목 `'(게스트)'`·`'고객이 계정을 요청했습니다'`·`ctaLabel '대화 열기'` 는 `notifyTitle` 규약(«기능 · 행위»)을 안 탄다 | `guest.js:261,404,409` |
| I | 낮음 | 토스터 클릭은 같은 탭 이동 ↔ 드롭다운/페이지는 새 탭 — «얹히는 진입점은 새 탭» 규칙과 불일치. 토스트 억제 시에도 소리 재생 | `NotificationToaster.tsx:290-291,588` |
| J | 낮음 | 알림 페이지 `limit:100` 고정, 서버 커서 미사용 → 100건 이전 영구 미도달 | `NotificationsPage.tsx:22`, `notifications.js:419` |
| K | 낮음 | 죽은 라우트 11개(§1-E) — 특히 `conversations.js` Cue 4종·승인/거절 2종은 `projects.js` 에 산 버전이 따로 있어 **두 벌 규칙** 상태. 메일 `backfill` 은 «기존 계정은 이 버튼으로» 주석과 달리 버튼 없음 | `conversations.js:1068-1294`, `email_accounts.js:446` |
| L | 낮음 | `push_service.js:12` «topic = tag» 주석은 거짓(헤더 안 보냄) · `notifications.js:102`·`NotificationToaster.tsx:4` 주석도 옛 동작 | 해당 줄 |
| M | 낮음(보안) | 메일 외부 이미지 무차단 — 열기만 해도 발신자가 열람 시각·IP 를 안다(추적 픽셀) | `mailSrcDoc.ts:94-100` |
| N | 낮음 | KB `auto_translate`·`translation_visibility` 저장만 되고 읽는 곳 0(설정 UI 가 거짓 약속) | `routes/kb.js:1283,1329,1370` |
