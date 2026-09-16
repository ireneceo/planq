## 현재 작업 상태
**마지막 업데이트:** 2026-09-16 08:00 UTC
**작업 상태:** 완료 (운영 배포 1회 v1.52.9 · 이후 신고 5건 dev 구현·검증 완료, **미배포**)

### 진행 중인 작업
- 없음. **내일 Fable 로 검증부터 시작한다** (Irene 지시 2026-09-16: *"내일 다 하자. fable하고."*)

### 다음 할 일 (내일, 우선순위 순)
1. **Fable 게이트** — `docs/FABLE_GATE_QUEUE.md` **#54 · #55 · #56** 이 전부 `by:"unavailable"` 이다.
   이 세션에서 Fable 호출이 **429(쿼터 소진)로 6회 연속 실패**했다. 토큰이 돌아오면 세 항목을
   **묶어서 한 라운드**로 올린다(쪼개 올리지 말 것 — CLAUDE.md 소모 규칙).
   각 항목 끝에 *"Fable 이 봐야 할 것"* 이 적혀 있다. 특히 #56 의 두 판단:
   - 회사 대표주소(단일 토막 local-part, 예 `peichin@aimcoffee.com`)를 **일부러 후보로** 보내는 선택
   - 짧은 인사성 메일이 거의 항상 `echoed_inbound` 인데, "요청을 적어 주세요" 로 끝내는 대신
     정형 답장 한 줄을 주는 편이 나은가
2. **커밋 `4296e3de` 운영 배포** (Fable 판정 뒤). 스키마 변경 0 · 마이그레이션 0 — 코드만.
3. 장부 **#409 · #410** 은 답글이 없어 안 닫혔다(안전장치). 답글을 달아야 닫힌다.

### 완료된 작업 (이번 세션)

**0. 앞 세션에서 끊긴 작업 마무리 → 배포 v1.52.9** (커밋 `95d53e0f` · `eca60c65`)
- 채팅 첨부 미리보기: 소켓 매퍼가 `preview_url`·`file_id`·`drive_editable` 을 버리던 것(2026-09-07 에
  조회 매퍼만 고치고 실시간 경로를 안 고쳤다) + 서버 판정이 mime 만 보던 것 → 확장자 폴백.
- 확인필요 → 영업 링크가 `?tab=` 을 싣는다(상담 탭은 미등록 문의만 담아 5종 중 4종이 0건이었다).
- 운영 배포 검증: health ok · 프론트 200 · PM2 1.52.9 · CSP 일치 · PDF 렌더 OK ·
  백업 `/opt/planq/backups/20260916_063048` · 릴리즈노트·개발현황 발행 완료.

**1. Q sale 상담 유입 기준을 «관계» 로** (커밋 `4296e3de`, 미배포)
- 운영 실측 `triage='human'` 32건: 쇼핑몰 주문알림 10 · 카드사 약관 · 11번가 통지 · Tripadvisor 광고 ·
  무역협회 «수출상담회 참가 신청». 진짜 문의 7건 중 5건이 «우리가 답함» 또는 «개인 주소».
- `services/saleMailCriteria.js` 신설 — 자동 유입 = 우리가 답함 · 개인 주소 · 사람이 올림.
  나머지는 **「후보」** 칸(버리지 않는다). dev 실측 889 → 34.
- 목록과 집계가 `classifyMailThreads` **한 번**을 읽는다(전엔 같은 술어가 두 벌이었다).

**2. [상담으로 보내기] 3곳** — 메일 목록 **우클릭**(행이 `<button>` 이라 안에 메뉴 불가 → `AppContextMenu`
  에 `data-pq-context` 확장) · 메일 상세 ⋯ · 채팅 메시지 툴바. `POST /:biz/inbox/promote`.
  보관함 [되돌리기]도 «사람이 문의라고 말한 것» 으로 읽는다(안 그러면 되돌려도 후보로 떨어졌다).

