// reload 해도 되는가 — **단일 술어** (2026-09-11 BuildVersionGuard 에서 추출)
//
// 새 빌드 자동 반영(BuildVersionGuard)과 워크스페이스 전환 전파(WorkspaceSyncGuard)가 같이 쓴다.
// 두 곳이 각자 판정하면 한쪽만 녹음·편집을 지키고 다른 쪽은 날린다.
//
// 보류 기준 (데이터·작업 흐름 보호):
//   포커스가 입력란·contentEditable 에 있음
//   body[data-form-dirty] / [data-form-dirty="1"] — 미저장 변경 (자동저장이 끝나면 꺼진다)
//   body[data-editing-active] / [data-editing-active="1"] — **편집 화면이 열려 있음** (저장 여부와 무관)
//     ★ formDirty 는 자동저장이 끝나는 순간 꺼진다 — 그 틈에 reload 하면 글을 쓰는 중에 편집이 닫힌다
//       (운영 신고 2026-08-21: "고치면 저장되어 버려 / 닫혀, 편집이")
//   body[data-pip-active] — 핀(Document PiP) 창은 opener 문서에 종속, reload 하면 핀 창이 같이 죽는다
//   body[data-recording-active] — Q Note 녹음 중 reload = 마이크 사망
export function isReloadSafe(): boolean {
  try {
    const el = document.activeElement as HTMLElement | null;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return false;
    if (document.body.dataset.formDirty === '1') return false;
    if (document.querySelector('[data-form-dirty="1"]')) return false;
    if (document.body.dataset.editingActive === '1') return false;
    if (document.querySelector('[data-editing-active="1"]')) return false;
    if (document.body.dataset.pipActive === '1') return false;
    if (document.body.dataset.recordingActive === '1') return false;
  } catch { /* noop */ }
  return true;
}
