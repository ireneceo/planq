// 공개 Q Note 세션 페이지 — share_token 기반 (인증 없음)
// 라우트: /public/qnote-sessions/:token
// 사이클 N+25 — 회의 transcript + summary read-only 미리보기.
import React, { useEffect, useState } from 'react';
import styled from 'styled-components';
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

  if (loading) return <Center>{t('public.loading', '회의록 로드 중...')}</Center>;
  if (err || !data) {
    return (
      <Center>
        <ErrTitle>{t('public.notFound', '공개되지 않았거나 만료된 링크입니다')}</ErrTitle>
        <ErrHint>{err || t('public.notFoundHint', '링크 만료 또는 작성자가 공유를 해제했습니다.')}</ErrHint>
      </Center>
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
    <Page>
      <Toolbar className="no-print">
        <Brand src="/planQ-slogan_color.svg" alt="PlanQ" />
        <ToolbarSpacer />
        <PrintBtn type="button" onClick={() => window.print()}>{t('public.print', '인쇄 / PDF')}</PrintBtn>
      </Toolbar>
      <PromoBar className="no-print">
        <PromoText>{t('public.promoCopy', '업무, 프로젝트, 사람, 시간, 고객, 청구를 하나로 연결')}</PromoText>
        <PromoLink href="https://planq.kr" target="_blank" rel="noreferrer">
          {t('public.promoCta', '플랜큐 바로가기')} <span aria-hidden="true">→</span>
        </PromoLink>
      </PromoBar>

      <DocFrame data-print-area>
        <DocTitle>{session.title}</DocTitle>
        <DocMeta>
          {new Date(session.created_at).toLocaleString('ko-KR')}
          {session.duration_seconds > 0 && ` · ${Math.round(session.duration_seconds / 60)}${t('public.minute', '분')}`}
          {session.utterance_count > 0 && ` · ${t('public.utteranceCount', { count: session.utterance_count, defaultValue: '발화 {{count}}개' })}`}
        </DocMeta>

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
      </DocFrame>
    </Page>
  );
};

export default PublicQNoteSessionPage;

const Page = styled.div`
  min-height: 100vh; background: #F8FAFC; padding: 0 0 40px 0;
  @media print { background: #FFF; padding: 0; }
`;
const Toolbar = styled.div`
  display: flex; align-items: center; gap: 8px; padding: 12px 24px;
  background: #FFF; border-bottom: 1px solid #E2E8F0;
  position: sticky; top: 0; z-index: 10;
  @media print { display: none !important; }
`;
const Brand = styled.img`display:block;width:88px;height:auto;user-select:none;`;
const ToolbarSpacer = styled.div`flex:1;`;
const PrintBtn = styled.button`
  padding: 7px 14px; font-size: 13px; font-weight: 600; color: #334155;
  border: 1px solid #E2E8F0; border-radius: 8px; background: #FFF; cursor: pointer;
  &:hover { border-color: #14B8A6; color: #0F766E; }
`;
const PromoBar = styled.div`
  display: flex; align-items: center; gap: 14px;
  padding: 9px 24px; background: #F0FDFA; border-bottom: 1px solid #99F6E4;
  font-size: 12px; color: #475569;
  @media print { display: none !important; }
`;
const PromoText = styled.span`flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;`;
const PromoLink = styled.a`
  flex-shrink: 0; color: #0F766E; font-weight: 700; text-decoration: none; white-space: nowrap;
  &:hover { color: #115E59; text-decoration: underline; }
`;
const DocFrame = styled.article`
  max-width: 820px; margin: 32px auto; background: #FFF; border: 1px solid #E2E8F0;
  border-radius: 12px; padding: 48px 56px; box-shadow: 0 4px 12px rgba(0,0,0,0.04);
  font-size: 14px; line-height: 1.7; color: #0F172A;
  @media print { border: none; box-shadow: none; padding: 0; margin: 0; max-width: 100%; }
  @media (max-width: 640px) { padding: 24px 20px; margin: 16px; }
`;
const DocTitle = styled.h1`font-size: 24px; font-weight: 700; color: #0F172A; margin: 0 0 6px 0;`;
const DocMeta = styled.div`font-size: 12px; color: #64748B; margin: 0 0 16px 0;`;
const ParticipantsRow = styled.div`display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 20px;`;
const ParticipantPill = styled.span`
  padding: 4px 10px; font-size: 12px; font-weight: 500; color: #334155;
  background: #F1F5F9; border-radius: 999px;
`;
const ParticipantRole = styled.span`margin-left: 6px; color: #64748B; font-weight: 400;`;
const Section = styled.section`margin-top: 28px; padding-top: 16px; border-top: 1px solid #EEF2F6;`;
const SectionTitle = styled.h2`font-size: 14px; font-weight: 700; color: #0F172A; margin: 0 0 10px 0;`;
const SectionBody = styled.div`font-size: 13px; color: #334155; line-height: 1.7;`;
const SummaryLine = styled.div`margin-bottom: 4px; &::before { content: '· '; color: #94A3B8; }`;
const Utt = styled.div`padding: 10px 0; border-bottom: 1px solid #F1F5F9; &:last-child { border-bottom: none; }`;
const UttSpeaker = styled.div`font-size: 12px; font-weight: 600; color: #0F766E; margin-bottom: 4px;`;
const UttText = styled.div`font-size: 13px; color: #0F172A; line-height: 1.6;`;
const UttTranslated = styled.div`font-size: 12px; color: #64748B; line-height: 1.6; margin-top: 4px; padding-left: 8px; border-left: 2px solid #E2E8F0;`;
const Center = styled.div`min-height: 60vh; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; color: #64748B; font-size: 14px; padding: 24px;`;
const ErrTitle = styled.div`font-size: 16px; font-weight: 600; color: #0F172A;`;
const ErrHint = styled.div`font-size: 13px; color: #64748B;`;
