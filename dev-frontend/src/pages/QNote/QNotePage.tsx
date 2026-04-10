import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import styled from 'styled-components';
import StartMeetingModal from './StartMeetingModal';
import type { StartConfig } from './StartMeetingModal';
import { getLanguageByCode } from '../../constants/languages';
import { useAuth } from '../../contexts/AuthContext';
import {
  listSessions,
  getSession,
  createSession,
  updateSession,
  uploadDocument,
  addUrl,
} from '../../services/qnote';
import type { QNoteSession, QNoteUtterance, QNoteSpeaker } from '../../services/qnote';
import { LiveSession } from '../../services/qnoteLive';
import type { LiveEvent } from '../../services/qnoteLive';
import {
  MicIcon,
  StopIcon,
  PlusIcon,
  ArrowRightIcon,
  HelpCircleIcon,
} from '../../components/Common/Icons';

/**
 * Q Note 페이지
 *
 * 색상 원칙:
 *   - Primary 딥틸: #14B8A6 #0D9488 #115E59 #F0FDFA #CCFBF1 #99F6E4
 *   - Point 코랄/로즈: #F43F5E #E11D48 #FFF1F2 #FFE4E6 #FECDD3 #9F1239
 *   - Neutral: #FFFFFF #F8FAFC #F1F5F9 #E2E8F0 #CBD5E1 #94A3B8 #64748B #475569 #0F172A
 *
 * 회의 상태 머신:
 *   empty → prepared → recording ⇄ paused → (회의 종료) → review
 *
 * 발화 블록 모델:
 *   일반 발화 → flat transcript 블록 (보더/배경 없음)
 *   질문      → 카드 (코랄 보더 + 수평 레이아웃 + 우측 답변 찾기)
 *
 * 커밋 규칙 (터미네이터 기반):
 *   Deepgram final 들을 pending 버퍼에 누적
 *   "?" / "." / "!" 로 끝나는 final 이 오면 pending 전체를 한 번에 커밋
 *     - ? 로 끝남 → 질문 카드
 *     - . ! 로 끝남 → speech 블록 (직전 같은 화자 speech 블록과 병합)
 *   화자 교체(갭 ≥ 1.5초) 또는 침묵 ≥ 20초 → pending 강제 flush (미완성 문장도)
 *   일시중지 / 회의종료 → 강제 flush
 */

type Phase = 'empty' | 'prepared' | 'recording' | 'paused' | 'review';
type BlockKind = 'speech' | 'question';

interface BlockSegment {
  utteranceId: number;
  original: string;
  translation: string | null;
  start: number | null;
  end: number | null;
}

interface TranscriptBlock {
  id: string;
  kind: BlockKind;
  speakerRowId: number | null;
  speakerLabel: string;
  timestamp: string;
  segments: BlockSegment[];
  firstStart: number | null;
  lastEnd: number | null;
  lastDgSpeakerId: number | null;
}

interface PendingBuffer {
  segments: BlockSegment[];
  firstStart: number | null;
  lastEnd: number | null;
  dgSpeakerId: number | null;
  speakerRowId: number | null;
  speakerLabel: string;
}

// 하드 캡 — 20초 이상 침묵이면 pending 강제 flush
const SILENCE_HARD_CAP_SEC = 20;
// 플리커 내성 — 다른 speaker 라도 침묵 갭이 짧으면 Deepgram 플리커로 간주
const FLICKER_TOLERANCE_SEC = 1.5;

