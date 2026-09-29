# 네이티브 앱 «공유 받기» 설계 (#434 ②) — 2026-09-29

> Irene #434: *"모바일에서 이미지나 파일을 쉐어하면 앱을 선택하고 파일로 넣을지 채팅방에 넣을지 프로젝트로 파일로 넣을지
> 다양한 경로를 선택하게 해주고 파일에서는 폴더도 만들 수 있어야 하지 않아?"* — 결정: **네이티브까지, 한 앱 빌드로.**

## 상태

| 부분 | 상태 |
|---|---|
| ① 공유 받은 뒤 화면 (`/share-receive`, 웹·앱 공용) | ✅ 2026-09-29 — 대화방 고르기 · 저장 위치(회사 파일/프로젝트 → 폴더 · 새 폴더) · 문서가 글·첨부를 받음. 카나리 `--suite sharereceive` |
| ② 안드로이드 공유 수신 | ⏳ 설계만 — 이 서버에 Android SDK 가 없어 빌드·실기기 검증 불가 |
| ② iOS Share Extension | ⏳ 설계만 — **Apple 개발자 계정 작업이 먼저** (아래 전제) |

## 핵심 결정 — 입구는 하나다

네이티브가 받은 파일을 **웹 공유(PWA share_target)와 같은 자리**에 넣는다:
캐시 `planq-share-v1` 의 `/_share_payload`(JSON: title·text·url·fileCount·ts) + `/_share_file_{i}`(본문 + `X-Filename` 헤더) →
`/share-receive?shared=1` 로 이동. 그러면 ① 화면·검사(`sharereceive` 카나리)를 그대로 쓴다.
**네이티브 전용 공유 화면을 새로 만들지 않는다** — 만들면 웹과 앱의 선택지가 갈라진다(CLAUDE.md «새로 만들지 않는다»).

앱은 원격 껍데기(`server.url`)라 JS 는 서버에서 오지만, **플러그인은 앱 바이너리 안에 있어야** 한다 → 새 앱 빌드가 필요하다.

## 안드로이드

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

## 검증 계획 (빌드가 생기면)
- 안드로이드: 갤러리 → 공유 → PlanQ → ① 화면이 뜨고 파일 칩이 보인다 → 프로젝트 폴더 저장 → DB 확인
- iOS: 사진 앱 → 공유 → PlanQ → 같은 흐름 · 앱이 꺼져 있을 때(콜드 스타트)
- 회귀: `--suite sharereceive,pushdeeplink`
