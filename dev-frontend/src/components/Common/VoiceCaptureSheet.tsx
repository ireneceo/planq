// 말로 추가 — 우측 하단 퀵버튼(RightDock)에서 열리는 녹음 시트. 모바일 우선.
//
// 설계: docs/MAIL_ALIAS_AND_VOICE_DESIGN.md §B
//   말한다 → 전사 → AI 가 무엇인지 판단(업무·일정·메모·메일) → **미리보기** → 사람이 확인해야 저장.
//   자동 저장하지 않는다. 잘못 들은 말이 그대로 업무가 되면 그 기능은 두 번 다시 안 쓴다.
import { useCallback, useEffect, useRef, useState } from 'react';
import styled, { keyframes } from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { apiFetch, useAuth } from '../../contexts/AuthContext';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import { useEscapeStack } from '../../hooks/useEscapeStack';
import ActionButton from './ActionButton';

const MAX_SECONDS = 30;

type Kind = 'task' | 'event' | 'memo' | 'mail';
interface Intent {
  kind: Kind;
  title: string;
  detail: string;
  assignee_name: string | null;
  when: string | null;
  confidence: number;
}
type Stage = 'idle' | 'recording' | 'thinking' | 'preview' | 'error';

interface Props { onClose: () => void; }

export default function VoiceCaptureSheet({ onClose }: Props) {
  const { t } = useTranslation('common');
  const { user } = useAuth();
  const navigate = useNavigate();
  const businessId = user?.business_id ? Number(user.business_id) : null;

  const [stage, setStage] = useState<Stage>('idle');
  const [seconds, setSeconds] = useState(0);
  const [text, setText] = useState('');
  const [intent, setIntent] = useState<Intent | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useBodyScrollLock(true);
  useEscapeStack(true, onClose);

  const stopTracks = () => {
    recRef.current?.stream.getTracks().forEach((tr) => tr.stop());
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  };

  const send = useCallback(async (blob: Blob) => {
    if (!businessId) return;
    setStage('thinking');
    try {
      const fd = new FormData();
      fd.append('audio', blob, 'voice.webm');
      fd.append('business_id', String(businessId));
      const r = await apiFetch('/api/voice/capture', { method: 'POST', body: fd });
      const j = await r.json();
      if (!j.success) {
        setErr(j.message === 'stt_unavailable'
          ? t('voice.unavailable', { defaultValue: '음성 인식을 사용할 수 없어요. 잠시 후 다시 시도해 주세요.' }) as string
          : t('voice.failed', { defaultValue: '인식하지 못했어요. 다시 말해 주세요.' }) as string);
        setStage('error');
        return;
      }
      if (j.data.empty || !j.data.text) {
        setErr(t('voice.silent', { defaultValue: '들리지 않았어요. 다시 말해 주세요.' }) as string);
        setStage('error');
        return;
      }
      setText(j.data.text);
      setIntent(j.data.intent);
      setStage('preview');
    } catch {
      setErr(t('voice.failed', { defaultValue: '인식하지 못했어요. 다시 말해 주세요.' }) as string);
      setStage('error');
    }
  }, [businessId, t]);

  const start = useCallback(async () => {
    setErr(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      rec.onstop = () => {
        stopTracks();
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' });
        if (blob.size > 0) send(blob);
      };
      recRef.current = rec;
      rec.start();
      setStage('recording');
      setSeconds(0);
      timerRef.current = setInterval(() => {
        setSeconds((s) => {
          if (s + 1 >= MAX_SECONDS) { rec.stop(); return MAX_SECONDS; }   // 30초 캡 — 비용·집중
          return s + 1;
        });
      }, 1000);
    } catch {
      setErr(t('voice.noPermission', { defaultValue: '마이크 권한이 필요해요. 브라우저 설정에서 허용해 주세요.' }) as string);
      setStage('error');
    }
  }, [send, t]);

  const stop = () => { recRef.current?.stop(); };

  // 화면을 벗어나면(전화 수신·앱 전환) 녹음을 멈추고 거기까지 전사한다
  useEffect(() => {
    const onHide = () => { if (recRef.current?.state === 'recording') recRef.current.stop(); };
    document.addEventListener('visibilitychange', onHide);
    return () => { document.removeEventListener('visibilitychange', onHide); stopTracks(); };
  }, []);

  // 확인 — 의도별로 기존 경로에 넘긴다 (여기서 직접 저장하지 않는다)
  const confirm = () => {
    if (!intent || busy) return;
    setBusy(true);
    const q = encodeURIComponent(text);
    if (intent.kind === 'task') navigate(`/tasks?create=1&voice=${q}`);
    else if (intent.kind === 'event') navigate(`/calendar?create=1&voice=${q}`);
    else if (intent.kind === 'mail') navigate(`/mail?compose=1&voice=${q}`);
    else navigate(`/memo?voice=${q}`);   // 메모는 개인 보관함(L1)
    onClose();
  };

  const kindLabel = (k: Kind) => t(`voice.kind.${k}`, {
    defaultValue: { task: '업무', event: '일정', memo: '메모', mail: '메일 답장' }[k],
  }) as string;

  return (
    <Backdrop onClick={onClose}>
      <Sheet onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={t('voice.title', { defaultValue: '말로 추가' }) as string}>
        <Head>
          <Title>{t('voice.title', { defaultValue: '말로 추가' }) as string}</Title>
          <CloseBtn type="button" onClick={onClose} aria-label={t('close', { defaultValue: '닫기' }) as string}>✕</CloseBtn>
        </Head>

        {stage === 'idle' && (
          <Body>
            <Hint>{t('voice.hint', { defaultValue: '말하면 업무·일정·메모·메일 중 무엇인지 알아서 판단해요. 만들기 전에 항상 확인 화면을 보여줍니다.' }) as string}</Hint>
            <Examples>
              <Ex>"{t('voice.ex1', { defaultValue: '루아님께 경쟁사 비교표 이번 주까지 요청해줘' }) as string}"</Ex>
              <Ex>"{t('voice.ex2', { defaultValue: '다음 주 화요일 3시 아이린앤컴퍼니 미팅' }) as string}"</Ex>
            </Examples>
            <MicBtn type="button" onClick={start} aria-label={t('voice.start', { defaultValue: '녹음 시작' }) as string}>
              <MicIcon viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="23" />
              </MicIcon>
            </MicBtn>
            <MicLabel>{t('voice.tapToSpeak', { defaultValue: '눌러서 말하기' }) as string}</MicLabel>
          </Body>
        )}

        {stage === 'recording' && (
          <Body>
            <Pulse />
            <RecText>{t('voice.recording', { n: seconds, defaultValue: '녹음 중 {{n}}초' }) as string}</RecText>
            <Remain>{t('voice.remain', { n: MAX_SECONDS - seconds, defaultValue: '{{n}}초 남음' }) as string}</Remain>
            <ActionButton tone="primary" size="md" onClick={stop}>
              {t('voice.stop', { defaultValue: '말하기 끝' }) as string}
            </ActionButton>
          </Body>
        )}

        {stage === 'thinking' && (
          <Body>
            <Spinner aria-hidden="true" />
            <RecText>{t('voice.thinking', { defaultValue: '무슨 말인지 보는 중…' }) as string}</RecText>
          </Body>
        )}

        {stage === 'error' && (
          <Body>
            <ErrText>{err}</ErrText>
            <ActionButton tone="secondary" size="md" onClick={start}>
              {t('voice.retry', { defaultValue: '다시 말하기' }) as string}
            </ActionButton>
          </Body>
        )}

        {stage === 'preview' && intent && (
          <Body $left>
            <Said>“{text}”</Said>
            <Card>
              <KindChip $kind={intent.kind}>{kindLabel(intent.kind)}</KindChip>
              <CardTitle>{intent.title}</CardTitle>
              <CardMeta>
                {intent.assignee_name && <Meta>{t('voice.assignee', { defaultValue: '담당' }) as string}: {intent.assignee_name}</Meta>}
                {intent.when && <Meta>{intent.when}</Meta>}
              </CardMeta>
              {intent.detail && <CardDetail>{intent.detail}</CardDetail>}
            </Card>
            <Row>
              <ActionButton tone="primary" size="md" onClick={confirm} loading={busy}>
                {t('voice.confirm', { defaultValue: '이대로 만들기' }) as string}
              </ActionButton>
              <ActionButton tone="secondary" size="md" onClick={start} disabled={busy}>
                {t('voice.retry', { defaultValue: '다시 말하기' }) as string}
              </ActionButton>
            </Row>
            <FootHint>{t('voice.editHint', { defaultValue: '다음 화면에서 내용을 고칠 수 있어요.' }) as string}</FootHint>
          </Body>
        )}
      </Sheet>
    </Backdrop>
  );
}

