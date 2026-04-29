import { useState, useMemo, useRef, useEffect } from 'react';
import styled from 'styled-components';
import { useTranslation, Trans } from 'react-i18next';
import PlanQSelect from '../../components/Common/PlanQSelect';
import {
  MicIcon,
  MonitorIcon,
  CloseIcon,
  PlusIcon,
  FileTextIcon,
} from '../../components/Common/Icons';
import { LANGUAGES, getDefaultLanguageFromBrowser } from '../../constants/languages';
import { ALL_CAPTURE_CAPABILITIES } from '../../services/audio';
import type { CaptureMode } from '../../services/audio';
import {
  downloadPriorityQATemplate,
  uploadPriorityQAFile,
  getSession,
  listQAPairs,
  deletePriorityQA,
  deletePriorityQAByFile,
  refreshSessionVocabulary,
} from '../../services/qnote';
import type { QAPair, QNoteDocument } from '../../services/qnote';
import { apiFetch, useAuth } from '../../contexts/AuthContext';
import FilePicker, { type FilePickerResult } from '../../components/Common/FilePicker';
import { fetchWorkspaceFiles } from '../../services/files';

interface Props {
  open: boolean;
  userLanguage?: string; // 사용자 프로필 language (회의 시작 시 자동으로 번역 대상 됨)
  // 편집 모드 — 기존 세션 수정. onStart 대신 onSave 가 호출되고 "회의 진행" 버튼이 "저장" 으로 바뀜
  editMode?: boolean;
  initialConfig?: Partial<StartConfig>;
  // 편집 모드에서 세션이 이미 존재하므로 파일 drop/select 시 바로 업로드 가능
  editingSessionId?: number;
  onClose: () => void;
  onStart: (config: StartConfig) => void;
}

export interface Participant {
  name: string;
  role: string;
}

export interface PriorityQAItem {
  question: string;
  answer: string;
  shortAnswer?: string;
  keywords?: string;
}

export interface StartConfig {
  title: string;
  brief: string;
  participants: Participant[];
  meetingLanguages: string[];
  translationLanguage: string;
  answerLanguage: string;
  captureMode: CaptureMode;
  documents: File[];
  // 사이클 O4 — 워크스페이스에서 link 한 기존 파일 IDs (재업로드 X)
  workspaceFileIds: number[];
  pastedContext: string;
  urls: string[];
  priorityQAs: PriorityQAItem[];
  priorityQACsv: File | null;
  meetingAnswerStyle: string;
  meetingAnswerLength: 'short' | 'medium' | 'long';
  // NOTE: STT 보정용 어휘 사전은 서버가 세션 생성 시 자동 추출 (UI 노출 없음)
}

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_FILES = 5;
const MAX_TEXT_CHARS = 100_000;

const ACCEPTED_TYPES = ['.pdf', '.docx', '.txt', '.md'];
const ACCEPTED_MIME = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'text/markdown',
];

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// 언어를 PlanQSelect 옵션으로 변환 (텍스트만)
function langToOption() {
  return LANGUAGES.filter((l) => l.deepgram).map((lang) => ({
    value: lang.code,
    label: lang.label,
    description: lang.native !== lang.label ? lang.native : undefined,
  }));
}

// 사용자 모국어 라벨 lookup (Hint 표시용)
function getLanguageLabel(code: string): string {
  return LANGUAGES.find((l) => l.code === code)?.label || code;
}

