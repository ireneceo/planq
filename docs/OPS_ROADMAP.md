# PlanQ 운영 인프라 로드맵

> 가입자·사용량 임계치 기반으로 단계적으로 인프라를 확장한다. 자동 체크 스크립트가 임계치 도달 시 Irene 에게 알림.

**기준 환경:** 운영서버 (현재 dev.planq.kr / 추후 planq.kr).

---

## 자동 체크 스크립트

### 파일
`/opt/planq/dev-backend/scripts/ops-capacity-check.js` — 주 1회 실행 (PM2 cron)

### 수집 지표
- `businesses` 테이블 총 레코드 수
- `business_storage_usage.bytes_used` 합계
- `files` 테이블 총 레코드 수
- 월간 업로드 트래픽 추정 (전주 대비 증가량 × 4)

### 알림 채널
이메일 (Irene `irene@irenewp.com`) — Nodemailer + 운영 SMTP 설정 시점 이후.
임시: 콘솔 로그 + PM2 log 확인.

### 결과 기록
`ops_capacity_log` 테이블 (주차별 스냅샷) — 추세 그래프 작성용.

---

## Stage 0 — 지금 바로 도입 (Phase 2A)

| 항목 | 기준 | 상태 |
|---|---|---|
| 플랜별 파일 크기 제한 | Free 10MB / Basic 30MB / Pro 50MB | 이미 존재 |
| 플랜별 총 스토리지 쿼터 | Free 1GB / Basic 50GB / Pro 500GB | **Phase 2A** |
| SHA-256 dedup | 중복 파일 참조 카운트 | **Phase 2A** |
| 휴지통 (soft delete) | `deleted_at` + 30일 유지 | **Phase 2A** |
| 폴더 시스템 | `file_folders` 테이블 + UI | **Phase 2A** |
| OPS 체크 스크립트 | 주 1회 가입자/용량 집계 | **Phase 2A** |

---

## Stage 1 — 가입자 100명 또는 총 50GB

**알림 메시지:** `"businesses ≥ 100 또는 storage ≥ 50GB 도달. Stage 1 도입 권장"`

| 도입 항목 | 내용 | 예상 비용 절감 |
|---|---|---|
| **휴지통 자동 정리 cron** | 30일 지난 deleted_at 레코드 영구 삭제 + 물리 파일 제거 | 평균 10~20% 절감 |
| **이미지 썸네일 생성** | 업로드 시 WebP 256px 썸네일 자동 생성, 리스트는 썸네일만 서빙 | 대역폭 50% 절감 |
| **업로드 스로틀** | 단일 사용자 분당 20회 / 시간당 200회 | 악의적 사용 차단 |

예상 작업: 1.5일.

---

## Stage 2 — 가입자 500명 또는 총 500GB

**알림 메시지:** `"businesses ≥ 500 또는 storage ≥ 500GB 도달. Stage 2 도입 권장"`

| 도입 항목 | 내용 | 효과 |
|---|---|---|
| **Cold storage 이관** | 90일 이상 열람 없는 파일 → Backblaze B2 또는 Cloudflare R2 | 보관 비용 1/5 |
| **파일 접근 시 lazy 복원** | cold 파일 다운로드 요청 시 hot 으로 복귀 | UX 유지 |
| **서명 URL 다운로드** | 자체 스토리지도 1회용 서명 URL 로 전환 (보안 + 대역폭 분리) | 직접 링크 노출 방지 |
| **Backup 스케줄** | DB + 활성 파일 일일 스냅샷 | 재해 복구 |

예상 작업: 3일.

---

## Stage 3 — 가입자 2,000명 또는 총 5TB

**알림 메시지:** `"businesses ≥ 2000 또는 storage ≥ 5TB 도달. Stage 3 도입 권장"`

| 도입 항목 | 내용 | 효과 |
|---|---|---|
| **CDN 도입** | CloudFront / Cloudflare R2 signed URL | 글로벌 다운로드 속도 + 서버 대역폭 0 |
| **업로드 큐** | Redis BullMQ — 대량 업로드 배치 처리 | 피크 안정성 |
| **서버 분리** | 파일 API 전용 서버 + DB 리드 레플리카 | 수평 확장 |
| **모니터링** | Grafana + Prometheus — 용량/트래픽/에러율 실시간 | 가시성 |

예상 작업: 5일.

---

## Stage 4 — 가입자 5,000명 또는 월 트래픽 1TB

**알림 메시지:** `"businesses ≥ 5000 도달. Stage 4 필요 — 장기 파트너쉽 검토"`

이 시점에서는 인프라 전담 엔지니어 또는 클라우드 파트너십 검토. 이 문서의 세부는 Stage 3 까지.

---

## 외부 클라우드 비중 추적

외부 클라우드 연동 고객이 많으면 Stage 도달 타이밍이 늦춰짐.

| 비율 | 영향 | 비고 |
|---|---|---|
| Google Drive 이용 고객 ≥ 50% | 자체 스토리지 Stage 1 자연 지연 | 좋은 신호 |
| Drive 이용 고객 ≥ 80% | Cold storage 도입 유보 가능 | 최적 |

OPS 체크 스크립트가 provider 별 비중도 함께 리포트.

---

## 체크리스트

### Phase 2A 착수 시
- [ ] `business_storage_usage` 테이블 생성
- [ ] `files` 테이블에 `deleted_at`, `ref_count`, `content_hash` 컬럼 추가
- [ ] `ops_capacity_log` 테이블 생성
- [ ] `scripts/ops-capacity-check.js` 작성 (가입자·용량 집계)
- [ ] PM2 ecosystem.config.js 에 cron 등록 (주 1회)
- [ ] 알림은 당분간 PM2 log — SMTP 설정 후 이메일 전환

### Stage 1 착수 시
- [ ] 휴지통 자동 정리 cron (일 1회)
- [ ] 이미지 썸네일 파이프라인 (Sharp)
- [ ] 업로드 rate limit 강화

### Stage 2 착수 시
- [ ] Backblaze B2 또는 R2 계정 준비
- [ ] 파일 접근 기록 테이블 (`file_access_log`)
- [ ] Cold 이관 cron + lazy 복원 미들웨어
- [ ] 서명 URL 미들웨어

### Stage 3 착수 시
- [ ] CDN 설정 (Cloudflare 등)
- [ ] Redis + BullMQ 도입
- [ ] 모니터링 스택 구성