// ─── 문장 경계 판정 ──────────────────────────────────────
const ENDS_WITH_TERMINATOR = /[.!?。！？][\s"')\]]*$/;
const ENDS_WITH_QUESTION = /[?？][\s"')\]]*$/;

function textEndsWithTerminator(text: string): boolean {
  return ENDS_WITH_TERMINATOR.test(text.trim());
}

function textEndsWithQuestion(text: string): boolean {
  return ENDS_WITH_QUESTION.test(text.trim());
}

function formatTime(sec: number | string | null | undefined): string {
  if (sec == null) return '';
  if (typeof sec === 'number') {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return '';
}

function speakerLabelFor(
  speakerRowId: number | null,
  dgSpeakerId: number | null,
  speakers: QNoteSpeaker[],
): string {
  if (speakerRowId != null) {
    const match = speakers.find((s) => s.id === speakerRowId);
    if (match) {
      if (match.is_self) return '나';
      if (match.participant_name) return match.participant_name;
      return `화자 ${(match.deepgram_speaker_id ?? 0) + 1}`;
    }
  }
  if (dgSpeakerId != null) return `화자 ${dgSpeakerId + 1}`;
  return '화자';
}

function joinText(segments: BlockSegment[]): string {
  return segments.map((s) => s.original).join(' ').replace(/\s+/g, ' ').trim();
}

function joinTranslation(segments: BlockSegment[]): { text: string; hasAny: boolean; allTranslated: boolean } {
  const translated = segments.filter((s) => s.translation != null && s.translation !== '');
  const text = translated.map((s) => s.translation).join(' ').replace(/\s+/g, ' ').trim();
  return {
    text,
    hasAny: translated.length > 0,
    allTranslated: translated.length === segments.length,
  };
}

const QNotePage = () => {
  const { user } = useAuth();
  const businessId = user?.business_id ?? null;

  const [showStartModal, setShowStartModal] = useState(false);
  const [phase, setPhase] = useState<Phase>('empty');
  const [sessions, setSessions] = useState<QNoteSession[]>([]);
  const [activeSession, setActiveSession] = useState<QNoteSession | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [pendingConfig, setPendingConfig] = useState<StartConfig | null>(null);

  const [blocks, setBlocks] = useState<TranscriptBlock[]>([]);
  const [pending, setPending] = useState<PendingBuffer | null>(null);
  const [interimText, setInterimText] = useState<string>('');
  const [liveError, setLiveError] = useState<string | null>(null);

  const liveRef = useRef<LiveSession | null>(null);
  const speakersRef = useRef<QNoteSpeaker[]>([]);
  const pendingRef = useRef<PendingBuffer | null>(null);  // 즉시 읽기용
  const blockCounterRef = useRef(0);
  const transcriptRef = useRef<HTMLDivElement | null>(null);

  const meetingLangLabels = useMemo(() => {
    const langs = activeSession?.meeting_languages || [];
    return langs.map((c) => getLanguageByCode(c)?.label || c).join(' + ');
  }, [activeSession]);

  // ── 세션 목록 로드 ────────────────────────────────────
  const loadSessions = useCallback(async () => {
    if (!businessId) return;
    try {
      const data = await listSessions(businessId);
      setSessions(data);
    } catch (err) {
      console.error('Failed to load sessions:', err);
    }
  }, [businessId]);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    return () => {
      liveRef.current?.stop();
      liveRef.current = null;
    };
  }, []);

  // ── pending 을 블록으로 커밋 (speech 는 직전 같은 화자 블록과 병합) ──
  const commitPendingAsBlock = useCallback((p: PendingBuffer, kind: BlockKind) => {
    const newBlock: TranscriptBlock = {
      id: `b${++blockCounterRef.current}`,
      kind,
      speakerRowId: p.speakerRowId,
      speakerLabel: p.speakerLabel,
      timestamp: formatTime(p.firstStart),
      segments: p.segments,
      firstStart: p.firstStart,
      lastEnd: p.lastEnd,
      lastDgSpeakerId: p.dgSpeakerId,
    };

    setBlocks((prev) => {
      if (kind === 'speech') {
        const last = prev[prev.length - 1];
        if (
          last &&
          last.kind === 'speech' &&
          last.speakerRowId === p.speakerRowId &&
          (
            last.lastEnd == null ||
            p.firstStart == null ||
            p.firstStart - last.lastEnd < SILENCE_HARD_CAP_SEC
          )
        ) {
          const merged: TranscriptBlock = {
            ...last,
            segments: [...last.segments, ...p.segments],
            lastEnd: p.lastEnd ?? last.lastEnd,
            lastDgSpeakerId: p.dgSpeakerId ?? last.lastDgSpeakerId,
          };
          return [...prev.slice(0, -1), merged];
        }
      }
      return [...prev, newBlock];
    });
  }, []);

  // pending 강제 flush (pause/end/speaker-change/silence 시)
  const flushPending = useCallback(() => {
    const p = pendingRef.current;
    if (!p) return;
    const text = joinText(p.segments);
    const kind: BlockKind = textEndsWithQuestion(text) ? 'question' : 'speech';
    commitPendingAsBlock(p, kind);
    pendingRef.current = null;
    setPending(null);
  }, [commitPendingAsBlock]);

  // ── 세션 클릭 → 리뷰 모드 ─────────────────────────────
  const openReview = async (sessionId: number) => {
    if (liveRef.current) {
      liveRef.current.stop();
      liveRef.current = null;
    }
    flushPending();
    try {
      const detail = await getSession(sessionId);
      setActiveSession(detail);
      speakersRef.current = detail.speakers || [];
      setPhase('review');
      setBlocks([]);
      setInterimText('');
      setLiveError(null);
      setPendingConfig(null);
      pendingRef.current = null;
      setPending(null);
    } catch (err) {
      console.error('Failed to load session:', err);
    }
  };

  // ── WebSocket 이벤트 핸들러 ───────────────────────────
  const handleLiveEvent = useCallback((ev: LiveEvent) => {
    if (ev.type === 'transcript') {
      if (!ev.is_final) setInterimText(ev.transcript);
      return;
    }

    if (ev.type === 'finalized') {
      setInterimText('');

      const text = ev.transcript;
      const segStart = typeof ev.start === 'number' ? ev.start : null;
      const segEnd = typeof ev.end === 'number' ? ev.end : segStart;
      const dgSpeakerId = ev.deepgram_speaker_id ?? null;
      const speakerRowId = ev.speaker_id ?? null;

      const newSegment: BlockSegment = {
        utteranceId: ev.utterance_id,
        original: text,
        translation: null,
        start: segStart,
        end: segEnd,
      };

      // 현재 pending 을 ref 에서 읽어 즉시 처리
      let current = pendingRef.current;

      // 화자 교체 / 침묵 갭 flush 판정
      if (current) {
        const gap =
          segStart != null && current.lastEnd != null ? segStart - current.lastEnd : 0;
        const differentSpeaker =
          current.dgSpeakerId != null &&
          dgSpeakerId != null &&
          current.dgSpeakerId !== dgSpeakerId;
        const speakerChanged = differentSpeaker && gap >= FLICKER_TOLERANCE_SEC;
        const silenceExceeded = gap >= SILENCE_HARD_CAP_SEC;

        if (speakerChanged || silenceExceeded) {
          const currentText = joinText(current.segments);
          const prevKind: BlockKind = textEndsWithQuestion(currentText) ? 'question' : 'speech';
          commitPendingAsBlock(current, prevKind);
          current = null;
        }
      }

      // append or create
      if (current) {
        current = {
          ...current,
          segments: [...current.segments, newSegment],
          lastEnd: segEnd ?? current.lastEnd,
          dgSpeakerId: dgSpeakerId ?? current.dgSpeakerId,
        };
      } else {
        current = {
          segments: [newSegment],
          firstStart: segStart,
          lastEnd: segEnd,
          dgSpeakerId,
          speakerRowId,
          speakerLabel: speakerLabelFor(speakerRowId, dgSpeakerId, speakersRef.current),
        };
      }

      // 이번 final 이 terminator 로 끝나면 즉시 커밋
      if (textEndsWithTerminator(text)) {
        const isQuestion = textEndsWithQuestion(text);
        commitPendingAsBlock(current, isQuestion ? 'question' : 'speech');
        pendingRef.current = null;
        setPending(null);
      } else {
        pendingRef.current = current;
        setPending(current);
      }
      return;
    }

    if (ev.type === 'enrichment') {
      // 블록과 pending 모두에서 해당 utterance_id 를 찾아 번역 주입
      setBlocks((prev) =>
        prev.map((block) => {
          let changed = false;
          const newSegs = block.segments.map((seg) => {
            if (seg.utteranceId !== ev.utterance_id) return seg;
            changed = true;
            return { ...seg, translation: ev.translation };
          });
          return changed ? { ...block, segments: newSegs } : block;
        })
      );
      setPending((prev) => {
        if (!prev) return prev;
        let changed = false;
        const newSegs = prev.segments.map((seg) => {
          if (seg.utteranceId !== ev.utterance_id) return seg;
          changed = true;
          return { ...seg, translation: ev.translation };
        });
        if (!changed) return prev;
        const updated = { ...prev, segments: newSegs };
        pendingRef.current = updated;
        return updated;
      });
      return;
    }

    if (ev.type === 'error') {
      setLiveError(ev.message);
      return;
    }

    if (ev.type === 'closed') {
      setPhase((p) => (p === 'recording' ? 'paused' : p));
      return;
    }
  }, [commitPendingAsBlock]);

  // ── 녹음 시작 (prepared/paused → recording) ───────────
  const startRecording = async () => {
    if (!activeSession || !pendingConfig) return;
    setLiveError(null);
    const live = new LiveSession({
      sessionId: activeSession.id,
      captureMode: pendingConfig.captureMode,
      onEvent: handleLiveEvent,
    });
    try {
      await live.start();
      liveRef.current = live;
      setPhase('recording');
    } catch (err) {
      setLiveError(err instanceof Error ? err.message : '라이브 연결 실패');
      live.stop();
    }
  };

  // ── 녹음 일시 중지 ────────────────────────────────────
  const pauseRecording = () => {
    liveRef.current?.stop();
    liveRef.current = null;
    setInterimText('');
    flushPending();
    setPhase('paused');
  };

  // ── 회의 종료 ─────────────────────────────────────────
  const endMeeting = async () => {
    liveRef.current?.stop();
    liveRef.current = null;
    setInterimText('');
    flushPending();
    if (activeSession) {
      try {
        await updateSession(activeSession.id, { status: 'completed' });
        const refreshed = await getSession(activeSession.id);
        setActiveSession(refreshed);
        speakersRef.current = refreshed.speakers || [];
      } catch (err) {
        console.error('End meeting failed:', err);
      }
    }
    setPhase('review');
    setPendingConfig(null);
    loadSessions();
  };

  // ── 새 회의 생성 ──────────────────────────────────────
  const handleStartMeeting = async (cfg: StartConfig) => {
    if (!businessId) {
      setLiveError('비즈니스 정보가 없습니다.');
      return;
    }
    setShowStartModal(false);
    setLiveError(null);
    setBlocks([]);
    setInterimText('');
    pendingRef.current = null;
    setPending(null);

    try {
      if (liveRef.current) {
        liveRef.current.stop();
        liveRef.current = null;
      }

      const created = await createSession({
        business_id: businessId,
        title: cfg.title || '제목 없는 회의',
        brief: cfg.brief || undefined,
        participants: cfg.participants.length > 0
          ? cfg.participants.map((p) => ({ name: p.name, role: p.role || null }))
          : undefined,
        meeting_languages: cfg.meetingLanguages,
        translation_language: cfg.translationLanguage,
        answer_language: cfg.answerLanguage,
        pasted_context: cfg.pastedContext || undefined,
      });

      for (const file of cfg.documents) {
        try { await uploadDocument(created.id, file); }
        catch (err) { console.error(`Upload failed: ${file.name}`, err); }
      }
      for (const url of cfg.urls) {
        try { await addUrl(created.id, url); }
        catch (err) { console.error(`URL add failed: ${url}`, err); }
      }

      const detail = await getSession(created.id);
      setActiveSession(detail);
      speakersRef.current = detail.speakers || [];
      setSessions((prev) => [detail, ...prev]);
      setPendingConfig(cfg);
      setPhase('prepared');
    } catch (err) {
      setLiveError(err instanceof Error ? err.message : '세션 생성 실패');
    }
  };

  // ── 리뷰 모드 블록 구성 (동일 규칙: 터미네이터 기반) ──
  const reviewBlocks = useMemo<TranscriptBlock[]>(() => {
    if (!activeSession?.utterances) return [];
    const speakers = activeSession.speakers || [];
    const speakerById = new Map(speakers.map((s) => [s.id, s]));
    const out: TranscriptBlock[] = [];
    let counter = 0;
    let buf: PendingBuffer | null = null;

    const flush = (p: PendingBuffer, kind: BlockKind) => {
      if (kind === 'speech') {
        const last = out[out.length - 1];
        if (
          last &&
          last.kind === 'speech' &&
          last.speakerRowId === p.speakerRowId &&
          (
            last.lastEnd == null ||
            p.firstStart == null ||
            p.firstStart - last.lastEnd < SILENCE_HARD_CAP_SEC
          )
        ) {
          last.segments.push(...p.segments);
          last.lastEnd = p.lastEnd ?? last.lastEnd;
          return;
        }
      }
      out.push({
        id: `r${++counter}`,
        kind,
        speakerRowId: p.speakerRowId,
        speakerLabel: p.speakerLabel,
        timestamp: formatTime(p.firstStart),
        segments: p.segments.slice(),
        firstStart: p.firstStart,
        lastEnd: p.lastEnd,
        lastDgSpeakerId: p.dgSpeakerId,
      });
    };

    for (const u of activeSession.utterances as QNoteUtterance[]) {
      const start = typeof u.start_time === 'number' ? u.start_time : null;
      const end = typeof u.end_time === 'number' ? u.end_time : start;
      const dgSp = u.speaker_id != null
        ? (speakerById.get(u.speaker_id)?.deepgram_speaker_id ?? null)
        : null;
      const text = u.original_text;
      const seg: BlockSegment = {
        utteranceId: u.id,
        original: text,
        translation: u.translated_text,
        start,
        end,
      };

      // speaker / silence flush 체크
      if (buf) {
        const gap = start != null && buf.lastEnd != null ? start - buf.lastEnd : 0;
        const differentSpeaker =
          buf.dgSpeakerId != null && dgSp != null && buf.dgSpeakerId !== dgSp;
        const speakerChanged = differentSpeaker && gap >= FLICKER_TOLERANCE_SEC;
        const silenceExceeded = gap >= SILENCE_HARD_CAP_SEC;

        if (speakerChanged || silenceExceeded) {
          const cText = joinText(buf.segments);
          flush(buf, textEndsWithQuestion(cText) ? 'question' : 'speech');
          buf = null;
        }
      }

      if (buf) {
        buf.segments.push(seg);
        buf.lastEnd = end ?? buf.lastEnd;
        buf.dgSpeakerId = dgSp ?? buf.dgSpeakerId;
      } else {
        buf = {
          segments: [seg],
          firstStart: start,
          lastEnd: end,
          dgSpeakerId: dgSp,
          speakerRowId: u.speaker_id,
          speakerLabel: speakerLabelFor(u.speaker_id, dgSp, speakers),
        };
      }

      if (textEndsWithTerminator(text)) {
        const isQuestion = textEndsWithQuestion(text);
        flush(buf, isQuestion ? 'question' : 'speech');
        buf = null;
      }
    }

    // 남은 buf 마지막 flush
    if (buf) {
      const cText = joinText(buf.segments);
      flush(buf, textEndsWithQuestion(cText) ? 'question' : 'speech');
    }

    return out;
  }, [activeSession]);

  const renderBlocks = phase === 'review' ? reviewBlocks : blocks;
  const showRecordingUI = phase === 'prepared' || phase === 'recording' || phase === 'paused';

  // 라이브 자동 하단 스크롤
  useEffect(() => {
    if (phase !== 'recording' && phase !== 'paused') return;
    const el = transcriptRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [blocks, pending, interimText, phase]);

  // ─── 블록 렌더 ─────────────────────────────────────
  const renderBlock = (block: TranscriptBlock) => {
    const originalText = joinText(block.segments);
    const { text: translatedText, hasAny, allTranslated } = joinTranslation(block.segments);

    if (block.kind === 'question') {
      return (
        <QuestionCard key={block.id}>
          <QuestionCardBody>
            <BlockHeader>
              <BlockSpeaker>{block.speakerLabel}</BlockSpeaker>
              <BlockTime>{block.timestamp}</BlockTime>
              <QuestionInlineLabel>
                <HelpCircleIcon size={11} />
                <span>질문</span>
              </QuestionInlineLabel>
            </BlockHeader>
            <QuestionOriginal>{originalText}</QuestionOriginal>
            {hasAny ? (
              <QuestionTranslation>
                {translatedText}
                {!allTranslated && <PendingHint> …</PendingHint>}
              </QuestionTranslation>
            ) : (
              <TranslationPending>번역 중…</TranslationPending>
            )}
          </QuestionCardBody>
          <QuestionCardAside>
            <FindAnswerBtn disabled title="아직 개발 중입니다">
              <span>답변 찾기</span>
              <ArrowRightIcon size={14} />
            </FindAnswerBtn>
          </QuestionCardAside>
        </QuestionCard>
      );
    }

    return (
      <SpeechBlockWrap key={block.id}>
        <BlockHeader>
          <BlockSpeaker>{block.speakerLabel}</BlockSpeaker>
          <BlockTime>{block.timestamp}</BlockTime>
        </BlockHeader>
        <SpeechOriginal>{originalText}</SpeechOriginal>
        {hasAny ? (
          <SpeechTranslation>
            {translatedText}
            {!allTranslated && <PendingHint> …</PendingHint>}
          </SpeechTranslation>
        ) : (
          <TranslationPending>번역 중…</TranslationPending>
        )}
      </SpeechBlockWrap>
    );
  };

  // ─── Pending (미완성 문장) 렌더 — 유령 블록 ─────────
  const renderPending = () => {
    if (!pending) return null;
    const originalText = joinText(pending.segments);
    if (!originalText) return null;
    return (
      <PendingBlockWrap>
        <BlockHeader>
          <BlockSpeaker>{pending.speakerLabel}</BlockSpeaker>
          <BlockTime>{formatTime(pending.firstStart)}</BlockTime>
        </BlockHeader>
        <PendingOriginal>{originalText}</PendingOriginal>
      </PendingBlockWrap>
    );
  };

  return (
    <Layout $collapsed={sidebarCollapsed}>
      <Sidebar $collapsed={sidebarCollapsed}>
        <SidebarHeader>
          <SidebarTitle>Q Note</SidebarTitle>
          <NewSessionBtn onClick={() => setShowStartModal(true)}>
            <PlusIcon size={14} />
            <span>새 회의</span>
          </NewSessionBtn>
        </SidebarHeader>

        <SearchBox placeholder="세션 검색" />

        <SessionList>
          {sessions.length === 0 && <EmptySessionMsg>아직 세션이 없습니다.</EmptySessionMsg>}
          {sessions.map((session) => {
            const lang = getLanguageByCode(session.language);
            const isActive = activeSession?.id === session.id;
            return (
              <SessionItem
                key={session.id}
                $active={isActive}
                onClick={() => openReview(session.id)}
              >
                <SessionItemTitle>{session.title}</SessionItemTitle>
                <SessionItemMeta>
                  <span>{new Date(session.created_at).toLocaleDateString()}</span>
                  <Dot>·</Dot>
                  <span>{session.utterance_count} 발화</span>
                  <Dot>·</Dot>
                  <span>{lang?.label || session.language}</span>
                </SessionItemMeta>
              </SessionItem>
            );
          })}
        </SessionList>
      </Sidebar>

      <Main>
        <CollapseToggle
          onClick={() => setSidebarCollapsed((v) => !v)}
          aria-label={sidebarCollapsed ? '사이드바 열기' : '사이드바 닫기'}
        >
          {sidebarCollapsed ? '›' : '‹'}
        </CollapseToggle>

        {phase === 'empty' && (
          <EmptyState>
            <EmptyIconWrap>
              <MicIcon size={36} />
            </EmptyIconWrap>
            <EmptyTitle>회의를 시작해보세요</EmptyTitle>
            <EmptyDesc>
              실시간 음성 인식, 번역, 질문 감지로
              <br />
              회의록을 자동으로 만들어드립니다.
            </EmptyDesc>
            <EmptyBtn onClick={() => setShowStartModal(true)}>
              <PlusIcon size={16} />
              <span>새 회의 시작</span>
            </EmptyBtn>
          </EmptyState>
        )}

        {showRecordingUI && activeSession && (
          <>
            <MainHeader>
              <HeaderLeft>
                <SessionTitle>{activeSession.title}</SessionTitle>
                <SessionMeta>
                  {meetingLangLabels && <Badge>{meetingLangLabels}</Badge>}
                  {phase === 'prepared' && <Badge>녹음 대기</Badge>}
                  {phase === 'recording' && <Badge>녹음 중</Badge>}
                  {phase === 'paused' && <Badge>일시 중지</Badge>}
                </SessionMeta>
              </HeaderLeft>
              <HeaderRight>
                {phase === 'prepared' && (
                  <PrimaryBtn onClick={startRecording}>
                    <MicIcon size={14} />
                    <span>녹음 시작</span>
                  </PrimaryBtn>
                )}
                {phase === 'recording' && (
                  <>
                    <RecordingIndicator>
                      <RecordDot />
                      녹음 중
                    </RecordingIndicator>
                    <SecondaryBtn onClick={pauseRecording}>
                      <StopIcon size={14} />
                      <span>중지</span>
                    </SecondaryBtn>
                    <DangerBtn onClick={endMeeting}>회의 종료</DangerBtn>
                  </>
                )}
                {phase === 'paused' && (
                  <>
                    <PrimaryBtn onClick={startRecording}>
                      <MicIcon size={14} />
                      <span>녹음 이어하기</span>
                    </PrimaryBtn>
                    <DangerBtn onClick={endMeeting}>회의 종료</DangerBtn>
                  </>
                )}
              </HeaderRight>
            </MainHeader>

            {liveError && <ErrorBar>{liveError}</ErrorBar>}

            <Transcript ref={transcriptRef}>
              {renderBlocks.length === 0 && !pending && phase === 'prepared' && (
                <EmptyTranscript>
                  회의 준비가 완료되었습니다.
                  <br />
                  "녹음 시작"을 누르면 실시간 음성 인식이 시작됩니다.
                </EmptyTranscript>
              )}

              {renderBlocks.map((block) => renderBlock(block))}
              {renderPending()}

              {phase === 'recording' && (
                <InterimLine>
                  <InterimDot />
                  {interimText || '듣는 중...'}
                </InterimLine>
              )}
            </Transcript>
          </>
        )}

        {phase === 'review' && activeSession && (
          <>
            <MainHeader>
              <HeaderLeft>
                <SessionTitle>{activeSession.title}</SessionTitle>
                <SessionMeta>
                  <Badge>리뷰</Badge>
                  <Badge>{activeSession.utterance_count} 발화</Badge>
                </SessionMeta>
              </HeaderLeft>
              <HeaderRight>
                <SecondaryBtn>요약 생성</SecondaryBtn>
                <SecondaryBtn>질문 보기</SecondaryBtn>
              </HeaderRight>
            </MainHeader>
            <Transcript>
              {renderBlocks.length === 0 && <EmptyTranscript>발화 기록이 없습니다.</EmptyTranscript>}
              {renderBlocks.map((block) => renderBlock(block))}
            </Transcript>
          </>
        )}
      </Main>

      <StartMeetingModal
        open={showStartModal}
        onClose={() => setShowStartModal(false)}
        onStart={handleStartMeeting}
      />
    </Layout>
  );
};

export default QNotePage;

// ─────────────────────────────────────────────────────────
// PRIMARY: #14B8A6 #0D9488 #115E59 #F0FDFA #CCFBF1 #99F6E4
// POINT:   #F43F5E #E11D48 #FFF1F2 #FFE4E6 #FECDD3 #9F1239
// NEUTRAL: #FFFFFF #F8FAFC #F1F5F9 #E2E8F0 #CBD5E1 #94A3B8 #64748B #334155 #0F172A
// ─────────────────────────────────────────────────────────

const Layout = styled.div<{ $collapsed: boolean }>`
  display: grid;
  grid-template-columns: ${(p) => (p.$collapsed ? '0px 1fr' : '300px 1fr')};
  height: calc(100vh - 64px);
  background: #f8fafc;
  transition: grid-template-columns 200ms ease;
`;

const Sidebar = styled.aside<{ $collapsed: boolean }>`
  background: #ffffff;
  border-right: 1px solid #e2e8f0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  transform: translateX(${(p) => (p.$collapsed ? '-100%' : '0')});
  transition: transform 200ms ease;
  visibility: ${(p) => (p.$collapsed ? 'hidden' : 'visible')};
`;

const SidebarHeader = styled.div`
  padding: 20px 20px 12px;
  display: flex;
  justify-content: space-between;
  align-items: center;
`;

const SidebarTitle = styled.h1`
  font-size: 18px;
  font-weight: 700;
  color: #0f172a;
  margin: 0;
`;

const NewSessionBtn = styled.button`
  height: 32px;
  padding: 0 12px;
  border: none;
  background: #14b8a6;
  color: #ffffff;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  &:hover { background: #0d9488; }
`;

const SearchBox = styled.input`
  margin: 0 20px 12px;
  height: 36px;
  padding: 0 12px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  font-size: 13px;
  color: #0f172a;
  &::placeholder { color: #94a3b8; }
  &:focus {
    outline: none;
    border-color: #14b8a6;
    box-shadow: 0 0 0 3px rgba(20, 184, 166, 0.15);
  }
`;

const SessionList = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: 4px 12px 20px;
`;

const EmptySessionMsg = styled.div`
  padding: 24px 14px;
  text-align: center;
  color: #94a3b8;
  font-size: 13px;
`;

const SessionItem = styled.div<{ $active: boolean }>`
  padding: 12px 14px;
  border-radius: 10px;
  cursor: pointer;
  background: ${(p) => (p.$active ? '#f0fdfa' : 'transparent')};
  border: 1px solid ${(p) => (p.$active ? '#14b8a6' : 'transparent')};
  margin-bottom: 4px;
  transition: all 120ms;
  &:hover { background: #f8fafc; }
`;

const SessionItemTitle = styled.div`
  font-size: 14px;
  font-weight: 600;
  color: #0f172a;
  margin-bottom: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const SessionItemMeta = styled.div`
  font-size: 11px;
  color: #64748b;
  display: flex;
  gap: 6px;
  align-items: center;
`;

const Dot = styled.span`
  color: #cbd5e1;
`;

const Main = styled.section`
  position: relative;
  display: flex;
  flex-direction: column;
  overflow: hidden;
`;

const CollapseToggle = styled.button`
  position: absolute;
  top: 50%;
  left: 0;
  transform: translate(-50%, -50%);
  z-index: 10;
  width: 24px;
  height: 48px;
  border: 1px solid #e2e8f0;
  background: #ffffff;
  color: #64748b;
  border-radius: 0 8px 8px 0;
  cursor: pointer;
  font-size: 16px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  padding-left: 8px;
  box-shadow: 2px 0 6px rgba(15, 23, 42, 0.04);
  &:hover {
    color: #0d9488;
    border-color: #14b8a6;
  }
`;

const MainHeader = styled.div`
  padding: 20px 32px;
  background: #ffffff;
  border-bottom: 1px solid #e2e8f0;
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
`;

const HeaderLeft = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const HeaderRight = styled.div`
  display: flex;
  gap: 10px;
  align-items: center;
`;

const SessionTitle = styled.h2`
  font-size: 20px;
  font-weight: 700;
  color: #0f172a;
  margin: 0;
`;

const SessionMeta = styled.div`
  display: flex;
  gap: 8px;
  align-items: center;
`;

const Badge = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 24px;
  padding: 0 10px;
  background: #f1f5f9;
  color: #475569;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 500;
`;

const RecordingIndicator = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  height: 36px;
  padding: 0 14px;
  background: #f0fdfa;
  color: #0f766e;
  border: 1px solid #99f6e4;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
`;

const RecordDot = styled.span`
  width: 8px;
  height: 8px;
  background: #0d9488;
  border-radius: 50%;
  animation: pulse 1.6s ease-in-out infinite;
  @keyframes pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.4; transform: scale(0.85); }
  }
`;

const PrimaryBtn = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 36px;
  padding: 0 18px;
  background: #14b8a6;
  color: #ffffff;
  border: none;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  &:hover { background: #0d9488; }
`;

const SecondaryBtn = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 36px;
  padding: 0 16px;
  background: #ffffff;
  color: #0d9488;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  &:hover {
    background: #f0fdfa;
    border-color: #14b8a6;
  }
`;

const DangerBtn = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 36px;
  padding: 0 16px;
  background: #ffffff;
  color: #9f1239;
  border: 1px solid #fecdd3;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  &:hover {
    background: #fff1f2;
    border-color: #f43f5e;
  }
`;

const ErrorBar = styled.div`
  margin: 12px 32px 0;
  padding: 10px 14px;
  background: #fff1f2;
  color: #9f1239;
  border: 1px solid #fecdd3;
  border-radius: 8px;
  font-size: 13px;
`;

const Transcript = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: 24px 32px 120px;
  display: flex;
  flex-direction: column;
  gap: 18px;
`;

const EmptyTranscript = styled.div`
  padding: 48px 24px;
  text-align: center;
  color: #94a3b8;
  font-size: 14px;
  line-height: 1.6;
`;

// ─── Speech 블록 (평문 transcript) ────────────────
const SpeechBlockWrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const BlockHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 2px;
`;

const BlockSpeaker = styled.span`
  font-size: 12px;
  font-weight: 700;
  color: #0d9488;
`;

const BlockTime = styled.span`
  font-size: 11px;
  color: #94a3b8;
`;

const SpeechOriginal = styled.div`
  font-size: 15px;
  color: #0f172a;
  line-height: 1.65;
  word-break: break-word;
`;

const SpeechTranslation = styled.div`
  font-size: 13px;
  color: #64748b;
  line-height: 1.55;
  word-break: break-word;
`;

// ─── 질문 카드 — 수평 레이아웃 (좌 본문 / 우 답변 버튼) ─
const QuestionCard = styled.div`
  display: flex;
  align-items: stretch;
  gap: 16px;
  background: #ffffff;
  border: 1px solid #fecdd3;
  border-left: 4px solid #f43f5e;
  border-radius: 10px;
  padding: 12px 16px;
  box-shadow: 0 1px 3px rgba(244, 63, 94, 0.06);
`;

const QuestionCardBody = styled.div`
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const QuestionCardAside = styled.div`
  flex-shrink: 0;
  display: flex;
  align-items: center;
`;

const QuestionInlineLabel = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  font-weight: 700;
  color: #9f1239;
  background: #ffe4e6;
  padding: 2px 8px;
  border-radius: 10px;
`;

const QuestionOriginal = styled.div`
  font-size: 15px;
  font-weight: 600;
  color: #0f172a;
  line-height: 1.55;
  word-break: break-word;
`;

const QuestionTranslation = styled.div`
  font-size: 13px;
  color: #64748b;
  line-height: 1.5;
  word-break: break-word;
`;

const TranslationPending = styled.div`
  font-size: 13px;
  color: #cbd5e1;
  font-style: italic;
`;

const PendingHint = styled.span`
  color: #cbd5e1;
  font-style: italic;
`;

const FindAnswerBtn = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
  background: #f43f5e;
  color: #ffffff;
  border: none;
  height: 34px;
  padding: 0 14px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: background 120ms;
  &:hover:not(:disabled) { background: #e11d48; }
  &:disabled {
    background: #fecdd3;
    cursor: not-allowed;
  }
`;

// ─── Pending (미완성 문장) 렌더 — 유령 블록 ─────
const PendingBlockWrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  opacity: 0.55;
`;

const PendingOriginal = styled.div`
  font-size: 15px;
  color: #475569;
  line-height: 1.65;
  font-style: italic;
  word-break: break-word;
  &::after {
    content: ' …';
    color: #cbd5e1;
  }
`;

// ─── 라이브 interim 라인 ──────────────────────────
const InterimLine = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 14px;
  color: #94a3b8;
  font-style: italic;
  padding: 4px 0;
`;

const InterimDot = styled.span`
  width: 6px;
  height: 6px;
  background: #cbd5e1;
  border-radius: 50%;
  animation: blink 1.2s ease-in-out infinite;
  @keyframes blink {
    0%, 100% { opacity: 0.3; }
    50% { opacity: 1; }
  }
`;

const EmptyState = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 40px;
`;

const EmptyIconWrap = styled.div`
  width: 72px;
  height: 72px;
  border-radius: 50%;
  background: #f0fdfa;
  color: #0d9488;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 20px;
`;

const EmptyTitle = styled.h2`
  font-size: 22px;
  font-weight: 700;
  color: #0f172a;
  margin: 0 0 8px;
`;

const EmptyDesc = styled.p`
  font-size: 14px;
  color: #64748b;
  margin: 0 0 24px;
  line-height: 1.6;
`;

const EmptyBtn = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 44px;
  padding: 0 28px;
  background: #14b8a6;
  color: #ffffff;
  border: none;
  border-radius: 10px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  &:hover { background: #0d9488; }
`;
