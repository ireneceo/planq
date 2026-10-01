## 현재 작업 상태
**마지막 업데이트:** 2026-10-01 밤 · **주체:** [Opus] Opus 5.5
**작업 상태:** v1.67.0 운영 배포 완료(commit `844b976b`, backup `/opt/planq/backups/20261001_200409`) · Fable PASS · 후속 묶음 미커밋(Fable 검증 중)

### 오늘 한 일
- 앱스토어 출시 확인(id6804790919) · 운영 `app_ios_url` 교체
- Fable 라운드(대기열 5-a·09-30 묶음) → FAIL 3건 수정 → 재검증 PASS
- 메일 실시간: 거절된 소켓이 재연결 안 되던 것(`services/socket.ts`) · e2e mailrt runReconnect
- 랜딩 홈 포지셔닝(의뢰형 비즈니스의 고객 업무) · 가입 출처 기록(`users.signup_source`, 관리자 «가입 출처» 카드)
- 와디즈 상세페이지 검토 → 수정 7건 목록(Irene 전달용)
- v1.67.0 배포 · 릴리즈노트 발행 · 운영 도움말 재시드

### 미커밋(Fable 검증 중)
- 탭 모드: 다른 탭 갔다 와서 X→뒤로 재열림(isClosingNav swap) · e2e mobilepanels ①d(양성 대조 확인)
- 관리자 대시보드 사용자 수 = 사람 계정만(게스트·AI 제외)
- 옛 «수익성 엔진» 문구 3곳 → 새 포지셔닝(en promoCopy 키 누락도 해결)

### 다음 할 일
1. 위 묶음 Fable PASS → 커밋(배포는 Irene 지시)
2. #429 답글(Irene) → 다음 배포에 닫힘
3. 업종별 랜딩 페이지 2장(외주·에이전시 / 전문직 사무소) — 와이어부터
4. #434 ② 네이티브 공유 · #424 근무일수 통합 · nginx 자동 적용

---

> ⚠️ 아래는 09-30 기록.

## (09-30) 작업 상태
**마지막 업데이트:** 2026-09-30 · **주체:** [Opus] Opus 5.5
**작업 상태:** 완료(커밋까지) — **미배포** · 오늘 변경은 전부 R=0·F=1 → **Fable 미검증(자체 검증)** · Fable 429 재시도 실패(대기열 5-a 는 내일)

### 이번 세션 커밋
| 커밋 | 내용 |
|---|---|
| `2524b4aa` | #429 동료 오늘 상태 — 사이드바 «팀 N명 근무 중» 목록(포털) · 채팅 이름 옆 점 · e2e `teampresence`(고객 403·3폭·실시간) · `Feedback-Closes: 429` |
| `b5bca160` | 모바일: ensureFocusedVisible 이 스크롤 상자 경계·덮은 sticky 줄까지 본다 · 채팅 폰 입력 중 고객링크 카드·정보밴드 접기 · 폰 밴드1 56 통일 · e2e `mobilesweep`(27화면×390/360) |
| `3a87d6ae` | Q task 시간 칸 blur 무변경 저장 차단(반복 업무 창 오작동·자동 누적 정지) — `utils/hours.sameHours` |
| `3c1e70eb` | 구형 WebView 폴리필 `public/legacy-polyfill.js`(운영 크래시 Object.hasOwn) · dev DB 로거 오탐 제거 |

### 검증(자체)
- mobilesweep 61/61 · teampresence 전부 · 회귀(mobile·mobilechrome·headerdrift·mobilepanels·screenbreak·chatbottom·docsheader·caret) 통과(mobilepanels ③ 은 연속 실행 중 로딩 플레이크 → 단독 0) · 가드 60/61 · 빌드 EXIT 0
- 검사 중 dev 데이터 오염 → 원복: 업무 575 예측 7.5→5.0(감사·예측 이력 행 삭제) · 594/613 actual_source user→auto

### 다음 할 일
1. **Fable 한 라운드**(토큰 생기면) — 대기열 맨 위 5-a(이미 운영) + 참고 묶음
2. 배포 시: 운영 `node seed-wiki-content.js` · 스키마 변경 없음 · #429 는 배포 후 답글→닫기
3. #434 ② 네이티브 공유(Irene/Apple) · #424 근무일수 통합(Fable 설계) · nginx 자동 적용(Irene «이따»)
4. 운영 열린 신고 중 대형 기획: #381·382·411·412·426·439·440 — Irene 논의

---

> ⚠️ 아래는 09-29 기록.

## (09-29) 작업 상태
**마지막 업데이트:** 2026-09-29 밤 · **주체:** [Opus] Opus 5.5
**작업 상태:** 완료(개발완료 처리) — **v1.66.0 운영 배포 완료** (commit `3646b92d`, backup `/opt/planq/backups/20260929_180016`) · **Fable 미검증**(429 ×4, 대기열 맨 위)

### 진행 중인 작업
- **#429 동료 출퇴근 상태** — Irene 결정 **1번**(워크스페이스 멤버 전원이 서로의 **상태만**, 시각·기록 없음, 고객 제외).
  서버는 이미 있음: `GET /api/attendance/presence`(멤버 전원·뱃지만, 고객 403) + `attendance:updated`(멤버만 들어가는 business 방).
  훅 초안 `docs/drafts-useTeamPresence.ts.txt`(저장소에 텍스트로만 보관 — ★ 버그: 첫 구독자가 해제되면 소켓 리스너가 다른 구독자 것까지 끊긴다. 참조 카운트 0 일 때만 해제로 고칠 것).
  할 일: ①훅 `hooks/useTeamPresence.ts` ②사이드바 근태 카드 아래 한 줄 «팀 N명 근무 중» → 누르면 멤버·상태 목록(포털 — 사이드바 transform) ③채팅 이름 옆 상태 점(멤버만, 고객·Cue 없음) ④카나리 3폭 + 고객 403 대조