const pulse = keyframes`0%,100%{transform:scale(1);opacity:.9}50%{transform:scale(1.15);opacity:.55}`;
const spin = keyframes`to{transform:rotate(360deg)}`;

const Backdrop = styled.div`
  position: fixed; inset: 0; z-index: 1200;
  background: rgba(15, 23, 42, 0.45);
  display: flex; align-items: flex-end; justify-content: center;
  @media (min-width: 641px) { align-items: center; }
`;
const Sheet = styled.div`
  width: 100%; max-width: 420px;
  background: #fff; border-radius: 16px 16px 0 0;
  padding: 16px 20px calc(20px + env(safe-area-inset-bottom));
  box-shadow: 0 -8px 32px rgba(15, 23, 42, 0.18);
  @media (min-width: 641px) { border-radius: 16px; padding-bottom: 20px; }
`;
const Head = styled.div`display: flex; align-items: center; justify-content: space-between;`;
const Title = styled.h3`margin: 0; font-size: 15px; font-weight: 700; color: #0F172A;`;
const CloseBtn = styled.button`
  width: 32px; height: 32px; border: none; background: none; cursor: pointer;
  color: #94A3B8; font-size: 14px; border-radius: 8px;
  &:hover { background: #F1F5F9; color: #334155; }
`;
const Body = styled.div<{ $left?: boolean }>`
  display: flex; flex-direction: column; gap: 12px;
  align-items: ${(p) => (p.$left ? 'stretch' : 'center')};
  padding: 18px 0 6px;
`;
const Hint = styled.p`margin: 0; font-size: 13px; color: #64748B; line-height: 1.6; text-align: center;`;
const Examples = styled.div`display: flex; flex-direction: column; gap: 4px; align-items: center;`;
const Ex = styled.span`font-size: 12px; color: #94A3B8;`;
const MicBtn = styled.button`
  width: 72px; height: 72px; border-radius: 50%; border: none; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  color: #fff; background: linear-gradient(135deg, #F43F5E 0%, #BE185D 100%);
  box-shadow: 0 8px 24px rgba(244, 63, 94, 0.32);
  transition: transform 0.15s ease;
  &:hover { transform: translateY(-2px); }
  &:focus-visible { outline: 3px solid #F43F5E; outline-offset: 3px; }
`;
const MicIcon = styled.svg`width: 30px; height: 30px;`;
const MicLabel = styled.span`font-size: 12px; font-weight: 600; color: #64748B;`;
const Pulse = styled.div`
  width: 64px; height: 64px; border-radius: 50%;
  background: linear-gradient(135deg, #F43F5E 0%, #BE185D 100%);
  animation: ${pulse} 1.2s ease-in-out infinite;
  @media (prefers-reduced-motion: reduce) { animation: none; }
`;
const RecText = styled.div`font-size: 14px; font-weight: 700; color: #0F172A;`;
const Remain = styled.div`font-size: 12px; color: #94A3B8;`;
const Spinner = styled.div`
  width: 32px; height: 32px; border-radius: 50%;
  border: 3px solid #E2E8F0; border-top-color: #14B8A6;
  animation: ${spin} 0.8s linear infinite;
  @media (prefers-reduced-motion: reduce) { animation-duration: 2.5s; }
`;
const ErrText = styled.div`font-size: 13px; color: #B45309; text-align: center; line-height: 1.6;`;
const Said = styled.div`
  font-size: 13px; color: #475569; line-height: 1.6;
  padding: 10px 12px; background: #F8FAFC; border-radius: 10px;
`;
const Card = styled.div`
  display: flex; flex-direction: column; gap: 6px;
  padding: 12px 14px; border: 1px solid #E2E8F0; border-radius: 12px;
`;
const KIND_TONE: Record<Kind, { bg: string; fg: string }> = {
  task: { bg: '#F0FDFA', fg: '#0F766E' },
  event: { bg: '#EFF6FF', fg: '#1D4ED8' },
  memo: { bg: '#FEF3C7', fg: '#92400E' },
  mail: { bg: '#FDF2F8', fg: '#BE185D' },
};
const KindChip = styled.span<{ $kind: Kind }>`
  align-self: flex-start; padding: 1px 8px; border-radius: 999px;
  font-size: 11px; font-weight: 700;
  background: ${(p) => KIND_TONE[p.$kind].bg}; color: ${(p) => KIND_TONE[p.$kind].fg};
`;
const CardTitle = styled.div`font-size: 14px; font-weight: 600; color: #0F172A; line-height: 1.5;`;
const CardMeta = styled.div`display: flex; gap: 8px; flex-wrap: wrap;`;
const Meta = styled.span`font-size: 11px; color: #94A3B8;`;
const CardDetail = styled.div`font-size: 12px; color: #64748B; line-height: 1.6;`;
const Row = styled.div`display: flex; gap: 8px;`;
const FootHint = styled.div`font-size: 11px; color: #94A3B8; text-align: center;`;
