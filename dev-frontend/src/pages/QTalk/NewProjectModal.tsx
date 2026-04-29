import React, { useState, useEffect, useRef } from 'react';
import CalendarPicker from '../../components/Common/CalendarPicker';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import PlanQSelect from '../../components/Common/PlanQSelect';
import LetterAvatar from '../../components/Common/LetterAvatar';
import { listBusinessMembers, type WorkspaceMemberRow } from '../../services/qtalk';
import { useAuth } from '../../contexts/AuthContext';
import { PROJECT_COLOR_PALETTE } from '../../utils/projectColors';

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
  color: string;
  project_type: 'fixed' | 'ongoing';
  members: MemberInput[];
  clients: ClientInput[];
  channels: ChannelInput[];
}

export interface ChannelInput {
  channel_type: 'customer' | 'internal';
  name: string;
  participant_user_ids: number[]; // member user ids
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
  const [color, setColor] = useState<string>(PROJECT_COLOR_PALETTE[0].value);
  const [projectType, setProjectType] = useState<'fixed' | 'ongoing'>('fixed');
  const [members, setMembers] = useState<MemberInput[]>([]);
  const [clients, setClients] = useState<ClientInput[]>([]);
  const [newClientName, setNewClientName] = useState('');
  const [newClientEmail, setNewClientEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const dateAnchorRef = useRef<HTMLButtonElement>(null);
  const [customerChatName, setCustomerChatName] = useState('');
  const [internalChatName, setInternalChatName] = useState('');
  const [customerParticipants, setCustomerParticipants] = useState<Set<number>>(new Set());
  const [internalParticipants, setInternalParticipants] = useState<Set<number>>(new Set());

  // 모달 열릴 때 워크스페이스 멤버 목록 fetch + 본인을 기본 멤버로
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const list = await listBusinessMembers(businessId);
        if (cancelled) return;
        // ai 제외 + user join 이 null 인 row (삭제된 유저) 방어적으로 제외
        const humans = list.filter((m) => m.role !== 'ai' && m.user);
        setAvailableMembers(humans);
        // 본인을 기본 담당자로 세팅 (아직 비어있을 때만)
        if (members.length === 0 && user) {
          const me = humans.find((m) => m.user_id === Number(user.id));
          if (me) {
            setMembers([{ user_id: me.user_id, name: me.user?.name || user.name, role: '기획', is_default: true }]);
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
      setCustomerChatName(''); setInternalChatName('');
      setCustomerParticipants(new Set()); setInternalParticipants(new Set());
      setSubmitting(false);
    }
  }, [open]);

  // 멤버가 추가되면 기본으로 두 채널에 포함
  useEffect(() => {
    setCustomerParticipants(prev => {
      const next = new Set(prev);
      for (const m of members) if (!next.has(m.user_id)) next.add(m.user_id);
      // 제거된 멤버는 참여자에서도 제외
      for (const uid of Array.from(next)) if (!members.some(m => m.user_id === uid)) next.delete(uid);
      return next;
    });
    setInternalParticipants(prev => {
      const next = new Set(prev);
      for (const m of members) if (!next.has(m.user_id)) next.add(m.user_id);
      for (const uid of Array.from(next)) if (!members.some(m => m.user_id === uid)) next.delete(uid);
      return next;
    });
  }, [members]);

  if (!open) return null;

