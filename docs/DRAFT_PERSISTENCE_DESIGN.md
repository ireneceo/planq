# 입력 임시저장 — 설계 v2

> Irene 2026-09-11: *"업무상세에서 수정요청에 내용 남기거나 댓글에 내용 남기거나 하다가 나가면 다 날라가는데 **모든 입력란은 임시저장** 되어 있게 못해?"*
> 같은 날: *"고치는 걸 왜 자꾸 단편적으로 해? 구조 자체를 … 제대로 적용해서 수정해야지"*

**상태: v2 — Fable 설계 게이트 v1 FAIL(치명 1 · 중요 9 · 경미 7) 전부 반영 · 재게이트 대기 · 미구현.**
R=1(사용자 글 유실은 되돌릴 수 없다 · 초안이 다른 사용자/워크스페이스로 새면 격리 위반) · S=1.

---

## 0. 감사로 확인한 사실 (dev-frontend/src, 2026-09-11 · Fable 실측 교정 반영)

| 분류 | 개수 | 판정 술어 / 내용 |
|---|---:|---|
| 자유 텍스트 입력 정의 | `styled.textarea` 59 정의/47파일 · 리터럴 `<textarea` 29 · `<RichEditor` 11 | `grep -rE "styled\.textarea|<textarea|<RichEditor"` — 규모는 이 술어로 잰다(옛 "~67곳·17화면" 은 재현 불가라 폐기) |
| 손으로 쓴 초안 키 `planq:draft:` | **4곳 — 전부 bizId 없음** | `TaskDetailDrawer.tsx:319 task-comment` · `MailContextPanel.tsx:449 mail-issue` · `:470 mail-note` · `QTalk/RightPanel.tsx:438 qtalk-note`(NoteThread 경유) |
| `useLocalDraft` 키 | 1 | `MailPage.tsx:1680 qmail-fwd-{userId}-{msgId}` (접두가 달라 청소 대상 밖) |
| 직접 구현 | 2 | `StartMeetingModal.tsx:176 qnote_meeting_draft_v1`(사용자·워크스페이스 축 없음, TTL 24h — 의도) · `GuestChatPanel.tsx:43 guest:name:{토큰 원문}` |
| `AutoSaveField` | **125 사용 · 24 파일** | AdminPlatformSettings 21 · WorkspaceSettings 20 · QBill Settings 15 … — D-C3 공용 변경의 폭발 반경 |
| 서버 초안 | 2 | 메일 새 메일·답장 |
| 민감 입력 | 21 | 비밀번호(리터럴·삼항 `type={show?'text':'password'}` 포함)·IMAP/SMTP·S3 키·Stripe 비밀키·웹훅·계좌번호 |

**keep-alive 사실(치명 T1 의 전제):** `components/Tab/TabPane.tsx` — 비활성 탭은 `display:none` 으로 **마운트 유지**.
`TaskDetailDrawer` 는 QTaskPage·TodoPage·TasksTab·QCalendarPage·TaskPopoutView 5곳에 마운트되고 팝아웃 창·PiP 는 별도 문서다.
→ **같은 초안 키를 든 인스턴스가 한 창 안에서도 여럿 동시에 산다.**

**신고 화면(업무 상세 `TaskDetailDrawer.tsx`) 자유 텍스트 — 실제 마크업**
| 입력 | 상태(줄) | 마크업 | 저장 |
|---|---|---|---|
| 댓글 본문 | `commentDraft` 319 | `CommentInput` 3060 (styled.textarea) | `useDraftText` — 키에 bizId 없음 · 첨부 안 남음 |
| 댓글 수정 | `editingCommentDraft` 345 | `CommentEditArea` 3041 | 없음 |
| 수정요청 사유 | `revisionNote` 380 | `RevisionInput` 3008 | 없음 |
| 승인 코멘트 | `approveNote` 389 | `RevisionInput` | 없음 |
| 확인요청 메모 | `submitNote` 393 | `RevisionInput` | 없음 |
| 보류 사유 | `holdReason` 383 | `HoldReasonInput` 2797 **styled.input** (maxLength 500) | 없음 (사후 편집 `holdReasonDraft` 384 는 AutoSaveField 1523 — 무키) |

