# PlanQ 세션 상태

**마지막 업데이트:** 2026-06-15 — 모바일 OS push 미해결 진단 + 세금계산서 보완. 다음 섹션 이어서.

## 현재 작업 상태
**작업 상태:** 진행 중 (모바일 OS push 미해결 — 다음 섹션 최우선)

### 🔴 진행 중: 아이린 아이폰만 OS push 배너 미표시 (최우선)

**증상:** 아이린 아이폰(iOS 18.7, PWA)에서 OS 알림 배너·배지·알림센터 전부 안 뜸.
데스크탑은 정상. **직원 한수정(user 3, iOS 18.6)은 똑같은 푸시를 정상 수신.**

**운영 DB·로그로 증명된 사실 — 실패 지점 = iOS 화면 표시 단계 단 하나:**
```
서버 → Apple(201 수락) → 아이린폰 SW 수신(ack) → showNotification 성공(count++→5, perm=granted) → [iOS 화면표시] ✗
```
- 구독: sub92(iOS18.7, web.push.apple.com) **활성** + sub83(Mac) 활성. p256dh=87/auth=22 정상
- 발송: 최근 3시간 전부 `sent 201` (실패/410/404 0건). Apple이 매번 수락
- 중복/좀비: 활성 iOS 1개뿐(좀비 자동만료 정상). 재구독마다 새 endpoint 정상 생성
- **직원 endpoint와 형식 100% 동일** — 직원폰은 뜨고 아이린폰만 안 뜸
- 코드 회귀 아님: push/sw/manifest/notify 파일 목요일(6/10, 5b831d5)→월요일아침(6/13, 3847f3c) **변경 0건**. 같은 코드+같은 iOS18.7로 금요일엔 잘 됨

**→ 결론: 아이린 기기의 iOS 알림 "표시" 상태 문제 (서버/코드/구독 아님).**
가장 유력: 오늘 테스트 폭주(망가진 코드로 알림 도착했으나 화면 미표시 다수)로
iOS가 PlanQ를 "조용히 전달" 자동 강등 / 또는 잠금화면·배너·알림센터 토글 OFF / Scheduled Summary.

**다음 섹션 첫 액션 (아이린 확인 필요 — 아직 답 못 받음):**
1. 아이폰 설정 → 알림 → PlanQ → 화면 그대로 읽어달라:
   "조용히 전달 중" 문구 / "잠금화면·배너·알림센터" 토글 / "예약된 요약"에 PlanQ 포함 여부
2. 알림 센터(위→아래 스와이프)에 PlanQ 알림이 쌓여 있나 vs 아예 없나 (갈림길)
3. 안 풀리면: PWA 삭제 → 아이폰 재부팅 → 재설치 → 알림 허용 (nuclear reset)
4. 근본 대안: 알림톡/SMS 등 OS 비의존 채널 (PWA push의 iOS 한계 회피) 검토

**오늘 운영 배포된 관련 수정 (live):**
- bc1e5d8 sw.js 풀옵션 복원(icon/badge/tag/vibrate/silent:false) — 금요일 버전
- 30ad10b icon-72.png 생성 (없어서 badge가 HTML 404였음 → image/png 정상화)
- 97281c3/c5b7772 미읽음 이메일 에스컬레이션 (push silent-drop 안전망, 5분) — **현재 모바일 구멍 메우는 중**
- 67ba7dc push 핸들러 update() 제거 + ack 측정 / 59cdf47 focused-skip 제거
- ⚠️ sw.js 에 [측정용] ack/diag 코드 남음 — 해결 후 제거 필요

### 완료된 작업 (이번 세션)
- 구독결제 세금계산서 한국 필수항목(업태/종목/담당자명/연락처/신청금액 prefill) — 229b8a6, e5c862d
- 프로젝트 없이 만든 본인 업무 첫 배정 허용 (운영 #37) — 20d74a3
- 데스크탑 OS push 회귀 fix (focused-skip 제거 + update() 제거) — 정상화 확인
- 미읽음 이메일 에스컬레이션 안전망 신설 (1분 cron, read_at NULL+5분)

### 다음 할 일 (알림 해결 후)
- #6 AI 생성물 재수정/재생성 UX 통일
- #9 lua 피드백 reviewing 13건
- #10 Q docs 문서 다운로드 (PDF)
- i18n en JSON 머지 (8 에이전트 ~130키, defaultValue 코딩됨 / en JSON 미머지)
- OAuth Safari → DEV redirect 버그 (아이린 "저장만" 요청)

---

## 복구 가이드
새 Claude 세션 시작 시:
```
이전 세션 이어서. /opt/planq/.claude/session-state.md 읽어줘.
모바일 알림(아이린 아이폰만 OS 배너 미표시) 이어서 해결하자.
```
