# AI 업무 추가 — 자연어 → 업무 자동 분해

> **사이클 N+1 핵심 기능 (2026-05-08)**
> 자연어 한 줄 입력 → AI 가 단일 또는 다중 업무로 분해 → 미리보기 → 일괄 확정.

---

## 1. 진입점

| 위치 | UI |
|---|---|
| Q task 페이지 [+ ▼] | "직접 입력" / **"AI 로 만들기 ✨"** / "템플릿 적용" |
| 프로젝트 → 업무 탭 [+ ▼] | 동일 (프로젝트 컨텍스트 추가 주입) |
| 단축키 ⌘+T | AI 모달 직접 열기 (선택) |

## 2. 모달 흐름 — 단일 모달 안에서 끝남

```
1. 자연어 입력 (textarea + 큰 [AI 로 만들기 ✨] 버튼)
   - 컨텍스트 자동 표시: 프로젝트·멤버·오늘 날짜
   - ⌘+Enter 제출
2. AI 분석 중 (로딩 spinner + 살짝 떨리는 점)
3. 미리보기 카드 리스트 (인라인 편집 가능)
   - 제목·시간·날짜·담당자·우선순위·의존성
   - 결과물 기반 명명 강제 — 부적절 단어 (디자인·조사) ⚠ 표시 + 권장
4. [모두 추가 (선택 N개)] / [수정 모드] / [다시 생성]
5. 확정 → 일괄 task 생성
```

**페이지 이동 X** — 모달 안에서 모든 편집·확정. (Irene 의 "다른 탭 갈 일 없음" 요구)

## 3. LLM 프롬프트 (요약)

```
역할: project planning expert
정책:
  - 업무명은 결과물 기반 (시장조사 X → 경쟁사 비교분석표 작성 O)
  - estimated_hours 1~80 합리적
  - duration_days 일정 분배 (주말 제외)
  - 의존성 (depends_on_index) 식별
  - 담당자 추천 (멤버 역할 + role_hint 매핑, 없으면 null)
  - 사용자 입력의 마감일 / 기간 준수
출력 (JSON):
{
  "tasks": [{ title, estimated_hours, duration_days,
              start_offset_days, due_offset_days,
              priority, assignee_hint, depends_on_index }],
  "reasoning": "..."
}
```

전체 프롬프트는 `dev-backend/services/aiTaskPlanner.js` (사이클 N+1 신규).

## 4. API

```
POST /api/tasks/ai-create
Body: { business_id, project_id?, prompt, target_date? }
Response: { candidates: [...], reasoning: "..." }
   ↑ DB 저장 X — 미리보기만

POST /api/tasks/ai-create/confirm
Body: { candidates: [...] (사용자 편집 후) }
Response: { created: [{id, title, ...}, ...] }
   ↑ 일괄 task 생성 + 의존성 변환 + assignee 매핑
```

## 5. 담당자 매핑 정책

| 진입 위치 | default |
|---|---|
| Q task | 모두 본인 (assignee_id = me) |
| 프로젝트 → 업무 탭 | LLM 의 assignee_hint → 워크스페이스 멤버 매칭. 매칭 실패 시 NULL |

매칭 로직 — fuzzy:
- LLM 이 "디자이너" 추천 → BusinessMember.job_title 또는 expertise 검색
- 일치 멤버 1명이면 자동 assign
- 다수 또는 0명이면 NULL (사용자 직접 선택)

## 6. 예측 시간 — task_estimations.source 활용

기존 `task_estimations` 테이블 (source ENUM 'ai'/'user') 그대로 사용.

| 시점 | 동작 |
|---|---|
| AI 생성 | source='ai' row 자동 생성. tasks.estimated_hours 도 동기. |
| 사용자 인라인 수정 | source='user' row 추가. user 우선 (회색 → 검정 톤 변경) |

UI 분기:
- `task_estimations` 응답에 source 포함
- 가장 최신 user 가 있으면 검정, ai 만 있으면 회색 + ✨ 아이콘

## 7. 결과물 기반 업무명 정책 (메모리 박제)

LLM 프롬프트에 강제:
```
잘못된 예: "디자인", "시장조사", "고객 미팅"
올바른 예: "메인 페이지 디자인 시안 작성",
          "경쟁사 비교분석표 작성",
          "신규 고객사 미팅 회의록 작성"
```

미리보기 단계에서 부적절 단어 발견 시 카드에 작은 ⚠ 표시 + 추천 변경 버튼.

## 8. 통합 — AI ↔ 템플릿 추천 (★)

자연어 입력 분석 시 시스템 + 사용자 템플릿 중 매칭도 ≥ 0.80 일 때만 추천 배너 노출.

```
사용자: "WordPress 블로그 사이트 개발"
        ↓
LLM matched: "WordPress 사이트 개발" 템플릿 (0.95)
        ↓
미리보기 위에 작은 배너:
┌────────────────────────────────────────┐
│ 💡 비슷한 템플릿 — [WordPress 사이트 개발]│
│   12 업무, 21일 · 95% 매칭              │
│   [이 템플릿 사용] [AI 가 새로 만들기 ✕] │
└────────────────────────────────────────┘
```

매칭 < 0.80 = 추천 X (시각 노이즈 방지).

## 9. 작업 항목 (사이클 N+1)

- DB: `task_estimations.source` 활용 (이미 있음)
- 백엔드: `services/aiTaskPlanner.js` 신규 — LLM 호출 + JSON 파싱
- 백엔드: `routes/tasks.js` 에 `/ai-create` + `/confirm` 추가
- 프론트: `components/QTask/AiTaskCreateModal.tsx` 신규
- 프론트: 미리보기 카드 인라인 편집 + ⚠ 결과물 명명 검증
- 프론트: AI 추천 배너 (≥ 0.80)
