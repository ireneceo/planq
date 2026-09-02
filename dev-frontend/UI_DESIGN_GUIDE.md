# UI/UX 통합 디자인 가이드

> **이 문서는 모든 새 기능 개발 시 반드시 참조해야 합니다.**
> 기준 페이지: PlanQ Pages (DashboardPage, BusinessPage, MembersPage)
> **색상 사용:** `COLOR_GUIDE.md` 참조 — 허용된 색상만 사용. 이모지 아이콘 사용 금지.

---

## 0. 글자 크기는 rem 이다 (2026-08-30 — px 금지)

**`font-size` 를 px 로 쓰지 않는다.** 앱 전체가 rem 이고, 루트 배율 하나가 글자만 키운다.

```css
/* ❌ 금지 — 이 요소만 배율을 안 따라간다 */
font-size: 13px;

/* ✅ */
font-size: 0.8125rem;    /* 13px */
```

- 배율 정의: `dev-frontend/src/index.css` → `html { font-size: calc(16px * var(--planq-font-scale, 1)) }`
- 적용 단일 착지점: `services/fontScale.ts` (설정: 내 프로필 > 글씨 크기, 기기별 localStorage)
- **신규 코드는 `theme/tokens.ts` 의 `TYPE` 을 쓴다** — caption 0.6875 / meta 0.75 / body 0.8125 /
  bodyLg 0.875 / title 1 / pageTitle 1.125 rem
- **가드 `fontpx` 가 fail-closed 로 막는다**(베이스 0). styled 선언·JSX 인라인·중괄호·동적
  보간·`font:` 축약형 5형태 모두 잡는다 — 반증 완료.
- 아이콘·여백·고정 px 높이는 **안 커진다**(의도) — 그것까지 키우는 것은 화면 확대이고
  좁은 폰에서 유효 가로폭을 깎는다.
- **폰 입력칸은 최소 1rem(16px)** — iOS 가 16px 미만 입력칸 포커스 시 화면을 자동 확대한다.
  `textarea`·`select` 는 `:not()` 3연쇄로 특이도를 맞춰야 styled 클래스를 이긴다.

> 아래 예시 코드에 남아 있는 `font-size: NNpx` 표기는 **옛 문서**다. 실제 코드는 전부 rem 이며,
> 새로 쓸 때는 위 규칙을 따른다.

---

## 0-B. 상세는 못 불러오면 **말을 한다** (2026-08-30)

상세 로드 실패(404·403·429·500·네트워크 순단)를 조용히 삼키지 않는다. 침묵은 사용자에게
**"눌렀는데 아무 일도 안 일어났다"** 로 보인다.

```tsx
import DetailFallback from 'components/Common/DetailFallback';
import { useDetailResource } from 'hooks/useDetailResource';
// status: 'loading' | 'ready' | 'not_found' | 'forbidden' | 'error'
<DetailFallback status={status} onRetry={retry} onBack={close} />
```

- **`apiFetch` 는 throw 하지 않는다** — 반드시 `r.status` 를 본다
- 상세 URL 파라미터는 `hooks/useDetailParam` 하나로 — 화면마다 만들면 갈라지고,
  안 만든 화면은 **딥링크가 죽는다**(실제로 파일·고객이 그랬다)
- 카나리 `node scripts/e2e/run.js --suite detailopen` 가 지킨다 — **침묵이 실패**

---

## 0-C. 배경 갱신은 **화면을 바꾸지 않는다** (2026-09-01)

소켓 broadcast·visibility 복귀로 도는 갱신은 **데이터만** 새로 받는다. 그 갱신이 화면을
로딩으로 덮거나 지우면, 그 안에서 하던 일(편집·스크롤·열어둔 패널)이 **언마운트로 사라진다.**

