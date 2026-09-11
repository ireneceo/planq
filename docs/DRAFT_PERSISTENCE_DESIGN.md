# 입력 임시저장 — 설계 초안

> Irene 2026-09-11: *"업무상세에서 수정요청에 내용 남기거나 댓글에 내용 남기거나 하다가 나가면 다 날라가는데 **모든 입력란은 임시저장** 되어 있게 못해?"*
> 같은 날: *"고치는 걸 왜 자꾸 단편적으로 해? 구조 자체를 … 제대로 적용해서 수정해야지"*

**상태: 설계 초안 · 감사 완료 · 미구현.** 워크스페이스 단일 정본(docs/WORKSPACE_SCOPE_DESIGN.md) 단계 2 검증 뒤 착수.

---

## 0. 감사로 확인한 사실 (dev-frontend/src 전수, 2026-09-11)

| 분류 | 개수 | 내용 |
|---|---:|---|
| **D1 쓰다가 나가면 사라짐** | **~67곳 · 17화면** | 컴포넌트 `useState` 라 새로고침·탭 정지·드로어/모달 닫기에 사라진다 |
| D2 localStorage 초안 | 5 | `useDraftText` 호출 2 · `useLocalDraft` 1 · 직접 구현 2 (형식·만료·키가 제각각) — Fable 실측 교정(원래 "4") |
| D2 서버 초안 | 2 | 메일 새 메일·답장 |
| D2 서버 debounce 자동저장 | 5 | 업무 설명·결과물 · Q docs · Q Note 메모 화면·팝업 |
| D2 `AutoSaveField` | ~13 | |
| D3 짧은 입력(검색·이름 등) | ~182 | 대상 아님 |
| 민감 입력 | 21 | 비밀번호·IMAP/SMTP·S3 키·Stripe 비밀키·계좌번호 — **초안 대상에서 절대 제외** |

**신고 화면(업무 상세)**: 수정요청 사유 · 확인요청 메모 · 승인 코멘트 · 보류 사유 · 댓글 수정 · 댓글 첨부 — **저장 없음**.
댓글 본문만 `useDraftText` 로 저장됨(첨부는 빠짐). 확인요청 메모·승인 코멘트·보류 사유는 업무를 바꿔도 **초기화되지 않아 다음 업무로 따라갈 수 있다**(미실측).

**조용한 유실(자동저장이 있는데도 마지막 입력이 사라지는 곳)**
- `components/Common/AutoSaveField.tsx:113` — 언마운트 때 debounce 타이머를 **취소만** 하고 저장하지 않는다 → 입력 후 2초 안에 드로어를 닫으면 마지막 입력 소실 (공용 컴포넌트 — ~13곳 전부)
- 메일 새 메일 `closeCompose` · 답장 스레드 전환 — 1.5초 debounce 를 저장 없이 취소
- Q Note `MemoView`·메모 팝업 언마운트 — 1초분 소실
- 업무 설명·결과물 debounce 타이머를 언마운트 때 해제하지 않음 → 닫힌 뒤 발사(미실측)

**키·정리의 구멍**
- `StartMeetingModal` `qnote_meeting_draft_v1` — **사용자·워크스페이스 축 없음** → 공용 PC·전환 시 남의 초안이 복원
- 로그아웃이 초안을 지우지 않는다(`AuthContext.tsx:797-806`) · 만료 초안 일괄 정리 없음 · quota 실패를 전부 삼킴

---

## 1. 계약 (초안)

### D-C1. 초안 장치는 하나 — `useDraftText` 를 정본으로 확장
- 기존 `hooks/useLocalDraft`·`useDraftText` 중 **대상 전환·언마운트·pagehide 확정 저장**을 갖춘 `useDraftText` 를 정본으로.
- 형식 `{ v: 1, value, attachments?, savedAt }` · 키 `planq:draft:{kind}:{userId}:{bizId}:{entityId}` — 사용자·**워크스페이스** 축 필수(워크스페이스 단일 정본과 같은 축).
- 무로그인 공개 화면(게스트·서명·공개 문서·공개 청구서·문의)은 `{kind}:t:{tokenHash}` 축.
- 제출 **성공 후에만** 삭제 · TTL 7일 · 로그아웃 시 그 사용자 초안 일괄 삭제 · 부팅 시 만료 일괄 정리.

### D-C2. 공용 입력 껍데기에 넣으면 자동으로 초안이 된다
- 자유 텍스트 입력용 공용 컴포넌트(`DraftTextarea` — 또는 기존 textarea 래퍼에 `draftKey` prop)로 모은다. 화면마다 훅을 부르게 하면 또 빠진다
  (memory `feedback_shared_wrapper_is_not_enforcement` — 껍데기만으로는 강제되지 않으므로 D-C5 가드와 같이).
- **복원은 보이게** — 복원된 초안이 있으면 입력란 아래 "임시저장된 내용을 불러왔어요 · 지우기"(첫 편집 전 자동저장 억제 규칙과 같은 계열).

### D-C3. 자동저장이 있는 곳도 **나갈 때 확정 저장**
- `AutoSaveField` 언마운트 · 메일 초안 닫기/전환 · Q Note 메모 언마운트 — 대기 중인 debounce 를 **취소가 아니라 flush**.
- 업무 설명·결과물 debounce 타이머는 언마운트 때 flush 후 해제.

### D-C4. 민감 입력은 초안 대상이 아니다
- `type="password"` · `autoComplete="new-password|current-password"` · `data-no-draft` 표식 입력은 껍데기가 **저장을 거부**한다.
- 목록(감사): LoginPage·RegisterPage·ResetPasswordPage·AccountDeletionSection·SharePasswordPrompt·ShareModal 비밀번호 · IMAP/SMTP 비밀번호 · S3 키 · Stripe 비밀키·웹훅 · 계좌번호.

### D-C5. 가드
- `guard-invariants --category=draft`(래칫): `<textarea` · `RichEditor` 사용처 중 `draftKey`/`DraftTextarea`/`// draft-exempt: <이유>` 가 없는 곳을 센다. 기존 부채 동결 후 감소.
- 민감 입력에 `draftKey` 가 붙으면 하드 실패.
- e2e `--suite drafts`: 업무 상세 수정요청 사유·댓글·확인요청 메모에 입력 → 드로어 닫기 → 다시 열기 → 복원 · 제출 후 삭제 · 다른 사용자/워크스페이스로 안 샘(양성·음성 대조군) · `AutoSaveField` 입력 직후 닫기 → 서버 값 반영.

## 2. 적용 순서 (초안)
1. D-C3 조용한 유실 수리(AutoSaveField flush · 메일 · 메모) — 공용 1곳이 ~13곳을 고친다
2. D-C1 훅 정본화 + 키 축 + 로그아웃 정리 + 만료 정리 · `StartMeetingModal` 키 교정
3. D-C2 공용 껍데기 + **업무 상세 6개 입력(신고 화면)** 먼저 → 나머지 D1 화면별
4. D-C4 민감 입력 차단 · D-C5 가드 + e2e

## 3. R/S/F
사용자 텍스트 유실(되돌릴 수 없음)·다른 사용자·워크스페이스로 초안이 새는 것은 격리 계열 → **R=1**. 키 축·민감 제외·flush 경계 판단 → S=1. 설계부터 Fable.
