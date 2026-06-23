# PlanQ 세션 상태

## 현재 작업 상태
**마지막 업데이트:** 2026-06-23
**작업 상태:** 완료 — **#63 Phase 2(워크스페이스 간 이전) dev 완료·미배포.** 자율 처리 가능한 운영 피드백 전부 해소(이번+병렬 세션). 남은 건 외부의존.

### 진행 중인 작업
- 없음

### 완료된 작업 (이번 세션)
- **#63 Phase 1** 데이터 내보내기 — 본인 L1 export + 관리자 워크스페이스 백업(L1 제외). **운영 라이브.**
- **#87** 업무 전 영역 워크스페이스 표시명(계정명 누출 차단, tasks.js 7곳 + projects.js 4곳). **운영 라이브.**
- **#71** 공지 배너 랜딩·미리보기·팝아웃 차단. **운영 라이브.**
- **#79** 모바일 입력 focus 시 키보드 위로 자동 스크롤(전역 main.tsx). **운영 라이브.**
- **#85** 보고서 SCR(상황·문제·해결) AI 요약 생성(온디맨드·rate-limit). **운영 라이브.**
- **#89** 랜딩 푸터 로고 좌측정렬 + 태그라인 "일이 일이되지 않게, 플랜큐". **운영 라이브.**
- **#90** Cue/AI 업무 — 이름 지정 담당자 배정 + 링크 보존 + 요청 충실 반영. **운영 라이브.**
- **#91** 단일(비분할) 청구서 결제완료 버튼(owner). **운영 라이브.**
- **#63 Phase 2** 워크스페이스 간 이전(복사, 원본 유지) — `transfer-targets`+`transfer` 라우트 + DataExportSettings 카드. E2E PASS(biz5→biz73 복사·원본유지). **dev 완료·미배포(commit 83737db).**
- (병렬 세션) #81 Cue 실제 진행 · #86 모바일 퀵메뉴 잘림 · #92 구독 정기발송 표시 · #72/#88 Google OAuth redirect 운영 fix — 운영 라이브.

### 박제
- **PM2 재시작 함정(이 세션 반복):** `node -e ... && pm2 restart` 같은 compound/background 명령에서 pm2 restart가 자주 미적용(uptime 안 줄어듦). 코드 반영 후엔 **단독 `pm2 restart planq-dev-backend` 실행 + uptime/restart_time으로 적용 확인** 필수. 미적용 시 신규 라우트 404("API 에러")로 오인됨.
- #63 정책: memory `project_data_export_transfer` (본인 L1만·백업 L1제외·이전=복사).

## ▶ 다음 할 일
- **#63 Phase 2 운영 배포** — 다음 `/배포` 시 commit 83737db 반영(transfer 라우트·UI).
- 남은 pending (외부의존, 자율 불가):
  - **#60** iOS 모바일 푸시 — Capacitor 하이브리드 네이티브앱 착수 결정 (Irene)
  - **#72/#88** Google 로그인·Gmail — redirect 운영 fix는 라이브, **Google Cloud 콘솔 OAuth 검증 제출**이 막힘 (Irene) + GCP redirect URI 등록
- **#63 Phase 3 (향후):** 소유권 완전 이양(이동=원본 삭제) · Q note 메모 포함 · 비동기 대용량 export job.

---

## 복구 가이드

새 Claude 세션 시작 시 아래 내용을 붙여넣으세요:

```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```
