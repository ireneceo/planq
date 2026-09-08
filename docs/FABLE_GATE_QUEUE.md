# Fable 게이트 대기열

> Fable 토큰이 없을 때 만든 것 중 **판정식상 올려야 하는 것**을 여기 쌓는다.
> 토큰이 생기면 **묶어서 한 라운드**로 올린다 (CLAUDE.md — 쪼개 올리면 소모가 난다).
>
> 판정식: `Fable 에 올린다 ⟺ R=1 OR (S=1 AND F=0)`
> 여기 있는 항목은 **자체 검증만 통과한 상태**다 — "Fable 미검증(자체 검증)" 으로 표기해야 한다.

---

## 1. Q Note 회의록을 Cue 범위로 (2026-09-08, commit `f584036f`)

**판정: R=1** — 개인 자료(회의록)가 LLM 프롬프트로 들어가고, Cue 답변에는 **고객 대화방으로
나가는 경로**(`cue_orchestrator`)가 따로 있다. 문이 잘못 열리면 되돌릴 수 없다.
**S=1** — 새 절단면(어느 경로에서 개인 자료를 허용할 것인가)을 요구사항에서 자동으로 못 뽑는다.

### 무엇을 만들었나
- `q-note/routers/sessions.py` → `GET /api/sessions/internal/search`
  (x-internal-api-key, `business_id` + **`user_id` 강제** — 이 조건이 사적 공간 정책의 집행 지점)
- `dev-backend/services/qnoteContext.js` → 통로 하나. 2.5s 타임아웃, 실패해도 `[]`
- `dev-backend/services/cue_context.js` → `personalScope` 인자 신설(기본 `'none'` = fail-closed).
  `personalScope === 'self' && internal && userId` **셋 다** 맞을 때만 싣는다
- `dev-backend/routes/cue.js` `/help` 만 `personalScope: 'self'` 를 넘긴다.
  `cue_orchestrator` 는 넘기지 않는다(= 대화방 경로는 구조적으로 못 탄다)
- 커버리지 문구도 같이 고쳤다 — 실었을 때만 "조회함", 안 실었으면 "**본인 노트뿐**" 이라고 말한다

### 왜 `audience === 'internal'` 로 갈음하지 않았나
그 값의 뜻은 "스태프 전용 정보 허용" 이지 "받는 사람이 묻는 사람 하나" 가 아니다.
지금은 우연히 같지만, 내부 **공유** 대화방용 경로가 나중에 `internal` 로 들어오면
남의 눈에 내 회의록이 조용히 실린다. 뜻이 다른 두 가지는 값도 나눴다.

### 자체 검증 (Fable 미검증)
`node scripts/e2e/run.js --suite qnotecue` — 7/7, 그중 **5개가 음성 대조군**:
① 본인 노트는 요약 본문 낱말로 뜬다
② 같은 워크스페이스 **owner** 여도 남의 노트는 안 뜬다
③ `personalScope` 기본값이면 안 뜬다 (= 대화방 경로 보호)
④ `audience='client_facing'` 이면 `personalScope='self'` 여도 안 뜬다
⑤ 다른 워크스페이스에서는 안 뜬다
⑥ 내부 엔드포인트 — 키 틀리면 401 · `user_id` 가 다르면 0건
⑦ 커버리지 문구가 거짓말하지 않는다
가드를 깨뜨려 반증도 했다(문을 넓히면 ③④⑦이 빨강으로 뒤집힌다).

### Fable 에게 물을 것
1. `personalScope` 문이 **정말로** 답이 묻는 사람에게만 가는 경로와 1:1 인가.
   `/api/cue/help` 응답이 다른 곳으로 재사용되는 경로가 있는가(MCP 읽기 서버·Cue tools 포함).
2. 프롬프트 주입 표면 — 회의록 발췌(3건 × 700자)를 `<<<회의록: …>>>` 구분자로 가뒀는데,
   전사에 그 구분자 문자열이 그대로 들어 있으면 탈출 가능한가.
3. q-note `/internal/search` 의 LIKE 조합(필드 6 × 낱말 10)이 SQLite 에서 감당 가능한가.
   `INTERNAL_API_KEY` 만으로 지키는 표면이 하나 더 늘어난 것의 위험.
4. 개인 노트(L1)를 포함시킨 판단이 옳은가 — `/internal/by-entity` 는 L1 을 **뺀다**
   (그건 남에게 보이는 히스토리라서). 여기는 본인에게만 가므로 포함했다. 이 비대칭이 맞는가.
