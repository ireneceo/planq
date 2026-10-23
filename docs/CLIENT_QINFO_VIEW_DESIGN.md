# 고객 홈 «자료» 칸 — 고객이 자기 범위 Q info 를 읽기 전용으로 (2026-10-23)

- Irene 원문(2026-10-22): «Q info는 DB처럼 … 통합정리하는 곳이야 … 고객에게도 접점이 제대로 연결되어 있는지 확인해.»
  → 조사(고객 화면에 Q info 없음) 보고 · 권고 ② «고객 홈에 자료 칸, 그 고객 범위만 읽기 전용, 비밀 칸·대외비 제외» → Irene «권고대로 진행해 줘».
- Fable 설계 판정 2026-10-23: **DESIGN: OK** (아래가 판정 요지 — 구현은 이대로)

## ① 볼 수 있는 항목 = 기존 한 벌 + vlevel 한 조건
- `access_scope.canClientReadKb` / `kbClientReadableWhere` 두 함수에만 `vlevel = 'L4' OR vlevel IS NULL` 추가. 고객 홈·Cue·검색이 같은 술어(좁히는 변경 — Cue 는 fail-closed 방향).
- 프로젝트·워크스페이스 범위 자료는 고객 연결 프로젝트여도 안 보인다(10-16 «고객은 연결된 곳만»).
- 옛 항목 숨김 플래그·스키마 없음 — L4 힌트가 원래 «고객도 본다» 였고 10-16 부터 Cue 가 이미 고객 답변에 인용한다. 내부 메모성 행은 보안등급 internal 로(기존 장치).

## ② 내보낼 필드 = 화이트리스트 `services/kbClientView.js`
- 목록 `kbClientListRow`: id·title·created_at·updated_at·has_body·item_count(비밀 아닌 살아 있는 칸 수).
- 상세 `kbClientDetail`: + body(화면이 sanitizeRichText) · custom_columns(**secret 제외**, `{id,name,type}`) · custom_values(그 칸 값만).
- 안 내보냄: secret 칸(라벨까지)·tags·분류·작성자·첨부·share_*·범위/등급 칸·색인 칸.
- 공개 링크 by-token 도 같은 칸 선별 함수(secret 칸 값이 나가던 구멍).

## ③ API (`routes/client_home.js`, actorOf 체인 — 고객만)
- `GET /api/client-home/:biz/info` (default 100 / max 200, created_at DESC) · `GET /api/client-home/:biz/info/:id`(없으면 404 — 존재 은닉, `canClientReadKb` 재확인) · 홈 응답에 `info_count`.

## ④ 화면 — 고객 홈 탭 `kb`(«자료 N», 0 이면 탭 없음) · `?tab=kb&doc=<id>` · `ClientInfoTab` 은 GuestDocsTab 껍데기(guestShell·guestCards·읽기 시트) 재사용, 편집·복사·공유·첨부 없음.

## ⑤ 실시간·감사·i18n
- `broadcastKb` 에 한 줄: scope client 면 연결 고객 계정(`Client.user_id`, active)의 `user:<id>` 방에 신호 `{id, business_id}`. 화면은 250ms 디바운스 재조회 + useVisibilityRefresh.
- 감사 없음(읽기). i18n guest ko/en · 등록 힌트 4곳 같은 문장.

## ⑥ 운영 — 스키마·마이그레이션 없음. 배포 전 읽기 전용 확인: 운영 `kb_documents WHERE scope='client'` 목록(계정 고객 연결 건수)을 Irene 에게 보여 «이 제목들이 고객 홈에 보이게 된다» 확인.

## ⑦ 자체 검증 — 고객 A 양성/B 음성(404)/멤버 403 · internal↔general 뒤집기 · L1 행 안 보임·NULL 보임 · 프로젝트 범위 안 보임 · 응답 원문에 secret 값·client_ids·uploaded_by·tags 0(대조 text 값 있음) · by-token 같은 2건 · 홈 목록 ids == kbClientReadableWhere · 휴지통/복원 · 페이지네이션 · 화면 3폭(탭 숨김/보임·시트·DOM secret 0·버튼 0·Esc/뒤로) · 실시간 양성/음성.
