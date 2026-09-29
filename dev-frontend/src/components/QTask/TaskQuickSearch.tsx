// Q task 헤더 «전체 업무에서 찾기» (2026-09-29, 운영 #430)
//
//   Irene: "Q task에서 우측 상단에 헤더에 전체업무에서 검색하기 기능이 있으면 어때? … 내 업무 아닌거 봐야 할 때나
//           이미 끝난 요청받은 업무 찾을 때 탭으로 다 나눠져 있어서 불편하네. 그런데 통합업무검색과 좀 다르잖아."
//   탭(오늘·이번 주·내 전체·요청)과 **무관하게** 볼 수 있는 모든 업무를 제목으로 찾는다 — 끝난 것·취소된 것·남의 것 포함.
//   통합검색(GlobalSearchModal)은 모든 메뉴를 섞어 보여 주고, 이것은 업무만 보고 누르면 이 화면에서 바로 상세가 열린다.
//
//   ★ 새 API 를 만들지 않는다 — 관련 업무 고르기가 쓰는 `/api/tasks/by-business/:biz/search` 가 이미
//     권한 범위(taskListWhere) 안에서 상태 무관하게 찾는다. 껍데기도 알림과 같은 dropdownShell 이다.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../../contexts/AuthContext';
import { useEscapeStack } from '../../hooks/useEscapeStack';
import { Popover, List, Loading, Empty, EmptyTitle, EmptyHint, ItemButton, ItemBody, ItemTitle, ItemMeta } from '../Common/dropdownShell';
import { STATUS_COLOR, displayStatus, getStatusLabel, type StatusCode } from '../../utils/taskLabel';
import { getRoles, primaryPerspective } from '../../utils/taskRoles';
import { formatDay } from '../../utils/dateFormat';
import { isEnterAction } from '../../utils/imeKey';

interface Hit {
  id: number; title: string; status: string; project_id: number | null; due_date: string | null;
  assignee_id: number | null; created_by?: number; request_by_user_id?: number | null;
  source?: string; request_ack_at?: string | null; start_date?: string | null; planned_week_start?: string | null;
  Project?: { id: number; name: string } | null;
}
interface Props {
  bizId: number;
  myId: number;
  todayStr: string;
  members: Array<{ user_id: number; name: string }>;
  onOpen: (taskId: number) => void;
}

