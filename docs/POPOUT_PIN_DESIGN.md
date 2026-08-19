# 팝아웃 "항상 위 고정(핀)" — 1클릭 설계 (#258 · #280 · #286)

> 세 번 신고된 건. 2026-08-19 Fable 실측으로 **1클릭이 가능함**이 확인됐다.
> 그 전까지는 "브라우저 규칙상 불가" 라고 판단해 **안내 문단**으로 답하고 있었다 — 그 판단이 틀렸다.

## 실측 결과 (Chrome for Testing, headful + Xvfb, 3회)

⚠️ 1·2차는 puppeteer 의 `page.evaluate` 가 CDP `userGesture:true` 로 돌아 **가짜 활성화가 심어져 오염**됐다.
3차는 모든 evaluate 후 8초(transient 만료) 대기 + 음성 대조군으로 정화한 값이다.

| 실험 | 결과 |
|---|---|
| 음성 대조군 — 제스처 0 상태에서 메인 창이 직접 `requestWindow()` | **NotAllowedError** (제약이 실재함을 증명) |
| (a) 팝아웃이 `window.opener.documentPictureInPicture.requestWindow()` **동기 직접 호출** | **실패** (2회) |
| (b) 팝아웃 → 메시지 → **메인 창**(8초간 제스처 전무·비포커스·배경 탭)이 `requestWindow()` | **성공** (2회) |
| (c) 팝아웃이 연 PiP → 팝아웃을 닫으면 | **PiP 같이 죽음** |
| 메인 창이 연 PiP → 팝아웃을 닫아도 | **생존** ("창 2개" 안 됨이 성립) |

**해석**: Chrome 이 사용자 활성화를 **같은 출처의 오프너 체인 창**에 전파한다. 전파가 비동기라
동기 직접 호출(a)만 실패한다. 따라서 릴레이 방식(b)이 정답이다.

**단서**: 자동화 브라우저 실측이므로 **구현 후 실 브라우저 육안 1회 확인 필수**(반증 1).
활성화 전파는 오프너 체인 범위만 신뢰 → **BroadcastChannel 광역이 아니라 `window.opener` 직접 postMessage**.

## 주 사양 — 1클릭 릴레이

1. **팝아웃 핀 클릭** (`PopoutPinButton`, `pin.isPip === false` 분기)
   - 안내 카드 **전부 삭제**
   - `opener && !opener.closed` 면 `window.opener.postMessage({ type:'planq:pin-request', tool, title }, location.origin)`
   - 버튼은 "고정 중…" 상태로. **클릭 즉시** 보낸다 — 활성화 창(약 5초) 안에 메인 창의 `requestWindow` 가 돌아야 한다
2. **메인 창 상시 수신자** (★ `pinOwner.ts` 의 `openChannel()` 이 pin 성공 후에만 열려 메인 창이 못 듣던 구멍)
   - `pinOwner.ts` 모듈 초기화 블록에 `window.addEventListener('message', …)` **상시** 등록
   - 조건: `ev.origin === location.origin` && `ev.data.type === 'planq:pin-request'` && **이 창이 팝아웃/PiP 가 아닐 것**(`utils/popout.ts` realPopout 가드 재사용) → `pinOwner.pin(tool, title)`
   - 기존 BroadcastChannel 프로토콜(`pin-intent`/`pin-ack`/`unpin-request`)은 **손대지 않는다**
   - opener 직접 타겟팅이라 다중 메인 탭 수신자 선출 문제가 없다
3. **팝아웃 닫는 시점** — 기존 #286 의 `pin-engaged` 수신 시 자기닫기 **그대로**.
   즉 **PiP 가 실제로 성사된 뒤에만** 닫힌다. 릴레이 실패 시 팝아웃은 산다(창 소실 없음)
4. **실패 처리** — 클릭 후 3초 안에 `pin-engaged` 미수신이면(오프너 사망·PiP 미지원·거부)
   `window.opener?.focus()` + 아래 폴백의 arm 브로드캐스트 + 버튼 옆 **한 줄**:
   `"메인 창에서 핀을 한 번 더 눌러 주세요"` / `"Press the pin once more in the main window"`
   **안내 문단은 어떤 경로에서도 부활 금지**
5. **녹음 중 예외 유지** — `body.dataset.recordingActive === '1'` 이면 릴레이를 보내지 않고
   핀 disabled + 툴팁 `"녹음 중에는 고정할 수 없어요 — 녹음이 끝나면 눌러 주세요"`
   (녹음은 팝아웃 마이크에 붙어 있어 이 창을 닫을 수 없고, 안 닫으면 창이 2개가 된다)

## 폴백 사양 — 실 브라우저에서 릴레이가 반증되면 (그리고 4번 실패 경로의 몸통)

- 핀 클릭 → `window.opener.focus()` + `{ type:'pin-arm', tool, title }` → 메인 창 RightDock 의 해당 도구
  핀 버튼이 **armed**(Coral pulse + `aria-live` 라벨), 30초 후 자동 해제 → 사용자가 그 버튼 클릭 =
  기존 `pin()` 경로 → `pin-engaged` 로 팝아웃 자기닫기. **총 2클릭**
- 팝아웃 문구는 제약 설명이 아니라 **다음 동작만**: `"메인 창에서 깜빡이는 핀을 누르면 여기로 고정돼요"`
- arm 수신자도 2번과 같은 **상시 리스너**로 (현행 구조로는 메인 창이 못 듣는다)

## 반증 목록 (구현 후 — Fable 게이트)

1. **실 Chrome 육안 1회** — 팝아웃 핀 1클릭 → PiP 뜸 + 팝아웃 자동 닫힘 + **화면에 창 = PiP 1개뿐**
2. **핀 실패 시 창 보존** — `requestWindow` 를 강제 실패시키고 클릭 → 팝아웃이 **안 닫히고** 폴백 한 줄.
   성사 전 자기닫기 = 회귀
3. 메인 탭이 **배경/비포커스**일 때도 1클릭 성공
4. **오프너 사망**(메인 탭 닫힘) 후 클릭 → 예외 없이 폴백. 콘솔 에러 0
5. **녹음 중** — 핀 disabled + 툴팁, 릴레이 미발신, 녹음 무중단. 종료 후 재활성
6. **기존 도크 핀 무회귀** — 도크 핀 → 같은 도구 팝아웃 자기닫기(#286) 그대로. 도구 교체 시 PiP 1개 유지
7. **상시 리스너 격리** — 팝아웃/PiP 창 자신은 `pin-request` 를 처리하지 않는가(realPopout 가드).
   타 오리진 postMessage 거부(origin 검사)
8. i18n ko/en 패리티 + `--category=i18n` PASS · **옛 안내 문단 키 잔존 0**(grep 으로 사망 확인)
9. `npm run build` 실 exit 0 (파이프 뒤 가림 금지 — 별도 파일 박제)
