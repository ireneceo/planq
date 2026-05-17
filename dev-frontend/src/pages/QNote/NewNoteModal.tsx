// NewNoteModal — Q Note 의 + 진입 모달 (사이클 N+17 hotfix).
//
// Q docs PostAiModal manual mode 패턴 동기. + 누르면 dropdown 대신 모달:
//   - 탭: 메모 (텍스트) / 음성 노트
//   - 옵션: 프로젝트 / 고객 연결 (선택, PostAiModal 과 동일 PlanQSelect)
//   - 버튼: [취소] [메모 작성 / 음성 노트 시작]
//
// 흐름:
//   1) 메모 + [메모 작성] → onStart('memo', { project_id, client_id })
//      → QNotePage 가 composingMemo=true + MemoView 에 prefill
//   2) 음성 + [음성 노트 설정 시작] → onStart('voice', { project_id, client_id })
//      → QNotePage 가 StartMeetingModal 열고 project/client prefill
//
// styled 토큰은 PostAiModal 과 동일 (Backdrop/Dialog/Header/Tabs/Field/Footer).
import React, { useState, useEffect } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../../contexts/AuthContext';
import PlanQSelect, { type PlanQSelectOption } from '../../components/Common/PlanQSelect';

export type NewNoteKind = 'memo' | 'voice';

interface ProjectOpt { id: number; name: string }
interface ClientOpt { id: number; name: string }

interface Props {
  open: boolean;
  onClose: () => void;
  businessId: number;
  onStart: (kind: NewNoteKind, opts: { project_id: number | null; client_id: number | null }) => void;
}

const NewNoteModal: React.FC<Props> = ({ open, onClose, businessId, onStart }) => {
  const { t } = useTranslation('qnote');
  const [kind, setKind] = useState<NewNoteKind>('memo');
  const [projects, setProjects] = useState<ProjectOpt[]>([]);
  const [clients, setClients] = useState<ClientOpt[]>([]);
  const [projectId, setProjectId] = useState<number | null>(null);
  const [clientId, setClientId] = useState<number | null>(null);

  useEffect(() => {
    if (!open || !businessId) return;
    setKind('memo');
    setProjectId(null);
    setClientId(null);
    // project / client 목록 fetch — PostAiModal 과 동일 endpoint 패턴
    Promise.all([
      apiFetch(`/api/projects?business_id=${businessId}&limit=200`).then(r => r.json()).catch(() => null),
      apiFetch(`/api/clients?business_id=${businessId}&limit=200`).then(r => r.json()).catch(() => null),
    ]).then(([pj, cl]) => {
      if (pj?.success) setProjects((pj.data || []).map((p: any) => ({ id: p.id, name: p.name })));
      if (cl?.success) setClients((cl.data || []).map((c: any) => ({ id: c.id, name: c.company_name || c.contact_name || `#${c.id}` })));
    });
  }, [open, businessId]);

  if (!open) return null;

  const projectOptions: PlanQSelectOption[] = projects.map(p => ({ value: p.id, label: p.name }));
  const clientOptions: PlanQSelectOption[] = clients.map(c => ({ value: c.id, label: c.name }));

  const submit = () => {
    onStart(kind, { project_id: projectId, client_id: clientId });
  };

  return (
    <Backdrop onClick={() => onClose()}>
      <Dialog onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={t('newNoteModal.title', { defaultValue: '새 노트' }) as string}>
        <Header>
          <Title>{t('newNoteModal.title', { defaultValue: '새 노트' }) as string}</Title>
          <CloseBtn type="button" onClick={onClose} aria-label={t('memoPopup.close') as string}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
          </CloseBtn>
        </Header>

        <Body>
          <Tabs role="tablist" aria-label={t('newNoteModal.tabsAria', { defaultValue: '노트 종류 선택' }) as string}>
            <Tab type="button" role="tab" aria-selected={kind === 'memo'} $active={kind === 'memo'} onClick={() => setKind('memo')}>
              <TabTitle>{t('newNoteModal.kindMemo', { defaultValue: '메모' }) as string}</TabTitle>
              <TabHint>{t('newNoteModal.kindMemoHint', { defaultValue: '텍스트 — 코드블록 / 서식 지원' }) as string}</TabHint>
            </Tab>
            <Tab type="button" role="tab" aria-selected={kind === 'voice'} $active={kind === 'voice'} onClick={() => setKind('voice')}>
              <TabTitle>{t('newNoteModal.kindVoice', { defaultValue: '음성 노트' }) as string}</TabTitle>
              <TabHint>{t('newNoteModal.kindVoiceHint', { defaultValue: '회의 녹음 + STT + 답변 찾기' }) as string}</TabHint>
            </Tab>
          </Tabs>

          <Intro>
            {kind === 'memo'
              ? (t('newNoteModal.memoDesc', { defaultValue: '빈 본문으로 시작합니다. 제목은 첫 줄에서 자동 추출돼요.' }) as string)
              : (t('newNoteModal.voiceDesc', { defaultValue: '다음 단계에서 녹음 모드·언어·참여자를 설정한 후 시작합니다.' }) as string)
            }
          </Intro>

          <Field>
            <Label>
              {t('newNoteModal.client', { defaultValue: '고객 연결' }) as string}
              <OptionalMark>{t('newNoteModal.optional', { defaultValue: '(선택)' }) as string}</OptionalMark>
            </Label>
            <PlanQSelect
              size="sm"
              options={clientOptions}
              value={clientOptions.find(o => o.value === clientId) || null}
              onChange={(opt) => setClientId(opt ? Number((opt as PlanQSelectOption).value) : null)}
              placeholder={
                clientOptions.length === 0
                  ? (t('newNoteModal.clientEmpty', { defaultValue: '등록된 고객 없음' }) as string)
                  : (t('newNoteModal.clientPh', { defaultValue: '고객 선택 — 회사명·담당자 자동 채움 (선택)' }) as string)
              }
              isClearable
              isSearchable
            />
          </Field>

          <Field>
            <Label>
              {t('newNoteModal.project', { defaultValue: '프로젝트 연결' }) as string}
              <OptionalMark>{t('newNoteModal.optional', { defaultValue: '(선택)' }) as string}</OptionalMark>
            </Label>
            <PlanQSelect
              size="sm"
              options={projectOptions}
              value={projectOptions.find(o => o.value === projectId) || null}
              onChange={(opt) => setProjectId(opt ? Number((opt as PlanQSelectOption).value) : null)}
              placeholder={t('newNoteModal.projectPh', { defaultValue: '프로젝트 선택 — 고객 자동 매핑 (선택)' }) as string}
              isClearable
              isSearchable
            />
          </Field>
        </Body>

        <Footer>
          <SecondaryBtn type="button" onClick={onClose}>{t('newNoteModal.cancel', { defaultValue: '취소' }) as string}</SecondaryBtn>
          <PrimaryBtn type="button" onClick={submit}>
            {kind === 'memo'
              ? (t('newNoteModal.startMemo', { defaultValue: '메모 작성' }) as string)
              : (t('newNoteModal.startVoice', { defaultValue: '음성 노트 시작' }) as string)
            }
          </PrimaryBtn>
        </Footer>
      </Dialog>
    </Backdrop>
  );
};

