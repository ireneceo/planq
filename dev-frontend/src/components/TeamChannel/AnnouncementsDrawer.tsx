// 공지 목록 — «전체» 방에 올린 공지 전부(게시 중 = 핀 · 게시 끝 = 핀 해제, 목록엔 남는다). 2026-11-16 Fable 설계 B.
//   읽음 «N명 중 M명» 은 모두에게, 누가 읽었는지 명단은 작성자·대표·관리자만(서버가 같은 선으로 막는다).
//   껍데기는 우측 곁패널 공용 DetailDrawer. 실시간: 공지·수정·삭제·핀 신호 + 탭 복귀 + 소켓 재연결 때 다시 읽는다.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import DetailDrawer from '../Common/DetailDrawer';
import ActionButton from '../Common/ActionButton';
import { onSocket } from '../../services/socket';
import { useVisibilityRefresh } from '../../hooks/useVisibilityRefresh';
import {
  listAnnouncements, getAnnouncementReaders, type Announcement, type AnnouncementReaders,
} from '../../services/teamChannel';
import AnnounceModal from './AnnounceModal';
import { formatDayTime } from '../../utils/dateFormat';
import { useTimeFormat } from '../../hooks/useTimeFormat';

interface Props {
  open: boolean;
  onClose: () => void;
  businessId: number;
  conversationId: number;
  myUserId: number;
  /** 대표·관리자 — 공지 올리기·모든 공지 고치기·읽은 사람 명단 */
  canAnnounce: boolean;
  /** 공지를 누르면 대화에서 그 메시지로 */
  onJump?: (messageId: number) => void;
}

const AnnouncementsDrawer: React.FC<Props> = ({ open, onClose, businessId, conversationId, myUserId, canAnnounce, onJump }) => {
  const { t, i18n } = useTranslation('qtalk');
  const [items, setItems] = useState<Announcement[] | null>(null);
  const [error, setError] = useState(false);
  const [readers, setReaders] = useState<Record<number, AnnouncementReaders | 'loading' | 'error'>>({});
  const [openReaders, setOpenReaders] = useState<number | null>(null);
  const [compose, setCompose] = useState<null | { editing: Announcement | null }>(null);
  const timer = useRef<number | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await listAnnouncements(businessId, 100);
      setItems(r.items); setError(false);
    } catch { setError(true); }
  }, [businessId]);
  const reload = useCallback(() => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => { void load(); setReaders({}); }, 250);
  }, [load]);

  useEffect(() => { if (open) { setItems(null); void load(); } }, [open, load]);
  useEffect(() => {
    if (!open) return undefined;
    const match = (d: { conversation_id?: number } | undefined) => !d?.conversation_id || Number(d.conversation_id) === Number(conversationId);
    const offs = ['team:announcement', 'message:updated', 'message:deleted', 'message:pinned', 'message:unpinned', 'conversation:read']
      .map((ev) => onSocket<{ conversation_id?: number }>(ev, (d) => { if (match(d)) reload(); }));
    window.addEventListener('socket:reconnected', reload);
    return () => { offs.forEach((off) => off()); window.removeEventListener('socket:reconnected', reload); if (timer.current) window.clearTimeout(timer.current); };
  }, [open, conversationId, reload]);
  useVisibilityRefresh(() => { if (open) reload(); });

  const toggleReaders = async (a: Announcement) => {
    if (openReaders === a.id) { setOpenReaders(null); return; }
    setOpenReaders(a.id);
    if (readers[a.id] && readers[a.id] !== 'error') return;
    setReaders((p) => ({ ...p, [a.id]: 'loading' }));
    try {
      const r = await getAnnouncementReaders(businessId, a.id);
      setReaders((p) => ({ ...p, [a.id]: r }));
    } catch { setReaders((p) => ({ ...p, [a.id]: 'error' })); }
  };

  const { tz } = useTimeFormat();   // 워크스페이스 시간대 — 대화 화면과 같은 시각
  const fmt = (iso: string) => formatDayTime(iso, { tz, locale: i18n.language === 'en' ? 'en-US' : 'ko-KR' });

  return (
    <>
      <DetailDrawer open={open} onClose={onClose} ariaLabel={t('team.list.title', '공지') as string}>
        <DetailDrawer.Header onClose={onClose}>
          <HeadRow>
            <HeadTitle>{t('team.list.title', '공지')}</HeadTitle>
            {canAnnounce && (
              <ActionButton tone="primary" size="sm" data-testid="team-announcements-new" onClick={() => setCompose({ editing: null })}>
                {t('team.list.new', '공지 올리기')}
              </ActionButton>
            )}
          </HeadRow>
        </DetailDrawer.Header>
        <DetailDrawer.Body>
          <List data-testid="team-announcements-list">
            {error && <Empty role="alert">{t('team.list.error', '공지를 불러오지 못했습니다')}</Empty>}
            {!error && items === null && <Empty>{t('team.list.loading', '불러오는 중…')}</Empty>}
            {!error && items && items.length === 0 && (
              <Empty>{canAnnounce ? t('team.list.emptyAdmin', '아직 공지가 없습니다. «공지 올리기» 로 멤버 모두에게 알리세요.') : t('team.list.empty', '아직 공지가 없습니다.')}</Empty>
            )}
            {items?.map((a) => {
              const mine = Number(a.sender_id) === Number(myUserId);
              const canSee = canAnnounce || mine;
              const rd = readers[a.id];
              const read = Math.min(a.read_by_count, a.other_count);
              const senderName = a.sender?.name_localized?.[i18n.language] || a.sender?.name || '';
              return (
                <Card key={a.id} data-testid={`team-announcement-${a.id}`}>
                  <CardTop>
                    {a.pinned_at
                      ? <Badge $live>{t('team.list.live', '게시 중')}</Badge>
                      : <Badge>{t('team.list.ended', '게시 끝')}</Badge>}
                    <CardTitle type="button" onClick={() => onJump?.(a.id)} title={t('team.list.jump', '대화에서 보기') as string}>{a.title}</CardTitle>
                  </CardTop>
                  <Meta>
                    {senderName} · {fmt(a.created_at)}
                    {a.is_edited && <> · {t('team.list.edited', '수정됨')}</>}
                  </Meta>
                  <Body>{a.content}</Body>
                  <CardFoot>
                    {canSee ? (
                      <ReadBtn type="button" onClick={() => void toggleReaders(a)} aria-expanded={openReaders === a.id} data-testid={`team-announcement-readers-${a.id}`}>
                        {t('team.list.readRatio', { read, total: a.other_count, defaultValue: '{{total}}명 중 {{read}}명 읽음' })}
                      </ReadBtn>
                    ) : (
                      <ReadText>{t('team.list.readRatio', { read, total: a.other_count, defaultValue: '{{total}}명 중 {{read}}명 읽음' })}</ReadText>
                    )}
                    {(canAnnounce || mine) && (
                      <EditBtn type="button" onClick={() => setCompose({ editing: a })} data-testid={`team-announcement-edit-${a.id}`}>
                        {t('team.list.edit', '고치기')}
                      </EditBtn>
                    )}
                  </CardFoot>
                  {openReaders === a.id && (
                    <Readers>
                      {rd === 'loading' && <Muted>{t('team.list.loading', '불러오는 중…')}</Muted>}
                      {rd === 'error' && <Muted role="alert">{t('team.list.readersError', '명단을 불러오지 못했습니다')}</Muted>}
                      {rd && typeof rd === 'object' && (
                        <>
                          <ReaderGroup>
                            <ReaderLabel>{t('team.list.unread', '안 읽음 {{count}}', { count: rd.unread.length })}</ReaderLabel>
                            <Names>{rd.unread.length ? rd.unread.map((x) => x.name).join(', ') : t('team.list.none', '없음')}</Names>
                          </ReaderGroup>
                          <ReaderGroup>
                            <ReaderLabel>{t('team.list.read', '읽음 {{count}}', { count: rd.read.length })}</ReaderLabel>
                            <Names>{rd.read.length ? rd.read.map((x) => x.name).join(', ') : t('team.list.none', '없음')}</Names>
                          </ReaderGroup>
                        </>
                      )}
                    </Readers>
                  )}
                </Card>
              );
            })}
          </List>
        </DetailDrawer.Body>
      </DetailDrawer>
      {compose && (
        <AnnounceModal businessId={businessId} editing={compose.editing}
          onClose={() => setCompose(null)}
          onDone={() => { setCompose(null); reload(); }} />
      )}
    </>
  );
};
export default AnnouncementsDrawer;

