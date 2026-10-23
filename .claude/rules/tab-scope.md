---
paths:
  - "dev-frontend/src/components/Tab/**"
  - "dev-frontend/src/stores/**"
  - "dev-frontend/src/components/Layout/**"
  - "dev-frontend/src/config/**"
  - "dev-frontend/src/pages/Admin/**"
  - "dev-frontend/src/components/Admin/**"
---

<!-- CLAUDE.md 에서 옮긴 규칙 (2026-10-23). 이 경로의 파일을 읽거나 고칠 때 자동으로 실린다. 문장은 옮기기만 했다. -->
# 탭 범위 계약

## 탭 범위 계약 — 범위를 바꾸는 문은 **하나**다 (2026-09-10 박제)

> Irene: *"플랫폼관리자에서 탭이 제목이 제대로 안바뀌고 탭을 열면 다른 워크스페이스 탭이 열려.
> 워크스페이스별로, 플랫폼관리자도 마찬가지로 각각 따로 탭기능이 움직여야 하는 건데."*

1. **`kind` 는 경로에서 나오는 파생값이다 — 저장된 값을 믿지 마라.** `scrub()` 이 읽을 때마다
   `kindOfPath` 로 다시 센다. 안 그러면 매핑을 고쳐도 **이미 열려 있던 탭**은 옛 kind 를 들고 있어
   고친 티가 안 난다. (`/admin` 이 `PREFIX_KIND` 에 없어 관리자 화면 15개가 전부 `other` 였다 —
   그래서 ①이름이 언제나 "설정" ②identity 가 같아 **서로를 덮어썼다**.)
2. **탭 이름은 화면이 심지 않는다 — 표에서 읽는다.** `adminLabelKeyForPath()` 가 사이드바와 같은
   `ADMIN_MENUS` 를 읽는다. 화면마다 `useTabTitle` 을 부르게 하면 **하나만 빠뜨려도 그 탭만**
   조용히 기본값으로 떨어진다(상태값 규약과 같은 사고). 메뉴를 늘리면 탭 이름도 따라온다.
3. **탭을 여는 문은 자기가 어느 범위인지 넘긴다.** `visibleNavMenus({ scope })` ·
   `<GlobalSearchModal scope=…>`. 넘기지 않으면 platform_admin 에게는 *어디서든* 워크스페이스
   메뉴가 섞여 나오고, 누르는 순간 `newTab → ensureScopeFor → setTabScope` 가 **말없이 범위를
   갈아끼워** 직전 워크스페이스의 탭 목록이 통째로 되살아난다.
4. **범위를 바꾸는 문은 워크스페이스 전환기 하나다.** `+`·검색·드롭다운은 자기 범위 안에서만 연다.
   그 대가로 platform_admin 이 워크스페이스 `+` 로 관리자 화면을 못 연다 — **의도한 것**이다.
5. 회귀는 `--suite scopetabs` 와 **`--suite admintabs`** 둘이 막는다.
   ★ `scopetabs` 단독으로는 이 계열을 **구조적으로 못 잡는다** — 스냅샷이 탭의 `path` 만 담고
   **`title` 을 버리며**, 탭을 여는 문(`+`)을 한 번도 누르지 않는다. 그래서 admintabs 를 만들었다.
6. **카나리가 만드는 임시 계정은 약관 *버전*까지 채운다.** 시각만 채우면 로그인 직후 재동의 모달이
   전면에 뜨는데, `aria-modal` 이 하나 떠 있어 **"열린 것처럼" 보인다** — 실제로 `+` 판정이
   양쪽 다 0건으로 나와 하마터면 초록으로 넘어갈 뻔했다. 양성 대조군이 잡았다.

---

