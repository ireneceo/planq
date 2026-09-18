// 「새 노트」 메뉴 — **항목 목록과 껍데기를 한 곳**에 둔다.
//
// Q note 사이드바의 ＋ 와 Q sale 의 [상담 진행] 이 같은 메뉴를 쓴다. 베껴 두면 한쪽에만 항목이
// 늘거나 순서가 갈라진다(CLAUDE.md "껍데기는 빼서 같이 쓴다 — 베끼면 갈라진다").
//
// ★ 하는 일은 자리마다 다르다 — 그것만 `onPick` 으로 받는다:
//     · Q note 안  : 그 자리에서 바로 시작한다(모달/녹음)
//     · 그 밖의 화면: `/notes?new=<kind>` 로 **Q note 를 연다**(QNotePage 가 매번 소비하는 기존 문)
//   문구(i18n 키)·순서·testid 는 공유한다.
import { createPortal } from 'react-dom';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import type { AnchorPos } from '../Common/popoverAnchor';
import { listRowTitleCss } from '../../theme/tokens';
import { tabStore } from '../../stores/tabStore';

export type NewNoteKind = 'memo' | 'quick' | 'upload' | 'voice';

/** 순서 (Irene 2026-09-11): 메모 → 음성메모 → 녹음 파일 → 음성 노트(대화형).
 *  가벼운 것에서 무거운 것으로 — 적기 · 바로 녹음하기 · 가진 녹음 올리기 · 준비해서 회의하기. */
// ★ 문구는 **로케일에만** 둔다. 여기 한국어 기본값을 적으면 같은 문장이 두 곳이 되고,
//   로케일을 고쳐도 폴백이 남아 갈라진다(그리고 하드코딩 래칫이 올라간다).
//   네 키 모두 ko/en 양쪽에 있다 — `qnote:page.newNoteDropdown.*`.
export const NEW_NOTE_KINDS: Array<{ kind: NewNoteKind; testId: string; titleKey: string; descKey: string }> = [
  { kind: 'memo', testId: 'qnote-new-memo',
    titleKey: 'page.newNoteDropdown.memoLabel', descKey: 'page.newNoteDropdown.memoDesc' },
  { kind: 'quick', testId: 'qnote-quick-record',
    titleKey: 'page.newNoteDropdown.quickLabel', descKey: 'page.newNoteDropdown.quickDesc' },
  { kind: 'upload', testId: 'qnote-upload-audio',
    titleKey: 'page.newNoteDropdown.uploadLabel', descKey: 'page.newNoteDropdown.uploadDesc' },
  { kind: 'voice', testId: 'qnote-new-voice',
    titleKey: 'page.newNoteDropdown.voiceLabel', descKey: 'page.newNoteDropdown.voiceDesc' },
];

/** Q note 밖에서 부르는 기본 동작 — 그 종류로 Q note 를 새 탭에 연다.
 *  (하던 일 위에 얹히는 진입점은 새 탭 — 보던 화면을 덮지 않는다.) */
export function openQNoteWithKind(kind: NewNoteKind) {
  tabStore.openInNewTab(`/notes?new=${kind}`);
}

/**
 * ★ **body 로 포털해 `position: fixed` 로 띄운다.** 절대위치로 두면 조상이 자르는 자리에서
 *   메뉴가 통째로 사라진다 — 2026-09-18 실측: Q sale 머리줄이 폰에서 `overflow:auto` 인 49px 띠라
 *   메뉴 rect 가 **x=-111 · 높이 241 중 49만** 남아 4항목이 한 픽셀도 안 그려졌다
 *   (aria-expanded 는 true — 「눌려도 아무 일 없는 컨트롤」). memory
 *   feedback_clipped_menu_reads_as_dead_button.
 *   좌표·바깥클릭·Esc·포커스는 공용 `usePopoverAnchor` 한 벌이 준다.
 */
export function NewNoteMenu(
  { pos, panelRef, onPick, onMouseLeave }: {
    pos: AnchorPos | null;
    panelRef?: React.Ref<HTMLDivElement>;
    onPick: (kind: NewNoteKind) => void;
    onMouseLeave?: () => void;
  },
) {
  const { t } = useTranslation('qnote');
  if (!pos) return null;
  return createPortal(
    <NewNoteDropdown ref={panelRef} style={{ top: pos.top, right: pos.right }}
      onMouseLeave={onMouseLeave} data-testid="qnote-new-menu" role="menu">
      {NEW_NOTE_KINDS.map((it) => (
        <NewNoteItem key={it.kind} type="button" data-testid={it.testId} onClick={() => onPick(it.kind)}>
          <NewNoteItemTitle>{t(it.titleKey) as string}</NewNoteItemTitle>
          <NewNoteItemDesc>{t(it.descKey) as string}</NewNoteItemDesc>
        </NewNoteItem>
      ))}
    </NewNoteDropdown>,
    document.body,
  );
}

// ── 껍데기 (값은 Q note 사이드바의 것을 그대로 옮겼다 — 바꾸지 않는다) ──
export const NewSessionWrap = styled.div`position: relative;`;
export const NewSessionBtn = styled.button`
  width: 32px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: #14B8A6;
  border: none;
  border-radius: 8px;
  color: #FFFFFF;
  cursor: pointer;
  transition: background 0.15s;
  padding: 0;
  &:hover { background: #0D9488; }
  &:focus-visible { outline: 2px solid #0D9488; outline-offset: 2px; }
`;
export const NewNoteDropdown = styled.div`
  /* 좌표는 usePopoverAnchor 가 인라인 style 로 준다(트리거 오른쪽 끝 기준). */
  position: fixed;
  z-index: 2000;
  min-width: 220px;
  max-width: calc(100vw - 16px);
  background: #FFFFFF;
  border: 1px solid #E2E8F0;
  border-radius: 10px;
  box-shadow: 0 8px 24px -6px rgba(15,23,42,0.18);
  overflow: hidden;
  animation: pqNoteDdFade 0.12s ease-out;
  @keyframes pqNoteDdFade { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
`;
export const NewNoteItem = styled.button`
  display: block; width: 100%; text-align: left;
  padding: 10px 14px;
  background: transparent; border: none; cursor: pointer;
  &:hover { background: #F8FAFC; }
  &:focus-visible { background: #F0FDFA; outline: none; }
  & + & { border-top: 1px solid #F1F5F9; }
`;
export const NewNoteItemTitle = styled.div`
  /* 규격은 theme/tokens.listRowTitleCss 하나다 (전엔 0.8125rem 고정 — 폰에서 2px 작았다). */
  ${listRowTitleCss}
  color: #0F172A;
`;
export const NewNoteItemDesc = styled.div`
  font-size: 0.6875rem; color: #94A3B8; margin-top: 2px;
`;
