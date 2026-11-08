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
import { anchorStyle, type AnchorPos } from '../Common/popoverAnchor';
import { listRowTitleCss } from '../../theme/tokens';
import { tabStore } from '../../stores/tabStore';
import { webConferenceCapability } from '../../services/audio';
import { EditIcon, MonitorIcon, BoltIcon, MicIcon, FileIcon } from '../Common/Icons';

// 'voice' = 옛 주소(`?new=voice`·메모 창 링크) — 받는 쪽이 온라인/대면 중 이 기기에서 되는 쪽으로 푼다.
export type NewNoteKind = 'memo' | 'quick' | 'upload' | 'voice' | 'voice_online' | 'voice_offline';
type MenuKind = Exclude<NewNoteKind, 'voice'>;
type MenuGroup = 'write' | 'record' | 'file';

/** 순서·묶음 (Irene 2026-11-08 «권고대로» — 대화형을 온라인/대면 둘로 나누고, 보면 뭘 하는지 바로 알게).
 *  적기 → 녹음하며 받아쓰기(바로 녹음 · 온라인 회의 · 대면 회의 — 가벼운 것부터, Fable 설계 판정 d) → 파일. 녹음 방식은 메뉴에서 정해진다
 *  — 설정 창이 맨 아래에서 «캡처 방식» 을 다시 묻지 않는다. */
// ★ 문구는 **로케일에만** 둔다(`qnote:page.newNoteDropdown.*`, ko/en 양쪽). 여기 기본값을 적으면 두 곳이 된다.
export const NEW_NOTE_KINDS: Array<{ kind: MenuKind; group: MenuGroup; testId: string; titleKey: string; descKey: string }> = [
  { kind: 'memo', group: 'write', testId: 'qnote-new-memo',
    titleKey: 'page.newNoteDropdown.memoLabel', descKey: 'page.newNoteDropdown.memoDesc' },
  { kind: 'quick', group: 'record', testId: 'qnote-quick-record',
    titleKey: 'page.newNoteDropdown.quickLabel', descKey: 'page.newNoteDropdown.quickDesc' },
  { kind: 'voice_online', group: 'record', testId: 'qnote-new-online',
    titleKey: 'page.newNoteDropdown.onlineLabel', descKey: 'page.newNoteDropdown.onlineDesc' },
  { kind: 'voice_offline', group: 'record', testId: 'qnote-new-offline',
    titleKey: 'page.newNoteDropdown.offlineLabel', descKey: 'page.newNoteDropdown.offlineDesc' },
  { kind: 'upload', group: 'file', testId: 'qnote-upload-audio',
    titleKey: 'page.newNoteDropdown.uploadLabel', descKey: 'page.newNoteDropdown.uploadDesc' },
];
const GROUP_KEY: Record<MenuGroup, string> = {
  write: 'page.newNoteDropdown.groupWrite',
  record: 'page.newNoteDropdown.groupRecord',
  file: 'page.newNoteDropdown.groupFile',
};

/** 온라인 회의(마이크 + 탭 소리)를 이 기기에서 할 수 있나 — 판정은 녹음 쪽 한 곳(webConferenceCapability). */
export function onlineMeetingAvailable(): boolean {
  try { return webConferenceCapability.isAvailable(); } catch { return false; }
}

/** 옛 'voice' 를 이 기기에서 되는 쪽으로 푼다. */
export function resolveVoiceKind(kind: NewNoteKind): NewNoteKind {
  if (kind !== 'voice') return kind;
  return onlineMeetingAvailable() ? 'voice_online' : 'voice_offline';
}

function KindIcon({ kind }: { kind: MenuKind }) {
  switch (kind) {
    case 'memo': return <EditIcon size={16} />;
    case 'voice_online': return <MonitorIcon size={16} />;
    case 'voice_offline': return <MicIcon size={16} />;
    case 'quick': return <BoltIcon size={16} />;
    case 'upload': return <FileIcon size={16} />;
  }
}

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
  const onlineOk = onlineMeetingAvailable();
  return createPortal(
    <NewNoteDropdown ref={panelRef} style={anchorStyle(pos)}
      onMouseLeave={onMouseLeave} data-testid="qnote-new-menu" role="menu">
      {NEW_NOTE_KINDS.map((it, i) => {
        const disabled = it.kind === 'voice_online' && !onlineOk;
        const head = i === 0 || NEW_NOTE_KINDS[i - 1].group !== it.group;
        return (
          <div key={it.kind}>
            {head && <NewNoteGroupLabel role="presentation">{t(GROUP_KEY[it.group]) as string}</NewNoteGroupLabel>}
            <NewNoteItem type="button" role="menuitem" data-testid={it.testId}
              disabled={disabled} aria-disabled={disabled || undefined}
              onClick={() => { if (!disabled) onPick(it.kind); }}>
              <NewNoteItemIcon $kind={it.kind} aria-hidden="true"><KindIcon kind={it.kind} /></NewNoteItemIcon>
              <NewNoteItemText>
                <NewNoteItemTitle>{t(it.titleKey) as string}</NewNoteItemTitle>
                <NewNoteItemDesc>
                  {disabled ? (t('page.newNoteDropdown.onlineUnavailable') as string) : (t(it.descKey) as string)}
                </NewNoteItemDesc>
              </NewNoteItemText>
            </NewNoteItem>
          </div>
        );
      })}
    </NewNoteDropdown>,
    document.body,
  );
}

