// components/Profile/VoiceProfileSection.tsx — 내 목소리 등록 (팀원 프로필 · 고객 홈 공용)
//
// 2026-10-05 ProfilePage 에서 뺐다 — 고객 홈(/home)에도 같은 것을 얹는다(CLAUDE.md «껍데기는 빼서 같이 쓴다»).
// 목소리는 생체정보다(docs/VOICE_PROFILE_DESIGN.md §2):
//   · 동의 체크를 해야 녹음(등록)을 시작할 수 있다 — 서버도 consent_version 없이는 저장하지 않는다
//   · 어디에 쓰이는지 · 보관기간 · 회의 자동 인식 끄기를 같은 자리에서 보여준다
//   · 등록 상태는 본인만 본다(이 화면). 다른 사람 화면에 «목소리 등록됨» 같은 표시를 만들지 않는다
import { useEffect, useId, useRef, useState, useCallback } from 'react';
import { useTranslation, Trans } from 'react-i18next';
import { WavRecorder } from '../../services/audio/recordToWav';
import {
  getVoiceFingerprints,
  registerVoiceFingerprint,
  deleteVoiceFingerprintLanguage,
  deleteAllVoiceFingerprints,
  verifyVoiceMatch,
  setVoiceMatchEnabled,
  type VoiceFingerprintList,
  type VoiceTestResult,
} from '../../services/qnote';
import { LANGUAGES, getLanguageByCode } from '../../constants/languages';
import PlanQSelect from '../Common/PlanQSelect';
import ConfirmDialog from '../Common/ConfirmDialog';
import AutoSaveField from '../Common/AutoSaveField';
import { Switch, SwitchKnob } from '../Common/switchShell';
import { MicIcon, CheckIcon, XIcon, TrashIcon } from '../Common/Icons';
import { useTimeFormat } from '../../hooks/useTimeFormat';
import { mapApiError } from '../../utils/apiError';
import {
  Banner,
  SectionTitle,
  Description,
  Hint,
  RegList,
  EmptyHint,
  RegItem,
  RegLeft,
  RegLabel,
  RegMeta,
  RegActions,
  AddLangRow,
  AddLangLabel,
  ActionRow,
  VerifyResultBox,
  VerifyResultLine,
  VerifyResultMsg,
  VerifyPerLang,
  VerifyPerLangItem,
  RecorderBox,
  SampleSentenceBox,
  SampleLabel,
  SampleSentence,
  PrimaryBtn,
  SecondaryBtn,
  DangerBtn,
  DangerIconBtn,
  RecordingUI,
  RecordingRow,
  RecDot,
  RecElapsed,
  RecHint,
  RecRemaining,
  RecHintLine,
  LevelBar,
  LevelFill,
  RecBtnRow,
  ProcessingUI,
  InlineError,
  RetryBtn,
  UsageBox,
  UsageTitle,
  UsageBody,
  ConsentRow,
  ConsentMore,
  ConsentFull,
  OutdatedNote,
  MatchRow,
} from './voiceProfileStyles';

const MIN_SEC = 10;           // 등록 최소 길이
const REG_SOFT_TARGET = 15;   // 권장 길이 (자동 종료 아님, UI 안내용)
const REG_MAX_SEC = 30;       // 서버 허용 상한 (백엔드 MAX_SECONDS + 여유)
const VERIFY_MIN_SEC = 3;
const VERIFY_SOFT_TARGET = 5;
const VERIFY_MAX_SEC = 15;

// 언어별 예시 문장 (낭독용 — 언어별 예시 문장은 i18n 대상이 아니다)
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

interface Props {
  /** 'member' = 내 프로필 · 'client' = 고객 홈. 문구만 다르다 */
  variant?: 'member' | 'client';
}