**3. AI 답변 초안 "아무 반응 없음"** — 그 메일은 서버가 `echoed_inbound` 로 막는다(실측 2.6초·0자).
  화면은 "아래에 적어 주세요" 라는데 **그 입력란이 초안 있을 때만** 떴다(막다른 길) →
  실패 직후 열고 커서 이동. 빈 초안을 success 로 내보내던 경로는 422 `ai_empty`.

**4. 확인필요 → 메일 폴더 동기화** — `?thread=` 로 들어오면 그 메일이 **속한 폴더**로 좌측을 맞춘다.
  `setFolder` 를 쓰지 않는다(그 함수는 `thread` 를 지워 방금 연 메일을 닫는다).

**5. 업무 댓글에 결과물 버전 **시점**** — 댓글 + 버전을 시간순 한 줄기로. **내용은 넣지 않는다**
  (2026-09-10 박제 유지). Irene 진단이 맞았다 — 시점이 안 보여 담당자가 "올렸습니다" 댓글을 따로 썼다.

**6. 리팩터** — `SaleInboxList` 가 800줄 계약을 넘겨(847) `useInboxItemActions.ts` 로 액션 한 벌 분리(793).

### 주요 변경 파일
- 신규: `dev-backend/services/saleMailCriteria.js` · `dev-frontend/src/components/QSale/useInboxItemActions.ts`
  · `scripts/e2e/canary-sale-criteria.js`(suite `salecriteria`) · `scripts/e2e/canary-chat-preview.js`(suite `chatpreview`)
- 수정: `saleInbox.js` · `sale_save.js` · `cue_orchestrator.js` · `email_threads.js` · `MailPage.tsx`(+styles)
  · `ChatPanel.tsx` · `TaskDetailDrawer.tsx` · `AppContextMenu.tsx` · `SaleInboxList.tsx` · locales 8종
  · `seed-wiki-content.js`(아티클 `sale-inbox-criteria` 추가 — **운영 반영하려면 배포 후
  `node seed-wiki-content.js` 를 운영에서 돌려야 한다**)

### ★ 이번 세션에서 내가 틀린 것 (내일 같은 실수 반복 금지)
1. **"AI 초안 5분 무응답" 은 오진**이었다. 측정 스크립트가 DB 풀을 안 닫아 프로세스가 끝나지 않았고
   `| tail` 뒤에서 출력이 갇혔다 — **응답 시간이 아니라 프로세스 수명을 쟀다.** 실측 gpt-5.1 **1.9초**.
   그 숫자로 Irene 의 «모델 교체» 승인을 받았고, 사실을 알린 뒤 **원복**했다.
2. **두 번째 측정도 틀렸다** — dotenv 미로드로 API 키 없이 `0.0초 fallback`. "빠르다" 로 읽힐 뻔했다.
   → 하니스가 **진짜 일을 했는지부터** 증명할 것(키 로드 여부를 먼저 출력).
3. **`pkill -f "..."` 가 자기 셸을 죽였다**(그 문자열이 내 명령줄에도 있었다). 종료코드 144.
4. **좌표 판정 2회 거짓 실패** — ①헤드리스 뷰포트 밖 → `scrollIntoView` 후 재측정 ②폴더 동기화를
   **URL 로** 쟀는데 기본 폴더가 이미 맞으면 URL 은 안 바뀐다 → **결과(목록에 있는가)** 로 판정.
5. **`tsc --noEmit` 은 이 저장소에서 거짓 초록**이다(솔루션 참조라 아무것도 검사 안 함).
   **정본은 `npm run build`** — 실제로 TS 오류 7건이 그 뒤에 나왔다.

### Git 상태
- 최근 커밋: `4296e3de` (미배포) ← `eca60c65` (v1.52.9 배포됨) ← `95d53e0f` ← `c8f9ac7b`
- 미커밋 변경: **없음** (working tree clean)
- Fable 게이트 마커: `by:"unavailable"` · fp `e80ec1ce` · commit `4296e3de`
