// MemoView — Q Note 페이지의 우측 panel 에서 text 메모 풀모드 편집 (사이클 N+17).
//
// 정책:
//  - composingMemo (신규 빈 메모) OR activeSession.input_type === 'text' (기존 메모 클릭) 시 노출
//  - PostEditor (TipTap RichEditor) 풀모드 — 코드블록·서식·이미지·table 모두
//  - 헤더: 제목 (자동 추출 / 클릭 편집) + 저장 상태 dot + visibility chip + 삭제
//  - 자동저장 1초 debounce — popup 과 동일 패턴
//
// popup (우하단 FAB) vs MemoView (페이지 안 우측 panel):
//  - popup: 다른 페이지 작업 중 빠른 캡처. 작은 floating window.
//  - MemoView: Q Note 페이지 안 메모 전용 작업. 넓은 영역 풀모드 편집.
//  - 양쪽 같은 sessions.body 컬럼 (JSON.stringify(doc)) 사용 → 즉시 동기화.
import React, { useState, useEffect, useRef, useCallback, Suspense, lazy } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { createSession, updateSession, generateSessionSummary } from '../../services/qnote';
import type { QNoteSession } from '../../services/qnote';
import { parseBodyToDoc, deriveTitleFromDoc, isDocEmpty } from '../../utils/qnoteBody';
import VisibilityBadge from '../../components/Common/VisibilityBadge';

const PostEditor = lazy(() => import('../../components/Docs/PostEditor'));

