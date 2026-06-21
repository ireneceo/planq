# AI 템플릿 추천 — 서비스 기획서

> 작성: 2026-06-21. 사이클 N+1 `project_task_templates` 의 "AI 추천" 미구현 부분 완성.
> 관련 메모리: `project_task_templates`, `feedback_ai_recommendation_threshold`, `project_kb_engine_reuse`, `feedback_no_popup_on_popup`.

## 1. 한 줄 정의

사용자가 **AI 업무 추가**에 자연어를 입력하면, AI가 새로 분해하기 **전에** "이거 당신이 저장해둔 템플릿이랑 거의 같아요"를 감지해 **검증된 템플릿 재사용**을 권한다. (지금은 AI 생성과 템플릿이 따로 놀아서 매번 맨바닥부터 생성)

## 2. 왜 (가치)

- 같은 종류의 일을 반복하는 회사일수록, 매번 AI가 미묘하게 다르게 만드는 것보다 **한 번 검증한 템플릿 재사용**이 정확·일관·빠름.
- AI 호출(비용) 절감 + "아 맞다 그거 있었지" 의 재발견.
- 차별화: 자연어 + AI + 템플릿의 결합 (Asana/ClickUp/Linear 에 없음).

## 3. 사용자 시나리오 (실데이터)

직원이 AI 업무 추가에 입력: *"새 고객사 들어와서 온보딩 준비해야 해"*
→ 입력칸 아래 (생성 버튼 위)에 **추천 배너** 자동 등장 (debounce 후):

```
┌──────────────────────────────────────────────────┐
│ 💡 저장된 '신규 고객사 온보딩' 템플릿과 거의 같아요  │
│    업무 9개 · 영업/기획자/운영                       │
│                          [ 이 템플릿 쓰기 ]  ✕      │
└──────────────────────────────────────────────────┘
```

- **이 템플릿 쓰기** → AI 모달 닫고 `TemplateSelectModal` 을 그 템플릿 **상세(detail) 단계로 바로 열기** → 시작일·담당자 매핑·미리보기 후 [적용]. (기존 적용 흐름 100% 재사용, 신규 적용 로직 0)
- **✕(닫기)** → 배너 숨김. 사용자는 그대로 "AI 업무 추가"(새로 생성) 진행.
- 추천 무시하고 AI 생성해도 정상 — 추천은 **방해 없는 보조 신호**(memory `feedback_ai_recommendation_threshold`: subtle info 톤, 닫기 가능, 약한 매칭은 숨김).

## 4. 매칭 엔진

**재료:** 템플릿의 `name + description + 모든 item title` 을 한 문자열로 임베딩 (Q Note/KB 와 동일 `text-embedding-3-small`, memory `project_kb_engine_reuse`).

**저장:** `task_templates.embedding` BLOB 컬럼 신규. 템플릿 생성/수정/items 변경/프로젝트→템플릿 저장 시 재계산. 기존 행 백필(`backfill-template-embeddings.js`).

**추천 호출:** `POST /api/task-templates/recommend { business_id, prompt, project_id? }`
1. 멤버 권한 확인 (client 차단)
2. 사용자 프롬프트 임베딩 1회 (per-user rate-limit — 외부 비용 라우트, CLAUDE.md 운영안정성 #1)
3. 워크스페이스 가용 템플릿(preset + workspace)의 저장 embedding 과 코사인 유사도
4. 최고 점수가 **임계값 이상**이면 `{ match: {id, name, task_count, category, is_system, role_hints[]}, score } ` 반환, 아니면 `{ match: null }`

**임계값 (보정 완료):** text-embedding-3-small 코사인은 의미 유사 문장도 0.3~0.6 대 (KB '환불' 0.47 사례). raw 코사인 0.80 은 비현실적 → 설계의 "≥0.80" 은 *체감 신뢰도* 로 해석, 실 프롬프트로 보정한 `RECOMMEND_MIN_SIM = 0.45` 사용.

**보정 측정(2026-06-21, biz3 실 템플릿 10종):**
| 분류 | 점수 범위 |
|------|-----------|
| 진짜 매칭 (온보딩/웹앱/쇼핑몰/마케팅/채용) | 0.419 ~ 0.567 |
| 무관 (점심메뉴/연차휴가/비품/송금) | 0.258 ~ 0.433 |

0.45 → 무관(최대 0.433) 전부 차단 + 명확한 매칭(0.46~0.57) 포착. 모호 표현("새 고객사…" 0.419)은 누락되나 **정밀도 우선**(memory `feedback_ai_recommendation_threshold`: 잘못된 추천이 누락보다 해롭다 — 연차휴가→채용 0.433 오추천 방지). 사용자에겐 raw 점수 비노출(배너 문구만).

**격리:** 템플릿 목록은 `is_system=true(business_id NULL)` + `business_id=현재WS` 만 (기존 GET 과 동일 where). 타 워크스페이스 템플릿 0.

**graceful:** OPENAI 키 없음/임베딩 실패 → `{ match: null }` (배너 안 뜸, 크래시 0). embedding 없는 옛 템플릿은 매칭 후보에서 skip(백필 전 안전).

## 5. 프론트 변경

- `AiTaskCreateModal` (input 단계): prompt 변경 → 600ms debounce → recommend 호출 → match 있으면 배너. 로딩/생성 중·preview 단계엔 숨김. `project_id` 동봉.
- `TemplateSelectModal`: `initialTemplateId?` prop 추가 — 열릴 때 그 템플릿 detail 자동 진입(기존 `openDetail` 재사용). 없으면 기존 list 동작.
- 부모(`QTaskPage`/`TasksTab`): AI 모달의 "이 템플릿 쓰기" → AI 모달 close + TemplateSelectModal open(initialTemplateId 전달). 두 모달은 형제 — **팝업 위 팝업 아님**(memory `feedback_no_popup_on_popup` 준수: 하나 닫고 하나 연다).
- `services` 에 `recommendTemplate(businessId, prompt, projectId)` 추가.
- i18n `qtask` `ai.recommend.*` ko/en 신규.

## 6. 엣지 케이스

- 템플릿 0개 워크스페이스 → 항상 match null (배너 0).
- 프롬프트 < 6자 → 호출 안 함(노이즈·비용).
- 같은 프롬프트 연속 → 마지막 1회만(debounce + AbortController 로 이전 요청 취소).
- 추천 떴는데 사용자가 AI 생성 강행 → 정상(추천은 강제 아님).
- preview 로 넘어간 뒤엔 추천 숨김(이미 생성 결정함).

## 7. 검증 기준

- 빌드 EXIT0 · i18n 하드코딩 0 · ko/en 키 패리티
- recommend API: 온보딩 프롬프트 → '신규 고객사 온보딩' match / 무관 프롬프트("점심 메뉴 정하기") → null
- 멀티테넌트: 타 WS 토큰 → 그 WS 템플릿만, cross 누출 0
- rate-limit 동작 / OPENAI 없을 때 graceful null
- 실데이터 임계 보정 결과 기록
```
```

## 8. 범위 밖 (이번 사이클 X)

- 새 프로젝트 생성 모달에서의 추천(이번엔 AI 업무 추가만 — 추후 동일 패턴 확장 가능)
- 다중 템플릿 추천(top-N) — 1순위 1개만(노이즈 최소)
