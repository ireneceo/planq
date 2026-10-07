## 현재 작업 상태
**마지막 업데이트:** 2026-10-07 (개발완료) · **주체:** [Opus] Opus 5.5 (+ Fable 검증 서브에이전트 5회)
**작업 상태:** 완료 — 운영 배포 5회(마지막 f19fbfca 12:39, backup 20261007_123113). 이전: **dev 미배포 5커밋**: bf4353d7 체크박스 디자인 · 59fba176+a6e3b66e AI create_event 칸·감사 대상 · 6169cbfe 반복 회차 날짜 · (위키 시드·UI 가이드 문서)

### 진행 중인 작업
- 없음

### 답 기다림: 운영 위키 시드 실행 (2026-10-07)
- **무엇을:** 운영에서 `cd /opt/planq/backend && node seed-wiki-content.js` (배포 후 단계)
- **왜 멈췄나:** 운영 데이터 쓰기 명령이 권한 검사에서 거부됨 — 우회하지 않음
- **답이 오면 할 일:** Irene 이 직접 실행하거나 허용 → 실행 후 #459 답글(체크박스 2차, done)

### 완료된 작업 (이번 세션)
- 서명 흐름: 확인필요·받은 서명 → /sign/:token · 문서 먼저 → 서명 위치 → 본인 확인 → 서명 · 우리 쪽 링크를 로그아웃/다른 계정으로 열면 로그인 안내
- 구독: 결제 대기 유예 중 전부 잠기던 결함 → `services/planActive` 상태표(운영 biz 10 해제 확인) + health-check billing 6건
- 채팅 푸시: 다른 기기에서 그 방을 보고 있으면 생략(`services/presence`, PushLog viewer_active, fail-open)
- 통합 검색 둘째 줄(업무 담당·작성·마감 / 문서 #분류 / 파일 올린 사람·날짜) · 파일 설명·태그 검색
- Q calendar: 워크스페이스 시간대 · 겹침 나란히 · 업무 연결 · 알림 제목 · 프로젝트 필터 · 프로젝트 «일정» 탭
- 랜딩·로그인·SEO 정의 «의뢰형 고객 업무» 포지셔닝 원복(Irene: 주 업무는 업무관리·내부소통)
- Fable 지적 수정: AI 감사 대상(문서·일정) · L1 문서 owner/admin 편집 차단 · 메일 아는 상대 자기 증명 · 삭제된 업무 표시 · 동의 문구
- 피드백 회신 함수(`services/feedbackRespond` + `scripts/feedback-reply.js`) · 개발시작/개발완료 스킬에 운영 피드백 확인·답변 단계
- 체크박스·라디오 우리 모양(전역 `:where()`) · AI create_event 종류·알림·업무·화상 링크
- 운영 피드백 답변: #461 done · #462 reviewing

### 답 기다림 (이전): 운영 배포 지시 (2026-10-07) — 12:39 배포 완료 f19fbfca
- **무엇을:** dev 미배포 6커밋(59fba176 · 6169cbfe · bf4353d7 · a6e3b66e · fd9d972c + 기록) 운영 배포
- **왜 멈췄나:** 배포는 Irene 의 명시 «/배포» 로만 한다(CLAUDE.md 배포 규칙 · 상황판 지시 «운영 배포 Irene 지시 없이 안 함»). 상황판 항목 배정만으로는 배포 지시로 보지 않았다
- **배포 준비 상태(2026-10-07 확인):** health-check 51/51 · 불변식 가드 통과 · dev 빌드 12:22(fd9d972c 12:09 이후) 반영 · dev.planq.kr 200. Fable: 59fba176 41/43 PASS + 감사 대상 한 줄 수정(a6e3b66e)은 Fable 미검증(자체 검증)
- **답이 오면 할 일:** /배포(--auto) → 운영 verify 3종 → `ssh …prod "cd /opt/planq/backend && node seed-wiki-content.js"` → #459 답글(체크박스 2차, done)

### 다음 할 일
1. **배포 대기 6커밋** (⏸ Irene /배포 지시 대기 — 위 «답 기다림») (+fd9d972c 코드 블록 [+] 띠 편집 모드에서만) — 배포 후 운영 위키 시드(`ssh …prod "cd /opt/planq/backend && node seed-wiki-content.js"`) · #459 답글(체크박스 2차, 배포 후 done)
2. **Irene 결정 대기 8건** (Fable B 판정 — docs/FABLE_GATE_QUEUE.md 맨 위 «2026-10-07 Fable 라운드 결과»):
   ① Kate·Aidan 같은 회사? → 고객별 채널 원칙(청구서가 다른 고객에게 보이는 상태) ② 프로젝트 복사본 고객 연결
   ③ AI 프로젝트 만들기·태그 생성·메모 기본 L1 ④ 보낸편지함 먼저/스팸 30일 ⑤ Cue 질문 분석 opt-in · help_question_logs 90일
   ⑥ 구글 캘린더 목록 권한을 OAuth 심사에 묶기 ⑦ Claude 개인/조직 연결 · 운영 ChatGPT 중복 grant ⑧ #462 일정 알림 선택
3. 남은 피드백(결정·설계 필요): #458 말하기 업그레이드 · #434/#456 폰 공유로 넣기(앱 빌드) · #460 설문 검토 의견 · #457 «Link WRONG»(외부 사용자, 맥락 없음) · #415 빈 글
4. 종일 일정 시간대(기기 자정 저장 → 다른 시간대에서 하루 밀림) — 구글 동기화·알림까지 걸려 Fable 설계부터
5. Irene: ChatGPT 재연결(docs:write) · front_v4.jpg 운영 확인

### 주요 변경사항
- 신규: `services/{planActive,presence,feedbackRespond}.js` · `scripts/feedback-reply.js` · `pages/QCalendar/{ProjectFilter,CalendarFrame}.tsx`
- `QCalendarPage` scope prop(프로젝트 탭) · `NewEventModal initialProjectId` · `services/socket.ts registerViewing`
- 기억: memory `feedback_positioning_needs_explicit_decision` (포지셔닝 문장은 Irene 이 정한 것만)

---

## 복구 가이드

새 Claude 세션 시작 시 아래 내용을 붙여넣으세요:

```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```
