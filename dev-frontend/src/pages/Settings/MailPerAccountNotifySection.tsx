// 메일 알림 — 메일함(주소)별로 내가 받을 범위 (2026-10-22, docs/MAIL_NOTIFY_PER_ADDRESS_DESIGN.md D5)
//
//   Irene: «회사 건 받고 개인 건 안 받거나 개인 건 받고 회사 건 안 받을 수도 있잖아.»
//   계정 카드의 «기본 알림 범위»(MailNotifyScopeSection) 는 그 메일함의 기본값이고, 여기는 **나만의 덮어쓰기**다.
//   «기본값 따름» = 서버에 행이 없다(PUT 'default' 가 지운다). 고르면 바로 저장(AutoSaveField select · ✓ 배지).
//   선택지 문구는 qmail:notifyScope.* 를 그대로 읽는다 — 같은 글자를 두 곳에 두지 않는다.
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../../contexts/AuthContext';
import AutoSaveField from '../../components/Common/AutoSaveField';
import PlanQSelect from '../../components/Common/PlanQSelect';
import { mediaPhone } from '../../theme/breakpoints';

type Scope = 'off' | 'reply_only' | 'recommended' | 'all';
type Choice = 'default' | Scope;

interface Row {
  account_id: number;
  email: string;
  display_name: string | null;
  is_shared: boolean;
  account_scope: Exclude<Scope, 'off'>;
  my_scope: Scope | null;
  effective_scope: Scope;
}

const SCOPE_LABEL: Record<Scope, string> = {
  off: 'settings:notifications.mailPerAccount.off',
  reply_only: 'qmail:notifyScope.replyOnly',
  recommended: 'qmail:notifyScope.recommended',
  all: 'qmail:notifyScope.all',
};

interface Props {
  businessId: number;
  /** 알림 매트릭스의 «메일» 줄이 전부 꺼져 있는가 — 그러면 여기 설정과 무관하게 안 온다 */
  mailChannelsOff: boolean;
}

export default function MailPerAccountNotifySection({ businessId, mailChannelsOff }: Props) {
  const { t } = useTranslation(['settings', 'qmail']);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await apiFetch(`/api/businesses/${businessId}/email-accounts/my-notify`);
        const j = await r.json();
        if (!alive) return;
        if (!r.ok || !j.success) throw new Error('load_failed');
        setRows(j.data as Row[]);
      } catch {
        if (alive) setFailed(true);
      }
    })();
    return () => { alive = false; };
  }, [businessId]);

  if (failed) return <Hint>{t('settings:notifications.mailPerAccount.loadFailed') as string}</Hint>;
  if (!rows) return null;
  if (!rows.length) {
    return (
      <Hint>
        {t('settings:notifications.mailPerAccount.empty') as string}{' '}
        <Link to="/business/settings/mail-accounts">{t('settings:notifications.mailPerAccount.connect') as string}</Link>
      </Hint>
    );
  }

  return (
    <List data-testid="mail-per-account-notify">
      {mailChannelsOff && <Warn>{t('settings:notifications.mailPerAccount.channelsOffHint') as string}</Warn>}
      {rows.map((row) => (
        <AccountRow key={row.account_id} businessId={businessId} row={row} />
      ))}
    </List>
  );
}

function AccountRow({ businessId, row }: { businessId: number; row: Row }) {
  const { t } = useTranslation(['settings', 'qmail']);
  const [choice, setChoice] = useState<Choice>(row.my_scope || 'default');
  const ref = useRef<Choice>(row.my_scope || 'default');
  const savedRef = useRef<Choice>(row.my_scope || 'default');

  const options = [
    {
      value: 'default',
      label: t('settings:notifications.mailPerAccount.default', { scope: t(SCOPE_LABEL[row.account_scope]) }) as string,
    },
    ...(['off', 'reply_only', 'recommended', 'all'] as Scope[]).map((s) => ({ value: s, label: t(SCOPE_LABEL[s]) as string })),
  ];

  const persist = async () => {
    const next = ref.current;
    if (next === savedRef.current) return;
    const r = await apiFetch(`/api/businesses/${businessId}/email-accounts/${row.account_id}/my-notify`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notify_scope: next }),
    });
    if (!r.ok) {
      // 화면이 서버와 다른 값을 보여주면 안 된다 — 되돌리고 던져야 ! 배지가 뜬다
      ref.current = savedRef.current;
      setChoice(savedRef.current);
      throw new Error('save_failed');
    }
    savedRef.current = next;
  };

  return (
    <Item data-testid={`mail-per-account-${row.account_id}`}>
      <Who>
        <Addr title={row.email}>{row.email}</Addr>
        <Kind $shared={row.is_shared}>
          {(row.is_shared ? t('settings:notifications.mailPerAccount.shared') : t('settings:notifications.mailPerAccount.personal')) as string}
        </Kind>
      </Who>
      <Pick>
        <AutoSaveField key={row.account_id} type="select" onSave={persist}>
          <PlanQSelect
            size="sm"
            isSearchable={false}
            aria-label={t('settings:notifications.mailPerAccount.pickLabel', { email: row.email }) as string}
            options={options}
            value={options.find((o) => o.value === choice) || options[0]}
            onChange={(o: any) => {
              const v = (o?.value || 'default') as Choice;
              ref.current = v;
              setChoice(v);
            }}
          />
        </AutoSaveField>
      </Pick>
    </Item>
  );
}

const List = styled.div`display: flex; flex-direction: column; gap: 0;`;
const Item = styled.div`
  display: flex; align-items: center; gap: 12px;
  padding: 10px 0; border-top: 1px solid #F1F5F9;
  &:first-of-type { border-top: none; }
  ${mediaPhone} { flex-direction: column; align-items: stretch; gap: 6px; }
`;
const Who = styled.div`flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px;`;
const Addr = styled.span`
  font-size: 0.8125rem; font-weight: 600; color: #0F172A;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0;
`;
const Kind = styled.span<{ $shared: boolean }>`
  flex-shrink: 0; font-size: 0.6875rem; font-weight: 600; padding: 1px 8px; border-radius: 999px;
  color: ${(p) => (p.$shared ? '#0F766E' : '#475569')};
  background: ${(p) => (p.$shared ? '#F0FDFA' : '#F1F5F9')};
`;
const Pick = styled.div`
  width: 260px; flex-shrink: 0;
  ${mediaPhone} { width: 100%; }
`;
const Hint = styled.div`font-size: 0.75rem; color: #64748B; a { color: #0D9488; font-weight: 600; }`;
const Warn = styled.div`
  font-size: 0.75rem; color: #B45309; background: #FFFBEB; border: 1px solid #FDE68A;
  border-radius: 8px; padding: 8px 10px; margin-bottom: 6px;
`;
