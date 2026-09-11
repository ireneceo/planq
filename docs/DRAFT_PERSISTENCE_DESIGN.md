# 입력 임시저장 — 설계 v5

> Irene 2026-09-11: *"업무상세에서 수정요청에 내용 남기거나 댓글에 내용 남기거나 하다가 나가면 다 날라가는데 **모든 입력란은 임시저장** 되어 있게 못해?"*
> 같은 날: *"고치는 걸 왜 자꾸 단편적으로 해? 구조 자체를 … 제대로 적용해서 수정해야지"*

**상태: v5 — 설계 게이트 v1 FAIL(T1) · v2 FAIL(C1) · v3 FAIL(C1′) · v4 FAIL(치명 C1 포커스 판정 · 중요 I-1~I-4 · 경미 m-1~m-9) 반영 · 미구현.**
> 5회차 설계 게이트는 돌리지 않는다 — 치명이 회차마다 좁아졌고(유실 경로 → 비교 필드 → 포커스 판정), 남은 위험은 전부 **양성 대조군이 달린 카나리로 기계 판정 가능(F=1)** 하다. 라운드 1A 구현 게이트(R=1 → Fable)가 v5 규칙과 ⑩ 카나리를 함께 판정한다.
R=1(사용자 글 유실 비가역 · 교차 노출) · S=1. **라운드 1A(초안 장치) → 1B(자동저장 나갈 때 저장) 두 게이트. 1B 는 1A 위에 선다(순서 고정)** — 1B 의 edit 폴백·로그아웃 ③④ 가 1A 의 `draftKinds`·`draftsSuppressed` 를 쓴다.

> **v4 에서 바뀐 것(한눈에)** — ① 비교 필드를 `savedAt`(쓴 시각)이 아니라 저장본에 박은 **`editedAt`(편집 시각)** 으로 · 같은 편집은 다시 쓰지 않음(C1′) ② 빈 값은 삭제 대신 **툼스톤**, 제출만 `cleared` 레코드(I-3) ③ 포커스 중 무시한 쓰기는 **blur 때 반영** — 닫는 순간 화면 == 저장본(I-4) ④ 사칭 창은 정체 확정 청소·센티널을 **건너뜀**(I-1) ⑤ `draftsSuppressed` 양방향(I-5) ⑥ AutoSaveField key 규칙 대상에 `useAuth` 파생 식별자 포함 + `switchWorkspace` 도 flush 프로토콜(I-2) ⑦ 1B→1A 의존 명시(I-6) ⑧ 경미 9건 · 카나리 12건 추가.

---

## 0. 감사로 확인한 사실 (dev-frontend/src, 2026-09-11 · Fable 실측 교정 반영)

| 분류 | 개수 | 판정 술어 / 내용 |
|---|---:|---|
| 자유 텍스트 입력 정의 | `styled.textarea` 59 정의/50파일 · 대소문자 구분 리터럴 `<textarea` **1** · `<RichEditor` 11 | `grep -rE "styled\.textarea"` · `grep -rE "<textarea"`(대소문자 구분) · `grep -r "<RichEditor"` (옛 "29" 는 `-i` 셈이라 styled 사용처와 중복) |
| 손으로 쓴 초안 키 `planq:draft:` | 4곳 · 전부 bizId 없음 | `TaskDetailDrawer.tsx:319 task-comment` · `MailContextPanel.tsx:449 mail-issue` · `:470 mail-note`(둘 다 uid 가 `myUserId || 0`) · `QTalk/RightPanel.tsx:438 qtalk-note` |
| `useLocalDraft` 키 | 1 | `MailPage.tsx:1680 qmail-fwd-{userId}-{msgId}` — value-effect cleanup(`useLocalDraft.ts:66-71`)이 타이머만 지워 ✕ 닫기에 마지막 800ms 유실 |
| 직접 구현 | 2 | `StartMeetingModal.tsx:176 qnote_meeting_draft_v1`(TTL 24h 의도) · `GuestChatPanel.tsx:43 guest:name:{토큰 원문}` |
| `AutoSaveField` | 125 사용 · 24 파일 | |
| 민감 입력 | 21 | 비밀번호(리터럴·삼항)·IMAP/SMTP·S3·Stripe·계좌 |

**keep-alive(치명의 전제):** `TabPane.tsx:50-52` 비활성 탭 `display:none` 마운트 유지. **탭 전환은 `visibilitychange`·`focus` 를 내지 않고**, `storage` 이벤트는 **자기 문서에 오지 않는다.** `TaskDetailDrawer` 마운트 5곳(QTaskPage·TodoPage·TasksTab·QCalendarPage·TaskPopoutView) + 팝아웃 창·PiP(별도 문서).

**업무 상세 자유 텍스트** — 댓글 `commentDraft` 319(`CommentInput` 3060) · 댓글 수정 `editingCommentDraft` 345(`CommentEditArea` 3041) · 수정요청 `revisionNote` 380 · 승인 `approveNote` 389 · 확인요청 `submitNote` 393(셋 다 `RevisionInput` 3008) · 보류 사유 `holdReason` 383(`HoldReasonInput` 2797 styled.input — `maxLength` 는 **사용처**에) · 보류 사유 사후 편집 `holdReasonDraft` 384(AutoSaveField 1523 안, 서버 자동저장 — 로컬 초안 대상 아님). 드로어의 워크스페이스는 props `bizId`(162).