### 완료된 작업 (이번 세션 전체)
- 운영 신고 11건 답글·닫기: #428·431·432·433·435·438(배포분) · #427·430·436·437·441(v1.66.0)
- 모바일 #437 뒤로=패널 닫기 · #441 메뉴 맨 위 · #436 메일 쓰기 모드 · #427 폴더 안 전체 선택 · 탭 모드 X 닫은 업무 재열림
- #430 Q task 전체 업무 찾기 · Q sales · 프로젝트 폴더 업로드 = 프로젝트 파일 · 날짜 형식 2차 + 가드 datefmt · 공유 받기 ① · 화면 깨짐 점검 도구
- v1.66.0 배포 · 릴리즈노트 발행 · 운영 도움말 시드

### 다음 할 일
1. #429 (위)
2. **Fable 한 라운드** — `docs/FABLE_GATE_QUEUE.md` 맨 위(5-a 프로젝트 폴더 업로드 R=1 + 오늘 참고 묶음). **이미 운영에 나감** — FAIL 이면 핫픽스
3. 다음 배포 뒤 운영 `node seed-wiki-content.js`(create-task 돋보기 안내)
4. #434 ② 네이티브 공유 — Apple App Group·확장 번들 ID·프로필(Irene) 후 한 빌드 (`docs/NATIVE_SHARE_RECEIVE.md`)
5. #424 근무일수·휴일 통합 — Fable 설계 대기 · nginx 자동 적용 — Irene «이따»

---

## 복구 가이드
```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```

> ⚠️ 아래는 09-29 오후(배포 전) 기록.

## (오후) 작업 상태
**마지막 업데이트:** 2026-09-29 오후 · **주체:** [Opus] Opus 5.5
**작업 상태:** 완료(커밋까지) — **미배포** · 5-a 는 Fable 429 → unavailable(대기열 맨 위) · 나머지 R=0 자체 검증

### 이번 세션 커밋
| 커밋 | 내용 |
|---|---|
| `0938a2f2` | 모바일 #437 뒤로=패널 닫기(`hooks/useBackToClose`, 미러 모드만) · #441 메뉴 z1060·Cue 누르면 메뉴 닫힘 · #436 쓰기 모드(키보드 up 시 헤더 접힘·메타 숨김·버튼 줄 붙박이 해제·답장 칸 --vvh 상한) · #427 선택 모드면 [전체 선택] 늘 표시 · e2e `mobilepanels` 21 · `screenbreak`(18화면×3폭, 대조군) |
| `b1a0f755` | 표시명 Q sale → **Q sales** (주소·API·ENUM·i18n 키 유지) · dev 도움말 재시드 84 |
| `1e0cc312` | 프로젝트 폴더 업로드 = 프로젝트 파일(L2) — **R=1, Fable 미검증** |
| `d3fae6be` | 날짜 형식 2차 — `formatDay/formatClock/formatDayTime` · ~50곳 이전 · 가드 `datefmt` 래칫(베이스 31) |
| `2a09b144` | #434 ① 공유 받기 — 대화방 고르기 · 저장 위치(프로젝트·폴더·새 폴더) · 문서가 받음 · e2e `sharereceive` · 네이티브 설계 `docs/NATIVE_SHARE_RECEIVE.md` |
| `5eb699e7` | 탭 모드 X 로 닫은 업무가 뒤로 가기에 재열림 — UrlMirror pqIdx·trail(닫기=back) · TabAppShell pqIdx 보존 |
| `96aa28b4` | #430 Q task 헤더 «전체 업무에서 찾기» (e2e `taskquicksearch`) |

### 운영 신고 장부
- #428·431·432·433·435·438 — 답글 달고 **done 처리 완료**(운영 DB, close-deployed-feedback)
- #427·436·437·441·430 — `Feedback-Closes` 트레일러. **배포 후 답글 → 닫기**

### 다음 할 일
1. **Fable 한 라운드**(토큰 생기면) — `docs/FABLE_GATE_QUEUE.md` 맨 위(5-a + 오늘 참고 묶음). 그 전 운영 배포는 Irene 판단
2. 배포 시: 운영 `node seed-wiki-content.js`(Q sales 문구) · 스키마 변경 없음
3. #434 ② 네이티브 — Irene/Apple 계정 작업(App Group·확장 번들 ID·프로필 → Codemagic) 후 안드로이드+iOS 한 빌드
4. #429(동료 출퇴근 상태 표시·채팅 이름 옆) — 누가 볼 수 있는지 Irene 결정 필요 · #424 근무일수 통합은 Fable 설계 대기
5. nginx 자동 적용 — Irene «이따» (미룸)

### 배운 것
- `--update-baseline` 전체 실행은 **godfile 동결값을 현재 크기로 올려** 래칫을 느슨하게 만든다 → 새 카테고리만 넣을 땐 godfile 을 되돌릴 것
- 태블릿(가로 550↑)은 **탭 모드** — 브라우저 히스토리를 UrlMirror 가 맡는다. 폭(≤1024)이 아니라 모드로 가른다
- 화면 깨짐 판정은 «층» 을 봐야 한다 — FAB·배너·목록 aside(absolute z30)가 덮는 것은 의도. 첫 실행 35건 대부분이 판정기 탓
- 앱 셸이 html 을 고정해 `scrollWidth` 로는 가로 넘침을 못 잰다(대조군이 잡았다)

---

> ⚠️ 아래는 09-29 오전 기록.

## 현재 작업 상태
**마지막 업데이트:** 2026-09-29 · **주체:** [Opus] Opus 5.5
**작업 상태:** 완료(개발완료 처리) — **v1.65.0 운영 배포 완료** (commit `cb174f51`, backup `/opt/planq/backups/20260929_070541`) · Fable PASS

