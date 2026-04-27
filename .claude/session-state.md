## 현재 작업 상태
**마지막 업데이트:** 2026-04-27
**작업 상태:** 완료 — Phase D+1·D+2 (거래 시퀀스 자동 진행 + 사용자 정의) + 외화 인프라 + 설정 통합 + Phase E (PDF·메일·알림 매트릭스)

---

## ⚡ 빠른 재개 (다음 세션)

```
session-state.md 읽고 "전체 테스트 가이드" 항목대로 직접 클릭/검증해줘.
이상 없으면 다음 작업 (옵션 C: Phase F Q docs 슬롯 시스템) 시작.
```

---

## 🧪 다음 세션 전체 테스트 가이드 (이번 세션 누적 작업 검증용)

### 0. 헬스체크 (필수 첫 단계)
```bash
node /opt/planq/scripts/health-check.js
```
27/27 통과해야 진행.

### 1. 거래 시퀀스 자동 진행 (Phase D+1)
**URL**: `https://dev.planq.kr/projects/p/63?tab=transactions` (또는 새 프로젝트 만들고 거래 탭)

체크 항목:
- [ ] "다음 할 일" 카드 노출 (현재 active stage 기반)
- [ ] 단계 보드: 견적 → 계약 → 청구 → 세금계산서 (4 dot + 연결선)
- [ ] 완료된 단계 녹색, 진행 중 teal glow, 대기 회색
- [ ] "바로 가기" 버튼 클릭 → 프로젝트 문서 탭에서 새 문서 모달 열림 (`/projects/p/X?tab=docs&new=1&category=quote`)
- [ ] 견적 발행 → 자동으로 단계 1 완료 + 다음 단계 active 전환
- [ ] 계약 양사 서명 완료 → 단계 2 완료 + 청구 단계 active

### 2. 거래 stage 사용자 정의 (Phase D+2 — 이번 세션 마지막 작업)
**URL**: 프로젝트 거래 탭 → 단계 보드 헤더 ✏️ "편집"

체크 항목:
- [ ] ✏️ 편집 버튼 클릭 → 편집 모드 진입 (단계가 row 형식으로 변환)
- [ ] 단계 이름 변경 (input 클릭 → 수정 → blur 또는 Enter → 저장)
- [ ] ↑↓ 버튼으로 순서 변경 (첫 자리 ↑/마지막 ↓ 비활성화)
- [ ] "+ 단계 추가" 클릭 → "사후 점검" 같은 사용자 정의 단계 추가
- [ ] custom stage 의 🗑 삭제 버튼 → 확인 다이얼로그
- [ ] template stage 는 자물쇠 아이콘 (삭제 불가)
- [ ] read-only 모드에서 custom stage 의 dot 클릭 → 완료/대기 토글

### 3. PDF 다운로드 (Phase E1)
체크 항목:
- [ ] 청구서 상세 드로어 → 액션바에 "PDF 다운로드" 버튼 → `.pdf` 다운로드
- [ ] 공개 결제 페이지 (`/public/invoices/:token`) → 우측 상단 "PDF 다운로드" 버튼
- [ ] 공개 문서 페이지 (`/public/posts/:token`) → "PDF 다운로드" 버튼
- [ ] 외화 청구서 (currency = USD/EUR 등): PDF 가 영문 모드 (Bill To/Wire Transfer/Subtotal + SWIFT 노출)
- [ ] PDF 메일 첨부: invoice 발송 모달에서 send_email=true → 받은 메일에 PDF 첨부 (SMTP 연결된 환경에서)

### 4. 메일 발신 설정 (Phase E2/E3)
**URL**: `https://dev.planq.kr/business/settings/email`

체크 항목:
- [ ] SMTP 연결 상태 배너 (현재 dev 는 amber — 미연결)
- [ ] 발신 표시이름 입력 → 미리보기에 즉시 반영 (`"이름" <noreply@planq.kr>`)
- [ ] 회신 주소 입력 (이메일 형식 검증)
- [ ] 청구서 발송 시 메일 헤더의 From 이 워크스페이스 이름으로 표시 (SMTP 연결 필요)

### 5. 알림 매트릭스 (Phase E4)
**URL**: `https://dev.planq.kr/business/settings/notifications`

