# PlanQ 개발 세션 상태

## 현재 작업 상태
**마지막 업데이트:** 2026-05-18
**작업 상태:** 완료
**운영 라이브 버전:** v1.15.0 (commit `64ace71`, 7회 배포)
**직전 라이브:** v1.13.0 (commit `5317eca`)

### 진행 중인 작업
- 없음

---

## ★ 다음 세션 우선 작업 (사용자 직접 요청)

다음 `/개발시작` 시 아래 항목 우선 안내 — 사용자가 이번 세션에 보고했으나 시간 제약으로 다음 사이클로 미룬 작업들.

### B. 개인 보관함 풀세트 — 프로젝트 페이지처럼
- 현재 개인 보관함이 다른 자산 보기 위주
- 프로젝트 페이지 같은 구조로 자료 등록·수정·관리·삭제 모두 가능하게
- "지식" 라벨은 N+24 에 정리 완료 → "정보" 통일
- 사용자 표현: "개인보관함도 프로젝트처럼 해당 탭에서 다 보고 관리하고 수정하고 등록하게 해줘야지"

### C. Image Lightbox 통일 (전 영역)
- 채팅·문서·곳곳에서 이미지 클릭 시 동작 불일치
- 사용자 표현: "이미지 클릭하면 원본크기 안보이거나 보이더라도 닫기가 안나와서 곤란"
- LightboxWrapper 통합 + 모든 이미지 표시처에서 동일 컴포넌트 사용
- 닫기 버튼 일관 노출

### D. 입력란 외 클릭 영역 확장
- 사용자 표현: "모든 데이터에 아무곳을 클릭해도 커서가 들어가게. 첫줄을 눌러야만 커서가 들어가"
- textarea / contenteditable wrapper 클릭 시 자동 focus
- description/body 같은 큰 입력 영역의 빈 공간 클릭도 진입

### E. 메모/다른 자산 공유 시 권한 설정 통합
- 사용자 표현: "공유하는 기능과 보기/쓰기/읽기 권한 설정 같은 패턴으로 정리 안되어 있어? 필요한 모든 곳에 같은 컴포넌트"
- N+25 에 QNoteShareModal 만 만들었음. 다른 자산은 ShareModal + VisibilityChangeModal 분리
- ShareModal 자체를 visibility 통합형으로 확장 또는 새 통합 컴포넌트
- 메모(text 메모) / 음성노트 / 모든 공유 가능 자산 동일 흐름

### F. 운영 nginx OG share bot proxy 적용 (사용자 직접 SSH)
- 운영서버에서 1회 sudo 명령 실행 필요 (운영서버 sudo NOPASSWD 아님)
- `/tmp/planq-share-bot.conf` 이미 배포됨
- 적용 후 카카오톡·페이스북 등에서 공유 시 페이지별 OG meta 동적 응답

```bash
ssh irene@87.106.78.146
sudo cp /tmp/planq-share-bot.conf /etc/nginx/conf.d/planq-share-bot.conf
sudo sed -i 's|location / {|location / {\n        if ($planq_share_bot) { proxy_pass http://localhost:3004; break; }|' /etc/nginx/sites-available/planq.kr
sudo nginx -t && sudo systemctl reload nginx
```

### F1. dev qnote PM2 등록 재정비
- 현재 lua PM2 의 planq-qnote 가 errored (잘못된 bash 인터프리터)
- irene 가 띄운 uvicorn(PID 변동)이 port 8000 수동 서빙 중
- 운영 PM2 는 정상 (deploy 스크립트가 올바른 옵션으로 띄움)
- dev 환경 정리만 필요

---

## 완료된 작업 (이번 세션 — N+22~N+25)

### N+22 (v1.14.0)
- 채팅 sender 워크스페이스명 적용 (`services/displayName.js` 11지점)
- 좌측 메뉴 워크스페이스명 즉시 반영 (refreshUser hook)
- 프로필 2열 grid + 사용처 hint
- Q Task drawer 닫힘 상태 클릭 동작 + waiting status 드롭다운 + EdgeHandle + 6점→3점
- Q Talk 별·⋮ 정렬 + admin role 권한
- 한글 파일명 mojibake 복구 (`services/filename.js`, 운영 17 row cleanup)
- 본문 인라인 이미지 L1→L3 + 운영 3 row promote
- PostEditor 이미지 selectednode outline read-only 차단
- PWA dock badge race fix (SW visible client skip + visibility reapply)
- q-note text 메모 5 컬럼 idempotent migration

### N+23
- SEO·SNS OG 동적 응답 (`middleware/ogMeta.js`) — share bot UA 17종
- OG 썸네일 1200×630 자동 생성 + Admin "SEO·SNS 공유" 카드
- KB AI ingest parser fix (자격증명 짧은 텍스트도 추출)
- MemoFab Q Talk 노출 + 채팅 한글 IME 가드
- HEIC/HEIF 미리보기 fallback
- Google Calendar 정기 회의 — rrule → recurrence

### N+24
- 채팅 실시간 회복 가드 (visibility/focus/online tryRecover)
- RightPanel "프로젝트 상세 보기" navigate
- CueHelpDrawer Q Talk 노출 (FAB_HIDDEN_PATHS 비움)
- Q Note 종료 후 [설정 보기] [요약 생성] [질문 보기] 3 버튼 + 모달
- MemoFab allowed admin role 추가
- "지식" → "정보" 라벨 잔존 처리

### N+25 (v1.15.0)
- Q Note 공유 통합 모달 (`QNoteShareModal.tsx`) — visibility L1~L3 + L4 share_token 한 모달
- q-note `GET /api/sessions/public/by-token/:token` anonymous endpoint
- `PublicQNoteSessionPage.tsx` + `/public/qnote-sessions/:token` 라우트

### 운영 데이터 cleanup (1회)
- 한글 파일명 mojibake 17 row 복구
- 본문 인라인 이미지 3 row L1 → L3 promote

### 운영 배포 (7건)
- v1.14.0 (N+22) / N+23 OG / N+23 hotfix 3건 / N+24 채팅실시간 / N+24 QNote / v1.15.0 (N+25)

---

## 복구 가이드

새 Claude 세션 시작 시 아래 내용을 붙여넣으세요:

```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```

`/개발시작` 명령 시 위 ★ "다음 세션 우선 작업" 섹션 (B/C/D/E/F/F1) 이 가장 먼저 안내됩니다.
