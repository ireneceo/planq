# 제품 감사 — `shell` (앱 껍데기 · 첫 경험 · 설정 · 관리자) — 2026-10-07

> 독립 감사 · 저장소 무변경 · 근거는 전부 `파일:줄` (dev-frontend/src 기준 FE, dev-backend 기준 BE). dev DB 는 SELECT 만.

## 요약 (5줄)
1. **첫 경험의 뼈대는 좋다** — 가입 1화면에 워크스페이스까지 만들고 즉시 로그인, 이메일 인증이 길을 막지 않으며(`BE routes/auth.js:218-492`), 서버가 실데이터로 채우는 온보딩 체크리스트가 있다(`components/Onboarding/OnboardingChecklist.tsx`, `BE services/onboarding.js`). 비밀번호 가입 기준 첫 업무까지 **약 7클릭**.
2. **그런데 초대 경로가 네 군데서 끊긴다** — 초대 링크에서 구글 가입하면 초대가 버려지고(새 워크스페이스가 생긴다), 가입↔로그인 링크가 `?redirect` 를 떨군다, 기존 계정이 멤버 초대를 받아도 `active_business_id` 가 안 바뀌어 **옛 워크스페이스에 착지**한다, 409 는 영어 원문으로 뜬다. 고객·팀원을 들이는 것이 이 제품의 가치인데 그 문이 가장 약하다.
3. **메뉴 인지 부담이 크다** — 오너 사이드바 상위 20개 · 목적지 49개, 설정만 21곳(하위 ~35절). 숨기기·순서·즐겨찾기·설정 검색 **없음**. 게다가 `business_member_permissions` 를 **화면이 전혀 읽지 않아** «숨김» 으로 둔 메뉴도 그대로 보이고 눌러야 403 이 난다(서버는 94곳 `requireMenu`).
4. **일관성은 "같은 팔레트, 다른 손"** — 페이지에 raw hex 9,156개(129색)·`@media(max-width)` 316곳 vs 토큰 사용 18곳, 색·대비 토큰 없음(`#94A3B8` 823회, 흰 배경 대비 ≈2.6:1 AA 미달). PageShell 70/232 파일, 자체 헤더 30. 상세 밴드·드로어 폭 등은 가드로 잠겼지만 **색·간격·브레이크포인트는 잠기지 않았다**.
5. **성능** — 첫 로드 JS 1.22MB(gz 392KB, 74파일) + i18n **31개 네임스페이스를 전부**(ko gz 212KB, 요청 31건) 첫 화면에서 받는다(`i18n.ts:14`). 설정 허브 청크 377KB 는 15개 절을 전부 정적 import(`WorkspaceSettingsPage.tsx`, lazy 0건).

---

## 1. 구현 상태

