// TagQuickMenu — 리스트 행에서 태그를 바로 붙이고/떼는 메뉴 (Irene 신고 2026-08-23:
//   "상세에서 이름을 쓰면 자동으로 만들기가 되는데 리스트에서는 안되네. 리스트에서도 태그는
//    추가되어야 하지 않을까? 아무튼 추가하고 삭제하고 다 불편해").
//
//   여태 리스트의 태그는 **읽기 전용 칩**(TagChips) 뿐이라, 태그 하나 붙이려면 업무를 열어야 했다.
//   여기서 붙이기·떼기·새로 만들기를 한 자리에서 끝낸다 — 저장은 즉시(PUT), 성공 토스트 없음.
//
//   ★ 메뉴는 createPortal 로 document.body 에 띄운다 — 부모 overflow:hidden·stacking context 에
//     갇히지 않게(같은 함정으로 통합검색이 탭바 안에 깔렸던 전례). TaskRowActionMenu 와 같은 패턴.
//   ★ 사전에 없는 이름은 그 자리에서 만들어 바로 붙인다(TagPicker 와 같은 감각 — 두 곳을 오가지 않는다).
//   ★ 실패는 조용히 넘기지 않는다 — apiFetch 는 throw 하지 않으므로 res.ok 를 본다.
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../../contexts/AuthContext';
import type { TaskTagLite } from './TagChips';

interface Props {
  taskId: number;
  bizId: number | null;
  /** 워크스페이스 태그 사전 */
  dict: TaskTagLite[];
  /** 이 업무에 붙은 태그 */
  value: TaskTagLite[];
  disabled?: boolean;
  /** 저장 성공 — 서버가 돌려준 최종 태그 배열 */
  onSaved: (tags: TaskTagLite[]) => void;
  /** 새 태그가 사전에 추가됨 — 호출측 사전 갱신 */
  onDictAdd: (tag: TaskTagLite) => void;
  /** 사전 관리(이름 변경·삭제) 열기. 주면 메뉴 하단에 진입 항목이 생긴다.
   *  헤더의 '태그 관리' 버튼을 없애는 대신 여기로 모았다 — 태그 일은 한 곳에서 끝난다(Irene 2026-08-24). */
  onManage?: () => void;
}

const MAX_TAGS_PER_TASK = 10;   // 백엔드 task_tags.js 와 같은 값

const TagQuickMenu: React.FC<Props> = ({ taskId, bizId, dict, value, disabled, onSaved, onDictAdd, onManage }) => {
  const { t } = useTranslation('qtask');
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (!open) { setQ(''); setErr(null); } else setTimeout(() => inputRef.current?.focus(), 30); }, [open]);

  // 바깥 클릭 · Esc 닫기
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const tgt = e.target as Node;
      if (wrapRef.current?.contains(tgt) || menuRef.current?.contains(tgt)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  // 좌표 — 트리거의 viewport 기준. 화면 아래/오른쪽으로 넘치면 접어 올린다.
  useLayoutEffect(() => {
    if (!open) { setPos(null); return; }
    const r = wrapRef.current?.getBoundingClientRect();
    if (!r) return;
    const W = 240, H = 300;
    setPos({
      top: r.bottom + 4 + H > window.innerHeight ? Math.max(8, r.top - H - 4) : r.bottom + 4,
      left: Math.max(8, Math.min(r.left, window.innerWidth - W - 8)),
    });
  }, [open]);

  const selectedIds = value.map(v => v.id);

  const save = async (tagIds: number[]) => {
    if (busy) return;
    setBusy(true); setErr(null);
    try {
      const r = await apiFetch(`/api/tasks/${taskId}/tags`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tag_ids: tagIds }),
      });
      const j = await r.json().catch(() => null);
      // apiFetch 는 throw 하지 않는다 — 권한(403)·상한(400)을 그대로 보여준다(조용한 실패 금지)
      if (!r.ok || !j?.success) { setErr(j?.message || (t('tags.saveFailed', '태그를 저장하지 못했습니다') as string)); return; }
      onSaved((j.data?.tags || []) as TaskTagLite[]);
    } finally { setBusy(false); }
  };

  const toggle = (id: number) => {
    const next = selectedIds.includes(id) ? selectedIds.filter(x => x !== id) : [...selectedIds, id];
    if (next.length > MAX_TAGS_PER_TASK) { setErr(t('tags.maxPerTask', { count: MAX_TAGS_PER_TASK, defaultValue: '업무당 태그는 최대 {{count}}개입니다' }) as string); return; }
    void save(next);
  };

  const create = async () => {
    const name = q.trim().slice(0, 30);
    if (!name || busy || !bizId) return;
    setBusy(true); setErr(null);
    try {
      const r = await apiFetch('/api/tasks/tags', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ business_id: bizId, name }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.success) { setErr(j?.message || (t('tags.createFailed', '태그를 만들지 못했습니다') as string)); return; }
      const tag = j.data as TaskTagLite;
      onDictAdd(tag);
      setQ('');
      setBusy(false);
      await save([...selectedIds, tag.id]);   // 만들자마자 이 업무에 붙인다
    } finally { setBusy(false); }
  };

  const needle = q.trim().toLowerCase();
  const shown = needle ? dict.filter(d => d.name.toLowerCase().includes(needle)) : dict;
  const exact = dict.some(d => d.name.toLowerCase() === needle);

  return (
    <Wrap ref={wrapRef}>
      <Trigger
        type="button"
        $open={open}
        disabled={disabled}
        aria-label={t('tags.quickTitle', '태그 붙이기') as string}
        title={t('tags.quickTitle', '태그 붙이기') as string}
        data-testid={`task-tag-quick-${taskId}`}
        onClick={(e) => { e.stopPropagation(); setOpen(o => !o); }}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
      </Trigger>
      {open && pos && createPortal(
        <Menu ref={menuRef} role="dialog" aria-modal="false" aria-label={t('tags.quickTitle', '태그 붙이기') as string}
          style={{ top: pos.top, left: pos.left }} onClick={(e) => e.stopPropagation()}>
          <Field
            ref={inputRef} value={q} disabled={busy}
            onChange={(e) => { setQ(e.target.value); setErr(null); }}
            onKeyDown={(e) => { if (e.key === 'Enter' && q.trim() && !exact) { e.preventDefault(); void create(); } }}
            placeholder={t('tags.quickPh', '태그 검색 · 새로 만들기') as string}
          />
          <ScrollArea>
            {shown.map((tg) => {
              const on = selectedIds.includes(tg.id);
              return (
                <Item key={tg.id} type="button" $on={on} disabled={busy} onClick={() => toggle(tg.id)}>
                  <Dot $color={tg.color || '#64748B'} />
                  <Name>{tg.name}</Name>
                  {on && (
                    <Check viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></Check>
                  )}
                </Item>
              );
            })}
            {q.trim() && !exact && (
              <Item type="button" $on={false} disabled={busy} onClick={() => void create()}>
                <PlusMini viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></PlusMini>
                <Name>{t('tags.createNamed', { name: q.trim(), defaultValue: "'{{name}}' 태그 만들기" }) as string}</Name>
              </Item>
            )}
            {shown.length === 0 && !q.trim() && (
              <Empty>{t('tags.quickEmpty', '아직 태그가 없습니다. 이름을 입력해 만들어 보세요.') as string}</Empty>
            )}
          </ScrollArea>
          {err && <ErrText role="alert">{err}</ErrText>}
          {onManage && (
            <ManageRow type="button" onClick={() => { setOpen(false); onManage(); }}>
              {t('tags.manageTitle', '태그 관리')}
              <ManageHint>{t('tags.manageHint', '이름 변경 · 삭제')}</ManageHint>
            </ManageRow>
          )}
        </Menu>,
        document.body,
      )}
    </Wrap>
  );
};

