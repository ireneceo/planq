// components/Layout/EditableNavSection.tsx — 사이드바 한 칸(«기능»·«개인»)을 사람이 고른 순서·숨김으로 그린다
//   + 그 자리에서 고치는 «메뉴 편집» (2026-10-16, Irene «권고대로» — 계산은 config/navPrefs 한 곳).
//
// 메뉴 한 줄의 모양(아이콘·배지·testid)은 MainLayout 이 그대로 그려 넘긴다 — 여기서 다시 그리지 않는다.
// 편집 중에는 그 줄을 **미리보기로만** 보여 주고(inert — 눌러도 이동하지 않는다) 옆에 ↑ ↓ 눈 버튼을 붙인다.
//
// ★ 숨긴 메뉴는 «더보기 (n)» 한 줄로 접힌다. 숨긴 메뉴의 숫자 배지는 그 줄에 **합계**로 보인다 —
//   숨겼다고 숫자가 사라지면 «확인 필요» 합과 메뉴 배지가 어긋나 보인다(숫자 배지 계약).
// ★ 지금 보고 있는 화면이 숨긴 메뉴면 «더보기» 를 저절로 편다 — 어디에 와 있는지 사이드바가 말해야 한다.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import styled, { css } from 'styled-components';
import { useTranslation } from 'react-i18next';
import { mediaTablet } from '../../theme/breakpoints';
import { useEscapeStack } from '../../hooks/useEscapeStack';
import { arrangeSection, withSection, type NavPrefs, type NavPrefSection } from '../../config/navPrefs';

export interface EditableNavItem {
  key: string;
  /** MainLayout 이 그린 메뉴 한 줄. 이 사람에게 안 보이는 메뉴면 null/false */
  node: React.ReactNode;
  /** 숫자 배지 값(없으면 0) — 숨겼을 때 «더보기» 합계에 쓴다 */
  count?: number;
  /** 지금 이 메뉴 화면에 있는가 */
  active?: boolean;
  /** 편집 줄의 버튼 이름에 쓰는 메뉴 이름 */
  label: string;
}

export interface MoreRowProps { expanded: boolean; hiddenCount: number; badge: number; onClick: () => void }

interface Props {
  section: NavPrefSection;
  items: EditableNavItem[];
  prefs: NavPrefs | null | undefined;
  /** 편집할 수 있는 사람인가(멤버 이상) — 아니면 저장 값만 따른다 */
  editable: boolean;
  isCollapsed: boolean;
  /** 칸 제목. 편집 버튼(또는 완료 버튼)을 받아 제목 줄 안에 둔다 */
  renderTitle: (action: React.ReactNode) => React.ReactNode;
  renderMore: (p: MoreRowProps) => React.ReactNode;
  onSave: (next: NavPrefs | null) => Promise<void>;
}

const LS_MORE = (s: string) => `planq.nav.more.${s}`;

