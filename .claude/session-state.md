# PlanQ 세션 상태

## 현재 작업 상태
**마지막 업데이트:** 2026-07-01 (운영 피드백 마라톤 + 설정 IA 전면 재설계 — /개발완료)
**작업 상태:** 완료 · **운영 배포 5배치 완료 + 설정 IA 최종분 dev 대기(Irene 확인 후 /배포)**

### 진행 중인 작업
- 없음. **설정 IA 최종분(내 계정 2뎁스 패널·권한/청구 위로·Cue 구성원·내 메일 계정 중복제거)은 dev 반영 완료, 운영 미배포 — Irene dev 확인 후 `/배포` 대기.**

### 완료된 작업 (2026-07-01 세션)
- **프로젝트 문서 탭 = 파일 탭 통일** (공용 assetTabLayout) + URL버그 + 탭 지연로드(속도) + 추가탭 표상세 — 배포됨
- **🔴 #106 개인파일 유출 fix(보안)** · **#101/#103 주간그래프 실제시간** · **#87/#98 표시명(한수정→루아)** — 배포됨(cd3cf30)
- **청구서**: 정기 draft 인박스 노출 · 나에게 미리보기 · 정기청구 자동/수동 설정 · 발송→채팅 전달 fix · Q Bill 뱃지 — 배포됨
- **디자인 토큰 전수 통일**(active검정→teal·EEF2F6·0369A1·radius·violet 60+파일) + 증빙탭=청구서탭 FilterChips — 배포됨(6d2e604)
- **#95·#104·#109 + Drive 개인/팀 분리** — 배포됨(80bb3e3)
- **★ 설정 IA 전면 재설계**(회사=설정/개인=내 계정 2뎁스, 업무환경 병합, scope 분리, 이름정리) — **dev만, 미배포**
- **CLAUDE.md Fable 검증 게이트 블록 추가**

### 함정/원칙 박제 (memory)
- feedback_filter_all_option_mandatory — 필터/탭/그룹 나누면 "전체" 필수
- (기존) feedback_member_display_name_on_lists · feedback_visibility_refresh_server_fresh · project_google_oauth_verification_pending 등

### 다음 할 일
1. **설정 IA 최종분 `/배포`** (Irene dev 확인 후)
2. **남은 피드백**: #99 채팅 업무링크(task 공개미리보기 정책) · #96 문서 표 UX · #90 Cue 파싱 · #97 이미지 리사이즈·속도 · #105 Focus 일시정지 즉시반영 · #86 모바일 퀵메뉴 · #85 보고서 SCR 헤드라인 · #89 랜딩 푸터 · #63 일괄 다운로드 · #60 모바일 푸시
3. **신규 기능**: 새 탭으로 열기(멀티뷰, NavItem 이미 Link) · 공통 브레드크럼 · 뒤로가기/로딩 캐시(경량 stale-while-revalidate)
4. **디자인 tail**: 뱃지 padding 1px7px→2px8px · EmptyState/Loading 공용 컴포넌트화 · Q Mail 계정 필터 "전체" 항상
5. **외부(Irene)**: Gmail OAuth 검증(Verification Center) 또는 테스트유저 — restricted scope. 당장 Gmail은 앱 비밀번호.

---

## 복구 가이드

새 Claude 세션 시작 시:
```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```
