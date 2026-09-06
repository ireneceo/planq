## 현재 작업 상태
**마지막 업데이트:** 2026-09-06
**작업 상태:** 완료 (운영 배포 6회 · 커밋 19건 · 안드로이드 APK 전달 · 가드 34/34·41/41·tenant 0)

### 진행 중인 작업
- 없음

### 완료된 작업 (이번 세션)
- **상세 헤더 두 밴드 표준** — Q Mail·Q docs·Q Note 통일. 본문 시작 y 197→117, 좌우 밑줄 247/247 일치
- **구글 로그인 앱 복귀** — 기기코드 페어링(`services/oauthPairing.js`). 6자리를 *로그인을 마친 브라우저*에서
  생성해 계정 탈취 벡터 제거(Fable 3라운드). 딥링크 둘 다 실패해도 로그인이 끝난다
- **Fable 사용 기준 박제** — `R=1 OR (S=1 AND F=0)` 판정식(CLAUDE.md). "무조건"→"고위험만"
- **태블릿 상단 탭 가로+세로** — `TABS_MEDIA` 900→550px. 상단 크롬 96px→40px(한 겹), 햄버거를 탭바로
- **오버레이 기준선 통일** — `--pq-chrome-bottom` + `belowTabs`/`belowChrome`. 우측 패널 8곳 적용,
  `--category=overlaytop` 가드로 재발 차단. (오버레이 101개 기계 전수조사)
- **딥링크 → 엉뚱한 상세** — `setTabScope` 어긋남 판정을 identity→경로 전체로. detailopen 7/13→13/13
- **assetlinks 업로드 키 지문 추가** — Play 미승인 상태의 사이드로드 APK 는 App Link 검증이 불가능했다
- **안드로이드 APK 릴리즈 빌드** — 로컬(JDK 21 + platform 36), `adjustResize`·운영 URL·versionCode 100
- **검사기 2건 교정** — `keep-alive`(하니스가 만든 탭을 앱 탓으로) · UI 규격 정규식이 토큰 40px 을 위반으로
  세던 것(781→738)
- **`auth_oauth.js` 610줄 → 네 모듈 분리** (`7d38d2a6`, 운영 배포) — god-file 래칫 해소(46→45/45),
  가드 34/34 전체 통과. 라우터는 하나 그대로 두어 등록 순서·마운트 무변경.
  공유 Map(confirmStash·usedNativeCodes)은 `oauth/core.js` 단독 소유 — 두 벌이 되면 연결 확인이
  "만료됨" 이 되고 replay 차단이 무너진다. **Fable 게이트 PASS(조건 없음)**.
- **운영 청크 정리** (`8a965dfc`) — 36,761개/636MB → 20,601개/**358MB**.
  `scripts/prune-prod-assets.sh` 신규(dry-run 기본 · 삭제 아닌 **격리**).
  ★ mtime 으로 지우면 안 된다 — 안 바뀐 청크는 해시가 같아 살아 있는데 오래돼 보인다.
  살아있는 목록을 빌드 산출물에서 계산하고, 로컬 빌드가 운영과 어긋나면 중단한다.
  격리본 `/opt/planq/backups/stale-assets-20260906_223337` (280M) — 확인 후 `--purge-quarantine` 로 삭제.

### 다음 할 일
1. **Irene 태블릿 실기기 확인 대기** — 세로/가로 상단 탭 · 업무상세 우측패널 정렬 ·
   알림으로 다른 항목 열기 · APK 설치 후 키보드 위 입력란 · 구글 로그인 앱 복귀
2. iPad(iOS) 실기기 확인 — 키보드 위 입력란
3. Codemagic `android-play` 재빌드 (오늘 것은 로컬 빌드 APK)
4. 격리한 옛 청크 삭제 — 며칠 두고 이상 없으면
   `scripts/prune-prod-assets.sh --purge-quarantine /opt/planq/backups/stale-assets-20260906_223337`

### 미해결 (오늘 답 못 한 것)
- 닫힌 프로젝트의 기존 게스트 링크 정책
- Q Note 메모의 AI요약/업무추출 밴드 접기 여부
- Q Talk 채팅 헤더 65px (부제가 헤더 안에 쌓여 60px 계약 초과)

---

## 복구 가이드

새 Claude 세션 시작 시 아래 내용을 붙여넣으세요:

```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```