**조용한 유실** — `AutoSaveField.tsx:113` cleanup = `clearTimers()` 만 · 메일 초안 effect cleanup(1382·1775) `clearTimeout` 만, `closeCompose` 1843, `sendCompose` 함수 1866 안 1896 `DELETE email-drafts` 후 `closeCompose()`, 답장 1538 DELETE 후 전환 · `MemoView.tsx:225-229`(QNotePage 2684 `key={s-${id}}` 로 세션 전환 시 언마운트) · `MemoPopup` handleClose(591-598) 밖 언마운트 · 업무 설명·결과물 `debouncedSave`(697-705) 는 드로어 닫기엔 저장되나 **새로고침·탭 닫기**엔 ≤2초 유실 · `useDraftText.flush`(`useLocalDraft.ts:127-130`) dirty 판정 없음, 빈 값이면 `removeItem`(104).

**로그아웃 실제 순서** — `AuthContext.tsx:837-846`: `await fetch(logout)` → `setAccessToken(null)`(동기) → `clearPageCache()` → `goLogin()`. **토큰이 먼저 사라지고** 그 뒤 언마운트가 온다.
**정체가 정해지는 경로** — `login()` · `register()`(824) · OAuth(`OAuthCallbackPage.tsx:29` 가 hash 토큰 후 `location.replace` → 부팅 `checkSession` 691·711·718) · 사칭 종료(`ImpersonateBanner.tsx:47` 토큰 교체 후 이동).
**사칭** — `impersonator` 는 **JWT 클레임**이고 `useAuth().user` 에 없다(`ImpersonateBanner.tsx:33` 이 토큰을 디코드해 읽음, `sessionStorage.impersonate_pending`).
**워크스페이스 전환** — `AuthContext.switchWorkspace` 는 **먼저 `setUser(새 business_id)` 로 다시 렌더**(910)하고, 호출부가 그 뒤 `window.location.href = '/talk'`(`WorkspaceSwitcher.tsx:124·136·156`)로 이동한다. 이동 전 그 짧은 창에 대기 중인 AutoSaveField 타이머가 **새 렌더의 `saveRef`(새 bizId URL)로 발사될 여지가 있다** → D-C3 `key` 규칙이 bizId 를 대상에 포함하는 것은 필요하다(키가 바뀌면 언마운트 flush 가 옛 bizId 로 먼저 저장). 원격 전환(`WorkspaceSyncGuard rebootForWorkspace`)은 setUser 없이 바로 재부팅.
**같은 브라우저 멀티 계정** — access 토큰은 메모리, refresh 는 공유 쿠키라 두 사용자가 동시에 로그인돼 있을 수 없다. 예외: ⓐ 사칭 창 ⓑ 앞 사용자 탭이 ≤15분 옛 토큰으로 살아 있음.

---

## 1. 계약

### D-C1. 초안 장치 — `useDraftText` 정본 + 동기화 규칙 + 키 등록제

**(a) 동기화 규칙 (치명 T1·C1)**
- `writeDraftText(key, value)` 는 저장 뒤 **같은 문서에** `window.dispatchEvent(new CustomEvent('planq:draft-written', { detail: { key, savedAt } }))` 를 낸다. 인스턴스는 `storage`(다른 창)와 이 이벤트(같은 창) **둘 다** 듣는다.
- **저장본 형식 `{ v:2, value, editedAt, cleared? }`** — `editedAt` 은 **마지막 `setText` 시각**이다. flush 는 `Date.now()` 가 아니라 인스턴스의 `lastEditAtRef` 를 박는다(C1′: 쓴 시각과 편집 시각을 섞으면 더 새 글이 거부된다).
- 인스턴스 상태: `dirtyRef`(마지막 read 이후 `setText` 가 불렸나) · `lastEditAtRef` · `writtenEditAtRef`(마지막으로 **쓴** 편집 시각) · `composingRef`(IME 조합 중).
  - **dirty 는 read(마운트·키 전환·재읽기)와 `clear()` 에서만 내려간다.**
  - **편집 시각은 단조 증가** — `setText` 는 `lastEditAt = Math.max(Date.now(), lastEditAt + 1)`, read 는 `lastEditAt = stored.editedAt ?? 0`(v4 I-1: 같은 ms 겹침·시계 역행에 마지막 입력이 영영 안 쓰이는 것 차단). 저장본이 없으면 flush 조건 ⓒ 는 참.
- **정본 = 편집 시각이 큰 쪽.**
  - flush(키 전환·언마운트·pagehide·visibility hidden·debounce)는 ⓐ dirty ⓑ `writtenEditAtRef !== lastEditAtRef`(같은 편집을 다시 쓰지 않는다) ⓒ **저장본 `editedAt < lastEditAt`**(같은 시각도 양보) 셋 다일 때만 쓴다.
  - **빈 값은 `removeItem` 이 아니라 툼스톤 `{ value:'', editedAt }`** 으로 쓴다 — 일반 비교 규칙이 그대로 적용된다(I-3: 남이 자기 글을 지운 순간 내 글이 비워지면 안 된다). 툼스톤은 TTL 청소가 지운다.
  - 이벤트 수신(같은 창 CustomEvent · 다른 창 `storage`): 저장본 `editedAt > lastEditAt` 이면 **포커스와 무관하게 즉시 재읽기** + `common:draft.replaced` 한 줄("다른 창의 더 새 글로 바뀌었어요"). 내 편집이 전부 그보다 옛 것이므로 정본 규칙과 같다.
    · ★ v4 C1: `document.activeElement` 로 보류하면 팝아웃·PiP(별도 문서)에서 창이 포커스를 잃어도 `activeElement` 는 그대로라 보류가 풀리지 않고, 사용자가 돌아와 한 글자 치는 순간 **다른 창에서 쓴 더 새 글을 옛 글로 덮는다.** 포커스로 판정하지 않는다.
    · 보류는 **IME 조합 중(`compositionstart`~`compositionend`)에만** — `compositionend` 에서 즉시 재비교(한글 조합 중 값이 바뀌면 입력이 깨진다).
  - flush 시점에 **입력란 `blur` · `window blur`** 도 넣는다(다른 창으로 옮기기 전에 내 편집을 먼저 쓴다). **불변식: 닫는 순간 화면 == 저장본.**
  - `storage` 의 `newValue: null`(로그아웃 삭제·TTL 청소)은 재읽기 대상이 아니다. 단 **내 키가 null 로 오면 `writtenEditAtRef = null`**(화면은 그대로 — 다음 flush 가 다시 쓸 수 있게, v4 m-1).
