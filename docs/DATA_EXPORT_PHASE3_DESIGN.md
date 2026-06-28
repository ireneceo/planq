# #63 Phase 3 — 자료 이동 & 비동기 내보내기 설계

> Phase 1(본인 L1 export + 관리자 워크스페이스 백업) · Phase 2(워크스페이스 간 복사) 위에 확장.
> 구현·검증 완료 (2026-06-28). dev 라이브, 운영 배포 대기.

## 1. 기능 정의
- **목적:** ① 복사가 아닌 **실제 이동**(원본 정리) ② **Q Note 세션** 포함 ③ 대용량 **비동기** 처리.
- **결정(Irene):** ① 이동은 **본인이 본인 것만**(자가 이동) ② Q Note **본인 세션 → 문서(요약+전사)** ③ **DB job 테이블 + cron 드레인**.
- **비범위:** 관리자 오프보딩(타 멤버 강제 이동), 외부 클라우드(GDrive) 재이동, 실시간 진행률 바.

## 2. API (`routes/export.js` + qnote 내부 1개)
| Method · Path | 설명 |
|---|---|
| POST `/:biz/me/transfer-job` | `{target_business_id, mode:copy\|move, include_qnote}` → job 생성(queued) |
| POST `/:biz/me/export-job` | `{include_qnote}` → 다운로드 zip job |
| GET `/:biz/me/jobs` | 본인 job 목록(최근 20, download_token 포함) |
| GET `/:biz/me/jobs/:id` | 본인 job 상세 |
| GET `/:biz/me/jobs/:id/download?token=` | export zip 다운로드(토큰·30일) |
| GET `/api/sessions/internal/export?business_id&user_id` (qnote) | x-internal-api-key, 본인 세션(title·summary·transcript) |

## 3. DB — `export_jobs`
user_id, business_id, kind(transfer\|export), mode(copy\|move), target_business_id, include_qnote,
status(queued\|running\|done\|failed), attempts, result(JSON counts), error, download_path/token/expires_at,
started_at, done_at. 인덱스: status / (business_id,user_id) / download_token.

## 4. 워커 — `services/exportJobWorker.js`
cron 30초 드레인(틱당 3건). transfer: 본인 L1 파일·문서 복사(content_hash dedup) + (옵션)Q Note→문서.
move 면 **복사 성공 후** 원본 파일 soft delete(ref_count 0 시 물리삭제)·문서 archived. export: zip→파일+토큰(30일).
완료 시 notify(eventKind 'feedback', link `/settings/data-export`). 실패 시 attempts<3 재시도. 만료 zip 6시간 cleanup.

## 5. UI — `DataExportSettings.tsx`
- 이전 카드: 대상 선택 + 복사/이동 라디오 + Q Note 토글 → job 생성(move 는 danger 톤 + 확인 모달).
- 내 데이터 카드: Q Note 토글 ON 시 백그라운드 export-job, OFF 면 기존 동기 zip.
- 작업 내역 카드: job 상태 + export 완료 시 다운로드. queued/running 동안 3초 폴링.

## 6. 검증
- 백엔드 E2E: copy(파일·문서 복사·원본보존) / move(원본 file soft delete·doc archived) / export+download / include_qnote(56세션→문서) / 권한(미멤버 타겟·타인 job) — 17/17.
- qnote 내부 endpoint: 키 있음→세션, 키 없음→401.
- 빌드 EXIT0/TS0 · i18n ko/en 403/403 · 헬스 29/29 · 운영 INTERNAL_API_KEY 패리티 확인.

## 운영 배포 주의
- `export_jobs` 테이블 → deploy sync-database 자동 생성.
- qnote endpoint → deploy 시 planq-prod-qnote 재시작 필요.
- INTERNAL_API_KEY 운영 Node↔qnote 일치 확인됨(2026-06-28).
- export zip 저장: `uploads/exports/` (deploy rsync 시 .env·uploads 보호 정책 영향 없음).
