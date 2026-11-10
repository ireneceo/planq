# PlanQ 데스크탑 앱 — 2단계 «네이티브답게» 설계 초안 (2026-11-10)

> Irene 2026-11-10: *"데스크탑 네이티브앱 개발하는 거 어때? … PWA 말고 네이티브 앱으로 만들면 더 완벽한 서비스 되는 거 맞아?"*
> → (검토 답 뒤) *"뭘 한거야? 네이티브 앱 개발하자고 한거잖아."* = 개발 지시.
> 1단계 정본 `docs/DESKTOP_APP_DESIGN.md`(Fable DESIGN-READY · 완료 검증 PASS 424ac6fc). 1단계는 **만들었지만 아직 사용자에게 안 나갔다**.

## 0. 지금 사실
- `desktop/` Electron 44.9 원격 껍데기(창 = planq.kr). 트레이·단일 실행·자동 실행·배지·팝아웃 여러 개 항상 위·OS 알림·구글/애플 로그인 복귀·자동 업데이트(electron-updater generic)·e2e `--suite desktop`.
- 1단계에서 **뺀 것**(설계 §2): Q Note 시스템 소리 · 창 밖 네이티브 메뉴 · 전역 단축키 · 윈도우 코드서명 · 꺼져 있을 때 알림 · 스토어 · 오프라인 화면.
- 앱 안에서 지금 PWA(크롬)보다 **못한** 것: Q note «온라인 회의» 녹음(getDisplayMedia 를 열지 않아 비활성 — `WebConferenceCapture.isAvailable`).
- 게시 막힘: 맥 Developer ID·공증 없음 · 운영 nginx `/desktop/` 없음 · dist 가 dev 출처.

## 1. 2단계 범위 (제안)
**A. 내보내기(1단계 마무리)** — 운영 출처 빌드(윈도우 wine · 맥 codemagic) → `publish.sh`. Irene 할 일: 맥 인증서·공증, nginx `/desktop/`(sudo). 윈도우는 서명 없이 먼저(SmartScreen 안내) · 서명은 후속.

**B. Q note 온라인 회의 녹음을 앱에서 — 화면 고르기 없이 «시스템 소리 + 마이크»**
- main `session.setDisplayMediaRequestHandler` — APP_ORIGIN 메인/노트 창의 요청만, `desktopCapturer` 첫 화면 + `audio: 'loopback'`(윈도우 WASAPI 루프백 · 맥 13+ ScreenCaptureKit). 영상 트랙은 받자마자 끈다(웹과 같은 처리).
- 웹 `WebConferenceCapture.isAvailable` 의 `!isDesktopApp()` 를 `desktop 이면 planqDesktop.capabilities.systemAudio` 로. 맥은 «화면 기록» 권한 안내 한 줄(거절이면 설정 열기 — openExternal 예외 1개 추가 `x-apple.systempreferences:…Privacy_ScreenCapture`).
- 효과: 줌·팀즈 **데스크탑 앱** 회의도 녹음된다(크롬 탭 공유로는 브라우저 탭 소리만) — PWA 로는 구조적으로 불가한 것.

**C. 전역 단축키 «빠른 업무 추가»** — 다른 프로그램을 쓰다가 `Ctrl/Cmd+Shift+Space` → 작은 창(기존 `/task-popout` 의 할 일 입력 — 새 화면 그리지 않음, `?quick=1` 이면 입력칸 포커스) → Enter 로 추가·Esc 숨김. 설정에서 끄기·키 바꾸기(트레이 메뉴 + 설정 «데스크탑 앱»). 단축키 등록 실패(다른 앱이 씀)는 설정에 보인다.

**D. 연결 끊김 화면** — `did-fail-load`(메인 프레임·네트워크 오류)면 껍데기 안 정적 페이지(`desktop/src/offline.html` — ko/en, «다시 연결» 버튼 + 10초마다 자동 재시도). 지금은 흰 화면.

**E. 맥 메뉴바·윈도우 점프 목록** — 맥 «파일 > 새 업무 / 새 메모 / Q talk 열기» · 윈도우 작업표시줄 우클릭 «새 업무·Q task·Q talk». 모두 기존 팝아웃 열기 경로(`pq-*`).

**뺀다(3단계 이후)**: 꺼져 있을 때 알림(트레이 상주가 대답) · 스토어 배포 · 로컬 UI 번들(오프라인 작업) — 웹 배포로 같이 고쳐지는 장점을 버리게 된다.

## 2. 표면 변화
- preload: `capabilities: { systemAudio: boolean }` · `onQuickAdd(cb)` · `getShortcut()/setShortcut(accel)` 만 더함. main IPC 출처 검사 그대로.
- 권한: `display-capture` 를 APP_ORIGIN 에만. 카메라는 계속 거절.
- 서버/DB 변경 0.

