// NewChatModal — Q Talk "새 대화 시작" 진입점.
// 설계 원칙 (2026-04-20 재설계):
//  - 프로젝트는 선택적 연결. 연결 안 하면 "일반 대화".
//  - 참여자는 워크스페이스 팀원 중 직접 선택.
//  - 고객 추가는 차후 확장 (프로젝트 연결 시 해당 프로젝트의 고객을 표시, 직접 초대 Phase 2).
//  - 채널 유형은 자동 결정 (고객 있으면 customer, 팀원만이면 internal).
import React, { useEffect, useMemo, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import PlanQSelect from '../../components/Common/PlanQSelect';
import LetterAvatar from '../../components/Common/LetterAvatar';
import { useAuth } from '../../contexts/AuthContext';
import { listBusinessMembers, listProjects, type WorkspaceMemberRow, type ApiProject } from '../../services/qtalk';

export interface NewChatFormData {
  title: string;
  project_id: number | null;
  participant_user_ids: number[];
}

interface Props {
  businessId: number;
  open: boolean;
  preselectedProjectId?: number | null; // 특정 프로젝트 컨텍스트에서 열 때 기본 연결
  onClose: () => void;
  onCreate: (data: NewChatFormData) => void | Promise<void>;
}

const NewChatModal: React.FC<Props> = ({ businessId, open, preselectedProjectId, onClose, onCreate }) => {
  const { t } = useTranslation('qtalk');
  const { user } = useAuth();
  const myId = user ? Number(user.id) : -1;

  const [title, setTitle] = useState('');
  const [projectId, setProjectId] = useState<number | null>(preselectedProjectId ?? null);
  const [participantIds, setParticipantIds] = useState<number[]>([]);
  const [members, setMembers] = useState<WorkspaceMemberRow[]>([]);
  const [projects, setProjects] = useState<ApiProject[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle('');
    setProjectId(preselectedProjectId ?? null);
    setParticipantIds([]);
    setSubmitting(false);
    (async () => {
      try {
        const [mem, projs] = await Promise.all([
          listBusinessMembers(businessId),
          listProjects(businessId).catch(() => [] as ApiProject[]),
        ]);
        setMembers(mem.filter((m) => m.role !== 'ai' && m.user));
        setProjects(projs);
      } catch { /* ignore */ }
    })();
  }, [open, businessId, preselectedProjectId]);

  const memberOptions = useMemo(
    () => members
      .filter((m) => m.user_id !== myId && !participantIds.includes(m.user_id))
      .map((m) => ({ value: String(m.user_id), label: m.user?.name || `user ${m.user_id}` })),
    [members, participantIds, myId],
  );
  const projectOptions = useMemo(
    () => [
      { value: '__none__', label: t('newChat.noProject', '연결 안 함 (일반 대화)') },
      ...projects.map((p) => ({ value: String(p.id), label: p.name })),
    ],
    [projects, t],
  );

  const addParticipant = (userId: number) => {
    if (participantIds.includes(userId)) return;
    setParticipantIds((prev) => [...prev, userId]);
  };
  const removeParticipant = (userId: number) => {
    setParticipantIds((prev) => prev.filter((x) => x !== userId));
  };

  const canSubmit = title.trim().length > 0 && !submitting;
  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await onCreate({ title: title.trim(), project_id: projectId, participant_user_ids: participantIds });
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;
  return (
    <Backdrop onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <Dialog role="dialog" aria-modal="true">
        <Header>
          <Title>{t('newChat.title', '새 대화 시작')}</Title>
          <CloseBtn onClick={onClose} aria-label="닫기">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </CloseBtn>
        </Header>
        <Body>
          <Field>
            <Label>{t('newChat.name', '대화창 이름')} <Req>*</Req></Label>
            <Input autoFocus value={title} placeholder={t('newChat.namePh', '예: 4월 정기 미팅 / Acme 온보딩')}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleSubmit(); }} />
          </Field>

          <Field>
            <Label>{t('newChat.project', '프로젝트 연결')}</Label>
            <Hint>{t('newChat.projectHint', '연결하면 프로젝트의 업무·이슈·메모가 함께 묶입니다. 건너뛰면 일반 대화로 만들어집니다.')}</Hint>
            <PlanQSelect
              size="md"
              value={projectId == null
                ? { value: '__none__', label: t('newChat.noProject', '연결 안 함 (일반 대화)') }
                : projectOptions.find((o) => o.value === String(projectId)) || null}
              onChange={(opt) => {
                const v = (opt as { value?: string } | null)?.value;
                setProjectId(!v || v === '__none__' ? null : Number(v));
              }}
              options={projectOptions}
            />
          </Field>

          <Field>
            <Label>{t('newChat.members', '참여자')}</Label>
            <Hint>{t('newChat.membersHint', '워크스페이스 팀원 중 이 대화에 참여할 사람을 추가하세요.')}</Hint>
            <Chips>
              <MeChip>
                <LetterAvatar name={user?.name || '나'} size={20} />
                <span>{user?.name || '나'} ({t('newChat.me', '나')})</span>
              </MeChip>
              {participantIds.map((uid) => {
                const m = members.find((x) => x.user_id === uid);
                return (
                  <Chip key={uid}>
                    <LetterAvatar name={m?.user?.name || String(uid)} size={20} />
                    <span>{m?.user?.name || `#${uid}`}</span>
                    <ChipX type="button" onClick={() => removeParticipant(uid)} aria-label="remove">×</ChipX>
                  </Chip>
                );
              })}
            </Chips>
            {memberOptions.length > 0 && (
              <PlanQSelect
                size="sm" isClearable
                placeholder={t('newChat.addMemberPh', '+ 팀원 추가')}
                value={null}
                onChange={(opt) => {
                  const v = (opt as { value?: string } | null)?.value;
                  if (v) addParticipant(Number(v));
                }}
                options={memberOptions}
              />
            )}
          </Field>
        </Body>
        <Footer>
          <SecondaryBtn type="button" onClick={onClose}>{t('common.cancel', '취소')}</SecondaryBtn>
          <PrimaryBtn type="button" onClick={handleSubmit} disabled={!canSubmit}>
            {submitting ? t('newChat.creating', '생성 중...') : t('newChat.create', '대화 만들기')}
          </PrimaryBtn>
        </Footer>
      </Dialog>
    </Backdrop>
  );
};

