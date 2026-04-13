import { useEffect, useRef, useState, useCallback } from 'react';
import styled from 'styled-components';
import { useTranslation, Trans } from 'react-i18next';
import { useAuth, apiFetch } from '../../contexts/AuthContext';
import type { LanguageLevels, LanguageSkillLevel } from '../../contexts/AuthContext';
import { WavRecorder } from '../../services/audio/recordToWav';
import {
  getVoiceFingerprints,
  registerVoiceFingerprint,
  deleteVoiceFingerprintLanguage,
  deleteAllVoiceFingerprints,
  verifyVoiceMatch,
  type VoiceFingerprintList,
  type VoiceTestResult,
} from '../../services/qnote';
import { LANGUAGES, getLanguageByCode, type LanguageOption } from '../../constants/languages';
import PlanQSelect from '../../components/Common/PlanQSelect';
import ConfirmDialog from '../../components/Common/ConfirmDialog';
import AutoSaveField from '../../components/Common/AutoSaveField';
import { MicIcon, CheckIcon, XIcon, TrashIcon } from '../../components/Common/Icons';

const MIN_SEC = 10;           // 등록 최소 길이
const REG_SOFT_TARGET = 15;   // 권장 길이 (자동 종료 아님, UI 안내용)
const REG_MAX_SEC = 30;       // 서버 허용 상한 (백엔드 MAX_SECONDS + 여유)
const VERIFY_MIN_SEC = 3;
const VERIFY_SOFT_TARGET = 5;
const VERIFY_MAX_SEC = 15;

// 언어별 예시 문장
const SAMPLE_SENTENCES: Record<string, string> = {
  ko: '안녕하세요, 저는 PlanQ 를 사용하는 사용자입니다. 오늘 회의는 중요한 주제를 다루고 있습니다. 제 목소리를 등록해서 회의 중 본인 발화를 자동으로 인식하도록 하겠습니다.',
  en: "Hello, I am a PlanQ user. Today's meeting covers important topics. I'm registering my voice so that the system can automatically recognize me during meetings.",
  ja: 'こんにちは、私はPlanQのユーザーです。今日の会議は重要な内容を扱っています。自分の声を登録して、会議中に自動的に本人の発言を認識できるようにします。',
  zh: '你好，我是PlanQ的用户。今天的会议讨论的是重要话题。我正在注册我的声音，以便在会议期间自动识别我的发言。',
  es: 'Hola, soy usuario de PlanQ. La reunión de hoy trata temas importantes. Estoy registrando mi voz para que el sistema me reconozca automáticamente durante las reuniones.',
  fr: "Bonjour, je suis un utilisateur de PlanQ. La réunion d'aujourd'hui aborde des sujets importants. J'enregistre ma voix pour que le système me reconnaisse automatiquement.",
  de: 'Hallo, ich bin ein PlanQ-Nutzer. Das heutige Meeting behandelt wichtige Themen. Ich registriere meine Stimme, damit mich das System während Meetings automatisch erkennt.',
};

type RecState = 'idle' | 'recording' | 'processing' | 'error';
type RecPurpose = 'register' | 'verify';

