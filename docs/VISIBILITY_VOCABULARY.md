# PlanQ Visibility Model — 4단계 통일 Vocabulary

> **사이클 N+1 합의 (2026-05-08)** — 모든 자산(파일·문서·노트·메모·지식·청구·서명)의 권한·노출은 이 4단계 vocabulary 로 통일.
>
> 기존 PERMISSION_MATRIX.md 의 "열린 문화" 철학은 협업 자산(메시지·업무·일정)에 한해 유지. 자료 자산(파일·문서·지식)은 **참여자만 노출** (옵션 A) 정책으로 강화.

---

## 1. 4단계 Visibility

| 단계 | 한국어 | 영어 | 누가 봄 | 배지 아이콘 | 색 |
|:-:|---|---|---|:-:|---|
| **L1** | 개인 | Personal | 본인 (`user_id`) | `lock` | `#64748B` 회색 |
| **L2** | 팀 비공개 | Project / Channel | 프로젝트 멤버 / 채팅 참여자 / 업무 관계자 | `users` | `#0F766E` teal |
| **L3** | 워크스페이스 공개 | Workspace | 워크스페이스 모든 멤버 | `building-2` | `#1E40AF` blue |
| **L4** | 외부 공개 | External | 외부 share_token / 발송 받은 사람 | `globe` | `#C2410C` orange |

**기본 규칙:**
- 어디에도 안 묶음 (`project_id` / `conversation_id` NULL) → **L1 (개인) default**
- 프로젝트·채팅·업무에 묶음 → **L2 (팀 비공개)** 자동
- L3 은 명시적 토글 (rare — 회사 핸드북·복지 가이드)
- L4 는 명시적 share/email 액션 (share_token 인프라 활용)

---

## 2. 항목별 매핑

| 항목 | L1 | L2 | L3 | L4 |
|---|:-:|:-:|:-:|:-:|
| File | uploader 본인 + project_id NULL | project_id 명시 → 프로젝트 멤버 | scope='workspace' 토글 | share_token |
| Post (Q docs) | author 본인 + project_id NULL | project_id 명시 → 멤버 | scope='workspace' 토글 | share_token |
| KbDocument (Q info) | uploader 본인 + scope='private' | scope='project'+project_id | scope='business' | n/a |
| QnoteSession | user_id 본인 (default 항상) | n/a (개인 도구) | n/a | promote 후 (Q docs/Q info 로 변환) |
| Task | n/a | 담당자/요청자/검토자 | n/a | n/a |
| Conversation | n/a | 참여자 | n/a | n/a |
| Invoice | n/a | 담당자(`owner_user_id`) + owner | n/a | client (외부) |
| SignatureRequest | n/a | 발송자(requester) | n/a | 받는 사람 (외부) |

---

## 3. 마이그레이션 정책 (★ 보강 사항)

**문제:** 기존 데이터 (files 31건 중 6건, posts 45건 중 34건) 가 project_id NULL. 옵션 A 정책 시 갑자기 owner 외엔 안 보임 → 사용자 충격 큼.

**해결:** 기존 데이터는 **L3 (워크스페이스) 자동 백필**. 사용자가 명시적으로 visibility 낮추면 L1/L2 로 변경 가능. 신규 업로드만 L1 default.

| 항목 | 마이그레이션 |
|---|---|
| files | `project_id IS NULL AND visibility IS NULL` → `visibility = 'L3'` 백필 |
| posts | 동일 |
| kb_documents | 기존 scope ENUM 유지, L1~L4 매핑은 `scope='private'` 추가만 |
| invoices | `owner_user_id = COALESCE(created_by, owner_id)` 백필 |

---

## 4. 시각 시그널 — 5중 (★ 합의 사항)

PlanQ 의 디자인 원칙: **모든 visibility 차이는 시각 시그널로 즉시 인지 가능해야 한다. 텍스트 설명만으로 부족.**