**조용한 유실 — 확인됨**
- `AutoSaveField.tsx:113` 언마운트 cleanup = `clearTimers()` 만 → debounce 안에 닫으면 마지막 입력 소실.
- 메일 `MailPage.tsx` 초안 effect cleanup(1382·1775) `clearTimeout` 만 · `closeCompose`(1843) 가 상태를 비움. 단 `sendCompose`(1896) 는 `DELETE email-drafts` 후 `closeCompose()`, 답장은 1538 DELETE 후 전환.
- `MemoView.tsx:225-229` — `QNotePage.tsx:2684 key={s-${id}}` 로 세션 전환 시 언마운트 → 유실 실재.
- `MemoPopup.tsx` — `handleClose`(591-598)·`startNew`(583-589)는 이미 dirty 면 persist. 구멍은 **handleClose 를 안 거치는 언마운트**(스탠드얼론 창 닫기·라우트 이탈·탭 LRU 정지)뿐.
- 업무 설명·결과물 `debouncedSave`(697-705) — **드로어 닫기**에는 저장됨(클로저가 detailTask id 로 PUT). **새로고침·탭 닫기·pagehide** 에는 타이머가 페이지와 함께 죽고 onBlur flush(2108·2405)도 안 불려 마지막 ≤2초 유실.
- `AutoSaveField` 는 저장 대상이 바뀌어도 언마운트되지 않는 자리가 있다 — 드로어는 5곳 어디서도 task 로 `key` 되지 않음 · 1523 무키 → 대기 타이머가 새 렌더의 `saveRef.current` 로 발사.
- `useDraftText.flush`(`useLocalDraft.ts:127-130`) 는 **dirty 판정 없이** 쓰고, 빈 값이면 `removeItem`(104).

**정리의 구멍** — `logout`(`AuthContext.tsx:837-846`) 은 `clearPageCache()` 만 · 세션 만료(766-772 → goLogin)·다른 탭 로그아웃·강제 종료는 logout 을 안 탄다 · 사칭 창(`impersonate_pending`)은 대상 userId 로 관리자 브라우저에 초안을 남기고 `exitImpersonation` 은 청소 없음.

---

## 1. 계약

### D-C1. 초안 장치는 하나 — `useDraftText` 정본 + **dirty 규칙** + 키 등록제

**(a) dirty 규칙 — 치명 T1 대응, 모든 적용의 선행 조건**
- 인스턴스는 `dirtyRef` 를 가진다: 마지막 read(마운트·키 전환·재읽기) 이후 **`setText` 가 불렸을 때만** true.
- flush(키 전환·언마운트·pagehide·visibilitychange:hidden)는 **dirty 인 인스턴스만** 쓴다. **빈 값 삭제도 dirty 일 때만.** 쓰고 나면 dirty=false.
- non-dirty 인스턴스는 `visibilitychange:visible` · `focus` · 같은 키의 `storage` 이벤트에서 **다시 읽는다**(다른 탭·팝아웃이 쓴 초안을 이 인스턴스가 보여준다).
- 제출 성공 `clear()` 는 명시 동작이라 dirty 와 무관하게 지운다.

**(b) 키는 `useDraftKey(kind, entityId)` 한 함수 + `hooks/draftKinds.ts` 등록제**
- 키 `planq:draft:{kind}:{userId}:{bizId}:{entityId}`. `userId`·`bizId` 는 `useAuth()` 에서, **둘 중 하나라도 없거나 사칭 중(`impersonator`)이면 null**(=보존 안 함).
- `draftKinds.ts`: `{ kind: { ttlMs, mode: 'append'|'edit', owners: [파일] } }` — 등록되지 않은 kind 는 가드 FAIL. TTL 은 **kind 별**(회의 시작 24h 유지, 기본 7일).
- `useLocalDraft` 도 키를 `useDraftKey` 로 받는다(장치가 둘이어도 **키와 청소는 하나**).

**(c) 옛 키 이관 표** — 새 키가 비었을 때 한 번 읽어 옮기고 지운다
| 옛 키 | 새 kind |
|---|---|
| `planq:draft:task-comment:{uid}:{taskId}` | `task-comment` |
| `planq:draft:mail-issue:…` (MailContextPanel:449) | `mail-issue` |
| `planq:draft:mail-note:…` (:470) | `mail-note` |
| `planq:draft:qtalk-note:…` (RightPanel:438) | `qtalk-note` |
| `qmail-fwd-{uid}-{msgId}` | `mail-forward` |
| `qnote_meeting_draft_v1` | `qnote-meeting-start` (TTL 24h) — 옛 값은 사용자 축이 없어 **이관하지 않고 삭제** |

