// 업무 row 액션 메뉴 — Q Task / 프로젝트>업무 공통.
// 사이클 N+22: 6 점 grip(드래그 연상) → 3 점 ⋮ (Q Talk 와 동일 표준). 동작은 동일 — 드롭다운(아래 추가 / 복제 / 삭제).
// Menu 는 createPortal 로 document.body 에 띄워 부모 overflow:hidden 영향 X.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';

type DeleteResult = { ok: boolean; message?: string } | void;

interface Props {
  onAddBelow: () => void;
  onCopy: () => void;
  // 운영 #48 — 삭제 결과를 반환하면 실패(예: 권한 없음 403) 사유를 메뉴에 인라인 표시한다.
  onDelete: () => Promise<DeleteResult> | DeleteResult;
  busy?: boolean;
}

export default function TaskRowActionMenu({ onAddBelow, onCopy, onDelete, busy }: Props) {
  const { t } = useTranslation('qtask');
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // 메뉴 닫힐 때 삭제 확인/에러 상태 초기화
  useEffect(() => {
    if (!open) { setConfirming(false); setDeleting(false); setErrMsg(null); }
  }, [open]);

  const runDelete = async () => {
    setDeleting(true); setErrMsg(null);
    try {
      const r = await onDelete();
      if (r && r.ok === false) {
        setErrMsg(r.message || (t('rowAction.errGeneric', '삭제할 수 없습니다.') as string));
        setConfirming(false);
        return;
      }
      setOpen(false);
    } catch {
      setErrMsg(t('rowAction.errGeneric', '삭제할 수 없습니다.') as string);
      setConfirming(false);
    } finally {
      setDeleting(false);
    }
  };

  // 외부 클릭 시 닫기
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const tgt = e.target as Node;
      if (wrapRef.current?.contains(tgt) || menuRef.current?.contains(tgt)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Esc 닫기
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  // 좌표 계산 — handle 의 viewport 좌표 기준
  useLayoutEffect(() => {
    if (!open) { setMenuPos(null); return; }
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    setMenuPos({ top: rect.bottom + 4, left: rect.left });
  }, [open]);

  return (
    <Wrap ref={wrapRef} className="task-row-action">
      <Handle
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(o => !o); }}
        title={t('rowAction.title', '업무 액션 메뉴') as string}
        aria-label={t('rowAction.title', '업무 액션 메뉴') as string}
        $open={open}
        disabled={busy}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/></svg>
      </Handle>
      {open && menuPos && createPortal(
        <Menu ref={menuRef} role="menu" style={{ top: menuPos.top, left: menuPos.left }}>
          <MenuItem type="button" role="menuitem" onClick={(e) => { e.stopPropagation(); setOpen(false); onAddBelow(); }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            {t('rowAction.addBelow', '아래에 업무 추가')}
          </MenuItem>
          <MenuItem type="button" role="menuitem" onClick={(e) => { e.stopPropagation(); setOpen(false); onCopy(); }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            {t('rowAction.copy', '복제')}
          </MenuItem>
          <MenuDivider />
          {errMsg ? (
            <ErrBox role="alert">{errMsg}</ErrBox>
          ) : confirming ? (
            <ConfirmRow onClick={(e) => e.stopPropagation()}>
              <ConfirmText>{t('rowAction.confirmDelete', '이 업무를 삭제할까요?')}</ConfirmText>
              <ConfirmBtns>
                <CBtn type="button" $danger disabled={deleting} onClick={(e) => { e.stopPropagation(); void runDelete(); }}>
                  {deleting ? t('rowAction.deleting', '삭제 중…') : t('rowAction.confirmYes', '삭제')}
                </CBtn>
                <CBtn type="button" disabled={deleting} onClick={(e) => { e.stopPropagation(); setConfirming(false); }}>
                  {t('rowAction.confirmNo', '취소')}
                </CBtn>
              </ConfirmBtns>
            </ConfirmRow>
          ) : (
            <MenuItem type="button" role="menuitem" $danger onClick={(e) => { e.stopPropagation(); setConfirming(true); }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
              {t('rowAction.delete', '삭제')}
            </MenuItem>
          )}
        </Menu>,
        document.body,
      )}
    </Wrap>
  );
}

const Wrap = styled.div`
  position: relative;
  display: inline-flex; align-items: center;
  flex-shrink: 0;
`;
const Handle = styled.button<{ $open: boolean }>`
  width: 22px; height: 22px;
  display: inline-flex; align-items: center; justify-content: center;
  background: ${p => p.$open ? '#F0FDFA' : 'transparent'};
  border: none; border-radius: 6px;
  color: ${p => p.$open ? '#0F766E' : '#94A3B8'};
  cursor: pointer;
  transition: color 0.15s, background 0.15s;
  flex-shrink: 0;

  &:hover:not(:disabled) {
    background: #F0FDFA;
    color: #0F766E;
  }
  &:disabled { opacity: 0.4; cursor: not-allowed; }

  /* 모바일 — 터치 타겟 36px+ */
  @media (max-width: 640px) {
    width: 36px; height: 36px;
    color: ${p => p.$open ? '#0F766E' : '#64748B'};
    svg { width: 16px; height: 16px; }
  }
`;
const Menu = styled.div`
  position: fixed;
  min-width: 180px;
  background: #FFFFFF;
  border: 1px solid #E2E8F0;
  border-radius: 10px;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.12);
  padding: 6px;
  z-index: 9000;
  display: flex; flex-direction: column;
`;
const MenuItem = styled.button<{ $danger?: boolean }>`
  display: inline-flex; align-items: center; gap: 10px;
  padding: 8px 12px;
  background: transparent; border: none; border-radius: 6px;
  font-size: 13px; font-weight: 500;
  color: ${p => p.$danger ? '#DC2626' : '#0F172A'};
  cursor: pointer;
  text-align: left;
  white-space: nowrap;
  &:hover { background: ${p => p.$danger ? '#FEF2F2' : '#F8FAFC'}; }
  svg { color: ${p => p.$danger ? '#DC2626' : '#64748B'}; flex-shrink: 0; }
`;
const MenuDivider = styled.div`
  height: 1px; background: #F1F5F9; margin: 4px 0;
`;
const ConfirmRow = styled.div`
  padding: 8px 12px; display: flex; flex-direction: column; gap: 8px;
`;
const ConfirmText = styled.div`
  font-size: 13px; font-weight: 600; color: #0F172A;
`;
const ConfirmBtns = styled.div`
  display: flex; gap: 6px;
`;
const CBtn = styled.button<{ $danger?: boolean }>`
  flex: 1; min-height: 32px; padding: 0 10px;
  border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer;
  border: 1px solid ${p => p.$danger ? '#DC2626' : '#E2E8F0'};
  background: ${p => p.$danger ? '#DC2626' : '#FFFFFF'};
  color: ${p => p.$danger ? '#FFFFFF' : '#475569'};
  &:hover:not(:disabled) { background: ${p => p.$danger ? '#B91C1C' : '#F8FAFC'}; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;
const ErrBox = styled.div`
  padding: 8px 12px; font-size: 12px; line-height: 1.45; font-weight: 500;
  color: #B91C1C; background: #FEF2F2; border-radius: 6px; white-space: normal;
  max-width: 240px;
`;