| 영역 | 기능 | 상태 | 근거 / 빠진 것 |
|---|---|---|---|
| 랜딩 | 홈·기능·요금·블로그·문의·진단 | ✅ | `pages/Landing/*` 12화면, SEO 프리렌더(CLAUDE.md 박제). 로그인해도 `/` 는 랜딩(`RootRoute.tsx:1-7`) — 의도된 POS 패턴 |
| 가입 | 1화면 가입 + 워크스페이스 동시 생성 + 즉시 로그인 | ✅ | `RegisterPage.tsx:323-331,470` · `auth.js:375-424` (Starter 14일 체험, Cue AI 멤버 자동) |
| 가입 | 이메일 인증 | 🟡 | 발송은 하지만 **아무것도 막지 않고 알리지도 않는다**(`auth.js:482-488`, 로그인 미검사 `:496-583`). 인증 성공 문구 "모든 기능을 사용할 수 있습니다" 는 거짓(잠긴 게 없다). `POST /auth/resend-verify-email`(`auth.js:1063`) **호출처 0** 인데 VerifyEmailPage 오류 문구는 "로그인 후 재발송" 을 안내. dev DB: 사용자 242 중 인증 5 |
| 가입 | 구글/애플 가입 | 🟡 | 작동. 워크스페이스 이름 "{이름} 의 워크스페이스" 묻지 않고 생성(`oauth/core.js:98`), 착지 `/inbox`(체크리스트 없는 화면, `:155-160`) |
| 온보딩 | 체크리스트(워크스페이스 4 + 개인 4) | ✅ | `OnboardingChecklist.tsx` · Dashboard `:126` · 설정 brand 탭 `:948`. 서버 판정, «왜»·«열기»·«사용법(Cue→위키)» |
| 온보딩 | 제품 투어 · 샘플 데이터 · 환영 화면 · `/onboarding` 라우트 | 🔴 | 라이브러리 0, seed 스크립트는 가입에서 안 돈다, `/onboarding` 은 `TabMirror.tsx:15` 와 주석에만 |
| 빈 상태 | Q task · Q talk · 고객 | ✅ | CTA 있음(`QTaskPage.tsx:2403`, `ChatPanel.tsx:1203`, `ClientsPage.tsx:469`) |
| 빈 상태 | Q project · Q talk 채널 없음 · 대시보드 | 🟡 | 프로젝트 빈 상태 CTA 가 **같은 화면에 있는 생성 버튼을 두고 /talk 로 보낸다**(`QProjectPage.tsx:415,432-441`); 채널 없음은 CTA 없음(`ChatPanel.tsx:1241`); 대시보드는 hero 없이 한 줄 문구 3개 |
| 초대 | 멤버·워크스페이스 고객·프로젝트 고객 수락, 환영 대화방 | ✅ | `invites.js:95-248`, `clientOnboarding.js:22` |
| 초대 | 초대→구글 가입 | 🔴 | `routes/oauth/*` 에 invite/redirect 전달 **0** → 초대 버려지고 새 워크스페이스 생성 |
| 초대 | 기존 계정의 멤버 초대 수락 | 🔴 | `invites.js` 에 `active_business_id` 갱신 **0건** → 수락 후 옛 워크스페이스로 착지 |
| 초대 | 가입↔로그인 링크 redirect 보존 | 🔴 | `RegisterPage.tsx:489` `/login`, `LoginPage.tsx:661` `/register` 모두 bare |
| 로그인 | 아이디/이메일 · 기억하기 · 구글/애플 · 비번찾기 · 삭제유예 복구 · 레이트리밋 문구 | ✅ | `LoginPage.tsx` · `security.js:334-365`. 단 가입(3/시간/IP)·비번찾기 리밋은 **영어 원문**(`apiError.ts` 미매핑) |
| 내비 | 사이드바(섹션 4 + 관리 3 아코디언) · 접기 · 모바일 드로어 | ✅ | `MainLayout.tsx:1474-1860`(2,390줄 수기 JSX) |
| 내비 | 메뉴 정본 `config/navMenus.ts` 와 사이드바 동기 | 🟡 | 이미 이탈: `/attendance`·`/business/settings/attendance`·`/activity`·`#announcement` 는 사이드바에만(`MainLayout:1636,1734,1745,1408`) → 전역검색·탭 `+` 에서 못 찾음 |
| 내비 | 메뉴 권한(business_member_permissions)의 화면 반영 | 🔴 | `services/permissions.ts` 를 읽는 곳은 `MemberPermissionMatrix`·`DefaultBillingOwnerSection` 뿐. 사이드바는 role 만(`hasBiz`) → «숨김» 메뉴가 보이고 눌러야 403 |
| 내비 | 메뉴 숨기기·순서·즐겨찾기 | 🔴 | 없음 |
| 멀티탭 | 탭 열기/LRU 4 · 소프트캡 10 · 복원 · 드래그 · 우클릭 · 모달 열린 탭 보호 | ✅ | `stores/tabStore.ts:49-50,555`, `TabStrip.tsx` |
| 멀티탭 | 11번째 탭 열면 **말없이** 오래된 탭 닫힘 · 탭 키보드 단축키(Ctrl+Tab/W/1-9) · «모든 탭» 오버플로 메뉴 | 🔴 | `tabStore.ts:555`; `tabs.overflow` 문구만 있고 UI 없음 |
| 워크스페이스 전환 | 드롭다운 2클릭 · 다창 동기(`WorkspaceSyncGuard`) · 409 stale | ✅ | `WorkspaceSwitcher.tsx`, `AuthContext.tsx:1003`. 전환 후 **항상 `/talk`** 로 하드 이동(`:124,136`) — 보던 화면 상실 |
| 전역검색 | ⌘K · 12 엔티티 · 메뉴명 · 최근 · Cue 폴백 | ✅ | `GlobalSearchModal.tsx:46-47,196-218`. 결과 ↑↓ 키 이동 없음(미확인→코드에 없음) |
| 단축키 | 6종 등록 | 🟡 | **충돌 2**: `Ctrl+\` 가 전역검색(`MainLayout:1002`)과 우측패널 토글(`QTalkPage:458`,`MailPage:466`,`RightPanel:177`) 동시 발화; Windows `Ctrl+/` 가 패널 토글+Cue 도움말. `⌘T` 가 브라우저 새 탭을 가로챔(`CueTaskBar.tsx:82`). 단축키 목록 화면 **없음**. "⌘K" 힌트가 Windows 에서도 ⌘ |
| 모바일 | 햄버거 드로어 · 모바일 헤더 · 탭 550px 게이트 · 안전영역 · 키보드 계약 | ✅ | `MainLayout:98-124,1178-1210`, `tabsBeta.ts:32`, CLAUDE.md mobilesweep |
| 모바일 | 하단 내비 | 🔴 | 앱 셸에 없음(Guest·ClientHome 에만). 폰에서 20개 메뉴는 전부 햄버거 2탭 |
| 네이티브 | Capacitor 7 원격 셸 · 푸시 · 딥링크 · 오프라인 폴백 · 다운로드 페이지 | ✅ | `capacitor.config.ts`, `NativeBridge.tsx`, `DownloadAppPage.tsx` |
| 설정 | 허브 14탭 + 개인 6 + 멤버/조직 | ✅ | `WorkspaceSettingsPage.tsx:529`, `MainLayout:2077-2290` |
| 설정 | 설정 검색 · 개인/팀 구분 | 🔴/🟡 | 검색 없음. 개인 설정이 `/business/settings/*?scope=personal` 에 얹혀 있어 사이드바가 쿼리로 추론(`MainLayout:1108-1121`). «내 업무 환경»(nav) vs «내 업무 설정»(페이지 제목) 불일치 |
| 설정 | 워크스페이스 **admin** 역할의 설정 편집 | 🔴 | `isAdmin = owner || platform_admin`(`WorkspaceSettingsPage.tsx:514`) → admin 은 브랜드·업무환경·권한 **읽기전용 배너**. 서버는 admin 허용(`businesses.js:1039-1047`). 권한 매트릭스도 `isOwner={isAdmin}`(`:1339`) 이라 admin 편집 불가(힌트 문구는 "오너와 관리자만") |
| 권한 | 13메뉴 × 3단계 매트릭스 · 컬럼별 write 인원 · Q bill 0명 경고 | ✅ | `MemberPermissionMatrix.tsx:17,173` |
| 권한 | 역할 템플릿·일괄 적용·행/열 «전부»·복사 · 단계 뜻 설명 | 🔴 | 없음. desc 는 "보기/읽기/쓰기", 옵션은 "숨김/읽기/쓰기" |
| 조직 | 부서·팀·팀장·멤버 배치 | ✅ | `OrgPage.tsx`, `org.js:58-250`. 쓰임은 대시보드 범위·근태 집계·프로젝트 owner_department 뿐 — 담당자 선택·필터·권한엔 안 쓰임. dev DB teams 0 |
| 프로필 | 계정/워크스페이스/Q note 프로필 분리 · 아바타 · 보조 이메일 OTP · 언어 | ✅ | `ProfilePage.tsx` 1,491줄 |
| 내 데이터 | 내보내기(ZIP: 파일+글 HTML) · 다른 워크스페이스로 복사/이동 · 워크스페이스 백업 | 🟡 | `export.js:60-150`. **업무·메시지·메일·일정·청구·프로필은 안 들어간다** — GDPR 개인정보 내보내기가 아니라 자료 내보내기. 백업은 서버 admin 허용(`:198,209`) UI 는 owner 만. 고객(client) 은 내보내기 전무 |
| 계정 삭제 | 자가 삭제 · 30일 유예 · 복구 · 익명화 cron · 오너 워크스페이스 이전 선행 | ✅ | `account_deletion.js:98-167`, `accountAnonymize.js` |
| 계정 삭제 | OAuth 전용 계정 삭제 | 🔴 | `oauth_otp_required` 400(`account_deletion.js:107-110`) — OTP 단계 미구현, 화면 안내 없음 |
| 계정 삭제 | «먼저 내보내기» 링크 | 🔴 | `AccountDeletionSection.tsx:89` `/business/settings/data-export` 에 `?scope=personal` 없음 + 일반 `<a>`(전체 리로드) — 비오너는 소개문만 보이는 페이지 |
| 워크스페이스 삭제 | | 🔴 | 엔드포인트·UI 없음(단독 오너 계정 삭제 시 간접 소프트삭제만). 소유권 이전·나가기는 있음 |
| 플랫폼 관리자 | 18 화면(대시보드·사용자·워크스페이스·구독·결제·청구설정·문의·피드백·메일/푸시/감사 로그·플랫폼설정·랜딩방문·개발현황·Cue질문·위키·업데이트·알림) | ✅ | `App.tsx:569-664`, `navMenus.ts:103-126` |
| 플랫폼 관리자 | 사용자 정지/차단 · 손님 문의 메일 회신 · 세금계산서 실패/대기 큐 · 위키 질문 로그/클러스터 | 🔴 | 정지는 라우트·UI 둘 다 없음(감사 필터엔 `user.status_change` 가 있음 `AdminAuditLogsPage:36`); `inquiries.js` PATCH 는 메일 안 보냄; 호출처 0 라우트 4개: `admin_billing.js:403,418`, `admin_wiki.js:237,266` |
| 도움말 | Q helper 드로어(5모드) · 경로 인식 위키 컨텍스트 · 공개 /guide · 검색 · 로그인 사용자 문의(feedback kind=inquiry) | ✅ | `CueHelpDrawer.tsx:34,271,355-382`, `wiki.js:169-192`. seed 17분류 86글(dev DB 138글, 전부 public) |
| 피드백 | 내 피드백 스레드 · 후속 질문 · 관리자 답변 알림 | ✅ | `MyFeedbackPage.tsx`, `feedbackRespond.js:17-33` |
| 새 소식 | DB(help_articles blog_category=updates) · 개별/전체 읽음 | ✅ | `whats_new.js`, `useWhatsNew.ts:64,83` |
| 약관 | 공개 페이지 · 버전 재동의 모달 · 버전 bump 스크립트 | 🟡 | `TermsReacceptModal.tsx:29-42`. 시행일이 페이지에 하드코딩(`TermsOfService.tsx:4`) — DB `terms_version` 과 따로 논다 |
| 죽은 코드 | `pages/ComingSoon/ComingSoonPage.tsx` · `pages/Landing/ComingSoonPage.tsx` | 🔴 | import 0 |
| i18n | auth `verify.*`·`register.terms*/privacy*` 블록 ko/en **둘 다 없음**(인라인 한글 기본값으로만 렌더 → 영어 사용자에게 한글) · `adminUsers.*` 10키 누락 | 🔴 | `python3` 로 확인: `'verify' in ko/auth.json` → False |

---

## 2. UX 점수 · 최고 수준과의 격차

| 영역 | 점수 | 근거 · 격차 (Linear/Notion/Slack/HubSpot 대비) |
|---|---|---|
| 첫 경험(랜딩→가치) | **6/10** | 가입 1화면·즉시 로그인·체크리스트는 급이 맞다. 격차: ①환영/역할 질문 없음(Notion 은 "무슨 용도?" 1문항으로 템플릿을 고른다) ②샘플 데이터·템플릿 0 — dev 29 워크스페이스 중 **19개가 업무 0건**(66%)이라 «빈 워크스페이스» 가 기본 상태인데 빈 대시보드는 한 줄 문구뿐 ③OAuth 가입자는 체크리스트를 못 본다 ④"팀원 1명 초대" 가 체크리스트에 없다(고객 초대만) — Slack/Linear 의 활성화 지표 1순위 |
| 초대·팀 합류 | **4/10** | 네 군데 끊김(요약 2). 초대받은 사람의 첫 화면이 «옛 워크스페이스» 또는 «엉뚱한 새 워크스페이스». 초대 이메일 미리채움 없음. 정원 초과 422 는 일반 오류 |
| 내비게이션·인지 부담 | **5/10** | 상위 20·목적지 49·설정 21. Linear 는 상위 7개, Slack 은 5개 + 검색. «협업» 섹션 11개가 전부 같은 무게(Q 접두 11개 — 이름만으로 기능을 못 가른다: Q info vs Q docs vs Q note vs Q file). 권한으로 숨긴 메뉴도 보인다. 즐겨찾기·최근 없음. 전역검색은 좋다(12 엔티티) |
| 멀티탭 | **7/10** | 데스크탑 생산성 도구로 드물게 좋은 기능. 격차: 조용한 탭 폐기, 키보드 없음, 오버플로 메뉴 없음 |
| 설정 | **5/10** | 21곳·검색 없음·개인/팀이 URL 로 얽힘·admin 역할이 읽기전용 오진. 자동저장 ~72%(55/75) 로 «어디는 되고 어디는 안 되는» 상태(CLAUDE.md 가 이미 지적한 모양). 파괴 동작 9곳이 확인 없이 즉시 실행(§5) |
| 권한 | **5/10** | 매트릭스 자체는 명료(즉시 저장·플래시·인원 수). 격차: 템플릿/프리셋 없음(HubSpot 은 역할 세트), 단계 뜻 미설명, 화면 미반영 |
| 모바일·네이티브 | **6/10** | 키보드·안전영역·패널 뒤로가기 계약이 촘촘하다. 격차: 하단 내비 없음(Slack/Linear 모바일은 4~5 탭), 20개 메뉴 햄버거 2탭, 반응형 토큰 미사용 316곳 |
| 접근성 | **4/10** | aria-label 564 vs 버튼 ~1,237, `outline:none` 301곳, skip link 0, 사이드바가 `<nav>` 아님, 대비 토큰 없음(`#94A3B8` 2.6:1 × 823). focus-visible·reduced-motion 전역 규칙은 있음 |
| 디자인 일관성 | **5/10** | 팔레트는 사실상 하나(slate/teal 상위 12색이 대부분)라 «보이는» 일관성은 중간 이상. 그러나 토큰이 아니라 **손으로 같은 값을 9천 번 적은** 상태 — 다크모드·브랜드 색 변경·대비 수정이 사실상 불가능. 가드로 잠긴 것(헤더 밴드·드로어 폭·아바타 모양)은 잘 지켜진다 |
| 플랫폼 관리자 | **7/10** | 18 화면·사칭·감사·플랫폼설정까지 운영 도구로 충실. 격차: 사용자 정지 없음, 손님 문의 메일 회신 없음 |
| 도움말·피드백 | **8/10** | 경로 인식 위키 + LLM Q&A + 문의 스레드 + 관리자 답변 알림 — 이 영역은 최고 수준에 가깝다. 격차: 단축키 도움말 없음, 드로어 진입점이 «⌘?» 와 우하단 버튼뿐(사이드바에 «도움말» 항목 없음) |
| 성능 | **6/10** | 첫 로드 gz 392KB JS + 212KB i18n(31요청) ≈ 600KB·105요청. Linear 류는 초기 <300KB. 코드 분할은 라우트 단위로 잘 돼 있음(346 청크) |
| **전체 일관성 점수** | **5.5/10** | 구조 계약(밴드·드로어·휴지통·첨부·자동저장)은 박제·가드까지 돼 있어 **같은 일이 같은 모양**인 비율이 높다. 반면 색·간격·브레이크포인트·권한 반영·메뉴 정본은 손에 달려 있고 이미 이탈했다 |

