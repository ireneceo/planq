## 현재 작업 상태
**마지막 업데이트:** 2026-05-07
**작업 상태:** 완료

### 진행 중인 작업
- 없음

### 이번 세션 (2026-05-07) — 랜딩 페이지 Hero 카피 리뉴얼

Irene 요청으로 랜딩 페이지 Hero 섹션 카피 전면 변경.

### 완료된 작업 (이번 세션)
- 슬로건 변경: "일을 일답게 하다" → "일이 일이 되지 않게"
- 프리헤드라인 신규 추가: "업무, 프로젝트, 사람, 시간, 고객, 청구를" (20px, #fff)
- 헤드라인 변경: "하나로 연결해 / 시간을 돈으로 바꾸는 / 수익성 엔진" (48px, 3줄)
- 하이라이트 색상: "시간을 돈으로 바꾸는" 부분 #14B8A6 적용
- 서브카피 삭제: "대화, 할일, 자료, 회의, 청구까지 —" 제거
- 레이아웃 조정: 마진/간격 최적화, Hero 영역 상단 80px 올림

### 수정된 파일
- `dev-frontend/src/pages/Landing/HomePage.tsx`
- `dev-frontend/public/locales/ko/landing.json`
- `dev-frontend/public/locales/en/landing.json`

### 다음 할 일
- KB Phase 2 — PDF/docx 파일 업로드 + 다중 분리 정밀
- Q Task 정기업무 cron — D-7 미리 instance 자동 생성
- Q docs 재구조화 + 자료정리 Brief 통합

---

## 환경
- **dev:** dev.planq.kr (port 3003)
- **운영:** planq.kr (port 3004)

---

## 복구 가이드

새 Claude 세션 시작 시 아래 내용을 붙여넣으세요:

```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```
