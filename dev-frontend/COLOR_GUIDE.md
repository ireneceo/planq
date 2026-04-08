# PlanQ 디자인 컬러 시스템

> **이 문서에 정의된 색상만 사용한다. 새 색상 추가 금지.**
> **CSS 변수명은 섹션 11 참조. styled-components에서도 동일 변수 사용.**

---

## 1. 브랜드 컬러 — Primary (딥 틸)

| 단계 | HEX | 용도 |
|------|-----|------|
| Primary 50 | `#F0FDFA` | 선택 항목 배경 |
| Primary 100 | `#CCFBF1` | 호버 배경, 뱃지/태그 배경 |
| Primary 200 | `#99F6E4` | 태그 배경, 선택 항목 보더, 사이드바 아이콘 |
| Primary 300 | `#5EEAD4` | 비활성 보더, 사이드바 아이콘, 로고 "Q" 강조 |
| Primary 400 | `#2DD4BF` | 아이콘, 서브 텍스트 |
| **Primary 500** | **`#14B8A6`** | **버튼, 링크, 포커스 링, 입력 포커스 보더** |
| **Primary 600** | **`#0D9488`** | **버튼 호버, 활성 탭, 텍스트 링크** |
| Primary 700 | `#0F766E` | 프레스 상태, 강조 보더, 사이드바 활성 메뉴 BG |
| Primary 800 | `#115E59` | 사이드바 BG 상단, 뱃지 텍스트 |
| Primary 900 | `#134E4A` | 사이드바 BG 하단 |

### Primary 적용 규칙

| 용도 | 색상 |
|------|------|
| 버튼 기본 | Primary 500 `#14B8A6` |
| 버튼 호버 | Primary 600 `#0D9488` |
| 버튼 프레스/액티브 | Primary 700 `#0F766E` |
| 버튼 비활성 | Primary 300 `#5EEAD4` + opacity 0.5 |
| 텍스트 링크 | Primary 600 `#0D9488` |
| 텍스트 링크 호버 | Primary 700 `#0F766E` |
| 포커스 링 | Primary 500 + opacity 0.3 (box-shadow) |
| 입력 필드 포커스 보더 | Primary 500 `#14B8A6` |
| 선택된 항목 배경 | Primary 50 `#F0FDFA` |
| 선택된 항목 보더 | Primary 200 `#99F6E4` |
| 사이드바 배경 | Primary 800 → Primary 900 그라데이션 |
| 사이드바 텍스트 | `#FFFFFF` |
| 사이드바 아이콘 | Primary 200 `#99F6E4` |
| 사이드바 활성 메뉴 BG | Primary 700 `#0F766E` |
| 로그인 좌측 패널 배경 | Primary 600 → Primary 900 그라데이션 |
| 뱃지/태그 배경 | Primary 100 `#CCFBF1` |
| 뱃지/태그 텍스트 | Primary 800 `#115E59` |

---

## 2. 시맨틱 컬러 (상태/의미)

### Success (성공/완료)

| 단계 | HEX | 용도 |
|------|-----|------|
| Success 50 | `#F0FDF4` | 성공 알림 배경 |
| Success 100 | `#DCFCE7` | 성공 뱃지 배경 |
| Success 500 | `#22C55E` | 성공 아이콘, 보더 |
| Success 600 | `#16A34A` | 성공 텍스트 |
| Success 800 | `#166534` | 성공 뱃지 텍스트 |

### Warning (경고/주의)

| 단계 | HEX | 용도 |
|------|-----|------|
| Warning 50 | `#FFFBEB` | 경고 알림 배경 |
| Warning 100 | `#FEF3C7` | 경고 뱃지 배경 |
| Warning 500 | `#F59E0B` | 경고 아이콘, 보더 |
| Warning 600 | `#D97706` | 경고 텍스트 |
| Warning 800 | `#92400E` | 경고 뱃지 텍스트 |

### Error (에러/위험)

