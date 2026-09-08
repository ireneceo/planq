// 메일 브리프 — 요약 · 검증 · 지금 어느 순간인가.
//
// Irene 2026-09-08: *"번역 옆에 메일 요약 및 검증이 나와서 누르면 번역 처럼 요약내용 간략하게
//   알려주고 실제 메일이 어떤 상황인지 믿어도 되는지 그리고 연결된 프로젝트나 고객이 있다면
//   추가로 어느 순간인지 알려줄 수 있어?"*
//
// ★ 검증 문구는 **서버가 준 신호를 사람 말로 옮길 뿐**이다. 여기서 판단을 새로 만들지 않는다 —
//   화면이 자체 판정을 하기 시작하면 서버와 갈라지고, 갈라진 쪽이 곧 거짓말이 된다.
//   신호 코드를 모르면 코드를 그대로 보여준다(조용히 감추지 않는다 — 감추면 새 신호가 안 보인다).
import React from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';

export interface TrustSignal { code: string; level: 'ok' | 'info' | 'warn' | 'danger'; detail?: string }
export interface MailBrief {
  summary: string[] | null;
  ai_error?: string | null;
  trust: { level: 'ok' | 'caution' | 'danger'; signals: TrustSignal[] };
  situation: {
    message_count: number;
    last_direction: string | null;
    days_since_last: number | null;
    reply_needed: boolean;
    thread_status: string | null;
    triage: string | null;
    position: number;
  };
  links: {
    client: { id: number; name: string } | null;
    project: { id: number; name: string; status?: string } | null;
    stage: { kind: string; label: string; status: string } | null;
    stage_progress?: { done: number; total: number };
    next_action?: unknown;
    invoices: { id: number; number: string; status: string; owed: number; currency: string; due_date?: string | null }[];
    tasks: { id: number; title: string; status: string; due_date?: string | null }[];
  };
  suggestions: string[];
  generated_at: string;
}

const TRUST_TONE: Record<string, string> = { ok: '#0F9D58', caution: '#B45309', danger: '#DC2626' };

