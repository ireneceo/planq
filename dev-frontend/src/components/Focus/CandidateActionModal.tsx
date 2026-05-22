// CandidateActionModal — 인박스 task_candidate 카드 클릭 시 inline 등록/반려 모달
// (사이클 N+26 hotfix — 사용자: "할일이 명확해지거나 우측패널 업무상세 바로 열거나 뭐든 할일을 하게")
//
// 흐름:
//   1. 인박스 카드 클릭 → 모달 오픈
//   2. 본문: title (편집 가능) · 추정 담당자 · 대화방명
//   3. 액션 입력: 담당자 select · 마감일 (옵션) · 메모 (옵션)
//   4. [등록] → POST register → 인박스 새로고침 + (옵션) drawer 자동 오픈
//      [반려] → POST reject → 인박스 새로고침
//      [닫기] → 모달만 닫기
//
// 등록/반려는 즉시 effect 가 보이도록 onDone 콜백으로 부모가 silentLoad 트리거.

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../../contexts/AuthContext';
import PlanQSelect, { type PlanQSelectOption } from '../Common/PlanQSelect';
import SingleDateField from '../Common/SingleDateField';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import { useEscapeStack } from '../../hooks/useEscapeStack';
import { useFocusTrap } from '../../hooks/useFocusTrap';

interface Member { user_id: number; name: string; }
interface CandidateInfo {
  candidate_id: number;
  title: string;
  conversation_id: number | null;
  conversation_name: string | null;
  guessed_assignee: { id: number; name: string } | null;
  workspace_name?: string | null;
  workspace_business_id?: number | null;
}

interface Props {
  open: boolean;
  info: CandidateInfo | null;
  onClose: () => void;
  // 등록·반려 성공 시 부모가 인박스 silent reload + (옵션) drawer 오픈
  onRegistered?: (taskId: number, businessId: number) => void;
  onRejected?: () => void;
}

