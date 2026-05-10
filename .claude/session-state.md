## 현재 작업 상태
**마지막 업데이트:** 2026-05-10 15:21
**작업 상태:** 사이클 N+3 완료 + v1.4.0 운영 라이브

### 진행 중인 작업
- 없음

### 완료된 작업 (이번 세션)

**v1.4.0 운영 라이브 (`e16b125`, 2026-05-10 15:19:55 UTC, 103s)**

**근본 회귀 fix ★★:**
- `task_extractor` JSON 키워드 누락 — `response_format: json_object` 사용 시 messages 안 'JSON' 단어 필수. 옛 프롬프트 누락으로 매번 OpenAI 400 → fallback `{tasks:[]}` → 추출 자체가 한 번도 정상 작동 안 했던 회귀
- 검증: "퍼플히어 파비콘" + "앱 아이콘" 2개 정확 추출 200

**UpdateBanner 시스템 통째 제거:**
- 사이클 N+2 의 PWA 자동 무효화 시스템이 빌드 잦은 환경에서 banner 짜증 + cache-bust `_v=` query 무한 누적 회귀
- main.tsx 폴링/socket build_id/UpdateBanner mount 모두 제거
- SW activate 시 모든 client URL `_v=` query 정리 + 강제 navigate (갇힌 옛 PWA 자동 탈출)

**권한 정책 보강:**
- 댓글 본인 편집/삭제 PUT/DELETE 신규 (workspace owner 도 차단)
- task PUT 필드별 차등 (title/description: 작성자/담당자/owner, assignee/due_date: 작성자/owner, project_id: owner only)

**채팅방 정리:**
- POST `/api/projects/conversations/:id/unlink` — project_id=null
- POST `/api/conversations/:bizId/:id/archive` — soft delete (archived_at)
- conversations.archived_at + archived_by_user_id 컬럼 신규
- ⋮ 메뉴 + ConfirmDialog

**latest_estimation_source 시각 분기:**
- tasks list API literal subquery
- NumInput `$ai` italic + AiInlineBadge `fx` 칠

**부수 fix:**
- weeklyReviewCron BusinessMember.active → removed_at:null
- rate-limit /push/test IPv6 helper (ipKeyGenerator)

### 검증 결과
- 헬스체크 27/27 PASS
- API 13/13 PASS (사이클 N+3 누적 통합)
- UpdateBanner 흔적 산출물 4종 모두 0 (완전 제거)
- 운영 sw.js navigate/_v 정리 11 라인 반영

### 알려진 후속 (다음 사이클)
- 운영 nginx /version.json + /sw.js + / no-cache (Irene sudo 1줄 — 직전 사이클부터 미적용)
- 모달 통일 스프린트 / 통합 공유 시스템 / Smart Routing / PushLog admin 통계 / iOS UA 분기

---

## 환경
- **dev:** dev.planq.kr (port 3003) — chunk `BzZcjTHb` (build_id 1778426390945)
- **운영:** planq.kr (port 3004) — commit `e16b125` (build_id 1778426390945)
- **DB:** dev `planq_dev_db` / prod `planq_prod_db`
- **PM2:** planq-dev-backend 1.4.0 / planq-prod-backend 1.4.0 / planq-qnote / planq-prod-qnote

## 운영 라이브 (마지막)
- commit: `e16b125`
- timestamp: 2026-05-10 15:19:55 UTC (103s deploy)
- backup: `/opt/planq/backups/20260510_151817`
- 외부 health: ✅ 200
- 버전: **v1.4.0** (minor, 1.3.0 → 1.4.0)

---

## 복구 가이드

새 Claude 세션 시작 시 아래 내용을 붙여넣으세요:

```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```
