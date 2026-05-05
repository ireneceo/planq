# Q Knowledge — AI / CSV Ingest 설계

> 작성: 2026-05-05  · 사이클: KB-Ingest Phase 1
>
> 목적: 워크스페이스 멤버가 다양한 자료(자유 텍스트·파일·CSV)를 빠르게 KB 에 추가. AI 가 자동 분류·다중 포스트 분리·번역까지 처리하되, **원문 보존 + 검수 default + 일괄 저장 옵션** 으로 신뢰성과 효율성을 동시에 확보.

---

## 1. 핵심 원칙

1. **원문 정보만 사용** — AI 가 없는 정보를 만들지 않는다 (환각 금지)
2. **문장 정리는 최소** — 오타·띄어쓰기·줄바꿈만, 구조 재작성 X
3. **자동 분류** — 카테고리·태그·필요시 커스텀 항목 자동 추출
4. **다중 포스트 분리** — 토픽이 명확히 다르면 자동 분리, 애매하면 1개로 합침
5. **번역 = 또 하나의 AI 호출** — `cue_usage` 차감 (워크스페이스 한도 합산)
6. **검수 default** — 단, "검수 없이 일괄 저장" 토글 제공 (효율성 우선 사용자)

## 2. 입력 — 2 종

| 입구 | 헤더 버튼 | 라우트 |
|---|---|---|
| AI 자동 분석 | ✨ "AI로 추가" (SparkleIcon) | `POST /api/kb/ai-ingest` |
| CSV 일괄 업로드 | ⬆ "CSV 업로드" | `POST /api/kb/csv-ingest` |

기존 "+ 새 지식 등록" (`NewBtn`) 은 그대로 유지 — 단건 수동 입력용.

### 2.1 AI 입력 형식
- 자유 텍스트 붙여넣기 (최대 50,000 자)
- 파일 업로드 (PDF / docx / xlsx / txt / md — Q File 인프라 재사용, 최대 10MB / 플랜 한도 따름)
- 옵션: 입력 언어 자동 감지 / 명시 (ko/en)

### 2.2 CSV 입력 형식
샘플 컬럼 (사용자 다운로드 가능):
```
title, body, category, tags, source_language, auto_translate
```
- `category`: policy / manual / incident / faq / about / pricing
- `tags`: comma-separated
- `source_language`: ko / en
- `auto_translate`: true / false (default true)

## 3. AI 파이프라인

```
입력 (텍스트 또는 파일)
  ↓ [텍스트 추출: PDF→pdf-parse, docx→mammoth, xlsx→xlsx 라이브러리]
  ↓ [언어 감지: 자동 또는 사용자 명시]
  ↓ [GPT-4o-mini 분석]:
     - 토픽 경계 감지 → N 개 후보 포스트 분리 (애매하면 1)
     - 각 포스트별: title / body / category / tags / 정리된 본문
     - **system prompt 강제: "원문 정보만 사용. 오타/띄어쓰기만 정리. 새 정보 만들지 말 것."**
  ↓ [응답: { candidates: [{title, body, category, tags, source_language, ...}] }]
  ↓ 검수 UI 노출
  ↓ 사용자 ✅ → POST /api/kb/ai-ingest/save (또는 일괄 토글)
  ↓ 저장 시:
     - KbDocument.create
     - 청크 분할 + 임베딩 (text-embedding-3-small)
     - auto_translate=true 면 번역본 생성 + 양쪽 임베딩
     - cue_usage 차감 (analyze + embedding + translate 각각)
```

## 4. DB 스키마 변경 — KbDocument

신규 컬럼 (sync-database 자동 적용):

| 컬럼 | 타입 | 기본 | 설명 |
|---|---|---|---|
| `source_language` | ENUM('ko','en') | 'ko' | 원문 언어 |
| `auto_translate` | BOOLEAN | true | 다른 언어로 자동 번역 |
| `translation_visibility` | ENUM('translate','show_original','hide_other') | 'translate' | 번역 안 할 때 다른 언어에서 어떻게 보여줄지 |
| `translations` | JSON | null | `{ ko: { title, body }, en: { title, body } }` |
| `parent_doc_id` | INT FK | null | 다중 포스트 분리 시 원본 그룹 식별 |
| `source_file_id` | INT FK files | null | 입력 파일 (있으면) |