### 진행 중인 작업
- 없음 (날짜 형식은 1차까지 배포, 2차는 다음 할 일)

### 완료된 작업 (이번 세션)
- 자잘한 후속 5건 `ae4b707e` — 증빙신청 per-IP 한도 · 폴더삭제 감사 상한 · 일정 공유 버튼 헤더 우측 · CalendarPicker 주 시작 · 카나리 email_logs
- #438 메일 `1b83ff61` — IMAP 실패 uid 커서 유지(3연속만 건너뜀) · Message-ID 없는 메일 합성 id 보존 · 답변필요 행 reply_preview
- Fable 1차 FAIL → `297a9065` 자동 넘김 취소 시 포커스 세션 종료 → PASS · 릴리즈노트 문구 FAIL → `cb174f51` → PASS
- v1.65.0 배포(09-26~29 18커밋) · 운영 도움말 seed(customer-entry-booking) · 마이그레이션 users 칸 3 확인

### 다음 할 일 (Irene 결정: 추천대로)
1. **모바일 UI 묶음** — #437(확인필요→업무 열면 닫기·뒤로 불가·헤더 두 줄 겹침, 우측패널·헬프 전부) · #441(팝업 위 햄버거, Cue 팝업이 햄버거 열린 채) · #436(메일 답장 키보드) · #427(폴더 안 전체선택이 파일 하나 고른 뒤에만 보임). 3폭 실측, 구조로 고친다
2. **Q sale → Q sales** 영문 이름(결정 3-a) — 표면 전수(메뉴·i18n·SEO·도움말·e2e·LLM 프롬프트, memory feedback_rename_needs_full_surface_sweep)
3. **프로젝트 폴더 업로드 파일 → 프로젝트 자동 연결**(결정 5-a) — 가시성 확대라 구현 후 Fable
4. 날짜 형식 2차 — 직접 포맷 155곳/69파일 + slice 128곳 · 가드 datefmt · 도움말 아티클(2차 뒤)
5. 화면 깨짐 전수 점검 도구 · #434 공유(네이티브)

### Irene 결정 대기
- **nginx 자동 적용** — 저장소 정본 + sudo 로 wrapper 하나만 허용. 권한 검사가 «승인 없는 지속 권한» 으로 막아 멈춤.
  초안은 `/tmp/claude-1000/-opt-planq/968759c6-.../scratchpad/held/planq-nginx-apply`(세션 scratchpad — 사라질 수 있음, 정규식 1줄 버그 있음). 승인 시 다시 작성.
  `/wiki` 301 · server_tokens off 가 여기 걸려 있다
- 운영 신고 #428·431·432·433·435·438 **답글** — 답글 달면 다음 배포에 장부 닫힘(트레일러 커밋 `2e3f688f`)

### 배운 것
- IMAP 커서를 실패 항목 위로 올리면 일시 오류가 영구 유실 — memory `feedback_cursor_advance_on_failure_loses_data`
- 릴리즈노트도 Fable 이 코드와 대조한다 — «고르지 않으면 그대로» 가 자동 12시간제와 모순이었다
- 질문은 번호·선택지·추천으로 — memory `feedback_number_questions`

---

## 복구 가이드
```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```

> ⚠️ 아래는 09-28 이전 기록.

## 현재 작업 상태
**마지막 업데이트:** 2026-09-28 · **주체:** [Opus] Opus 5.5
**작업 상태:** 부분 완료 — 날짜 형식 설정 **진행 중** · 전부 **미배포** · Fable 미검증(자체 검증) · 게이트 ⛔(날짜 형식 R=1, 대기열 등록)

### 진행 중인 작업
- **날짜 형식 설정** (Irene 승인 09-27) — 1차 백엔드·설정 카드·캘린더 주 시작까지 커밋됨. 남은 것:
  1. 화면 3폭 실측(내 업무 설정 `/me/work-settings` 카드 · 캘린더 월요일 시작 · 형식 반영 · 자동일 때 기존과 동일)
  2. 2차 전수 적용 — 직접 포맷 155곳/69파일 + slice 128곳 → `useTimeFormat`/`dateFormat.ts` · `CalendarPicker` 주 시작
  3. 가드 `datefmt` 래칫(신규 직접 포맷 증가 차단)
  4. Fable 한 라운드(`docs/FABLE_GATE_QUEUE.md` 맨 위 항목 — 오늘 커밋 4건도 참고로 묶음)

