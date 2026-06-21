# PlanQ 세션 상태

## 현재 작업 상태
**마지막 업데이트:** 2026-06-21
**작업 상태:** ✅ 운영 배포 완료 — D4 보안등급 posts/kb/docs 확장 (commit cfb1abe, 20260621_080734). 운영 DB security_level ENUM 3테이블 확인, 헬스/PM2/프론트 정상.

### 진행 중인 작업
- 없음

### 완료된 작업 (이번 섹션 — D4 보안등급 posts/kb/docs 확장)
- **공통 헬퍼** `dev-backend/services/securityLevel.js` — `blocksExternalShare(entity)` (general 외 차단), `isValidLevel`, `SECURITY_LEVELS`. file/post/document/kb 공유 게이트 단일 출처.
- **모델 3** — `posts.security_level` · `documents.security_level` · `kb_documents.security_level` ENUM(general/internal/confidential, 기본 general). 멱등 ALTER 로 dev 운영DB 반영(full sync 회피, Too-many-keys 안전).
- **posts.js** — serialize + 4 공유 게이트(POST /share, /share/email, /share-to-chat, PUT /visibility L4전환) + `PUT /api/posts/:id/security-level`(author+owner/admin, 상향 시 share_token 무효화 + L4면 L3 강등 + audit).
- **docs.js** — POST /documents/:id/share 게이트 + `PUT /api/docs/documents/:id/security-level`(member, audit). 일반 PUT 화이트리스트엔 security_level 미포함(전용 엔드포인트 강제).
- **kb.js** — list attributes 추가 + POST /kb-documents/:id/share 게이트 + share-bundle 게이트(selection 생성 시 비-general 1건이라도 있으면 403, 공개 뷰 selection·category 둘 다 `security_level:'general'` 런타임 필터로 사후 상향 즉시 차단) + `PUT /api/kb-documents/:id/security-level`(member, broadcastKb, audit).
- **share.js** — 통합 /email·/chat 게이트를 `blocksExternalShare`로 일반화(file+kb_document). **옛 /chat 은 file 보안 게이트가 아예 없던 갭이라 같이 보완.**
- **프론트** — 서비스 3종(updatePostSecurityLevel/updateDocumentSecurityLevel/updateKbSecurityLevel) + 타입 필드. PostsPage(상세 PlanQSelect+배지+hint, 리스트 배지) · PostShareModal(차단 배너+체크박스/발송 disable) · KnowledgePage(상세 선택+배지+hint, 리스트 배지, 번들 차단 구체 메시지) · DocumentEditorPage(메타 사이드바 선택+배지+hint). 공통 `SecurityLevelBadge`/`useSecurityLevelLabel` 재사용. i18n `securityLevel.*` ko/en 기존 키 재사용(신규 0).
- **검증:** E2E 21/22 통과(1건은 테스트 assertion 오류 — 백엔드는 400 invalid_level 정상, 기능 22/22). 빌드 exit 0(tsc -b) + dev 새 청크 서빙. i18n 하드코딩 0(잔여 한국어는 주석뿐).
- (이전 섹션) **탭 라벨** '나의 주간보고' → '나의 업무보고' (ko/en).
- **보고서 전수 반응형** — KpiGrid `minmax(0,1fr)`+min-width:0+word-break+560px 1열, ReportContent Grid minmax·Sec/ITitle min-width:0, UnitName word-break, ReportsList FilterBar wrap. 보고서 non-minmax 1fr 0건, 가로 오버플로우 근본 제거.
- **보고서 외부 공유 링크** — `report_shares`(token→기간 멱등) + `GET /api/reports/public/integrated/:token`(무인증 read-only 롤업) + `/public/report/:token` 공개페이지(KpiGrid·ReportContent 재사용) + IntegratedReportView "공유 링크" 버튼. E2E 9/9.
- **D4 #62 보안등급** — `files.security_level` ENUM(general/internal/confidential, 기본 general). 외부공유 게이트(내부·기밀 차단 + 상향 시 share_token 무효화, files share-link + 통합 share /email·/chat). 일괄 export 게이트(기밀=owner/admin, bulk-download). 공통 `SecurityLevelBadge` + DocsTab 배지·선택·hint + securityLevel i18n. 개인드라이브 push=N/A(읽기전용). 변경 권한=작성자+owner/admin. E2E 8/9(유령user 401)+3/3.
- **운영 배포 검증:** 헬스 200 · files.security_level·report_shares·clients.kind·departments 운영 스키마 확인.
- (직전 섹션 운영 라이브: D1 조직 + D2-a 유형 + D2-b 담당자 + D3 보고서 재구성)

### 다음 할 일
0. **🚀 D4 보안등급 확장 운영 배포** — dev 검증 완료(E2E+빌드). Irene `/배포` 시 커밋 후 `./scripts/deploy-planq.sh --auto`. DB는 posts/documents/kb_documents 에 security_level ENUM 추가됨(운영 sync 자동 또는 ALTER).
1. **#63 워크스페이스 간 이동 (대규모, `/기능설계` 필요):** 퇴사자 자료를 다른 워크스페이스로 이동. 소유권 재배정·데이터 무결성·보안등급 게이트. 제품 결정(이동 단위·권한·승인흐름) 필요.
3. **보고서 디자인 세부 보완:** Irene 화면 검토 후 추가 요청 예정 ("자세한 수정은 다시 요청할게").
4. **D1 후속 — 멤버 소속 표시:** ✅ 채팅 hover(UserInfoPopover) 완료(05b21b4, 미배포). 잔여 surface: 업무리스트 행·프로필 페이지(밀집 리스트 표시방식은 디자인 결정 필요).
5. **기타 backlog:** AI 기능 전수검사(`docs/AI_FEATURE_AUDIT.md`), Q위키 스크린샷 캡처 env, Google OAuth 검증 제출, #60 iOS Capacitor.

### 구조 박제 (절대 임의 변경 금지)
- memory `project_d_cluster_org_design` — D 클러스터 4페이즈 + 결정(평면부서+팀·단일메뉴+client.kind·담당자화 B중간·보안등급 3단계). 설계 `docs/Q_ORG_DESIGN.md`.
- memory `project_reporting_structure` — 전체 보고서 IA 확정본 (탭제거·카드접기·빈약내용 반려됨).
- memory `feedback_copy_existing_design_not_bespoke` — 새 화면은 기존 페이지 디자인 베껴서, bespoke styled 금지.

### 참고
- `planq-dev-backend`·`planq-qnote` 는 **irene** pm2. 운영 `irene@87.106.78.146`(PROD_BE=/opt/planq/backend, port 3004).
- 배포: 커밋 후 `./scripts/deploy-planq.sh --auto`. DB 컬럼/테이블 추가는 sync 자동(ENUM 신규 컬럼 포함 확인됨).

---

## 복구 가이드

새 Claude 세션 시작 시 아래 내용을 붙여넣으세요:

```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```
