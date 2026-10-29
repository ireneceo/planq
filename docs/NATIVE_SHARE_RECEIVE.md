# 네이티브 앱 «공유 받기» 설계 (#434 ②) — 2026-09-29

> Irene #434: *"모바일에서 이미지나 파일을 쉐어하면 앱을 선택하고 파일로 넣을지 채팅방에 넣을지 프로젝트로 파일로 넣을지
> 다양한 경로를 선택하게 해주고 파일에서는 폴더도 만들 수 있어야 하지 않아?"* — 결정: **네이티브까지, 한 앱 빌드로.**

## 상태

| 부분 | 상태 |
|---|---|
| ① 공유 받은 뒤 화면 (`/share-receive`, 웹·앱 공용) | ✅ 2026-09-29 — 대화방 고르기 · 저장 위치(회사 파일/프로젝트 → 폴더 · 새 폴더) · 문서가 글·첨부를 받음. 카나리 `--suite sharereceive` |
| ② 안드로이드 공유 수신 | ✅ 코드 2026-10-07 — **새 앱 빌드(Play)가 나가야 사용자에게 닿는다** (아래 «안드로이드 — 구현») |
| ② iOS Share Extension | ⏳ 상세 설계·일정 2026-10-29(아래 «iOS 상세 설계») — **Apple 개발자 계정 작업이 먼저** (아래 전제) |

## 핵심 결정 — 입구는 하나다

네이티브가 받은 파일을 **웹 공유(PWA share_target)와 같은 자리**에 넣는다:
캐시 `planq-share-v1` 의 `/_share_payload`(JSON: title·text·url·fileCount·ts) + `/_share_file_{i}`(본문 + `X-Filename` 헤더) →
`/share-receive?shared=1` 로 이동. 그러면 ① 화면·검사(`sharereceive` 카나리)를 그대로 쓴다.
**네이티브 전용 공유 화면을 새로 만들지 않는다** — 만들면 웹과 앱의 선택지가 갈라진다(CLAUDE.md «새로 만들지 않는다»).

앱은 원격 껍데기(`server.url`)라 JS 는 서버에서 오지만, **플러그인은 앱 바이너리 안에 있어야** 한다 → 새 앱 빌드가 필요하다.

## 안드로이드 — 구현 (2026-10-07, [Opus])

- 외부 플러그인 없이 **우리 플러그인 한 파일**: `android/app/src/main/java/app/planq/ShareReceivePlugin.java`
  (MainActivity 가 `registerPlugin`). 받은 파일을 앱 캐시 `share-in/` 로 복사만 한다 — 파일당 50MB · 합 100MB · 10개, 넘으면 건너뛴다.
  후보였던 `@capgo/capacitor-share-target` 은 관리가 8.x(Capacitor 8)로 넘어가 7.x 는 멈춰 있다 — 바이너리에 남의 코드를 넣지 않았다.
- JS `services/nativeShare.ts` 가 웹 공유(sw.js)와 **같은 캐시 형식**으로 옮기고 `/share-receive?shared=1&n=…` 로 보낸다. `NativeBridge` 가 묶는다.
- intent-filter `SEND`·`SEND_MULTIPLE`, mimeType 은 manifest.json share_target.accept 와 같은 목록.
- 검증(에뮬레이터 API 34, dev 를 가리키는 디버그 APK): 파일 앱 → 공유 시트에 **PlanQ 가 뜬다** → 누르면 «PlanQ 로 공유» 화면에
  `share-test.png 8.5 KB`(원본 8,659바이트) — **켜져 있을 때 ✅ · 꺼져 있을 때(콜드 스타트) ✅**. 회귀 `--suite sharereceive` 0 실패.
  ★ `adb shell am start … --grant-read-uri-permission` 으로는 **사진 읽기 권한이 넘어가지 않아** 파일 0개로 보인다(셸이 MediaStore 권한을 못 넘김).
  실제 공유 시트(파일 앱)로 재야 한다 — 이것 때문에 «파일이 안 붙는다» 로 오판할 뻔했다.
