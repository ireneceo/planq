// InquiryMailHistory — 상담(메일) 한 건의 **메일 이력 전부**, 보낸/받은 표시와 함께 (2026-10-23)
//
// Irene: *"상담내용 자동 가져오기에서 메일이면 내가 보낸 메일내용이 라스트로 보이는데?
//          보낸 건지 받은 건지 표시되고 모든 메일이력이 나와야지."*
//   목록 미리보기는 스레드의 **마지막 메일**(방향 무관)이라 우리가 답하면 우리 답장이 «문의» 처럼 보였다.
//   여기서는 스레드의 메일을 시간순으로 전부 보인다.
// ★ 행은 고객 히스토리와 **같은 컴포넌트**(ClientTimeline) — 보낸/받은 배지 색·문구가 한 벌이다.
//   눌러서 펼치면 그 메일 본문 전체를 보인다(한 줄 미리보기만으로는 이력을 «읽을» 수 없다).
import React, { useCallback, useEffect, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import ClientTimeline from '../Clients/ClientTimeline';
import { onSocket } from '../../services/socket';
import { getInboxThreadMessages, type InboxThreadMessage } from '../../services/sale';

interface Props { businessId: number; threadId: number }

const InquiryMailHistory: React.FC<Props> = ({ businessId, threadId }) => {
  const { t } = useTranslation('qsale');
  const [items, setItems] = useState<InboxThreadMessage[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const out = await getInboxThreadMessages(businessId, threadId);
      setItems(out.items || []); setHasMore(!!out.has_more); setError(false);
    } catch { setError(true); }
  }, [businessId, threadId]);

  // 대상이 바뀌면 앞 스레드의 이력을 먼저 치운다(늦게 온 응답이 남의 메일을 그리지 않게)
  useEffect(() => {
    let alive = true;
    setItems(null); setOpen(new Set()); setError(false);
    void getInboxThreadMessages(businessId, threadId)
      .then((out) => { if (alive) { setItems(out.items || []); setHasMore(!!out.has_more); } })
      .catch(() => { if (alive) setError(true); });
    return () => { alive = false; };
  }, [businessId, threadId]);

  // 새 메일·답장이 오면 이력도 따라간다(실시간 규칙 16) — 상담 목록과 같은 신호
  useEffect(() => {
    let timer: number | null = null;
    const debounced = () => { if (timer) return; timer = window.setTimeout(() => { timer = null; void load(); }, 250); };
    const offs = ['mail:new', 'mail:updated'].map((ev) => onSocket(ev, debounced));
    return () => { if (timer) window.clearTimeout(timer); offs.forEach((off) => off()); };
  }, [load]);

  const toggle = (id: string) => setOpen((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  return (
    <Wrap data-testid="client-panel-mail-history">
      <Head>
        <Title>{t('panel.mailHistory') as string}</Title>
        {items && items.length > 0 && <Count>{items.length}</Count>}
      </Head>
      {error ? (
        <Dim>{t('error.loadFailed') as string}</Dim>
      ) : !items ? (
        <Dim>{t('timeline.loading', { defaultValue: '불러오는 중…' }) as string}</Dim>
      ) : (
        <>
          {hasMore && <Dim>{t('panel.mailHistoryOlder') as string}</Dim>}
          <ClientTimeline
            items={items}
            onOpen={(it) => toggle(String(it.id))}
            renderBelow={(it) => {
              const m = it as InboxThreadMessage;
              return open.has(String(m.id)) && m.body
                ? <Full data-testid="client-panel-mail-body">{m.body}</Full>
                : null;
            }}
          />
        </>
      )}
    </Wrap>
  );
};

export default InquiryMailHistory;

const Wrap = styled.div`display: flex; flex-direction: column; gap: 8px; margin-top: 14px;`;
const Head = styled.div`display: flex; align-items: center; gap: 6px;`;
const Title = styled.div`font-size: 0.8125rem; font-weight: 700; color: #334155;`;
const Count = styled.span`font-size: 0.75rem; font-weight: 600; color: #64748B;`;
const Dim = styled.div`font-size: 0.8125rem; color: #94A3B8;`;
const Full = styled.div`
  margin-top: 6px; padding: 10px 12px; border-radius: 8px; background: #F8FAFC;
  font-size: 0.8125rem; line-height: 1.6; color: #334155;
  white-space: pre-wrap; word-break: break-word; max-height: 420px; overflow-y: auto;
`;
