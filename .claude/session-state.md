# PlanQ 세션 상태

**마지막 업데이트:** 2026-06-10 — **운영 피드백 집중 사이클 (deploy11~13 운영 라이브).** 작업 상태: 완료.

---

## ✅ 이번 세션 운영 라이브 (deploy11·12·13)
- **포커스 측정시간 SSOT (#17)** — focus.js `task_accumulated_seconds`(종료세션 합)+현재, FocusWidget/TaskFocusBar baseline 통일, 재개 0리셋 차단. E2E 4/4
- **Q task 실시간 (#19/#11)** — `PATCH /:id/time` task:updated broadcast 추가(진행률·시간 즉시 반영)
- **채팅 토스터 중복 (#25)** — message:new conv+business 양쪽 도착 → msg.id 10s dedup (NotificationToaster). ChatPanel/unread는 이미 dedup
- **유예 구독 비활성 오판정** — plan.js `active` 가 grace 무시 → 유예 중 업로드 차단. `code==='free'?true:(!expired||inGrace)&&[...]`. E2E 3/3. [[feedback_plan_active_honors_grace]]
- **KB 미리보기 메타** — 프로필명·source 제거 → 작성/수정일(createdAt accessor fix) + 커스텀 url 항목 + 번들 리스트
- **Q Task 상세** — 작성/요청일, 되돌리기 하단 이동, 단계 직접변경 owner/admin 한정
- **외부 고객 청구서 (#1)** — NewInvoiceModal '외부 직접 입력' 모드(초대 없이 이름+이메일, recipient_email). E2E 5/5
- **업무 타임라인 표시명** — projects `/:id/tasks` applyMemberDisplayName 누락 fix (한수정→루아). [[feedback_member_display_name_on_lists]]
- **내 문의·피드백 (#21/#14)** — 좌측 개인 그룹 메뉴 + `/me/feedback` 페이지 + respond 시 보고자 알림(link /me/feedback). E2E 7/7·4/4
- **모바일 키보드 가림 (#23)** — StandardModal·NewChatModal `100vh→var(--vvh)`
- **피드백 12건 일괄 완료처리+답변+알림** (운영 feedback_items done 3→15)

## 📋 남은 운영 피드백 (pending/reviewing)
- **신기능:** #9 Q talk 팝아웃 탭 · #26 팝아웃 Pin · #28 멀티탭 · #29 독립서버 파일저장
- **버그/개선:** #5 댓글 알림+전체 알림페이지 · #7 모바일 채팅 우측아이콘 자리 · #27 주간그래프 캡처+수동보고
- **부분 완료:** #6 인포 공유(번들·공유 됨, 카테고리 전송 남음) · #23 등록팝업(채팅개설 됨, 나머지 모달 점검 남음)
- **추가 확인:** #1 프로젝트 생성 Q talk 옵션 · #8 같은 방 알림 · #12 Q helper 엔터 · #14 공유 task 링크
- **PlanQ 정상(노션 이슈):** #24 캘린더 제목 — PlanQ는 Google summary 정상, 노션 캘린더 표시 문제

## 📋 청구서 묶음 잔여
- #2 항목별 상세내용(설명) 필드 · #11 청구서 공유·다운로드·미연동 표시 · #10 문서 PDF 다운로드 · #6 AI 재생성 통일(전 영역)

## 환경 / 주의
- dev 3003 / prod planq.kr 3004. 배포 `cd /opt/planq && ./scripts/deploy-planq.sh --auto` (**반드시 /opt/planq 에서 실행** — cwd 다르면 스크립트 못 찾음)
- **배포 전 반드시 커밋** — 미커밋이면 "Changed files:0"으로 sync 스킵. [[feedback_deploy_requires_commit]]
- ⚠️ 백그라운드 `pm2 restart` 자주 멈춤 → **포그라운드 `timeout 45 pm2 restart planq-dev-backend --update-env`**
- 운영 PDF 라이브러리(Chromium) 미설치 — 문서·인포·청구서 PDF 다운로드는 Irene 의 `sudo apt-get` 1회 필요 (대기)
- 운영 DB: `ssh irene@87.106.78.146 'cd /opt/planq/backend; node -e "..."'`

---

## 복구 가이드
새 Claude 세션 시작 시:
```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```