---

## 3. 확장 기능 제안

| # | 문제(사용자 말) | 제안 | 기대효과 | 규모 | R | 우선 |
|---|---|---|---|---|---|---|
| E1 | "초대 링크 눌러서 구글로 가입했더니 내 워크스페이스가 따로 생겼어요" | OAuth 시작 시 `invite_token`/`redirect` 를 state 에 싣고 `finishOauthLogin` 뒤 수락 → 초대 워크스페이스로 착지. 멤버 초대 수락 시 `active_business_id` 갱신 | 초대 성공률(가입→합류) 직접 상승 | S | 0 (인증 끝부분은 한 벌 `oauth/finish.js` — 그 안에서만) | **P0** |
| E2 | "가입했는데 뭘 해야 할지 모르겠어요" (빈 워크스페이스 66%) | 가입 직후 **1문항 역할 선택**(에이전시/컨설팅/외주/기타) → 그에 맞는 샘플 프로젝트 1 + 업무 3 + 고객 1(«예시» 태그, 한 번에 삭제) + 체크리스트에 «팀원 초대» 단계 추가. OAuth 착지도 대시보드로 | Time-to-value: 7클릭 → 첫 화면에서 «살아 있는» 제품 | M | 0 | **P0** |
| E3 | "쓰지도 않는 메뉴가 11개나 보여요" / "권한 숨김 했는데 그대로 보여요" | `GET /api/businesses/:id/me/permissions` 를 부팅 때 받아 사이드바·전역검색·탭 `+` 가 **같은 `visibleNavMenus`** 로 숨김 적용 + 오너가 워크스페이스 단위로 «안 쓰는 Q 끄기»(이미 있는 permissions 표로 기본값 none) + 개인 «즐겨찾기» 상단 고정 | 인지 부담 20→사용자가 정한 수. 권한 화면이 거짓말하지 않음 | M | 0 (숨김은 서버 403 위에 얹는 표시뿐) | **P0** |
| E4 | "설정이 어디 있는지 못 찾겠어요" | 설정 검색(전역검색 ⌘K 에 «설정» 엔티티 추가 — `navMenus` 하위 항목 + 각 절 제목을 색인) + 개인/워크스페이스를 `/me/settings/*` · `/business/settings/*` 로 URL 분리 | 설정 도달 클릭 3→1 | S | 0 | P1 |
| E5 | "권한을 팀원마다 13칸씩 고르기 힘들어요" | 역할 프리셋 3종(PM / 실무자 / 뷰어) + «이 사람과 같게» 복사 + 행/열 «전부» + 각 단계의 뜻 툴팁(메뉴별 read 가 무엇을 허용하는지 `PERMISSION_MATRIX.md` 에서 생성) | 권한 설정 시간 1/5 | M | 0 (쓰기는 기존 API) | P1 |
| E6 | "다른 워크스페이스로 바꾸면 보던 게 날아가요" | 전환 시 하드 이동을 없애고 `setTabScope` 로 새 범위의 마지막 탭 복원(지금은 항상 `/talk`) + 전환 드롭다운에 ⌘1~9 | 전환 비용 감소 | S | 0 | P1 |
| E7 | "탭이 조용히 사라져요" / "탭 단축키 없어요" | 11번째 탭에서 오래된 탭 닫기 전 토스트 아닌 **탭 줄 안 배지**로 알림 + «모든 탭» 오버플로 메뉴(문구 이미 존재) + Ctrl+Tab/Ctrl+W/Ctrl+1-9 + 단축키 도움말(`?`) | 데스크탑 파워유저 유지 | S | 0 | P1 |
| E8 | "폰에서 메뉴 찾느라 햄버거를 두 번 눌러요" | 폰(≤640) 하단 내비 4+1: 확인필요 · Q talk · Q task · 캘린더 · 더보기(드로어). Guest/ClientHome 의 기존 하단탭 컴포넌트를 공용으로 빼서 재사용 | 폰 핵심 도달 2탭→1탭 | M | 0 | P1 |
| E9 | "내 데이터 내보내기가 파일밖에 없네요" | 내보내기 ZIP 에 업무·메시지·일정·청구 JSON/CSV 포함(관리자용 `GET /admin/users/:id/data-export` 가 이미 JSON 을 만든다 — 그 함수를 본인용으로 공유) + 고객 역할도 자기 대화·업무 내보내기 | 개인정보법·GDPR 요구 충족, 이탈 시 신뢰 | M | 0 | P1 |
| E10 | "구글로 가입했는데 탈퇴가 안 돼요" | OAuth 전용 계정 삭제 OTP(보조이메일 OTP 흐름 `users.js:523-753` 재사용) | 막다른 길 제거(법적 요구) | S | **R=1(삭제)** → Fable | P1 |
| E11 | "손님 문의에 답장을 보낼 수가 없어요"(관리자) | `inquiries.js` PATCH 에 `reply_email` 발송(ConfirmDialog 에 받는 주소 표기 — CLAUDE.md 외부발송 규칙) | 랜딩 문의 응답률 | S | **R=1(외부 발송)** → Fable | P2 |
| E12 | "사용자를 정지시킬 방법이 없어요"(관리자) | `users.status='suspended'` 전이 라우트 + 로그인 차단 + 감사 `user.status_change`(필터엔 이미 있음) | 운영 안전 | S | **R=1(인증)** → Fable | P2 |
| E13 | "영어로 쓰면 약관 동의·인증 화면이 한국어예요" | auth `verify.*`·`register.terms*`·`adminUsers.*` 키 ko/en 추가 (가드 parity 가 못 잡는 이유: 키 자체가 양쪽에 없어 패리티는 통과한다 — **미사용 키 검출 가드** 추가 권고) | 영어 사용자 첫 화면 | S | 0 | P1 |
| E14 | (성능) 첫 로드 105요청 | i18n 을 `ns:['common','layout','auth']` 만 init 하고 라우트별 `useTranslation(ns)` 지연 로드(`i18next` 는 ns 요청 시 자동 로드); `WorkspaceSettingsPage` 15절 `lazy()` | 첫 로드 요청 105→~45, i18n 212KB→~40KB | S | 0 | P1 |