const CandidateActionModal: React.FC<Props> = ({ open, info, onClose, onRegistered, onRejected }) => {
  const { t } = useTranslation('focus');
  const dialogRef = useRef<HTMLDivElement>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [title, setTitle] = useState('');
  const [assigneeId, setAssigneeId] = useState<number | null>(null);
  const [dueDate, setDueDate] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<'register' | 'reject' | null>(null);
  const [error, setError] = useState<string | null>(null);

  useBodyScrollLock(open);
  useEscapeStack(open, onClose);
  useFocusTrap(dialogRef, open);

  // info 변경 시 기본값 reset
  useEffect(() => {
    if (!open || !info) return;
    setTitle(info.title || '');
    setAssigneeId(info.guessed_assignee?.id ?? null);
    setDueDate(null);
    setError(null);
  }, [open, info]);

  // 멤버 목록 fetch (워크스페이스별)
  useEffect(() => {
    if (!open || !info?.workspace_business_id) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await apiFetch(`/api/businesses/${info.workspace_business_id}/members`);
        const j = await r.json();
        if (cancelled || !j.success) return;
        setMembers((j.data || []).map((m: { user_id: number; name: string }) => ({ user_id: m.user_id, name: m.name })));
      } catch { /* noop */ }
    })();
    return () => { cancelled = true; };
  }, [open, info?.workspace_business_id]);

  const handleRegister = useCallback(async () => {
    if (!info || submitting) return;
    setSubmitting('register'); setError(null);
    try {
      const overrides: Record<string, unknown> = {};
      if (title.trim() && title.trim() !== info.title) overrides.title = title.trim();
      if (assigneeId != null) overrides.assignee_id = assigneeId;
      if (dueDate) overrides.due_date = dueDate;
      const r = await apiFetch(`/api/projects/task-candidates/${info.candidate_id}/register`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(overrides),
      });
      const j = await r.json();
      if (!r.ok || !j.success) {
        setError(j?.message || 'register_failed');
        setSubmitting(null);
        return;
      }
      const newTaskId = j.data?.task?.id || j.data?.task_id;
      const bizId = info.workspace_business_id || j.data?.task?.business_id;
      onClose();
      setSubmitting(null);
      if (newTaskId && bizId) onRegistered?.(newTaskId, bizId);
    } catch (e) {
      setError((e as Error).message || 'register_failed');
      setSubmitting(null);
    }
  }, [info, title, assigneeId, dueDate, submitting, onClose, onRegistered]);

  const handleReject = useCallback(async () => {
    if (!info || submitting) return;
    setSubmitting('reject'); setError(null);
    try {
      const r = await apiFetch(`/api/projects/task-candidates/${info.candidate_id}/reject`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
      });
      const j = await r.json();
      if (!r.ok || !j.success) {
        setError(j?.message || 'reject_failed');
        setSubmitting(null);
        return;
      }
      onClose();
      setSubmitting(null);
      onRejected?.();
    } catch (e) {
      setError((e as Error).message || 'reject_failed');
      setSubmitting(null);
    }
  }, [info, submitting, onClose, onRejected]);

  if (!open || !info) return null;

  const memberOpts: PlanQSelectOption[] = [
    { value: '', label: t('candidateModal.assigneePh', '담당자 선택') as string },
    ...members.map(m => ({ value: String(m.user_id), label: m.name })),
  ];

  const node = (
    <Backdrop onClick={onClose}>
      <Dialog
        ref={dialogRef}
        role="dialog" aria-modal="true" aria-label={t('candidateModal.title', '업무 후보 처리') as string}
        onClick={(e) => e.stopPropagation()}
      >
        <ModalHeader>
          <HeaderTitle>{t('candidateModal.title', '업무 후보 처리')}</HeaderTitle>
          <CloseBtn type="button" onClick={onClose} aria-label={t('common.close', '닫기') as string}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </CloseBtn>
        </ModalHeader>

        <Body>
          <SourceBadge>
            <SourceIcon>💬</SourceIcon>
            <SourceText>
              {info.conversation_name
                ? t('candidateModal.fromConv', { conv: info.conversation_name, defaultValue: 'Q Talk · {{conv}} 에서 추출' })
                : t('candidateModal.fromQtalk', { defaultValue: 'Q Talk 대화에서 추출' })}
            </SourceText>
          </SourceBadge>

          <Field>
            <FieldLabel>{t('candidateModal.titleLabel', '업무명')}</FieldLabel>
            <TextInput
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('candidateModal.titlePh', '업무명을 입력하세요') as string}
              autoFocus
              maxLength={200}
            />
          </Field>

          <Field>
            <FieldLabel>{t('candidateModal.assignee', '담당자')} <Required>*</Required></FieldLabel>
            <PlanQSelect
              value={assigneeId != null ? memberOpts.find(o => o.value === String(assigneeId)) : memberOpts[0]}
              options={memberOpts}
              onChange={(opt) => {
                const v = (opt as PlanQSelectOption | null)?.value;
                setAssigneeId(v ? Number(v) : null);
              }}
              size="md"
              isClearable={false}
            />
            {info.guessed_assignee && (
              <FieldHint>{t('candidateModal.guessedAssignee', { name: info.guessed_assignee.name, defaultValue: 'Q Talk 가 "{{name}}" 으로 추정' })}</FieldHint>
            )}
          </Field>

          <Field>
            <FieldLabel>{t('candidateModal.dueDate', '마감일 (선택)')}</FieldLabel>
            <SingleDateField
              value={dueDate || ''}
              onChange={(v) => setDueDate(v || null)}
              placeholder={t('candidateModal.dueDatePh', '비워두면 마감 없음') as string}
            />
          </Field>

          {error && <ErrorLine>{error}</ErrorLine>}
        </Body>

        <Footer>
          <FooterLeft>
            <RejectBtn type="button" onClick={handleReject} disabled={submitting !== null}>
              {submitting === 'reject'
                ? t('candidateModal.skipping', '건너뛰는 중...')
                : t('candidateModal.skip', '건너뛰기')}
            </RejectBtn>
          </FooterLeft>
          <FooterRight>
            <CancelBtn type="button" onClick={onClose} disabled={submitting !== null}>
              {t('common.close', '닫기')}
            </CancelBtn>
            <RegisterBtn
              type="button"
              onClick={handleRegister}
              disabled={submitting !== null || assigneeId == null || !title.trim()}
            >
              {submitting === 'register'
                ? t('candidateModal.registering', '등록 중...')
                : t('candidateModal.register', '업무로 등록')}
            </RegisterBtn>
          </FooterRight>
        </Footer>
      </Dialog>
    </Backdrop>
  );

  return createPortal(node, document.body);
};

export default CandidateActionModal;