- 빌드 환경: 이 서버 JDK 는 17 뿐이라 Capacitor 7(21 필요) 빌드가 안 된다. 검증 때는 작업 임시 폴더에 JDK 21 을 받아 썼다(시스템 무변경). CI(Codemagic)는 java 21.

## 안드로이드 (원래 설계)

1. `AndroidManifest.xml` 의 MainActivity 에 intent-filter 추가: `ACTION_SEND` · `ACTION_SEND_MULTIPLE`, mimeType `image/*` · `application/pdf` ·
   오피스 문서 · `text/plain` · `application/zip`(manifest.json share_target 의 accept 와 **같은 목록**).
2. 받는 쪽: Capacitor 7 호환 공유 수신 플러그인(후보 `@capgo/capacitor-share-target`) — 앱이 켜질 때·켜져 있을 때 둘 다 이벤트를 받는다.
3. `NativeBridge.tsx` 에서 이벤트 → 파일 URI 를 읽어 위 캐시에 넣고 → `planq:navigate` 로 `/share-receive?shared=1`.
   ★ 콜드 스타트에 문서를 다시 로드하지 않는다(CLAUDE.md «네이티브 앱은 우리 JS 가 돌기 전에 죽을 수 있다» 1·2번 — 딥링크와 같은 통로).
4. 로그인 전이면 로그인 뒤 이어서(`planq_boot_deeplink` 와 같은 보관 방식). 캐시 TTL 10분은 ① 과 같다.

## iOS

1. Xcode 에 **Share Extension** 타깃 추가(번들 ID 예: `app.planq.ShareExtension`).
2. **App Group**(예: `group.app.planq`)을 앱·확장 양쪽 entitlements 에 — 확장이 받은 파일을 공유 컨테이너에 쓰고,
   `planq://share` 로 본 앱을 연다(커스텀 스킴은 이미 등록돼 있다 — `appUrlOpen`).
3. 본 앱은 공유 컨테이너를 읽어 안드로이드 3번과 **같은 함수**로 캐시에 넣는다.
4. 확장은 메모리 한도가 작다(약 120MB) — 큰 동영상은 확장에서 복사만 하고 올리기는 본 앱이 한다.

### 전제 (Irene / Apple 계정 작업 — 코드로 대신할 수 없다)
- Apple Developer 에서 App Group 생성 · 확장 번들 ID 등록 · 두 번들 모두 App Group capability 켜기
- 확장용 **프로비저닝 프로필** 발급 → Codemagic 서명 설정에 추가(지금은 본 앱 프로필 1개뿐)
- TestFlight 로 실기기 확인(공유 시트에 PlanQ 가 뜨는가 · 사진 여러 장 · PDF · 로그아웃 상태)

## iOS 상세 설계 + 일정 (2026-10-29, 방 e2db7199 · [Opus] 초안 → [Fable] 설계 검토 DESIGN-FIX 6건 → 반영)

> #456 «아이폰 공유 시트에 PlanQ 가 안 뜬다 — 테스트 앱이라서?» → **아니다.** 앱에 공유 확장 타깃이 아예 없다
> (`App.xcodeproj` 타깃 = `App` 하나 · entitlements 에 App Group 없음, 2026-10-29 확인). TestFlight 빌드도 확장이 있으면 공유 시트에 뜬다.
> 안드로이드는 코드가 끝났고(76da612a) Play 에 새 빌드가 올라가야 뜬다(상황판 할 일 `todomv5a7m3l`).

