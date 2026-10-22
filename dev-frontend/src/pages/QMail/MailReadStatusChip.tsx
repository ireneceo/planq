// 메일 상세 밴드2 — «읽음 n/m» 칩 (2026-10-22 · docs/MAIL_MEMBER_READ_AND_REPLY_OWNER_DESIGN.md §7).
//
// Irene: *"내가 읽은 건지 누가 읽었는지 알게 … 읽은 거랑 답변한거 멤버별로 권한자 이름으로"*
//   명단 = 이 메일함을 볼 수 있는 멤버(서버 services/mailRead.audienceOf). 개인 메일함은 서버가 read_status 를 안 준다 → 칩 없음.
//   n = 마지막 받은 메일까지 읽은 사람. 시각을 모르는 «읽음» 은 옛 공용 읽음을 이어받은 것(배포 전 읽음)이다.
import React from 'react';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';
import ChipPopover from '../../components/Common/ChipPopover';

export interface ReadStatus {
  readers: Array<{ user_id: number; name: string | null; read: boolean; read_at: string | null }>;
  repliers: Array<{ user_id: number; name: string | null; replied_at: string | null; after_last_inbound: boolean }>;
}

function fmt(iso: string | null, lang: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(lang === 'en' ? 'en-US' : 'ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const MailReadStatusChip: React.FC<{ status: ReadStatus | null | undefined; myUserId?: number | null }> = ({ status, myUserId }) => {
  const { t, i18n } = useTranslation('qmail');
  if (!status || !status.readers.length) return null;
  const read = status.readers.filter((r) => r.read);
  const unread = status.readers.filter((r) => !r.read);
  const nm = (r: { user_id: number; name: string | null }) => `${r.name || `#${r.user_id}`}${r.user_id === myUserId ? ` (${t('actions.meShort', { defaultValue: '나' })})` : ''}`;
  return (
    <ChipPopover
      data-testid="mail-read-chip"
      prefix={t('readStatus.prefix', { defaultValue: '읽음' }) as string}
      label={`${read.length}/${status.readers.length}`}
      active={unread.length === 0}
      ariaLabel={t('readStatus.aria', { defaultValue: '누가 읽고 답했는지' }) as string}
      width={280}
    >
      {() => (
        <Wrap data-testid="mail-read-panel">
          <Sec>{t('readStatus.read', { defaultValue: '읽음 ({{n}})', n: read.length })}</Sec>
          {read.length ? read.map((r) => (
            <Row key={r.user_id}><Name>{nm(r)}</Name><When>{r.read_at ? fmt(r.read_at, i18n.language) : t('readStatus.earlier', { defaultValue: '이전에 읽음' })}</When></Row>
          )) : <Empty>{t('readStatus.none', { defaultValue: '아직 없음' })}</Empty>}
          <Sec>{t('readStatus.unread', { defaultValue: '안 읽음 ({{n}})', n: unread.length })}</Sec>
          {unread.length ? <Names>{unread.map(nm).join(' · ')}</Names> : <Empty>{t('readStatus.none', { defaultValue: '아직 없음' })}</Empty>}
          <Sec>{t('readStatus.replied', { defaultValue: '답장 ({{n}})', n: status.repliers.length })}</Sec>
          {status.repliers.length ? status.repliers.map((r) => (
            <Row key={r.user_id}><Name>{nm(r)}</Name><When>{fmt(r.replied_at, i18n.language)}</When></Row>
          )) : <Empty>{t('readStatus.noReply', { defaultValue: '아직 답장한 멤버 없음' })}</Empty>}
        </Wrap>
      )}
    </ChipPopover>
  );
};

export default MailReadStatusChip;

const Wrap = styled.div`display: flex; flex-direction: column; gap: 2px; max-height: 320px; overflow-y: auto;`;
const Sec = styled.div`
  font-size: 0.6875rem; font-weight: 700; color: #64748B; padding: 8px 2px 4px;
  &:first-child { padding-top: 0; }
`;
const Row = styled.div`display: flex; align-items: baseline; gap: 8px; padding: 3px 2px; font-size: 0.8125rem; color: #0F172A;`;
const Name = styled.span`flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;`;
const When = styled.span`flex-shrink: 0; font-size: 0.6875rem; color: #94A3B8;`;
const Names = styled.div`font-size: 0.8125rem; color: #334155; padding: 3px 2px; line-height: 1.5;`;
const Empty = styled.div`font-size: 0.75rem; color: #94A3B8; padding: 3px 2px;`;
