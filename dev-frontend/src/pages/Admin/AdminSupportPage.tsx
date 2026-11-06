// /admin/support — PlanQ 안내방 받은편지함 (2026-11-04, docs/PLANQ_GUIDE_ROOM_DESIGN.md §2)
// 워크스페이스마다 하나인 «PlanQ 안내» 방 목록 → 방을 열면 우측 패널에 대화 + PlanQ 팀 답 쓰기.
// ★ 이 화면은 /api/admin/support/* 만 부른다(워크스페이스 대화 라우트 금지 — 설계 §2). URL 싱크 ?business=:id.
// 실시간: 서버가 안내방에 글이 오갈 때 관리자 user 방으로 'support:updated'(번호만) → 목록·열린 방을 서버 값으로 다시 읽는다.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import PageShell from '../../components/Layout/PageShell';
import DetailDrawer from '../../components/Common/DetailDrawer';
import EmptyState from '../../components/Common/EmptyState';
import { useTimeFormat } from '../../hooks/useTimeFormat';
import { useVisibilityRefresh } from '../../hooks/useVisibilityRefresh';
import ChromeLink from '../../components/Tab/ChromeLink';
import { onSocket } from '../../services/socket';
import { listRowTitleCss } from '../../theme/tokens';
import { fetchSupportRooms, type SupportRoomRow } from '../../services/admin';
import { useSupportRoom, SupportThread, SupportComposer } from './AdminSupportThread';

export default function AdminSupportPage() {
  const { t } = useTranslation('admin');
  const { formatDateTime } = useTimeFormat();
  const [params, setParams] = useSearchParams();
  const activeId = params.get('business') ? Number(params.get('business')) : null;

  const [rows, setRows] = useState<SupportRoomRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const { room, roomError, reload: loadRoom } = useSupportRoom(activeId);

  const loadList = useCallback(async () => {
    try { setRows((await fetchSupportRooms()).rows); setError(false); }
    catch { setError(true); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void loadList(); }, [loadList]);

  // 실시간 — 번호 신호만 오므로 서버 값으로 덮는다(250ms 묶기). 열린 방이면 그 방도.
  const activeRef = useRef(activeId);
  activeRef.current = activeId;
  useEffect(() => {
    let timer: number | null = null;
    const off = onSocket<{ business_id: number }>('support:updated', (p) => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        void loadList();
        if (activeRef.current && p && p.business_id === activeRef.current) void loadRoom();
      }, 250);
    });
    return () => { off(); if (timer) window.clearTimeout(timer); };
  }, [loadList, loadRoom]);
  useVisibilityRefresh(useCallback(() => { void loadList(); if (activeRef.current) void loadRoom(); }, [loadList, loadRoom]));

  const select = (id: number) => {
    if (activeId === id) params.delete('business'); else params.set('business', String(id));
    setParams(params, { replace: true });
  };
  const close = () => { params.delete('business'); setParams(params, { replace: true }); };

  const activeRow = useMemo(() => rows.find((r) => r.business_id === activeId) || null, [rows, activeId]);

  return (
    <PageShell title={t('support.title', '안내방')} count={rows.length}>
      <Desc>{t('support.desc', '워크스페이스마다 하나인 «PlanQ 안내» 방입니다. Cue 가 먼저 답하고, PlanQ 팀이 이어서 답할 수 있습니다.')}</Desc>
      {loading && <Dim>{t('support.loading', '불러오는 중…')}</Dim>}
      {error && <ErrorText>{t('support.loadFailed', '목록을 불러오지 못했어요')}</ErrorText>}
      {!loading && !error && rows.length === 0 && (
        <EmptyState title={t('support.empty', '아직 열린 안내방이 없어요')} description={t('support.emptyDesc', '워크스페이스 사람이 Q talk 에서 «PlanQ 안내» 를 열면 여기에 보입니다.')} />
      )}
      <List data-testid="admin-support-list">
        {rows.map((r) => (
          <Row key={r.business_id} type="button" $active={r.business_id === activeId} onClick={() => select(r.business_id)} data-testid={`admin-support-row-${r.business_id}`}>
            <RowMain>
              <RowTitle>{r.business_name || `#${r.business_id}`}</RowTitle>
              <RowPreview>{r.last_preview || t('support.noMessages', '아직 대화가 없어요')}</RowPreview>
            </RowMain>
            <RowSide>
              {r.human_requested && <HumanBadge>{t('support.humanRequested', 'PlanQ 팀 답 필요')}</HumanBadge>}
              {r.unread > 0 && <Unread aria-label={t('support.unread', { count: r.unread, defaultValue: '안 읽음 {{count}}' }) as string}>{r.unread > 99 ? '99+' : r.unread}</Unread>}
              {r.last_message_at && <Dim>{formatDateTime(r.last_message_at)}</Dim>}
            </RowSide>
          </Row>
        ))}
      </List>

      <DetailDrawer open={activeId != null} onClose={close} ariaLabel={t('support.title', '안내방') as string}>
        <DetailDrawer.Header onClose={close}>
          <DrawerTitle>{room?.business_name || activeRow?.business_name || (activeId ? `#${activeId}` : '')}</DrawerTitle>
          {room?.human_requested && <HumanBadge>{t('support.humanRequested', 'PlanQ 팀 답 필요')}</HumanBadge>}
        </DetailDrawer.Header>
        <DetailDrawer.Body>
          {activeId && (
            <JourneyLink to={`/admin/businesses?workspace=${activeId}`} data-testid="admin-support-journey">
              {t('support.openJourney', '이 워크스페이스 여정 보기')}
            </JourneyLink>
          )}
          <SupportThread room={room} roomError={roomError} />
        </DetailDrawer.Body>
        <DetailDrawer.Footer>
          <SupportComposer businessId={activeId} room={room} onClose={close}
            onSent={async () => { await Promise.all([loadRoom(), loadList()]); }} />
        </DetailDrawer.Footer>
      </DetailDrawer>
    </PageShell>
  );
}

