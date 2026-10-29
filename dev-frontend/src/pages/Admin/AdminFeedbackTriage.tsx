// 관리자 피드백 상세 — «AI 원인 조사» 카드 (2026-10-29 · docs/FEEDBACK_AI_TRIAGE_DESIGN.md).
//   접수되면 상황판이 읽기 전용 정찰 방으로 원인·고칠 방법을 조사해 이 칸(ai_triage*)에 붙인다. 플랫폼관리자만 본다.
//   ★ 텍스트로만 그린다 — 조사 결과는 고객 글을 읽은 AI 의 출력이다(마크다운→HTML·자동 링크 금지).
//   ★ 정찰 방은 운영을 못 읽는다 — «이미 고쳐짐» 은 코드 기준이고 배포 여부는 따로 본다(문구로 알린다).
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { formatDayTime } from '../../utils/dateFormat';

export type TriageVerdict = 'already_fixed' | 'needs_fix' | 'needs_decision' | 'not_dev' | 'unclear' | 'failed';
export interface TriageBody {
  verdict?: TriageVerdict; summary?: string; cause?: string; fix?: string; repro?: string;
  files?: string[]; size?: 'small' | 'medium' | 'large'; fable_needed?: boolean;
  fixed_commit?: string; head?: string; room?: string; error?: string[];
}
interface TriageItem {
  ai_triage_verdict?: TriageVerdict | null;
  ai_triage_at?: string | null;
  ai_triage?: TriageBody | null;
}

export function TriageBox({ detail, label }: { detail: TriageItem; label: (v: TriageVerdict) => string }) {
  const { t } = useTranslation('common');
  const v = detail.ai_triage_verdict;
  if (!v || !detail.ai_triage_at) return <Hint>{t('adminFeedback.triage.none')}</Hint>;
  const b = detail.ai_triage;
  // 본문은 한 건을 따로 읽어 채운다 — 오기 전에는 판단만
  const rows: Array<[string, string | undefined]> = b ? [
    ['summary', b.summary], ['cause', b.cause], ['fix', b.fix], ['repro', b.repro],
  ] : [];
  return (
    <Box>
      <Head>
        <TriageChip $v={v}>{label(v)}</TriageChip>
        {b?.size && <Meta>{t(`adminFeedback.triage.size.${b.size}`)}</Meta>}
        {b?.fable_needed && <Meta>{t('adminFeedback.triage.fableNeeded')}</Meta>}
        <Meta>{formatDayTime(detail.ai_triage_at, { year: 'always' })}</Meta>
      </Head>
      {v === 'failed' && <Hint>{t('adminFeedback.triage.failed')}{b?.error?.length ? ` (${b.error.join(', ')})` : ''}</Hint>}
      {v === 'already_fixed' && <Hint>{t('adminFeedback.triage.fixedHint')}{b?.fixed_commit ? ` · ${b.fixed_commit.slice(0, 8)}` : ''}</Hint>}
      {rows.filter(([, x]) => !!x).map(([k, x]) => (
        <Field key={k}>
          <FieldLabel>{t(`adminFeedback.triage.field.${k}`)}</FieldLabel>
          <FieldText>{x}</FieldText>
        </Field>
      ))}
      {b?.files && b.files.length > 0 && (
        <Field>
          <FieldLabel>{t('adminFeedback.triage.field.files')}</FieldLabel>
          <Files>{b.files.map((f) => <code key={f}>{f}</code>)}</Files>
        </Field>
      )}
      {(b?.head || b?.room) && (
        <Foot>{[b.head ? t('adminFeedback.triage.head', { head: b.head.slice(0, 8) }) : '', b.room ? t('adminFeedback.triage.room', { room: b.room }) : ''].filter(Boolean).join(' · ')}</Foot>
      )}
    </Box>
  );
}

export const TriageChip = styled.span<{ $v: TriageVerdict }>`
  flex-shrink: 0; white-space: nowrap;
  padding: 3px 10px; border-radius: 999px;
  font-size: 0.6875rem; font-weight: 700;
  ${(p) => p.$v === 'needs_fix' ? 'background:#FFEDD5;color:#9A3412;' :
    p.$v === 'already_fixed' ? 'background:#DCFCE7;color:#166534;' :
    p.$v === 'needs_decision' ? 'background:#EDE9FE;color:#5B21B6;' :
    p.$v === 'failed' ? 'background:#FEE2E2;color:#B91C1C;' :
    'background:#F1F5F9;color:#475569;'}
`;
const Box = styled.div`
  display: flex; flex-direction: column; gap: 10px;
  padding: 12px; background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px;
`;
const Head = styled.div`display: flex; align-items: center; gap: 8px; flex-wrap: wrap;`;
const Meta = styled.span`font-size: 0.75rem; color: #64748B;`;
const Hint = styled.div`font-size: 0.78125rem; color: #64748B;`;
const Field = styled.div`display: flex; flex-direction: column; gap: 4px;`;
const FieldLabel = styled.div`font-size: 0.6875rem; font-weight: 700; color: #64748B;`;
const FieldText = styled.div`font-size: 0.8125rem; color: #0F172A; white-space: pre-wrap; word-break: break-word;`;
const Files = styled.div`
  display: flex; flex-wrap: wrap; gap: 4px;
  & > code { font-size: 0.75rem; padding: 2px 6px; background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 4px; word-break: break-all; }
`;
const Foot = styled.div`font-size: 0.6875rem; color: #94A3B8;`;
