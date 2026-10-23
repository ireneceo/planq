---
paths:
  - "dev-frontend/src/components/Trash/**"
  - "dev-backend/routes/*trash*.js"
  - "dev-backend/services/contentTrash.js"
---

<!-- CLAUDE.md 에서 옮긴 규칙 (2026-10-23). 이 경로의 파일을 읽거나 고칠 때 자동으로 실린다. 문장은 옮기기만 했다. -->
# 휴지통

## 휴지통은 **하나**다 (2026-09-22 박제)

> Irene: *"휴지통이 분산되어 있는 거 이상한데. 그리고 글자로 휴지통 말고 아이콘만 쓰는 거 어때?"*

- 서랍 `components/Trash/TrashDrawer`(탭: 전체·파일·문서·정보) + 여는 버튼 `components/Trash/TrashButton`(아이콘만 36px·폰 40px,
  `aria-label`·`title` 필수) **한 벌**. Q file·Q docs·Q info·프로젝트 탭·개인 보관함이 같은 것을 쓰고, 연 메뉴의 칸이 먼저 선택된다.
  자리는 **검색·필터 줄 오른쪽 끝**. 목록은 `FileTrashPanel`·`ContentTrashPanel` — 서버 보관·복원은 파일/콘텐츠 두 라우트 그대로.
- 예전엔 서랍 두 개·버튼 두 모양이었고 **Q info 에는 여는 문이 없었다**(지운 정보는 Q docs 에서만 되살릴 수 있었다).
- 새로 휴지통에 들어가는 종류가 생기면 **칸(탭)을 더한다.** 서랍을 새로 만들지 않는다.
- ★ 서랍 본문(`DetailDrawer.Body`)은 세로 flex 다 — `overflow` 를 준 자식은 `flex-shrink: 0` 이 없으면 **0px 로 눌려 안 보인다**
  (탭 줄이 좌표는 52×26 인데 한 픽셀도 안 그려져 클릭이 본문에 떨어졌다. 크기만 쟀으면 놓쳤다).