### 흐름
```
사진 앱 «공유» → PlanQ (Share Extension, 화면 거의 없음: «PlanQ 로 보내는 중…»)
  ① UTType 을 정본 목록과 대조(안 맞으면 skipped) · 사진은 JPEG 표현 우선 · 받은 항목을 App Group 컨테이너 group.app.planq/share-in/<ts>/ 에 «파일째» 복사(loadFileRepresentation — 메모리에 안 올림)
     + manifest.json {title,text,files:[{name,mime,size,file}],skipped,ts}
  ② planq://share 로 본 앱 열기 → 성공하면 completeRequest
     실패(애플이 막은 iOS 판) → 확장 화면에 «PlanQ 앱을 열면 이어서 고를 수 있어요» + [닫기]  (받은 것은 남아 있다)
본 앱 (원격 껍데기 WebView)
  ③ Swift 플러그인 ShareReceive(iOS) — 안드로이드와 **같은 이름·같은 메서드**: takePending() / 'shareReceived' 이벤트
     App Group 의 가장 최근 묶음(10분 안)을 앱 캐시 share-in/ 로 옮기고 경로 목록을 돌려준 뒤 모든 묶음 삭제 — 이것이 정본, 이벤트는 신호
  ④ services/nativeShare.ts — 플랫폼 분기 android → android|ios 로만 넓힘. 나머지(캐시 형식·/share-receive 이동)는 그대로
  ⑤ 'shareReceived' 는 planq://share 를 받을 때 + 앱이 앞으로 나올 때(다른 경로로 앱을 연 경우) 둘 다 쏜다
```

### 결정 (Fable 설계 검토 DESIGN-FIX 6건 반영, 2026-10-29)
1. **확장은 «넘겨주기» 만 한다 — 고르는 화면은 웹 `/share-receive` 하나.** 확장 안에 대화방·프로젝트 목록(SwiftUI)을 두면
   로그인 토큰을 공유 키체인에 꺼내 두고 API·권한 술어를 Swift 로 두 벌 만든다(웹과 선택지가 갈라짐 — 위 «입구는 하나다»).
2. **본 앱 열기는 응답자 사슬로 `UIApplication.open(_:options:completionHandler:)`** — 공유 확장은 공식 `openURL` 이 없다(위젯·iMessage 만).
   옛 `openURL:` 셀렉터는 iOS 18 에서 죽었다. 심사 거절 사례는 «아무 일도 안 하고 앱만 띄우는» 확장이다 — 우리는 복사·상태 표시를 한다.
   - 셀렉터는 `responds(to:)` 로 확인하고 없으면 **바로 폴백**(크래시 금지).
   - `completeRequest` 는 **복사·manifest.json 쓰기가 끝난 뒤**, open 의 completion(또는 2초 타임아웃)에서 부른다 — 먼저 부르면 확장이 끝나 open 이 안 된다.
   - 실패 화면은 막다른 길이 아니다: **[PlanQ 열기] 버튼**(같은 호출을 사용자 손으로 한 번 더) + «앱을 직접 열어도 10분 안이면 이어집니다».
   - **정본은 `takePending` 이 App Group 을 직접 읽는 것**, `shareReceived` 이벤트와 `planq://share` 는 신호일 뿐(안드로이드와 같은 원칙 — 콜드 스타트에 URL 이벤트가 리스너보다 먼저 와도 무해).
   - 주소는 **`planq://share` 로 끝낸다** — `/` 를 붙이면 NativeBridge 가 pathname `/` 를 대시보드 이동으로 받아 공유 이동과 경주한다.
3. **묶음 정리·동시 공유** — App Group 은 OS 가 비워 주지 않는다. 확장은 시작할 때 share-in/ 의 10분 지난 묶음을 지운다.
   본 앱 `takePending` 은 **가장 최근 묶음 하나만** 옮기고 나머지는 지우며, 최근 것도 10분이 지났으면 지우고 빈 값을 돌려준다.
   연달아 두 번 공유하면 최신만 산다(앞 것은 원본이 사용자 폰에 있으니 손실 아님). TTL 판정은 manifest.json 의 `ts`.
4. **한도는 안드로이드와 같다** — 파일당 50MB · 합 100MB · 10개 · 넘으면 건너뛰고 skipped. 확장 메모리 한도(약 120MB)는 파일째 복사라 안 걸린다.
   본 앱 → WebView 는 지금처럼 Filesystem.readFile(base64). 실기기 확인에 «50MB 가까운 파일 1개 + 사진 10장» 을 넣고, WebContent 가 죽으면 그때 스트리밍으로.