const StartMeetingModal = ({ open, userLanguage, editMode, initialConfig, editingSessionId, onClose, onStart }: Props) => {
  const { t } = useTranslation('qnote');
  const effectiveUserLanguage = userLanguage || getDefaultLanguageFromBrowser();
  const [title, setTitle] = useState('');
  const [brief, setBrief] = useState('');
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [pName, setPName] = useState('');
  const [pRole, setPRole] = useState('');
  const [meetingLang, setMeetingLang] = useState<string>('');
  const [translationLang, setTranslationLang] = useState<string>(effectiveUserLanguage);
  const [answerLang, setAnswerLang] = useState<string>('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [captureMode, setCaptureMode] = useState<CaptureMode>('web_conference');
  const [documents, setDocuments] = useState<File[]>([]);
  // 사이클 O4 — 워크스페이스 파일 link (재업로드 X)
  const [workspaceFileIds, setWorkspaceFileIds] = useState<number[]>([]);
  const [workspaceFileMeta, setWorkspaceFileMeta] = useState<Record<number, { name: string; size: number }>>({});
  const [filePickerOpen, setFilePickerOpen] = useState(false);
  const { user } = useAuth();
  const businessId = user?.business_id ? Number(user.business_id) : null;
  const handleWorkspaceFilePick = async (result: FilePickerResult) => {
    if (!result.existingFileIds || result.existingFileIds.length === 0 || !businessId) return;
    setWorkspaceFileIds(prev => [...new Set([...prev, ...result.existingFileIds!])]);
    try {
      const all = await fetchWorkspaceFiles(businessId);
      setWorkspaceFileMeta(prev => {
        const next = { ...prev };
        for (const id of result.existingFileIds!) {
          const f = all.find(x => x.id === `direct-${id}`);
          if (f) next[id] = { name: f.file_name, size: f.file_size };
        }
        return next;
      });
    } catch { /* skip */ }
  };
  const removeWorkspaceFile = (id: number) => {
    setWorkspaceFileIds(prev => prev.filter(x => x !== id));
    setWorkspaceFileMeta(prev => { const next = { ...prev }; delete next[id]; return next; });
  };
  const [pastedContext, setPastedContext] = useState('');
  const [urls, setUrls] = useState<string[]>([]);
  const [urlInput, setUrlInput] = useState('');
  const [fileError, setFileError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Priority Q&A (최우선 답변)
  const [priorityQAs, setPriorityQAs] = useState<PriorityQAItem[]>([]);
  const [pqQuestion, setPqQuestion] = useState('');
  const [pqAnswer, setPqAnswer] = useState('');
  const [pqShortAnswer, setPqShortAnswer] = useState('');
  const [pqKeywords, setPqKeywords] = useState('');
  const [priorityCsv, setPriorityCsv] = useState<File | null>(null);
  const [priorityCsvDragging, setPriorityCsvDragging] = useState(false);
  const [priorityCsvUploading, setPriorityCsvUploading] = useState(false);
  const [priorityCsvResult, setPriorityCsvResult] = useState<string | null>(null);
  const priorityCsvInputRef = useRef<HTMLInputElement>(null);

  // 회의별 답변 스타일 + 길이
  const [meetingAnswerStyle, setMeetingAnswerStyle] = useState('');
  const [meetingAnswerLength, setMeetingAnswerLength] = useState<'short' | 'medium' | 'long'>('medium');

  // 초안 자동저장 (localStorage) — 모달 닫아도 입력 보존
  const DRAFT_KEY = 'qnote_meeting_draft_v1';
  const [draftRestored, setDraftRestored] = useState(false);
  const hasDraftRef = useRef(false);

  // 편집 모드 — 기존에 저장된 자료 (DB 에서 로드)
  const [existingPriorityQAs, setExistingPriorityQAs] = useState<QAPair[]>([]);
  const [existingDocuments, setExistingDocuments] = useState<QNoteDocument[]>([]);
  const [loadingExisting, setLoadingExisting] = useState(false);

  // 편집 모드 — 어휘사전 (STT 교정용). 서버가 자동 추출한 것 + 사용자 수동 편집
  const [sessionKeywords, setSessionKeywords] = useState<string[]>([]);
  const [keywordInput, setKeywordInput] = useState('');
  const [refreshingVocab, setRefreshingVocab] = useState(false);

  // 본인 음성 핑거프린트 등록 여부 — 미등록이면 본인 자동 인식 불가능 → 배너로 안내

  const allLangOptions = useMemo(() => langToOption(), []);

  // 모달 열릴 때 localStorage 초안 복원 (있으면) 또는 초기화
  useEffect(() => {
    if (!open) {
      setDraftRestored(false);
      return;
    }
    // 먼저 전부 리셋
    setPName('');
    setPRole('');
    setPqQuestion('');
    setPqAnswer('');
    setPqShortAnswer('');
    setPqKeywords('');
    setUrlInput('');
    setFileError(null);
    setIsDragging(false);
    setDocuments([]);
    setPriorityCsv(null);

    // 편집 모드 — initialConfig 로 채우고 초안 복원 건너뜀
    if (editMode && initialConfig) {
      setTitle(initialConfig.title || '');
      setBrief(initialConfig.brief || '');
      setParticipants(initialConfig.participants || []);
      setMeetingLang(initialConfig.meetingLanguages?.[0] || '');
      setTranslationLang(initialConfig.translationLanguage || effectiveUserLanguage);
      setAnswerLang(initialConfig.answerLanguage || '');
      setShowAdvanced(true);
      setCaptureMode(initialConfig.captureMode || 'web_conference');
      setPastedContext(initialConfig.pastedContext || '');
      setUrls(initialConfig.urls || []);
      setPriorityQAs(initialConfig.priorityQAs || []);
      setMeetingAnswerStyle(initialConfig.meetingAnswerStyle || '');
      setMeetingAnswerLength(initialConfig.meetingAnswerLength || 'medium');
      hasDraftRef.current = false;
      setDraftRestored(false);

      // 기존 자료를 DB 에서 로드 (documents + priority Q&A + keywords)
      if (editingSessionId) {
        setLoadingExisting(true);
        (async () => {
          try {
            const [sess, pqs] = await Promise.all([
              getSession(editingSessionId),
              listQAPairs(editingSessionId, 'priority'),
            ]);
            setExistingDocuments(sess.documents || []);
            setExistingPriorityQAs(pqs || []);
            setSessionKeywords(Array.isArray(sess.keywords) ? sess.keywords : []);
          } catch (err) {
            console.error('Failed to load existing materials:', err);
          } finally {
            setLoadingExisting(false);
          }
        })();
      }
      return;
    }

    // 신규 생성 모드 — 기존 자료 상태 비움
    setExistingDocuments([]);
    setExistingPriorityQAs([]);
    setSessionKeywords([]);
    setKeywordInput('');

    // 저장된 초안 복원 시도
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const d = JSON.parse(raw);
        setTitle(d.title || '');
        setBrief(d.brief || '');
        setParticipants(Array.isArray(d.participants) ? d.participants : []);
        setMeetingLang(d.meetingLang || '');
        setTranslationLang(d.translationLang || effectiveUserLanguage);
        setAnswerLang(d.answerLang || '');
        setShowAdvanced(!!d.showAdvanced);
        setCaptureMode(d.captureMode || 'web_conference');
        setPastedContext(d.pastedContext || '');
        setUrls(Array.isArray(d.urls) ? d.urls : []);
        setPriorityQAs(Array.isArray(d.priorityQAs) ? d.priorityQAs : []);
        setMeetingAnswerStyle(d.meetingAnswerStyle || '');
        setMeetingAnswerLength((['short','medium','long'].includes(d.meetingAnswerLength) ? d.meetingAnswerLength : 'medium') as 'short'|'medium'|'long');
        hasDraftRef.current = true;
        setDraftRestored(true);
        return;
      }
    } catch { /* ignore parse errors */ }

    // 초안 없으면 전부 빈 값
    hasDraftRef.current = false;
    setTitle('');
    setBrief('');
    setParticipants([]);
    setMeetingLang('');
    setTranslationLang(effectiveUserLanguage);
    setAnswerLang('');
    setShowAdvanced(false);
    setCaptureMode('web_conference');
    setPastedContext('');
    setUrls([]);
    setPriorityQAs([]);
    setMeetingAnswerStyle('');
    setMeetingAnswerLength('medium');
  }, [open, effectiveUserLanguage]);

  // 초안 자동 저장 — 필드 변경 시 debounce 500ms. 편집 모드는 저장 안 함.
  useEffect(() => {
    if (!open || editMode) return;
    const handle = setTimeout(() => {
      try {
        const draft = {
          title, brief, participants,
          meetingLang, translationLang, answerLang, showAdvanced,
          captureMode, pastedContext, urls,
          priorityQAs, meetingAnswerStyle, meetingAnswerLength,
        };
        // 전부 비어있으면 저장하지 않음 (빈 초안 유령 방지)
        const hasAny = title || brief || participants.length || meetingLang ||
          pastedContext || urls.length || priorityQAs.length || meetingAnswerStyle;
        if (hasAny) {
          localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
          hasDraftRef.current = true;
        } else {
          localStorage.removeItem(DRAFT_KEY);
          hasDraftRef.current = false;
        }
      } catch { /* ignore quota errors */ }
    }, 500);
    return () => clearTimeout(handle);
  }, [open, title, brief, participants, meetingLang, translationLang, answerLang,
      showAdvanced, captureMode, pastedContext, urls, priorityQAs, meetingAnswerStyle, meetingAnswerLength]);

  const clearDraft = () => {
    try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
    hasDraftRef.current = false;
    setDraftRestored(false);
    setTitle('');
    setBrief('');
    setParticipants([]);
    setPName('');
    setPRole('');
    setMeetingLang('');
    setTranslationLang(effectiveUserLanguage);
    setAnswerLang('');
    setShowAdvanced(false);
    setCaptureMode('web_conference');
    setDocuments([]);
    setPastedContext('');
    setUrls([]);
    setUrlInput('');
    setPriorityQAs([]);
    setPqQuestion('');
    setPqAnswer('');
    setPqShortAnswer('');
    setPqKeywords('');
    setPriorityCsv(null);
    setPriorityCsvResult(null);
    setMeetingAnswerStyle('');
    setMeetingAnswerLength('medium');
  };

  if (!open) return null;

  const selectedMeetingOpt = allLangOptions.find((o) => o.value === meetingLang) || null;
  const selectedTranslationOpt = allLangOptions.find((o) => o.value === translationLang) || null;

  const canStart = !!meetingLang;

  const showFileError = (msg: string) => {
    setFileError(msg);
    setTimeout(() => setFileError(null), 4000);
  };

  const addFiles = (files: FileList | File[]) => {
    const incoming = Array.from(files);
    const accepted: File[] = [];
    for (const f of incoming) {
      const ext = '.' + (f.name.split('.').pop() || '').toLowerCase();

      if (!ACCEPTED_TYPES.includes(ext) && !ACCEPTED_MIME.includes(f.type)) {
        showFileError(t('startModal.fileError.unsupported', { name: f.name }));
        continue;
      }
      if (f.size === 0) {
        showFileError(t('startModal.fileError.empty', { name: f.name }));
        continue;
      }
      if (f.size > MAX_FILE_SIZE) {
        showFileError(t('startModal.fileError.tooLarge', { name: f.name }));
        continue;
      }
      if (documents.length + accepted.length >= MAX_FILES) {
        showFileError(t('startModal.fileError.tooMany', { max: MAX_FILES }));
        break;
      }
      // 중복 검사 (이름 + 크기)
      if (
        documents.some((d) => d.name === f.name && d.size === f.size) ||
        accepted.some((d) => d.name === f.name && d.size === f.size)
      ) {
        showFileError(t('startModal.fileError.duplicate', { name: f.name }));
        continue;
      }
      accepted.push(f);
    }
    if (accepted.length > 0) setDocuments((prev) => [...prev, ...accepted]);
  };

  const removeFile = (index: number) => {
    setDocuments((prev) => prev.filter((_, i) => i !== index));
  };

  const addParticipant = () => {
    const name = pName.trim();
    if (!name) return;
    setParticipants((prev) => [...prev, { name, role: pRole.trim() }]);
    setPName('');
    setPRole('');
  };

  const removeParticipant = (idx: number) => {
    setParticipants((prev) => prev.filter((_, i) => i !== idx));
  };

  const addUrl = () => {
    const url = urlInput.trim();
    if (!url) return;
    if (!/^https?:\/\//.test(url)) {
      showFileError(t('startModal.fileError.urlInvalid'));
      return;
    }
    if (urls.includes(url)) {
      showFileError(t('startModal.fileError.urlDuplicate'));
      return;
    }
    setUrls((prev) => [...prev, url]);
    setUrlInput('');
  };

  const removeUrl = (idx: number) => {
    setUrls((prev) => prev.filter((_, i) => i !== idx));
  };

  const addPriorityQA = () => {
    const q = pqQuestion.trim();
    const a = pqAnswer.trim();
    if (!q || !a) return;
    const sa = pqShortAnswer.trim();
    const kw = pqKeywords.trim();
    setPriorityQAs((prev) => [...prev, {
      question: q, answer: a,
      shortAnswer: sa || undefined,
      keywords: kw || undefined,
    }]);
    setPqQuestion('');
    setPqAnswer('');
    setPqShortAnswer('');
    setPqKeywords('');
  };

  const removePriorityQA = (idx: number) => {
    setPriorityQAs((prev) => prev.filter((_, i) => i !== idx));
  };

  const PQ_ALLOWED_EXT = ['csv', 'tsv', 'xlsx', 'xls', 'json', 'txt', 'md', 'pdf', 'docx', 'doc'];

  const handlePriorityCsvSelect = async (f: File | null) => {
    if (!f) {
      setPriorityCsv(null);
      setPriorityCsvResult(null);
      return;
    }
    if (f.size > 10 * 1024 * 1024) {
      showFileError(t('startModal.fileError.priorityTooLarge', '파일이 너무 큽니다 (최대 10MB)'));
      return;
    }
    const ext = (f.name.split('.').pop() || '').toLowerCase();
    if (!PQ_ALLOWED_EXT.includes(ext)) {
      showFileError(t('startModal.fileError.priorityUnsupported', { name: f.name, formats: PQ_ALLOWED_EXT.join(', ') }));
      return;
    }
    setPriorityCsv(f);
    setPriorityCsvResult(null);

    // 편집 모드 + 세션 ID 있으면 **즉시 업로드**
    if (editMode && editingSessionId) {
      setPriorityCsvUploading(true);
      try {
        const res = await uploadPriorityQAFile(editingSessionId, f);
        const parts = [];
        if (res.created) parts.push(t('startModal.priority.uploadResultCreated', { count: res.created }));
        if (res.updated) parts.push(t('startModal.priority.uploadResultUpdated', { count: res.updated }));
        let msg = parts.length ? parts.join(', ') + t('startModal.priority.uploadResultRegister', ' 등록') : t('startModal.priority.uploadResultNoChange', '변경 없음');
        if (res.errors && res.errors.length > 0) msg += t('startModal.priority.uploadResultWarnings', { count: res.errors.length });
        setPriorityCsvResult(msg);
        // 성공 시 드롭존 파일 상태 비움 (파일 박스는 "기존 파일 목록"으로 넘어감)
        if (res.created || res.updated) {
          setPriorityCsv(null);
        }
      } catch (err) {
        const detail = err instanceof Error ? err.message : t('startModal.priority.uploadFailUnknown', '알 수 없는 오류');
        setPriorityCsvResult(t('startModal.priority.uploadFail', { msg: detail }));
        showFileError(t('startModal.priority.uploadFailShort', { msg: err instanceof Error ? err.message : '' }));
      } finally {
        setPriorityCsvUploading(false);
      }
      // 업로드 후 기존 목록 재조회
      if (editingSessionId) {
        try {
          const pqs = await listQAPairs(editingSessionId, 'priority');
          setExistingPriorityQAs(pqs || []);
        } catch { /* ignore */ }
      }
    }
  };

  const handleDeleteExistingPriorityFile = async (filename: string) => {
    if (!editingSessionId) return;
    try {
      await deletePriorityQAByFile(editingSessionId, filename);
      setExistingPriorityQAs((prev) => prev.filter((q) => q.source_filename !== filename));
    } catch (err) {
      showFileError(err instanceof Error ? err.message : t('startModal.priority.deleteFail', '파일 삭제 실패'));
    }
  };

  const handleDeleteExistingPriority = async (qaId: number) => {
    if (!editingSessionId) return;
    try {
      await deletePriorityQA(editingSessionId, qaId);
      setExistingPriorityQAs((prev) => prev.filter((q) => q.id !== qaId));
    } catch (err) {
      showFileError(err instanceof Error ? err.message : t('startModal.priority.deleteQAFail', 'Q&A 삭제 실패'));
    }
  };

  const handleDeleteExistingDocument = async (docId: number) => {
    if (!editingSessionId) return;
    try {
      const res = await apiFetch(`/qnote/api/sessions/${editingSessionId}/documents/${docId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setExistingDocuments((prev) => prev.filter((d) => d.id !== docId));
    } catch (err) {
      showFileError(err instanceof Error ? err.message : t('startModal.priority.deleteDocFail', '문서 삭제 실패'));
    }
  };

  // 어휘사전 — 즉시 PUT session.keywords
  const saveKeywords = async (next: string[]) => {
    setSessionKeywords(next);
    if (!editingSessionId) return;
    try {
      const res = await apiFetch(`/qnote/api/sessions/${editingSessionId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keywords: next }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      showFileError(err instanceof Error ? err.message : t('startModal.vocabulary.saveFail', '어휘사전 저장 실패'));
    }
  };

  const addSessionKeyword = () => {
    const items = keywordInput.split(/[,\n]/).map((s) => s.trim()).filter((s) => s.length >= 2 && s.length <= 80);
    if (items.length === 0) return;
    const seen = new Set(sessionKeywords.map((k) => k.toLowerCase()));
    const next = [...sessionKeywords];
    for (const k of items) {
      if (!seen.has(k.toLowerCase())) {
        seen.add(k.toLowerCase());
        next.push(k);
      }
    }
    saveKeywords(next.slice(0, 200));
    setKeywordInput('');
  };

  const removeSessionKeyword = (idx: number) => {
    saveKeywords(sessionKeywords.filter((_, i) => i !== idx));
  };

  // 어휘 재추출 — 현재 인덱싱된 문서 기반으로 다시 뽑고 기존에 합침
  const handleRefreshVocab = async () => {
    if (!editingSessionId) return;
    setRefreshingVocab(true);
    try {
      const res = await refreshSessionVocabulary(editingSessionId);
      setSessionKeywords(res.keywords || []);
    } catch (err) {
      showFileError(err instanceof Error ? err.message : t('startModal.vocabulary.refreshFail', '어휘 재추출 실패'));
    } finally {
      setRefreshingVocab(false);
    }
  };


  const handleStart = () => {
    // 입력 중인 참여자 이름이 "+ 추가" 없이 남아있으면 자동으로 포함.
    // 사용자가 한 명만 입력하고 엔터/버튼 없이 바로 "회의 시작"을 눌러도 저장되도록.
    const pendingName = pName.trim();
    const pendingRole = pRole.trim();
    const finalParticipants = pendingName
      ? [...participants, { name: pendingName, role: pendingRole }]
      : participants;

    // 입력 중인 priority Q&A 자동 포함
    const pendingPQ = pqQuestion.trim() && pqAnswer.trim()
      ? [{
          question: pqQuestion.trim(),
          answer: pqAnswer.trim(),
          shortAnswer: pqShortAnswer.trim() || undefined,
          keywords: pqKeywords.trim() || undefined,
        }]
      : [];
    const finalPriorityQAs = [...priorityQAs, ...pendingPQ];

    // 회의 시작 성공 → 초안 삭제
    try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
    hasDraftRef.current = false;

    onStart({
      title: title.trim() || t('startModal.defaultTitle'),
      brief: brief.trim(),
      participants: finalParticipants,
      meetingLanguages: [meetingLang],
      translationLanguage: translationLang || (meetingLang === 'ko' ? 'en' : 'ko'),
      answerLanguage: answerLang || meetingLang,
      captureMode,
      documents,
      workspaceFileIds: workspaceFileIds,
      pastedContext: pastedContext.trim(),
      urls,
      priorityQAs: finalPriorityQAs,
      priorityQACsv: priorityCsv,
      meetingAnswerStyle: meetingAnswerStyle.trim(),
      meetingAnswerLength,
    });
  };

  return (
    <Backdrop onClick={onClose}>
      <ModalBox role="dialog" aria-modal="true" aria-label={editMode ? (t('startModal.editHeader', '회의 설정 편집') as string) : (t('startModal.header') as string)} onClick={(e) => e.stopPropagation()}>
        <Header>
          <Title>{editMode ? t('startModal.editHeaderTitle', '회의 설정 편집') : t('startModal.header')}</Title>
          <HeaderRight>
            {!editMode && draftRestored && (
              <>
                <DraftBadge>{t('startModal.draftRestored', '초안 복원됨')}</DraftBadge>
                <DraftResetBtn type="button" onClick={clearDraft} title={t('startModal.draftClearTitle', '저장된 초안을 지우고 처음부터 새로 시작') as string}>
                  {t('startModal.draftClear', '초안 지우기')}
                </DraftResetBtn>
              </>
            )}
            <CloseBtn onClick={onClose} aria-label={t('startModal.closeLabel')}>
              <CloseIcon size={18} />
            </CloseBtn>
          </HeaderRight>
        </Header>

        <Body>
          {editMode && (
            <EditModeBanner>
              <strong>{t('startModal.editBanner.prefix', '편집 모드')}</strong>{t('startModal.editBanner.body', ' — 기존 자료는 DB 에 안전하게 저장되어 있습니다. 여기서 ')}<strong>{t('startModal.editBanner.addHighlight', '추가한 항목은 기존 자료에 합쳐')}</strong>{t('startModal.editBanner.middle', '지며, ')}<strong>{t('startModal.editBanner.removeHighlight', '✗ 버튼으로 개별 삭제')}</strong>{t('startModal.editBanner.suffix', '할 수 있습니다.')}
              {loadingExisting && <span style={{ marginLeft: 8, color: '#0d9488' }}>{t('startModal.editBanner.loading', '(기존 자료 불러오는 중...)')}</span>}
            </EditModeBanner>
          )}
          <Field>
            <Label>{t('startModal.titleLabel')}</Label>
            <Input
              type="text"
              placeholder={t('startModal.titlePlaceholder')}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={100}
            />
          </Field>

          <Field>
            <Label>{t('startModal.briefLabel')}</Label>
            <Hint>{t('startModal.briefHint')}</Hint>
            <TextArea
              placeholder={t('startModal.briefPlaceholder')}
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              maxLength={2000}
              rows={4}
            />
            <CharCount>{brief.length} / 2000</CharCount>
          </Field>

          <Field>
            <Label>{t('startModal.participantsLabel')}</Label>
            <Hint>{t('startModal.participantsHint')}</Hint>
            {participants.length > 0 && (
              <ParticipantList>
                {participants.map((p, idx) => (
                  <ParticipantRow key={idx}>
                    <ParticipantName>{p.name}</ParticipantName>
                    {p.role && <ParticipantRole>{p.role}</ParticipantRole>}
                    <RemoveBtn onClick={() => removeParticipant(idx)} aria-label={t('startModal.removeLabel')}>
                      <CloseIcon size={14} />
                    </RemoveBtn>
                  </ParticipantRow>
                ))}
              </ParticipantList>
            )}
            <ParticipantInputs>
              <ParticipantInput
                placeholder={t('startModal.participantNamePlaceholder')}
                value={pName}
                onChange={(e) => setPName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addParticipant();
                  }
                }}
              />
              <ParticipantInput
                placeholder={t('startModal.participantRolePlaceholder')}
                value={pRole}
                onChange={(e) => setPRole(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addParticipant();
                  }
                }}
              />
              <AddRowBtn type="button" onClick={addParticipant} disabled={!pName.trim()}>
                <PlusIcon size={14} />
              </AddRowBtn>
            </ParticipantInputs>
          </Field>

          <Field>
            <Label>
              {t('startModal.meetingLanguageLabel')} <Required>*</Required>
            </Label>
            <PlanQSelect
              options={allLangOptions}
              value={selectedMeetingOpt}
              onChange={(opt: any) => setMeetingLang(opt?.value || '')}
              placeholder={t('startModal.meetingLanguagePlaceholder')}
            />
          </Field>

          {showAdvanced ? (
            <AdvancedSection>
              <AdvancedToggle onClick={() => setShowAdvanced(false)}>
                {t('startModal.advancedHide')}
              </AdvancedToggle>
              <LangRow>
                <Field>
                  <Label>{t('startModal.translationLanguageLabel')}</Label>
                  <PlanQSelect
                    options={allLangOptions}
                    value={selectedTranslationOpt}
                    onChange={(opt: any) => setTranslationLang(opt?.value || effectiveUserLanguage)}
                    placeholder={t('startModal.translationLanguagePlaceholder')}
                  />
                  <Hint>{t('startModal.translationHint', { lang: getLanguageLabel(effectiveUserLanguage) })}</Hint>
                </Field>
                <Field>
                  <Label>{t('startModal.answerLanguageLabel')}</Label>
                  <PlanQSelect
                    options={allLangOptions}
                    value={allLangOptions.find((o) => o.value === answerLang) || null}
                    onChange={(opt: any) => setAnswerLang(opt?.value || meetingLang)}
                    placeholder={t('startModal.answerLanguagePlaceholder')}
                  />
                </Field>
              </LangRow>
            </AdvancedSection>
          ) : (
            <AdvancedToggle onClick={() => setShowAdvanced(true)}>
              {t('startModal.advancedShow')}
            </AdvancedToggle>
          )}

          <Field>
            <PriorityLabel>
              <PriorityBadge>{t('startModal.priority.badge', '최우선')}</PriorityBadge>
              {t('startModal.priority.label', 'Q&A 자료 (답변 1순위)')}
              {editMode && existingPriorityQAs.length > 0 && (
                <ExistingCount>{t('startModal.priority.totalCount', { count: existingPriorityQAs.length })}</ExistingCount>
              )}
            </PriorityLabel>
            <Hint>
              {t('startModal.priority.intro1', '여기에 등록한 Q&A는 ')}<strong>{t('startModal.priority.introStrong', '다른 모든 자료보다 먼저')}</strong>{t('startModal.priority.intro2', ' 사용됩니다. 파일 업로드 또는 직접 입력 두 가지 방식 모두 지원합니다.')}
            </Hint>

            {/* ── 1) 파일 업로드 영역 (먼저) ── */}
            <input
              ref={priorityCsvInputRef}
              type="file"
              accept=".csv,.tsv,.xlsx,.xls,.json,.txt,.md,.pdf,.docx,.doc"
              hidden
              onChange={(e) => {
                handlePriorityCsvSelect(e.target.files?.[0] || null);
                if (e.target) e.target.value = '';
              }}
            />
            <CSVDropzone
              $dragging={priorityCsvDragging}
              $uploading={priorityCsvUploading}
              onClick={() => !priorityCsvUploading && priorityCsvInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setPriorityCsvDragging(true); }}
              onDragLeave={() => setPriorityCsvDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setPriorityCsvDragging(false);
                const f = e.dataTransfer.files?.[0];
                if (f) handlePriorityCsvSelect(f);
              }}
            >
              <DropzoneIcon>
                <FileTextIcon size={20} />
              </DropzoneIcon>
              <DropzoneText>
                {priorityCsvUploading
                  ? t('startModal.priority.uploading', '업로드 중... (PDF/DOCX 는 LLM 추출로 20~30초 걸릴 수 있습니다)')
                  : priorityCsv
                    ? priorityCsv.name
                    : t('startModal.priority.dropHint', '파일 끌어다 놓거나 클릭해서 선택')}
                <DropzoneSubText>
                  {priorityCsvResult
                    ? priorityCsvResult
                    : editMode
                      ? t('startModal.priority.uploadNowSub', 'CSV · Excel · JSON · TXT · MD · PDF · DOCX — 선택 즉시 업로드')
                      : t('startModal.priority.uploadLaterSub', 'CSV · Excel · JSON · TXT · MD · PDF · DOCX — 회의 시작 시 업로드')}
                </DropzoneSubText>
              </DropzoneText>
              {priorityCsv && !priorityCsvUploading && (
                <RemoveBtn
                  onClick={(e) => { e.stopPropagation(); handlePriorityCsvSelect(null); }}
                  aria-label={t('startModal.removeLabel')}
                >
                  <CloseIcon size={14} />
                </RemoveBtn>
              )}
            </CSVDropzone>

            {/* ── 2) 업로드된 파일 목록 (드롭존 바로 아래 — 업로드 즉시 여기서 확인) ── */}
            {editMode && existingPriorityQAs.filter((p) => p.source_filename).length > 0 && (() => {
              const byFile = new Map<string, QAPair[]>();
              for (const pq of existingPriorityQAs) {
                if (pq.source_filename) {
                  const arr = byFile.get(pq.source_filename) || [];
                  arr.push(pq);
                  byFile.set(pq.source_filename, arr);
                }
              }
              return (
                <FileList>
                  {Array.from(byFile.entries()).map(([fname, items]) => (
                    <FileRow key={`file:${fname}`}>
                      <FileIcon>
                        <FileTextIcon size={14} />
                      </FileIcon>
                      <PQQuestionText title={items.map((i) => i.question_text).join('\n')}>
                        {fname} <span style={{ color: '#888', fontWeight: 400 }}>· {t('startModal.priority.itemCount', { count: items.length })}</span>
                      </PQQuestionText>
                      <RemoveBtn
                        onClick={() => handleDeleteExistingPriorityFile(fname)}
                        aria-label={t('startModal.removeLabel')}
                      >
                        <CloseIcon size={14} />
                      </RemoveBtn>
                    </FileRow>
                  ))}
                </FileList>
              );
            })()}

            <TemplateLink
              type="button"
              onClick={async () => {
                try {
                  await downloadPriorityQATemplate();
                } catch (err) {
                  showFileError(err instanceof Error ? err.message : t('startModal.priority.templateDownloadFail', '템플릿 다운로드 실패'));
                }
              }}
            >
              {t('startModal.priority.templateDownload', '샘플 CSV 다운로드 (컬럼명은 question/질문 · answer/답변 · short_answer · keywords · category 중 어떤 이름이든 OK)')}
            </TemplateLink>

            {/* ── 3) 직접 입력 영역 ── */}
            <Divider>
              <DividerText>{t('startModal.priority.divider', '또는 직접 입력')}</DividerText>
            </Divider>

            <PQRow>
              <ParticipantInput
                placeholder={t('startModal.priority.questionPlaceholder', '질문 예: 왜 이 주제를 선택했나요?') as string}
                value={pqQuestion}
                onChange={(e) => setPqQuestion(e.target.value)}
              />
            </PQRow>
            <PQRow>
              <TextArea
                placeholder={t('startModal.priority.answerPlaceholder', '정확한 답변 (말할 그대로, 길어도 OK)') as string}
                value={pqAnswer}
                onChange={(e) => setPqAnswer(e.target.value)}
                rows={2}
              />
            </PQRow>
            <PQRow>
              <ParticipantInput
                placeholder={t('startModal.priority.shortAnswerPlaceholder', "1문장 버전 (선택, 회의 답변 길이가 '짧게'일 때 우선 사용)") as string}
                value={pqShortAnswer}
                onChange={(e) => setPqShortAnswer(e.target.value)}
                maxLength={500}
              />
            </PQRow>
            <PQRow>
              <ParticipantInput
                placeholder={t('startModal.priority.keywordsPlaceholder', '핵심 키워드 (선택, 쉼표 구분 — 검색 속도·정확도 ↑)') as string}
                value={pqKeywords}
                onChange={(e) => setPqKeywords(e.target.value)}
                maxLength={500}
              />
              <AddRowBtn type="button" onClick={addPriorityQA} disabled={!pqQuestion.trim() || !pqAnswer.trim()}>
                <PlusIcon size={14} />
              </AddRowBtn>
            </PQRow>

            {/* ── 직접 입력한 것 (신규 + 기존 수동) 목록 ── */}
            {(() => {
              const manualExisting = editMode
                ? existingPriorityQAs.filter((p) => !p.source_filename)
                : [];
              if (manualExisting.length === 0 && priorityQAs.length === 0) return null;
              return (
                <FileList>
                  {manualExisting.map((pq) => (
                    <FileRow key={`existing:${pq.id}`}>
                      <FileIcon>
                        <FileTextIcon size={14} />
                      </FileIcon>
                      <PQQuestionText>{pq.question_text}</PQQuestionText>
                      <RemoveBtn onClick={() => handleDeleteExistingPriority(pq.id)} aria-label={t('startModal.removeLabel')}>
                        <CloseIcon size={14} />
                      </RemoveBtn>
                    </FileRow>
                  ))}
                  {priorityQAs.map((qa, idx) => (
                    <FileRow key={`new:${idx}`}>
                      <FileIcon>
                        <FileTextIcon size={14} />
                      </FileIcon>
                      <PQQuestionText>{qa.question}</PQQuestionText>
                      <RemoveBtn onClick={() => removePriorityQA(idx)} aria-label={t('startModal.removeLabel')}>
                        <CloseIcon size={14} />
                      </RemoveBtn>
                    </FileRow>
                  ))}
                </FileList>
              );
            })()}
          </Field>

          {editMode && (
            <Field>
              <Label>
                {t('startModal.vocabulary.label', '어휘사전 (STT 교정용)')}
                {sessionKeywords.length > 0 && <ExistingCount>{t('startModal.vocabulary.countSuffix', { count: sessionKeywords.length })}</ExistingCount>}
              </Label>
              <Hint>
                {t('startModal.vocabulary.hintPart1', '여기 등록된 단어는 ')}<strong>{t('startModal.vocabulary.hintStrong1', 'Deepgram 이 음성인식 시 우선 매칭')}</strong>{t('startModal.vocabulary.hintPart2', '하고, AI 가 "remote work" 같은 구절을 잘못 듣는 문제를 고쳐줍니다.')}
                <br />
                <strong>{t('startModal.vocabulary.hintStrong2', '업로드한 문서가 최우선 소스')}</strong>{t('startModal.vocabulary.hintPart3', '입니다. 문서 인덱싱이 끝나면 자동으로 재추출되며, 그 전이면 아래 "문서 기반 재추출" 버튼으로 즉시 뽑을 수 있습니다.')}
              </Hint>
              <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                <GenerateKeywordsBtn
                  type="button"
                  onClick={handleRefreshVocab}
                  disabled={refreshingVocab}
                  title={t('startModal.vocabulary.refreshTitle', '현재 인덱싱된 문서에서 어휘를 다시 추출 (기존 수동 추가 키워드는 유지)') as string}
                >
                  {refreshingVocab ? t('startModal.vocabulary.refreshing', '재추출 중...') : t('startModal.vocabulary.refresh', '📄 문서 기반 재추출')}
                </GenerateKeywordsBtn>
              </div>

              {sessionKeywords.length > 0 ? (
                <KeywordChipList>
                  {sessionKeywords.map((kw, idx) => (
                    <KeywordChip key={idx}>
                      <span>{kw}</span>
                      <KeywordChipRemove onClick={() => removeSessionKeyword(idx)} aria-label={t('startModal.removeLabel')}>
                        <CloseIcon size={11} />
                      </KeywordChipRemove>
                    </KeywordChip>
                  ))}
                </KeywordChipList>
              ) : (
                <EmptyHint>{t('startModal.vocabulary.empty', '자동 추출된 어휘가 없습니다. 아래에서 직접 추가하세요.')}</EmptyHint>
              )}

              <KeywordAddRow>
                <ParticipantInput
                  placeholder={t('startModal.vocabulary.addPlaceholder', '단어/구절 추가 (쉼표나 엔터로 여러 개 한번에)') as string}
                  value={keywordInput}
                  onChange={(e) => setKeywordInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addSessionKeyword();
                    }
                  }}
                />
                <AddRowBtn type="button" onClick={addSessionKeyword} disabled={!keywordInput.trim()}>
                  <PlusIcon size={14} />
                </AddRowBtn>
              </KeywordAddRow>
            </Field>
          )}

          <Field>
            <Label>{t('startModal.answerStyle.label', '답변 스타일 · 길이')}</Label>
            <Hint>
              {t('startModal.answerStyle.hint', '답변이 너무 어렵거나 길면 여기서 조정하세요. 말하기 좋은 단어로, 언어 레벨에 맞게 생성됩니다.')}
            </Hint>
            <LengthRow>
              <LengthBtn type="button" $active={meetingAnswerLength === 'short'} onClick={() => setMeetingAnswerLength('short')}>
                {t('startModal.answerStyle.short', '짧게 (1-2문장)')}
              </LengthBtn>
              <LengthBtn type="button" $active={meetingAnswerLength === 'medium'} onClick={() => setMeetingAnswerLength('medium')}>
                {t('startModal.answerStyle.medium', '보통 (2-3문장)')}
              </LengthBtn>
              <LengthBtn type="button" $active={meetingAnswerLength === 'long'} onClick={() => setMeetingAnswerLength('long')}>
                {t('startModal.answerStyle.long', '길게 (3-4문장)')}
              </LengthBtn>
            </LengthRow>
            <TextArea
              placeholder={t('startModal.answerStyle.stylePlaceholder', '예시: 짧고 자신감 있게. 전문용어 금지. 구체적 숫자 포함. 반드시 질문을 되묻지 말 것.') as string}
              value={meetingAnswerStyle}
              onChange={(e) => setMeetingAnswerStyle(e.target.value)}
              rows={3}
              maxLength={2000}
            />
          </Field>

          <Field>
            <Label>
              {t('startModal.materialsLabel')}
              {editMode && existingDocuments.length > 0 && (
                <ExistingCount>{t('startModal.materialsExisting', { count: existingDocuments.length })}</ExistingCount>
              )}
            </Label>
            <Hint>
              {t('startModal.materialsHintLine1')}
              <br />
              <Trans i18nKey="startModal.materialsHintLine2" ns="qnote" components={{ 1: <strong /> }} />
              <br />
              {t('startModal.materialsHintLine3')}
            </Hint>

            {/* 편집 모드: 기존 문서 목록 (읽기 + 삭제) */}
            {editMode && existingDocuments.length > 0 && (
              <FileList>
                {existingDocuments.map((doc) => (
                  <FileRow key={doc.id}>
                    <FileIcon>
                      <FileTextIcon size={14} />
                    </FileIcon>
                    <FileName>{doc.original_filename || doc.title || t('startModal.docName', { id: doc.id })}</FileName>
                    <FileSize>{doc.status === 'indexed' ? t('startModal.chunkUnit', { count: doc.chunk_count || 0 }) : doc.status}</FileSize>
                    <RemoveBtn onClick={() => handleDeleteExistingDocument(doc.id)} aria-label={t('startModal.removeLabel')}>
                      <CloseIcon size={14} />
                    </RemoveBtn>
                  </FileRow>
                ))}
              </FileList>
            )}

            {fileError && <ErrorBanner>{fileError}</ErrorBanner>}
            <Dropzone
              $dragging={isDragging}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragging(false);
                addFiles(e.dataTransfer.files);
              }}
            >
              <DropzoneIcon>
                <PlusIcon size={20} />
              </DropzoneIcon>
              <DropzoneText>
                {t('startModal.dropzoneText')}
                <DropzoneSubText>{t('startModal.dropzoneSub')}</DropzoneSubText>
              </DropzoneText>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept={ACCEPTED_TYPES.join(',')}
                hidden
                onChange={(e) => {
                  if (e.target.files) addFiles(e.target.files);
                  e.target.value = '';
                }}
              />
            </Dropzone>

            <PickerRow>
              <WorkspaceFileBtn type="button" onClick={() => setFilePickerOpen(true)}>
                {t('startModal.fromWorkspace', '+ 워크스페이스 파일에서')}
              </WorkspaceFileBtn>
              <PickerHint>{t('startModal.fromWorkspaceHint', '재업로드 없이 기존 파일을 회의 자료로 연결')}</PickerHint>
            </PickerRow>
            {workspaceFileIds.length > 0 && (
              <FileList>
                {workspaceFileIds.map(id => {
                  const meta = workspaceFileMeta[id];
                  return (
                    <FileRow key={`ws-${id}`}>
                      <FileIcon><FileTextIcon size={14} /></FileIcon>
                      <FileName>{meta?.name || `#${id}`}</FileName>
                      {meta?.size != null && <FileSize>{formatFileSize(meta.size)}</FileSize>}
                      <WorkspaceTag>{t('startModal.workspaceTag', '기존')}</WorkspaceTag>
                      <RemoveBtn onClick={() => removeWorkspaceFile(id)} aria-label={t('startModal.removeLabel')}>
                        <CloseIcon size={14} />
                      </RemoveBtn>
                    </FileRow>
                  );
                })}
              </FileList>
            )}
            {documents.length > 0 && (
              <FileList>
                {documents.map((file, idx) => (
                  <FileRow key={`${file.name}-${idx}`}>
                    <FileIcon>
                      <FileTextIcon size={14} />
                    </FileIcon>
                    <FileName>{file.name}</FileName>
                    <FileSize>{formatFileSize(file.size)}</FileSize>
                    <RemoveBtn onClick={() => removeFile(idx)} aria-label={t('startModal.removeLabel')}>
                      <CloseIcon size={14} />
                    </RemoveBtn>
                  </FileRow>
                ))}
              </FileList>
            )}

            <Divider>
              <DividerText>{t('startModal.dividerText')}</DividerText>
            </Divider>

            <TextArea
              placeholder={t('startModal.pastedPlaceholder')}
              value={pastedContext}
              onChange={(e) => setPastedContext(e.target.value)}
              maxLength={MAX_TEXT_CHARS}
              rows={4}
            />
            <CharCount>
              {pastedContext.length.toLocaleString()} / {MAX_TEXT_CHARS.toLocaleString()}
            </CharCount>

            <Divider>
              <DividerText>{t('startModal.dividerUrl')}</DividerText>
            </Divider>

            <UrlRow>
              <ParticipantInput
                placeholder={t('startModal.urlPlaceholder')}
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addUrl();
                  }
                }}
              />
              <AddRowBtn type="button" onClick={addUrl} disabled={!urlInput.trim()}>
                <PlusIcon size={14} />
              </AddRowBtn>
            </UrlRow>
            <Hint>{t('startModal.urlHint')}</Hint>

            {urls.length > 0 && (
              <FileList>
                {urls.map((u, idx) => (
                  <FileRow key={u}>
                    <FileIcon>
                      <FileTextIcon size={14} />
                    </FileIcon>
                    <FileName>{u}</FileName>
                    <UrlStatus>{t('startModal.urlStatusPending')}</UrlStatus>
                    <RemoveBtn onClick={() => removeUrl(idx)} aria-label={t('startModal.removeLabel')}>
                      <CloseIcon size={14} />
                    </RemoveBtn>
                  </FileRow>
                ))}
              </FileList>
            )}
          </Field>

          <Field>
            <Label>
              {t('startModal.captureLabel')} <Required>*</Required>
            </Label>
            <CaptureCards>
              {ALL_CAPTURE_CAPABILITIES.map((cap) => {
                const available = cap.isAvailable();
                const selected = captureMode === cap.mode;
                const Icon = cap.mode === 'web_conference' ? MonitorIcon : MicIcon;
                return (
                  <CaptureCard
                    key={cap.mode}
                    $selected={selected}
                    $disabled={!available}
                    onClick={() => available && setCaptureMode(cap.mode)}
                  >
                    <CaptureLabelRow>
                      <CaptureIconWrap $selected={selected}>
                        <Icon size={18} />
                      </CaptureIconWrap>
                      <CaptureLabel>
                        {cap.label}
                        {!available && <Unavailable>{t('startModal.unavailable')}</Unavailable>}
                      </CaptureLabel>
                    </CaptureLabelRow>
                    <CaptureDesc>{cap.description}</CaptureDesc>
                  </CaptureCard>
                );
              })}
            </CaptureCards>
          </Field>
        </Body>

        <Footer>
          <SecondaryBtn onClick={onClose}>{t('startModal.cancel')}</SecondaryBtn>
          <PrimaryBtn onClick={handleStart} disabled={!canStart}>
            {editMode ? t('startModal.saveBtn', '저장') : t('startModal.start')}
          </PrimaryBtn>
        </Footer>
      </ModalBox>
      {businessId && (
        <FilePicker
          open={filePickerOpen}
          onClose={() => setFilePickerOpen(false)}
          businessId={businessId}
          onPick={handleWorkspaceFilePick}
          title={t('startModal.fromWorkspace', '+ 워크스페이스 파일에서') as string}
          mode="existing"
          variant="modal"
          multiple
        />
      )}
    </Backdrop>
  );
};

