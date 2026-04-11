import { useState, useMemo, useRef, useEffect } from 'react';
import styled from 'styled-components';
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

interface Props {
  open: boolean;
  userLanguage?: string; // 사용자 프로필 language (회의 시작 시 자동으로 번역 대상 됨)
  onClose: () => void;
  onStart: (config: StartConfig) => void;
}

export interface Participant {
  name: string;
  role: string;
}

export interface StartConfig {
  title: string;
  brief: string;
  participants: Participant[];   // 자유 입력. 개별 또는 그룹.
  meetingLanguages: string[];
  translationLanguage: string;
  answerLanguage: string;
  captureMode: CaptureMode;
  documents: File[];
  pastedContext: string;
  urls: string[];                // 참고 URL 목록
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

const StartMeetingModal = ({ open, userLanguage, onClose, onStart }: Props) => {
  const effectiveUserLanguage = userLanguage || getDefaultLanguageFromBrowser();
  const [title, setTitle] = useState('');
  const [brief, setBrief] = useState('');
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [pName, setPName] = useState('');
  const [pRole, setPRole] = useState('');
  const [meetingLangs, setMeetingLangs] = useState<string[]>([]);
  const [translationLang, setTranslationLang] = useState<string>(effectiveUserLanguage);
  const [answerLang, setAnswerLang] = useState<string>('');
  const [adding, setAdding] = useState(false);
  const [captureMode, setCaptureMode] = useState<CaptureMode>('web_conference');
  const [documents, setDocuments] = useState<File[]>([]);
  const [pastedContext, setPastedContext] = useState('');
  const [urls, setUrls] = useState<string[]>([]);
  const [urlInput, setUrlInput] = useState('');
  const [fileError, setFileError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const allLangOptions = useMemo(() => langToOption(), []);

  // 모달이 열릴 때마다 이전 입력 초기화 (이전 회의 데이터 잔존 방지)
  useEffect(() => {
    if (open) {
      setTitle('');
      setBrief('');
      setParticipants([]);
      setPName('');
      setPRole('');
      setMeetingLangs([]);
      setTranslationLang(effectiveUserLanguage);
      setAnswerLang('');
      setAdding(false);
      setCaptureMode('web_conference');
      setDocuments([]);
      setPastedContext('');
      setUrls([]);
      setUrlInput('');
      setFileError(null);
      setIsDragging(false);
    }
  }, [open, effectiveUserLanguage]);

  if (!open) return null;

  // 선택 안 된 언어만 추가 가능
  const addableOptions = allLangOptions.filter((o) => !meetingLangs.includes(o.value));
  const selectedTranslationOpt = allLangOptions.find((o) => o.value === translationLang) || null;
  // 답변 언어 옵션은 메인 언어 중에서 선택 (기본 케이스) 또는 어떤 언어든
  const answerLangOptions = allLangOptions.filter((o) => meetingLangs.includes(o.value));
  const selectedAnswerOpt = answerLangOptions.find((o) => o.value === answerLang) || null;

  const addMeetingLang = (code: string) => {
    if (!meetingLangs.includes(code)) {
      const next = [...meetingLangs, code];
      setMeetingLangs(next);
      // 답변 언어가 빈 값이거나 메인에 없으면 첫 번째로 자동 세팅
      if (!answerLang || !next.includes(answerLang)) setAnswerLang(next[0]);
    }
    setAdding(false);
  };

  const removeMeetingLang = (code: string) => {
    const next = meetingLangs.filter((c) => c !== code);
    setMeetingLangs(next);
    if (answerLang === code) setAnswerLang(next[0] || '');
  };

  const canStart = meetingLangs.length > 0 && answerLang;

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
        showFileError(`"${f.name}" — 지원하지 않는 형식. PDF·DOCX·TXT·MD만 가능.`);
        continue;
      }
      if (f.size === 0) {
        showFileError(`"${f.name}" — 빈 파일입니다.`);
        continue;
      }
      if (f.size > MAX_FILE_SIZE) {
        showFileError(`"${f.name}" — 파일이 너무 큽니다 (최대 10 MB).`);
        continue;
      }
      if (documents.length + accepted.length >= MAX_FILES) {
        showFileError(`파일은 최대 ${MAX_FILES}개까지 업로드 가능합니다.`);
        break;
      }
      // 중복 검사 (이름 + 크기)
      if (
        documents.some((d) => d.name === f.name && d.size === f.size) ||
        accepted.some((d) => d.name === f.name && d.size === f.size)
      ) {
        showFileError(`"${f.name}" — 이미 추가된 파일입니다.`);
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
      showFileError('URL은 http:// 또는 https://로 시작해야 합니다.');
      return;
    }
    if (urls.includes(url)) {
      showFileError('이미 추가된 URL입니다.');
      return;
    }
    setUrls((prev) => [...prev, url]);
    setUrlInput('');
  };