export default function VoiceProfileSection({ variant = 'member' }: Props) {
  const { t } = useTranslation('profile');
  const { t: tErr } = useTranslation('errors');
  const { formatDateTime } = useTimeFormat();
  const consentId = useId();
  const [fpList, setFpList] = useState<VoiceFingerprintList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [consentChecked, setConsentChecked] = useState(false);
  const [consentOpen, setConsentOpen] = useState(false);
  const [matchOn, setMatchOn] = useState(true);
  const matchRef = useRef(true);

  // 녹음 상태
  const [recState, setRecState] = useState<RecState>('idle');
  const [recPurpose, setRecPurpose] = useState<RecPurpose>('register');
  const [recLanguage, setRecLanguage] = useState<string>('ko');
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const recorderRef = useRef<WavRecorder | null>(null);
  const timerRef = useRef<number | null>(null);
  const [verifyResult, setVerifyResult] = useState<VoiceTestResult | null>(null);

  const [confirm, setConfirm] = useState<{
    open: boolean;
    title: string;
    message: string;
    onConfirm: () => void | Promise<void>;
  }>({ open: false, title: '', message: '', onConfirm: () => {} });
  const closeConfirm = () => setConfirm((c) => ({ ...c, open: false }));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const s = await getVoiceFingerprints();
      setFpList(s);
      // 이미 지금 버전에 동의해 등록한 사람은 다시 체크하지 않아도 된다
      setConsentChecked((prev) => prev || (s.registered && s.consent_current));
      matchRef.current = s.match_enabled;
      setMatchOn(s.match_enabled);
    } catch (e) {
      setError(mapApiError(e, tErr));
    } finally {
      setLoading(false);
    }
  }, [tErr]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
      if (recorderRef.current) recorderRef.current.stop().catch(() => {});
    };
  }, []);

  // 자동 인식 토글 — 클릭이 값을 뒤집고(stage), 래퍼가 저장한다(persist). 최신값은 ref 로 읽는다
  const persistMatch = useCallback(async () => {
    await setVoiceMatchEnabled(matchRef.current);
  }, []);

  const startRecording = async (purpose: RecPurpose, lang?: string) => {
    if (purpose === 'register' && !consentChecked) return;
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
        if (e >= hardMax) stopRecording();
      }, 100);
    } catch (e) {
      setError(mapApiError(e, tErr));
      setRecState('error');
    }
  };

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
        await registerVoiceFingerprint(lang, wavBlob, fpList?.consent_version_required || '');
        await load();
        const langLabel = getLanguageByCode(lang)?.label || lang;
        setSuccess(t('messages.successRegister', { label: langLabel }));
      }
      setRecState('idle');
    } catch (e) {
      const base = mapApiError(e, tErr);
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
          setError(mapApiError(e, tErr));
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
          setError(mapApiError(e, tErr));
        }
      },
    });
  };

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
    <div data-testid="voice-profile-section">
      {error && recState !== 'idle' && <Banner $kind="error"><XIcon size={14} />{error}</Banner>}
      {success && <Banner $kind="success"><CheckIcon size={14} />{success}</Banner>}
      <SectionTitle>{t('voice.sectionTitle')}</SectionTitle>
      <Description>
        <Trans i18nKey="voice.description" ns="profile" components={{ 1: <strong />, 2: <strong /> }} />
      </Description>

      {/* 용도 — 생체정보라 «어디에 쓰이는지» 를 먼저 말한다 (VOICE_PROFILE_DESIGN §2-1) */}
      <UsageBox>
        <UsageTitle>{t('voice.usage.title', '어디에 쓰이나요')}</UsageTitle>
        <UsageBody>{variant === 'client'
      ? t('voice.usage.bodyClient', '상담 회의록에서 내 발언에 내 이름이 표시됩니다. 내가 고객으로 연결된 회의에서만 쓰이고, 다른 곳·외부에는 쓰이지 않습니다.')
      : t('voice.usage.body', '내가 속한 워크스페이스의 Q Note 회의에서 내 발언에 내 이름이 붙습니다. 다른 워크스페이스·외부에는 쓰이지 않습니다.')}</UsageBody>
        {fpList && <UsageBody>{t('voice.retention', { months: fpList.retention_months, defaultValue: '{{months}}개월 동안 쓰이지 않으면 자동 삭제됩니다.' })}</UsageBody>}
      </UsageBox>

      {/* 동의 — 체크해야 녹음(등록)을 시작할 수 있다. 서버도 동의 버전 없이는 저장하지 않는다(400 consent_required) */}
      {fpList?.registered && !fpList.consent_current && (
        <OutdatedNote data-testid="voice-consent-outdated">{t('voice.consent.outdated', '안내 문구가 바뀌었습니다. 다시 동의하고 다시 등록하면 자동 인식이 계속됩니다.')}</OutdatedNote>
      )}
      <ConsentRow>
        <input
      type="checkbox"
      id={consentId}
      data-testid="voice-consent"
      checked={consentChecked}
      onChange={(e) => setConsentChecked(e.target.checked)}
      disabled={recState !== 'idle'}
        />
        <label htmlFor={consentId}>{t('voice.consent.label', '내 목소리 특징값 저장과 회의 중 이름 표시에 동의합니다')}</label>
        <ConsentMore type="button" onClick={() => setConsentOpen((v) => !v)} aria-expanded={consentOpen}>
      {consentOpen ? t('voice.consent.hide', '접기') : t('voice.consent.show', '전문 보기')}
        </ConsentMore>
      </ConsentRow>
      {consentOpen && <ConsentFull>{t('voice.consent.full')}</ConsentFull>}
      {!consentChecked && recState === 'idle' && (
        <Hint>{t('voice.consent.required', '동의해야 등록할 수 있습니다.')}</Hint>
      )}

      {/* 회의 자동 인식 — 등록은 두고 매칭만 끈다 */}
      {fpList?.registered && (
        <MatchRow>
      <AutoSaveField type="toggle" onSave={persistMatch}>
        <Switch
          type="button" role="switch"
          data-testid="voice-match-toggle"
          aria-checked={matchOn}
          aria-label={t('voice.match.toggle', '회의에서 자동 인식') as string}
          $on={matchOn}
          onClick={() => { matchRef.current = !matchRef.current; setMatchOn(matchRef.current); }}
        >
          <SwitchKnob $on={matchOn} />
        </Switch>
      </AutoSaveField>
      <span>{t('voice.match.toggle', '회의에서 자동 인식')}</span>
      {!matchOn && <Hint>{t('voice.match.offHint', '등록은 유지되고 회의에서 이름 붙이기만 멈춥니다.')}</Hint>}
        </MatchRow>
      )}

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
                      {lang.updated_at ? ` · ${formatDateTime(lang.updated_at)}` : ''}
                    </RegMeta>
                  </RegLeft>
                  <RegActions>
                    <SecondaryBtn
                      onClick={() => startRecording('register', lang.language === 'unknown' ? 'ko' : lang.language)}
                      disabled={recState !== 'idle' || !consentChecked}
                      title={!consentChecked ? (t('voice.consent.required', '동의해야 등록할 수 있습니다.') as string) : undefined}
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
          {addableOptions.length > 0 && recState === 'idle' && consentChecked && (
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
    </div>
  );
}