(이미 있어 제안하지 않은 것: 온보딩 체크리스트·경로 인식 도움말·문의 스레드·새 소식·약관 재동의·계정 삭제 유예·워크스페이스 소유권 이전·전역검색·다창 워크스페이스 동기 — 전부 확인됨.)

---

## 4. 개선 설계 (바로 구현 가능 수준)

### D1. 초대 경로 봉합 (E1) — S · P0 · R=0
**문제** 초대→구글 가입 시 초대 유실 / 가입↔로그인 링크가 redirect 유실 / 멤버 초대 수락 후 옛 워크스페이스 착지 / 409 영어.
**설계**
- `RegisterPage.tsx:489`, `LoginPage.tsx:661` — 링크를 `` `/login?redirect=${encodeURIComponent(redirect)}` `` 식으로 현재 `redirect` 를 그대로 싣는다(이미 `?redirect` 를 읽는 코드가 양쪽에 있다).
- `GoogleAuthButton.tsx:74` — 시작 URL 에 `&redirect=`(= `/invite/:token`) 를 붙인다. `routes/oauth/login.js:33`·`apple.js:25` 가 이를 `state` 에 싣고, `oauth/finish.js` 가 성공 착지 시 `redirect` 가 `/invite/` 로 시작하면 그리로 돌린다(지금 `core.js:160` 은 무조건 `/inbox`). **초대 모드일 땐 워크스페이스를 만들지 않는다** — `auth.js:243-251` 의 같은 분기를 `finish.js` 신규가입 경로에서도 부른다(한 함수로 빼서 공유).
- `invites.js:249` 수락 성공 직후 `User.update({ active_business_id: invite.business_id })` + 응답에 `business_id` → InvitePage 는 `refreshUser()` 후 이동.
- `utils/apiError.ts` 에 `'Email already registered': 'email_taken'`, `'Too many registration attempts': 'rate_limit_register'`, `'Too many password reset requests': 'rate_limit_reset'` 매핑 + ko/en `errors.json`.
**문구** ko: `email_taken` "이미 가입된 이메일이에요. 로그인해 주세요." / en "This email is already registered. Please sign in." · `rate_limit_register` "가입 시도가 많아요. 1시간 뒤 다시 해 주세요." / "Too many sign-up attempts. Try again in an hour."
**검증** health-check `--category=clientlink` 계열에 «기존 계정 멤버 초대 수락 → `/me` 의 business_id == 초대 워크스페이스» 1건 · «초대 모드 OAuth 신규 → businesses 행 +0, business_members +1» 1건(dev OAuth 모사: `finishOauthLogin` 을 직접 호출하는 node 스크립트) · 양성 대조군(redirect 없이 OAuth → `/inbox`).