체크 항목:
- [ ] 7 이벤트 × 3 채널 = 21 토글 매트릭스 노출
- [ ] 토글 클릭 → 즉시 저장 (낙관적 업데이트, 실패 시 원복)
- [ ] 새로고침 후 토글 상태 유지
- [ ] 기본값 모두 ON

### 6. 외화 결제 인프라
**URL**: `/business/settings/billing`

체크 항목:
- [ ] 통화 옵션 5종 (KRW/USD/EUR/JPY/CNY) 노출
- [ ] 입금 계좌 6 필드: 은행/계좌번호/예금주/SWIFT/영문 은행명/영문 예금주
- [ ] 외화 청구서 발행 후 공개 결제 페이지에 SWIFT/영문 정보 자동 노출 (KRW 청구서는 한국 정보만)
- [ ] 한국 사업자 고객만 세금계산서 단계 활성, 해외 고객은 거래 탭 단계 보드에서 자동 skipped

### 7. 채팅방 가기 버튼
체크 항목:
- [ ] 문서 공유 모달 → 채팅방에 보내기 → 결과 화면 "채팅방 가서 보기"
- [ ] 서명 요청 모달 + 채팅 토글 → 발송 후 결과 화면 "채팅방 가서 보기"
- [ ] 청구서 발행 모달 + send_chat → 발송 결과 화면 "채팅방 가서 보기"
- [ ] 발송된 청구서 드로어 → 액션바에 "채팅방 가기" (자동 conversation 검색)

### 8. 확인필요 (Phase D1) + 채팅방 배너
체크 항목:
- [ ] `/inbox` 진입 → 서명/결제/세금계산서 collector 동작
- [ ] 업무 추출 시 카드 메시지(서명/문서/청구) 무시 — 텍스트 메시지에서만 추출
- [ ] 채팅방 상단 "업무 후보 N개" 배너에 "확인하기/나중에" 사라지고 X 닫기만

### 9. 통합 설정 좌측 nav
**URL**: `/business/settings`

체크 항목:
- [ ] 좌측 secondary nav 에 워크스페이스 / 청구 설정 / 이메일 / 알림 / 언어 / 파일 저장소 / 구독 플랜 / 권한 / Cue 모두 노출
- [ ] 워크스페이스 아이콘 = 회사 건물 (톱니바퀴 X)
- [ ] 청구 설정 아이콘 = 영수증, 구독 플랜 아이콘 = 신용카드 (구분됨)
- [ ] `/business/settings/billing` 진입 시 청구 설정 폼 정상 (이전 visibleTabs 버그 fix)
- [ ] 청구 설정의 법인 정보 누락 시 노란 경고 배너 + "법인 정보 입력하기" → 자동 스크롤

### 10. API E2E (백엔드 검증)
선택적으로 임시 스크립트로 종합 검증:
```bash
# /opt/planq/dev-backend 에서 임시 스크립트 작성 후 실행
# 22/22 시나리오 (D+2 11 + Phase E 회귀 8 + 외화/거래/확인필요 회귀 3)
```

---

## 완료된 작업 (이번 세션, 2026-04-27)

### Phase D+1 — 거래 시퀀스 자동 진행
- 신규 모델 `ProjectStage` + 4 템플릿 (fixed/subscription/consulting/custom)
- `services/projectStageEngine.js` — 자동 진행 + next_action 계산 엔진
- post/signature/invoice 변경 hooks 모두 연결
- 레거시 프로젝트 lazy seed (GET /transactions 첫 호출 시)
- TransactionsTab: 다음 할 일 카드 + 단계 보드 추가

### Phase D+2 — 거래 stage 사용자 정의 UI
- 신규 라우트 `POST /api/projects/:id/stages/:stageId/move` (트랜잭션 swap)
- TransactionsTab 편집 모드: label/순서/추가/삭제/토글
- template_seeded 삭제 차단 (자물쇠 아이콘)
- 18/18 E2E 통과

### Phase E — PDF · 메일 · 알림
- **PDF**: Puppeteer 싱글톤 + invoice/post HTML 템플릿 (외화면 자동 영문) + 메일 첨부 + 다운로드 버튼 4지점
- **메일**: Business.mail_from_name + mail_reply_to + EmailSettings UI (SMTP 상태 배너 + 미리보기)
- **알림**: NotificationPref 모델 + 21 토글 매트릭스 + isAllowed helper
- 17/17 E2E 통과