export default StartMeetingModal;

// ─────────────────────────────────────────────────────────
// styled
// ─────────────────────────────────────────────────────────
const Backdrop = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
  padding: 20px;
`;

const ModalBox = styled.div`
  width: 100%;
  max-width: 640px;
  background: #ffffff;
  border-radius: 16px;
  box-shadow: 0 24px 64px rgba(15, 23, 42, 0.2);
  display: flex;
  flex-direction: column;
  max-height: calc(100vh - 40px);
  overflow: hidden;
`;

const Header = styled.div`
  padding: 24px 28px 16px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid #f1f5f9;
`;

const Title = styled.h2`
  font-size: 20px;
  font-weight: 700;
  color: #0f172a;
  margin: 0;
`;

const CloseBtn = styled.button`
  width: 32px;
  height: 32px;
  border-radius: 8px;
  border: none;
  background: transparent;
  color: #64748b;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  &:hover {
    background: #f1f5f9;
    color: #0f172a;
  }
`;

const Body = styled.div`
  padding: 24px 28px;
  display: flex;
  flex-direction: column;
  gap: 22px;
  overflow-y: auto;
`;

const Field = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const AdvancedSection = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

const AdvancedToggle = styled.button`
  font-size: 12px;
  font-weight: 500;
  color: #94a3b8;
  background: none;
  border: none;
  cursor: pointer;
  padding: 4px 0;
  text-align: left;
  &:hover { color: #64748b; }
`;

const LangRow = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  @media (max-width: 600px) {
    grid-template-columns: 1fr;
  }
`;

const Label = styled.label`
  font-size: 13px;
  font-weight: 600;
  color: #334155;
`;

const Required = styled.span`
  color: #dc2626;
`;

const Hint = styled.div`
  font-size: 12px;
  color: #94a3b8;
  margin-top: 2px;
`;

const Input = styled.input`
  height: 44px;
  padding: 0 14px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  font-size: 14px;
  color: #0f172a;
  transition: border-color 120ms, box-shadow 120ms;
  &::placeholder {
    color: #94a3b8;
  }
  &:focus {
    outline: none;
    border-color: #14b8a6;
    box-shadow: 0 0 0 3px rgba(20, 184, 166, 0.15);
  }
`;

const TextArea = styled.textarea`
  padding: 12px 14px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  font-size: 14px;
  color: #0f172a;
  font-family: inherit;
  line-height: 1.55;
  resize: vertical;
  min-height: 100px;
  transition: border-color 120ms, box-shadow 120ms;
  &::placeholder {
    color: #94a3b8;
    white-space: pre-line;
  }
  &:focus {
    outline: none;
    border-color: #14b8a6;
    box-shadow: 0 0 0 3px rgba(20, 184, 166, 0.15);
  }
`;

const CharCount = styled.div`
  font-size: 11px;
  color: #94a3b8;
  text-align: right;
  margin-top: -2px;
`;

const Dropzone = styled.div<{ $dragging: boolean }>`
  border: 2px dashed ${(p) => (p.$dragging ? '#14b8a6' : '#cbd5e1')};
  background: ${(p) => (p.$dragging ? '#f0fdfa' : '#f8fafc')};
  border-radius: 10px;
  padding: 20px 16px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  cursor: pointer;
  transition: all 120ms;
  &:hover {
    border-color: #14b8a6;
    background: #f0fdfa;
  }
`;

const DropzoneIcon = styled.div`
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #0d9488;
`;

const DropzoneText = styled.div`
  font-size: 13px;
  color: #64748b;
  font-weight: 500;
  text-align: center;
`;

const DropzoneSubText = styled.div`
  font-size: 11px;
  color: #94a3b8;
  font-weight: 400;
  margin-top: 2px;
`;

const Divider = styled.div`
  position: relative;
  text-align: center;
  margin: 4px 0;
  &::before {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    top: 50%;
    border-top: 1px solid #e2e8f0;
  }
`;

const PriorityLabel = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 600;
  color: #0f172a;
  margin-bottom: 4px;
`;

const EditModeBanner = styled.div`
  margin: -4px 0 12px;
  padding: 12px 14px;
  background: #f0fdfa;
  border: 1px solid #99f6e4;
  border-left: 3px solid #0d9488;
  border-radius: 8px;
  font-size: 12px;
  color: #134e4a;
  line-height: 1.55;
  strong { color: #0f766e; font-weight: 700; }
`;

const ExistingCount = styled.span`
  display: inline-flex;
  align-items: center;
  margin-left: auto;
  padding: 2px 8px;
  font-size: 11px;
  font-weight: 600;
  color: #0f766e;
  background: #ccfbf1;
  border-radius: 10px;
`;

const GenerateKeywordsBtn = styled.button`
  padding: 8px 14px;
  background: #ffffff;
  color: #0d9488;
  border: 1px solid #99f6e4;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 120ms;
  &:hover:not(:disabled) {
    background: #f0fdfa;
    border-color: #0d9488;
  }
  &:disabled {
    color: #cbd5e1;
    border-color: #e2e8f0;
    cursor: not-allowed;
  }
`;

const KeywordAddRow = styled.div`
  display: flex;
  gap: 6px;
  margin-top: 8px;
`;

const KeywordChipList = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
  padding: 10px;
  background: #f8fafc;
  border-radius: 8px;
  max-height: 200px;
  overflow-y: auto;
`;

const KeywordChip = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 4px 4px 10px;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  font-size: 12px;
  color: #0f172a;
`;

const KeywordChipRemove = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  padding: 0;
  background: none;
  border: none;
  border-radius: 50%;
  color: #94a3b8;
  cursor: pointer;
  &:hover { color: #dc2626; background: #fef2f2; }
`;

const EmptyHint = styled.div`
  padding: 12px;
  margin-top: 8px;
  background: #f8fafc;
  color: #94a3b8;
  font-size: 12px;
  text-align: center;
  border-radius: 8px;
`;

const PriorityBadge = styled.span`
  display: inline-flex;
  align-items: center;
  padding: 3px 8px;
  font-size: 10px;
  font-weight: 700;
  color: #ffffff;
  background: #f43f5e;
  border-radius: 4px;
  letter-spacing: 0.03em;
`;

const PQRow = styled.div`
  display: flex;
  gap: 6px;
  margin-top: 4px;
  align-items: flex-start;
`;

const PQQuestionText = styled.div`
  flex: 1;
  font-size: 13px;
  color: #0f172a;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const CSVDropzone = styled.div<{ $dragging?: boolean; $uploading?: boolean }>`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  border: 2px dashed ${(p) => (p.$dragging ? '#0d9488' : '#cbd5e1')};
  background: ${(p) => (p.$dragging ? '#f0fdfa' : p.$uploading ? '#f8fafc' : '#ffffff')};
  color: #475569;
  border-radius: 10px;
  cursor: ${(p) => (p.$uploading ? 'wait' : 'pointer')};
  transition: border-color 120ms, background 120ms;
  &:hover {
    ${(p) => !p.$uploading && 'border-color: #0d9488; background: #f0fdfa;'}
  }
`;

const LengthRow = styled.div`
  display: flex;
  gap: 6px;
  margin-bottom: 4px;
`;

const LengthBtn = styled.button<{ $active?: boolean }>`
  flex: 1;
  padding: 10px 12px;
  border: 1px solid ${(p) => (p.$active ? '#0d9488' : '#e2e8f0')};
  background: ${(p) => (p.$active ? '#0d9488' : '#ffffff')};
  color: ${(p) => (p.$active ? '#ffffff' : '#475569')};
  font-size: 12px;
  font-weight: 600;
  border-radius: 8px;
  cursor: pointer;
  transition: all 120ms;
  &:hover {
    border-color: ${(p) => (p.$active ? '#0f766e' : '#0d9488')};
  }
`;

const TemplateLink = styled.button`
  display: inline-block;
  margin-top: 6px;
  padding: 0;
  background: none;
  border: none;
  font-size: 11px;
  color: #0d9488;
  text-decoration: none;
  cursor: pointer;
  &:hover { text-decoration: underline; }
`;

const HeaderRight = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 10px;
`;

const DraftBadge = styled.span`
  display: inline-flex;
  align-items: center;
  padding: 3px 8px;
  font-size: 10px;
  font-weight: 700;
  color: #0f766e;
  background: #ccfbf1;
  border-radius: 4px;
  letter-spacing: 0.03em;
`;

const DraftResetBtn = styled.button`
  padding: 5px 10px;
  background: #ffffff;
  color: #64748b;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  transition: all 120ms;
  &:hover {
    background: #f8fafc;
    color: #dc2626;
    border-color: #fecaca;
  }
`;

const DividerText = styled.span`
  position: relative;
  background: #ffffff;
  padding: 0 12px;
  font-size: 11px;
  color: #94a3b8;
  font-weight: 500;
`;

const PickerRow = styled.div`
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 8px;
`;
const WorkspaceFileBtn = styled.button`
  height: 32px; padding: 0 12px;
  background: #FFFFFF; color: #0F766E;
  border: 1px solid #14B8A6; border-radius: 6px;
  font-size: 12px; font-weight: 600; cursor: pointer;
  transition: all 0.15s;
  &:hover { background: #F0FDFA; }
`;
const PickerHint = styled.div`
  font-size: 11px; color: #94A3B8;
`;
const WorkspaceTag = styled.span`
  flex-shrink: 0;
  padding: 1px 6px; border-radius: 4px;
  background: #F0FDFA; color: #0F766E;
  font-size: 10px; font-weight: 600;
`;
const FileList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 4px;
`;

const FileRow = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
`;

const FileIcon = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  background: #f0fdfa;
  color: #0d9488;
  border-radius: 6px;
  flex-shrink: 0;
`;

const FileName = styled.div`
  flex: 1;
  font-size: 13px;
  color: #0f172a;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const FileSize = styled.div`
  font-size: 11px;
  color: #94a3b8;
  flex-shrink: 0;
`;

const RemoveBtn = styled.button`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  background: transparent;
  border: none;
  border-radius: 4px;
  color: #94a3b8;
  cursor: pointer;
  flex-shrink: 0;
  &:hover {
    background: #f1f5f9;
    color: #475569;
  }
`;

const CaptureCards = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  @media (max-width: 600px) {
    grid-template-columns: 1fr;
  }
`;

const CaptureCard = styled.div<{ $selected: boolean; $disabled: boolean }>`
  border: 2px solid ${(p) => (p.$selected ? '#14b8a6' : '#e2e8f0')};
  background: ${(p) => (p.$selected ? '#f0fdfa' : '#ffffff')};
  border-radius: 12px;
  padding: 14px 16px;
  cursor: ${(p) => (p.$disabled ? 'not-allowed' : 'pointer')};
  opacity: ${(p) => (p.$disabled ? 0.5 : 1)};
  transition: all 150ms;
  &:hover {
    border-color: ${(p) => (p.$disabled ? '#e2e8f0' : '#14b8a6')};
  }
`;

const CaptureLabelRow = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 6px;
`;

const CaptureIconWrap = styled.div<{ $selected: boolean }>`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: ${(p) => (p.$selected ? '#ccfbf1' : '#f1f5f9')};
  color: ${(p) => (p.$selected ? '#0d9488' : '#64748b')};
`;

const CaptureLabel = styled.div`
  font-size: 14px;
  font-weight: 600;
  color: #0f172a;
`;

const Unavailable = styled.span`
  font-size: 12px;
  font-weight: 400;
  color: #94a3b8;
`;

const CaptureDesc = styled.div`
  font-size: 12px;
  color: #64748b;
  line-height: 1.4;
`;

const Footer = styled.div`
  padding: 16px 28px 24px;
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  border-top: 1px solid #f1f5f9;
`;

const SecondaryBtn = styled.button`
  height: 42px;
  padding: 0 22px;
  border: 1px solid #e2e8f0;
  background: #ffffff;
  color: #475569;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  &:hover {
    background: #f8fafc;
    border-color: #cbd5e1;
  }
`;

const PrimaryBtn = styled.button`
  height: 42px;
  padding: 0 26px;
  border: none;
  background: #14b8a6;
  color: #ffffff;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: background 120ms;
  &:hover:not(:disabled) {
    background: #0d9488;
  }
  &:active:not(:disabled) {
    background: #0f766e;
  }
  &:disabled {
    background: #cbd5e1;
    cursor: not-allowed;
  }
`;

const ParticipantList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 4px;
`;

const ParticipantRow = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
`;

const ParticipantName = styled.div`
  font-size: 14px;
  font-weight: 600;
  color: #0f172a;
  flex-shrink: 0;
`;

const ParticipantRole = styled.div`
  flex: 1;
  font-size: 12px;
  color: #64748b;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const ParticipantInputs = styled.div`
  display: grid;
  grid-template-columns: 1fr 1.4fr auto;
  gap: 6px;
`;

const ParticipantInput = styled.input`
  height: 38px;
  padding: 0 12px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  font-size: 13px;
  color: #0f172a;
  &::placeholder {
    color: #94a3b8;
  }
  &:focus {
    outline: none;
    border-color: #14b8a6;
    box-shadow: 0 0 0 3px rgba(20, 184, 166, 0.15);
  }
`;

const AddRowBtn = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  background: #14b8a6;
  color: #ffffff;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  &:hover:not(:disabled) {
    background: #0d9488;
  }
  &:disabled {
    background: #cbd5e1;
    cursor: not-allowed;
  }
`;

const UrlRow = styled.div`
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 6px;
`;

const UrlStatus = styled.span`
  font-size: 11px;
  color: #94a3b8;
  flex-shrink: 0;
  padding: 2px 8px;
  background: #f1f5f9;
  border-radius: 10px;
`;

const ErrorBanner = styled.div`
  padding: 10px 12px;
  background: #fff1f2;
  color: #9f1239;
  border: 1px solid #fecdd3;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
`;
