# PlanQ 세션 상태

## 현재 작업 상태
**마지막 업데이트:** 2026-06-25 (3차)
**작업 상태:** **#93-ⓐ/ⓑ 운영 배포 완료** (deploy `20260625_184251`·149초·`1c21df1`·planq.kr 헬스 200·PM2 prod 2개 online). 이후 **#93-ⓑ 전수 확대 dev 완료·미배포**(`cfaf5c3`, 다음 `/배포` 대상).

### 진행 중인 작업
- 없음

### 완료된 작업 (이번 세션 — 3차)
- **#93-ⓐ/ⓑ 운영 배포** — 직전 세션 미배포분(`a1ee0b4`+`f6e19f9`) `/검증`(헬스29/29·빌드EXIT0·워크플로 shape)+`/배포 --auto`(149초)로 운영 라이브. node_env=production·prod-backend(1.45.0)/prod-qnote online.
- **#93-ⓑ 전수 확대** (`cfaf5c3`, **미배포**) — 나머지 워크플로 액션(ack/submit-review/cancel-review/complete/approve/revert/revision/reviewer·policy) 깜빡임 제거. callAction→refreshAfterAction 의 `setDetailTask(detailR.data)` 전체 교체를 인플레이스로: (1) status·진행률 등 스칼라는 액션 응답(task.toJSON / approve `{task,new_status}`)에서 즉시 병합 → 액션카드 지연 점프 제거 (2) 리뷰어·이력·댓글·첨부 background 보강하되 **body/description(RichEditor 바인딩)은 prev 레퍼런스 유지** → 에디터 리렌더 원천 차단. focus:refresh dispatch 추가. 검증: 빌드EXIT0·TS0 / **워크플로 shape E2E 10/10**(전이별 status·approve 래핑·body 보존, JWT 직접서명으로 리뷰어 approve 라이브) / i18n 0 / dev 서빙 200 / 테스트데이터 원복.

### 직전 세션(2차) 완료분
- **랜딩페이지 재정비** — 홈 Features Q 시리즈 5→9개(Mail·docs·Calendar·Project). v1.45.0 운영 배포(`e8709a7`, deploy `20260625_155601`, planq.kr 헬스 200). 동봉: #72/#88 앱 비번(`c98bb50`) + #63 Phase 2(`83737db`). 빌드 OOM fix(package.json 8192).
- **#93-ⓐ Q helper 팝아웃 재로그인** (`a1ee0b4`, **미배포**) — 부모 창(window.opener)이 `__pqGetToken` 으로 access token getter 노출 → 팝아웃 부팅 checkSession 이 즉시 상속 → refresh 라운드트립/플래시 제거. 만료 시 기존 apiFetch 401→refresh 자동 복구. cross-origin opener throw→catch 폴백, 일반 탭 무변경.
- **#93-ⓑ "진행 시작" 깜빡임** (`f6e19f9`, **미배포**) — actStart 가 status 전이 후 전체 refetch(refreshAfterAction → setDetailTask(detailR.data)) 로 본문/액션카드까지 리렌더 → 깜빡임. status 만 인플레이스 병합 + 이력/리뷰어만 refreshWorkflowOnly 헬퍼로 보강. status 전이 시 inbox:refresh+focus:refresh dispatch(Focus 위젯 즉시 동기화). changeStatus 에도 동일 이벤트.

### 검증 (#93)
- 백엔드 refresh 3시나리오 PASS · 상속(유효)/me 200 · 만료 401→복구 · 빌드 EXIT0(tsc+vite 8GB) · 번들 브리지 반영 · /help-popout·/tasks 서빙 200 · 신규 i18n 0.

