// 내 문의·피드백 내역 (운영 #21) — 좌측 개인 그룹 메뉴. GET /api/feedback/mine.
import { useEffect, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { apiFetch, useAuth } from '../../contexts/AuthContext';
import PageShell from '../../components/Layout/PageShell';
import { formatDate } from '../../utils/dateFormat';

interface MyFeedbackItem {
  id: number;
  category: string;
  priority: string;
  title: string;
  body: string;
  status: string;
  admin_response: string | null;
  responded_at: string | null;
  created_at: string;
}

const CAT_LABEL: Record<string, string> = { bug: '버그', improve: '개선', feature: '기능 요청', other: '기타' };
const STATUS_TONE: Record<string, { bg: string; fg: string; label: string }> = {
  pending: { bg: '#FEF3C7', fg: '#92400E', label: '접수됨' },
  reviewing: { bg: '#DBEAFE', fg: '#1E40AF', label: '검토 중' },
  done: { bg: '#DCFCE7', fg: '#166534', label: '완료' },
  wontfix: { bg: '#F1F5F9', fg: '#64748B', label: '보류' },
};

const MyFeedbackPage = () => {
  const { t } = useTranslation('common');
  const { user } = useAuth();
  const tz = (user as { workspace_timezone?: string } | null)?.workspace_timezone || 'Asia/Seoul';
  const [items, setItems] = useState<MyFeedbackItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    apiFetch('/api/feedback/mine')
      .then(r => r.json())
      .then(j => { if (!cancelled && j?.success) setItems(Array.isArray(j.data) ? j.data : []); })
      .catch(() => { if (!cancelled) setItems([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  return (
    <PageShell title={t('myFeedback.title', { defaultValue: '내 문의·피드백' }) as string} count={items.length}>
      {loading ? (
        <Empty>{t('myFeedback.loading', { defaultValue: '불러오는 중…' }) as string}</Empty>
      ) : items.length === 0 ? (
        <Empty>{t('myFeedback.empty', { defaultValue: '아직 남긴 문의·피드백이 없어요. Q helper에서 문의나 피드백을 남겨보세요.' }) as string}</Empty>
      ) : (
        <List>
          {items.map(it => {
            const tone = STATUS_TONE[it.status] || STATUS_TONE.pending;
            return (
              <Card key={it.id}>
                <Top>
                  <Cat>{t(`myFeedback.cat.${it.category}`, { defaultValue: CAT_LABEL[it.category] || it.category }) as string}</Cat>
                  <Status $bg={tone.bg} $fg={tone.fg}>
                    {t(`myFeedback.status.${it.status}`, { defaultValue: tone.label }) as string}
                  </Status>
                  <DateText>{formatDate(it.created_at, tz)}</DateText>
                </Top>
                {it.title && <Title>{it.title}</Title>}
                <Body>{it.body}</Body>
                {it.admin_response && (
                  <Reply>
                    <ReplyLabel>{t('myFeedback.reply', { defaultValue: '운영팀 답변' }) as string}</ReplyLabel>
                    <ReplyText>{it.admin_response}</ReplyText>
                  </Reply>
                )}
              </Card>
            );
          })}
        </List>
      )}
    </PageShell>
  );
};

export default MyFeedbackPage;

const List = styled.div`display: flex; flex-direction: column; gap: 12px; max-width: 760px;`;
const Empty = styled.div`padding: 48px 16px; text-align: center; font-size: 14px; color: #94A3B8;`;
const Card = styled.div`
  padding: 16px 18px; border: 1px solid #E2E8F0; border-radius: 12px; background: #FFFFFF;
  display: flex; flex-direction: column; gap: 8px;
`;
const Top = styled.div`display: flex; align-items: center; gap: 8px; flex-wrap: wrap;`;
const Cat = styled.span`
  font-size: 11px; font-weight: 700; color: #0F766E;
  background: #F0FDFA; border-radius: 999px; padding: 3px 10px;
`;
const Status = styled.span<{ $bg: string; $fg: string }>`
  font-size: 11px; font-weight: 700; border-radius: 999px; padding: 3px 10px;
  background: ${p => p.$bg}; color: ${p => p.$fg};
`;
const DateText = styled.span`margin-left: auto; font-size: 12px; color: #94A3B8;`;
const Title = styled.div`font-size: 14px; font-weight: 600; color: #0F172A;`;
const Body = styled.div`font-size: 13px; color: #334155; white-space: pre-wrap; word-break: break-word; line-height: 1.5;`;
const Reply = styled.div`
  margin-top: 4px; padding: 12px 14px; background: #F8FAFC; border-radius: 10px;
  border-left: 3px solid #14B8A6;
`;
const ReplyLabel = styled.div`font-size: 11px; font-weight: 700; color: #0F766E; margin-bottom: 4px;`;
const ReplyText = styled.div`font-size: 13px; color: #334155; white-space: pre-wrap; word-break: break-word; line-height: 1.5;`;