export default TagQuickMenu;

const Wrap = styled.span`
  position: relative; display: inline-flex; align-items: center; flex-shrink: 0;
`;
const Trigger = styled.button<{ $open: boolean }>`
  width: 20px; height: 20px; padding: 0;
  display: inline-flex; align-items: center; justify-content: center;
  background: ${p => (p.$open ? '#F0FDFA' : 'transparent')};
  border: 1px dashed ${p => (p.$open ? '#5EEAD4' : '#CBD5E1')}; border-radius: 4px;
  color: ${p => (p.$open ? '#0F766E' : '#94A3B8')};
  cursor: pointer; flex-shrink: 0;
  transition: color 0.15s, background 0.15s, border-color 0.15s;
  &:hover:not(:disabled) { background: #F0FDFA; border-color: #5EEAD4; color: #0F766E; }
  &:disabled { opacity: 0.4; cursor: not-allowed; }
  /* 모바일 터치 타겟 — TaskRowActionMenu 와 같은 기준 */
  @media (max-width: 640px) { width: 32px; height: 32px; svg { width: 14px; height: 14px; } }
`;
const Menu = styled.div`
  position: fixed; width: 240px; z-index: 1300;
  background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 10px;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.12);
  padding: 8px;
`;
const Field = styled.input`
  width: 100%; height: 30px; padding: 0 8px;
  font-size: 12px; font-family: inherit; color: #0F172A;
  border: 1px solid #E2E8F0; border-radius: 6px; outline: none;
  &:focus { border-color: #5EEAD4; box-shadow: 0 0 0 2px rgba(94,234,212,0.25); }
`;
const ScrollArea = styled.div`
  margin-top: 6px; max-height: 220px; overflow-y: auto;
  display: flex; flex-direction: column; gap: 2px;
`;
const Item = styled.button<{ $on: boolean }>`
  display: flex; align-items: center; gap: 6px; width: 100%;
  padding: 6px 8px; min-height: 30px;
  background: ${p => (p.$on ? '#F0FDFA' : 'transparent')};
  border: none; border-radius: 6px; cursor: pointer;
  font-size: 12px; font-family: inherit; text-align: left;
  color: ${p => (p.$on ? '#0F766E' : '#334155')};
  &:hover:not(:disabled) { background: ${p => (p.$on ? '#CCFBF1' : '#F8FAFC')}; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;
const Dot = styled.span<{ $color: string }>`
  width: 8px; height: 8px; border-radius: 2px; flex-shrink: 0;
  background: ${p => p.$color};
`;
const PlusMini = styled.svg`width: 12px; height: 12px; flex-shrink: 0; color: #0F766E;`;
const Name = styled.span`
  flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
`;
const Check = styled.svg`width: 12px; height: 12px; flex-shrink: 0;`;
const Empty = styled.div`
  padding: 10px 8px; font-size: 11px; color: #94A3B8; line-height: 1.5;
`;
const ManageRow = styled.button`
  display: flex; align-items: center; gap: 6px; width: 100%;
  margin-top: 6px; padding: 7px 8px; min-height: 32px;
  background: transparent; border: none; border-top: 1px solid #F1F5F9; border-radius: 0 0 6px 6px;
  font-size: 12px; font-family: inherit; color: #475569; cursor: pointer; text-align: left;
  &:hover { background: #F8FAFC; color: #0F172A; }
`;
const ManageHint = styled.span`
  margin-left: auto; font-size: 11px; color: #94A3B8;
`;
const ErrText = styled.div`
  margin-top: 6px; font-size: 11px; color: #DC2626; line-height: 1.4;
`;
