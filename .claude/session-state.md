# PlanQ 세션 상태

## 현재 작업 상태
**마지막 업데이트:** 2026-07-18 (Opus 4.8, 1M) — IMAP IDLE 재연결 누수 핫픽스 운영 배포
**작업 상태:** 완료 (배포됨)

### 진행 중인 작업
- 없음

### 이번 세션 완료 (2026-07-18)
- **IMAP IDLE 재연결 누수 핫픽스** (운영 배포 `52fdf3a`, Deployment Complete 115s) — `help@irenewp.com` "메일 계정 sync 실패 (3회 연속) — Too many simultaneous connections" 알림 폭주 해결.
  - **근본원인:** Gmail 계정당 동시 IMAP 15연결 제한. `services/emailImapCron.js` IDLE 재연결 로직이 1 disconnect(error+close+end 3이벤트)→3재연결·의도적 end()가 재유발·타이머 중복예약 으로 고아 연결 누적 → 15개 초과.
  - **수정:** dropped 1회성 플래그 · reconnectTimers dedup · teardownConn removeAllListeners 先 · connecting 플레이스홀더 · 폴링 backstop live-IDLE skip. (백엔드 전용, 프론트 무변경)
  - **검증:** health 30/30 · 재연결 storm 소멸 · 운영 `help@irenewp.com` fail=0·last_sync 즉시 갱신·err∅ · dev도 회복(fail=0). 메모리 `feedback_imap_idle_reconnect_leak.md`.
  - **배포 주의(기록):** 1차 full 배포가 프론트 빌드 단계에서 stall(tee EOF로 exit0 위장, PM2 미재시작=부분배포). 백엔드 전용이라 `--skip-build --auto`로 완주. **다음 프론트 포함 배포 전 `npm run build` 정상 여부 확인 권장.**

### 완료된 작업 (이번 세션)
- **⑤ 캔버스 AI 초안 생성** (운영 배포됨): 마이그레이션(projects.strategy_sources JSON · project_workstreams.source ENUM('ai','manual')) + services/canvasDraft.js(LLM 게이트웨이 경유) + POST /api/projects/:id/canvas/ai-draft + 프론트 AI버튼·AutoGenBadge 3상태. 실HTTP+LLM 6/6. 운영 마이그레이션 컬럼 실측 통과.
- **⑥ 멀티탭 keep-alive** (dev 완성 + 운영 배포, 플래그 off): strangler 10/12 커밋 — tabStore(외부 store)·통일 TabStrip(사이드바 색·Q아이콘·＋통합검색·닫기가드)·chrome 17파일 RR탈피·트리스왑(형제 MemoryRouter, spike 게이트)·keep-alive·오버레이 편입·숨은탭 격리·공유 라우트 config+drift 가드·히스토리 순수로직. tabs e2e 3/3 영구 게이트.
- **운영 배포 완료** (2a03a38, Complete 103s): 두 멀티탭 플래그(beta/spike) 운영 off → 운영 사용자는 재구성 shell만(planq.kr /login·/·/features 렌더·크래시0·pageerror0 실측). 백업 /opt/planq/backups/20260716_203001.
- **Q위키 아티클 추가**: qproject/project-canvas-ai-draft (⑤ 사용자 대면). dev seed 반영·게이트 통과. **운영 위키 seed는 다음 /배포 시 반영 예정.**
- (세션 전반) Q Mail AI #153/164/179(9a293e3, 운영) · voice iOS #155(79db3e4, 운영) · 캘린더 배너 #126.

### 멀티탭 플래그 (중요)
- `planq_tabs_beta`: 미러 스트립. dev 기본 on, 운영 off.
- `planq_tabs_spike`: 트리 스왑 keep-alive. 기본 off(dev도). Irene 5 인간검증(IME·체감·뒤로가기·마이크·F5) 후 ⑫에서 승격.
- spike 켜기: `localStorage.setItem('planq_tabs_spike','1')`

### 추가 완료 (Fable 판정 후 실행 — 운영 배포됨 c80fed0, 20260716_214815)
- **⑤(B) Cue provenance** — Fable GO. `created_via VARCHAR(20) NULL` 3테이블(tasks/calendar_events/documents) + action layer 배선 + cue_tools 생성 3분기 'cue' + `ProvenanceBadge`(중립 회색) 3화면 + i18n common:provenance.cue. source='manual' 유지·권한/재무 무접촉(grep 불변식)·고객 차단. 실HTTP+toJSON+가드3축 통과.
- **⑥ 카나리 자동화 3건** — Fable CONDITIONAL-GO. canary-tabs.js에 뒤로가기·F5복원·마이크 track-alive 추가 → tabs 6/6. Irene 인간검증 5→2건(IME·전환 체감)으로 압축.

### ⑥ 멀티탭 전역 승격 — 운영 라이브 (6464deb, 20260716_220926)
- `tabsBeta.ts` isTabsBeta/isTabsSpike **기본 on(데스크탑 ≥1025px)**. dev·운영 모두 자동 노출. opt-out '0' 또는 기본값 flip 으로 즉시 롤백.
- 승격 근거: **keep-alive 입력 state 탭 왕복 보존 실증**(KEEPALIVE_TEST 유지) + tabs 스위트 6/6(opt-out 무회귀·무크래시·keep-alive·뒤로가기·F5·마이크 track-alive). IME 조합은 blur commit→state 반영으로 손실 없음.
- 운영 검증: 청크 해시 일치(운영=검증빌드 index-kEODvNZl.js)·헬스 200·PM2 fresh. **Irene 브라우저는 하드리프레시(Cmd+Shift+R) 필요**(옛 캐시 번들).
- 모바일 무영향(데스크탑 전용).

### 다음 할 일
- ⑪ 탭 드래그 정렬 · QNote 폴링정지(9b) (남은 폴리시)
- ⑦ 인프라(Irene 액션): Stripe Webhook Secret · SMTP DKIM/SPF/DMARC DNS · Google OAuth 검증 제출

### 운영 반영 완료 (오늘 밤)
- ⑤ 캔버스 AI 초안 · ⑥ 멀티탭 keep-alive(전역 on) · ⑤B created_via provenance(3테이블 마이그레이션·ProvenanceBadge 3화면) · 카나리 6건 · Q위키 캔버스AI.

---

## 복구 가이드

새 Claude 세션 시작 시 아래 내용을 붙여넣으세요:

```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```

### 참조
- 설계: docs/MULTITAB_DESIGN.md · docs/qa/BACKLOG_REMAINING_DECISIONS_2026-07-16.md
- 게이트: scripts/e2e/canary-tabs.js (node scripts/e2e/run.js --suite tabs → 3/3)
- 메모리: project_multitab_keepalive.md
