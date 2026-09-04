# 안드로이드 · 구글플레이 출시 런북

**최종 갱신 2026-09-04.** 이 문서는 "다음에 무엇을 어디서 어떻게" 만 적는다.
이미 끝난 것을 다시 하라고 안내하지 않기 위해 **끝난 것 / 남은 것**을 나눠 둔다.

---

## 끝난 것 (다시 하지 말 것)

| 항목 | 상태 |
|---|---|
| 개발자 계정 | Organisation, Account ID `6744981296049524067`, 표시명 **PlanQ** |
| App content 선언 | 전부 완료 — 개인정보처리방침 · 로그인 정보 · 광고 · 콘텐츠 등급 · 타겟 · Data safety · 정부앱 · 금융기능 · 건강 |
| Data safety | 수집 21종 · **공유 0건** · 삭제 URL 2칸 모두 `https://planq.kr/account-deletion` |
| Financial features | **해당 없음**(My app doesn't provide any financial features) |
| Advertising ID | **사용 안 함** |
| Health | **해당 없음** |
| 계정 삭제 안내 페이지 | 2026-09-03 운영 배포 완료 (`/account-deletion`) |
| 스토어 등록정보(한국어) | 앱 이름 `PlanQ` · 짧은 설명 · 자세한 설명 · 아이콘 · 피처 그래픽 · 스크린샷 |
| 태그 | Business · Productivity · Communication · Notebook · Calendar |
| 연락처 | help@planq.kr · https://planq.kr · 전화번호 **비움**(개인번호 노출 방지) |
| External marketing | 켬 |
| AI asset declaration | **Don't label assets** (생성형 AI 이미지 없음) |
| 스토어 자산 | `/opt/planq/store-assets/` — 아이콘 512×512 · 피처 1024×500 · 폰 6장 1080×1920 · tab7 6장 1920×1080 · tab10 6장 2560×1440 |
| 앱 내 결제 표면 봉쇄 | `dev-frontend/src/utils/purchase.ts` — 네이티브에서 구매 버튼·모달·유도문구 전부 미노출 |
| **Firebase 등록** | 2026-09-04 완료 — 프로젝트 `PlanQ` / ID `planq-48cf7` / 번호 `463247676987`. **애널리틱스 끔** |
| **FCM 서버 설정** | `dev-backend/secrets/fcm-service-account.json`(600) + `.env` 2줄. OAuth 토큰 발급 성공, 발송 경로 `404 unregistered` 로 확인 |
| **`google-services.json`** | `dev-frontend/android/app/` (644). 두 파일 모두 `.gitignore` 등재 |

---

## ★ 업로드 키스토어 (한 번만 · 없으면 빌드가 즉시 실패)

2026-09-04 첫 Android 빌드가 이것 때문에 실패했다 —
`No keystores with reference 'planq_upload' were found`.
이 문서에 "등록돼 있음" 이라고 적혀 있었지만 **만든 적이 없었다.**

**Codemagic UI** → 팀 이름 → `Settings` → `Code signing identities` → `Android keystores`
→ **`Generate keystore`**(파일 업로드가 아니라 생성)

| 칸 | 값 |
|---|---|
| **Reference name** | **`planq_upload`** — codemagic.yaml `android_signing` 이 이 이름을 찾는다 |
| Key alias | `planq` |
| Validity | 30년 이상 |

**파일로 내려받아 옮기지 않는다.** Codemagic 이 만들어 보관하게 한다.
이 키를 잃으면 앱 업데이트를 올릴 수 없다(Play 지원팀 통한 업로드 키 재설정만 남는다).

키스토어만으로는 부족하다 — `app/build.gradle` 의 `signingConfigs.release` 가 `CM_*`
환경변수를 읽어야 한다(2026-09-04 추가). 없으면 **서명 없는 AAB 가 초록불로 나오고**
Play 가 업로드에서 거부한다. 그래서 빌드 마지막에 `jarsigner -verify` 단계를 뒀다.

---

## ★ 링크로 앱 열기 (App Links) — 아직 안 됨

2026-09-04 실측: 운영 `https://planq.kr/.well-known/assetlinks.json` 의 지문이
**`__ANDROID_SHA256_CERT__` 플레이스홀더 그대로**다. 이 상태면 planq.kr 링크를 눌러도
앱이 안 열리고 브라우저로 떨어진다(알림 클릭·초대 링크 전부).

**넣어야 할 값은 우리 업로드 키의 지문이 아니다.** Play App Signing 을 쓰면 구글이
자기 키로 다시 서명하므로, 기기가 검증하는 지문은 **구글의 앱 서명 키** 것이다.

1. Play Console → **App integrity** → `App signing` → **SHA-256 certificate fingerprint** 복사
2. 개발서버에서:
   ```bash
   node /opt/planq/scripts/android-set-cert.js <SHA256>
   cd /opt/planq/dev-frontend && npm run build
   ```
3. `/배포` 후 확인: `curl -s https://planq.kr/.well-known/assetlinks.json`

> 참고로 업로드 키 지문은 `33:E1:4E:15:…:C1:EC` 다 — **이걸 넣으면 안 된다.**

---

## ★ 테스터 설치 전에 반드시 — 운영서버 FCM 설정

Play 빌드는 **운영(`https://planq.kr`)** 을 바라본다. 운영 백엔드에 FCM 설정이 없으면
`isFcmConfigured()` 가 false 라 **안드로이드 알림이 에러 없이 0통**이다(2026-09-04 확인: 없음).

- **키 파일** — rsync 제외 목록에 `secrets/` 가 없다. **다음 배포 때 자동으로 따라간다.**
- **`.env` 두 줄** — `.env` 는 rsync 제외다. **손으로 넣어야 한다.** 배포로 따라가지 않는다.

```bash
ssh irene@87.106.78.146
printf 'FCM_PROJECT_ID=planq-48cf7\nFCM_SERVICE_ACCOUNT_PATH=/opt/planq/backend/secrets/fcm-service-account.json\n' >> /opt/planq/backend/.env
chmod 600 /opt/planq/backend/secrets/fcm-service-account.json
pm2 restart planq-backend --update-env
```

확인: 운영에서 `node -e "require('dotenv').config();console.log(require('./services/fcm_sender').isFcmConfigured())"` → `true`.

---

## 남은 것 — AAB 빌드와 릴리즈

> Firebase 는 2026-09-04 에 끝났다. 서버는 알림을 보낼 수 있는 상태이고,
> **실제 도착 확인은 앱을 기기에 설치한 뒤에만 가능하다**(기기 토큰이 그때 생긴다).


1. **Codemagic** 에서 워크플로 **`android-play`** 실행
   > ★ 워크플로 목록에 iOS 와 Android 두 개가 있다. **`PlanQ Android — Play`** 를 고른다.
   > 빌드가 시작되면 `Machine:` 이 `Linux` 인지 확인 — `Mac mini` 면 iOS 를 고른 것이다.
2. Play Console → **Test and release** → 트랙 선택 → **`새 버전 만들기`** → AAB 업로드
3. **국가 및 지역** 선택
4. 검토 → **제출**

> ①을 건너뛰고 ②만 해도 출시는 된다. 다만 **안드로이드 첫 사용자에게 알림이 안 간다.**
> 나중에 넣으려면 새 빌드를 다시 올려야 한다.

---

## 영어 스토어 등록정보

언어 추가는 등록정보 화면 상단 **`Select a language to edit`** → `English (United States)`.
**"Import translations with AI" 는 쓰지 않는다** — 기계 번역이 Q 시리즈 용어를 망친다.

- App name: **`PlanQ`**
  > ★ 영문 슬로건이 **아직 정해지지 않았다.** 브랜드 메모리에 한국어만 있다
  > ("일을 일답게 하다" / "일이 일이 되지 않게"). 정해지기 전까지 이름에 설명을 붙이지 않는다.
- Short description / Full description: 세션 기록 참조 (2026-09-03 작성본)

이미지는 기본 언어(한국어)에 올린 것을 **자동으로 재사용**한다 — 따로 올릴 필요 없다.
다만 스크린샷 안 글자는 한국어다. 영어 스크린샷이 필요해지면:
```bash
cd /opt/planq && node scripts/store-capture.js --device=all   # 캡처 계정 언어를 영어로 바꾼 뒤
```

---

## 스크린샷 다시 만들기

```bash
cd /opt/planq
node scripts/store-capture.js --device=phone            # 1080×1920 (9:16)
node scripts/store-capture.js --device=tab7,tab10       # 1920×1080 · 2560×1440 (16:9)
node scripts/store-capture.js --device=all --only=talk,task
```
산출물 `/opt/planq/store-assets/screenshots/`. **dev 에서만 캡처된다**(운영 화면 유출 차단).

**태블릿은 가로로 찍는다.** 세로면 폰과 같은 한 컬럼이라 따로 올리는 의미가 없다 —
가로에서만 사이드바 + 목록 + 대화 + 작업대가 한 화면에 보인다.

**칸을 섞지 말 것** — 아이콘(512×512, 1:1)과 피처 그래픽(1024×500)은 스크린샷 칸에
넣으면 규격 위반으로 거부된다. 각자 자기 칸에 올린다.