**(d) 수정형(`mode:'edit'`) 초안** — `{ value, base, savedAt }`. 복원 시 서버 현재값 ≠ `base` 면 **버리고** `common:draft.baseChanged` 한 줄("다른 곳에서 바뀌어 임시저장본을 버렸어요"). 댓글 수정이 해당.

### D-C2. 자유 텍스트 입력은 공용 껍데기로
- `components/Common/DraftTextarea.tsx`(textarea 래퍼) · `DraftInput`(긴 사유 input) — `draftKind`·`entityId` prop. RichEditor 자유 텍스트는 훅 직접이되 `useDraftKey` 경유.
- 복원은 보이게: `common:draft.restored` "임시저장된 내용을 불러왔어요 · 지우기" / "Restored your unsent text · Clear". 복원만으로 서버 자동저장을 부르지 않는다.
- 첨부: 텍스트만. 이미 서버 파일인 첨부만 `attachments: number[]` — **제출 전 존재 재확인**(지워졌으면 뺀다).
- 수용하는 한계: 다른 기기에서 제출한 뒤 이 기기에 초안이 남는다(중복 제출 가능) — 복원 줄이 보이므로 사람이 판단한다.

### D-C3. 자동저장이 있는 곳도 **나갈 때 확정 저장**
- **AutoSaveField**
  - 대기 판정은 타이머 존재가 아니라 `pendingRef`(입력 후 저장 전). 언마운트 cleanup 에서 pending 이면 `saveRef.current()` 즉시 호출(실패는 콘솔).
  - inflight 중 새 입력 → **완료 후 한 번 더 저장(체인)**. 건너뛰지 않는다.
  - **저장 대상이 바뀌는 자리의 AutoSaveField 는 `key={entityId}`** — 가드 `--category=autosave` 에 규칙 추가(드로어 안 AutoSaveField 무키 = 위반). 그래야 대상 전환이 언마운트 flush 로 옛 대상에 저장된다.
  - 125곳 공용 변경 → `--suite toggles` · autosave e2e 필수 재실행.
- **메일** — `closeCompose(reason)`: `'user'`(✕·취소)만 `dirtyRef` 기준 PUT 선발사, `'sent'`·`'discard'` 는 발사 없이 비운다. 답장 스레드 전환도 같은 규칙(보낸 뒤 전환 = sent).
- **Q Note** — `MemoView` 언마운트(세션 전환 key 리마운트 포함) dirty 면 persist · `MemoPopup` 은 handleClose 밖 언마운트에서 dirty 면 persist.
- **업무 설명·결과물 `debouncedSave`** — `pagehide` 에서 대기분을 `fetch(…, { keepalive: true })` 로 flush. 드로어 닫기는 종전(이미 저장됨).
- 로그아웃 순서: `logout` 은 서버 POST 를 await 한 뒤 언마운트되므로 flush 는 **아직 유효한 토큰으로 성공한다** — 허용(쓰던 글을 저장하는 것이 맞다).

### D-C4. 민감 입력은 초안 대상이 아니다 — 등록제 + 기계 판정
- 등록되지 않은 kind 는 쓸 수 없다(D-C1b). 가드:
  ① 등록 외 kind → FAIL
  ② `type=` 속성값에 `'password'` 문자열이 들어간 파일(리터럴·삼항 모두) 또는 `sensitiveFiles` 목록(LoginPage·RegisterPage·ResetPasswordPage·AccountDeletionSection·SharePasswordPrompt·ShareModal·IMAP/SMTP·S3·Stripe·계좌 설정)에서 `useDraftKey`/`DraftTextarea`/`DraftInput` → FAIL (`// draft-sensitive-reviewed: <이유>` 로만 해제)
  ③ 양성 대조군: LoginPage 에 `useDraftKey` 한 줄을 심으면 FAIL 이어야 한다.

