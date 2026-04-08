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
- 텍스트만으로 명확하게 전달

---

## 2. 공통 컴포넌트 사용

### 2.1 필수 Import

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
| 프로필 (Profile) | 이름, 전화번호, 아바타 |

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
