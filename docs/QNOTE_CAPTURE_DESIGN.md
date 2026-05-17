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

---

## v2 갱신 — 사이클 N+17 환경 반영 (2026-05-17)

> N+2 합의 (2026-05-08) → N+17 (2026-05-17) 사이 N+3~N+16 사이클을 거치며 visibility 통합 아키텍처 / Q Note 공유 정책 / PWA Share Target / AutoSaveField 표준 / 글로벌 단축키 인프라가 변경됨. 본 섹션은 원문 §1~§9 의 항목별 delta + 새 영역. **§7~§9 는 v2 가 우선**.

### v2-§1. visibility 통합 아키텍처 (N+14)

| 옛 안 (§3, §4, §6) | v2 갱신 |
|---|---|
| 메모 popup 의 🔒 자물쇠 상시 + tooltip "본인만 봐요" | `VisibilityBadge` 컴포넌트로 교체. default L1, 클릭 시 `VisibilityChangeModal` 호출 (L1→L2/L3/L4). 모든 자산 통일 |
| 음성/메모 = 사적 공간 (옛 정책) | 기본 L1 + 명시 변경 시 공유 가능 (N+14 박제). recording status 중인 voice 만 visibility 변경 차단, text 메모는 항상 변경 가능 |
| linked_voice_session_id cross-business 제약 미명시 | 같은 `business_id` 강제. 다른 워크스페이스 voice session 에 link 시 400 |

### v2-§2. sessions 테이블 신설 컬럼 (옛 §7 교체)

| 컬럼 | 타입 | 기본값 | 용도 |
|---|---|---|---|
| `input_type` | TEXT NOT NULL | `'voice'` | 'voice' \| 'text' 분기 |
| `translate_enabled` | INTEGER NOT NULL | `1` | LLM 답변 언어 분기 (§5) |
| `linked_voice_session_id` | INTEGER FK | NULL | 메모↔회의 자동 연결 |
| `summarized_at` | TEXT | NULL | 정리하기 1회 여부 |

**추가 변경:**
- `CAPTURE_MODES` 화이트리스트 (`routers/sessions.py:165`) 에 `'text'` 추가
- text 메모는 status 전이 `prepared`→`active`→`completed` (voice 의 `recording` 단계 skip)
- 마이그레이션은 SQLite `ALTER TABLE` 4번 (sessions table). 외래키는 FK pragma 검사 비활성 환경이므로 인덱스만 추가

### v2-§3. 글로벌 단축키 충돌 검사

| 단축키 | 현재 사용처 |
|---|---|
| ⌘/ · Ctrl+\ | 우측 패널 토글 (Q Talk RightPanel, Q Task) — `QTalk/RightPanel.tsx:142` |
| ⌘+Enter · Ctrl+Enter | 인라인 폼 submit (Q Task, Q Talk 메모) |
| **⌘+M (mac)** | OS minimize. 브라우저에서 페이지 전달 되긴 하나 일부 환경에서 가로채임 |
| **Ctrl+M (win/linux)** | OS·브라우저 충돌 없음 |

**대체안:** mac 도 `⌘+Shift+M` (또는 `Alt+M`) 으로 안전하게 — 그러나 Notion/Slack 의 ⌘+M Quick Capture 관행과 다름. **결정 필요**.

### v2-§4. FAB 위치 정리

현재 우하단은 `CueHelpDrawer.tsx:226` 의 Cue FAB 가 차지 (`bottom: 80px` 계산 + `FAB_HIDDEN_PATHS` 배열).

**제안 배치:**
```
                                              ┌────┐
                                              │ 메모 │  bottom: 80px (위)
                                              └────┘
                                              ┌────┐
                                              │ Cue │  bottom: 16px (아래)
                                              └────┘
```