- **`clear()`**(제출 성공)는 `{ cleared: true, editedAt: now }` 를 쓰고 이벤트를 낸 뒤 키를 지운다 — 받은 인스턴스는 **`cleared` 레코드에만** dirty 무시 비우기를 한다(제출은 명시 동작). 판정은 `storage.newValue` / CustomEvent `detail.record` 로 한다(**재읽기 금지** — 이미 지워져 있다, v4 m-2).
- 툼스톤(`value:''`)에는 복원 줄을 띄우지 않는다 · edit 모드 레코드도 `v:2`·`editedAt` 형식으로 통일(v4 m-9).
- 비교 동등성: RichEditor 값은 양쪽 `trim` + 빈 `<p></p>` 정규화 뒤 비교(m-6).
- 수용 한계: 두 곳에서 동시에 편집하면 **마지막 편집이 이긴다** · 두 문서의 검사-후-쓰기 사이에 뮤텍스가 없어 ±수 ms 동시 쓰기는 마지막으로 쓴 쪽(m-8).

**(b) 키 — `useDraftKey(kind, entityId, bizId?)` 한 함수 + `hooks/draftKinds.ts` 등록제**
- 키 `planq:draft:{kind}:{userId}:{bizId}:{entityId}`. `bizId` 는 **엔티티의 business_id 가 있으면 그것**(드로어 props `bizId`), 없을 때만 `user.business_id`.
- null(=보존 안 함): userId·bizId 중 하나라도 없음 · **사칭 중** — `AuthContext` 가 `isImpersonating`(액세스 토큰 `impersonator` 클레임 디코드 또는 `sessionStorage.impersonate_pending`)을 노출하고 그것이 정본 · `draftsSuppressed`(D-C5).
  - 키가 null 로 **바뀌어도 화면 state 는 유지**하고 저장만 멈춘다(현 `useDraftText` 137-139 는 '' 로 리셋 — 그러면 suppressed 순간 입력이 사라진다, v4 m-4).
  - ★ 사실 교정(v4 m-6): 현재 사칭 탭(`AdminUsersPage.tsx:63 window.open(…_impersonate=1, 'noopener')`)을 **부팅에서 읽어 대상으로 전환하는 코드가 src 에 없다** — 새 탭은 refresh 쿠키로 **관리자 본인**으로 부팅한다. 사칭 가드는 지금은 idle 이며 사칭 토큰 경로(`_impersonateSetAccessToken`)를 위한 방어다.
- `draftKinds.ts`: `{ kind: { ttlMs, mode: 'append'|'edit', owners: [파일] } }` — 등록 외 kind 는 가드 FAIL. TTL kind 별(기본 7일, `qnote-meeting-start` 24h).
- `useLocalDraft` 도 `useDraftKey` 로 키를 받고 **같은 동기화 규칙 + `enabled` true→false 전환·언마운트 시 flush**(I6).

**(c) 옛 키 이관** — 새 키가 비었을 때 한 번 읽어 옮기고 지운다
| 옛 키 | 새 kind | 비고 |
|---|---|---|
| `planq:draft:task-comment:{uid}:{taskId}` | `task-comment` | |
| `planq:draft:mail-issue:{uid}:…` | `mail-issue` | **uid `0` 이면 이관 없이 삭제** |
| `planq:draft:mail-note:{uid}:…` | `mail-note` | uid `0` 이면 삭제 |
| `planq:draft:qtalk-note:…` | `qtalk-note` | |
| `qmail-fwd-{uid}-{msgId}` | `mail-forward` | |
| `qnote_meeting_draft_v1` | — | 사용자 축 없음 → 이관 없이 삭제 |

**(d) 수정형(`mode:'edit'`)** — `{ value, base, savedAt }`. 열 때: 서버값 == `value` → 조용히 삭제 / 서버값 == `base` → 복원 줄 / 그 외 → 버리고 `common:draft.baseChanged`. 댓글 수정 · 업무 설명·결과물 새로고침 폴백(D-C3) 이 해당.

### D-C2. 자유 텍스트 입력은 공용 껍데기로
- `components/Common/DraftTextarea.tsx` · `DraftInput`(긴 사유 input) — `draftKind`·`entityId`·`bizId`. RichEditor 자유 텍스트는 훅 직접이되 `useDraftKey` 경유.
- 복원은 보이게: `common:draft.restored` "임시저장된 내용을 불러왔어요 · 지우기" / "Restored your unsent text · Clear". **복원만으로 서버 저장을 부르지 않는다.**
- 첨부: 텍스트만 + 이미 서버 파일인 id 만(`attachments: number[]`) — 제출 전 존재 재확인.
- 수용 한계: 다른 기기에서 제출한 뒤 이 기기에 초안이 남는다(복원 줄로 사람이 판단).