| # | 위치 | 시그널 | 빈도 |
|:-:|---|---|---|
| 1 | 사이드바 | 섹션 헤더 "협업"/"개인" + Q note 옆 자물쇠 | 상시 |
| 2 | Q note 페이지 헤더 | sub-line "🔒 본인만 봅니다" | 상시 |
| 3 | 프로젝트 노트 탭 | dismiss 가능 info 박스 (협업 컨텍스트 안에서 사적 공간 안내) | 1회 (dismiss) |
| 4 | 메모 popup 우상단 | 자물쇠 아이콘 + tooltip | 상시 |
| 5 | FirstVisitTour | 1회 onboarding (Q note 첫 진입) | 1회 |

**파일·문서 카드:**
- 모든 카드/리스트 행에 **visibility 배지** 상시 노출 (12px line icon + 옵션 텍스트)
- subtle 색 (회색 톤), hover 시 강조
- 클릭 → 공유 변경 모달 (L1↔L2↔L4 전환)

---

## 5. 사이드바 구조 (★ 합의)

```
─── 협업 ───
📥 인박스
💬 Q talk
✅ Q task
📂 Q project
📄 Q docs
📁 Q file
💡 Q info

─── 개인 ───
🗄️ 개인 보관함
⚙️ 프로필·설정
```

- 섹션 헤더 = **시각 그룹 라벨만** (회색 11px uppercase, `#94A3B8`)
- **기능 분리 X** — Q file 메뉴에서도 개인 파일 보임. 같은 데이터 다양한 view (Single Source / Multiple Views).
- 한국어 "협업"/"개인" / 영어 "Workspace"/"Personal"

---

## 6. 사이클 N+1 작업 매트릭스

| # | 영역 | 작업 |
|:-:|---|---|
| 1 | 권한 정책 | `access_scope.js` 4 헬퍼 옵션 A 적용 |
| 2 | Visibility model | L1~L4 vocabulary 통일 + DB scope 컬럼 정리 |
| 3 | 마이그레이션 스크립트 | 기존 file/post 의 visibility = 'L3' 백필 |
| 4 | Visibility 배지 | 모든 카드/행에 4 아이콘 + 색 + 클릭 변경 모달 |
| 5 | 개인 보관함 메뉴 | 라우트 + 페이지 + 6 탭 (대시·노트·문서·파일·지식·메모) |
| 6 | 사이드바 섹션 | 협업·개인 그룹 라벨 + Q note 자물쇠 |
| 7 | Invoice owner_user_id | DB 컬럼 + 청구 설정 default + 발행 모달 + 인박스 분기 |
| 8 | Signature 알림 통일 | requester_user_id 기준 |
| 9 | 5중 시그널 | 사이드바·헤더·탭·popup·tour |
| 10 | 첫 사용 explainer | 개인 보관함 1회 안내 |

**예상:** 13~15 commit, 1.5 사이클.

---

## 7. 헤더 sub-line + dismiss 가능 박스 — 보강

**5중 시그널 노이즈 방지:**
- **상시 노출 (silent confirmation)**: 자물쇠 아이콘 + tooltip
- **1회 노출 (dismiss)**: info 박스, FirstVisitTour
- **헤더 sub-line**: 항상이지만 작고 회색 (`12px #64748B`) — 시끄럽지 않음

**개인 보관함 첫 진입 explainer (★ 보강):**
> _이 보관함은 본인만 보는 자료입니다. 같은 파일이 Q file 메뉴에도 보이지만 권한 표시(자물쇠)로 구분됩니다. 공유는 [공유하기] 버튼으로._

dismiss 후 다신 안 뜸.

---

## 8. 모바일 메모 popup — 보강

**기본:** 데스크탑 = 우측 sticky 분할 / 모바일 = 풀스크린 모드 (sticky 비활성).
이유: 모바일 화면 점유 ↑, sticky 하면 transcript 와 메모 둘 다 못 봄. 풀스크린 → 회의로 돌아가기 쉬운 back 버튼 강화.

---

## 9. 메모리 박제

- `project_visibility_vocabulary` (신규) — 4단계 vocabulary
- `project_personal_vault` (신규) — 개인 보관함 + Single Source/Multiple Views
- `project_invoice_signature_owner` (신규) — 담당자 컬럼 정책
- `feedback_visibility_signal_required` (신규) — 시각 시그널 필수 원칙
- `feedback_qnote_personal_tool` (갱신) — 텍스트 type + 보관함 + 5중 시그널 추가

---

**상태:** 합의 완료, 사이클 N+1 시작 대기.