```tsx
const load = useCallback(async (opts?: { silent?: boolean }) => {
  const silent = opts?.silent === true;
  if (!silent) setLoading(true);           // ① 배경 갱신은 loading 을 건드리지 않는다
  ...
  const failed = (st: DetailStatus) => { if (!silent) { setDetailStatus(st); setProject(null); } };
  ...                                      // ② 배경 갱신 실패는 화면을 지우지 않는다
} finally { if (!silent) setLoading(false); }
}, [id]);

useVisibilityRefresh(useCallback(() => { void load({ silent: true }); }, [load]));
onSocket('x:updated', () => void load({ silent: true }));

// ③ 로딩 화면은 보여줄 것이 없을 때만
if (loading && !project) return <PageShell title="로드 중..."><Empty>로드 중...</Empty></PageShell>;
```

- **④ 안 쓰는 이벤트는 듣지 않는다.** 화면이 렌더하지 않는 자원의 이벤트로 전체를 재조회하면
  낭비이자 사고다. 실측: 프로젝트 상세가 `post:*` 마다 전체를 다시 불러 글 쓰는 중 **130건/분**
  (제거 후 30건/분), 그 재조회가 곧 **편집창을 죽인 반응**이었다.
- 실사례 — Irene "프로젝트>문서에서 편집이 임시저장된 다음 닫혀버려": 기존 문서 자동저장 PUT →
  `post:updated` 방송 → 부모(`QProjectDetailPage`)가 자기 재조회 → `if (loading) return <로드 중…>` →
  `PostsPage` 언마운트. **내 저장이 내 편집창을 죽였다.** 신규 초안은 방송을 안 해
  (`routes/posts.js:903`) "기존 문서만" 이라는 경계가 생겼고, 그 경계가 원인의 경계였다.
- 판정은 **실브라우저로** — 정적 검사로는 안 잡힌다. 옛 코드 240 표본 중 231회 닫힘 → 0회.

---

## 1. 필수 규칙

### 1.1 브라우저 alert() 절대 금지

```javascript
// ❌ 절대 금지
alert('Success!');
window.alert('Something');

// ❌ 성공 메시지도 표시하지 않음
if (response.success) {
  alert('Saved successfully'); // 금지
}
```

### 1.2 성공 메시지 처리

```javascript
// ✅ 올바른 방법: 성공 시 알림 없이 처리
if (response.success) {
  setShowModal(false);  // 모달 닫기
  fetchData();          // 데이터 리프레시
  // 끝. 성공 메시지 표시 안함
}
```

### 1.3 에러 메시지 처리

```javascript
const [formError, setFormError] = useState<string | null>(null);

if (!response.success) {
  setFormError(response.message || 'Failed to save');
  return;
}
setFormError(null);
```

```jsx
{formError && <ErrorMessage>{formError}</ErrorMessage>}
<Button variant="primary" onClick={handleSubmit}>Save</Button>
```

### 1.4 삭제 확인

```javascript
// ✅ ConfirmDialog 컴포넌트 사용 (window.confirm 금지)
```

### 1.4-B 권한 부재 — "읽기 전용" 뱃지 (2026-05-10 사이클 N+5)

권한 분기로 편집 막힌 필드는 **회색 pill 뱃지로 시각화** + RichEditor/Input `readOnly`. disabled 처럼 보이는 것보다 명확.

```tsx
{!canEditBody && <ReadOnlyHint>{t('detail.readOnly', '읽기 전용')}</ReadOnlyHint>}
<RichEditor value={...} readOnly={!canEditBody} ... />

const ReadOnlyHint = styled.span`
  font-size:11px; font-weight:500;
  color:#94A3B8;            /* Text Tertiary */
  background:#F1F5F9;       /* Slate 100 */
  border-radius:10px;
  padding:2px 8px;
`;
```

본문 안 링크는 `RichEditor` 의 `Link.openOnClick: true + target='_blank'` 정책으로 **편집 권한 무관 항상 새 탭**. 권한 매트릭스는 `docs/PERMISSION_MATRIX.md` 참조.

### 1.4-C 자동값 vs 사용자값 시각 구분 — 회색 italic vs 검정 (2026-05-11 사이클 N+6)

시스템이 자동 채운 값 (AI 예측, 자동 누적 등) 과 사용자 직접 입력값을 시각적으로 구분.

