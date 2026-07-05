# 피드백 회귀 대장 (Feedback Regressions)

> 운영 피드백 1건 = 검사 1개. 하니스(`scripts/e2e/`)가 자동 검출. INSPECTION_PLAYBOOK.md §6.
> 실행: `node scripts/e2e/run.js --suite mobile` (exit 0/1, health-check 동급 게이트).

## 상태
- **하니스 v1 (모바일 키보드 스위트) 구축·작동** (2026-07-05). puppeteer + CDP 뷰포트축소로 iOS 키보드 시뮬 → 앱 실제 방어코드(main.tsx ensureFocusedVisible) 발화 → 가림/점프/가로스크롤 판정.
- 시뮬 보정: CDP `setDeviceMetricsOverride` 에 `screenOrientation` **넣지 말 것** (앱 orientationchange 가 fullH 리셋 → 키보드 판정 깨짐).

## 1차 전수(모바일 키보드) 결과 — 가림(occlusion) 검출
검출 = focus + 키보드 시뮬 후 입력 요소 bottom 이 visualViewport 아래(가려짐). 앱이 위로 못 올린 케이스.

| 화면 | 상태 | 비고 |
|------|------|------|
| /business/clients (검색·초대) | ✅ 통과 | |
| /docs · /wiki | ✅ 통과 | |
| **/business/settings** | ❌ **3 입력 가림** (bottom 390/467/544 > 337) | 긴 폼 하단 필드가 키보드 위로 안 올라옴 |
| **/calendar (일정 모달)** | ❌ **3 입력 가림** (470/614/598) | 일정 추가 모달 입력이 가려짐 (피드백 "모바일 팝아웃 업무/일정 추가 키보드 가림"과 일치) |
| **/tasks** | ❌ **1 입력 가림** (342 > 337) | |
| /bills · /inbox | ⚪ 직접 입력 없음 | 모달 opener(data-testid) 추가 필요 |

## 하니스 v1 한계 (다음 보강)
- **data-testid 미도입** → 모달/FAB opener 가 텍스트·위치 휴리스틱(불안정). tasks FAB opener 실패. → 인터랙티브 요소에 data-testid 부여(개발 규칙).
- 모달 gated 입력(bills·inbox) 은 opener 없이 못 봄.
- 남은 스위트: canary-crawl(표시명/L1), chrome-suppression(팝아웃 FAB·배너), 기능완결성.

## 다음 (fix 대상 = 위 ❌ 화면)
각 화면 입력 컨테이너를 `--vvh` 바운드 스크롤 영역으로(또는 ensureFocusedVisible 가 잡을 스크롤부모 제공) → 하니스로 GREEN 확인. settings → calendar 모달 → tasks 순.
