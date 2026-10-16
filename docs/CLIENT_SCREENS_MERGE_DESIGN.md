# 고객 화면 한 벌로 — 설정 > 고객 을 Q sale 로 합친다 (Fable 설계 판정 2026-10-16)

> Irene: *"원래 설정에 고객리스트와 큐세일즈에 고객이랑 또 따로 만들었어? 큐세일즈랑 연결이나 합쳐서 제대로 구성되게 점검 해줘"*

## 점검 결과(사실)
- 데이터는 한 벌(`clients`). 화면이 네 벌이었다 — 설정 > 고객(`/business/clients`, 자체 드로어) · Q sale > 고객 탭 + 패널(ClientPanel) · Q sale 상세(`/sale/:id`) · 고객 타임라인(`/business/clients/:id/timeline`).
- 갈라진 것: 사업자·증빙 편집·정기 청구·메모·보관·초대 배너·감사 이력은 설정에만 / 단계·담당·연결·통합 히스토리는 Q sale 에만.
  설정 드로어는 연결 프로젝트를 `user_id` 로만 찾아 계정 없는 고객의 프로젝트가 0 으로 보였다(dev 5명). 메뉴 권한 키도 `clients`·`qsale` 두 개.

## 판정
1. **Q sale 하나로 합친다.** 설정 > 고객 메뉴·화면은 없애고 옛 주소는 Q sale 로 넘긴다(`/business/clients` → `/sale?tab=clients` · `?client=` → 패널 · `?new=1` → 고객 추가 · `/:id/timeline` → `/sale/:id`).
2. **상세 정본 = ClientPanel + SaleDetailPage 가 같은 절 컴포넌트**(`components/Clients/`): 사업자·증빙 편집 · 정기 청구 · 메모 · 상태 배너(초대 대기·직접 관리·보관) · 변경 이력. 유형(kind)은 프로필 폼에.
3. **권한 키 `qsale` 하나.** 서버 `requireMenu('clients')` → `'qsale'`, `clients` 키 폐지. 옛 행은 `scripts/migrate-menu-key-clients.js`(dry-run 기본 · `--apply`) — 더 좁은 쪽(fail-closed), 옛 행은 지우지 않는다.
4. 추가 문: 상담 탭 [+ 고객응대 내역 추가](문의) · 고객 탭 [+ 고객 추가](초대 / 직접 관리 — 옛 설정 폼을 빼서 씀).
5. 연결 프로젝트 판정은 Q sale 술어(`client_id OR contact_user_id`) 하나. `PUT /api/clients/:biz/:id` 가 저장 뒤 방송하지 않던 것도 고친다.

## 뺀 것
이름·회사·전화·이메일 쓰기 두 벌(PUT clients / PATCH sale) 통합 · 삭제 라우트의 project_clients 정리 술어 · Q sale 베타 칩·메뉴 이름 · 목록 인라인 편집.
