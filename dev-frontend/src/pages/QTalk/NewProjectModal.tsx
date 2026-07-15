import React, { useState, useEffect, useRef } from 'react';
import CalendarPicker from '../../components/Common/CalendarPicker';
import CreateDrawer from '../../components/Common/CreateDrawer';
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
  kind?: 'client' | 'internal';
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
const ROLE_KEY: Record<string, string> = {
  '기획': 'planning', '디자인': 'design', '개발': 'dev', '영업': 'sales', '운영': 'ops', '기타': 'etc',
};

const NewProjectModal: React.FC<Props> = ({ businessId, open, onClose, onCreate }) => {
  const { t } = useTranslation('qtalk');
  const roleLabel = (r: string) => t(`newProject.role.${ROLE_KEY[r] || 'etc'}`, { defaultValue: r });
  const ROLE_SELECT_OPTIONS = ROLE_OPTIONS.map((r) => ({ value: r, label: roleLabel(r) }));
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
  const [isInternal, setIsInternal] = useState(false);  // 내부 프로젝트(비청구·수익성 제외)
  const [members, setMembers] = useState<MemberInput[]>([]);
  const [clients, setClients] = useState<ClientInput[]>([]);
  const [newClientName, setNewClientName] = useState('');
  const [newClientEmail, setNewClientEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const dateAnchorRef = useRef<HTMLButtonElement>(null);
  const [customerChatName, setCustomerChatName] = useState('');
  const [internalChatName, setInternalChatName] = useState('');
  // 채널 생성 여부 토글 — 기본 ON (UX: 프로젝트 만들 때 보통 채팅 같이 만듦)
  const [createCustomerChannel, setCreateCustomerChannel] = useState(true);
  const [createInternalChannel, setCreateInternalChannel] = useState(true);
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
            setMembers([{ user_id: me.user_id, name: me.name || me.user?.name || user.name, role: '기획', is_default: true }]);
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
      // #95 — 채팅방 생성 토글도 기본값 복원. 옛 버그: 이전에 끈 상태가 남아 다음 생성 때 의도와 다르게 동작.
      setCreateCustomerChannel(true); setCreateInternalChannel(true);
      setIsInternal(false); // 내부 프로젝트 체크 상태 유출 방지 (다음 생성에 client 기본)
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
    setMembers([...members, { user_id: m.user_id, name: m.name || m.user?.name || `user ${m.user_id}`, role: '기타', is_default: false }]);
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
        kind: isInternal ? 'internal' : 'client',
        members,
        clients,
        channels: [
          ...(createCustomerChannel ? [{ channel_type: 'customer' as const, name: customerChatName.trim() || t('newProject.customerChannelName', { defaultValue: '{{name}} 고객', name: name.trim() }), participant_user_ids: Array.from(customerParticipants) }] : []),
          ...(createInternalChannel ? [{ channel_type: 'internal' as const, name: internalChatName.trim() || t('newProject.internalChannelName', { defaultValue: '{{name}} 내부', name: name.trim() }), participant_user_ids: Array.from(internalParticipants) }] : []),
        ],
      });
    } finally {
      setSubmitting(false);
    }
  };

  const availableToAdd = availableMembers.filter((m) => !members.find((x) => x.user_id === m.user_id));

  return (
    <CreateDrawer
      open={open}
      onClose={onClose}
      wide
      title={t('modal.title', '새 프로젝트')}
      onSubmit={handleCreate}
      submitting={submitting}
      submitLabel={t('modal.create', '프로젝트 생성')}
      submitDisabled={!name.trim()}
    >
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

          <Field>
            <KindCheckRow>
              <input type="checkbox" checked={isInternal} onChange={(e) => setIsInternal(e.target.checked)} id="np-internal" />
              <label htmlFor="np-internal">
                <strong>{t('modal.internalLabel', '내부 프로젝트')}</strong>
                <small>{t('modal.internalDesc', '자체 투자(비청구) — 수익성 통계에서 제외되고 "내부 투자"로 별도 집계')}</small>
              </label>
            </KindCheckRow>
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
                    const nm = m.name || m.user?.name || `user ${m.user_id}`;
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

          {/* Q Talk 채널 설정 — 채널 종류별 토글 + 이름·참여자 */}
          <Field>
            <Label>{t('modal.channels', 'Q Talk 채널')}</Label>
            <HelpText>{t('modal.channelsHelp', '체크한 채널만 생성됩니다. 둘 다 해제하면 채팅 채널 없이 프로젝트만 만들어집니다.')}</HelpText>
            {([
              { type: 'customer' as const, defaultName: t('modal.customerChannelDefault', { project: name || t('modal.projectFallback', '프로젝트') }) as string, title: t('modal.customerChannel', '고객 Q Talk 채널') as string, enabled: createCustomerChannel, setEnabled: setCreateCustomerChannel },
              { type: 'internal' as const, defaultName: t('modal.internalChannelDefault', { project: name || t('modal.projectFallback', '프로젝트') }) as string, title: t('modal.internalChannel', '내부 Q Talk 채널') as string, enabled: createInternalChannel, setEnabled: setCreateInternalChannel },
            ]).map(cfg => {
              const nameVal = cfg.type === 'customer' ? customerChatName : internalChatName;
              const setNameVal = cfg.type === 'customer' ? setCustomerChatName : setInternalChatName;
              const parts = cfg.type === 'customer' ? customerParticipants : internalParticipants;
              const setParts = cfg.type === 'customer' ? setCustomerParticipants : setInternalParticipants;
              return (
                <ChannelCard key={cfg.type} $disabled={!cfg.enabled}>
                  <ChannelHeaderRow>
                    <ChannelTitle>{cfg.title}</ChannelTitle>
                    {/* 우측 상단 토글 스위치 — 체크박스 대신 (Irene UX 요청) */}
                    <SwitchLabel role="switch" aria-checked={cfg.enabled} title={cfg.enabled ? (t('modal.disableChannel','채널 끄기') as string) : (t('modal.enableChannel','채널 켜기') as string)}>
                      <SwitchInput type="checkbox" checked={cfg.enabled}
                        onChange={(e) => cfg.setEnabled(e.target.checked)} />
                      <SwitchSlider />
                    </SwitchLabel>
                  </ChannelHeaderRow>
                  {cfg.enabled && (
                    <>
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
                                <span>{m.name} · {roleLabel(m.role)}{m.is_default ? ' ★' : ''}</span>
                              </ChannelMemberChk>
                            );
                          })}
                        </ChannelMembersList>
                      </ChannelMembers>
                    </>
                  )}
                </ChannelCard>
              );
            })}
          </Field>
    </CreateDrawer>
  );
};

