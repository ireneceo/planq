# 마케팅 측정 켜기 — 순서대로 (2026-10-18, Irene 승인 «권고대로»)

설계 정본 `docs/MARKETING_TRACKING_DESIGN.md`. 코드는 dev 에 다 들어가 있고, **운영에서 켜는 스위치는 관리자 화면의 GTM ID 한 칸**이다.
그 칸을 채우기 전까지 운영에서는 아무 태그도 돌지 않는다.

| # | 무엇 | 누가 | 언제 |
|---|---|---|---|
| 1 | 코드·처리방침 문구 배포(마이그레이션 `migrate-marketing-tags.js` 는 배포 슬롯에 있음) | 배포 방 | 다음 배포 |
| 2 | 처리방침 개정 공지 — 공지 띠 + 회원 메일 | Irene(명령 한 줄) | **배포 당일**(시행 2026-10-26 의 7일 전까지) |
| 3 | 운영·dev nginx CSP 적용(GTM·픽셀 스크립트 허용) | Irene(sudo) | 배포 뒤 아무 때나 |
| 4 | Google 태그 관리자·GA4·Meta 계정에서 ID 만들기, GTM 컨테이너 가져오기 | Irene | 시행일 전 |
| 5 | GTM 게시 → 운영 관리자 > 플랫폼 설정 > «마케팅 측정» 에 GTM ID 입력 | Irene | **2026-10-26 시행일 이후** |
| 6 | 확인 — GTM 미리보기·GA4 실시간·Meta 테스트 이벤트 | Irene + 이 방 | 켠 직후 |

★ 배포가 10-19 보다 늦어지면 시행일을 **배포일 + 7일**로 옮긴다 — 바뀌는 곳 셋: ① `dev-frontend/src/pages/Legal/PrivacyPolicy.tsx` effectiveDate ② `locales/{ko,en}/legal.json` privacy.s10 변경 이력 날짜 ③ `dev-backend/services/emailService.js` POLICY_NOTICE ko/en 제목·본문 날짜.
★ 배포 때 `dev-backend/scripts/send-policy-notice.js` 가 운영 `backend/scripts/` 에 실렸는지 확인한다.

## 2. 개정 공지
- 공지 띠: 운영 관리자 > 플랫폼 설정 > 공지 — 한국어 «개인정보처리방침이 2026년 10월 26일부터 바뀝니다(공개 소개 페이지의 방문 통계·광고 측정 도구 추가). 자세히: 개인정보처리방침» · 영어 «Our Privacy Policy changes on October 26, 2026 (visit statistics and ad measurement on our public pages).»
- 회원 메일: 운영 서버에서 `cd /opt/planq/backend && NODE_ENV=production node scripts/send-policy-notice.js` (미리보기 — 보낼 사람 수만 나온다) → 나온 수 N 으로 `… --send --confirm=N`. 다시 돌려도 이미 보낸 주소는 건너뛴다.

## 3. nginx CSP (sudo)
dev: `sudo bash /opt/planq/scripts/apply-nginx-security-headers.sh dev` · 운영: 개발 서버에서 `scp /opt/planq/scripts/apply-nginx-security-headers.sh irene@87.106.78.146:/tmp/` → 운영 서버에서 `sudo bash /tmp/apply-nginx-security-headers.sh prod` (운영에는 루트 scripts/ 가 없다). 적용 뒤 `curl -sI https://planq.kr | grep -i content-security` 에 `googletagmanager.com` 이 보이면 된다.

## 4. 계정·ID·컨테이너
1. **Google 태그 관리자**(tagmanager.google.com) → 계정 «PlanQ» · 컨테이너 «planq.kr» · 대상 «웹» → `GTM-XXXXXXX` 를 받는다.
2. **GA4**(analytics.google.com) → 속성 «PlanQ» · 웹 스트림 `https://planq.kr` → 측정 ID `G-XXXXXXXXXX`.
   - 스트림 > 향상된 측정: **페이지 조회의 «브라우저 기록 이벤트 기반 페이지 변경» 끔 · 양식 상호작용 끔 · 사이트 검색 끔 · 아웃바운드 클릭·파일 다운로드 끔**
   - 관리 > 데이터 보관 **14개월** · Google 신호 **끔** · 이벤트 > 주요 이벤트: `sign_up`·`generate_lead` · 데이터 필터 > 내부 트래픽(사무실 IP)
   - 관리 > 제품 링크 > **Search Console 연결**(이미 있는 planq.kr 속성)
3. **GTM 가져오기** — 관리 > 컨테이너 가져오기 > `docs/marketing/gtm-container-import.json` · 기존 작업공간 · **병합** → 변수 `GA4 측정 ID`·`Meta 픽셀 ID` 값을 실제 ID 로 바꾼다.
   (가져오기가 실패하면 설계서 §7 표대로 손으로 만든다 — 변수 16 · 트리거 11 · GA4 태그 11)
4. **Meta**(business.facebook.com > 이벤트 관리자) → 픽셀 만들기 → 픽셀 ID · 설정에서 **자동 고급 매칭 끔** · **도메인 확인**(planq.kr, DNS TXT 권장) · 집계 이벤트 측정 우선순위 `CompleteRegistration`·`Lead`.
   GTM 에서 템플릿 갤러리 «Facebook Pixel»(facebookarchive) 추가 → 태그 4개(맞춤 HTML 은 CSP 에 막혀 안 됨):
   - 기본: 픽셀 ID `{{Meta 픽셀 ID}}` · 이벤트 PageView · **Disable automatic configuration 켬 · Disable pushState 켬** · 트리거 `CE - pq_page_view` · 추가 동의 확인 `ad_storage`
   - CompleteRegistration(+ 같은 태그 복제해 StartTrial, value 0 · KRW) · 트리거 `CE - pq_sign_up`
   - Lead · 트리거 `CE - pq_lead`, `CE - pq_diagnosis_email`
   - ViewContent · 트리거 `CE - pq_view_pricing`, `CE - pq_view_service`
5. **Search Console** — 이미 등록돼 있다(06-05 sitemap). 속성이 «도메인» 인지 «URL 접두어» 인지만 확인.

## 6. 켠 뒤 확인
GTM [미리보기] 로 `https://planq.kr/pricing` 열기 → `pq_page_view`·`pq_view_pricing` 에 GA4·Meta 태그가 «실행됨» · 로그인 후 앱 화면(`/inbox`)에서는 GTM 이 **아예 안 보여야** 정상.
GA4 실시간에 page_view, Meta 테스트 이벤트에 PageView 가 뜨면 끝.
처리방침 문구가 사실인지 같이 확인 — **GA4 데이터 보관 14개월**(기본 2개월이면 문구가 거짓) · GA4 «양식 상호작용» 끔 · Meta «자동 고급 매칭» 끔 · 픽셀 «Disable pushState» 켬.
