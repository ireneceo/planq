# 안드로이드 · 구글플레이 출시 런북

**최종 갱신 2026-09-03.** 이 문서는 "다음에 무엇을 어디서 어떻게" 만 적는다.
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

---

## 남은 것 ① — Firebase 등록 (Irene, 브라우저)

**왜 필요한가:** 안드로이드 푸시 알림은 FCM 을 거친다. 이 두 파일이 없으면 빌드는 되지만
**알림이 한 통도 안 간다**(에러 없이 조용히 skip 된다 — `services/fcm_sender.js` `isFcmConfigured()`).
iOS 는 APNs 로 따로 가므로 영향 없다.

### 1. 프로젝트 만들기

1. **https://console.firebase.google.com** 접속 — **Play Console 과 같은 구글 계정**으로 로그인
2. **`프로젝트 만들기`** 클릭
3. 프로젝트 이름: **`PlanQ`** → `계속`
4. **"이 프로젝트에서 Google 애널리틱스 사용 설정"** 토글을 **끈다** → `프로젝트 만들기`
   > ★ 반드시 꺼야 한다. Play Data safety 에 **"분석 목적 수집 없음 · 광고 ID 사용 안 함"** 으로
   > 신고했다. 애널리틱스를 켜면 그 신고가 거짓이 된다.

### 2. 안드로이드 앱 등록 → `google-services.json`

1. 프로젝트 개요 화면 가운데의 **안드로이드 아이콘**(초록 로봇) 클릭
2. **Android 패키지 이름**: **`app.planq`** ← 정확히 이 값 (`capacitor.config.ts` `appId`, `android/app/build.gradle` `applicationId`)
3. 앱 닉네임: `PlanQ Android` (선택)
4. 디버그 서명 인증서 SHA-1: **비워 둔다** (구글 로그인을 네이티브로 안 쓴다)
5. `앱 등록` → 다음 화면에서 **`google-services.json 다운로드`** 클릭
6. 그 뒤 "Firebase SDK 추가" / "다음 단계" 안내는 **전부 건너뛴다** — Capacitor 가 이미 처리한다

### 3. 서버용 서비스 계정 키

1. 왼쪽 위 **톱니바퀴** → **`프로젝트 설정`**
2. 상단 **`서비스 계정`** 탭
3. **`새 비공개 키 생성`** → 확인 팝업에서 **`키 생성`** → JSON 파일이 내려온다

### 4. 두 파일 전달

| 파일 | 어디로 |
|---|---|
| `google-services.json` | `/opt/planq/dev-frontend/android/app/google-services.json` |
| 서비스 계정 JSON | `/opt/planq/dev-backend/secrets/fcm-service-account.json` (권한 600) |

**서비스 계정 JSON 을 채팅에 붙여넣지 말 것** — 개인키가 들어 있다.
서버에 올려두고 경로만 알려주거나 파일로 전달한다.

전달 후 lua 가 할 일 (사람 손 불필요):
```bash
# .env 두 줄 (dev-backend/.env · 운영도 같이)
FCM_SERVICE_ACCOUNT_PATH=/opt/planq/dev-backend/secrets/fcm-service-account.json
FCM_PROJECT_ID=<서비스계정 JSON 의 project_id>
```
그 뒤 `pm2 restart planq-dev-backend` → 실제 발송 테스트(`push_logs` 에 `sent` 확인).

---

## 남은 것 ② — AAB 빌드와 릴리즈

1. **Codemagic** 에서 워크플로 **`android-play`** 실행 (키스토어 `planq_upload` 등록돼 있음)
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
