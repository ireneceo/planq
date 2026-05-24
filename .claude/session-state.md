# PlanQ 개발 세션 상태
**마지막 업데이트:** 2026-05-24
**작업 상태:** 완료 — N+50~N+61 12 사이클 SaaS readiness (미라이브 13 commit)
**최근 운영 라이브 commit:** `2c1aeba` (editor wrapper click fix)
**미라이브 commit:** 13 — N+50/51/52/53/54/55/56/57/58/59/60 + N+61 sequelize 모델 unique 제거 (이번 세션)

---

## 이번 세션 완료 (N+50 ~ N+61)

### N+61 — sequelize 모델 unique:true 제거 (인덱스 누적 근본 차단)

**N+60 의 진짜 마무리.** N+60 은 dev DB 일회성 정리였고, sequelize 가 다음 sync 마다 또 중복 만들지 않게 모델 정의 자체를 바꿔야 영구 안전.

**근본 원인:** column-level `unique: true` 가 sync 마다 sequelize 의 자동 인덱스 생성 trigger → `share_token_2`, `share_token_3` ... 무한 누적.

**해결:** column-level unique 제거 + `indexes: [{ unique: true, fields: [...], name: '...' }]` 배열에 명시 (이름 지정). sequelize 가 이름으로 인식해 중복 생성 안 함.

**변경된 16 모델:**
| 모델 | column |
|------|--------|
| Business | slug |
| BusinessMember | invite_token |
| CalendarEvent | share_token |
| Client | invite_token |
| Document | share_token |
| File | share_token |
| Invoice | invoice_number, share_token |
| KbDocument | share_token |
| Post | share_token (non-unique → unique 변경) |
| PushSubscription | endpoint |
| Quote | share_token |
| RefreshToken | token_hash (indexes 이미 있음, column만 제거) |
| Report | share_token |
| SignatureRequest | token (indexes 이미 있음, column만 제거) |
| Task | share_token |
| User | email, username |

**검증:**
- 모든 모델 syntax check OK (14 모델)
- 1st sync — 명시 인덱스 새로 생성 (정상)
- **2nd sync — 인덱스 카운트 변화 0** (누적 차단 성공 ✅)
- 헬스체크 28/28 통과
- column-level `unique: true` 잔존 0건

**누적 차단 검증 (1st sync vs 2nd sync):**
| 테이블 | 1st sync 후 | 2nd sync 후 |
|--------|-------------|-------------|
| businesses | 5 | 5 ✓ |
| users | 6 | 6 ✓ |
| files | 12 | 12 ✓ |
| posts | 15 | 15 ✓ |
| invoices | 12 | 12 ✓ |
| tasks | 13 | 13 ✓ |
| (16 모두) | unchanged | unchanged ✓ |

**30년차 결정 박제 (N+61):**
- **column-level `unique: true` = sync 누적 폭탄 trigger** — sequelize 가 이름 없이 자동 생성하니 매번 새 인덱스
- **indexes 배열 + name: '...' 지정** — sequelize 가 이름으로 인식 → 중복 안 만듦
- **운영 DB 적용 시** — sync-database.js 실행하면 명시 인덱스 1회 생성됨. 그 후로는 안정. N+60 SQL 정리 + N+61 모델 변경 = 영구 안전

### N+50~N+60 (요약)
- N+50 `457c8ec` — pagination 10 라우트 전수
- N+51 `707edcc` — AuditLog Tier 1 16 action + invoice FK fix
- N+52 `60ef03b` — PWA Share 회귀 + LoginPage search 보존
- N+53 `cdd6dc6` — share-receive 새로고침 안전망
- N+54 `74458bc` — AuditLog 2차 10 action + records FK fix
- N+55 `6451e07` — FE auto-paginate (5 페이지)
- N+56 `42d5771` — share 파일 첨부 통합
- N+57 `2108f13` — chat destination attachFileIds
- N+58 `355c396` — file batch meta + ChatPanel chip meta
- N+59 `d6e4f49` — files share/bulk audit + AuditLog admin pagination
- N+60 `17cec52` — dev DB 중복 인덱스 정리 (700 ALTER) + 운영 적용 SQL 박제

## 다음 사이클 (미완)

1. **운영 push** — 미라이브 13 commit + N+60 SQL 운영 적용
2. **AdminAuditLogsPage target_type filter UI** — backend 이미 있음
3. **QNote / PostsPage attachFileIds 받기** — N+57 패턴 (변경 폭 큼)
4. **3차 AuditLog 보강 (선택)** — docs CRUD / task_templates apply
5. **Phase 9 통합 컨텍스트 + Q Mail** (9주, 큰 사이클)

---

## 복구 가이드

새 Claude 세션 시작 시:
```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```
