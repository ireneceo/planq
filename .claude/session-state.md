# PlanQ 세션 상태

## 현재 작업 상태
**마지막 업데이트:** 2026-08-18 (3) (Opus 5, 1M)
**작업 상태:** 🔄 **진행 중** — #239 커밋 완료(`382f2ffc`). **미배포 3커밋 대기.** 다음은 #228.

> ## ⚠️ 이 파일이 낡으면 Fable 이 오판한다 — 청크를 끝낼 때마다 갱신할 것.

---

## Irene 지시 (유효)
1. "A군 다 해. 다하고 B군 상의하면서 하자" → A군(자율) 전부 → B군(판단 필요) 상의 → **네이티브 앱 iOS/Android 등록**이 종착점
2. **"모든 판단은 너가 하지 말고 fable이 해"** (2026-08-18) — 추천안 제시도 Fable 몫. Opus 는 사실조사·구현·실행·보고만
3. "3,4,5 먼저 끝내고 게이트 통과하면 배포해" → 3(#239) 완료. **4(#228) → 5(#258/#276 완료) → 배포**
4. 배포는 **명시 `/배포` 명령이 있을 때만**

---

## 🚀 미배포 커밋 3건 (다음 /배포 대상)
| 커밋 | 내용 |
|---|---|
| `dcdc1563` | 대화 lifecycle 단일원천(#240) + posts/meta 500 |
| `0e0cf323` | #274 청구서 고객 화면 (draft 노출 보안 포함) |
| `382f2ffc` | **#239 문서 외부 확인** + #276 장부 스크립트 |

**★ 배포 시 필수:** `deploy-planq.sh` 에 `migrate-doc-external-confirm.js` 가 이미 삽입돼 있다
(sync-database 뒤 → PM2 reload 앞). 이 순서가 깨지면 신 코드가 컬럼 없이 떠서 Data truncated 로 죽는다.
배포 후 `scripts/close-deployed-feedback.js --range <배포범위> ` → 운영에서 `--ids ... --apply` 로 장부 닫기.

---

## ▶ 다음에 할 일 (순서대로)

### 1. #228 드래그 아웃 (설계 승인됨 — 5분 서명 URL)
- **제약 실측 완료**: 인증 다운로드(`routes/files.js` `/:businessId/:id/download`)는 `authenticateToken`
  헤더 필요. OS 드래그(`DownloadURL`)는 헤더 없이 가져간다. 기존 `share-link` 는 **최소 7일 공개 토큰**이라
  드래그용으로 쓰면 파일이 영구 공개된다 → 그래서 5분 서명 URL 이 맞다.
- 프론트 드래그 선례: `ProcessPartsTab.tsx:73` · `ProjectTaskList.tsx:385` · `TabStrip.tsx:78`

### 2. 메일 트리아지 '답변 필요' 결손 (Fable 판정 완료 — 구현만 남음)
**신고**: 링크솔루션 메일(명백한 요청)이 '확인 권장'으로 떨어짐. **#221 재발.**
**근본원인**: `isAddressedToUs` 게이트에서 잘림. `hasStrongRequest` 는 true 였다.
- 메일은 `help@wor-pro.com` 수신인데 등록 계정은 3개뿐(`help@irenewp.com`·`irene@irenewp.com`·`minky3018@gmail.com`)
- **`buildOwnEmailSet` 이 별칭 테이블을 아예 안 읽는다** → 별칭 등록만으로는 못 고친다
- **"우리 주소" 공식이 3벌**: `emailTriage.buildOwnEmailSet`(별칭X) / `scripts/retriage-mail.js` 자체맵(별칭X·SMTP_FROM도X) / `emailImapCron.js:376`(별칭O)
- **결손 규모**: 실제 도착 주소 — irene@irenecompany.com **361건** · help@irenecompany.com 91 · help@wor-pro.com 56 · help@k-bizhub.com 23 · gitconsulting 9. 시스템은 9개 중 3개만 안다

**Fable 판정 — 기각안**: "수신 계정을 근거로" = 변화 0건(그 계정은 이미 등록됨, To 에 없는 게 문제).
"강한 요청이면 주소게이트 skip" = 25건 실측 결과 TP 1 : **FP 2**(삼성생명 "보내주시는", 인증서광고 "전자세금계산서") + 콜드메일 방벽 재개방.

**Fable 채택안 (구현 지시)**:
1. `services/emailTriage.js buildOwnEmailSet(businessId)` — `EmailAccountAlias`(account_id IN ...) 합류. try/catch 유지
2. `scripts/retriage-mail.js` — 수제 `ownEmailsByBiz` 제거 → `buildOwnEmailSet` 호출 (공식 3벌→1벌)
3. 별칭 등록 6개 (`routes/mail_aliases.js` API 경유, **관측 기반 자동등록 금지** — BCC 스팸 오염):
   help@wor-pro.com(acc3·acc5 양쪽) · irene@irenecompany.com · help@irenecompany.com(acc5) ·
   help@k-bizhub.com · irene@gitconsulting.group · help@gitconsulting.group (착지 계정 확인 후)
4. health-check 커버리지 항목: 최근 90일 도착 To 중 ≥10건인데 ownEmails 미포함이면 경보
5. **백필**: 새 스크립트 만들지 말 것 — `scripts/retriage-mail.js` 가 정본(멱등·dismissed/handled 존중).
   절차: 코드수정 → dev검증 → /배포 → 운영 preview → 원장 JSON 덤프 → apply. 예상 diff **th1725 1건**

**반증 테스트(필수)**: 별칭 row 를 **지우면 다시 false 로 돌아와야** 한다(가드는 깨뜨려 확인).
음성 대조군 = To 가 제3자 주소면 uncertain 유지.

**#221 유출 이유**: 검증 표본이 전부 등록 계정 주소였다. "ownEmails ⊇ 실제 도착 주소" 불변식이 검증 항목에 없었다.

### 3. 남은 A군
#259 게스트 링크(2세션) · #285 근태(2세션) · #229/#231/#269 · #284 · #233 · #227 · #230 · #235

### 4. B군 (Irene 판단 필요) → 그 다음 네이티브 앱 등록
Apple: 멤버십 결제 → Team ID → APNs .p8 / Google: Play Console → FCM 키 → SHA-256 (Irene 계정 작업)

---

## 이번 세션에서 배운 것 (재발 방지)

- **코드 이동은 성공 경로를 태워야 한다** — `routes/`→`services/` 이동으로 `require('./notifications')` 가
  깨졌는데 fire-and-forget `.catch` 가 삼켜 **HTTP 200 뒤에 묻혔다**. 확인 알림뿐 아니라 기존 서명·거절
  알림까지 죽어 있었다. 문법검사·가드·빌드 전부 통과했다. **알림은 DB 행 증가로 실측할 것.**
- **알림 검증은 실행 직전 max(id) 를 기록하고 그 이후 행만 세라** — 옛 행을 보고 오판했다.
- **워크스페이스 멤버 1명이면 알림 0건이 정상** — 검증이 무의미해진다. 2명 이상에서 테스트.
- **상태마다 시각 컬럼이 다르면 WHERE 도 갈라야 한다** — commented 를 rejected_at 으로 걸러 도달 불가였다.
- **주석 안 따옴표에 한국어를 넣으면 i18n 가드가 하드코딩으로 읽는다** (트레일링 주석은 제외 대상 아님).
- **`sequelize.literal` 은 import 없이 쓰면 런타임에만 죽는다.**
- **`pkill -f` 는 자기 셸을 죽인다** — 이번에도 당했다. PID 로 kill 할 것.
- **빌드 백그라운드 2개가 같은 로그 파일을 쓰면 EXIT 이 오염된다** — 고유 경로 + 단일 실행.
- **`grep -c` 는 0건일 때 exit 1** — 체인 끝에 두면 "실패"로 보고된다.
