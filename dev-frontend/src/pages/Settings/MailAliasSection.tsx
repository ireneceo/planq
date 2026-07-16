// 보내는 주소(Send-as) — 한 메일함으로 여러 도메인 주소를 쓰는 경우.
//
// Gmail·Outlook 의 "다른 주소로 메일 보내기" 와 같다. PlanQ 는 주소를 등록해 두고 고르게 하고,
// 그 주소로 보낼 권한 자체는 메일 제공자에서 인증돼 있어야 한다 — 그 사실을 화면에 밝힌다
// (여기서 등록만 하면 다 되는 것처럼 보이면 발송 실패의 원인을 사용자가 찾을 수 없다).
import { useCallback, useEffect, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import ActionButton from '../../components/Common/ActionButton';
import { apiFetch } from '../../contexts/AuthContext';

export interface MailAlias {
  id: number;
  email: string;
  display_name: string | null;
  signature_html: string | null;
  is_default: boolean;
}

interface Props {
  businessId: number;
  accountId: number;
  accountEmail: string;
}

export default function MailAliasSection({ businessId, accountId, accountEmail }: Props) {
  const { t } = useTranslation('qmail');
  const [aliases, setAliases] = useState<MailAlias[]>([]);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const base = `/api/businesses/${businessId}/email-accounts/${accountId}/aliases`;

  const load = useCallback(async () => {
    try {
      const r = await apiFetch(base);
      const j = await r.json();
      setAliases(j.success ? (j.data || []) : []);
    } catch { setAliases([]); }
  }, [base]);
  useEffect(() => { load(); }, [load]);

  const add = async () => {
    const addr = email.trim().toLowerCase();
    if (!addr || busy) return;
    setBusy(true); setErr(null);
    try {
      const r = await apiFetch(base, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: addr, display_name: name.trim() || null }),
      });
      const j = await r.json();
      if (!j.success) {
        const map: Record<string, string> = {
          invalid_email: t('alias.errInvalid', { defaultValue: '이메일 주소 형식을 확인해 주세요.' }) as string,
          alias_exists: t('alias.errExists', { defaultValue: '이미 등록된 주소예요.' }) as string,
          same_as_account: t('alias.errSame', { defaultValue: '이 계정의 기본 주소와 같아요.' }) as string,
        };
        setErr(map[j.message] || (t('alias.errFailed', { defaultValue: '추가하지 못했어요.' }) as string));
        return;
      }
      setEmail(''); setName('');
      await load();
    } finally { setBusy(false); }
  };

  const remove = async (id: number) => {
    setBusy(true); setErr(null);
    try {
      const r = await apiFetch(`${base}/${id}`, { method: 'DELETE' });
      if (!r.ok) { const j = await r.json().catch(() => ({})); setErr(j?.message || (t('alias.errFailed', { defaultValue: '삭제하지 못했어요.' }) as string)); return; }
      await load();
    } finally { setBusy(false); }
  };

  const setDefault = async (id: number) => {
    setBusy(true);
    try {
      await apiFetch(`${base}/${id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_default: true }),
      });
      await load();
    } finally { setBusy(false); }
  };

  return (
    <Wrap>
      <Head>
        <Title>{t('alias.title', { defaultValue: '보내는 주소' }) as string}</Title>
      </Head>
      <Desc>
        {t('alias.desc', { defaultValue: '이 메일함으로 여러 도메인 주소를 쓰는 경우, 보낼 때 고를 수 있게 등록해 두세요. 답장은 그 메일이 온 주소로 자동 선택됩니다.' }) as string}
      </Desc>

      <List>
        <Row $muted>
          <Addr>{accountEmail}</Addr>
          <Tag>{t('alias.accountAddr', { defaultValue: '계정 기본' }) as string}</Tag>
        </Row>
        {aliases.map((a) => (
          <Row key={a.id}>
            <Addr>
              {a.email}
              {a.display_name && <Who>{a.display_name}</Who>}
            </Addr>
            {a.is_default
              ? <Tag $on>{t('alias.default', { defaultValue: '기본' }) as string}</Tag>
              : (
                <LinkBtn type="button" onClick={() => setDefault(a.id)} disabled={busy}>
                  {t('alias.setDefault', { defaultValue: '기본으로' }) as string}
                </LinkBtn>
              )}
            <LinkBtn type="button" $danger onClick={() => remove(a.id)} disabled={busy}>
              {t('alias.remove', { defaultValue: '삭제' }) as string}
            </LinkBtn>
          </Row>
        ))}
      </List>

      <AddRow>
        <Input
          type="email"
          value={email}
          disabled={busy}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t('alias.emailPh', { defaultValue: 'hello@another-domain.com' }) as string}
        />
        <InputSm
          type="text"
          value={name}
          disabled={busy}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('alias.namePh', { defaultValue: '표시 이름 (선택)' }) as string}
        />
        <ActionButton tone="secondary" size="sm" onClick={add} loading={busy} disabled={!email.trim()}>
          {t('alias.add', { defaultValue: '추가' }) as string}
        </ActionButton>
      </AddRow>
      {err && <ErrText>{err}</ErrText>}

      <Note>
        {t('alias.providerNote', { defaultValue: 'Gmail 로 보내는 경우, 그 주소가 Gmail 설정의 "다른 주소로 메일 보내기"에 등록·인증돼 있어야 실제로 발송됩니다. 자체 메일 서버는 도메인 소유 주소면 대개 그대로 발송됩니다.' }) as string}
      </Note>
    </Wrap>
  );
}

const Wrap = styled.div`
  display: flex; flex-direction: column; gap: 8px;
  margin-top: 14px; padding-top: 14px; border-top: 1px solid #F1F5F9;
`;
const Head = styled.div`display: flex; align-items: center; justify-content: space-between;`;
const Title = styled.div`font-size: 13px; font-weight: 700; color: #0F172A;`;
const Desc = styled.p`margin: 0; font-size: 12px; color: #94A3B8; line-height: 1.6;`;
const List = styled.div`display: flex; flex-direction: column; gap: 4px;`;
const Row = styled.div<{ $muted?: boolean }>`
  display: flex; align-items: center; gap: 8px;
  padding: 8px 10px; border-radius: 8px;
  background: ${(p) => (p.$muted ? '#F8FAFC' : '#FFFFFF')};
  border: 1px solid #E2E8F0;
`;
const Addr = styled.div`flex: 1; min-width: 0; display: flex; align-items: center; gap: 6px; font-size: 12px; color: #334155; word-break: break-all;`;
const Who = styled.span`font-size: 11px; color: #94A3B8;`;
const Tag = styled.span<{ $on?: boolean }>`
  flex-shrink: 0; padding: 1px 7px; border-radius: 999px;
  font-size: 10px; font-weight: 700;
  color: ${(p) => (p.$on ? '#0F766E' : '#94A3B8')};
  background: ${(p) => (p.$on ? '#F0FDFA' : '#F1F5F9')};
`;
const LinkBtn = styled.button<{ $danger?: boolean }>`
  flex-shrink: 0; border: none; background: none; padding: 0 2px; cursor: pointer;
  font-size: 11px; font-weight: 600; color: ${(p) => (p.$danger ? '#94A3B8' : '#0F766E')};
  &:hover:not(:disabled) { color: ${(p) => (p.$danger ? '#DC2626' : '#0D9488')}; text-decoration: underline; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;
const AddRow = styled.div`display: flex; align-items: center; gap: 6px; flex-wrap: wrap;`;
const Input = styled.input`
  flex: 1; min-width: 200px; height: 32px; padding: 0 10px;
  border: 1px solid #E2E8F0; border-radius: 8px; font-size: 12px; color: #334155;
  &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 3px rgba(20,184,166,.15); }
`;
const InputSm = styled(Input)`flex: 0 1 140px; min-width: 120px;`;
const ErrText = styled.div`font-size: 11px; font-weight: 600; color: #B45309;`;
const Note = styled.p`
  margin: 2px 0 0; padding: 8px 10px; border-radius: 8px;
  background: #F8FAFC; border: 1px solid #E2E8F0;
  font-size: 11px; color: #64748B; line-height: 1.6;
`;
