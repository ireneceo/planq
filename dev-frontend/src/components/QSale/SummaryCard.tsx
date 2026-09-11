// components/QSale/SummaryCard.tsx — 고객 히스토리 요약 카드 (docs/Q_SALE_DESIGN.md §10)
//
// ★ 요약은 **캐시**다 — 낡았는지를 상태로 보여주고(“새 접점 N건 반영 전”), 갱신은 사람이 누를 때만 한다(비용).
// ★ 문장마다 근거를 보여주고, 근거가 없으면 회색으로 그렇게 말한다 — 환각을 사용자가 보는 자리에서 거른다.
//   근거를 누르면 타임라인이 그 항목들만 보여준다(§10.6 ①).
// ★ 상세 화면에서 떼어냈다(파일 800줄 상한) — 같은 카드를 다른 화면에서도 쓸 수 있다.
import { useCallback, useEffect, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useTimeFormat } from '../../hooks/useTimeFormat';
import {
  getClientSummary, refreshClientSummary, setClientSummaryManual, SUMMARY_SECTIONS,
  type SummaryStatus, type TimelineType,
} from '../../services/sale';

type Props = {
  businessId: number | null;
  clientId: number;
  /** 근거 클릭 — 타임라인을 그 항목들만 남긴다 */
  onFilterRefs: (refs: Array<{ type: TimelineType; id: number | string }>) => void;
  refFilterActive: boolean;
  onClearFilter: () => void;
};

export default function SummaryCard({ businessId, clientId, onFilterRefs, refFilterActive, onClearFilter }: Props) {
  const { t } = useTranslation('qsale');
  const { formatDateTime } = useTimeFormat();
  const [status, setStatus] = useState<SummaryStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  const load = useCallback(async () => {
    if (!businessId) return;
    try { setStatus(await getClientSummary(businessId, clientId)); } catch { /* 카드 하나가 상세를 죽이지 않는다 */ }
  }, [businessId, clientId]);
  useEffect(() => { load(); }, [load]);

  const refresh = async (force: boolean) => {
    if (!businessId || busy) return;
    setBusy(true); setMsg(null);
    try {
      const next = await refreshClientSummary(businessId, clientId, force);
      setStatus(next);
      if (next.skipped === 'up_to_date') setMsg(t('summary.upToDate') as string);
      else if (next.skipped === 'no_items') setMsg(t('summary.noItems') as string);
      else if (next.skipped === 'manual_summary') setMsg(t('summary.manualNote') as string);
    } catch (e) {
      const m = (e as Error).message;
      setMsg(m === 'cue_usage_limit_exceeded' ? (t('summary.usageLimit') as string)
        : m === 'ai_unavailable' ? (t('summary.unavailable') as string)
          : (t('error.saveFailed') as string));
    } finally { setBusy(false); }
  };

  const saveManual = async () => {
    if (!businessId || busy || !draft.trim()) return;
    setBusy(true);
    try { setStatus(await setClientSummaryManual(businessId, clientId, draft)); setEditing(false); }
    catch { setMsg(t('error.saveFailed') as string); }
    finally { setBusy(false); }
  };

  const asOf = status?.as_of ? formatDateTime(status.as_of) : null;

  return (
    <Card data-testid="sale-summary-card">
      <Head>
        <Title>{t('summary.title') as string}</Title>
        <Meta>
          {asOf && <Dim title={asOf}>{t('summary.asOf', { date: asOf }) as string}</Dim>}
          {status && (status.new_items > 0
            ? <StaleChip data-testid="sale-summary-stale">{t('summary.stale', { count: status.new_items }) as string}</StaleChip>
            : status.has_summary && <Dim>{t('summary.upToDate') as string}</Dim>)}
          <MiniBtn type="button" data-testid="sale-summary-refresh" disabled={busy} onClick={() => refresh(false)}>
            {busy ? (t('summary.refreshing') as string) : (t('summary.refresh') as string)}
          </MiniBtn>
        </Meta>
      </Head>

      {status?.manual && <Hint>{t('summary.manualNote') as string}</Hint>}
      {msg && <Hint role="status">{msg}</Hint>}

      {editing ? (
        <>
          {/* draft-exempt: 서버에 있는 요약 전문을 불러와 고치는 칸이다. 취소해도 원문이 그대로 남고
              저장은 즉시 PATCH 로 나가므로 "쓰다 만 글" 이 사라지는 경로가 아니다. */}
          <TextArea rows={6} value={draft} onChange={(e) => setDraft(e.target.value)} />
          <Row>
            <MiniBtn type="button" onClick={saveManual} disabled={busy}>{t('summary.editSave') as string}</MiniBtn>
            <MiniBtn type="button" onClick={() => setEditing(false)}>{t('summary.editCancel') as string}</MiniBtn>
          </Row>
        </>
      ) : status?.summary_json ? (
        <>
          {SUMMARY_SECTIONS.map((key) => {
            const rows = status.summary_json?.[key] || [];
            if (!rows.length) return null;
            return (
              <Section key={key}>
                <Label>{t(`summary.section.${key}`) as string}</Label>
                <Lines>
                  {rows.map((row, i) => (
                    <Line key={`${key}-${i}`}>
                      <span>{row.text}</span>
                      {row.refs.length > 0 ? (
                        <RefBtn type="button" onClick={() => onFilterRefs(row.refs)} title={t('summary.showSources') as string}>
                          {t('summary.evidence', { count: row.refs.length }) as string}
                        </RefBtn>
                      ) : (
                        <NoRef>{t('summary.noEvidence') as string}</NoRef>
                      )}
                    </Line>
                  ))}
                </Lines>
              </Section>
            );
          })}
          <Row>
            <MiniBtn type="button" onClick={() => { setDraft(status.summary || ''); setEditing(true); }}>
              {t('summary.edit') as string}
            </MiniBtn>
            {refFilterActive && <MiniBtn type="button" onClick={onClearFilter}>{t('summary.clearFilter') as string}</MiniBtn>}
          </Row>
        </>
      ) : status?.summary ? (
        <>
          <Plain>{status.summary}</Plain>
          <Row>
            <MiniBtn type="button" onClick={() => { setDraft(status.summary || ''); setEditing(true); }}>{t('summary.edit') as string}</MiniBtn>
            {status.manual && <MiniBtn type="button" disabled={busy} onClick={() => refresh(true)}>{t('summary.regenerate') as string}</MiniBtn>}
          </Row>
        </>
      ) : (
        <Dim>{t('summary.empty') as string}</Dim>
      )}
    </Card>
  );
}

