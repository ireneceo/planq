## 현재 작업 상태
**마지막 업데이트:** 2026-08-30 14:43 UTC (2차 세션)
**작업 상태:** 배포 1회 완료 · 커밋 7건 · **미배포 2건** · 미커밋 0건

### 진행 중인 작업
- 없음 (Irene 자리 비움)

### 다음에 바로 할 것
1. **미배포 2건 배포** — `577d7ccf`(프로젝트 파일 post 소스) · `a21c2fa4`(본문 이미지 쓰기측+백필)
2. **배포 후 운영 백필 실행** (배포 스크립트 밖 수동)
   ```
   ssh irene@87.106.78.146 "cd /opt/planq/backend && node scripts/backfill-orphan-editor-images.js"        # 미리보기(9건 예상)
   ssh irene@87.106.78.146 "cd /opt/planq/backend && node scripts/backfill-orphan-editor-images.js --apply"
   ```
3. **#378 마지막 항목** — post 77 첨부 2건이 문서(L2)보다 좁은 L1. "청중 없는 L2"(프로젝트·대상멤버 둘 다
   NULL)가 PostsPage.tsx:1055 의 보정에서 의도적으로 빠져 있다. 정책 판단이 필요한 자리.
4. **#354 루틴 설계 모드** — #353 배관이 착지했으므로 이제 가능(Fable 이 "다음 사이클" 로 판정)
5. **#382 · #381 Q Sale** — 신규 시스템이라 Fable 설계 게이트 선행

---

## 이번 세션에 한 것

### 배포 1회 (commit `46babe01`, 14:43 기준 운영 반영 확인됨)
3점 검증 — 운영 헬스 200 · 청크 해시 dev=prod(`index-DwoSd-YS.js`) · PM2 3개 재기동.
배포 스크립트가 exit 1 을 냈지만 로그는 Deployment Complete 였고 위 3점으로 반영을 직접 확인(부수 신호).
**배포 후 수동 단계 2건 실행 완료:**
- 위키 시드 — `help_articles` 44 → **54건**, `upload-recording`·`text-size` 착지 확인
- 자기참조 시리즈 4건 정리 — 세 컬럼 NULL, 제목·상태 불변, 백업
  `/opt/planq/backups/self-ref-recurrence-20260830134440.json`, 재실행 0건(멱등). 회차 통계 61 → **57**

### 커밋 7건