| 단계 | HEX | 용도 |
|------|-----|------|
| Error 50 | `#FEF2F2` | 에러 알림 배경 |
| Error 100 | `#FEE2E2` | 에러 뱃지 배경, 입력 에러 배경 |
| Error 500 | `#EF4444` | 에러 아이콘, 보더 |
| Error 600 | `#DC2626` | 에러 텍스트, 입력 에러 보더 |
| Error 800 | `#991B1B` | 에러 뱃지 텍스트 |

### Info (정보/안내)

| 단계 | HEX | 용도 |
|------|-----|------|
| Info 50 | `#F0F9FF` | 안내 알림 배경 |
| Info 100 | `#E0F2FE` | 안내 뱃지 배경 |
| Info 500 | `#0EA5E9` | 안내 아이콘, 보더 |
| Info 600 | `#0284C7` | 안내 텍스트 |
| Info 800 | `#075985` | 안내 뱃지 텍스트 |

---

## 3. Q Task 상태 컬러

| 상태 | 배경 | 보더 | 도트 | 텍스트 |
|------|------|------|------|--------|
| 대기 (pending) | `#F8FAFC` | `#E2E8F0` | `#94A3B8` | `#475569` |
| 진행중 (in_progress) | `#FFFBEB` | `#FDE68A` | `#D97706` | `#92400E` |
| 완료 (completed) | `#F0FDF4` | `#BBF7D0` | `#16A34A` | `#14532D` |
| 취소 (canceled) | `#F8FAFC` | `#E2E8F0` | `#94A3B8` | `#94A3B8` (취소선) |

### Q Task 마감 컬러

| 상태 | 뱃지 배경 | 뱃지 텍스트 | 아이콘 |
|------|----------|-----------|--------|
| 지연 (마감 지남) | `#FEF2F2` | `#991B1B` | `#DC2626` |
| 오늘 마감 | `#FFF7ED` | `#9A3412` | `#EA580C` |
| 임박 (3일 내) | `#FFFBEB` | `#92400E` | `#D97706` |
| 여유 | 없음 | `#64748B` | 없음 |

---

## 4. Q Bill 상태 컬러

| 상태 | 뱃지 배경 | 뱃지 텍스트 | 도트 |
|------|----------|-----------|------|
| 작성중 (draft) | `#F8FAFC` | `#475569` | `#94A3B8` |
| 발송됨 (sent) | `#F0F9FF` | `#075985` | `#0EA5E9` |
| 입금완료 (paid) | `#F0FDF4` | `#166534` | `#22C55E` |
| 연체 (overdue) | `#FEF2F2` | `#991B1B` | `#DC2626` |
| 취소 (canceled) | `#F8FAFC` | `#94A3B8` | `#CBD5E1` |

---

## 5. Neutral 컬러 (텍스트/배경/보더)

### 텍스트

| 용도 | HEX |
|------|-----|
| Text Primary | `#0F172A` |
| Text Secondary | `#475569` |
| Text Tertiary | `#94A3B8` |
| Text Inverse | `#FFFFFF` |

### 배경

| 용도 | HEX |
|------|-----|
| BG Primary | `#FFFFFF` |
| BG Secondary | `#F8FAFC` |
| BG Tertiary | `#F1F5F9` |

### 보더

| 용도 | HEX |
|------|-----|
| Border Light | `#F1F5F9` |
| Border Default | `#E2E8F0` |
| Border Strong | `#CBD5E1` |
| Border Dark | `#94A3B8` |

---

## 6. 우선순위 컬러 (Q Task)

| 우선순위 | 뱃지 배경 | 뱃지 텍스트 | 아이콘 |
|---------|----------|-----------|--------|
| 긴급 (urgent) | `#FEF2F2` | `#991B1B` | `#DC2626` |
| 높음 (high) | `#FFF7ED` | `#9A3412` | `#EA580C` |
| 보통 (medium) | `#F0F9FF` | `#075985` | `#0EA5E9` |
| 낮음 (low) | `#F8FAFC` | `#475569` | `#94A3B8` |

---

## 7. 사이드바 컬러

