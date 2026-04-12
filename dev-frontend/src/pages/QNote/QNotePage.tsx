import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
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
  reassignUtteranceSpeaker,
  getCachedAnswer,
  findAnswer,
  translateAnswer,
} from '../../services/qnote';
import type { QNoteSession, QNoteUtterance, QNoteSpeaker } from '../../services/qnote';
import { LiveSession } from '../../services/qnoteLive';
import type { LiveEvent } from '../../services/qnoteLive';
import {
  MicIcon,
  StopIcon,
  PlusIcon,
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
 * 커밋 규칙 (speech_final 기반):
 *   백엔드(live.py)가 Deepgram `speech_final=true` 이벤트에 대해서만 DB insert + `finalized`
 *   이벤트 발행. 그 전 `is_final=true && !speech_final` 은 interim 으로 취급.
 *   프론트는 `finalized` 를 받는 즉시 새 블록으로 승격 — 한 문장이 여러 카드로 쪼개지는
 *   "버벅거림" 을 원천 차단.
 *   2초 이내 같은 화자의 연속 finalized 는 직전 블록과 merge.
 *   질문 감지는 텍스트 끝 `?` 로 낙관 판정, enrichment 도착 후 백엔드 판정으로 덮어씀.
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

// ─── 질문 판정 (낙관적, 백엔드 enrichment 가 덮어씀) ───

function formatTime(sec: number | string | null | undefined): string {
  if (sec == null) return '';
  if (typeof sec === 'number') {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return '';
}

interface SpeakerLabelContext {
  speakers: QNoteSpeaker[];
  participants?: { name: string; role?: string | null }[] | null;
}

function speakerLabelFor(
  speakerRowId: number | null,
  dgSpeakerId: number | null,
  ctx: SpeakerLabelContext,
): string {
  const { speakers, participants } = ctx;
  if (speakerRowId != null) {
    const match = speakers.find((s) => s.id === speakerRowId);
    if (match) {
      if (match.is_self) return '나';
      if (match.participant_name) return match.participant_name;
      // 참여자 1명 → 나 아닌 모든 화자를 그 참여자 이름으로
      // 참여자 다수 → "상대"
      const pCount = participants?.length ?? 0;
      if (pCount === 1 && participants![0].name) return participants![0].name;
      if (pCount > 1) return '상대';
      return `화자 ${(match.deepgram_speaker_id ?? 0) + 1}`;
    }
  }
  if (dgSpeakerId != null) {
    const pCount = participants?.length ?? 0;
    if (pCount === 1 && participants![0].name) return participants![0].name;
    if (pCount > 1) return '상대';
    return `화자 ${dgSpeakerId + 1}`;
  }
  return '상대';
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

  const { sessionId: urlSessionId } = useParams<{ sessionId?: string }>();
  const navigate = useNavigate();

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
  const [editingTitle, setEditingTitle] = useState(false);

  // 회의 제목 인라인 수정 + 자동저장
  const handleTitleSave = useCallback(async (newTitle: string) => {
    const trimmed = newTitle.trim();
    setEditingTitle(false);
    const sess = activeSessionRef.current;
    if (!sess || !trimmed || trimmed === sess.title) return;
    try {
      await updateSession(sess.id, { title: trimmed });
      setActiveSession((prev) => prev ? { ...prev, title: trimmed } : prev);
      setSessions((prev) => prev.map((s) => s.id === sess.id ? { ...s, title: trimmed } : s));
    } catch {
      // 실패 시 무시 (원본 유지)
    }
  }, []);

  useEffect(() => {
    if (!liveNotice) return;
    const t = window.setTimeout(() => setLiveNotice(null), 5000);
    return () => window.clearTimeout(t);
  }, [liveNotice]);

  const liveRef = useRef<LiveSession | null>(null);
  const speakersRef = useRef<QNoteSpeaker[]>([]);
  const activeSessionRef = useRef<QNoteSession | null>(null);
  const pendingRef = useRef<PendingBuffer | null>(null);  // 즉시 읽기용
  const blockCounterRef = useRef(0);
  const transcriptRef = useRef<HTMLDivElement | null>(null);

  // activeSession 변경 시 ref 동기화 (useCallback 내부에서 stale closure 방지)
  useEffect(() => { activeSessionRef.current = activeSession; }, [activeSession]);

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

  // URL 파라미터로 세션 자동 열기 (/notes/:sessionId)
  const urlSessionIdHandled = useRef(false);
  useEffect(() => {
    if (!urlSessionId || urlSessionIdHandled.current || phase !== 'empty') return;
    const id = parseInt(urlSessionId, 10);
    if (isNaN(id)) return;
    urlSessionIdHandled.current = true;
    openReview(id);
  }, [urlSessionId, phase]);

  useEffect(() => {
    return () => {
      liveRef.current?.stop();
      liveRef.current = null;
    };
  }, []);

  // ── pending 을 블록으로 커밋 — 각 문장을 독립 블록으로 생성 (merge 없음) ──
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
    setBlocks((prev) => [...prev, newBlock]);
  }, []);

  // pending 강제 flush (pause/end/speaker-change/silence 시)
  const flushPending = useCallback(() => {
    const p = pendingRef.current;
    if (!p) return;
    commitPendingAsBlock(p, 'speech');
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
      navigate(`/notes/${sessionId}`, { replace: true });

      // 저장된 답변 있는 질문들 → 초기 상태 세팅 (답변 보기 버튼으로 시작)
      if (detail.detected_questions && detail.detected_questions.length > 0) {
        const readySet = new Set<number>();
        const dataInit: Record<number, { tier: string; answer: string; collapsed: boolean }> = {};
        detail.detected_questions.forEach((dq) => {
          if (dq.utterance_id && dq.answer_text) {
            readySet.add(dq.utterance_id);
            dataInit[dq.utterance_id] = {
              tier: dq.answer_tier || 'cached',
              answer: dq.answer_text,
              collapsed: true,  // 새로고침 시 기본 접힘 → "답변 보기" 표시
            };
          }
        });
        setAnswerReadySet(readySet);
        setAnswerData((prev) => {
          const next = { ...prev };
          Object.entries(dataInit).forEach(([k, v]) => {
            next[Number(k)] = { ...next[Number(k)], ...v };
          });
          return next;
        });
      }

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
      // paused 진입 시, 재개를 위해 기본 pendingConfig 구성 (참여자/언어/캡처모드 원본 유지).
      // capture_mode 는 DB 에 영속화 되어 있음 — web_conference 면 재개 시 탭 공유 다이얼로그가
      // 다시 떠서 사용자가 재선택해야 함 (새로고침 시 브라우저 권한 소실되는 것과 동일).
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
          captureMode: detail.capture_mode || 'microphone',
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
      // speech_final 기반 — 한 utterance = 한 문장. 즉시 블록으로 승격.
      // 2초 이내 같은 화자면 `commitPendingAsBlock` 내부에서 직전 블록과 merge.
      setInterimText('');
      pendingRef.current = null;
      setPending(null);

      const text = ev.transcript;
      const segStart = typeof ev.start === 'number' ? ev.start : null;
      const segEnd = typeof ev.end === 'number' ? ev.end : segStart;
      const dgSpeakerId = ev.deepgram_speaker_id ?? null;
      const speakerRowId = ev.speaker_id ?? null;

      // 서버가 보낸 is_self 로 speakersRef 즉시 갱신 (세션 새로고침 없이 "나" 라벨 반영)
      if (speakerRowId != null) {
        const existing = speakersRef.current.find((s) => s.id === speakerRowId);
        if (!existing) {
          const newSpeaker = {
            id: speakerRowId,
            deepgram_speaker_id: dgSpeakerId ?? 0,
            participant_name: null as string | null,
            is_self: ev.is_self ? 1 : 0,
          };
          speakersRef.current = [...speakersRef.current, newSpeaker];
          setActiveSession((prev) => prev ? { ...prev, speakers: speakersRef.current } : prev);
        } else if (ev.is_self && !existing.is_self) {
          speakersRef.current = speakersRef.current.map((s) =>
            s.id === speakerRowId ? { ...s, is_self: 1 } : s
          );
          setActiveSession((prev) => prev ? { ...prev, speakers: speakersRef.current } : prev);
        }
      }

      const newSegment: BlockSegment = {
        utteranceId: ev.utterance_id,
        original: text,
        translation: null,
        start: segStart,
        end: segEnd,
      };

      const buffer: PendingBuffer = {
        segments: [newSegment],
        firstStart: segStart,
        lastEnd: segEnd,
        dgSpeakerId,
        speakerRowId,
        speakerLabel: speakerLabelFor(speakerRowId, dgSpeakerId, { speakers: speakersRef.current, participants: activeSessionRef.current?.participants }),
      };
      // 질문 판정은 서버 enrichment 결과로만 (낙관 판정 제거 — 오판 방지)
      commitPendingAsBlock(buffer, 'speech');
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
      // enrichment의 is_question으로 block.kind 교정 (낙관 판정 덮어씀)
      const enrichedKind: BlockKind = ev.is_question ? 'question' : 'speech';
      setBlocks((prev) =>
        prev.map((block) => {
          let changed = false;
          const newSegs = block.segments.map((seg) => {
            if (seg.utteranceId !== ev.utterance_id) return seg;
            changed = true;
            return patch(seg);
          });
          if (!changed) return block;
          return { ...block, segments: newSegs, kind: enrichedKind };
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

    if ((ev as any).type === 'answer_ready') {
      const uttId = (ev as any).utterance_id as number;
      setAnswerReadySet((prev) => new Set(prev).add(uttId));
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

  // ── 녹음 시작 ──────────────────────────────────────────
  const startRecording = async () => {
    if (!activeSession) {
      setLiveError('활성 세션이 없습니다');
      return;
    }
    if (!pendingConfig) {
      const fallback: StartConfig = {
        title: activeSession.title,
        brief: activeSession.brief || '',
        participants: (activeSession.participants || []).map((p) => ({ name: p.name, role: p.role || '' })),
        meetingLanguages: activeSession.meeting_languages || ['ko'],
        translationLanguage: activeSession.translation_language || 'ko',
        answerLanguage: activeSession.answer_language || '',
        pastedContext: activeSession.pasted_context || '',
        documents: [],
        urls: [],
        captureMode: activeSession.capture_mode || 'microphone',
      };
      setPendingConfig(fallback);
    }
    setLiveError(null);

    const captureMode = pendingConfig?.captureMode || activeSession.capture_mode || 'microphone';
    if (captureMode === 'web_conference' && phase === 'paused') {
      setLiveNotice('탭 오디오 공유를 다시 선택해주세요. 공유 다이얼로그에서 "탭 오디오 공유" 체크를 확인하세요.');
    }
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
      let hint = msg;
      if (/Permission denied|NotAllowedError/i.test(msg)) {
        hint = '마이크 또는 탭 공유 권한이 거부되었습니다. 브라우저 주소창 좌측 자물쇠 아이콘에서 권한을 허용해주세요.';
      } else if (/tab|display/i.test(msg)) {
        hint = '탭 오디오 공유가 취소되었습니다. 다시 시도할 때 공유 다이얼로그에서 "탭 오디오 공유" 체크를 확인하세요.';
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
        capture_mode: cfg.captureMode,
        // 사용자 프로필 스냅샷 — 답변을 "나"로서 생성하기 위한 배경
        user_name: user?.name || undefined,
        user_bio: user?.bio || undefined,
        user_expertise: user?.expertise || undefined,
        user_organization: user?.organization || undefined,
        user_job_title: user?.job_title || undefined,
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
      navigate(`/notes/${created.id}`, { replace: true });
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

    // 각 utterance를 독립 블록으로 생성 (merge 없음 — 문장별 분리)
    for (const u of sess.utterances as QNoteUtterance[]) {
      const start = typeof u.start_time === 'number' ? u.start_time : null;
      const end = typeof u.end_time === 'number' ? u.end_time : start;
      const dgSp = u.speaker_id != null
        ? (speakerById.get(u.speaker_id)?.deepgram_speaker_id ?? null)
        : null;
      const text = u.original_text || '';
      const seg: BlockSegment = {
        utteranceId: u.id,
        original: text,
        translation: u.translated_text,
        start,
        end,
      };
      const single: PendingBuffer = {
        segments: [seg],
        firstStart: start,
        lastEnd: end,
        dgSpeakerId: dgSp,
        speakerRowId: u.speaker_id,
        speakerLabel: speakerLabelFor(u.speaker_id, dgSp, { speakers, participants: sess.participants }),
      };
      const kind: BlockKind = u.is_question ? 'question' : 'speech';
      out.push({
        id: `r${++counter}`,
        kind,
        speakerRowId: single.speakerRowId,
        speakerLabel: single.speakerLabel,
        timestamp: formatTime(single.firstStart),
        segments: single.segments.slice(),
        firstStart: single.firstStart,
        lastEnd: single.lastEnd,
        lastDgSpeakerId: single.dgSpeakerId,
      });
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

  // ── 답변 찾기 상태 ──
  const [answerData, setAnswerData] = useState<Record<number, {
    loading?: boolean;
    tier?: string;
    answer?: string;
    answer_translation?: string;
    error?: string;
    collapsed?: boolean;
    editedQuestion?: string;      // 수정된 질문 (undefined면 원본)
    mergedBlockIds?: string[];    // 합친 블록 ID 목록 (순서 유지)
  }>>({});
  const [answerReadySet, setAnswerReadySet] = useState<Set<number>>(new Set());
  const [editingQuestionId, setEditingQuestionId] = useState<number | null>(null);

  // 현재 합쳐진(숨겨진) 블록 ID set — 렌더링 시 스킵
  const hiddenBlockIds = useMemo(() => {
    const set = new Set<string>();
    Object.values(answerData).forEach((ad) => {
      ad.mergedBlockIds?.forEach((id) => set.add(id));
    });
    return set;
  }, [answerData]);

  // ── Merge 상태 localStorage persistence ──
  // 세션별로 merge 정보만 저장/복원 (답변/로딩 상태는 저장 안 함)
  const mergeStorageKey = activeSession ? `qnote-merge-${activeSession.id}` : null;

  // 세션 변경 시 저장된 merge 상태 복원
  useEffect(() => {
    if (!mergeStorageKey) return;
    try {
      const raw = localStorage.getItem(mergeStorageKey);
      if (!raw) return;
      const saved: Record<number, { editedQuestion?: string; mergedBlockIds?: string[] }> = JSON.parse(raw);
      setAnswerData((prev) => {
        const next = { ...prev };
        Object.entries(saved).forEach(([uttId, data]) => {
          const id = Number(uttId);
          next[id] = { ...next[id], editedQuestion: data.editedQuestion, mergedBlockIds: data.mergedBlockIds };
        });
        return next;
      });
    } catch { /* ignore parse errors */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mergeStorageKey]);

  // answerData 의 merge 관련 필드가 변경되면 localStorage 저장
  useEffect(() => {
    if (!mergeStorageKey) return;
    const toSave: Record<number, { editedQuestion?: string; mergedBlockIds?: string[] }> = {};
    Object.entries(answerData).forEach(([uttId, data]) => {
      if (data.editedQuestion !== undefined || (data.mergedBlockIds && data.mergedBlockIds.length > 0)) {
        toSave[Number(uttId)] = {
          editedQuestion: data.editedQuestion,
          mergedBlockIds: data.mergedBlockIds,
        };
      }
    });
    try {
      if (Object.keys(toSave).length > 0) {
        localStorage.setItem(mergeStorageKey, JSON.stringify(toSave));
      } else {
        localStorage.removeItem(mergeStorageKey);
      }
    } catch { /* storage full or unavailable */ }
  }, [answerData, mergeStorageKey]);

  const refreshActiveSession = useCallback(async () => {
    const sess = activeSessionRef.current;
    if (!sess) return;
    const refreshed = await getSession(sess.id);
    setActiveSession(refreshed);
    speakersRef.current = refreshed.speakers || [];
    // blocks 의 speakerRowId 를 서버 utterances 기준으로 즉시 갱신
    if (refreshed.utterances) {
      const uttMap = new Map(
        (refreshed.utterances as QNoteUtterance[]).map((u) => [u.id, u])
      );
      setBlocks((prev) =>
        prev.map((block) => {
          const uttId = block.segments[0]?.utteranceId;
          if (!uttId) return block;
          const u = uttMap.get(uttId);
          if (!u) return block;
          const newKind: BlockKind = u.is_question ? 'question' : 'speech';
          if (block.speakerRowId === u.speaker_id && block.kind === newKind) return block;
          return { ...block, speakerRowId: u.speaker_id, kind: newKind };
        })
      );
    }
  }, []);

  // 라이브 자동 하단 스크롤
  useEffect(() => {
    if (phase !== 'recording' && phase !== 'paused') return;
    const el = transcriptRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [blocks, pending, interimText, phase]);

  // ─── 블록 렌더 ─────────────────────────────────────
  const currentCaptureMode = pendingConfig?.captureMode || activeSession?.capture_mode || 'microphone';
  const isMicMode = currentCaptureMode === 'microphone';

  const renderBlock = (block: TranscriptBlock, _prevBlock: TranscriptBlock | null, blockIndex: number, visibleBlocks: TranscriptBlock[]) => {
    const originalText = joinText(block.segments);
    const { text: translatedText, hasAny, allTranslated } = joinTranslation(block.segments);

    const allOutOfScope = block.segments.length > 0 && block.segments.every((s) => s.outOfScope);

    const speakerCtx = { speakers: activeSession?.speakers || [], participants: activeSession?.participants };

    // 마이크 모드: 수동 지정된 이름(participant_name / is_self)만 표시. 자동 라벨("화자 1", "상대") 안 붙음.
    let liveLabel = '';
    if (isMicMode) {
      if (block.speakerRowId != null) {
        const match = speakerCtx.speakers.find((s) => s.id === block.speakerRowId);
        if (match?.is_self) liveLabel = '나';
        else if (match?.participant_name) liveLabel = match.participant_name;
      }
    } else {
      liveLabel = speakerLabelFor(block.speakerRowId, block.lastDgSpeakerId, speakerCtx);
    }

    const isSelfSpeaker = block.speakerRowId != null &&
      speakerCtx.speakers.some((s) => s.id === block.speakerRowId && s.is_self);

    // 문장 단위 화자 변경 (utterance 기반)
    const uttId = block.segments[0]?.utteranceId;
    const renderAssignBtn = () => {
      if (!speakerAssignAllowed || !uttId) return null;
      // 현재 블록에 이미 지정된 화자 이름 (팝오버에서 제외하기 위해)
      const currentSpeaker = speakerCtx.speakers.find((s) => s.id === block.speakerRowId);
      const currentSpeakerName = currentSpeaker?.participant_name || null;
      const currentIsSelf = currentSpeaker?.is_self ?? false;
      return (
        <SpeakerAssignWrap>
          <SpeakerAssignBtn
            onClick={(e: React.MouseEvent) => {
              e.stopPropagation();
              setSpeakerPopoverFor((prev) => (prev === block.id ? null : block.id));
            }}
          >
            ▾
          </SpeakerAssignBtn>
          {speakerPopoverFor === block.id && (
            <SpeakerPopover
              currentSpeakerName={currentSpeakerName}
              currentIsSelf={currentIsSelf}
              participants={activeSession?.participants || []}
              onClose={() => setSpeakerPopoverFor(null)}
              onAssignName={async (name) => {
                const sess = activeSessionRef.current;
                if (!sess) return;
                setAssignSaving(true);
                try {
                  await reassignUtteranceSpeaker(sess.id, uttId, { participant_name: name });
                  await refreshActiveSession();
                  setSpeakerPopoverFor(null);
                } finally {
                  setAssignSaving(false);
                }
              }}
              onAssignSelf={async () => {
                const sess = activeSessionRef.current;
                if (!sess) return;
                setAssignSaving(true);
                try {
                  await reassignUtteranceSpeaker(sess.id, uttId, { is_self: true });
                  await refreshActiveSession();
                  setSpeakerPopoverFor(null);
                } finally {
                  setAssignSaving(false);
                }
              }}
              disabled={assignSaving}
            />
          )}
        </SpeakerAssignWrap>
      );
    };

    // 마이크 모드: 화자를 모르므로 모든 질문이 카드
    // 웹 화상회의: 내 질문은 카드 아님 (기존 규칙)
    const showAsQuestion = isMicMode
      ? block.kind === 'question'
      : block.kind === 'question' && !isSelfSpeaker;

    if (showAsQuestion) {
      const questionUttId = block.segments[0]?.utteranceId;
      const ad = questionUttId ? answerData[questionUttId] : undefined;
      const hasReadyAnswer = questionUttId ? answerReadySet.has(questionUttId) : false;
      const hasAnswer = ad && !ad.loading && ad.answer && !ad.error;
      const isCollapsed = ad?.collapsed ?? false;
      const isEditing = editingQuestionId === questionUttId;

      const fetchTranslation = (sessId: number, uttId: number, answerText: string) => {
        translateAnswer(sessId, answerText)
          .then((res) => {
            if (res.translation) {
              setAnswerData((prev) => {
                const cur = prev[uttId];
                if (!cur) return prev;
                return { ...prev, [uttId]: { ...cur, answer_translation: res.translation } };
              });
            }
          })
          .catch(() => {});
      };

      const doSearch = async (searchText: string) => {
        if (!questionUttId || !activeSessionRef.current) return;
        const sessId = activeSessionRef.current.id;

        setAnswerData((prev) => ({ ...prev, [questionUttId]: { ...prev[questionUttId], loading: true, error: undefined, collapsed: false } }));

        // 수정 안 한 원본이면 캐시 시도
        if (searchText === originalText) {
          try {
            const cached = await getCachedAnswer(sessId, questionUttId);
            setAnswerData((prev) => ({
              ...prev,
              [questionUttId]: {
                ...prev[questionUttId],
                tier: cached.answer_tier || 'cached',
                answer: cached.answer,
                loading: false,
                collapsed: false,
              },
            }));
            fetchTranslation(sessId, questionUttId, cached.answer);
            return;
          } catch { /* 캐시 없음 */ }
        }

        try {
          const result = await findAnswer(sessId, searchText, questionUttId);
          if (result.tier === 'none') {
            setAnswerData((prev) => ({
              ...prev,
              [questionUttId]: { ...prev[questionUttId], answer: '등록된 자료에서 답을 찾지 못했습니다.', tier: 'none', loading: false, collapsed: false },
            }));
          } else {
            setAnswerData((prev) => ({
              ...prev,
              [questionUttId]: {
                ...prev[questionUttId],
                tier: result.tier,
                answer: result.answer || '',
                answer_translation: result.answer_translation || undefined,
                loading: false,
                collapsed: false,
              },
            }));
            if (result.answer && !result.answer_translation) {
              fetchTranslation(sessId, questionUttId, result.answer);
            }
          }
        } catch (err) {
          setAnswerData((prev) => ({
            ...prev,
            [questionUttId]: { ...prev[questionUttId], error: err instanceof Error ? err.message : '답변 찾기 실패', loading: false },
          }));
        }
      };

      const handleBtnClick = () => {
        if (!questionUttId) return;
        if (ad?.loading) return;
        if (hasAnswer) {
          // 답변 있음 → 접기/펼치기 토글
          setAnswerData((prev) => ({
            ...prev,
            [questionUttId]: { ...prev[questionUttId], collapsed: !isCollapsed },
          }));
        } else {
          // 답변 없음 → 검색
          const searchText = ad?.editedQuestion ?? originalText;
          doSearch(searchText);
        }
      };

      // 질문 텍스트 수정 시작
      const startEdit = () => {
        if (!questionUttId) return;
        setEditingQuestionId(questionUttId);
      };

      const commitEdit = (newText: string) => {
        if (!questionUttId) return;
        setEditingQuestionId(null);
        const trimmed = newText.trim();
        if (!trimmed || trimmed === originalText) {
          // 원본과 같거나 빈 값 → 수정 취소, editedQuestion 제거
          setAnswerData((prev) => {
            const cur = { ...prev[questionUttId] };
            delete cur.editedQuestion;
            return { ...prev, [questionUttId]: cur };
          });
          return;
        }
        // 수정됨 → 기존 답변 클리어 + 새 질문으로 자동 검색
        setAnswerData((prev) => ({
          ...prev,
          [questionUttId]: { editedQuestion: trimmed },
        }));
        doSearch(trimmed);
      };

      // 다음 블록 텍스트 합치기 (다음 블록은 숨김 처리)
      const handleMergeNext = () => {
        if (!questionUttId) return;
        const nextBlock = visibleBlocks[blockIndex + 1];
        if (!nextBlock) return;
        const nextText = joinText(nextBlock.segments);
        if (!nextText) return;
        const currentText = ad?.editedQuestion || originalText;
        const merged = currentText + ' ' + nextText;
        const prevMergedIds = ad?.mergedBlockIds || [];
        setAnswerData((prev) => ({
          ...prev,
          [questionUttId]: {
            ...prev[questionUttId],
            editedQuestion: merged,
            mergedBlockIds: [...prevMergedIds, nextBlock.id],
          },
        }));
        doSearch(merged);
      };

      // 합친 블록 분리 — 숨김 해제 + 질문 원본 복귀
      const handleUnmerge = () => {
        if (!questionUttId) return;
        setAnswerData((prev) => {
          const cur = { ...prev[questionUttId] };
          delete cur.editedQuestion;
          delete cur.mergedBlockIds;
          delete cur.answer;
          delete cur.answer_translation;
          delete cur.tier;
          delete cur.collapsed;
          return { ...prev, [questionUttId]: cur };
        });
      };

      const hasNextBlock = blockIndex + 1 < visibleBlocks.length;
      const mergedCount = ad?.mergedBlockIds?.length || 0;

      return (
        <QuestionCard key={block.id}>
          <QuestionCardHeader>
            <QuestionHeaderLeft>
              {liveLabel && <SpeakerInline $self={isSelfSpeaker}>{liveLabel}</SpeakerInline>}
              {renderAssignBtn()}
              <QuestionInlineLabel>
                <HelpCircleIcon size={11} />
              </QuestionInlineLabel>
              {isEditing ? (
                <QuestionEditInput
                  defaultValue={ad?.editedQuestion ?? originalText}
                  autoFocus
                  onBlur={(e) => commitEdit(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); commitEdit(e.currentTarget.value); }
                    if (e.key === 'Escape') {
                      setEditingQuestionId(null);
                    }
                  }}
                />
              ) : (
                <QuestionOriginal onClick={startEdit} title="클릭하여 수정" style={{ cursor: 'text' }}>
                  {ad?.editedQuestion || originalText}
                  {ad?.editedQuestion && <EditedMark>(수정됨)</EditedMark>}
                  {mergedCount > 0 && <MergedBadge>+{mergedCount} 합침</MergedBadge>}
                </QuestionOriginal>
              )}
              {hasNextBlock && !isEditing && (
                <MergeNextBtn onClick={handleMergeNext} title="다음 문장 합치기">+</MergeNextBtn>
              )}
              {mergedCount > 0 && !isEditing && (
                <UnmergeBtn onClick={handleUnmerge} title="합친 문장 분리">분리</UnmergeBtn>
              )}
              <InlineTime>{block.timestamp}</InlineTime>
            </QuestionHeaderLeft>
            {hasAnswer ? (
              <CollapseBtn onClick={handleBtnClick}>
                {isCollapsed ? '답변 보기' : '답변 접기'}
              </CollapseBtn>
            ) : (
              <FindAnswerBtn
                onClick={handleBtnClick}
                disabled={ad?.loading}
                $ready={hasReadyAnswer}
              >
                답변 생성
              </FindAnswerBtn>
            )}
          </QuestionCardHeader>
          <QuestionContentArea>
            {hasAny && !isEditing && (
              <QuestionTranslation>
                {translatedText}
                {!allTranslated && <PendingHint> ...</PendingHint>}
              </QuestionTranslation>
            )}
            {hasAnswer && !isCollapsed && (
              <AnswerPanel>
                <AnswerTierBadge $tier={ad.tier || 'general'}>
                  {ad.tier === 'custom' ? '등록 답변' : ad.tier === 'generated' ? 'AI 사전 답변' : ad.tier === 'rag' ? '자료 기반' : ad.tier === 'none' ? '미발견' : 'AI 답변'}
                </AnswerTierBadge>
                <AnswerText>{ad.answer}</AnswerText>
                {ad.answer_translation ? (
                  <AnswerTranslation>{ad.answer_translation}</AnswerTranslation>
                ) : ad.tier !== 'none' ? (
                  <AnswerTranslation style={{ fontStyle: 'italic', color: '#94a3b8' }}>번역 중...</AnswerTranslation>
                ) : null}
              </AnswerPanel>
            )}
            {ad?.loading && <AnswerLoading>답변 검색 중...</AnswerLoading>}
            {ad?.error && <AnswerError>{ad.error}</AnswerError>}
          </QuestionContentArea>
        </QuestionCard>
      );
    }

    return (
      <SpeechBlockWrap key={block.id} $dimmed={allOutOfScope}>
        <SpeechRow>
          {liveLabel && <SpeakerInline $self={isSelfSpeaker}>{liveLabel}</SpeakerInline>}
          {renderAssignBtn()}
          <SpeechOriginal>{originalText}</SpeechOriginal>
          <InlineTime>{block.timestamp}</InlineTime>
        </SpeechRow>
        {!allOutOfScope && hasAny && (
          <SpeechTranslation>
            {translatedText}
            {!allTranslated && <PendingHint> ...</PendingHint>}
          </SpeechTranslation>
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
            const isActive = activeSession?.id === session.id;
            const statusLabel =
              session.status === 'recording' ? '녹음 중' :
              session.status === 'paused' ? '일시 중지' :
              session.status === 'completed' ? '종료' : '대기';
            const statusColor =
              session.status === 'recording' ? '#dc2626' :
              session.status === 'paused' ? '#f59e0b' :
              session.status === 'completed' ? '#64748b' : '#94a3b8';
            const participants = session.participants || [];
            const participantNames = participants.map((p) => p.name).join(', ');
            return (
              <SessionItem
                key={session.id}
                $active={isActive}
                onClick={() => openReview(session.id)}
              >
                <SessionItemRow>
                  <SessionItemTitle>{session.title}</SessionItemTitle>
                  <SessionStatusBadge style={{ color: statusColor, borderColor: statusColor }}>{statusLabel}</SessionStatusBadge>
                </SessionItemRow>
                <SessionItemMeta>
                  <span>{new Date(session.created_at).toLocaleDateString()}</span>
                  {session.utterance_count > 0 && (
                    <>
                      <Dot>·</Dot>
                      <span>{session.utterance_count}문장</span>
                    </>
                  )}
                  {participantNames && (
                    <>
                      <Dot>·</Dot>
                      <SessionParticipants>{participantNames}</SessionParticipants>
                    </>
                  )}
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
                {editingTitle ? (
                  <SessionTitleInput
                    defaultValue={activeSession.title}
                    autoFocus
                    onBlur={(e) => handleTitleSave(e.currentTarget.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); handleTitleSave(e.currentTarget.value); }
                      if (e.key === 'Escape') setEditingTitle(false);
                    }}
                  />
                ) : (
                  <SessionTitle onClick={() => setEditingTitle(true)} title="클릭하여 수정">
                    {activeSession.title}
                  </SessionTitle>
                )}
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

            <ParticipantBar>
              <ParticipantBarLabel>참여자 ({(activeSession.participants?.length ?? 0) + 1}명)</ParticipantBarLabel>
              <ParticipantPill key="self">나</ParticipantPill>
              {(activeSession.participants || []).map((p, i) => (
                <ParticipantPill key={i}>
                  {p.name}
                  {p.role && <ParticipantPillRole>{p.role}</ParticipantPillRole>}
                </ParticipantPill>
              ))}
            </ParticipantBar>

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

              {renderBlocks.filter((b) => !hiddenBlockIds.has(b.id)).map((block, idx, arr) => renderBlock(block, idx > 0 ? arr[idx - 1] : null, idx, arr))}
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
                {editingTitle ? (
                  <SessionTitleInput
                    defaultValue={activeSession.title}
                    autoFocus
                    onBlur={(e) => handleTitleSave(e.currentTarget.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); handleTitleSave(e.currentTarget.value); }
                      if (e.key === 'Escape') setEditingTitle(false);
                    }}
                  />
                ) : (
                  <SessionTitle onClick={() => setEditingTitle(true)} title="클릭하여 수정">
                    {activeSession.title}
                  </SessionTitle>
                )}
                <SessionMeta>
                  <Badge>리뷰</Badge>
                  <Badge>{activeSession.utterance_count}문장</Badge>
                </SessionMeta>
              </HeaderLeft>
              <HeaderRight>
                <SecondaryBtn>요약 생성</SecondaryBtn>
                <SecondaryBtn>질문 보기</SecondaryBtn>
              </HeaderRight>
            </MainHeader>

            <ParticipantBar>
              <ParticipantBarLabel>참여자 ({(activeSession.participants?.length ?? 0) + 1}명)</ParticipantBarLabel>
              <ParticipantPill key="self">나</ParticipantPill>
              {(activeSession.participants || []).map((p, i) => (
                <ParticipantPill key={i}>
                  {p.name}
                  {p.role && <ParticipantPillRole>{p.role}</ParticipantPillRole>}
                </ParticipantPill>
              ))}
            </ParticipantBar>

            <Transcript>
              {renderBlocks.length === 0 && <EmptyTranscript>기록된 문장이 없습니다.</EmptyTranscript>}
              {renderBlocks.filter((b) => !hiddenBlockIds.has(b.id)).map((block, idx, arr) => renderBlock(block, idx > 0 ? arr[idx - 1] : null, idx, arr))}
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
  currentSpeakerName: string | null;
  currentIsSelf: boolean | number;
  participants: ParticipantLite[];
  onClose: () => void;
  onAssignName: (name: string) => Promise<void>;
  onAssignSelf: () => Promise<void>;
  disabled: boolean;
}

const SpeakerPopover = ({ currentSpeakerName, currentIsSelf, participants, onClose, onAssignName, onAssignSelf, disabled }: SpeakerPopoverProps) => {
  const [customName, setCustomName] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const t = window.setTimeout(() => document.addEventListener('click', onDocClick), 0);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener('click', onDocClick);
    };
  }, [onClose]);

  // 이미 지정된 화자 제외: 현재 블록의 화자 이름과 같은 참여자는 숨김
  const filteredParticipants = participants.filter(
    (p) => p.name !== currentSpeakerName
  );

  // "나" 버튼: 이미 "나"로 지정된 블록이면 숨김
  const showSelfBtn = !currentIsSelf;

  return (
    <PopoverWrap ref={ref} onClick={(e) => e.stopPropagation()}>
      <PopoverTitle>이 사람은</PopoverTitle>
      {showSelfBtn && (
        <PopoverBtn onClick={onAssignSelf} disabled={disabled} $primary>
          나
        </PopoverBtn>
      )}
      {filteredParticipants.length > 0 && (
        <>
          <PopoverDivider />
          <PopoverLabel>등록된 참여자</PopoverLabel>
          {filteredParticipants.map((p) => (
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
      {!showSelfBtn && filteredParticipants.length === 0 && (
        <PopoverHint>회의 시작 시 참여자를 등록하면 여기서 선택할 수 있습니다</PopoverHint>
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

const PopoverHint = styled.div`
  font-size: 11px;
  color: #94a3b8;
  padding: 6px 8px;
  line-height: 1.4;
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

const SessionItemRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
`;

const SessionItemTitle = styled.div`
  font-size: 14px;
  font-weight: 600;
  color: #0f172a;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
  min-width: 0;
`;

const SessionStatusBadge = styled.span`
  flex-shrink: 0;
  font-size: 10px;
  font-weight: 700;
  border: 1px solid;
  border-radius: 4px;
  padding: 1px 6px;
  white-space: nowrap;
`;

const SessionParticipants = styled.span`
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 120px;
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
  cursor: text;
  &:hover { color: #475569; }
`;

const SessionTitleInput = styled.input`
  font-size: 20px;
  font-weight: 700;
  color: #0f172a;
  margin: 0;
  border: 1px solid #14b8a6;
  border-radius: 4px;
  padding: 0 4px;
  outline: none;
  background: #f0fdfa;
  min-width: 200px;
  &:focus { border-color: #0d9488; }
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

const ParticipantBar = styled.div`
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin: 8px 32px 0;
  padding: 8px 12px;
  background: #f8fafc;
  border-radius: 8px;
`;

const ParticipantBarLabel = styled.span`
  font-size: 11px;
  font-weight: 600;
  color: #94a3b8;
  letter-spacing: 0.03em;
`;

const ParticipantPill = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  font-weight: 500;
  color: #115e59;
  background: #f0fdfa;
  border: 1px solid #ccfbf1;
  border-radius: 12px;
  padding: 3px 10px;
`;

const ParticipantPillRole = styled.span`
  font-size: 10px;
  font-weight: 400;
  color: #64748b;
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
  gap: 2px;
  opacity: ${(p) => (p.$dimmed ? 0.45 : 1)};
`;

const SpeakerInline = styled.span<{ $self: boolean }>`
  flex-shrink: 0;
  font-size: 12px;
  font-weight: 700;
  color: ${(p) => (p.$self ? '#0d9488' : '#6366f1')};
  margin-right: 6px;
`;

const SpeechRow = styled.div`
  display: flex;
  align-items: baseline;
  gap: 8px;
`;

const InlineTime = styled.span`
  font-size: 11px;
  color: #cbd5e1;
  white-space: nowrap;
  flex-shrink: 0;
`;

const SpeakerAssignWrap = styled.span`
  position: relative;
  display: inline-flex;
  flex-shrink: 0;
  margin-right: 8px;
`;

const SpeakerAssignBtn = styled.button`
  font-size: 11px;
  color: #94a3b8;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 4px;
  cursor: pointer;
  padding: 2px 6px;
  white-space: nowrap;
  &:hover { color: #0d9488; border-color: #99f6e4; background: #f0fdfa; }
`;

const BlockHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 2px;
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
  padding-left: 8px;
`;

// ─── 질문 카드 — 세로 레이아웃 (헤더: 질문+버튼 / 본문: 번역+답변) ─
const QuestionCard = styled.div`
  display: flex;
  flex-direction: column;
  background: #ffffff;
  border: 1px solid #fecdd3;
  border-left: 4px solid #f43f5e;
  border-radius: 10px;
  padding: 12px 16px;
  box-shadow: 0 1px 3px rgba(244, 63, 94, 0.06);
`;

const QuestionCardHeader = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 12px;
`;

const QuestionHeaderLeft = styled.div`
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 6px;
`;

const QuestionContentArea = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const CollapseBtn = styled.button`
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  white-space: nowrap;
  background: #ffffff;
  color: #64748b;
  border: 1px solid #e2e8f0;
  height: 34px;
  padding: 0 14px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 120ms;
  &:hover { background: #f8fafc; color: #475569; border-color: #cbd5e1; }
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
  flex: 1;
`;

const QuestionEditInput = styled.input`
  font-size: 15px;
  font-weight: 600;
  color: #0f172a;
  line-height: 1.55;
  flex: 1;
  border: 1px solid #f43f5e;
  border-radius: 4px;
  padding: 2px 6px;
  outline: none;
  background: #fff1f2;
  &:focus { border-color: #e11d48; }
`;

const EditedMark = styled.span`
  font-size: 11px;
  font-weight: 400;
  color: #f43f5e;
  margin-left: 6px;
`;

const MergeNextBtn = styled.button`
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  border-radius: 4px;
  border: 1px solid #fecdd3;
  background: #fff1f2;
  color: #f43f5e;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
  &:hover { background: #fecdd3; }
`;

const UnmergeBtn = styled.button`
  flex-shrink: 0;
  height: 22px;
  padding: 0 8px;
  border-radius: 4px;
  border: 1px solid #e2e8f0;
  background: #ffffff;
  color: #64748b;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  line-height: 1;
  &:hover { background: #f8fafc; color: #475569; border-color: #cbd5e1; }
`;

const MergedBadge = styled.span`
  display: inline-flex;
  align-items: center;
  margin-left: 6px;
  padding: 1px 6px;
  font-size: 10px;
  font-weight: 700;
  color: #9f1239;
  background: #ffe4e6;
  border-radius: 4px;
  vertical-align: middle;
`;

const QuestionTranslation = styled.div`
  font-size: 13px;
  color: #64748b;
  line-height: 1.5;
  word-break: break-word;
  padding-left: 8px;
`;

// TranslationPending 제거 — 번역이 없으면 영역 자체를 숨김 (placeholder 대신)

const PendingHint = styled.span`
  color: #cbd5e1;
  font-style: italic;
`;

const FindAnswerBtn = styled.button<{ $ready?: boolean }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  white-space: nowrap;
  background: ${(p) => (p.$ready ? '#e11d48' : '#f43f5e')};
  color: #ffffff;
  border: none;
  height: 34px;
  padding: 0 14px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: background 120ms;
  ${(p) => p.$ready && 'animation: pulse-ready 1.5s ease-in-out 2;'}
  &:hover:not(:disabled) { background: #e11d48; }
  &:disabled {
    background: #fecdd3;
    cursor: not-allowed;
  }
  @keyframes pulse-ready {
    0%, 100% { box-shadow: none; }
    50% { box-shadow: 0 0 0 3px rgba(244, 63, 94, 0.3); }
  }
`;

// ─── 답변 표시 패널 ─────
const AnswerPanel = styled.div`
  margin-top: 8px;
  padding: 10px 12px;
  background: #fefce8;
  border: 1px solid #fef08a;
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const AnswerTierBadge = styled.span<{ $tier: string }>`
  font-size: 10px;
  font-weight: 700;
  color: ${(p) =>
    p.$tier === 'custom' ? '#15803d' :
    p.$tier === 'generated' ? '#1d4ed8' :
    p.$tier === 'rag' ? '#9333ea' :
    p.$tier === 'none' ? '#94a3b8' : '#64748b'};
  text-transform: uppercase;
  letter-spacing: 0.04em;
`;

const AnswerText = styled.div`
  font-size: 14px;
  color: #0f172a;
  line-height: 1.6;
  white-space: pre-wrap;
`;

const AnswerTranslation = styled.div`
  font-size: 13px;
  color: #64748b;
  line-height: 1.55;
  border-top: 1px solid #fef08a;
  padding-top: 6px;
  margin-top: 2px;
`;

const AnswerLoading = styled.div`
  margin-top: 6px;
  font-size: 12px;
  color: #94a3b8;
  font-style: italic;
`;

const AnswerError = styled.div`
  margin-top: 6px;
  font-size: 12px;
  color: #dc2626;
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