5. **받는 종류 = 정본 목록(manifest.json share_target.accept = Android intent-filter) 그대로.** 동영상은 정본에 없으니 넣지 않는다(넣으려면 셋을 같이).
   `NSExtensionActivationRule` 사전: Image ≤10 · File ≤10 · Text · WebURL ≤1. `TRUEPREDICATE` 는 심사 거절 사유라 안 쓴다.
   사전형 File 은 종류를 못 가르므로 **확장이 항목의 UTType 을 accept 목록과 대조해 맞지 않는 것은 복사하지 않고 skipped 로 센다.**
6. **HEIC** — 아이폰 기본 사진은 HEIC 이고 받는 쪽은 미리보기 없는 파일로 다룬다. 제공자가 **`public.jpeg` 표현을 주면 그것을 먼저** 받고(사진 앱은 변환본을 준다), 없으면 원본. 확장 안에서 변환하지 않는다(메모리 한도).
7. **프라이버시 매니페스트** — ITMS-91053 은 `.appex` 도 본다. 확장은 파일 속성 시각·UserDefaults 를 쓰지 않는다(TTL 은 `ts`, 상태는 파일로) + 확장 번들에 PrivacyInfo.xcprivacy(추적·수집 없음)를 둔다. 사진 권한 문구는 필요 없다(공유 시트가 준다).
8. **빌드 번호·서명** — `agvtool new-version -all` 은 타깃에 `CURRENT_PROJECT_VERSION` 이 있어야 바꾼다 → 확장 타깃에 `CURRENT_PROJECT_VERSION`·`MARKETING_VERSION` 을 본 앱과 같은 값으로,
   `APPLICATION_EXTENSION_API_ONLY=YES`·`CODE_SIGN_ENTITLEMENTS`·«Embed Foundation Extensions» 단계를 pbxproj 에. 확장 Info.plist 는 `$(CURRENT_PROJECT_VERSION)`·`$(MARKETING_VERSION)`.
   **기계 검사**: `ios-beta-check` 가 두 타깃의 CFBundleVersion·ShortVersion 이 같고 App.entitlements·ShareExtension.entitlements 의 application-groups 가 같은지 보고 다르면 exit 1
   (버전 불일치 = App Store Connect 업로드 거부 · `cap-link-domains.js` 가 App.entitlements 를 다시 쓰므로 App Group 키가 빠지는 회귀를 여기서 잡는다).
9. **로그인 전이면** 지금 /share-receive 와 같은 길(로그인 → 이어서). 새 장치 없음. 워크스페이스 바꾸기는 웹 화면 몫(별건).
10. **배포 대상 iOS 14.0**(본 앱과 같음) · 번들 `app.planq.ShareExtension` · 표시 이름 «PlanQ».

### 바뀌는 파일 (Apple 설정 뒤 착수 — 그 전에 타깃을 넣으면 Codemagic iOS 빌드가 서명 단계에서 깨진다)
- `ios/App/ShareExtension/` — `ShareViewController.swift` · `Info.plist` · `ShareExtension.entitlements`(App Group) · `PrivacyInfo.xcprivacy`
- `ios/App/App.xcodeproj/project.pbxproj` — 타깃 추가 + App 에 «Embed App Extensions» (맥이 없으니 ruby `xcodeproj` 로 생성, Codemagic 빌드로 검증)
- `ios/App/App/App.entitlements` — `com.apple.security.application-groups`
- `ios/App/App/ShareReceivePlugin.swift` — ③ (PlanqAuthSessionPlugin 과 같은 등록 방식)
- `src/services/nativeShare.ts` — ④⑤ (웹 배포로 먼저 나가도 무해 — 옛 앱 빌드는 플러그인이 없어 null)
- `codemagic.yaml` — `ios_signing.bundle_identifier` 를 두 번들로(확장 프로필 포함)
- `scripts/ios-beta-check.js` — 위 8번 검사(버전·App Group 일치)

