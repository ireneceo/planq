// 채팅 설정 통합 모달 — 자동 업무 추출 + 번역 표시 + 참여자 관리 + 프로젝트(read-only)
import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';
import PlanQSelect, { type PlanQSelectOption } from '../../components/Common/PlanQSelect';
import { useEscapeStack } from '../../hooks/useEscapeStack';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import {
  updateConversation,
  addConversationParticipant, removeConversationParticipant,
  fetchParticipantPanel,
  type ApiConversation, type SupportedLang,
} from '../../services/qtalk';

interface Participant {
  user_id: number;
  name: string;
  email: string;
  role?: string;
  is_ai?: boolean;
}
interface Candidate { user_id: number; name: string; email: string; kind: 'member' | 'client'; }
interface Props {
  open: boolean;
  onClose: () => void;
  businessId: number;
  conversation: ApiConversation;
  projectName: string | null;
  onUpdated: (next: ApiConversation) => void;
}

const LANG_OPTIONS: { value: SupportedLang; label: string }[] = [
  { value: 'ko', label: '한국어' },
  { value: 'en', label: 'English' },
  { value: 'ja', label: '日本語' },
  { value: 'zh', label: '中文' },
  { value: 'es', label: 'Español' },
];

const ChatSettingsModal: React.FC<Props> = ({
  open, onClose, businessId, conversation, projectName, onUpdated,
}) => {
  const { t } = useTranslation('qtalk');
  useBodyScrollLock(open);
  useEscapeStack(open, onClose);

  const [autoExtract, setAutoExtract] = useState(conversation.auto_extract_enabled);
  const [translationOn, setTranslationOn] = useState(conversation.translation_enabled);
  const initialLangs = (conversation.translation_languages || ['ko', 'en']) as SupportedLang[];
  const [langA, setLangA] = useState<SupportedLang>(initialLangs[0] || 'ko');
  const [langB, setLangB] = useState<SupportedLang>(initialLangs[1] || 'en');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inviteId, setInviteId] = useState<number | null>(null);

  // 참여자 — 서버에서 fetch (prop 의존 시 빈 목록 오표시 → #1 fix). 추가/제거 시 로컬 즉시 반영.
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);   // 멤버 + 고객 후보
  const [pendingClients, setPendingClients] = useState<{ name: string; email: string }[]>([]);

  useEffect(() => {
    if (!open) return;
    setAutoExtract(conversation.auto_extract_enabled);
    setTranslationOn(conversation.translation_enabled);
    const ll = (conversation.translation_languages || ['ko', 'en']) as SupportedLang[];
    setLangA(ll[0] || 'ko');
    setLangB(ll[1] || 'en');
    setError(null);
    setInviteId(null);
    // 참여자 패널 데이터 fetch — 현재 참여자 + 멤버/고객 후보 + 미수락 초대고객
    fetchParticipantPanel(businessId, conversation.id).then(panel => {
      setParticipants(panel.participants.map(p => ({ user_id: p.user_id, name: p.name, email: p.email, role: p.role, is_ai: p.is_ai })));
      setCandidates([
        ...panel.member_candidates.map(m => ({ ...m, kind: 'member' as const })),
        ...panel.client_candidates.map(c => ({ ...c, kind: 'client' as const })),
      ]);
      setPendingClients(panel.pending_clients || []);
    }).catch(() => { setParticipants([]); setCandidates([]); setPendingClients([]); });
  }, [open, conversation, businessId]);

  if (!open) return null;

  const sameLang = langA === langB;
  const canSave = !sameLang || !translationOn;

  const save = async () => {
    if (busy) return;
    if (translationOn && sameLang) {
      setError(t('settings.translation.errSame', '두 언어를 다르게 선택하세요') as string);
      return;
    }
    setBusy(true); setError(null);
    try {
      const next = await updateConversation(conversation.id, {
        auto_extract_enabled: autoExtract,
        translation_enabled: translationOn,
        translation_languages: translationOn ? [langA, langB] : null,
      });
      onUpdated(next);
      onClose();
    } catch (e) {
      const msg = (e as Error).message || '';
      setError(msg.includes('translation_languages') ? t('settings.translation.errInvalid', '언어 설정이 잘못되었습니다') as string
        : t('settings.errFailed', '저장 실패') as string);
    } finally {
      setBusy(false);
    }
  };

  const addMember = async () => {
    if (!inviteId || busy) return;
    const c = candidates.find(x => x.user_id === inviteId);
    if (!c) return;
    setBusy(true); setError(null);
    try {
      await addConversationParticipant(businessId, conversation.id, inviteId, c.kind);
      // 로컬 즉시 반영 + 후보에서 제거
      setParticipants(prev => [...prev, { user_id: c.user_id, name: c.name, email: c.email, role: c.kind }]);
      setCandidates(prev => prev.filter(x => x.user_id !== c.user_id));
      setInviteId(null);
    } catch (e) {
      setError((e as Error).message || (t('settings.errFailed', '저장 실패') as string));
    } finally { setBusy(false); }
  };

  const removeMember = async (userId: number) => {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      await removeConversationParticipant(businessId, conversation.id, userId);
      setParticipants(prev => prev.filter(p => p.user_id !== userId));
    } catch (e) {
      setError((e as Error).message || (t('settings.errFailed', '저장 실패') as string));
    } finally { setBusy(false); }
  };

  // 초대 가능 후보 = 멤버 + 프로젝트 고객 (이미 참여자 제외는 서버에서 처리). 고객은 라벨에 표시.
  const memberOptions: PlanQSelectOption[] = candidates
    .filter(c => !participants.find(p => p.user_id === c.user_id))
    .map(c => ({
      value: c.user_id,
      label: c.kind === 'client'
        ? `${c.name} · ${t('settings.participants.clientTag', { defaultValue: '고객' })}${c.email ? ` (${c.email})` : ''}`
        : `${c.name}${c.email ? ` (${c.email})` : ''}`,
    }));

  return (
    <Backdrop onClick={onClose}>
      <Dialog onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={t('settings.title', '채팅 설정') as string}>
        <Header>
          <Title>{t('settings.title', '채팅 설정')}</Title>
          <CloseBtn type="button" onClick={onClose} aria-label={t('common.close', '닫기') as string}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </CloseBtn>
        </Header>
        <Body>
          {/* 기본 정보 */}
          <Section>
            <SectionTitle>{t('settings.basic', '기본 정보')}</SectionTitle>
            <ReadRow>
              <ReadLabel>{t('settings.project', '소속 프로젝트')}</ReadLabel>
              <ReadValue>{projectName || '—'}</ReadValue>
            </ReadRow>
            <ReadHint>{t('settings.projectHint', '프로젝트 연결은 변경할 수 없습니다. 다른 프로젝트로 옮기려면 새 채팅방을 만드세요.')}</ReadHint>
          </Section>

          {/* 번역 */}
          <Section>
            <SectionTitle>{t('settings.translation.title', '번역 표시')}</SectionTitle>
            <ToggleRow>
              <ToggleLabel>
                <input type="checkbox" role="switch" aria-checked={translationOn}
                  checked={translationOn} onChange={e => setTranslationOn(e.target.checked)} />
                <span>{t('settings.translation.enable', '번역 표시 사용')}</span>
              </ToggleLabel>
              <ToggleHint>{t('settings.translation.hint', '사용 시 메시지에 두 언어가 함께 표시됩니다 (Q note 패턴). 사용 OFF 시 원문만 표시.')}</ToggleHint>
            </ToggleRow>
            {translationOn && (
              <LangRow>
                <LangCol>
                  <ReadLabel>{t('settings.translation.langA', '언어 1')}</ReadLabel>
                  <PlanQSelect size="sm"
                    options={LANG_OPTIONS as unknown as PlanQSelectOption[]}
                    value={LANG_OPTIONS.find(o => o.value === langA) as unknown as PlanQSelectOption}
                    onChange={(opt) => setLangA(((opt as PlanQSelectOption)?.value as SupportedLang) || 'ko')}
                    isSearchable={false} />
                </LangCol>
                <LangSep>↔</LangSep>
                <LangCol>
                  <ReadLabel>{t('settings.translation.langB', '언어 2')}</ReadLabel>
                  <PlanQSelect size="sm"
                    options={LANG_OPTIONS as unknown as PlanQSelectOption[]}
                    value={LANG_OPTIONS.find(o => o.value === langB) as unknown as PlanQSelectOption}
                    onChange={(opt) => setLangB(((opt as PlanQSelectOption)?.value as SupportedLang) || 'en')}
                    isSearchable={false} />
                </LangCol>
              </LangRow>
            )}
            {translationOn && sameLang && <ErrorMsg>{t('settings.translation.errSame', '두 언어를 다르게 선택하세요')}</ErrorMsg>}
          </Section>

          {/* 자동 업무 추출 */}
          <Section>
            <SectionTitle>{t('settings.autoExtract.title', '자동 업무 추출')}</SectionTitle>
            <ToggleRow>
              <ToggleLabel>
                <input type="checkbox" role="switch" aria-checked={autoExtract}
                  checked={autoExtract} onChange={e => setAutoExtract(e.target.checked)} />
                <span>{t('settings.autoExtract.enable', '메시지에서 업무 후보 자동 추출')}</span>
              </ToggleLabel>
              <ToggleHint>{t('settings.autoExtract.hint', '대화 내용을 분석해 업무 후보를 자동으로 모읍니다. 우측 패널 또는 확인 필요에서 검토합니다.')}</ToggleHint>
            </ToggleRow>
          </Section>

          {/* 참여자 */}
          <Section>
            <SectionTitle>{t('settings.participants.title', '참여자')}</SectionTitle>
            <MemberList>
              {participants.map(p => (
                <MemberRow key={p.user_id}>
                  <MemberInfo>
                    <MemberName>
                      {p.name}
                      {p.is_ai
                        ? <RoleTag $kind="ai">{t('settings.participants.aiTag', { defaultValue: 'AI' }) as string}</RoleTag>
                        : p.role === 'client'
                          ? <RoleTag $kind="client">{t('settings.participants.clientTag', { defaultValue: '고객' }) as string}</RoleTag>
                          : null}
                    </MemberName>
                    <MemberEmail>{p.email}</MemberEmail>
                  </MemberInfo>
                  {!p.is_ai && (
                    <DangerBtn type="button" onClick={() => removeMember(p.user_id)} disabled={busy}>
                      {t('settings.participants.remove', '내보내기')}
                    </DangerBtn>
                  )}
                </MemberRow>
              ))}
              {participants.length === 0 && <Empty>{t('settings.participants.empty', '참여자가 없습니다')}</Empty>}
            </MemberList>
            {memberOptions.length > 0 && (
              <InviteRow>
                <PlanQSelect size="sm"
                  options={memberOptions}
                  value={memberOptions.find(o => o.value === inviteId) || null}
                  onChange={(opt) => setInviteId(opt ? Number((opt as PlanQSelectOption).value) : null)}
                  placeholder={t('settings.participants.invitePh2', '멤버 · 고객 선택') as string}
                  isClearable isSearchable
                />
                <PrimaryBtn type="button" disabled={!inviteId || busy} onClick={addMember}>
                  {t('settings.participants.invite', '초대')}
                </PrimaryBtn>
              </InviteRow>
            )}
            {pendingClients.length > 0 && (
              <PendingNote>
                {t('settings.participants.pendingNote', { defaultValue: '초대 수락 대기 중인 고객은 수락하면 자동으로 이 채팅에 참여합니다' }) as string}
                <PendingList>{pendingClients.map((c, i) => <span key={i}>{c.name}{c.email ? ` (${c.email})` : ''}</span>)}</PendingList>
              </PendingNote>
            )}
          </Section>

          {error && <ErrorMsg>{error}</ErrorMsg>}
        </Body>
        <Footer>
          <SecondaryBtn type="button" onClick={onClose} disabled={busy}>{t('common.cancel', '취소')}</SecondaryBtn>
          <PrimaryBtn type="button" disabled={busy || !canSave} onClick={save}>
            {busy ? t('common.saving', '저장 중...') : t('common.save', '저장')}
          </PrimaryBtn>
        </Footer>
      </Dialog>
    </Backdrop>
  );
};

