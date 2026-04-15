import React, { useState, useEffect } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import PlanQSelect from '../../components/Common/PlanQSelect';
import LetterAvatar from '../../components/Common/LetterAvatar';
import { listBusinessMembers, type WorkspaceMemberRow } from '../../services/qtalk';
import { useAuth } from '../../contexts/AuthContext';

interface Props {
  businessId: number;
  open: boolean;
  onClose: () => void;
  onCreate: (data: ProjectFormData) => void;
}

export interface ProjectFormData {
  name: string;
  client_company: string;
  client_email: string;
  description: string;
  start_date: string;
  end_date: string;
  members: MemberInput[];
  clients: ClientInput[];
}

interface MemberInput {
  user_id: number;
  name: string;
  role: string;
  is_default: boolean;
}

interface ClientInput {
  name: string;
  email: string;
}

const ROLE_OPTIONS = ['기획', '디자인', '개발', '영업', '운영', '기타'];
const ROLE_SELECT_OPTIONS = ROLE_OPTIONS.map((r) => ({ value: r, label: r }));

const NewProjectModal: React.FC<Props> = ({ businessId, open, onClose, onCreate }) => {
  const { t } = useTranslation('qtalk');
  const { user } = useAuth();
  const [availableMembers, setAvailableMembers] = useState<WorkspaceMemberRow[]>([]);
  const [name, setName] = useState('');
  const [clientCompany, setClientCompany] = useState('');
  const [clientEmail, setClientEmail] = useState('');
  const [description, setDescription] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [members, setMembers] = useState<MemberInput[]>([]);
  const [clients, setClients] = useState<ClientInput[]>([]);
  const [newClientName, setNewClientName] = useState('');
  const [newClientEmail, setNewClientEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // 모달 열릴 때 워크스페이스 멤버 목록 fetch + 본인을 기본 멤버로
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const list = await listBusinessMembers(businessId);
        if (cancelled) return;
        // ai 제외
        const humans = list.filter((m) => m.role !== 'ai');
        setAvailableMembers(humans);
        // 본인을 기본 담당자로 세팅 (아직 비어있을 때만)
        if (members.length === 0 && user) {
          const me = humans.find((m) => m.user_id === Number(user.id));
          if (me) {
            setMembers([{ user_id: me.user_id, name: me.user.name, role: '기획', is_default: true }]);
          }
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[NewProjectModal] load members failed', err);
      }
    })();
    return () => { cancelled = true; };
  }, [open, businessId]); // eslint-disable-line react-hooks/exhaustive-deps

  // 모달 닫히면 폼 리셋
  useEffect(() => {
    if (!open) {
      setName(''); setClientCompany(''); setClientEmail('');
      setDescription(''); setStartDate(''); setEndDate('');
      setMembers([]); setClients([]);
      setNewClientName(''); setNewClientEmail('');
      setSubmitting(false);
    }
  }, [open]);

  if (!open) return null;

  const addMember = (userId: number) => {
    const m = availableMembers.find((x) => x.user_id === userId);
    if (!m || members.find((x) => x.user_id === userId)) return;
    setMembers([...members, { user_id: m.user_id, name: m.user.name, role: '기타', is_default: false }]);
  };

  const removeMember = (userId: number) => {
    setMembers(members.filter((m) => m.user_id !== userId));
  };

  const updateMemberRole = (userId: number, role: string) => {
    setMembers(members.map((m) => (m.user_id === userId ? { ...m, role } : m)));
  };

  const setDefault = (userId: number) => {
    setMembers(members.map((m) => ({ ...m, is_default: m.user_id === userId })));
  };

  const addClient = () => {
    if (!newClientName.trim()) return;
    setClients([...clients, { name: newClientName.trim(), email: newClientEmail.trim() }]);
    setNewClientName('');
    setNewClientEmail('');
  };

  const removeClient = (idx: number) => {
    setClients(clients.filter((_, i) => i !== idx));
  };

  const handleCreate = async () => {
    if (!name.trim() || submitting) return;
    setSubmitting(true);
    try {
      await onCreate({
        name: name.trim(),
        client_company: clientCompany.trim(),
        client_email: clientEmail.trim(),
        description: description.trim(),
        start_date: startDate,
        end_date: endDate,
        members,
        clients,
      });
    } finally {
      setSubmitting(false);
    }
  };

  const availableToAdd = availableMembers.filter((m) => !members.find((x) => x.user_id === m.user_id));

  return (
    <Backdrop onClick={onClose}>
      <Modal onClick={(e) => e.stopPropagation()}>
        <ModalHeader>
          <ModalTitle>{t('modal.title', '새 프로젝트')}</ModalTitle>
          <CloseBtn onClick={onClose}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </CloseBtn>
        </ModalHeader>

        <ModalBody>
          {/* 기본 정보 */}
          <Field>
            <Label>{t('modal.name', '프로젝트명')} <Required>*</Required></Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('modal.namePlaceholder', '예: 브랜드 리뉴얼')}
              autoFocus
            />
          </Field>

          <Row>
            <Field>
              <Label>{t('modal.clientCompany', '고객사')}</Label>
              <Input
                value={clientCompany}
                onChange={(e) => setClientCompany(e.target.value)}
                placeholder="Acme Corp"
              />
            </Field>
            <Field>
              <Label>{t('modal.clientEmail', '고객사 이메일')}</Label>
              <Input
                value={clientEmail}
                onChange={(e) => setClientEmail(e.target.value)}
                placeholder="contact@acme.com"
                type="email"
              />
            </Field>
          </Row>

          <Row>
            <Field>
              <Label>{t('modal.startDate', '시작일')}</Label>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </Field>
            <Field>
              <Label>{t('modal.endDate', '종료일')}</Label>
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </Field>
          </Row>

          <Field>
            <Label>{t('modal.description', '설명 (선택)')}</Label>
            <TextArea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('modal.descriptionPlaceholder', '프로젝트 목적·범위·주의사항')}
              rows={2}
            />
          </Field>

          {/* 멤버 + 역할 */}
          <Field>
            <Label>{t('modal.members', '멤버 & 역할')}</Label>
            <MemberList>
              {members.map((m) => {
                return (
                  <MemberRow key={m.user_id}>
                    <LetterAvatar name={m.name} size={26} />
                    <MemberName>{m.name}</MemberName>
                    <RoleSelectWrap>
                      <PlanQSelect
                        options={ROLE_SELECT_OPTIONS}
                        value={ROLE_SELECT_OPTIONS.find((o) => o.value === m.role) || null}
                        onChange={(opt: unknown) => {
                          const v = (opt as { value: string } | null)?.value;
                          if (v) updateMemberRole(m.user_id, v);
                        }}
                        isSearchable={false}
                      />
                    </RoleSelectWrap>
                    <DefaultCheck>
                      <input
                        type="radio"
                        name="default"
                        checked={m.is_default}
                        onChange={() => setDefault(m.user_id)}
                      />
                      <span>{t('modal.default', '기본')}</span>
                    </DefaultCheck>
                    <RemoveBtn onClick={() => removeMember(m.user_id)}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </RemoveBtn>
                  </MemberRow>
                );
              })}
              {availableToAdd.length > 0 && (
                <AddMemberRow>
                  <AddMemberLabel>+ {t('modal.addMember', '멤버 추가')}</AddMemberLabel>
                  {availableToAdd.map((m) => (
                    <AddMemberChip key={m.user_id} onClick={() => addMember(m.user_id)}>
                      <LetterAvatar name={m.user.name} size={18} />
                      {m.user.name}
                    </AddMemberChip>
                  ))}
                </AddMemberRow>
              )}
            </MemberList>
            <HelpText>{t('modal.defaultHelp', '"기본" 체크 = 자동 업무 추출 시 담당자 매핑 실패하면 이 사람으로 fallback')}</HelpText>
          </Field>

          {/* 고객 참여자 */}
          <Field>
            <Label>{t('modal.clientContacts', '고객 참여자 (초대 링크 생성)')}</Label>
            <ClientList>
              {clients.map((c, i) => (
                <ClientRow key={i}>
                  <LetterAvatar name={c.name} size={24} />
                  <ClientName>{c.name}</ClientName>
                  <ClientEmail>{c.email}</ClientEmail>
                  <RemoveBtn onClick={() => removeClient(i)}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </RemoveBtn>
                </ClientRow>
              ))}
              <NewClientRow>
                <Input
                  value={newClientName}
                  onChange={(e) => setNewClientName(e.target.value)}
                  placeholder={t('modal.clientNamePlaceholder', '이름')}
                  style={{ flex: '0 0 120px' }}
                />
                <Input
                  value={newClientEmail}
                  onChange={(e) => setNewClientEmail(e.target.value)}
                  placeholder="이메일"
                  type="email"
                  style={{ flex: 1 }}
                />
                <AddClientBtn onClick={addClient} disabled={!newClientName.trim()}>
                  {t('modal.addClient', '추가')}
                </AddClientBtn>
              </NewClientRow>
            </ClientList>
            <HelpText>{t('modal.clientHelp', '저장 시 초대 링크가 클립보드에 복사됩니다. (이메일 발송은 추후 지원)')}</HelpText>
          </Field>

          <ChannelInfo>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="16" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
            {t('modal.channelInfo', '프로젝트 생성 시 "내부 논의" + "{{client}} 과의 소통" 대화 채널 2개가 자동 생성됩니다.', { client: clientCompany || '고객' })}
          </ChannelInfo>
        </ModalBody>

        <ModalFooter>
          <FooterBtn onClick={onClose} disabled={submitting}>{t('modal.cancel', '취소')}</FooterBtn>
          <FooterBtn $primary disabled={!name.trim() || submitting} onClick={handleCreate}>
            {submitting ? t('modal.creating', '생성 중...') : t('modal.create', '프로젝트 생성')}
          </FooterBtn>
        </ModalFooter>
      </Modal>
    </Backdrop>
  );
};

