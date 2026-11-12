// 팝아웃 «확인 필요» 한 줄 띠 (2026-11-06, Irene: *"팝아웃 업무, 오늘의 업무에 확인필요에 들어오는 알림을 한줄만 넣어줄래?
//   요약으로 업무리스트 보는 거 문제 안되게. 그리고 클릭하면 그 항목 전체 보이게 — 팝아웃만 쓰는 고객이 자꾸 놓쳐."*)
//
//   데이터 = 확인 필요 정본 `fetchTodo(bizId)`(사이드바 배지 useInboxCount 와 같은 범위·같은 갱신 신호). 새 백엔드 0.
//   · 숫자는 서버 `total` 그대로 — 목록 길이로 다시 세지 않는다(.claude/rules/badges.md: 확인 필요 = 메뉴 배지 합).
//   · 접힘(기본) = 한 줄: «확인 필요 N건 · 맨 위 항목». 0건이면 띠를 그리지 않는다(목록 자리를 먹지 않는다).
//   · 펼침 = 항목 전체(띠 안에서 스크롤 — 아래 업무 목록을 통째로 밀어내지 않는다).
//   · 항목 클릭 — TodoList 를 그대로 쓰지 않는 이유: 그 handleClick 은 navigate(link) 라 **팝아웃 창 자체가 이동**한다.
//       업무 → 이 창의 업무 상세(onOpenTask) / 그 밖 → 메인 탭에 부탁(requestMainNavigate, 실패하면 새 탭) / 서명 → 새 탭.
//   · 긴급 요청 띠(PopoutUrgentBand)에 이미 있는 업무는 펼친 목록에서만 뺀다 — 숫자는 사이드바와 같게 둔다.
import React, { useCallback, useEffect, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { fetchTodo, type TodoItem } from '../../services/dashboard';
import { joinRoom, leaveRoom, onSocket } from '../../services/socket';
import { requestMainNavigate } from '../Common/PopoutBridge';
import { scopedStorage } from '../../services/accounts';
import { listRowTitleCss } from '../../theme/tokens';

const OPEN_KEY = 'planq:taskPopout:inboxOpen';

interface Props {
  bizId: number;
  onOpenTask: (id: number) => void;
  /** 긴급 요청 띠에 이미 보이는 업무 id — 펼친 목록에서만 뺀다 */
  excludeTaskIds?: number[];
}

function usePopoutInbox(bizId: number) {
  const [data, setData] = useState<{ items: TodoItem[]; total: number } | null>(null);
  const load = useCallback(async () => {
    try {
      const r = await fetchTodo(bizId);
      setData({ items: r.items || [], total: r.total || 0 });
    } catch { /* 실패는 0건이 아니다 — 직전 값을 그대로 둔다 */ }
  }, [bizId]);

  useEffect(() => {
    let pending: ReturnType<typeof setTimeout> | null = null;
    const debounced = () => { if (pending) clearTimeout(pending); pending = setTimeout(() => { void load(); }, 300); };
    void load();
    const onVis = () => { if (document.visibilityState === 'visible') void load(); };
    window.addEventListener('inbox:refresh', debounced);
    window.addEventListener('planq:unread-changed', debounced);
    window.addEventListener('focus', debounced);
    document.addEventListener('visibilitychange', onVis);
    const room = `business:${bizId}`;
    joinRoom(room);
    const offInbox = onSocket('inbox:refresh', debounced);
    const offMsg = onSocket('message:new', debounced);
    const offCare = onSocket('conversation:care', debounced);   // 응대 중 문의 담당 변화(docs/QTALK_CARE_DESIGN.md)
    // 업무 변화(요청·컨펌 차례)는 inbox:refresh 와 함께 오지만, task:* 만 오는 경로도 있어 같이 듣는다
    const offTaskNew = onSocket('task:new', debounced);
    const offTaskUpd = onSocket('task:updated', debounced);
    return () => {
      if (pending) clearTimeout(pending);
      window.removeEventListener('inbox:refresh', debounced);
      window.removeEventListener('planq:unread-changed', debounced);
      window.removeEventListener('focus', debounced);
      document.removeEventListener('visibilitychange', onVis);
      leaveRoom(room);
      offInbox(); offMsg(); offCare(); offTaskNew(); offTaskUpd();
    };
  }, [bizId, load]);

  return data;
}

const PopoutInboxBand: React.FC<Props> = ({ bizId, onOpenTask, excludeTaskIds = [] }) => {
  const { t } = useTranslation('qtask');
  const { t: td } = useTranslation('dashboard');
  const data = usePopoutInbox(bizId);
  const [open, setOpen] = useState<boolean>(() => {
    return scopedStorage.get(OPEN_KEY) === '1';
  });
  const toggle = () => setOpen((v) => {
    const next = !v;
    scopedStorage.set(OPEN_KEY, next ? '1' : '0');   // 사람마다 다른 뜻 — 계정 축(저장 못 해도 동작은 같다)
    return next;
  });

  if (!data || data.total <= 0) return null;

  const excluded = new Set(excludeTaskIds.map(Number));
  const isUrgentDup = (it: TodoItem) => it.drawer?.kind === 'task' && excluded.has(Number(it.drawer.id));
  const listed = data.items.filter((it) => !isUrgentDup(it));
  const dupCount = data.items.length - listed.length;
  const top = listed[0] || data.items[0];
  const verb = (it: TodoItem) => td(`todo.verb.${it.verb}`, { defaultValue: it.verb }) as string;

  const openMain = (path: string) => { if (!requestMainNavigate(path)) window.open(path, '_blank'); };
  const openItem = (it: TodoItem) => {
    if (it.drawer?.kind === 'task' && Number(it.drawer.id)) { onOpenTask(Number(it.drawer.id)); return; }
    if (it.type === 'signature' && it.link?.startsWith('/sign/')) { window.open(it.link, '_blank', 'noopener,noreferrer'); return; }
    // 초대 수락·업무 후보 등록 같은 인라인 처리는 메인 «확인 필요» 에서 한다
    if (it.inline === 'invite' || it.type === 'task_candidate' || !it.link) { openMain('/inbox'); return; }
    openMain(it.link);
  };

  return (
    <Band role="region" aria-label={t('popout.inbox.title', '확인 필요') as string} data-testid="task-popout-inbox">
      <HeadBtn type="button" onClick={toggle} aria-expanded={open} data-testid="task-popout-inbox-toggle"
        aria-label={(open ? t('popout.inbox.collapse', '확인 필요 접기') : t('popout.inbox.expand', '확인 필요 모두 보기')) as string}>
        <Count>{t('popout.inbox.head', { n: data.total, defaultValue: '확인 필요 {{n}}건' })}</Count>
        {!open && top && (
          <Summary data-testid="task-popout-inbox-summary">
            <VerbText>{verb(top)}</VerbText> {top.subject}
          </Summary>
        )}
        <Chevron $open={open} aria-hidden>▾</Chevron>
      </HeadBtn>
      {open && (
        <ListBox data-testid="task-popout-inbox-list">
          {listed.map((it) => (
            <Item key={it.id} type="button" onClick={() => openItem(it)} data-testid="task-popout-inbox-item">
              <ItemMeta><VerbText>{verb(it)}</VerbText>{it.context ? ` · ${it.context}` : ''}</ItemMeta>
              <ItemTitle>{it.subject}</ItemTitle>
            </Item>
          ))}
          {dupCount > 0 && (
            <Note>{t('popout.inbox.inUrgent', { n: dupCount, defaultValue: '긴급 요청 {{n}}건은 위 띠에 있어요' })}</Note>
          )}
          {data.total > data.items.length && (
            <Note>{t('popout.inbox.more', { n: data.total - data.items.length, defaultValue: '외 {{n}}건' })}</Note>
          )}
          <MainLink type="button" onClick={() => openMain('/inbox')} data-testid="task-popout-inbox-open-main">
            {t('popout.inbox.openMain', '확인 필요 화면에서 보기')}
          </MainLink>
        </ListBox>
      )}
    </Band>
  );
};

export default PopoutInboxBand;

const Band = styled.div`
  flex-shrink: 0;
  margin: 8px 12px 0;
  background: #FFFBEB;
  border: 1px solid #FDE68A;
  border-left: 4px solid #F59E0B;
  border-radius: 8px;
  overflow: hidden;
`;
const HeadBtn = styled.button`
  width: 100%; min-height: 36px; padding: 0 10px;
  display: flex; align-items: center; gap: 8px;
  background: transparent; border: none; cursor: pointer; text-align: left; font-family: inherit;
  &:focus-visible { outline: none; box-shadow: inset 0 0 0 2px rgba(245, 158, 11, 0.4); }
`;
const Count = styled.span`
  flex: 0 0 auto; font-size: 0.8125rem; font-weight: 700; color: #B45309; white-space: nowrap;
`;
const Summary = styled.span`
  flex: 1 1 auto; min-width: 0; font-size: 0.8125rem; color: #0F172A;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
`;
const VerbText = styled.span`font-weight: 600; color: #92400E;`;
const Chevron = styled.span<{ $open: boolean }>`
  flex: 0 0 auto; margin-left: auto; font-size: 0.75rem; color: #B45309;
  transform: rotate(${(p) => (p.$open ? '180deg' : '0deg')}); transition: transform 0.15s;
`;
const ListBox = styled.div`
  max-height: 40vh; overflow-y: auto;
  padding: 0 6px 6px; display: flex; flex-direction: column; gap: 4px;
`;
const Item = styled.button`
  min-height: 40px; padding: 4px 8px;
  display: flex; flex-direction: column; align-items: flex-start; justify-content: center;
  background: #FFFFFF; border: 1px solid #FDE68A; border-radius: 6px;
  cursor: pointer; text-align: left; font-family: inherit;
  &:hover { background: #FFFDF5; }
  &:focus-visible { outline: none; box-shadow: 0 0 0 2px rgba(245, 158, 11, 0.4); }
`;
const ItemMeta = styled.span`
  max-width: 100%; font-size: 0.6875rem; color: #64748B;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
`;
const ItemTitle = styled.span`
  max-width: 100%; ${listRowTitleCss} color: #0F172A;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
`;
const Note = styled.div`font-size: 0.75rem; color: #92400E; padding: 2px 4px;`;
const MainLink = styled.button`
  align-self: flex-start; min-height: 32px; padding: 0 4px;
  background: transparent; border: none; cursor: pointer; font-family: inherit;
  font-size: 0.75rem; font-weight: 600; color: #0D9488;
  &:hover { text-decoration: underline; }
`;
