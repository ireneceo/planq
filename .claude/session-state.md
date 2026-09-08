## 현재 작업 상태
**마지막 업데이트:** 2026-09-08 22:10 UTC (Opus 5, 1M)
**작업 상태:** 배포 완료 · 작업 트리 깨끗 · Irene 오늘 마감
**배포:** **v1.48.14** · commit `d38f123c` · 20260908_213958 (287초, EXIT 0)
**백업(운영):** `/opt/planq/backups/20260908_213958`
**롤백:** `ssh irene@87.106.78.146 'tar -xzf /opt/planq/backups/20260908_213958/backend.tar.gz -C /opt/planq && pm2 reload planq-prod-backend'`

### 이번 세션에서 한 것 — 탭 범위 신고 하나가 뿌리였다

Irene: *"플랫폼관리자랑 다른 워크스페이스 갈 때 에러 안나오고 상단 탭이 해당 워크스페이스나
플랫폼관리자 기준으로 바뀌어야 해."* → 이어서 *"여전히 리셋 안돼. 배포 안해서 그래?"*

**두 신고가 같은 하나였다.** "탭이 섞인다" 와 "플랫폼관리자는 에러다" 의 원인이 동일.

1. **`7bc70ef7` 범위를 기록 시점에 정한다** (`dev-frontend/src/stores/tabStore.ts`)
   - 저장 키는 이미 워크스페이스별로 갈려 있었는데(#405) **기록이 전환보다 앞서** 있었다.
     경로가 먼저 바뀌면 그 순간의 범위(=옛 범위)에 새 경로가 탭으로 박히고, 그 다음에
     MainLayout effect 가 범위를 갈아끼웠다. **키만 보면 갈라져 있고 새는 곳은 키 안의 내용.**
   - 대조군 실측: `::b5=["/talk","/tasks","/admin/dashboard"]` · `::admin=["/files"]`,
     그리고 그 상태의 플랫폼 관리자 화면은 **에러 화면**이었다.
   - 고침: store 가 기록 전에 스스로 범위 결정(`ensureScopeFor`). /admin 은 경로가,
     나머지는 MainLayout 이 알려준 워크스페이스(`setTabScopeBusiness`)가 정한다.
     범위를 갈아끼웠으면 **호출부는 거기서 끝낸다**(중복 탭 생성 제거).
   - `setTabScope(next, here?)` — location 이 아직 안 바뀐 시점에도 정렬. pendingSwitch 폐기.
   - `AuthContext.apiFetch` — inFlight ≥ 12 면 재시도 안 함(ERR_INSUFFICIENT_RESOURCES 폭풍 방지)
   - `WorkspaceSwitcher` data-testid 3개

2. **`5446a277` 이미 저장된 오염을 읽는 순간 버린다** (`scrub`/`belongsToScope`)
   - 기록 순서를 고쳐도 **그 전에 섞여 저장된 목록은 브라우저에 그대로 남는다.**
     배포해도 계속 보이고 사용자에겐 "안 고쳐졌다" 와 구별되지 않는다.
   - sessionStorage · 복원 스냅샷(localStorage) · 옛 무범위 이관분 3경로 전부

3. **`d38f123c`** v1.48.14 버전·릴리즈노트·개발현황 / **`eab4c068`** Fable 대기열 2건 추가

### 신규 카나리
`scripts/e2e/canary-scope-tabs.js` — `--suite scopetabs` **13/13**
platform_admin + 워크스페이스 2개 임시계정으로 A→관리자→A→B 를 **스위처 실클릭** 왕복.
범위별 키의 **내용** + 화면 탭 막대 + 에러를 같이 본다. 오염 주입 후 정리(⑤)까지.
**양성 대조군 2회 확인** (ensureScopeFor 무력화 / scrub 무력화 — 각각만 빨강)

### 이번 세션의 교훈 (memory 에 박제됨)
- **`feedback_scope_key_split_but_content_mixed`** (신규) — 키가 갈려도 기록이 전환보다
  앞서면 내용이 섞인다. 키 존재 검사로는 못 잡는다.
- **대조군 빌드가 TS 오류로 죽어(EXIT 2) 번들이 안 바뀐 채 "통과" 가 나왔다.**
  대조군도 빌드 EXIT 0 을 확인하고 판정할 것.

### 곁들여 실측한 격리 (Irene: "이거 보안문제 아니야?")
```
active = B(6) 인 계정
  200 /api/tasks/2178/detail    B 업무
  200 /api/tasks/2177/detail    A 업무 — 내가 A 멤버라서 열린다(활성이 아닌데도)
  403 /api/tasks/by-business/1  비멤버 → 막힌다
  403 /api/admin/overview·users 비관리자 → insufficient_role
```
`--suite tenant` 9/9 · `--suite l1` 4/4. **테넌트 경계 자체는 안 뚫려 있다.**
다만 서버 판정 축이 "활성 워크스페이스" 가 아니라 **"멤버인가"** — 그래서 탭·링크가 섞이면
화면이 섞인다. 탭 입구는 막았고 **알림·공유 링크·주소 입력은 그대로** 남아 있다.

### 운영 데이터 작업 (Irene 이 직접 실행, 멱등 확인됨)
`fix-series-miss-policy.js --all --apply` — 시리즈 정책 12개 auto_skip · 지난 미수행 6건 마감.
검증: 오늘/이후 마감 0건 · 지난 미수행 잔여 0건. 남은 carry 3개는 완료된 **자식 회차**라 무해.

---

## ▶ 다음 세션 할 일

### 1. Fable 토큰 생기면 — **묶어서 한 라운드** (`docs/FABLE_GATE_QUEUE.md` 4건)
| # | 항목 | 판정 | 상태 |
|---|---|---|---|
| 1 | Q Note 회의록을 Cue 범위로 (`f584036f`) | R=1·S=1 | 구현 완료·자체검증 7/7 |
| 2 | 채팅 민감정보 보호 #407 | R=1 | 설계안 3개, 미구현 |
| 3 | 워크스페이스 격리 **판정 축** | R=1·S=1 | 실측 박제·결정 대기 |
| 4 | Q sale **구현 직전 검토** | — | 설계 v2 이미 있음 |

### 2. Q sale — 착수 전 확인
- 설계: `docs/Q_SALE_DESIGN.md` (942줄, v2 2026-09-02, **Fable 산출물**). 상태 **Irene 승인 대기**
- **남은 결정 3건(§15)**: ①문의고객 상한 배수(정식×3) ②히스토리 요약 갱신 시점 3가지
  ③고객관리 메뉴 유지/흡수
- **횡단 12항목(§12)** — 9개가 1차 필수. 알림 ENUM·확인필요 collectSale·실시간 broadcast·
  **권한 게이트 11곳**·탭 TabKind·검색·i18n·감사/GDPR/익명화·마이그레이션(ENUM append 2)
- ⚠️ 설계가 09-02 것인데 그 뒤 §12가 지목한 파일들을 건드렸다(탭 범위·게스트링크 scope·
  크래시 보고·온보딩) → **착수 전 §12 신선도부터 Fable 검토**
- ⚠️ Q Note 경계(§7) — 전화 녹음은 팀 자산인데 Q Note 는 "진짜 사적 공간"(본인 외 403).
  구현 시 가장 조심할 지점

### 3. 답변·결정 대기 (Irene)
- **#407** 채팅 민감정보 — 우리 권고는 "화면이 경고하고 Q info secret 으로 유도"(대기열 2번 §4)
- **워크스페이스 판정 축**을 활성 기준으로 바꿀지 (바꾸면 다른 워크스페이스 알림·공유 링크가
  전환 없이 안 열린다)

### 4. 남은 신고·작업
- **#408** 인포 상세 헤더 잘림 · 리스트 링크 클릭 안 됨 (삭제 확인은 고침)
- **React #185** 플랫폼 관리자 — dev 재현 실패(admincrawl 16/16). 운영에서 나면 크래시 보고에 남는다
- **Drive 폴더 이관 dry-run** — 21건 중 19건이 채팅 파일이라 스크립트가 잘못 계산한다.
  **스크립트에 대화방 축을 먼저 반영**한 뒤 dry-run. `--apply` 는 Irene 승인 후에만
- **피드백 장부** — 이번 커밋들에 `Feedback-Closes` 트레일러가 없어 안 닫혔다.
  탭 신고 번호를 받으면 다음 배포에 실어 닫는다 (또는 `scripts/feedback-close-backlog.txt`)

---

## Git 상태 (저장 시점)
```
브랜치: main · 작업 트리 깨끗(uncommitted 0)
eab4c068 docs(fable): 대기열에 2건 추가 — 워크스페이스 격리 판정 축 · Q sale 구현 직전 검토
d38f123c chore(release): v1.48.14 — 워크스페이스·플랫폼 관리자 탭 범위      ← 운영 배포된 커밋
5446a277 fix(tabs): 이미 저장돼 있던 남의 범위 탭을 읽는 순간 버린다
7bc70ef7 fix(tabs): 범위를 **기록 시점에** 정한다 — 관리자 탭이 워크스페이스 목록에 남던 것
f7bbcc97 fix(tabs): 워크스페이스·플랫폼 관리자를 바꿔도 앞의 탭이 따라오던 것
```
※ `eab4c068` 은 문서라 배포 대상 아님. 운영 = `d38f123c`.

## 게이트 상태 (저장 시점)
health-check 41/41 · guard-invariants 37/38(미통과 1건 문서 신선도 경고 전용) ·
build EXIT 0 / error TS 0 · scopetabs 13/13 · tabs 7/7 · tabtitle 3/3 ·
tabletchrome 9/9 · admincrawl 16/16 · tenant 9/9 · l1 4/4