### D-C3. 자동저장이 있는 곳도 **나갈 때 확정 저장** (라운드 1B)
- **AutoSaveField**
  - `pendingRef`(입력 후 저장 전) 기준. 언마운트 cleanup 에서 pending 이면 즉시 `saveRef.current()`. 실패는 `console.warn`(로컬 폴백은 라운드 2 검토).
  - **inflight 중에는 새 발사를 완료 뒤로 미룬다**(동시 2 PUT 금지 — 옛 값이 나중에 착지할 수 있다). 완료 뒤 pending 이면 한 번 더.
  - **`key` 규칙(기계 판정)**: `<AutoSaveField` 가 있는 파일에서 `method: 'PUT'|'PATCH'` 호출 URL 템플릿의 `${…}` 안 식별자 중 **모듈 상수·import 가 아닌 전부**(`useState`·props·`useParams`·**`useAuth()` 파생** — 예 `const businessId = user?.business_id` 포함)를 집합 S 로 뽑는다. S 가 비어 있지 않으면 그 파일의 **모든** `<AutoSaveField` 는 `key={…}` 안에 S 원소 이름을 포함해야 한다. 예외는 `// autosave-key-exempt: <이유>` 한 줄. 양성 대조군: `TaskDetailDrawer.tsx:1523` key 제거 → FAIL · `ProfilePage.tsx` key 제거 → FAIL(I-2).
  - pending 중에는 `body[data-form-dirty]` 계약을 세운다 — `BuildVersionGuard`·`WorkspaceSyncGuard` 원격 재부팅이 pending 을 날리지 않게(m-7). 원격 재부팅(`apply`)도 아래 flush 프로토콜을 거친다.
- **flush 프로토콜 `planq:drafts:flush`** — `window.dispatchEvent(new CustomEvent('planq:drafts:flush', { detail: { waitUntil(p) } }))`. **pending 이 있는 인스턴스만** `waitUntil(saveRef.current())` 로 등록한다(리스너는 마운트분만, 순서 무관 — m-9). 부르는 쪽은 `Promise.allSettled` 를 **상한 3초**로 기다린다. 부르는 곳: 로그아웃 ① · **`switchWorkspace` POST 전**(I-2) · 원격 재부팅 `apply` 전.
  - **시리즈 공유 필드**(`TASK_SERIES_FIELDS` — 설명 등)는 `saveFields`(629-641)가 저장 대신 **범위 다이얼로그**를 띄운다 → flush 프로토콜에서도 `isSeries && needsSeriesScope` 면 PUT 생략 + `mode:'edit'` 로컬 초안(v4 I-2).
  - **AutoSaveField 는 `pagehide` 에서도** pending 이면 `saveRef.current()` 를 부른다(`location.href` 이동·새로고침·탭 닫기엔 언마운트 cleanup 이 오지 않는다 — 완주 보장은 없으나 시도, v4 I-3).
  - 언마운트 시 inflight 면 즉시 발사하지 않는다 — **완료 콜백이 `mountedRef` 와 무관하게 pending 을 한 번 더 발사**(동시 2 PUT 금지와 양립, v4 m-8).
- **메일** — `closeCompose(reason)`: `'user'`(✕·취소)만 `dirtyRef` 기준 PUT 선발사, `'sent'`·`'discard'` 는 발사 없이 비운다. 답장 스레드 전환도 같은 규칙.
- **Q Note** — `MemoView` 언마운트 dirty 면 persist · `MemoPopup` handleClose 밖 언마운트 dirty 면 persist.
- **업무 설명·결과물 새로고침** — `pagehide` 에서
  ① **raw `fetch(url, { method:'PATCH'|'PUT', keepalive:true, headers:{ Authorization:`Bearer ${getAccessToken()}`, 'X-Workspace-Id': getRequestWorkspaceId(), 'Content-Type':'application/json' }, body })`**(apiFetch 는 `tryRefresh` 를 먼저 await 할 수 있어 문서가 죽기 전에 디스패치가 안 된다 · 엔티티 id 라우트라 409 는 안 나지만 헤더는 싣는다(관찰 카운터) · 401 재시도 불가)
  ② **동시에** `mode:'edit'` 로컬 초안 `task-description`/`task-body` `{ value, base: 마지막 서버값, savedAt }` 을 남긴다(본문 크기 무관)
  ③ 본문 60KB 초과면 ①을 생략하고 ②만(Chrome keepalive 64KB 상한). 다음 열기 때 D-C1d 판정.
- **반복 업무(시리즈)** — `saveFields`(629)가 `isSeries && needsSeriesScope` 면 범위를 먼저 묻는다. pagehide raw PUT 은 이 물음을 우회하므로 **시리즈 업무는 ① 생략, ② 로컬 edit 초안만**(m-5). raw keepalive 에 `X-Workspace-Id: getRequestWorkspaceId()` 도 싣는다(`observe()` 카운터 오염 방지 — m-4).
- **로그아웃 순서(I2)** — `logout()` 은 모듈 `logoutInFlight` Promise 를 재사용한다(이중 클릭 시 ①~⑤ 한 번 — 버튼은 `disabled` + `common:auth.loggingOut` "로그아웃 중…" / "Signing out…"). `AccountDeletionSection` 은 `logout({ flush: false })`(삭제된 계정으로 PUT 하지 않는다 — m-2):
  ① flush 프로토콜 → AutoSaveField pending·`debouncedSave`·메일 dirty 가 **토큰이 살아 있는 동안** 저장 → `allSettled`(상한 3초, 초과해도 진행)
  ② 서버 logout POST
  ③ 모듈 플래그 `draftsSuppressed = true`(이후 로컬 flush·`useDraftKey` 모두 no-op/null)
  ④ 그 사용자 로컬 초안 키 삭제
  ⑤ 토큰 null · `goLogin()`

### D-C4. 민감 입력 — 등록제 + 기계 판정
① 등록 외 kind → FAIL
② `type=` 속성값에 `'password'` 문자열이 들어간 파일(리터럴·삼항) 또는 `sensitiveFiles` 목록 파일에서 `useDraftKey`/`DraftTextarea`/`DraftInput` → FAIL (`// draft-sensitive-reviewed: <이유>` 로만 해제)
③ 양성 대조군: LoginPage 에 `useDraftKey` 한 줄 → FAIL

