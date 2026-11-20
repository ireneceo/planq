# 프로젝트 히스토리에 메일·주요 이슈 연결 — 설계 (2026-11-20 · Fable 설계 판정 DESIGN-READY · 방 fec4b3e3)

Irene 원문: «프로젝트 히스토리에 고객이 보낸 메일도 연결하자. 그리고 채팅으로 소통하는 주요이슈도 추가되는 거 맞아? fable 검토»
답: 아니었다 — 채팅 «주요 이슈»(project_issues)도 메일도 히스토리 소스에 없었다.

## 메일 — 소스 `mail` (메시지 1건 = 1줄)
- 범위: `email_threads.project_id = 이 프로젝트` 만 · 스레드 status open·archived(스팸·uncertain 제외)
- 메시지 제외: internal_only · 보낸 것 중 delivery_status 가 sent·delivered 아닌 것
- 보는 사람: Q mail 메뉴 read 이상(`menu_permission.menuAllows`) + `accessibleAccountIds` 안의 메일함. 못 보면 줄 자체를 안 보낸다
- 칸(화이트리스트): id `mail:<message id>` · kind mail.received/mail.sent · at=sent_at · actor(보낸 것만 sent_by_user_id) · entity email_thread/thread_id · title(메시지 제목||스레드 제목) · counterpart_name(받은 것만). 본문·요약·수신 주소 금지
- 클릭 `/mail?thread=<id>`

## 주요 이슈 — 소스 `issue`
- 술어 `project_issues.project_id = 이 프로젝트`(GET /:id/issues 와 같음). 독립 대화 이슈 제외
- kind: issue.mail(email_thread_id) / issue.chat(conversation_id) / issue.project — 히스토리 직접 입력 manual «주요 이슈» 와 구별
- title 본문 앞 80자 · preview 80자 넘을 때 앞 240자 · 클릭 개요 탭
- 메일 이슈는 스레드 프로젝트를 따라간다: `mailLink.syncThreadIssuesProject` (linkThread 채울 때 · PUT 스레드 project_id 변경)
- historyOverrides 좌표에 넣지 않음 · 고객 링크(guestHistory)는 손대지 않음

## 실시간(신호만)
- issue:updated / issue:deleted 추가(PUT·DELETE /api/projects/issues/:id)
- `history:refresh {project_id}` (CLIENT_VIEW 미등록 → 고객 방 안 감): 수신 수집 · 답장·새 메일·전달 발송 · 스레드 프로젝트 변경(옛·새) · 메일 이슈 생성·삭제
- HistoryTab 이 issue:new/updated/deleted · history:refresh 를 듣는다

## 검증
Fable 대조군 11종 — 완료 검증(/fable-검증) 1회 필요(메일 줄이 Q mail 밖으로 처음 나감). 스키마 변경 0.
비차단: «주요 이슈» 가 두 군데(project_issues · 히스토리 직접 입력) — 합칠지는 별건.