### 일정
| 단계 | 누가 | 걸리는 것 | 상태 |
|---|---|---|---|
| 0. Apple 설정 4가지(App Group·확장 번들·프로필·Codemagic 등록) | Irene | 20~30분 | 상황판 할 일 `todomv5a7pg0`(10/12~) **여기서 멈춰 있다** |
| 1. 구현(위 파일) + guard·빌드 | Claude | 반나절 | 0 끝나면 바로 |
| 2. Codemagic «PlanQ iOS — TestFlight» 빌드(서명·업로드) | Claude 커밋 → Irene 실행 | 30~40분 | 실패하면 로그 보고 1 로 |
| 3. TestFlight 외부 베타 심사(새 확장이 붙어 다시 심사) | Apple | 보통 1일 | |
| 4. 실기기 확인 — 사진 여러 장·PDF·앱 꺼진 상태·로그아웃 상태·10개 넘게 | Irene | 10분 | |
| 안드로이드 — Play 업로드 + 심사 + 실기기 | Irene → Google | 1~3일 | 상황판 할 일 `todomv5a7m3l` |

→ 아이폰은 **0번이 끝난 날부터 약 2~3일**(대부분 Apple 심사 대기). 안드로이드는 Play 업로드만 하면 된다.

## 검증 계획 (빌드가 생기면)
- 안드로이드: 갤러리 → 공유 → PlanQ → ① 화면이 뜨고 파일 칩이 보인다 → 프로젝트 폴더 저장 → DB 확인
- iOS: 사진 앱 → 공유 → PlanQ → 같은 흐름 · 앱이 꺼져 있을 때(콜드 스타트)
- 회귀: `--suite sharereceive,pushdeeplink`

## 받은 뒤 화면 재설계 — «대상 먼저, 형태는 다음» (2026-10-16, [Fable] UX 판정 · [Opus] 구현)

> Irene: *"파일 공유할 때 어디로 갈지 우리 앱을 너무 어려울 것 같아. 제대로 디렉션이 되게 안내가 가능할까? 검토 좀 제대로 해"*

판정: 그대로 iPhone 에 내보내면 안 된다 — 첫 질문이 «PlanQ 의 어느 메뉴» (같은 크기 카드 5장, 메모·문서 아이콘이 같고 «Q File» 은 제품명),
대화방 목록에 검색·최근순 없음, 어디에 떨어졌는지 안 보임, 업무·문서·메모는 오터치가 곧 업로드, 사진에 썸네일 없음, 상단 180px 가 크롬.

재설계 (프론트만, 새 표·새 API 없음)
1. 받은 것 — 사진은 썸네일(3장 + «+N»), 글은 두 줄. 이 화면에선 알림 권한 배너를 숨긴다(`body[data-share-receive]`).
2. **추천 카드 하나** — 사진·영상·글·링크 → 채팅 / 문서·zip → 프로젝트 파일 / 카톡·왓츠앱 내보내기 → 기존 보관 카드.
   카드 안에 **최근 목적지 칩**(localStorage `planq:share-recent:<user>:<biz>`, 5건, 살아 있는 목록과 대조) + [찾기].
3. 나머지는 44px 행 목록. 고객 역할은 채팅만. 업무·문서·메모 행에는 «파일은 내 파일에 먼저 올라갑니다» 를 그 행에 적는다.
4. 고르기 — 대화방: 검색(`utils/searchMatch`) + 최근·고정·고객·팀 묶음(고정 → 최근 대화순, 묶음당 5 + 더 보기).
   파일: 프로젝트를 행+검색으로(가로 칩 폐지), 누르면 같은 화면에서 폴더로 내려가고 «회사 파일» 은 끝으로.
5. 결과 — 파일: «✓ 프로젝트 › 폴더 에 저장했어요» + [열기][다른 곳에도][닫기](이름은 서버 응답 id 로 찾는다).
   채팅: 입력칸 위 밴드 «공유한 내용이 담겨 있어요 — 보내기를 누르세요»(보내거나 비우면 사라짐).
측정: 390·360 에서 추천 카드가 스크롤 없이 보임 · 최근 대화방까지 2탭 · 정렬 DB 일치 · 썸네일이 실제로 그려짐 ·
최근 칩(보관하면 사라짐) · 결과 글자 = DB 이름 · 고객은 채팅 행만 · 카톡 카드 회귀 · i18n·parity · 실기기 1회.
iOS 확장은 이것이 초록이 된 뒤 착수.
