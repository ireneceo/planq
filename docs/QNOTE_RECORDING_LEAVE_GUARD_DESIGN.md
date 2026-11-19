# Q Note 녹음 중 이탈 보호 — 설계 (2026-11-19 · Fable DESIGN-READY)

> Irene: *"노트에서 녹음이나 녹화할 때 갑자기 나가게 되는 일이 생기곤 해. 나가지 못하게 하고 안내하고 나서 원하면 나가게 하거나 아니면 새창으로 계속 녹음을 하는데 문제없게 하고 시작하거나 뭔가 조치가 필요해. fable 검토해줘"*

## 원칙
**탭 모드에서는 묻지 않고 녹음 탭을 살린다(이동을 다른 탭으로 돌림). 살릴 수 없을 때만 묻는다.**
보호 대상은 `phase==='recording'` 뿐(`paused` 는 이미 LiveSession stop + 잠금 반납 — 지킬 것이 없다).

## 한 지점 — `services/recordingGuard.ts`
- `register(ownerKey, { tabId|null, stop })` / `unregister` / `isActive()` / `ownersOfTab(tabId)` / `requestLeave(reason, run)`.
- `body.dataset.recordingActive` 는 여기서만 세운다.
- 활성이면 App 루트 `RecordingLeaveGuard` 확인창 → [녹음 계속하기](기본) / [녹음 멈추고 …] → stop(멈춤) → run.
- «새 창에서 계속» 버튼 없음(스트림을 창 사이로 옮길 수 없다).

| 경로 | 처리 |
|---|---|
| A 탭 모드 메뉴 이동 | `navigateActive`: 녹음 탭이고 목적지 identity 가 다르면 `openInNewTab` 로 돌림 + 탭 빨간 점 + 1회 안내 |
| A·F 화면 안 이동 | `components/Tab/LeaveGate` — `UNSAFE_NavigationContext` navigator 를 감싸 재공급(TabPane MemoryRouter·미러 BrowserRouter 아래). 탭 모드 = 새 탭으로 돌림 / 미러 = 묻기 / `go(n)` = 묻기 |
| A 미러 뒤로가기 | 녹음 중 표식 히스토리 칸 1개. popstate 로 빠지면 재push + 묻기 |
| B 탭 닫기 | `closeTab` → 묻기 |
| C LRU·탭 10개 상한 | 녹음 탭은 정지·닫기 대상에서 제외 |
| D 새로고침·창 닫기 | 녹음 중에만 `beforeunload` preventDefault. **잠금 반납은 pagehide 로만** |
| E 로그아웃·워크스페이스·계정 전환·범위 교체 | 진입 첫 줄에서 묻기 |
| G 데스크탑 종료·Ctrl+R | main `will-prevent-unload` → 네이티브 대화창. 웹은 preload 지원 표식이 있을 때만 데스크탑에서 beforeunload 를 건다 |

언마운트 cleanup 의 `liveRef.stop()` 은 최후 안전망으로 유지.

## 넣지 않은 것 — «새 창에서 녹음»
스트림을 못 옮겨 «시작 때 미리 고르기» 로만 가능한데 사용자는 나갈 줄 모르고 시작한다 · 탭 모드의 «녹음 탭 고정 + 이동은 다른 탭» 이 같은 보장을 선택 없이 준다 · 폰·앱은 창을 못 연다 · 5,415줄 화면에 두 번째 껍데기만 는다.

## 범위 밖
녹음 엔진을 앱 수준으로 올리기·data router 전환 · 네트워크/STT 끊김 알림 · 폰 백그라운드/화면 잠금 · 서버가 끊는 강제 로그아웃 · 다른 창의 워크스페이스 전환(isReloadSafe 가 보류) · paused 보호.

## 검증 — `--suite recleave`
가짜 마이크로 실제 «바로 녹음». 살아 있다 = 정지 버튼 보임 ∧ `recordingActive==='1'` ∧ 15초 뒤 서버 `recorder_lock.active && mine`.
양성 대조군: 구현 전 HEAD FAIL 기준선 · [멈추고 이동] 뒤 ③ 이 거짓으로 뒤집힘 · paused 에서는 확인창 0.