interface Props {
  session: QNoteSession | null;
  businessId: number;
  // 사이클 N+17 hotfix — NewNoteModal 에서 선택한 project/client prefill (신규 메모일 때만)
  prefillProjectId?: number | null;
  prefillClientId?: number | null;
  onCreated: (session: QNoteSession) => void;
  onUpdated: (session: QNoteSession) => void;
  onDelete: (id: number) => void;
  onClose: () => void;
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error';
const SAVE_DEBOUNCE_MS = 1000;

function timeAgo(t: (k: string, opts?: any) => string, savedAt: number | null): string {
  if (!savedAt) return '';
  const sec = Math.floor((Date.now() - savedAt) / 1000);
  if (sec < 5) return t('memoPopup.savedJustNow') as string;
  if (sec < 60) return t('memoPopup.savedAt', { ago: `${sec}s` }) as string;
  const min = Math.floor(sec / 60);
  if (min < 60) return t('memoPopup.savedAt', { ago: `${min}m` }) as string;
  return t('memoPopup.savedAt', { ago: `${Math.floor(min / 60)}h` }) as string;
}

// TipTap doc → plain text (요약 입력용). 블록 단위 줄바꿈.
function docToPlainText(doc: unknown): string {
  if (!doc || typeof doc !== 'object') return '';
  const blockText = (node: any): string => {
    if (!node) return '';
    if (typeof node.text === 'string') return node.text;
    if (Array.isArray(node.content)) return node.content.map(blockText).join('');
    return '';
  };
  const content = Array.isArray((doc as any).content) ? (doc as any).content : [];
  const lines: string[] = [];
  for (const block of content) {
    const txt = blockText(block).trim();
    if (txt) lines.push(txt);
  }
  return lines.join('\n');
}

const MemoView: React.FC<Props> = ({ session, businessId, prefillProjectId, prefillClientId, onCreated, onUpdated, onDelete, onClose }) => {
  // prefillClientId — sessions 컬럼 X. 다음 사이클 source_meta 등에 보존 예정 (props interface 만 받아둠).
  void prefillClientId;
  const { t } = useTranslation('qnote');
  const [doc, setDoc] = useState<unknown>(() => parseBodyToDoc(session?.body));
  const [sessionId, setSessionId] = useState<number | null>(session?.id ?? null);
  const [saveState, setSaveState] = useState<SaveState>(session ? 'saved' : 'idle');
  const [savedAt, setSavedAt] = useState<number | null>(session ? Date.now() : null);
  const [tick, setTick] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // N+88 — 메모 요약 (body 기반, 영속). session.summary_* 로 표시.
  const [summarizing, setSummarizing] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const runMemoSummary = async () => {
    if (!sessionId) return;
    setSummaryError(null);
    setSummarizing(true);
    try {
      const text = docToPlainText(doc).trim();
      if (!text) { setSummaryError(t('page.summary.emptyHint') as string); return; }
      const data = await generateSessionSummary(sessionId, text);
      if (session) {
        onUpdated({ ...session, summary_key_points: data.key_points, summary_full: data.full_summary, summarized_at: new Date().toISOString() });
      }
    } catch (e) {
      setSummaryError((e as Error).message || (t('page.summary.failed') as string));
    } finally {
      setSummarizing(false);
    }
  };

  const dirtyRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionIdRef = useRef<number | null>(sessionId);
  sessionIdRef.current = sessionId;

  // session prop 변경 시 (다른 메모 click) doc 갱신
  useEffect(() => {
    setDoc(parseBodyToDoc(session?.body));
    setSessionId(session?.id ?? null);
    setSaveState(session ? 'saved' : 'idle');
    setSavedAt(session ? Date.now() : null);
    dirtyRef.current = false;
  }, [session?.id]);  // eslint-disable-line react-hooks/exhaustive-deps

  const persist = useCallback(async () => {
    if (isDocEmpty(doc)) return;
    const title = deriveTitleFromDoc(doc);
    const bodyJson = JSON.stringify(doc);
    setSaveState('saving');
    try {
      if (sessionIdRef.current) {
        const updated = await updateSession(sessionIdRef.current, { title, body: bodyJson } as any);
        setSavedAt(Date.now()); setSaveState('saved');
        dirtyRef.current = false;
        onUpdated(updated);
        return updated;
      }
      // 사이클 N+17 hotfix — NewNoteModal prefill (project_id) 반영.
      // project_id 가 있으면 visibility L2 자동 설정. client_id 는 sessions 테이블 컬럼 X
      // (다음 사이클 컬럼 추가 후 메타 보존).
      const created = await createSession({
        business_id: businessId, title, input_type: 'text', body: bodyJson,
        ...(prefillProjectId ? { project_id: prefillProjectId } : {}),
      } as any);
      setSessionId(created.id);
      setSavedAt(Date.now()); setSaveState('saved');
      dirtyRef.current = false;
      onCreated(created);
      return created;
    } catch (e) {
      setSaveState('error'); throw e;
    }
  }, [doc, businessId, onCreated, onUpdated]);

  useEffect(() => {
    if (!dirtyRef.current) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { persist().catch(() => null); }, SAVE_DEBOUNCE_MS);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [doc, persist]);

  useEffect(() => {
    if (saveState !== 'saved') return;
    const id = setInterval(() => setTick(x => x + 1), 10_000);
    return () => clearInterval(id);
  }, [saveState]);
  void tick;

  const titleDisplay = deriveTitleFromDoc(doc) || (t('memoPopup.idleNew') as string);

  return (
    <Wrap>
      <Header>
        <TitleArea>
          <Title>{titleDisplay}</Title>
          <Status>
            <Dot $tone={saveState} />
            {saveState === 'saving' && (t('memoPopup.savingNow') as string)}
            {saveState === 'saved' && timeAgo(t as any, savedAt)}
            {saveState === 'error' && (t('memoPopup.errorRetry') as string)}
            {saveState === 'idle' && !sessionId && (t('memoPopup.idleNew') as string)}
          </Status>
        </TitleArea>
        <HeaderActions>
          <VisibilityBadge level={(session?.visibility as any) || 'L1'} compact />
          {sessionId && (
            <IconBtn
              type="button"
              onClick={() => setConfirmDelete(true)}
              title={t('memoPopup.delete', { defaultValue: '메모 삭제' }) as string}
              aria-label={t('memoPopup.delete', { defaultValue: '메모 삭제' }) as string}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/>
              </svg>
            </IconBtn>
          )}
          <IconBtn
            type="button"
            onClick={() => {
              // 사이클 N+17 hotfix — 빈 메모 닫기 시 자동 delete (URL 즉시 생성 정책의 cleanup).
              if (sessionId && isDocEmpty(doc)) {
                onDelete(sessionId);
                return;
              }
              onClose();
            }}
            title={t('memoPopup.close') as string}
            aria-label={t('memoPopup.close') as string}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </IconBtn>
        </HeaderActions>
      </Header>

      {/* N+88 — 메모 요약 (body 기반·영속). 저장된 메모일 때만. */}
      {sessionId && (
        <MemoSummary>
          {session?.summary_full ? (
            <>
              <MemoSummaryTop>
                <MemoSummaryTitle>{t('page.summary.title', '요약')}</MemoSummaryTitle>
                <MemoSummaryRegen type="button" onClick={runMemoSummary} disabled={summarizing}>
                  {summarizing ? t('page.summary.generating', '생성 중...') : t('page.summary.regenerate', '재요약')}
                </MemoSummaryRegen>
              </MemoSummaryTop>
              {(session.summary_key_points || []).length > 0 && (
                <MemoSummaryPoints>
                  {(session.summary_key_points || []).map((p, i) => <li key={i}>{p}</li>)}
                </MemoSummaryPoints>
              )}
              <MemoSummaryFull>{session.summary_full}</MemoSummaryFull>
              {summaryError && <MemoSummaryError>{summaryError}</MemoSummaryError>}
            </>
          ) : (
            <MemoSummaryEmpty>
              <MemoSummaryHint>{t('page.summary.emptyHint', 'AI가 이 회의의 핵심을 요약합니다.')}</MemoSummaryHint>
              <MemoSummaryGenerate type="button" onClick={runMemoSummary} disabled={summarizing}>
                {summarizing ? t('page.summary.generating', '생성 중...') : t('page.summary.generate', 'AI 요약 생성')}
              </MemoSummaryGenerate>
              {summaryError && <MemoSummaryError>{summaryError}</MemoSummaryError>}
            </MemoSummaryEmpty>
          )}
        </MemoSummary>
      )}

      <Body>
        <Suspense fallback={<EditorLoading>{t('memoPopup.searchLoading') as string}</EditorLoading>}>
          {/* 사이클 N+17 hotfix — Q docs PostsPage 와 동일한 카드 스타일 (borderless 제거).
              회색 페이지 bg + 흰 카드 (PostEditor Wrap 의 default border + border-radius:12). */}
          <PostEditor
            value={doc}
            onChange={(next) => { dirtyRef.current = true; setDoc(next); }}
            placeholder={t('memoPopup.bodyPlaceholder') as string}
            editable
            businessId={businessId}
          />
        </Suspense>
      </Body>

      {confirmDelete && sessionId && (
        <ConfirmBackdrop onClick={() => setConfirmDelete(false)}>
          <ConfirmDialog onClick={(e) => e.stopPropagation()}>
            <ConfirmTitle>{t('memoPopup.deleteConfirmTitle', { defaultValue: '메모를 삭제할까요?' }) as string}</ConfirmTitle>
            <ConfirmDesc>{t('memoPopup.deleteConfirmDesc', { defaultValue: '이 메모가 영구 삭제됩니다. 되돌릴 수 없어요.' }) as string}</ConfirmDesc>
            <ConfirmActions>
              <SecondaryBtn type="button" onClick={() => setConfirmDelete(false)}>
                {t('common.cancel', { defaultValue: '취소' }) as string}
              </SecondaryBtn>
              <DangerBtn type="button" onClick={() => { setConfirmDelete(false); onDelete(sessionId); }}>
                {t('memoPopup.delete', { defaultValue: '삭제' }) as string}
              </DangerBtn>
            </ConfirmActions>
          </ConfirmDialog>
        </ConfirmBackdrop>
      )}
    </Wrap>
  );
};

export default MemoView;

// ─── styled ───
const Wrap = styled.div`
  flex: 1; min-height: 0;
  display: flex; flex-direction: column;
  background: #FFFFFF;
`;
// N+88 — 메모 요약 밴드 (Header 와 Body 사이)
const MemoSummary = styled.section`
  flex-shrink: 0;
  padding: 14px 20px;
  border-bottom: 1px solid #E2E8F0;
  background: #F8FAFC;
  @media (max-width: 768px) { padding: 12px 14px; }
`;
const MemoSummaryTop = styled.div`
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  margin-bottom: 8px;
`;
const MemoSummaryTitle = styled.h3`
  margin: 0; font-size: 13px; font-weight: 700; color: #0F172A; letter-spacing: -0.2px;
  display: flex; align-items: center; gap: 8px;
  &::before { content: ''; width: 3px; height: 14px; background: #14B8A6; border-radius: 2px; }
`;
const MemoSummaryRegen = styled.button`
  border: 1px solid #E2E8F0; background: #FFFFFF; color: #475569;
  font-size: 12px; font-weight: 600; padding: 6px 12px; border-radius: 8px; cursor: pointer;
  transition: all 0.15s ease;
  &:hover:not(:disabled) { border-color: #CBD5E1; background: #F8FAFC; }
  &:disabled { opacity: 0.5; cursor: default; }
`;
const MemoSummaryPoints = styled.ul`
  margin: 0 0 8px; padding-left: 18px; display: flex; flex-direction: column; gap: 4px;
  li { font-size: 13px; line-height: 1.6; color: #0F172A; }
`;
const MemoSummaryFull = styled.div`
  font-size: 13px; line-height: 1.7; color: #334155; white-space: pre-wrap;
  max-height: 140px; overflow-y: auto;
`;
const MemoSummaryEmpty = styled.div`
  display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap;
`;
const MemoSummaryHint = styled.div`
  font-size: 13px; color: #64748B;
`;
const MemoSummaryGenerate = styled.button`
  border: none; background: #14B8A6; color: #FFFFFF;
  font-size: 13px; font-weight: 600; padding: 8px 16px; border-radius: 8px; cursor: pointer;
  white-space: nowrap; transition: background 0.15s ease;
  &:hover:not(:disabled) { background: #0D9488; }
  &:active:not(:disabled) { background: #0F766E; }
  &:disabled { opacity: 0.6; cursor: default; }
`;
const MemoSummaryError = styled.div`
  font-size: 12px; color: #B91C1C; margin-top: 8px; flex-basis: 100%;
`;
const Header = styled.div`
  display: flex; align-items: flex-start; gap: 12px;
  padding: 14px 20px;
  border-bottom: 1px solid #E2E8F0;
  background: #FFFFFF;
  flex-shrink: 0;
  min-height: 60px;
  @media (max-width: 768px) {
    padding: 10px 14px;
    gap: 8px;
  }
`;
const TitleArea = styled.div`
  flex: 1; min-width: 0;
  display: flex; flex-direction: column; gap: 4px;
`;
const Title = styled.h2`
  margin: 0;
  font-size: 16px; font-weight: 700; color: #0F172A;
  letter-spacing: -0.2px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
`;
const Status = styled.div`
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 11px; color: #94A3B8;
`;
const Dot = styled.span<{ $tone: SaveState }>`
  display: inline-block;
  width: 6px; height: 6px; border-radius: 50%;
  background: ${(p) =>
    p.$tone === 'saved' ? '#22C55E' :
    p.$tone === 'saving' ? '#F59E0B' :
    p.$tone === 'error' ? '#EF4444' :
    '#CBD5E1'};
`;
const HeaderActions = styled.div`
  display: flex; align-items: center; gap: 4px;
  flex-shrink: 0;
`;
const IconBtn = styled.button`
  width: 32px; height: 32px;
  display: inline-flex; align-items: center; justify-content: center;
  background: transparent; color: #64748B;
  border: none; border-radius: 8px; cursor: pointer;
  transition: background 0.15s, color 0.15s;
  &:hover { background: #F1F5F9; color: #0F172A; }
  &:focus-visible { outline: 2px solid rgba(15,118,110,0.5); outline-offset: 2px; }
`;
const Body = styled.div`
  flex: 1; min-height: 0;
  display: flex; flex-direction: column;
  /* 사이클 N+17 — Q docs PostsPage Body 와 spacing 동기 (좌우 들러붙음 fix) */
  padding: 24px 28px;
  background: #F8FAFC;
  gap: 16px;
  overflow-y: auto;
  @media (max-width: 768px) { padding: 16px 18px; }
`;
const EditorLoading = styled.div`
  display: flex; align-items: center; justify-content: center;
  height: 100%; min-height: 200px;
  font-size: 13px; color: #94A3B8;
`;

// 삭제 확인
const ConfirmBackdrop = styled.div`
  position: fixed; inset: 0;
  background: rgba(15, 23, 42, 0.45);
  z-index: 2400;
  display: flex; align-items: center; justify-content: center;
`;
const ConfirmDialog = styled.div`
  background: #FFFFFF; border-radius: 12px;
  padding: 20px 24px;
  width: min(420px, 90vw);
  box-shadow: 0 20px 50px -12px rgba(15,23,42,0.3);
`;
const ConfirmTitle = styled.div`
  font-size: 15px; font-weight: 700; color: #0F172A; margin-bottom: 8px;
`;
const ConfirmDesc = styled.div`
  font-size: 13px; color: #64748B; line-height: 1.55; margin-bottom: 16px;
`;
const ConfirmActions = styled.div`
  display: flex; justify-content: flex-end; gap: 8px;
`;
const SecondaryBtn = styled.button`
  padding: 8px 16px;
  font-size: 13px; font-weight: 600; color: #475569;
  background: transparent; border: 1px solid #E2E8F0;
  border-radius: 6px; cursor: pointer;
  &:hover { background: #F8FAFC; border-color: #CBD5E1; }
`;
const DangerBtn = styled.button`
  padding: 8px 16px;
  font-size: 13px; font-weight: 600; color: #FFFFFF;
  background: #EF4444; border: 1px solid #EF4444;
  border-radius: 6px; cursor: pointer;
  &:hover { background: #DC2626; border-color: #DC2626; }
`;