- 메모 FAB 도 `FAB_HIDDEN_PATHS` 패턴 재사용 (Q Talk 자동 숨김)
- 모바일 BottomNav 충돌 회피: `padding-bottom: env(safe-area-inset-bottom)`
- Client 역할은 두 FAB 모두 hide (이미 Q Note 차단 메모리 박제)

### v2-§5. AutoSaveField debounce

CLAUDE.md 표준은 input 2초 / select 300ms. **메모 popup 만 1초로 유지** (즉시 저장됨이 본질, 불안감 ↓). 합의 박제 필요.

### v2-§6. PWA Share Target 통합

이미 `manifest.json:24-39` + `sw.js:35-78` + `ShareReceivePage.tsx` 인프라 있음. v2 추가:

- `ShareReceivePage` destination 옵션 5종에 **"Q Note 메모로 추가"** 추가
- 텍스트 / URL 공유 → Quick Capture 같은 흐름으로 진입 (제목 자동 추출 + 본문 prefill)
- 이미지·파일 공유는 기존 destination 유지 (메모와 직접 연결 안 함 — 별도 사이클)

### v2-§7. 회의↔메모 자동 연결 (§4 강화)

| 조건 | 메모 popup 의 "현재 회의에 연결" 토글 |
|---|---|
| 사용자 자신의 voice session status='recording' row 존재 | default ON |
| status='active' (text 메모) row 존재 | disabled (text↔text 연결은 의미 없음) |
| 그 외 | 토글 hidden |

서버 측: `POST /api/sessions` 에 `linked_voice_session_id` 전달. 검증:
- 같은 `business_id` AND 같은 `user_id` AND `input_type='voice'` AND status='recording' 만 허용
- 아니면 400 `invalid_link_target`

### v2-§8. Cue RAG 인덱싱 (신규)

기존 박제 — `project_kb_engine_reuse.md` (Q Talk KB = Q Note 엔진 재사용). 메모 corpus 도 같은 패턴:

- 메모 "정리하기" 완료 시 (summarized_at 마킹 시점) 자동 kb_chunks 인덱싱
- visibility 별 RAG 범위:
  - L1 → 본인 Cue 만 (개인 corpus, business_id + user_id 매칭)
  - L2/L3 → 프로젝트/워크스페이스 멤버 Cue (visibility 헬퍼 재사용)
  - L4 → kb 인덱싱 X (외부 공유는 RAG 무관)

### v2-§9. 5중 시그널 (v2 통합)

| 시그널 | 위치 | 구현 |
|---|---|---|
| 시그널 1 — 사이드바 | "노트" 메뉴 라벨 그대로 (음성+텍스트 포괄) | i18n 변경 없음 |
| 시그널 2 — 헤더 | Q note 페이지 헤더에 `input_type` chip ("음성/텍스트") | tab 분리 또는 헤더 chip |
| 시그널 3 — 탭 분리 | 목록에서 음성/텍스트 두 탭 | 옵션 — 사이클 후반 결정 |
| 시그널 4 — popup 안 | `VisibilityBadge` (default L1) | 공통 컴포넌트 |
| 시그널 5 — 첫 사용 tour | ⌘+M / FAB 사용법 1회 안내 | localStorage 플래그 |

### v2-§10. 작업 매트릭스 갱신

