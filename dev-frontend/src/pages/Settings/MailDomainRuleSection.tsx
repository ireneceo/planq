// 우리 도메인 — "우리에게 온 메일" 인식 규칙 (수신 축).
//
// 주소를 하나씩 등록하던 방식은 도메인이 늘 때마다 로컬파트 수만큼 등록해야 했다.
// 도메인을 한 번 등록하면 그 도메인의 모든 주소(help@·irene@·앞으로 만들 sales@)가 자동 인식된다.
//
// 보내는 주소(Send-as)와는 다른 개념이라 화면에서도 분리한다 — 발송은 메일 제공자가 주소 단위로만
// 인증해 주고 표시 이름·서명도 주소별이라 규칙으로 대체할 수 없다.
import { useCallback, useEffect, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import ActionButton from '../../components/Common/ActionButton';
import { apiFetch } from '../../contexts/AuthContext';

export interface MailDomainRule {
  id: number;
  domain: string;
  note: string | null;
}

interface Props {
  businessId: number;
  canEdit: boolean;
}

export default function MailDomainRuleSection({ businessId, canEdit }: Props) {
  const { t } = useTranslation('qmail');
  const [rules, setRules] = useState<MailDomainRule[]>([]);
  const [domain, setDomain] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const base = `/api/businesses/${businessId}/email-domain-rules`;

  const load = useCallback(async () => {
    try {
      const r = await apiFetch(base);
      if (!r.ok) { setRules([]); return; }
      const j = await r.json();
      setRules(j.success ? (j.data || []) : []);
    } catch { setRules([]); }
  }, [base]);
  useEffect(() => { load(); }, [load]);

  const add = async () => {
    const d = domain.trim().toLowerCase().replace(/^@/, '');
    if (!d || busy) return;
    setBusy(true); setErr(null);
    try {
      const r = await apiFetch(base, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: d }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.success) {
        const map: Record<string, string> = {
          invalid_domain: t('domainRule.errInvalid', { defaultValue: '도메인만 넣어 주세요 (예: wor-pro.com).' }) as string,
          public_domain_not_allowed: t('domainRule.errPublic', { defaultValue: 'gmail.com 처럼 누구나 쓰는 메일 도메인은 등록할 수 없어요. 그 도메인 전체가 우리 주소로 잡혀 버립니다.' }) as string,
          rule_exists: t('domainRule.errExists', { defaultValue: '이미 등록된 도메인이에요.' }) as string,
          admin_required: t('domainRule.errAdmin', { defaultValue: '워크스페이스 관리자만 바꿀 수 있어요.' }) as string,
        };
        setErr(map[j.message] || (t('domainRule.errFailed', { defaultValue: '추가하지 못했어요.' }) as string));
        return;
      }
      setDomain('');
      await load();
    } finally { setBusy(false); }
  };

  const remove = async (id: number) => {
    setBusy(true); setErr(null);
    try {
      const r = await apiFetch(`${base}/${id}`, { method: 'DELETE' });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        setErr(j?.message === 'admin_required'
          ? (t('domainRule.errAdmin', { defaultValue: '워크스페이스 관리자만 바꿀 수 있어요.' }) as string)
          : (t('domainRule.errFailed', { defaultValue: '삭제하지 못했어요.' }) as string));
        return;
      }
      await load();
    } finally { setBusy(false); }
  };

  return (
    <Wrap>
      <Head>
        <Title>{t('domainRule.title', { defaultValue: '우리 도메인' }) as string}</Title>
      </Head>
      <Desc>
        {t('domainRule.desc', { defaultValue: '이 도메인으로 온 메일은 주소가 무엇이든 우리에게 온 것으로 인식합니다. 도메인을 한 번 등록하면 help@·문의@ 처럼 앞부분이 달라도 따로 등록할 필요가 없어요.' }) as string}
      </Desc>

      {rules.length > 0 && (
        <List>
          {rules.map((r) => (
            <Row key={r.id}>
              <Addr>@{r.domain}</Addr>
              {canEdit && (
                <LinkBtn type="button" $danger onClick={() => remove(r.id)} disabled={busy}>
                  {t('domainRule.remove', { defaultValue: '삭제' }) as string}
                </LinkBtn>
              )}
            </Row>
          ))}
        </List>
      )}

      {canEdit && (
        <AddRow>
          <Input
            type="text"
            value={domain}
            disabled={busy}
            onChange={(e) => setDomain(e.target.value)}
            placeholder={t('domainRule.ph', { defaultValue: 'wor-pro.com' }) as string}
          />
          <ActionButton tone="secondary" size="sm" onClick={add} loading={busy} disabled={!domain.trim()}>
            {t('domainRule.add', { defaultValue: '추가' }) as string}
          </ActionButton>
        </AddRow>
      )}
      {err && <ErrText>{err}</ErrText>}

      <Note>
        {t('domainRule.note', { defaultValue: '우리가 소유한 도메인만 등록하세요. 남의 도메인을 넣으면 그 도메인 앞으로 뿌려진 광고 메일까지 "우리에게 온 메일"로 잡힙니다. 보내는 주소는 아래 "보내는 주소"에서 따로 관리합니다.' }) as string}
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
const Row = styled.div`
  display: flex; align-items: center; gap: 8px;
  padding: 8px 10px; border-radius: 8px;
  background: #FFFFFF; border: 1px solid #E2E8F0;
`;
const Addr = styled.div`flex: 1; min-width: 0; font-size: 12px; color: #334155; word-break: break-all;`;
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
const ErrText = styled.div`font-size: 11px; font-weight: 600; color: #B45309;`;
const Note = styled.p`
  margin: 2px 0 0; padding: 8px 10px; border-radius: 8px;
  background: #F8FAFC; border: 1px solid #E2E8F0;
  font-size: 11px; color: #64748B; line-height: 1.6;
`;