const TaskQuickSearch: React.FC<Props> = ({ bizId, myId, todayStr, members, onOpen }) => {
  const { t } = useTranslation('qtask');
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [loading, setLoading] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const seqRef = useRef(0);

  const close = () => { setOpen(false); };
  useEscapeStack(open, close);

  // 바깥을 누르면 닫는다(알림 드롭다운과 같은 규칙)
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e: MouseEvent) => {
      const tg = e.target as Node;
      if (popRef.current?.contains(tg) || btnRef.current?.contains(tg)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    const id = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => { document.removeEventListener('mousedown', onDown); window.clearTimeout(id); };
  }, [open]);

  // 입력 250ms 뒤 검색 — 늦게 온 옛 응답이 새 결과를 덮지 않게 순번으로 거른다
  useEffect(() => {
    const term = q.normalize('NFC').trim();
    if (!open || !term) { setHits(null); setLoading(false); return undefined; }
    const my = ++seqRef.current;
    setLoading(true);
    const id = window.setTimeout(async () => {
      try {
        const r = await apiFetch(`/api/tasks/by-business/${bizId}/search?q=${encodeURIComponent(term)}&limit=30`);
        const j = await r.json().catch(() => ({}));
        if (my !== seqRef.current) return;
        setHits(r.ok && j.success && Array.isArray(j.data) ? j.data : []);
      } catch { if (my === seqRef.current) setHits([]); }
      finally { if (my === seqRef.current) setLoading(false); }
    }, 250);
    return () => window.clearTimeout(id);
  }, [q, open, bizId]);

  const nameOf = useMemo(() => {
    const m = new Map(members.map((x) => [x.user_id, x.name]));
    return (id: number | null | undefined) => (id ? m.get(id) || '' : '');
  }, [members]);

  const relation = (h: Hit): string => {
    if (h.assignee_id === myId) return t('quickSearch.rel.mine', '내 담당') as string;
    if (h.request_by_user_id === myId || h.created_by === myId) return t('quickSearch.rel.requested', '내가 요청') as string;
    return t('quickSearch.rel.others', '다른 사람') as string;
  };

  const pick = (id: number) => { setOpen(false); onOpen(id); };

  return (
    <>
      <SearchBtn
        ref={btnRef}
        type="button"
        data-testid="qtask-quick-search"
        aria-label={t('quickSearch.open', '전체 업무에서 찾기') as string}
        title={t('quickSearch.open', '전체 업무에서 찾기') as string}
        aria-expanded={open}
        $on={open}
        onClick={() => setOpen((v) => !v)}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
      </SearchBtn>
      {open && (
        <Pop ref={popRef} role="dialog" aria-label={t('quickSearch.open', '전체 업무에서 찾기') as string} data-testid="qtask-quick-search-pop">
          <InputRow>
            <Input
              ref={inputRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (isEnterAction(e) && hits && hits[0]) pick(hits[0].id); }}
              placeholder={t('quickSearch.placeholder', '업무 제목으로 찾기') as string}
              data-testid="qtask-quick-search-input"
            />
          </InputRow>
          <Hint>{t('quickSearch.hint', '모든 탭·끝난 업무·다른 사람 업무까지 찾습니다')}</Hint>
          <List>
            {!q.trim() && null}
            {q.trim() && loading && hits === null && <Loading>{t('quickSearch.loading', '찾는 중…')}</Loading>}
            {q.trim() && hits && hits.length === 0 && !loading && (
              <Empty><EmptyTitle>{t('quickSearch.empty', '맞는 업무가 없습니다')}</EmptyTitle><EmptyHint>{t('quickSearch.emptyHint', '제목에 들어간 낱말로 찾아 보세요')}</EmptyHint></Empty>
            )}
            {hits && hits.map((h) => {
              const code = displayStatus(h, todayStr) as StatusCode;
              const sc = STATUS_COLOR[code] || STATUS_COLOR.not_started;
              const label = getStatusLabel(h, primaryPerspective(getRoles(h, myId)), todayStr, (k, f) => t(k, f || k) as string);
              const who = nameOf(h.assignee_id);
              const meta = [relation(h), who, h.Project?.name, h.due_date ? formatDay(h.due_date.slice(0, 10)) : ''].filter(Boolean).join(' · ');
              return (
                <ItemButton key={h.id} type="button" $unread={false} data-testid="qtask-quick-search-row" onClick={() => pick(h.id)}>
                  <ItemBody>
                    <ItemTitle $unread={false}>{h.title}</ItemTitle>
                    <ItemMeta><StatusChip $bg={sc.bg} $fg={sc.fg}>{label}</StatusChip>{meta}</ItemMeta>
                  </ItemBody>
                </ItemButton>
              );
            })}
          </List>
        </Pop>
      )}
    </>
  );
};

export default TaskQuickSearch;

const SearchBtn = styled.button<{ $on: boolean }>`
  width: 36px; height: 36px; flex-shrink: 0;
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: 8px; cursor: pointer;
  background: ${(p) => (p.$on ? '#F0FDFA' : '#FFFFFF')};
  border: 1px solid ${(p) => (p.$on ? '#14B8A6' : '#E2E8F0')};
  color: ${(p) => (p.$on ? '#0F766E' : '#475569')};
  &:hover { background: #F8FAFC; border-color: #CBD5E1; color: #0F172A; }
  &:focus-visible { outline: none; box-shadow: 0 0 0 3px rgba(20,184,166,0.3); }
  @media (max-width: 640px) { width: 40px; height: 40px; }
`;
// 헤더 오른쪽 아래에 붙는다 — 껍데기(Popover)의 left 기준을 오른쪽으로 바꾼다
const Pop = styled(Popover)`
  left: auto; right: 16px; width: 420px;
`;
const InputRow = styled.div` padding: 12px 12px 4px; flex-shrink: 0; `;
const Input = styled.input`
  width: 100%; height: 40px; padding: 0 12px; border: 1px solid #E2E8F0; border-radius: 8px;
  font-size: 0.875rem; color: #0F172A; box-sizing: border-box;
  &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 3px rgba(20,184,166,0.2); }
  @media (max-width: 640px) { font-size: 1rem; }
`;
const Hint = styled.div` padding: 2px 14px 8px; font-size: 0.6875rem; color: #94A3B8; flex-shrink: 0; `;
const StatusChip = styled.span<{ $bg: string; $fg: string }>`
  display: inline-block; margin-right: 6px; padding: 1px 6px; border-radius: 4px;
  font-size: 0.625rem; font-weight: 700; background: ${(p) => p.$bg}; color: ${(p) => p.$fg};
`;
