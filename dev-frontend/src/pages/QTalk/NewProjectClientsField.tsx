// pages/QTalk/NewProjectClientsField — 새 프로젝트의 «고객 참여자» 칸 (2026-10-27 NewProjectModal 에서 나눔)
//
// Irene: "프로젝트 만들 때 기존 고객 검색이 안되는데." — 여태 이 칸은 이름·이메일 빈 입력뿐이라
//   이미 있는 고객도 새 연락처로 한 줄 더 생겼다(그 고객과 이어지지 않음). 이제 기존 고객은 **검색해서 고객 id 로** 붙인다
//   — 프로젝트 상세 «기존 고객 연결» 과 같은 목록·같은 라벨(clientOptionLabel)·보관 고객 제외.
import React, { useEffect, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import LetterAvatar from '../../components/Common/LetterAvatar';
import PlanQSelect from '../../components/Common/PlanQSelect';
import { apiFetch } from '../../contexts/AuthContext';
import { clientOptionLabel } from '../../utils/clientLabel';
import { Field, Label, Input, HelpText, RemoveBtn } from './newProjectFormStyles';

/** client_id 가 있으면 기존 고객(연결), 없으면 새 연락처(초대 링크) */
export interface ClientInput {
  client_id?: number;
  name: string;
  email: string;
}

type BizClient = {
  id: number; display_name: string | null; company_name: string | null; invite_email?: string | null;
  status?: string | null; access_kind?: string | null; user?: { id: number; name: string; email: string } | null;
};

interface Props {
  businessId: number;
  open: boolean;
  clients: ClientInput[];
  onChange: (next: ClientInput[]) => void;
}

const NewProjectClientsField: React.FC<Props> = ({ businessId, open, clients, onChange }) => {
  const { t } = useTranslation('qtalk');
  const { t: tSale } = useTranslation('qsale');
  const [bizClients, setBizClients] = useState<BizClient[]>([]);
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');

  useEffect(() => {
    if (!open) { setNewName(''); setNewEmail(''); return; }
    let cancelled = false;
    (async () => {
      const j = await apiFetch(`/api/clients/${businessId}`).then((r) => r.json()).catch(() => null);
      if (!cancelled && j?.success) setBizClients(j.data || []);
    })();
    return () => { cancelled = true; };
  }, [open, businessId]);

  const picked = new Set(clients.map((c) => c.client_id).filter(Boolean));
  // 보관된 고객은 붙일 수 없다(프로젝트 상세와 같은 규칙) · 이미 고른 고객은 뺀다
  const candidates = bizClients.filter((b) => !picked.has(b.id) && b.status !== 'archived');
  const nameOf = (c: BizClient) => c.display_name || c.user?.name || c.company_name || c.invite_email || '';
  const emailOf = (c: BizClient) => c.user?.email || c.invite_email || '';

  const pickExisting = (id: number) => {
    const c = bizClients.find((b) => b.id === id);
    if (!c || picked.has(id)) return;
    onChange([...clients, { client_id: c.id, name: nameOf(c), email: emailOf(c) }]);
  };

  const addNew = () => {
    if (!newName.trim()) return;
    onChange([...clients, { name: newName.trim(), email: newEmail.trim() }]);
    setNewName(''); setNewEmail('');
  };

  return (
    <Field>
      <Label>{t('modal.clientContacts', '고객 참여자')}</Label>
      <ClientList>
        {clients.map((c, i) => (
          <ClientRow key={c.client_id ? `c${c.client_id}` : `n${i}`}>
            <LetterAvatar name={c.name} size={24} />
            <ClientName>{c.name}</ClientName>
            <ClientEmail>{c.email}</ClientEmail>
            {!c.client_id && <NewTag>{t('modal.clientNewTag', '새 초대')}</NewTag>}
            <RemoveBtn type="button" onClick={() => onChange(clients.filter((_, j) => j !== i))} aria-label={t('modal.clientRemove', '빼기') as string}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </RemoveBtn>
          </ClientRow>
        ))}
        {candidates.length > 0 && (
          <div data-testid="newproject-client-pick">
            <PlanQSelect
              isSearchable
              placeholder={t('modal.clientSearchPlaceholder', '기존 고객 검색') as string}
              value={null}
              onChange={(opt) => {
                const v = (opt as { value?: string } | null)?.value;
                if (v) pickExisting(Number(v));
              }}
              options={candidates.map((c) => ({
                value: String(c.id),
                label: clientOptionLabel(`${nameOf(c)}${c.company_name && c.display_name ? ' · ' + c.company_name : ''}${emailOf(c) ? ' (' + emailOf(c) + ')' : ''}`, c, tSale),
              }))}
            />
          </div>
        )}
        <NewClientRow>
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={t('modal.clientNamePlaceholder', '이름')}
            style={{ flex: '0 0 120px' }}
          />
          <Input
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            placeholder={t('modal.clientEmailPlaceholder', '이메일') as string}
            type="email"
            style={{ flex: 1 }}
          />
          <AddClientBtn type="button" onClick={addNew} disabled={!newName.trim()}>
            {t('modal.addClient', '추가')}
          </AddClientBtn>
        </NewClientRow>
      </ClientList>
      <HelpText>{t('modal.clientHelp')}</HelpText>
    </Field>
  );
};

export default NewProjectClientsField;

const NewTag = styled.span`
  font-size: 0.6875rem; color: #854D0E; background: #FEF9C3; border-radius: 4px; padding: 1px 6px; flex-shrink: 0;
`;
const ClientList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const ClientRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  background: #F8FAFC;
  border: 1px solid #E2E8F0;
  border-radius: 8px;
`;

const ClientName = styled.div`
  font-size: 0.8125rem;
  color: #0F172A;
  font-weight: 500;
`;

const ClientEmail = styled.div`
  flex: 1;
  font-size: 0.6875rem;
  color: #64748B;
`;

const NewClientRow = styled.div`
  display: flex;
  gap: 6px;
  align-items: center;
`;

const AddClientBtn = styled.button`
  padding: 8px 14px; flex-shrink: 0; white-space: nowrap;
  background: #0D9488;
  color: #FFFFFF;
  border: none;
  border-radius: 8px;
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
  flex-shrink: 0;
  &:hover:not(:disabled) { background: #0F766E; }
  &:disabled { background: #CBD5E1; cursor: not-allowed; }
`;