### D2. 첫 화면 활성화 (E2) — M · P0 · R=0
**문제** 가입 직후 대시보드가 사실상 빈 화면(문구 3줄 + 체크리스트). 빈 워크스페이스가 66%.
**와이어(텍스트)**
```
[대시보드 · 첫 방문]
┌ 환영합니다, {이름}님 — 어떤 일을 하시나요?            ┐
│ (에이전시)(컨설팅)(외주 개발)(기타)   [건너뛰기]        │
└ 선택하면 예시 프로젝트·업무·고객을 넣어 드려요 (언제든 한 번에 삭제) ┘
┌ 업무 효율 높이기 (기존 OnboardingChecklist)             ┐
│ ☐ 팀원 1명 초대하기   ← 신규 단계 (invite_member)         │
│ ☐ 고객 초대 ☐ 첫 대화 ☐ 첫 업무 ☐ 메일 연결              │
└ …                                                       ┘
```
**건드릴 곳** `DashboardPage.tsx:126` 위에 `components/Onboarding/WelcomeRoleCard.tsx`(신규, `StandardModal` 아님 — 카드) · `BE services/onboarding.js` 에 `invite_member` 단계(판정: `business_members` 사람 2명 이상) · `BE routes/businesses.js` `POST /:id/onboarding/seed { kind }` — 기존 `scripts/seed-*-biz3.js` 의 생성 로직을 `services/onboardingSeed.js` 로 옮겨 호출(행동 계층 `services/actions/project_actions`·`post_actions` 를 쓴다 — CLAUDE.md «새로 만들지 않는다») · 예시 행은 `meta.sample=true` 로 표시하고 «예시 모두 삭제» 버튼 하나 · `oauth/core.js:160` 신규가입만 `/dashboard` 착지 · `businesses.onboarding_role` 컬럼 1개(ENUM, nullable, 멱등 스크립트).
**문구** `dashboard.json > welcome.title` "환영합니다, {{name}}님 — 어떤 일을 하시나요?" / "Welcome, {{name}} — what kind of work do you do?" · `welcome.seedHint` "선택하면 예시 프로젝트·업무·고객을 넣어 드려요. 언제든 한 번에 지울 수 있어요." / "Pick one and we'll add a sample project, tasks and a client. Remove them all with one click any time." · `onboarding.steps.invite_member.title` "팀원 초대하기" / "Invite a teammate".
**검증** 신규 가입 node 스크립트 → `POST seed` → projects/tasks/clients 각 +1/+3/+1 · `DELETE samples` → 0 · 체크리스트 `invite_member` done 전이 · 캔버스 3폭(`--suite mobilesweep` 에 대시보드 이미 포함).