## 3. 검증
e2e `desktop` 에 더함 — B: 핸들러가 다른 출처 요청 거절 · 같은 출처는 오디오 트랙 1+ / 영상 0 (리눅스 xvfb 는 루프백 없음 → 핸들러 판정만 기계, 소리 녹음은 실기기) · C: 단축키 → 창 보임·입력 포커스·추가 1건(실 API) · D: 존재하지 않는 출처로 띄워 오프라인 화면 → 출처 복구 후 자동 복귀 · E: 메뉴 항목이 같은 `pq-*` 창 재사용. 웹 회귀 build·guard·tenant·`qnotenewnote`(크롬은 그대로).

## 4. Fable 설계 판정 (2026-11-10) — DESIGN-FIX → 아래 6개를 설계에 넣음
1. **B 요청 판정** — 메인 창 + 같은 출처 + `userGesture` 일 때만. 영상은 «첫 화면» 대신 요청한 자기 프레임(`request.frame`) — 실기기에서 loopback 이 안 붙으면 화면 영상 + main 쪽 **첫 회 네이티브 확인창**. 녹음 중에는 트레이에 표시. (이유: 원격 껍데기라 planq.kr XSS 하나면 화면·시스템 소리를 조용히 가져간다.)
2. **B 맥 불확실 3건은 스파이크로 확정** — Info.plist `NSAudioCaptureUsageDescription`(14.2+) 필요 여부 · 권한 거절 때 «무음 트랙» 판정 · 15 의 주기 재허용. `systemAudio` 판정은 main(OS·버전), 웹은 `undefined` 를 false 로 읽는다(웹·껍데기 버전 엇갈림).
3. **C 단축키** — `setShortcut` 은 메인 창만 · main 이 수식키(Ctrl/Cmd/Alt) 필수 형식 검증. 빠른 추가 창은 `baseWebPreferences()` 그대로 · 로그아웃이면 메인 창. 저장 키는 기존 `/task-popout` 입력 규칙 그대로(Enter 단독 금지와 맞춤 — 「Enter 로 추가」 문구 철회). ← **구현 2026-11-10** (아래 §6).
4. **D 연결 끊김** — `offline.html` 은 **preload 없는 전용 보기**(WebContentsView) · 재시도는 main 타이머 · `ERR_ABORTED(-3)` 제외 · 메인 프레임 5xx 응답도 같은 화면. ← **구현 2026-11-10** (`desktop/src/main.js` showOffline · `desktop/src/offline.html` · 검사 `scripts/e2e/canary-desktop-offline.js`).
5. **E** 점프 목록·메뉴 인자는 고정 허용 목록(`--pq-action=…`)만 — `second-instance` 가 임의 URL 을 받지 않는다. 가치가 가장 낮아 맨 뒤. ← **구현 2026-11-10** (아래 §6).
6. **A** 윈도우 **무서명 출시는 Irene 결정**(SmartScreen 경고 · 자동 업데이트 무결성이 TLS·서버에만 기댐). **맥 인증서는 B 의 선행 조건**(화면 기록 권한은 서명된 앱이어야 유지된다).

**순서(판정대로)**: B 스파이크(윈도우·맥 실기기 각 1회 — 맥은 서명 뒤) → D ✅ → C → E → A 게시. B 스파이크가 실패한 OS 는 `systemAudio:false` 로 두고 나머지를 진행.
**기계 검증**: 다른 출처·팝아웃·제스처 없는 요청 거절 · 단축키 검증 거절(양성 대조군) · 오프라인 전환·복귀 · 점프 목록 인자 허용 목록 · asar 시험 표면 0.
**실기기만**: 실제 소리(무음 포함) · 맥 권한 흐름 · 단축키 충돌 · SmartScreen·공증 · 서명된 빌드 자동 업데이트.

## 5. 맥 서명 준비 (2026-11-10)
- `desktop/build/entitlements.mac.plist` — JIT 2줄 + `device.audio-input`(없으면 서명한 앱에서 Q note 마이크가 조용히 막힌다) · build.js 가 stage 로 복사·`mac.entitlements`.
- `codemagic.yaml desktop-mac` 에 환경 묶음 `planq_desktop_mac`(CSC_LINK · CSC_KEY_PASSWORD · APPLE_ID · APPLE_APP_SPECIFIC_PASSWORD · APPLE_TEAM_ID) — Irene 할 일.
- 운영 `/desktop/` 자리: `scripts/apply-nginx-desktop.sh`(폴더 + nginx 블록 + 없는 파일 404 확인) — Irene 할 일(sudo).

