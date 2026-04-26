## 현재 작업 상태
**마지막 업데이트:** 2026-04-26
**작업 상태:** 완료 — Phase A 서명 받기 전체 + Phase B1 분할 청구 백엔드

---

## ⚡ 빠른 재개

```
session-state.md 읽고 다음 작업 (B2 — Q Bill 청구서 리스트 + 발행 모달) 이어서 해.
```

---

## 진행 중인 작업
- **없음** (Phase A 4단계 + B1 완료, B2 부터 다음 세션)

---

## 완료된 작업 (이번 세션, 2026-04-26)

### Q docs UI/UX 정리
- 상세 제목 중복 제거 (h1 → PrintOnlyTitle)
- 공유 모달 (PostShareModal) — 토글 라벨 고정, 탭 UI, 발송 결과 화면, URL 카드
- 공개 페이지 `/public/posts/:token` (PublicPostPage) + 삭제된 문서 friendly
- AI 작성 모달 (PostAiModal) + 시스템 템플릿 body 참조 구조 주입
- 표 에디터 (TipTap Table extensions) — Notion-style + border-radius 라운드 외곽
- 에디터 줄간격 1.55, `<li><p>` margin 0
- 편집 폼 카테고리·프로젝트 2열, "프로젝트" 라벨 제거
- 사이드바 접기 (EdgeHandle 통일)
- 상세 chip 순서 (카테고리 → 프로젝트 → 공유중)
- conversation_id 출처 필드 폐기

### 7종 시스템 템플릿 풍부화
- 견적·청구·NDA·제안·회의록 + 계약서·SOW 신규
- 8 column 품목표·결제 분할·SLA·차별화·리스크 등 컨설팅 표준

### 프로젝트 detail docs 탭
- ProjectPostsTab 신규 — 1컬럼 인라인 마스터-디테일 (DocsTab 패턴 통일)
- 페이지 이탈 0

### 채팅 카드 메시지
- Message.meta JSON 컬럼
- share-to-chat → kind='card', card_type='post'
- ChatPanel DocCard + PostCardPreviewModal

### 통합 설계 문서
- `docs/Q_BILL_SIGNATURE_DESIGN.md` (14 섹션, 1100+ 줄)
- 시나리오·ERD·API·UI 와이어프레임·시퀀스·전자서명법 충족·구현 4주

### Phase A — 서명 받기 (자체 구현, 4 task 완료, E2E 55/55)
- A1 백엔드 (16/16): signature_requests 테이블 + 9 라우트 + OTP hash + rate limit + audit
- A2 모달·카드·진입 (12/12): PostSignatureModal + 헤더 버튼 + ChatPanel signature_request 카드
- A3 공개 서명 페이지 (17/17): /sign/:token 5단계 (검토→OTP→캔버스→동의→완료) + 모바일
- A4 진행 표 + 후속 액션 (10/10): SignatureProgressSection + 양사 signed 시 후속 카드

### Phase B1 — Q Bill 분할 청구 백엔드 (13/13)
- Invoice 모델 확장 (installment_mode, bank_snapshot, partially_paid status)
- InvoiceInstallment 신규 (15 컬럼)
- 라우트 5종 (분할 발행, send, mark-paid, unmark-paid, mark-tax-invoice, cancel)

### 발견·수정한 버그 4건 (senior-level)
1. for 루프 `let row` 스코프 → `created[0]` 로
2. Post.status enum mismatch → maybeUpdateEntityStatus no-op
3. Sequelize update 후 인스턴스 갱신 → reminder_count 더블 증가 (메모리 등록)
4. window.confirm 헬스체크 룰 → ConfirmDialog 교체

---

## 다음 할 일 (우선순위)

### B Phase 잔여 (Q Bill 프론트)
- **B2**: Q Bill 청구서 리스트 + 발행 모달 (분할 토글 UI) — 2일
- **B3**: 청구서 상세 (분할 일정 표 + 액션) — 2일
- **B4**: 공개 청구서 페이지 `/public/invoices/:token` — 1일

### C Phase (채팅 결제 요청)
- **C1**: 채팅 결제 요청 — 카드 메시지 + 공개 결제 페이지 — 2일
- **C2**: 입금 완료 알림 → 사용자 마킹 → 카드 자동 갱신 — 1일

### D Phase (통합)
- **D1**: 통합 트리거 — 서명/검수 → 후속 액션 카드 자동 표시 — 2일
- **D2**: 알림 센터 — 서명/결제/세금계산서/검수 일관 표시 — 2일

총 ~2주.

---

## 환경 / 인증

- 백엔드: pm2 planq-dev-backend (port 3003)
- DB: planq_dev_db / planq_admin / CE5tloemiYjWNUIs
- 도메인: dev.planq.kr
- 헬스체크: `node /opt/planq/scripts/health-check.js` — 27/27 통과 상태
- 마지막 빌드: `index-YlMSfh4i.js` 서빙 정상

---

## 주요 문서 위치

- `/opt/planq/docs/Q_BILL_SIGNATURE_DESIGN.md` — **이번 세션 통합 설계 (B/C/D Phase 진행 시 참조)**
- `/opt/planq/DEVELOPMENT_PLAN.md` (히스토리)
- `/opt/planq/CLAUDE.md` (DB 테이블 32개로 갱신 + Q_BILL_SIGNATURE_DESIGN 등록)
- 메모리: `/home/irene/.claude/projects/-opt-planq/memory/`
  - 이번 세션 신규: `feedback_sequelize_update_mutation.md`

---

## 복구 가이드

새 Claude 세션 시작 시:

```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```

또는 더 직접적으로:

```
B2 Q Bill 청구서 리스트 + 발행 모달 구현해줘.
설계는 docs/Q_BILL_SIGNATURE_DESIGN.md §5.3 참고.
```