### D3. 메뉴 권한 화면 반영 + 메뉴 다이어트 (E3) — M · P0 · R=0
**문제** 권한 «숨김» 이 화면에선 보임. 사이드바와 `navMenus.ts` 정본이 이탈. 20개 상위 메뉴.
**설계**
- `BE` `GET /api/businesses/:id/me/menu-levels` → `{ qtalk:'write', qmail:'none', … }` (`middleware/menu_permission.js` 의 판정 함수를 그대로 호출 — 서버와 같은 술어). `AuthContext` `/me` 응답에 합쳐 부팅 1회.
- `config/navMenus.ts` 에 각 메뉴 `permKey` 추가, `visibleNavMenus({scope, levels})` 가 `none` 을 거른다. **사이드바를 이 함수로 그린다**(`MainLayout.tsx:1474-1860` 의 수기 JSX 를 `WORKSPACE_MENUS.map` 으로 교체 — 이탈 4건이 자동 해소). 전역검색·탭 `+` 는 이미 이 함수를 쓴다.
- 권한 변경 broadcast(`permissions:updated` user room) → 사이드바 즉시 갱신(CLAUDE.md 16번).
- 오너 «워크스페이스에서 쓰지 않는 Q 끄기»: 권한 화면 상단에 토글 줄 — 내부적으로는 **기본값(role 없는 멤버)의 level 을 none 으로** 저장(새 표 없음; `business_member_permissions` 에 `user_id NULL = 기본값` 행 허용 → 스키마 변경이면 Fable 판정 R 검토. 대안: `businesses.disabled_menus` JSON 1컬럼).
- 즐겨찾기: `users.nav_favorites` JSON(개인) — 사이드바 «주요» 섹션 맨 위.
**와이어**
```
워크스페이스 ▾        ⌘K 검색
★ 즐겨찾기   Q talk · Q task · 캘린더       ← 우클릭/별 아이콘으로 추가
확인 필요 (3)  대시보드
협업         (권한 none 메뉴는 아예 없음)
개인 · 관리  (그대로)
```
**검증** 가드 신규 `--category=navregistry`(사이드바가 `WORKSPACE_MENUS` 외 경로를 하드코딩하면 실패 — 지금 4건으로 양성 대조군) · e2e: 멤버 qmail=none → 사이드바에 «Q mail» 0건 + `/mail` 직접 진입 403 화면 · owner 는 보임(음성 대조군).

