// CueHelpDrawer — PlanQ 글로벌 Cue 도움말 챗 (우측 floating drawer).
// 진입:
//   1) ⌘? (mac) / Ctrl+/ (win) 단축키
//   2) HelpDot 의 "Cue 에게 묻기" → window.dispatchEvent('cue:ask', { detail: { prefill } })
//   3) EmptyState 의 보조 CTA → 동일 이벤트
// 30년차 UX:
//   - ESC 닫기 / 외부 클릭 닫기 / 단축키 토글
//   - 마지막 5턴 만 메모리 (인지 부담 0)
//   - 답변은 마크다운 X (LLM 응답 system prompt 가 짧게 강제)
import React, { useEffect, useRef, useState, useCallback } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';
import { apiFetch } from '../../contexts/AuthContext';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';

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
  const [input, setInput] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

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
          page_context: {
            path: location.pathname,
            search: location.search || undefined,
          },
        }),
      });
      const j = await res.json();
      if (!res.ok || !j.success) throw new Error(j.message || 'Cue error');
      setTurns(prev => prev.map((tn, i) => i === prev.length - 1 ? { ...tn, a: j.data.answer || '', loading: false } : tn));
    } catch (e) {
      setTurns(prev => prev.map((tn, i) => i === prev.length - 1
        ? { ...tn, error: e instanceof Error ? e.message : 'error', loading: false }
        : tn));
    } finally {
      setSubmitting(false);
    }
  }, [input, submitting, location]);

  if (!open) return null;
  return (
    <>
      <Backdrop onClick={() => setOpen(false)} />
      <Drawer ref={drawerRef} role="dialog" aria-label={t('cue.title', 'Cue 도움말') as string}>
        <Header>
          <HeaderTitle>
            <Sparkle aria-hidden>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 16.8 5.8 21.3l2.4-7.4L2 9.4h7.6L12 2z"/></svg>
            </Sparkle>
            <span>{t('cue.title', 'Cue 도움말')}</span>
          </HeaderTitle>
          <CloseBtn type="button" onClick={() => setOpen(false)} aria-label={t('cancel', '닫기') as string}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </CloseBtn>
        </Header>
        <Body ref={bodyRef}>
          {turns.length === 0 ? (
            <Empty>
              <EmptyTitle>{t('cue.emptyTitle', '무엇이 궁금한가요?')}</EmptyTitle>
              <EmptyHint>{t('cue.emptyHint', 'PlanQ 의 어떤 기능이든 자연어로 물어보세요. 현재 화면 컨텍스트를 읽고 답변합니다.')}</EmptyHint>
              <EmptyShortcut>
                <kbd>⌘</kbd> <kbd>?</kbd> {t('cue.toggleHint', '로 언제든 열고 닫기')}
              </EmptyShortcut>
            </Empty>
          ) : (
            turns.map((tn, i) => (
              <TurnRow key={i}>
                <Q><QuLabel>{t('cue.you', '나')}</QuLabel><span>{tn.q}</span></Q>
                <A>
                  <ALabel>Cue</ALabel>
                  {tn.loading
                    ? <Loading>{t('cue.thinking', '생각 중…')}</Loading>
                    : tn.error
                      ? <ErrorText>{tn.error}</ErrorText>
                      : <Answer>{tn.a}</Answer>}
                </A>
              </TurnRow>
            ))
          )}
        </Body>
        <Footer>
          <InputArea
            ref={inputRef}
            value={input}
            placeholder={t('cue.inputPh', '질문을 입력하세요 (Cmd/Ctrl + Enter 로 보내기)') as string}
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
            {submitting ? t('cue.sending', '전송 중…') : t('cue.send', '보내기')}
          </SendBtn>
        </Footer>
      </Drawer>
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
const Sparkle = styled.span`
  display: inline-flex;
  color: #F43F5E;
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
  margin-bottom: 18px;
`;
const Q = styled.div`
  display: flex; gap: 8px;
  margin-bottom: 8px;
  span { font-size: 13px; color: #0F172A; line-height: 1.5; flex: 1; }
`;
const QuLabel = styled.span`
  font-size: 11px; font-weight: 700; color: #94A3B8;
  flex-shrink: 0; padding-top: 2px;
`;
const A = styled.div`
  display: flex; gap: 8px;
  background: #F0FDFA;
  border-left: 3px solid #14B8A6;
  border-radius: 0 8px 8px 0;
  padding: 10px 12px;
`;
const ALabel = styled.span`
  font-size: 11px; font-weight: 700; color: #0D9488;
  flex-shrink: 0; padding-top: 2px;
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
