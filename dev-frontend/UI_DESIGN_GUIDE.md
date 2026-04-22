# UI/UX 통합 디자인 가이드

> **이 문서는 모든 새 기능 개발 시 반드시 참조해야 합니다.**
> 기준 페이지: PlanQ Pages (DashboardPage, BusinessPage, MembersPage)
> **색상 사용:** `COLOR_GUIDE.md` 참조 — 허용된 색상만 사용. 이모지 아이콘 사용 금지.

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

// Toggle — ref로 수동 트리거
const toggleRef = useRef<AutoSaveHandle>(null);

<AutoSaveField ref={toggleRef} type="toggle" onSave={handleSave}>
  <ToggleSwitch checked={enabled} onChange={(val) => {
    setEnabled(val);
    toggleRef.current?.triggerSave();
  }} />
</AutoSaveField>
```

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
