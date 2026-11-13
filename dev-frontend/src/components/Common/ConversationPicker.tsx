// 대화방 고르기 — 검색 + 묶음(최근·고정·고객·팀) + 행. «공유 받기»(pages/ShareReceive)와 «메시지 전달»(pages/QTalk/ForwardFlow)이 같이 쓴다.
//   ShareReceivePage 안에 있던 것을 꺼냈다(docs/QTALK_FORWARD_DESIGN.md §4 — 새로 만들지 않는다).
//   testid 는 접두어(testIdPrefix, 기본 'share')로 — 공유 화면의 옛 testid(share-search·share-conv-row·share-group-*)를 그대로 둔다.
//   목록을 거르는 일(보관·현재 방·안내방 빼기)은 부르는 쪽이 한다 — 여기는 받은 것을 그린다.
import { useMemo, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { SearchIcon } from './Icons';
import type { ApiConversation } from '../../services/qtalk';
import { textMatches } from '../../utils/searchMatch';

const GROUP_LIMIT = 5;

export const conversationLabel = (c: ApiConversation) =>
  c.display_name || c.title || c.Client?.display_name || c.Client?.company_name || `#${c.id}`;

interface Props {
  convs: ApiConversation[] | null;
  onPick: (c: ApiConversation) => void;
  /** «최근 보낸 곳» 묶음에 먼저 둘 방 id(순서대로) */
  recentIds?: number[];
  selectedId?: number | null;
  disabled?: boolean;
  searchPlaceholder?: string;
  emptyText?: string;
  testIdPrefix?: string;
}

export default function ConversationPicker({ convs, onPick, recentIds = [], selectedId = null, disabled, searchPlaceholder, emptyText, testIdPrefix = 'share' }: Props) {
  const { t } = useTranslation('common');
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // 고정 먼저, 그다음 최근 대화순(목록 응답에 이미 있는 값)
  const sorted = useMemo(() => {
    const ts = (v?: string | null) => (v ? new Date(v).getTime() : 0);
    return [...(convs || [])].sort((a, b) => {
      const pa = ts(a.my_pinned_at), pb = ts(b.my_pinned_at);
      if (!!pa !== !!pb) return pa ? -1 : 1;
      if (pa && pb && pa !== pb) return pb - pa;
      return ts(b.last_message_at) - ts(a.last_message_at);
    });
  }, [convs]);
  const matches = (c: ApiConversation) => [conversationLabel(c), c.Client?.display_name, c.Client?.company_name, c.title].some((x) => textMatches(x, query));
  const groups = useMemo(() => {
    const byId = new Map(sorted.map((c) => [c.id, c]));
    const recent = recentIds.map((id) => byId.get(id)).filter(Boolean) as ApiConversation[];
    const rest = sorted.filter((c) => !recentIds.includes(c.id));
    return [
      { key: 'recent', label: t('shareReceive.group.recent', '최근 보낸 곳'), rows: recent },
      { key: 'pinned', label: t('shareReceive.group.pinned', '고정한 대화방'), rows: rest.filter((c) => c.my_pinned_at) },
      { key: 'customer', label: t('shareReceive.group.customer', '고객 대화방'), rows: rest.filter((c) => !c.my_pinned_at && c.channel_type === 'customer') },
      { key: 'team', label: t('shareReceive.group.team', '팀 대화방'), rows: rest.filter((c) => !c.my_pinned_at && c.channel_type !== 'customer') },
    ].filter((g) => g.rows.length > 0);
  }, [sorted, recentIds, t]);

  const renderRow = (c: ApiConversation) => (
    <PickRow key={c.id} type="button" data-testid={`${testIdPrefix}-conv-row`} data-conv-id={c.id} disabled={disabled}
      $on={selectedId === c.id} aria-pressed={selectedId === c.id} onClick={() => onPick(c)}>
      <span>{conversationLabel(c)}</span>
      <PickMeta>{c.channel_type === 'customer' ? t('shareReceive.convCustomer', '고객') : c.channel_type === 'platform' ? 'PlanQ' : t('shareReceive.convTeam', '팀')}</PickMeta>
    </PickRow>
  );

  return (
    <>
      <SearchWrap>
        <SearchIcon size={16} />
        <SearchInput value={query} onChange={(e) => setQuery(e.target.value)} data-testid={`${testIdPrefix}-search`}
          placeholder={searchPlaceholder || (t('shareReceive.searchConv', '대화방·고객 이름으로 찾기') as string)} />
      </SearchWrap>
      {convs === null && <Hint>{t('common.loading', '불러오는 중...')}</Hint>}
      {convs && convs.length === 0 && <Hint>{emptyText || t('shareReceive.convEmpty', '보낼 수 있는 대화방이 없습니다')}</Hint>}
      {convs && query.trim() && (() => {
        const hits = sorted.filter(matches);
        return hits.length ? hits.slice(0, 30).map(renderRow) : <Hint>{t('shareReceive.noMatch', '맞는 곳이 없습니다')}</Hint>;
      })()}
      {convs && !query.trim() && groups.map((g) => {
        const open = expanded[g.key];
        const rows = open ? g.rows : g.rows.slice(0, GROUP_LIMIT);
        return (
          <Group key={g.key} data-testid={`${testIdPrefix}-group-${g.key}`}>
            <GroupLabel>{g.label}</GroupLabel>
            {rows.map(renderRow)}
            {!open && g.rows.length > GROUP_LIMIT && (
              <MoreBtn type="button" onClick={() => setExpanded((p) => ({ ...p, [g.key]: true }))}>
                {t('shareReceive.more', { n: g.rows.length - GROUP_LIMIT, defaultValue: '더 보기 ({{n}})' })}
              </MoreBtn>
            )}
          </Group>
        );
      })}
    </>
  );
}

const SearchWrap = styled.label`
  display: flex; align-items: center; gap: 8px; height: 40px; padding: 0 12px; flex-shrink: 0;
  background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 8px; color: #94A3B8;
  &:focus-within { border-color: #14B8A6; box-shadow: 0 0 0 3px rgba(20,184,166,0.2); }
`;
const SearchInput = styled.input`
  flex: 1; min-width: 0; border: none; outline: none; background: transparent; font-size: 1rem; color: #0F172A;
`;
const Hint = styled.div`font-size: 0.75rem; color: #64748B; padding: 4px 0; line-height: 1.5;`;
const Group = styled.div`display: flex; flex-direction: column; gap: 6px; margin-top: 4px;`;
const GroupLabel = styled.div`font-size: 0.75rem; font-weight: 700; color: #64748B;`;
const MoreBtn = styled.button`
  align-self: flex-start; background: none; border: none; padding: 0; min-height: 32px;
  color: #0F766E; font-size: 0.8125rem; font-weight: 600; cursor: pointer;
`;
const PickRow = styled.button<{ $on?: boolean }>`
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  min-height: 44px; padding: 10px 14px;
  background: ${p => p.$on ? '#F0FDFA' : '#FFFFFF'};
  border: 1px solid ${p => p.$on ? '#14B8A6' : '#E2E8F0'}; border-radius: 10px;
  font-size: 0.875rem; color: #0F172A; text-align: left; cursor: pointer;
  span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
  @media (hover: hover) { &:hover:not(:disabled) { border-color: #14B8A6; } }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;
const PickMeta = styled.span`font-size: 0.6875rem; color: #64748B; flex-shrink: 0; max-width: 40%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;`;