const MailBriefPanel: React.FC<{ brief: MailBrief }> = ({ brief }) => {
  const { t } = useTranslation('qmail');
  const tone = TRUST_TONE[brief.trust.level] || '#64748B';

  // 신호 → 사람 말. 키가 없으면 코드를 그대로 노출한다(새 신호가 조용히 사라지지 않게).
  const signalText = (s: TrustSignal): string => {
    const key = `brief.signal.${s.code}`;
    const txt = t(key, { detail: s.detail || '', defaultValue: '' }) as string;
    return txt || `${s.code}${s.detail ? ` (${s.detail})` : ''}`;
  };

  const money = (n: number, cur: string) =>
    `${Math.round(n).toLocaleString('ko-KR')} ${cur}`;

  return (
    <Wrap data-testid="mail-brief-panel">
      <Row>
        <TrustBadge $c={tone}>
          {/* 세 단계를 각각 부른다 — 폴백(defaultValue)이 키와 한 줄에 붙어 있어야
              번역이 빠졌을 때 무엇이 대신 나오는지 읽는 사람이 바로 안다. */}
          {brief.trust.level === 'danger'
            ? t('brief.trust.danger', { defaultValue: '위험 신호' }) as string
            : brief.trust.level === 'caution'
              ? t('brief.trust.caution', { defaultValue: '확인 필요' }) as string
              : t('brief.trust.ok', { defaultValue: '특이 신호 없음' }) as string}
        </TrustBadge>
        <Meta>
          {t('brief.situation.line', {
            count: brief.situation.message_count,
            days: brief.situation.days_since_last ?? 0,
            defaultValue: '이 대화 {{count}}통 · 마지막 메일 {{days}}일 전',
          }) as string}
          {brief.situation.reply_needed
            ? ` · ${t('brief.situation.replyNeeded', { defaultValue: '답장 필요' }) as string}`
            : ''}
        </Meta>
      </Row>

      {/* 검증 — 근거를 하나씩 보여준다. "안전합니다" 한 줄로 끝내면 믿을 근거가 없다. */}
      <SignalList>
        {brief.trust.signals.map((s, i) => (
          <SignalItem key={`${s.code}-${i}`} $level={s.level}>
            <Dot $level={s.level} aria-hidden="true" />
            {signalText(s)}
          </SignalItem>
        ))}
      </SignalList>

      {brief.summary && brief.summary.length > 0 && (
        <Section>
          <H>{t('brief.summaryTitle', { defaultValue: '요약' }) as string}</H>
          <Ul>{brief.summary.map((l, i) => <li key={i}>{l}</li>)}</Ul>
        </Section>
      )}
      {brief.ai_error && (
        <Note>{t('brief.aiUnavailable', { defaultValue: '요약은 지금 만들 수 없어요. 아래 확인 내용은 그대로 유효합니다.' }) as string}</Note>
      )}

      {(brief.links.client || brief.links.project) && (
        <Section>
          <H>{t('brief.contextTitle', { defaultValue: '연결된 일' }) as string}</H>
          <Ul>
            {brief.links.client && (
              <li>{t('brief.client', { name: brief.links.client.name, defaultValue: '고객: {{name}}' }) as string}</li>
            )}
            {brief.links.project && (
              <li>
                {t('brief.project', { name: brief.links.project.name, defaultValue: '프로젝트: {{name}}' }) as string}
                {brief.links.stage && ` — ${t('brief.stageNow', {
                  label: brief.links.stage.label,
                  defaultValue: '지금 «{{label}}» 단계',
                }) as string}`}
                {brief.links.stage_progress && brief.links.stage_progress.total > 0
                  && ` (${brief.links.stage_progress.done}/${brief.links.stage_progress.total})`}
              </li>
            )}
            {brief.links.invoices.map((iv) => (
              <li key={iv.id}>
                {t('brief.invoiceOwed', {
                  number: iv.number, amount: money(iv.owed, iv.currency),
                  defaultValue: '미수금 {{number}} — {{amount}}',
                }) as string}
              </li>
            ))}
            {brief.links.tasks.slice(0, 3).map((tk) => (
              <li key={tk.id}>
                {t('brief.openTask', { title: tk.title, defaultValue: '열린 업무: {{title}}' }) as string}
              </li>
            ))}
          </Ul>
        </Section>
      )}

      {brief.suggestions.length > 0 && (
        <Section>
          <H>{t('brief.nextTitle', { defaultValue: '다음 할 일' }) as string}</H>
          <Ul>{brief.suggestions.map((l, i) => <li key={i}>{l}</li>)}</Ul>
        </Section>
      )}
    </Wrap>
  );
};

const Wrap = styled.div`
  margin-top: 8px; padding: 12px 14px; border-radius: 8px;
  background: #F8FAFC; border: 1px solid #E2E8F0;
  color: #1E293B; font-size: 0.8125rem; line-height: 1.6;
`;
const Row = styled.div`
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 8px;
`;
const TrustBadge = styled.span<{ $c: string }>`
  display: inline-flex; align-items: center;
  padding: 2px 10px; border-radius: 999px;
  font-size: 0.6875rem; font-weight: 700;
  color: ${p => p.$c}; background: ${p => p.$c}1A; border: 1px solid ${p => p.$c}55;
`;
const Meta = styled.span`font-size: 0.75rem; color: #64748B;`;
const SignalList = styled.ul`margin: 0 0 4px; padding: 0; list-style: none; display: grid; gap: 3px;`;
const SignalItem = styled.li<{ $level: string }>`
  display: flex; align-items: flex-start; gap: 6px;
  font-size: 0.75rem;
  color: ${p => (p.$level === 'danger' ? '#B91C1C' : p.$level === 'warn' ? '#B45309' : '#475569')};
`;
const Dot = styled.span<{ $level: string }>`
  flex-shrink: 0; width: 6px; height: 6px; border-radius: 50%; margin-top: 6px;
  background: ${p => (p.$level === 'danger' ? '#DC2626' : p.$level === 'warn' ? '#F59E0B' : p.$level === 'ok' ? '#0F9D58' : '#94A3B8')};
`;
const Section = styled.div`margin-top: 8px;`;
const H = styled.div`font-size: 0.6875rem; font-weight: 700; color: #64748B; margin-bottom: 3px;`;
const Ul = styled.ul`margin: 0; padding-left: 16px; display: grid; gap: 2px;`;
const Note = styled.div`margin-top: 6px; font-size: 0.75rem; color: #B45309;`;

export default MailBriefPanel;