  const removeUrl = (idx: number) => {
    setUrls((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleStart = () => {
    onStart({
      title: title.trim() || '제목 없는 회의',
      brief: brief.trim(),
      participants,
      meetingLanguages: meetingLangs,
      translationLanguage: translationLang,
      answerLanguage: answerLang,
      captureMode,
      documents,
      pastedContext: pastedContext.trim(),
      urls,
    });
  };

  return (
    <Backdrop onClick={onClose}>
      <ModalBox onClick={(e) => e.stopPropagation()}>
        <Header>
          <Title>새 회의 시작</Title>
          <CloseBtn onClick={onClose} aria-label="닫기">
            <CloseIcon size={18} />
          </CloseBtn>
        </Header>

        <Body>
          <Field>
            <Label>회의 제목</Label>
            <Input
              type="text"
              placeholder="예: 월요일 팀 스탠드업"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={100}
            />
          </Field>

          <Field>
            <Label>회의 안내 (선택)</Label>
            <Hint>
              회의 목적, 주의사항, 다룰 내용을 적어두면 번역·요약·답변 품질이 크게 향상됩니다.
            </Hint>
            <TextArea
              placeholder={
                '예시:\n- 목적: 신규 SaaS 제품 투자 유치 미팅\n- 자료: 피칭 덱 v3 첨부\n- 주의: 매출 수치는 NDA 대상'
              }
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              maxLength={2000}
              rows={4}
            />
            <CharCount>{brief.length} / 2000</CharCount>
          </Field>

          <Field>
            <Label>참여자 (선택)</Label>
            <Hint>
              개별 또는 그룹 단위 자유 입력. 회의 후 화자 매칭에 사용됩니다.
            </Hint>
            {participants.length > 0 && (
              <ParticipantList>
                {participants.map((p, idx) => (
                  <ParticipantRow key={idx}>
                    <ParticipantName>{p.name}</ParticipantName>
                    {p.role && <ParticipantRole>{p.role}</ParticipantRole>}
                    <RemoveBtn onClick={() => removeParticipant(idx)} aria-label="제거">
                      <CloseIcon size={14} />
                    </RemoveBtn>
                  </ParticipantRow>
                ))}
              </ParticipantList>
            )}
            <ParticipantInputs>
              <ParticipantInput
                placeholder="이름 (예: Sarah, 우리 PM)"
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
                placeholder="역할/메모 (선택, 예: Acme사 CEO)"
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
              회의 메인 언어 <Required>*</Required>
            </Label>
            <Hint>
              발화자가 실제로 사용하는 언어. 2개 이상이면 자동으로 코드스위칭 모드로 인식합니다.
            </Hint>
            <LangPills>
              {meetingLangs.map((code) => (
                <LangPill key={code}>
                  <span>{getLanguageLabel(code)}</span>
                  <PillRemove onClick={() => removeMeetingLang(code)} aria-label="제거">
                    <CloseIcon size={12} />
                  </PillRemove>
                </LangPill>
              ))}
              {meetingLangs.length === 0 && !adding && (
                <PillsPlaceholder>아직 선택된 언어가 없습니다</PillsPlaceholder>
              )}
              {!adding && addableOptions.length > 0 && (
                <AddLangBtn onClick={() => setAdding(true)}>
                  <PlusIcon size={12} />
                  <span>언어 추가</span>
                </AddLangBtn>
              )}
            </LangPills>
            {adding && (
              <AddLangSelectWrap>
                <PlanQSelect
                  options={addableOptions}
                  value={null}
                  onChange={(opt: any) => opt && addMeetingLang(opt.value)}
                  placeholder="추가할 언어 선택"
                  autoFocus
                  onBlur={() => setAdding(false)}
                />
              </AddLangSelectWrap>
            )}
          </Field>

          <LangRow>
            <Field>
              <Label>
                답변 언어 <Required>*</Required>
              </Label>
              <PlanQSelect
                options={answerLangOptions}
                value={selectedAnswerOpt}
                onChange={(opt: any) => setAnswerLang(opt?.value || meetingLangs[0])}
                placeholder="답변 언어 선택"
              />
              <Hint>
                "답변 찾기" 결과 + 회의에서 실제로 말할 언어
              </Hint>
            </Field>

            <Field>
              <Label>
                번역 언어 <Required>*</Required>
              </Label>
              <PlanQSelect
                options={allLangOptions}
                value={selectedTranslationOpt}
                onChange={(opt: any) => setTranslationLang(opt?.value || effectiveUserLanguage)}
                placeholder="내가 보고 싶은 언어"
              />
              <Hint>
                보조 번역 표시용. 디폴트 = 내 언어({getLanguageLabel(effectiveUserLanguage)}).
              </Hint>
            </Field>
          </LangRow>

          <Field>
            <Label>참고 자료 (선택)</Label>
            <Hint>
              "답변 찾기"는 이 자료를 우선 검색합니다. 자료가 없으면 일반 AI 지식으로 답변합니다.
              <br />
              <strong>텍스트나 링크를 우선 사용해주세요.</strong> 파일은 작은 슬라이드/문서 위주.
              <br />
              파일당 10 MB · 최대 5개 · PDF·DOCX·TXT·MD · 텍스트 PDF만 (스캔본 ❌)
            </Hint>

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
                파일을 끌어다 놓거나 클릭해서 선택
                <DropzoneSubText>PDF · DOCX · TXT · MD</DropzoneSubText>
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

            {documents.length > 0 && (
              <FileList>
                {documents.map((file, idx) => (
                  <FileRow key={`${file.name}-${idx}`}>
                    <FileIcon>
                      <FileTextIcon size={14} />
                    </FileIcon>
                    <FileName>{file.name}</FileName>
                    <FileSize>{formatFileSize(file.size)}</FileSize>
                    <RemoveBtn onClick={() => removeFile(idx)} aria-label="제거">
                      <CloseIcon size={14} />
                    </RemoveBtn>
                  </FileRow>
                ))}
              </FileList>
            )}

            <Divider>
              <DividerText>또는 텍스트 붙여넣기</DividerText>
            </Divider>

            <TextArea
              placeholder={
                '이메일, 노션, 웹페이지에서 복사한 텍스트를 붙여넣으세요.\n파일과 함께 사용 가능합니다.'
              }
              value={pastedContext}
              onChange={(e) => setPastedContext(e.target.value)}
              maxLength={MAX_TEXT_CHARS}
              rows={4}
            />
            <CharCount>
              {pastedContext.length.toLocaleString()} / {MAX_TEXT_CHARS.toLocaleString()}
            </CharCount>

            <Divider>
              <DividerText>또는 링크 (URL)</DividerText>
            </Divider>

            <UrlRow>
              <ParticipantInput
                placeholder="https://... (블로그, 노션 공개 페이지, PDF 링크 등)"
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
            <Hint>
              공개 페이지만 자동 추출 가능. 비공개/로그인 페이지는 텍스트로 직접 붙여넣어주세요.
            </Hint>

            {urls.length > 0 && (
              <FileList>
                {urls.map((u, idx) => (
                  <FileRow key={u}>
                    <FileIcon>
                      <FileTextIcon size={14} />
                    </FileIcon>
                    <FileName>{u}</FileName>
                    <UrlStatus>대기</UrlStatus>
                    <RemoveBtn onClick={() => removeUrl(idx)} aria-label="제거">
                      <CloseIcon size={14} />
                    </RemoveBtn>
                  </FileRow>
                ))}
              </FileList>
            )}
          </Field>

          <Field>
            <Label>
              캡처 방식 <Required>*</Required>
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
                        {!available && <Unavailable> (지원 안 함)</Unavailable>}
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
          <SecondaryBtn onClick={onClose}>취소</SecondaryBtn>
          <PrimaryBtn onClick={handleStart} disabled={!canStart}>
            회의 진행
          </PrimaryBtn>
        </Footer>
      </ModalBox>
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
  z-index: 200;
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

const LangRow = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  @media (max-width: 600px) {
    grid-template-columns: 1fr;
  }
`;

const LangPills = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  min-height: 44px;
  padding: 6px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #ffffff;
`;

const LangPill = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 8px 0 12px;
  background: #f0fdfa;
  border: 1px solid #99f6e4;
  color: #0f766e;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
`;

const PillRemove = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border: none;
  background: transparent;
  color: #0d9488;
  border-radius: 4px;
  cursor: pointer;
  &:hover {
    background: #ccfbf1;
    color: #0f766e;
  }
`;

const AddLangBtn = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 30px;
  padding: 0 12px;
  background: transparent;
  border: 1px dashed #cbd5e1;
  color: #64748b;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  &:hover {
    border-color: #14b8a6;
    color: #0d9488;
    background: #f0fdfa;
  }
`;

const AddLangSelectWrap = styled.div`
  margin-top: 8px;
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

const DividerText = styled.span`
  position: relative;
  background: #ffffff;
  padding: 0 12px;
  font-size: 11px;
  color: #94a3b8;
  font-weight: 500;
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

const PillsPlaceholder = styled.span`
  font-size: 13px;
  color: #94a3b8;
  padding: 0 6px;
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