| 커밋 | 내용 | 배포 |
|------|------|:---:|
| `25da0469` | 정기업무 — 지난 회차 자동 정리가 **생성 대상에만** 돌던 것(#349 반쪽) + 자기참조 정리 스크립트 | ✅ |
| `c9581578` | **#353 AI 업무추가 배관 4개** — RRULE 직접 수신 · 업무그룹 배치 · 장문 지침 · 의존 링크 | ✅ |
| `90cd854d` | **Cue 검색어가 팝아웃 창에 전달 안 되던 것**(Irene 신고) | ✅ |
| `cc5ee617` | 세션 상태 | ✅ |
| `46babe01` | 지침 절단 경고색 → COLOR_GUIDE Warning 600 | ✅ |
| `577d7ccf` | **프로젝트 > 파일에 문서 첨부가 아예 없던 것**(#378) | ❌ 미배포 |
| `a21c2fa4` | **본문 이미지가 파일 메뉴에 영영 안 잡히던 것**(#378) 쓰기측 봉쇄 + 백필 | ❌ 미배포 |

### 오늘 드러난 것 — "관문이 있는 줄 알았는데 옆문이 열려 있던" 계열

| 발견 | 정체 |
|------|------|
| #349 정리 루프 | 주석은 "정리는 독립된 일" 인데 **바깥 WHERE 가 남아** 생성 대상에만 돌았다. 월간 3주·연간 51주·종결 시리즈는 영영 |
| 자기참조 시리즈 4건 | cron 에서 영영 빠지는데 통계는 오염. **parent_id 만 풀면 캐치업 폭주**(next 가 과거) |
| RRULE 이중 FREQ | `FREQ=DAILY;FREQ=HOURLY` — 정규식은 앞을, 파서는 **뒤를** 채택. Fable 이 DB 착지까지 실증 |
| 생성·수정 API | AI 경로만 막고 있었다 — 일반 생성/수정은 `FREQ=HOURLY` 를 그냥 저장 (기존 부채) |
| Cue `cue:ask` | **window 이벤트라 창 하나 안에서만** 산다. Q helper 는 별도 창으로 띄워 쓰는 도구 |
| 프로젝트 파일 | post 소스 블록이 **통째로 없었다**. 프론트는 "문서" 폴더를 그리고 있었는데 늘 0건 |
| editor-image | business_id 없으면 **File 행 없이** 통과 → 본문엔 보이는데 파일 메뉴엔 없음(운영 9건) |
| 해시 함수 | routes/files.js 와 gdriveIngest.js 에 **각각 복사** → `utils/fileHash` 로 통합 |
| ProjectWorkstream | 컬럼이 `name` 이 아니라 **`title`**. 그대로였으면 AI 업무추가 전체가 500 |

### Fable 게이트 2회
- **설계** → #355 의 1~3단계는 이미 구현돼 있음을 운영 실증으로 확인. #349 반쪽 구멍 + 자기참조 4건 발견.
  백필 잔여(완료된 과거 회차 start_date 10건·reviewer 3건)와 auto_skip 일괄 전환은 **하지 않기로** 판정
- **구현 검증** → **조건부 PASS**. 조건(이중 FREQ 우회) 이행 + 권고 3건 반영

### 검증 수치 (전부 실행 결과)
정기업무 10/10 · 정리 스크립트 11/11 · #353 실HTTP 20/20 · 결정적 반증 19/19 · 우회 봉쇄 9/9 ·
무회귀 6/6 · advanced 보존 15/15 · Cue 실브라우저 7/7 · 프로젝트 파일 post 소스 14/14 ·
editor-image 쓰기측 12/12 · 백필 15/15 · 가드 28/28 · health 37/37 · e2e tenant 0 실패 · 빌드 exit 0/TS 0.
운영 옛 데이터 대조 — 반복 규칙 15종/업무 27건 **전부 새 관문 통과**(수정 시 400 회귀 없음).

### ⚠️ 내 판정기가 이번에도 거짓말했다 (전부 잡아 고침)
- **advanced 보존 검사가 PUT 404 인데도 "통과"** — 요청이 안 닿았는데 값이 안 변한 것을 보존으로 읽었다.
  양성 대조군(제목이 실제로 저장됐는가)을 넣어 잡음
- **백필 fixture 오염** — 앞선 실패 잔재 19건이 남아 "전부 중복" 으로 읽었다. 테스트에 선행 정리 추가
- **시각 비교를 밀리초로** — DB DATETIME 은 초 단위 절사. 멀쩡한 값이 틀렸다고 나왔다
- 업로드 상태코드를 200 으로 기대(실제 201), `e2e run.js` 를 dev-backend 에서 실행(cwd MODULE_NOT_FOUND)

### 신설 파일
- `dev-backend/scripts/fix-self-referencing-recurrence.js` (운영 적용 완료)
- `dev-backend/scripts/backfill-orphan-editor-images.js` (**운영 미적용**)
- `dev-backend/utils/fileHash.js` · `dev-frontend/src/utils/cueAsk.ts`

### 수정된 주요 파일
- `dev-backend/services/recurringTaskGenerator.js` · `rruleFromRecurrence.js` · `aiTaskPlanner.js` ·
  `services/actions/task_actions.js` · `routes/tasks.js` · `routes/projects.js` · `routes/posts.js` ·
  `routes/files.js` · `services/gdriveIngest.js`
- `dev-frontend/src/components/QTask/AiCandidateCard.tsx` · `components/Common/CueHelpDrawer.tsx` ·
  `GlobalSearchModal.tsx` · `HelpDot.tsx` · `components/Dashboard/TodoList.tsx` · `pages/QTask/QTaskPage.tsx`
- `public/locales/{ko,en}/qtask.json` (ai.* 5키 추가)

---

## 정직하게 적는 것

1. **#353 은 장부 미닫음** — priority(5번)를 Fable 이 범위에서 제외(컬럼 신설 필요 + priority_order 오염).
   부분 해결이라 `Feedback-Closes` 트레일러를 넣지 않았다.
2. **#378 도 미닫음** — 커밋에 `Feedback-Keeps-Open: 378`. 남은 것은 위 "다음에 바로 할 것" 3번.
3. **auto_skip 은 켜지 않았다** — 운영 20개 시리즈 전부 `carry`. 일괄 전환은 사용자 자산 임의 변경.
   즉 #349 수정은 지금 **운영 데이터를 0건 바꾼다** — "켜면 제대로 도는" 상태를 만든 것.
4. **#383 은 운영에서 동작 확인됐으나 장부는 pending** — 답글이 없어 자동 닫힘 대상이 아니다.
5. **editor-image dedup 은 에디터 이미지 폴더 안으로 제한** — 본문 URL 이 파일명을 직접 가리켜서.
6. ZIP 일괄 다운로드는 여전히 direct/chat/task 만 지원(기존 제약, post 미지원).

## 🔑 Irene 만 할 수 있는 것

| 항목 | 내용 |
|------|------|
| **배포** | 미배포 2건 + 배포 후 백필 실행 |
| **auto_skip 켜기** | 정기업무 상세 "지난 회차 자동 넘김". 프로젝트 10 평일 데일리 3건(#225·226·227)이 적합 후보 — 켜면 다음 자정에 밀린 5건(244·246·247·251·253) 자동 정리 |
| **#378 마지막 판단** | "청중 없는 L2" 문서의 첨부를 어디까지 넓힐지 |
| **아이폰 / Android / iOS 심사 / Google Drive** | 이전 세션 상태와 동일(변동 없음) |

> ⚠️ Apple Developer 계정은 **help@wor-pro.com** — 2단계 인증 6자리가 그 메일함으로만 온다.

---

## Git 상태 (2026-08-30 14:43 UTC)

- 미커밋 변경: **0건** (working tree clean)
- HEAD: `a21c2fa4`
- 운영 반영 지점: `46babe01`
- 미배포: `577d7ccf` · `a21c2fa4`

---

## 복구 가이드

```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```
