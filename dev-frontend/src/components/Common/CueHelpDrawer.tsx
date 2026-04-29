// Q helperer — PlanQ 사용법 안내 + 운영팀 피드백 (우측 floating drawer).
// Cue (워크스페이스 AI 팀원) 와는 별개 페르소나 — PlanQ 제품/플랫폼 안내 전담.
// 진입:
//   1) ⌘? (mac) / Ctrl+/ (win) 단축키 — 어디서든 토글
//   2) HelpDot 의 "Q helper 에 묻기" → window.dispatchEvent('cue:ask', { detail: { prefill } })
//   3) 우측 하단 floating 버튼 (피드백 탭으로 진입)
// 탭:
//   - guide: PlanQ 사용법·기능 안내 (LLM 답변, 마지막 5턴)
//   - feedback: 운영팀에 버그·개선·기능요청 제출 (POST /api/feedback)
import React, { useEffect, useRef, useState, useCallback } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';
import { apiFetch } from '../../contexts/AuthContext';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';

// 사이클 P7d — 채팅 모드 분리: qhelper(PlanQ 매뉴얼) / workspace(Cue, 워크스페이스 데이터)
// 'feedback' 은 별도 view (채팅 아닌 폼)
type Mode = 'qhelper' | 'workspace' | 'feedback';
type FeedbackCategory = 'bug' | 'improve' | 'feature' | 'other';

interface Turn {
  q: string;
  a: string;
  loading?: boolean;
  error?: string;
}