### 피드백 큐 확인 (3차 — 정정)
- **dev** `feedback_items` 2건 + `contact_inquiries` 13건 = 전부 옛 검증/테스트 잔존물 → 정리 완료(feedback→wontfix, inquiry→spam). dev 미해결 0.
- **운영(planq.kr)은 다름** — `contact_inquiries` new 0건(정리 불필요)이나 `feedback_items` **pending/reviewing 17건은 전부 진짜 사용자 피드백**(#60·#63·#71·#72·#79·#81·#84·#85·#86·#87·#88·#89·#90·#91·#92·#93·#94). 임의 close 금지. 대부분 이미 배포 처리됐으나 운영 status done 마킹만 안 된 위생 갭. **트리아지 → done 마킹은 Irene 확인 후.**
- **진짜 미해결(자율 가능):**
  - **#94** (6/23) — q Task '이번주 나의 업무' 주간 진척 그래프 예측 42.3·실제 187.4 **고정**, 리스트 실제시간 변경해도 그래프 미반영. (과거 #35·#57~59·6/16 그래프 작업 있었으나 여전히 호소) → 다음 개발 1순위 버그
  - **#90** (6/22) — Cue 업무 생성 품질: 담당자 이름 언급해도 미배정·링크 누락·자기 업무로 오인식. (#81=실행 트리거는 했으나 인식 품질 별개) → Cue 프롬프트/파서 개선
  - **#89** (랜딩 푸터 로고 좌측정렬·카피 수정), **#91** (청구서 결제완료 처리 버튼) — 코드 대조 후 미처리면 처리

## ▶ 다음 할 일

### 1) #93-ⓑ 전수 확대 운영 배포 (다음 `/배포`)
- `cfaf5c3` 워크플로 전수 깜빡임 제거. 프론트 단독(DB 변경 0). 검증 통과 상태.
- **참고:** #93-ⓐ(팝아웃 재로그인)는 데스크탑 window.open 을 robust 하게 해결(이미 운영 라이브). iPhone PWA 에서 window.open 이 Safari(별도 쿠키 jar)로 탈출하는 케이스라면 opener 상속이 안 되므로(별도 컨텍스트) 인앱 드로어 방식 전환 필요 — Irene 이 어느 환경에서 봤는지 확인 시 추가 대응.

### 2) 운영 미해결 피드백 (자율 가능 — 위 '피드백 큐 확인' 상세)
- **#94 주간 진척 그래프 stale** (1순위 버그) → **#90 Cue 인식 품질** → #89/#91 코드 대조
- 운영 feedback_items 17건 done 위생 마킹은 Irene 확인 후 일괄

### 3) [검토 예정] 피드백/문의 자동 트리아지·응답 시스템 (Irene 요청 — 기획설계 필요)
- **요청:** 신규 피드백/문의 도착 시 ① 자동 분류 ② 자동 답변 ③ 코드로 고칠 수 있으면 자동 수정 ④ 기획설계 필요건은 "검토하겠습니다" 자동회신 + 다음할일 자동 적재.
- **사전 판단(검토 결과 초안):**
  - 자동 분류+자동 회신(질문→Q위키/Cue 지식 답변, 기획요청→"검토" 회신+백로그 적재) = **가능**. emailService + Cue + feedback_items.parent_id 인프라 재사용.
  - **자동 코드 수정+자동 배포 = 위험·권장 불가.** 무인 비즈니스 로직 수정은 검증스킬·CLAUDE.md 금지(LLM auto-fix는 selector/waitFor 한정). 안전형 = "AI가 수정안 diff+검증 생성 → Irene 승인 → /배포". 완전 무인 X.
  - 결론: **답변·트리아지 자동화는 구현 가치 큼 / 코드수정은 '제안까지 자동, 적용은 승인'.** → 정식 `/기능설계` 로 IA·안전가드·비용(LLM 호출) 설계 후 승인→구현.

### 4) 외부의존 (자율 불가)
- **#60** iOS 푸시 — Capacitor 네이티브앱 결정 (Irene)
- **#72/#88(ⓑ)** Google OAuth 검증 제출 — Google Cloud 콘솔 (Irene) + GCP redirect URI 등록

---

## 복구 가이드

새 Claude 세션 시작 시 아래 내용을 붙여넣으세요:

```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```
