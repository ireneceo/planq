// 고객 관계 상태 배너 — 초대 수락 대기(재발송) · 직접 관리(초대하기) · 보관됨(되살리기).
//   2026-10-16 설정 > 고객 드로어의 배너들을 빼서 Q sale 패널·상세 페이지가 같이 쓴다.
//   ★ 초대 재발송은 되돌릴 수 없는 외부 발송 — 보낼 주소를 보여 주고 묻는다(CLAUDE.md «외부 발송은 확인을 받는다»).
//   할 수 있는가(초대 가능)는 서버 값(can_invite)만 본다.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../../contexts/AuthContext';
import { useTimeFormat } from '../../hooks/useTimeFormat';
import ConfirmDialog from '../Common/ConfirmDialog';
import { Banner, BannerText, BannerMeta, BannerBtn } from './clientDetailStyles';

export interface StatusBannerClient {
  id: number;
  status: string | null;
  invited_at?: string | null;
  created_at?: string | null;
  reinvite_count?: number;
  invite_email?: string | null;
  can_invite?: boolean;
}

interface Props {
  businessId: number;
  client: StatusBannerClient;
  /** 관리 행위(재발송·초대·되살리기)를 할 수 있는가 — 대표·플랫폼 관리자 */
  canManage: boolean;
  /** [이 고객 초대] — 고객 추가 서랍을 그 고객으로 연다 */
  onInvite?: () => void;
  /** 되살리기 — 부르는 쪽이 보관 라우트를 부른다(⋯ 메뉴와 같은 함수) */
  onRestore?: () => void;
  onChanged?: () => void;
}

export default function ClientStatusBanner({ businessId, client, canManage, onInvite, onRestore, onChanged }: Props) {
  const { t } = useTranslation('clients');
  const { formatDateTime } = useTimeFormat();
  const [ask, setAsk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [failed, setFailed] = useState(false);

  const resend = async () => {
    if (busy) return;
    setBusy(true); setFailed(false);
    try {
      const r = await apiFetch(`/api/clients/${businessId}/${client.id}/resend-invite`, { method: 'POST' });
      const j = await r.json().catch(() => null);
      if (r.ok && j?.success) { setDone(true); onChanged?.(); } else setFailed(true);
    } catch { setFailed(true); } finally { setBusy(false); }
  };

  if (client.status === 'invited') {
    const when = formatDateTime(client.invited_at || client.created_at || '');
    return (
      <Banner data-testid="client-invite-banner">
        <BannerText>
          <strong>{t('invitePending.title', '초대 수락 대기 중')}</strong>
          <span>{failed ? t('invitePending.resendFailed', { defaultValue: '다시 보내지 못했습니다. 잠시 뒤 다시 시도해 주세요.' }) : t('invitePending.desc', '아직 가입하지 않았어요. 메일을 못 받았다면 다시 보낼 수 있습니다.')}</span>
          <BannerMeta>
            {t('invitePending.invitedAt', { when, defaultValue: `초대: ${when}` }) as string}
            {(client.reinvite_count ?? 0) > 0 && ` · ${t('clients.resentCount', { count: client.reinvite_count, defaultValue: `재발송 ${client.reinvite_count}회` }) as string}`}
          </BannerMeta>
        </BannerText>
        {canManage && (
          <BannerBtn type="button" data-testid="client-resend-invite" onClick={() => setAsk(true)}
            disabled={busy || !client.invite_email}
            title={client.invite_email ? undefined : (t('invitePending.noEmail') as string)}>
            {busy ? t('invitePending.resending', '보내는 중…') : done ? t('invitePending.resent', '재발송 완료') : t('invitePending.resend', '초대 재발송')}
          </BannerBtn>
        )}
        <ConfirmDialog
          isOpen={ask}
          title={t('invitePending.resendConfirmTitle') as string}
          message={t('invitePending.resendConfirmBody', { email: client.invite_email || '—' }) as string}
          confirmText={t('invitePending.resend') as string}
          cancelText={t('deleteModal.cancel') as string}
          variant="info"
          onClose={() => setAsk(false)}
          onConfirm={() => { setAsk(false); void resend(); }}
        />
      </Banner>
    );
  }
  if (client.status === 'managed') {
    return (
      <Banner data-testid="client-managed-banner">
        <BannerText>
          <strong>{t('managed.title')}</strong>
          <span>{t('managed.desc')}</span>
        </BannerText>
        {canManage && client.can_invite && onInvite && (
          <BannerBtn type="button" data-testid="client-invite-this" onClick={onInvite}>{t('managed.invite')}</BannerBtn>
        )}
      </Banner>
    );
  }
  if (client.status === 'archived') {
    return (
      <Banner $tone="muted" data-testid="client-archived-banner">
        <BannerText $tone="muted">
          <strong>{t('archivedBanner.title', { defaultValue: '보관된 고객' }) as string}</strong>
          <span>{t('archivedBanner.desc', { defaultValue: '목록 기본 보기에서 빠져 있습니다. 기록과 연결은 그대로입니다.' }) as string}</span>
        </BannerText>
        {canManage && onRestore && (
          <BannerBtn type="button" data-testid="client-restore" onClick={onRestore}>
            {t('archivedBanner.restore', { defaultValue: '되살리기' }) as string}
          </BannerBtn>
        )}
      </Banner>
    );
  }
  return null;
}