const CueHelpDrawer: React.FC = () => {
  const { t } = useTranslation('common');
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>('qhelper');
  const [input, setInput] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  // 피드백 모드 폼 상태
  const [fbCategory, setFbCategory] = useState<FeedbackCategory>('improve');
  const [fbPriority, setFbPriority] = useState<'normal' | 'high'>('normal');
  const [fbTitle, setFbTitle] = useState('');
  const [fbBody, setFbBody] = useState('');
  const [fbResultMsg, setFbResultMsg] = useState<string | null>(null);

  useBodyScrollLock(open);

  // 단축키 ⌘? / Ctrl+/
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().includes('MAC');
      const wantOpen = (isMac && e.metaKey && e.key === '?') || (!isMac && e.ctrlKey && e.key === '/');
      if (wantOpen) {
        e.preventDefault();
        setOpen(v => !v);
      }
      if (e.key === 'Escape' && open) {
        setOpen(false);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  // cue:ask 이벤트 listen
  useEffect(() => {
    const onAsk = (e: Event) => {
      const ce = e as CustomEvent<{ prefill?: string }>;
      const prefill = ce.detail?.prefill || '';
      setOpen(true);
      if (prefill) setInput(prefill);
    };
    window.addEventListener('cue:ask', onAsk as EventListener);
    return () => window.removeEventListener('cue:ask', onAsk as EventListener);
  }, []);

  // 열린 후 input focus
  useEffect(() => {
    if (open) {
      const tm = window.setTimeout(() => inputRef.current?.focus(), 100);
      return () => window.clearTimeout(tm);
    }
  }, [open]);

  // 답변 도착 시 자동 스크롤
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [turns]);

  const submit = useCallback(async () => {
    const q = input.trim();
    if (!q || submitting) return;
    setSubmitting(true);
    const turn: Turn = { q, a: '', loading: true };
    setTurns(prev => [...prev.slice(-4), turn]); // 최근 5턴 유지
    setInput('');
    try {
      const res = await apiFetch('/api/cue/help', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: q,
          mode,  // 'qhelper' | 'workspace' — 백엔드가 system prompt + 컨텍스트 격리
          page_context: {
            path: location.pathname,
            search: location.search || undefined,
          },
        }),
      });
      const j = await res.json();
      if (!res.ok || !j.success) throw new Error(j.message || 'Q helper error');
      setTurns(prev => prev.map((tn, i) => i === prev.length - 1 ? { ...tn, a: j.data.answer || '', loading: false } : tn));
    } catch (e) {
      setTurns(prev => prev.map((tn, i) => i === prev.length - 1
        ? { ...tn, error: e instanceof Error ? e.message : 'error', loading: false }
        : tn));
    } finally {
      setSubmitting(false);
    }
  }, [input, submitting, location]);

  // 피드백 제출 (자동 메타: page_url, user_agent)
  const submitFeedback = useCallback(async () => {
    if (!fbTitle.trim() || !fbBody.trim() || submitting) return;
    setSubmitting(true);
    setFbResultMsg(null);
    try {
      const res = await apiFetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: fbCategory,
          priority: fbPriority,
          title: fbTitle.trim(),
          body: fbBody.trim(),
          page_url: location.pathname + (location.search || ''),
        }),
      });
      const j = await res.json();
      if (!res.ok || !j.success) throw new Error(j.message || 'feedback error');
      setFbResultMsg(t('qhelper.fbThanks', '접수됐습니다 #{{id}} — 빠르게 검토할게요', { id: j.data?.id }) as string);
      setFbTitle('');
      setFbBody('');
      setFbCategory('improve');
      setFbPriority('normal');
      window.setTimeout(() => setFbResultMsg(null), 6000);
    } catch (e) {
      setFbResultMsg(t('qhelper.fbErr', '제출 실패: {{msg}}', { msg: e instanceof Error ? e.message : 'error' }) as string);
    } finally {
      setSubmitting(false);
    }
  }, [fbCategory, fbPriority, fbTitle, fbBody, submitting, location, t]);

  return (
    <>
      {!open && (
        <FloatingTrigger
          type="button"
          onClick={() => { setMode('qhelper'); setOpen(true); }}
          aria-label={t('qhelper.openFloating', 'Q helper — 사용 안내 + 피드백') as string}
          title={t('qhelper.openFloating', 'Q helper — 사용 안내 + 피드백') as string}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
        </FloatingTrigger>
      )}
      {open && <>
      <Backdrop onClick={() => setOpen(false)} />
      <Drawer ref={drawerRef} role="dialog" aria-label={t('qhelper.title', 'Q helper') as string}>
        <Header>
          <HeaderTitle>
            <Sparkle aria-hidden $cue={mode === 'workspace'}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 16.8 5.8 21.3l2.4-7.4L2 9.4h7.6L12 2z"/></svg>
            </Sparkle>
            <span>
              {mode === 'feedback' ? t('qhelper.fbHeaderTitle', '피드백 보내기') :
               mode === 'workspace' ? t('qhelper.cueTitle', 'Cue · 내 워크스페이스') :
               t('qhelper.title', 'Q helper')}
            </span>
          </HeaderTitle>
          <HeaderActions>
            {mode !== 'feedback' ? (
              <FeedbackEnter type="button" onClick={() => setMode('feedback')}>
                {t('qhelper.openFeedbackBtn', '피드백 보내기')}
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
              </FeedbackEnter>
            ) : (
              <BackToGuide type="button" onClick={() => setMode('qhelper')}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
                {t('qhelper.backToGuide', '안내로 돌아가기')}
              </BackToGuide>
            )}
            <CloseBtn type="button" onClick={() => setOpen(false)} aria-label={t('cancel', '닫기') as string}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </CloseBtn>
          </HeaderActions>
        </Header>
        {mode !== 'feedback' && (
          <ModeSwitch role="tablist">
            <ModeBtn type="button" $active={mode === 'qhelper'} $variant="qhelper"
              onClick={() => { setMode('qhelper'); setTurns([]); }} role="tab" aria-selected={mode === 'qhelper'}>
              <ModeDot $variant="qhelper" />
              {t('qhelper.modeQhelper', 'PlanQ 안내')}
            </ModeBtn>
            <ModeBtn type="button" $active={mode === 'workspace'} $variant="workspace"
              onClick={() => { setMode('workspace'); setTurns([]); }} role="tab" aria-selected={mode === 'workspace'}>
              <ModeDot $variant="workspace" />
              {t('qhelper.modeWorkspace', 'Cue · 내 워크스페이스')}
            </ModeBtn>
          </ModeSwitch>
        )}
        {mode === 'qhelper' && turns.length === 0 && (
          <QuickChips>
            {[
              { v: 'usage', label: t('qhelper.quickUsage', '사용법') },
              { v: 'bug', label: t('qhelper.quickBug', '오류·버그') },
              { v: 'plan', label: t('qhelper.quickPlan', '결제·플랜') },
              { v: 'security', label: t('qhelper.quickSecurity', '보안·권한') },
            ].map(c => (
              <QuickChip key={c.v} type="button" onClick={() => setInput(`[${c.label}] `)}>
                {c.label}
              </QuickChip>
            ))}
          </QuickChips>
        )}
        {mode === 'workspace' && turns.length === 0 && (
          <QuickChips>
            {[
              { v: 'tasks', label: t('qhelper.cueQuickTasks', '내 업무') },
              { v: 'clients', label: t('qhelper.cueQuickClients', '고객') },
              { v: 'schedule', label: t('qhelper.cueQuickSchedule', '일정') },
              { v: 'docs', label: t('qhelper.cueQuickDocs', '문서') },
            ].map(c => (
              <QuickChip key={c.v} type="button" onClick={() => setInput(`[${c.label}] `)}>
                {c.label}
              </QuickChip>
            ))}
          </QuickChips>
        )}
        {mode === 'feedback' && (
          <FeedbackPitch>
            {t('qhelper.fbPitch', 'PlanQ 가 더 좋아지도록 의견을 남겨주세요. 모든 제안을 검토합니다.')}
          </FeedbackPitch>
        )}
        <Body ref={bodyRef}>
          {(mode === 'qhelper' || mode === 'workspace') && (
            turns.length === 0 ? (
              <Empty>
                <EmptyTitle>
                  {mode === 'workspace' ? t('qhelper.cueEmptyTitle', '내 워크스페이스에 대해 무엇이든') : t('qhelper.emptyTitle', '무엇이 궁금한가요?')}
                </EmptyTitle>
                <EmptyHint>
                  {mode === 'workspace'
                    ? t('qhelper.cueEmptyHint', '현재 워크스페이스의 고객·업무·일정·회의를 기반으로 답변합니다. 다른 워크스페이스 데이터는 보지 않습니다.')
                    : t('qhelper.emptyHint', 'PlanQ 의 사용법·기능을 자연어로 물어보세요. 현재 화면 컨텍스트를 읽고 답변합니다.')}
                </EmptyHint>
                <EmptyShortcut>
                  <kbd>⌘</kbd> <kbd>?</kbd> {t('qhelper.toggleHint', '로 언제든 열고 닫기')}
                </EmptyShortcut>
              </Empty>
            ) : (
              turns.map((tn, i) => (
                <TurnRow key={i}>
                  <Q>
                    <QuLabel>{t('qhelper.you', '나')}</QuLabel>
                    <QText>{tn.q}</QText>
                  </Q>
                  <A $variant={mode === 'workspace' ? 'workspace' : 'qhelper'}>
                    <ALabel $variant={mode === 'workspace' ? 'workspace' : 'qhelper'}>
                      {mode === 'workspace' ? t('qhelper.cueLabel', 'Cue') : t('qhelper.guideLabel', 'Q helper')}
                    </ALabel>
                    {tn.loading
                      ? <Loading>{t('qhelper.thinking', '생각 중…')}</Loading>
                      : tn.error
                        ? <ErrorText>{tn.error}</ErrorText>
                        : <Answer>{tn.a}</Answer>}
                  </A>
                </TurnRow>
              ))
            )
          )}
          {mode === 'feedback' && (
            <FbForm>
              <FbField>
                <FbLabel>{t('qhelper.fbCategory', '분류')}</FbLabel>
                <FbCatRow>
                  {(['bug', 'improve', 'feature', 'other'] as FeedbackCategory[]).map(c => (
                    <FbCatBtn
                      key={c} type="button"
                      $active={fbCategory === c}
                      onClick={() => setFbCategory(c)}
                    >
                      {t(`qhelper.fbCat.${c}`)}
                    </FbCatBtn>
                  ))}
                </FbCatRow>
              </FbField>
              <FbField>
                <FbLabel>{t('qhelper.fbTitle', '제목')}</FbLabel>
                <FbInput
                  value={fbTitle}
                  onChange={e => setFbTitle(e.target.value)}
                  placeholder={t('qhelper.fbTitlePh', '한 줄 요약') as string}
                  maxLength={200}
                />
              </FbField>
              <FbField>
                <FbLabel>{t('qhelper.fbBody', '내용')}</FbLabel>
                <FbTextArea
                  value={fbBody}
                  onChange={e => setFbBody(e.target.value)}
                  placeholder={t('qhelper.fbBodyPh', '구체적으로 적어주시면 빠르게 반영할 수 있습니다.\n예) 어디서 / 무엇이 / 어떻게 되었으면') as string}
                  rows={5}
                />
              </FbField>
              <FbCheck>
                <input
                  type="checkbox"
                  id="fb-urgent"
                  checked={fbPriority === 'high'}
                  onChange={e => setFbPriority(e.target.checked ? 'high' : 'normal')}
                />
                <label htmlFor="fb-urgent">{t('qhelper.fbUrgent', '긴급 (서비스 사용 불가 등)')}</label>
              </FbCheck>
              <FbMeta>
                <FbMetaLabel>{t('qhelper.fbMeta', '자동으로 함께 전송')}:</FbMetaLabel>
                <FbMetaValue>{location.pathname}{location.search}</FbMetaValue>
              </FbMeta>
              {fbResultMsg && <FbResult>{fbResultMsg}</FbResult>}
            </FbForm>
          )}
        </Body>
        <Footer>
          {mode !== 'feedback' ? (
            <>
              <InputArea
                ref={inputRef}
                value={input}
                placeholder={mode === 'workspace'
                  ? t('qhelper.cueInputPh', '내 워크스페이스에 대해 묻기 (Cmd/Ctrl + Enter)') as string
                  : t('qhelper.inputPh', '질문을 입력하세요 (Cmd/Ctrl + Enter 로 보내기)') as string}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    submit();
                  }
                }}
                rows={2}
              />
              <SendBtn type="button" onClick={submit} disabled={submitting || !input.trim()}>
                {submitting ? t('qhelper.sending', '전송 중…') : t('qhelper.send', '보내기')}
              </SendBtn>
            </>
          ) : (
            <FbSendBtn type="button" onClick={submitFeedback} disabled={submitting || !fbTitle.trim() || !fbBody.trim()}>
              {submitting ? t('qhelper.fbSending', '제출 중…') : t('qhelper.fbSend', '제출')}
            </FbSendBtn>
          )}
        </Footer>
      </Drawer>
      </>}
    </>
  );
};