| 요소 | HEX |
|------|-----|
| 배경 (그라데이션 상단) | `#115E59` (Primary 800) |
| 배경 (그라데이션 하단) | `#134E4A` (Primary 900) |
| 메뉴 텍스트 (기본) | `#CCFBF1` (Primary 100) |
| 메뉴 텍스트 (활성) | `#FFFFFF` |
| 메뉴 아이콘 (기본) | `#5EEAD4` (Primary 300) |
| 메뉴 아이콘 (활성) | `#FFFFFF` |
| 활성 메뉴 배경 | `#0F766E` (Primary 700) |
| 호버 배경 | `rgba(255,255,255,0.08)` |
| 구분선 | `rgba(255,255,255,0.1)` |
| 로고 텍스트 | `#FFFFFF` |
| 로고 "Q" 강조 | `#5EEAD4` (Primary 300) |

---

## 8. 입력 필드 컬러

| 상태 | 배경 | 보더 | 텍스트 | 플레이스홀더 |
|------|------|------|--------|------------|
| 기본 | `#F8FAFC` | `#E2E8F0` | `#0F172A` | `#94A3B8` |
| 호버 | `#F8FAFC` | `#CBD5E1` | `#0F172A` | `#94A3B8` |
| 포커스 | `#FFFFFF` | `#14B8A6` | `#0F172A` | `#94A3B8` |
| 에러 | `#FEF2F2` | `#DC2626` | `#0F172A` | `#94A3B8` |
| 비활성 | `#F1F5F9` | `#E2E8F0` | `#94A3B8` | `#CBD5E1` |

---

## 9. 버튼 컬러

### Primary 버튼 (채움)

| 상태 | 배경 | 텍스트 | 보더 |
|------|------|--------|------|
| 기본 | `#14B8A6` | `#FFFFFF` | 없음 |
| 호버 | `#0D9488` | `#FFFFFF` | 없음 |
| 프레스 | `#0F766E` | `#FFFFFF` | 없음 |
| 비활성 | `#99F6E4` | `#FFFFFF` (opacity 0.7) | 없음 |

### Secondary 버튼 (아웃라인)

| 상태 | 배경 | 텍스트 | 보더 |
|------|------|--------|------|
| 기본 | 투명 | `#0D9488` | `#E2E8F0` |
| 호버 | `#F0FDFA` | `#0F766E` | `#0D9488` |
| 프레스 | `#CCFBF1` | `#0F766E` | `#0D9488` |
| 비활성 | 투명 | `#94A3B8` | `#E2E8F0` |

### Ghost 버튼 (텍스트만)

| 상태 | 배경 | 텍스트 |
|------|------|--------|
| 기본 | 투명 | `#0D9488` |
| 호버 | `#F0FDFA` | `#0F766E` |

### Danger 버튼

| 상태 | 배경 | 텍스트 |
|------|------|--------|
| 기본 | `#DC2626` | `#FFFFFF` |
| 호버 | `#B91C1C` | `#FFFFFF` |

---

## 10. POS → PlanQ 매핑표

| 용도 | POS | PlanQ |
|------|-----|-------|
| Primary (버튼, 포커스, 링크) | `#635BFF` | `#14B8A6` |
| Primary hover | `#5147E5` | `#0D9488` |
| Primary light (포커스 링) | `rgba(99,91,255,0.1)` | `rgba(20,184,166,0.1)` |
| Error (에러 텍스트, 보더) | `#DC2626` | `#DC2626` (동일) |
| 로그인 좌측 패널 배경 | `#635BFF` 그라데이션 | `#0D9488` → `#134E4A` 그라데이션 |
| 사이드바 배경 | `#635BFF` 계열 | `#115E59` → `#134E4A` |
| 활성 메뉴 배경 | `#5147E5` | `#0F766E` |

---

## 11. CSS 변수 (개발용)