export default function EditableNavSection({ section, items, prefs, editable, isCollapsed, renderTitle, renderMore, onSave }: Props) {
  const { t } = useTranslation('layout');
  const visible = useMemo(() => items.filter((i) => !!i.node), [items]);
  const byKey = useMemo(() => new Map(visible.map((i) => [i.key, i])), [visible]);
  const defaultKeys = useMemo(() => visible.map((i) => i.key), [visible]);

  const saved = useMemo(() => arrangeSection(defaultKeys, prefs?.sections?.[section]), [defaultKeys, prefs, section]);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<{ all: string[]; hidden: string[] } | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const [expanded, setExpanded] = useState<boolean>(() => {
    try { return localStorage.getItem(LS_MORE(section)) === '1'; } catch { return false; }
  });
  const [dragKey, setDragKey] = useState<string | null>(null);

  // 편집 중 바뀐 값 — 0.4초 모아 한 번 저장. 완료·닫기 때 남은 것을 바로 보낸다.
  const pendingRef = useRef<NavPrefs | null | undefined>(undefined);
  const timerRef = useRef<number | null>(null);
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;

  // onSave 는 부모가 렌더마다 새로 만든다 — ref 로 읽어 flush 를 고정한다(안 그러면 정리 함수가 렌더마다 돌아 0.4초 묶음이 깨진다)
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  const flush = useCallback(async () => {
    if (timerRef.current) { window.clearTimeout(timerRef.current); timerRef.current = null; }
    const next = pendingRef.current;
    if (next === undefined) return;
    pendingRef.current = undefined;
    try { await onSaveRef.current(next); setSaveFailed(false); } catch { setSaveFailed(true); }
  }, []);

  useEffect(() => () => { void flush(); }, [flush]);

  // autosave-exempt: 메뉴 순서·숨김 — 사이드바 자체가 결과로 바로 보인다(✓ 배지를 붙일 입력란이 없다). 실패는 편집 칸에 글로 알린다
  const apply = (all: string[], hidden: string[]) => {
    draftRef.current = { all, hidden };
    setDraft({ all, hidden });
    pendingRef.current = withSection(prefsRef.current, section, defaultKeys, { order: all, hidden });
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => { void flush(); }, 400);
  };

  // 버튼을 빠르게 연달아 눌러도(렌더 전) 앞 변경 위에 쌓이게 — 렌더 시점 draft 가 아니라 ref 를 읽는다
  const draftRef = useRef(draft);
  draftRef.current = draft;

  const startEdit = () => { setDraft({ all: saved.all, hidden: saved.hidden }); setSaveFailed(false); setEditing(true); };
  const finishEdit = useCallback(() => { setEditing(false); setDraft(null); void flush(); }, [flush]);
  useEscapeStack(editing, finishEdit);
  // 아이콘만 보이는 좁은 사이드바로 접으면 편집을 끝낸다(편집 버튼이 그릴 자리가 없다)
  useEffect(() => { if (isCollapsed && editing) finishEdit(); }, [isCollapsed, editing, finishEdit]);

  const move = (key: string, toIndex: number) => {
    const d = draftRef.current;
    if (!d) return;
    const all = d.all.filter((k) => k !== key);
    all.splice(Math.max(0, Math.min(toIndex, all.length)), 0, key);
    apply(all, d.hidden);
  };
  const moveBy = (key: string, delta: number) => {
    const d = draftRef.current;
    if (d) move(key, d.all.indexOf(key) + delta);
  };
  const toggleHidden = (key: string) => {
    const d = draftRef.current;
    if (!d) return;
    const hidden = d.hidden.includes(key) ? d.hidden.filter((k) => k !== key) : [...d.hidden, key];
    apply(d.all, hidden);
  };
  const reset = () => apply(defaultKeys, []);

  if (visible.length === 0) return null;

  const canEdit = editable && !isCollapsed;
  const titleAction = !canEdit ? null : editing ? (
    <TitleTextBtn type="button" onClick={finishEdit} data-testid={`nav-edit-done-${section}`}>{t('nav.editDone', '완료')}</TitleTextBtn>
  ) : (
    <TitleIconBtn type="button" className="pq-nav-edit" onClick={startEdit} data-testid={`nav-edit-${section}`}
      aria-label={t('nav.editMenu', '메뉴 편집') as string} title={t('nav.editMenu', '메뉴 편집') as string}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>
    </TitleIconBtn>
  );

  if (editing && draft) {
    return (
      <>
        {renderTitle(titleAction)}
        <EditHint>{t('nav.editHint', '끌거나 화살표로 순서를 바꾸고, 눈을 눌러 숨겨요. 숨긴 메뉴는 «더보기» 에 모여요.')}</EditHint>
        <EditList data-testid={`nav-edit-list-${section}`}>
          {draft.all.map((key, idx) => {
            const item = byKey.get(key);
            if (!item) return null;
            const isHidden = draft.hidden.includes(key);
            return (
              <EditRow key={key} data-nav-key={key} data-hidden={isHidden ? '1' : '0'} $hidden={isHidden} $dragging={dragKey === key}
                draggable
                onDragStart={(e) => { setDragKey(key); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', key); } catch { /* 일부 브라우저 */ } }}
                onDragEnd={() => setDragKey(null)}
                onDragOver={(e) => { if (dragKey) e.preventDefault(); }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (!dragKey || dragKey === key) return;
                  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  const after = e.clientY > rect.top + rect.height / 2;
                  const without = draft.all.filter((k) => k !== dragKey);
                  const target = without.indexOf(key) + (after ? 1 : 0);
                  move(dragKey, target);
                  setDragKey(null);
                }}>
                <Preview ref={(el) => { if (el) el.setAttribute('inert', ''); }} aria-hidden="true">{item.node}</Preview>
                <Controls>
                  <CtrlBtn type="button" disabled={idx === 0} onClick={() => moveBy(key, -1)}
                    aria-label={t('nav.moveUp', { name: item.label, defaultValue: '{{name}} 위로' }) as string}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15"/></svg>
                  </CtrlBtn>
                  <CtrlBtn type="button" disabled={idx === draft.all.length - 1} onClick={() => moveBy(key, 1)}
                    aria-label={t('nav.moveDown', { name: item.label, defaultValue: '{{name}} 아래로' }) as string}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
                  </CtrlBtn>
                  <CtrlBtn type="button" onClick={() => toggleHidden(key)} aria-pressed={isHidden} data-testid={`nav-edit-eye-${key}`}
                    aria-label={(isHidden ? t('nav.showMenu', { name: item.label, defaultValue: '{{name}} 보이기' }) : t('nav.hideMenu', { name: item.label, defaultValue: '{{name}} 숨기기' })) as string}>
                    {isHidden ? (
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                    ) : (
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                    )}
                  </CtrlBtn>
                </Controls>
              </EditRow>
            );
          })}
        </EditList>
        <EditFooter>
          <FooterLink type="button" onClick={reset} data-testid={`nav-edit-reset-${section}`}>{t('nav.editReset', '기본으로 되돌리기')}</FooterLink>
          {saveFailed && <SaveFailed role="status">{t('nav.editSaveFailed', '저장하지 못했어요. 다시 바꿔 보세요.')}</SaveFailed>}
        </EditFooter>
      </>
    );
  }

  const hiddenItems = saved.hidden.map((k) => byKey.get(k)!).filter(Boolean);
  const hiddenActive = hiddenItems.some((i) => i.active);
  const open = expanded || hiddenActive;
  const hiddenBadge = hiddenItems.reduce((n, i) => n + (i.count || 0), 0);
  const toggleMore = () => {
    const next = !expanded;
    setExpanded(next);
    try { localStorage.setItem(LS_MORE(section), next ? '1' : '0'); } catch { /* 저장 못 해도 이번 화면은 그대로 */ }
  };

  return (
    <>
      {renderTitle(titleAction)}
      {saved.shown.map((k) => <React.Fragment key={k}>{byKey.get(k)!.node}</React.Fragment>)}
      {hiddenItems.length > 0 && (
        <>
          {open && hiddenItems.map((i) => <React.Fragment key={i.key}>{i.node}</React.Fragment>)}
          {renderMore({ expanded: open, hiddenCount: hiddenItems.length, badge: open ? 0 : hiddenBadge, onClick: toggleMore })}
        </>
      )}
    </>
  );
}