export default CueHelpDrawer;

// ─── styled ───
const Backdrop = styled.div`
  position: fixed; inset: 0;
  background: rgba(15, 23, 42, 0.30);
  z-index: 1000;
`;
const Drawer = styled.div`
  position: fixed; top: 0; right: 0; bottom: 0;
  width: 440px;
  background: #FFFFFF;
  border-left: 1px solid #E2E8F0;
  box-shadow: -8px 0 32px rgba(15, 23, 42, 0.10);
  z-index: 1001;
  display: flex; flex-direction: column;
  animation: cueSlideIn 0.2s ease-out;
  @keyframes cueSlideIn { from { transform: translateX(100%); } to { transform: translateX(0); } }
  @media (max-width: 1024px) { width: min(440px, 90vw); }
  @media (max-width: 640px) {
    width: 100vw;
    border-left: none;
    box-shadow: none;
    padding-bottom: env(safe-area-inset-bottom);
  }
`;
const Header = styled.div`
  flex-shrink: 0;
  height: 56px;
  padding: 0 16px;
  display: flex; align-items: center; justify-content: space-between;
  border-bottom: 1px solid #E2E8F0;
`;
const HeaderTitle = styled.div`
  display: inline-flex; align-items: center; gap: 8px;
  font-size: 14px; font-weight: 700; color: #0F172A;
`;
const Sparkle = styled.span<{ $cue?: boolean }>`
  display: inline-flex;
  color: ${p => p.$cue ? '#F43F5E' : '#0D9488'};
`;
const CloseBtn = styled.button`
  width: 32px; height: 32px;
  display: inline-flex; align-items: center; justify-content: center;
  background: transparent; border: none; border-radius: 8px;
  color: #64748B; cursor: pointer;
  &:hover { background: #F1F5F9; color: #0F172A; }
`;
const Body = styled.div`
  flex: 1; overflow-y: auto;
  padding: 16px;
`;
const Empty = styled.div`
  text-align: center; padding: 40px 20px;
`;
const EmptyTitle = styled.h4`
  font-size: 14px; font-weight: 700; color: #0F172A;
  margin: 0 0 6px;
`;
const EmptyHint = styled.p`
  font-size: 13px; color: #64748B;
  margin: 0 0 16px; line-height: 1.55;
`;
const EmptyShortcut = styled.div`
  font-size: 12px; color: #94A3B8;
  display: inline-flex; align-items: center; gap: 4px;
  kbd {
    display: inline-flex; align-items: center; justify-content: center;
    min-width: 22px; height: 22px; padding: 0 6px;
    background: #F1F5F9; border: 1px solid #E2E8F0; border-radius: 4px;
    font-family: inherit; font-size: 11px; font-weight: 600; color: #334155;
  }
`;
const TurnRow = styled.div`
  margin-bottom: 16px;
  display: flex; flex-direction: column; gap: 6px;
`;
const Q = styled.div`
  display: flex; flex-direction: column; gap: 2px;
  padding: 8px 10px;
  background: #F8FAFC;
  border-radius: 8px;
`;
const QuLabel = styled.span`
  font-size: 10px; font-weight: 700; color: #94A3B8;
  text-transform: uppercase; letter-spacing: 0.4px;
`;
const QText = styled.span`
  font-size: 13px; color: #0F172A; line-height: 1.55;
  white-space: pre-wrap; word-break: break-word;
`;
const A = styled.div<{ $variant?: 'qhelper' | 'workspace' }>`
  display: flex; flex-direction: column; gap: 4px;
  background: ${p => p.$variant === 'workspace' ? '#FFF1F2' : '#F0FDFA'};
  border-left: 3px solid ${p => p.$variant === 'workspace' ? '#F43F5E' : '#14B8A6'};
  border-radius: 0 8px 8px 0;
  padding: 10px 12px;
`;
const ALabel = styled.span<{ $variant?: 'qhelper' | 'workspace' }>`
  font-size: 10px; font-weight: 700;
  color: ${p => p.$variant === 'workspace' ? '#9F1239' : '#0D9488'};
  text-transform: uppercase; letter-spacing: 0.4px;
`;
const Answer = styled.div`
  font-size: 13px; color: #0F172A; line-height: 1.55;
  white-space: pre-wrap;
  flex: 1;
`;
const Loading = styled.span`
  font-size: 13px; color: #64748B; font-style: italic;
`;
const ErrorText = styled.span`
  font-size: 13px; color: #DC2626;
`;
const Footer = styled.div`
  flex-shrink: 0;
  padding: 12px 16px;
  border-top: 1px solid #E2E8F0;
  display: flex; gap: 8px; align-items: flex-end;
`;
const InputArea = styled.textarea`
  flex: 1;
  resize: none;
  border: 1px solid #E2E8F0;
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 13px; font-family: inherit;
  color: #0F172A;
  &:focus {
    outline: none;
    border-color: #14B8A6;
    box-shadow: 0 0 0 3px rgba(20,184,166,0.15);
  }
`;
const SendBtn = styled.button`
  flex-shrink: 0;
  padding: 8px 14px;
  background: #14B8A6;
  color: #FFFFFF;
  border: none; border-radius: 8px;
  font-size: 13px; font-weight: 600;
  cursor: pointer;
  height: 36px;
  transition: background 0.15s;
  &:hover { background: #0D9488; }
  &:disabled { background: #CBD5E1; cursor: not-allowed; }
`;
// ─── 헤더 액션 (피드백 진입 / 안내로 돌아가기) ───
const HeaderActions = styled.div`
  display: inline-flex; align-items: center; gap: 4px;
`;
const FeedbackEnter = styled.button`
  all: unset; cursor: pointer;
  display: inline-flex; align-items: center; gap: 4px;
  padding: 6px 10px;
  background: #FFF1F2; color: #9F1239;
  border-radius: 999px;
  font-size: 12px; font-weight: 600;
  transition: all 0.15s;
  &:hover { background: #FECDD3; }
`;
const BackToGuide = styled.button`
  all: unset; cursor: pointer;
  display: inline-flex; align-items: center; gap: 4px;
  padding: 6px 10px;
  background: #F1F5F9; color: #475569;
  border-radius: 999px;
  font-size: 12px; font-weight: 600;
  transition: all 0.15s;
  &:hover { background: #E2E8F0; }
`;
// ─── 모드 토글 (qhelper / workspace) ───
const ModeSwitch = styled.div`
  flex-shrink: 0;
  display: flex; gap: 4px;
  padding: 8px 12px;
  background: #F8FAFC;
  border-bottom: 1px solid #E2E8F0;
`;
const ModeBtn = styled.button<{ $active: boolean; $variant: 'qhelper' | 'workspace' }>`
  all: unset; cursor: pointer;
  display: inline-flex; align-items: center; gap: 6px;
  padding: 6px 12px; border-radius: 999px;
  font-size: 12px; font-weight: 600;
  transition: all 0.15s;
  ${p => p.$active && p.$variant === 'qhelper' && 'background: #FFFFFF; color: #0F766E; border: 1px solid #14B8A6;'}
  ${p => p.$active && p.$variant === 'workspace' && 'background: #FFFFFF; color: #9F1239; border: 1px solid #F43F5E;'}
  ${p => !p.$active && 'background: transparent; color: #64748B;'}
  &:hover { background: ${p => p.$active ? '#FFFFFF' : '#FFFFFF99'}; }
`;
const ModeDot = styled.span<{ $variant: 'qhelper' | 'workspace' }>`
  width: 6px; height: 6px; border-radius: 50%;
  background: ${p => p.$variant === 'workspace' ? '#F43F5E' : '#14B8A6'};
  flex-shrink: 0;
`;
// ─── 빠른 분류 칩 (채팅 시작 전 의도 빠른 지정) ───
const QuickChips = styled.div`
  flex-shrink: 0;
  padding: 12px 16px;
  display: flex; flex-wrap: wrap; gap: 6px;
  border-bottom: 1px solid #F1F5F9;
`;
const QuickChip = styled.button`
  all: unset; cursor: pointer;
  padding: 4px 10px; border-radius: 999px;
  background: #F8FAFC; border: 1px solid #E2E8F0;
  font-size: 12px; font-weight: 500; color: #475569;
  transition: all 0.15s;
  &:hover { background: #F0FDFA; border-color: #14B8A6; color: #0F766E; }
`;
const FeedbackPitch = styled.div`
  flex-shrink: 0;
  padding: 12px 16px;
  background: #FFF1F2;
  border-bottom: 1px solid #FECDD3;
  font-size: 12.5px; color: #9F1239;
  line-height: 1.55;
`;
// ─── 피드백 폼 ───
const FbForm = styled.div`
  display: flex; flex-direction: column; gap: 14px;
`;
const FbField = styled.div`
  display: flex; flex-direction: column; gap: 6px;
`;
const FbLabel = styled.label`
  font-size: 12px; font-weight: 700; color: #475569;
`;
const FbCatRow = styled.div`
  display: flex; gap: 6px; flex-wrap: wrap;
`;
const FbCatBtn = styled.button<{ $active: boolean }>`
  all: unset; cursor: pointer;
  padding: 6px 12px; border-radius: 999px;
  font-size: 12px; font-weight: 600;
  background: ${p => p.$active ? '#F43F5E' : '#F1F5F9'};
  color: ${p => p.$active ? '#FFFFFF' : '#475569'};
  transition: all 0.15s;
  &:hover { background: ${p => p.$active ? '#E11D48' : '#E2E8F0'}; }
`;
const FbInput = styled.input`
  height: 36px; padding: 0 10px;
  border: 1px solid #E2E8F0; border-radius: 8px;
  font-size: 13px; color: #0F172A;
  &:focus { outline: none; border-color: #F43F5E; box-shadow: 0 0 0 3px rgba(244,63,94,0.15); }
`;
const FbTextArea = styled.textarea`
  padding: 10px 12px;
  border: 1px solid #E2E8F0; border-radius: 8px;
  font-size: 13px; color: #0F172A;
  font-family: inherit; resize: vertical;
  &:focus { outline: none; border-color: #F43F5E; box-shadow: 0 0 0 3px rgba(244,63,94,0.15); }
`;
const FbCheck = styled.div`
  display: flex; align-items: center; gap: 8px;
  font-size: 13px; color: #475569;
  input { width: 16px; height: 16px; accent-color: #F43F5E; cursor: pointer; }
  label { cursor: pointer; }
`;
const FbMeta = styled.div`
  display: flex; align-items: center; gap: 8px;
  padding: 8px 10px;
  background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 6px;
  font-size: 11px;
`;
const FbMetaLabel = styled.span`color: #64748B; font-weight: 600; flex-shrink: 0;`;
const FbMetaValue = styled.span`
  color: #334155; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  word-break: break-all; min-width: 0;
`;
const FbResult = styled.div`
  padding: 10px 12px;
  background: #F0FDFA; border: 1px solid #5EEAD4; border-radius: 8px;
  font-size: 13px; color: #0F766E;
`;
const FbSendBtn = styled.button`
  width: 100%;
  padding: 10px 14px;
  background: #F43F5E;
  color: #FFFFFF;
  border: none; border-radius: 8px;
  font-size: 13px; font-weight: 700;
  cursor: pointer;
  height: 40px;
  transition: background 0.15s;
  &:hover:not(:disabled) { background: #E11D48; }
  &:disabled { background: #CBD5E1; cursor: not-allowed; }
`;
// ─── 우측 하단 floating 진입 버튼 (전역) ───
const FloatingTrigger = styled.button`
  position: fixed; right: 20px; bottom: 20px;
  width: 52px; height: 52px;
  display: inline-flex; align-items: center; justify-content: center;
  background: #F43F5E;
  color: #FFFFFF;
  border: none; border-radius: 50%;
  box-shadow: 0 4px 16px rgba(244,63,94,0.30);
  cursor: pointer;
  z-index: 900;
  transition: transform 0.15s, background 0.15s;
  &:hover { background: #E11D48; transform: translateY(-1px); }
  &:focus-visible { outline: 2px solid rgba(244,63,94,0.5); outline-offset: 4px; }
  @media (max-width: 640px) {
    right: 16px; bottom: 16px;
    width: 48px; height: 48px;
  }
`;