### 완료된 작업 (이번 세션)
- `4e0b663b`·`957159ba` 반복업무 자동 넘김 — 워크스페이스 시간대 기준 + 매시 정리 + 진행중·대기 포함(운영 #262·#331 배포 후 닫힘)
- `c70b2ab4` #435 — 우측패널 머리 이중 여백 · iOS 입력 자동확대 · 폰 버튼 글자
- `63388222` 채팅 반응 — 도구줄 이동 · 떠 있는 팝오버 · 폰 탭 유령 클릭 차단 · 카나리 `--suite chatreaction`(17검사)
- #434 검토 — 네이티브 앱에 공유 수신 없음

### 다음 할 일 (Irene 결정: «다 할 건데 알아서» · 공유는 네이티브까지)
1. 날짜 형식 마무리(위)
2. **화면 깨짐 전수 점검 도구** — 주요 화면 × 3폭: 탭 유령 클릭 · 버튼 겹침/36px 미만 · 열면 옆 내용 밀림. 기존 run.js 에 붙인다
3. **#434 공유** — ①공유 후 화면(파일 → 채팅/업무/프로젝트 폴더 · 폴더 만들기, 웹·앱 공용 `/share-receive`) ②안드로이드 SEND intent + iOS Share Extension 을 **한 앱 빌드**로
4. 배포 시(지시 받으면): `migrate-user-date-prefs.js`(배포 슬롯 등록됨) · `pm2 restart planq-qnote`(09-27분) · 도움말 운영 seed(09-25분)

### 배운 것
- 헤드리스 Chrome 은 `hover:none`·`pointer:none` — CSS 를 `(hover:hover),(pointer:fine)` 로 쓰면 JS `isTouchDevice` 와 답이 갈린다. **같은 술어**(`not all and (hover:none) and (pointer:coarse)`)
- `pkill -f "vite build"` 가 자기 명령줄을 죽였다(exit 144) — 또 겪음
- opacity 전환 중에 재면 0 으로 읽힌다 — 대조군이 안 뒤집힐 때 판정기부터 의심

---

## 복구 가이드
```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```

> ⚠️ 아래는 09-27 이전 기록.

## 현재 작업 상태
**마지막 업데이트:** 2026-09-27 · **주체:** [Opus] Opus 5.5
**작업 상태:** 완료(개발완료 처리) — **미배포**

### 진행 중인 작업
- 없음

### 완료된 작업 (이번 세션)
- 09-26 미커밋 6묶음 이어받기 → 커밋 6건(유입 퍼널 · #431 · #432 · #428 · #433 · 공유 업무 빈 설명). #431 Fable 1·2차 FAIL → 3차 PASS
- **보안 설정 점검·수리**(정본 `docs/SECURITY_SWEEP_2026-09-27.md`, CLAUDE.md «공유·참조는 다섯 규칙») — Fable PASS(KB 78칸 행렬 포함)
- 업무 공유 링크 = 문서 수준(최신 결과물 · L4+general 첨부 · 이전 버전 N개) · 앱 안 공유 링크 → 앱 새 탭(openOwnLink) · 공개 페이지 날짜 = 화면 언어

### 다음 할 일
1. **날짜 형식 설정 (Irene 승인 2026-09-27 «승인해 fable 제안대로»)** — users 칸 3개(date_format·time_format·week_start, NULL=언어별 자동:
   ko `2026. 9. 27. (토)`·24h·일요일 / en `Sep 27, 2026 (Sat)`·12h·일요일) · 프로필 시간대 옆 설정 · dateFormat/useTimeFormat 이 읽음 ·
   1차 캘린더·상세·공개 → 2차 나머지(직접 호출 155곳/69파일 + slice 128곳) · 가드 `datefmt` 래칫 · 운영 멱등 마이그레이션(코드 배포 전) · R=1 → Fable
2. 엔티티 링크 첨부(업무·노트·정보·청구·일정·프로젝트·메일·상담) + 통합검색 5종 추가 — 설계 문서부터({type,id} 저장 + 보는 사람 기준 판정)
3. 일정 상세 공유 버튼 위치 통일(업무=헤더 우측 / 일정=푸터 좌측 → 헤더 우측)
4. Q note 공유 비밀번호·만료(SQLite 스키마)
5. Fable 후속 권고: IMAGE_STAGE2B 3단계 켤 때 업무 인라인 이미지(/api/tasks/public/attach)가 imageCtx 정규식 밖 — 공개 업무 본문 이미지 깨짐 대비
6. 배포 시(지시 받으면): **`pm2 restart planq-qnote` 필수**(sessions.py) · 스키마 변경 없음 · 도움말 «고객 창구와 상담 예약» 운영 seed(09-25 이월)

### Irene 이 알아야 할 변화 (Fable 소견)
- owner/admin 의 Cue·통합검색·KB 검색이 멤버의 «나만 보기» Q info 도 본다 — **화면(Q info 목록)은 원래 그랬고** 이번에 판정을 한 벌로 합치며 같아졌다

---

## 복구 가이드
```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```

> ⚠️ 아래는 09-25 기록.

## 현재 작업 상태
**마지막 업데이트:** 2026-09-25 19:30 UTC
**작업 상태:** 완료(개발완료 처리) — **v1.64.0 운영 배포 완료** (commit `50dac6b9`, backup `/opt/planq/backups/20260925_191726`)
**주체:** [Opus] Opus 5.5 (1M)

### 이번 세션(저녁~밤)에 한 것 — 전부 Fable PASS
| 커밋 | 내용 | Fable |
|---|---|---|
| `e9c956bc` | 고객 창구 P1 | 2라운드 PASS(이전 세션) |
| `42cab97b` | 게이트 지문 확장(scripts·.claude/hooks·commands, `fable-gate-paths.sh`) + 창구 마이그레이션 배포 슬롯 | Fable 결정 |
| `8a5330d1` | P2 상담 예약 + QR + D2(방문자 방 복귀) | PASS · D2 델타 PASS |
| `b0b3748f` | D3 방문자 막기 + 카나리 정리 | 1 FAIL(정리 throw) → PASS |
| `4e5a4e6f` | P3 로그인 고객 홈 `/home` | 1 FAIL(메일 2통·계정 수락 알림 누락) → PASS |
| `50dac6b9` | v1.64.0 버전·릴리즈노트·개발현황 | — |

### 운영 반영 확인 (배포 후 실측)
- health 200 · pm2 3개 online · 운영 버전 1.64.0 · `/api/client-home`·`/api/calendar/booking` 무인증 401
- 마이그레이션: guest_links conversation_id NULL 적용(기존 5행 무변경) · booking_status 이미 있음(sync 가 먼저 만듦) → no-op
- 옛 `/wiki` 생성물 0 · sitemap `/wiki/` 0 · `/guide/a` 88
- 릴리즈노트 v1.64.0 발행 · 개발현황 발행 · `seed-wiki-content.js` 운영 실행(article 83)

### 다음 할 일
- ★ 도움말 «고객 창구와 상담 예약»(slug customer-entry-booking) 은 dev 에만 있다 — 다음 배포 뒤 운영에서 `node seed-wiki-content.js`
- 인사이트 «유입→예약→확정→등록» 퍼널(P3 잔여, 팀 화면)
- 팀 «다른 시간 제안» 이 담당 일정 겹침을 안 본다(설계 허용 — 요청 있으면)
- `canary-guest-entry.js` 가 email_logs 를 매 실행 2행 남긴다
- dev DB 잔여(내 것 아님): `fz_gl_probe2` 테이블 · `clients#177` · 고아 게스트 그림자 73
- ★ `50dac6b9` 가 package.json·lock(게이트 경로)을 바꿔 게이트가 한 번 울린다 — 버전 숫자만 바뀐 커밋

### 배운 것
- **같은 브라우저 컨텍스트에서 신원을 바꾸면** 앞 세션 상태가 섞여 판정이 뒤집힌다 → 신원마다 `createBrowserContext()`
- 탭 모드는 `routes/appRoutes.tsx` **와** App.tsx 두 목록에 라우트를 넣어야 한다(한쪽만이면 데스크탑 본문이 빈다) · 새 경로는 tabStore `PREFIX_KIND` 에도(없으면 `other` 로 설정 탭과 덮어쓴다)
- `notify()` 는 기본으로 메일 채널까지 태운다 — 전용 메일을 따로 보내는 곳에서는 `skipChannels:['email']`
- 헬퍼가 빈 경우 `0` 을 돌려주면 `for…of` 에서 던져 **뒤의 원복이 건너뛰어진다** → 원복은 finally 맨 앞 별도 단계
- 빌드가 외부 SIGTERM(143)으로 두 번 끊겼다(메모리 여유) — 재시도로 통과

### Git
- 브랜치 main · HEAD `50dac6b9` · 미커밋: `.claude/session-state.md` 만

> ⚠️ 아래 **「오후 세션」·「오전 세션」** 절은 다른 작업 기록이다. 지우지 말 것.

### 다음 세션에서 가장 먼저 할 일
1. **게이트는 통과 상태다** — `.claude/.fable-gate.json` `by=fable` · fp `84b1d2a6` · commit `91f1c450`.
   ★ **코드를 한 줄이라도 바꾸면 지문이 달라져 다시 판정받아야 한다**(정상 동작).
   1차는 **FAIL** 이었다 — `resolveGuestToken` 완화 2곳(E6·D1). 회귀는 카나리 `runE6`·`runD1` 상주.
2. **커밋 안 했다** — 22파일 미커밋. 오후분(도움말 개명)은 이미 커밋돼 있고 이건 별건이다.
3. **P2(예약) 미착수** — 설계 §6 은 P1+P2 를 **한 사이클**로 정했다(P1 단독은 새 가치가 거의 없다).
   P2 범위: 슬롯 API(무인증·개인 링크 필수) · 신청(prospect 생성) · 확인필요 버킷 + 승인/제안/거절 ·
   고객 수락/취소 · 메일(.ics) · 끝남 cron → `client_interactions` · `sales_stage` 자동 전이 · Q calendar 점선.
   스키마 1: `calendar_events.booking_status` NULL 컬럼(멱등, **코드 배포 전**).
   ★ P2 를 얹으면 지문이 달라지므로 **같은 라운드로 Fable 재판정**한다.
4. **Irene 결정 대기 — QR**: 설정 «고객 창구» 카드에 QR 을 넣을지. 저장소에 QR 라이브러리가 **없다**(새 의존성).
   안 넣어도 주소·복사·미리보기로 기능은 완결이다.
5. **배포 순서(지시 받으면)**: `node dev-backend/scripts/migrate-guest-link-scope-workspace.js` 를
   **코드 배포 전에** 운영에서 실행 → rsync → `seed-wiki-content.js`(어제분 도움말 2건).
   오후분(도움말 개명 43파일)과 **함께** 나간다.

### 이번 세션(오후2)에 한 것
`docs/CLIENT_ENTRY_DESIGN.md` §5 **P1** 전부 — 상세는 `DEVELOPMENT_PLAN.md` 맨 위 절.
요약: 스키마 2건 · `routes/customer_entry.js` 신규 · `resolveGuestToken` 완화 2곳 ·
`requireRoom` 공용 문 · `entryOf` 화이트리스트 · `GuestWorkspacePage` 4탭 ·
`guestShell` 로 껍데기 10개 추출 · 설정 «고객 창구» 카드 · i18n 22키×2 · 카나리 창구 축.

### ★★ Fable 1차 FAIL — 내가 틀린 두 곳 (가장 중요)
내가 프롬프트에 «제일 위험한 지점» 이라고 적은 그 줄에서 나왔고 **내 근거가 정반대였다.**
- **E6**: 대화방 일치 완화를 `parent.conversation_id && …`(truthiness)로 썼더니 **부모 방이 비는 순간
  검사 자체가 사라져** 부모 404 · 자식 **200**. 그 상태는 **내가 컬럼을 nullable 로 만들어 새로 가능해진 것**이다.
  → `parent.scope !== 'workspace' &&` 로 가르면 옛 scope 는 HEAD 와 **글자까지 같은 판정**이 된다.
- **D1**: 창구에서 그 검사를 면제한 자리에 **대체 검사를 두지 않았다** → 개인 링크가 남의 방을 가리켜도 200.
  → `ConversationParticipant` 소유 검사.
- **교훈(memory 갱신함 `feedback_optional_branch_skips_auth`)**: 전제의 *징후*(값이 있나)가 아니라
  **전제의 이름**으로 가른다 · 검사를 면제했으면 대체 검사를 둔다 · **컬럼을 넓히면 그 컬럼을 읽는 판정을 전수로** 본다.
- ★ E6·D1 을 **카나리에 상주**시켰다 — 임시 스크립트에 뒀다가 `rm` 을 먼저 해서 그 버전을 한 번 잃었다.

### ★ 이번 세션에서 배운 것 / 내가 틀린 것
1. **설계가 절단면을 놓칠 수 있다** — 설계는 스키마를 「ENUM append 1건」으로 적었지만 공유 창구 링크가
   가리킬 대화방이 없다는 것을 못 봤다. 이탈을 **선언하고** 게이트에 명시했다(숨기지 않는다).
2. **완화는 «왜 그 규칙이 있나» 로 좁힌다** — 부모·자식 대화방 일치와 `can_write` 상한은 둘 다
   «같은 방을 공유한다» 는 전제 위에 있었다. scope 로 가르면 workspace 쪽만 무검사가 되고 옛 링크
   무변경 대조군도 성립하지 않는다. 「부모가 방을 가졌을 때만」 이 두 규칙을 **한 술어**로 좁힌다.
3. **can_write 를 강제했다가 기능을 죽일 뻔했다** — 공유 창구를 열람 전용으로 못박으니 자식이 그 값을
   물려받아 **확인을 마친 방문자도 자기 방에 못 썼다.** 실HTTP 로 잡았다(코드만 봤으면 못 봤다).
4. **`.catch(()=>null)` 이 정리 실패를 삼켰다** — 부모를 먼저 지우려다 자식 FK 에 막혀 조용히 실패하고
   행 1건이 남았다. 자식→부모 순 + **잔여를 판정 항목으로** 넣었다.
5. **`grep -c` 가 0건이면 exit 1** 이라 `&&` 사슬이 끊겼다(또 겪었다).
6. **`tsc` 만 보고 넘기지 않았다** — 첫 빌드가 EXIT 2(`error TS` 1, 절대경로 import)였는데 «1.86s 완료» 같은
   낙관적 로그에 속지 않고 종료코드를 따로 셌다.
7. **가드가 규격 지킨 코드를 벌하는 자리** — `const Header = styled` 라는 이름만으로 «자체 페이지 헤더» 로
   세어졌다(실제로는 카드 머리). 베이스라인을 올리거나 검사기를 약화시키지 않고 **형제 파일 규약대로
   `CardHeader` 로 개명**해 634 로 되돌렸다.

### ⚠️ 발견한 게이트 구멍 (내가 고치지 않았다 — 판단 필요)
`fable-gate-stop.sh` 의 지문은 **`dev-backend dev-frontend q-note` 만** 해시한다.
그래서 `scripts/e2e/*`·`scripts/guard-invariants.js`·`docs/*` 변경은 **지문에 안 들어간다** —
카나리만 고치면 게이트가 조용하다. 검사기를 약화시키는 변경이 무검증으로 지나갈 수 있는 모양이다
(memory `feedback_unwired_guard_is_no_guard` 계열). 고치면 기존 마커가 전부 무효가 되므로 Irene 판단 대기.

### 완료된 작업 (오후 세션)

**① 업무 댓글이 위로 붙던 결함 (운영 신고)** — ✅ Fable PASS
> Irene: *"업무 상세에서 댓글을 달았는데 댓글이 아래로 안 붙고 위로 붙어서 올라간 줄 몰랐어."*
- 정렬 규칙이 아니라 **이름** 문제였다. 조회는 `comments[].createdAt`, 저장은 `created_at` 만 →
  새 댓글 시각이 `''` → **빈 문자열이 모든 날짜보다 작아 맨 위로**. 표시 시각도 빈칸.

**② 업무 히스토리 시각이 5개월간 빈칸** — ✅ Fable PASS (Fable 이 diff 밖에서 찾았다)
- `GET /workflow` 는 `created_at`, 화면은 `createdAt` → **2026-04-25 부터 빈칸.**
  아무도 신고하지 않았다 — **빈칸은 «고장» 으로 보이지 않는다.**

**정본 `dev-backend/utils/rowTimestamps.js` 신설 (`withBothTimestamps`)**
- 근원: 전역 `Model.prototype.toJSON` override(`models/index.js:165`)가 **최상위만**
  `createdAt→created_at` 으로 바꾸고 **중첩 include 행은 camelCase 로 남긴다.**
- ★ **중첩까지 재귀시키지 않았다** — 조회 응답의 중첩 행 이름이 한꺼번에 바뀌면
  `createdAt` 을 읽는 화면들이 **동시에** 시각을 잃는다. 넓히는 쪽이 위험하다.

**③ 「Q위키」 → 「도움말」 개명 (Irene 결정) — 주소까지** · 재판정 대기
- ko「도움말」/ en **`Guide`** · 관리 「도움말 관리」/`Guide admin` · **`Q helper` 팝업 제목 보존**
- **주소** `/wiki/`→`/guide/` · `/wiki/a/:slug`→`/guide/a/:slug` · `/admin/wiki`→`/admin/guide`
- **안 바꾼 것(의도)**: API `/api/wiki/*` · 파일명 · DB(`help_articles`·`kb_chunks.source_type='wiki'`).
  ENUM 변경은 비가역이고 사용자에게 안 보인다.
- ★ Irene 이 **내 SEO 논리를 반박했고 그게 맞았다** — 운영 실측: 집계 시작 2026-09-21(나흘),
  전체 방문 25건, `/wiki/` **1건.** 지킬 색인 자산이 없어 **본격 운영 전 지금이 가장 싼 시점**이었다.

**④ 랜딩 브랜드 표기 정렬** — 랜딩이 `Q Talk`·`Q talk` 를 **같은 문서 안에서 섞어 쓰고 있었다.**
앱 사이드바 소문자를 정본으로 **80건** 정렬(대문자 잔여 0).

### 개명에서 «이름만 바꾸면 고장 나는 것» — 내가 찾은 3건
| 지점 | 무엇이 문제였나 |
|---|---|
| `dev-frontend/src/utils/publicSurface.ts` | 공개 표면 판정이 `/wiki` 기준 → 주소만 바꾸면 **회원이 도움말에서 워크스페이스 크롬**을 본다. 주석에 「전에 같은 회귀가 있었다」고 적힌 자리 |
| `dev-backend/services/seoArtifacts.js` | 빵조각 **3번째 항목만** 옛 주소 잔존 |
| `dev-backend/services/wikiQuestionCluster.js` | 알림 링크가 `/admin/wiki` → **죽은 링크** |

### Fable 1차 FAIL 로 찾은 잔존 4계열 (고쳤다)
1. `dev-frontend/index.html:66` `<noscript>` nav 의 `/wiki/` — **생성기는 홈 머리를 바꾸지 않아
   운영 홈 HTML 에 죽은 링크로 실린다**(운영 홈에 3건 있었다)
2. `dev-frontend/public/llms.txt` — AI 크롤러용 죽은 링크
3. 생성 글 `<title>… | Q위키 — PlanQ` · 알림 제목 `Q위키 초안 N건`
4. **e2e 7곳이 옛 주소를 쳐서 초록이 거짓이 된다** — `canary-crawl`·`canary-header-drift`·
   `visual-audit`·`mobile-keyboard`·`canary-admin-crawl`·`canary-body-gutter`·`narrow-text-audit`
- 추가로 내가 하나 더: **Cue LLM 프롬프트** 「Q위키 문서」→「도움말 문서」
  (`services/cuePrompts.js:45` + `routes/cue.js:362` — **짝이 맞아야** 근거 블록을 찾는다).
  안 고치면 Cue 가 답변에서 폐기된 이름을 말한다.

### ★ 오후 세션에서 내가 틀린 것 (반복 금지)
1. **`Q sale` 을 「상담」으로 바꾸자고 했는데 틀렸다** — 「상담」은 6단계 중 **3번째 단계**이고
   고객 관리는 별도 메뉴(「고객·파트너」)가 있다. 내용을 좁게 보고 «이름이 틀렸다» 고 단정했다.
2. **SEO 색인 손실을 근거로 주소 유지를 주장했는데 데이터가 없었다** — Irene: *"본격 운영도 안
   했는데 이게 중요해?"* 운영을 읽어 보니 `/wiki/` 방문 1건. **주장 전에 재라.**
3. **검사기가 세 번 거짓** — ①`[class*="TimelineItem"]` 은 빌드된 styled-components 에 없어 0건
   ②히스토리 섹션이 기본 접힘이라 행 0건 ③`task_status_history` 에 `updated_at` 컬럼 없음.
   셋 다 **미측정으로 보고**되어 초록으로 새지는 않았다.
4. **양성 대조군이 반만 적용됐는데 «들어갔다» 고 판단** — 파일에 `\uffff` 가 **실제 문자**로 들어가
   치환이 안 맞았다. `grep -c POSCTRL` 이 1인데 2곳을 바꿨다는 사실을 늦게 알아챘다.
5. **`grep` 이 또 거짓** — ugrep 이라 `{...}` 를 구간식으로 읽어 `data-testid={\`...\`}` 를 못 찾는다.
   그 탓에 `&&` 사슬이 끊겨 재시작·빌드가 안 돌았다.
6. **좌표 검사가 결함을 못 잡았다** — DOM 순서대로 top 을 비교하면 내용과 무관하게 항상 증가한다.
   **행을 내용으로 찾아** 비교하도록 고쳤다.

### 회귀 (추가)
`--suite delivver` **11검사**(5개 추가): 새 댓글 맨 아래 · 좌표로도 과거가 위 · 새 댓글 시각 보임 ·
히스토리 섹션 펼침 · 히스토리 시각 빈칸 아님. 손잡이 신설 `task-comment-<id>`·`task-history-toggle`·`task-history-time`.

### 자체 검증 수치 (최종 상태)
- `npm run build` EXIT 0 · `error TS` 0 · health 48/48 · guard 59/60(i18n 242/242 · parity 증가 0)
- `--suite tenant` 0 실패 · `--suite delivver` 11/11 · `wiki-coverage-check.js` EXIT 0
- 실브라우저: `/guide` 목록 · `/guide/a/create-workspace` 본문 · 「Back to Guide」 · 뒤로 `/guide` 동작
- 산출물: `dev-frontend-build/index.html` 에 `href="/guide/">도움말` · `llms.txt` 새 주소
- DB 아티클 본문에 옛 주소·이름 **0건**

### 배포 시 주의 (오후분)
- **운영 옛 생성물**: `wiki/index.html` + `wiki/a/*` = **88 html + 88 .gz**. 배포 직후 `generate-seo.js` 가
  **매니페스트 마커 기준 자동 삭제** + sitemap/rss 재작성(Fable 반증 `removed:3`, 마커 없는 파일은 보존).
  ★ **빈 폴더까지 지워지는지가 관건이다**(위 「가장 먼저 할 일」 2번). 확인:
  ```
  ssh irene@87.106.78.146 'cd /opt/planq/frontend-build && find wiki -name index.html | wc -l; grep -c /wiki/ sitemap.xml; ls guide/a | wc -l'
  # 기대 0 / 0 / 87
  ```
  선택: `rmdir /opt/planq/frontend-build/wiki/a /opt/planq/frontend-build/wiki`(빈 폴더)
- **옛 `/wiki` 는 앱 안 리다이렉트로 살렸다** — `/wiki`→`/guide`, `/wiki/a/:slug`→`/guide/a/:slug`
  (slug 보존). 그 전에는 **랜딩 홈**으로 떨어져 색인된 옛 글 32건이 엉뚱한 데로 갔다(Fable 실측).
  nginx 301 은 더 깔끔하지만 **앱 안 리다이렉트로 충분**하다 — Irene 이 원하면 추가.
- 스키마 **0**. 롤백은 코드만(43파일 revert → 재빌드 → 재배포, 생성기가 대칭 복원)
- **Q위키 2건 운영 미반영**(어제분): `ssh irene@87.106.78.146 "cd /opt/planq/backend && node seed-wiki-content.js"`
  — **배포 rsync 뒤에.** 생성될 것: `folder-upload-and-delete`·`same-name-file`·`trial-options`

### 메뉴 이름 전략 — 이번에 합의된 규칙 (박제)
| 규칙 | 예 |
|---|---|
| **Q + 영어(소문자) = 제품명** → 언어와 무관하게 유지 | `Q talk` `Q task` … `Q sale` |
| **Q 가 안 붙는 것 = 각 언어의 평범한 라벨** | 「도움말」/`Guide` · 「고객·파트너」 · 「문의 인박스」 |
| **예외 `Q helper`**(팝업) | Irene 지시로 그대로 |
- 전면 한글화는 **하지 않는다**: ①제품명을 언어마다 다르게 하면 한 기능에 이름이 둘 ②이름은 화면에만
  있지 않다(도움말 83건·알림·메일·랜딩 색인·URL) ③「Q 메일/문서/파일/청구」는 전부 한글 2자라
  실루엣이 같아 **스캔이 더 느리다**
- **공공·대기업 온프렘용 한글 스킨은 «카드» 로 남긴다** — i18n 이 이미 있어 ko 값만 바꾸면 되므로
  지금 쓸 필요가 없고, 그때 「한글 메뉴로 드립니다」가 협상 재료가 된다

### Irene 결정 대기 (오후분)
1. **`Q sale` → `Q sales`** — 영어권에서 `sale`(단수)은 **할인 행사**로 읽힌다. 영업 활동은 `sales`.
   표시값만 바뀌어 비용 거의 없음. (`Q CRM`·`Q deal`·`Q pipeline` 은 권하지 않음 — 약어·업계용어)
2. **옛 `/wiki` 301 리다이렉트** 넣을지 (nginx 변경)
3. **교차 모드 구멍**(어제부터) — 워크스페이스 모드로 프로젝트 폴더에 올린 파일이 `project_id=null`·L1 이라
   **프로젝트 탭에 안 보인다.** Fable 권고는 프로젝트 파일이 되게 하는 것인데
   **가시성이 L1 → 프로젝트 멤버로 넓어진다.** 임의로 정하지 않음

### Git 상태 (오후 세션 종료 시점)
- `main` · HEAD **`ab2b07a7`**(푸시 완료) · 작업 트리 깨끗 · 운영 **1.63.5**(오후분 미배포)
- 다른 세션 잔여물(내 것 아님, 안 건드림): `dev-backend/test-cal-dbg.js`·`test-qnote-visibility.js`(9/20~21) ·
  `ZZ 게스트검증 업무` 2건(9/05)

---

## 오전 세션 (다른 세션이 남긴 기록 — 지우지 말 것)

**작업 상태:** 완료 (운영 배포 v1.61.0 ~ v1.63.5, 마지막 `5b549002`)
**주체:** [Opus] Opus 5.5 (1M) · 검증 [Fable]

### 완료된 작업 (오전 세션)
- 게스트 진입 P0·A·B (워크스페이스 이름·로고, 공유 링크 멱등 발급·교체, 고객 공개 범위, 로그인 시트)
- 이미지 보안 2a(L1) · 2b 0단계(첨부 사본) · 2b 1·2단계(`image_ctx` + L2/L3 계측, 막지 않음)
- 감사 1~3순위 — 변경 라우트 감사 없음 328 → 98
- 권한 결함 3건 차단(v1.63.5): Cue 초안 승인/거절 · 후보 병합 · 대화방 메시지 — 남의 워크스페이스에 쓰기 가능했다. 운영 흔적 0
- PDF: `?w=` 이미지 누락 수정 → 그 수정이 만든 500 회귀(post 76)를 운영 실측으로 잡아 v1.63.4 에서 줄여 넣기 + 이미지 없이 재렌더
- 서명본 이미지 깨짐 · 기본 발신 계정 해제 · 오류 로그 토큰 노출(redactUrl)

### 다음 할 일
1. **고객 워크스페이스 링크 (docs/CLIENT_ENTRY_DESIGN.md P1)** — Irene 과 합의한 자리: 설정 › 권한 «고객 공개 범위» 옆 «고객 창구» 카드
   (주소·[복사]·[교체]·QR·[고객 화면 미리보기]=새 창) + Q sale 상단 [고객 링크 복사]. 좌측 메뉴에는 넣지 않는다(이동용).
   ★ 시작 전에 Irene 에게 한 줄 확인: **P1+P2(예약) 한 번에(6~8일)** vs **P1 먼저(2~3일)**.
   R=1(무인증 표면·토큰) → Fable. `guest_links.scope` ENUM append `'workspace'` 멱등 마이그레이션 **코드 배포 전**.
2. 작은 후속: `invoice` 무인증 receipt-request 전용 limiter · `file_folder.delete` 감사 oldValue 파일 목록 상한(50 + 총수)
3. 감사 잔여 98 (attendance·leave·notifications 등)
4. 이미지 2b 3단계 — 운영 `l23.would_deny` 를 ~14일 관찰 후(2026-10-08 전후). 켜기 전 Fable · 문서 캐시 60초 판단
5. 결정 대기: 휴지통 L1 행이 산 L3 첨부 사본을 404 로 만드는 것(FABLE_GATE_QUEUE) · nginx `server_tokens off`(sudo)

### 관찰(비차단)
- 보관된 standalone 고객 대화에 고객이 쓰면 409(재활성 안 됨) — 기존 동작, `isClient` 가 프로젝트 분기에서만 계산됨
- `PATCH /api/projects/tasks/:id` 허용 status 목록이 현재 ENUM 과 안 맞음(죽은 경로)

---

## 복구 가이드

새 Claude 세션 시작 시 아래 내용을 붙여넣으세요:

```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```