| # | 영역 | 작업 | 규모 |
|:-:|---|---|:-:|
| 1 | DB | SQLite ALTER: input_type / translate_enabled / linked_voice_session_id / summarized_at + CAPTURE_MODES 화이트리스트 'text' 추가 | 소 |
| 2 | Q Note Python | sessions 라우터: input_type='text' 분기 (status 'active'/'completed', recording skip) + linked_voice_session_id 검증 + summarized_at 마킹 | 중 |
| 3 | MemoPopup 컴포넌트 | sticky 핀 + AutoSaveField 1초 + VisibilityBadge + 모바일 풀스크린 + "현재 회의 연결" 토글 | 중 |
| 4 | Quick Capture FAB + 단축키 | 우하단 메모 FAB (Cue 위) + ⌘+Shift+M (또는 ⌘+M) 글로벌 단축키. Q Talk/Client hide | 중 |
| 5 | 번역 토글 | 회의 시작 모달 + 진행 중 우상단 토글 + LLM 프롬프트 분기 | 소 |
| 6 | Q Note 페이지 — 텍스트 모드 분기 | 목록 view 에 음성/텍스트 두 type 동시 표시 (input_type 컬럼) | 소 |
| 7 | AI 분기 모달 "정리하기" | 음성·텍스트 공통 5액션 (업무 / Q info / Q docs / 외부공유 / 보관) | 대 |
| 8 | PWA Share Target | ShareReceivePage 에 "Q note 메모로 추가" destination 추가 | 소 |
| 9 | Cue RAG 인덱싱 | summarized_at 시점 kb_chunks 자동 인덱싱 (visibility 별 scope) | 중 |
| 10 | 5중 시그널 + tour | VisibilityBadge / 헤더 chip / 첫 사용 tour | 소 |

**예상:** 10~12 commit, 1 사이클.

### v2-§11. MVP 분리 안 (옵션)

대형 사이클이라 두 단계로 쪼개고 싶다면:

**N+17 코어 (5 commit):** ① DB ② Python sessions ③ MemoPopup ④ Quick Capture FAB+단축키 ⑥ Q Note 페이지 텍스트 모드

**N+18 확장 (5~6 commit):** ⑤ 번역 토글 ⑦ AI 분기 모달 ⑧ PWA Share Target ⑨ Cue RAG ⑩ 5중 시그널

---

**v2 상태:** 재검토 완료. **Irene 결정 박제 (2026-05-17 N+17):**
- ① 단축키: **⌘+Shift+M (mac) / Ctrl+Shift+M (win)** — OS 충돌 없음, Slack 관행 친숙
- ② FAB: **메모 FAB 하나만 우하단 16px 녹색 원형**. Cue FAB 는 80px 로 위로 이동
- ③ 스코프: **N+17 MVP 코어 5 commit 먼저** → 사용 감각 확인 후 N+18 확장 (번역/AI분기/Share Target/Cue RAG/시그널)

### v2-§12. N+17 MVP 코어 5 commit 순서 (확정)

| commit | 작업 | 파일 |
|:-:|---|---|
| 1 | DB ALTER: input_type / translate_enabled / linked_voice_session_id / summarized_at + CAPTURE_MODES `'text'` 추가 | `q-note/data/qnote.db` (ALTER) + `q-note/routers/sessions.py:165` |
| 2 | Python sessions text 분기: status `prepared→active→completed` (recording skip), input_type='text' INSERT 분기, linked_voice_session_id 검증, summarized_at field | `q-note/routers/sessions.py` |
| 3 | MemoPopup 컴포넌트 신규 (sticky 핀 + AutoSaveField 1초 + VisibilityBadge + 모바일 풀스크린 + 회의 연결 토글) | `dev-frontend/src/components/QNote/MemoPopup.tsx` (신규) |
| 4 | Quick Capture FAB + ⌘+Shift+M / Ctrl+Shift+M 글로벌 단축키 (Cue FAB 위치 위로 이동) | `dev-frontend/src/components/QNote/MemoFab.tsx` (신규) + `dev-frontend/src/components/Cue/CueHelpDrawer.tsx` (위치 조정) + `dev-frontend/src/components/Layout/MainLayout.tsx` (FAB mount) |
| 5 | Q Note 페이지에 text/voice 두 type 동시 표시 + input_type chip + 텍스트 메모 클릭 시 MemoPopup 재오픈 | `dev-frontend/src/pages/QNote/QNotePage.tsx` |

각 commit 단위로 빌드 + API 호출 검증 + frontend 페이지 확인 (CLAUDE.md "청크 단위 E2E 검증" 박제 준수).
