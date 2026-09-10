# PlanQ 세션 상태

## 현재 작업 상태
**마지막 업데이트:** 2026-09-10 (Opus 5, 1M)
**작업 상태:** 완료 — 단, **Fable 검증 결과 대기 중** (R=1 멀티테넌트 격리)

### 진행 중인 작업
- **Fable 독립 검증 진행 중** — 커밋 `a8ae55a6`(워크스페이스 격리). 판정이 오면
  PASS 면 마커 기록, FAIL 이면 지적 항목 수리 후 재검. **판정 전에는 "검증 완료" 라고 쓰지 않는다.**
  ★ 이번엔 **커밋을 먼저 하고 Fable 을 띄웠다** — Irene 이 자리를 옮기며 저장을 요청해서다.
    지문 검사(`.fable-gate.json`)는 *미커밋 diff* 에 묶여 있어 이 상태에서 **조용히 초록**이 된다.
    그 초록은 검증이 아니다. Fable 판정문을 근거로 삼을 것.

### 완료된 작업 (이번 세션)
- **확인필요·관리자 탭 워크스페이스 격리** (커밋 `a8ae55a6`) — Irene 신고
  - `/api/dashboard/todo` 를 화면 3곳이 **범위 없이** 불러 전 워크스페이스를 합산하고 있었다.
    사이드바 배지만 범위를 지켜 불러 **같은 화면에서 두 숫자가 갈라져** 있었다
  - `collectSignatures` 가 `businessId` 를 **받아놓고 안 썼다** — 범위를 줘도 샜고,
    합산 모드에선 같은 행이 워크스페이스 수만큼 중복 계수(dev 반증 실측 2회)
  - 인박스 캐시 축 `'all'` → 워크스페이스 (전환 후 직전 것이 먼저 그려지던 것)
  - `/admin` 이 `PREFIX_KIND` 에 없어 관리자 15화면이 전부 `other` → 이름 "설정" 고정 +
    identity 충돌로 **서로를 덮어씀**. `admin` kind + `admin:<경로>` identity 로 분리
  - 탭 이름을 사이드바와 **같은 표**(`ADMIN_MENUS`)에서 읽는다(`adminLabelKeyForPath`)
  - `scrub()` 이 로드 때 경로에서 kind 재계산 (저장된 kind 는 파생값)
  - `visibleNavMenus(scope)` — 관리자 `+` 에 워크스페이스 메뉴가 섞여 나와, 누르면
    직전 워크스페이스 탭 목록이 통째로 복원되던 문을 닫음
  - **신규 카나리 `--suite admintabs` 17/17** (양성 대조군 포함).
    기존 `scopetabs` 는 스냅샷이 `title` 을 버리고 `+` 를 안 눌러 **구조적으로 못 잡는다**
- **공개 화면 여백** (커밋 `0f93a90f`) — Fable FAIL 2건 수리. `center` 카드가 197~354px 로
  쪼그라들던 것(→420 고정) · 문서형 sticky 툴바가 20px 안으로 들어가던 것(→전폭 0/0).
  여백의 책임을 `Page` → `Frame` 으로 (`width: min(100% - 2*gutter, 토큰)`)
- **워크스페이스 만들기 점검** — Irene 질문에 답. 운영 `#9 테스트 워크스페이스`(2026-09-08)는
  owner + AI 멤버 구조가 다른 워크스페이스와 **동일하다. 생성은 정상.**
  두 번째를 만든 것이 원래 있던 결함을 드러냈을 뿐

### 다음 할 일 (우선순위 순)
1. **Fable 판정 처리** — PASS 면 마커, FAIL 이면 수리 후 재검
2. **AI 일정 수정 UI** — 서버는 끝났다(`services/scheduleEdit.js` · `routes/schedule_edit.js` ·
   `models/ScheduleBatch.js` · 마이그레이션 배포 스크립트 배선 완료). **`ScheduleEditModal.tsx` 미착수.**
   설계 `docs/AI_SCHEDULE_EDIT_DESIGN.md`
3. **권한 막힘 2건** (운영 스크립트 SSH 실행이 권한 분류기에 막혀 있다 — 우회하지 말 것)
   - 메일 자동연결 백필: `ssh …prod "cd /opt/planq/backend && node scripts/backfill-mail-links.js"`
     (기존 링크 12건 `scratchpad/prod-mail-links-before.json` 에 덤프해 둠)
   - 릴리즈노트 v1.48.21 운영 발행
4. **Irene 판단 대기**
   - 관리자 모드에서도 워크스페이스 **알림 벨**이 뜨고 그 링크가 범위 전환을 일으킨다 —
     의도일 수 있어 신고 범위를 넘겨 손대지 않았다
   - `PublicSignPage` 가 본인 확인 **전에** 서명자 이메일을 노출한다
   - 통합보고서 공유 링크는 **만료되지 않는다** (`report_shares` 에 만료 컬럼 자체가 없다)
5. 백로그 — 프로젝트 "주요 이슈" 자동화 · #407 두 축 · #381/#382 Q sale ·
   Finance 탭 고정비·지출 입력 UI

### 이번 세션에서 배운 것 (박제 완료)
- `feedback_scoped_call_optional_means_leaky` — 범위 인자가 선택이면 샌다.
  **워크스페이스 1곳짜리 계정으로 재면 늘 초록이다**
- `feedback_consent_modal_fakes_modal_open` — 약관 재동의 모달이 `aria-modal` 로
  "열린 것처럼" 보인다. 임시 계정에 `terms_version` 까지 채울 것
- CLAUDE.md 에 **탭 범위 계약** 섹션 신설 + 숫자 배지 계약에 **범위 규칙** 추가

---

## 복구 가이드

새 Claude 세션 시작 시 아래 내용을 붙여넣으세요:

```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```