export default function ProfilePage() {
  const { t } = useTranslation('profile');
  const { user, updateUser } = useAuth();
  const [fpList, setFpList] = useState<VoiceFingerprintList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // 녹음 상태
  const [recState, setRecState] = useState<RecState>('idle');
  const [recPurpose, setRecPurpose] = useState<RecPurpose>('register');
  const [recLanguage, setRecLanguage] = useState<string>('ko');
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const recorderRef = useRef<WavRecorder | null>(null);
  const timerRef = useRef<number | null>(null);
  const [verifyResult, setVerifyResult] = useState<VoiceTestResult | null>(null);

  // 언어 선택 (기본 언어)
  const [language, setLanguage] = useState<string>(user?.language || 'ko');
  const [langSaving, setLangSaving] = useState(false);

  // Q Note 답변 생성용 프로필
  const [bio, setBio] = useState<string>(user?.bio || '');
  const [expertise, setExpertise] = useState<string>(user?.expertise || '');
  const [organization, setOrganization] = useState<string>(user?.organization || '');
  const [jobTitle, setJobTitle] = useState<string>(user?.job_title || '');

  // 언어 레벨 (언어별 4-skill 1-6)
  type Skill = 'reading' | 'speaking' | 'listening' | 'writing';
  const [languageLevels, setLanguageLevels] = useState<LanguageLevels>(user?.language_levels || {});
  const [expertiseLevel, setExpertiseLevel] = useState<'layman' | 'practitioner' | 'expert' | ''>(user?.expertise_level || '');

  useEffect(() => {
    if (user?.bio !== undefined) setBio(user.bio || '');
    if (user?.expertise !== undefined) setExpertise(user.expertise || '');
    if (user?.organization !== undefined) setOrganization(user.organization || '');
    if (user?.job_title !== undefined) setJobTitle(user.job_title || '');
    if (user?.language_levels !== undefined) setLanguageLevels(user.language_levels || {});
    if (user?.expertise_level !== undefined) setExpertiseLevel(user.expertise_level || '');
  }, [user?.bio, user?.expertise, user?.organization, user?.job_title, user?.language_levels, user?.expertise_level]);

  const LEVEL_OPTIONS = [
    { value: 0, label: '—' },
    { value: 1, label: '1 초급' },
    { value: 2, label: '2 기초' },
    { value: 3, label: '3 중급' },
    { value: 4, label: '4 중상급' },
    { value: 5, label: '5 고급' },
    { value: 6, label: '6 원어민' },
  ];

  const saveProfileField = useCallback(async (field: 'bio' | 'expertise' | 'organization' | 'job_title', value: string) => {
    if (!user?.id) throw new Error('Not logged in');
    const res = await apiFetch(`/api/users/${user.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [field]: value || null }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.message || t('messages.errorSave'));
    if (updateUser) updateUser({ [field]: value || null });
  }, [user?.id, updateUser, t]);

  const saveLanguageLevel = useCallback(async (lang: string, skill: Skill, level: number) => {
    if (!user?.id) throw new Error('Not logged in');
    const next: LanguageLevels = { ...languageLevels };
    if (level === 0) {
      if (next[lang]) {
        const block = { ...next[lang] };
        delete block[skill];
        if (Object.keys(block).length) next[lang] = block;
        else delete next[lang];
      }
    } else {
      next[lang] = { ...(next[lang] || {}), [skill]: level as LanguageSkillLevel };
    }
    const payload = Object.keys(next).length ? next : null;
    const res = await apiFetch(`/api/users/${user.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ language_levels: payload }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.message || t('messages.errorSave'));
    setLanguageLevels(next);
    if (updateUser) updateUser({ language_levels: payload });
  }, [user?.id, languageLevels, updateUser, t]);

  const saveExpertiseLevel = useCallback(async (level: string) => {
    if (!user?.id) throw new Error('Not logged in');
    const val = level || null;
    const res = await apiFetch(`/api/users/${user.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expertise_level: val }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.message || t('messages.errorSave'));
    setExpertiseLevel((val as 'layman' | 'practitioner' | 'expert' | null) || '');
    if (updateUser) updateUser({ expertise_level: val as 'layman' | 'practitioner' | 'expert' | null });
  }, [user?.id, updateUser, t]);

  // 언어 추가 — 드롭다운 선택 시 즉시 startRecording 호출 (별도 state 불필요)
  const errorBannerRef = useRef<HTMLDivElement>(null);

  // 확인 다이얼로그 상태
  const [confirm, setConfirm] = useState<{
    open: boolean;
    title: string;
    message: string;
    onConfirm: () => void | Promise<void>;
  }>({ open: false, title: '', message: '', onConfirm: () => {} });
  const closeConfirm = () => setConfirm((c) => ({ ...c, open: false }));

  // ─────────── 데이터 로드 ───────────
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const s = await getVoiceFingerprints();
      setFpList(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('messages.errorLoadStatus'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { load(); }, [load]);

  // 에러 발생 시 상단 배너로 스크롤 (녹음 섹션에서 내려간 상태여도 확인 가능)
  useEffect(() => {
    if (error && errorBannerRef.current) {
      errorBannerRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [error]);

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
      if (recorderRef.current) recorderRef.current.stop().catch(() => {});
    };
  }, []);

  useEffect(() => {
    if (user?.language) setLanguage(user.language);
  }, [user?.language]);

  // ─────────── 녹음 시작 ───────────
  const startRecording = async (purpose: RecPurpose, lang?: string) => {
    setError(null);
    setSuccess(null);
    setVerifyResult(null);
    setElapsed(0);
    setLevel(0);
    setRecPurpose(purpose);
    if (purpose === 'register' && lang) setRecLanguage(lang);

    try {
      const rec = new WavRecorder();
      await rec.start((lvl) => setLevel(lvl));
      recorderRef.current = rec;
      setRecState('recording');
      const hardMax = purpose === 'verify' ? VERIFY_MAX_SEC : REG_MAX_SEC;
      const startAt = Date.now();
      timerRef.current = window.setInterval(() => {
        const e = (Date.now() - startAt) / 1000;
        setElapsed(e);
        // 하드 상한(30초) 넘으면 강제 종료. 그 외엔 사용자가 직접 버튼으로 종료.
        if (e >= hardMax) stopRecording();
      }, 100);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('messages.errorMicPermission'));
      setRecState('error');
    }
  };

  // ─────────── 녹음 종료 + 업로드 ───────────
  const stopRecording = async () => {
    if (timerRef.current) { window.clearInterval(timerRef.current); timerRef.current = null; }
    if (!recorderRef.current) return;
    const purpose = recPurpose;
    const lang = recLanguage;
    const capturedElapsed = elapsed;
    setRecState('processing');
    setError(null);
    try {
      const wavBlob = await recorderRef.current.stop();
      recorderRef.current = null;
      const minSec = purpose === 'verify' ? VERIFY_MIN_SEC : MIN_SEC;
      if (capturedElapsed < minSec) {
        const msg = purpose === 'verify'
          ? t('messages.errorTooShortVerify', { minSec, elapsed: capturedElapsed.toFixed(1) })
          : t('messages.errorTooShortRegister', { minSec, elapsed: capturedElapsed.toFixed(1) });
        setError(msg);
        setRecState('idle');
        return;
      }
      if (purpose === 'verify') {
        const result = await verifyVoiceMatch(wavBlob);
        setVerifyResult(result);
      } else {
        await registerVoiceFingerprint(lang, wavBlob);
        await load();
        const langLabel = getLanguageByCode(lang)?.label || lang;
        setSuccess(t('messages.successRegister', { label: langLabel }));
      }
      setRecState('idle');
    } catch (e) {
      const base = e instanceof Error ? e.message : t('messages.errorProcess');
      const prefix = purpose === 'verify' ? t('messages.errorPrefixVerify') : t('messages.errorPrefixRegister');
      setError(`${prefix}: ${base}`);
      setRecState('idle');
    }
  };

  const cancelRecording = async () => {
    if (timerRef.current) { window.clearInterval(timerRef.current); timerRef.current = null; }
    if (recorderRef.current) {
      try { await recorderRef.current.stop(); } catch { /* ignore */ }
      recorderRef.current = null;
    }
    setRecState('idle');
    setElapsed(0);
    setLevel(0);
  };

  // ─────────── 언어별 삭제 (ConfirmDialog) ───────────
  const handleDeleteLanguage = (lang: string) => {
    const label = getLanguageByCode(lang)?.label || lang;
    setConfirm({
      open: true,
      title: t('confirm.deleteLangTitle'),
      message: t('confirm.deleteLangMessage', { label }),
      onConfirm: async () => {
        closeConfirm();
        try {
          await deleteVoiceFingerprintLanguage(lang);
          await load();
          setSuccess(t('messages.successDeleteLanguage', { label }));
        } catch (e) {
          setError(e instanceof Error ? e.message : t('messages.errorDelete'));
        }
      },
    });
  };

  const handleDeleteAll = () => {
    setConfirm({
      open: true,
      title: t('confirm.deleteAllTitle'),
      message: t('confirm.deleteAllMessage'),
      onConfirm: async () => {
        closeConfirm();
        try {
          await deleteAllVoiceFingerprints();
          await load();
          setSuccess(t('messages.successDeleteAll'));
        } catch (e) {
          setError(e instanceof Error ? e.message : t('messages.errorDelete'));
        }
      },
    });
  };

  // ─────────── 기본 언어 변경 ───────────
  const handleLanguageChange = async (code: string) => {
    if (code === user?.language) return;
    setLangSaving(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/users/${user?.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language: code }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || t('messages.errorLanguageSave'));
      setLanguage(code);
      if (updateUser) updateUser({ language: code });
      setSuccess(t('messages.successLanguageChanged'));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('messages.errorLanguageSave'));
    } finally {
      setLangSaving(false);
    }
  };

  const langOptions = LANGUAGES.map((l: LanguageOption) => ({
    value: l.code,
    label: `${l.label} · ${l.native}`,
  }));

  // 등록 가능한 언어 옵션 (이미 등록된 언어는 제외)
  const registeredCodes = new Set((fpList?.languages || []).map((l) => l.language));
  const addableOptions = LANGUAGES
    .filter((l) => !registeredCodes.has(l.code))
    .map((l) => ({ value: l.code, label: `${l.label} · ${l.native}` }));

  const sampleSentence = SAMPLE_SENTENCES[recLanguage] || SAMPLE_SENTENCES.ko;

  const softTarget = recPurpose === 'verify' ? VERIFY_SOFT_TARGET : REG_SOFT_TARGET;
  const hardMax = recPurpose === 'verify' ? VERIFY_MAX_SEC : REG_MAX_SEC;
  const minSec = recPurpose === 'verify' ? VERIFY_MIN_SEC : MIN_SEC;
  const levelPct = Math.min(100, Math.round(level * 180));
  const readyToStop = elapsed >= minSec;
  const reachedSoftTarget = elapsed >= softTarget;

  return (
    <Page>
      <Container>
        <Header>
          <Title>{t('header.title')}</Title>
          <Subtitle>{t('header.subtitle')}</Subtitle>
        </Header>

        <div ref={errorBannerRef} />
        {error && <Banner $kind="error"><XIcon size={14} />{error}</Banner>}
        {success && <Banner $kind="success"><CheckIcon size={14} />{success}</Banner>}

        {/* 기본 정보 */}
        <Card>
          <SectionTitle>{t('basic.sectionTitle')}</SectionTitle>
          <FieldRow>
            <Label>{t('basic.name')}</Label>
            <ReadOnly>{user?.name || '-'}</ReadOnly>
          </FieldRow>
          <FieldRow>
            <Label>{t('basic.email')}</Label>
            <ReadOnly>{user?.email || '-'}</ReadOnly>
          </FieldRow>
          <FieldRow>
            <Label>{t('basic.defaultLanguage')}</Label>
            <FieldBody>
              <PlanQSelect
                value={langOptions.find((o) => o.value === language) || null}
                onChange={(opt) => {
                  const v = (opt as { value: string } | null)?.value;
                  if (v) handleLanguageChange(v);
                }}
                options={langOptions}
                placeholder={t('basic.languagePlaceholder')}
                isDisabled={langSaving}
                size="sm"
              />
              <Hint>{t('basic.languageHint')}</Hint>
            </FieldBody>
          </FieldRow>
        </Card>

        {/* Q note 답변 생성 프로필 */}
        <Card>
          <SectionTitle>{t('qnoteProfile.sectionTitle')}</SectionTitle>
          <Description>
            <Trans i18nKey="qnoteProfile.description" ns="profile" components={{ 1: <strong />, 2: <br /> }} />
          </Description>

          <FieldRow>
            <Label>{t('qnoteProfile.organization')}</Label>
            <FieldBody>
              <AutoSaveField onSave={() => saveProfileField('organization', organization)}>
                <TextInput
                  value={organization}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setOrganization(e.target.value)}
                  placeholder={t('qnoteProfile.organizationPlaceholder')}
                  maxLength={200}
                />
              </AutoSaveField>
            </FieldBody>
          </FieldRow>

          <FieldRow>
            <Label>{t('qnoteProfile.jobTitle')}</Label>
            <FieldBody>
              <AutoSaveField onSave={() => saveProfileField('job_title', jobTitle)}>
                <TextInput
                  value={jobTitle}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setJobTitle(e.target.value)}
                  placeholder={t('qnoteProfile.jobTitlePlaceholder')}
                  maxLength={100}
                />
              </AutoSaveField>
            </FieldBody>
          </FieldRow>

          <FieldRow>
            <Label>{t('qnoteProfile.expertise')}</Label>
            <FieldBody>
              <AutoSaveField onSave={() => saveProfileField('expertise', expertise)}>
                <TextInput
                  value={expertise}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setExpertise(e.target.value)}
                  placeholder={t('qnoteProfile.expertisePlaceholder')}
                  maxLength={500}
                />
              </AutoSaveField>
              <Hint>{t('qnoteProfile.expertiseHint')}</Hint>
            </FieldBody>
          </FieldRow>

          <FieldRow>
            <Label>{t('qnoteProfile.bio')}</Label>
            <FieldBody>
              <AutoSaveField onSave={() => saveProfileField('bio', bio)}>
                <TextArea
                  value={bio}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setBio(e.target.value)}
                  placeholder={t('qnoteProfile.bioPlaceholder')}
                  maxLength={2000}
                  rows={4}
                />
              </AutoSaveField>
              <Hint>{t('qnoteProfile.bioHint', { length: bio.length, max: 2000 })}</Hint>
            </FieldBody>
          </FieldRow>
        </Card>

        {/* 언어 레벨 — 답변 난이도 조절 */}
        <Card>
          <SectionTitle>내 언어 레벨 (답변 난이도 조절용)</SectionTitle>
          <Description>
            언어별 <strong>읽기·말하기·듣기·쓰기</strong> 4개 영역의 수준을 설정하세요.
            Q note 가 답변을 생성할 때 이 레벨에 맞춰 <strong>너무 어려운 단어를 피하고 발음하기 쉬운 문장</strong>으로 작성합니다.
            <br />특히 답변을 따라 읽어야 하는 언어(영어 등)의 <strong>읽기·말하기 레벨</strong>이 중요합니다.
          </Description>

          <LevelTableHead>
            <LevelTableCell $head>언어</LevelTableCell>
            <LevelTableCell $head>읽기</LevelTableCell>
            <LevelTableCell $head>말하기</LevelTableCell>
            <LevelTableCell $head>듣기</LevelTableCell>
            <LevelTableCell $head>쓰기</LevelTableCell>
          </LevelTableHead>
          {['ko', 'en', 'ja', 'zh', 'es', 'fr', 'de'].map((code) => {
            const meta = LANGUAGES.find((l) => l.code === code);
            const label = meta?.label || code.toUpperCase();
            const block = languageLevels[code] || {};
            return (
              <LevelRow key={code}>
                <LevelLangCell>{label}</LevelLangCell>
                {(['reading', 'speaking', 'listening', 'writing'] as const).map((skill) => {
                  const current = block[skill] ?? 0;
                  return (
                    <LevelCell key={skill}>
                      <PlanQSelect
                        size="sm"
                        isClearable={false}
                        isSearchable={false}
                        value={LEVEL_OPTIONS.find((o) => o.value === current) || LEVEL_OPTIONS[0]}
                        onChange={(opt) => {
                          const v = (opt as { value: number } | null)?.value ?? 0;
                          saveLanguageLevel(code, skill, v);
                        }}
                        options={LEVEL_OPTIONS}
                      />
                    </LevelCell>
                  );
                })}
              </LevelRow>
            );
          })}
          <Hint style={{ marginTop: 10 }}>
            미설정("—")은 해당 언어를 별도 조정 안 함 — 기본값으로 답변 생성됩니다.
          </Hint>

          <FieldRow style={{ marginTop: 16, borderTop: '1px solid #e2e8f0', paddingTop: 16 }}>
            <Label>전문 지식 수준</Label>
            <FieldBody>
              <ExpertiseRow>
                {([
                  { val: '', label: '미설정' },
                  { val: 'layman', label: '일반인' },
                  { val: 'practitioner', label: '실무자' },
                  { val: 'expert', label: '전문가' },
                ] as const).map((opt) => (
                  <ExpertiseBtn
                    key={opt.val}
                    type="button"
                    $active={expertiseLevel === opt.val}
                    onClick={() => saveExpertiseLevel(opt.val)}
                  >
                    {opt.label}
                  </ExpertiseBtn>
                ))}
              </ExpertiseRow>
              <Hint>
                듣는 사람 기준이 아닌 <strong>대답하는 내 수준</strong>. 전문가면 정확한 용어 그대로, 일반인이면 쉬운 말로 답변합니다.
              </Hint>
            </FieldBody>
          </FieldRow>
        </Card>

        {/* 음성 핑거프린트 (다국어) */}
        <Card>
          <SectionTitle>{t('voice.sectionTitle')}</SectionTitle>
          <Description>
            <Trans i18nKey="voice.description" ns="profile" components={{ 1: <strong />, 2: <strong /> }} />
          </Description>

          {loading ? (
            <Hint>{t('voice.loading')}</Hint>
          ) : (
            <>
              <RegList>
                {(fpList?.languages || []).length === 0 && (
                  <EmptyHint>{t('voice.empty')}</EmptyHint>
                )}
                {(fpList?.languages || []).map((lang) => {
                  const meta = getLanguageByCode(lang.language);
                  const label = meta?.label || lang.language.toUpperCase();
                  const isLegacy = lang.language === 'unknown';
                  return (
                    <RegItem key={lang.language}>
                      <RegLeft>
                        <RegLabel>{isLegacy ? t('voice.legacyLabel') : label}</RegLabel>
                        <RegMeta>
                          {lang.sample_seconds ? t('voice.sampleSeconds', { sec: lang.sample_seconds.toFixed(1) }) : ''}
                          {lang.updated_at ? ` · ${new Date(lang.updated_at).toLocaleString()}` : ''}
                        </RegMeta>
                      </RegLeft>
                      <RegActions>
                        <SecondaryBtn
                          onClick={() => startRecording('register', lang.language === 'unknown' ? 'ko' : lang.language)}
                          disabled={recState !== 'idle'}
                        >
                          {t('voice.reregister')}
                        </SecondaryBtn>
                        <DangerIconBtn onClick={() => handleDeleteLanguage(lang.language)}>
                          <TrashIcon size={12} />
                        </DangerIconBtn>
                      </RegActions>
                    </RegItem>
                  );
                })}
              </RegList>

              {/* 언어 추가 — 드롭다운에서 선택 즉시 녹음 시작 */}
              {addableOptions.length > 0 && recState === 'idle' && (
                <AddLangRow>
                  <AddLangLabel>
                    <MicIcon size={14} />
                    <span>
                      <Trans i18nKey="voice.addLangPrompt" ns="profile" components={{ 1: <strong /> }} />
                    </span>
                  </AddLangLabel>
                  <PlanQSelect
                    value={null}
                    onChange={(opt) => {
                      const v = (opt as { value: string } | null)?.value;
                      if (v) startRecording('register', v);
                    }}
                    options={addableOptions}
                    placeholder={t('voice.addLangPlaceholder')}
                    size="sm"
                  />
                </AddLangRow>
              )}

              {/* 매칭 확인 + 전체 삭제 */}
              {(fpList?.languages.length || 0) > 0 && recState === 'idle' && (
                <ActionRow>
                  <SecondaryBtn onClick={() => startRecording('verify')}>
                    {t('voice.verifyBtn')}
                  </SecondaryBtn>
                  <Hint style={{ flex: 1 }}>{t('voice.verifyHint')}</Hint>
                  <DangerBtn onClick={handleDeleteAll}>
                    <TrashIcon size={12} />
                    <span>{t('voice.deleteAllBtn')}</span>
                  </DangerBtn>
                </ActionRow>
              )}
            </>
          )}

          {/* 매칭 확인 결과 */}
          {verifyResult && (
            <VerifyResultBox $match={verifyResult.match}>
              <VerifyResultLine>
                <strong>{verifyResult.match ? t('verify.matched') : t('verify.notMatched')}</strong>
                <span>{t('verify.similarityLine', { similarity: verifyResult.similarity.toFixed(3), threshold: verifyResult.threshold.toFixed(2) })}</span>
              </VerifyResultLine>
              <VerifyResultMsg>{verifyResult.message}</VerifyResultMsg>
              {verifyResult.per_language.length > 1 && (
                <VerifyPerLang>
                  {verifyResult.per_language.map((p) => {
                    const lbl = getLanguageByCode(p.language)?.label || p.language.toUpperCase();
                    return (
                      <VerifyPerLangItem key={p.language}>
                        <span>{lbl}</span>
                        <strong>{p.similarity.toFixed(3)}</strong>
                      </VerifyPerLangItem>
                    );
                  })}
                </VerifyPerLang>
              )}
            </VerifyResultBox>
          )}

          {/* 녹음 인터페이스 */}
          {recState !== 'idle' && (
            <RecorderBox>
              {recPurpose === 'register' && (
                <SampleSentenceBox>
                  <SampleLabel>
                    {t('recorder.sampleLabel', { label: getLanguageByCode(recLanguage)?.label || recLanguage.toUpperCase(), minSec: MIN_SEC })}
                  </SampleLabel>
                  <SampleSentence>{sampleSentence}</SampleSentence>
                </SampleSentenceBox>
              )}

              {recState === 'recording' && (
                <RecordingUI>
                  <RecordingRow>
                    <RecDot />
                    <RecElapsed>
                      {elapsed.toFixed(1)}s
                      <RecHint>
                        {' '}{t('recorder.elapsedHint', { minSec, softTarget, hardMax })}
                      </RecHint>
                    </RecElapsed>
                    <RecRemaining>
                      {!readyToStop
                        ? t('recorder.remainNeedMore', { seconds: Math.ceil(minSec - elapsed) })
                        : reachedSoftTarget
                          ? t('recorder.remainEnough')
                          : t('recorder.remainAllowed')}
                    </RecRemaining>
                  </RecordingRow>
                  <LevelBar>
                    <LevelFill style={{ width: `${levelPct}%` }} />
                  </LevelBar>
                  <RecBtnRow>
                    <PrimaryBtn onClick={stopRecording} disabled={!readyToStop}>
                      <CheckIcon size={14} />
                      <span>
                        {recPurpose === 'verify' ? t('recorder.finishVerify') : t('recorder.finishRegister')}
                        {!readyToStop ? ` ${t('recorder.finishSuffix', { seconds: Math.ceil(minSec - elapsed) })}` : ''}
                      </span>
                    </PrimaryBtn>
                    <SecondaryBtn onClick={cancelRecording}>
                      <XIcon size={14} />
                      <span>{t('recorder.cancel')}</span>
                    </SecondaryBtn>
                  </RecBtnRow>
                  <RecHintLine>
                    {t('recorder.hintLine', { hardMax })}
                  </RecHintLine>
                </RecordingUI>
              )}

              {recState === 'processing' && (
                <ProcessingUI>{t('recorder.processing')}</ProcessingUI>
              )}
            </RecorderBox>
          )}

          {/* 녹음이 종료되고 에러가 남은 경우, 녹음 섹션 자리에도 인라인 표시 */}
          {recState === 'idle' && error && (
            <InlineError>
              <XIcon size={14} />
              <span>{error}</span>
              <RetryBtn onClick={() => setError(null)}>{t('messages.closeBtn')}</RetryBtn>
            </InlineError>
          )}
        </Card>

        {/* 개인정보 안내 */}
        <Card>
          <SectionTitle>{t('privacy.sectionTitle')}</SectionTitle>
          <PrivacyList>
            <PrivacyItem>
              <Trans i18nKey="privacy.item1" ns="profile" components={{ 1: <strong />, 2: <strong /> }} />
            </PrivacyItem>
            <PrivacyItem>
              <Trans i18nKey="privacy.item2" ns="profile" components={{ 1: <strong /> }} />
            </PrivacyItem>
            <PrivacyItem>
              <Trans i18nKey="privacy.item3" ns="profile" components={{ 1: <strong /> }} />
            </PrivacyItem>
            <PrivacyItem>
              <Trans i18nKey="privacy.item4" ns="profile" components={{ 1: <strong /> }} />
            </PrivacyItem>
          </PrivacyList>
        </Card>
      </Container>

      <ConfirmDialog
        isOpen={confirm.open}
        onClose={closeConfirm}
        onConfirm={() => confirm.onConfirm()}
        title={confirm.title}
        message={confirm.message}
        confirmText={t('confirm.deleteText')}
        cancelText={t('confirm.cancelText')}
        variant="danger"
      />
    </Page>
  );
}

// ─── Styled ───────────────────────────────────

const Page = styled.div`
  min-height: calc(100vh - 64px);
  background: #f8fafc;
  padding: 32px 24px;
`;

const Container = styled.div`
  max-width: 720px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 20px;
`;

const Header = styled.div`
  margin-bottom: 4px;
`;

const Title = styled.h1`
  margin: 0;
  font-size: 24px;
  font-weight: 700;
  color: #0f172a;
`;

const Subtitle = styled.p`
  margin: 4px 0 0;
  color: #64748b;
  font-size: 14px;
`;

const Card = styled.section`
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 24px;
`;

const SectionTitle = styled.h2`
  margin: 0 0 16px;
  font-size: 16px;
  font-weight: 700;
  color: #0f172a;
`;

const Description = styled.p`
  margin: 0 0 16px;
  color: #475569;
  font-size: 13px;
  line-height: 1.6;
  strong { color: #0f172a; font-weight: 600; }
`;

const FieldRow = styled.div`
  display: flex;
  gap: 16px;
  margin-bottom: 14px;
  align-items: flex-start;
  &:last-child { margin-bottom: 0; }
`;

const Label = styled.div`
  width: 100px;
  flex-shrink: 0;
  font-size: 13px;
  font-weight: 600;
  color: #475569;
  padding-top: 8px;
`;

const FieldBody = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const ReadOnly = styled.div`
  flex: 1;
  padding: 8px 0;
  font-size: 14px;
  color: #0f172a;
`;

const Hint = styled.div`
  font-size: 11px;
  color: #94a3b8;
`;

const LevelTableHead = styled.div`
  display: grid;
  grid-template-columns: 1.2fr 1fr 1fr 1fr 1fr;
  gap: 6px;
  padding: 6px 0;
  border-bottom: 1px solid #e2e8f0;
`;

const LevelTableCell = styled.div<{ $head?: boolean }>`
  font-size: ${(p) => (p.$head ? '11px' : '13px')};
  font-weight: ${(p) => (p.$head ? 700 : 500)};
  color: ${(p) => (p.$head ? '#64748b' : '#0f172a')};
  letter-spacing: 0.03em;
  text-transform: ${(p) => (p.$head ? 'uppercase' : 'none')};
`;

const LevelRow = styled.div`
  display: grid;
  grid-template-columns: 1.2fr 1fr 1fr 1fr 1fr;
  gap: 6px;
  padding: 8px 0;
  align-items: center;
  border-bottom: 1px solid #f1f5f9;
`;

const LevelLangCell = styled.div`
  font-size: 13px;
  font-weight: 600;
  color: #0f172a;
`;

const LevelCell = styled.div`
  display: flex;
  align-items: center;
`;


const ExpertiseRow = styled.div`
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
`;

const ExpertiseBtn = styled.button<{ $active?: boolean }>`
  padding: 8px 14px;
  font-size: 12px;
  font-weight: 600;
  color: ${(p) => (p.$active ? '#ffffff' : '#475569')};
  background: ${(p) => (p.$active ? '#0d9488' : '#ffffff')};
  border: 1px solid ${(p) => (p.$active ? '#0d9488' : '#e2e8f0')};
  border-radius: 8px;
  cursor: pointer;
  transition: all 120ms;
  &:hover {
    border-color: ${(p) => (p.$active ? '#0f766e' : '#0d9488')};
  }
`;

const TextInput = styled.input`
  width: 100%;
  padding: 10px 12px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  font-size: 14px;
  color: #0f172a;
  background: #ffffff;
  outline: none;
  transition: border-color 120ms;
  &:focus { border-color: #14b8a6; }
  &::placeholder { color: #cbd5e1; }
`;

const TextArea = styled.textarea`
  width: 100%;
  padding: 10px 12px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  font-size: 14px;
  color: #0f172a;
  background: #ffffff;
  outline: none;
  resize: vertical;
  min-height: 100px;
  font-family: inherit;
  line-height: 1.5;
  transition: border-color 120ms;
  &:focus { border-color: #14b8a6; }
  &::placeholder { color: #cbd5e1; }
`;

const Banner = styled.div<{ $kind: 'error' | 'success' }>`
  padding: 12px 16px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  background: ${(p) => (p.$kind === 'error' ? '#fef2f2' : '#f0fdf4')};
  color: ${(p) => (p.$kind === 'error' ? '#b91c1c' : '#15803d')};
  border: 1px solid ${(p) => (p.$kind === 'error' ? '#fecaca' : '#bbf7d0')};
`;

const RegList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 14px;
`;

const EmptyHint = styled.div`
  padding: 14px 16px;
  background: #f8fafc;
  border: 1px dashed #cbd5e1;
  border-radius: 8px;
  font-size: 12px;
  color: #64748b;
  text-align: center;
`;

const RegItem = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 14px;
  background: #f0fdfa;
  border: 1px solid #99f6e4;
  border-radius: 8px;
`;

const RegLeft = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

const RegLabel = styled.div`
  font-size: 13px;
  font-weight: 700;
  color: #0f172a;
`;

const RegMeta = styled.div`
  font-size: 10px;
  color: #0f766e;
`;

const RegActions = styled.div`
  display: flex;
  gap: 6px;
`;

const AddLangRow = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  background: #f8fafc;
  border: 1px dashed #cbd5e1;
  border-radius: 8px;
  margin-bottom: 10px;
`;

const AddLangLabel = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #475569;

  svg { color: #0d9488; flex-shrink: 0; }
  strong { color: #0d9488; font-weight: 700; }
`;

const ActionRow = styled.div`
  display: flex;
  gap: 10px;
  align-items: center;
  padding-top: 8px;
  margin-top: 4px;
  border-top: 1px solid #f1f5f9;
`;

const VerifyResultBox = styled.div<{ $match: boolean }>`
  margin-top: 14px;
  padding: 14px 16px;
  border-radius: 8px;
  background: ${(p) => (p.$match ? '#f0fdf4' : '#fff7ed')};
  border: 1px solid ${(p) => (p.$match ? '#bbf7d0' : '#fed7aa')};
`;

const VerifyResultLine = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
  font-size: 13px;
  color: #0f172a;
  strong { font-weight: 700; }
  span { font-size: 11px; color: #64748b; font-variant-numeric: tabular-nums; }
`;

const VerifyResultMsg = styled.div`
  font-size: 11px;
  color: #475569;
`;

const VerifyPerLang = styled.div`
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px dashed #e2e8f0;
`;

const VerifyPerLangItem = styled.div`
  display: flex;
  gap: 6px;
  font-size: 11px;
  color: #64748b;
  strong { color: #0f172a; font-weight: 700; font-variant-numeric: tabular-nums; }
`;

const RecorderBox = styled.div`
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid #f1f5f9;
`;

const SampleSentenceBox = styled.div`
  margin-bottom: 12px;
`;

const SampleLabel = styled.div`
  font-size: 11px;
  font-weight: 600;
  color: #64748b;
  margin-bottom: 6px;
  letter-spacing: 0.02em;
`;

const SampleSentence = styled.div`
  padding: 12px 14px;
  background: #f8fafc;
  border-radius: 8px;
  font-size: 13px;
  color: #0f172a;
  line-height: 1.7;
`;

const PrimaryBtn = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 9px 16px;
  font-size: 12px;
  font-weight: 600;
  background: #0d9488;
  color: #fff;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  &:hover:not(:disabled) { background: #0f766e; }
  &:disabled { background: #94a3b8; cursor: not-allowed; }
`;

const SecondaryBtn = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  font-size: 12px;
  font-weight: 600;
  background: #fff;
  color: #475569;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  cursor: pointer;
  &:hover:not(:disabled) { background: #f8fafc; border-color: #94a3b8; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;

const DangerBtn = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  font-size: 12px;
  font-weight: 600;
  background: #fff;
  color: #dc2626;
  border: 1px solid #fecaca;
  border-radius: 8px;
  cursor: pointer;
  &:hover { background: #fef2f2; }
`;

const DangerIconBtn = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 6px 8px;
  background: #fff;
  color: #dc2626;
  border: 1px solid #fecaca;
  border-radius: 6px;
  cursor: pointer;
  &:hover { background: #fef2f2; }
`;

const RecordingUI = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

const RecordingRow = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
`;

const RecDot = styled.span`
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #ef4444;
  animation: pulse 1.2s ease-in-out infinite;
  @keyframes pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.6; transform: scale(0.85); }
  }
`;

const RecElapsed = styled.div`
  font-size: 15px;
  font-weight: 700;
  color: #0f172a;
  font-variant-numeric: tabular-nums;
`;

const RecHint = styled.span`
  font-weight: 500;
  color: #94a3b8;
  font-size: 12px;
`;

const RecRemaining = styled.div`
  margin-left: auto;
  font-size: 11px;
  color: #64748b;
`;

const RecHintLine = styled.div`
  font-size: 10px;
  color: #94a3b8;
  text-align: center;
  padding-top: 2px;
`;

const LevelBar = styled.div`
  height: 8px;
  background: #f1f5f9;
  border-radius: 4px;
  overflow: hidden;
`;

const LevelFill = styled.div`
  height: 100%;
  background: linear-gradient(90deg, #14b8a6, #f43f5e);
  transition: width 50ms linear;
`;

const RecBtnRow = styled.div`
  display: flex;
  gap: 8px;
`;

const ProcessingUI = styled.div`
  padding: 12px;
  text-align: center;
  color: #64748b;
  font-size: 13px;
`;

const InlineError = styled.div`
  margin-top: 12px;
  padding: 12px 14px;
  display: flex;
  align-items: center;
  gap: 8px;
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 8px;
  color: #b91c1c;
  font-size: 12px;
  line-height: 1.6;

  svg { flex-shrink: 0; }
  span { flex: 1; }
`;

const RetryBtn = styled.button`
  flex-shrink: 0;
  padding: 4px 10px;
  font-size: 11px;
  font-weight: 600;
  background: #fff;
  color: #b91c1c;
  border: 1px solid #fecaca;
  border-radius: 6px;
  cursor: pointer;
  &:hover { background: #fef2f2; border-color: #f87171; }
`;

const PrivacyList = styled.ul`
  margin: 0;
  padding: 0 0 0 18px;
  display: flex;
  flex-direction: column;
  gap: 10px;
`;

const PrivacyItem = styled.li`
  font-size: 12px;
  color: #475569;
  line-height: 1.7;
  strong { color: #0f172a; font-weight: 600; }
`;
