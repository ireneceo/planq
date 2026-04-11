import { useEffect, useRef, useState, useCallback } from 'react';
import styled from 'styled-components';
import { useAuth, apiFetch } from '../../contexts/AuthContext';
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
      setError(e instanceof Error ? e.message : '상태 조회 실패');
    } finally {
      setLoading(false);
    }
  }, []);

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
      setError(e instanceof Error ? e.message : '마이크 권한 필요');
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
          ? `매칭 확인 실패: 최소 ${minSec}초 이상 녹음이 필요합니다 (현재 ${capturedElapsed.toFixed(1)}초). 다시 시도해주세요.`
          : `등록 실패: 최소 ${minSec}초 이상 녹음이 필요합니다 (현재 ${capturedElapsed.toFixed(1)}초). 예시 문장을 끝까지 읽고 "녹음 완료"를 눌러주세요.`;
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
        setSuccess(`${langLabel} 음성이 등록되었습니다`);
      }
      setRecState('idle');
    } catch (e) {
      const base = e instanceof Error ? e.message : '처리 실패';
      const prefix = purpose === 'verify' ? '매칭 확인 실패' : '등록 실패';
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
      title: '음성 등록 삭제',
      message: `${label} 음성 등록을 삭제하시겠습니까? 다음 회의부터 본인 자동 감지에 이 언어는 사용되지 않습니다.`,
      onConfirm: async () => {
        closeConfirm();
        try {
          await deleteVoiceFingerprintLanguage(lang);
          await load();
          setSuccess(`${label} 등록이 삭제되었습니다`);
        } catch (e) {
          setError(e instanceof Error ? e.message : '삭제 실패');
        }
      },
    });
  };

  const handleDeleteAll = () => {
    setConfirm({
      open: true,
      title: '모든 음성 등록 삭제',
      message: '등록된 모든 언어의 음성 핑거프린트를 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.',
      onConfirm: async () => {
        closeConfirm();
        try {
          await deleteAllVoiceFingerprints();
          await load();
          setSuccess('모든 음성 등록이 삭제되었습니다');
        } catch (e) {
          setError(e instanceof Error ? e.message : '삭제 실패');
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
      if (!res.ok || !data.success) throw new Error(data.message || '언어 저장 실패');
      setLanguage(code);
      if (updateUser) updateUser({ language: code });
      setSuccess('기본 언어가 변경되었습니다');
    } catch (e) {
      setError(e instanceof Error ? e.message : '언어 저장 실패');
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
          <Title>내 프로필</Title>
          <Subtitle>음성 핑거프린트와 기본 설정을 관리합니다</Subtitle>
        </Header>

        <div ref={errorBannerRef} />
        {error && <Banner $kind="error"><XIcon size={14} />{error}</Banner>}
        {success && <Banner $kind="success"><CheckIcon size={14} />{success}</Banner>}

        {/* 기본 정보 */}
        <Card>
          <SectionTitle>기본 정보</SectionTitle>
          <FieldRow>
            <Label>이름</Label>
            <ReadOnly>{user?.name || '-'}</ReadOnly>
          </FieldRow>
          <FieldRow>
            <Label>이메일</Label>
            <ReadOnly>{user?.email || '-'}</ReadOnly>
          </FieldRow>
          <FieldRow>
            <Label>기본 언어</Label>
            <FieldBody>
              <PlanQSelect
                value={langOptions.find((o) => o.value === language) || null}
                onChange={(opt) => {
                  const v = (opt as { value: string } | null)?.value;
                  if (v) handleLanguageChange(v);
                }}
                options={langOptions}
                placeholder="언어 선택"
                isDisabled={langSaving}
                size="sm"
              />
              <Hint>회의 시 번역 기본값으로 사용됩니다</Hint>
            </FieldBody>
          </FieldRow>
        </Card>

        {/* 음성 핑거프린트 (다국어) */}
        <Card>
          <SectionTitle>내 목소리 등록</SectionTitle>
          <Description>
            회의 중 <strong>본인 발화를 자동으로 인식</strong>하려면 목소리를 등록해주세요.
            {' '}회의에서 사용하는 언어가 여러 개면 <strong>각 언어별로 한 번씩 등록</strong>해야 합니다.
            영어로 등록한 목소리로는 한국어 발화 인식 정확도가 떨어집니다.
          </Description>

          {loading ? (
            <Hint>불러오는 중...</Hint>
          ) : (
            <>
              <RegList>
                {(fpList?.languages || []).length === 0 && (
                  <EmptyHint>
                    아직 등록된 목소리가 없습니다. 아래에서 언어를 선택하고 녹음해주세요.
                  </EmptyHint>
                )}
                {(fpList?.languages || []).map((lang) => {
                  const meta = getLanguageByCode(lang.language);
                  const label = meta?.label || lang.language.toUpperCase();
                  const isLegacy = lang.language === 'unknown';
                  return (
                    <RegItem key={lang.language}>
                      <RegLeft>
                        <RegLabel>{isLegacy ? '언어 미지정 (과거 등록)' : label}</RegLabel>
                        <RegMeta>
                          {lang.sample_seconds ? `${lang.sample_seconds.toFixed(1)}초` : ''}
                          {lang.updated_at ? ` · ${new Date(lang.updated_at).toLocaleString('ko-KR')}` : ''}
                        </RegMeta>
                      </RegLeft>
                      <RegActions>
                        <SecondaryBtn
                          onClick={() => startRecording('register', lang.language === 'unknown' ? 'ko' : lang.language)}
                          disabled={recState !== 'idle'}
                        >
                          재등록
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
                      등록할 언어를 선택하면 <strong>바로 녹음이 시작</strong>됩니다
                    </span>
                  </AddLangLabel>
                  <PlanQSelect
                    value={null}
                    onChange={(opt) => {
                      const v = (opt as { value: string } | null)?.value;
                      if (v) startRecording('register', v);
                    }}
                    options={addableOptions}
                    placeholder="＋ 언어 선택해서 등록하기"
                    size="sm"
                  />
                </AddLangRow>
              )}

              {/* 매칭 확인 + 전체 삭제 */}
              {(fpList?.languages.length || 0) > 0 && recState === 'idle' && (
                <ActionRow>
                  <SecondaryBtn onClick={() => startRecording('verify')}>
                    매칭 확인하기
                  </SecondaryBtn>
                  <Hint style={{ flex: 1 }}>
                    지금 목소리로 5초 녹음해 저장된 핑거프린트와 정확히 매칭되는지 확인합니다
                  </Hint>
                  <DangerBtn onClick={handleDeleteAll}>
                    <TrashIcon size={12} />
                    <span>전체 삭제</span>
                  </DangerBtn>
                </ActionRow>
              )}
            </>
          )}

          {/* 매칭 확인 결과 */}
          {verifyResult && (
            <VerifyResultBox $match={verifyResult.match}>
              <VerifyResultLine>
                <strong>{verifyResult.match ? '본인으로 인식됩니다' : '본인으로 인식되지 않습니다'}</strong>
                <span>최고 유사도 {verifyResult.similarity.toFixed(3)} / 임계값 {verifyResult.threshold.toFixed(2)}</span>
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
                    {getLanguageByCode(recLanguage)?.label || recLanguage.toUpperCase()} · 아래 문장을 자연스럽게 낭독해주세요 (최소 {MIN_SEC}초)
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
                        {' '}/ 최소 {minSec}s · 권장 {softTarget}s · 최대 {hardMax}s
                      </RecHint>
                    </RecElapsed>
                    <RecRemaining>
                      {!readyToStop
                        ? `${Math.ceil(minSec - elapsed)}초 더 녹음`
                        : reachedSoftTarget
                          ? '충분합니다 — 완료해도 됩니다'
                          : '완료 버튼을 누를 수 있습니다'}
                    </RecRemaining>
                  </RecordingRow>
                  <LevelBar>
                    <LevelFill style={{ width: `${levelPct}%` }} />
                  </LevelBar>
                  <RecBtnRow>
                    <PrimaryBtn onClick={stopRecording} disabled={!readyToStop}>
                      <CheckIcon size={14} />
                      <span>
                        {recPurpose === 'verify' ? '확인 완료' : '녹음 완료'}
                        {!readyToStop ? ` (${Math.ceil(minSec - elapsed)}초 더)` : ''}
                      </span>
                    </PrimaryBtn>
                    <SecondaryBtn onClick={cancelRecording}>
                      <XIcon size={14} />
                      <span>취소</span>
                    </SecondaryBtn>
                  </RecBtnRow>
                  <RecHintLine>
                    문장을 끝까지 말씀한 뒤 직접 "녹음 완료"를 눌러주세요. {hardMax}초 도달 시 자동 종료됩니다.
                  </RecHintLine>
                </RecordingUI>
              )}

              {recState === 'processing' && (
                <ProcessingUI>임베딩 계산 중...</ProcessingUI>
              )}
            </RecorderBox>
          )}

          {/* 녹음이 종료되고 에러가 남은 경우, 녹음 섹션 자리에도 인라인 표시 */}
          {recState === 'idle' && error && (
            <InlineError>
              <XIcon size={14} />
              <span>{error}</span>
              <RetryBtn onClick={() => setError(null)}>닫기</RetryBtn>
            </InlineError>
          )}
        </Card>

        {/* 개인정보 안내 */}
        <Card>
          <SectionTitle>개인정보 처리</SectionTitle>
          <PrivacyList>
            <PrivacyItem>
              <strong>등록 데이터</strong>: 원본 오디오는 저장되지 않습니다. Resemblyzer 모델이 추출한 256차원 벡터(수학적 특징)만 DB에 저장되며,
              이 벡터로는 원본 음성을 <strong>복원할 수 없습니다</strong>. 재생 기능이 없는 이유입니다.
            </PrivacyItem>
            <PrivacyItem>
              <strong>사용처</strong>: 회의 중 본인 발화 자동 감지, 회의 종료 시 같은 사람의 발화 자동 병합. 외부 서비스로 전송되지 않습니다.
            </PrivacyItem>
            <PrivacyItem>
              <strong>회의 오디오</strong>: 회의 중 메모리에 일시적으로 버퍼링되며, 회의 종료 시 즉시 폐기됩니다.
            </PrivacyItem>
            <PrivacyItem>
              <strong>삭제 권리</strong>: 위 "삭제" 또는 "전체 삭제" 버튼으로 언제든 등록을 철회할 수 있습니다.
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
        confirmText="삭제"
        cancelText="취소"
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
