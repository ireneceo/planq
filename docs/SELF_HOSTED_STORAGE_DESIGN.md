# 독립 서버(S3 호환) 파일 저장 — 설계 (운영 피드백 #29)

> 사용자 요청: "파일 저장을 유저의 독립 서버도 사용할 수 있어? 구글드라이브 대신? 자신의 서버를 사용해서…"
> 목표: 워크스페이스가 **자체 S3 호환 스토리지(MinIO/Wasabi/Cloudflare R2/AWS S3 등)** 를 파일 저장소로 쓸 수 있게. PlanQ 자체 저장·Google Drive 와 **나란히 선택**.

작성: 2026-06-12 · 상태: 설계(미구현). 대형 기능 — 설계 후 별도 사이클 구현.

---

## 1. 현재 구조 (재사용 대상)
- `files.storage_provider` ENUM: 현재 `'planq'`(자체) / `'gdrive'`. + `external_url` 컬럼(외부 저장 시 접근 URL).
- 다운로드 분기: `routes/files.js` — `storage_provider !== 'planq'` 면 `external_url` 로 redirect (없으면 400).
- 자격 저장 패턴: `models/ExternalConnection.js`(owner_scope workspace/user), `BusinessCloudToken.js`, Q Mail AES-256-GCM 암호화([[project_qmail_status]]).
- 메모리: [[project_file_storage_hybrid]] (자체/GDrive 2-way, 메타는 DB 인덱스, PlanQ 유일 진입점), [[project_external_connections_owner_scope]].

## 2. 설계 — S3 호환 provider 추가
**원칙: 새 진입점 X. 기존 업로드/다운로드 경로에 `s3` provider 분기만 추가.** (PlanQ 가 유일 진입점 유지 — 메모리 정책.)

### 2.1 스키마
- `files.storage_provider` ENUM 에 `'s3'` 추가 (ALTER, 운영 수동).
- 워크스페이스 스토리지 설정 — `external_connections` 재사용 또는 신규 `workspace_storage_configs`:
  - `business_id`, `provider`('s3'), `endpoint`(https), `region`, `bucket`, `path_prefix`,
  - `access_key_enc`, `secret_key_enc` (AES-256-GCM, Q Mail 헬퍼 재사용),
  - `public_base_url`(선택 — CDN), `is_active`, `verified_at`.
- `businesses.default_storage_provider` ENUM('planq','gdrive','s3') — 신규 업로드 라우팅 기준.

### 2.2 업로드 라우팅 (`routes/files.js`)
1. 업로드 시 `business.default_storage_provider` 확인.
2. `s3` 면 → `services/s3Storage.js putObject(key, buffer, mime)` (key = `path_prefix/business_id/yyyy-mm/uuid.ext`).
3. File row: `storage_provider='s3'`, `external_url = 서명 GET 또는 프록시 경로`, `content_hash`(dedup 은 s3 도 가능 — head before put).
4. 실패 시 → PlanQ 자체 저장 fallback + 경고 로그 (데이터 손실 0순위).

### 2.3 다운로드
- `storage_provider==='s3'` → **서명 URL(presigned GET, 단기 TTL) 생성 후 redirect** (private 버킷). public CDN 설정 시 `public_base_url`.
- 기존 `external_url` 분기 그대로 — s3 는 매 요청 서명 갱신(만료 회피)을 위해 `/api/files/:id/download` 가 그때 서명.

### 2.4 보안 (필수)
- 자격 **AES-256-GCM 암호화** 저장 (평문 금지, .env KEY).
- `endpoint` **https 강제 + SSRF 가드**(내부 IP 차단 — `routes/push.js isAllowedEndpoint` 패턴 재사용, 메모리 운영안정성 4번).
- 연결 시 **검증**: 테스트 putObject/headBucket → 성공해야 `verified_at` set + 활성.
- 멀티테넌트: 모든 key 에 `business_id` prefix 강제. presigned URL 도 그 prefix 만.

## 3. UI (설정 → 파일·외부 연동)
- "독립 서버 (S3 호환)" 카드: endpoint/region/bucket/access·secret/path prefix 입력 → [연결 테스트] → 활성.
- 저장소 선택: 자체 / Google Drive / 독립 서버(S3) 라디오 → `default_storage_provider`.
- 기존 파일은 그대로(provider 별 혼재 허용). 마이그레이션은 선택(후속).

## 4. 단계
- **P1** s3Storage 서비스(put/get presign/head) + 설정 테이블 + 암호화 + 연결 테스트 API.
- **P2** 업로드 라우팅 분기 + 다운로드 presign redirect + dedup.
- **P3** 설정 UI + 저장소 선택.
- **P4** (선택) 기존 파일 마이그레이션 잡.

## 5. 의존성/주의
- 라이브러리: `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` (S3 호환 endpoint 지원).
- 용량 쿼터([[feedback_staged_infra_rollout]]): s3 사용 시 워크스페이스 쿼터는 외부 위임(자체 quota 안 셈) — GDrive 와 동일 정책.
- 검증: 연결 테스트 + 실 업로드/다운로드 E2E + SSRF 차단 + 잘못된 자격 graceful.