export default NewNoteModal;

// ─── styled (PostAiModal 동일 토큰) ───
const Backdrop = styled.div`
  position: fixed; inset: 0; background: rgba(15,23,42,0.4);
  display: flex; align-items: center; justify-content: center; z-index: 1000; padding: 20px;
`;
const Dialog = styled.div`
  background: #FFFFFF; border-radius: 14px; max-width: 560px; width: 100%;
  max-height: 90vh;
  display: flex; flex-direction: column;
  box-shadow: 0 20px 60px rgba(0,0,0,0.2);
  @media (max-width: 640px) {
    position: fixed; top: 70px; bottom: 20px; left: 16px; right: 16px;
    width: auto; max-width: none; max-height: none;
  }
`;
const Header = styled.div`
  display: flex; align-items: center; justify-content: space-between;
  padding: 18px 22px 14px; border-bottom: 1px solid #F1F5F9;
  flex-shrink: 0;
`;
const Title = styled.h2`
  font-size: 16px; font-weight: 700; color: #0F172A; margin: 0;
`;
const CloseBtn = styled.button`
  width: 28px; height: 28px; display: inline-flex; align-items: center; justify-content: center;
  background: transparent; border: none; border-radius: 6px; cursor: pointer; color: #64748B;
  &:hover { background: #F1F5F9; color: #0F172A; }
`;
const Body = styled.div`
  padding: 16px 22px 12px;
  flex: 1; overflow-y: auto;
  min-height: 0;
`;
const Tabs = styled.div`
  display: grid; grid-template-columns: 1fr 1fr; gap: 8px;
  margin-bottom: 12px;
`;
const Tab = styled.button<{ $active: boolean }>`
  display: flex; flex-direction: column; align-items: flex-start; gap: 2px;
  padding: 12px 14px;
  background: ${({ $active }) => $active ? '#F0FDFA' : '#FFFFFF'};
  border: 1px solid ${({ $active }) => $active ? '#14B8A6' : '#E2E8F0'};
  border-radius: 10px;
  cursor: pointer;
  text-align: left;
  transition: background 0.15s, border-color 0.15s;
  &:hover { border-color: #14B8A6; background: #F0FDFA; }
  &:focus-visible { outline: 2px solid rgba(20,184,166,0.3); outline-offset: 2px; }
`;
const TabTitle = styled.span`
  font-size: 13px; font-weight: 700; color: #0F172A;
`;
const TabHint = styled.span`
  font-size: 11px; font-weight: 500; color: #64748B; line-height: 1.4;
`;
const Intro = styled.p`
  font-size: 12px; color: #334155; line-height: 1.6; margin: 0 0 12px;
  padding: 10px 12px; background: #F8FAFC; border-radius: 8px;
`;
const Field = styled.div`display:flex;flex-direction:column;gap:6px;margin-bottom:12px;`;
const Label = styled.label`font-size:12px;font-weight:600;color:#0F172A;`;
const OptionalMark = styled.span`color: #94A3B8; font-weight: 400; font-size: 11px; margin-left: 4px;`;
const Footer = styled.div`
  display: flex; justify-content: flex-end; gap: 6px;
  padding: 12px 22px 18px;
  flex-shrink: 0;
  border-top: 1px solid #F1F5F9; background: #FFFFFF;
`;
const PrimaryBtn = styled.button`
  padding: 9px 18px; font-size: 13px; font-weight: 700; color: #FFFFFF;
  background: #14B8A6;
  border: none; border-radius: 8px; cursor: pointer;
  transition: background 0.15s;
  &:hover { background: #0D9488; }
`;
const SecondaryBtn = styled.button`
  padding: 9px 16px; font-size: 13px; font-weight: 600; color: #334155;
  background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 8px; cursor: pointer;
  &:hover { border-color: #CBD5E1; background: #F8FAFC; }
`;
