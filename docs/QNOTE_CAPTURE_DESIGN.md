# Q note 확장 + Quick Capture — 설계 문서

> **사이클 N+2 합의 (2026-05-08)** — Q note 의 본질을 음성→텍스트 통합 캡처 도구로 확장. 어디서든 빠르게 메모할 수 있는 Quick Capture FAB + 단축키 + AI 분기 액션 통합.

---

## 1. Q note 재정의

| 차원 | 기존 인식 | 본질 (재정의) |
|---|---|---|
| Q note | 음성 회의록 도구 | **모든 입력 채널의 캡처 → 정리 → 활용 도구** |

회의록(음성)이든 메모(텍스트)든 본질은 같음 — 정리되지 않은 정보를 빠르게 잡아두고 → AI 가 정리 → 다른 곳으로 분기.

```
Q note (생각·정보 캡처 도구)
├ type: voice (음성 → STT → 회의록)
└ type: text (실시간 자동저장 → 메모)

공통 흐름:
입력 → 캡처 → AI 정리 → 분기 액션 (업무 / Q info / 문서 / 외부공유 / 그대로 보관)
```

---

## 2. Quick Capture — 진입점 4개

| 진입점 | 트리거 | 어디서 |
|:-:|---|---|
| ★ A | 글로벌 단축키 ⌘+M (mac) / Ctrl+M (win) | 모든 페이지 |
| B | 우하단 FAB (메모 아이콘) | 데스크탑/모바일 (Q Talk 자동 숨김 — FAB 정책 일관) |
| C | Q note 페이지 + 버튼 → 모드 선택 (회의/메모) | Q note 페이지 |
| D | PWA 공유 타겟 | OS 공유 시트 (이미 메모리에 박제) |

---

## 3. Popup 동작

```
┌─────────────────────────────┐
│ 메모             🔒  📌  ✕  │
│ ✓ 자동저장됨 · 1초 전        │
│                             │
│ [제목 — 첫 줄 자동 추출]    │
│                             │
│ 본문 입력 영역              │
│                             │
│ [프로젝트: ___] [태그: ___] │
├─────────────────────────────┤
│ [정리하기 ✨] [닫기]         │
└─────────────────────────────┘
```

- **자동저장** debounce 1s (AutoSaveField 패턴)
- **제목 없어도 OK** — 첫 줄 자동 추출
- **🔒 자물쇠** — 상시. tooltip "이 메모는 본인만 봐요"
- **📌 핀** — 데스크탑 only (모바일 비활성). sticky 모드 → 다음 페이지 이동해도 유지
- **닫기** — popup 만 닫고 메모는 Q note 에 자동 저장

---

## 4. 회의 ↔ 메모 동시 사용 (★ 핵심 use case)

> **Irene 핵심 시나리오:** "회의 중 상대방 발언 들으면서 메모 popup 열어 답변 준비"

기술적으로 두 트랙 독립 (마이크 vs 키보드) — 충돌 X.

**UI:**
```
Q note (회의 진행 중)
┌────────────────────────────────────────────────┐
│  🎤 마이크 ON · 00:12:34       📝 메모 [📌]    │
│                                                │
│  ┌─────────────────┐ ┌──────────────────────┐ │
│  │ Transcript      │ │ 메모 (sticky pinned) │ │
│  │ [상대]: 가격...  │ │ - 가격 -10% 제안    │ │
│  │ [나]:    ...     │ │ - 마감 6/30 강조    │ │
│  └─────────────────┘ └──────────────────────┘ │
│                                                │
│  [번역 ON/OFF] [회의 종료]                      │
└────────────────────────────────────────────────┘
```

**자동 연결:**
- 메모 popup 의 옵션 토글: "현재 회의에 연결" (default ON 회의 중일 때)
- ON: `qnote_sessions.linked_voice_session_id = 현재회의id` 저장
- 회의 종료 후 회의록 페이지 하단에 **"이 회의 중 작성한 메모"** 섹션 자동 노출
- 두 세션 합쳐서 "정리하기" → AI 가 발언 + 메모 합산 분석

**모바일:**
- 풀스크린 모드 (sticky 비활성). 회의로 돌아가는 back 버튼 강화.

---

