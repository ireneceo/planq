# PlanQ 세션 상태

## 현재 작업 상태
**마지막 업데이트:** 2026-07-02 (Fable 검수 세션 — 연동 3종 fix + 지식 루프 3축 + 네이티브앱 계획)
**작업 상태:** 진행 중 · **dev 반영 완료, 운영 미배포 (Irene /배포 대기)**

### 완료된 작업 (2026-07-02 세션, Fable)
- **🔴 메일 유실 근본 fix** — matchClient 가 없는 clients.email_aliases 컬럼 조회 → 신규 스레드 수신메일 전멸. dev 1000통 + 운영 11통 재수집 완료, 빈 스레드 정리. 운영 DB 컬럼 선반영(승인 하). 커밋 1684253
- **메일 등록 사전검증** — POST/PUT 시 IMAP 실연결 강제, provider 별 안내 코드(gmail/naver/ms 앱 비밀번호). 도메인→서버 자동완성, outlook/kakao/daum 가이드, 오류 원인 카드 배지. 실 API 3/3 PASS
- **운영 irene@ 메일 계정 삭제** (Invalid credentials 204회 — Irene 재테스트 예정, 앱 비밀번호 안내 완료)
- **share-cleanup invoices shared_at 크래시 fix / S3 ENUM +s3 (모델+dev ALTER) + softDeleteFile s3 분기 / GDrive last_error 관측성 + 재연결 배지** (GDrive 토큰 refresh 실동작 확인 — 정상)
- **피드백 3건**: #105 Focus 일시정지 즉시반영(focus:refresh 드로어 수신), #97 이미지 리사이즈(sharp ?w= + webp 캐시, 709KB→6.5KB), #90 Cue 담당자 안전망 + 미매칭 경고. 커밋 4eb2732
- **★ 지식 루프 3축 (docs/KNOWLEDGE_LOOP_DESIGN.md + TESTS.md)** — E2E 29/29 PASS:
  - 축2 Q위키 자기강화: help_question_logs + 답변 피드백 2버튼 + 주간 클러스터→위키 초안(gpt-4o-mini, 사람 발행 게이트) + admin 질문로그 대시보드. cron 월 05:00
  - 축1 Cue 지식: cue_knowledge 카드(수락 게이트) + 설정>Cue 관리 UI + 실측시간 통계 프롬프트 주입(ai-create/추정) + client.summary 재사용 + **memo 실버그 fix**(고객 컨텍스트 전멸이던 것) + task 결과물 "KB에 저장" 버튼. cron 월 05:20
  - 축3 랜딩 블로그: Q위키 발행 플래그 → /api/blog public API → BlogPage 실데이터 + /blog/:slug 상세(SEO meta) + admin 블로그 토글
- **docs/NATIVE_APP_PLAN.md** — Capacitor 네이티브앱 계획 (Opus 실행용). Irene: Mac 있음/개발자계정 미가입(최우선 액션), App Store 공개 정식 목표

### 다음 할 일
1. **커밋(지식루프 배치) + Irene dev 확인 후 /배포** — 운영 수동 ALTER 목록: docs/KNOWLEDGE_LOOP_TESTS.md 하단 (files ENUM s3 / business_cloud_tokens last_error / help_question_logs / cue_knowledge / help_articles 4컬럼)
2. **Opus 위임**: 네이티브앱(docs/NATIVE_APP_PLAN.md 체크리스트) + 피드백 #96 문서표 UX·#86 모바일 퀵메뉴·#85 보고서 헤드라인·#89 랜딩 푸터·#63 일괄다운로드 + 새탭/브레드크럼/캐시 + 디자인 tail
3. **Irene 액션**: Apple Developer Program 가입($99) · Google OAuth 검증 제출 · 운영 메일 재연결 테스트(앱 비밀번호)
4. 설정 IA 최종분(전 세션분)도 여전히 미배포 — 이번 배포에 같이 나감

### 함정/박제 (이번 세션)
- clients.email_aliases / shared_at / files ENUM — **코드가 참조하는 컬럼의 DB 실존 여부** 검증 필요 (모델·raw SQL 모두)
- buildCueContext 스냅샷은 개별 .catch 필수 (하나 죽으면 컨텍스트 전멸하던 실사례 2건)
- IMAP parse 실패는 uid 전진 → silent 유실. fail_count 0 이어도 최신 스레드 날짜로 정합 확인

---

## 복구 가이드

새 Claude 세션 시작 시:
```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```