### 사용자 지적 대응 (다수)
1. 거래 탭 stage 라인 끊김 fix
2. 거래 → 새 문서 자동 연결 (`/projects/p/X?tab=docs&new=1&category=...`)
3. 프로젝트>문서 탭에 AI/템플릿 버튼 추가
4. 모달이 list 모드 return 블록 밖에 있어 안 보이는 버그 fix
5. 청구 설정 visibleTabs 누락 fix
6. 발신자 정보 redundancy 제거 (워크스페이스 법인 정보로 통합)
7. 통화/은행/세금계산서 멘탈 모델 정리
8. EmailSettings/NotificationSettings placeholder 자연 언어로 정정
9. 워크스페이스/청구 설정/구독 플랜 아이콘 차별화

### 채팅방 가기 버튼 4 지점
- PostShareModal · PostSignatureModal · NewInvoiceModal · InvoiceDetailDrawer

### 업무 추출 정확도 (Phase D1 보완)
- 카드 메시지 (`kind='card'`) 추출 제외 → "표준 견적서 작성" 같은 오추출 방지
- 채팅방 상단 배너 "확인하기/나중에" 제거 → X 닫기만

### 설정 통합
- Q Bill `/bills?tab=settings` → `/business/settings/billing` 자동 redirect
- 좌측 secondary nav 에 청구 설정/이메일/알림 신규 항목

---

## 환경 / 인증

- 백엔드: pm2 planq-dev-backend (port 3003)
- DB: planq_dev_db / planq_admin / CE5tloemiYjWNUIs
- 도메인: dev.planq.kr
- 헬스체크: `node /opt/planq/scripts/health-check.js` — 27/27 통과
- 마지막 빌드: `index-D8MbLadb.js`
- 신규 패키지: puppeteer (백엔드)

---

## 신규 메모리 (이번 세션)

- `project_phase_e_complete.md` — PDF/메일/알림 인프라
- `project_project_stages.md` — ProjectStage 4 템플릿 + 자동 진행
- `feedback_user_facing_copy.md` — 사용자 노출 문구 자연 언어 원칙
- `feedback_currency_vs_bank.md` — 통화·은행·세금계산서 분리 멘탈 모델
- `feedback_tab_layout_unify.md` — 탭 레이아웃 스코프 통일

---

## 다음 할 일 (우선순위)

### 옵션 C — Phase F: Q docs 슬롯 시스템 (~5일)
- 템플릿 변수 슬롯 (`{{client.biz_name}}`, `{{project.amount}}` 등)
- 새 문서 작성 = 폼만 입력 → 본문 자동 채움
- 슬롯 단위 변경 비교
- 발신/수신 자동 채움 (Business + Client biz_*)
- 영문 슬롯 자동 (외화 청구 영문 계약서/견적서)

### 옵션 B — SMTP 운영 연결 (Irene 결정 필요, ~1일)
- `.env` 의 SMTP_HOST/USER/PASSWORD/FROM 값 결정
  - SendGrid / Mailgun / AWS SES / Google Workspace 중 선택
- 도메인 인증 (SPF/DKIM/DMARC) DNS 작업
- 실 발송 검증 (청구서/서명/문서 공유)

### 옵션 D — Phase 8: 반응형 일괄 스프린트 (~5일)
- 햄버거 2뎁스 아코디언 + 마스터-디테일 드릴다운
- 모든 페이지 모바일 대응

---

## 복구 가이드 (새 Claude 세션)

```
session-state.md 읽고 "다음 세션 전체 테스트 가이드" 항목대로 검증해줘.
이상 없으면 옵션 C (Phase F Q docs 슬롯 시스템) 진행.
```

또는 직접:

```
Phase F Q docs 슬롯 시스템 구현해줘.
- 템플릿에 변수 슬롯 정의
- 새 문서 작성 = 폼 입력 → 본문 자동 채움
- 슬롯 단위 변경 비교
- 영문 슬롯도 자동
실 API 정석 개발. mock 절대 금지.
```