  const addMember = (userId: number) => {
    const m = availableMembers.find((x) => x.user_id === userId);
    if (!m || members.find((x) => x.user_id === userId)) return;
    setMembers([...members, { user_id: m.user_id, name: m.user?.name || `user ${m.user_id}`, role: '기타', is_default: false }]);
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
        end_date: projectType === 'ongoing' ? '' : endDate,
        color,
        project_type: projectType,
        members,
        clients,
        channels: [
          { channel_type: 'customer', name: customerChatName.trim() || `${name.trim()} 고객`, participant_user_ids: Array.from(customerParticipants) },
          { channel_type: 'internal', name: internalChatName.trim() || `${name.trim()} 내부`, participant_user_ids: Array.from(internalParticipants) },
        ],
      });
    } finally {
      setSubmitting(false);
    }
  };

  const availableToAdd = availableMembers.filter((m) => !members.find((x) => x.user_id === m.user_id));

  return (
    <Backdrop onClick={onClose}>
      <Modal role="dialog" aria-modal="true" aria-label={t('modal.title', '새 프로젝트') as string} onClick={(e) => e.stopPropagation()}>
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

          <Field>
            <Label>{t('modal.type', '프로젝트 타입')} <Required>*</Required></Label>
            <TypeRow>
              <TypeBtn type="button" $active={projectType==='fixed'} onClick={()=>setProjectType('fixed')}>
                <strong>{t('modal.typeFixed', '일시 프로젝트')}</strong>
                <small>{t('modal.typeFixedDesc', '시작~종료일이 있는 계약/기간제')}</small>
              </TypeBtn>
              <TypeBtn type="button" $active={projectType==='ongoing'} onClick={()=>setProjectType('ongoing')}>
                <strong>{t('modal.typeOngoing', '지속 구독')}</strong>
                <small>{t('modal.typeOngoingDesc', '월간/구독 등 지속 계약')}</small>
              </TypeBtn>
            </TypeRow>
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

          <Field>
            <Label>{projectType === 'fixed' ? t('modal.period', '기간') : t('modal.startDate', '시작일')}</Label>
            <DateTrigger ref={dateAnchorRef} type="button" onClick={() => setDatePickerOpen((v) => !v)}>
              {projectType === 'fixed' ? (
                startDate || endDate ?
                  <>{startDate?.replace(/-/g, '/') || '—'} ~ {endDate?.replace(/-/g, '/') || '—'}</>
                  : <DatePlaceholder>{t('modal.pickPeriod', '기간 선택')}</DatePlaceholder>
              ) : (
                startDate ? startDate.replace(/-/g, '/') : <DatePlaceholder>{t('modal.pickStart', '시작일 선택')}</DatePlaceholder>
              )}
            </DateTrigger>
            {datePickerOpen && (
              <CalendarPicker
                isOpen={datePickerOpen}
                anchorRef={dateAnchorRef}
                startDate={startDate}
                endDate={projectType === 'fixed' ? endDate : startDate}
                singleMode={projectType === 'ongoing'}
                onRangeSelect={(s, e) => {
                  setStartDate(s || '');
                  if (projectType === 'fixed') setEndDate(e || '');
                }}
                onClose={() => setDatePickerOpen(false)}
              />
            )}
          </Field>

          <Field>
            <Label>{t('modal.description', '설명 (선택)')}</Label>
            <TextArea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('modal.descriptionPlaceholder', '프로젝트 목적·범위·주의사항')}
              rows={2}
            />
          </Field>

          <Field>
            <Label>{t('modal.color', '프로젝트 색상')}</Label>
            <SwatchRow>
              {PROJECT_COLOR_PALETTE.map((c) => (
                <Swatch
                  key={c.value}
                  type="button"
                  $color={c.value}
                  $active={color === c.value}
                  aria-label={c.label}
                  title={c.label}
                  onClick={() => setColor(c.value)}
                />
              ))}
            </SwatchRow>
            <HexRow>
              <HexPreview style={{ background: color }} />
              <input
                type="color"
                value={/^#[0-9a-fA-F]{6}$/.test(color) ? color : '#14B8A6'}
                onChange={e => setColor(e.target.value)}
                style={{ width: 32, height: 32, padding: 0, border: '1px solid #E2E8F0', borderRadius: 6, background: 'transparent', cursor: 'pointer' }}
                title={t('modal.colorPicker', '직접 색상 선택') as string}
                aria-label={t('modal.colorPicker', '직접 색상 선택') as string}
              />
              <HexInput
                type="text"
                value={color}
                onChange={e => {
                  const v = e.target.value.trim();
                  if (/^#?[0-9a-fA-F]{0,6}$/.test(v)) setColor(v.startsWith('#') ? v : `#${v}`);
                }}
                placeholder="#14B8A6"
                maxLength={7}
              />
            </HexRow>
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
                  {availableToAdd.map((m) => {
                    const nm = m.user?.name || `user ${m.user_id}`;
                    return (
                      <AddMemberChip key={m.user_id} onClick={() => addMember(m.user_id)}>
                        <LetterAvatar name={nm} size={18} />
                        {nm}
                      </AddMemberChip>
                    );
                  })}
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
                  placeholder={t('modal.clientEmailPlaceholder', '이메일') as string}
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

          {/* 채팅 채널 설정 */}
          <Field>
            <Label>{t('modal.channels', '채팅 채널')}</Label>
            <HelpText>{t('modal.channelsHelp', '프로젝트 생성 시 2개 채널이 자동 생성됩니다. 이름과 참여자를 조정하세요.')}</HelpText>
            {([
              { type: 'customer' as const, defaultName: t('modal.customerChannelDefault', { project: name || t('modal.projectFallback', '프로젝트') }) as string, ref: 'customer', title: t('modal.customerChannel', '고객 채널') as string },
              { type: 'internal' as const, defaultName: t('modal.internalChannelDefault', { project: name || t('modal.projectFallback', '프로젝트') }) as string, ref: 'internal', title: t('modal.internalChannel', '내부 채널') as string },
            ]).map(cfg => {
              const nameVal = cfg.type === 'customer' ? customerChatName : internalChatName;
              const setNameVal = cfg.type === 'customer' ? setCustomerChatName : setInternalChatName;
              const parts = cfg.type === 'customer' ? customerParticipants : internalParticipants;
              const setParts = cfg.type === 'customer' ? setCustomerParticipants : setInternalParticipants;
              return (
                <ChannelCard key={cfg.type}>
                  <ChannelTitle>{cfg.title}</ChannelTitle>
                  <Input value={nameVal} onChange={e => setNameVal(e.target.value)} placeholder={cfg.defaultName} />
                  <ChannelMembers>
                    <HelpText>{t('modal.channelMembers', '참여 멤버')} ({parts.size}/{members.length})</HelpText>
                    <ChannelMembersList>
                      {members.length === 0 && <HelpText>{t('modal.noMembers', '멤버를 먼저 추가하세요')}</HelpText>}
                      {members.map(m => {
                        const checked = parts.has(m.user_id);
                        return (
                          <ChannelMemberChk key={m.user_id}>
                            <input type="checkbox" checked={checked}
                              onChange={() => {
                                const next = new Set(parts);
                                if (checked) next.delete(m.user_id); else next.add(m.user_id);
                                setParts(next);
                              }} />
                            <span>{m.name} · {m.role}{m.is_default ? ' ★' : ''}</span>
                          </ChannelMemberChk>
                        );
                      })}
                    </ChannelMembersList>
                  </ChannelMembers>
                </ChannelCard>
              );
            })}
          </Field>
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

const TypeRow = styled.div`display:flex;gap:8px;`;
const TypeBtn = styled.button<{$active?:boolean}>`
  flex:1;display:flex;flex-direction:column;align-items:flex-start;gap:4px;
  padding:10px 12px;border:1px solid ${p=>p.$active?'#14B8A6':'#E2E8F0'};
  border-radius:8px;background:${p=>p.$active?'#F0FDFA':'#FFF'};cursor:pointer;text-align:left;
  strong{font-size:13px;font-weight:600;color:${p=>p.$active?'#0F766E':'#0F172A'};}
  small{font-size:11px;color:#64748B;}
  &:hover{border-color:#14B8A6;}
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

const DateTrigger = styled.button`width:100%;padding:8px 10px;border:1px solid #E2E8F0;border-radius:8px;font-size:13px;color:#0F172A;background:#FFF;font-family:inherit;text-align:left;cursor:pointer;&:hover{border-color:#14B8A6;}&:focus{outline:none;border-color:#14B8A6;box-shadow:0 0 0 2px rgba(20,184,166,0.15);}`;
const DatePlaceholder = styled.span`color:#94A3B8;`;
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

const ChannelCard = styled.div`padding:12px;border:1px solid #E2E8F0;border-radius:8px;margin-top:8px;display:flex;flex-direction:column;gap:8px;`;
const ChannelTitle = styled.div`font-size:12px;font-weight:700;color:#0F766E;`;
const ChannelMembers = styled.div`display:flex;flex-direction:column;gap:4px;`;
const ChannelMembersList = styled.div`display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:4px;max-height:140px;overflow-y:auto;padding:4px;background:#F8FAFC;border-radius:6px;`;
const ChannelMemberChk = styled.label`display:flex;align-items:center;gap:6px;font-size:11px;color:#0F172A;cursor:pointer;padding:2px 4px;border-radius:4px;&:hover{background:#F0FDFA;}input{accent-color:#14B8A6;cursor:pointer;}`;
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


const ModalFooter = styled.div`
  padding: 14px 22px;
  border-top: 1px solid #F1F5F9;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  flex-shrink: 0;
`;

const SwatchRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: flex-start;
`;
const HexRow = styled.div`
  display: flex; align-items: center; gap: 8px; margin-top: 8px;
`;
const HexPreview = styled.div`
  width: 32px; height: 32px; border-radius: 50%;
  border: 2px solid #E2E8F0; flex-shrink: 0;
`;
const HexInput = styled.input`
  width: 100px; height: 32px; padding: 0 10px;
  border: 1px solid #E2E8F0; border-radius: 6px;
  font-size: 12px; color: #0F172A;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 3px rgba(20,184,166,0.15); }
`;
const Swatch = styled.button<{ $color: string; $active: boolean }>`
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: ${(p) => p.$color};
  border: 2px solid ${(p) => (p.$active ? '#0F172A' : 'transparent')};
  box-shadow: ${(p) => (p.$active ? `0 0 0 3px ${p.$color}40` : 'inset 0 0 0 1px rgba(15, 23, 42, 0.08)')};
  cursor: pointer;
  padding: 0;
  transition: transform 0.15s, box-shadow 0.15s;
  &:hover { transform: scale(1.1); }
  &:focus-visible { outline: none; box-shadow: 0 0 0 3px ${(p) => p.$color}66; }
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
