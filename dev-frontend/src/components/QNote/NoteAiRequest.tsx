// Q note «AI 추가 요청» — 기본 요약 아래에서 녹취·메모를 원하는 모양으로 가공한다 (2026-11-20).
//
// Irene: *"Q note에서 녹음하거나 저장한 내용을 요약할 때 AI로 가공해서 만들어 낼 수 있게 해줘. 메일에 답변 작성하는 것처럼.
//         기본 요약기능 두고, 추가로 ai 추가요청 기능 나오게."*
//
// - 기본 요약(■ 결정·할 일…)은 건드리지 않는다. 결과는 노트에 따로 한 건 남는다(sessions.ai_request_*).
// - 흐름은 메일 답장 AI 요청과 같다 — 입력 바는 같은 컴포넌트(MailAiBar · Cue 바 껍데기)를 쓴다.
//   결과가 없으면 «이렇게 만들어 줘», 결과가 있으면 «이 결과를 이렇게 고쳐 줘»(지금 결과를 같이 보낸다).
//   처음부터 다시 하려면 [새로 요청] — 결과를 비운다.
// - 같은 컴포넌트를 음성 노트(QNotePage 요약 칸)와 메모(MemoView 요약 패널)가 같이 쓴다. 대상이 바뀌면 부모가 key 로 가른다.
import { useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import MailAiBar from '../../pages/QMail/MailAiBar';
import { CORAL } from '../Common/cueBarShell';
import { generateNoteAiRequest, clearNoteAiRequest } from '../../services/qnote';
import { copyRichContent } from '../../utils/copyRich';

export interface NoteAiRequestValue {
  ai_request_text?: string | null;
  ai_request_result?: string | null;
  ai_request_at?: string | null;
}

interface Props {
  sessionId: number;
  value: NoteAiRequestValue;
  /** 가공할 원문(녹취 줄 또는 메모 평문). 비면 안내만 한다. */
  getText: () => string;
  /** 기본 요약 전문 — 있으면 참고로 같이 보낸다(원문이 이긴다) */
  summary?: string | null;
  onChange: (next: NoteAiRequestValue) => void;
  /** 결과를 문서로 저장 — 없으면 버튼을 안 보인다 */
  onSaveDoc?: () => void;
  docSaved?: boolean;
  savingDoc?: boolean;
  onViewDoc?: () => void;
  emptyTextMsg: string;
  /** 만들기·다듬기·지우기는 노트 생성자만(서버 403 과 같은 선). 아니면 결과만 읽기. */
  canRequest: boolean;
}

const ERROR_KEYS: Record<string, string> = {
  ai_unavailable: 'aiRequest.errUnavailable',
  ai_empty: 'aiRequest.errEmpty',
  empty_transcript: 'aiRequest.errEmptySource',
  session_not_found: 'aiRequest.errFailed',
  forbidden: 'aiRequest.errForbidden',
};

export default function NoteAiRequest({
  sessionId, value, getText, summary, onChange, onSaveDoc, docSaved, savingDoc, onViewDoc, emptyTextMsg, canRequest,
}: Props) {
  const { t } = useTranslation('qnote');
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  // 기다리는 사이 다른 노트로 옮기면(부모가 key 로 이 칸을 버린다) 늦게 온 결과를 새 노트 화면에 얹지 않는다 — 서버엔 이미 남았다.
  const aliveRef = useRef(true);
  useEffect(() => () => { aliveRef.current = false; }, []);
  const result = value.ai_request_result || '';
  const hasResult = !!result.trim();

  const errText = (e: unknown) => {
    const code = (e as Error)?.message || '';
    return t(ERROR_KEYS[code] || 'aiRequest.errFailed') as string;
  };

  const run = async (instructionArg?: string) => {
    const instruction = (instructionArg ?? input).trim();
    if (busy || !instruction) return;
    const text = getText().trim();
    if (!text) { setError(emptyTextMsg); return; }
    setBusy(true);
    setError(null);
    try {
      const r = await generateNoteAiRequest({
        sessionId, transcript: text, instruction,
        currentResult: hasResult ? result : null,
        summary: summary || null,
      });
      if (!aliveRef.current) return;
      onChange({ ai_request_text: r.request, ai_request_result: r.result, ai_request_at: r.at });
      setInput('');
      setCopied(false);
    } catch (e) {
      if (!aliveRef.current) return;
      setError(errText(e));
      window.setTimeout(() => inputRef.current?.focus(), 0);
    } finally {
      if (aliveRef.current) setBusy(false);
    }
  };

  const reset = async () => {
    if (busy) return;
    setError(null);
    try {
      await clearNoteAiRequest(sessionId);
      onChange({ ai_request_text: null, ai_request_result: null, ai_request_at: null });
      setCopied(false);
      window.setTimeout(() => inputRef.current?.focus(), 0);
    } catch (e) {
      setError(errText(e));
    }
  };

  const copy = async () => {
    const ok = await copyRichContent({ text: result });
    setCopied(ok);
    if (ok) window.setTimeout(() => setCopied(false), 2000);
  };

  const examples = [
    t('aiRequest.ex1', '고객에게 보낼 회의 정리 메일로 써 줘'),
    t('aiRequest.ex2', '상사 보고용으로 5줄 안에 정리'),
    t('aiRequest.ex3', '결정 사항과 할 일만 표로'),
    t('aiRequest.ex4', '영어로 번역해 줘'),
  ] as string[];

  // 남의 노트(공개 범위로 열린 것)에서 결과도 없으면 칸 자체를 안 보인다 — 할 수 있는 것이 없다.
  if (!canRequest && !hasResult) return null;

  return (
    <Wrap data-testid="qnote-ai-request">
      <Head>
        <Title>{t('aiRequest.title', 'AI 추가 요청')}</Title>
        {hasResult && (
          <Actions>
            <Btn type="button" onClick={copy} data-testid="qnote-ai-request-copy">
              {copied ? t('aiRequest.copied', '복사됨') : t('aiRequest.copy', '복사')}
            </Btn>
            {onSaveDoc && (docSaved ? (
              <SavedRow>
                <SavedText>{t('page.summary.savedDoc', '문서 저장됨')}</SavedText>
                {onViewDoc && <LinkBtn type="button" onClick={onViewDoc}>{t('page.summary.viewDoc', '보기')}</LinkBtn>}
              </SavedRow>
            ) : (
              <Btn type="button" onClick={onSaveDoc} disabled={savingDoc} data-testid="qnote-ai-request-save-doc">
                {savingDoc ? t('page.summary.savingDoc', '저장 중...') : t('page.summary.saveDoc', '문서로 저장')}
              </Btn>
            ))}
            {canRequest && (
              <Btn type="button" onClick={reset} disabled={busy} data-testid="qnote-ai-request-reset">
                {t('aiRequest.reset', '새로 요청')}
              </Btn>
            )}
          </Actions>
        )}
      </Head>
      {canRequest && (
      <MailAiBar
        testId="qnote-ai-request-bar"
        inputRef={inputRef}
        value={input}
        onChange={setInput}
        onSubmit={() => { void run(); }}
        busy={busy}
        placeholder={(hasResult
          ? t('aiRequest.refinePh', '결과를 어떻게 고칠까요? (예: 더 짧게 · 더 정중하게 · 가격 강조) · Enter')
          : t('aiRequest.newPh', '요약 말고 다른 모양이 필요하면 AI 에게 요청하세요 (예: 고객에게 보낼 메일로) · Enter')) as string}
        ariaLabel={t('aiRequest.label', 'AI 추가 요청') as string}
        sendLabel={(hasResult ? t('aiRequest.refine', 'AI 로 다듬기') : t('aiRequest.send', 'AI 로 만들기')) as string}
      />
      )}
      {canRequest && !hasResult && !busy && (
        <Chips>
          {examples.map((ex) => (
            <Chip key={ex} type="button" onClick={() => { setInput(ex); inputRef.current?.focus(); }}>{ex}</Chip>
          ))}
        </Chips>
      )}
      {busy && (
        <Working role="status" data-testid="qnote-ai-request-working">
          <Dot aria-hidden />
          {hasResult ? t('aiRequest.refining', 'AI 가 결과를 다듬는 중이에요…') : t('aiRequest.working', 'AI 가 만드는 중이에요…')}
        </Working>
      )}
      {error && <Err role="alert">{error}</Err>}
      {hasResult && (
        <ResultBox>
          {value.ai_request_text && (
            <ReqLine>{t('aiRequest.lastRequest', '마지막 요청')}: {value.ai_request_text}</ReqLine>
          )}
          <ResultText data-testid="qnote-ai-request-result">{result}</ResultText>
        </ResultBox>
      )}
    </Wrap>
  );
}

// 값은 QNotePage 요약 칸(SummaryHeadTitle·SummaryRegenBtn·SummaryFull)과 같다 — 요약 바로 아래에 붙어 한 칸처럼 보인다.
const Wrap = styled.div`
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px dashed #E2E8F0;
  display: flex;
  flex-direction: column;
  gap: 8px;
`;
const Head = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
`;
const Title = styled.h4`
  margin: 0;
  font-size: 0.8125rem;
  font-weight: 700;
  color: #0F172A;
  letter-spacing: -0.2px;
  display: flex;
  align-items: center;
  gap: 8px;
  &::before {
    content: '';
    width: 3px;
    height: 0.875rem;
    background: ${CORAL};
    border-radius: 2px;
  }
`;
const Actions = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
`;
const Btn = styled.button`
  border: 1px solid #E2E8F0;
  background: #FFFFFF;
  color: #475569;
  font-size: 0.75rem;
  font-weight: 600;
  padding: 6px 12px;
  min-height: 32px;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.15s ease;
  &:hover:not(:disabled) { border-color: #CBD5E1; background: #F8FAFC; }
  &:disabled { opacity: 0.5; cursor: default; }
`;
const SavedRow = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 8px;
`;
const SavedText = styled.span`
  font-size: 0.75rem;
  font-weight: 600;
  color: #0F766E;
`;
const LinkBtn = styled.button`
  border: none;
  background: transparent;
  color: #0D9488;
  font-size: 0.75rem;
  font-weight: 600;
  text-decoration: underline;
  cursor: pointer;
  padding: 0;
`;
const Chips = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
`;
const Chip = styled.button`
  border: 1px solid #E2E8F0;
  background: #FFFFFF;
  color: #475569;
  font-size: 0.75rem;
  padding: 4px 10px;
  min-height: 32px;
  border-radius: 999px;
  cursor: pointer;
  &:hover { border-color: #FDA4AF; color: #BE123C; }
`;
const Working = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.75rem;
  color: #64748B;
`;
const Dot = styled.span`
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: ${CORAL};
  animation: qnAiPulse 1s ease-in-out infinite;
  @keyframes qnAiPulse { 0%, 100% { opacity: 0.3; } 50% { opacity: 1; } }
`;
const Err = styled.div`
  font-size: 0.75rem;
  color: #B91C1C;
`;
const ResultBox = styled.div`
  background: #FFFFFF;
  border: 1px solid #E2E8F0;
  border-radius: 10px;
  padding: 12px 14px;
`;
const ReqLine = styled.div`
  font-size: 0.75rem;
  color: #64748B;
  margin-bottom: 8px;
  word-break: break-word;
`;
const ResultText = styled.div`
  font-size: 0.8125rem;
  line-height: 1.7;
  color: #334155;
  white-space: pre-wrap;
  word-break: break-word;
`;