### D4. 설정 검색 + 개인/팀 URL 분리 (E4) — S · P1
**건드릴 곳** `GlobalSearchModal.tsx:196-218` 결과 종류에 `setting` 추가 — 소스는 `navMenus.ts` 하위 목록 + 각 `*Section.tsx` 의 `data-settings-section="<key>"` 제목(정적 색인 `config/settingsIndex.ts` — 라벨은 `t()` 키로). 경로: `/me/settings/:tab` 신설(`appRoutes.tsx:81-113` + App.tsx 양쪽, CLAUDE.md «두 목록»), 옛 `?scope=personal` 은 리다이렉트. `WorkspaceSettingsPage.tsx:514` `isAdmin` 을 `hasBiz('owner','admin')` 로 — admin 읽기전용 오진 동시 해소. nav «내 업무 환경» ↔ 페이지 «내 업무 설정» 한쪽으로 통일.
**검증** `--suite admintabs` 류로 admin 계정이 브랜드 저장 200 · 검색 "알림" → 설정 결과 1건 이상 · 폰 3폭.

### D5. 권한 프리셋·복사·설명 (E5) — M · P1
**와이어** 매트릭스 위 줄: `[프리셋 적용 ▾ PM / 실무자 / 뷰어]  [○○님과 같게]` · 각 행 끝 `전부 ▾` · 열 머리 `전부 ▾` · 단계 셀 hover 툴팁 "읽기: 목록·상세 보기, 댓글 가능 / 쓰기: 만들기·수정 / 숨김: 메뉴 숨김". 프리셋은 `config/permissionPresets.ts` 상수(ko/en 라벨) → 기존 `PUT /permissions/:userId` 를 13번 호출하지 않고 **일괄 `PUT /permissions/:userId/bulk`** 1건(트랜잭션). 강등도 ConfirmDialog(`Matrix:134`).
**검증** bulk PUT → GET 13칸 일치 · 403(member) · 강등 확인창 `aria-modal` 1.

### D6. 첫 로드 다이어트 (E14) — S · P1
`i18n.ts:14` `ns` 를 `['common','layout','auth','errors']` 로, 나머지는 각 페이지 `useTranslation('qtask')` 가 자동 로드(이미 `useSuspense:false` 라 첫 렌더 폴백 문구 → **키 노출 방지**: `react.bindI18nStore:'added'` + 페이지 lazy import 와 같은 시점에 `i18n.loadNamespaces(ns)` 를 `appRoutes` 의 lazy 래퍼에서 선행). `WorkspaceSettingsPage.tsx` 15 절을 `React.lazy` + 기존 `ErrorBoundary`. **검증** 빌드 후 `index.html` 요청 수·gz 합(지금 105요청/≈600KB 를 기준선으로) · 각 라우트 첫 진입에서 `t()` 키 원문 노출 0(e2e 전 라우트 innerText 에 `^[a-z]+\.[a-z.]+$` 패턴 0).

