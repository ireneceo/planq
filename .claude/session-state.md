## 현재 작업 상태
**마지막 업데이트:** 2026-05-06 v1.1.1+
**작업 상태:** 완료 — 운영 라이브 (`fa292a1`, timestamp `20260506_182044`)

### 진행 중인 작업
- 없음

### 이번 세션 (2026-05-06) — 31 commit 운영 라이브

직전 운영 (`a0b550f`, 2026-05-05) 이후 풀 사이클. Irene 의 광범위 보고 (알림·업무 추출·반복·로그인·다중 디바이스·채팅 UX·모바일 반응형·UI 일관화) 일괄 처리.

### 이번 세션 핵심 영역

| 영역 | 핵심 commit | 사용자 영향 |
|------|---|---|
| 알림 풀세트 (Slack 수준) | `62b2eb8`+`375b540`+`a0c8572`+`101f1a5`+`e3578d3`+`72ee853` | OS 푸시·사운드·진동·뱃지 정확·역할별 메시지·본인 액션 차단·SW fallback |
| 업무 추출 정밀화 | `f196029`+`4d32890`+`fa292a1` | 질문/보고 제외, [   ] placeholder, 인라인 편집, 등록/요청 분기, 정렬·간격 |
| Q Calendar 반복 | `63c4c0a` | 3주/N주마다 + 종료 조건 + 공통 RecurrencePicker |
| 다중 디바이스 세션 ★ | `1b05435` | refresh_tokens 테이블 — Mac+iPhone 동시 사용 시 자동 logout 영구 해소 |
| Q Talk 채팅 UX | `d54da34`+`9206095`+`33731d3`+`a67c4c3` | 시간 표시·그룹핑·줄간격·모바일 100dvh·자동 포커스·auto-resize |
| Q Task 댓글 첨부 | `ec2b9eb`+`da6e8e3` | stored_name fix·인증·영역 분리 |
| 모바일 / PWA | `e7708e4`+`41d7ee1`+`05c68f4` | 설치 배너·iOS 자동 줌 차단·안내 일반화 |
| UI 일관화 | `4650404` | 모든 단일 날짜 → SingleDateField (12곳 일괄) |
| 주간 보고 Phase 1 | `58487e9`+`f0b7e38` | Q Task 4번째 탭·자동/수동 박제·cron fix |

### 운영 배포 흔적 (4회)
1. `66f55da` (2026-05-06 04:54) — Weekly Review + 약관 hotfix
2. `9206095` (2026-05-06 08:47) — 알림 풀세트 + 업무 추출 정밀화 v1.1.1
3. `da6e8e3` (2026-05-06 09:02) — 댓글 첨부 401 fix + 영역 분리
4. **`fa292a1`** (2026-05-06 18:22) — 다중 디바이스 + UI 일관화 + 모바일 반응형

### 신규 자산
**테이블 2:**
- `refresh_tokens` (1b05435) — 다중 디바이스 세션
- `weekly_reviews` + `weekly_review_settings` (58487e9)

**컴포넌트:**
- `components/Common/SingleDateField.tsx` — CalendarPicker singleMode wrapper
- `components/Common/RecurrencePicker.tsx` — 공통 반복 설정
- `components/QTalk/CandidateEditCard.tsx` — 업무 후보 편집 카드
- `components/QTask/WeeklyReview*.tsx` — 주간 보고 (4 컴포넌트)

**메모리 갱신:**
- `project_multi_device_session.md` — RFC 6749 패턴
- `feedback_singledatefield_no_native.md` — native type=date 금지
- `feedback_deploy_explicit_only.md` — /배포 명령 사이클별

### 다중 디바이스 마이그레이션 1회 비용 (운영 사용자 영향)
`1b05435` 배포 직후 모든 사용자 1회 재로그인 필요 (옛 cookie hash ↔ 새 token_hash 매칭 X). 그 후부터 Mac + iPhone + 태블릿 동시 사용 시 logout 영구 해소.

### 다음 진입 ★ 후보

**자주 사용 영역:**
- KB Phase 2 — PDF/docx 파일 업로드 + 다중 분리 정밀
- Q Task 정기업무 cron — D-7 미리 instance 자동 생성
- Q docs 재구조화 + 자료정리 Brief 통합

**알림 후속:**
- 알림 그룹화 (5분 묶음)
- DND 시간대 / 집중 모드
- `/activity` 통합 히스토리

**인프라:**
- 협업 권한 분리 (lua 가 자기 백엔드 변경 후 직접 PM2 restart)
- multer originalname utf-8 정규화 (macOS Screenshot narrow no-break space)
- Phase 9 통합 컨텍스트 (Q Mail + 360° + visibility 4단계, 9주 사이클)

---

## 환경
- **운영 라이브:** https://planq.kr (`fa292a1` v1.1.1+, timestamp `20260506_182044`)
- **dev:** dev-backend port 3003 (planq-dev-backend), dev.planq.kr — 헬스 27/27 PASS
- **운영:** backend port 3004 (planq-prod-backend), q-note port 8001 (planq-prod-qnote)
- DB: dev planq_dev_db, 운영 planq_prod_db (양쪽 refresh_tokens / weekly_reviews 동기화 완료)

---

## 복구 가이드

새 Claude 세션 시작 시 아래 내용을 붙여넣으세요:

```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```
