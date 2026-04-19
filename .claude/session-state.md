## 현재 작업 상태
**마지막 업데이트:** 2026-04-19 (Phase C 세션 종료)
**작업 상태:** 완료

### 진행 중인 작업
- 없음

### 완료된 작업 (이번 세션)

**Q Task Phase C — 상세 패널 액션 매트릭스 + UI 정합성**

1. **상세 패널 역할별 액션 카드**
   - 담당자: ack / start / submit-review / resubmit / cancel-review / complete / completeSimple
   - 컨펌자: approve / revision(인라인 폼) / revert (1회 per 라운드)
   - Disabled 버튼은 전제 미충족 시 버튼 자체 숨김
   - 버튼 색 = 도착 상태 색상 (예: `[진행 시작]` = 티일, `[승인]` = 블루)

2. **컨펌자 섹션 + 정책 토글**
   - 리스트/추가/제거 + all/any 정책 세그
   - 진행 중 라운드에 추가 시 경고 다이얼로그

3. **히스토리 타임라인** — event_type 별 컬러 도트 + round/actor/target/note

4. **상태 자유 전환 드롭다운** — 상태 뱃지 클릭, 리스트/상세 각각 독립 state
   - 종류별 옵션: 요청업무 8단계(waiting 포함) / 일반업무 7단계(waiting 제외)
   - 요청업무 + not_started + 미ack → "업무요청 받음" 라벨

5. **카드/리스트 선택 UX** — 로즈 좌측 3px 라인 + 리스트는 옅은 배경. 지연 시각 분리 (카드 우상단 "지연" 뱃지)

6. **상세 버튼 확대/토글** — 20→28px, 활성 시 로즈 배경

7. **라운드 뱃지** — R1/R2 뱃지 상태 옆 노출

8. **인라인 이름 칩** — 요청자/담당자 별도 컬럼 제거, 업무명 옆 3색 칩(from/to/observer)

9. **버그 픽스**
   - due_date 정렬 null-last
   - 상태 드롭다운 TCell overflow 잘림
   - 카드 hover translateY 지터

10. **week 필터 확장** — 담당자 + 컨펌자(pending)

11. **완료 상태 색상** — 진녹 → 슬레이트 그레이

12. **백엔드**: all-tasks API 응답에 reviewers 포함

13. **시드 19건** — `scripts/seed-qtask-workflow-test.js`, irene biz=3 `워크플로우 테스트` 프로젝트, `[WF]` 접두사
    - M1~M8 일반 / R1~R6 받은 요청 / S1~S3 보낸 요청 / C1~C2 컨펌자

### 검증 결과
- 헬스체크 27/27 통과
- 빌드 성공 (gzip ≈ 250 kB, tsc 0 error)
- 시드 idempotent 확인 (재실행 시 기존 [WF] 삭제 후 재생성)
- 백엔드 재시작 후 reviewers 필드 응답 확인

### 다음 할 일 (다음 세션 시작점)

**Phase D — 탭 뱃지 카운트**
- 이번 주: task_requested + reviewer pending 수
- 요청하기: reviewing(결과 대기) 수
- 전체업무: revision_requested 수

**Phase E — "내 전체업무" 의미 정리**
- 현재 assignee OR reviewer 합산. UX 리뷰 필요

**기타 백로그**
- Q Project 상세 페이지 (`/projects/:id`)
- Q Talk 청크 5 — Cue 자동 추출 트리거
- Clients 초대/편집 UI (F5-2b)
- Dashboard 구현
- lua 팀원 계정 세팅

### Irene 확인 필요
- https://dev.planq.kr/tasks — `[WF]` 시드 19건으로 모든 단계 시나리오 검증
- 요청 업무 vs 일반 업무 단계 라벨 차이 확인
- 담당자/컨펌자 액션 흐름 확인

---

## 복구 가이드

새 Claude 세션 시작 시 아래 내용을 붙여넣으세요:

```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```