## 6. C·E 구현 (2026-11-10)
- **C 빠른 업무 추가** — `desktop/src/shortcut.js validateAccel`(main 검증: Ctrl/Cmd/Alt 필수 · Ctrl/Cmd 하나 + 글자·숫자 거절(복사·붙여넣기 빼앗기 방지) · 수식키만·Super 거절) ·
  `main.js openQuickAdd` — 창 `baseWebPreferences()` · `/task-popout?quick=1` · Esc/닫기 = 숨김(다음에 바로) · `/task-popout` 밖으로 가면(로그인) 창을 닫고 메인 창.
  설정은 userData `desktop-settings.json` · 등록 실패 = `registered:false, error:'in_use'`(설정 화면에 보임) · 바꾸다 충돌이면 옛 키로 되돌림.
  웹: `useDesktopQuickMode` — 입력 칸을 가려 두었어도 보이고 뜰 때마다 포커스(저장은 기존 PopoutQuickAdd 그대로). 설정 > 알림 «이 컴퓨터(데스크탑 앱)» 칸 아래 `DesktopQuickAddShortcut`(켜기·키 바꾸기·기본값). 트레이에 «빠른 업무 추가»·«단축키로 빠른 업무 추가» 체크.
- **E** — `--pq-action=` 허용 목록 `quick-task|qtask|qtalk|qnote`(`actionFromArgv`) · 윈도우 `setUserTasks` · 맥 «파일» 메뉴 + 독 메뉴(같은 동작). 팝아웃은 main → `planq:action` → 웹 `launchDockTool`(같은 pq-* 창).
- preload 더함: `getShortcut` · `setShortcut`(메인 창만) · `onQuickAdd` · `onAction` — 웹 타입은 모두 선택(옛 껍데기 호환).
- 검사 `scripts/e2e/canary-desktop-quick.js`(`--suite desktopquick`) — 양성 대조군(수식키 없는 키·흔한 키 거절 + 정상 키는 받음) · 가림 설정 대조 · 점프 목록 허용 목록 밖 무시 · 로그아웃이면 메인 창.
- 실기기만: 실제 전역 키 입력·다른 앱과의 충돌 · 윈도우 점프 목록 표시 · 맥 메뉴/독 메뉴 표시.

## 6. 윈도우 서명 — Fable 결정 C (2026-11-10 · Irene «fable 이 다 파악하고 결정하라고 해»)
**무서명은 제한 파일럿만, 공개 게시는 서명 뒤.** 이유: 무서명 공개는 B2B 신뢰(SmartScreen «알 수 없는 게시자»·회사 PC 정책 차단)를 되돌리기 어렵게 깎고, 무서명 자동 업데이트는 TLS·서버(nginx 한 대)만 믿어 서버가 뚫리면 설치된 모든 PC 에 임의 코드가 깔린다 — 대수가 적을 때만 감수. 아직 아무도 의존하지 않아 기다리는 비용이 거의 없다.
- 인증서: 한국 법인 **OV 코드서명 · 클라우드 서명형**(빌드가 리눅스 wine 이라 USB 토큰형 불가 — 예: DigiCert KeyLocker, SSL.com eSigner). EV 불필요. Azure Trusted Signing 은 한국 법인 자격이 안 될 가능성이 높음(확인만). ※ 자격·가격은 Fable 기억 기반 — 신청 전 확인.
- 파일럿: 무서명 빌드를 `/desktop/` 에 올리되 `platform_settings.app_windows_url` 은 **비워 둔다**(공개 버튼 숨김) — 직접 링크로 사내·우호 고객 3~5대. 안내문에 SmartScreen «추가 정보 → 실행».
- 공개 조건(모두): ① 윈도우 설치 파일 서명(게시자 = 법인명) ② 서명→서명 자동 업데이트 실기기 1회 통과 ③ 파일럿 치명 결함 0.
- 서명 전환: 무서명 설치본은 서명된 업데이트를 그대로 받는다(안전). **서명 빌드부터 `publisherName` 명시** — 갱신 때 CN 이 바뀌면 업데이트가 조용히 거절되므로 같은 표기 유지 또는 새 이름을 배열에 먼저 추가해 한 버전 내보낸다. 파일럿 PC 가 서명 버전으로 올라왔는지 확인. 파일럿 동안 latest.yml sha512 유지 · desktop-releases 쓰기 권한 최소.
- 할 일: (Irene) 인증서 신청 카드 · (개발) 파일럿 업로드(nginx 자리 뒤) · 인증서 도착 시 서명 단계 + publisherName · 조건 충족 뒤 URL 설정 · `.claude/rules/desktop-app.md` 에 만료일·CN 유지 주의(그 파일은 다른 방이 고치는 중이라 그 방 커밋 뒤에).