// ── 껍데기 (값은 Q note 사이드바의 것을 그대로 옮겼다 — 바꾸지 않는다) ──
export const NewSessionWrap = styled.div`position: relative;`;
/**
 * 새 노트 버튼.
 *
 * ★ 2026-09-20 (Irene: *"프로젝트 > 노트에서 우측 +버튼이 글자가 다 안나오고 +만 있는 사이즈야."*)
 *   — 이 버튼은 **32×32 아이콘 전용**(`padding:0`, 고정폭)인데 프로젝트 탭에서만 안에 글자를
 *   넣고 있었다. 칸이 32px 이라 «새 노트» 가 잘려 `+` 만 보였다.
 *   글자를 같이 보여 주는 자리는 `$wide` 로 **껍데기가** 넓어진다 — 호출부에서 style 을 덧대면
 *   두 곳이 갈라진다(memory feedback_copied_component_drifts_extract_shell).
 *   높이는 32px 그대로(한 줄 안 컨트롤 토큰).
 */
export const NewSessionBtn = styled.button<{ $wide?: boolean }>`
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
  ${p => (p.$wide
    ? 'width:auto;min-width:32px;padding:0 12px;gap:6px;white-space:nowrap;font-size:0.8125rem;font-weight:700;'
    : 'width:32px;padding:0;')}
  &:hover { background: #0D9488; }
  &:focus-visible { outline: 2px solid #0D9488; outline-offset: 2px; }
`;
export const NewNoteDropdown = styled.div`
  /* 좌표는 usePopoverAnchor 가 인라인 style 로 준다(트리거 오른쪽 끝 기준). */
  position: fixed;
  z-index: 2000;
  min-width: 280px;
  width: 300px;
  max-width: calc(100vw - 16px);
  padding-bottom: 4px;
  background: #FFFFFF;
  border: 1px solid #E2E8F0;
  border-radius: 10px;
  box-shadow: 0 8px 24px -6px rgba(15,23,42,0.18);
  overflow: hidden;
  animation: pqNoteDdFade 0.12s ease-out;
  @keyframes pqNoteDdFade { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
`;
export const NewNoteItem = styled.button`
  display: flex; align-items: flex-start; gap: 10px; width: 100%; text-align: left;
  padding: 9px 14px;
  background: transparent; border: none; cursor: pointer;
  &:hover:not(:disabled) { background: #F8FAFC; }
  &:focus-visible { background: #F0FDFA; outline: none; }
  &:disabled { cursor: not-allowed; opacity: 0.55; }
`;
/** 묶음 이름(적기·녹음하며 받아쓰기·파일) — 누르는 것이 아니라 읽는 줄. */
const NewNoteGroupLabel = styled.div`
  padding: 8px 14px 2px;
  font-size: 0.6875rem; font-weight: 600; color: #94A3B8; letter-spacing: 0.2px;
  div + div > & { border-top: 1px solid #F1F5F9; margin-top: 4px; padding-top: 10px; }
`;
const ICON_TONE: Record<MenuKind, { bg: string; fg: string }> = {
  memo: { bg: '#F0FDFA', fg: '#0F766E' },
  voice_online: { bg: '#EFF6FF', fg: '#1D4ED8' },
  voice_offline: { bg: '#F5F3FF', fg: '#6D28D9' },
  quick: { bg: '#FFF7ED', fg: '#C2410C' },   // 빨강은 «녹음 중»·위험 색이라 피한다(Fable 비차단 2)
  upload: { bg: '#F8FAFC', fg: '#475569' },
};
const NewNoteItemIcon = styled.span<{ $kind: MenuKind }>`
  flex-shrink: 0; width: 32px; height: 32px; border-radius: 8px;
  display: inline-flex; align-items: center; justify-content: center;
  background: ${p => ICON_TONE[p.$kind].bg}; color: ${p => ICON_TONE[p.$kind].fg};
  margin-top: -1px;
`;
const NewNoteItemText = styled.span`display: block; min-width: 0; flex: 1;`;
export const NewNoteItemTitle = styled.div`
  /* 규격은 theme/tokens.listRowTitleCss 하나다 (전엔 0.8125rem 고정 — 폰에서 2px 작았다). */
  ${listRowTitleCss}
  color: #0F172A;
`;
export const NewNoteItemDesc = styled.div`
  font-size: 0.6875rem; color: #64748B; margin-top: 2px; line-height: 1.4;
`;