export default NewChatModal;

// ─── styled (디자인 토큰 통일: EmptyState / AddDrawer 와 동일 팔레트) ───
const Backdrop = styled.div`
  position:fixed;inset:0;background:rgba(15,23,42,0.40);z-index:50;
  display:flex;align-items:center;justify-content:center;padding:20px;
  animation:nmFade 0.15s ease-out;
  @keyframes nmFade{from{opacity:0;}to{opacity:1;}}
`;
const Dialog = styled.div`
  width:100%;max-width:520px;background:#FFF;border-radius:14px;
  box-shadow:0 24px 48px rgba(15,23,42,0.18);
  display:flex;flex-direction:column;max-height:90vh;overflow:hidden;
  animation:nmPop 0.18s ease-out;
  @keyframes nmPop{from{transform:translateY(8px);opacity:0.6;}to{transform:translateY(0);opacity:1;}}
`;
const Header = styled.div`
  padding:18px 22px;border-bottom:1px solid #E2E8F0;display:flex;align-items:center;justify-content:space-between;flex-shrink:0;
`;
const Title = styled.h2`font-size:16px;font-weight:700;color:#0F172A;margin:0;`;
const CloseBtn = styled.button`
  width:32px;height:32px;display:flex;align-items:center;justify-content:center;
  background:transparent;border:none;border-radius:8px;color:#64748B;cursor:pointer;
  &:hover{background:#F1F5F9;color:#0F172A;}
`;
const Body = styled.div`
  padding:20px 22px;overflow-y:auto;display:flex;flex-direction:column;gap:18px;
`;
const Field = styled.div`display:flex;flex-direction:column;gap:6px;`;
const Label = styled.label`font-size:13px;font-weight:600;color:#0F172A;`;
const Req = styled.span`color:#F43F5E;margin-left:2px;`;
const Hint = styled.div`font-size:12px;color:#94A3B8;line-height:1.5;margin-bottom:2px;`;
const Input = styled.input`
  height:40px;padding:0 12px;border:1px solid #E2E8F0;border-radius:8px;
  font-size:14px;color:#0F172A;font-family:inherit;background:#FFF;
  &:focus{outline:none;border-color:#14B8A6;box-shadow:0 0 0 3px rgba(20,184,166,0.12);}
  &::placeholder{color:#CBD5E1;}
`;
const Chips = styled.div`
  display:flex;flex-wrap:wrap;gap:6px;padding:4px 0;
`;
const Chip = styled.span`
  display:inline-flex;align-items:center;gap:6px;padding:4px 8px 4px 4px;
  background:#F1F5F9;border-radius:999px;font-size:12px;color:#0F172A;font-weight:500;
`;
const MeChip = styled(Chip)`
  background:#F0FDFA;color:#0F766E;font-weight:600;
`;
const ChipX = styled.button`
  width:18px;height:18px;display:flex;align-items:center;justify-content:center;
  background:transparent;border:none;color:#64748B;cursor:pointer;font-size:14px;line-height:1;border-radius:50%;
  &:hover{background:#E2E8F0;color:#0F172A;}
`;
const Footer = styled.div`
  padding:14px 22px;border-top:1px solid #E2E8F0;display:flex;justify-content:flex-end;gap:8px;flex-shrink:0;background:#FAFBFC;
`;
const PrimaryBtn = styled.button`
  height:40px;padding:0 20px;background:#14B8A6;color:#FFF;border:none;border-radius:8px;
  font-size:13px;font-weight:700;cursor:pointer;transition:background 0.15s;
  &:hover:not(:disabled){background:#0D9488;}
  &:disabled{background:#CBD5E1;cursor:not-allowed;}
`;
const SecondaryBtn = styled.button`
  height:40px;padding:0 16px;background:#FFF;color:#475569;border:1px solid #E2E8F0;border-radius:8px;
  font-size:13px;font-weight:600;cursor:pointer;
  &:hover{background:#F8FAFC;border-color:#CBD5E1;}
`;