const Desc = styled.p`margin: 0 0 12px; font-size: 0.8125rem; color: #64748B;`;
const Dim = styled.span`color: #94A3B8; font-size: 0.75rem;`;
const ErrorText = styled.div`font-size: 0.8125rem; color: #DC2626; padding: 8px 0;`;
const List = styled.div`display: flex; flex-direction: column; gap: 8px;`;
const Row = styled.button<{ $active: boolean }>`
  display: flex; gap: 12px; align-items: center; width: 100%; text-align: left; cursor: pointer;
  padding: 12px 14px; border-radius: 10px; background: #fff;
  border: 1px solid ${(p) => (p.$active ? '#14B8A6' : '#E2E8F0')};
  &:hover { border-color: #94A3B8; }
`;
const RowMain = styled.div`flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px;`;
const RowTitle = styled.div`${listRowTitleCss}`;
const RowPreview = styled.div`font-size: 0.75rem; color: #64748B; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;`;
const RowSide = styled.div`display: flex; flex-direction: column; align-items: flex-end; gap: 4px; flex-shrink: 0;`;
const HumanBadge = styled.span`font-size: 0.6875rem; font-weight: 700; padding: 2px 8px; border-radius: 6px; background: #FEF3C7; color: #92400E;`;
const Unread = styled.span`min-width: 20px; padding: 2px 6px; line-height: 1.45; border-radius: 10px; background: #F43F5E; color: #fff; font-size: 0.6875rem; font-weight: 700; display: inline-flex; align-items: center; justify-content: center;`;
const DrawerTitle = styled.div`font-size: 1rem; font-weight: 700; color: #0F172A;`;
const JourneyLink = styled(ChromeLink)`display: inline-block; margin: 12px 20px 0; font-size: 0.75rem; color: #0F766E; text-decoration: underline;`;
