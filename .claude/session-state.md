# PlanQ 세션 상태

## 현재 작업 상태
**마지막 업데이트:** 2026-08-24 (오후 사이클)
**작업 상태:** 완료 — 단, **iOS 베타는 노트북(맥)에서 이어서 진행 중**

### 진행 중인 작업
- **iOS TestFlight 베타** — 애플 쪽 관문은 전부 통과. 남은 것은 **맥에서 빌드·업로드**뿐

### 완료된 작업 (이번 세션)
- 랜딩 **서비스 페이지 `/service`** + 견적문의(`/contact?type=quote`) — ko/en
- **문의 폼 전건 실패 수정** — 필드명 불일치로 역대 접수 0건이던 것 (실호출 400 재현 후 수정)
- **외부 API 크레딧 경보** — Deepgram/OpenAI 잔액·소진 예상일(30/14/7/3/1일)·일 1회 메일 + 단가 자동 보정
- **Q Task 체크박스 권한 규칙** — 담당자 아닌 업무의 완료 체크박스 제거(팝아웃과 단일 함수 공유)
- **팝아웃 체크 즉시 반응** — 낙관 반영 + 행 단위 잠금
- **카운트 정의 통일** — 오늘 탭·팝아웃 `업무 N건, 요청 M건` (합 = 보이는 행 수)
- 태그 `+` 위치 고정 · 메일 답장 카드 여백 · 전체보기 새 창 여백
- **iOS**: 아이콘·스플래시 PlanQ 마크 교체(알파 제거) · 베타 런북 · 빌드 목표 서버 안전장치

---

## 📱 iOS 베타 — 여기서 이어서 (노트북)

### 애플 쪽 완료 (다시 안 해도 됨)
| 항목 | 값 |
|---|---|
| Apple ID | **`help@wor-pro.com`** (MIJUNGKIM) — 인증 6자리 코드는 **이 메일함으로만** 온다 |
| Team ID | **`H2HW8BHXNW`** (조직 `irene&company`) |
| Bundle ID | **`app.planq`** (Push Notifications + Associated Domains) |
| APNs Key ID | **`P8QD2K92HW`** — 키는 양 서버 `/opt/planq/secrets/` 에 640 권한 |
| App Store Connect | 앱 레코드 `PlanQ` 생성됨 (1.0 제출 준비 중) |

APNs 검증 완료: 가짜 토큰에 `BadDeviceToken`(400) = 애플이 우리 인증을 수락.
운영 `APNS_PRODUCTION=true`(TestFlight용) / dev `false`(Xcode 직접설치용).

### 기기 판정
- **아이맥 = 2020 인텔(iMac20,1, i5-10500)** — macOS 26 은 인텔 지원 마지막 세대. 최신 Xcode 설치 가능 여부 미확인
- → **맥에어(노트북)로 전환하기로 결정.** Apple Silicon 이면 그대로 진행

### 노트북에서 할 일 (순서)
1. 사양 확인: `system_profiler SPHardwareDataType | head -8` · `sw_vers -productVersion` · `df -h / | tail -1`
   (Xcode 는 설치 후 40GB 가까이 쓴다 — 용량 먼저)
2. App Store → **Xcode** 설치 / https://nodejs.org → LTS `.pkg` 설치
3. ```
   git clone git@github-planq:ireneceo/planq.git
   cd planq/dev-frontend && npm install
   npm run cap:beta        # ★ 반드시 "https://planq.kr" + ✓ 점검 통과 확인
   cd ios/App && pod install && cd ../..
   npm run cap:open:ios
   ```
   `cap:beta` 가 `dev.planq.kr` 을 찍으면 **중단** — 그대로 빌드하면 테스터가 개발서버를 쓴다
4. Xcode: Signing & Capabilities → Team 지정 → Any iOS Device → Product > Archive → Upload
5. App Store Connect → PlanQ → **TestFlight 탭** → 내부 테스터 추가 (심사 없음, 100명)

절차 상세: `docs/IOS_BETA_RUNBOOK.md`

---

## 다음 할 일
1. **iOS 베타 빌드·업로드** (위 노트북 절차) → 내부 테스터로 실기기 검증 6항목
2. **운영 nginx AASA Content-Type** — Irene 이 `sudo bash /tmp/planq-aasa-nginx.sh` 실행
   (지금 `application/octet-stream` 이라 Universal Links 가 죽어 있다. dev 는 정상)
3. **운영 크레딧 잔액 입력** — `planq.kr/admin/billing-settings` → Deepgram `185.54` / OpenAI `15.76`
   (운영 DB 는 dev 와 별개라 0행. 넣어야 경보가 굴러간다)
4. **Team ID 반영분 배포 대기** — AASA 커밋됨(`1b53555c`), 운영 반영은 `/배포` 필요
5. Fable 큐 `docs/FABLE_VERIFY_QUEUE.md` — §6 Gmail 스팸함 수집(커서 스키마), §5 메일 전달 기능(차단 중)

### Irene 조치 대기
- **Dropbox 의 `.p8` 공유 링크 삭제** — PlanQ 이름으로 푸시를 보낼 수 있는 키다
- Google Drive 재연동 (`invalid_grant`)

---

## 복구 가이드

새 Claude 세션 시작 시 아래 내용을 붙여넣으세요:

```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```

노트북에서 이어가려면 개발 서버에 접속해 `claude --continue` 하면 이 대화가 그대로 이어집니다.
