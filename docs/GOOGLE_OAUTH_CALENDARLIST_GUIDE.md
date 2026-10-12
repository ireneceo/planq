# 구글 «캘린더 목록 보기» 권한 — Irene 작업 안내 (2026-10-07)

> 무엇: 개인 구글 캘린더 연결에서 «PlanQ 일정을 어느 캘린더에 올릴지» 고르는 기능(48e0164d)에 필요한 권한
> `https://www.googleapis.com/auth/calendar.calendarlist.readonly` (구독 중인 캘린더 **목록만** 읽기 — 일정 내용은 못 읽음)

## 1. 지금 쓰는 데 문제가 생기나? — **아니요(그렇게 만들어 두었습니다)**

| 상황 | 사용자에게 보이는 것 |
|---|---|
| 평소 [Google 캘린더 연결] | **지금과 똑같습니다.** 새 권한을 묻지 않습니다 |
| 이미 연결된 사람 | 그대로 씁니다. 일정은 기본(primary) 캘린더로 갑니다 |
| [구글 캘린더 목록 불러오기] 를 누른 사람만 (내 외부 연동 · Q calendar 두 곳) | 구글이 «캘린더 목록 보기» 권한을 **한 번 더** 묻습니다 |

- 구글 정책: 승인 전의 민감 권한을 요청하면 그 동의 화면에 **«확인되지 않은 앱» 경고**가 붙고, 그 앱의
  **신규 사용자 100명 한도(평생, 초기화 불가)** 에 셉니다. 출처: [Google — Unverified apps](https://support.google.com/cloud/answer/7454865)
- 그래서 새 권한을 **[구글 캘린더 목록 불러오기] 를 누른 사람에게만** 묻게 했습니다(점진적 동의). 평소 연결 흐름은 이 권한과 무관해
  심사 결과와 상관없이 지금처럼 동작합니다. 심사 승인 전에는 [구글 캘린더 목록 불러오기] 를 누른 사람만 경고를 봅니다.
- 콘솔에 권한을 **추가하는 것**과 **심사 제출** 자체는 앱 동작을 바꾸지 않습니다. 심사 중에도 앱은 그대로 돌아갑니다.
- ★ 확인 못 함: 지금 콘솔에서 앱의 기존 권한(calendar.events·drive.file)이 이미 승인됐는지는 제가 볼 수 없습니다.
  아래 2-①에서 «인증 센터» 상태를 한 번 봐 주세요.

## 2. 해야 할 일 (순서대로 · 구글 계정 주인만 할 수 있음)

**① 상태 확인** — [console.cloud.google.com](https://console.cloud.google.com) → PlanQ 프로젝트 →
«Google 인증 플랫폼(Google Auth Platform)» → «인증 센터(Verification center)». 지금 상태(미제출/검토 중/승인)를 확인.

**② 운영 배포가 먼저입니다** — 심사관은 실제 화면(planq.kr)과 방침을 봅니다. [캘린더 고르기] 와 바뀐 방침
(«구독 캘린더 목록(읽기) — 일정을 올릴 캘린더를 고르는 데만 사용»)이 운영에 있어야 합니다. 이번 배포가 끝나면 됩니다.

**③ 권한 추가** — «데이터 액세스(Data access)» → «범위 추가 또는 삭제(Add or remove scopes)» →
필터에 `calendar.calendarlist.readonly` 입력 → 체크 → «업데이트» → 화면 아래 «저장».

**④ 사용 이유 입력** — 같은 화면의 민감 범위 설명 칸(영문). 그대로 붙여 넣으시면 됩니다:

> PlanQ shows the user's Google events alongside their team schedule. We use calendar.calendarlist.readonly to display
> the names and colors of the calendars the user already has access to, so the user can (a) choose which calendar PlanQ
> adds events to and (b) toggle which of their calendars are shown inside PlanQ. Event contents are read only with
> calendar.events, and only for the calendars the user has chosen to display. The list is fetched when the user opens
> the calendar picker or presses 'Load my calendars', and we store only the chosen calendar IDs (write target and
> visible set).

> ★ 2026-10-12 갱신 — Q calendar 에서 구글 캘린더마다 보기/가리기가 생겨(Fable 2단계 판정) 옛 문안
> («쓰기 캘린더 고르기에만 쓴다»)은 사실과 달라졌다. **이미 콘솔에 옛 문안을 넣었다면 위 문안으로 바꿔 주세요**
> (심사관이 보는 설명과 실제 동작이 다르면 반려 사유).

**⑤ 데모 영상(심사 제출에 필요)** — 2분 이내, 화면 녹화. 주소창(planq.kr)과 구글 동의 화면이 보이게:
1. planq.kr 로그인 → 프로필 > 외부 연동
2. [Google 캘린더 연결] → 구글 동의 화면(앱 이름·권한이 보이게) → 허용
3. [구글 캘린더 목록 불러오기] → 구글이 «캘린더 목록 보기» 를 묻는 화면 → 허용
4. 목록에서 다른 캘린더를 고름
5. PlanQ 에서 일정을 하나 만들고 → 구글 캘린더의 **그 캘린더**에 나타나는 것을 보여 줌
6. Q calendar 로 가서 Google 옆 캘린더 칩(공휴일·보조 캘린더)을 눌러 보이고 가려지는 것을 보여 줌

**⑥ 제출** — «인증 센터» → «인증을 위해 제출(Submit for verification)». 심사는 보통 며칠~몇 주이고, 구글이 메일로
추가 질문을 보낼 수 있습니다(받으시면 저에게 넘겨 주세요 — 답장 문안을 쓰겠습니다).

## 3. 넣지 말 것
- Gmail 권한(`https://mail.google.com/`)은 **넣지 마세요.** 제한 범위라 유료 보안평가(CASA)로 넘어갑니다.
  지금 Gmail 연결은 꺼져 있고 Q mail 은 앱 비밀번호로 동작합니다.
- `calendar.readonly`(모든 캘린더 내용 읽기)도 필요 없습니다. 목록만 쓰는 좁은 권한으로 충분합니다.