// ─── styled ─────────────────────────────────────────────────────
const Backdrop = styled.div`
  position: fixed; inset: 0; z-index: 1250;
  background: rgba(15, 23, 42, 0.55);
  display: flex; align-items: center; justify-content: center;
  padding: 24px;
  animation: cam-in 0.18s ease-out;
  @keyframes cam-in { from { opacity: 0; } to { opacity: 1; } }
  @media (max-width: 640px) { padding: 0; align-items: flex-end; }
`;
const Dialog = styled.div`
  background: #FFFFFF;
  border-radius: 16px;
  width: 100%;
  max-width: 480px;
  display: flex; flex-direction: column;
  box-shadow: 0 20px 60px rgba(0,0,0,0.25);
  animation: cam-pop 0.2s cubic-bezier(0.2, 0.8, 0.2, 1);
  @keyframes cam-pop { from { transform: scale(0.96); opacity: 0; } to { transform: scale(1); opacity: 1; } }
  @media (max-width: 640px) { border-radius: 16px 16px 0 0; max-width: 100%; }
`;
const ModalHeader = styled.header`
  display: flex; align-items: center; justify-content: space-between;
  padding: 20px 24px 12px;
`;
const HeaderTitle = styled.h2`
  font-size: 18px; font-weight: 700; color: #0F172A; margin: 0; letter-spacing: -0.3px;
`;
const CloseBtn = styled.button`
  width: 32px; height: 32px; padding: 0;
  background: transparent; border: none; border-radius: 6px;
  color: #64748B; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
  &:hover { background: #F1F5F9; color: #0F172A; }
`;
const Body = styled.div`
  padding: 0 24px 16px;
  display: flex; flex-direction: column; gap: 14px;
`;
const SourceBadge = styled.div`
  display: inline-flex; align-items: center; gap: 8px;
  padding: 8px 12px;
  background: #F0FDFA; border: 1px solid #CCFBF1; border-radius: 8px;
  font-size: 12px; color: #0F766E;
`;
const SourceIcon = styled.span`font-size: 14px; line-height: 1;`;
const SourceText = styled.span`font-weight: 500;`;
const Field = styled.div`display: flex; flex-direction: column; gap: 6px;`;
const FieldLabel = styled.label`
  font-size: 13px; font-weight: 600; color: #0F172A;
`;
const Required = styled.span`color: #DC2626; margin-left: 2px;`;
const FieldHint = styled.span`font-size: 11px; color: #64748B;`;
const TextInput = styled.input`
  height: 40px; padding: 0 12px;
  border: 1px solid #CBD5E1; border-radius: 6px;
  font-size: 14px; color: #0F172A;
  &:focus { outline: 2px solid rgba(20,184,166,0.4); outline-offset: -1px; border-color: #14B8A6; }
`;
const ErrorLine = styled.div`
  padding: 8px 12px;
  background: #FEF2F2; border: 1px solid #FECACA; border-radius: 6px;
  font-size: 12px; color: #DC2626;
`;
const Footer = styled.footer`
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 24px 20px;
  border-top: 1px solid #F1F5F9;
`;
const FooterLeft = styled.div``;
const FooterRight = styled.div`display: flex; gap: 8px;`;
const baseFooterBtn = `
  height: 36px; padding: 0 16px;
  border-radius: 8px;
  font-size: 13px; font-weight: 600; cursor: pointer;
  transition: background 0.12s, color 0.12s;
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;
// N+36 — "반려" → "건너뛰기". Secondary 톤 (회색 outline) — 부정적 위험 액션 아님.
// 사용자 호소: "거절 멘트 부적합 + 버튼 라인 없어서 클릭 어려움" (옛 border #FECACA 옅은 빨강).
const RejectBtn = styled.button`
  ${baseFooterBtn}
  background: #FFFFFF; color: #475569;
  border: 1px solid #CBD5E1;
  &:hover:not(:disabled) { background: #F8FAFC; border-color: #94A3B8; }
`;
const CancelBtn = styled.button`
  ${baseFooterBtn}
  background: #FFFFFF; color: #334155;
  border: 1px solid #CBD5E1;
  &:hover:not(:disabled) { background: #F8FAFC; }
`;
const RegisterBtn = styled.button`
  ${baseFooterBtn}
  background: #14B8A6; color: #FFFFFF;
  border: 1px solid #14B8A6;
  &:hover:not(:disabled) { background: #0D9488; border-color: #0D9488; }
`;