### D-C5. 정리
- **로그인 성공 시**: `planq:draft:*` 중 userId ≠ 새 사용자인 키 + 옛 키(`qnote_meeting_draft_v1`·`qmail-fwd-*` 중 타 사용자) 전부 삭제 — 세션 만료·다른 사람 로그인·강제 종료 경로가 여기서 닫힌다.
- **로그아웃**: 그 사용자 초안 삭제(공용 PC). **세션 만료 자체는 지우지 않는다**(같은 사람이 재로그인해 이어 쓴다).
- **부팅 1회**: kind 별 TTL 지난 키 삭제.
- **quota**: 쓰기 실패 → 만료 청소 1회 후 재시도 → 그래도 실패면 조용히 포기(입력은 막지 않는다).

### D-C6. 가드 · 카나리
**가드 `--category=draft` (래칫 + 하드)**
- 술어: `styled.textarea` / `styled(X).attrs({as:'textarea'})` / `styled.input` 중 `maxLength≥200` 또는 `rows` 있는 것 / `contentEditable` 정의를 **컴포넌트명으로 해석**해 JSX 사용처를 센다 + 리터럴 `<textarea`·`<RichEditor`. 초안 표식(`DraftTextarea`/`DraftInput`/`useDraftKey`/`// draft-exempt: <이유>`)이 없으면 부채.
- 손으로 쓴 `planq:draft:` 문자열(=`useDraftKey` 우회) 부채.
- **커버리지 출력**(정의 n · 사용 m · 표식 k). 라운드 1 대상 6개가 **실제로 셈에 잡히는지** 출력으로 확인.
- 양성 대조군: 표식 없는 `RevisionInput` 사용 1곳 추가 → 래칫 FAIL · D-C4 ③.

**카나리 `--suite drafts`** (실브라우저, 폰·데스크탑)
① 업무 상세 6입력 입력 → 드로어 닫기 → 다시 열기 → **보이는지**(좌표·elementFromPoint) + 복원 줄
② 제출 성공 후 비어 있음 · 제출 실패(4xx)면 남음
③ 다른 업무 전환 섞임 0 · 다른 사용자/워크스페이스 안 보임 · 같은 사용자·워크스페이스로 돌아오면 보임(양성)
④ **T1 음성 대조군** — 같은 업무를 두 alive 탭(또는 메인+팝아웃)에 열고 한쪽만 입력 → 다른 쪽 전환·닫기 → 초안 남음
⑤ AutoSaveField 입력 0.5초 뒤 닫기 → PUT 1건 · **본문 == 마지막 입력값** · 대상 전환 직후 PUT 옛 entity 1건 / 새 entity 0건
⑥ 메일 — 입력 후 ✕ → 서버 초안 반영 · **입력 후 1초 안에 보내기 → 서버 초안 0건** · Q Note 메모 입력 직후 세션 전환 → 반영 · 업무 설명 입력 직후 새로고침 → 반영
⑦ 로그아웃 → 그 사용자 초안 키 0(`useLocalDraft` 키 포함) · 다른 사람 로그인 → 앞 사람 키 0 · 민감 입력 페이지 입력 → 저장소 값 없음
⑧ 댓글 수정 초안 — 다른 세션이 원문 수정 → 복원 안 함 + baseChanged 줄
+ `--suite toggles` 재실행

## 2. 적용 순서 (한 라운드 = 한 번의 Fable 게이트)
**라운드 1** (순서 고정)
1. D-C1a dirty 규칙(T1) — 훅 수정 + 카나리 ④
2. D-C1b/c 키 등록제·`useDraftKey`·이관 표 · 사칭 null · kind 별 TTL
3. D-C5 로그인/로그아웃/부팅 청소
4. D-C3 — AutoSaveField pending·체인·`key` 규칙 · 메일 reason 분기 · Q Note 메모 · 업무 설명·결과물 pagehide keepalive
5. D-C2 업무 상세 6입력(수정형 댓글 수정 포함, 보류 사유는 DraftInput)
6. D-C4 · D-C6 가드(커버리지·양성 대조군) · 카나리 ①~⑧ · toggles

**라운드 2** — 나머지 자유 텍스트 사용처 래칫 감소 · 공개 화면 토큰 축(`guest:name:{토큰 원문}` 교정 포함) · 첨부 확장 검토

## 3. 기본값
- 첨부: 텍스트만(서버 파일 id 만, 제출 전 재확인) · 보존: kind 별(기본 7일, 회의 시작 24h)
