// 대화 입력창 «+» 메뉴의 [명함 보내기] 창 — 내 명함 또는 동료의 기본 명함을 카드로 보낸다. 설계 docs/NAME_CARD_V3_STRATEGY.md 9절 결정 4
//   여는 버튼은 여기 없다(2026-10-23, Irene «이모티콘만 그대로 나오고 나머지는 +로 합체») — ChatPanel 의 + 메뉴(OverflowMenu)가 연다.
//   목록은 서버가 «링크가 열린 것만» 준다(꺼진 명함은 남이 퍼뜨리지 않는다). 고르면 한 번에 보낸다(중복 제출 가드).
//   카드에는 공개 주소와 요약만 실린다 — 고객은 카드를 눌러 명함 페이지에서 [연락처에 저장].
import React, { useEffect, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import StandardModal from '../Common/StandardModal';
import LetterAvatar from '../Common/LetterAvatar';
import { listNameCardOptions, sendNameCardMessage, type NameCardOptions } from '../../services/nameCards';

interface Props { open: boolean; onClose: () => void; businessId: number; conversationId: number }

const SendNameCardModal: React.FC<Props> = ({ open, onClose, businessId, conversationId }) => {
  const { t } = useTranslation('cards');
  const [opts, setOpts] = useState<NameCardOptions | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    let alive = true;
    setOpts(null); setErr(null);
    listNameCardOptions(businessId).then((o) => { if (alive) setOpts(o); }).catch(() => { if (alive) setErr(t('sendCard.loadFailed') as string); });
    return () => { alive = false; };
  }, [open, businessId, t]);

  const send = async (target: { card_id: number } | { member_user_id: number }) => {
    if (busy) return;
    setBusy(true); setErr(null);
    try { await sendNameCardMessage(businessId, conversationId, target); onClose(); }
    catch { setErr(t('sendCard.failed') as string); }
    finally { setBusy(false); }
  };
  const empty = !!opts && opts.mine.length === 0 && opts.colleagues.length === 0;

  return (
    <>
      <StandardModal open={open} onClose={onClose} title={t('sendCard.title')} size="sm">
        <Hint>{t('sendCard.hint')}</Hint>
        {!opts && !err && <Muted aria-busy="true">…</Muted>}
        {empty && <Muted data-testid="send-card-empty">{t('sendCard.empty')}</Muted>}
        {opts && opts.mine.length > 0 && (
          <Group>
            <GroupTitle>{t('sendCard.mine')}</GroupTitle>
            {opts.mine.map((c) => (
              <Row key={`m${c.id}`} type="button" disabled={busy} onClick={() => void send({ card_id: c.id })} data-testid={`send-card-mine-${c.id}`}>
                <LetterAvatar name={c.name} size={32} />
                <Main><Name>{c.label}</Name><Sub>{[c.name, c.job_title].filter(Boolean).join(' · ')}</Sub></Main>
              </Row>
            ))}
          </Group>
        )}
        {opts && opts.colleagues.length > 0 && (
          <Group>
            <GroupTitle>{t('sendCard.colleagues')}</GroupTitle>
            {opts.colleagues.map((c) => (
              <Row key={`c${c.user_id}`} type="button" disabled={busy} onClick={() => void send({ member_user_id: c.user_id })} data-testid={`send-card-colleague-${c.user_id}`}>
                <LetterAvatar name={c.name} size={32} />
                <Main><Name>{c.name}</Name>{c.job_title && <Sub>{c.job_title}</Sub>}</Main>
              </Row>
            ))}
          </Group>
        )}
        {err && <Err role="alert">{err}</Err>}
      </StandardModal>
    </>
  );
};
export default SendNameCardModal;

const Hint = styled.div`font-size: 0.8125rem; color: #64748B; line-height: 1.5; margin-bottom: 12px;`;
const Muted = styled.div`font-size: 0.8125rem; color: #94A3B8; padding: 8px 0;`;
const Err = styled.div`font-size: 0.8125rem; color: #B91C1C; margin-top: 8px;`;
const Group = styled.div`display: flex; flex-direction: column; gap: 4px; margin-bottom: 12px;`;
const GroupTitle = styled.div`font-size: 0.75rem; font-weight: 700; color: #475569;`;
const Row = styled.button`
  display: flex; align-items: center; gap: 10px; width: 100%; min-height: 48px; padding: 6px 10px; box-sizing: border-box;
  border: 1px solid #E2E8F0; border-radius: 10px; background: #FFFFFF; text-align: left; cursor: pointer;
  &:hover:not(:disabled) { border-color: #14B8A6; background: #F0FDFA; }
  &:disabled { opacity: 0.6; cursor: default; }
`;
const Main = styled.div`flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px;`;
const Name = styled.div`font-size: 0.875rem; font-weight: 600; color: #0F172A; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;`;
const Sub = styled.div`font-size: 0.75rem; color: #64748B; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;`;
