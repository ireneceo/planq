# PlanQ 세션 상태

## 현재 작업 상태
**마지막 업데이트:** 2026-07-05 (저녁, Opus)
**작업 상태:** ✅ 이번 세션 전부 운영 배포 완료

### 진행 중인 작업
- 없음

### 완료된 작업 (이번 세션 — 전부 운영 배포)
- **검사 하니스 v1 구축** (`scripts/e2e/` — lib/browser.js·mobile-keyboard.js·run.js·visual-audit.js). puppeteer 로그인→모바일 키보드 시뮬(CDP viewport 축소)→가림/점프/가로스크롤 자동 판정. **캘리브레이션 함정: setDeviceMetricsOverride에 screenOrientation 넣으면 앱 orientationchange가 fullH 리셋→키보드 판정 깨짐(빼야 함).** (404040d)
- **비주얼 감사** — 전 화면 스크린샷 전수. 결론: 완성도가 화면마다 들쭉날쭉(bill=목표수준 / calendar 월그리드·tasks 테이블=뒤처짐).
- **알림 배너 디바이스 인지 + 모바일 컴팩트** — 네이티브앱에서 웹 push 문구 부정확 → nativePushStatus 분기. (4f1eff9)
- **모바일 단축키 힌트 숨김(Ctrl+K·⌘K) + 설정 심볼 raw URL 제거** (P0)
- **★ '이번 주 나의 업무'에 지연(마감 지난 미착수) 포함** — FE+BE `/my-week`+docs §5. (d57620e)
- **★ 주간 진척 그래프 목표선·y축 = 가용시간 (Fable 검토)** — base=effectiveCapacity, 판정칩 SPI는 Σ예측 유지. docs §6.1. (468479b)

### 다음 할 일 (다음 세션 우선순위)
1. **MEMORY.md 압축** (현재 184줄, 200 한계 근접) — 신중히 병합/정리해 <140줄. 급하게 안 쳐내기(교훈 유실 방지).
2. **비주얼 감사 P1 (실제 리팩터):**
   - 캘린더 모바일 아젠다 뷰 (월 그리드 375px 안 맞음 → 일/리스트 뷰) — 최대 값어치
   - 업무 리스트 모바일 카드화 (지금 가로스크롤 → 카드 레이아웃)
   - 채팅 FAB 중복 정리 (경미)
   - P2 화면별 폴리시 (나머지를 Q bill 수준 바까지)
3. **하니스 보강:** 인터랙티브 요소에 data-testid 부여 → 모달 opener 안정화(bills·inbox 등 gated 입력) + 표시명/L1 카나리 크롤 스위트 구축.
4. **표시명 6라우트 TODO** (businesses·dashboard·org·weekly_reviews·notifications·clients) — 카나리 크롤로 검증하며 수정.

---

## 복구 가이드

새 Claude 세션 시작 시 아래 내용을 붙여넣으세요:

```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```
