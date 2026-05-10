# PlanQ 개발 세션 상태

## 현재 작업 상태
**마지막 업데이트:** 2026-05-10
**작업 상태:** 완료
**버전:** v1.5.2 운영 라이브 (commit `8dc5251` + `06e327f` bump)

---

## 진행 중인 작업
- 없음

---

## 완료된 작업 (이번 세션)

### 사이클 N+5 — 권한 매트릭스 책임선 분리 (v1.5.2)

1. **Task 본문 책임선 분리**
   - `description` 담당자 빠짐 (의뢰자 영역: 작성자/owner/admin)
   - `body` owner 빠짐, admin 백도어 (수행자 영역: 담당자/admin)
   - `routes/tasks.js` FIELD_RULES 분리
   - 프론트엔드 `canEditTitle / canEditDescription / canEditBody` 3분기 + 회색 "읽기 전용" 뱃지

2. **Task DELETE 안전핀**
   - 작성자는 댓글·이력·리뷰어 0건 신생 task 만 삭제 가능 (실수 정정용)
   - 활동 있으면 owner/admin 만

3. **Invoice 재무 owner only**
   - `assertInvoiceMutationOwner` 헬퍼 신설
   - send / mark-paid / unmark-paid / mark-tax-invoice / delete(invoice·installment) 5 라우트 가드
   - member 호출 → 403 `owner_only`

4. **RichEditor 본문 링크**
   - `openOnClick: true` + `target=_blank`
   - editable/readOnly 무관 모든 사용처에서 항상 새 탭

5. **Q Note 진짜 사적 공간 명문화**
   - 코드 (`q-note/routers/sessions.py`) 는 이미 완벽 — 매트릭스가 코드 현실(admin 도 차단)에 일치

6. **박제 문서**
   - `docs/PERMISSION_MATRIX.md` §5.7~§5.10 신설 + §12 이력
   - `CLAUDE.md` 사이클 N+5 정책 4 인라인 노트
   - `dev-frontend/UI_DESIGN_GUIDE.md` §1.4-B 권한 부재 뱃지 패턴
   - i18n ko/en `detail.readOnly` + `detail.readOnlyHint`

### 검증
- 헬스체크 27/27 PASS
- API 권한 테스트 18/18 PASS (owner 9 + member 9)
- 빌드 1.52s, 타입 에러 0
- 운영 배포 109s, https://planq.kr/api/health 200

---

## 다음 할 일 (DEVELOPMENT_PLAN.md 기반)

DEVELOPMENT_PLAN.md 상단 "다음 진입 ★" 차순위 — Irene 선택:
- 권한 옵션 A + 개인 보관함
- Q note 텍스트 type + Quick Capture
- Custom SMTP (Pro+)
- ShareModal 채팅방 발송 후 PostShareModal 흡수 (chat·email 통일 마무리)

이번 사이클에서 발견한 follow-up:
- **Message 편집/삭제 라우트 신규 구현** — 매트릭스 §5.9 명세는 박제됐지만 라우트 자체가 없음. 추후 구현 시 본인 msg + owner 모더레이션 정책 적용
- **`invoices.owner_user_id` 컬럼 활용 재검토** — 담당자 표시는 가능하나 권한 부여 안 함. UI 에서 어떻게 노출할지

---

## 환경변수 / 인증 현황
- SMTP 5개 dev/prod populated. 메일 발송 정상
- DEEPGRAM 양쪽 EMPTY (Q Note STT 503 fallback)
- JWT_SECRET dev/prod 분리 운영
- platform_admin 계정: irene@irenewp.com (워크스페이스 owner 도 겸함)

---

## 주요 문서 위치
- 권한 매트릭스: `/opt/planq/docs/PERMISSION_MATRIX.md` (이번 사이클 §5.7~§5.10 신설)
- 개발 로드맵: `/opt/planq/DEVELOPMENT_PLAN.md`
- UI 가이드: `/opt/planq/dev-frontend/UI_DESIGN_GUIDE.md` (§1.4-B 권한 뱃지 신설)
- 프로젝트 규칙: `/opt/planq/CLAUDE.md`

---

## 복구 가이드

새 Claude 세션 시작 시 아래 내용을 붙여넣으세요:

```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```