기존 KbDocument row → 마이그레이션 시 `source_language='ko'`, `auto_translate=false` 로 default. 운영 데이터 영향 X.

## 5. 번역 정책

| 옵션 | 다른 언어 사용자에서 | 검색 임베딩 |
|---|---|---|
| `translate` (기본) | 번역본 자동 노출 | 양쪽 언어 임베딩 |
| `show_original` | 원문 그대로 + "원문(언어)" 뱃지 + "원문 보기" 토글 | 원문 언어 임베딩만 |
| `hide_other` | 안 보임 (검색 결과 제외) | 원문 언어 임베딩만 |

번역 결과도 검수 UI 에서 미리보기 + 수정 가능.

## 6. 검수 UI

**KbAiIngestModal**:
- Step 1: 입력 (텍스트 또는 파일) + 옵션 (언어·번역·visibility)
- Step 2: AI 분석 진행 (로딩 + 토큰 예상 차감 표시)
- Step 3: 후보 카드 N 개 미리보기
  - 각 카드: title 편집 / body 편집 / category select / tags / 언어 뱃지 / [✅ 저장 | ✏️ 수정 | ❌ 제외]
  - 다중 포스트 시 "다시 합치기" / "더 나누기" 토글
  - 번역본 같이 미리보기 (번역 ON 시)
- Step 4: 일괄 저장 / "검수 없이 즉시 저장" 토글
- 저장 완료 → 모달 닫기 + KnowledgePage 리프레시

**KbCsvIngestModal**:
- Step 1: 샘플 다운로드 안내 + 파일 업로드
- Step 2: 파싱 미리보기 (table — 각 행)
- Step 3: 일괄 저장 (검수 스킵 default — 사용자가 채워서 올린 데이터라 신뢰)

## 7. 비용·한도

- 분석 (analyze): `cue_usage.kind = 'kb_analyze'`, 1 호출당 1
- 임베딩 (embed): 자동 — 추가 차감 X (이미 KB 구축 시 자동)
- 번역 (translate): `cue_usage.kind = 'kb_translate'`, 포스트당 1 (양쪽 언어 모두)
- 한도 초과 → `LimitReachedDialog` (Q-R 사이클 컴포넌트 재사용) — "Cue 액션 추가" 슬롯 제안

업로드 시 사전 견적 표시:
> "이 자료 처리에 약 N 회 차감됩니다. 잔여 50회 중 N회 사용 → 진행?"

## 8. Phase 분할

### Phase 1 (이번 사이클)
- DB 스키마 확장 (KbDocument 6 컬럼)
- AI 분석 + 검수 UI + 일괄 저장 (단일 또는 다중 포스트)
- CSV 업로드 + 미리보기 + 일괄 저장
- 번역 ON/OFF + visibility 3 옵션 + 양쪽 임베딩
- 헤더 버튼 2개 (별 + 업로드 아이콘)
- cue_usage 차감 + 한도 가드

### Phase 2 (다음 사이클)
- 다중 파일 동시 업로드 (zip / 폴더)
- 원문 변경 시 자동 재번역 큐
- "다시 합치기 / 더 나누기" 정밀 검수 (Phase 1 은 단순 분리만)
- 다국어 확장 (일본어 등)

### Phase 3
- 비동기 큐 (BullMQ, 대용량 PDF 수십 페이지)
- 사용자별 사전 학습 (선호 카테고리·태그 추론)

## 9. 보안

- 파일 업로드 — 기존 Q File 보안 정책 적용 (확장자 화이트리스트, 크기 제한, content-type 검증)
- AI 분석 결과는 검수 전엔 DB 저장 X (휘발 메모리만 — 사용자가 일괄 저장 안 누르면 사라짐)
- system prompt 에 "원문 정보만 사용" 강제 — 환각 시 사용자가 검수 단계에서 캐치
- 번역 결과 — translation 결과를 사용자 검수 단계에서 노출 (오역 캐치)

## 10. 메트릭 (관찰)

- 분석 호출 / 일 (per workspace)
- 검수 vs 일괄 저장 비율 (어떤 사용 패턴인지)
- 번역 ON 비율 (다국어 워크스페이스 비율 추정)
- 평균 후보 수 (다중 포스트 분리 빈도)

운영 진입 후 메트릭 보면서 system prompt 튜닝.
