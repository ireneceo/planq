// QNoteSummaryModal — Q Note 정리하기 분기 모달 (사이클 N+42, project_qnote_capture_design 박제).
//
// 4 액션 분기:
//   1) 업무 생성  → /tasks?prefill=text (QTaskPage 의 ?prefill 박제 — PWA Share Target 패턴 재사용)
//   2) 지식 등록  → /info?prefill=text&prefill_title=title (KnowledgePage prefill 처리, N+42 추가)
//   3) 정식 문서 → /docs?prefill_brief=text&prefill_brief_title=title (PostsPage prefill 처리, N+42 추가)
//   4) 외부 공유 → 부모 컴포넌트가 처리 (기존 QNoteShareModal 호출)
//
// 진입 시 PATCH /api/sessions/:id { mark_summarized: true } 자동 호출 — summarized_at 기록.

import React, { useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import { useEscapeStack } from '../../hooks/useEscapeStack';

interface Props {
  open: boolean;
  onClose: () => void;
  sessionId: number;
  sessionTitle: string;
  transcriptText: string;  // 트랜스크립트 본문 (utterance 들 합친 텍스트)
  qnoteApiBase?: string;   // q-note FastAPI base (default '/qnote/api')
  qnoteToken?: string;     // 인증 토큰
}

const QNoteSummaryModal: React.FC<Props> = ({ open, onClose, sessionId, sessionTitle, transcriptText, qnoteApiBase = '/qnote/api', qnoteToken }) => {
  const { t } = useTranslation('qnote');
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  useBodyScrollLock(open);
  useEscapeStack(open, onClose);

  if (!open) return null;

  const markSummarized = async () => {
    // PATCH /api/sessions/:id { mark_summarized: true } — summarized_at = NOW()
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (qnoteToken) headers.Authorization = `Bearer ${qnoteToken}`;
      await fetch(`${qnoteApiBase}/sessions/${sessionId}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ mark_summarized: true }),
      });
    } catch {
      // mark_summarized 실패 무시 — 사용자 흐름 차단 안 함
    }
  };

  const goTask = async () => {
    if (busy) return;
    setBusy(true);
    await markSummarized();
    const lines = [sessionTitle.trim(), '', transcriptText.trim()].join('\n').slice(0, 8000);
    navigate(`/tasks?prefill=${encodeURIComponent(lines)}`);
    onClose();
  };
  const goKnowledge = async () => {
    if (busy) return;
    setBusy(true);
    await markSummarized();
    const title = sessionTitle.slice(0, 200);
    const body = transcriptText.slice(0, 8000);
    navigate(`/info?prefill=${encodeURIComponent(body)}&prefill_title=${encodeURIComponent(title)}`);
    onClose();
  };
  const goDocs = async () => {
    if (busy) return;
    setBusy(true);
    await markSummarized();
    const title = sessionTitle.slice(0, 200);
    const text = transcriptText.slice(0, 8000);
    navigate(`/docs?prefill_brief=${encodeURIComponent(text)}&prefill_brief_title=${encodeURIComponent(title)}`);
    onClose();
  };
  return (
    <Backdrop onClick={onClose}>
      <Dialog onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={t('summary.title', '정리하기')}>
        <Head>
          <Title>{t('summary.title', '정리하기')}</Title>
          <Close type="button" onClick={onClose} aria-label="Close">×</Close>
        </Head>
        <Desc>{t('summary.desc', '이 회의/메모를 다른 형태로 변환합니다.')}</Desc>
        <Grid>
          <Action type="button" onClick={goTask} disabled={busy}>
            <Icon viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
            </Icon>
            <ActionLabel>{t('summary.actionTask', '업무 생성')}</ActionLabel>
            <ActionHint>{t('summary.actionTaskHint', 'Q Task 신규 등록 모달에 본문 prefill')}</ActionHint>
          </Action>
          <Action type="button" onClick={goKnowledge} disabled={busy}>
            <Icon viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" /><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
            </Icon>
            <ActionLabel>{t('summary.actionKnowledge', '지식 등록')}</ActionLabel>
            <ActionHint>{t('summary.actionKnowledgeHint', 'Q info 에 새 지식으로 저장')}</ActionHint>
          </Action>
          <Action type="button" onClick={goDocs} disabled={busy}>
            <Icon viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
            </Icon>
            <ActionLabel>{t('summary.actionDocs', '정식 문서 승격')}</ActionLabel>
            <ActionHint>{t('summary.actionDocsHint', 'Q docs 자료정리(Brief) 로 AI 가공')}</ActionHint>
          </Action>
          {/* N+88 — 공유 액션 제거: 공유는 헤더 단일 "공유" 버튼으로 일원화 (중복 제거) */}
        </Grid>
      </Dialog>
    </Backdrop>
  );
};

export default QNoteSummaryModal;

const Backdrop = styled.div`
  position: fixed; inset: 0;
  background: rgba(15, 23, 42, 0.45);
  display: flex; align-items: center; justify-content: center;
  z-index: 60; padding: 16px;
`;
const Dialog = styled.div`
  background: #FFFFFF;
  border-radius: 14px;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.18);
  width: min(560px, 100%);
  max-height: 90vh; overflow-y: auto;
  padding: 20px;
`;
const Head = styled.div`display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;`;
const Title = styled.h3`margin: 0; font-size: 18px; font-weight: 700; color: #0F172A;`;
const Close = styled.button`
  background: none; border: none; color: #94A3B8; font-size: 24px;
  cursor: pointer; padding: 0 4px;
  &:hover { color: #334155; }
`;
const Desc = styled.p`margin: 0 0 16px; font-size: 13px; color: #64748B;`;
const Grid = styled.div`
  display: grid; grid-template-columns: 1fr 1fr; gap: 12px;
  @media (max-width: 480px) { grid-template-columns: 1fr; }
`;
const Action = styled.button`
  display: flex; flex-direction: column; gap: 6px; align-items: flex-start;
  padding: 14px;
  border: 1px solid #E2E8F0; border-radius: 10px;
  background: #FFFFFF; color: #0F172A;
  text-align: left; cursor: pointer;
  transition: border 0.15s, background 0.15s, transform 0.1s;
  &:hover { border-color: #14B8A6; background: #F0FDFA; }
  &:active { transform: translateY(1px); }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
  &:focus-visible { outline: 2px solid rgba(20, 184, 166, 0.4); outline-offset: 2px; }
`;
const Icon = styled.svg`width: 22px; height: 22px; color: #0F766E; flex-shrink: 0;`;
const ActionLabel = styled.span`font-size: 14px; font-weight: 600; line-height: 1.3;`;
const ActionHint = styled.span`font-size: 12px; color: #64748B; line-height: 1.4;`;