## 5. 번역 선택 토글 (★ 합의)

### 진입점 2곳
1. 회의 시작 모달 — "번역 사용" 토글 (default ON)
2. 진행 중 우상단 — 같은 토글 (실시간 변경 가능)

### 동작
- **ON (현행)**: 자막·답변 모두 사용자 화면 언어로 번역
- **OFF**: 자막은 발언 언어 그대로, AI 답변은 **질문 언어 = 답변 언어**

### LLM 프롬프트 분기
```
[ON]  "Answer in user's UI language: {ui_lang}"
[OFF] "Answer in the same language as the question."
```

### DB
- `qnote_sessions.translate_enabled` BOOLEAN default true
- 마이그레이션: 기존 sessions 모두 true 백필

---

## 6. AI 분기 액션 모달 (정리하기) — 음성/텍스트 공통

```
[메모를 어디로 보낼까요?]

🤖 AI 가 추출한 항목:
  • 업무 후보 2개  → "고객사 미팅 준비", "제안서 v2 작성"
  • 키워드 → 신규 프로젝트, Q3 일정

원하는 액션:
  [✓] 업무 2개 생성 (Q task)
  [ ] 지식 카드 등록 (Q info)
  [ ] 정식 문서로 승격 (Q docs — type='document')
  [ ] 외부 공유 (이메일·링크)
  [ ] 그냥 보관

[적용]
```

**정책:**
- 음성 회의록과 텍스트 메모가 같은 모달
- promote 후 원본 노트는 그대로 본인 only (L1)
- 새로 만들어진 업무/지식/문서는 각자 visibility (보통 L2)

---

## 7. DB 변경 (사이클 N+2)

| 테이블 | 컬럼 변경 |
|---|---|
| qnote_sessions | `input_type` ENUM('voice','text') NOT NULL DEFAULT 'voice' |
| qnote_sessions | `translate_enabled` BOOLEAN DEFAULT true |
| qnote_sessions | `linked_voice_session_id` INT FK qnote_sessions(id) NULL — 메모가 어떤 회의에 linked |
| qnote_sessions | `summarized_at` TIMESTAMP NULL — 정리하기 한 번 했는지 |

---

## 8. 작업 매트릭스 (사이클 N+2)

| # | 영역 | 작업 |
|:-:|---|---|
| 1 | DB | input_type / translate_enabled / linked_voice_session_id 컬럼 추가 + 마이그레이션 |
| 2 | Q note 텍스트 type | 신규 작성 모드 선택 (회의/메모) UI |
| 3 | Quick Capture FAB | 우하단 메모 fab (Q Talk 자동 숨김) + ⌘M 단축키 |
| 4 | MemoPopup 컴포넌트 | sticky 핀 + 자동저장 + 자물쇠 표시 + 모바일 풀스크린 |
| 5 | 번역 선택 토글 | 회의 시작 + 진행 중 진입점 + LLM 프롬프트 분기 |
| 6 | 회의 ↔ 메모 자동 연결 | linked_voice_session_id 저장 + 회의 종료 후 통합 보기 |
| 7 | AI 분기 모달 | 정리하기 모달 (음성·텍스트 공통, 4 액션 + 보관) |
| 8 | 사이드바 한국어 라벨 | "노트" 그대로 (음성+텍스트 포괄) |
| 9 | 5중 시그널 적용 | 사이드바·헤더·탭·popup·tour |

**예상:** 8~10 commit, 1 사이클.

---

## 9. 비즈니스 가치 (경영 컨설턴트 시각)

| 가치 | 설명 |
|---|---|
| Friction 0 | 다른 앱(메모장/Notion) 안 켬. 단축키 한 번에 메모 popup |
| Lock-in | 모든 생각·메모가 PlanQ 에 누적 → Cue AI RAG 정확도 ↑ |
| Data Asset | 흩어진 메모 → 단일 corpus → 검색·AI 학습 자산 |
| Workflow 단축 | "회의록 보고 업무 정리" manual → 한 클릭 분기 |
| 차별화 | B2B 캡처 OS 포지셔닝 (Notion+Slack+Apple Notes 통합 가치) |

---

**상태:** 합의 완료, 사이클 N+2 시작 대기 (사이클 N+1 권한 정책 후).
