## 현재 작업 상태
**마지막 업데이트:** 2026-05-06 v1.1.1
**작업 상태:** 완료 — 운영 라이브 (`9206095`, timestamp `20260506_084745`)

### 진행 중인 작업
- 없음

### 이번 세션 (2026-05-06) 운영 라이브 누적 13 commit

직전 운영 (`a0b550f`, 2026-05-05) 이후 박제·검증·배포 풀 사이클.

| commit | 영역 | 요약 |
|---|---|---|
| `4adcbc8` | auth | 약관 재동의 모달 — 랜딩 차단 + 백엔드 PUT 처리 + refreshUser |
| `58487e9` | qtask | 주간 보고 (Weekly Review) Phase 1 — 4번째 탭 + 자동/수동 박제 |
| `66f55da` | claude | 개발팀 + 협업 규칙 섹션 |
| `62b2eb8` | notif | 알림 풀세트 — 새 메시지 push + unread 뱃지 + 자동 구독 + Badging API |
| `d54da34` | qtalk | 메시지 시간 미표시 fix + Hangouts 그룹핑 + [고객] 라벨 |
| `63c4c0a` | recur | Q Calendar 반복 풀세트 (3주/N주마다 + 종료 조건) + 공통 RecurrencePicker |
| `e7708e4` | pwa | 모바일 설치 배너 — FAB 위로 + iOS/Mac Safari 클릭 가능 |
| `375b540` | notif | 데스크탑 사운드 + 모바일 진동 활성 |
| `a0c8572` | notif | unread 실시간 일치 + 앱 아이콘 정확한 숫자 + manifest 아이콘 선명도 |
| `101f1a5` | notif | 무관한 task 토스트 노이즈 제거 + push 클릭 link path 일괄 fix |
| `c29aeef` | auth | 로그인 상태 유지 체크박스 — 사용자 동의 기반 영속 인증 |
| `963cced` | auth | login 라우트 cookie 도 remember 분기 (보강) |
| `f196029` | qtalk | 업무 추출 풀 재설계 — 정밀 LLM + 인라인 편집 + 등록/요청 분기 + URL 자동링크 |
| `f0b7e38` | weekly | workspace_timezone → timezone (cron 컬럼명 오류) |
| `581728b` | recur | "매년 NaN월 NaN일" 차단 + 리스트 칩은 short 라벨 |
| `ffab8c5` | login | 좌측 브랜드 로고 + 설명 문구 갱신 (planQ-slogan_white.svg + 새 슬로건) |
| `e3578d3` | notif | 본인 액션 토스터 차단 + 역할별 메시지 분기 + revision 핸들러 |
| `ec2b9eb` | qtask | 댓글 첨부 이미지 등록 직후 표시 안 되는 버그 — stored_name 누락 |
| `9206095` | qtalk | 연속 메시지 줄간격 좁힘 (Slack 패턴 강화) |

### 핵심 사용자 영향

**알림 풀세트 (Slack/행아웃 수준):**
- 새 채팅 메시지 OS 푸시 + 사운드 + 진동
- 좌측 메뉴 unread / 채팅 리스트 뱃지 / 데스크탑 PWA dock 아이콘 숫자 실시간 일치
- 본인 액션 알림 자기에게 표시 차단 (actor_user_id payload)
- 받는 사람 역할별 메시지 (요청자/검토자/담당자)
- 모바일 알림 클릭 시 정확한 페이지 (이전 /q-talk → /talk fix)
- PWA 자동 구독 (Slack 패턴 — granted 자동 / default 7일 1회 prompt)

**업무 추출 정밀화 (30년차 AI 시각):**
- ZERO-TOLERANCE — 질문/보고 추출 금지
- 모호한 객체는 `[   ]` placeholder
- 마감 EXPLICIT 만 (이번주/곧/조만간 → null)
- 1:1 채팅 자동 담당자 추론
- 우측 패널 인라인 편집 (제목/담당자/마감)
- 담당자 본인 → "등록" / 타인 → "요청" 즉시 분기

**로그인 / 인증:**
- "로그인 상태 유지 (7일)" 체크박스 (Slack/Google 표준)
- 새 로고 + 슬로건: "업무, 프로젝트, 사람, 시간, 고객, 청구를 하나로 연결해 시간을 돈으로 바꾸는 수익성 엔진"

**Q Talk 채팅:**
- 메시지 시간 표시 정상화 (toJSON override 후 발견된 widespread bug)
- 같은 발신자 연속 메시지 그룹핑 (Hangouts 패턴, 줄간격 좁힘)
- URL 자동 클릭 가능
- [고객] 라벨 (channel_type=customer 만, coral)
- 댓글 이미지 등록 직후 표시 (stored_name fix)

**Q Calendar 반복:**
- 3주/4주/N주마다 반복 (Custom 모달)
- 종료 조건 (계속 / N회 / 특정 날짜까지)
- 공통 RecurrencePicker 컴포넌트

**Q Task:**
- 주간 보고 4번째 탭 (자동·수동 박제, JSON 통계 활용 준비)
- 정기업무 RRULE 라벨 정밀화 (격주 / 매월 / 매년 short, NaN 차단)

**모바일 PWA:**
- 설치 배너 위치 + iOS/Mac Safari 클릭 가능 (방법 보기 단계 펼침)
- 아이콘 선명도 (manifest icons 순서 PNG 우선)
- 모바일 OS 알림 / 공유 시트 / 뱃지 — PWA 설치 시 작동

### 운영 라이브 정보
- URL: `https://planq.kr` (`9206095`, timestamp `20260506_084745`)
- 운영 백업: `/opt/planq/backups/20260506_084745`
- 배포 직전 운영: `a0b550f` (2026-05-05) → `9206095` (이번)

### 다음 진입 ★ 후보
- KB Phase 2 — PDF/docx 파일 업로드 + 다중 분리 정밀
- Q Task 정기업무 (RRULE 자동 생성 cron — D-7 미리 instance 생성)
- Q docs 재구조화 + 자료정리 Brief 통합
- 알림 그룹화 (5분 묶음) / DND 시간대 / `/activity` 통합 히스토리
- Phase 9 통합 컨텍스트 (Q Mail + 360° + visibility 4단계, 9주 사이클)
- 협업 인프라 — PM2 권한 분리 (lua 가 자기 백엔드 변경 후 직접 restart 가능하게)
- multer originalname utf-8 정규화 (macOS Screenshot narrow no-break space 깨짐 fix)

---

## 환경
- **운영 라이브:** https://planq.kr (`9206095` v1.1.1, timestamp `20260506_084745`)
- **dev:** dev-backend port 3003 (planq-dev-backend), dev.planq.kr — 헬스 200
- **운영:** backend port 3004 (planq-prod-backend), q-note port 8001 (planq-prod-qnote)
- DB: dev planq_dev_db, 운영 planq_prod_db

---

## 복구 가이드

새 Claude 세션 시작 시:
```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```
