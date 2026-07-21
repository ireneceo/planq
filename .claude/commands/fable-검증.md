# /fable-검증 — Fable 독립 검증 게이트 (구현·테스트 검증 무조건 Fable)

CLAUDE.md **'역할 분담 — 기획·설계·검증·테스트 = Fable (무조건)'** 정책의 실행 커맨드.
구현 완료 후 **Opus 자체 검증은 완료 근거가 될 수 없다.** 반드시 이 커맨드로 **Fable(model:fable) 서브에이전트**를 띄워 독립 검증하고, 그 판정을 근거로만 완료 보고한다.

이 커맨드는 Stop 훅(`fable-gate-stop.sh`)과 연동된다 — **PASS 시 마커를 기록해야 정지(완료)가 허용**된다.

---

## 1단계: Fable 서브에이전트로 독립 검증 (필수)

**Agent 도구를 `model: "fable"` 로 호출**한다(Opus 가 직접 검증하지 않는다). 서브에이전트에 아래를 그대로 위임:

> 너는 PlanQ 독립 검증관(Fable)이다. 방금 Opus 가 구현한 변경을 **코드 리뷰가 아니라 실제 실행/호출로** 검증하고, 통과/실패를 근거와 함께 판정하라. 통과를 남발하지 말고 의심되면 실패로 판정하라.
>
> **대상 변경 파악**: `cd /opt/planq && git status --porcelain -- dev-backend dev-frontend q-note` 와 `git diff` 로 이번 미커밋 변경 범위를 확인.
>
> **① diff 범위 대조** — 변경이 사전 합의된 설계/요구 범위 안인가. 설계 외 변경(임의 추가·부수 수정) 0 인지 확인. 벗어난 게 있으면 목록화.
>
> **② 가드 스크립트 3축 + 빌드** (모두 종료코드 0 이어야 통과):
> ```bash
> cd /opt/planq/dev-backend && node /opt/planq/scripts/health-check.js
> node /opt/planq/scripts/guard-invariants.js
> node /opt/planq/scripts/e2e/run.js --suite tenant
> cd /opt/planq/dev-frontend && npm run build   # tsc -b EXIT 0 + error TS 0
> ```
> (guard-invariants 래칫 실패 = 신규 위반. 의도된 부채 감소가 아니면 실패 처리.)
>
> **③ 실호출·회귀** — 코드 리뷰 금지, 실제 HTTP(포트 3003)로 증명:
> - login → 핵심 CUD → 재조회 값 일치
> - 권한별 접근(비권한 403, 멀티테넌트 비멤버 403)
> - 운영 옛 데이터 sample 1건으로 회귀 없음 확인
> - 테스트 스크립트는 `cd /opt/planq/dev-backend && node test-xxx.js` 로 실행 후 **반드시 `rm`**.
>
> **④ 배포 안전성** (배포/마이그레이션 동반 시) — 운영 ALTER 가이드·백필 idempotent / 프론트 청크 해시 갱신 / 롤백 경로(backups/{TIMESTAMP}).
>
> **출력**: ①~④ 각 PASS/FAIL + 근거(실제 명령 출력·HTTP 응답 발췌). 하나라도 FAIL 이면 **전체 판정 = FAIL**. 마지막 줄에 정확히 `VERDICT: PASS` 또는 `VERDICT: FAIL` 만 출력.

고위험 변경(보호영역·돈/주문 무결성·운영 DB 마이그레이션·신규 아키텍처·보안 경계)은 ①~④ 전부 생략 불가 — Fable 에게 명시적으로 강조.

---

## 2단계: 판정 처리

### PASS 인 경우 → 마커 기록 (정지 허용)
Fable 이 `VERDICT: PASS` 를 낸 경우에만 아래 Bash 실행:

```bash
REPO=/opt/planq
FP=$(git -C "$REPO" status --porcelain -- dev-backend dev-frontend q-note | sha256sum | cut -d' ' -f1)
printf '{"fingerprint":"%s","ts":%s,"by":"fable"}\n' "$FP" "$(date +%s)" > "$REPO/.claude/.fable-gate.json"
echo "✅ Fable 게이트 통과 기록됨 (fp=${FP:0:12})"
```

그 후 사용자에게 Fable 판정 근거를 요약 보고. (필요 시 이어서 `/개발완료`.)

### FAIL 인 경우 → 마커 기록 금지
- 마커를 쓰지 않는다(정지 시 훅이 다시 게이트를 요구).
- Fable 이 지적한 FAIL 항목을 사용자에게 그대로 보고하고, 수정 후 다시 `/fable-검증`.
- **"코드상 맞다"로 통과 처리 절대 금지.**

---

## 주의
- 이 커맨드 없이 "검증 완료/개발 완료"라고 보고하는 것은 정책 위반이다.
- Opus 가 스스로 ①~④ 를 실행해 통과시키는 것도 위반 — 검증 주체는 **반드시 Fable 서브에이전트**.
- 마커는 "현재 변경 상태"의 지문에 묶인다. 마커 기록 후 코드를 더 바꾸면 지문이 달라져 게이트가 다시 열린다(재검증 필요) — 정상 동작.
- Irene 이 검증 없이 넘기라고 명시하면: `touch /opt/planq/.claude/.fable-gate-skip` (이후 훅 침묵). 다시 강제하려면 해당 파일 삭제.