```css
:root {
  /* Primary */
  --color-primary-50: #F0FDFA;
  --color-primary-100: #CCFBF1;
  --color-primary-200: #99F6E4;
  --color-primary-300: #5EEAD4;
  --color-primary-400: #2DD4BF;
  --color-primary-500: #14B8A6;
  --color-primary-600: #0D9488;
  --color-primary-700: #0F766E;
  --color-primary-800: #115E59;
  --color-primary-900: #134E4A;

  /* Neutral */
  --color-neutral-50: #F8FAFC;
  --color-neutral-100: #F1F5F9;
  --color-neutral-200: #E2E8F0;
  --color-neutral-300: #CBD5E1;
  --color-neutral-400: #94A3B8;
  --color-neutral-500: #64748B;
  --color-neutral-600: #475569;
  --color-neutral-700: #334155;
  --color-neutral-800: #1E293B;
  --color-neutral-900: #0F172A;

  /* Success */
  --color-success-50: #F0FDF4;
  --color-success-100: #DCFCE7;
  --color-success-500: #22C55E;
  --color-success-600: #16A34A;
  --color-success-800: #166534;

  /* Warning */
  --color-warning-50: #FFFBEB;
  --color-warning-100: #FEF3C7;
  --color-warning-500: #F59E0B;
  --color-warning-600: #D97706;
  --color-warning-800: #92400E;

  /* Error */
  --color-error-50: #FEF2F2;
  --color-error-100: #FEE2E2;
  --color-error-500: #EF4444;
  --color-error-600: #DC2626;
  --color-error-800: #991B1B;

  /* Info */
  --color-info-50: #F0F9FF;
  --color-info-100: #E0F2FE;
  --color-info-500: #0EA5E9;
  --color-info-600: #0284C7;
  --color-info-800: #075985;

  /* Text */
  --color-text-primary: #0F172A;
  --color-text-secondary: #475569;
  --color-text-tertiary: #94A3B8;
  --color-text-inverse: #FFFFFF;

  /* Background */
  --color-bg-primary: #FFFFFF;
  --color-bg-secondary: #F8FAFC;
  --color-bg-tertiary: #F1F5F9;

  /* Border */
  --color-border-light: #F1F5F9;
  --color-border-default: #E2E8F0;
  --color-border-strong: #CBD5E1;
  --color-border-dark: #94A3B8;

  /* Sidebar */
  --color-sidebar-bg-top: #115E59;
  --color-sidebar-bg-bottom: #134E4A;
  --color-sidebar-text: #CCFBF1;
  --color-sidebar-text-active: #FFFFFF;
  --color-sidebar-icon: #5EEAD4;
  --color-sidebar-active-bg: #0F766E;
  --color-sidebar-hover-bg: rgba(255, 255, 255, 0.08);
  --color-sidebar-divider: rgba(255, 255, 255, 0.1);

  /* Button */
  --color-btn-primary: #14B8A6;
  --color-btn-primary-hover: #0D9488;
  --color-btn-primary-press: #0F766E;
  --color-btn-danger: #DC2626;
  --color-btn-danger-hover: #B91C1C;
}
```

---

## 12. 사용 규칙

1. **Primary 색상은 액션 요소에만 사용.** 버튼, 링크, 포커스. 본문 텍스트에 쓰지 않는다 (링크 제외).
2. **상태 색상(Success/Warning/Error)은 시맨틱하게만 사용.** 성공이 아닌 곳에 초록을 쓰지 않는다.
3. **텍스트는 Neutral 계열만 사용.**
4. **뱃지/태그는 같은 계열의 연한 배경 + 진한 텍스트.** 예: Success 100 배경 + Success 800 텍스트.
5. **사이드바는 Primary 800~900 그라데이션.** 메뉴 텍스트는 Primary 100, 아이콘은 Primary 300.
6. **에러 색상은 `#DC2626` 고정.**
7. **보더는 `#E2E8F0` 기본.** 호버 시 `#CBD5E1`, 포커스 시 `#14B8A6`.
8. **위 목록에 없는 색상 사용 금지.**
9. **이모지를 아이콘 대신 사용 금지.**
