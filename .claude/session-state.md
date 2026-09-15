## 현재 작업 상태
**마지막 업데이트:** 2026-09-15 12:50 UTC
**작업 상태:** 완료 (운영 배포 3회 · `/개발완료` 처리)

### 진행 중인 작업
- 없음

### 완료된 작업 (이번 세션)

**1. 메일 검색 고도화** (배포 `73cfbead` 07:40)
- 토큰 서브쿼리의 **무정렬 `LIMIT 1000`** 이 오류·경고 없이 결과를 잘라내고 있었다 →
  상관 서브쿼리 `EXISTS` 로 교체(상한 자체가 없어진다).
  dev 실측: `'here'` 매칭 스레드 1,368건 중 **368건(27%) 탈락**.
- 검색 대상 확대 — `participants` JSON(목록이 **보여주는** 발신자 이름의 원천) · `to_emails`/`cc_emails` · 첨부 `filename`.
- 검색이 **폴더를 넘는다**(스팸 제외) + 결과 행에 폴더 칩. 카나리 `mailsearch` 6/6.

**2. 알림 배지 — "12인데 10"** (배포 `73cfbead`)
- 숫자는 처음부터 맞았다. 운영 실측 `total 10 = email 4 + task 3 + sale 3`, 업무 배지 합도 10.
  남는 2는 Q Talk 안읽음이 **같은 Coral** 이라 눈으로 합산된 것.
- `mailReplyCount` 가 같은 술어를 **두 번째 쿼리**로 세고 있었고 그쪽엔 `COLLECT_LIMIT` 가 없어
  답변필요 메일 120건 초과 시 **배지 > total** 로 갈라졌다 → `all.filter(type==='email')` 한 공식.
- 거짓 주석 2곳 정정(`dashboard.js` · CLAUDE.md §2) — 진짜 예외는 Q mail 이 아니라 Q Talk 였다.
- 카나리 `inboxcount` 에 **합 계약** 추가(양성 대조군 2회 검증).
- ★ **색 변경은 전부 원복**(`93751485`). 요청은 숫자였는데 안읽음 배지를 회색→민트로 두 번 바꿨고,
  회색 버전이 55분간 운영에 떠 있었다. memory `feedback_fix_the_number_not_the_look`.

**3. 채팅을 확인 필요 안으로** (배포 `b189a072` 09:13)
- `collectChats` — **방 1개 = 항목 1개**. 채팅 목록과 같은 술어(`conversationListWhere` + `clientVisibleSql`),
  참여자 INNER JOIN, `GROUP BY conversation_id`.
- 확인 필요에 **채팅 탭**(영업 다음) + 전체 탭 카테고리 등록.
- 사이드바 Q Talk 배지 = **방 수**. 채팅 리스트의 방별 숫자는 **메시지 수 그대로**(Irene 확인).
- OS 앱 아이콘 이중 계수 제거(다른 워크스페이스 몫만 더한다). 실시간 `message:new` + `planq:unread-changed`.
- **이로써 예외가 0** — 좌측 메뉴 배지의 합 == 확인 필요.

**4. 프로젝트 탭 · 뒤로가기 · 우클릭 메뉴** (배포 `404e904c` 12:35)
- `projectTabBleed` — 슬롯 여백(좌우 20 · **하단 88**) 상쇄, 12탭 공용. 실측 좌 220·우 1440 한 값,
  하단 죽은 띠 **108 → 20**.
- **껍데기를 안 쓰던 탭 3개**(고객·상세정보·설정)를 `ProjectTabPane` 상속으로.
- 공용 `ToolbarRight` — 문서·파일·정보가 `[검색][필터] … [버튼]`. 높이 **{36}**, `+ 새 문서`.
  `AiActionButton` 에 `size="filter"`(36) 변형 추가(sm 32 머리줄 · md 40 폼은 불변).
