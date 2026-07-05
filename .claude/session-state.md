# PlanQ 세션 상태

## 현재 작업 상태
**마지막 업데이트:** 2026-07-05 (노트북 이관)
**작업 상태:** ✅ 이번 세션 전부 배포 완료 · **다음 = 검사 하니스 구축** (설계 박제됨)

---

## ⚡ 빠른 재개 (노트북 새 세션)
```
session-state.md 읽고 이어서 개발해. docs/qa/INSPECTION_PLAYBOOK.md 대로 검사 하니스부터 짓자.
```

---

## 🔖 다음 할 일 (노트북) — 검사 하니스 구축
**설계 완료 문서: `docs/qa/INSPECTION_PLAYBOOK.md` (Fable 게이트 설계).** 이 순서로 구축:
1. **하니스 골격** `scripts/e2e/run.js` + `lib/`(login·route-inventory·cdp-keyboard) + `docs/qa/FEEDBACK_REGRESSIONS.md` 대장
2. **모바일 키보드 스위트**(가장 아픈 모바일부터) — 7 시나리오(/inbox·/tasks·/talk·/docs·/notes·/calendar·/help-popout) RED 확인 → 페이지별 `--vvh`/스크롤부모 fix. 판정식: 캐럿 bottom ≤ vvh−8 · 가로스크롤0 · 자동점프<4px
3. **카나리 크롤** — 표시명 6곳(businesses·dashboard·org·weekly_reviews·notifications·clients) + L1 자동검출·수정
4. **42건 회귀 전환**(부류 대표: A7·B2·C2·D6)
5. **/검증 개정** 11단계 추가 + CLAUDE.md 규칙 3줄

**배경:** 운영 피드백 42건이 기존 검증 다 통과했는데 유출. 특히 **모바일 심각**. "일일이 요청 말고 전수검사도 못 잡는다"의 구조적 해답 = 이 하니스.

---

## ✅ 이번 세션 완료·배포 (전부 planq.kr 라이브, 미배포 0)
| 항목 | 커밋 |
|------|------|
| 증빙(세금계산서/현금영수증) 신청 **확인-only 뷰** + 개인 프리필 저장 | e2fa7b1 |
| 고객 **사업자·증빙 정보 편집 UI** (고객관리 드로어) | (wip a27c978 계열) |
| **구글드라이브 미러** — 워크스페이스 파일 전체 Drive 사본(storage=planq 유지, 서빙 무영향). 운영 63건 백필. `scripts/backfill-gdrive-mirror.js`(매니페스트 롤백) | 3e99736 |
| 청구서 **재발송 버튼** (원본+PDF, 독촉과 분리, 상태 무변경) | a27c978 |
| 청구서 **열람(viewed) 신뢰성** — 봇/이메일스캐너/프리페치 제외(isBotOrScanner) | 088a6fd |
| 🔴 **L1 개인파일 누출 보안 fix** — fileListWhereByLevel legacy visibility에 vlevel:null 게이트 (canary 검증) | c57d672 |
| **INSPECTION_PLAYBOOK.md** — 검사 하니스 설계 박제 | (이번 커밋) |

**HEAD = c57d672 배포 완료. 미커밋/미배포 0.**

## 기율법률사무소 (INV-2026-0003) 상태
- status=sent, 수신 jwchoi@kiyul.co.kr, **재발송 1회 완료** (원본+버튼 정상). 사업자정보(상호 "기율 법률사무소" 띄어쓰기·242-78-00597) 입력됨 → 증빙 신청 시 **확인 요약**으로 뜸.
- viewed_at=NULL(미열람 정정 완료) → 고객이 실제 열면 그때 기록.

## 미결정/후속
- **카드결제**: A안(각 워크스페이스 자기 결제링크 붙여넣기, KRW부터, PlanQ 자금 무접촉) 확정 · B안(결제대행) **폐기**. 구현은 추후. Fable 검토 `docs`/대화 참조 — 인프라(businesses.portone_*·InvoicePayment) 이미 있음.
- **표시명 6 라우트** 수정 = 하니스 3단계에서 카나리로.

---
관련 메모리: `feedback_no_options_just_fix`(옵션 말고 직접·판단해서), `project_visibility_unified_arch`(L1~L4), `feedback_mobile_keyboard_vvh_bound`, `feedback_member_display_name_on_lists`.
