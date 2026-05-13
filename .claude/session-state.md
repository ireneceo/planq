# PlanQ 개발 세션 상태

## 현재 작업 상태
**마지막 업데이트:** 2026-05-13
**작업 상태:** 완료 — 사이클 N+12 (Q Task 반복 설정 버그 fix)
**버전:** v1.7.1

---

## 진행 중인 작업
- 없음

---

## 완료된 작업 (이번 세션)

### Q Task 반복 설정 버그 fix 3건

1. **격주 반복 저장 안 되는 버그 fix** — `setRecurPreset(p)` 후 `setTimeout(saveRule, 0)` 호출 시 React state가 아직 업데이트 안 된 이전 값('weekly')으로 RRULE 빌드. `buildRecurRule`과 `saveRule`에 `overrides` 파라미터 추가해서 새 값을 직접 전달.

2. **반복 설정 RRULE 파싱 누락 fix** — 상세 진입 시 `setRecurEnabled(true)`만 호출하고 preset/endType 복원 안 함. `parseRRule()` 사용해서 전체 state 복원.

3. **반복 설정 권한 체크 UX 개선** — 담당자(작성자 아닌 경우)는 `recurrence_rule` 수정 권한이 없는데 UI에서 편집 가능하게 보이고 저장 시 403 에러 발생. `canEditRecurrence` 권한 체크 추가 + disabled UI + "읽기 전용" 힌트.

### 수정 파일
- `dev-frontend/src/components/QTask/TaskDetailDrawer.tsx`

---

## 다음 할 일

1. **운영 GDrive 연결 fix** (irene 직접 진행 필요)
   - Google Console에서 OAuth client에 `https://planq.kr` 리디렉션 URI 추가
   - 운영 `.env`에 `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` 실값 교체
   - `pm2 restart planq-prod-backend`

2. **청크 5 (visibility 배지 카드/행 적용 + 5중 시각 시그널)**

3. **DocsTab 카드 hover share 아이콘**

---

## 환경변수 / 인증 현황
- SMTP 5개 dev/prod populated
- DEEPGRAM 양쪽 EMPTY
- **GOOGLE_CLIENT_ID/SECRET — dev 정상 / 운영 placeholder ★ irene fix 필요**
- JWT_SECRET dev/prod 분리
- platform_admin: irene@irenecompany.com (dev), irene@irenewp.com (prod)
- .env 권한 640

---

## 주요 문서 위치
- 권한 매트릭스: `/opt/planq/docs/PERMISSION_MATRIX.md`
- 4단계 visibility: `/opt/planq/docs/VISIBILITY_VOCABULARY.md`
- 개인 보관함 설계: `/opt/planq/docs/PERSONAL_VAULT_DESIGN.md`
- 개발 로드맵: `/opt/planq/DEVELOPMENT_PLAN.md`

---

## 복구 가이드

새 Claude 세션 시작 시 아래 내용을 붙여넣으세요:

```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```