```tsx
const NumInput = styled.input<{$ai?: boolean}>`
  color: ${p => p.$ai ? '#94A3B8' : '#0F172A'};
  font-style: ${p => p.$ai ? 'italic' : 'normal'};
  &:focus { color: #0F172A; font-style: normal; /* 편집 진입 = 즉시 검정 = 확정 시그널 */ }
`;
<NumInput $ai={source === 'ai' || source === 'auto'} ... />
```

규칙:
- 회색 italic = 시스템 자동값 (사용자 미확정)
- 검정 normal = 사용자 명시 입력 (확정)
- 사용자가 input 클릭하면 자동 검정 톤 전환 (별도 "확정" 버튼 X — 마찰 회피)
- tooltip: `"AI 자동 예측 — 직접 입력하면 확정됩니다"` 또는 `"진행 시작·완료 시 자동 누적 — 직접 입력하면 확정됩니다"`

적용처: Q Task 의 estimated_hours (`latest_estimation_source`) / actual_hours (`actual_source`).

### 1.4-D 라이브 dot indicator — 진행 중 시그널 (2026-05-11)

작업 중 status (in_progress 등) 일 때 라벨 옆 작은 ● dot + pulse 애니메이션 (Apple Watch 스톱워치 패턴). actual_hours 같은 시간 누적 필드에 의미.

```tsx
const InProgressDot = styled.span`
  display:inline-flex; align-items:center; gap:4px;
  font-size:10px; font-weight:600; color:#DC2626;
  > span { width:6px; height:6px; border-radius:50%; background:#DC2626; animation: pulse 1.4s ease-in-out infinite; }
  @keyframes pulse { 0%,100% { opacity:1; transform:scale(1); } 50% { opacity:0.4; transform:scale(0.8); } }
`;
```

위치 원칙: input row 안이 아니라 **라벨 옆** (input row 폭 영향 0, 인접 셀 wrap 차단).

### 1.4-E 자동 작동 안내 상시 노출 (2026-05-11)

자동으로 작동하는 기능 (시간 누적, AI 예측, status 자동 전환) 의 안내는 **tooltip 의존 금지** (모바일/터치 환경에서 발견 불가). caption 박스로 상시 inline 노출.

```tsx
const TimeAutoHint = styled.div`
  display:flex; align-items:center; gap:6px;
  margin-top:8px; padding:6px 10px;
  background:#F8FAFC; border:1px solid #F1F5F9; border-radius:6px;
  font-size:11px; color:#64748B; line-height:1.4;
`;
// 예: "진행 시작·완료 시 실제 시간이 자동 누적됩니다 (직접 입력하면 확정)"
```

조건부 강조 (예: 100% 도달 + reviewer 있음) 안내는 Primary teal 톤 (`#F0FDFA` bg + `#0F766E` text + `#5EEAD4` border) — 강조이지만 경고 아님.

### 1.4-F 모바일 bottom sheet — 풀스크린 모달 대체 (2026-05-11)

모바일 (≤640px) 에서 모달/picker 가 풀스크린이면 답답. **75vh bottom sheet** (Slack/Apple 정석) 사용.

```tsx
const Backdrop = styled.div`
  /* desktop: center modal */
  display:flex; align-items:center; justify-content:center; padding:20px;
  /* mobile: bottom sheet */
  @media (max-width: 640px) {
    align-items: flex-end; justify-content: stretch; padding: 0;
  }
`;
const Dialog = styled.div`
  border-radius:14px; max-width:560px; max-height:90vh;
  @media (max-width: 640px) {
    max-height: 75vh; height: auto;
    border-radius: 16px 16px 0 0;
    padding-bottom: env(safe-area-inset-bottom);
    animation: pq-sheet-up 0.22s ease-out;
  }
  @keyframes pq-sheet-up {
    from { transform: translateY(100%); }
    to   { transform: translateY(0); }
  }
`;
```

이점: 작업 영역만 75% 차지 + 위쪽 컨텍스트 25% 살짝 보여 사용자가 "어디서 호출했는지" 인지 유지. iPhone 노치 safe-area 보정.

### 1.4-G 모바일에서 hover-only 패턴 금지 (2026-05-11)

`opacity:0` + `parent:hover & { opacity:1 }` 같은 hover 등장 패턴은 **모바일에서 영영 안 보임**. 모바일 분기 필수.

```tsx
const ActionBtn = styled.button<{$active?: boolean}>`
  opacity: ${p => p.$active ? 1 : 0};
  ${ParentRow}:hover & { opacity: 1; }
  /* 모바일/터치: hover 없으니 항상 노출 */
  @media (hover: none), (max-width: 1024px) { opacity: 1; }
`;
```

적용 사례: QTalk LeftPanel PinBtn (즐겨찾기 별표) — 데스크탑은 hover-only 노이즈 최소화 / 모바일은 outline 별표 항상 노출.

### 1.5 이모지/아이콘 금지

- 페이지 내 안내 메시지에 이모지 사용 금지
- 국기 이모지(🇰🇷 🇺🇸 등) 사용 금지 — 언어는 텍스트("한국어", "English")로
- 아이콘 필요 시: `components/Common/Icons.tsx` (Feather-style stroke SVG, 사이드바와 동일 디자인 시스템)
- 텍스트만으로 명확하게 전달

### 1.6 셀렉트(드롭다운) — PlanQSelect 강제

- 모든 셀렉트는 `components/Common/PlanQSelect.tsx` 사용
- raw `<select>`, styled `select`, react-select 직접 import 금지 — 헬스체크 린트가 차단
- 검색 가능, 멀티 셀렉트, 아이콘/설명 옵션 지원
- **옵션이 많은 리스트 (시간, 50+ 항목)**: `density="compact"` prop 추가해 옵션 패딩 절반 (10px 12px → 5px 10px)

### 1.7 액션 버튼 3톤 규칙 (필수 — 2026-04-19 표준화)

**버튼은 딱 3종류만 사용한다. 상태 색(단계별 색상)을 버튼 배경으로 쓰지 말 것.**

| 톤 | 용도 | 스타일 |
|------|------|--------|
| **Primary** | 긍정 CTA (확인/저장/승인/완료/Ack/진행 시작 등) | 배경 `#14B8A6` (Primary 500), 호버 `#0D9488` (Primary 600), 흰 글자 |
| **Secondary** | 취소/닫기/보조 액션 (Cancel review 등) | 흰 배경 + `#CBD5E1` outline + `#334155` 글자 |
| **Danger** | 파괴적/부정 액션 (수정 요청, 결정 취소, 삭제) | 흰 배경 + `#FECACA` outline + `#DC2626` 글자, 호버 시 `#FEF2F2` 배경 |

**상태 색상(Teal/Blue/Coral/Gray)은 뱃지·진행바·드롭다운 옵션 같은 읽기 전용 UI에만 사용.**

**근거**: 다양한 상태 색으로 버튼을 칠하면 한 화면에 6~7색 버튼이 섞여 디자인이 난잡해지고, 브랜드 톤(Teal/Coral)이 희석됨. Phase C 초기 구현 후 Irene 피드백으로 통일.

### 1.8 중복 제출 방지

모든 "생성/추가/승인" 성격의 액션은 연타·중복 실행을 막아야 한다.

```tsx
const [submitting, setSubmitting] = useState(false);
const submit = async () => {
  if (submitting) return;                    // 가드 1
  setSubmitting(true);
  try { /* POST */ } finally { setSubmitting(false); }
};

<Btn onClick={submit} disabled={submitting}>  {/* 가드 2 */}
  {submitting ? '저장 중...' : '저장'}
</Btn>
```

**Enter 키로 저장 트리거 금지.** 멀티필드 폼에서 Enter는 오타·연타·IME 조합 과정에 쉽게 발화 → 의도치 않은 조기 제출. 필요한 경우 **Ctrl/Cmd+Enter**만 허용.

### 1.9 상세/드로어 패널은 URL 싱크

"리스트 클릭 → 우측 상세" 같은 패널은 새로고침 시 상태가 사라지면 안 됨. URL 쿼리로 싱크:

```tsx
// 열기
const sp = new URLSearchParams(location.search);
sp.set('task', String(taskId));
navigate(`${location.pathname}?${sp}`, { replace: true });

// mount 시 복원
const initialId = new URLSearchParams(location.search).get('task');
```

- 파라미터명: 단수형 엔티티 (task, client, project …)
- 닫기 시 파라미터 제거
- `replace: true` 로 뒤로가기 스택 오염 방지

### 1.10 메시지·발화 번역 표시 (Q note 패턴 — 2026-04-28)

대화/회의 등에서 양 언어 동시 표시가 필요할 때 — 원문 위, 번역 아래 옅은 회색 박스.

```tsx
<MessageText>{m.body}</MessageText>
{translated && <TranslatedText>{translated}</TranslatedText>}
```

표준 styled (Q talk `ChatPanel`, Q note 의 transcript 동일 톤):

```tsx
const TranslatedText = styled.div`
  margin-top: 4px;
  padding: 6px 10px;
  font-size: 13px;          /* 원문보다 1px 작게 */
  color: #64748B;           /* Text Subtle */
  background: #F8FAFC;      /* BG Secondary */
  border-left: 2px solid #CBD5E1;  /* Border Strong */
  border-radius: 6px;
  line-height: 1.5;
  white-space: pre-wrap;    /* 줄바꿈 보존 필수 */
`;
```

규칙:
- **`white-space: pre-wrap` + `word-break: break-word` 필수** — 번역에 줄바꿈/들여쓰기 보존
- **원문 자체에도 `white-space: pre-wrap`** — 사용자 입력 줄바꿈 보존 (`Shift+Enter`)
- 토글 OFF 면 번역 박스 자체 미렌더 (원문만)
- 빈 번역 ("" 또는 원문과 동일) 은 표시 X — robust filter

번역 데이터 정책:
- 메시지 발송 시 백엔드 비동기 LLM 호출 → DB 저장 → Socket.IO `message:translated` 이벤트 push
- 클라는 message:new 즉시 표시 (translations null) → message:translated 도착 시 갱신
- 폴링 fallback: 메시지 발송 4초 후 GET /messages 1회 — Socket.IO 못 받았을 때 보장
- 진입 시 GET 응답에 이미 translations 들어있으면 즉시 양 언어 표시

스크롤 정책:
- 채팅방 진입 → 무조건 마지막 메시지 (localStorage 위치 복원 X)
- 본인 메시지 발송 → 무조건 sticky-to-bottom (거리 무시)
- 타인 메시지 도착 → 거리 120px 이내면 따라감
- 번역 도착 (메시지 카드 높이 증가) → 200px 이내면 따라감 (가려지지 않게)

---

## 2. 페이지 레이아웃 (필수 — 2026-04-17 표준화)

**모든 신규 페이지는 아래 2가지 레이아웃 중 하나만 사용한다. 페이지 루트에 직접 styled `<Page>`/`<Header>` 선언 금지.**

### 2.1 단일 컬럼 페이지 — `PageShell`

설정·프로필·목록(고객/업무/문서) 페이지에 사용.

```tsx
import PageShell from '../../components/Layout/PageShell';

<PageShell
  title={t('page.title')}
  count={items.length}                 // 제목 옆 카운트 (선택)
  actions={<><SearchInput/><Btn/></>}  // 헤더 우측 (선택)
>
  {/* 본문 */}
</PageShell>
```

잠긴 표준값:
- 헤더 `min-height: 60px`, `padding: 14px 20px`, 배경 `#fff`, border-bottom `#e2e8f0`
- 제목 `18px / 700 / -0.2px`
- 페이지 배경 `#f8fafc`, Body padding 20px

### 2.2 멀티 컬럼(패널) 페이지 — `PanelHeader`

Q Talk/Note/Task 3컬럼. 모든 패널 `min-height: 60px` → 가로 border-bottom 수평 연결.

```tsx
import PanelHeader, { PanelTitle, PanelSubTitle, PanelMetaTitle }
  from '../../components/Layout/PanelHeader';

<PanelHeader><PanelTitle>Q talk</PanelTitle></PanelHeader>        // 앱 타이틀 18px
<PanelHeader><PanelSubTitle>{chat.name}</PanelSubTitle></PanelHeader> // 항목명 16px
<PanelHeader><PanelMetaTitle>프로젝트 작업대</PanelMetaTitle></PanelHeader> // 섹션 13px
```

### 2.3 금지
- 헤더에 부제목을 **아래줄로** 쌓기 금지 (메타는 제목 옆 인라인)
- 헤더 높이·padding·폰트 커스터마이즈 금지
- 페이지마다 `<Page>`/`<Header>` styled 따로 선언 금지

### 2.4 관리 리스트/섹션 — 헤더 + 검색 + 추가 버튼 공통 패턴 (필수 — 2026-04-22)

고객·멤버·프로젝트 고객·파일 등 **"조회 + 검색 + 추가(초대)" 3요소**를 가진 리스트 페이지/섹션은 아래 구조 고정.

**A. 페이지 전체가 리스트인 경우** — `PageShell` actions 슬롯 사용 (고객 관리 `/business/clients` 기준)
```tsx
<PageShell
  title={t('page.title')}
  count={filtered.length}
  actions={<>
    <SearchBox value={q} onChange={setQ} placeholder="..." width={240} />
    <FilterSeg>...</FilterSeg>               {/* 선택 */}
    {isAdmin && <InviteBtn onClick={...}>＋ 초대</InviteBtn>}
  </>}
>
  {/* 본문 — Table 또는 Card List */}
</PageShell>
```

**B. 설정 탭 내 리스트 섹션인 경우** — `Card` 상단 `SectionHeaderRow` 사용 (워크스페이스 설정 멤버 섹션 기준)
```tsx
<Card>
  <SectionHeaderRow>
    <div>
      <SectionTitle>...</SectionTitle>
      <SectionDesc>...</SectionDesc>
    </div>
    {isAdmin && <InvitePrimaryBtn>＋ 초대</InvitePrimaryBtn>}
  </SectionHeaderRow>
  {/* 인라인 초대 박스 또는 모달 */}
  {/* 리스트 */}
</Card>
```

**잠긴 표준값 — 초대 버튼 (InviteBtn / InvitePrimaryBtn):**
- `display:inline-flex; align-items:center; gap:6px`
- `height:32px; padding:0 14px`
- 배경 `#14B8A6` (Primary 500) / hover `#0D9488`
- `color:#FFF; font-size:13px; font-weight:700; border-radius:8px`
- **아이콘 + 텍스트** — SVG `+` 14×14px, strokeWidth 2.2

**초대 UX — 입력 필드 개수로 분기:**
- 필드 **1개 (이메일만)** → **인라인 박스** (Card 내부 `InviteBox` 펼침/접기)
- 필드 **2개 이상** → **모달** (고객 초대: 이름·이메일·회사명)

**검색 — 리스트 항목 수에 따라:**
- 평균 20개 미만이면 생략 가능 (멤버처럼 소규모)
- 20개 이상 가능성이 있으면 `SearchBox` 추가 (고객처럼 중규모)

**금지:**
- 페이지/섹션마다 InviteBtn 스타일 따로 정의 금지 — 반드시 위 표준값 준수
- 인라인 박스 vs 모달 혼용 금지 — 필드 수 기준으로 선택

---

## 3. 공통 컴포넌트 사용

### 3.1 필수 Import

```typescript
import {
  Container, Header, Title, ActionSection, Content, Button
} from '../../components/UI';

import {
  StatsGrid, StatCard, StatValue, StatLabel, StatDescription
} from '../../components/UI';

import { FilterBar, SearchInput, FilterSelect } from '../../components/Common/FilterComponents';

import {
  Modal, ModalWarning, FormRow, FormGroup, FormLabel,
  FormInput, FormSelect, FormTextArea, ModalButton
} from '../../components/UI';

import {
  Table, TableHeader, TableRow, EmptyState
} from '../../components/UI';
```

### 2.2 페이지 구조

```jsx
<MainLayout>
  <Container>
    <Header>
      <Title>Page Title</Title>
      <ActionSection>
        <Button variant="primary" onClick={handleAdd}>Add New</Button>
      </ActionSection>
    </Header>
    <Content>
      <StatsGrid><StatCard>...</StatCard></StatsGrid>
      <FilterBar>
        <SearchInput placeholder="Search..." />
        <FilterSelect>...</FilterSelect>
      </FilterBar>
      <Table>...</Table>
    </Content>
  </Container>
</MainLayout>
```

---

## 3. 컬러 팔레트

> **전체 색상 체계는 `COLOR_GUIDE.md` 참조.** 아래는 핵심 요약.

| 용도 | 색상 코드 | 사용처 |
|------|-----------|--------|
| Primary | `#14B8A6` | 주요 버튼, 포커스 링, 입력 포커스 보더 |
| Primary Hover | `#0D9488` | 버튼 호버, 텍스트 링크 |
| Primary Press | `#0F766E` | 버튼 프레스, 사이드바 활성 메뉴 |
| Text Primary | `#0F172A` | 제목, 본문 |
| Text Secondary | `#475569` | 부제목, 라벨 |
| Text Tertiary | `#94A3B8` | 힌트, 플레이스홀더 |
| Border | `#E2E8F0` | 테두리, 구분선 |
| Background | `#F8FAFC` | 페이지 배경 |
| Card Background | `#FFFFFF` | 카드, 모달 |

### 3.2 상태 색상

| 상태 | Background | Text Color |
|------|------------|------------|
| Success | `#F0FDF4` | `#16A34A` |
| Error | `#FEF2F2` | `#DC2626` |
| Warning | `#FFFBEB` | `#D97706` |
| Info | `#F0F9FF` | `#0284C7` |

---

## 4. 버튼 스타일

```jsx
<Button variant="primary">Save</Button>
<Button variant="secondary">Cancel</Button>
<Button variant="danger">Delete</Button>
```

| Size | padding |
|------|---------|
| small | 8px 14px |
| medium | 12px 20px (기본) |
| large | 16px 28px |

---

## 5. 모달 사용

```jsx
<Modal isOpen={showModal} onClose={() => setShowModal(false)} title="Modal Title" size="medium"
  footer={<>
    <ModalButton variant="secondary" onClick={() => setShowModal(false)}>Cancel</ModalButton>
    <ModalButton variant="primary" onClick={handleSubmit} disabled={saving}>
      {saving ? 'Saving...' : 'Save'}
    </ModalButton>
  </>}>
  <FormGroup>
    <FormLabel>Field Name</FormLabel>
    <FormInput value={value} onChange={handleChange} />
  </FormGroup>
  {formError && <ModalWarning>{formError}</ModalWarning>}
</Modal>
```

| Size | Max Width |
|------|-----------|
| small | 400px |
| medium | 600px |
| large | 800px |

---

## 6. 금지 사항 체크리스트

### 절대 하지 말 것

- alert() 사용
- 성공 메시지 팝업/토스트 표시
- 이모지를 UI 텍스트에 사용
- 공통 컴포넌트 무시하고 직접 스타일 작성

### 반드시 할 것

- 에러 메시지는 버튼 근처에 인라인으로 표시
- 성공 시 모달 닫기 + 데이터 리프레시만
- 공통 UI 컴포넌트 import해서 사용
- 삭제 확인은 ConfirmDialog 사용

---

## 7. 자동저장 (AutoSaveField) — 필수 적용

### 7.1 핵심 규칙

**PlanQ의 모든 입력 폼에서 저장이 필요한 곳은 AutoSaveField를 사용한다.**
- 저장 버튼 없음 → 입력하면 자동 저장
- 성공 시 ✓ 뱃지만 잠깐 표시, 팝업/토스트 없음
- 에러 시 ! 뱃지 표시 (4초 후 자동 사라짐)

### 7.2 적용 대상

| 페이지 | 자동저장 적용 필드 |
|--------|-----------------|
| 설정 (Settings) | 모든 설정 필드 (이름, 로고, 토글 등) |
| 고객 상세 (Client Detail) | 표시이름, 회사명, 메모 |
| 할일 상세 (Task Detail) | 제목, 설명, 담당자, 마감일, 우선순위 |
| 청구서 작성 (Bill Create) | **예외: 저장 버튼 사용** (항목 추가/삭제가 복잡) |
| 프로필 (Profile) | 이름, 전화번호, 아바타, **Q Note 프로필**(회사/직책/전문분야/자기소개) |

### 7.3 Debounce 타이밍

| 필드 타입 | Debounce | 이유 |
|----------|----------|------|
| input (텍스트) | 2000ms | 타이핑 완료 대기 |
| select (드롭다운) | 300ms | 클릭 즉시 반영 |
| toggle (스위치) | 300ms | 클릭 즉시 반영 |
| image (이미지) | 300ms | 업로드 즉시 반영 |
| list (목록) | 300ms | 추가/삭제 즉시 반영 |

### 7.4 사용법

```typescript
import AutoSaveField, { AutoSaveHandle } from '../../components/Common/AutoSaveField';

// 기본 사용 (input — onChange 자동 감지)
<AutoSaveField onSave={handleSave}>
  <FormInput value={name} onChange={(e) => setName(e.target.value)} />
</AutoSaveField>

// Select
<AutoSaveField type="select" onSave={handleSave}>
  <FormSelect value={status} onChange={(e) => setStatus(e.target.value)}>
    <option value="active">Active</option>
  </FormSelect>
</AutoSaveField>

// Toggle — 래퍼가 click 을 받는다. ref·triggerSave 불필요.
<AutoSaveField type="toggle" onSave={handleSave}>
  <Switch type="button" role="switch" aria-checked={enabled}
    data-testid="myscreen-toggle-enabled"
    onClick={() => setEnabled(!enabled)}>
    <SwitchKnob $on={enabled} />
  </Switch>
</AutoSaveField>
```

> ⚠️ **toggle 래퍼 안에는 저장 대상 컨트롤만 둔다.** 저장과 무관한 클릭 요소가 필요하면 래퍼 밖에.
>
> **옛 문서는 `ref` + `triggerSave()` 를 수동으로 부르라고 했는데, 실제 사용처 5곳이 전부
> 그것을 빠뜨려 눌러도 저장이 안 됐다** — 운영 **점검 모드** 스위치 포함(2026-09-02).
> 원인은 `AutoSaveField` 가 자식의 `onChange` 만 감쌌던 것이다. 토글은 전부 `<button onClick>`
> 이거나 안쪽에 input 을 감싼 `<label>` 이라 직접 자식에 `onChange` 가 없다.
> 지금은 `type="toggle"` 이면 **Wrapper 가 onClick 을 받는다** — click 이 버블링하므로
> button·checkbox·안쪽 버튼 무엇이든 닿고, 키보드(Space/Enter)도 같다.
> 회귀는 `node scripts/e2e/run.js --suite toggles` 가 **눌러서** 잡는다.

### 7.5 뱃지 위치

| 타입 | 위치 |
|------|------|
| input | 입력 필드 오른쪽 내부 |
| select | 오른쪽 상단 코너 (-6px) |
| toggle | 토글 오른쪽 중앙 |
| image | 오른쪽 하단 (12px) |
| list | 오른쪽 상단 코너 (-8px) |

### 7.6 상태 표시

| 상태 | 아이콘 | 색상 | 지속시간 |
|------|--------|------|---------|
| saving | 스피너 | #E6EBF1 / #8898AA | 저장 완료까지 |
| saved | ✓ 원형 | #D1FAE5 bg / #065F46 text | 2초 후 페이드아웃 |
| error | ! 원형 | #EF4444 bg / white text | 4초 후 페이드아웃 |

---

**마지막 업데이트:** 2026-04-08
**기준:** PlanQ 공통 컴포넌트 (POS 구조 기반)
