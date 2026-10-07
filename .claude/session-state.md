## 현재 작업 상태
**마지막 업데이트:** 2026-10-07 (개발완료) · **주체:** [Opus] Opus 5.5 (+ Fable 검증 서브에이전트 5회)
**작업 상태:** 완료 — 운영 배포 5회(마지막 f19fbfca 12:39, backup 20261007_123113). 이전: **dev 미배포 5커밋**: bf4353d7 체크박스 디자인 · 59fba176+a6e3b66e AI create_event 칸·감사 대상 · 6169cbfe 반복 회차 날짜 · (위키 시드·UI 가이드 문서)

### 진행 중(미커밋): UI/UX 전수 검증 체계 (2026-10-07 밤 · [Opus] 방 f6990861)
- 정본 문서 `docs/qa/UI_VERIFICATION_SYSTEM.md`(왜 샜나 · 기준 · 언제 · 첫 실측). 답: UI 는 Fable 이 아니라 기계 검사 전부를 매일 돌리고 결과를 아침 방이 읽는 것.
- 새 장치: `scripts/e2e/full-sweep.sh`(등록 스위트 전부, 순찰 직후 자동) · `sweep-summary.js` · `run.js` 계정 상태(현재 워크스페이스) 오염 감지·복원 ·
  순찰 확장(상세 23 + 고객 2환경 + 연 창 모양 판정 + 파일창·내려받기 감지 · `PATROL_TAG`/`PATROL_DETAIL_ONLY`) · cron 16:00 UTC · 개발시작 1-C · 검증 8-D 교체
- 고친 실제 결함: 지워진 대상 알림 표시(`services/notificationTargets`) · 고객 정보탭 오류·새 프로젝트 버튼 · 새 프로젝트 창 잘림 · 칩 팝오버 스크롤 닫기 ·
  메일 상세 늦은 응답 덮어쓰기 · 업무 상세 blur 저장 · Q file 나눠 그리기. 낡은 검사기 8개 갱신.
- dev 빌드 반영 · 백엔드 재시작 완료. **미커밋**(같은 폴더에 감사 방 629e3b90 이 돌고 있어 /개발완료 안 함). 운영 미배포.

### 답 기다림: Fable 제품 종합 감사 — 결정 14건 + 0단계 결함 착수 지시 (2026-10-07 · [Opus]+[Fable] 감사 방)
- **무엇을:** Fable 이 6개 영역을 감사했다(`docs/audit-2026-10-07/*.md`). 종합·재검증·로드맵은 `docs/FABLE_PRODUCT_AUDIT_2026-10-07.md` — 결함 30건 재검증(사실로 확인 27), 전체 UX 6.0/10.
  Irene 결정 14건(문서 끝) + 0단계 결함 10묶음(돈·구독 0-A, 청구 정합 0-B, 격리 0-C, 휴지통 0-D 는 R=1 → Fable 게이트) 착수 지시.
- **왜 멈췄나:** ① 정책·가시성·돈 결정은 Irene 몫 ② 같은 폴더에서 «UI/UX 전수 검증» 방이 소스를 고치는 중(한 솔루션 한 편집 방) ③ 운영 읽기(SELECT 5건: 토큰 NULL 청구서·고아 pending 결제·외화·RETENTION_PURGE_APPLY·위키 file_id)가 권한 거부됨
- **답이 오면 할 일:** 편집 방이 비면 0단계 묶음 순서대로 구현 → R=1 묶음마다 Fable 게이트. 운영 SELECT 는 Irene 허용 시 실행해 0-A·0-D 긴급도 확정

### 진행 중인 작업 — (피드백 방은 끝남, 아래는 기록)
- [Opus] 피드백 방 (2026-10-07 밤): ① 운영 답글 5건 발송 완료(#458·#434·#456·#460 reviewing · #415 wontfix) ③ 말하기 데스크탑 4종 끝까지 확인 + Cue 카드 일정 날짜·시간 편집·시간대 일치(3cfbbb8b)
  ② 설문 구현(725ec330 — 설계 docs/SURVEY_DESIGN.md · Fable 설계 수정 7건 반영 · dev 마이그레이션 적용) → ✅ **Fable 라운드 D PASS**(차단 0) · 비차단 a(열쇠 정확 일치 78c5b3e8)·d(시험 데이터) 처리 · 운영 배포는 «결정 8건» 방이 HEAD 통째로 한다(PASS 통보함)
  · 운영 배포 시: `migrate-survey.js` 가 배포 슬롯에 등록됨(코드보다 먼저). 안드로이드 공유는 새 Play 빌드 필요

### 답 기다림 (이전): 남은 피드백 5건 — 운영 답글 승인 + 결정 2개 (2026-10-07 · [Opus] 피드백 정리 방) — Irene 답: ①보내 ②외부 포함 누구나 ③그대로+제대로 → 처리함(아래 «진행 중»)
- **무엇을:** ① 운영 피드백 답글 5건 보내도 되나(초안 `docs/feedback-replies-2026-10-07.json` — #458·#434·#456·#460 reviewing, #415 wontfix(본인이 남긴 빈 글)) ② #460 설문: 누가 응답하나(내부·로그인 고객만 / 외부 누구나) ③ #458 데스크탑 말하기: 그대로 보이기(권고) / 숨기기
- **왜 멈췄나:** 답글은 운영 데이터 쓰기 + 보고자 알림(Irene 지시 없이 안 함). 설문 외부 응답은 무인증 공개 표면(R=1)이라 Irene 결정 뒤 Fable 설계
- **답이 오면 할 일:** ① 배포 후 운영에서 `node scripts/feedback-reply.js <json> --apply`(배포 전이면 /tmp 로 복사) ② (가)면 표 문서 «설문으로 받기»+통계 구현 / (나)면 Fable 설계 게이트부터 ③ 숨기기면 RightDock 말하기 항목을 마이크 없는 기기에서 숨김

### 답 기다림: Irene 직접 할 일 3가지 — 구글 심사 · AI 앱 재연결 · 중복 연결 정리 (2026-10-07 · [Opus] 결정 8건 방, 상황판 요청 askmuyci17b)
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
5. Irene: ChatGPT 재연결(docs:write) · front_v4.jpg 운영 확인

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