---

## 5. 버그 · 위험 발견

| 심각도 | 내용 | 근거 |
|---|---|---|
| **높음** | 초대 링크에서 구글/애플 가입 → 초대 유실 + 새 워크스페이스 생성 | `routes/oauth/*` invite 전달 0 · `core.js:98,160` |
| **높음** | 기존 계정이 멤버 초대 수락 → `active_business_id` 미갱신, 옛 워크스페이스 착지 | `invites.js` 에 `active_business_id` 0건 |
| **높음** | 메뉴 권한 «숨김» 이 사이드바·탭에 반영 안 됨(서버만 403) | `MainLayout.tsx` 권한 참조 0 · `services/permissions.ts` 소비자 2곳뿐 |
| **높음** | 워크스페이스 admin 역할이 설정·권한 매트릭스를 편집 못 함(서버는 허용) | `WorkspaceSettingsPage.tsx:514,1339` vs `businesses.js:1039-1047` |
| 중간 | 가입↔로그인 링크가 `?redirect` 유실 | `RegisterPage.tsx:489`, `LoginPage.tsx:661` |
| 중간 | `Ctrl+\` 이중 발화(전역검색 + 우측패널), Windows `Ctrl+/` 이중, `⌘T` 브라우저 가로챔 | `MainLayout:1002` · `QTalkPage:458` · `MailPage:466` · `RightPanel:177` · `CueTaskBar:82` |
| 중간 | OAuth 전용 계정 삭제 불가(400 `oauth_otp_required`, 화면 안내 없음) | `account_deletion.js:107-110` |
| 중간 | «먼저 내보내기» 링크 scope 누락 + `<a>` 전체 리로드 | `AccountDeletionSection.tsx:89` |
| 중간 | 파괴 동작 확인창 없음 9곳: API 토큰 폐기(`ApiTokenSection:55,119`) · 메일 별칭(`MailAliasSection:119`) · 도메인 규칙(`:106`) · 메일 규칙(`MailRulesSection:106`, 실패도 침묵) · Cue 지식(`CueKnowledgeSection:52`, 침묵) · 팀 삭제(`OrgPage:116`) · OAuth 연결 해제(`ProfileIntegrationsPage:170,353`) · 아바타 삭제 · admin 강등(`Matrix:134`) | |
| 중간 | 사이드바 ↔ `navMenus.ts` 정본 이탈 4건 → 전역검색·탭 `+` 에서 근태·활동기록·공지 못 찾음 | `MainLayout:1636,1734,1745,1408` |
| 중간 | i18n 키 부재(ko/en 둘 다): auth `verify.*`, `register.terms*/privacy*`, common `adminUsers.*` 10키 → 영어 사용자에게 한글 | `ko/auth.json` 에 `verify` 없음 |
| 중간 | 호출처 0 라우트: `POST /auth/resend-verify-email`(`auth.js:1063`) · `admin_billing.js:403,418` · `admin_wiki.js:237,266` / 죽은 화면: ComingSoonPage ×2 | |
| 낮음 | 인증 성공 문구 "모든 기능을 사용할 수 있습니다"·VerifyEmailPage "로그인 후 재발송" 안내(기능 없음)·가입 부제 "무료로 시작하세요"(체험 14일) — 문구가 코드와 다름 | `VerifyEmailPage.tsx`, `RegisterPage` `register.subtitle`, `auth.js:372` |
| 낮음 | 11번째 탭에서 오래된 탭 무경고 폐기 | `tabStore.ts:555` |
| 낮음 | 워크스페이스 전환 후 무조건 `/talk` | `WorkspaceSwitcher.tsx:124,136` |
| 낮음 | 프로젝트 빈 상태 CTA 가 같은 화면의 생성 버튼을 두고 `/talk` 로 보냄 | `QProjectPage.tsx:415,432-441` |
| 낮음 | 약관 시행일 하드코딩 vs DB `terms_version` 분리 | `TermsOfService.tsx:4` |
| 낮음 | 접근성: `outline:none` 301곳 · skip link 0 · 사이드바 `<nav>` 아님 · `#94A3B8` 대비 2.6:1 × 823 | `index.css:383-391` 전역 규칙은 있음 |
| 낮음 | `/settings`·`/settings/:tab` 역할 게이트 없음(고객이 열면 «No workspace» 하드코딩 문구) | `App.tsx:529-534`, `WorkspaceSettingsPage.tsx:930,938` |

**측정 수치(재현 명령)** — 번들: `ls -la dev-frontend-build/assets/*.js` (최대 청크 vendor-tiptap 428KB, WorkspaceSettingsPage 377KB, index 316KB; 첫 로드 modulepreload 73 + index = 1.22MB raw / 392KB gz) · i18n: `i18n.ts:14` 31 ns, `du -sh dev-frontend-build/locales` 1.9MB(ko gz 212KB) · dev DB: businesses 29 / 업무 0건 19 / 고객 0건 23 / 프로젝트 0건 22 / users 242(이메일 인증 5) / help_articles 138 / teams 0 / perm rows 5.
