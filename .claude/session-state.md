# PlanQ 개발 세션 상태
**마지막 업데이트:** 2026-05-24
**작업 상태:** 완료 — N+50~N+60 11 사이클 SaaS readiness (미라이브 11 commit + dev DB schema 정리)
**최근 운영 라이브 commit:** `2c1aeba` (editor wrapper click fix)
**미라이브 commit:** 11 + dev DB schema fix (N+60 — 운영 DB 적용 SQL 박제)

---

## 이번 세션 완료 (N+50 ~ N+60)

### N+60 — DB 중복 인덱스 정리 (sequelize sync 누적 fix)

**30년차 시각 critical 발견:** dev DB 의 11 테이블이 MySQL 64 키 한도 도달. 다음 `sync({alter:true})` 시 ALTER 실패 — 운영 진입 직전 폭탄. memory `feedback_sync_alter_too_many_keys.md` 박제 사례 재발.

**원인:** sequelize sync 가 unique 컬럼 (share_token, invite_token 등) 의 인덱스를 매 sync 마다 새로 생성 → share_token_2, share_token_3 ... 50+ 누적.

**dev DB 정리 (700 ALTER):**
| 테이블 | before | after |
|--------|--------|-------|
| posts | 64 keys | 13 |
| documents | 64 | 13 |
| files | 64 | 11 |
| invoices | 64 | 9 |
| business_members / clients / users / signature_requests / quotes / reports / businesses | 64 | 6~9 |

**검증:**
- 헬스체크 28/28 통과 (인덱스 정리 영향 없음)
- EXPLAIN audit_logs `business_id + created_at` → `audit_logs_business_id_created_at` backward index scan 정합
- EXPLAIN files `business_id + visibility + deleted_at` → 인덱스 사용 (옵티마이저 선택)

**운영 DB 적용 SQL 박제:**
- `dev-backend/scripts/cleanup-duplicate-indexes.sql` — 운영 배포 시 참고 (information_schema 에서 자동 SQL 추출 + 점검 절차)

**30년차 결정 박제 (N+60):**
- **sequelize sync({alter:true}) 의 unique 인덱스 누적 = 자연 누적 폭탄** — 다음 사이클에 모델 정의에서 unique:true 제거 + 명시 index 만 사용 검토
- **운영 DB 적용 시 — 백업 + 점검 모드 + 헬스체크** 3단계 필수 (memory: project_backup_strategy.md)
- **인덱스 정리는 SELECT 후 자동 ALTER 생성** — 수동 list 보다 information_schema 쿼리로 안전
- **EXPLAIN 통계 작은 데이터셋은 부정확** — 운영 데이터셋에서 다시 확인 필요 (필요 시 ANALYZE TABLE)

### N+50~N+59 (요약)
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

## 다음 사이클 (미완)

1. **운영 push** — 미라이브 11 commit + N+60 DB 정리 SQL 적용
2. **sequelize 모델 unique:true 제거** — 인덱스 누적 근본 차단
3. **AdminAuditLogsPage target_type filter UI 추가** — backend filter 이미 있음
4. **QNote / PostsPage attachFileIds 받기** — N+57 패턴 (변경 폭 큼)
5. **Phase 9 통합 컨텍스트 + Q Mail** (9주, 큰 사이클)

---

## 복구 가이드

새 Claude 세션 시작 시:
```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```