### D-C5. 정리 (라운드 1A)
- **정체 확정 한 곳**: `AuthProvider` 의 `useEffect([user?.id])` — `draftsSuppressed = false` 로 시작하고, `prevId !== user.id` 이면 `planq:draft:*` 중 userId ≠ 현재 사용자 키 삭제 + `planq:draft:owner` 센티널을 현재 userId 로 갱신. (부팅 복원·login·register·OAuth·사칭 종료가 모두 지나간다)
  - **`isImpersonating` 이면 청소도 센티널 갱신도 건너뛴다**(I-1: 사칭은 `AdminUsersPage.tsx:63 window.open(…_impersonate=1)` 별도 문서 부팅이라, 안 건너뛰면 관리자 본인 초안을 지우고 관리자 탭을 정지시킨다).
  - `user → null`(로그아웃·세션 만료)이면 아무것도 하지 않는다(로그아웃 ④ 가 처리 · m-3).
- 다른 탭은 `storage` 로 센티널을 받아 **`draftsSuppressed = (String(owner) !== String(myUserId))` — 양방향·문자열 비교**(I-5: 같은 사람이 재로그인하면 풀린다 · `user.id` 는 `String(apiUser.id)` 라 한쪽만 `Number()` 로 바꾸면 모든 탭이 영구 정지 — v4 m-3). 자기 창이 `isImpersonating` 이면 센티널을 무시한다. 로그아웃 ③ 만 일방 true(직후 goLogin), 로그아웃 ④ 는 센티널을 `''` 로 갱신(같은 사용자의 옛 탭·팝아웃도 멈춘다 — 재로그인 시 풀림, v4 m-5).
- 이관(D-C1c)은 **옛 키의 uid == 현재 userId 일 때만** 읽는다(v4 m-9).
- `planq:draft:owner` 는 청소·TTL 대상에서 **제외**(m-3). ⓑ 옛 토큰 탭이 청소 전에 앞 사용자 키에 쓰는 것은 누수가 아니다(허용).
- 로그아웃: D-C3 순서 ④. 세션 만료 자체는 지우지 않는다(같은 사람이 재로그인).
- 부팅 1회: kind 별 TTL 지난 키 삭제. quota: 만료 청소 1회 후 재시도 → 실패면 조용히 포기(입력은 막지 않는다).

### D-C6. 가드 · 카나리
**가드 `--category=draft`**
- 술어: `styled.textarea`·`styled(X).attrs({as:'textarea'})` 정의를 컴포넌트명으로 해석해 JSX 사용처를 센다 · `styled.input` 정의는 **JSX 사용처의** `maxLength≥200` 또는 `rows` 로 판정 · `contentEditable` · 리터럴 `<textarea`·`<RichEditor`. 초안 표식(`DraftTextarea`/`DraftInput`/`useDraftKey`/`// draft-exempt: <이유>`)이 없으면 부채. **`<AutoSaveField>` 의 자식은 통과**(서버 자동저장).
- 손으로 쓴 `planq:draft:` 문자열 부채 · 등록 외 kind FAIL · D-C4 ②
- **커버리지 출력**(정의 n · 사용 m · 표식 k) — 라운드 1A 대상 6개(업무 상세)가 셈에 잡히는지 출력으로 확인
- 양성 대조군: 표식 없는 `RevisionInput` 사용 1곳 추가 → 래칫 FAIL · D-C4 ③ · D-C3 key 규칙(1523 key 제거 → FAIL)