const Card = styled.section`background: #fff; border: 1px solid #E2E8F0; border-radius: 12px; padding: 14px;`;
const Head = styled.div`display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; flex-wrap: wrap;`;
const Title = styled.h2`margin: 0; font-size: 0.8125rem; font-weight: 700; color: #334155;`;
const Meta = styled.div`display: flex; align-items: center; gap: 6px; flex-wrap: wrap;`;
const Dim = styled.span`font-size: 0.75rem; color: #94A3B8; white-space: nowrap;`;
const Hint = styled.div`font-size: 0.6875rem; color: #94A3B8; margin-bottom: 6px;`;
const StaleChip = styled.span`
  display: inline-flex; align-items: center; padding: 3px 8px; border-radius: 999px; line-height: 1.3;
  font-size: 0.6875rem; font-weight: 700; color: #92400E; background: #FEF3C7; white-space: nowrap;
`;
const Section = styled.div`display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px;`;
const Label = styled.div`font-size: 0.6875rem; font-weight: 700; color: #94A3B8;`;
const Lines = styled.div`display: flex; flex-direction: column; gap: 4px;`;
const Line = styled.div`display: flex; align-items: baseline; gap: 6px; font-size: 0.8125rem; color: #0F172A; line-height: 1.5;`;
const RefBtn = styled.button`
  flex-shrink: 0; padding: 1px 6px; border-radius: 999px; cursor: pointer;
  font-size: 0.6875rem; font-weight: 600; color: #0F766E; background: #F0FDFA; border: 1px solid #99F6E4;
  &:hover { background: #CCFBF1; }
`;
/* 근거가 없는 문장은 지우지 않고 **그렇게 보이게** 둔다 — 지우면 무엇이 틀렸는지도 사라진다 */
const NoRef = styled.span`flex-shrink: 0; font-size: 0.6875rem; color: #CBD5E1;`;
const Plain = styled.div`font-size: 0.8125rem; color: #334155; line-height: 1.6; white-space: pre-wrap;`;
const Row = styled.div`display: flex; gap: 6px; margin-top: 6px;`;
const MiniBtn = styled.button`
  height: 36px; padding: 0 10px; border-radius: 6px; cursor: pointer;
  font-size: 0.6875rem; font-weight: 600; color: #475569;
  background: #fff; border: 1px solid #E2E8F0;
  &:hover { background: #F8FAFC; }
  &:disabled { opacity: 0.6; cursor: default; }
`;
const TextArea = styled.textarea`
  padding: 8px 10px; border: 1px solid #E2E8F0; border-radius: 8px;
  font-size: 0.8125rem; color: #0F172A; width: 100%; resize: vertical; font-family: inherit;
  &:focus { outline: none; border-color: #5EEAD4; }
`;