export default NewProjectModal;

// ─────────────────────────────────────────────
const Backdrop = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.5);
  z-index: 2000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  animation: fadeIn 0.15s ease-out;
  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }
`;

const Modal = styled.div`
  width: 100%;
  max-width: 560px;
  max-height: calc(100vh - 40px);
  background: #FFFFFF;
  border-radius: 16px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.2);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: slideUp 0.2s ease-out;
  @keyframes slideUp {
    from { transform: translateY(20px); opacity: 0; }
    to { transform: translateY(0); opacity: 1; }
  }
`;

const ModalHeader = styled.div`
  padding: 18px 22px;
  border-bottom: 1px solid #F1F5F9;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
`;

const ModalTitle = styled.h2`
  font-size: 17px;
  font-weight: 700;
  color: #0F172A;
  margin: 0;
`;

const CloseBtn = styled.button`
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: 6px;
  color: #64748B;
  cursor: pointer;
  &:hover { background: #F1F5F9; color: #0F172A; }
`;

const ModalBody = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: 20px 22px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  &::-webkit-scrollbar { width: 6px; }
  &::-webkit-scrollbar-thumb { background: #E2E8F0; border-radius: 3px; }
`;

const Field = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const Row = styled.div`
  display: flex;
  gap: 10px;
  & > ${Field} { flex: 1; }
`;

const Label = styled.label`
  font-size: 12px;
  font-weight: 600;
  color: #475569;
`;

const Required = styled.span`
  color: #F43F5E;
`;

const Input = styled.input`
  padding: 9px 12px;
  background: #F8FAFC;
  border: 1px solid #E2E8F0;
  border-radius: 8px;
  font-size: 13px;
  color: #0F172A;
  font-family: inherit;
  &::placeholder { color: #94A3B8; }
  &:focus {
    outline: none;
    border-color: #14B8A6;
    background: #FFFFFF;
    box-shadow: 0 0 0 3px rgba(20, 184, 166, 0.1);
  }
`;

const TextArea = styled.textarea`
  padding: 9px 12px;
  background: #F8FAFC;
  border: 1px solid #E2E8F0;
  border-radius: 8px;
  font-size: 13px;
  color: #0F172A;
  font-family: inherit;
  resize: vertical;
  &::placeholder { color: #94A3B8; }
  &:focus {
    outline: none;
    border-color: #14B8A6;
    background: #FFFFFF;
    box-shadow: 0 0 0 3px rgba(20, 184, 166, 0.1);
  }
`;

const HelpText = styled.div`
  font-size: 11px;
  color: #94A3B8;
  margin-top: 2px;
`;

const MemberList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px;
  background: #F8FAFC;
  border: 1px solid #E2E8F0;
  border-radius: 8px;
`;

const MemberRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;

const MemberName = styled.div`
  flex: 1;
  font-size: 13px;
  color: #0F172A;
  font-weight: 500;
`;

const RoleSelectWrap = styled.div`
  width: 120px;
  font-size: 12px;
`;

const DefaultCheck = styled.label`
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: #64748B;
  cursor: pointer;
  input { accent-color: #F43F5E; }
`;

const RemoveBtn = styled.button`
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: 4px;
  color: #94A3B8;
  cursor: pointer;
  &:hover { background: #FEE2E2; color: #DC2626; }
`;

const AddMemberRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding-top: 6px;
  border-top: 1px dashed #E2E8F0;
`;

const AddMemberLabel = styled.span`
  font-size: 11px;
  color: #64748B;
  font-weight: 600;
  margin-right: 4px;
`;

const AddMemberChip = styled.button`
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 3px 8px 3px 3px;
  background: #FFFFFF;
  border: 1px solid #E2E8F0;
  border-radius: 14px;
  font-size: 11px;
  font-weight: 500;
  color: #475569;
  cursor: pointer;
  &:hover { border-color: #14B8A6; color: #0F766E; }
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
  font-size: 13px;
  color: #0F172A;
  font-weight: 500;
`;

const ClientEmail = styled.div`
  flex: 1;
  font-size: 11px;
  color: #64748B;
`;

const NewClientRow = styled.div`
  display: flex;
  gap: 6px;
  align-items: center;
`;

const AddClientBtn = styled.button`
  padding: 8px 14px;
  background: #0D9488;
  color: #FFFFFF;
  border: none;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  flex-shrink: 0;
  &:hover:not(:disabled) { background: #0F766E; }
  &:disabled { background: #CBD5E1; cursor: not-allowed; }
`;

const ChannelInfo = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 12px;
  background: #F0FDFA;
  border: 1px solid #99F6E4;
  border-radius: 8px;
  font-size: 11px;
  color: #0F766E;
  line-height: 1.4;
  svg { flex-shrink: 0; margin-top: 1px; }
`;

const ModalFooter = styled.div`
  padding: 14px 22px;
  border-top: 1px solid #F1F5F9;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  flex-shrink: 0;
`;

const FooterBtn = styled.button<{ $primary?: boolean }>`
  padding: 10px 18px;
  font-size: 13px;
  font-weight: 600;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.1s;
  ${(p) => p.$primary ? `
    background: #0D9488;
    color: #FFFFFF;
    border: none;
    &:hover:not(:disabled) { background: #0F766E; }
    &:disabled { background: #CBD5E1; cursor: not-allowed; }
  ` : `
    background: transparent;
    color: #64748B;
    border: 1px solid #E2E8F0;
    &:hover { background: #F8FAFC; color: #0F172A; }
  `}
`;