**카나리 `--suite drafts`(신설) + `--suite toggles`(기존)** — 실브라우저, 폰·데스크탑
- ① 업무 상세 6입력 입력 → 닫기 → 다시 열기 → 보이는지(좌표·elementFromPoint) + 복원 줄 · 복원만으로 3초 내 PUT 0건
- ② 제출 성공 후 비어 있음 · 제출 실패(4xx)면 남음
- ③ 다른 업무 섞임 0 · 다른 사용자/워크스페이스 안 보임 · 같은 사용자·워크스페이스로 돌아오면 보임(양성)
- ④ **(a) 같은 창 keep-alive 두 탭 (b) 메인+팝아웃 — 둘 다**: 한쪽만 입력 → 다른 쪽 전환·닫기 → 초안 남음 · **양성 대조군: 동기화 규칙을 끈 빌드에서 ④ FAIL**
- ④-충돌: 두 인스턴스 모두 입력 → 나중 편집이 남음 · 포커스 중 입력란은 남의 쓰기로 안 바뀜 · 한쪽 제출 → 다른 쪽 비워짐
- ⑤ (1B) AutoSaveField 입력 0.5초 뒤 닫기 → PUT 1 · 본문 == 마지막 입력 · 대상 전환 직후 옛 entity 1 / 새 entity 0 · 느린 첫 PUT 중 재입력 → 2번째 PUT 은 첫 응답 뒤, 서버 최종값 == 마지막 입력 · 로그아웃 직전 pending → PUT 200 1건
- ⑥ (1B) 메일 ✕ → 서버 초안 반영 · **입력 1초 안 보내기 → 서버 초안 0** · 전달 폼 입력 0.3초 뒤 ✕ → 다시 열기 복원 · Q Note 메모 입력 직후 세션 전환 → 반영 · 업무 설명 입력 직후 새로고침 → 반영 · 설명 >64KB 입력 직후 새로고침 → 로컬 edit 초안 복원 줄
- ⑦ 로그아웃 → 그 사용자 키 0(`useLocalDraft` 포함) · login·register·OAuth 경로로 다른 사람 로그인 → 앞 사람 키 0 · 사칭 창 입력 → `planq:draft:*` 0 · 민감 입력 페이지 입력 → **모든** localStorage/sessionStorage 값에 입력 문자열 부재
- ⑧ 댓글 수정 초안 — 원문이 다른 세션에서 바뀜 → 복원 안 함 + baseChanged 줄
- ⑨ 이관: 옛 키 심기 → 열기 → 새 키에 값·옛 키 삭제 · uid `0` 옛 키는 삭제만 · 부팅 TTL: 만료 삭제·미만료 유지 · quota: 저장소 채운 뒤 입력 → 예외 없음
- ⑩ (v3 게이트 추가) — 각 항목 옆 괄호는 끄면 FAIL 이 나야 하는 **양성 대조군**
  1. A 편집 → B 편집(+5s) → A 창 닫기(+0.2s) → 저장본 == B 글 (`savedAt` 비교 빌드 FAIL — C1′)
  2. B 가 글 전부 삭제(tB) → 비포커스 A 는 **''** 로 바뀜 / A 가 tB 뒤 추가 입력하면 닫은 뒤 저장본 == A 글 (`removeItem` 빌드에서는 A **화면 ≠ 저장본** — 화면엔 글, 저장본 없음 — 으로 FAIL · v4 I-4 교정)
  3. **A 창 `document.hasFocus()===false && activeElement===입력란`**(양성 조건 명시) 상태에서 B(팝아웃) 쓰기 → A 화면 == B 글 즉시 · 사용자가 A 로 돌아와 한 글자 → 저장본 == B 글 + 1자 (포커스 보류 빌드 FAIL — v4 C1)
  4. `impersonator` 클레임 토큰을 직접 심은 탭 부팅 → 관리자 `planq:draft:*` 키 수 불변 · 그 탭 입력 뒤 `planq:draft:*` 0 (사칭 가드 빼면 FAIL — v4 m-6: 현재 사칭 탭은 관리자로 부팅하므로 토큰을 심어야 빨갛게 만들 수 있다)
  5. 탭 A 살려둔 채 탭 B 로그아웃 → 같은 사용자 재로그인 → 탭 A 입력 → 키 존재 (I-5)
  6. (1B) ProfilePage 표시명 입력 0.5초 뒤 워크스페이스 전환 → 옛 biz PUT 1 / 새 biz 0 (I-2)
  7. (1B) 로그아웃 이중 클릭 → PUT 1 · logout POST 1 · flush 3초 초과 강제 → 로그아웃 진행 + 버튼 disabled (m-2)
  8. (1B) 원격 전환(BroadcastChannel) 수신 시 pending → reload 전 PUT 1 (m-7)
  9. (1B) 시리즈 업무 설명 입력 → 새로고침 **및 로그아웃** → `series_scope` 없는 PUT 0 · 범위 다이얼로그 0 · 로컬 edit 초안 존재 (m-5 · v4 I-2)
  10. 부팅 TTL 청소 뒤 `planq:draft:owner` 존재 · 로그아웃 ④ 뒤 다른 uid 키 불변 (m-3)
  11. 팝아웃 창 닫기(pagehide) → 메인 인스턴스(`hasFocus()===false && activeElement===입력란` 포함) 화면 == 팝아웃 글
  13. 같은 ms 편집·쓰기 겹침을 흉내(Date.now 고정 스텁) → 마지막 입력이 저장본에 착지 · 시계 역행 스텁 → 여전히 착지 (단조 증가 규칙 끄면 FAIL — v4 I-1)
  14. (1B) AutoSaveField 입력 0.5초 뒤 `location.href` 이동 → PUT 시도 1 (pagehide 핸들러 빼면 0 — v4 I-3)
  15. 한글 IME 조합 중 다른 창 쓰기 → 조합 깨짐 0 · compositionend 직후 재비교
  12. (1B) `draftKinds.ts` 에서 `task-description` 제거 → 1B 가드 FAIL (I-6)

## 2. 적용 순서 — 두 게이트
**라운드 1A(초안 장치)** — ① D-C1a 동기화 규칙(+카나리 ④·④-충돌·양성 대조군) ② D-C1b/c 키·등록제·이관·사칭 null·kind TTL · `useLocalDraft` 규칙 ③ D-C5 정체 확정 청소·센티널·부팅 TTL ④ D-C2 업무 상세 6입력(댓글 수정 edit 모드, 보류 사유 DraftInput) ⑤ D-C4·D-C6 draft 가드 · 카나리 ①~④·⑦(로그아웃 제외분)~⑨ · 곁들여 QNotePage `FindAnswerBtn` 비소유자 숨김(Fable 비차단 경고)
**라운드 1B(나갈 때 저장) — 1A 머지 뒤에만** — AutoSaveField pending·순차·key 규칙 가드(useAuth 파생 포함)·`data-form-dirty` · flush 프로토콜(로그아웃·switchWorkspace·원격 재부팅) · 메일 reason · Q Note 메모 · 업무 설명·결과물 pagehide keepalive(★ **edit 폴백 — 시리즈·60KB 초과 · `task-description`/`task-body` kind · ⑩9 · ⑩12 는 라운드 2 로 이연**. Fable 2026-09-11 결함 A: 시리즈 설명 입력 직후 새로고침·로그아웃하면 어디에도 안 남는다 — 유실 창은 변경 전과 같고 넓어지지 않았다) · 로그아웃 단일 실행·순서 ①~⑤ · 카나리 ⑤·⑥·⑦ 로그아웃분·⑩-6~9·12 · `--suite toggles` · 가드: `task-description`/`task-body` 미등록이면 1B 빌드 FAIL
**라운드 2** — 나머지 자유 텍스트 사용처 래칫 감소 · 공개 화면 토큰 축(`guest:name:{토큰 원문}` 교정) · AutoSaveField flush 실패 로컬 폴백 · 첨부 확장 검토

## 2-1. 라운드 1A 구현 노트 (2026-09-11)