export default NewProjectModal;

// ─────────────────────────────────────────────
const Field = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const TypeRow = styled.div`display:flex;gap:8px;`;
const KindCheckRow = styled.div`
  display:flex;align-items:flex-start;gap:8px;padding:10px 12px;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;
  input{margin-top:2px;width:16px;height:16px;cursor:pointer;flex-shrink:0;}
  label{display:flex;flex-direction:column;gap:2px;cursor:pointer;}
  strong{font-size:13px;color:#0F172A;font-weight:600;}
  small{font-size:11px;color:#64748B;line-height:1.5;}
`;
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

const ChannelCard = styled.div<{ $disabled?: boolean }>`padding:12px;border:1px solid ${p=>p.$disabled?'#E2E8F0':'#99F6E4'};border-radius:8px;margin-top:8px;display:flex;flex-direction:column;gap:8px;background:${p=>p.$disabled?'#FAFBFC':'#F0FDFA'};transition:background 0.15s,border-color 0.15s;`;
const ChannelHeaderRow = styled.div`display:flex;align-items:center;justify-content:space-between;`;
const ChannelTitle = styled.div`font-size:13px;font-weight:700;color:#0F766E;`;
// 우측 상단 토글 스위치 — Primary teal, 36×20.
const SwitchLabel = styled.label`position:relative;display:inline-block;width:36px;height:20px;cursor:pointer;flex-shrink:0;`;
const SwitchInput = styled.input`opacity:0;width:0;height:0;`;
const SwitchSlider = styled.span`position:absolute;inset:0;background:#CBD5E1;border-radius:999px;transition:background 0.15s;
  &::before{content:'';position:absolute;left:2px;top:2px;width:16px;height:16px;background:#FFF;border-radius:50%;transition:transform 0.15s;box-shadow:0 1px 2px rgba(0,0,0,0.1);}
  ${SwitchInput}:checked + &{background:#14B8A6;}
  ${SwitchInput}:checked + &::before{transform:translateX(16px);}`;
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
  border: 2px solid ${(p) => (p.$active ? '#14B8A6' : 'transparent')};
  box-shadow: ${(p) => (p.$active ? `0 0 0 3px ${p.$color}40` : 'inset 0 0 0 1px rgba(15, 23, 42, 0.08)')};
  cursor: pointer;
  padding: 0;
  transition: transform 0.15s, box-shadow 0.15s;
  &:hover { transform: scale(1.1); }
  &:focus-visible { outline: none; box-shadow: 0 0 0 3px ${(p) => p.$color}66; }
`;