- `DocsTab` 의 `Toolbar`·`SortWrap` **로컬 복사본 삭제** — 공용을 고쳐도 파일 탭만 옛 모양이었다.
- 파일 탭 안쪽 여백을 문서 탭과 **같은 깊이·같은 값**(`Inner` 20 / ≤900px 16)으로.
- 뒤로가기: 히스토리 push + **URL 따라가기 useEffect**. `validTabs` 에 `details`·`settings` 누락도 수정.
- **우클릭 메뉴** `components/Common/AppContextMenu.tsx`(App 루트) — 링크: 새 탭에서 열기·링크 복사 /
  탭: 복제·복사·닫기·다른 탭 모두 닫기 / 공통: 뒤로·앞으로. **입력칸·글자 선택은 가로채지 않는다.**
- **같은 화면 두 개 열기** — 우클릭 항목이 `tabStore.newTab()`(중복 허용)을 직접 부른다.

**5. 문서**
- `DEVELOPMENT_PLAN.md` 최종 업데이트 + 완료 섹션.
- Q위키 아티클 2건 추가 — `inbox-chat`(확인 필요에 채팅) · `right-click-menu`(우클릭·탭 복제).
  `node seed-wiki-content.js` 반영 · 커버리지 게이트 통과(⛔ 0). **운영 반영은 다음 배포 때
  `ssh …prod "cd /opt/planq/backend && node seed-wiki-content.js"` 필요.**

### 다음 할 일
1. **프로젝트 > 노트 탭 리스트를 문서 탭과 같은 모양으로** — Irene 지시, **아직 시작 전**.
   지금은 `QNotePage`(5,048줄) 본체를 그대로 얹어 프로젝트 안에서도 Q Note 레이아웃이 나온다.
   문서 탭은 `<PostsPage scope={{type:'project'}} />` 로 `assetTabLayout`(툴바 + [분류 트리 | 카드 그리드])
   을 쓴다 — 노트도 embedded 일 때 같은 껍데기로.
2. **우클릭 메뉴가 비켜나야 할 자리 전수 확인** — 파일 드롭존 · TipTap 편집기 · 표 셀.
   지금은 "입력칸 · 글자 선택" 두 조건으로만 비켜난다.
3. **릴리즈노트** — 오늘 사용자 눈에 보이는 변경이 여럿인데 노트는 어제 것(v1.52.8)이 재발행됐다.
   버전을 올릴지 Irene 확인 필요.
4. 큐 #48 열린 항목 — 메일 배지가 `COLLECT_LIMIT` 120 을 물려받아 그 이상은 덜 센다.
5. 고객(Client) 화면 확인 필요에도 채팅이 뜬다 — 맞는지 Irene 확인.

### 주요 변경사항
- **Fable 게이트: 429 로 이 세션 내내 미가용(15~18차).** 배포 3건 전부 **자체 검증**이며
  `docs/FABLE_GATE_QUEUE.md` #48~#52 에 판정·수치·*Fable 이 봐야 할 것* 을 남겼다(`by:"unavailable"`).
- **카나리가 내가 만든 회귀 2건을 잡았다** — 상세정보·설정 탭이 열리지 않게 된 것,
  파일 탭만 시작점이 20px 어긋난 것.
- **양성 대조군 2회 중 1회는 안 뒤집혔다** — `replace` 변경은 "이 검사로는 증명 못 함" 으로 기록.
  실제로 뒤로가기를 고친 것은 URL 따라가기 쪽이고 그건 뒤집혔다(유효).
- 신설 카나리: `mailsearch` · `docsheader` · `headerdrift` · (기존) `inboxcount` 합 계약.

### Git 상태
- 브랜치 `main`
- 운영 배포 3회: `73cfbead`(07:40) · `b189a072`(09:13) · `404e904c`(12:35)
- 백업: `/opt/planq/backups/20260915_123503`(운영) · dev 일일 백업은 `/개발완료` 7단계

---

## 복구 가이드

새 Claude 세션 시작 시 아래 내용을 붙여넣으세요:

```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```
