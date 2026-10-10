## 현재 작업 상태
**마지막 업데이트:** 2026-10-10 새벽
**작업 상태:** 완료 (방 006a5c5d — 관리자 열람 규칙 D2·D3·D4, Fable PASS · 방 58947e65 — 체험 중 결제 환불, Fable 설계·완료 PASS) · **운영 미배포 커밋 다수**(646974b5 v1.70.1 이후)

### 진행 중인 작업
- 없음

### 완료: 캘린더 지난 일정 흐리게 (2026-10-10 · 방 fae6dd42 · [Opus] · Fable 안 씀 — 색·표시만, 공용 기준상 대상 아님)
- 끝난 일정(끝 시각 ≤ 지금, 워크스페이스 벽시계) = 불투명도 0.55 · 마우스 올리면 0.85. 업무(마감)는 흐리게 안 함(늦은 것 ≠ 끝난 것). 진행 중·오늘 종일은 그대로.
- 한 벌 `pages/QCalendar/pastLook.ts`(pastAttr·pastCss·useWallNow 1분 갱신) — 월 칸·월 팝오버·종일·시간표·목록 5곳. 시간표의 현재 시각 선도 1분마다 움직이게(전엔 화면 연 시각에 멈춰 있었다).
- 검증: build EXIT 0 · guard 68/69 · 실브라우저 3폭×3보기 58 ✅ 0 ❌(미측정 6 = 다른 보기에서 잰 것) · 픽스처 잔여 0. 운영 미배포.

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