const HeadRow = styled.div`display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0;`;
const HeadTitle = styled.h2`margin: 0; font-size: 1rem; font-weight: 700; color: #0F172A; flex: 1; min-width: 0;`;
const List = styled.div`display: flex; flex-direction: column; gap: 10px;`;
const Empty = styled.div`padding: 24px 8px; text-align: center; font-size: 0.8125rem; color: #94A3B8; line-height: 1.6;`;
const Card = styled.div`border: 1px solid #E2E8F0; border-radius: 10px; padding: 12px 14px; background: #FFFFFF; display: flex; flex-direction: column; gap: 6px;`;
const CardTop = styled.div`display: flex; align-items: center; gap: 8px; min-width: 0;`;
const Badge = styled.span<{ $live?: boolean }>`
  flex-shrink: 0; font-size: 0.6875rem; font-weight: 700; padding: 2px 8px; border-radius: 999px;
  background: ${(p) => (p.$live ? '#FEF3C7' : '#F1F5F9')}; color: ${(p) => (p.$live ? '#92400E' : '#64748B')};
`;
const CardTitle = styled.button`
  flex: 1; min-width: 0; text-align: left; border: none; background: none; padding: 0; cursor: pointer;
  font-size: 0.9375rem; font-weight: 700; color: #0F172A; overflow-wrap: anywhere;
  &:hover { color: #0F766E; }
`;
const Meta = styled.div`font-size: 0.75rem; color: #94A3B8;`;
const Body = styled.div`font-size: 0.8125rem; color: #334155; line-height: 1.6; white-space: pre-wrap; overflow-wrap: anywhere;`;
const CardFoot = styled.div`display: flex; align-items: center; gap: 8px; margin-top: 2px;`;
const linkBtn = `
  border: none; background: none; padding: 4px 0; min-height: 32px; cursor: pointer; font-size: 0.75rem; font-weight: 600;
`;
const ReadBtn = styled.button`${linkBtn} color: #0F766E; &:hover { text-decoration: underline; }`;
const ReadText = styled.span`font-size: 0.75rem; color: #64748B;`;
const EditBtn = styled.button`${linkBtn} color: #64748B; margin-left: auto; &:hover { color: #0F172A; }`;
const Readers = styled.div`border-top: 1px dashed #E2E8F0; padding-top: 8px; display: flex; flex-direction: column; gap: 6px;`;
const ReaderGroup = styled.div`display: flex; flex-direction: column; gap: 2px;`;
const ReaderLabel = styled.div`font-size: 0.6875rem; font-weight: 700; color: #64748B;`;
const Names = styled.div`font-size: 0.8125rem; color: #334155; line-height: 1.5; overflow-wrap: anywhere;`;
const Muted = styled.div`font-size: 0.75rem; color: #94A3B8;`;