- **⑩5 재조정 규칙** — 같은 키가 null(정지)에서 **같은 키로** 돌아오면 `load` 하지 않는다. 저장본이 더 새 편집이면 그것을 적용하고, 아니면 화면 글을 다시 쓴다(로그아웃이 저장본을 지웠고 화면 글은 남아 있다). **다른 키**로 바뀐 것이면 이 분기를 타지 않는다 — 앞 대상의 글이 새 대상 키에 섞인다(③). 첫 카나리에서 재로그인 뒤 `L1S` 가 사라지고 `R` 만 남았던 것.
- **카나리 판정 교정 2** — ① `/tasks` 부팅의 `POST /api/tasks/priority/reindex` 를 "복원이 저장을 불렀다" 로 셌다 → 대상 업무 쓰기만 센다 · ⑧ Esc 취소가 초안을 지우는 것은 정상(명시 취소).
- **④(a) 양성 대조군 교정** — `window` 에 capture 리스너로 `stopImmediatePropagation` 하는 차단은 이벤트가 `window` **자신**에게 발송돼(at-target) 먼저 등록된 훅 리스너가 받는다. 차단이 3회 찍혔는데 판정이 안 뒤집혔다 → `window.dispatchEvent` 가로채기(끝나면 원복)로 교체 후 뒤집힘 확인(숨은 탭 `A1` · 최종 `A1x`).
- **카나리가 잡은 실제 버그 2**
  1. 업무 전환 이펙트(`TaskDetailDrawer`)의 `revisionDraft.clear()` — 이펙트가 도는 순간 키는 **떠나는 업무** 것이라, 드로어를 연 채 다른 업무를 누르면 쓰던 수정요청 메모가 지워졌다. 옛 빌드에서 새 항목 FAIL(전환 뒤 저장본 없음) → 제거 후 PASS.
  2. `NoteThread` 가 `await onAdd()` 뒤 **무조건** 비웠다 — 넘기는 핸들러 셋(Q Talk `handleAddNote`·메일 `addIssue`/`addNote`)이 모두 실패를 삼켜, 저장이 실패해도 메모 초안이 사라졌다. `onAdd: Promise<boolean>` 타입 계약(성공 여부를 안 돌려주는 새 호출부는 빌드가 막는다) + `true` 일 때만 비움. 카나리 ②-메모: 400 → 입력칸·초안 그대로 / 성공 → 비움 + DB 1건.
- **규칙으로 남긴 것** — 초안을 비우는 곳은 **제출 성공·명시 취소**뿐이다. 대상 전환·재조회 이펙트에서 `clear()` 하지 않는다.
- **자체 검증(Fable 미검증)** — 카나리 `drafts` 28/28 · 가드 EXIT 0(draft 베이스라인 신규, godfile 불변) · health-check 41/41 · build EXIT 0 / error TS 0.

## 2-2. 라운드 1B 구현 노트 (2026-09-11)

- **flush 프로토콜** — `services/pendingSaves.ts`(`planq:drafts:flush` · `waitUntil` · 상한 3초). 부르는 곳: `AuthContext.logout`(단일 실행 · 대기분 먼저 → POST, 계정 삭제는 `{ flush:false }`) · `switchWorkspace`(POST 전 — 지금 워크스페이스로 보낸다) · `WorkspaceSyncGuard`(보류 창에서 사용자가 "전환" 을 누를 때. 자동 경로는 `data-form-dirty` 가 이미 보류시킨다). `useDraftText` 도 받아 로컬 초안을 동기로 쓴다.
- **AutoSaveField** — pending/inflight 분리 · 저장 중 새 입력은 완료 뒤 이어 보냄 · 언마운트·pagehide 대기분 발사(저장 중이면 완료 finally 가 mountedRef 와 무관하게) · 대기·저장 중 `data-form-dirty="1"`.
- **`hooks/useLeaveSave`** — MemoView·MemoPopup 에 **같은 코드가 복사**돼 들어갔던 것을 한 벌로 뽑았다. single-flight(새 메모 생성 중 나가며 저장이 또 나가면 메모 둘) · leaving 저장은 `onCreated/onUpdated` 를 안 부름 · `active` false 전환(팝업이 외부에서 닫힘)도 저장. MemoPopup 799→773줄(아이콘 `MemoPopupIcons.tsx` 분리 — god-file 래칫을 기준선이 아니라 구조로).
- **메일** — 답장·새 메일 초안 PUT 을 스냅샷(pending ref)으로 들고, 스레드 전환·취소·✕(`closeCompose('user'|'sent')`)·flush·pagehide(keepalive)·언마운트에서 보낸다. 발송을 시작하거나 성공하면 버린다.
- **업무 설명·결과물** — ★ 설계 가정 교정: 드로어 **닫기는 원래 괜찮았다**(언마운트가 타이머를 안 지워 늦게라도 나간다). 사라지는 것은 로그아웃(토큰이 먼저 지워져 401)과 창 닫기·새로고침 → pending 기록 + flush + pagehide keepalive. 반복 업무 공유 필드는 범위를 물을 화면이 없어 보내지 않는다(로컬 edit 폴백은 **미구현 — 다음 라운드**).
- **가드 `autosavekey`** — PUT/PATCH URL 템플릿 `${}` 뿌리 식별자(import·대문자 상수·전역 제외)가 있으면 그 파일 `<AutoSaveField` 는 key 에 그 이름을 포함. 베이스 52(24파일 중 11파일). 반증: key 하나 붙이면 51 통과 · key 없는 칸 하나 넣으면 53 FAIL.
- **카나리 `leavesave`** — ⑤ 프로필 이름 · ⑥ Q Note 새 메모 · ⑥-메일 ✕ · ⑥-업무 설명 새로고침(+keepalive 차단 대조군) · ⑦ 로그아웃 순서·이중 클릭. 판정기 교정 2: 새로고침 중 keepalive 요청은 puppeteer request 에 안 잡혀 판정을 DB 로(대조군으로 증명) · 생성 응답 본문 캡처가 비어 메모가 남아 제목 검색으로 정리.
- **곁에서 잡은 것** — `MainLayout` 접힌 사이드바의 `onClick={logout}` 이 MouseEvent 를 넘겼다(logout 에 옵션이 생기자 타입이 잡음).
- **자체 검증(Fable 미검증)** — `leavesave` 7/7 · `toggles` 6/0 · `drafts` 회귀 28/28(1차 ⑩3 FATAL 1회 · 재현 안 됨 · 원인 미확정, 진단 남김) · guard EXIT 0 · health 41/41 · build EXIT 0 / error TS 0.