export default ChatSettingsModal;

// ─── styled ───
const Backdrop = styled.div`
  position: fixed; inset: 0; background: rgba(15,23,42,0.4);
  display: flex; align-items: center; justify-content: center;
  z-index: 1000; padding: 20px;
  @media (max-width: 640px) { padding: 0; align-items: stretch; }
`;
const Dialog = styled.div`
  background: #fff; border-radius: 14px; max-width: 560px; width: 100%;
  max-height: 90vh; display: flex; flex-direction: column;
  box-shadow: 0 20px 60px rgba(15,23,42,0.2);
  @media (max-width: 640px) {
    max-width: none; max-height: none; border-radius: 0;
    margin-top: 60px; height: calc(var(--vvh, 100vh) - 60px);
  }
`;
const Header = styled.div`
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 20px; border-bottom: 1px solid #F1F5F9;
`;
const Title = styled.h2`font-size:16px;font-weight:700;color:#0F172A;margin:0;`;
const CloseBtn = styled.button`
  width:28px;height:28px;background:transparent;border:none;cursor:pointer;
  border-radius:6px;color:#64748B;display:flex;align-items:center;justify-content:center;
  &:hover{background:#F1F5F9;color:#0F172A;}
`;
const Body = styled.div`flex:1;overflow-y:auto;padding:20px;display:flex;flex-direction:column;gap:20px;`;
const Section = styled.section`display:flex;flex-direction:column;gap:8px;`;
const SectionTitle = styled.h3`font-size:13px;font-weight:700;color:#0F172A;margin:0 0 4px;`;
const ReadRow = styled.div`display:flex;justify-content:space-between;align-items:center;`;
const ReadLabel = styled.div`font-size:12px;font-weight:600;color:#334155;`;
const ReadValue = styled.div`font-size:13px;color:#0F172A;`;
const ReadHint = styled.div`font-size:11px;color:#94A3B8;line-height:1.5;`;
const ToggleRow = styled.div`display:flex;flex-direction:column;gap:4px;`;
const ToggleLabel = styled.label`
  display:inline-flex;align-items:center;gap:8px;font-size:13px;color:#0F172A;cursor:pointer;
  input{width:32px;height:18px;}
`;
const ToggleHint = styled.div`font-size:11px;color:#94A3B8;line-height:1.5;`;
const LangRow = styled.div`display:flex;align-items:flex-end;gap:8px;`;
const LangCol = styled.div`flex:1;display:flex;flex-direction:column;gap:4px;`;
const LangSep = styled.div`font-size:14px;color:#94A3B8;padding-bottom:8px;`;
const ErrorMsg = styled.div`font-size:12px;color:#DC2626;background:#FEF2F2;padding:8px 10px;border-radius:6px;border:1px solid #FECACA;`;
const MemberList = styled.div`display:flex;flex-direction:column;gap:6px;`;
const MemberRow = styled.div`
  display:flex;justify-content:space-between;align-items:center;
  padding:8px 12px;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;
`;
const MemberInfo = styled.div`display:flex;flex-direction:column;gap:2px;`;
const MemberName = styled.div`font-size:13px;font-weight:600;color:#0F172A;display:flex;align-items:center;gap:6px;`;
const MemberEmail = styled.div`font-size:11px;color:#64748B;`;
const Empty = styled.div`text-align:center;padding:14px;color:#94A3B8;font-size:12px;`;
const RoleTag = styled.span<{ $kind: 'client' | 'ai' }>`
  font-size:10px;font-weight:700;padding:1px 7px;border-radius:999px;
  ${p => p.$kind === 'client'
    ? 'background:#F0FDFA;color:#0F766E;'
    : 'background:#FEF2F2;color:#B91C1C;'}
`;
const PendingNote = styled.div`
  margin-top:10px;padding:10px 12px;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;
  font-size:11px;color:#64748B;line-height:1.6;
`;
const PendingList = styled.div`
  display:flex;flex-direction:column;gap:2px;margin-top:6px;font-weight:600;color:#475569;
`;
const InviteRow = styled.div`display:flex;gap:6px;align-items:flex-start;`;
const PrimaryBtn = styled.button`
  height:32px;padding:0 14px;background:#14B8A6;color:#fff;border:none;
  border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;
  &:hover:not(:disabled){background:#0D9488;}
  &:disabled{background:#CBD5E1;cursor:not-allowed;}
`;
const SecondaryBtn = styled.button`
  height:32px;padding:0 14px;background:#fff;color:#334155;border:1px solid #E2E8F0;
  border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;
  &:hover:not(:disabled){border-color:#CBD5E1;background:#F8FAFC;}
`;
const DangerBtn = styled.button`
  height:28px;padding:0 10px;background:#fff;color:#DC2626;border:1px solid #FECACA;
  border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;
  &:hover:not(:disabled){background:#FEF2F2;}
  &:disabled{opacity:.4;cursor:not-allowed;}
`;
const Footer = styled.div`
  display:flex;justify-content:flex-end;gap:6px;
  padding:12px 20px 18px;border-top:1px solid #F1F5F9;
`;
