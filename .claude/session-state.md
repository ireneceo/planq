# PlanQ 세션 상태

**마지막 업데이트:** 2026-06-12 — **운영 피드백 4건 (dev 검증·커밋 완료 · 운영 미배포, `/배포` 대기).**

---

## 현재 작업 상태
**작업 상태:** dev 검증·커밋 완료 · **운영 미배포 (`/배포` 대기)**

### 진행 중인 작업
- 없음 (이번 세션 4건 모두 dev 검증·커밋 완료, 운영 배포만 남음)

### 완료된 작업 (이번 세션)
- **#32 세금계산서 공급자 업태/종목** — `businesses.biz_type/biz_item` + `PUT /:id/legal` + 설정 법인정보 입력 + 청구서 PDF 표기(한국만, `pdfTemplates.js` senderTypeLine/senderItemLine). 커밋 `65067d9`
- **#33 공개/팝아웃 미리보기 알림 숨김** — `App.tsx isPopout` 에 `/public/` 추가 (토스터·CueHelpDrawer·MemoFab·RightDock 게이팅). 커밋 `65067d9`
- **#14 업무 삭제 안 됨 fix** — 작성자 삭제 조건을 "타인 관여 0건"으로 정교화(본인 자동 status_history 잠금 제외) + `businesses.owner_id` 본인 owner 인정 + `documents.task_id` NO ACTION FK → 트랜잭션 detach. 커밋 `fa2e95f`
- **#26 팝아웃 항상-위 Pin** — Document PiP(Chrome/Edge 데스크탑) + 같은 라우트 iframe 재사용 + `window.open` fallback. 커밋 `b0558d5`
- 헬스 29/29, 모든 빌드 EXIT 0

### 다음 할 일 (다음 세션 시작점)
1. **`/배포`** — 운영 반영. `sync-database` 가 `businesses.biz_type/biz_item` 컬럼 자동 추가(단순 컬럼, ENUM 아님 → 수동 ALTER 불필요). 배포 후 운영 헬스/PM2/프론트 검증.
2. **운영 피드백 해결 회신 + lua 알림** (배포 후):
   - #32, #33, #14, #26 → done 처리 + 맞춤 답변 + 보고자(lua) 알림 (feedback respond 엔드포인트, link `/me/feedback`)
   - #28 탭 기능 → "네이티브 멀티탭 이미 가능(브라우저 탭 2개), 인앱 탭바는 네이티브 부족 시 별도 사이클" 회신 (Irene 결정: 네이티브 우선)
3. 운영 피드백 큐 재확인 (배포 시점 신규 피드백 있을 수 있음)

### 참고 — #14 추가 맥락
- lua 의 실제 test 업무 #69(business 1)는 owner(Irene)가 직접 댓글 2 + 상태변경 2 → lua 관점엔 "타인 관여" 남음 → **Irene(owner) 계정에선 즉시 삭제 가능**. lua 회신 시 이 점 안내.

### 미배포 커밋 (운영에 아직 없음 — git log 대조)
- `b0558d5` #26 PiP
- `fa2e95f` #14 삭제 fix
- `65067d9` #32·#33
- (#29 S3 `0695730`·`78c897f` 의 운영 배포 여부는 다음 배포 전 `git log`/운영 대조 확인)

---

## 복구 가이드

새 Claude 세션 시작 시 아래 내용을 붙여넣으세요:

```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```
