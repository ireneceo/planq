## 현재 작업 상태
**마지막 업데이트:** 2026-09-22
**작업 상태:** 완료 (운영 배포 6회 · v1.55.3 유지 · 마지막 배포 cd852d9d 계열) [Claude Code]

### 진행 중인 작업
- 없음

### 완료된 작업 (이번 세션 — 전부 운영 배포됨, Fable 미검증(자체 검증) · 429 한도)
- Apple 로그인 운영 동작 (Team ID 교정) · App Store 정식 심사 제출(빌드 16, 수동 출시)
- 데모 계정 한국어 시드 · 빈 메시지 대화 삭제 · Q docs 휴지통 영어 번역
- 휴지통 통합 (components/Trash — 전체·파일·문서·정보, 아이콘 버튼, Q info 진입점)
- SEO/AEO 1단계: 크롤러 본문 prerender(#root 시각숨김) · 홈 생성 · FAQPage/Breadcrumb · .gz 동시 기록
- 랜딩 문구 교정: 요금제 FAQ·추가구매 가격을 실제 청구에 · Pro API 제거 · 개발 용어 25곳
- SEO/AEO 2단계: 업무 가이드 9편(FAQ 26 포함) · 글 FAQ 자동 구조화 · llms.txt · <strong> 노출 수정
- Q mail: 비밀번호 재설정·보안 경고 메일 → 확인 권장 · 운영 retriage 56통

### 다음 할 일
- **App Store 심사 대기** — 승인 → Irene [출시] → 운영 `app_ios_url` 을 App Store 주소로(내가). 반려면 사유 원문으로. memory `project_app_release_status`
- **Irene 결정 대기**: 추가구매 가격(페이지를 청구 설정 ₩4,900 등에 맞췄다 — 반대가 의도면 청구 설정 변경) · Apple .p8 키 교체 권장
- **~2026-10-10**: Search Console 검색어 + 랜딩 방문 집계로 업무 가이드 효과 분석 → 잘 되는 주제 추가 · [AI 마케팅 분석] 버튼
- Fable 가용 시 `docs/FABLE_GATE_QUEUE.md` 9/21~9/22 항목 일괄(Apple 로그인 최우선)
- 보류: 요금제 추가구매 카드 3→5 · 캘린더 참석자 알림 묻기·외부 이메일 초대 · #381·#382·#411·#417~#419

---

## 복구 가이드

새 Claude 세션 시작 시 아래 내용을 붙여넣으세요:

```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```
