# PlanQ 세션 상태

## 현재 작업 상태
**마지막 업데이트:** 2026-06-21
**작업 상태:** 완료 — D 클러스터 대거 진척 운영 배포 (D2·D3·D4)

### 진행 중인 작업
- 없음

### 완료된 작업 (이번 섹션)
- **탭 라벨** '나의 주간보고' → '나의 업무보고' (ko/en).
- **보고서 전수 반응형** — KpiGrid `minmax(0,1fr)`+min-width:0+word-break+560px 1열, ReportContent Grid minmax·Sec/ITitle min-width:0, UnitName word-break, ReportsList FilterBar wrap. 보고서 non-minmax 1fr 0건, 가로 오버플로우 근본 제거.
- **보고서 외부 공유 링크** — `report_shares`(token→기간 멱등) + `GET /api/reports/public/integrated/:token`(무인증 read-only 롤업) + `/public/report/:token` 공개페이지(KpiGrid·ReportContent 재사용) + IntegratedReportView "공유 링크" 버튼. E2E 9/9.
- **D4 #62 보안등급** — `files.security_level` ENUM(general/internal/confidential, 기본 general). 외부공유 게이트(내부·기밀 차단 + 상향 시 share_token 무효화, files share-link + 통합 share /email·/chat). 일괄 export 게이트(기밀=owner/admin, bulk-download). 공통 `SecurityLevelBadge` + DocsTab 배지·선택·hint + securityLevel i18n. 개인드라이브 push=N/A(읽기전용). 변경 권한=작성자+owner/admin. E2E 8/9(유령user 401)+3/3.
- **운영 배포 검증:** 헬스 200 · files.security_level·report_shares·clients.kind·departments 운영 스키마 확인.
- (직전 섹션 운영 라이브: D1 조직 + D2-a 유형 + D2-b 담당자 + D3 보고서 재구성)

### 다음 할 일
1. **보안등급 posts/kb/docs 확장 (중규모):** 현재 files만. Post·KbDocument·Document 에 `security_level` + 각 외부공유/export 게이트 동일 적용. 공통 `SecurityLevelBadge` 재사용. files 패턴 그대로.
2. **#63 워크스페이스 간 이동 (대규모, `/기능설계` 필요):** 퇴사자 자료를 다른 워크스페이스로 이동. 소유권 재배정·데이터 무결성·보안등급 게이트. 제품 결정(이동 단위·권한·승인흐름) 필요.
3. **보고서 디자인 세부 보완:** Irene 화면 검토 후 추가 요청 예정 ("자세한 수정은 다시 요청할게").
4. **D1 후속(선택):** 멤버 소속(`MemberAffiliation`) 표시를 업무리스트·채팅·프로필 전반 확산.
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
