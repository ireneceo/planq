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
  matchSpeaker,
  mergeSpeakers,
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
  detectedLanguage?: string | null;
  outOfScope?: boolean;
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
  const [liveNotice, setLiveNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!liveNotice) return;
    const t = window.setTimeout(() => setLiveNotice(null), 5000);
    return () => window.clearTimeout(t);
  }, [liveNotice]);

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
  // 방어: 같은 utterance_id 가 중복 append 되지 않도록 dedup.
  const commitPendingAsBlock = useCallback((p: PendingBuffer, kind: BlockKind) => {
    const dedup = (segs: BlockSegment[]) => {
      const seen = new Set<number>();
      return segs.filter((s) => {
        if (seen.has(s.utteranceId)) return false;
        seen.add(s.utteranceId);
        return true;
      });
    };
    const newBlock: TranscriptBlock = {
      id: `b${++blockCounterRef.current}`,
      kind,
      speakerRowId: p.speakerRowId,
      speakerLabel: p.speakerLabel,
      timestamp: formatTime(p.firstStart),
      segments: dedup(p.segments),
      firstStart: p.firstStart,
      lastEnd: p.lastEnd,
      lastDgSpeakerId: p.dgSpeakerId,
    };

    // 2초 이내 같은 화자면 speech/question 상관없이 merge
    const LIVE_MERGE_GAP = 2.0;
    setBlocks((prev) => {
      const last = prev[prev.length - 1];
      if (
        last &&
        last.speakerRowId === p.speakerRowId &&
        (
          last.lastEnd == null ||
          p.firstStart == null ||
          p.firstStart - last.lastEnd < LIVE_MERGE_GAP
        )
      ) {
        const merged: TranscriptBlock = {
          ...last,
          kind: kind === 'question' || last.kind === 'question' ? 'question' : 'speech',
          segments: dedup([...last.segments, ...p.segments]),
          lastEnd: p.lastEnd ?? last.lastEnd,
          lastDgSpeakerId: p.dgSpeakerId ?? last.lastDgSpeakerId,
        };
        return [...prev.slice(0, -1), merged];
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

  // ── 세션 클릭 → status 기반 phase 결정 ─────────────────
  //   completed → review (리뷰 모드)
  //   그 외     → paused (이어서 녹음 가능)
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
      const nextPhase: Phase = detail.status === 'completed' ? 'review' : 'paused';
      setPhase(nextPhase);
      // paused 로 진입 시 서버 utterances 에서 blocks 재구성 → 화면에 바로 노출.
      // review 는 useMemo(reviewBlocks) 사용하므로 blocks 는 비움.
      if (nextPhase === 'paused') {
        setBlocks(buildBlocksFromSession(detail));
      } else {
        setBlocks([]);
      }
      setInterimText('');
      setLiveError(null);
      // paused 진입 시, 재개를 위해 기본 pendingConfig 구성 (참여자/언어 유지)
      if (nextPhase === 'paused') {
        setPendingConfig({
          title: detail.title,
          brief: detail.brief || '',
          participants: (detail.participants || []).map((p) => ({ name: p.name, role: p.role || '' })),
          meetingLanguages: detail.meeting_languages || ['ko'],
          translationLanguage: detail.translation_language || 'ko',
          answerLanguage: detail.answer_language || '',
          pastedContext: detail.pasted_context || '',
          documents: [],
          urls: [],
          captureMode: 'microphone',
        });
      } else {
        setPendingConfig(null);
      }
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
      // 블록과 pending 모두에서 해당 utterance_id 를 찾아 번역/언어/정제 원문 주입
      const patch = (seg: BlockSegment): BlockSegment => ({
        ...seg,
        // GPT 가 정제한 원문(한국어 띄어쓰기 등)이 있으면 교체
        original: ev.formatted_original || seg.original,
        translation: ev.translation,
        detectedLanguage: ev.detected_language ?? seg.detectedLanguage ?? null,
        outOfScope: ev.out_of_scope ?? seg.outOfScope ?? false,
      });
      setBlocks((prev) =>
        prev.map((block) => {
          let changed = false;
          const newSegs = block.segments.map((seg) => {
            if (seg.utteranceId !== ev.utterance_id) return seg;
            changed = true;
            return patch(seg);
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
          return patch(seg);
        });
        if (!changed) return prev;
        const updated = { ...prev, segments: newSegs };
        pendingRef.current = updated;
        return updated;
      });
      return;
    }

    if (ev.type === 'self_matched') {
      // 라이브 본인 매칭 성공 → speakers 배열을 즉시 갱신
      setActiveSession((prev) => {
        if (!prev) return prev;
        const next = {
          ...prev,
          speakers: (prev.speakers || []).map((s) =>
            s.id === ev.speaker_id ? { ...s, is_self: 1 } : s
          ),
        };
        speakersRef.current = next.speakers || [];
        return next;
      });
      setLiveNotice(`본인 인식됨 (유사도 ${ev.similarity.toFixed(2)})`);
      return;
    }

    if (ev.type === 'self_match_failed') {
      // 매칭 실패 — 사용자에게 명시적으로 알려서 수동 지정 경로로 유도
      setLiveError(`본인 자동 인식 실패: ${ev.reason}`);
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
    if (!activeSession) {
      setLiveError('활성 세션이 없습니다');
      return;
    }
    if (!pendingConfig) {
      // paused 상태에서 이어하기 시 pendingConfig 가 없으면 기본값 (마이크 모드) 으로 복구
      setLiveError('회의 설정 복원 실패 — 마이크 모드로 이어갑니다');
    }
    setLiveError(null);
    const captureMode = pendingConfig?.captureMode || 'microphone';
    const live = new LiveSession({
      sessionId: activeSession.id,
      captureMode,
      onEvent: handleLiveEvent,
    });
    try {
      await live.start();
      liveRef.current = live;
      setPhase('recording');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[QNote] live.start failed:', err);
      // 사용자에게 구체적 힌트
      let hint = msg;
      if (/Permission denied|NotAllowedError/i.test(msg)) {
        hint = '마이크 또는 탭 공유 권한이 거부되었습니다. 브라우저 주소창 좌측 자물쇠 아이콘에서 권한을 허용해주세요.';
      } else if (/tab|display/i.test(msg)) {
        hint = '탭 오디오 공유가 취소되었습니다. 다시 시도할 때 공유 다이얼로그에서 "탭 오디오 공유" 체크를 확인해주세요.';
      } else if (/WebSocket/i.test(msg)) {
        hint = 'Q Note 서버 연결 실패. 새로고침 후 다시 시도해주세요.';
      }
      setLiveError(`녹음 시작 실패: ${hint}`);
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

  // ── 서버 utterances 를 블록으로 재구성 (리뷰/paused 공용) ──
  const buildBlocksFromSession = useCallback(
    (sess: QNoteSession | null): TranscriptBlock[] => {
      if (!sess?.utterances) return [];
      const speakers = sess.speakers || [];
      const speakerById = new Map(speakers.map((s) => [s.id, s]));
      const out: TranscriptBlock[] = [];
      let counter = 0;
      let buf: PendingBuffer | null = null;

    // 연속 merge gap — 같은 화자, 2초 이내 발화는 한 블록으로 묶어 "두 번씩 나오는" 시각적 중복 제거.
    // question 도 merge 대상 (같은 화자 짧은 연속 질문들은 같은 카드)
    const MERGE_GAP_SEC = 2.0;
    const flush = (p: PendingBuffer, kind: BlockKind) => {
      const last = out[out.length - 1];
      if (
        last &&
        last.speakerRowId === p.speakerRowId &&
        (
          last.lastEnd == null ||
          p.firstStart == null ||
          p.firstStart - last.lastEnd < MERGE_GAP_SEC
        )
      ) {
        // kind 가 달라도 합쳐서 question 이 하나라도 포함되면 question 카드로
        last.segments.push(...p.segments);
        last.lastEnd = p.lastEnd ?? last.lastEnd;
        if (kind === 'question') last.kind = 'question';
        return;
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

    for (const u of sess.utterances as QNoteUtterance[]) {
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
  }, []);

  // 리뷰 모드용: activeSession 변경 시 자동 재계산
  const reviewBlocks = useMemo<TranscriptBlock[]>(
    () => buildBlocksFromSession(activeSession),
    [activeSession, buildBlocksFromSession]
  );

  // 원래 로직 복원: review 는 reviewBlocks, 그 외는 blocks.
  // paused 는 openReview 에서 blocks 를 미리 하이드레이트 하므로 blocks 사용.
  const renderBlocks = phase === 'review' ? reviewBlocks : blocks;
  const showRecordingUI = phase === 'prepared' || phase === 'recording' || phase === 'paused';

  // ─── 화자 인라인 할당 팝오버 상태 ───────────────────
  // 자동 인식 실패 시 수동 지정이 필요하므로 recording 중에도 허용.
  // (사용자 요청: "화자 선택이 안 됨" — 녹음 중에도 열려야 함)
  const speakerAssignAllowed = phase !== 'empty' && phase !== 'prepared';
  // 팝오버는 클릭한 **그 블록**에만 떠야 함. 같은 speakerRowId 여러 블록에 동시 렌더 금지.
  const [speakerPopoverFor, setSpeakerPopoverFor] = useState<string | null>(null); // block.id
  const [assignSaving, setAssignSaving] = useState(false);

  const refreshActiveSession = useCallback(async () => {
    if (!activeSession) return;
    const refreshed = await getSession(activeSession.id);
    setActiveSession(refreshed);
    speakersRef.current = refreshed.speakers || [];
  }, [activeSession]);

  // 이름 할당 — 이미 다른 speaker 가 같은 이름이면 자동 병합
  const assignSpeakerName = useCallback(async (speakerRowId: number, name: string) => {
    if (!activeSession) return;
    setAssignSaving(true);
    try {
      const speakers = activeSession.speakers || [];
      const existing = speakers.find(
        (s) => s.id !== speakerRowId && (s.participant_name || '').trim() === name.trim() && name.trim() !== ''
      );
      if (existing) {
        await mergeSpeakers(activeSession.id, speakerRowId, existing.id);
      } else {
        await matchSpeaker(activeSession.id, speakerRowId, { participant_name: name || undefined });
      }
      await refreshActiveSession();
      setSpeakerPopoverFor(null);
    } finally {
      setAssignSaving(false);
    }
  }, [activeSession, refreshActiveSession]);

  // "나" 할당 — 이미 다른 speaker 가 is_self 면 자동 병합
  const assignSpeakerSelf = useCallback(async (speakerRowId: number) => {
    if (!activeSession) return;
    setAssignSaving(true);
    try {
      const speakers = activeSession.speakers || [];
      const existingSelf = speakers.find((s) => s.id !== speakerRowId && s.is_self);
      if (existingSelf) {
        await mergeSpeakers(activeSession.id, speakerRowId, existingSelf.id);
      } else {
        await matchSpeaker(activeSession.id, speakerRowId, { is_self: true });
      }
      await refreshActiveSession();
      setSpeakerPopoverFor(null);
    } finally {
      setAssignSaving(false);
    }
  }, [activeSession, refreshActiveSession]);

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

    // 언어 필터: 블록의 모든 segment 가 out_of_scope 면 흐리게 + 언어 태그
    const allOutOfScope = block.segments.length > 0 && block.segments.every((s) => s.outOfScope);
    const outOfScopeLang = allOutOfScope
      ? (block.segments.find((s) => s.detectedLanguage)?.detectedLanguage || null)
      : null;
    const outOfScopeLabel = outOfScopeLang
      ? (getLanguageByCode(outOfScopeLang)?.label || outOfScopeLang.toUpperCase())
      : null;

    // 동적 speakerLabel — self_matched 나 수동 지정 후 즉시 반영되도록 매 렌더마다 재계산
    // (block.speakerLabel 은 생성 시점 snapshot 이라 stale)
    const liveLabel = speakerLabelFor(
      block.speakerRowId,
      block.lastDgSpeakerId,
      activeSession?.speakers || []
    );

    const speakerBadge = (
      <SpeakerBadgeWrap>
        <BlockSpeaker
          as={speakerAssignAllowed ? 'button' : 'span'}
          $clickable={speakerAssignAllowed}
          disabled={!speakerAssignAllowed}
          onClick={(e: React.MouseEvent) => {
            if (!speakerAssignAllowed || block.speakerRowId == null) return;
            e.stopPropagation();
            setSpeakerPopoverFor((prev) => (prev === block.id ? null : block.id));
          }}
        >
          {liveLabel}
          {speakerAssignAllowed && block.speakerRowId != null && <SpeakerCaret>▾</SpeakerCaret>}
        </BlockSpeaker>
        {speakerAssignAllowed && speakerPopoverFor === block.id && block.speakerRowId != null && (
          <SpeakerPopover
            speakerRowId={block.speakerRowId}
            participants={activeSession?.participants || []}
            onClose={() => setSpeakerPopoverFor(null)}
            onAssignName={(name) => assignSpeakerName(block.speakerRowId!, name)}
            onAssignSelf={() => assignSpeakerSelf(block.speakerRowId!)}
            disabled={assignSaving}
          />
        )}
      </SpeakerBadgeWrap>
    );

    if (block.kind === 'question') {
      return (
        <QuestionCard key={block.id}>
          <QuestionCardBody>
            <BlockHeader>
              {speakerBadge}
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
      <SpeechBlockWrap key={block.id} $dimmed={allOutOfScope}>
        <BlockHeader>
          {speakerBadge}
          <BlockTime>{block.timestamp}</BlockTime>
          {outOfScopeLabel && <OutOfScopeTag>{outOfScopeLabel} · 선택 언어 아님</OutOfScopeTag>}
        </BlockHeader>
        <SpeechOriginal>{originalText}</SpeechOriginal>
        {allOutOfScope ? null : hasAny ? (
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
            {liveNotice && <NoticeBar>{liveNotice}</NoticeBar>}

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
// SpeakerPopover — 발화 블록의 [화자 N ▾] 클릭 시 인라인 팝오버
//   참여자/나 선택 시 즉시 적용. 같은 이름/나가 이미 있으면 자동 병합.
// ─────────────────────────────────────────────────────────
interface ParticipantLite {
  name: string;
  role?: string | null;
}

interface SpeakerPopoverProps {
  speakerRowId: number;
  participants: ParticipantLite[];
  onClose: () => void;
  onAssignName: (name: string) => Promise<void>;
  onAssignSelf: () => Promise<void>;
  disabled: boolean;
}

const SpeakerPopover = ({ participants, onClose, onAssignName, onAssignSelf, disabled }: SpeakerPopoverProps) => {
  const [customName, setCustomName] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  // click 이벤트 기준. 버튼 onClick 에서 stopPropagation 하므로 toggle 경로와 충돌 없음.
  // 마이크로 이벤트 순서: 버튼 click (stopPropagation) → document click 호출 안 됨.
  // 팝오버 밖 click → document click → 닫힘.
  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    // setTimeout 으로 현재 event 루프 이후에 등록 (toggle click 과 동일 tick 에서 바로 닫히는 것 방지)
    const t = window.setTimeout(() => document.addEventListener('click', onDocClick), 0);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener('click', onDocClick);
    };
  }, [onClose]);

  return (
    <PopoverWrap ref={ref} onClick={(e) => e.stopPropagation()}>
      <PopoverTitle>이 사람은</PopoverTitle>
      <PopoverBtn onClick={onAssignSelf} disabled={disabled} $primary>
        나
      </PopoverBtn>
      {participants.length > 0 && (
        <>
          <PopoverDivider />
          <PopoverLabel>등록된 참여자</PopoverLabel>
          {participants.map((p) => (
            <PopoverBtn
              key={p.name}
              onClick={() => onAssignName(p.name)}
              disabled={disabled}
            >
              {p.name}
              {p.role && <PopoverRole>{p.role}</PopoverRole>}
            </PopoverBtn>
          ))}
        </>
      )}
      <PopoverDivider />
      <PopoverLabel>직접 입력</PopoverLabel>
      <PopoverInputRow>
        <PopoverInput
          type="text"
          placeholder="이름"
          value={customName}
          onChange={(e) => setCustomName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && customName.trim()) {
              onAssignName(customName.trim());
            }
          }}
          disabled={disabled}
          autoFocus
        />
        <PopoverInputBtn
          onClick={() => customName.trim() && onAssignName(customName.trim())}
          disabled={disabled || !customName.trim()}
        >
          저장
        </PopoverInputBtn>
      </PopoverInputRow>
    </PopoverWrap>
  );
};

const PopoverWrap = styled.div`
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 50;
  min-width: 200px;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.12);
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const PopoverTitle = styled.div`
  font-size: 10px;
  font-weight: 700;
  color: #94a3b8;
  padding: 4px 8px 2px;
  letter-spacing: 0.05em;
  text-transform: uppercase;
`;

const PopoverLabel = styled.div`
  font-size: 10px;
  font-weight: 600;
  color: #94a3b8;
  padding: 2px 8px;
`;

const PopoverDivider = styled.div`
  height: 1px;
  background: #f1f5f9;
  margin: 4px 0;
`;

const PopoverBtn = styled.button<{ $primary?: boolean }>`
  text-align: left;
  font-size: 13px;
  font-weight: ${(p) => (p.$primary ? 700 : 500)};
  color: ${(p) => (p.$primary ? '#0d9488' : '#0f172a')};
  background: ${(p) => (p.$primary ? '#f0fdfa' : 'transparent')};
  border: 1px solid ${(p) => (p.$primary ? '#99f6e4' : 'transparent')};
  border-radius: 6px;
  padding: 8px 10px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;

  &:hover:not(:disabled) { background: ${(p) => (p.$primary ? '#ccfbf1' : '#f8fafc')}; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;

const PopoverRole = styled.span`
  font-size: 10px;
  font-weight: 500;
  color: #94a3b8;
`;

const PopoverInputRow = styled.div`
  display: flex;
  gap: 4px;
  padding: 0 4px 4px;
`;

const PopoverInput = styled.input`
  flex: 1;
  min-width: 0;
  font-size: 12px;
  padding: 6px 8px;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  outline: none;
  color: #0f172a;
  &:focus { border-color: #14b8a6; }
  &:disabled { background: #f1f5f9; }
`;

const PopoverInputBtn = styled.button`
  font-size: 11px;
  font-weight: 600;
  padding: 6px 10px;
  background: #0d9488;
  color: #fff;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  &:hover:not(:disabled) { background: #0f766e; }
  &:disabled { background: #cbd5e1; cursor: not-allowed; }
`;

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

const NoticeBar = styled.div`
  margin: 12px 32px 0;
  padding: 10px 14px;
  background: #f0fdfa;
  color: #0f766e;
  border: 1px solid #99f6e4;
  border-radius: 8px;
  font-size: 13px;
  animation: fadeOut 4s forwards;
  @keyframes fadeOut {
    0%, 70% { opacity: 1; }
    100% { opacity: 0; visibility: hidden; }
  }
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
const SpeechBlockWrap = styled.div<{ $dimmed?: boolean }>`
  display: flex;
  flex-direction: column;
  gap: 4px;
  opacity: ${(p) => (p.$dimmed ? 0.45 : 1)};
`;

const OutOfScopeTag = styled.span`
  font-size: 10px;
  font-weight: 600;
  color: #94a3b8;
  background: #f1f5f9;
  padding: 2px 6px;
  border-radius: 4px;
  letter-spacing: 0.02em;
`;

const BlockHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 2px;
`;

const SpeakerBadgeWrap = styled.span`
  position: relative;
  display: inline-flex;
  align-items: center;
`;

const BlockSpeaker = styled.span<{ $clickable?: boolean }>`
  font-size: 12px;
  font-weight: 700;
  color: #0d9488;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: ${(p) => (p.$clickable ? '3px 7px' : '0')};
  border-radius: 6px;
  background: ${(p) => (p.$clickable ? '#f0fdfa' : 'transparent')};
  border: ${(p) => (p.$clickable ? '1px solid #99f6e4' : 'none')};
  cursor: ${(p) => (p.$clickable ? 'pointer' : 'default')};
  transition: background 120ms, border-color 120ms;

  &:hover {
    ${(p) => p.$clickable && 'background: #ccfbf1; border-color: #5eead4;'}
  }
`;

const SpeakerCaret = styled.span`
  font-size: 9px;
  color: #0d9488;
  opacity: 0.7;
  margin-left: 2px;
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
