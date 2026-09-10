// 공개 Q Note 세션 페이지 — share_token 기반 (인증 없음)
// 라우트: /public/qnote-sessions/:token
// 사이클 N+25 — 회의 transcript + summary read-only 미리보기.
import React, { useEffect, useState } from 'react';
import styled from 'styled-components';
import PublicPageShell, { PublicCenter, PublicTitle, PublicMeta, PublicBtn } from '../../components/Layout/PublicPageShell';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';

interface Speaker {
  id: number;
  deepgram_speaker_id: number;
  participant_name: string | null;
  is_self: number;
}

interface Utterance {
  id: number;
  speaker: string | null;
  original_text: string;
  translated_text: string | null;
  original_language: string | null;
  is_question: number;
  start_time: number | null;
  end_time: number | null;
}

interface PublicSession {
  session: {
    id: number;
    title: string;
    language: string;
    meeting_languages: string[];
    translation_language: string | null;
    duration_seconds: number;
    utterance_count: number;
    status: string;
    created_at: string;
    shared_at: string | null;
    participants: Array<{ name: string; role?: string | null }>;
    brief: string | null;
    input_type: string | null;
    body: string | null;
  };
  utterances: Utterance[];
  speakers: Speaker[];
  summary: { key_points: string | null; full_summary: string | null } | null;
}

const PublicQNoteSessionPage: React.FC = () => {
  const { t } = useTranslation('qnote');
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<PublicSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    fetch(`/qnote/api/sessions/public/by-token/${token}`)
      .then(r => r.json())
      .then(j => {
        if (!j.success) throw new Error(j.detail || j.message || 'load_failed');
        setData(j.data);
      })
      .catch(e => setErr((e as Error).message))
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) return <PublicCenter>{t('public.loading', '회의록 로드 중...')}</PublicCenter>;
  if (err || !data) {
    return (
      <PublicCenter>
        <ErrTitle>{t('public.notFound', '공개되지 않았거나 만료된 링크입니다')}</ErrTitle>
        <ErrHint>{err || t('public.notFoundHint', '링크 만료 또는 작성자가 공유를 해제했습니다.')}</ErrHint>
      </PublicCenter>
    );
  }

  const { session, utterances, speakers, summary } = data;
  const speakerMap = new Map(speakers.map(s => [s.deepgram_speaker_id, s.participant_name || `${t('public.speaker', '화자')} ${s.deepgram_speaker_id}`]));

  // text 메모는 body 가 TipTap JSON. 단순 plain extract.
  let textBody = '';
  if (session.input_type === 'text' && session.body) {
    try {
      const doc = JSON.parse(session.body);
      const walk = (n: { text?: string; content?: unknown[] }): string => {
        if (typeof n.text === 'string') return n.text;
        if (Array.isArray(n.content)) return (n.content as Array<{ text?: string; content?: unknown[] }>).map(walk).join(' ');
        return '';
      };
      textBody = walk(doc).trim();
    } catch { /* not JSON */ }
  }

  return (
    <PublicPageShell
      promo
      actions={(
        <PublicBtn type="button" onClick={() => window.print()}>{t('public.print', '인쇄 / PDF')}</PublicBtn>
      )}
    >

      <>
        <PublicTitle>{session.title}</PublicTitle>
        <PublicMeta>
          {new Date(session.created_at).toLocaleString('ko-KR')}
          {session.duration_seconds > 0 && ` · ${Math.round(session.duration_seconds / 60)}${t('public.minute', '분')}`}
          {session.utterance_count > 0 && ` · ${t('public.utteranceCount', { count: session.utterance_count, defaultValue: '발화 {{count}}개' })}`}
        </PublicMeta>

        {session.participants.length > 0 && (
          <ParticipantsRow>
            {session.participants.map((p, i) => (
              <ParticipantPill key={i}>{p.name}{p.role && <ParticipantRole>{p.role}</ParticipantRole>}</ParticipantPill>
            ))}
          </ParticipantsRow>
        )}

        {session.brief && (
          <Section>
            <SectionTitle>{t('public.brief', '회의 안내')}</SectionTitle>
            <SectionBody>{session.brief}</SectionBody>
          </Section>
        )}

        {summary && (summary.key_points || summary.full_summary) && (
          <Section>
            <SectionTitle>{t('public.summary', '요약')}</SectionTitle>
            {summary.key_points && (
              <SectionBody>
                {summary.key_points.split('\n').filter(Boolean).map((line, i) => (
                  <SummaryLine key={i}>{line}</SummaryLine>
                ))}
              </SectionBody>
            )}
            {summary.full_summary && <SectionBody>{summary.full_summary}</SectionBody>}
          </Section>
        )}

        {session.input_type === 'text' && textBody && (
          <Section>
            <SectionTitle>{t('public.memo', '메모')}</SectionTitle>
            <SectionBody style={{ whiteSpace: 'pre-wrap' }}>{textBody}</SectionBody>
          </Section>
        )}

        {utterances.length > 0 && (
          <Section>
            <SectionTitle>{t('public.transcript', '대화 기록')}</SectionTitle>
            {utterances.map((u) => {
              const dg = u.speaker ? Number(u.speaker.replace(/^\D+/, '') || -1) : -1;
              const name = speakerMap.get(dg) || u.speaker || '';
              return (
                <Utt key={u.id}>
                  <UttSpeaker>{name}</UttSpeaker>
                  <UttText>{u.original_text}</UttText>
                  {u.translated_text && <UttTranslated>{u.translated_text}</UttTranslated>}
                </Utt>
              );
            })}
          </Section>
        )}
      </>
    </PublicPageShell>
  );
};

export default PublicQNoteSessionPage;

const ParticipantRole = styled.span`margin-left: 6px; color: #64748B; font-weight: 400;`;
const Section = styled.section`margin-top: 28px; padding-top: 16px; border-top: 1px solid #E2E8F0;`;
const SectionTitle = styled.h2`font-size: 0.875rem; font-weight: 700; color: #0F172A; margin: 0 0 10px 0;`;
const SectionBody = styled.div`font-size: 0.8125rem; color: #334155; line-height: 1.7;`;
const SummaryLine = styled.div`margin-bottom: 4px; &::before { content: '· '; color: #94A3B8; }`;
const Utt = styled.div`padding: 10px 0; border-bottom: 1px solid #F1F5F9; &:last-child { border-bottom: none; }`;
const UttSpeaker = styled.div`font-size: 0.75rem; font-weight: 600; color: #0F766E; margin-bottom: 4px;`;
const UttText = styled.div`font-size: 0.8125rem; color: #0F172A; line-height: 1.6;`;
const UttTranslated = styled.div`font-size: 0.75rem; color: #64748B; line-height: 1.6; margin-top: 4px; padding-left: 8px; border-left: 2px solid #E2E8F0;`;
const ErrTitle = styled.div`font-size: 1rem; font-weight: 600; color: #0F172A;`;
const ErrHint = styled.div`font-size: 0.8125rem; color: #64748B;`;
const ParticipantPill = styled.span`
  padding: 4px 10px; font-size: 0.75rem; font-weight: 500; color: #334155;
  background: #F1F5F9; border-radius: 999px;
`;
const ParticipantsRow = styled.div`display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 20px;`;