const ctrlBase = css`
  display: inline-flex; align-items: center; justify-content: center;
  border: none; background: transparent; color: rgba(204, 251, 241, 0.75); cursor: pointer;
  border-radius: 6px; padding: 0;
  &:hover:not(:disabled) { background: rgba(255, 255, 255, 0.1); color: #FFFFFF; }
  &:focus-visible { outline: 2px solid #5EEAD4; outline-offset: 1px; }
  &:disabled { opacity: 0.3; cursor: default; }
`;

/* 눌리는 칸은 32(규격 토큰)이되 제목 줄을 키우지 않게 위아래로 겹친다 */
const TitleIconBtn = styled.button`
  ${ctrlBase}
  width: 28px; height: 32px; margin: -8px 0;
  ${mediaTablet} { width: 36px; height: 36px; margin: 0; }
`;

const TitleTextBtn = styled.button`
  ${ctrlBase}
  height: 32px; margin: -8px 0; padding: 0 8px; font-size: 0.75rem; font-weight: 700; color: #5EEAD4;
  text-transform: none; letter-spacing: 0;
  ${mediaTablet} { height: 36px; margin: 0; padding: 0 12px; font-size: 0.8125rem; }
`;

const EditHint = styled.div`
  padding: 0 16px 6px; font-size: 0.6875rem; line-height: 1.45; color: rgba(204, 251, 241, 0.6);
  white-space: normal;
`;

const EditList = styled.div`
  display: flex; flex-direction: column;
  margin: 0 8px; border-radius: 8px; background: rgba(255, 255, 255, 0.04);
  outline: 1px dashed rgba(94, 234, 212, 0.35);
`;

const EditRow = styled.div<{ $hidden: boolean; $dragging: boolean }>`
  position: relative; display: flex; align-items: center; cursor: grab;
  ${(p) => p.$dragging && css`opacity: 0.4;`}
  & > div:first-child { flex: 1; min-width: 0; ${(p) => p.$hidden && css`opacity: 0.4;`} }
`;

const Preview = styled.div`
  pointer-events: none;
  & > a { padding-left: 8px !important; padding-right: 4px !important; background: transparent !important; }
  /* 편집 중엔 숫자 배지를 감춘다 — 좁은 줄에서 화살표를 가린다(순서·숨김을 고르는 데 숫자는 필요 없다) */
  [data-nav-badge] { display: none; }
`;

const Controls = styled.div`
  display: flex; align-items: center; gap: 0; flex-shrink: 0; padding-right: 4px;
`;

const CtrlBtn = styled.button`
  ${ctrlBase}
  width: 24px; height: 32px;
  ${mediaTablet} { width: 36px; height: 40px; }
`;

const EditFooter = styled.div`
  display: flex; flex-direction: column; align-items: flex-start; gap: 4px;
  padding: 6px 16px 2px;
`;

const FooterLink = styled.button`
  ${ctrlBase}
  height: 32px; padding: 0 6px; margin-left: -6px; font-size: 0.75rem; font-weight: 500;
  ${mediaTablet} { height: 36px; }
`;

const SaveFailed = styled.span`
  font-size: 0.6875rem; color: #FDA4AF;
`;
