# 자기강화 지식 시스템 — E2E 검증 결과 (2026-07-02)

> 실 HTTP 호출 기반 (test 계정 로그인 → CUD → 재조회). 시드 데이터는 각 테스트 끝에 원복.

## 축 2 — Q위키 자기강화 루프 (10/10 PASS)
| 시나리오 | 결과 |
|----------|------|
| qhelper 질문 → 답변 + log_id 반환 | PASS |
| 피드백 제출 200 / 재제출 409 | PASS |
| 유사 질문 3건 → 클러스터 1개 → 위키 초안 1건 자동 생성 (gpt-4o-mini) | PASS |
| 초안 is_published=false (사람 승인 게이트) + origin_meta 질문 샘플 | PASS |
| 처리된 로그 processed_article_id 마킹 (재처리 방지) | PASS |
| admin 질문로그 대시보드 (stats: total/unanswered/not_helpful) | PASS |
| 공개 위키챗(help-public) 질문도 로깅 | PASS |

## 축 1 — Cue 워크스페이스 지식 (10/10 PASS)
| 시나리오 | 결과 |
|----------|------|
| 지식 카드 추가 (owner) → 즉시 active | PASS |
| member 추가 403 / member 목록 조회 허용 | PASS |
| buildCueContext 에 "# 워크스페이스 지식" 블록 주입 | PASS |
| **memo 실버그 fix** — clients.memo 부재로 clientId 있으면 컨텍스트 전체가 죽던 것 → notes+summary 로 교체 + 스냅샷별 개별 .catch | PASS (biz3 실고객으로 검증) |
| 실측 통계 SQL (카테고리별 완료업무 actual_hours, 표본≥5) + 프롬프트 블록 정합 | PASS |
| 채굴 수동 실행 (pending 제안 생성 흐름) | PASS |
| 상태 전이 (pending→active/rejected) + 삭제 | PASS |

## 축 3 — 랜딩 블로그 (9/9 PASS)
| 시나리오 | 결과 |
|----------|------|
| 내부(authenticated) 글 블로그 발행 시도 → 400 게이트 | PASS |
| 공개 글 발행 → blog_published_at + 카테고리 | PASS |
| GET /api/blog/posts 비인증 노출 + 카테고리 필터 | PASS |
| 상세(본문 블록) 조회 / 해제 후 목록 미노출 + 상세 404 | PASS |

## cron 등록 확인
- `[wikiQuestionCluster] cron registered (Mon 05:00 KST)` — 서버 로그 확인
- `[cueKnowledge] cron registered (Mon 05:20 KST)` — 서버 로그 확인

## 운영 배포 시 수동 ALTER (sync 미의존)
```sql
CREATE TABLE help_question_logs (...);   -- dev 와 동일 (services/wikiQuestionCluster.js 참조)
CREATE TABLE cue_knowledge (...);
ALTER TABLE help_articles ADD COLUMN origin ENUM('manual','auto_cluster') NOT NULL DEFAULT 'manual',
  ADD COLUMN origin_meta JSON NULL,
  ADD COLUMN blog_published_at DATETIME NULL, ADD COLUMN blog_category VARCHAR(40) NULL;
-- + 이전 배치분: ALTER TABLE files MODIFY storage_provider ENUM('planq','gdrive','s3') NOT NULL DEFAULT 'planq';
--   ALTER TABLE business_cloud_tokens ADD COLUMN last_error VARCHAR(300) NULL, ADD COLUMN last_error_at DATETIME NULL;
--   (clients.email_aliases 는 2026-07-02 운영 선반영 완료)
```
