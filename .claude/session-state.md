# PlanQ 세션 상태

**마지막 업데이트:** 2026-06-09 — **운영 배포 완료** (deploy `20260609_175356`, commit `a145e37`, 132초, 검증 3/3 OK)
**작업 상태:** Q docs 버그 클러스터 + 통화/청구서/인박스/메모장/빌링 운영 라이브. 남은 건 기능/설계 (아래 백로그).

> 버전은 **1.33.3 유지** (이번 배포 버전업 안 함 — Irene 다음 결정).

---

## ✅ 이번 세션 운영 배포 완료 (a145e37)

### Q docs (프로젝트 하위 "문서" = ProjectPostsTab) 버그 클러스터
- **#4 AI 생성** — `ProjectPostsTab` AI 버튼이 `intent="ai"` 없이 PostAiModal 열어 AI 탭 자체가 안 떴음 → 두 인스턴스에 `intent="ai"` 추가.
- **#5 첨부** — edit 모드 첨부 저장 누락 + view 모드 orphan(저장버튼 없음). 모두 `uploadProjectFile`(project_id+L2)+`attachToPost`로 통일. **E2E 8/9** — 문서·프로젝트>파일·Q File 3곳 노출 확인. (백엔드 무변경, files.js 가 project_id+L2 설정.)
- **#3 admin 목록 안 보임** — `middleware/access_scope.js` 가 `admin` role 미매핑 → owner급 전권(`isAdmin` + `fullView`). owner-only(재무)는 businessRole 검사라 계속 제외. `getUserScope`/`isMemberOrAbove`/`assertWorkspaceAccess`/`postListWhereByLevel`/`canAccessPostByLevel` + `posts.js assertWorkspaceOrClient`. **E2E 10/10** (admin L2·L3 열람, member 격리 유지).
- **#7 표 행/열** — `PostEditor.tsx` 표 안 커서 시 떠오르는 플로팅 BubbleMenu (열←→/행↑↓/삭제). i18n `qdocs.editor.table.*` ko·en 14키. useTranslation 추가.

### 통화/청구서/기타
- **원화 '원' 표기** — `₩1,000,000`→`1,000,000원`. 인앱 11 + PDF(pdfTemplates) + 메일(emailService) + dashboard.js(fmtAmt 헬퍼) + stats.js. ₩ 잔재 0.
- **청구서 발행일** — `NewInvoiceModal` `todayStr` 하드코딩(`'2026-04-27'`) → `todayInTz(workspace tz)` 실제 오늘. 결제기한도 미래로 정상화.
- **메모장 스크롤** — `PostEditor` compact Body 에 `flex:1;min-height:0;overflow-y:auto` (Wrap overflow:hidden 에 잘리던 회귀). MemoPopup 전용.
- **인박스 3버그** — (1) `dashboard.js resolveName` 이 name_localized(JSON 객체) 반환 → `[object Object]`. localizedToString + name 우선. (2) `insights.js` 컨펌대기 카운트 raw → Task join+business_id+status 필터(인박스와 일치). (3) `InsightCards` 현재경로 순환 CTA 숨김. **E2E 10/10**.
- **빌링 관리자 입금확인 방식** — owner 자가 mark-paid 차단, "입금했어요" 통보(notify-paid)만 → platform_admin 이 admin 라우트에서 활성화. **E2E 21/21**.

### 운영 DB ALTER (배포 시 선적용·검증 완료)
```sql
ALTER TABLE payments ADD COLUMN notify_paid_at DATETIME NULL AFTER marked_at,
  ADD COLUMN notify_payer_name VARCHAR(80) NULL AFTER notify_paid_at;
ALTER TABLE business_members MODIFY COLUMN role ENUM('owner','member','admin','ai') NULL DEFAULT 'member';
```
> **중요:** `admin` ENUM 은 N+21에 모델만 추가되고 dev·운영 DB 둘 다 누락이었음 → 그동안 admin role 자체가 작동 불가였음. 이번에 양쪽 ALTER 적용.

---

## 📋 다음 섹션 백로그 (남은 개발 — 각각 독립 사이클로 제대로)

### 청구서 (Q Bill)
- **#1 외부 고객 직접 입력 수신** — 현재 내부 등록 client 만 수신자 선택 가능(validate clientId 필수). 외부 1회성 고객을 **이름+이메일 직접 입력**해 발행. recipient_name/email ad-hoc + 내부 미연동 배지 표시(#11과 연계). *설계 결정 필요.*
- **#2 항목별 상세내용 필드** — line item 이 description(1줄)+qty+price 뿐. 항목별 상세(여러 줄) 입력·표시·PDF/메일 반영. invoice_items 모델 컬럼 + NewInvoiceModal UI + 템플릿.
- **#11 생성·공유·다운로드 + 미연동 표시** — 청구서 PDF 다운로드/공개 공유 인프라는 있음 → UI 노출·동작 점검. 내부 미연동(외부 수신자) 청구서 배지 표시하되 발행·공유·다운로드 정상.

### Q docs
- **#10 문서 PDF 다운로드** — 프로젝트>문서 본문 PDF 다운로드. Puppeteer(pdfTemplates/buildReceiptPdf 패턴) 재사용. Word(.docx)는 품질 낮아 후순위. 문서 view 헤더에 다운로드 버튼. (현재는 `window.print()` 버튼만 있음.)

### 전 영역
- **#6 AI 생성물 재수정/재생성 통일** — Q docs/Q task/Q note AI 생성물을 "AI에게 다시 수정/개선" 시키는 기능 전무. `/api/docs/ai-generate` 에 current_body+instruction 재생성 모드 + PostEditor 헤더 "AI 다시작성" 버튼 + 공통 컴포넌트화(cue 차감). **Irene 명시 요청: AI 만드는 모든 곳 통일.** *설계 필요.*

### lua 피드백 (운영 DB feedback_items)
- **#9 reviewing 13건** (개발 대기): #1 프로젝트생성 Qtalk · #5 업무댓글 알림 · #6 인포 공유(여러개·카테고리 전송) · #7 모바일채팅 아이콘 자리 · #8 같은방 새메시지 스크롤 · #9 Qtalk 우측탭 팝아웃 · #10 단계 되돌리기 버튼 · #11 Qtask 실시간 반영 · #12 Qhelper 엔터 전송 · #13 Q docs 리스트(일부 #3로 해소) · #14 업무삭제(public/tasks) · #15·16 포커스 측정시간(좌측배너≠상세).
- **#17·18 pending**: #17 포커스 좌측배너 시간≠상세 · #18 Q docs 리스트/문서추가(상당 부분 이번 #3·4·5로 해소 — 운영 확인 필요).
- lua 16건 중 **done 3건(#2 아이디/비번찾기, #3 프로젝트명, #4 요청 이미지)**.

---

## 환경
- dev: 3003 (dev.planq.kr) / prod: planq.kr 3004 (v1.33.3)
- 배포: `./scripts/deploy-planq.sh --auto` (검증된 변경). 백그라운드 `pm2 restart` 가 자주 멈춤 → **포그라운드 `timeout 45 pm2 restart`** 사용.
- 운영 DB 직접 ALTER 는 SSH+node(운영 자체 config/database) idempotent 패턴.

## 미푸시
- 운영 라이브지만 GitHub `git push origin main` 미실행(로컬 wip 커밋만). 필요 시 푸시.