## 2-3. 라운드 2 구현 노트 — 결함 A (2026-09-11)

> Fable(1A+1B PASS) 결함 A: 반복 업무 설명을 입력하고 바로 새로고침·로그아웃하면 그 글이 어디에도 안 남는다.
> Irene 결정: 로그아웃은 **"로그아웃 전에 확인"**(범위를 골라 저장하거나 버린 뒤 로그아웃).

- **사실 교정** — `TASK_SERIES_FIELDS` 에 `description` 은 있고 `body` 는 **없다**(결과물은 회차별). 범위 물음 대상은 설명뿐이다. 그리고 반복 업무 설명은 새로고침·로그아웃만이 아니라 **드로어를 닫기만 해도** 사라지고 있었다(늦게 터진 저장이 닫힌 드로어에 범위 물음을 띄우려다 아무 일도 없음). **업무를 바꾼 뒤** 늦게 뜬 범위 물음에서 고르면 `saveFields` 가 지금 업무를 써 **새 업무에 저장**될 수도 있었다.
- **로컬 본** — `task-description`·`task-body`(mode edit) 등록. 레코드에 `base`(원문)·`label`(업무 제목)·`series`. 쓰는 곳: 반복 업무 설명의 flush·언마운트·업무 전환·**범위 물음 취소**(+물음이 떠 있는 채 떠남) · 모든 설명/결과물의 pagehide(keepalive 와 함께 백업 — 서버에 들어갔으면 다시 열 때 조용히 지워진다). 저장 성공 시 삭제.
- **다시 열 때(D-C1d)** — 서버 == 본 → 조용히 삭제 · 서버 == base → 에디터에 복원 + 복원 줄(지우기) · 그 외 → 버리고 baseChanged 줄. 복원만으로 서버 저장 없음. 결과물 복원본은 `bodyDraftRef` 에도 실어 확인 요청이 같이 보낸다.
- **로그아웃 확인창** — `AuthContext.logout` 이 flush 뒤 `listDraftRecords(['task-description'])` 중 `series` 가 있으면 멈추고 `LOGOUT_BLOCKED_EVENT`. `LeaveDecisionGuard`(App 루트 — 두 렌더 트리 공통)가 항목마다 범위 선택 + [저장] · [취소] · [버리고 로그아웃]. 저장은 `GET /api/tasks/:id/detail` 로 서버 원문을 확인해 **base 와 같을 때만** PUT(`series_scope`) — 이미 같은 값이면 초안만 삭제, 달라졌으면 덮어쓰지 않고 알림. 전부 저장되면 로그아웃을 이어 간다. 계정 삭제(`flush:false`)는 묻지 않는다.
- **카나리가 잡은 것** — ⑨ 첫 실행: 사용자 메뉴를 누르면 설명 에디터 blur 가 **범위 물음을 먼저 띄워** 메뉴를 가렸고, 거기서 취소하면 글이 에디터에만 있고 어디에도 없었다 → 물음 취소 시 로컬 본으로 넘기고 에디터와 같은 값으로 복원 상태를 둔다.
- **자체 검증(Fable 미검증 — 라운드 2 + Drive Picker `297ef407` 을 묶어 올린다)** — `leavesave` 13/13(⑧ 새로고침 PUT 0·로컬 본·복원 줄·지우기 / ⑨ 범위 물음 취소 → 로컬 본 · 로그아웃 멈춤+확인창 · 취소 · 범위 저장 → series_scope PUT 뒤 로그아웃 POST 1 · DB 반영) · guard EXIT 0 · build EXIT 0 / error TS 0 · `drafts` 회귀 1차 27/28(⑩2 — 1A 부터의 간헐 실패, 진단: 입력 직후 포커스 BUTTON) → 재실행 28/28.
- **Fable 라운드 2 FAIL → 수리** — ① 범위 물음은 **어느 업무 것인지**(`seriesAskMetaRef`) 들고 다닌다. 저장 클로저가 지금 보이는 업무(prop `taskId`)가 아니면 묻지 않고 그 업무의 로컬 본으로, 물음에서 고르거나 취소해도 그 업무 기준(업무 전환 뒤 옛 글이 새 업무 DB·로컬 본으로 가던 비가역 결함). 에디터는 업무마다 `key` 로 가른다. ② 물음이 떠 있는 채 떠나면(새로고침·로그아웃·전환·닫힘) 물음 값도 로컬 본으로 옮기고 물음을 닫는다. ③ draft 가드는 초안 API 호출 인자 안의 kind 문자열(삼항·배열)과 draftStore 까지 대조 — 반증: 등록 줄 삭제 시 EXIT 1. ④ 로그아웃 멈춤·확인창 수집은 `listLeaveBlockers` 한 함수. 카나리 ⑧-전환·⑧-물음 추가 → `leavesave` 15/15 · `drafts` 28/28 · `toggles` 6/6.

## 3. 기본값
- 첨부: 텍스트만(서버 파일 id 만, 제출 전 재확인) · 보존: kind 별(기본 7일, 회의 시작 24h) · 동시 편집: 마지막 편집 승
