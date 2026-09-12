# PlanQ 세션 상태

## 현재 작업 상태
**마지막 업데이트:** 2026-09-12 06:15 UTC (Opus 5, 1M · 세션 planq-dc)
**작업 상태:** ✅ **운영 배포 완료 `0bfa1b38`** (2026-09-12 06:33 UTC, 334s, DEPLOY_EXIT 0) — ★ **Q sale 1a~1c · PDF 후속 2건은 Fable 미검증(자체 검증)**
**운영:** `0bfa1b38` · health 200 · / 200 · PM2 3종 online · Q sale 스키마 존재(clients.status `prospect` · client_stage_history · client_interactions · notifications/notification_prefs `sale`) · 고객 분포 active 3 / archived 1 / invited 1 (기존 데이터 불변)
**Git:** HEAD `0bfa1b38` · 작업트리 깨끗 · 마커 `by:"unavailable"` (Fable 한도 429 — 대기열 9번)
**롤백:** `ssh irene@87.106.78.146 'tar -xzf /opt/planq/backups/20260912_062714/backend.tar.gz -C /opt/planq && pm2 reload planq-prod-backend'`

### 이번 배포 (Irene 판단: "지금 배포 (Fable 미검증 감수)")
- Fable 라운드를 띄웠으나 **사용 한도(HTTP 429)로 시작 직후 중단** → 대기열 `docs/FABLE_GATE_QUEUE.md` 9번에 미검증 사실 기록, 개발현황·커밋에도 `opus_only` 로 표기
- 자체 검증(기계 검사): build EXIT 0 / error TS 0 · health 43/43 · guard-invariants EXIT 0 (49/50, 나머지는 문서 신선도 경고) · e2e tenant·detailopen·inboxcount **실패 0 (✅72)**
- 배포분: 미배포 13커밋 = 입력 임시저장 1A·1B·라운드 2(Fable PASS) · Drive Picker(PASS) · PDF 은퇴(PASS) + **PDF 후속 2 · Q sale 1a·1b·1c(미검증)**
- ⚠️ **배포 스크립트 순서 확인 필요(다음 라운드)** — `sync_database` 단계에서 `sync-database.js`(deploy-planq.sh:287)가 **먼저**, `migrate-qsale.js`(:418)가 **나중**에 돈다. 이번엔 ENUM 이 이미 있어 skip·변경 0 이라 무해했지만, **새 ENUM 값이 없는 환경의 첫 배포에서는 순서가 뒤집혀 있다.** 대기열 0번의 "마이그레이션이 코드보다 먼저" 조건과 어긋나므로 Fable 사후 검증 항목에 포함할 것

### 오늘 세션 시작 시점 파악 (/개발시작)
- 어제 밤 다른 세션(planq-18, 지금은 종료)이 **입력 임시저장 1A·1B·라운드 2 · Drive Picker · PDF 은퇴**(여기까지 Fable PASS, `f208323c`)에 이어
  **PDF 후속 2건**과 **Q sale 1a·1b·1c** 를 커밋했다. 뒤 5개는 자체 검증만 됐다.
- 대기열 `docs/FABLE_GATE_QUEUE.md` 0번에 Irene 지시가 박제돼 있다 — *"1b·1c 까지 개발한 뒤 한 라운드로 검증한다. 그 전에는 운영 배포 금지."*
- 미배포 누적: 13커밋 · 118파일 · +7,469/−456

### 진행 중인 작업
- **Fable 게이트 라운드(오늘)** — 대상: `11492759` · `07732a85`(PDF) · `f2a06c2f`(Q sale 1a) · `ea96ef46`(1b) · `161a3dae`(1c)
  - 판정 항목은 대기열 0번의 "Fable 이 봐야 할 것" 0~6: 배지 귀속 · 요약 비용(낡지 않으면 LLM 0) · refs 환각 · 마이그레이션 순서/멱등/롤백 · 권한(고객·qsale none/read) · 격리(라우트별 404/403) · 한도(prospects/clients 계수) · 고객으로 저장 부수효과 · 옛 타임라인 회귀
  - PDF: `--single-process` 제거 후 동시 요청·유휴 첫 PDF·Chrome 누수 0·SIGTERM 정리
- dev 상태: 마이그레이션 적용됨(clients.status `prospect` · client_stage_history · client_interactions · notifications.event_kind `sale`) · dev health OK · dev 빌드 09-11 23:14

### 다음 할 일
1. **Fable PASS → 마커(by:fable) → 운영 배포** (미배포 13커밋 한 번에). 배포 전 `docs/dev-status/next.json` 을 이번 범위로 다시 쓴다
   (지금 파일은 8bd11a23 배포분 기준 — Q Note 워크스페이스 공개·목록 격리·문서 템플릿 저장).
   배포 조건: `migrate-qsale.js` 가 코드보다 먼저 · sync(alter) 와의 순서 · 롤백 경로 확인
2. **FAIL 이면** 지적 항목만 수리 → 같은 라운드 재검증. 그 전 배포 금지(Irene 지시)
3. 배포 후 잔여(어제 남긴 목록 유지):
   - Q7 종 알림 = 현재 워크스페이스만 · Q6 미적용 상세 6곳(캘린더·메일·Q info·파일·청구·고객) · 워크스페이스 단계 3~5
   - 통합검색 표 셀 secret 칸 매칭 제외(#334 술어) · today-review/all-tasks 비소속 200→403 통일
   - 입력 임시저장 다음 라운드 · 도크 Q note [메모|음성메모] 탭 · GuestChatPanel 바닥 고정
   - q-note JWT businessId 클레임 · Q Note 공유 보기에서 '답변 찾기' 숨김
4. 사람 차례(Irene) — iOS 앱 재빌드(Codemagic, 키보드 ▲▼✓) · 운영 피드백 #409·#410 답글 · 판단 3건(관리자 벨 범위·서명 이메일 선노출·보고서 링크 무만료)

### 주의 (이 저장소는 세션이 동시에 붙는다)
- 커밋·배포 전 `git status` 로 남의 미커밋 변경이 섞이지 않았는지 본다. 남의 변경은 되돌리지 않는다
- Fable 검증 중에는 소스를 건드리지 않는다(지문이 바뀌어 판정이 무의미해진다)

---

## 복구 가이드

새 Claude 세션 시작 시 아래 내용을 붙여넣으세요:

```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```
